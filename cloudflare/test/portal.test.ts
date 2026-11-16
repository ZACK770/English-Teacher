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
import { cleanupPortalAuth } from "../src/portal-auth";
import worker from "../src/index";
import { LearningStore } from "../src/learning";

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
    const call = (phone: string, path: string, id: string, extra = "") => handleCallback(new Request(`https://x/v1/technoline/ivr/main?key=cb&PBXcallId=${id}&PBXnum=${phone}&PBXextensionPath=${encodeURIComponent(path)}&PBXphone=private${extra}`), pbxEnv, settings(pbxEnv), "main");
    expect((await call("0765674434", "/", "root-call", "&isaacMain=1")).goTo).toBe("/7");
    expect((await b.loadContext("root-call")).pbx_base).toBe("/");
    expect((await call("0765674434", "/", "root-menu", "&isaacMain=9")).goTo).toBe("/9");
    expect((await call("0765673575", "/99", "old-call", "&isaacMain=1")).goTo).toBe("/99/7");
    await expect(call("0765673575", "/5", "taxi-call")).rejects.toMatchObject({ status: 403 });
    await expect(call("0700000000", "/", "foreign-call")).rejects.toMatchObject({ status: 400 });
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
    expect(base.voice).toBe(defaults.voice);
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
    const snapshots = db.sql.prepare("SELECT opening_message,setup_json FROM prompt_snapshots").all();
    expect(snapshots.length).toBe(enabled ? 1 : 0);
    expect(JSON.stringify(snapshots).includes(text)).toBe(enabled);
    const turns = db.sql.prepare("SELECT text FROM conversation_turns").all();
    expect(turns.length).toBe(enabled ? 1 : 0);
    const session = db.sql.prepare("SELECT transcript_json FROM sessions WHERE student_id='learner-a'").get();
    expect(session).toBeTruthy();
    expect(String(session!.transcript_json).includes(text)).toBe(enabled);
  });
  it.each(["", "/english"])("consumes a %s browser voice ticket atomically and forwards only its verified customer", async (prefix) => {
    const created = await (await request("/v1/portal/voice-ticket", tokenA, { bot_id: "student" })).json() as any;
    const forward = vi.fn(async (r: Request) => Response.json({ customer: r.headers.get("X-Portal-Customer"), bot: r.headers.get("X-Profile"), path: new URL(r.url).pathname, search: new URL(r.url).search }));
    env.CALLS = { newUniqueId: () => "test-object", get: () => ({ fetch: forward }) } as unknown as DurableObjectNamespace;
    const url = "https://school.example" + prefix + "/v1/portal/voice?ticket=" + created.ticket;
    const connect = () => worker.fetch(new Request(url, { headers: { Upgrade: "websocket", "X-Portal-Customer": "learner-b" } }), env);
    expect(await (await connect()).json()).toEqual({ customer: "learner-a", bot: "student", path: "/v1/portal/voice", search: "" });
    expect((await connect()).status).toBe(401);
    expect(forward).toHaveBeenCalledOnce();
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

describe("Technoline caller-ID login", () => {
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
    const result = await verified.json() as any;
    expect(await b.portalCustomer(result.token)).toBe("learner-a");
    expect(await b.portalCustomer(tokenA)).toBe("learner-a");
    expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(401);
  });
  it("limits retries and rejects expired challenges", async () => {
    const id = await challenge();
    const wrong = code === "111111" ? "222222" : "111111";
    for (let n = 0; n < 5; n++) expect((await request("/v1/portal/auth/verify", "", { challenge: id, code: wrong })).status).toBe(401);
    expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(401);
    await b.putSetting("portal-auth:" + id, { phone: "0500000001", attempts: 0, expires: 0 });
    expect((await request("/v1/portal/auth/verify", "", { challenge: id, code })).status).toBe(401);
  });
  it("returns a clear unavailable state if Technoline rejects the source IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    expect((await request("/v1/portal/auth/start", "", { phone: "0500000001" })).status).toBe(503);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM console_settings WHERE id LIKE 'portal-auth:%'").get()?.n).toBe(0);
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
