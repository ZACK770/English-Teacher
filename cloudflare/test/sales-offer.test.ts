import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { dispatchCallbacks, submitCallback } from "../src/callbacks";
import { type Env, settings } from "../src/env";
import { controlsFromSettings } from "../src/controls";
import { ProgressStore } from "../src/progress";
import { TutorSession } from "../src/session";
import { PaymentStore } from "../src/payments";
import { SubscriptionStore } from "../src/subscriptions";
import { handleCallback } from "../src/pbx";
import { customerBought, enterSalesOffer, offerGift, offerSchedule, queueTestSalesOffer, salesOfferAllowed, salesOfferResponse, selectSalesOffers, SALES_OFFER_TEXT, SALES_OFFER_RECORDING } from "../src/sales-offer";

let sql: DatabaseSync, b: BusinessStore, env: Env;
const now = new Date("2026-06-15T14:00:00Z");
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(now);
  sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const stmt = {
        bind(...values: any[]) { args = values; return stmt; },
        first: async () => sql.prepare(query).get(...args) ?? null,
        all: async () => ({ results: sql.prepare(query).all(...args), success: true }),
        run: async () => ({ success: true, meta: { changes: Number(sql.prepare(query).run(...args).changes) } }),
      };
      return stmt;
    },
    async batch(statements: any[]) { return Promise.all(statements.map(s => s.all())); },
  } as unknown as D1Database;
  env = { DB: db, SALES_OFFER_MODE: "on", TLIVR_SYSTEM_API_KEY: "test", TLIVR_CALLBACK_EXTENSION_ID: "123" } as Env;
  b = new BusinessStore(db);
  await b.save("customers", { name: "Learner", phone: "0501111111" }, "learner");
  await b.save("ivr-events", { customer_id: "learner", route: "sales" }, "event");
  sql.prepare("UPDATE console_records SET created_at=? WHERE id='event'").run("2026-06-14T12:00:00Z");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "OK", errorCode: 0 })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); sql.close(); });
const offerId = "sales-offer:learner";
async function answered() {
  await selectSalesOffers(env);
  sql.prepare("UPDATE callback_requests SET status='dialed',updated_at=?").run(now.toISOString());
  await enterSalesOffer(b, env, "call", "learner");
}

async function tutorCalls(customerId = "learner", count = 3, seconds = 200, role = "teacher") {
  sql.prepare("INSERT OR IGNORE INTO bots(id,label,role,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(role, role, role, now.toISOString(), now.toISOString());
  for (let i = 0; i < count; i++) {
    const callId = customerId + "-" + role + "-" + i;
    sql.prepare("INSERT INTO call_customers VALUES (?,?,?,?,?)").run(callId, customerId, role, "phone", now.toISOString());
    sql.prepare(`INSERT INTO sessions(student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,observations_json)
      VALUES (?,?,?,?,?,1,1,'[]')`).run(customerId, callId, "2026-01-01T12:00:00Z", "2026-01-01T12:05:00Z", seconds);
  }
}

function freeUsage(product: string, billed: number | null, reserved = billed ?? 300, date = now.toISOString()) {
  const id = "free-" + sql.prepare("SELECT COUNT(*) AS n FROM usage_allocations").get()!.n;
  sql.prepare("INSERT INTO usage_allocations(call_id,customer_id,product,reserved_seconds,billed_seconds,created_at) VALUES (?,'learner',?,?,?,?)")
    .run(id, product, reserved, billed, date);
}

describe("rolling sales offers", () => {
  function phoneCalls(customerId: string, count: number, lastAt: string) {
    const insert = sql.prepare("INSERT INTO call_customers VALUES (?,?,?,?,?)");
    for (let i = 0; i < count; i++) {
      insert.run(customerId + "-" + i, customerId, "ivr", "phone", lastAt);
    }
  }

  beforeEach(() => {
    env.SALES_OFFER_AUDIENCE = "rolling";
    env.SALES_OFFER_ROLLING_START_AT = now.toISOString();
  });

  it("uses a gated backlog start and deduplicates repeated selection", async () => {
    phoneCalls("learner", 4, "2026-06-12T12:00:00Z");
    env.SALES_OFFER_MODE = "allowlist";
    env.SALES_OFFER_ALLOWLIST = "0501111111";
    await selectSalesOffers(env);
    env.SALES_OFFER_MODE = "on";
    await selectSalesOffers(env, new Date(+now - 1));
    expect(sql.prepare("SELECT id FROM callback_requests").all()).toEqual([]);
    await selectSalesOffers(env);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT id,next_attempt_at FROM callback_requests").all())
      .toEqual([{ id: offerId, next_attempt_at: now.toISOString() }]);
  });

  it("counts physical calls, not shared streaming segments, and honors the quota alternative", async () => {
    phoneCalls("learner", 1, "2026-06-14T06:00:00Z");
    for (const suffix of ["1", "2", "3"]) {
      sql.prepare("INSERT INTO call_customers VALUES (?,?,?,?,?)")
        .run("learner-0~" + suffix, "learner", "teacher", "phone", "2026-06-14T06:05:00Z");
    }
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).toBeNull();
    await b.save("policies", { enabled: true, trial_total_seconds: 60 }, "trial");
    freeUsage("school", 60);
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).toMatchObject({ rolling: true });
  });

  it("uses the last call plus 24 hours and moves a closed slot into calling hours", async () => {
    phoneCalls("learner", 4, "2026-06-15T20:00:00Z");
    vi.setSystemTime(new Date("2026-06-16T20:00:00Z"));
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).toBeNull();
    vi.setSystemTime(new Date("2026-06-17T05:00:00Z"));
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT next_attempt_at FROM callback_requests").get())
      .toMatchObject({ next_attempt_at: "2026-06-17T05:00:00.000Z" });
  });

  it("rechecks the last call before sending and does not retry an uncertain send", async () => {
    phoneCalls("learner", 4, "2026-06-14T06:00:00Z");
    await selectSalesOffers(env);
    sql.prepare("INSERT INTO call_customers VALUES (?,?,?,?,?)")
      .run("new", "learner", "ivr", "phone", now.toISOString());
    expect(await dispatchCallbacks(env)).toMatchObject({ sent: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(sql.prepare("SELECT next_attempt_at FROM callback_requests").get())
      .toMatchObject({ next_attempt_at: "2026-06-16T14:00:00.000Z" });
    vi.setSystemTime(new Date("2026-06-16T14:00:00Z"));
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timeout"));
    await dispatchCallbacks(env);
    await dispatchCallbacks(env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ dialRetries: 0 });
    expect(sql.prepare("SELECT status,attempts,next_attempt_at FROM callback_requests").get())
      .toMatchObject({ status: "failed", attempts: 1, next_attempt_at: null });
  });

  it("excludes QA and configured test recipients", async () => {
    phoneCalls("learner", 4, "2026-06-14T06:00:00Z");
    env.SALES_OFFER_TEST_PHONES = "0501111111";
    await selectSalesOffers(env);
    env.SALES_OFFER_TEST_PHONES = "";
    sql.exec("UPDATE customers SET source='qa-test' WHERE id='learner'");
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).toBeNull();
  });
});

describe("quota-exhausted sales offer audience", () => {
  beforeEach(() => {
    env.SALES_OFFER_AUDIENCE = "quota_exhausted";
    sql.prepare("DELETE FROM console_records WHERE kind IN ('ivr-events','policies')").run();
  });
  it("matches accessSummary for the default opening and monthly free calls, without sales entry", async () => {
    freeUsage("school-opening", 420);
    freeUsage("school", 20);
    expect(await b.accessSummary("learner", [])).toMatchObject({ opening_minutes: 0, free_calls_left: 1 });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    freeUsage("school", 30);
    expect(await b.accessSummary("learner", [])).toMatchObject({ opening_minutes: 0, free_calls_left: 0, limited: true });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT next_attempt_at FROM callback_requests").get()).toMatchObject({ next_attempt_at: "2026-06-16T14:00:00.000Z" });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
  });
  it("counts lifetime trial seconds, including reserved seconds, but never paid or gift allocations", async () => {
    await b.save("policies", { enabled: true, trial_total_seconds: 420, opening_seconds: 240, free_calls_month: 10 }, "trial");
    freeUsage("school-opening", 239, 240, "2026-05-01T12:00:00Z");
    freeUsage("school", 180);
    freeUsage("school-offer-gift", 240);
    sql.prepare("INSERT INTO usage_allocations VALUES ('paid','learner','school','receipt',600,600,?)").run(now.toISOString());
    await selectSalesOffers(env);
    expect(await b.accessSummary("learner", [])).toMatchObject({ free_calls_left: 1 });
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    freeUsage("school", null, 1);
    expect(await b.accessSummary("learner", [])).toMatchObject({ free_calls_left: 0, opening_minutes: 0 });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
  });
  it("retains opening retries for short calls and monthly free-call resets", async () => {
    await b.save("policies", { enabled: true, opening_seconds: 240, free_calls_month: 1 }, "trial");
    freeUsage("school-opening", 59);
    freeUsage("school", 300);
    await selectSalesOffers(env);
    expect(await b.accessSummary("learner", [])).toMatchObject({ opening_minutes: 4, free_calls_left: 0 });
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    freeUsage("school-opening", 60);
    sql.prepare("UPDATE usage_allocations SET created_at='2026-05-01T12:00:00Z' WHERE product='school'").run();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    freeUsage("school", 0);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    freeUsage("school", null, 300);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
  });
  it("does not treat an unlimited policy or a caller with no usage as quota exhaustion", async () => {
    await selectSalesOffers(env);
    await b.save("policies", { enabled: false, opening_seconds: 0, free_calls_month: 0 }, "disabled");
    freeUsage("school-opening", 420);
    freeUsage("school", 300);
    freeUsage("school", 300);
    expect(await b.accessSummary("learner", [])).toMatchObject({ limited: false });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("retains the mode gate, buyer exclusions and dial-time recheck", async () => {
    freeUsage("school-opening", 420);
    freeUsage("school", 300);
    freeUsage("school", 300);
    env.SALES_OFFER_MODE = "off";
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    env.SALES_OFFER_MODE = "on";
    await selectSalesOffers(env);
    await new SubscriptionStore(b.db).create("learner", "school-step", now.toISOString());
    vi.setSystemTime(new Date("2026-06-16T14:00:00Z"));
    await dispatchCallbacks(env);
    expect(sql.prepare("SELECT status FROM callback_requests").get()).toMatchObject({ status: "failed" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("high-interest sales offer audience", () => {
  beforeEach(() => {
    env.SALES_OFFER_AUDIENCE = "high_interest";
    sql.prepare("DELETE FROM console_records WHERE kind='ivr-events'").run();
  });
  it("selects historic teacher sessions without sales entry and queues tomorrow at 17:00 only once", async () => {
    await tutorCalls();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT next_attempt_at FROM callback_requests").get()).toMatchObject({ next_attempt_at: "2026-06-16T14:00:00.000Z" });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
    vi.setSystemTime(new Date(+now + 86400000));
    await selectSalesOffers(env, new Date());
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
  });
  it("requires both configured call and minute thresholds and ignores non-teacher sessions", async () => {
    await tutorCalls("learner", 2, 200);
    await tutorCalls("learner", 5, 600, "translator");
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    env.SALES_OFFER_MIN_TUTOR_CALLS = "2";
    env.SALES_OFFER_MIN_TUTOR_MINUTES = "10";
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    env.SALES_OFFER_MIN_TUTOR_MINUTES = "5";
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
  });
  it.each(["off", "allowlist"])("retains the %s gate for high-interest selection", async mode => {
    await tutorCalls();
    env.SALES_OFFER_MODE = mode as Env["SALES_OFFER_MODE"];
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("excludes hidden phones and empty activity and fails closed on malformed thresholds", async () => {
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    await tutorCalls();
    env.SALES_OFFER_MIN_TUTOR_CALLS = "invalid";
    await selectSalesOffers(env);
    env.SALES_OFFER_MIN_TUTOR_CALLS = "3";
    env.SALES_OFFER_MIN_TUTOR_MINUTES = "-1";
    await selectSalesOffers(env);
    env.SALES_OFFER_MIN_TUTOR_MINUTES = "0";
    sql.prepare("UPDATE customer_phones SET phone='private'").run();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("excludes usable receipts, but not reversed receipts, and checks purchases again before dial", async () => {
    await tutorCalls();
    sql.prepare(`INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at)
      VALUES ('r','learner','school-step','school','r',59,0,30,'2026-07-01T00:00:00Z',?)`).run(now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    sql.prepare("UPDATE sales_receipts SET payment_reversed_at=?").run(now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
    sql.prepare("INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES ('paid','purchase','learner','school-step','{}',5900,0,'paid',?,?)").run(now.toISOString(), now.toISOString());
    vi.setSystemTime(new Date("2026-06-16T14:00:00Z"));
    await dispatchCallbacks(env);
    expect(sql.prepare("SELECT status,last_error FROM callback_requests").get()).toMatchObject({ status: "failed", last_error: "Sales offer customer already purchased" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("excludes family members of an active subscription", async () => {
    await tutorCalls();
    await b.save("customers", { name: "Owner", phone: "0502222222" }, "owner");
    const sub = await new SubscriptionStore(b.db).create("owner", "school-step", now.toISOString());
    sql.prepare("INSERT INTO subscription_members(subscription_id,customer_id,added_at) VALUES (?,?,?)").run(sub.id, "learner", now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("caps each scheduled run at 100 and advances past previously offered customers", async () => {
    for (let i = 0; i < 101; i++) {
      const id = "audience-" + String(i).padStart(3, "0");
      await b.save("customers", { name: "Test", phone: "050" + String(i).padStart(7, "0") }, id);
      await tutorCalls(id);
    }
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(100);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(101);
  });
});

describe("cron-configured test offers", () => {
  beforeEach(() => {
    env.SALES_OFFER_AUDIENCE = "high_interest";
    env.SALES_OFFER_MIN_TUTOR_CALLS = "1000000";
    env.SALES_OFFER_TEST_PHONES = "0501111111";
    env.SALES_OFFER_TEST_AT = "2026-06-16T09:00:00+03:00";
  });
  it("queues the specified time without an audience match and deduplicates repeated crons and phone formats", async () => {
    env.SALES_OFFER_TEST_PHONES = "0501111111,+972501111111,0501111111";
    await selectSalesOffers(env);
    vi.setSystemTime(new Date(+now + 600000));
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT next_attempt_at,status,source FROM callback_requests").all()).toEqual([{
      next_attempt_at: "2026-06-16T06:00:00.000Z", status: "queued", source: "sales_offer",
    }]);
    expect(sql.prepare("SELECT id FROM console_records WHERE kind='sales-offers'").all()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["", "invalid", "2026-06-16T09:00:00", "2026-06-15T14:00:00Z", "2026-06-15T13:59:00Z", "2026-06-19T15:00:00+03:00"])("ignores empty, non-ISO, due, past or closed test times: %s", async at => {
    env.SALES_OFFER_TEST_AT = at;
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("does not queue while off, without test phones, or outside the allowlist", async () => {
    env.SALES_OFFER_MODE = "off";
    await selectSalesOffers(env);
    env.SALES_OFFER_MODE = "allowlist";
    env.SALES_OFFER_ALLOWLIST = "0502222222";
    await selectSalesOffers(env);
    env.SALES_OFFER_ALLOWLIST = "0501111111";
    env.SALES_OFFER_TEST_PHONES = "";
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("queues each configured phone in on mode and isolates missing customers", async () => {
    await b.save("customers", { name: "Other", phone: "0502222222" }, "other");
    env.SALES_OFFER_MODE = "on";
    env.SALES_OFFER_TEST_PHONES = "invalid,0509999999,0501111111,0502222222";
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(2);
  });
  it("keeps ordinary audience selection independent of an invalid test time", async () => {
    env.SALES_OFFER_AUDIENCE = "dropoffs";
    env.SALES_OFFER_TEST_AT = "invalid";
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT next_attempt_at FROM callback_requests").all()).toEqual([{ next_attempt_at: "2026-06-15T14:00:00.000Z" }]);
  });
});

describe("explicitly gated test offers", () => {
  beforeEach(() => { env.SALES_OFFER_TEST_PHONES = "+972501111111"; });
  it("can repeat for an existing subscriber at distinct times, with one gift per offer", async () => {
    await new SubscriptionStore(b.db).create("learner", "school-step", now.toISOString());
    const id = await queueTestSalesOffer(env, "0501111111", now);
    expect(await queueTestSalesOffer(env, "+972501111111", now)).toBe(id);
    await dispatchCallbacks(env);
    await enterSalesOffer(b, env, "test-call", "learner");
    expect(await b.loadContext("test-call")).toMatchObject({ offer_call: id });
    expect(await offerGift(b, env, id!, "learner", "gift")).toBe(240);
    expect(await offerGift(b, env, id!, "learner", "gift-again")).toBe(0);
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "test-call" }, "learner")).toMatchObject({ name: "isaacOffer" });
    await b.settleCall("gift", 240);
    const later = new Date(+now + 600000);
    const repeat = await queueTestSalesOffer(env, "0501111111", later);
    expect(repeat).not.toBe(id);
    vi.setSystemTime(later);
    await dispatchCallbacks(env);
    await enterSalesOffer(b, env, "repeat-call", "learner");
    expect(await b.loadContext("repeat-call")).toMatchObject({ offer_call: repeat });
    expect(await offerGift(b, env, repeat!, "learner", "second-gift")).toBe(240);
  });
  it("reserves a test gift instead of consuming subscriber minutes in TutorSession", async () => {
    await new SubscriptionStore(b.db).create("learner", "school-step", now.toISOString());
    const id = await queueTestSalesOffer(env, "0501111111", now);
    await dispatchCallbacks(env);
    await enterSalesOffer(b, env, "test-session", "learner");
    await new ProgressStore(b.db).createBot({
      id: "teacher", label: "Teacher", role: "teacher", description: "", audience: "general",
      channel_id: "teacher-channel", enabled: true, phone_enabled: true, web_enabled: true,
    }, controlsFromSettings(false));
    const reserve = vi.spyOn(BusinessStore.prototype, "reserveCall");
    const tutor = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "test-owner") as any;
    tutor.latency = vi.fn(async (event: string) => {
      if (event === "access_checked") { tutor.meteredAt = Date.now(); tutor.stop("test_complete"); }
    });
    await tutor.run(JSON.stringify({ type: "start", token: "teacher-channel", callId: "test-session", caller: "0501111111", format: "pcm16;rate=8000;ch=1" }), "teacher", false);
    expect(reserve).not.toHaveBeenCalled();
    expect(sql.prepare("SELECT product,receipt_id,reserved_seconds FROM usage_allocations WHERE call_id='test-session'").get())
      .toMatchObject({ product: "school-offer-gift", receipt_id: id, reserved_seconds: 240 });
  });
  it("lets scheduled selection bypass buyers and old offers only for test phones", async () => {
    await answered();
    await new SubscriptionStore(b.db).create("learner", "school-step", now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
    sql.prepare("UPDATE console_records SET created_at=? WHERE id='event'").run(now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(2);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(2);
  });
  it.each(["off", "allowlist"])("never bypasses mode %s without phone authorization", async mode => {
    env.SALES_OFFER_MODE = mode as Env["SALES_OFFER_MODE"];
    await expect(queueTestSalesOffer(env, "0501111111", now)).rejects.toMatchObject({ status: 403 });
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("does not authorize other phones or missing customers and rejects invalid/past/closed times", async () => {
    await expect(queueTestSalesOffer(env, "0502222222", now)).rejects.toMatchObject({ status: 403 });
    for (const at of [new Date("invalid"), new Date(+now - 1), new Date("2026-06-15T23:00:00Z")]) {
      await expect(queueTestSalesOffer(env, "0501111111", at)).rejects.toMatchObject({ status: 422 });
    }
    env.SALES_OFFER_TEST_PHONES += ",0502222222";
    await expect(queueTestSalesOffer(env, "0502222222", now)).rejects.toMatchObject({ status: 404 });
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("rechecks removal from the test list at dial, menu and gift time", async () => {
    await new SubscriptionStore(b.db).create("learner", "school-step", now.toISOString());
    const id = await queueTestSalesOffer(env, "0501111111", now);
    env.SALES_OFFER_TEST_PHONES = "";
    await dispatchCallbacks(env);
    expect(fetch).not.toHaveBeenCalled();
    expect(sql.prepare("SELECT status FROM callback_requests").get()).toMatchObject({ status: "failed" });
    await b.saveContext("test-call", { offer_call: id });
    const offer = await b.record("sales-offers", id!);
    await b.save("sales-offers", { ...offer, status: "answered", call_id: "test-call" }, id!);
    expect(await offerGift(b, env, id!, "learner", "gift")).toBe(0);
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "test-call" }, "learner")).toBeNull();
  });
  it("does not extend the subscriber override to a different phone", async () => {
    await b.save("customers", { name: "Other", phone: "0502222222" }, "other");
    await new SubscriptionStore(b.db).create("other", "school-step", now.toISOString());
    await b.save("ivr-events", { customer_id: "other", route: "sales" }, "other-event");
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT phone FROM callback_requests").all()).toEqual([{ phone: "0501111111" }]);
  });
});

describe("sales offers", () => {
  it.each(["typed", "legacy"])("excludes %s QA sources from selection and already queued callbacks", async storage => {
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).not.toBeNull();
    sql.exec("UPDATE callback_requests SET next_attempt_at='2026-06-15T13:00:00Z'");
    if (storage === "typed") sql.exec("UPDATE customers SET source='qa-test' WHERE id='learner'");
    else sql.exec("UPDATE console_records SET body=json_set(body,'$.source','qa-test') WHERE kind='customers' AND id='learner'");
    expect(await dispatchCallbacks(env)).toMatchObject({ sent: 0 });
    expect(fetch).not.toHaveBeenCalled();
    sql.exec("DELETE FROM callback_requests; DELETE FROM console_records WHERE kind='sales-offers'");
    env.SALES_OFFER_TEST_PHONES = "0501111111";
    env.SALES_OFFER_ALLOWLIST = "0501111111";
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).toBeNull();
    expect(await queueTestSalesOffer(env, "0501111111", new Date(+now + 60000))).toBeNull();
  });
  it("uses the exact twenty-shekel menu without moving renewal disclosure into the menu", () => {
    expect(SALES_OFFER_TEXT).toBe("רוצים לדעת אנגלית?! בלאק פריידיי בספיקול! הטבת חודש ראשון - מוגבלת למאה רוכשים בלבד! מצטרפים עכשיו למנוי החודשי סטארטר, ומשלמים רק עשרים שקלים. כן, עשרים שקלים ואתם על הדרך לדבר אנגלית שוטף! מעוניינים?! הקישו כעת 1.");
  });
  it("bundles the offer recording in the same telephone WAV format as the other prompts", () => {
    const audio = readFileSync(new FileURL("../../public/brand/phone/" + SALES_OFFER_RECORDING, import.meta.url));
    expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
    expect(audio.toString("ascii", 8, 12)).toBe("WAVE");
    expect(audio.readUInt16LE(20)).toBe(1);
    expect(audio.readUInt16LE(22)).toBe(1);
    expect(audio.readUInt32LE(24)).toBe(8000);
    expect(audio.readUInt16LE(34)).toBe(16);
  });
  it("plays the available recorded offer with a content-versioned Technoline cache name", async () => {
    await answered();
    env.PUBLIC_BASE_URL = "https://example.test/";
    const assets = vi.fn(async () => new Response(null, { headers: { "Content-Type": "audio/wav" } }));
    env.ASSETS = { fetch: assets } as unknown as Fetcher;
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call" }, "learner")).toMatchObject({
      name: "isaacOffer", enabledKeys: "1", files: [{
        fileLink: "https://example.test/brand/phone/" + SALES_OFFER_RECORDING,
        fileName: SALES_OFFER_RECORDING.replace(/\.wav$/, ""),
      }],
    });
    expect(assets.mock.calls).toHaveLength(1);
    const request = (assets.mock.calls[0] as unknown as [Request])[0];
    expect(request.method).toBe("HEAD");
    expect(request.url).toBe("https://example.test/brand/phone/" + SALES_OFFER_RECORDING);
    await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "0" }, "learner");
    expect(assets).toHaveBeenCalledTimes(1);
  });
  it.each(["no-url", "no-binding", "missing-file", "html-fallback", "fetch-error", "invalid-url"])("retains offer TTS when the recording is unavailable: %s", async reason => {
    await answered();
    env.PUBLIC_BASE_URL = reason === "no-url" ? "" : reason === "invalid-url" ? "not a URL" : "https://example.test";
    const assets = vi.fn(async () => {
      if (reason === "fetch-error") throw new Error("Unavailable");
      return new Response(null, {
        status: reason === "missing-file" ? 404 : 200,
        headers: { "Content-Type": reason === "html-fallback" ? "text/html" : "audio/wav" },
      });
    });
    if (reason !== "no-binding") env.ASSETS = { fetch: assets } as unknown as Fetcher;
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call" }, "learner"))
      .toMatchObject({ name: "isaacOffer", files: [{ text: SALES_OFFER_TEXT }] });
  });
  it("fails closed and normalizes the allowlist", async () => {
    env.SALES_OFFER_MODE = "off";
    expect(salesOfferAllowed(env, "0501111111")).toBe(false);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    env.SALES_OFFER_MODE = "allowlist";
    env.SALES_OFFER_ALLOWLIST = " +972501111111,0502222222 ";
    expect(salesOfferAllowed(env, "0501111111")).toBe(true);
    expect(salesOfferAllowed(env, "0503333333")).toBe(false);
    expect(salesOfferAllowed({ ...env, SALES_OFFER_MODE: "on" }, "private")).toBe(false);
  });
  it("rejects the reserved source on public callback submissions", async () => {
    await expect(submitCallback(new Request("https://example.test", { method: "POST", body: JSON.stringify({
      name: "Learner", phone: "0501111111", for_whom: "self", timing: "now", consent: true, source: "sales_offer",
    }) }), env)).rejects.toMatchObject({ status: 422 });
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("queues once for the next local day at 17:00, expiring on that call day", async () => {
    await selectSalesOffers(env);
    vi.setSystemTime(new Date(+now + 600000));
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
    expect(sql.prepare("SELECT source,status,next_attempt_at FROM callback_requests").get()).toMatchObject({ source: "sales_offer", status: "queued", next_attempt_at: "2026-06-15T14:00:00.000Z" });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ expires_at: "2026-06-15T20:59:59.000Z" });
    expect(offerSchedule(new Date("2026-06-18T12:00:00Z")).at).toBe("2026-06-20T17:00:00.000Z");
  });
  it("does not deduplicate a website callback against an automated offer, but still deduplicates website requests", async () => {
    await selectSalesOffers(env);
    env.SALES_OFFER_MODE = "off";
    const submit = () => submitCallback(new Request("https://example.test", { method: "POST", body: JSON.stringify({
      name: "Learner", phone: "0501111111", for_whom: "self", timing: "scheduled", consent: true, source: "landing",
    }) }), env);
    const first = await submit();
    expect(first.status).toBe(201);
    const result = await first.json() as { id: string };
    expect(result.id).not.toBe(offerId);
    expect(await (await submit()).json()).toMatchObject({ id: result.id, duplicate: true });
    expect(sql.prepare("SELECT source FROM callback_requests ORDER BY source").all()).toEqual([{ source: "landing" }, { source: "sales_offer" }]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("has no candidates for empty history or hidden phones", async () => {
    sql.prepare("DELETE FROM console_records WHERE kind='ivr-events'").run();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("excludes buyers and rechecks them before dialing", async () => {
    await selectSalesOffers(env);
    await b.db.prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES ('receipt','learner','school-step','school','ref',59,0,30,?,?)").bind("2026-07-15T00:00:00Z", now.toISOString()).run();
    expect(await customerBought(b, "learner")).toBe(true);
    await dispatchCallbacks(env);
    expect(sql.prepare("SELECT status,last_error FROM callback_requests").get()).toMatchObject({ status: "failed", last_error: "Sales offer customer already purchased" });
    expect(fetch).not.toHaveBeenCalled();
    sql.prepare("DELETE FROM callback_requests").run();
    sql.prepare("DELETE FROM console_records WHERE kind='sales-offers'").run();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("rechecks the gate before dialing", async () => {
    await selectSalesOffers(env);
    env.SALES_OFFER_MODE = "off";
    await dispatchCallbacks(env);
    expect(sql.prepare("SELECT status,last_error FROM callback_requests").get()).toMatchObject({ status: "failed", last_error: "Sales offer gate disabled for phone" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("excludes active subscribers and paid orders even without remaining minutes", async () => {
    await new SubscriptionStore(b.db).create("learner", "school-step", "2026-06-01T00:00:00Z");
    expect(await customerBought(b, "learner")).toBe(true);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    sql.prepare("UPDATE subscriptions SET status='cancelled'").run();
    sql.prepare("UPDATE sales_receipts SET expires_at='2020-01-01T00:00:00Z'").run();
    sql.prepare("INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES ('paid','purchase','learner','school-step','{}',5900,0,'paid',?,?)").run(now.toISOString(), now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("binds an answered offer to its call, with a single accounted gift", async () => {
    await answered();
    expect(await b.loadContext("call")).toMatchObject({ offer_call: offerId });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ status: "answered", call_id: "call" });
    expect(await offerGift(b, env, offerId, "learner", "segment")).toBe(240);
    expect(await offerGift(b, env, offerId, "learner", "another")).toBe(0);
    expect(sql.prepare("SELECT product,reserved_seconds FROM usage_allocations").get()).toMatchObject({ product: "school-offer-gift", reserved_seconds: 240 });
  });
  it("does not claim stale outbound calls", async () => {
    await selectSalesOffers(env);
    sql.prepare("UPDATE callback_requests SET status='dialed',updated_at=?").run("2026-06-15T10:59:00Z");
    await enterSalesOffer(b, env, "call", "learner");
    expect(await b.loadContext("call")).toEqual({});
  });
  it.each([30, 45, 119])("attributes provider retries answered %s minutes after campaign submission", async minutes => {
    await selectSalesOffers(env);
    await dispatchCallbacks(env);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body).toMatchObject({ dialRetries: 2, betweenRetries: 15 });
    vi.setSystemTime(new Date(+now + minutes * 60000));
    await enterSalesOffer(b, env, "retry-call", "learner");
    expect(await b.loadContext("retry-call")).toMatchObject({ offer_call: offerId });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ call_id: "retry-call", status: "answered" });
  });
  it.each([120, 121])("does not attribute a call outside the retry window after %s minutes", async minutes => {
    await selectSalesOffers(env);
    await dispatchCallbacks(env);
    vi.setSystemTime(new Date(+now + minutes * 60000));
    await enterSalesOffer(b, env, "stale-call", "learner");
    expect(await b.loadContext("stale-call")).toEqual({});
  });
  it.each(["0", "ERROR", "2", "9"])("hangs up on unsupported offer key or timeout %s", async choice => {
    await answered();
    const response = await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: choice }, "learner");
    expect(response).toEqual({ type: "hangup" });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ status: "declined" });
  });
  it("shows the month offer only in its bound call and handles unavailable package", async () => {
    await answered();
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "other" }, "learner")).toBeNull();
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call" }, "learner")).toMatchObject({ name: "isaacOffer", enabledKeys: "1" });
    const create = vi.spyOn(PaymentStore.prototype, "create");
    sql.prepare("DELETE FROM console_records WHERE kind='packages' AND id='school-offer-week'").run();
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner")).toMatchObject({ name: "isaacOfferUnavailable" });
    expect(create).toHaveBeenCalledWith("call", "learner", "school-offer-week", false, env);
    expect(await b.record("sales-offers", offerId)).toMatchObject({ status: "accepted" });
  });
  it("continues an available offer into existing terms then credit card flow", async () => {
    await answered();
    env = { ...env, NEDARIM_PHONE_ENABLED: "true", NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "test", NEDARIM_WEBHOOK_SECRET: "test", NEDARIM_PHONE_TERMINAL: "test" };
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner")).toMatchObject({ name: "isaacPayConfirm" });
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1", isaacPayConfirm: "1" }, "learner")).toMatchObject({ type: "creditCard", sum: 59 });
  });
  it("returns from terms to the one-key offer without entering credit card details", async () => {
    await answered();
    Object.assign(env, { NEDARIM_PHONE_ENABLED: "true", NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "test", NEDARIM_WEBHOOK_SECRET: "test", NEDARIM_PHONE_TERMINAL: "test" });
    const terms = await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner");
    expect(terms).toMatchObject({ name: "isaacPayConfirm", enabledKeys: "0,1" });
    expect(terms?.files[0].text).toBe("שימו לב: בהטבת בלאק פריידיי הינכם זכאים להטבת חודש ראשון. בסוף החודש המנוי ממשיך אוטומטית כמנוי סטארט במחירו הקבוע. אם לא תרצו להמשיך, ניתן לבטל את המנוי בשלוחה 3 בתוך שלושים הימים הראשונים, ולא תחויבו על חודש נוסף. לאישור והמשך לתשלום הקישו 1. לחזרה הקישו 0.");
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1", isaacPayConfirm: "0" }, "learner"))
      .toMatchObject({ name: "isaacOffer", enabledKeys: "1", removeParams: ["isaacPayConfirm", "isaacOffer"] });
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner"))
      .toMatchObject({ name: "isaacPayConfirm" });
  });
  async function acceptances(count: number) {
    for (let i = 0; i < count; i++) {
      await b.save("sales-offers", { customer_id: "buyer-" + i, status: "accepted" }, "accepted-" + i);
    }
  }
  it("stops selection and dispatch after one hundred acceptances", async () => {
    await acceptances(100);
    await selectSalesOffers(env);
    expect(await b.record("sales-offers", offerId)).toBeNull();
    await b.save("sales-offers", { customer_id: "learner", phone: "0501111111", status: "queued", expires_at: "2026-06-16T00:00:00Z" }, offerId);
    sql.prepare("INSERT INTO callback_requests(id,phone,name,for_whom,goal,timing,consent_at,source,status,attempts,created_at,updated_at,next_attempt_at) VALUES (?,'0501111111','','self','offer','scheduled','','sales_offer','queued',0,?,?,?)")
      .run(offerId, now.toISOString(), now.toISOString(), now.toISOString());
    expect(await dispatchCallbacks(env)).toMatchObject({ sent: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reserves the hundredth slot once and blocks a queued offer from becoming buyer 101", async () => {
    await answered();
    await acceptances(99);
    Object.assign(env, { NEDARIM_PHONE_ENABLED: "true", NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "test", NEDARIM_WEBHOOK_SECRET: "test", NEDARIM_PHONE_TERMINAL: "test" });
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner")).toMatchObject({ name: "isaacPayConfirm" });
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1", isaacPayConfirm: "1" }, "learner")).toMatchObject({ type: "creditCard" });
    await b.save("customers", { name: "Other", phone: "0502222222" }, "other");
    await b.save("sales-offers", { customer_id: "other", phone: "0502222222", call_id: "other-call", status: "answered", expires_at: "2026-06-16T00:00:00Z" }, "other-offer");
    await b.saveContext("other-call", { offer_call: "other-offer" });
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "other-call", isaacOffer: "1" }, "other")).toEqual({ type: "hangup" });
    expect(await new PaymentStore(b).orderForCall("other-call")).toBeNull();
  });
  it("can skip practice for a recognized offer call without changing ordinary inbound calls", async () => {
    await answered();
    Object.assign(env, { SALES_OFFER_SKIP_PRACTICE: "1", TLIVR_CALLBACK_SECRET: "cb", TLIVR_PROJECT_ENABLED: "true", TLIVR_PROJECT_PATH: "/", TLIVR_SYSTEM_PHONE: "0765673575" });
    const request = new Request("https://example.test/v1/technoline/ivr/main?key=cb&PBXnum=0765673575&PBXextensionPath=/&PBXphone=0501111111&PBXcallId=call");
    expect(await handleCallback(request, env, settings(env), "main"))
      .toMatchObject({ name: "isaacOffer", enabledKeys: "1" });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM usage_allocations").get()!.n).toBe(0);
    const ordinary = new Request("https://example.test/v1/technoline/ivr/main?key=cb&PBXnum=0765673575&PBXextensionPath=/&PBXphone=0502222222&PBXcallId=ordinary");
    expect(await handleCallback(ordinary, env, settings(env), "main"))
      .not.toMatchObject({ name: "isaacOffer" });
  });
});
