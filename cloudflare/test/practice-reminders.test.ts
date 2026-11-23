import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { SubscriptionStore } from "../src/subscriptions";
import { settings, sha256Hex, type Env } from "../src/env";
import { controlsFromSettings } from "../src/controls";
import { buildSetupPayload } from "../src/prompt";
import { TutorSession } from "../src/session";
import { practiceSummary, recordPractice } from "../src/practice";
import { dispatchPracticeReminders, parseReminderAnswer, reminderGuidance, reminderWeekdays, savePracticeReminder } from "../src/practice-reminders";

let sql: DatabaseSync, db: D1Database, env: Env;
const now = new Date("2026-06-14T17:04:00Z");
const lesson = { level: "beginner", topic: "everyday", conversation_mode: "guided", learning_load: "light", correction_policy: "after_answer", closing_activity: "roleplay", vocabulary: [], grammar: [] } as const;
beforeEach(async () => {
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
    async batch(statements: any[]) { const results = []; for (const statement of statements) results.push(await statement.all()); return results; },
  } as unknown as D1Database;
  env = { DB: db, REMINDERS_MODE: "dry_run", TLIVR_SYSTEM_API_KEY: "test" } as Env;
  await new BusinessStore(db).save("customers", { name: "Learner", phone: "0501111111" }, "learner");
  await new SubscriptionStore(db).create("learner", "school-step", "2026-06-01T00:00:00Z");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "OK", errorCode: 0 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); sql.close(); });
const events = () => sql.prepare("SELECT day,status,sent_at FROM practice_reminder_events").all();

describe("practice reminder preferences", () => {
  it.each([
    ["בשמונה בערב", "20:00"], ["7", "07:00"], ["בשעה 19:15", "19:15"], ["בתשע וחצי בבוקר", "09:30"], ["באחת עשרה בערב", "23:00"], ["בשתיים ורבע", "14:15"],
    ["בעשר בלילה", "22:00"], ["בשתיים בלילה", "02:00"], ["בשלוש אחרי הצהריים", "15:00"], ["באחת בצהריים", "13:00"], ["בשתים עשרה בצהריים", "12:00"],
    ["שמונה עשרה", "18:00"], ["תשע עשרה", "19:00"], ["עשרים ואחת", "21:00"], ["18:30", "18:30"],
    ["1", "13:00"], ["2", "14:00"], ["3", "15:00"], ["4", "16:00"], ["5", "17:00"], ["6", "18:00"], ["בשש בבוקר", "06:00"],
    ["בחמש לפנות בוקר", "05:00"], ["בחמש בבוקר", "05:00"], ["5 לפנות בוקר", "05:00"], ["בשתים עשרה לפנות בוקר", "00:00"],
    ["06:00", "06:00"], ["6:00", "06:00"], ["06", "06:00"], ["01:30", "01:30"], ["01", "01:00"],
  ])("parses %s", (answer, time) => expect(parseReminderAnswer(answer)).toEqual({ active: true, time_local: time }));
  it.each(["לא תודה", "לא", "בלי תזכורת", "לבטל את התזכורת"])("recognizes refusal: %s", answer => expect(parseReminderAnswer(answer)).toEqual({ active: false }));
  it.each(["", "כן", "מחר", "25:00", "7:90", "רבע לשמונה", "לא בשבע בשמונה"])("requires clarification: %s", answer => expect(parseReminderAnswer(answer)).toBeNull());
  it("defaults to package weekdays, never Saturday", () => {
    expect(reminderWeekdays(3)).toEqual([0, 2, 4]);
    expect(reminderWeekdays(5)).toEqual([0, 1, 2, 3, 4]);
    expect(reminderWeekdays(7)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("saves, changes and cancels without creating duplicate rows", async () => {
    expect(await savePracticeReminder(db, "learner", "בשמונה בערב", now)).toBe(true);
    expect(sql.prepare("SELECT * FROM practice_reminders").get()).toMatchObject({ customer_id: "learner", time_local: "20:00", weekdays: "[0,2,4]", active: 1, source: "lesson" });
    expect(await savePracticeReminder(db, "learner", "7", now)).toBe(true);
    expect(sql.prepare("SELECT time_local FROM practice_reminders").all()).toEqual([{ time_local: "07:00" }]);
    expect(await savePracticeReminder(db, "learner", "לא תודה", now)).toBe(true);
    expect(sql.prepare("SELECT active FROM practice_reminders").get()).toEqual({ active: 0 });
    expect(await savePracticeReminder(db, "learner", "כן", now)).toBe(false);
  });
  it("refreshes old package-default weekdays on upgrade and downgrade without changing the reminder time", async () => {
    await savePracticeReminder(db, "learner", "בשמונה בערב", now);
    sql.exec("UPDATE sales_receipts SET package_id='school-pace'; UPDATE subscriptions SET plan_id='school-pace'");
    expect((await practiceSummary(db, "learner", now)).reminder).toEqual({ time_local: "20:00", active: true, weekdays: [0, 1, 2, 3, 4, 5] });
    sql.exec("UPDATE sales_receipts SET package_id='school-step'; UPDATE subscriptions SET plan_id='school-step'");
    expect((await practiceSummary(db, "learner", now)).reminder?.weekdays).toEqual([0, 2, 4]);
  });
  it("preserves custom weekdays when a package changes", async () => {
    await savePracticeReminder(db, "learner", "בשמונה בערב", now);
    sql.exec("UPDATE practice_reminders SET weekdays='[1,3]'; UPDATE sales_receipts SET package_id='school-pace'");
    expect((await practiceSummary(db, "learner", now)).reminder?.weekdays).toEqual([1, 3]);
    expect(sql.prepare("SELECT weekdays FROM practice_reminders").get()).toEqual({ weekdays: "[1,3]" });
  });
  it("refreshes legacy lesson defaults without changing legacy custom schedules", async () => {
    await savePracticeReminder(db, "learner", "בשמונה בערב", now);
    sql.exec("DELETE FROM console_settings WHERE id='ivr:preferences:learner'; UPDATE sales_receipts SET package_id='school-pace'");
    expect((await practiceSummary(db, "learner", now)).reminder?.weekdays).toEqual([0, 1, 2, 3, 4, 5]);
    sql.exec("DELETE FROM console_settings WHERE id='ivr:preferences:learner'; UPDATE practice_reminders SET weekdays='[1,3]'");
    expect((await practiceSummary(db, "learner", now)).reminder?.weekdays).toEqual([1, 3]);
  });
  it("rejects anonymous, unpaid and translator-only customers", async () => {
    for (const id of ["anonymous-123", "missing", "translator"]) expect(await savePracticeReminder(db, id, "7", now)).toBe(false);
    expect(sql.prepare("SELECT * FROM practice_reminders").all()).toEqual([]);
  });
  it("advertises the tool only for an eligible identified lesson and suppresses offers when already active", () => {
    const controls = { ...controlsFromSettings(true), lesson: { ...lesson, vocabulary: [], grammar: [] } };
    for (const [customerId, enabled, expected] of [["learner", true, true], ["learner", false, false], ["anonymous-1", true, false], [undefined, true, false]] as const) {
      const declarations = buildSetupPayload(controls, "test", "teacher", settings(env), { customerId, practiceReminders: enabled }).setup.tools[0].functionDeclarations;
      expect(declarations.some(t => t.name === "save_practice_reminder")).toBe(expected);
    }
    expect(reminderGuidance(false)).toContain("רוצה תזכורת לתרגול הבא? באיזו שעה נוח?");
    expect(reminderGuidance(true)).toContain("Do not offer another one");
    expect(reminderGuidance(true)).toContain("only change or cancel it if the learner asks");
  });
  it("dispatches the tutor tool from heard speech, not invented model arguments", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(now);
    const session = new TutorSession({} as WebSocket, env, settings(env), "owner") as any;
    session.customerId = "learner";
    session.controls = { lesson };
    session.practiceReminders = true;
    expect(await session.recordTool({ name: "save_practice_reminder", args: { answer: "7" } })).toBe(false);
    session.reminderSpeech = "בשמונה בערב";
    expect(await session.recordTool({ name: "save_practice_reminder" })).toBe(true);
    expect(sql.prepare("SELECT time_local FROM practice_reminders").get()).toEqual({ time_local: "20:00" });
    expect(session.reminderSpeech).toBe("");
    session.practiceReminders = false;
    session.reminderSpeech = "7";
    expect(await session.recordTool({ name: "save_practice_reminder" })).toBe(false);
  });
  it("passes learner transcript answers through the existing live tool-result path", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(now);
    const session = new TutorSession({} as WebSocket, env, settings(env), "owner") as any;
    session.customerId = "learner";
    session.controls = { lesson };
    session.practiceReminders = true;
    const queue = [
      { type: "transcript", role: "learner", text: "at eight in the evening", rawText: "בשמונה בערב" },
      { type: "tool_call", calls: [{ name: "save_practice_reminder" }] },
      { type: "turn_complete" },
    ];
    session.ai = { addContext: vi.fn(), submitToolResult: vi.fn(), next: async () => {
      if (queue.length) return queue.shift();
      session.abort.abort();
      return { type: "closed" };
    } };
    await session.aiToOutput();
    expect(session.ai.submitToolResult).toHaveBeenCalledWith({ name: "save_practice_reminder" }, true, undefined);
    expect(sql.prepare("SELECT time_local FROM practice_reminders").get()).toEqual({ time_local: "20:00" });
  });
});

describe("scheduled practice pings", () => {
  beforeEach(async () => { await savePracticeReminder(db, "learner", "בשמונה בערב", now); });
  it.each(["typed", "legacy"])("excludes %s qa-test customers even when allowlisted", async storage => {
    env.REMINDERS_MODE = "live";
    env.REMINDERS_ALLOWLIST = "0501111111";
    if (storage === "typed") sql.exec("UPDATE customers SET source='qa-test' WHERE id='learner'");
    else sql.exec("UPDATE console_records SET body=json_set(body,'$.source','qa-test') WHERE kind='customers' AND id='learner'");
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["dry_run", "live"])("does not claim or send reminders for a top-up-only customer in %s", async mode => {
    sql.exec("UPDATE sales_receipts SET package_id='school-topup',subscription_id=NULL; DELETE FROM subscriptions");
    const business = new BusinessStore(db);
    expect(await business.hasPaidAccess("learner", now.toISOString())).toBe(true);
    expect(await business.activeSchoolPackage("learner", now.toISOString())).toBeNull();
    env.REMINDERS_MODE = mode as Env["REMINDERS_MODE"];
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("dispatches on a newly added practice weekday after the package changes", async () => {
    sql.exec("UPDATE sales_receipts SET package_id='school-pace'; UPDATE subscriptions SET plan_id='school-pace'");
    await dispatchPracticeReminders(env, new Date("2026-06-15T17:04:00Z"));
    expect(events()).toEqual([{ day: "2026-06-15", status: "dry_run", sent_at: null }]);
    expect(sql.prepare("SELECT weekdays FROM practice_reminders").get()).toEqual({ weekdays: "[0,1,2,3,4,5]" });
  });
  it("pings the last verified calling number once, including a linked phone without a primary", async () => {
    const business = new BusinessStore(db);
    const phone = "0502222222";
    await business.save("learner-phone-links", { customer_id: "learner", phone }, (await sha256Hex(phone)).slice(0, 24));
    expect(await business.identifyCall(phone, "linked-call", "teacher")).toBe("learner");
    sql.exec("UPDATE customers SET primary_phone=NULL WHERE id='learner'");
    env.REMINDERS_MODE = "live";
    await dispatchPracticeReminders(env, now);
    await dispatchPracticeReminders(env, now);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).phones).toEqual([phone]);
  });
  it("uses the most recent calling number and falls back when its verification is removed", async () => {
    const business = new BusinessStore(db);
    const phone = "0502222222";
    const linkId = (await sha256Hex(phone)).slice(0, 24);
    await business.save("learner-phone-links", { customer_id: "learner", phone }, linkId);
    await business.identifyCall(phone, "linked-first", "teacher");
    await business.identifyCall("0501111111", "primary-latest", "teacher");
    expect((await business.loadContext("preferences:learner")).last_verified_caller).toBe("0501111111");
    await business.identifyCall(phone, "linked-latest", "teacher");
    sql.prepare("DELETE FROM console_records WHERE kind='learner-phone-links' AND id=?").run(linkId);
    env.REMINDERS_MODE = "live";
    await dispatchPracticeReminders(env, now);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).phones).toEqual(["0501111111"]);
  });
  it("defaults off and does not claim events or call the provider", async () => {
    delete env.REMINDERS_MODE;
    await dispatchPracticeReminders(env, now);
    env.REMINDERS_MODE = "off";
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("selects a due Jerusalem time, dry-runs once and never calls Technoline", async () => {
    await dispatchPracticeReminders(env, now);
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([{ day: "2026-06-14", status: "dry_run", sent_at: null }]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["20:05", "19:54"])("does not select a future or stale slot: %s", async time => {
    sql.prepare("UPDATE practice_reminders SET time_local=?").run(time);
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
  });
  it("skips non-package weekdays, inactive reminders and Saturday even if configured", async () => {
    await dispatchPracticeReminders(env, new Date("2026-06-15T17:04:00Z"));
    sql.exec("UPDATE practice_reminders SET weekdays='[6]'");
    await dispatchPracticeReminders(env, new Date("2026-06-13T17:04:00Z"));
    sql.exec("UPDATE practice_reminders SET weekdays='[0]',active=0");
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
  });
  it("records skipped_practiced at the practice threshold without sending", async () => {
    env.REMINDERS_MODE = "live";
    await recordPractice(db, "learner", 120, now);
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([{ day: "2026-06-14", status: "skipped_practiced", sent_at: null }]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends a ring-only campaign below threshold, once despite concurrent cron runs", async () => {
    env.REMINDERS_MODE = "live";
    await recordPractice(db, "learner", 119, now);
    await Promise.all([dispatchPracticeReminders(env, now), dispatchPracticeReminders(env, now)]);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.tlivr.com/campaignApi.php");
    expect(JSON.parse(String(init?.body))).toMatchObject({ action: "campaignRun", phones: ["0501111111"], messagesType: "RH", callId: "0765673575", dialRetries: 0, externalID: expect.any(String) });
    expect(events()).toEqual([{ day: "2026-06-14", status: "sent", sent_at: now.toISOString() }]);
  });
  it("keeps the event ID deterministic but uses fresh external IDs on an explicit replay", async () => {
    env.REMINDERS_MODE = "live";
    vi.mocked(fetch).mockResolvedValue(Response.json({ status: "ERROR", errorCode: 54 }));
    await dispatchPracticeReminders(env, now);
    const first = sql.prepare("SELECT id,status FROM practice_reminder_events").get()!;
    await dispatchPracticeReminders(env, now);
    expect(fetch).toHaveBeenCalledOnce();
    expect(first.status).toBe("failed");
    sql.exec("DELETE FROM practice_reminder_events");
    vi.mocked(fetch).mockResolvedValue(Response.json({ status: "OK", errorCode: 0 }));
    await dispatchPracticeReminders(env, now);
    expect(sql.prepare("SELECT id,status FROM practice_reminder_events").get()).toEqual({ id: first.id, status: "sent" });
    const ids = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).externalID);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      expect(id).toMatch(new RegExp("^" + String(first.id).slice(0, 17) + "-[a-f0-9]{32}$"));
      expect(id.length).toBeLessThanOrEqual(50);
    }
    await dispatchPracticeReminders(env, now);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("normalizes the live allowlist and rejects all unlisted numbers", async () => {
    env.REMINDERS_MODE = "live";
    env.REMINDERS_ALLOWLIST = "0502222222";
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    env.REMINDERS_ALLOWLIST = "0502222222, +972501111111";
    await dispatchPracticeReminders(env, now);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("allows dry-run observation outside the live allowlist", async () => {
    env.REMINDERS_ALLOWLIST = "0502222222";
    await dispatchPracticeReminders(env, now);
    expect(events()[0]).toMatchObject({ status: "dry_run" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not send without live credentials or paid access", async () => {
    env.REMINDERS_MODE = "live";
    delete env.TLIVR_SYSTEM_API_KEY;
    await dispatchPracticeReminders(env, now);
    env.TLIVR_SYSTEM_API_KEY = "test";
    sql.exec("UPDATE sales_receipts SET expires_at='2026-06-01'; UPDATE subscriptions SET status='expired'");
    await dispatchPracticeReminders(env, now);
    expect(events()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["reject", "error"])("never retries an ambiguous or rejected send: %s", async failure => {
    env.REMINDERS_MODE = "live";
    if (failure === "reject") vi.mocked(fetch).mockRejectedValue(new Error("uncertain send"));
    else vi.mocked(fetch).mockResolvedValue(Response.json({ status: "ERROR", errorCode: 1 }));
    await dispatchPracticeReminders(env, now);
    await dispatchPracticeReminders(env, now);
    expect(events()[0]).toMatchObject({ status: "failed", sent_at: null });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses the due day's date when a ten-minute window crosses local midnight", async () => {
    sql.exec("UPDATE practice_reminders SET time_local='23:58'");
    await dispatchPracticeReminders(env, new Date("2026-06-14T21:02:00Z"));
    expect(events()).toEqual([{ day: "2026-06-14", status: "dry_run", sent_at: null }]);
  });
  it("uses Jerusalem winter time rather than a fixed UTC offset", async () => {
    sql.exec("UPDATE sales_receipts SET expires_at='2027-01-01'");
    await dispatchPracticeReminders(env, new Date("2026-11-22T18:04:00Z"));
    expect(events()).toEqual([{ day: "2026-11-22", status: "dry_run", sent_at: null }]);
  });
});
