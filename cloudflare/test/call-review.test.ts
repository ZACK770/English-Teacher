import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import type { Env } from "../src/env";
import { HAREDI_CONTENT_RULE } from "../src/content-rules";
import { callCostReport, callReviewReport, runCallReviews, sampleTutorTranscript, syncCallReviewPhone } from "../src/call-review";
import worker from "../src/index";

const now = Date.parse("2026-11-22T13:00:00Z");
const time = "2026-11-22T12:30:00.000Z";
const transcript = JSON.stringify([{ role: "learner", text: "I need help." }, { role: "tutor", text: "Say: I need help." }]);
let sql: DatabaseSync, env: Env;
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  const dir = new FileURL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL(file, dir), "utf8"));
  const db = {
    prepare(query: string) {
      const numbered = /\?\d/.test(query);
      const statement = sql.prepare(query);
      let args: SQLInputValue[] = [];
      const values = () => Object.fromEntries(args.map((value, i) => [`?${i + 1}`, value]));
      const wrapper = {
        bind: (...a: SQLInputValue[]) => { args = a; return wrapper; },
        first: async () => (numbered ? statement.get(values()) : statement.get(...args)) ?? null,
        all: async () => ({ results: numbered ? statement.all(values()) : statement.all(...args) }),
        run: async () => numbered ? statement.run(values()) : statement.run(...args),
      };
      return wrapper;
    },
    batch: (statements: { all: () => unknown }[]) => Promise.all(statements.map(s => s.all())),
  };
  env = { DB: db, CALL_REVIEW_ENABLED: "1", GEMINI_API_KEY: "test", ADMIN_BEARER_SECRET: "admin-test" } as unknown as Env;
  sql.prepare("INSERT OR IGNORE INTO bots(id,label,role,active_version,created_at,updated_at) VALUES ('coach','Coach','teacher',1,?,?)").run(time, time);
});
afterEach(() => { sql.close(); vi.unstubAllGlobals(); });

function session(id: string, text: string | null = transcript, learner = "learner-" + id) {
  sql.prepare("INSERT INTO call_customers VALUES (?,?, 'coach','phone',?)").run(id, learner, time);
  sql.prepare(`INSERT INTO sessions(student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,
    observations_json,transcript_json,estimated_cost_usd,cost_basis,model)
    VALUES (?,?,?,?,60,1,1,'[]',?,0.12,'gemini_usage_metadata','models/gemini-3.8-live')`).run(learner, id, time, time, text);
  sql.prepare(`INSERT INTO prompt_snapshots(created_at,profile_id,call_id,bot_version,fingerprint,
    system_instruction,opening_message,history_context,setup_json) VALUES (?,'coach',?,1,'abc','','','','{}')`).run(time, id);
}

function judge(issue: string, excerpt: number, content_drift_excerpt = 0) {
  return Response.json({ usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 30, thoughtsTokenCount: 5 },
    candidates: [{ content: { parts: [{ text: JSON.stringify({ issue, excerpt, content_drift_excerpt }) }] } }] });
}

describe("finished-call review", () => {
  it("samples throughout the call and removes obvious contact data", () => {
    const turns = Array.from({ length: 15 }, (_, i) => [
      { role: "learner", text: "Please try +972-50-123-4567 and private@example.com" },
      { role: "tutor", text: `Turn ${i}. Click https://example.com/private` },
    ]).flat();
    const excerpts = sampleTutorTranscript(JSON.stringify(turns));
    expect(excerpts).toHaveLength(8);
    expect(excerpts[0]).toEqual({ learner: "Please try [number]and [email]", tutor: "Turn 0. Click [link]" });
    expect(excerpts.at(-1)?.tutor).toBe("Turn 14. Click [link]");
    expect(sampleTutorTranscript("not a transcript")).toEqual([]);
  });

  it("only spends on teacher transcripts and reports a repeated issue without changing prompts", async () => {
    const fetch = vi.fn(async () => judge("no_practice", 1));
    vi.stubGlobal("fetch", fetch);
    session("a", transcript, "same");
    session("b", transcript, "same");
    session("c");
    session("missing", null);
    sql.prepare(`INSERT INTO latency_events(created_at,profile_id,call_id,event_name,since_call_start_ms,since_previous_ms,details_json)
      VALUES (?,'coach','failed-before-save','ai_connection_closed',50,50,'{"reason":"gemini_budget_reached"}')`).run(time);
    sql.prepare("INSERT INTO console_records VALUES ('ivr-events','menu',?,?,?)").run(JSON.stringify({
      call_id: "phone", route: "options", input: { isaacOption: "ERROR" }, output: { type: "hangup" },
    }), time, time);
    await runCallReviews(env, now);
    await runCallReviews(env, now + 600_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    const report = await callReviewReport(env, now);
    expect(report.coverage).toContainEqual(expect.objectContaining({ status: "no_transcript", logs: 1 }));
    expect(report.findings).toContainEqual({ code: "menu_error:options", logs: 1 });
    expect(report.findings).toContainEqual({ code: "gemini_budget_reached", logs: 1 });
    expect(report.prompt_candidates).toEqual([expect.objectContaining({
      profile_label: "Coach", bot_version: 1, code: "no_practice", affected: 3, learners: 2, status: "requires_validation",
      evidence_call_ids: expect.arrayContaining(["a", "b", "c"]),
    })]);
    expect(sql.prepare("SELECT active_version FROM bots WHERE id='coach'").get()?.active_version).toBe(1);
  });

  it("does not count invalid provider output as a success and retains its token counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => judge("no_practice", 99)));
    session("a");
    await runCallReviews(env, now);
    expect(sql.prepare("SELECT status,input_tokens,output_tokens,findings FROM call_reviews").get())
      .toEqual({ status: "failed", input_tokens: 500, output_tokens: 35, findings: "[]" });
  });

  it("persists content drift independently of the existing quality issue in the same review", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => judge("no_practice", 1, 1));
    vi.stubGlobal("fetch", fetch);
    const drift = JSON.stringify([{ role: "tutor", text: "Let's practice discussing movies." }]);
    session("drift", drift);
    await runCallReviews(env, now);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(body.systemInstruction.parts[0].text).toContain(HAREDI_CONTENT_RULE);
    expect(body.generationConfig.responseSchema.required).toContain("content_drift_excerpt");
    const report = await callReviewReport(env, now);
    expect(report.findings).toContainEqual({ code: "content_drift", logs: 1 });
    expect(report.recent).toContainEqual(expect.objectContaining({ call_id: "drift", findings: [
      { code: "no_practice", excerpt: 1 }, { code: "content_drift", excerpt: 1 },
    ] }));
  });

  it("does not double-send concurrent jobs and bounds transient retries", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    session("a");
    await Promise.all([runCallReviews(env, now), runCallReviews(env, now)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const minutes of [10, 31, 62, 93]) await runCallReviews(env, now + minutes * 60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sql.prepare("SELECT status FROM call_reviews").get()?.status).toBe("failed");
  });

  it("combines segment estimates but never substitutes navigation time for billed charges", async () => {
    env.TLIVR_SYSTEM_API_KEY = "pbx-test";
    env.TECHNOLINE_ILS_PER_MINUTE = "0.5";
    sql.prepare("INSERT INTO call_customers VALUES ('parent','learner','ivr','phone',?)").run(time);
    session("parent~12345678");
    session("parent~abc01234");
    session("parent~notasuffix");
    const start = Date.parse(time) / 1000;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "Ok", calls: [
      { callId: "parent", start, end: start + 120, seconds: 120, phone: "0501234567" },
      { callId: "unrelated", start, end: start + 60, seconds: 60, phone: "0501234567" },
    ] })));
    await syncCallReviewPhone(env, now);
    expect(sql.prepare("SELECT * FROM call_review_phone").all()).toEqual([
      { call_id: "parent", navigation_seconds: 120, observed_at: "2026-11-22T12:32:00.000Z" },
    ]);
    expect(await callCostReport(env, "parent")).toMatchObject({
      ai_estimated_usd: 0.24, phone: { estimated_ils: 1, basis: "technoline_navigation_not_billed_seconds" }, invoice_total: null,
    });
    delete env.TECHNOLINE_ILS_PER_MINUTE;
    expect((await callCostReport(env, "parent")).phone?.estimated_ils).toBeNull();
  });

  it("restricts the report to authenticated owners", async () => {
    const url = "https://speakool.net/v1/admin/call-reviews";
    expect((await worker.fetch(new Request(url), env)).status).toBe(401);
    const response = await worker.fetch(new Request(url, { headers: { Authorization: "Bearer admin-test" } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
