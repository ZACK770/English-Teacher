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
afterEach(() => sql.close());
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
function insert(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  sql.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row) as any[]);
}
function planAndSubscription(owner = "person1", status = "cancelled", id = "sub") {
  sql.prepare("INSERT OR IGNORE INTO plans(id,name,product,billing,price_agorot,created_at,updated_at) VALUES ('plan','תכנית','school','monthly',100,?,?)").run(now, now);
  insert("subscriptions", { id, customer_id: owner, plan_id: "plan", status, price_agorot: 100, started_at: now, created_at: now, updated_at: now });
}

describe("CRM customer reset", () => {
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
  it.each(["active", "past_due", "pending", "failed"])("blocks a %s standing order", async (state) => {
    customer();
    insert("standing_orders", { id: "standing", customer_id: "person1", package_id: "p", snapshot: "{}", monthly_agorot: 100, first_order_id: "o", state, created_at: now, updated_at: now });
    expect((await reset()).status).toBe(409);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM standing_orders").get()).toMatchObject({ n: 1 });
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
    expect(await b.loadContext("preferences:" + freshId)).toEqual({});
    expect(sql.prepare("SELECT COUNT(*) AS n FROM sessions WHERE student_id=?").get(freshId)).toMatchObject({ n: 0 });
    await startAdEntry(b, new ProgressStore(env.DB), {} as any, "fresh-call", freshId, "test");
    expect(await b.loadContext("fresh-call")).toMatchObject({ ad_new_caller: true });
  });
  it("rolls back all D1 deletions and audit if a later deletion fails", async () => {
    customer(); session();
    sql.exec("CREATE TRIGGER prevent_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'test failure'); END");
    expect((await reset()).status).toBe(500);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toMatchObject({ n: 1 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM console_audit").get()).toMatchObject({ n: 0 });
  });
  it("does not delete D1 records when R2 deletion fails", async () => {
    customer();
    insert("ivr_voicemails", { id: "vm", system_phone: "system", file_id: "file", customer_id: "person1", caller_key: "hash", created_at: now, intake_day: "2026-11-19", audio_ready: 1 });
    env.VOICEMAIL_AUDIO = { delete: vi.fn().mockRejectedValue(new Error("unavailable")) } as any;
    expect((await reset()).status).toBe(503);
    expect(sql.prepare("SELECT id FROM customers").get()).toMatchObject({ id: "person1" });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM console_audit").get()).toMatchObject({ n: 0 });
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
    expect(await b.loadContext("preferences:" + freshId)).toEqual({});
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
  it("requires admin and handles empty/not found/invalid filters/methods", async () => {
    expect((await request("people", false)).status).toBe(401);
    expect(await (await request("people")).json()).toMatchObject({ items: [], total: 0, cursor: null, counts: { paying: 0 } });
    for (const path of ["people/missing", "calls/missing/transcript"]) expect((await request(path)).status).toBe(404);
    for (const query of ["limit=0", "limit=201", "limit=no", "status=invalid", "cursor=missing"]) expect((await request("people?" + query)).status).toBe(422);
    expect((await request("people", true, "POST")).status).toBe(405);
  });
  it("removes external font links only for CRM HTML", async () => {
    env.ASSETS = { fetch: async () => new Response('<html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><div>שלום</div></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher;
    const crm = await worker.fetch(new Request('https://speakcall.app/dashboard/crm'), env);
    expect(await crm.text()).not.toContain('fonts.google');
    const old = await worker.fetch(new Request('https://speakcall.app/dashboard'), env);
    expect(await old.text()).toContain('fonts.googleapis.com');
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
    sql.prepare("INSERT INTO sales_receipts VALUES ('r1','person1','p1','school','test',59,0.18,100,?,?,NULL,NULL)").run(now, now);
    expect((await (await request("people")).json() as any).items[0]).toMatchObject({ status: "paying", revenue_ils: 59 });
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
});
