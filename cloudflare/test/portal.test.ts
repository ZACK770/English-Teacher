import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { buildSystemInstruction, controlsFromSettings } from "../src/controls";
import { type Env, settings } from "../src/env";
import { applyLearnerControls, materialsKind, teachersKind } from "../src/learner";
import { ProgressStore } from "../src/progress";
import { handleCallback, startSchool } from "../src/pbx";
import { CallSession } from "../src/call";
import { TutorSession } from "../src/session";
import { GeminiLive } from "../src/gemini";
import { GeminiBudget } from "../src/gemini-budget";
import { cleanupPortalAuth } from "../src/portal-auth";
import worker from "../src/index";
import { LearningStore } from "../src/learning";
import { PackageSchema } from "../src/business";
import { PaymentStore } from "../src/payments";
import { PRICING_PACKAGES, SCHOOL_FREE_POLICY } from "../../src/pricing";
import { cleanupCallbackQuota } from "../src/callbacks";

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

let db: SqlD1, env: Env, b: BusinessStore, progress: ProgressStore, tokenA: string, tokenB: string;
let code: string;
const config = { name: "המורה שלי", base_bot: "student", personality: "playful", voice: "Puck", explanation: "english", pace: "slow", corrections: "balanced", topic: "business", material_id: "" };
async function request(path: string, token = tokenA, body?: unknown, method?: string) {
  return worker.fetch(new Request("https://school.example" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}
beforeEach(async () => {
  db = new SqlD1();
  env = {
    DB: db as unknown as D1Database, ADMIN_BEARER_SECRET: "test-admin",
    ASSETS: { fetch: vi.fn(async () => new Response("<html>SPA fallback</html>")) },
  } as unknown as Env;
  let ledger: unknown;
  const guard = new GeminiBudget({
    storage: { kv: { get: () => ledger, put: (_: string, value: unknown) => { ledger = value; } } },
    waitUntil: () => {},
  } as unknown as DurableObjectState, env);
  env.GEMINI_BUDGET = { getByName: () => ({
    fetch: (url: string, init?: RequestInit) => guard.fetch(new Request(url, init)),
  }) } as unknown as DurableObjectNamespace;
  b = new BusinessStore(env.DB);
  progress = new ProgressStore(env.DB);
  await b.save("customers", { name: "Learner A", phone: "0500000001", source: "test", preferred_bot: "", notes: "" }, "learner-a");
  await b.save("customers", { name: "Learner B", phone: "0500000002", source: "test", preferred_bot: "", notes: "" }, "learner-b");
  await progress.createBot({ id: "student", label: "מורה בסיסי", role: "teacher", description: "", audience: "general", channel_id: "test-channel", phone_enabled: true, web_enabled: true, enabled: true }, controlsFromSettings(false));
  await progress.createBot({ id: "translator", label: "תרגומון", role: "translator", description: "", audience: "general", channel_id: "translator-channel", phone_enabled: true, web_enabled: true, enabled: true }, controlsFromSettings(false));
  tokenA = (await b.portalInvite("learner-a")).token;
  tokenB = (await b.portalInvite("learner-b")).token;
  code = "";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    code = new URLSearchParams(String(init.body)).get("cid") || "";
    return Response.json({ status: "OK", errorCode: "0" });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.sql.close(); });

it("blocks browser, PBX, and text calls at the shared budget without connecting to Gemini", async () => {
  env.GEMINI_DAILY_BUDGET_USD = "0.01";
  const connect = vi.spyOn(GeminiLive.prototype, "connect");
  const browser = { send: vi.fn(), close: vi.fn() };
  const phone = { send: vi.fn(), close: vi.fn() };
  const tutor = (socket: typeof browser, customerId?: string) => new TutorSession(
    socket as unknown as WebSocket, env, settings(env), crypto.randomUUID(), null, customerId ? { customerId, teacherId: "" } : undefined,
  );
  const start = { type: "start", format: "pcm16;rate=8000;ch=1" };
  await tutor(browser, "learner-a").run(JSON.stringify({ ...start, token: "portal", callId: "web-budget" }), "student", false);
  await tutor(phone).run(JSON.stringify({ ...start, token: "test-channel", callId: "phone-budget", caller: "0500000002" }), "student", false);
  expect(browser.send).toHaveBeenCalledWith(JSON.stringify({ type: "hangup", reason: "gemini_budget_reached" }));
  expect(phone.send).toHaveBeenCalledTimes(1);
  expect((await request("/v1/bots/student/turn", tokenA, { text: "Hello" })).status).toBe(429);
  expect(connect).not.toHaveBeenCalled();
  expect((await request("/v1/admin/gemini-budget")).status).toBe(401);
  expect(await (await request("/v1/admin/gemini-budget", env.ADMIN_BEARER_SECRET)).json()).toMatchObject({
    daily_budget_usd: 0.01, active_jobs: 0, alert_state: "pending",
  });
});

describe("approved pricing catalog", () => {
  it("seeds the approved school catalog and mirrors accurate billing types", async () => {
    for (const pkg of PRICING_PACKAGES.filter(p => p.product === "school")) {
      expect(PackageSchema.parse(await b.record("packages", pkg.id))).toEqual(PackageSchema.parse(pkg));
      const plan = db.sql.prepare("SELECT * FROM plans WHERE id=?").get(pkg.id)!;
      expect([plan.billing, plan.price_agorot, plan.included_minutes]).toEqual([pkg.billing, pkg.price_ils * 100, pkg.minutes]);
    }
    await b.save("packages", PackageSchema.parse(PRICING_PACKAGES[0]), "school-step");
    expect(db.sql.prepare("SELECT billing FROM plans WHERE id='school-step'").get()?.billing).toBe("monthly");
  });

  it("retires legacy school offers without deleting history or changing translator packages", async () => {
    await b.save("packages", { name: "ישן", product: "school", price_ils: 220, minutes: 100, validity_days: 30, active: true }, "pkg_starter");
    await b.save("packages", PRICING_PACKAGES.find(p => p.product === "translator")!, "pkg_translator_free");
    const translator = await b.record("packages", "pkg_translator_free");
    db.sql.exec(readFileSync(new FileURL("../migrations/0010_pricing_v2.sql", import.meta.url), "utf8"));
    expect((await b.list("packages")).some(p => p.id === "pkg_starter")).toBe(false);
    expect(await b.record("packages", "pkg_starter")).toMatchObject({ minutes: 100, active: false, retired: true });
    expect(await b.record("packages", "pkg_translator_free")).toEqual(translator);
  });

  it("blocks direct and hidden purchase and manual wallet grants for representative-only offers", async () => {
    for (const pkg of PRICING_PACKAGES.filter(p => !p.automated_purchase)) {
      await expect(new PaymentStore(b).create("buy-" + pkg.id, "learner-a", pkg.id, true)).rejects.toThrow("נציג");
      await expect(b.receipt({ customer_id: "learner-a", package_id: pkg.id, reference: "manual:" + pkg.id, amount_ils: pkg.price_ils })).rejects.toThrow("נציג");
    }
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM payment_orders").get()?.n).toBe(0);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sales_receipts").get()?.n).toBe(0);
  });

  it("keeps top-up and translator one-time orders available without a subscription", async () => {
    const translator = PRICING_PACKAGES.find(p => p.product === "translator")!;
    await b.save("packages", translator, translator.id);
    for (const [id, amount, minutes, days] of [["school-topup", 3900, 60, 30], [translator.id, 42000, 600, 90]] as const) {
      const order = await new PaymentStore(b).create("buy-" + id, "learner-a", id);
      expect(order.amount_agorot).toBe(amount);
      expect(JSON.parse(order.snapshot)).toMatchObject({ minutes, validity_days: days });
      expect(await new PaymentStore(b).issue("buy-" + id)).toBe(true);
      const data = { MosadNumber: "7019554", Groupe: "dibura-" + order.id, TransactionId: String(amount), Confirmation: "approved", Currency: "1", Amount: amount / 100 };
      expect(await new PaymentStore(b).settle(data, "7019554")).toMatchObject({ paid: true, package_id: id });
      expect(await new PaymentStore(b).settle(data, "7019554")).toMatchObject({ duplicate: true });
    }
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sales_receipts").get()?.n).toBe(2);
    expect(await b.reserveCall("learner-a", "student", "topup-call", 1800)).toEqual({ seconds: 900, mode: "paid" });
  });

  it("grants one opening lesson across teachers then two five-minute calls each month", async () => {
    await b.save("policies", SCHOOL_FREE_POLICY, "student");
    await b.save("policies", SCHOOL_FREE_POLICY, "another-teacher");
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(10);
    expect(await b.reserveCall("learner-a", "student", "opening", 1800)).toMatchObject({ seconds: 600, mode: "free" });
    await b.settleCall("opening", 600);
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(0);
    for (const id of ["free-a", "free-b"]) {
      expect(await b.reserveCall("learner-a", "another-teacher", id, 1800)).toMatchObject({ seconds: 300, mode: "free" });
      await b.settleCall(id, 300);
    }
    expect(await b.reserveCall("learner-a", "student", "exhausted", 1800)).toMatchObject({ seconds: 0, mode: "blocked" });
    db.sql.prepare("UPDATE usage_allocations SET created_at='2000-01-01' WHERE product='school'").run();
    expect(await b.reserveCall("learner-a", "student", "next-month", 1800)).toMatchObject({ seconds: 300, mode: "free" });
  });

  it("does not grant anonymous trials, retries zero-billed failures, and validates ranges", async () => {
    await b.save("policies", SCHOOL_FREE_POLICY, "student");
    expect(await b.reserveCall("anonymous-hidden", "student", "hidden", 1800)).toMatchObject({ seconds: 0 });
    await b.reserveCall("learner-a", "student", "failed-opening", 1800);
    await b.settleCall("failed-opening", 0);
    expect(await b.reserveCall("learner-a", "student", "retry", 1800)).toMatchObject({ seconds: 600 });
    expect(PackageSchema.safeParse({ ...PRICING_PACKAGES[0], max_call_minutes: 0 }).success).toBe(false);
    expect(PackageSchema.safeParse({ ...PRICING_PACKAGES[0], billing: "invalid" }).success).toBe(false);
    expect(PackageSchema.safeParse({}).success).toBe(false);
  });

  it.each([0, 1, 59])("restores the opening lesson after only %s billed seconds", async seconds => {
    await b.reserveCall("learner-a", "student", "short-opening", 1800);
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(0);
    await b.settleCall("short-opening", seconds);
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(10);
    expect(await b.reserveCall("learner-a", "student", "retry-opening", 1800)).toMatchObject({ seconds: 600 });
  });

  it("redeems the opening lesson at sixty billed seconds", async () => {
    await b.reserveCall("learner-a", "student", "opening-boundary", 1800);
    await b.settleCall("opening-boundary", 60);
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(0);
    expect(await b.reserveCall("learner-a", "student", "after-opening", 1800)).toMatchObject({ seconds: 300 });
  });

  it("does not advertise free limits when all school policies are disabled", async () => {
    await b.save("policies", { ...SCHOOL_FREE_POLICY, enabled: false }, "student");
    expect(await b.accessSummary("learner-a", [])).toMatchObject({ limited: false, opening_minutes: 0, free_calls_left: 0 });
    expect(await b.reserveCall("learner-a", "student", "disabled-policy", 1800)).toEqual({ seconds: 1800, mode: "unrestricted" });
  });

  it("uses the free fallback only when no school policy exists", async () => {
    expect(await b.accessSummary("learner-a", [])).toMatchObject({ limited: true, opening_minutes: 10, free_calls_left: 2 });
    await b.save("policies", { product: "translator", enabled: false }, "translator");
    expect(await b.accessSummary("learner-a", [])).toMatchObject({ limited: true, opening_minutes: 10 });
    await b.save("policies", { ...SCHOOL_FREE_POLICY, enabled: false }, "student");
    await b.save("policies", SCHOOL_FREE_POLICY, "another-teacher");
    expect(await b.accessSummary("learner-a", [])).toMatchObject({ limited: true, opening_minutes: 10 });
  });

  it("keeps the opening lesson available after text allowances are used", async () => {
    for (const id of ["text-a", "text-b"]) {
      expect(await b.reserveCall("learner-a", "student", id, 120, "text")).toMatchObject({ seconds: 120 });
      await b.settleCall(id, 120);
    }
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(10);
    expect(await b.reserveCall("learner-a", "student", "text-c", 120, "text")).toMatchObject({ seconds: 0 });
    expect(await b.reserveCall("learner-a", "student", "voice-opening", 1800)).toMatchObject({ seconds: 600 });
  });
});

describe("public callback quota", () => {
  it("does not spend the quota on repeat submissions for an existing callback", async () => {
    const submit = (number: number) => request("/v1/public/callback", tokenA, {
      name: "Callback test", phone: "050000000" + number, timing: "now", for_whom: "self", consent: true,
    });
    const initial = await submit(1);
    expect(initial.status).toBe(201);
    const { id } = await initial.json() as { id: string };
    for (let retry = 0; retry < 4; retry++) {
      const repeat = await submit(1);
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toEqual({ ok: true, id, duplicate: true });
    }
    expect((await submit(2)).status).toBe(201);
    expect((await submit(3)).status).toBe(201);
    expect((await submit(4)).status).toBe(429);
    expect((await submit(1)).status).toBe(200);
  });

  it("atomically limits valid submissions per connecting IP across hostnames", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-12T10:15:30Z"));
    const submit = (i: number, ip: string, isValid = true) => worker.fetch(new Request(
      "https://" + (i % 2 ? "www.speakcall.app/english" : "speakcall.app") + "/v1/public/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, "X-Forwarded-For": "198.51.100." + i },
        body: JSON.stringify({ name: "Callback test", phone: "050000000" + i, timing: "scheduled", for_whom: "self", consent: isValid }),
      }), env);
    expect((await submit(0, "192.0.2.1", false)).status).toBe(422);
    const responses = await Promise.all([1, 2, 3, 4, 5].map(i => submit(i, "192.0.2.1")));
    expect(responses.map(r => r.status).sort()).toEqual([201, 201, 201, 429, 429]);
    expect(responses.find(r => r.status === 429)?.headers.get("Retry-After")).toBe("2670");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM callback_requests").get()?.n).toBe(3);
    expect((await submit(6, "192.0.2.2")).status).toBe(201);
    await cleanupCallbackQuota(env);
    expect((await submit(7, "192.0.2.1")).status).toBe(429);
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-12-12T11:00:00Z"));
    await cleanupCallbackQuota(env);
    expect(db.sql.prepare("SELECT api FROM api_quota").all()).toEqual([]);
    expect((await submit(8, "192.0.2.1")).status).toBe(201);
  });
});

describe("real learner portal", () => {
  it("keeps deleted-list assessments discoverable without selecting deleted material for new lessons", async () => {
    const material = await (await request("/v1/portal/materials", tokenA, { name: "A practiced list", words: ["invoice — חשבונית", "receipt — קבלה"] })).json() as any;
    await request("/v1/portal/preferences", tokenA, { material_id: material.id });
    const initial = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    const store = new LearningStore(env.DB);
    await store.begin("learner-a", "list-call", initial.lesson!);
    const target = initial.lesson!.vocabulary[0].id;
    await store.record("learner-a", "list-call", { activity_id: "practice-1", vocabulary: [{ word_id: target, score: 100 }] });
    const removed = await worker.fetch(new Request("https://school.example/v1/portal/materials/" + material.id, { method: "DELETE", headers: { Authorization: "Bearer " + tokenA } }), env);
    expect(removed.status).toBe(200);
    const report = await (await request("/v1/portal/learning")).json() as any;
    expect(report.items.find((t: any) => t.id === target)).toMatchObject({ score: 100, attempts: 1 });
    expect(report.domains.find((d: any) => d.domain === "material:" + material.id)).toMatchObject({ archived: true, assessed: 1, total: 2 });
    expect((await (await request("/v1/portal/learning/history?kind=vocabulary&id=" + target)).json() as any).history).toHaveLength(1);
    const next = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(next.lesson!.vocabulary.some(t => t.domain === "material:" + material.id)).toBe(false);
    const other = await (await request("/v1/portal/learning", tokenB)).json() as any;
    expect(other.domains.some((d: any) => d.domain === "material:" + material.id)).toBe(false);
  });
  it("exposes zero target counts for Hebrew-only material and reports its ungraded lesson without inventing scores", async () => {
    const material = await (await request("/v1/portal/materials", tokenA, { name: "עבודה", words: ["אני עושה עסקים", "מה נשמע"] })).json() as any;
    expect(material.target_count).toBe(0);
    await request("/v1/portal/preferences", tokenA, { material_id: material.id });
    const me = await (await request("/v1/portal/me")).json() as any;
    expect(me.materials.find((m: any) => m.id === material.id)).toMatchObject({ target_count: 0, words: ["אני עושה עסקים", "מה נשמע"] });
    const controls = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    await new LearningStore(env.DB).begin("learner-a", "ungraded", controls.lesson!);
    const report = await (await request("/v1/portal/learning")).json() as any;
    expect(report.last_lesson).toMatchObject({ status: "no_targets", target_count: 0, result_count: 0 });
    expect(report.items.every((t: any) => t.score === null)).toBe(true);
    expect((await (await request("/v1/portal/learning", tokenB)).json() as any).last_lesson).toBe(null);
  });
  it("shares effective learning settings with the personal teacher and scopes learning history to the authenticated learner", async () => {
    const teacher = await (await request("/v1/portal/teachers", tokenA, { ...config, level: "intermediate", conversation_mode: "conversation", learning_load: "normal", correction_policy: "after_activity", closing_activity: "quiz" })).json() as any;
    await request("/v1/portal/preferences", tokenA, { active_teacher: teacher.id });
    await request("/v1/portal/preferences", tokenA, { level: "beginner", conversation_mode: "roleplay", correction_policy: "on_request", learning_load: "light", closing_activity: "roleplay" });
    const saved = await b.record(teachersKind("learner-a"), teacher.id);
    expect(saved).toMatchObject({ level: "beginner", conversation_mode: "roleplay", correction_policy: "on_request", learning_load: "light" });
    const c = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    const store = new LearningStore(env.DB);
    await store.begin("learner-a", "assessed-call", c.lesson!);
    const word = c.lesson!.vocabulary[0];
    expect(await store.record("learner-a", "assessed-call", { activity_id: "practice-1", vocabulary: [{ word_id: word.id, score: 100 }] })).toBe(true);
    const report = await (await request("/english/v1/portal/learning")).json() as any;
    expect(report.items.find((t: any) => t.id === word.id)).toMatchObject({ score: 100, attempts: 1 });
    expect((await request("/v1/portal/learning", "invalid")).status).toBe(401);
    const url = "/v1/portal/learning/history?kind=vocabulary&id=" + encodeURIComponent(word.id);
    expect((await (await request(url)).json() as any).history).toHaveLength(1);
    expect((await (await request(url, tokenB)).json() as any).history).toEqual([]);
    const other = await (await request("/v1/portal/learning", tokenB)).json() as any;
    expect(other.items.find((t: any) => t.id === word.id).score).toBe(null);
    expect((await request("/v1/portal/learning/history?kind=unknown&id=a")).status).toBe(422);
  });
  it("applies a changed intake level even when the learner and active teacher already have an explicit level", async () => {
    const teacher = await (await request("/v1/portal/teachers", tokenA, { ...config, level: "beginner", topic: "business" })).json() as any;
    await request("/v1/portal/preferences", tokenA, { active_teacher: teacher.id });
    const plan = { goal: "work", level: "fluent", difficulty: "speaking", minutes: 10, topic: "business" };
    expect((await request("/v1/portal/preferences", tokenA, { plan })).status).toBe(200);
    const controls = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(controls.lesson!.level).toBe("fluent");
    expect(controls.lesson!.vocabulary.every(t => t.level === "fluent")).toBe(true);
    expect((await (await request("/v1/portal/me")).json() as any).preferences.level).toBe("fluent");
  });
  it("routes live assessment calls directly to persistence and rejects legacy observations in targeted lessons", async () => {
    const controls = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    await new LearningStore(env.DB).begin("learner-a", "live-call", controls.lesson!);
    const session = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner") as any;
    session.controls = controls; session.customerId = "learner-a"; session.callId = "live-call";
    const target = controls.lesson!.vocabulary[0].id;
    expect(await session.recordTool({ name: "report_learning_batch", args: { activity_id: "practice-1", vocabulary: [{ word_id: target, score: 50 }] } })).toBe(true);
    expect(await session.recordTool({ name: "record_learning_observation", args: { skill: "vocabulary", result: "test", correction: "", score: 5 } })).toBe(false);
    expect((await new LearningStore(env.DB).history("learner-a", "vocabulary", target))[0]).toMatchObject({ score: 50 });
  });
  it.each(["direct", "legacy", "shared", "test", "web"] as const)("enforces phone activation for the %s stream", async (stream) => {
    env.TLIVR_ROUTER_CHANNEL = "router-channel";
    env.TEST_TEACHER_CHANNEL_ID = "test-teacher-channel";
    env.TEST_TEACHER_BEARER_SECRET = "test-bearer";
    await env.DB.prepare("UPDATE bots SET phone_enabled=0 WHERE id='student'").run();
    const send = vi.fn();
    const claim = vi.spyOn(ProgressStore.prototype, "claimCall").mockResolvedValue(false);
    const shared = stream === "shared";
    const web = stream === "web";
    const token = shared ? env.TLIVR_ROUTER_CHANNEL : web ? "portal" : stream === "test" ? env.TEST_TEACHER_CHANNEL_ID : "test-channel";
    if (shared) await b.saveContext("activation-test", { selected_bot: "student" });
    const session = new TutorSession({ send, close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner",
      stream === "test" ? "Bearer test-bearer" : null, web ? { customerId: "learner-a", teacherId: "" } : undefined);
    await session.run(JSON.stringify({ type: "start", token, callId: "activation-test", format: "pcm16;rate=8000;ch=1" }),
      stream === "direct" || web ? "student" : null, shared);
    if (web) expect(claim).toHaveBeenCalledOnce();
    else {
      expect(claim).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "hangup" }));
    }
  });
  it("signals a closing activity once from the server clock, without ending the call", async () => {
    vi.useFakeTimers();
    try {
      const controls = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
      const addContext = vi.fn();
      const session = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner") as any;
      session.controls = controls; session.ai = { addContext, close: vi.fn() };
      session.lessonDurationMs = 120000; session.meteredAt = Date.now() - 90000;
      const running = session.watchdog().catch(() => {});
      await vi.advanceTimersByTimeAsync(1500);
      expect(addContext).toHaveBeenCalledOnce();
      expect(addContext.mock.calls[0][0]).toContain("closing roleplay");
      expect(session.reason).toBe("");
      session.stop(); await running;
    } finally { vi.useRealTimers(); }
  });
  it("cleans expired login quota windows without resetting active or unrelated quotas", async () => {
    const now = Date.parse("2027-01-01T10:15:30Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const expired = ["portal-ring:phone:abc:2027-01-01T10:14", "portal-ring:phone:abc:2027-01-01T09", "portal-ring:ip:abc:2026-12-31T23", "portal-ring:day:2026-12-31"];
    const active = ["portal-ring:phone:abc:2027-01-01T10:15", "portal-ring:phone:abc:2027-01-01T10", "portal-ring:ip:abc:2027-01-01T10", "portal-ring:day:2027-01-01", "portal-ring:ip:abc:2027-01-01T11", "portal-voice-preview", "gemini"];
    for (const key of [...expired, ...active]) db.sql.prepare("INSERT INTO api_quota VALUES (?,?,?)").run("2026-12", key, 3);
    await b.putSetting("portal-auth:expired", { expires: now - 1 });
    await b.putSetting("voice-ticket:expired", { expires: now - 1 });
    await b.putSetting("portal-auth:current", { expires: now + 60000 });
    await cleanupPortalAuth(env);
    expect(db.sql.prepare("SELECT api FROM api_quota").all().map(r => r.api).sort()).toEqual(active.sort());
    expect(db.sql.prepare("SELECT SUM(used) AS used FROM api_quota").get()?.used).toBe(active.length * 3);
    expect(db.sql.prepare("SELECT id FROM console_settings").all().map(r => r.id)).toEqual(["portal-auth:current"]);
  });
  it("serves authenticated JSON before the static SPA fallback", async () => {
    const r = await request("/v1/portal/me");
    expect(r.status).toBe(200);
    const a = await r.json() as any;
    expect(a.customer.name).toBe("Learner A");
    expect(a.teachers).toEqual([]);
    expect(a.materials).toEqual([]);
    expect(a.progress.session_count).toBe(0);
    expect(a.progress).not.toHaveProperty("estimated_cost_usd");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it("requires the personal token and returns API 404 rather than HTML", async () => {
    expect((await request("/v1/portal/me", "invalid")).status).toBe(401);
    expect((await request("/v1/portal/not-real")).status).toBe(404);
  });
  it("saves vocabulary and one active teacher and actually applies them to the telephone tutor", async () => {
    const material = await (await request("/v1/portal/materials", tokenA, { name: "עבודה", words: ["appointment", "opportunity", "appointment"] })).json() as any;
    const teacher = await (await request("/v1/portal/teachers", tokenA, { ...config, material_id: material.id })).json() as any;
    const activated = await request("/v1/portal/preferences", tokenA, { active_teacher: teacher.id });
    expect(activated.status).toBe(200);
    const preference = await b.loadContext("preferences:learner-a");
    expect(preference).toMatchObject({ teacher_bot: "student", active_teacher: teacher.id, school_mode: "free" });
    await startSchool(b, progress, settings(env), "test-ivr", "learner-a");
    expect((await b.loadContext("test-ivr")).selected_bot).toBe("student");
    const controls = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(controls.voice).toBe("Puck");
    expect(controls.custom_vocabulary).toEqual(["appointment", "opportunity"]);
    expect(controls.custom_instructions).toContain("playful");
    expect(controls.custom_instructions).toContain("slow");
    expect(controls.custom_instructions).toContain("business");
  });
  it("routes a root-menu system and the existing /99 system with their own extension bases", async () => {
    const pbxEnv = { ...env, TLIVR_PROJECT_ENABLED: "true", TLIVR_CALLBACK_SECRET: "cb", TLIVR_SYSTEM_PHONE: "0765673575,0765674434", TLIVR_PROJECT_PATH: "/99,/" } as Env;
    const call = (phone: string, path: string, id: string, extra = "", route = "main") => handleCallback(new Request(`https://x/v1/technoline/ivr/main?key=cb&PBXcallId=${id}&PBXnum=${phone}&PBXextensionPath=${encodeURIComponent(path)}&PBXphone=private${extra}`), pbxEnv, settings(pbxEnv), route);
    expect((await call("0765674434", "/", "root-call", "&isaacMain=1")).goTo).toBe("/7");
    expect((await b.loadContext("root-call")).pbx_base).toBe("/");
    expect((await call("0765674434", "/", "root-menu", "&isaacMain=2")).goTo).toBe("/2");
    expect((await call("0765674434", "/2", "root-area", "&isaacOptions=1", "options")).goTo).toBe("/2/1");
    expect((await call("0765673575", "/99", "old-call", "&isaacMain=1")).goTo).toBe("/99/7");
    await expect(call("0765673575", "/5", "taxi-call")).rejects.toMatchObject({ status: 403 });
    await expect(call("0700000000", "/", "foreign-call")).rejects.toMatchObject({ status: 400 });
  });
  it("authenticates form-only PBX callbacks independently of the legacy URL credential", async () => {
    const pbxEnv = { ...env, TLIVR_PROJECT_ENABLED: "true", TLIVR_CALLBACK_SECRET: "legacy", TLIVR_CALLBACK_BODY_SECRET: "body-secret" };
    const fields = "PBXcallId=body-call&PBXnum=0765673575&PBXextensionPath=%2F99&isaacMain=1";
    const call = (form: string, query = "", liveEnv = pbxEnv) => handleCallback(new Request("https://x/v1/technoline/ivr/main" + query, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    }), liveEnv, settings(liveEnv), "main");
    expect((await call(fields + "&callback_key=body-secret")).goTo).toBe("/99/7");
    expect((await call(fields, "?key=legacy")).goTo).toBe("/99/7");
    expect((await call(fields + "&callback_key=body-secret", "", { ...pbxEnv, TLIVR_CALLBACK_SECRET: "" })).goTo).toBe("/99/7");
    await expect(call(fields, "?key=legacy", { ...pbxEnv, TLIVR_CALLBACK_SECRET: "" })).rejects.toMatchObject({ status: 401 });
    await expect(call(fields, "?callback_key=body-secret")).rejects.toMatchObject({ status: 401 });
    await expect(call(fields, "?key=body-secret")).rejects.toMatchObject({ status: 401 });
    await expect(call(fields + "&callback_key=legacy")).rejects.toMatchObject({ status: 401 });
    await expect(call(fields + "&callback_key=body-secret&callback_key=body-secret")).rejects.toMatchObject({ status: 401 });
    await expect(call(fields + "&callback_key=body-secret&too_large=" + "x".repeat(16384))).rejects.toMatchObject({ status: 413 });
    const log = JSON.stringify(await b.list("ivr-events"));
    expect(log).not.toContain("body-secret");
    expect(log).not.toContain("legacy");
  });
  it("offers named learner teachers plus a default on the phone and gives the tutor both names", async () => {
    const pbxEnv = { ...env, TLIVR_PROJECT_ENABLED: "true", TLIVR_CALLBACK_SECRET: "cb", TLIVR_SYSTEM_PHONE: "0765673575", TLIVR_PROJECT_PATH: "/" } as Env;
    const teacher = await b.save(teachersKind("learner-a"), { ...config, name: "Dana" });
    const call = (id: string, extra = "") => handleCallback(new Request(`https://x/v1/technoline/ivr/teachers?key=cb&PBXcallId=${id}&PBXnum=0765673575&PBXextensionPath=%2F2%2F1&PBXphone=0500000001${extra}`), pbxEnv, settings(pbxEnv), "teachers");
    const listed = JSON.stringify(await call("pick"));
    expect(listed).toContain("לDana הקישו 1");
    expect(listed).toContain("לדוד מצוות ספיקול הקישו 2");
    expect((await call("pick", "&isaacBotChoice=1")).goTo).toBe("/7");
    expect(await b.loadContext("preferences:learner-a")).toMatchObject({ active_teacher: teacher.id, topic: "business", pace: "slow" });
    const named = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(named.custom_instructions).toContain('"Dana"');
    expect(named.custom_instructions).toContain('"Learner A"');
    await call("pick-default");
    expect((await call("pick-default", "&isaacBotChoice=2")).goTo).toBe("/7");
    expect((await b.loadContext("preferences:learner-a")).active_teacher).toBe("");
    const fallback = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(fallback.custom_instructions).toContain('"דוד"');
    for (let i = 0; i < 9; i++) await b.save(teachersKind("learner-a"), { ...config, name: "T" + i });
    const first = JSON.stringify(await call("paged"));
    expect(first).toContain("למורים נוספים הקישו 9");
    expect(JSON.stringify(await call("paged", "&isaacBotChoice=9"))).toContain("דוד מצוות ספיקול");
    await b.save("customers", { name: "לקוח מהטלפון", phone: "0500000003", source: "missed-call", preferred_bot: "", notes: "" }, "learner-c");
    const anon = await applyLearnerControls(b, "learner-c", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(anon.custom_instructions).toContain("name is unknown");
  });
  it("does not let another learner select, preview, or delete a private teacher or read a word list", async () => {
    const teacher = await b.save(teachersKind("learner-a"), config);
    const material = await b.save(materialsKind("learner-a"), { name: "secret", words: ["private"] });
    expect((await request("/v1/portal/preferences", tokenB, { active_teacher: teacher.id })).status).toBe(404);
    expect((await request("/v1/portal/voice-ticket", tokenB, { bot_id: "student", teacher_id: teacher.id })).status).toBe(404);
    await request("/v1/portal/teachers/" + teacher.id, tokenB, undefined, "DELETE");
    expect(await b.record(teachersKind("learner-a"), teacher.id)).toBeTruthy();
    expect((await request("/v1/portal/preferences", tokenB, { material_id: material.id })).status).toBe(404);
    const a = await (await request("/v1/portal/me", tokenB)).json() as any;
    expect(a.teachers).toEqual([]);
    expect(a.materials).toEqual([]);
  });
  it("saves a plan, selected practice, and learner settings without changing the base bot", async () => {
    const r = await request("/v1/portal/preferences", tokenA, { plan: { goal: "travel", level: "beginner", difficulty: "writing", minutes: 5, topic: "flights" }, minutes: 5, track: "recommended", store_transcripts: true });
    expect(r.status).toBe(200);
    const c = await applyLearnerControls(b, "learner-a", { id: "student", role: "teacher" }, controlsFromSettings(false));
    expect(c.target_lesson_minutes).toBe(5);
    expect(c.ending_policy).toBe("after_target_with_permission");
    expect(c.lesson?.level).toBe("beginner");
    expect(buildSystemInstruction(c, "")).toContain("Dedicated grammar practice OFF");
    expect(buildSystemInstruction(c, "")).not.toContain("20% grammar");
    expect(c.store_transcripts).toBe(true);
    expect((await progress.loadControls("student", controlsFromSettings(false))).store_transcripts).toBe(false);
  });
  it("previews the base voice without inheriting a personal teacher using the same bot", async () => {
    const teacher = await b.save(teachersKind("learner-a"), config);
    await request("/v1/portal/preferences", tokenA, { active_teacher: teacher.id });
    const bot = { id: "student", role: "teacher" } as const;
    const defaults = controlsFromSettings(false);
    const base = await applyLearnerControls(b, "learner-a", bot, defaults, "");
    expect(base.voice).toBe("Puck");
    expect(base.custom_instructions).not.toContain("Personality: playful");
    expect((await applyLearnerControls(b, "learner-a", bot, defaults)).voice).toBe("Puck");
    expect((await applyLearnerControls(b, "learner-a", bot, defaults, teacher.id)).voice).toBe("Puck");
    expect((await b.loadContext("preferences:learner-a")).active_teacher).toBe(teacher.id);
  });
  it("updates the active template when preferences or the active word list change", async () => {
    const teacher = await b.save(teachersKind("learner-a"), config);
    await request("/v1/portal/preferences", tokenA, { active_teacher: teacher.id });
    const material = await b.save(materialsKind("learner-a"), { name: "new", words: ["meeting"] });
    await request("/v1/portal/preferences", tokenA, { pace: "fast", material_id: material.id });
    expect(await b.record(teachersKind("learner-a"), teacher.id)).toMatchObject({ pace: "fast", material_id: material.id });
    expect((await request("/v1/portal/teachers/" + teacher.id, tokenA, undefined, "DELETE")).status).toBe(409);
    await request("/v1/portal/materials/" + material.id, tokenA, undefined, "DELETE");
    expect((await b.record(teachersKind("learner-a"), teacher.id))?.material_id).toBe("");
    await request("/v1/portal/preferences", tokenA, { selected_bot: "student" });
    expect((await b.loadContext("preferences:learner-a")).active_teacher).toBe("");
  });
  it.each([
    ["/v1/portal/teachers", { ...config, voice: "unknown" }],
    ["/v1/portal/teachers", { ...config, base_bot: "translator" }],
    ["/v1/portal/materials", { name: "too many", words: Array(101).fill("word") }],
    ["/v1/portal/preferences", { minutes: 999 }],
  ])("rejects invalid learner input at %s", async (path, body) => {
    expect((await request(path, tokenA, body)).status).toBeGreaterThanOrEqual(400);
  });
  it("does not replace translator instructions with learner-teacher instructions", async () => {
    const c = controlsFromSettings(true);
    const result = await applyLearnerControls(b, "learner-a", { id: "translator", role: "translator" }, c);
    expect(result.base_prompt).toBe(c.base_prompt);
    expect(result.custom_instructions).toBe(c.custom_instructions);
    expect(result.store_transcripts).toBe(false);
  });
  it("never returns another customer's transcript", async () => {
    await progress.saveSession({ student_id: "learner-a", call_id: "private-call", started_at: new Date(), learner_turns: 1, tutor_turns: 1, observations: [], transcript: null, summary: { summary_he: "שיחה", success_he: "", next_step_he: "", points: 0 }, usage: { input_text_tokens: 0, input_audio_tokens: 0, output_text_tokens: 0, output_audio_tokens: 0, thoughts_tokens: 0, estimated_cost_usd: 0, cost_basis: "test" }, model: "test" });
    expect((await request("/v1/portal/sessions/private-call/transcript", tokenB)).status).toBe(404);
    expect(await (await request("/v1/portal/sessions/private-call/transcript")).json()).toEqual({ transcript: null });
    const a = await (await request("/v1/portal/me")).json() as any;
    expect(a.progress.sessions[0].call_id).toBe("private-call");
  });
  it.each([false, true])("honors text transcript opt-in=%s in prompt traces as well as turns", async (enabled) => {
    await request("/v1/portal/preferences", tokenA, { store_transcripts: enabled });
    vi.spyOn(GeminiLive.prototype, "connect").mockRejectedValue(new Error("Test model unavailable"));
    const text = "A private sentence from the learner";
    const result = await request("/v1/bots/student/turn", tokenA, { text });
    expect(result.status).toBe(502);
    expect(db.sql.prepare("SELECT product FROM usage_allocations").all()).toEqual([{ product: "school" }]);
    expect((await b.accessSummary("learner-a", [])).opening_minutes).toBe(10);
    const snapshots = db.sql.prepare("SELECT opening_message,setup_json FROM prompt_snapshots").all();
    expect(snapshots.length).toBe(enabled ? 1 : 0);
    expect(JSON.stringify(snapshots).includes(text)).toBe(enabled);
    const turns = db.sql.prepare("SELECT text FROM conversation_turns").all();
    expect(turns.length).toBe(enabled ? 1 : 0);
    const session = db.sql.prepare("SELECT transcript_json FROM sessions WHERE student_id='learner-a'").get();
    expect(session).toBeTruthy();
    expect(String(session!.transcript_json).includes(text)).toBe(enabled);
  });
  it.each([false, true, undefined].flatMap(enabled => ["conversation", "empty", "error"].map(outcome => ({ enabled, outcome }))))("honors voice transcript opt-in=$enabled for $outcome", async ({ enabled, outcome }) => {
    if (enabled !== undefined) await request("/v1/portal/preferences", tokenA, { store_transcripts: enabled });
    await progress.saveControls("student", controlsFromSettings(true));
    const connect = vi.spyOn(GeminiLive.prototype, "connect").mockResolvedValue(undefined);
    if (outcome === "error") connect.mockRejectedValue(new Error("Test model unavailable"));
    vi.spyOn(GeminiLive.prototype, "startGreeting").mockImplementation(() => {});
    vi.spyOn(GeminiLive.prototype, "addContext").mockImplementation(() => {});
    vi.spyOn(GeminiLive.prototype, "close").mockImplementation(() => {});
    const next = vi.spyOn(GeminiLive.prototype, "next").mockResolvedValue({ type: "closed" });
    if (outcome === "conversation") next
      .mockResolvedValueOnce({ type: "transcript", role: "learner", text: "My private answer" })
      .mockResolvedValueOnce({ type: "transcript", role: "tutor", text: "A private reply" });
    const session = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner", null, { customerId: "learner-a", teacherId: "" });
    await session.run(JSON.stringify({ type: "start", token: "portal", callId: "private-voice", format: "pcm16;rate=8000;ch=1" }), "student", false);
    expect(session.meter.transcript).toHaveLength(outcome === "conversation" ? 2 : 0);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM prompt_snapshots").get()?.n).toBe(enabled ? 1 : 0);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM conversation_turns").get()?.n).toBe(enabled && outcome === "conversation" ? 2 : 0);
    const saved = db.sql.prepare("SELECT transcript_json,summary_he FROM sessions WHERE student_id='learner-a'").get();
    expect(saved).toBeTruthy();
    expect(saved!.transcript_json).toBe(enabled ? JSON.stringify(session.meter.transcript) : null);
    expect(saved!.summary_he).toBeTruthy();
  });
  it.each(["", "/english"])("consumes a %s browser voice ticket atomically and forwards only its verified customer", async (prefix) => {
    await env.DB.prepare("UPDATE bots SET phone_enabled=0 WHERE id='student'").run();
    const issued = await request("/v1/portal/voice-ticket", tokenA, { bot_id: "student" });
    expect(issued.status).toBe(200);
    const created = await issued.json() as any;
    const forward = vi.fn(async (r: Request) => Response.json({ customer: r.headers.get("X-Portal-Customer"), bot: r.headers.get("X-Profile"), path: new URL(r.url).pathname, search: new URL(r.url).search }));
    env.CALLS = { newUniqueId: () => "test-object", get: () => ({ fetch: forward }) } as unknown as DurableObjectNamespace;
    const url = "https://school.example" + prefix + "/v1/portal/voice?ticket=" + created.ticket;
    const connect = () => worker.fetch(new Request(url, { headers: { Upgrade: "websocket", "X-Portal-Customer": "learner-b" } }), env);
    expect(await (await connect()).json()).toEqual({ customer: "learner-a", bot: "student", path: "/v1/portal/voice", search: "" });
    expect((await connect()).status).toBe(401);
    expect(forward).toHaveBeenCalledOnce();
  });
  it("lets web-only teachers take browser calls but not the phone teacher slot", async () => {
    await progress.createBot({ id: "web-only", label: "Web", role: "teacher", description: "", audience: "general", channel_id: null, phone_enabled: false, web_enabled: true, enabled: true }, controlsFromSettings(false));
    const created = await (await request("/v1/portal/voice-ticket", tokenA, { bot_id: "web-only" })).json() as any;
    const forward = vi.fn(async (r: Request) => Response.json({ bot: r.headers.get("X-Profile") }));
    env.CALLS = { newUniqueId: () => "test-object", get: () => ({ fetch: forward }) } as unknown as DurableObjectNamespace;
    const res = await worker.fetch(new Request("https://school.example/v1/portal/voice?ticket=" + created.ticket, { headers: { Upgrade: "websocket" } }), env);
    expect(await res.json()).toEqual({ bot: "web-only" });
    expect((await request("/v1/portal/teachers", tokenA, { name: "Web", base_bot: "web-only" })).status).toBe(404);
    await progress.createBot({ id: "phone-only", label: "Phone", role: "teacher", description: "", audience: "general", channel_id: null, phone_enabled: true, web_enabled: false, enabled: true }, controlsFromSettings(false));
    expect((await request("/v1/portal/voice-ticket", tokenA, { bot_id: "phone-only" })).status).toBe(404);
  });
  it.each(["speakcall.app", "www.speakcall.app"])("serves the SpeakCall landing page on %s", async (host) => {
    const index = readFileSync(new FileURL("../../index.html", import.meta.url), "utf8");
    env.ASSETS = { fetch: async (r: Request) => new URL(r.url).pathname === "/index.html"
      ? new Response(index, { headers: { "Content-Type": "text/html" } })
      : new Response(null, { status: 404 }) } as Fetcher;
    const page = await worker.fetch(new Request(`https://${host}/`), env);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<title>SpeakCall — פשוט לדבר.</title>");
    expect(html).toContain('<link rel="canonical" href="https://speakcall.app/" />');
    expect(html).toContain('<meta property="og:title" content="SpeakCall — פשוט לדבר." />');
    expect(html).toContain('<meta property="og:url" content="https://speakcall.app/" />');
  });
  it("loads the learner bundle under the existing impact.net /english path", async () => {
    env.ASSETS = { fetch: async (r: Request) => new URL(r.url).pathname === "/index.html"
      ? new Response('<script src="/assets/app.js"></script><link href="/assets/app.css">', { headers: { "Content-Type": "text/html" } })
      : new Response(null, { status: 404 }) } as Fetcher;
    const page = await worker.fetch(new Request("https://school.example/english/learn"), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<script src="/english/assets/app.js"></script><link href="/english/assets/app.css">');
  });
  it("accepts microphone PCM after the browser socket returns from its upgrade", async () => {
    class Socket extends EventTarget { accept = vi.fn(); send = vi.fn(); close = vi.fn(); }
    const server = new Socket();
    vi.stubGlobal("WebSocketPair", class { 0 = new Socket(); 1 = server; });
    const OriginalResponse = Response;
    vi.stubGlobal("Response", class extends OriginalResponse {
      constructor(body: any, init: any) { super(body, init?.status === 101 ? { status: 200 } : init); }
    });
    vi.spyOn(TutorSession.prototype, "run").mockResolvedValue(undefined);
    const received = vi.spyOn(TutorSession.prototype, "receive").mockImplementation(() => undefined);
    const session = new CallSession({ id: { toString: () => "object" }, waitUntil: () => {} } as unknown as DurableObjectState, env);
    await session.fetch(new Request("https://school.example/v1/portal/voice", { headers: { Upgrade: "websocket", "X-Profile": "student", "X-Portal-Customer": "learner-a" } }));
    const pcm = new ArrayBuffer(320);
    server.dispatchEvent(new MessageEvent("message", { data: pcm }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toHaveBeenCalledWith(pcm);
  });
});

describe("school history after navigation migration", () => {
  function session(call: string, customer = "learner-a", navigation = false) {
    db.sql.prepare(`INSERT INTO sessions (student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,
      observations_json,transcript_json,summary_he,next_step_he,points) VALUES (?,?,datetime('now'),datetime('now'),60,1,1,?,?,?,?,?)`)
      .run(customer, call, JSON.stringify([{ skill: navigation ? "navigation" : "speaking", score: navigation ? 1 : 4, result: "ok", correction: "" }]),
        JSON.stringify([{ role: "user", text: navigation ? "NAVIGATION_ONLY" : "hello" }]),
        navigation ? "NAVIGATION_ONLY" : "English practice", navigation ? "NAVIGATION_NEXT_STEP" : "Practice another phrase", navigation ? 999 : 10);
  }
  it.each([
    { id: "voice-navigator-live", role: "teacher" },
    { id: "old-navigation-profile", role: "navigation" },
  ])("excludes retired bot $id from history, aggregates, transcripts and tutor context without deleting data", async ({ id, role }) => {
    await progress.createBot({ id, role, label: "Archived", description: "", audience: "general", channel_id: null, phone_enabled: false, web_enabled: false, enabled: false }, controlsFromSettings(false));
    session("english-call");
    session("navigation-call", "learner-a", true);
    await b.registerWebCall("english-call", "learner-a", "student");
    await b.registerWebCall("navigation-call", "learner-a", id);
    const report = await progress.report("learner-a", 1);
    expect(report).toMatchObject({ session_count: 1, total_minutes: 1, total_points: 10, average_score: 4 });
    expect(report.sessions.map(s => s.call_id)).toEqual(["english-call"]);
    expect(await progress.lessonContext("learner-a")).not.toContain("NAVIGATION");
    const account = await (await request("/v1/portal/me")).json() as any;
    expect(account.calls.map((c: any) => c.call_id)).toEqual(["english-call"]);
    expect(account.progress.session_count).toBe(1);
    expect((await request("/v1/portal/sessions/navigation-call/transcript")).status).toBe(404);
    expect((await request("/v1/portal/sessions/english-call/transcript")).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(2);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM call_customers").get()?.n).toBe(2);
  });
  it("recognizes an archived navigation snapshot when the customer-call link is absent", async () => {
    session("orphan-navigation", "learner-a", true);
    db.sql.prepare(`INSERT INTO prompt_snapshots (created_at,profile_id,call_id,fingerprint,system_instruction,opening_message,history_context,setup_json)
      VALUES (datetime('now'),'voice-navigator-live','orphan-navigation','test','','','','{}')`).run();
    expect((await progress.report("learner-a")).session_count).toBe(0);
    expect(await progress.lessonContext("learner-a")).not.toContain("NAVIGATION");
    expect((await request("/v1/portal/sessions/orphan-navigation/transcript")).status).toBe(404);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM prompt_snapshots").get()?.n).toBe(1);
  });
  it("keeps customer identity independent of a retired bot ID and retains unknown legacy English calls", async () => {
    session("english-unlinked", "voice-navigator-live");
    session("translator-call");
    await b.registerWebCall("translator-call", "learner-a", "translator");
    expect((await progress.report("voice-navigator-live")).session_count).toBe(1);
    expect((await progress.report("learner-a")).session_count).toBe(1);
    expect((await b.customerDetail("learner-a")).calls.map(c => c.bot_id)).toEqual(["translator"]);
  });
});

describe("monthly voice preview quota", () => {
  it("reports the enforced calendar-month period and resets the monthly quota", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-01-31T12:00:00Z"));
      const token = (await b.portalInvite("learner-a")).token;
      for (let n = 0; n < 3; n++) expect(await b.consumeMonthlyQuota("portal-voice-preview:learner-a", 3)).toBe(true);
      const response = await request("/v1/portal/voice-preview", token, { voice: "Puck" });
      expect(response.status).toBe(429);
      expect(await response.text()).toContain("לחודש הזה");
      vi.setSystemTime(new Date("2027-02-01T00:00:00Z"));
      expect(await b.consumeMonthlyQuota("portal-voice-preview:learner-a", 3)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe("Technoline caller-ID login", () => {
  function used(kind: string) {
    return Number(db.sql.prepare("SELECT COALESCE(SUM(used),0) AS n FROM api_quota WHERE api LIKE ?").get(`portal-ring:${kind}:%`)?.n);
  }
  async function challenge(token = "") {
    const response = await request("/v1/portal/auth/start", token, { phone: "0500000001" });
    expect(response.status).toBe(200);
    return (await response.json() as any).challenge;
  }
  it("verifies six digits and issues a real portal token without revoking personal links", async () => {
    const id = await challenge();
    expect(code).toMatch(/^\d{6}$/);
    const verified = await request("/v1/portal/auth/verify", "", { challenge: id, code });
    expect(verified.status).toBe(200);
    expect(used("verified")).toBe(0);
    const result = await verified.json() as any;
    expect(await b.portalCustomer(result.token)).toBe("learner-a");
    expect(await b.portalCustomer(tokenA)).toBe("learner-a");
    expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(401);
    expect(used("verified")).toBe(0);
  });
  it("limits retries and rejects expired challenges", async () => {
    const id = await challenge();
    const wrong = code === "111111" ? "222222" : "111111";
    for (let n = 0; n < 5; n++) expect((await request("/v1/portal/auth/verify", "", { challenge: id, code: wrong })).status).toBe(401);
    expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(401);
    expect(used("verified")).toBe(0);
    await b.putSetting("portal-auth:" + id, { phone: "0500000001", attempts: 0, expires: 0 });
    expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(401);
  });
  it("returns a clear unavailable state if Technoline rejects the source IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    expect((await request("/v1/portal/auth/start", "", { phone: "0500000001" })).status).toBe(503);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM console_settings WHERE id LIKE 'portal-auth:%'").get()?.n).toBe(0);
    expect(used("verified")).toBe(0);
  });
  it.each(["rejected", "thrown"])("refunds %s provider calls without bypassing the minute throttle", async (failure) => {
    vi.useFakeTimers();
    const provider = vi.fn(async () => {
      if (failure === "thrown") throw new Error("Provider unavailable");
      return Response.json({ status: "ERROR", errorCode: "1" });
    });
    vi.stubGlobal("fetch", provider);
    try {
      for (let n = 0; n < 12; n++) {
        vi.setSystemTime(new Date(`2027-01-31T23:${String(n).padStart(2, "0")}:00Z`));
        expect((await request("/v1/portal/auth/start", "", { phone: "0500000001" })).status).toBe(503);
        expect(used("phone")).toBe(n + 1);
        expect(used("ip")).toBe(0);
        expect(used("day")).toBe(0);
        expect(db.sql.prepare("SELECT used FROM api_quota WHERE api GLOB 'portal-ring:phone:*:????-??-??T??'").get()?.used).toBe(0);
        expect((await request("/v1/portal/auth/start", "", { phone: "0500000001" })).status).toBe(429);
      }
      expect(provider).toHaveBeenCalledTimes(12);
      expect(db.sql.prepare("SELECT COUNT(*) AS n FROM console_settings WHERE id LIKE 'portal-auth:%'").get()?.n).toBe(0);
      vi.setSystemTime(new Date("2027-01-31T23:12:00Z"));
      provider.mockImplementation(async () => Response.json({ status: "OK", errorCode: "0" }));
      await challenge();
      expect(used("ip")).toBe(1);
      expect(used("day")).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("never refunds a quota below zero or creates missing quota rows", async () => {
    await b.refundMonthlyQuota("missing");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM api_quota WHERE api='missing'").get()?.n).toBe(0);
    await b.consumeMonthlyQuota("refund-test", 10);
    await b.refundMonthlyQuota("refund-test");
    await b.refundMonthlyQuota("refund-test");
    expect(db.sql.prepare("SELECT used FROM api_quota WHERE api='refund-test'").get()?.used).toBe(0);
  });
  it("allows unanswered calls up to the separate hourly attempt cap without using successful verifications", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-01-01T10:00:00Z"));
      for (let n = 0; n < 10; n++) {
        vi.setSystemTime(new Date(`2027-01-01T10:${String(n).padStart(2, "0")}:00Z`));
        await challenge();
      }
      vi.setSystemTime(new Date("2027-01-01T10:11:00Z"));
      expect((await request("/v1/portal/auth/start", "", { phone: "0500000001" })).status).toBe(429);
      expect(fetch).toHaveBeenCalledTimes(10);
      expect(used("verified")).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("allows more than five successful verifications per hour without a separate verification cap", async () => {
    vi.useFakeTimers();
    try {
      for (let n = 0; n < 7; n++) {
        vi.setSystemTime(new Date(`2027-01-01T10:0${n}:00Z`));
        const id = await challenge();
        expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(200);
      }
      expect(used("verified")).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("does not send a call for an invalid phone and limits repeated ringing", async () => {
    expect((await request("/v1/portal/auth/start", "", { phone: "invalid" })).status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
    await challenge();
    expect((await request("/v1/portal/auth/start", "", { phone: "0500000001" })).status).toBe(429);
  });
  it("links a verified additional phone to the same account and the same telephone lesson identity", async () => {
    const r = await request("/v1/portal/auth/start", tokenA, { phone: "0500000003", purpose: "link_phone" });
    const id = (await r.json() as any).challenge;
    const verified = await request("/v1/portal/auth/verify", tokenA, { challenge: id, code });
    expect(verified.status).toBe(200);
    expect(await b.identifyCall("0500000003", "alias-call", "student")).toBe("learner-a");
    const a = await (await request("/v1/portal/me")).json() as any;
    expect(a.phones[0].phone).toBe("0500000003");
    await request("/v1/portal/phones/" + a.phones[0].id, tokenB, undefined, "DELETE");
    expect(await b.customerForPhone("0500000003")).toBe("learner-a");
    await request("/v1/portal/phones/" + a.phones[0].id, tokenA, undefined, "DELETE");
    expect(await b.customerForPhone("0500000003")).toBeNull();
  });
});
