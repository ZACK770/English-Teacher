import { afterEach, expect, it, vi } from "vitest";
import { visiblePhone, CALL_FAILURE_MESSAGE, HIDDEN_CALLER_MESSAGE } from "../src/phone";
import { normalizedPhone } from "../src/business";
import { lessonSummaryAudioText, normalizePhone, submitCallback } from "../src/callbacks";
import { TutorSession } from "../src/session";
import { GeminiLive } from "../src/gemini";
import { BasicTranslator } from "../src/basic";
import { HAREDI_CONTENT_RULE } from "../src/content-rules";
import { NEUTRAL_HEBREW } from "../src/customer-language";
import * as google from "../src/google";
import { settings, type Env } from "../src/env";
import { handleCallback } from "../src/pbx";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("reads the measured outcome of a lesson without gendered address", () => {
  expect(lessonSummaryAudioText(24, 8)).toContain("בתרגול נצברו 24 נקודות");
  expect(lessonSummaryAudioText(undefined, 8)).toContain("היום היו 8 תורות דיבור");
});

it.each(["", "anonymous", "unknown", "private", "restricted", "blocked", "מספר חסוי", "0000000000", "12345", "abc0501234567", "+", "0501234567ext1"])("rejects hidden or invalid identity %s", async (phone) => {
  expect(visiblePhone(phone)).toBeNull();
  expect(() => normalizedPhone(phone)).toThrow();
  expect(normalizePhone(phone)).toBeNull();
  await expect(submitCallback(new Request("https://example.test", { method: "POST", body: JSON.stringify({ phone, name: "test", for_whom: "self", timing: "now", consent: true }) }), {} as Env)).rejects.toMatchObject({ status: 422 });
});

it.each(["0501234567", "+972 50-123-4567", "972501234567", "(050) 123-4567"])("preserves valid identity %s", (phone) => {
  expect(visiblePhone(phone)).toBe("0501234567");
  expect(normalizedPhone(phone)).toBe("0501234567");
  expect(normalizePhone(phone)).toBe("0501234567");
});

it("rejects hidden IVR callers before any database or teacher access and hangs up after the prompt", async () => {
  const env = {} as Env;
  const s = { ...settings(env), projectEnabled: true, callbackSecret: "secret", systems: [{ phone: "0765673575", base: "/" }] };
  const url = "https://example.test?key=secret&PBXcallId=hidden&PBXnum=0765673575&PBXextensionPath=1&PBXphone=anonymous";
  const response = await handleCallback(new Request(url), env, s, "school");
  expect(response).toMatchObject({ type: "simpleMenu", files: [{ text: HIDDEN_CALLER_MESSAGE }], times: 1 });
  expect(await handleCallback(new Request(url + "&hiddenCallerEnd=END"), env, s, "school")).toEqual({ type: "hangup" });
});

it("uses a system instruction for basic translation and returns the spoken refusal without a transcript", async () => {
  const refusal = "אפשר לומר משפט אחר לתרגום.";
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ heard: "", translation: refusal, language: "he-IL" }) }] } }],
  }));
  const env = {} as Env;
  const result = await new BasicTranslator(env, settings(env), "English").translate(new Uint8Array(320), new AbortController().signal);
  const body = JSON.parse(fetch.mock.calls[0][1]?.body as string);
  expect(body.systemInstruction.parts[0].text).toBe(HAREDI_CONTENT_RULE);
  expect(body.systemInstruction.parts[1].text).toContain(NEUTRAL_HEBREW);
  expect(body.systemInstruction.parts[0].text).toContain("Translation: politely decline inappropriate input without transcribing or translating.");
  expect(body.systemInstruction.parts.map((part: { text: string }) => part.text).join("").split(HAREDI_CONTENT_RULE)).toHaveLength(2);
  expect(body.systemInstruction.parts[1].text).toContain("selected English");
  expect(body.contents).toEqual([{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data: expect.any(String) } }] }]);
  expect(result).toMatchObject({ heard: "", text: refusal, language: "he-IL" });
});

it("requests a male TTS voice for the basic translator and keeps male selection on fallback", async () => {
  vi.spyOn(google, "googleToken").mockResolvedValue({ token: "test" });
  const post = vi.spyOn(google, "postJson").mockResolvedValue({ audioContent: "" });
  const env = {} as Env;
  const translator = new BasicTranslator(env, settings(env));
  await translator.speak("Hello", "en");
  expect(post.mock.calls[0][1]).toMatchObject({ voice: { languageCode: "en-US", ssmlGender: "MALE" } });
  post.mockRejectedValueOnce({ status: 400 });
  await translator.speak("שלום", "he", "Standard-B");
  expect(post.mock.calls[1][1]).toMatchObject({ voice: { languageCode: "he-IL", name: "he-IL-Standard-B" } });
  expect(post.mock.calls[2][1]).toMatchObject({ voice: { languageCode: "he-IL", ssmlGender: "MALE" } });
});

function session() {
  const pbx = { send: vi.fn(), close: vi.fn() };
  const env = {} as Env;
  const tutor = new TutorSession(pbx as unknown as WebSocket, env, settings(env), "owner") as any;
  tutor.artifact = { setup_message: { setup: { model: "model", sessionResumption: {} } } };
  tutor.progress = { logDiagnostic: vi.fn().mockResolvedValue(undefined) };
  tutor.ai = { resumeHandle: "resume-handle", close: vi.fn() };
  return { tutor, pbx };
}

it("rejects a hidden router stream with speech and hangup before Gemini, identity, or quota access", async () => {
  vi.useFakeTimers();
  const { tutor, pbx } = session();
  tutor.s.routerChannels = ["router"];
  const connect = vi.spyOn(GeminiLive.prototype, "connect");
  const speak = vi.spyOn(BasicTranslator.prototype, "speak").mockResolvedValue(new Uint8Array(320));
  const running = tutor.run(JSON.stringify({ type: "start", token: "router", callId: "hidden", caller: "", format: "pcm16;rate=8000;ch=1" }), null, true);
  await vi.runAllTimersAsync();
  await running;
  expect(connect).not.toHaveBeenCalled();
  expect(speak).toHaveBeenCalledWith(HIDDEN_CALLER_MESSAGE, "he-IL");
  expect(pbx.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "hangup" }));
  expect(pbx.close).toHaveBeenCalledWith(1000, "session ended");
});

it("reconnects with the same setup and resumption handle and excludes the gap", async () => {
  const { tutor } = session();
  const connect = vi.spyOn(GeminiLive.prototype, "connect").mockResolvedValue();
  await tutor.reconnectGemini();
  expect(connect).toHaveBeenCalledExactlyOnceWith(5000);
  expect(tutor.ai.setup).toEqual({ setup: { model: "model", sessionResumption: { handle: "resume-handle" } } });
  expect(tutor.failureStarted).toBeNull();
  expect(tutor.reason).toBe("");
  expect(tutor.finalMessage).toBeNull();
});

it.each([{ history: [] }, { history: [{ role: "learner", text: "hello" }] }])("prompts an audible continuation without a resumption handle and with history $history", async ({ history }) => {
  const { tutor } = session();
  tutor.ai.resumeHandle = null;
  tutor.meter.transcript.push(...history);
  vi.spyOn(GeminiLive.prototype, "connect").mockResolvedValue();
  const send = vi.spyOn(GeminiLive.prototype, "send").mockImplementation(() => {});
  await tutor.reconnectGemini();
  expect(send).toHaveBeenCalledWith({ clientContent: {
    turns: [{ role: "user", parts: [{ text: "Continue the interrupted lesson without repeating the greeting. Recent conversation: " + JSON.stringify(history) }] }],
    turnComplete: true,
  } });
});

it("unexpected closure retries twice, records exhaustion, and selects a spoken apology", async () => {
  const { tutor } = session();
  tutor.ai.next = vi.fn().mockResolvedValue({ type: "closed" });
  const connect = vi.spyOn(GeminiLive.prototype, "connect").mockRejectedValue(new Error("offline"));
  await tutor.aiToOutput();
  expect(connect).toHaveBeenCalledTimes(2);
  expect(tutor.finalMessage).toBe(CALL_FAILURE_MESSAGE);
  expect(tutor.reason).toBe("gemini_reconnect_exhausted");
  expect(tutor.failureStarted).not.toBeNull();
  expect(tutor.progress.logDiagnostic).toHaveBeenCalledWith("", "", "gemini_reconnect_exhausted", { attempts: 2 });
});

it("requests playback preservation when Gemini sends a graceful go-away", async () => {
  const { tutor } = session();
  tutor.ai.next = vi.fn().mockResolvedValue({ type: "go_away", detail: {} });
  const reconnect = vi.spyOn(tutor, "reconnectGemini").mockImplementation(async () => { tutor.abort.abort(); });
  await tutor.aiToOutput();
  expect(reconnect).toHaveBeenCalledExactlyOnceWith(true);
});

it.each([true, false])("preserves buffered and partial playback only for graceful reconnection: %s", async (graceful) => {
  const { tutor } = session();
  const output = [new Uint8Array(320).fill(1)];
  const partial = new Uint8Array([2, 3]);
  const carry = new Uint8Array([4, 5]);
  tutor.output = output;
  tutor.partial = partial;
  tutor.carry = carry;
  vi.spyOn(GeminiLive.prototype, "connect").mockResolvedValue();
  await tutor.reconnectGemini(graceful);
  expect(tutor.output).toEqual(graceful ? output : []);
  expect(tutor.partial).toEqual(graceful ? partial : new Uint8Array());
  expect(tutor.carry).toEqual(graceful ? carry : new Uint8Array());
});

it("turns a mid-call provider error into a recoverable closure", async () => {
  const ai = new GeminiLive("wss://example.test", "test", {});
  (ai as any).dispatch({ error: { code: 503 } });
  expect(await ai.next()).toEqual({ type: "closed" });
});

it("does not reconnect or apologize after intentional cancellation", async () => {
  const { tutor } = session();
  tutor.abort.abort();
  const connect = vi.spyOn(GeminiLive.prototype, "connect");
  await tutor.reconnectGemini();
  expect(connect).not.toHaveBeenCalled();
  expect(tutor.finalMessage).toBeNull();
});

it("plays independent Cloud TTS audio at phone cadence, including a padded final frame", async () => {
  vi.useFakeTimers();
  const { tutor, pbx } = session();
  vi.spyOn(BasicTranslator.prototype, "speak").mockResolvedValue(new Uint8Array(322).fill(1));
  const playing = tutor.speakFinalMessage(CALL_FAILURE_MESSAGE);
  await vi.runAllTimersAsync();
  await playing;
  expect(pbx.send).toHaveBeenCalledTimes(2);
  expect(pbx.send.mock.calls[1][0]).toHaveLength(320);
});

it("logs a failed independent prompt without preventing clean termination", async () => {
  const { tutor } = session();
  tutor.callId = "call";
  vi.spyOn(BasicTranslator.prototype, "speak").mockRejectedValue(new Error("tts offline"));
  await tutor.speakFinalMessage(CALL_FAILURE_MESSAGE);
  expect(tutor.progress.logDiagnostic).toHaveBeenCalledWith("", "call", "failure_prompt_failed");
});
