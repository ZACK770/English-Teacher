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
vi.mock("../../src/components/portal/portalApi", () => ({ apiPrefix: "", portalRequest: vi.fn() }));
import { VoiceRoom } from "../../src/components/portal/VoiceRoom";

let resume, getUserMedia, done, cleanup;
const render = () => {
  hooks.stateIndex = hooks.refIndex = 0;
  return renderToStaticMarkup(createElement(VoiceRoom, { token: "test", botId: "teacher", name: "דוד", onDone: done }));
};
beforeEach(() => {
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
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });
describe("voice entry recovery", () => {
  it("shows microphone permission guidance with retry and a working exit", async () => {
    cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(render()).toContain("אין גישה למיקרופון – אפשרו גישה בדפדפן ונסו שוב"));
    expect(render()).toContain("נסו שוב");
    expect(render()).toContain("בחזרה לפורטל");
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
    expect(render()).toContain("בחזרה לפורטל");
    expect(getUserMedia).not.toHaveBeenCalled();
    hooks.refs[1].current();
    expect(done).toHaveBeenCalledOnce();
  });
  it("keeps exit visible while microphone permission is pending", () => {
    getUserMedia.mockImplementation(() => new Promise(() => {}));
    cleanup = hooks.effects[0]();
    expect(render()).toContain("בחזרה לפורטל");
    expect(render()).not.toContain('role="alert"');
  });
});
