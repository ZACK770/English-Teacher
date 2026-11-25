import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ContentSafetyStore, ContentTurn, STRIKE_WINDOW_MS, adminContentSafety, confirmCriticalIncident, contentPolicy,
  dispatchContentAlert, matchedTerms,
} from "../src/content-safety";
import { settings, type Env } from "../src/env";
import { TutorSession } from "../src/session";
import { CONTENT_BLOCKED_MESSAGE } from "../../src/contentSafetyCopy";

const policy = { tutor: ["critical", "bad phrase", "מילה"], learner: ["topic", "another"], critical: ["critical"] };
const owner = { username: "owner", role: "owner" } as const;
const route = "/v1/admin/crm/content-safety";
let sqlite: DatabaseSync, env: Env, store: ContentSafetyStore, ai: ReturnType<typeof vi.fn>, fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0034_content_safety.sql", import.meta.url), "utf-8"));
  type Statement = { result: () => { results: Record<string, unknown>[]; meta: { changes: number } } };
  const DB = {
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      let args: SQLInputValue[] = [];
      const result = () => /^SELECT/i.test(query)
        ? { results: stmt.all(...args), meta: { changes: 0 } }
        : { results: [], meta: { changes: Number(stmt.run(...args).changes) } };
      const prepared = {
        bind(...values: SQLInputValue[]) { args = values; return prepared; },
        first: async (column?: string) => {
          const row = stmt.get(...args) ?? null;
          return column && row ? row[column] ?? null : row;
        },
        run: async () => result(), result,
      };
      return prepared;
    },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try { const result = statements.map(stmt => stmt.result()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  ai = vi.fn();
  fetchMock = vi.fn().mockImplementation(async () => Response.json({ status: "OK", errorCode: 0 }));
  vi.stubGlobal("fetch", fetchMock);
  env = {
    DB, AI: { run: ai }, CONTENT_SAFETY_MODE: "on", CONTENT_SAFETY_LISTS: JSON.stringify(policy),
    CONTENT_SAFETY_ALERT_TO: "0501111111", CONTENT_SAFETY_ALERT_FROM: "021111111", TLIVR_SYSTEM_API_KEY: "local-test",
  } as unknown as Env;
  store = new ContentSafetyStore(DB);
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

it("requires explicit enablement, all lists, and an alarm configuration", () => {
  expect(contentPolicy({} as Env)).toBeNull();
  expect(contentPolicy(env)).toEqual(policy);
  expect(() => contentPolicy({ ...env, CONTENT_SAFETY_LISTS: "{}" })).toThrow();
  expect(() => contentPolicy({ ...env, CONTENT_SAFETY_ALERT_FROM: undefined })).toThrow();
});

it("matches complete words and phrases across transcript chunks, not prefixes", () => {
  const turn = new ContentTurn(policy);
  expect(turn.transcript("tutor", "A BAD ph")).toBe(false);
  expect(turn.transcript("tutor", "rase")).toBe(false);
  expect(turn.transcript("tutor", ", please")).toBe(true);
  expect(turn.finish()).toMatchObject({ tutor: true, learner: false, critical: [] });
  expect(matchedTerms("uncritical, bad phrases and מִילָה.", policy.tutor)).toEqual(["מילה"]);
  expect(turn.transcript("tutor", "critical", true)).toBe(true);
  turn.interrupt();
  expect(turn.finish().critical).toEqual([]);
});

it("counts an utterance at most once, expires old strikes, and clears the count only after restore", async () => {
  const now = Date.now();
  expect(await store.strike("learner", "expired", now - STRIKE_WINDOW_MS - 1)).toBe(false);
  expect(await store.strike("learner", "one", now - STRIKE_WINDOW_MS)).toBe(false);
  expect(await store.strike("learner", "one", now)).toBe(false);
  expect(await store.strike("learner", "two", now)).toBe(false);
  expect(await store.strike("other", "other", now)).toBe(false);
  expect(await store.strike("learner", "three", now)).toBe(true);
  expect(await store.denied("learner")).toBe("content_blocked");
  expect(await store.denied("other")).toBeNull();
  const incident = (await store.status("learner")).customer!.incident_id;
  expect(await store.restore(incident)).toBe(true);
  expect(await store.strike("learner", "new", now)).toBe(false);
  await store.block("learner");
  expect(await store.restore(incident)).toBe(false);
  expect(await store.denied("learner")).toBe("content_blocked");
});

it("clears queued web audio and stops a teacher event before later frames or model tools", async () => {
  const socket = { send: vi.fn() }, submitToolResult = vi.fn(), close = vi.fn();
  const session = new TutorSession(socket as unknown as WebSocket, env, settings(env), "test", null,
    { customerId: "learner", teacherId: "teacher" }) as any;
  session.customerId = "learner";
  session.safety = new ContentTurn(policy);
  session.output = [new Uint8Array([1, 2])];
  const next = vi.fn().mockResolvedValueOnce({ type: "transcript", role: "tutor", text: "a bad phrase." })
    .mockResolvedValueOnce({ type: "tool_call", calls: [{ name: "end_session" }] });
  session.ai = { next, close, submitToolResult };
  await session.aiToOutput();
  expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "clear_audio" }));
  expect(session.output).toHaveLength(0);
  expect(session.finalMessage).toBe(CONTENT_BLOCKED_MESSAGE);
  expect(close).toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(submitToolResult).not.toHaveBeenCalled();
  expect(await store.denied("learner")).toBe("content_blocked");
});

it("counts one completed learner turn regardless of how many words match", async () => {
  const session = new TutorSession({} as WebSocket, env, settings(env), "test") as any;
  session.customerId = "learner";
  const turn = new ContentTurn(policy);
  turn.transcript("learner", "topic, another topic");
  expect(await session.finishContentTurn(turn)).toBe(false);
  expect(await session.finishContentTurn(turn)).toBe(false);
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM content_safety_strikes").get()).toEqual({ n: 1 });
});

it("does not suspend teachers on uncertain or mismatched audio; the confirmed incident calls once", async () => {
  const audio = new Uint8Array([0, 25]);
  const segment = { text: "critical", avg_logprob: -0.2, no_speech_prob: 0.01 };
  ai.mockResolvedValueOnce({ segments: [{ ...segment, no_speech_prob: 0.8 }] })
    .mockResolvedValueOnce({ segments: [{ ...segment, text: "uncritical" }] })
    .mockResolvedValue({ segments: [segment] });
  await confirmCriticalIncident(env, audio, ["critical"]);
  await confirmCriticalIncident(env, audio, ["critical"]);
  expect(await store.denied("anyone")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  await Promise.all([confirmCriticalIncident(env, audio, ["critical"]), confirmCriticalIncident(env, audio, ["critical"])]);
  await dispatchContentAlert(env);
  expect(await store.denied("anyone")).toBe("content_suspended");
  expect((await store.status(null)).teacher?.alert_state).toBe("accepted");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    action: "campaignRun", callId: "021111111", phones: ["0501111111"], dialRetries: 0,
  });
});

it("keeps the suspension on provider rejection without dialing a second time", async () => {
  fetchMock.mockRejectedValue(new Error("provider unavailable"));
  await dispatchContentAlert(env, (await store.suspend())!);
  await dispatchContentAlert(env);
  expect((await store.status(null)).teacher?.alert_state).toBe("failed");
  expect(await store.denied("learner")).toBe("content_suspended");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("restores only for the configured CRM owner, not staff, other owners or bearer callers", async () => {
  const incident = await store.suspend();
  const request = () => new Request("https://test.invalid" + route + "/restore", { method: "POST", body: JSON.stringify({ incident_id: incident }) });
  for (const identity of [{ ...owner, bearer: true }, { username: "other-owner", role: "owner" }, { username: "owner", role: "staff" }] as const) {
    await expect(adminContentSafety(request(), env, route + "/restore", identity)).rejects.toMatchObject({ status: 403 });
  }
  expect(await store.denied("learner")).toBe("content_suspended");
  expect((await adminContentSafety(request(), env, route + "/restore", owner))?.status).toBe(200);
  expect(await store.denied("learner")).toBeNull();
});
