import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { type Env } from "../src/env";
import { deriveStatus, INACTIVE_DAYS, SHORT_SESSION_SECONDS } from "../src/crm-people";
import worker from "../src/index";
import { BusinessStore } from "../src/business";
import { ProgressStore } from "../src/progress";
import { startAdEntry } from "../src/ad-entry";
import { sha256Hex } from "../src/env";
import { cleanupRecordings } from "../src/recordings";

let sql: DatabaseSync, env: Env;
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL("../migrations/" + file, import.meta.url), "utf8"));
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const statement = {
        bind: (...values: any[]) => { args = values; return statement; },
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => { const results = sql.prepare(query).all(...args); return { results, meta: { changes: Number((sql.prepare("SELECT changes() AS n").get() as any).n) }, success: true }; },
        run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...args).changes) }, success: true }),
      };
      return statement;
    },
    async batch(statements: any[]) {
      sql.exec("BEGIN");
      try { const result = []; for (const s of statements) result.push(await s.all()); sql.exec("COMMIT"); return result; }
      catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
  };
  env = { DB: db, ADMIN_BEARER_SECRET: "crm-test-secret" } as unknown as Env;
});
afterEach(() => { sql.close(); vi.restoreAllMocks(); });
const now = new Date().toISOString();
function customer(id = "person1", phone = "0501234567") {
  sql.prepare("INSERT INTO customers(id,name,primary_phone,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, "שם מוקלד", phone, now, now);
  sql.prepare("INSERT INTO console_records VALUES ('customers',?,?,?,?)").run(id, JSON.stringify({ name: "יעל כהן", phone, email: "yael@example.test", source: "אתר" }), now, now);
}
function event(kind: string, body: any) { sql.prepare("INSERT INTO console_records VALUES (?,?,?,?,?)").run(kind, crypto.randomUUID(), JSON.stringify({ customer_id: "person1", at: now, ...body }), now, now); }
function session(id = "call1", transcript: string | null = JSON.stringify([{ role: "learner", text: "Hello" }])) {
  sql.prepare("INSERT INTO sessions(student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,observations_json,transcript_json,summary_he,estimated_cost_usd,cost_basis) VALUES (?,?,?,?,?,1,1,'[]',?,'תרגול היכרות',0.1,'gemini_usage_metadata')").run("person1", id, now, now, 120, transcript);
  sql.prepare("INSERT INTO call_customers VALUES (?,?,?,'phone',?)").run(id, "person1", "teacher1", now);
}
const request = (path: string, auth = true, method = "GET") => worker.fetch(new Request("https://speakcall.app/v1/admin/crm/" + path, { method, headers: auth ? { Authorization: "Bearer crm-test-secret" } : {} }), env);
const reset = (confirm: unknown = "0501234567", id = "person1", headers: Record<string, string> = { Authorization: "Bearer crm-test-secret" }) => worker.fetch(new Request("https://speakcall.app/v1/admin/crm/people/" + id, { method: "DELETE", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ confirm }) }), env);
describe('returning practice customers', () => {
  it('returns an empty summary when practice tables are empty', async () => {
    const response = await request('returning');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], totals: { returning: 0, today: 0, week: 0, streaks: 0, reminder_rate: 0 } });
  });
  it('requires admin authentication', async () => {
    expect((await request('returning', false)).status).toBe(401);
    expect((await request('returning', true, 'POST')).status).toBe(405);
  });
  it('includes only customers with two qualified days and exposes sortable list metrics', async () => {
    customer();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    for (const day of [yesterday, today]) sql.prepare('INSERT INTO practice_days(customer_id,day,seconds,calls,first_at,last_at) VALUES (?,?,120,1,?,?)').run('person1', day, now, now);
    const result = await (await request('returning')).json() as any;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'person1', current_streak: 2, best_streak: 2, practice_days_30: 2, minutes_month: yesterday.slice(0, 7) === today.slice(0, 7) ? 4 : 2 });
    expect(result.totals).toMatchObject({ returning: 1, today: 1 });
    const list = await (await request('people?sort=current_streak')).json() as any;
    expect(list.items[0]).toMatchObject({ current_streak: 2, practice_days_30: 2 });
    sql.prepare('DELETE FROM practice_days WHERE day=?').run(yesterday);
    expect((await (await request('returning')).json() as any).items).toHaveLength(0);
  });
});
function insert(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  sql.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row) as any[]);
}
function planAndSubscription(owner = "person1", status = "cancelled", id = "sub") {
  sql.prepare("INSERT OR IGNORE INTO plans(id,name,product,billing,price_agorot,created_at,updated_at) VALUES ('plan','תכנית','school','monthly',100,?,?)").run(now, now);
  insert("subscriptions", { id, customer_id: owner, plan_id: "plan", status, price_agorot: 100, started_at: now, created_at: now, updated_at: now });
}

describe("CRM subscription access", () => {
  it("includes current family memberships in summaries and access filters, preferring owned subscriptions", async () => {
    customer(); customer("member", "0501234568");
    planAndSubscription("person1", "active");
    sql.exec("UPDATE subscriptions SET current_period_end='2099-01-01'");
    const card = async () => await (await request("people/member")).json() as any;
    expect((await card()).subscription.access).toBe("none");
    insert("subscription_members", { subscription_id: "sub", customer_id: "member", added_at: now });
    expect((await card()).subscription).toMatchObject({ id: "sub", access: "open" });
    const list = await (await request("people?access=open")).json() as any;
    expect(list.items.map((p: any) => p.id)).toContain("member");
    await request("subscriptions/sub/suspend", true, "POST");
    expect((await card()).subscription.access).toBe("suspended");
    sql.prepare("UPDATE subscription_members SET removed_at=?").run(now);
    expect((await card()).subscription.access).toBe("none");
    sql.exec("UPDATE subscription_members SET removed_at=NULL");
    planAndSubscription("member", "cancelled", "owned-sub");
    expect((await card()).subscription).toMatchObject({ id: "owned-sub", access: "inactive" });
  });
  it("summarizes access, payment holds and read-only standing orders on lists and cards", async () => {
    customer();
    expect((await (await request("people/person1")).json() as any).subscription.access).toBe("none");
    planAndSubscription("person1", "active");
    sql.exec("UPDATE subscriptions SET current_period_end='2099-01-01'");
    expect((await (await request("people/person1")).json() as any).subscription).toMatchObject({ id: "sub", plan_name: "תכנית", status: "active", access: "open" });
    insert("standing_orders", { id: "order", customer_id: "person1", package_id: "plan", snapshot: "{}", monthly_agorot: 100, first_order_id: "first", state: "active", entitlement_id: "sub", last_refusal_at: now, keva_id: "private-provider-id", created_at: now, updated_at: now });
    const before = sql.prepare("SELECT * FROM standing_orders").all();
    const held: any = await (await request("people?access=payment_hold")).json();
    expect(held.items[0]).toMatchObject({ subscription: { access: "payment_hold" }, nedarim: { state: "active", amount: 1, last_refusal_at: now, keva_id_present: true } });
    expect(JSON.stringify(held)).not.toContain("private-provider-id");
    await request("subscriptions/sub/suspend", true, "POST");
    expect((await (await request("people/person1")).json() as any).subscription.access).toBe("suspended");
    await request("subscriptions/sub/restore", true, "POST");
    expect((await (await request("people/person1")).json() as any).subscription.access).toBe("payment_hold");
    expect(sql.prepare("SELECT * FROM standing_orders").all()).toEqual(before);
    sql.exec("UPDATE standing_orders SET last_refusal_at=NULL,state='past_due'");
    expect((await (await request("people/person1")).json() as any).subscription.access).toBe("payment_hold");
    sql.exec("UPDATE standing_orders SET state='active'; UPDATE subscriptions SET status='cancelled'");
    expect((await (await request("people/person1")).json() as any).subscription.access).toBe("inactive");
    expect((await request("people?access=invalid")).status).toBe(422);
  });
  it("reports dated school call costs, insights, empty ranges and validation errors", async () => {
    customer(); session(); session("short"); session("translator");
    sql.exec("UPDATE sessions SET duration_seconds=30 WHERE call_id='short'; UPDATE call_customers SET bot_id='voice-navigator-live' WHERE call_id='translator'");
    const day = now.slice(0, 10);
    const report: any = await (await request(`calls?from=${day}&to=${day}`)).json();
    expect(report.items).toHaveLength(2);
    expect(report.items[0]).toMatchObject({ customer_id: "person1", customer_name: "יעל כהן", teacher: "teacher1", ai_cost_ils: 0.37 });
    expect(report.totals).toMatchObject({ calls: 2, minutes: 2.5, ai_cost_ils: 0.74 });
    expect(report.insights).toMatchObject({ short_call_share: 0.5, top_customers: [{ id: "person1", calls: 2 }], by_teacher: [{ id: "teacher1", calls: 2 }] });
    const empty: any = await (await request("calls?from=2000-01-01&to=2000-01-02")).json();
    expect(empty.items).toEqual([]); expect(empty.insights.cost_per_minute).toBe(0);
    expect((await request("calls?from=2026-02-30")).status).toBe(422);
    expect((await request("calls?from=2026-02-01&to=2026-01-01")).status).toBe(422);
    expect((await request("calls", false)).status).toBe(401);
    expect((await request("calls", true, "POST")).status).toBe(405);
  });
  it("requires an owner and keeps the billing status and minutes unchanged when suspending or restoring", async () => {
    customer();
    customer("member", "0501234568");
    planAndSubscription("person1", "active");
    insert("subscription_members", { subscription_id: "sub", customer_id: "member", added_at: now });
    const end = "2099-01-01T00:00:00+00:00";
    sql.prepare("UPDATE subscriptions SET current_period_end=? WHERE id='sub'").run(end);
    insert("sales_receipts", { id: "r", customer_id: "person1", package_id: "plan", product: "school", reference: "receipt", amount_ils: 100, vat_rate: 0, minutes: 20, expires_at: end, created_at: now, subscription_id: "sub" });
    const stampBefore = sql.prepare("SELECT status,current_period_end,updated_at FROM subscriptions").get();
    const receiptsBefore = sql.prepare("SELECT * FROM sales_receipts").all();
    const store = new BusinessStore(env.DB);
    await store.save("policies", { product: "school", enabled: true, opening_seconds: 420, free_calls_month: 2 }, "teacher1");
    expect(await store.hasPaidAccess("member")).toBe(true);
    expect((await request("subscriptions/sub/suspend", false, "POST")).status).toBe(401);
    expect((await request("subscriptions/sub/suspend")).status).toBe(405);
    insert("admin_users", { id: "staff", username: "staff", display_name: "staff", role: "staff", created_at: now });
    insert("admin_sessions", { token_hash: await sha256Hex("a".repeat(64)), user_id: "staff", created_at: now, expires_at: "2099-01-01" });
    const asStaff = new Request("https://speakcall.app/v1/admin/crm/subscriptions/sub/suspend", {
      method: "POST", headers: { Cookie: "admin_session=" + "a".repeat(64), Origin: "https://speakcall.app" },
    });
    expect((await worker.fetch(asStaff, env)).status).toBe(403);
    expect((await request("subscriptions/not-found/suspend", true, "POST")).status).toBe(404);
    const stopped = await (await request("subscriptions/sub/suspend", true, "POST")).json();
    expect(stopped).toMatchObject({ id: "sub", access_suspended_at: expect.any(String) });
    expect(await (await request("subscriptions/sub/suspend", true, "POST")).json()).toEqual(stopped);
    expect(await store.hasPaidAccess("person1")).toBe(false);
    expect(await store.hasPaidAccess("member")).toBe(false);
    expect(await store.hasSchoolCallbackMinutes("member")).toBe(false);
    expect(await store.reserveCall("person1", "teacher1", "phone", 60)).toMatchObject({ seconds: 0, mode: "blocked" });
    expect(await store.reserveCall("member", "teacher1", "web", 60, "text")).toMatchObject({ seconds: 0, mode: "blocked" });
    expect(await store.reserveCall("member", "translator1", "translator", 60)).toMatchObject({ seconds: 60, mode: "unrestricted" });
    expect(await (await request("subscriptions/sub/restore", true, "POST")).json()).toEqual({ id: "sub", access_suspended_at: null });
    expect(await store.hasPaidAccess("person1")).toBe(true);
    expect(await store.hasPaidAccess("member")).toBe(true);
    expect(await store.reserveCall("person1", "teacher1", "restored", 60)).toMatchObject({ seconds: 60, mode: "paid" });
    expect(sql.prepare("SELECT status,current_period_end,updated_at FROM subscriptions").get()).toEqual(stampBefore);
    expect(sql.prepare("SELECT * FROM sales_receipts").all()).toEqual(receiptsBefore);
    expect(sql.prepare("SELECT actor,path,status FROM admin_audit_log WHERE path LIKE '%/restore'").get())
      .toMatchObject({ actor: "bearer", path: "/v1/admin/crm/subscriptions/sub/restore", status: 200 });
  });
});

describe("CRM voicemail inbox", () => {
  it("lists transcripts for admins only and filters precisely by customer", async () => {
    customer();
    customer("other", "0501234568");
    for (const [index, customerId] of ["person1", "other", "unknown"].entries()) {
      insert("ivr_voicemails", { id: String(index).repeat(64), system_phone: "system", file_id: "file" + index, customer_id: customerId,
        caller_key: "hash", created_at: now, intake_day: now.slice(0, 10), status: "ready", transcript: "test message " + index, audio_ready: 1 });
    }
    const path = "voicemails?customer_id=person1";
    expect((await request(path, false)).status).toBe(401);
    expect((await request("voicemails/" + "0".repeat(64) + "/audio", false)).status).toBe(401);
    const result = await request(path);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    const { items, next } = await result.json() as { items: unknown[]; next: string | null };
    expect(items).toEqual([expect.objectContaining({ customer_id: "person1", transcript: "test message 0", audio_ready: 1 })]);
    expect(next).toBeNull();
    expect(await (await request("voicemails")).json()).toMatchObject({ items: [
      { customer_id: null }, { customer_id: "other" }, { customer_id: "person1" },
    ] });
  });
});

describe("CRM customer reset", () => {
  it("deletes the customer's practice history and reminders while preserving other customers", async () => {
    customer(); customer("other", "0507654321");
    for (const id of ["person1", "other"]) {
      insert("practice_days", { customer_id: id, day: "2026-06-14", seconds: 120, calls: 1, first_at: now, last_at: now });
      insert("practice_reminders", { customer_id: id, time_local: "20:00", source: "lesson", created_at: now, updated_at: now });
      insert("practice_reminder_events", { id, customer_id: id, day: "2026-06-14", scheduled_for: now, status: "dry_run" });
    }
    const response = await reset();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: { practice_days: 1, practice_reminders: 1, practice_reminder_events: 1 } });
    for (const table of ["practice_days", "practice_reminders", "practice_reminder_events"]) expect(sql.prepare(`SELECT customer_id FROM ${table}`).all()).toEqual([{ customer_id: "other" }]);
  });
  it.each([false, true])("prepares no compound SQL during reset with linked history %s", async history => {
    customer();
    if (history) {
      session(); planAndSubscription();
      event("ivr-events", { call_id: "call1" });
      insert("customer_phones", { phone: "0501234567", customer_id: "person1" });
    }
    const prepare = env.DB.prepare.bind(env.DB);
    const prepared = vi.spyOn(env.DB, "prepare").mockImplementation(query => {
      expect(query).not.toMatch(/\b(?:UNION|INTERSECT|EXCEPT)\b/i);
      return prepare(query);
    });
    expect((await reset()).status).toBe(200);
    expect(prepared.mock.calls.length).toBeGreaterThan(40);
    for (const [query] of prepared.mock.calls) expect(query).not.toMatch(/\b(?:UNION|INTERSECT|EXCEPT)\b/i);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM customers").get()).toMatchObject({ n: 0 });
  });
  it("keeps every prepared statement within the D1 binding limit", async () => {
    customer(); session();
    const prepare = env.DB.prepare.bind(env.DB);
    const bindings: { query: string; count: number }[] = [];
    vi.spyOn(env.DB, "prepare").mockImplementation(query => {
      const statement = prepare(query), bind = statement.bind.bind(statement);
      vi.spyOn(statement, "bind").mockImplementation((...args) => {
        bindings.push({ query, count: args.length });
        expect(args.length, query).toBeLessThanOrEqual(100);
        return bind(...args);
      });
      return statement;
    });
    expect((await reset()).status).toBe(200);
    expect(bindings.length).toBeGreaterThan(40);
    expect(bindings.find(b => b.query.includes("INSERT INTO console_audit"))?.count).toBe(4);
    const audit = sql.prepare("SELECT action FROM console_audit").get() as any;
    expect(JSON.parse(audit.action).counts).toMatchObject({ customers: 1, sessions: 1 });
  });
  beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(Date.parse(now) + 11 * 60 * 1000); });
  it.each(["session", "ivr-events", "ad-entries", "menu", "call_customers"].flatMap(source => [1, 9, 11].map(minutes => ({ source, minutes }))))("handles $source activity $minutes minutes ago", async ({ source, minutes }) => {
    customer();
    const at = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    if (source === "session") {
      session(); sql.prepare("UPDATE sessions SET ended_at=?").run(at);
    } else if (source === "call_customers" || source === "menu") {
      insert("call_customers", { call_id: "menu-call", customer_id: "person1", bot_id: "ivr", channel: "phone", created_at: source === "call_customers" ? at : now });
      if (source === "menu") event("ivr-events", { call_id: "menu-call", route: "main", at });
    } else event(source, { at });
    expect((await reset()).status).toBe(minutes < 10 ? 409 : 200);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM console_audit").get()).toMatchObject({ n: minutes < 10 ? 0 : 1 });
  });
  it.each(["primary_phone", "customer_phones"])("preserves phone-matched data when %s assigns the number to another customer", async source => {
    customer(); customer("other", source === "primary_phone" ? "+972501234567" : "0507654321");
    if (source === "customer_phones") insert("customer_phones", { phone: "0501234567", customer_id: "other" });
    const hash = await sha256Hex("0501234567");
    insert("console_records", { kind: "learner-phone-links", id: hash.slice(0, 24), body: JSON.stringify({ customer_id: "other", phone: "0501234567" }), created_at: now, updated_at: now });
    insert("ivr_voicemails", { id: "other-vm", system_phone: "system", file_id: "file", customer_id: "other", caller_key: hash, created_at: now, intake_day: "2026-11-19", audio_ready: 1 });
    insert("callback_requests", { id: "other-callback", phone: "0501234567", name: "שם", for_whom: "self", goal: "lesson", timing: "now", source: "test", consent_at: now, created_at: now, updated_at: now });
    event("sales-followups", { callback_id: "other-callback" });
    const b = new BusinessStore(env.DB);
    await b.putSetting("portal-auth:other", { phone: "0501234567" });
    const deleteAudio = vi.fn(); env.VOICEMAIL_AUDIO = { delete: deleteAudio } as any;
    expect((await reset()).status).toBe(200);
    expect(sql.prepare("SELECT id FROM ivr_voicemails").get()).toMatchObject({ id: "other-vm" });
    expect(sql.prepare("SELECT id FROM callback_requests").get()).toMatchObject({ id: "other-callback" });
    expect(await b.setting("portal-auth:other")).toEqual({ phone: "0501234567" });
    expect(sql.prepare("SELECT id FROM console_records WHERE kind='learner-phone-links'").get()).toMatchObject({ id: hash.slice(0, 24) });
    expect(deleteAudio).not.toHaveBeenCalled();
  });
  it.each(["issued", "awaiting_settlement", "selected", "paid"])("handles %s payment orders before reset", async state => {
    customer();
    insert("payment_orders", { id: "order", call_id: "payment-call", customer_id: "person1", package_id: "p", snapshot: "{}", amount_agorot: 100, vat_rate: 0, state, created_at: now, updated_at: now });
    const blocked = ["issued", "awaiting_settlement"].includes(state);
    expect((await reset()).status).toBe(blocked ? 409 : 200);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM payment_orders").get()).toMatchObject({ n: blocked ? 1 : 0 });
  });
  it("requires admin, owner role, exact confirmation, and returns 404 after reset", async () => {
    customer();
    expect((await reset("0501234567", "person1", {})).status).toBe(401);
    insert("admin_users", { id: "staff", username: "staff", display_name: "staff", role: "staff", created_at: now });
    insert("admin_sessions", { token_hash: await sha256Hex("a".repeat(64)), user_id: "staff", created_at: now, expires_at: "2099-01-01" });
    expect((await reset("0501234567", "person1", { Cookie: "admin_session=" + "a".repeat(64), Origin: "https://speakcall.app" })).status).toBe(403);
    for (const value of ["wrong", null, 501234567]) expect((await reset(value)).status).toBe(400);
    expect((await reset()).status).toBe(200);
    expect((await reset()).status).toBe(404);
  });
  it.each(["call_customers", "sessions"])("blocks a live call linked through %s", async (source) => {
    customer(); session();
    if (source === "sessions") sql.prepare("DELETE FROM call_customers").run();
    insert("active_calls", { call_id: "call1", profile_id: "teacher1", owner_id: "do", acquired_at: 0, lease_expires_at: Date.now() / 1000 + 60 });
    expect((await reset()).status).toBe(409);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM customers").get()).toMatchObject({ n: 1 });
  });
  it.each(["active", "past_due", "pending", "failed"])("blocks a provider-backed %s standing order", async (state) => {
    customer();
    insert("standing_orders", { id: "standing", customer_id: "person1", package_id: "p", snapshot: "{}", monthly_agorot: 100, first_order_id: "o", state, keva_id: "provider-standing-order", created_at: now, updated_at: now });
    expect((await reset()).status).toBe(409);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM standing_orders").get()).toMatchObject({ n: 1 });
  });
  it.each(["active", "past_due", "pending", "failed"])("handles %s standing orders without a provider id", async state => {
    customer();
    insert("standing_orders", { id: "standing", customer_id: "person1", package_id: "p", snapshot: "{}", monthly_agorot: 100, first_order_id: "o", state, provider_ref: "checkout-reference", created_at: now, updated_at: now });
    expect((await reset()).status).toBe(["active", "past_due"].includes(state) ? 409 : 200);
  });
  it.each(["active", "paused", "past_due"])("blocks a %s owned recurring subscription", async (status) => {
    customer(); planAndSubscription("person1", status);
    expect((await reset()).status).toBe(409);
  });
  it("blocks reset until another owner's family membership is removed", async () => {
    customer(); customer("owner", "0507654321"); planAndSubscription("owner", "active");
    insert("subscription_members", { subscription_id: "sub", customer_id: "person1", added_at: now });
    const response = await reset();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("יש להסיר את הלקוח מהמנוי המשפחתי תחילה");
    expect(sql.prepare("SELECT * FROM subscriptions").get()).toMatchObject({ id: "sub", customer_id: "owner", status: "active" });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM subscription_members").get()).toMatchObject({ n: 1 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM customers").get()).toMatchObject({ n: 2 });
  });
  it("preserves usage charged to another customer's receipt after family membership removal", async () => {
    customer(); customer("owner", "0507654321");
    insert("sales_receipts", { id: "family-receipt", customer_id: "owner", package_id: "p", product: "school", reference: "family-ref", amount_ils: 100, vat_rate: 0, minutes: 60, expires_at: now, created_at: now });
    insert("usage_allocations", { call_id: "family-call", customer_id: "person1", product: "school", receipt_id: "family-receipt", reserved_seconds: 120, billed_seconds: 120, created_at: now });
    expect((await reset()).status).toBe(200);
    expect(sql.prepare("SELECT billed_seconds FROM usage_allocations").get()).toMatchObject({ billed_seconds: 120 });
    expect(sql.prepare("SELECT customer_id FROM sales_receipts").get()).toMatchObject({ customer_id: "owner" });
  });
  it("allows an active prepaid entitlement that has no recurring billing", async () => {
    customer(); planAndSubscription("person1", "active");
    sql.prepare("UPDATE plans SET billing='prepaid'").run();
    expect((await reset()).status).toBe(200);
  });
  it("supports id confirmation for a customer without a phone", async () => {
    insert("customers", { id: "email-only", name: "שם", created_at: now, updated_at: now });
    expect((await reset("email-only", "email-only")).status).toBe(200);
  });
  it("clears old preferences and sessions even when the recreated phone gets the same deterministic id", async () => {
    const b = new BusinessStore(env.DB);
    const oldId = await b.identifyCall("0501234567", "old-call", "ivr");
    await b.savePreference(oldId, { plan: { level: "beginner" }, intro_school_seen: true });
    session();
    sql.prepare("UPDATE sessions SET student_id=?").run(oldId);
    sql.prepare("UPDATE call_customers SET customer_id=? WHERE call_id='call1'").run(oldId);
    expect((await reset("0501234567", oldId)).status).toBe(200);
    const freshId = await b.identifyCall("0501234567", "fresh-call", "ivr");
    expect(freshId).toBe(oldId);
    expect(await b.loadContext("preferences:" + freshId)).toEqual({ last_verified_caller: "0501234567" });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM sessions WHERE student_id=?").get(freshId)).toMatchObject({ n: 0 });
    await startAdEntry(b, new ProgressStore(env.DB), {} as any, "fresh-call", freshId, "test");
    expect(await b.loadContext("fresh-call")).toMatchObject({ ad_new_caller: true });
  });
  it("rolls back all D1 deletions and audit if a later deletion fails", async () => {
    customer(); session();
    insert("ivr_voicemails", { id: "vm", system_phone: "system", file_id: "file", customer_id: "person1", caller_key: "hash", created_at: now, intake_day: "2026-11-19", audio_ready: 1 });
    const deleteAudio = vi.fn(); env.VOICEMAIL_AUDIO = { delete: deleteAudio } as any;
    sql.exec("CREATE TRIGGER prevent_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'test failure'); END");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await reset();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ detail: "מחיקת הלקוח נכשלה עקב שגיאת שרת. נסו שוב או פנו לתמיכה." });
    expect(log).toHaveBeenCalledWith("crm_customer_reset_failed", expect.objectContaining({ message: "test failure" }));
    expect(sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toMatchObject({ n: 1 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM console_audit").get()).toMatchObject({ n: 0 });
    expect(deleteAudio).not.toHaveBeenCalled();
  });
  it("persists recording deletion after a failed reset cleanup and cron retries without playback access", async () => {
    customer(); session();
    sql.exec("UPDATE sessions SET started_at='2000-01-01',ended_at='2000-01-01'; UPDATE call_customers SET created_at='2000-01-01'");
    insert("call_recordings", { call_id: "call1", profile_id: "teacher1", customer_id: "person1", r2_key: "recordings/call1.ulaw", bytes: 8000, duration_ms: 1000, created_at: now });
    const deleteAudio = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    env.VOICEMAIL_AUDIO = { delete: deleteAudio } as any;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await reset()).status).toBe(200);
    expect(sql.prepare("SELECT * FROM call_recordings").all()).toHaveLength(0);
    expect(sql.prepare("SELECT r2_key FROM recording_deletions").all()).toEqual([{ r2_key: "recordings/call1.ulaw" }]);
    expect((await request("recordings/call1/audio")).status).toBe(404);
    await cleanupRecordings(env);
    expect(deleteAudio).toHaveBeenCalledTimes(2);
    expect(sql.prepare("SELECT * FROM recording_deletions").all()).toHaveLength(0);
  });
  it("rolls back queued recording deletions with a failed reset transaction", async () => {
    customer();
    insert("call_recordings", { call_id: "old", profile_id: "teacher1", customer_id: "person1", r2_key: "recordings/old.ulaw", bytes: 8000, duration_ms: 1000, created_at: now });
    sql.exec("CREATE TRIGGER prevent_queue BEFORE INSERT ON recording_deletions BEGIN SELECT RAISE(ABORT,'queue failure'); END");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await reset()).status).toBe(500);
    expect(sql.prepare("SELECT * FROM call_recordings").all()).toHaveLength(1);
    expect(sql.prepare("SELECT * FROM customers").all()).toHaveLength(1);
  });
  it("retention atomically revokes expired recordings and retains failed R2 deletions for cron retry", async () => {
    insert("call_recordings", { call_id: "old", profile_id: "t", customer_id: "c", r2_key: "recordings/old.ulaw", bytes: 8000, duration_ms: 1000, created_at: "2000-01-01" });
    const deleteAudio = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    env.VOICEMAIL_AUDIO = { delete: deleteAudio } as any;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await cleanupRecordings(env);
    expect(sql.prepare("SELECT * FROM call_recordings").all()).toHaveLength(0);
    expect(sql.prepare("SELECT * FROM recording_deletions").all()).toHaveLength(1);
    expect((await request("recordings/old/audio")).status).toBe(404);
    await cleanupRecordings(env);
    expect(deleteAudio).toHaveBeenCalledWith("recordings/old.ulaw");
    expect(sql.prepare("SELECT * FROM recording_deletions").all()).toHaveLength(0);
  });
  it("retains reset deletion targets when R2 is not bound until a later cleanup", async () => {
    customer();
    insert("call_recordings", { call_id: "old", profile_id: "t", customer_id: "person1", r2_key: "recordings/old.ulaw", bytes: 8000, duration_ms: 1000, created_at: now });
    expect((await reset()).status).toBe(200);
    expect((await request("recordings/old/audio")).status).toBe(404);
    expect(sql.prepare("SELECT * FROM recording_deletions").all()).toHaveLength(1);
    const deleteAudio = vi.fn().mockResolvedValue(undefined);
    env.VOICEMAIL_AUDIO = { delete: deleteAudio } as any;
    await cleanupRecordings(env);
    expect(deleteAudio).toHaveBeenCalledWith("recordings/old.ulaw");
    expect(sql.prepare("SELECT * FROM recording_deletions").all()).toHaveLength(0);
  });
  it.each([true, false])("succeeds and logs best-effort audio cleanup failure with R2 binding %s", async binding => {
    customer();
    insert("ivr_voicemails", { id: "vm", system_phone: "system", file_id: "file", customer_id: "person1", caller_key: "hash", created_at: now, intake_day: "2026-11-19", audio_ready: 1 });
    if (binding) env.VOICEMAIL_AUDIO = { delete: vi.fn().mockImplementation(async () => {
      expect(sql.prepare("SELECT COUNT(*) AS n FROM customers").get()).toMatchObject({ n: 0 });
      throw new Error("unavailable");
    }) } as any;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await reset();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ r2_objects: 0 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM customers").get()).toMatchObject({ n: 0 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM console_audit").get()).toMatchObject({ n: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("crm_reset_audio_cleanup_failed"));
  });
  it("deletes the full linked history in FK-safe order and makes the phone a fresh caller", async () => {
    customer("other", "0507654321");
    const baseline = Object.fromEntries((sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(({ name }) => [name, (sql.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as any).n]));
    customer(); session(); planAndSubscription();
    const b = new BusinessStore(env.DB);
    await b.savePreference("person1", { plan: { level: "beginner" }, intro_school_seen: true, email: "yael@example.test" });
    await b.savePreference("other", { intro_school_seen: true });
    const phoneHash = await sha256Hex("0501234567");
    for (const id of ["person1", phoneHash.slice(0, 24)]) insert("console_records", { kind: "learner-phone-links", id, body: "{}", created_at: now, updated_at: now });
    insert("customer_phones", { phone: "0501234567", customer_id: "person1" });
    for (const kind of ["enrollments", "ivr-events", "ad-entries", "sales-followups", "learner-phone-links"]) event(kind, { call_id: "call1", phone: "0501234567", callback_id: "cb" });
    for (const kind of ["learner-teachers:person1", "learner-materials:person1"]) event(kind, {});
    await b.saveContext("call1", { plan: "old" }); await b.saveContext("payments:call1", { value: "old" });
    await b.putSetting("portal-auth:challenge", { phone: "0501234567", linkCustomer: "person1" });
    await b.putSetting("portal-email:challenge", { email: "yael@example.test" });
    await b.putSetting("voice-ticket:ticket", { customerId: "person1" });
    await b.putSetting("economics", { usd_ils: 4 });
    insert("api_quota", { month: "2026-11", api: "global", used: 10 });
    insert("sales_receipts", { id: "receipt", customer_id: "person1", package_id: "p", product: "school", reference: "ref", amount_ils: 100, vat_rate: 0, minutes: 60, expires_at: now, created_at: now, subscription_id: "sub" });
    insert("payment_orders", { id: "order", call_id: "call1", customer_id: "person1", package_id: "p", snapshot: "{}", amount_agorot: 100, vat_rate: 0, state: "paid", receipt_id: "receipt", entitlement_id: "sub", created_at: now, updated_at: now });
    insert("payment_issues", { id: "issue", order_id: "order", kind: "test", message: "test", created_at: now });
    insert("installment_grants", { order_id: "order", month_index: 1, due_at: now, receipt_id: "receipt" });
    insert("standing_orders", { id: "standing", customer_id: "person1", package_id: "p", snapshot: "{}", monthly_agorot: 100, first_order_id: "order", state: "cancelled", entitlement_id: "sub", created_at: now, updated_at: now });
    insert("invoices", { id: "invoice", customer_id: "person1", subscription_id: "sub", amount_agorot: 100, status: "paid", issued_at: now, created_at: now });
    insert("subscription_members", { subscription_id: "sub", customer_id: "other", added_at: now });
    insert("subscription_renewals", { reference: "renewal", subscription_id: "sub", period_start: now, created_at: now });
    insert("subscription_billing_locks", { subscription_id: "sub", token: "token", created_at: now });
    insert("usage_allocations", { call_id: "call1", customer_id: "person1", product: "school-opening", receipt_id: "receipt", reserved_seconds: 120, billed_seconds: 120, created_at: now });
    insert("portal_tokens", { token_hash: "portal", customer_id: "person1", expires_at: now });
    insert("app_login_codes", { customer_id: "person1", code_hash: "code", expires_at_ms: 1, created_at: now });
    insert("app_sessions", { token_hash: "app", customer_id: "person1", expires_at_ms: 1, created_at: now });
    insert("customer_settings", { customer_id: "person1", body: "{}", updated_at: now });
    insert("learning_lessons", { customer_id: "person1", call_id: "call1", plan_json: "{}", created_at: now });
    insert("learning_targets", { customer_id: "person1", kind: "vocabulary", target_id: "word", body: "{}" });
    insert("learning_batches", { customer_id: "person1", call_id: "call1", activity_id: "activity", created_at: now });
    insert("learning_results", { customer_id: "person1", call_id: "call1", activity_id: "activity", kind: "vocabulary", target_id: "word", score: 100 });
    insert("learning_exposures", { customer_id: "person1", call_id: "call1", target_id: "word", count: 1 });
    insert("callback_requests", { id: "cb", phone: "+972501234567", name: "שם", for_whom: "self", goal: "lesson", timing: "now", source: "test", consent_at: now, created_at: now, updated_at: now });
    insert("ivr_voicemails", { id: "vm", system_phone: "system", file_id: "file", customer_id: "person1", caller_key: phoneHash, created_at: now, intake_day: "2026-11-19", audio_ready: 1 });
    const r2Delete = vi.fn().mockResolvedValue(undefined); env.VOICEMAIL_AUDIO = { delete: r2Delete } as any;
    insert("analytics_events", { id: "analytics", event: "sign_up", ts: now, origin: "server", visitor_id: "v", session_id: "s", path: "/", referrer: "", first_touch: "{}", last_touch: "{}", meta: "{}", customer_id: "person1", reference: "person1" });
    insert("analytics_attribution", { kind: "sign_up", reference: "person1", attribution: "{}" });
    insert("active_calls", { call_id: "call1", profile_id: "teacher1", owner_id: "expired", acquired_at: 0, lease_expires_at: 1 });
    insert("conversation_turns", { call_id: "call1", profile_id: "teacher1", created_at: now, direction: "learner", text: "hello" });
    insert("diagnostic_events", { call_id: "call1", profile_id: "teacher1", created_at: now, event_type: "test", details_json: "{}" });
    insert("latency_events", { call_id: "call1", profile_id: "teacher1", created_at: now, event_name: "test", since_call_start_ms: 0, since_previous_ms: 0 });
    insert("prompt_snapshots", { call_id: "call1", profile_id: "teacher1", created_at: now, fingerprint: "test", system_instruction: "old", opening_message: "old", history_context: "old", setup_json: "{}" });
    insert("navigation_usage_events", { call_id: "call1", profile_id: "teacher1", channel: "phone", model: "test", reported_at: now, usage_json: "{}" });
    insert("navigation_call_costs", { call_id: "call1", profile_id: "teacher1", computed_at: now, summary_json: "{}" });
    insert("navigation_devices", { device_id: "device", traccar_device_id: 1, label: "device", created_at: now });
    insert("navigation_assignments", { customer_id: "person1", device_id: "device", updated_at: now });
    insert("navigation_destinations", { id: "destination", customer_id: "person1", label: "home", address: "test", created_at: now, updated_at: now });
    insert("navigation_trips", { id: "trip", customer_id: "person1", device_id: "device", destination_label: "home", destination_address: "test", created_at_ms: 1, updated_at_ms: 1 });
    const response = await reset();
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.deleted).toMatchObject({ customers: 1, customer_phones: 1, sessions: 1, installment_grants: 1, subscriptions: 1, callback_requests: 1, learning_results: 1 });
    for (const table of Object.keys(result.deleted).filter(t => t !== "console_settings")) expect(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toMatchObject({ n: baseline[table] });
    expect(r2Delete).toHaveBeenCalledWith(["voicemails/vm.mp3"]);
    const audit = sql.prepare("SELECT action,entity_id FROM console_audit").get() as any;
    expect(audit.entity_id).toBe("person1"); expect(JSON.parse(audit.action)).toMatchObject({ action: "crm_customer_reset", actor: "bearer", counts: result.deleted });
    expect(audit.action).not.toContain("0501234567");
    expect(await b.setting("economics")).toEqual({ usd_ils: 4 });
    expect(await b.loadContext("preferences:other")).toEqual({ intro_school_seen: true });
    expect(sql.prepare("SELECT used FROM api_quota").get()).toMatchObject({ used: 10 });
    const freshId = await b.identifyCall("+972501234567", "fresh-call", "ivr");
    expect(await b.loadContext("preferences:" + freshId)).toEqual({ last_verified_caller: "0501234567" });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM sessions WHERE student_id=?").get(freshId)).toMatchObject({ n: 0 });
    await startAdEntry(b, new ProgressStore(env.DB), {} as any, "fresh-call", freshId, "test");
    expect(await b.loadContext("fresh-call")).toMatchObject({ ad_new_caller: true });
    expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("CRM status priority", () => {
  const base = { paid: false, callback: false, offered: false, activity: false, longest: 120, last: now, sessions: 0 };
  it("handles new, trial, short and inactive sessions and priority", () => {
    expect(deriveStatus(base)).toBe("new");
    expect(deriveStatus({ ...base, sessions: 1, activity: true })).toBe("trial");
    expect(deriveStatus({ ...base, sessions: 1, activity: true, longest: SHORT_SESSION_SECONDS })).toBe("dropped");
    expect(deriveStatus({ ...base, sessions: 1, activity: true, last: new Date(Date.now() - (INACTIVE_DAYS + 1) * 86400000).toISOString() })).toBe("dropped");
    expect(deriveStatus({ ...base, offered: true, activity: true })).toBe("offer_no_buy");
    expect(deriveStatus({ ...base, offered: true, callback: true })).toBe("callback_pending");
    expect(deriveStatus({ ...base, paid: true, callback: true, offered: true })).toBe("paying");
  });
});
describe("CRM read-only endpoints", () => {
  it("counts returning customers once on every day they were active", async () => {
    customer(); session();
    const earlier = new Date(Date.parse(now) - 2 * 86400000).toISOString();
    event("ivr-events", { route: "main", at: earlier });
    event("ivr-events", { route: "school", at: earlier });
    const { days } = await (await request("analytics")).json() as any;
    expect(days).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: earlier.slice(0, 10), active: 1, calls: 0 }),
      expect.objectContaining({ date: now.slice(0, 10), active: 1, calls: 1 }),
    ]));
  });
  it("requires admin and handles empty/not found/invalid filters/methods", async () => {
    expect((await request("people", false)).status).toBe(401);
    expect(await (await request("people")).json()).toMatchObject({ items: [], total: 0, cursor: null, counts: { paying: 0 } });
    for (const path of ["people/missing", "calls/missing/transcript"]) expect((await request(path)).status).toBe(404);
    for (const query of ["limit=0", "limit=201", "limit=no", "status=invalid", "cursor=missing"]) expect((await request("people?" + query)).status).toBe(422);
    expect((await request("people", true, "POST")).status).toBe(405);
  });
  it("serves both unified CRM routes without external fonts and preserves legacy HTML", async () => {
    env.ASSETS = { fetch: async () => new Response('<html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><div>שלום</div></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher;
    const crm = await worker.fetch(new Request('https://speakcall.app/dashboard/crm'), env);
    expect(await crm.text()).not.toContain('fonts.google');
    const old = await worker.fetch(new Request('https://speakcall.app/dashboard'), env);
    expect(await old.text()).not.toContain('fonts.googleapis.com');
    const legacy = await worker.fetch(new Request('https://speakcall.app/dashboard/legacy'), env);
    expect(await legacy.text()).toContain('fonts.googleapis.com');
  });
  it("matches scheduled callbacks by normalized phone and includes typed-only/JSON-only people", async () => {
    customer();
    sql.prepare("INSERT INTO customers(id,name,created_at,updated_at) VALUES ('typed','לקוח מטבלה',?,?)").run(now, now);
    sql.prepare("INSERT INTO console_records VALUES ('customers','json',?,?,?)").run(JSON.stringify({ name: "לקוח ממסמך", phone: "0502222222" }), now, now);
    sql.prepare("INSERT INTO callback_requests(id,phone,name,for_whom,goal,timing,source,consent_at,status,created_at,updated_at) VALUES ('cb','+972501234567','בדיקה','self','תרגול','now','אתר',?,'queued',?,?)").run(now, now, now);
    const result = await (await request('people')).json() as any;
    expect(result.total).toBe(3);
    expect(result.items.find((p: any) => p.id === 'person1').status).toBe('callback_pending');
    const card = await (await request('people/person1')).json() as any;
    expect(card.journey).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'callback', label: 'בקשה לשיחה חוזרת' })]));
  });
  it("merges typed+JSON once, aggregates costs, supports filters/counts and stable pagination", async () => {
    customer(); customer("person2", "0507654321"); session();
    event("ad-entries", { call_id: "call1", campaign: "pirsumofon-news" });
    sql.prepare("INSERT INTO console_settings VALUES ('economics',?)").run(JSON.stringify({ usd_ils: 4, forecast_cost_per_minute: 0.2 }));
    const result = await (await request("people?limit=1")).json() as any;
    expect(result).toMatchObject({ total: 2, cursor: "person1", counts: { trial: 1, new: 1 } });
    expect(result.items[0]).toMatchObject({ name: "יעל כהן", phone: "0501234567", calls_count: 1, minutes_used: 2, total_cost_ils: 0.8, ad_source: "pirsumofon-news", channels: ["phone", "web"] });
    expect((await (await request("people?limit=1&cursor=person1")).json() as any).items[0].id).toBe("person2");
    expect((await (await request("people?q=yael&source=pirsumofon-news&status=trial")).json() as any).items).toHaveLength(1);
    expect((await (await request("people?q=missing")).json() as any).items).toEqual([]);
  });
  it("falls back to saved preference email for cards and search without replacing profile email", async () => {
    customer();
    sql.prepare("INSERT INTO console_settings VALUES ('ivr:preferences:person1',?)").run(JSON.stringify({ email: "phone@example.test" }));
    expect((await (await request("people/person1")).json() as any).email).toBe("yael@example.test");
    sql.prepare("UPDATE console_records SET body=? WHERE kind='customers' AND id='person1'").run(JSON.stringify({ name: "יעל", phone: "0501234567" }));
    expect((await (await request("people/person1")).json() as any).email).toBe("phone@example.test");
    expect((await (await request("people?q=PHONE%40example.test")).json() as any).items).toHaveLength(1);
    sql.prepare("UPDATE console_settings SET body='not-json' WHERE id='ivr:preferences:person1'").run();
    expect((await (await request("people/person1")).json() as any).email).toBe("");
    expect((await (await request("people?q=phone%40example.test")).json() as any).items).toEqual([]);
  });
  it("derives callback/offer/payer from persisted records and preserves precedence", async () => {
    customer(); event("ivr-events", { route: "sales" });
    expect((await (await request("people")).json() as any).items[0].status).toBe("offer_no_buy");
    event("sales-followups", { type: "lesson", status: "pending" });
    expect((await (await request("people")).json() as any).items[0].status).toBe("callback_pending");
    sql.prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES ('r1','person1','p1','school','test',59,0.18,100,?,?)").run(now, now);
    expect((await (await request("people")).json() as any).items[0]).toMatchObject({ status: "paying", revenue_ils: 59 });
    expect(await (await request("analytics")).json()).toMatchObject({ totals: { callbacks_waiting: 1 }, statuses: { paying: 1, callback_pending: 0 } });
  });
  it.each(["queued", "dialing", "done", "dialed", "failed"])("uses the matching callback's %s state instead of a stale lesson followup", async (status) => {
    customer();
    event("sales-followups", { type: "lesson", status: "pending", callback_id: "lesson-cb" });
    sql.prepare("INSERT INTO callback_requests(id,phone,name,for_whom,goal,timing,source,consent_at,status,created_at,updated_at) VALUES ('lesson-cb','+972501234567','בדיקה','self','תרגול','now','אתר',?,?,?,?)").run(now, status, now, now);
    const expected = ["queued", "dialing"].includes(status) ? "callback_pending" : "offer_no_buy";
    expect((await (await request("people")).json() as any).items[0].status).toBe(expected);
    expect((await (await request("people/person1")).json() as any).status).toBe(expected);
  });
  it("charges estimated telephony only for phone sessions, not web or unclassified sessions", async () => {
    customer(); session("phone"); session("web"); session("unknown");
    sql.prepare("UPDATE call_customers SET channel='web' WHERE call_id='web'").run();
    sql.prepare("DELETE FROM call_customers WHERE call_id='unknown'").run();
    sql.prepare("INSERT INTO console_settings VALUES ('economics',?)").run(JSON.stringify({ usd_ils: 4, forecast_cost_per_minute: 0.2 }));
    const card = await (await request("people/person1")).json() as any;
    expect(card.calls.find((c: any) => c.call_id === "phone")).toMatchObject({ telephony_cost_ils: 0.4, total_cost_ils: 0.8 });
    for (const id of ["web", "unknown"]) expect(card.calls.find((c: any) => c.call_id === id)).toMatchObject({ telephony_cost_ils: 0, telephony_rate_ils: 0, total_cost_ils: 0.4 });
    expect(card.total_cost_ils).toBe(1.6);
    expect((await (await request("people")).json() as any).items[0].total_cost_ils).toBe(1.6);
  });
  it("exposes saved recordings in the calls list and requires admin playback authentication", async () => {
    customer(); session();
    insert("call_recordings", { call_id: "call1", profile_id: "teacher1", customer_id: "person1", r2_key: "recordings/call1.ulaw", bytes: 8000, duration_ms: 1000, created_at: now });
    const card = await (await request("people/person1")).json() as any;
    expect(card.calls[0].recording).toBe(true);
    expect((await request("recordings/call1/audio", false)).status).toBe(401);
    expect((await request("recordings/missing/audio")).status).toBe(404);
  });
  it("returns chronological journey/calls, lazy transcript, null recording and empty transcript", async () => {
    customer(); session(); session("empty", null);
    event("ivr-events", { call_id: "call1", route: "main", input: { isaacMain: "2" }, output: { goTo: "/99/2" } });
    const result = await (await request("people/person1")).json() as any;
    expect(result.calls).toHaveLength(2);
    expect(result.calls.find((c: any) => c.call_id === "call1")).toMatchObject({ has_transcript: true, recording: null, ai_cost_usd: 0.1 });
    expect(result.calls[0]).not.toHaveProperty("transcript_json");
    expect(result.journey).toEqual(expect.arrayContaining([expect.objectContaining({ label: "תפריט ראשי", input: { isaacMain: "2" }, destination: "/99/2", call_id: "call1" })]));
    expect(await (await request("calls/call1/transcript")).json()).toMatchObject({ turns: [{ role: "learner", text: "Hello" }], recording: null });
    expect(await (await request("calls/empty/transcript")).json()).toMatchObject({ turns: [] });
  });
  it("provides real analytics, smart multi-term search and sortable customer columns", async () => {
    customer(); customer("person2", "0507654321"); session();
    sql.prepare("UPDATE console_records SET body=? WHERE kind='customers' AND id='person1'").run(JSON.stringify({ name: "יעל כהן", phone: "0501234567", source: "קמפיין נובמבר", notes: "מבקשת שיעור ערב" }));
    const analytics = await (await request("analytics")).json() as any;
    expect(analytics).toMatchObject({ totals: { leads: 2, customers_with_calls: 1, calls: 1, minutes: 2 }, statuses: { trial: 1, new: 1 } });
    expect(analytics.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source: "קמפיין נובמבר", leads: 1, trials: 1 })]));
    expect(analytics.days).toHaveLength(30);
    expect((await (await request("people?q=יעל%20ערב")).json() as any).items).toHaveLength(1);
    const sorted = await (await request("people?sort=name&direction=desc")).json() as any;
    expect(sorted.items.map((p: any) => p.id)).toEqual(["person1", "person2"]);
    expect((await request("people?sort=not-a-column")).status).toBe(422);
  });
  it("excludes translator and navigation activity from the English-school CRM", async () => {
    customer(); session("english"); session("translate"); session("navigate");
    sql.prepare("INSERT INTO bots(id,label,role,created_at,updated_at) VALUES ('translator-bot','תרגומון','translator',?,?),('voice-navigator-live','ניווט','custom',?,?)").run(now, now, now, now);
    sql.prepare("UPDATE call_customers SET bot_id='translator-bot' WHERE call_id='translate'").run();
    sql.prepare("UPDATE call_customers SET bot_id='voice-navigator-live' WHERE call_id='navigate'").run();
    event("ivr-events", { call_id: "translate", route: "translator" });
    const card = await (await request("people/person1")).json() as any;
    expect(card.calls.map((c: any) => c.call_id)).toEqual(["english"]);
    expect(card).toMatchObject({ calls_count: 1, minutes_used: 2, card_payment: { available: false } });
    expect(card.journey.some((step: any) => step.call_id === "translate" || step.call_id === "navigate")).toBe(false);
  });
});

describe("CRM customer editing", () => {
  it("preserves the saved teacher when the profile form omits it", async () => {
    await new BusinessStore(env.DB).save("customers", { name: "לקוח", phone: "0501234567", preferred_bot: "teacher1" }, "person1");
    const update = (extra: Record<string, string>) => worker.fetch(new Request("https://speakcall.app/v1/admin/business/customers/person1", {
      method: "PUT", headers: { Authorization: "Bearer crm-test-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "לקוח", phone: "0501234567", notes: "הערה", ...extra }),
    }), env);
    expect(await (await update({})).json()).toMatchObject({ notes: "הערה", preferred_bot: "teacher1" });
    expect(await (await update({ preferred_bot: "" })).json()).toMatchObject({ preferred_bot: "" });
  });
});
