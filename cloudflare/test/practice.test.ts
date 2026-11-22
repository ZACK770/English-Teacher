import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { practiceInternal, practiceSummary, recordPractice } from "../src/practice";
import { BusinessStore } from "../src/business";
import { SubscriptionStore } from "../src/subscriptions";
import { ProgressStore } from "../src/progress";

let sql: DatabaseSync, db: D1Database;
const now = new Date("2026-06-14T12:00:00Z"); // Sunday
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
  db = {
    prepare(query: string) {
      let args: any[] = [];
      const statement = {
        bind: (...values: any[]) => { args = values; return statement; },
        first: async () => sql.prepare(query).get(...args) ?? null,
        all: async () => ({ results: sql.prepare(query).all(...args), success: true }),
        run: async () => ({ success: true, meta: { changes: Number(sql.prepare(query).run(...args).changes) } }),
      };
      return statement;
    },
    async batch(statements: any[]) { const results = []; for (const s of statements) results.push(await s.all()); return results; },
  } as unknown as D1Database;
});
afterEach(() => sql.close());
const record = (day: string, seconds = 120) => recordPractice(db, "learner", seconds, new Date(day + "T12:00:00Z"));

describe("daily practice", () => {
  it("ignores newer top-up receipts when resolving subscription cadence and quota", async () => {
    const b = new BusinessStore(db);
    await b.save("customers", { name: "Learner", phone: "0501111111" }, "learner");
    await new SubscriptionStore(db).create("learner", "school-step", "2026-06-01T00:00:00Z");
    sql.prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES ('topup','learner','school-topup','school','topup',39,0,60,'2026-07-01','2026-06-14')").run();
    expect(await b.activeSchoolPackage("learner", now.toISOString())).toMatchObject({ id: "school-step", sessions_per_week: 3, monthly_minutes: 60 });
    sql.exec("DELETE FROM sales_receipts WHERE id<>'topup'");
    expect(await b.activeSchoolPackage("learner", now.toISOString())).toMatchObject({ id: "school-step", sessions_per_week: 3 });
    sql.exec("UPDATE subscriptions SET status='expired'");
    expect(await b.activeSchoolPackage("learner", now.toISOString())).toBeNull();
    expect((await practiceSummary(db, "learner", now)).package).toBeNull();
  });
  it.each([["school-step", 60], ["school-pace", 200], ["school-fluent", 300], ["school-foundations", 150], ["school-mastery", 150]])("grants the catalog quota for new %s purchases", async (id, minutes) => {
    const b = new BusinessStore(db);
    await b.save("customers", { name: "Learner", phone: "0501111111" }, "learner");
    await new SubscriptionStore(db).create("learner", String(id), "2026-06-01T00:00:00Z", id === "school-mastery" ? [{ domain: "everyday" }, { domain: "career" }] : undefined);
    expect(sql.prepare("SELECT monthly_minutes FROM subscriptions").get()).toEqual({ monthly_minutes: minutes });
    expect(sql.prepare("SELECT minutes FROM sales_receipts").get()).toEqual({ minutes });
    expect(sql.prepare("SELECT included_minutes FROM plans WHERE id=?").get(id)).toEqual({ included_minutes: minutes });
    const receipts = sql.prepare("SELECT * FROM sales_receipts").all();
    const subscriptions = sql.prepare("SELECT * FROM subscriptions").all();
    sql.exec(readFileSync(new FileURL("../migrations/0029_phone_sales_catalog.sql", import.meta.url), "utf8"));
    expect(sql.prepare("SELECT * FROM sales_receipts").all()).toEqual(receipts);
    expect(sql.prepare("SELECT * FROM subscriptions").all()).toEqual(subscriptions);
  });
  it("returns an empty, minutes-free summary", async () => {
    const summary = await practiceSummary(db, "learner", now);
    expect(summary).toEqual({ current_streak: 0, best_streak: 0, today: { day: "2026-06-14", practiced: false, seconds: 0 }, dates: [], week: { start: "2026-06-14", target: 0, done: 0 }, package: null, reminder: null });
    expect((await practiceInternal(db, "learner", now)).month).toEqual({ start: "2026-06-01", minutes_used: 0, minutes_quota: null });
  });
  it("accumulates sub-threshold calls and counts exactly 120 seconds", async () => {
    await record("2026-06-14", 119);
    expect((await practiceSummary(db, "learner", now)).today.practiced).toBe(false);
    await record("2026-06-14", 1);
    expect((await practiceSummary(db, "learner", now)).today.practiced).toBe(true);
    expect(sql.prepare("SELECT calls,seconds FROM practice_days").get()).toMatchObject({ calls: 2, seconds: 120 });
  });
  it("counts Saturday normally, carries yesterday's streak and resets after a gap", async () => {
    for (const day of ["2026-06-11", "2026-06-12", "2026-06-13"]) await record(day);
    expect(await practiceSummary(db, "learner", now)).toMatchObject({ current_streak: 3, best_streak: 3, week: { start: "2026-06-14", done: 0 } });
    await record("2026-06-14");
    expect((await practiceSummary(db, "learner", now)).current_streak).toBe(4);
    expect((await practiceSummary(db, "learner", new Date("2026-06-16T12:00:00Z"))).current_streak).toBe(0);
  });
  it("uses Jerusalem calendar dates across midnight and limits dates, not best streak", async () => {
    await recordPractice(db, "learner", 120, new Date("2026-06-13T22:00:00Z"));
    await record("2025-01-01");
    expect((await practiceSummary(db, "learner", now)).dates).toEqual(["2026-06-14"]);
  });
  it("resolves cadence and internal monthly quota from the paying school package", async () => {
    const b = new BusinessStore(db);
    await b.save("customers", { name: "Learner", phone: "0501111111" }, "learner");
    await new SubscriptionStore(db).create("learner", "school-step", "2026-06-01T00:00:00Z");
    await record("2026-06-14");
    const internal = await practiceInternal(db, "learner", now);
    expect(internal.package).toEqual({ id: "school-step", name: "סטארט", sessions_per_week: 3 });
    expect(internal.week).toEqual({ start: "2026-06-14", done: 1, target: 3 });
    expect(internal.month).toEqual({ start: "2026-06-01", minutes_used: 2, minutes_quota: 60 });
    expect(await practiceSummary(db, "learner", now)).not.toHaveProperty("month");
  });
  it("skips anonymous customers and rejects invalid input without writing rows", async () => {
    await recordPractice(db, "anonymous-123", 120, now);
    for (const seconds of [-1, Infinity, NaN]) await expect(recordPractice(db, "learner", seconds, now)).rejects.toThrow("Invalid practice");
    await expect(recordPractice(db, "learner", 120, new Date("invalid"))).rejects.toThrow("Invalid practice");
    expect(sql.prepare("SELECT COUNT(*) AS n FROM practice_days").get()).toMatchObject({ n: 0 });
  });
  it("records school sessions once, excludes translators and attributes only recent sent reminders", async () => {
    sql.exec("INSERT INTO bots(id,label,role,created_at,updated_at) VALUES ('practice-teacher','Teacher','teacher','2026','2026'),('practice-translator','Translator','translator','2026','2026')");
    const started = new Date(Date.now() - 180000);
    for (const [id, hours, status] of [["recent", 2, "sent"], ["old", 4, "sent"], ["failed", 1, "failed"], ["future", -1, "sent"]] as const) {
      const sent = new Date(started.getTime() - hours * 3600000).toISOString();
      sql.prepare("INSERT INTO practice_reminder_events(id,customer_id,day,scheduled_for,sent_at,status) VALUES (?,'learner','2026-06-14',?,?,?)").run(id, sent, sent, status);
    }
    const progress = new ProgressStore(db);
    const session = { student_id: "learner", call_id: "lesson", started_at: started, learner_turns: 1, tutor_turns: 1, observations: [], transcript: null, summary: { summary_he: "", success_he: "", next_step_he: "", points: 0 }, usage: { input_text_tokens: 0, input_audio_tokens: 0, output_text_tokens: 0, output_audio_tokens: 0, thoughts_tokens: 0, estimated_cost_usd: 0, cost_basis: "test" }, model: "test" };
    for (const [call, bot, customer] of [["lesson", "practice-teacher", "learner"], ["translated", "practice-translator", "learner"], ["anon", "practice-teacher", "anonymous-1"]]) {
      sql.prepare("INSERT INTO call_customers(call_id,customer_id,bot_id,channel,created_at) VALUES (?,?,?,'web',?)").run(call, customer, bot, started.toISOString());
      await progress.saveSession({ ...session, call_id: call, student_id: customer });
    }
    await progress.saveSession(session);
    expect(sql.prepare("SELECT customer_id,calls FROM practice_days").all()).toEqual([{ customer_id: "learner", calls: 1 }]);
    expect(sql.prepare("SELECT id,responded_call_id FROM practice_reminder_events WHERE responded_at IS NOT NULL").all()).toEqual([{ id: "recent", responded_call_id: "lesson" }]);
  });
});
