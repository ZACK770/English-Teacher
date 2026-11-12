import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { customerControlOverrides } from "../src/platform";
import { BusinessStore } from "../src/business";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ADMIN = "test-admin-token-with-at-least-32-characters";
let db;
let env;

function prepare(query) {
  let values = [];
  const statement = {
    bind(...params) { values = params; return statement; },
    async first() { return db.prepare(query).get(...values) ?? null; },
    async all() { return { results: db.prepare(query).all(...values) }; },
    async run() { return { success: true, meta: { changes: Number(db.prepare(query).run(...values).changes) } }; },
  };
  return statement;
}
async function call(path, data, { method = data === undefined ? "GET" : "POST", token = ADMIN } = {}) {
  const r = await worker.fetch(new Request("https://example.test" + path, {
    method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env);
  return { status: r.status, body: await r.json().catch(() => null) };
}
const migrations = (upTo) => {
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql") && n <= upTo).sort()) db.exec(readFileSync(new URL(name, dir), "utf8"));
};
async function login(customerId, phone) {
  const issued = await call(`/v1/admin/app/customers/${customerId}/login-code`, {});
  expect(issued.status).toBe(201);
  const verified = await call("/v1/app/auth/verify", { phone, code: issued.body.code }, { token: null });
  expect(verified.status).toBe(200);
  return verified.body.token;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const batch = async (statements) => {
    db.exec("BEGIN");
    try { const out = []; for (const s of statements) out.push(await s.run()); db.exec("COMMIT"); return out; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  env = { DB: { prepare, batch }, ADMIN_BEARER_SECRET: ADMIN };
});
afterEach(() => { db.close(); vi.useRealTimers(); });

const apply = (name) => db.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));

describe("0007 migration backfill", () => {
  it("copies legacy customers, packages and receipts into typed tables", () => {
    migrations("0006_navigation_call_costs.sql");
    const t = "2026-11-01T00:00:00+00:00";
    db.prepare("INSERT INTO console_records VALUES ('customers','c1',?,?,?)").run(JSON.stringify({ name: "ישראל", phone: "0521234567", source: "organic", notes: "n" }), t, t);
    db.prepare("INSERT INTO customer_phones VALUES ('0521234567','c1')").run();
    db.prepare("INSERT INTO console_records VALUES ('packages','p1',?,?,?)").run(JSON.stringify({ name: "200 דקות", product: "school", minutes: 200, price_ils: 89, validity_days: 30, active: true }), t, t);
    db.prepare("INSERT INTO sales_receipts VALUES ('r1','c1','p1','school','REF1',89,0.18,200,?,?)").run(t, t);
    apply("0007_platform.sql");
    expect(db.prepare("SELECT id,name,primary_phone,status,notes FROM customers").get()).toEqual({ id: "c1", name: "ישראל", primary_phone: "0521234567", status: "active", notes: "n" });
    expect(db.prepare("SELECT product,billing,price_agorot,included_minutes,active FROM plans").get()).toEqual({ product: "school", billing: "prepaid", price_agorot: 8900, included_minutes: 200, active: 1 });
    expect(db.prepare("SELECT customer_id,amount_agorot,status,provider,sales_receipt_id FROM invoices").get()).toEqual({ customer_id: "c1", amount_agorot: 8900, status: "paid", provider: "nedarim", sales_receipt_id: "r1" });
  });
});

describe("platform API", () => {
  beforeEach(() => migrations("0008_platform_history.sql"));

  it("mirrors legacy console saves and phone-identified callers into customers/plans", async () => {
    const store = new BusinessStore(env.DB);
    const saved = await store.save("customers", { name: "א", phone: "052-111-2222", source: "organic", notes: "" }, null);
    await store.save("packages", { name: "חבילה", product: "translator", minutes: 30, price_ils: 19, validity_days: 30, active: true }, "pk");
    await store.identifyCall("0533334444", "call-x", "ivr");
    expect(db.prepare("SELECT primary_phone FROM customers WHERE id=?").get(saved.id).primary_phone).toBe("0521112222");
    expect(db.prepare("SELECT price_agorot FROM plans WHERE id='pk'").get().price_agorot).toBe(1900);
    expect(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE primary_phone='0533334444'").get().n).toBe(1);
  });

  it("requires the admin secret for admin routes", async () => {
    expect((await call("/v1/admin/app/customers", undefined, { token: "wrong" })).status).toBe(401);
    expect((await call("/v1/app/me", undefined, { token: ADMIN })).status).toBe(401);
  });

  it("manages customers, navigation plans, subscriptions, SIMs, devices and invoices", async () => {
    const c = await call("/v1/admin/app/customers", { name: "משה", phone: "0525556666", city: "בני ברק" });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: "משה", primary_phone: "0525556666", city: "בני ברק", status: "active" });
    expect(db.prepare("SELECT customer_id FROM customer_phones WHERE phone='0525556666'").get().customer_id).toBe(c.body.id);
    expect(JSON.parse(db.prepare("SELECT body FROM console_records WHERE kind='customers' AND id=?").get(c.body.id).body).name).toBe("משה");
    const dup = await call("/v1/admin/app/customers", { name: "אחר", phone: "0525556666" });
    expect(dup.status).toBe(422);
    const patched = await call("/v1/admin/app/customers/" + c.body.id, { status: "suspended", notes: "x" }, { method: "PATCH" });
    expect(patched.body).toMatchObject({ status: "suspended", notes: "x", name: "משה" });

    const plan = await call("/v1/admin/app/plans", { name: "ניווט חודשי", billing: "monthly", price_agorot: 4900, includes_device: false, active: true });
    expect(plan.status).toBe(201);
    expect(plan.body).toMatchObject({ product: "navigation", price_agorot: 4900, active: true });
    db.prepare("INSERT INTO plans(id,name,product,billing,price_agorot,created_at,updated_at) VALUES('school1','s','school','prepaid',100,'t','t')").run();
    expect((await call("/v1/admin/app/plans/school1", { price_agorot: 1 }, { method: "PATCH" })).status).toBe(409);

    const subscription = await call("/v1/admin/app/subscriptions", { customer_id: c.body.id, plan_id: plan.body.id, status: "trial" });
    expect(subscription.status).toBe(201);
    expect(subscription.body.price_agorot).toBe(4900);
    expect((await call("/v1/admin/app/subscriptions", { customer_id: "missing", plan_id: plan.body.id, status: "trial" })).status).toBe(404);
    const cancelled = await call("/v1/admin/app/subscriptions/" + subscription.body.id, { status: "cancelled", cancelled_at: "2026-11-12T12:00:00Z" }, { method: "PATCH" });
    expect(cancelled.body.status).toBe("cancelled");

    db.prepare("INSERT INTO navigation_devices(device_id,traccar_device_id,label,created_at) VALUES('dev',1,'car','t')").run();
    expect((await call("/v1/admin/app/devices/dev", { sim_iccid: "8997201234567890123" }, { method: "PATCH" })).status).toBe(404);
    const sim = await call("/v1/admin/app/sims", { iccid: "8997201234567890123", carrier: "019", data_mb_month: 2048, monthly_cost_agorot: 1200 });
    expect(sim.body).toMatchObject({ carrier: "019", status: "active" });
    const dev = await call("/v1/admin/app/devices/dev", { sim_iccid: "8997201234567890123", model: "ST-904L-E", imei: "" }, { method: "PATCH" });
    expect(dev.body).toMatchObject({ sim_iccid: "8997201234567890123", model: "ST-904L-E", inventory_status: "in_service" });

    const invoice = await call("/v1/admin/app/invoices", { customer_id: c.body.id, description: "מכשיר", amount_agorot: 25000 });
    expect(invoice.body).toMatchObject({ status: "open", provider: "manual", vat_rate: 0.18 });
    expect((await call("/v1/admin/app/invoices/" + invoice.body.id, { status: "paid", paid_at: "2026-11-12T12:00:00Z" }, { method: "PATCH" })).body.status).toBe("paid");
    db.prepare("INSERT INTO invoices(id,customer_id,amount_agorot,status,provider,issued_at,created_at) VALUES('nd',?,1,'paid','nedarim','t','t')").run(c.body.id);
    expect((await call("/v1/admin/app/invoices/nd", { status: "void" }, { method: "PATCH" })).status).toBe(409);

    const summary = await call("/v1/admin/app/summary");
    expect(summary.body).toMatchObject({ customers: 1, devices: 1, sims: 1, open_invoices: 0 });
    const detail = await call("/v1/admin/app/customers/" + c.body.id);
    expect(detail.body.subscriptions).toHaveLength(1);
    expect(detail.body.invoices).toHaveLength(2);
  });

  it("logs a customer in with a one-time code and scopes every read to that customer", async () => {
    const a = (await call("/v1/admin/app/customers", { name: "א", phone: "0521000001" })).body;
    const b = (await call("/v1/admin/app/customers", { name: "ב", phone: "0521000002" })).body;
    const issued = await call(`/v1/admin/app/customers/${a.id}/login-code`, {});
    expect(issued.body.code).toMatch(/^[0-9]{6}$/);
    const wrong = issued.body.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect((await call("/v1/app/auth/verify", { phone: "0521000001", code: wrong }, { token: null })).status).toBe(401);
    expect((await call("/v1/app/auth/verify", { phone: "0521000001", code: issued.body.code }, { token: null })).status).toBe(401);

    const token = await login(a.id, "052-1000001");
    expect((await call("/v1/app/auth/verify", { phone: "0521000001", code: "123456" }, { token: null })).status).toBe(401);
    const t = new Date().toISOString();
    db.prepare("INSERT INTO call_customers VALUES ('ca',?,'nav','phone',?),('cb',?,'nav','phone',?)").run(a.id, t, b.id, t);
    db.prepare("INSERT INTO conversation_turns(created_at,profile_id,call_id,direction,text) VALUES (?,?,?,?,?)").run(t, "nav", "cb", "caller", "סוד");
    db.prepare("INSERT INTO navigation_call_costs VALUES ('ca','nav',?,?)").run(t, JSON.stringify({ status: "partial", known_subtotal_ils: 0.41, known_subtotal_usd: 0.11, basis: "x" }));

    const me = await call("/v1/app/me", undefined, { token });
    expect(me.body.customer).toMatchObject({ id: a.id, primary_phone: "0521000001" });
    expect(me.body.device).toBeNull();
    const calls = await call("/v1/app/calls", undefined, { token });
    expect(calls.body.map((x) => x.call_id)).toEqual(["ca"]);
    expect(calls.body[0].cost).toMatchObject({ status: "partial", known_subtotal_ils: 0.41 });
    expect((await call("/v1/app/calls/cb/turns", undefined, { token })).status).toBe(404);
    expect((await call("/v1/app/device/live", undefined, { token })).status).toBe(404);

    const dest = await call("/v1/app/destinations", { label: "בית", address: "רחוב רבי עקיבא 1 בני ברק" }, { token });
    expect(dest.status).toBe(201);
    expect((await call("/v1/app/destinations", undefined, { token })).body).toHaveLength(1);
    expect((await call("/v1/admin/navigation/customers/" + b.id + "/destinations")).body).toHaveLength(0);

    await call("/v1/admin/app/customers/" + a.id, { status: "suspended" }, { method: "PATCH" });
    expect((await call("/v1/app/me", undefined, { token })).status).toBe(401);
    await call("/v1/admin/app/customers/" + a.id, { status: "active" }, { method: "PATCH" });
    expect((await call("/v1/app/auth/logout", {}, { token })).status).toBe(200);
    expect((await call("/v1/app/me", undefined, { token })).status).toBe(401);
  });

  it("expires login codes and sessions", async () => {
    const a = (await call("/v1/admin/app/customers", { name: "א", phone: "0521000001" })).body;
    const issued = await call(`/v1/admin/app/customers/${a.id}/login-code`, {});
    vi.setSystemTime(NOW + 11 * 60_000);
    expect((await call("/v1/app/auth/verify", { phone: "0521000001", code: issued.body.code }, { token: null })).status).toBe(401);
    const token = await login(a.id, "0521000001");
    vi.setSystemTime(NOW + 31 * 86400_000);
    expect((await call("/v1/app/me", undefined, { token })).status).toBe(401);
  });

  it("serves public plans and the OpenAPI contract without credentials", async () => {
    await call("/v1/admin/app/plans", { name: "פעיל", billing: "monthly", price_agorot: 100, active: true });
    await call("/v1/admin/app/plans", { name: "כבוי", billing: "monthly", price_agorot: 100 });
    const plans = await call("/v1/app/plans", undefined, { token: null });
    expect(plans.body.map((p) => p.name)).toEqual(["פעיל"]);
    const spec = await call("/v1/openapi.json", undefined, { token: null });
    expect(spec.body.openapi).toBe("3.1.0");
    expect(Object.keys(spec.body.paths)).toContain("/v1/app/trips");
  });

  it("registers customers from the public form with or without a device", async () => {
    const plan = (await call("/v1/admin/app/plans", { name: "חודשי", billing: "monthly", price_agorot: 4900, active: true })).body;
    const r = await call("/v1/app/signup", { name: "משה כהן", phone: "052-7000001", device_mode: "kit", plan_id: plan.id }, { token: null });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("lead");
    const c = (await call("/v1/admin/app/customers/" + r.body.customer_id)).body;
    expect(c.customer).toMatchObject({ device_mode: "kit", source: "web_signup", status: "lead" });
    expect(c.subscriptions[0]).toMatchObject({ status: "trial", price_agorot: 4900 });
    expect((await call("/v1/app/signup", { name: "כפול", phone: "0527000001", device_mode: "none" }, { token: null })).status).toBe(409);
    expect((await call("/v1/app/signup", { name: "בוט", phone: "0527000002", device_mode: "none", website: "x" }, { token: null })).status).toBe(422);
    const none = await call("/v1/app/signup", { name: "בלי מכשיר", phone: "0527000003", device_mode: "none" }, { token: null });
    expect(none.status).toBe(201);
    expect((await call("/v1/admin/app/customers?status=lead")).body).toHaveLength(2);
    const reports = (await call("/v1/admin/app/reports")).body;
    expect(reports.customers_by_device_mode).toMatchObject({ kit: 1, none: 1 });
    expect(reports.months[0].new_customers).toBe(2);
  });

  it("stores per-customer call settings and applies them as control overrides", async () => {
    const a = (await call("/v1/admin/app/customers", { name: "א", phone: "0521000001" })).body;
    expect(await customerControlOverrides(env, a.id)).toEqual({});
    const token = await login(a.id, "0521000001");
    expect((await call("/v1/app/settings", { voice: "Nobody" }, { token, method: "PUT" })).status).toBe(422);
    const saved = await call("/v1/app/settings", { navigation_voice: "gemini", voice: "Charon" }, { token, method: "PUT" });
    expect(saved.body).toMatchObject({ navigation_voice: "gemini", voice: "Charon", navigation_interrupt: null });
    await call(`/v1/admin/app/customers/${a.id}/settings`, { navigation_interrupt: "speech" }, { method: "PUT" });
    expect(await customerControlOverrides(env, a.id)).toEqual({ navigation_voice: "gemini", voice: "Charon", navigation_interrupt: "speech" });
  });

  it("returns the driven path and metrics of a trip, scoped to its customer", async () => {
    const a = (await call("/v1/admin/app/customers", { name: "א", phone: "0521000001" })).body;
    const b = (await call("/v1/admin/app/customers", { name: "ב", phone: "0521000002" })).body;
    db.prepare("INSERT INTO navigation_devices(device_id,traccar_device_id,label,enabled,created_at) VALUES ('d1',1,'x',1,'t')").run();
    db.prepare(`INSERT INTO navigation_trips(id,customer_id,device_id,destination_label,destination_address,status,created_at_ms,updated_at_ms,ended_at_ms)
      VALUES ('t1',?,'d1','מירון','מירון','completed',?,?,?)`).run(a.id, NOW, NOW, NOW + 60_000);
    const ins = db.prepare("INSERT INTO navigation_position_history VALUES ('d1',?,?,34.8,?,NULL,NULL)");
    for (let i = 0; i <= 30; i++) ins.run(NOW + i * 2000, 32 + i * 0.0003, 16 + (i % 2));
    const path = (await call("/v1/admin/app/trips/t1/path")).body;
    expect(path.point_count).toBe(31);
    expect(path.distance_m).toBeGreaterThan(950);
    expect(path.distance_m).toBeLessThan(1050);
    expect(path.max_speed_kmh).toBe(61.2);
    expect((await call("/v1/admin/app/trips")).body[0]).toMatchObject({ id: "t1", customer_name: "א", duration_s: 60 });
    const tokenB = await login(b.id, "0521000002");
    expect((await call("/v1/app/trips/t1/path", undefined, { token: tokenB })).status).toBe(404);
    const tokenA = await login(a.id, "0521000001");
    expect((await call("/v1/app/trips/t1/path", undefined, { token: tokenA })).body.points).toHaveLength(31);
  });
});
