import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { type Env } from "../src/env";
import worker from "../src/index";
import { standingOrderStart } from "../src/checkout";
import { SubscriptionStore, addMonths } from "../src/subscriptions";

// Execute production SQL, including JSON operations and atomic challenge consumption.
class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
      this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    }
  }
  prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      first: async (column?: string) => { const row = this.sql.prepare(query).get(...args); return row ? column ? row[column] : row : null; },
      all: async () => ({ results: this.sql.prepare(query).all(...args), success: true }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...args).changes) } }),
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.sql.exec("BEGIN");
    try {
      const result = [];
      for (const s of statements) result.push(await s.all());
      this.sql.exec("COMMIT");
      return result;
    } catch (e) { this.sql.exec("ROLLBACK"); throw e; }
  }
}

let db: SqlD1, env: Env, b: BusinessStore, token: string, calls: Record<string, string>[];
const req = (path: string, body?: unknown) => worker.fetch(new Request("https://speakcall.app" + path, {
  method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env);
async function hook(data: Record<string, unknown>) {
  const raw = JSON.stringify(data), ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "." + raw)))].map(x => x.toString(16).padStart(2, "0")).join("");
  return worker.fetch(new Request("https://speakcall.app/v1/payments/nedarim/webhook", { method: "POST", body: raw, headers: { "x-nedarim-timestamp": ts, "x-nedarim-signature": "v1=" + sig } }), env);
}
let keva: Record<string, string> = {};
beforeEach(async () => {
  db = new SqlD1();
  env = { DB: db, ADMIN_BEARER_SECRET: "a", NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "npk_x", NEDARIM_WEBHOOK_SECRET: "whsec_test", NEDARIM_API_VALID: "valid12345" } as unknown as Env;
  b = new BusinessStore(env.DB);
  await b.save("customers", { name: "Dana", phone: "0500000001", source: "test", preferred_bot: "", notes: "" }, "c1");
  token = (await b.portalInvite("c1")).token;
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    calls.push({ url: String(url), ...form });
    if (String(url).includes("CreateTransaction")) return Response.json({ Status: "OK", ID: String(500 + calls.length) });
    if (form.Action === "GetKevaId") return Response.json(keva);
    if (form.Action === "DeleteKeva") return new Response("OK");
    return Response.json({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); db.sql.close(); });

describe("website checkout", () => {
  it("charges a mastery track in installments with the price fixed server-side and the validation key never returned", async () => {
    expect((await req("/v1/portal/checkout", { package_id: "school-mastery" })).status).toBe(422);
    expect((await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "unknown" })).status).toBe(422);
    const r = await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "travel" });
    const o = await r.json() as any;
    expect(r.status).toBe(200);
    expect(JSON.stringify(o)).not.toContain("valid12345");
    expect(o).toMatchObject({ amount_ils: 1490, installments: 12, subscription: null, steps: [{ kind: "charge" }] });
    expect(o.iframe_url).toContain("MaxPayments=12");
    expect(calls[0]).toMatchObject({ PaymentType: "Ragil", Amount: "1490", Tashlumim: "12", Groupe: "dibura-" + o.id, ApiValid: "valid12345" });
    const again = await (await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "travel" })).json() as any;
    expect(again.id).toBe(o.id);
    const paid = { MosadNumber: "7019554", TransactionId: "9001", Confirmation: "77", Amount: "1490", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" };
    expect((await hook({ ...paid, Amount: "1" })).status).toBe(400);
    expect((await hook(paid)).status).toBe(200);
    expect((await hook(paid)).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n, MAX(minutes) m FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 1, m: 300 });
    expect((await (await req("/v1/portal/checkout/" + o.id)).json() as any).state).toBe("paid");
    const store = new SubscriptionStore(env.DB);
    const sub = await store.get(o.id);
    expect(sub).toMatchObject({ term_months: 12, monthly_minutes: 300, period_number: 1, price_agorot: 149000 });
    expect(JSON.parse(sub.domains_json)).toContainEqual({ domain: "travel" });
    expect(db.sql.prepare("SELECT entitlement_id FROM payment_orders WHERE id=?").get(o.id)?.entitlement_id).toBe(sub.id);
    await store.tick(addMonths(sub.started_at, 1));
    await store.tick(addMonths(sub.started_at, 1));
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 2 });
    await store.tick(addMonths(sub.started_at, 11));
    await store.tick(addMonths(sub.started_at, 11));
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 12 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM installment_grants").get()).toMatchObject({ n: 0 });
  });

  it("opens a monthly plan: first month now, standing order verified with Nedarim, monthly charges renew once each", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any;
    expect(o).toMatchObject({ amount_ils: 119, subscription: { state: "pending", monthly_ils: 119 } });
    expect(o.steps.map((s: any) => s.kind)).toEqual(["charge", "keva"]);
    const first = { MosadNumber: "7019554", TransactionId: "1", Confirmation: "5", Amount: "119", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" };
    expect((await hook({ ...first, Amount: "29" })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscriptions").get()?.n).toBe(0);
    expect((await hook(first)).status).toBe(200);
    expect((await hook(first)).status).toBe(200);
    const store = new SubscriptionStore(env.DB);
    expect(await store.get(o.id)).toMatchObject({ price_agorot: 11900, status: "active", period_number: 1 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT amount_ils FROM sales_receipts").get()?.amount_ils).toBe(29);
    expect(db.sql.prepare("SELECT entitlement_id FROM standing_orders").get()?.entitlement_id).toBe(o.id);
    expect((await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any)).toMatchObject({ id: o.id, steps: [{ kind: "keva" }] });
    expect((await req("/v1/portal/subscriptions/" + o.subscription.id + "/cancel", {})).status).toBe(409);
    expect(calls[1]).toMatchObject({ PaymentType: "HK", Amount: "119", Tashlumim: "", Groupe: "dibura-" + o.subscription.id, ...standingOrderStart() });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-other", KevaAmount: "119", KevaNextDate: "01/01/2027" };
    expect((await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).status).toBe(409);
    keva.KevaGroupe = "dibura-" + o.subscription.id;
    const confirmed = await (await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).json() as any;
    expect(confirmed.subscription).toMatchObject({ state: "active", next_date: "01/01/2027" });
    await hook({ MosadNumber: "7019554", TransactionId: "1", Confirmation: "5", Amount: "119", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" });
    const month = { MosadNumber: "7019554", TransactionId: "2", Confirmation: "6", Amount: "119", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    expect((await hook(month)).status).toBe(200);
    expect((await hook(month)).status).toBe(200);
    expect((await hook({ ...month, TransactionId: "3", Amount: "1" })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 2 });
    expect(await store.get(o.id)).toMatchObject({ period_number: 2 });
    expect((await store.summary("c1"))[0]).toMatchObject({ rollover_minutes: 200 });
    expect(db.sql.prepare("SELECT reference FROM subscription_renewals").get()?.reference).toBe("nedarim-keva:4242:2");
    expect(db.sql.prepare("SELECT amount_ils FROM sales_receipts ORDER BY valid_from DESC LIMIT 1").get()?.amount_ils).toBe(119);
    expect(db.sql.prepare("SELECT next_date FROM standing_orders").get()?.next_date).toBe(standingOrderStart().StartFrom);
    const refusal = { MosadNumber: "7019554", Status: "Error", Source: "Keva", KevaId: "4242", Message: "סירוב" };
    await hook(refusal);
    await hook(refusal);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_refusal'").get()).toMatchObject({ n: 1 });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toMatchObject({ state: "past_due" });
    expect((await store.get(o.id)).status).toBe("past_due");
    expect((await req("/v1/portal/subscriptions/" + o.subscription.id + "/cancel", {})).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ Action: "DeleteKeva", KevaId: "4242" });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toMatchObject({ state: "cancelled" });
    expect((await store.get(o.id)).status).toBe("cancelled");
    expect((await hook({ ...month, TransactionId: "999" })).status).toBe(400);
  });

  it("records charges during a pause, shifts future availability on resume and validates the family renewal amount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    expect((await hook({ MosadNumber: "7019554", TransactionId: "10", Confirmation: "5", Amount: "29", Currency: "1", Groupe: "dibura-" + o.id })).status).toBe(200);
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    expect((await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).status).toBe(200);
    const store = new SubscriptionStore(env.DB);
    await store.addMember(o.id, "0502223333", "Family");
    const charge = { MosadNumber: "7019554", TransactionId: "11", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    expect((await hook(charge)).status).toBe(400);
    expect((await store.get(o.id)).period_number).toBe(1);
    vi.setSystemTime(new Date("2026-01-30T00:00:00Z"));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/pause", { days: 7 })).status).toBe(200);
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    expect((await hook({ ...charge, Amount: "98" })).status).toBe(200);
    expect((await hook({ ...charge, Amount: "98" })).status).toBe(200);
    expect(await store.get(o.id)).toMatchObject({ status: "paused", period_number: 2 });
    vi.setSystemTime(new Date("2026-02-06T00:00:00Z"));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/resume", {})).status).toBe(200);
    expect(await store.get(o.id)).toMatchObject({ status: "active", current_period_start: "2026-02-08T00:00:00.000+00:00", current_period_end: "2026-03-08T00:00:00.000+00:00", pause_days_used: 7 });
    expect(db.sql.prepare("SELECT valid_from FROM sales_receipts ORDER BY valid_from DESC LIMIT 1").get()?.valid_from).toBe("2026-02-08T00:00:00.000+00:00");
    expect((await store.summary("c1"))[0].rollover_minutes).toBe(60);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(2);
    const member = db.sql.prepare("SELECT customer_id FROM subscription_members").get()?.customer_id as string;
    await store.removeMember(o.id, member);
    expect((await hook({ ...charge, Amount: "98" })).status).toBe(200);
    expect((await hook({ ...charge, TransactionId: "12", Amount: "98" })).status).toBe(400);
    const request = new Request("https://speakcall.app/v1/admin/business/subscriptions/" + o.id + "/cancel", { method: "POST", headers: { Authorization: "Bearer a" }, body: "{}" });
    expect((await worker.fetch(request, env)).status).toBe(200);
    expect((await store.get(o.id)).status).toBe("cancelled");
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()?.state).toBe("cancelled");
    expect(calls.at(-1)).toMatchObject({ Action: "DeleteKeva", KevaId: "4242" });
  });

  it("keeps a refused paused subscription frozen and resumes it as past due", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "20", Confirmation: "5", Amount: "29", Currency: "1", Groupe: "dibura-" + o.id });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" });
    await req("/v1/portal/subscriptions/" + o.id + "/pause", { days: 7 });
    expect((await hook({ MosadNumber: "7019554", Status: "Error", KevaId: "4242", Message: "refused" })).status).toBe(200);
    const store = new SubscriptionStore(env.DB);
    expect(await store.get(o.id)).toMatchObject({ status: "paused", resume_status: "past_due" });
    await req("/v1/portal/subscriptions/" + o.id + "/resume", {});
    expect((await store.get(o.id)).status).toBe("past_due");
    expect((await hook({ MosadNumber: "7019554", TransactionId: "21", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" })).status).toBe(200);
    expect((await store.get(o.id)).status).toBe("active");
  });

  it("rolls back the subscription and first grant when a provider transaction belongs to another order", async () => {
    const a = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    const c = await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any;
    const payment = { MosadNumber: "7019554", TransactionId: "50", Confirmation: "5", Amount: "29", Currency: "1" };
    expect((await hook({ ...payment, Groupe: "dibura-" + a.id })).status).toBe(200);
    expect((await hook({ ...payment, Groupe: "dibura-" + c.id })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscriptions").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT state FROM payment_orders WHERE id=?").get(c.id)?.state).toBe("issued");
    expect((await hook({ ...payment, TransactionId: "51", Groupe: "dibura-" + c.id })).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscriptions").get()?.n).toBe(2);
  });

  it("does not cancel either record when DeleteKeva fails", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "60", Confirmation: "5", Amount: "29", Currency: "1", Groupe: "dibura-" + o.id });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ERROR")));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/cancel", {})).status).toBe(502);
    expect((await new SubscriptionStore(env.DB).get(o.id)).status).toBe("active");
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()?.state).toBe("active");
  });

  it("is closed without the iframe validation key and refuses other customers' orders", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await b.save("customers", { name: "Other", phone: "0500000002", source: "test", preferred_bot: "", notes: "" }, "c2");
    token = (await b.portalInvite("c2")).token;
    expect((await req("/v1/portal/checkout/" + o.id)).status).toBe(404);
    delete env.NEDARIM_API_VALID;
    expect((await req("/v1/portal/checkout", { package_id: "school-step" })).status).toBe(503);
  });
});
