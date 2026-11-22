import { afterEach, expect, it, vi } from "vitest";
import { CallSession } from "../src/call";
import { controlsFromSettings } from "../src/controls";
import { type Env, settings } from "../src/env";
import { TutorSession } from "../src/session";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function session(env = {} as Env) {
  const pbx = { send: vi.fn(), close: vi.fn() };
  const tutor = new TutorSession(pbx as unknown as WebSocket, env, settings(env), "owner") as any;
  tutor.profileId = "isaac-basic";
  tutor.callId = "call";
  tutor.customerId = "customer";
  tutor.controls = controlsFromSettings(false);
  tutor.progress = { logLatency: vi.fn().mockResolvedValue(undefined) };
  return { tutor, pbx };
}

async function closedDetails(tutor: any) {
  await tutor.run("{}", null, false);
  const calls = tutor.progress.logLatency.mock.calls.filter((args: unknown[]) => args[2] === "ai_connection_closed");
  expect(calls).toHaveLength(1);
  return calls[0][5];
}

it.each([
  { code: 1000, reason: "Normal closure", wasClean: true },
  { code: 1006, reason: "", wasClean: false },
])("persists the first WebSocket close in the existing event: $code", async event => {
  const { tutor, pbx } = session();
  tutor.pbxClosed(event);
  tutor.receive(JSON.stringify({ type: "hangup" }));
  pbx.close.mockImplementation(() => tutor.pbxClosed({ code: 1000, reason: "session ended", wasClean: true }));
  expect(await closedDetails(tutor)).toEqual({
    reason: "caller_disconnected", disconnect_source: "websocket_close",
    close_code: event.code, close_reason: event.reason, was_clean: event.wasClean,
  });
  expect(pbx.send).not.toHaveBeenCalled();
});

it.each(["stop", "HANGUP", "end"])("persists the first %s control with only allowed fields", async type => {
  const { tutor } = session();
  tutor.receive(JSON.stringify({ type, code: 16, reason: "Normal clearing", wasClean: true,
    token: "private-token", audio: "private-audio", nested: { secret: "private-secret" }, phone: "0501234567" }));
  tutor.pbxClosed({ code: 1000, reason: "later close", wasClean: true });
  expect(await closedDetails(tutor)).toEqual({
    reason: "caller_disconnected", disconnect_source: "pbx_control", control_type: type.toLowerCase(),
    control_code: 16, control_reason: "Normal clearing", was_clean: true,
  });
});

it("handles a bare stop without inventing close metadata", async () => {
  const { tutor } = session();
  tutor.receive('{"type":"stop"}');
  expect(await closedDetails(tutor)).toEqual({ reason: "caller_disconnected", disconnect_source: "pbx_control", control_type: "stop" });
});

it("ignores malformed, audio and unrelated control fields", () => {
  const { tutor } = session();
  for (const text of ["{", "null", '{"type":"audio","reason":"secret"}']) tutor.receive(text);
  tutor.receive(new ArrayBuffer(320));
  expect(tutor.reason).toBe("");
  expect(tutor.disconnectDetails).toEqual({});
  tutor.receive('{"type":"end","code":"secret","reason":{"token":"secret"},"wasClean":"secret"}');
  expect(tutor.disconnectDetails).toEqual({ disconnect_source: "pbx_control", control_type: "end" });
});

it.each(["control", "close"])("redacts and bounds the %s reason", async source => {
  const { tutor } = session({ GEMINI_API_KEY: "private-gemini-key", TLIVR_CALLBACK_SECRET: "private-pbx-secret" } as Env);
  const reason = "private-gemini-key private-pbx-secret https://example.test/?key=other Bearer unknown token=unknown\n" + "x".repeat(200);
  if (source === "control") tutor.receive(JSON.stringify({ type: "end", reason }));
  else tutor.pbxClosed({ code: 1000, reason, wasClean: true });
  const details = await closedDetails(tutor);
  const text = details.control_reason ?? details.close_reason;
  expect(text).toContain("[redacted]");
  expect(text).toContain("[redacted URL]");
  expect(text).not.toMatch(/private|unknown|https|\n/);
  expect(text.length).toBeLessThanOrEqual(123);
});

it.each(["hard_time_limit", "gemini_budget_reached", "pbx_transport_error"])("does not relabel a server/error termination: %s", async reason => {
  const { tutor } = session();
  tutor.stop(reason, true);
  tutor.pbxClosed({ code: 1000, reason: "cleanup", wasClean: true });
  expect(await closedDetails(tutor)).toEqual({ reason });
});

it.each([false, true])("records a synchronous close before queued controls (portal: %s)", async portal => {
  class Socket extends EventTarget { accept = vi.fn(); send = vi.fn(); close = vi.fn(); }
  const server = new Socket();
  vi.stubGlobal("WebSocketPair", class { 0 = new Socket(); 1 = server; });
  const OriginalResponse = Response;
  vi.stubGlobal("Response", class extends OriginalResponse {
    constructor(body: any, init: any) { super(body, init?.status === 101 ? { status: 200 } : init); }
  });
  vi.spyOn(TutorSession.prototype, "run").mockImplementation(() => new Promise(() => {}));
  const env = {} as Env;
  const call = new CallSession({ id: { toString: () => "owner" }, waitUntil: () => {} } as unknown as DurableObjectState, env);
  await call.fetch(new Request("https://example.test" + (portal ? "/v1/portal/voice" : "/"), { headers: {
    Upgrade: "websocket", ...(portal ? { "X-Profile": "student", "X-Portal-Customer": "customer" } : {}),
  } }));
  if (!portal) server.dispatchEvent(new MessageEvent("message", { data: "{}" }));
  const tutor = (call as any).session;
  const close = Object.assign(new Event("close"), { code: 1006, reason: "", wasClean: false });
  const closed = vi.spyOn(tutor, "pbxClosed");
  server.dispatchEvent(new MessageEvent("message", { data: new Blob([new Uint8Array(320)]) }));
  server.dispatchEvent(new MessageEvent("message", { data: '{"type":"hangup"}' }));
  server.dispatchEvent(close);
  expect(closed).toHaveBeenCalledWith(close);
  expect(tutor.reason).toBe("caller_disconnected");
  expect(tutor.disconnectDetails).toEqual({ disconnect_source: "websocket_close", close_code: 1006, close_reason: "", was_clean: false });
});

it.each([false, true])("processes Blob audio before a queued hangup (portal: %s)", async portal => {
  class Socket extends EventTarget { accept = vi.fn(); send = vi.fn(); close = vi.fn(); }
  const server = new Socket();
  vi.stubGlobal("WebSocketPair", class { 0 = new Socket(); 1 = server; });
  const OriginalResponse = Response;
  vi.stubGlobal("Response", class extends OriginalResponse {
    constructor(body: any, init: any) { super(body, init?.status === 101 ? { status: 200 } : init); }
  });
  vi.spyOn(TutorSession.prototype, "run").mockImplementation(() => new Promise(() => {}));
  const env = {} as Env;
  const call = new CallSession({ id: { toString: () => "owner" }, waitUntil: () => {} } as unknown as DurableObjectState, env);
  await call.fetch(new Request("https://example.test" + (portal ? "/v1/portal/voice" : "/"), { headers: {
    Upgrade: "websocket", ...(portal ? { "X-Profile": "student", "X-Portal-Customer": "customer" } : {}),
  } }));
  if (!portal) server.dispatchEvent(new MessageEvent("message", { data: "{}" }));
  const tutor = (call as any).session;
  const received = vi.spyOn(tutor, "receive");
  const record = vi.fn();
  tutor.recorder = { receive: record };
  const pcm = new ArrayBuffer(320);
  server.dispatchEvent(new MessageEvent("message", { data: new Blob([pcm]) }));
  server.dispatchEvent(new MessageEvent("message", { data: '{"type":"hangup"}' }));
  await vi.waitFor(() => expect(tutor.reason).toBe("caller_disconnected"));
  expect(received.mock.calls).toEqual([[pcm], ['{"type":"hangup"}']]);
  expect(record).toHaveBeenCalledWith(new Uint8Array(pcm));
  expect(tutor.disconnectDetails).toEqual({ disconnect_source: "pbx_control", control_type: "hangup" });
});
