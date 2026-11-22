import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const hooks = vi.hoisted(() => ({ values: [], refs: [], effects: [], stateIndex: 0, refIndex: 0, capture: true }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal(),
  useState: initial => {
    const i = hooks.stateIndex++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], value => { hooks.values[i] = value; }];
  },
  useRef: initial => hooks.refs[hooks.refIndex++] ?? (hooks.refs[hooks.refIndex - 1] = { current: initial }),
  useEffect: effect => { if (hooks.capture) hooks.effects.push(effect); },
}));
vi.mock("../../src/components/portal/portalApi", () => ({
  apiPrefix: "",
  PortalError: class extends Error { constructor(message, status) { super(message); this.status = status; } },
  portalRequest: vi.fn(),
}));
vi.mock("lucide-react", () => ({ Mic: () => null, MicOff: () => null, PhoneOff: () => null }));
import { VoiceRoom } from "../../src/components/portal/VoiceRoom";
import { PortalError, portalRequest } from "../../src/components/portal/portalApi";

let resume, getUserMedia, done, cleanup;
const render = () => {
  hooks.stateIndex = hooks.refIndex = 0;
  return renderToStaticMarkup(createElement(VoiceRoom, { token: "test", botId: "teacher", name: "דוד", onDone: done }));
};
it("shows the recording and 90-day retention notice before connecting", () => {
  expect(render()).toContain("השיעור באתר מוקלט לצורך בקרת איכות ונשמר 90 יום");
  expect(portalRequest).not.toHaveBeenCalled();
});
beforeEach(() => {
  portalRequest.mockReset().mockResolvedValue({ ticket: "test-ticket" });
  Object.assign(hooks, { values: [], refs: [], effects: [], stateIndex: 0, refIndex: 0, capture: true });
  resume = vi.fn(async () => {});
  getUserMedia = vi.fn(async () => { throw new DOMException("Denied", "NotAllowedError"); });
  done = vi.fn();
  vi.stubGlobal("window", { AudioWorkletNode: class {} });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", class {
    state = "running";
    resume = resume;
    async close() { this.state = "closed"; }
  });
  render();
  hooks.capture = false;
});

describe("voice socket closure", () => {
  let sockets, stop, addModule;
  const connect = async () => {
    cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].onopen();
    return sockets[0];
  };
  beforeEach(() => {
    sockets = [];
    stop = vi.fn();
    addModule = vi.fn(async () => {});
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal("location", { origin: "https://school.example", protocol: "https:" });
    vi.stubGlobal("WebSocket", class {
      static OPEN = 1;
      constructor() { sockets.push(this); }
      close = vi.fn();
    });
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    vi.stubGlobal("AudioWorkletNode", class {
      port = {};
      connect = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal("AudioContext", class {
      state = "running";
      resume = resume;
      audioWorklet = { addModule };
      createMediaStreamSource = node;
      createGain = () => ({ ...node(), gain: { value: 1 } });
      createBuffer = (_channels, count, rate) => ({ duration: count / rate, getChannelData: () => new Float32Array(count) });
      createBufferSource = () => ({ ...node(), start: vi.fn() });
      currentTime = 0;
      async close() { this.state = "closed"; }
    });
  });
  it("does not close the client socket while waiting for the teacher", async () => {
    const socket = await connect();
    expect(socket.close).not.toHaveBeenCalled();
    expect(render()).toContain("עוד רגע, המורה מצטרף");
    expect(render()).not.toContain('role="alert"');
  });
  it("silently retries a timed-out worklet load without asking for the microphone again", async () => {
    vi.useFakeTimers();
    addModule.mockImplementationOnce(() => new Promise(() => {}));
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(5000);
    expect(addModule).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(portalRequest).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    expect(render()).not.toContain('role="alert"');
  });
  it("aborts a stalled ticket request and silently retries once before opening a single socket", async () => {
    vi.useFakeTimers();
    portalRequest.mockImplementationOnce(() => new Promise(() => {}));
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(8000);
    expect(portalRequest).toHaveBeenCalledTimes(2);
    expect(portalRequest.mock.calls[0][4].aborted).toBe(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    expect(render()).not.toContain('role="alert"');
  });
  it("stops retrying ticket requests after a second transient failure", async () => {
    portalRequest.mockRejectedValue(new PortalError("שירות השיחות אינו זמין", 503));
    cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(render()).toContain("שירות השיחות אינו זמין"));
    expect(portalRequest).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(0);
    expect(stop).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429])("does not retry ticket rejection %d", async status => {
    portalRequest.mockRejectedValue(new PortalError("לא ניתן לפתוח שיחה", status));
    cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(render()).toContain("לא ניתן לפתוח שיחה"));
    expect(portalRequest).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(0);
  });
  it("cancels a pending ticket when exiting without retrying", async () => {
    vi.useFakeTimers();
    portalRequest.mockImplementation(() => new Promise(() => {}));
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(0);
    hooks.refs[1].current();
    await vi.advanceTimersByTimeAsync(8000);
    expect(portalRequest).toHaveBeenCalledOnce();
    expect(portalRequest.mock.calls[0][4].aborted).toBe(true);
    expect(sockets).toHaveLength(0);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("leaves a stalled socket handshaking only for a bounded time and never opens another", async () => {
    vi.useFakeTimers();
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(10000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).toHaveBeenCalledOnce();
    expect(render()).toContain("השיחה לא התחברה");
  });
  it("clears the startup deadline when the teacher is ready", async () => {
    vi.useFakeTimers();
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets[0];
    socket.onopen();
    socket.onmessage({ data: JSON.stringify({ type: "ready" }) });
    await vi.advanceTimersByTimeAsync(40000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(render()).not.toContain('role="alert"');
  });
  it("shows a connection error with retry and exit, not a balance error, on a no-audio close", async () => {
    const socket = await connect();
    socket.onclose({ code: 1006, reason: "", wasClean: false });
    expect(render()).toContain("החיבור לשיחה נסגר לפני שהמורה התחיל לדבר");
    expect(render()).not.toContain("יתרת הדקות");
    expect(render()).not.toContain("שיחות הטעימה נוצלו");
    expect(render()).toContain("לנסות שוב");
    expect(render()).toContain("חזרה לאזור האישי");
    expect(stop).toHaveBeenCalled();
  });
  it("still offers retry if the socket closes after ready and silent audio", async () => {
    const socket = await connect();
    socket.onmessage({ data: JSON.stringify({ type: "ready" }) });
    socket.onmessage({ data: new Int16Array(160).buffer });
    socket.onmessage({ data: JSON.stringify({ type: "hangup", reason: "idle_timeout" }) });
    socket.onclose({ code: 1000, reason: "session ended", wasClean: true });
    expect(render()).toContain("החיבור לשיחה נסגר לפני שהמורה התחיל לדבר");
    expect(render()).toContain("לנסות שוב");
  });
  it("preserves a real server access rejection instead of replacing it with the generic error", async () => {
    const socket = await connect();
    socket.onmessage({ data: JSON.stringify({ type: "hangup", reason: "access_blocked" }) });
    socket.onclose({ code: 1000, reason: "session ended", wasClean: true });
    expect(render()).toContain("שיחות הטעימה נוצלו ואין דקות בחבילה");
    expect(render()).not.toContain("החיבור לשיחה נסגר לפני");
  });
  it("uses the connection fallback for an unrecognized hangup, not a balance suggestion", async () => {
    const socket = await connect();
    socket.onmessage({ data: JSON.stringify({ type: "hangup", reason: "unknown" }) });
    socket.onclose({ code: 1000, reason: "session ended", wasClean: true });
    expect(render()).toContain("החיבור לשיחה נסגר לפני שהמורה התחיל לדבר");
    expect(render()).not.toContain("יתרת הדקות");
  });
  it("closes the socket intentionally on unmount without showing a connection error", async () => {
    const socket = await connect();
    cleanup();
    expect(socket.close).toHaveBeenCalledOnce();
    socket.onclose({ code: 1000, reason: "", wasClean: true });
    expect(render()).not.toContain('role="alert"');
  });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("voice entry recovery", () => {
  it("shows microphone permission guidance with retry and a working exit", async () => {
    cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(render()).toContain("כדי לדבר כאן צריך לאפשר גישה למיקרופון בדפדפן."));
    expect(render()).toContain("לנסות שוב");
    expect(render()).toContain("חזרה לאזור האישי");
    expect(render()).not.toContain("התחל לדבר");
    hooks.refs[0].current();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    hooks.refs[1].current();
    expect(done).toHaveBeenCalledOnce();
  });
  it("reserves the gesture state for audio autoplay rejection and keeps exit reachable", async () => {
    resume.mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
    cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(render()).toContain("התחל לדבר"));
    expect(render()).toContain("חזרה לאזור האישי");
    expect(getUserMedia).not.toHaveBeenCalled();
    hooks.refs[1].current();
    expect(done).toHaveBeenCalledOnce();
  });
  it("keeps exit visible while microphone permission is pending", () => {
    getUserMedia.mockImplementation(() => new Promise(() => {}));
    cleanup = hooks.effects[0]();
    expect(render()).toContain("חזרה לאזור האישי");
    expect(render()).not.toContain('role="alert"');
  });
  it("offers a fresh gesture when resume never settles", async () => {
    vi.useFakeTimers();
    resume.mockImplementationOnce(() => new Promise(() => {}));
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(5000);
    expect(render()).toContain("התחל לדבר");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("bounds a pending microphone permission without reopening it and disposes a late stream", async () => {
    vi.useFakeTimers();
    let grant;
    getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(30000);
    expect(render()).toContain("המיקרופון לא נפתח");
    const stop = vi.fn();
    grant({ getTracks: () => [{ stop }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(portalRequest).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
});
