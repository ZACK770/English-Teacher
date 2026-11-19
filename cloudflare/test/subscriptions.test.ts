import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { addMonths, SubscriptionStore } from "../src/subscriptions";
import { LearningStore, vocabularyCatalog } from "../src/learning";
import { subscriptionApi } from "../src/subscription-api";
import worker from "../src/index";
import type { Env } from "../src/env";

class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    this.sql.exec("PRAGMA foreign_keys=ON");
  }
  prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      first: async () => this.sql.prepare(query).get(...args) ?? null,
      all: async () => ({ results: this.sql.prepare(query).all(...args), success: true }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...args).changes) } }),
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.sql.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      this.sql.exec("COMMIT");
      return results;
    } catch (error) { this.sql.exec("ROLLBACK"); throw error; }
  }
}
let db: SqlD1, store: SubscriptionStore, b: BusinessStore;
const at = "2026-01-01T00:00:00.000+00:00";
const date = (value: string) => vi.setSystemTime(new Date(value));
const receipts = () => db.sql.prepare("SELECT * FROM sales_receipts ORDER BY expires_at").all() as Record<string, any>[];
beforeEach(async () => {
  vi.useFakeTimers(); date(at);
  db = new SqlD1();
  store = new SubscriptionStore(db as unknown as D1Database);
  b = new BusinessStore(db as unknown as D1Database);
  await b.save("customers", { name: "Owner", phone: "0501111111" }, "owner");
  await b.save("policies", { enabled: true, product: "school", free_calls_month: 0, opening_seconds: 0, blocked_extension: "/99/8" }, "teacher");
});
afterEach(() => { db.sql.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("subscription promises against production SQL", () => {
  it("locks plan price, family price and minutes and grants the first period atomically", async () => {
    const sub = await store.create("owner", "school-step", at);
    expect(sub.price_agorot).toBe(5900);
    expect(sub.family_addon_agorot).toBe(3900);
    const pkg = await b.record("packages", "school-step");
    await b.save("packages", { ...pkg, price_ils: 999, minutes: 1 }, "school-step");
    expect(await store.renewalAmount(sub.id)).toBe(5900);
    await store.addMember(sub.id, "0502222222", "Learner");
    expect(await store.renewalAmount(sub.id)).toBe(9800);
    expect(receipts()[0].minutes).toBe(60);
    await store.recordRenewal(sub.id, addMonths(at, 1), "charge-1");
    expect(receipts()[1].minutes).toBe(60);
    expect((await store.get(sub.id)).price_agorot).toBe(5900);
  });
  it("rolls minutes for exactly one month, consumes earliest expiry first and deduplicates charges", async () => {
    const sub = await store.create("owner", "school-step", at);
    await store.recordRenewal(sub.id, addMonths(at, 1), "charge");
    await store.recordRenewal(sub.id, addMonths(at, 1), "charge");
    await store.grantPeriod(sub.id);
    expect(receipts()).toHaveLength(2);
    expect(receipts()[0].expires_at).toBe(addMonths(at, 2));
    date("2026-02-15");
    expect((await store.summary("owner"))[0].rollover_minutes).toBe(60);
    expect((await b.reserveCall("owner", "teacher", "feb", 60)).mode).toBe("paid");
    expect(db.sql.prepare("SELECT receipt_id FROM usage_allocations WHERE call_id='feb'").get()?.receipt_id).toBe(receipts()[0].id);
    await b.settleCall("feb", 60);
    date("2026-03-01");
    await b.reserveCall("owner", "teacher", "mar", 60);
    expect(db.sql.prepare("SELECT receipt_id FROM usage_allocations WHERE call_id='mar'").get()?.receipt_id).toBe(receipts()[1].id);
    expect((await store.summary("owner"))[0].rollover_minutes).toBe(0);
    await expect(store.recordRenewal(sub.id, at, " ")).rejects.toThrow();
  });
  it("rejects invalid plans/customers and conflicting charge references", async () => {
    await expect(store.create("missing", "school-step", at)).rejects.toThrow();
    await expect(store.create("owner", "school-topup", at)).rejects.toThrow();
    await expect(store.create("owner", "school-mastery", at)).rejects.toThrow("additional");
    await expect(store.create("owner", "school-foundations", at, [{ domain: "missing" }])).rejects.toThrow("measurable");
    expect(receipts()).toHaveLength(0);
    const a = await store.create("owner", "school-step", at), c = await store.create("owner", "school-pace", at);
    await store.recordRenewal(a.id, at, "unique");
    await expect(store.recordRenewal(c.id, at, "unique")).rejects.toThrow("another");
  });
  it("rolls back a renewal and its billing statements if cancellation wins the race", async () => {
    const sub = await store.create("owner", "school-step", at);
    const get = store.get.bind(store);
    vi.spyOn(store, "get").mockImplementationOnce(async id => {
      const before = await get(id);
      await db.prepare("UPDATE subscriptions SET status='cancelled' WHERE id=?").bind(id).run();
      return before;
    });
    await expect(store.recordRenewal(sub.id, at, "cancelled-charge", { amountAgorot: 5900, vatRate: 18, statements: [store.db.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES ('should-not-commit',?,?)").bind(sub.id, at)] })).rejects.toThrow();
    expect((await store.get(sub.id)).status).toBe("cancelled");
    expect(receipts()).toHaveLength(1);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscription_renewals").get()?.n).toBe(0);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM console_audit WHERE action='should-not-commit'").get()?.n).toBe(0);
  });
  it("freezes only subscription receipts, resumes without lost minutes/days, caps actual pause days", async () => {
    const sub = await store.create("owner", "school-step", at);
    date("2026-01-15");
    await expect(store.pause(sub.id, 0)).rejects.toThrow();
    await expect(store.pause(sub.id, 61)).rejects.toThrow();
    await store.pause(sub.id, 60);
    expect((await b.reserveCall("owner", "teacher", "frozen", 60)).mode).toBe("blocked");
    await expect(store.grantPeriod(sub.id)).rejects.toThrow();
    date("2026-02-04");
    const resumed = await store.resume(sub.id);
    expect(resumed.pause_days_used).toBe(20);
    expect(resumed.current_period_end).toBe("2026-02-21T00:00:00.000+00:00");
    expect(receipts()[0].expires_at).toBe("2026-03-21T00:00:00.000+00:00");
    await expect(store.pause(sub.id, 41)).rejects.toThrow();
    expect((await b.reserveCall("owner", "teacher", "thawed", 60)).mode).toBe("paid");
    await b.settleCall("thawed", 60);
    await store.pause(sub.id, 40);
    date("2026-03-20"); await store.tick();
    expect((await store.get(sub.id)).pause_days_used).toBe(60);
    expect((await store.get(sub.id)).status).toBe("active");
    await expect(store.pause(sub.id, 1)).rejects.toThrow();
    date("2027-01-02");
    expect((await store.pause(sub.id, 60)).pause_days_used).toBe(0);
  });
  it("shifts receipts even when they would have expired during the pause and extends mastery term", async () => {
    const sub = await store.create("owner", "school-foundations", at);
    await store.pause(sub.id, 60, "2026-02-20");
    await store.tick("2026-04-25");
    expect(receipts()[0].expires_at).toBe("2026-04-30T00:00:00.000+00:00");
    expect((await store.get(sub.id)).term_end).toBe("2026-06-30T00:00:00.000+00:00");
  });
  it("cancels future grants but keeps existing paid minutes until expiry", async () => {
    const sub = await store.create("owner", "school-step", at);
    await store.cancel(sub.id, at);
    await expect(store.recordRenewal(sub.id, at, "cancelled")).rejects.toThrow();
    await expect(store.grantPeriod(sub.id)).rejects.toThrow();
    await store.tick("2026-02-01");
    expect(receipts()).toHaveLength(1);
    date("2026-01-15");
    expect((await b.reserveCall("owner", "teacher", "cancelled-owner", 60)).mode).toBe("paid");
  });
  it("cron grants prepaid mastery months plus a single three-month guarantee extension, never monthly renewals", async () => {
    db.sql.exec("UPDATE console_records SET body=json_set(body,'$.duration_months',6) WHERE kind='packages' AND id='school-foundations'");
    const sub = await store.create("owner", "school-foundations", at);
    await store.create("owner", "school-step", at);
    await expect(store.evaluateGuarantee(sub.id, "2026-06-30")).rejects.toThrow("not due");
    await store.tick("2026-07-01");
    expect((await store.get(sub.id)).guarantee_status).toBe("granted");
    expect((await store.get(sub.id)).extension_months).toBe(3);
    await store.tick("2026-10-01"); await store.tick("2026-11-01");
    expect(receipts().filter(r => r.subscription_id === sub.id)).toHaveLength(9);
    expect(receipts()).toHaveLength(10);
    expect((await store.get(sub.id)).extension_months).toBe(3);
  });
  it("uses measurable whole-domain mastery, averages domains equally and does not extend eligible success", async () => {
    db.sql.exec("UPDATE console_records SET body=json_set(body,'$.duration_months',6) WHERE kind='packages' AND id='school-foundations'");
    const domains = [{ domain: "everyday", levels: ["beginner" as const] }];
    const pool = vocabularyCatalog.filter(t => t.domain === "everyday" && t.level === "beginner");
    expect(pool.length).toBeGreaterThan(100);
    const sub = await store.create("owner", "school-foundations", at, domains);
    const learning = new LearningStore(db as unknown as D1Database);
    const mastered = pool.slice(0, Math.ceil(pool.length * .7));
    for (let i = 0; i < 2; i++) {
      db.sql.prepare("INSERT INTO learning_lessons VALUES (?,?,?,?)").run("owner", "evidence-" + i, JSON.stringify({ vocabulary: mastered, grammar: [] }), at);
      db.sql.prepare("INSERT INTO learning_batches(customer_id,call_id,activity_id,created_at) VALUES (?,?,?,?)").run("owner", "evidence-" + i, "practice-1", at);
      for (const target of mastered) {
        db.sql.prepare("INSERT OR IGNORE INTO learning_targets VALUES (?,?,?,?)").run("owner", "vocabulary", target.id, JSON.stringify(target));
        db.sql.prepare("INSERT INTO learning_results VALUES (?,?,?,?,?,?)").run("owner", "evidence-" + i, "practice-1", "vocabulary", target.id, 100);
      }
    }
    expect((await learning.report("owner")).domains.find(d => d.domain === "everyday")!.total).toBeGreaterThan(pool.length);
    expect((await store.evaluateGuarantee(sub.id, "2026-07-01")).guarantee_status).toBe("not_eligible");
    await store.tick("2026-09-01");
    expect(receipts()).toHaveLength(6);
    expect((await store.get(sub.id)).extension_months).toBe(0);
    const combined = await store.create("owner", "school-mastery", at, [...domains, { domain: "travel" }]);
    expect((await store.evaluateGuarantee(combined.id, "2027-01-01")).guarantee_status).toBe("granted");
  });
  it("shares owner's pool while preserving separate customers, usage identity and progress; limits/removes members", async () => {
    const sub = await store.create("owner", "school-step", at);
    const member = await store.addMember(sub.id, "0502222222", "Child");
    expect(member.customer_id).not.toBe("owner");
    expect(await b.customerForPhone("0502222222")).toBe(member.customer_id);
    expect((await b.reserveCall(member.customer_id, "teacher", "member-call", 60)).mode).toBe("paid");
    const usage = db.sql.prepare("SELECT * FROM usage_allocations WHERE call_id='member-call'").get()!;
    expect(usage.customer_id).toBe(member.customer_id);
    expect(usage.receipt_id).toBe(receipts()[0].id);
    expect((await b.reserveCall(member.customer_id, "teacher", "member-overlap", 60)).mode).toBe("busy");
    expect((await b.reserveCall("owner", "teacher", "owner-parallel", 60)).mode).toBe("paid");
    await b.settleCall("owner-parallel", 60);
    await b.settleCall("member-call", 60);
    const learning = new LearningStore(db as unknown as D1Database);
    const target = vocabularyCatalog[0];
    await learning.begin(member.customer_id, "member-call", { level: "beginner", conversation_mode: "guided", correction_policy: "after_answer", learning_load: "light", closing_activity: "quiz", topic: target.domain, vocabulary: [target], grammar: [] });
    await learning.record(member.customer_id, "member-call", { activity_id: "practice-1", vocabulary: [{ word_id: target.id, score: 100 }] });
    expect((await learning.report(member.customer_id)).items.find(t => t.id === target.id)?.score).toBe(100);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM learning_targets WHERE customer_id='owner'").get()?.n).toBe(0);
    expect((await learning.report("owner")).items.find(t => t.id === target.id)?.attempts).toBe(0);
    for (let i = 3; i <= 5; i++) await store.addMember(sub.id, `050${i}222222`, "Family");
    await expect(store.addMember(sub.id, "0506222222", "Fifth")).rejects.toThrow("limit");
    await expect(store.addMember(sub.id, "0501111111", "Owner")).rejects.toThrow("Owner");
    await store.removeMember(sub.id, member.customer_id);
    expect((await b.reserveCall(member.customer_id, "teacher", "removed-call", 60)).mode).toBe("blocked");
    await store.addMember(sub.id, "0502222222", "Child");
    await store.pause(sub.id, 1, at);
    expect((await b.reserveCall(member.customer_id, "teacher", "paused-member", 60)).mode).toBe("blocked");
  });
  it("exposes authenticated admin and owner-only portal actions, validates input and returns empty lists", async () => {
    const env = { DB: db as unknown as D1Database, ADMIN_BEARER_SECRET: "admin" } as Env;
    const req = (path: string, token: string, body?: unknown) => worker.fetch(new Request("https://test" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    const path = "/v1/admin/business/subscriptions";
    expect((await req(path, "wrong")).status).toBe(401);
    expect(await (await req(path, "admin")).json()).toEqual({ items: [] });
    const created = await req(path, "admin", { customer_id: "owner", plan_id: "school-step" });
    expect(created.status).toBe(201);
    const sub = await created.json() as Record<string, any>;
    const filtered = await req(path + "?customer_id=owner", "admin");
    expect((await filtered.json() as any).items[0]).toMatchObject({ id: sub.id, plan_name: "צעד", owner: true });
    expect(await (await req(path + "?customer_id=nobody", "admin")).json()).toEqual({ items: [] });
    expect((await req(path + "/" + sub.id, "admin")).status).toBe(200);
    const { token } = await b.portalInvite("owner");
    const me = await req("/v1/portal/me", token);
    expect(me.status).toBe(200);
    expect((await me.json() as any).subscriptions[0]).toMatchObject({ id: sub.id, price_agorot: 5900, current_period_end: addMonths(at, 1) });
    expect((await req("/v1/portal/subscriptions", token)).status).toBe(200);
    const pauseRequest = new Request("https://test", { method: "POST", body: JSON.stringify({ days: 5 }) });
    await expect(subscriptionApi(pauseRequest.clone(), store, [sub.id, "pause"], "other")).rejects.toMatchObject({ status: 403 });
    expect((await subscriptionApi(pauseRequest, store, [sub.id, "pause"], "owner")).status).toBe(200);
    await expect(subscriptionApi(new Request("https://test", { method: "POST", body: "{}" }), store, [sub.id, "pause"], "owner")).rejects.toMatchObject({ status: 422 });
    expect((await req("/v1/portal/subscriptions/" + sub.id + "/resume", token, {})).status).toBe(200);
    expect((await req("/v1/portal/subscriptions/" + sub.id + "/pause", token, { days: 1 })).status).toBe(200);
    expect((await store.summary("owner"))[0]).toMatchObject({ status: "paused", price_agorot: 5900, rollover_minutes: 0 });
    expect(await store.summary("nobody")).toEqual([]);
  });
  it("clamps calendar-month arithmetic at month ends", () => {
    expect(addMonths("2026-01-31T00:00:00Z", 1)).toBe("2026-02-28T00:00:00.000+00:00");
  });
  it("does not spend a future period granted by an early renewal", async () => {
    const sub = await store.create("owner", "school-step", at);
    await store.recordRenewal(sub.id, at, "early-charge");
    db.sql.prepare("INSERT INTO usage_allocations VALUES ('spent','owner','school',?,3600,3600,?)").run(receipts()[0].id, at);
    expect((await b.reserveCall("owner", "teacher", "too-early", 60)).mode).toBe("blocked");
    date("2026-02-01");
    expect((await b.reserveCall("owner", "teacher", "on-time", 60)).mode).toBe("paid");
  });
  it("preserves family access to unexpired minutes after cancellation, but not while paused", async () => {
    const sub = await store.create("owner", "school-step", at);
    const member = await store.addMember(sub.id, "0503334444", "Family");
    await store.pause(sub.id, 1, at);
    expect((await b.reserveCall(member.customer_id, "teacher", "frozen-family", 60)).mode).toBe("blocked");
    await store.cancel(sub.id, at);
    expect((await b.reserveCall(member.customer_id, "teacher", "cancelled-family", 60)).mode).toBe("paid");
    date(addMonths(at, 2));
    expect((await b.reserveCall(member.customer_id, "teacher", "expired-family", 60)).mode).toBe("blocked");
  });
  it("isolates bad subscriptions during scheduled processing", async () => {
    const bad = await store.create("owner", "school-foundations", at);
    const good = await store.create("owner", "school-foundations", at);
    db.sql.prepare("UPDATE subscriptions SET status='paused',paused_at='invalid',pause_until=? WHERE id=?").run(at, bad.id);
    vi.spyOn(store, "list").mockResolvedValue([await store.get(bad.id), await store.get(good.id)]);
    await store.tick("2026-02-01");
    expect((await store.get(good.id)).period_number).toBe(2);
    expect((await store.get(bad.id)).status).toBe("paused");
  });
  it("does not revive a concurrently cancelled subscription or extend its receipts", async () => {
    const sub = await store.create("owner", "school-step", at);
    await store.pause(sub.id, 7, at);
    const paused = await store.get(sub.id);
    const expiry = receipts()[0].expires_at;
    vi.spyOn(store, "get").mockImplementationOnce(async () => {
      db.sql.prepare("UPDATE subscriptions SET status='cancelled' WHERE id=?").run(sub.id);
      return paused;
    });
    await expect(store.resume(sub.id, "2026-01-03")).rejects.toThrow("status changed");
    expect((await store.get(sub.id)).status).toBe("cancelled");
    expect(receipts()[0].expires_at).toBe(expiry);
  });
  it("returns plan labels, rollover expiries, members and remaining annual pause days", async () => {
    const sub = await store.create("owner", "school-step", at);
    await store.recordRenewal(sub.id, addMonths(at, 1), "summary-renewal");
    await store.addMember(sub.id, "0503333333", "Family learner");
    await store.pause(sub.id, 7, "2026-02-02");
    const summary = (await store.summary("owner", "2026-02-05"))[0];
    expect(summary).toMatchObject({ plan_name: "צעד", pause_days_remaining: 57, rollover_minutes: 60 });
    expect(summary.rollover).toEqual([{ expires_at: addMonths(at, 2), minutes: 60 }]);
    expect(summary.members).toHaveLength(1);
  });
  it("anchors month-end renewals and never grants an extra mastery period after February", async () => {
    db.sql.exec("UPDATE console_records SET body=json_set(body,'$.duration_months',6) WHERE kind='packages' AND id='school-foundations'");
    const sub = await store.create("owner", "school-foundations", "2026-01-31");
    await store.tick("2026-07-30");
    expect(receipts()).toHaveLength(6);
    expect((await store.get(sub.id)).current_period_end).toBe("2026-07-31T00:00:00.000+00:00");
    await store.tick("2026-11-01");
    expect(receipts()).toHaveLength(9);
  });
  it("preserves existing subscriptions and invoice references when migrating the status constraint", () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0015").sort()) legacy.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
      legacy.exec("PRAGMA foreign_keys=ON");
      legacy.prepare("INSERT INTO customers(id,created_at,updated_at) VALUES ('legacy',?,?)").run(at, at);
      legacy.prepare("INSERT INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,created_at,updated_at) VALUES ('legacy-sub','legacy','school-step','active',5900,?,?,?)").run(at, at, at);
      for (const date of ["2026-01-31T12:34:56.000+00:00", "2024-01-31T12:34:56.000+00:00", "2026-05-31T12:34:56.000+00:00"]) legacy.prepare("INSERT INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,created_at,updated_at) VALUES (?,'legacy','school-step','active',5900,?,?,?)").run(date, date, date, date);
      legacy.prepare("INSERT INTO invoices(id,customer_id,subscription_id,amount_agorot,status,issued_at,created_at) VALUES ('invoice','legacy','legacy-sub',5900,'paid',?,?)").run(at, at);
      legacy.exec("BEGIN");
      legacy.exec(readFileSync(new FileURL("../migrations/0015_subscriptions.sql", import.meta.url), "utf8"));
      legacy.exec("COMMIT");
      expect(legacy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(legacy.prepare("SELECT subscription_id FROM invoices WHERE id='invoice'").get()?.subscription_id).toBe("legacy-sub");
      expect(legacy.prepare("SELECT monthly_minutes,current_period_start,current_period_end,pause_year_start FROM subscriptions WHERE id='legacy-sub'").get()).toMatchObject({ monthly_minutes: 60, current_period_start: at, current_period_end: addMonths(at, 1), pause_year_start: at });
      for (const date of ["2026-01-31T12:34:56.000+00:00", "2024-01-31T12:34:56.000+00:00", "2026-05-31T12:34:56.000+00:00"]) expect(legacy.prepare("SELECT current_period_end FROM subscriptions WHERE id=?").get(date)?.current_period_end).toBe(addMonths(date, 1));
      legacy.exec("UPDATE subscriptions SET status='paused' WHERE id='legacy-sub'");
      expect(legacy.prepare("SELECT price_agorot FROM subscriptions WHERE id='legacy-sub'").get()?.price_agorot).toBe(5900);
    } finally { legacy.close(); }
  });
});
