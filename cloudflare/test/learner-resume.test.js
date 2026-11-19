import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

const hooks = vi.hoisted(() => ({ effects: [] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal(),
  useEffect: effect => { hooks.effects.push(effect); },
}));
vi.mock("../../src/components/portal/portalApi", () => ({ resumeLearnerSession: vi.fn() }));
vi.mock("../../src/components/portal/LearnerPortal", () => ({ PHONE_LINE: "076-5673575" }));
vi.mock("../../src/components/portal/EmailLogin", () => ({ EmailLogin: () => null }));
vi.mock("../../src/components/portal/DirectVoice", () => ({ DirectVoice: () => null }));
vi.mock("../../src/components/portal/LessonCallbackForm", () => ({ LessonCallbackForm: () => null }));
vi.mock("../../src/components/legal/LegalFooter", () => ({ LegalFooter: () => null }));
vi.mock("../../src/components/brand/SpeakCallLogo", () => ({ SpeakCallLogo: () => null }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null, ArrowUpRight: () => null, Phone: () => null, Monitor: () => null, Ear: () => null, Mic: () => null, RefreshCw: () => null }));
import { resumeLearnerSession } from "../../src/components/portal/portalApi";
import { SpeakoolLanding } from "../../src/components/portal/SpeakoolLanding";

let cleanup;
beforeEach(() => {
  hooks.effects = [];
  resumeLearnerSession.mockReset().mockResolvedValue(false);
  vi.stubGlobal("location", { pathname: "/", hash: "" });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("PopStateEvent", Event);
  vi.stubGlobal("history", { replaceState: vi.fn((_, __, path) => { location.pathname = path; }) });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });
const mount = () => { renderToStaticMarkup(createElement(SpeakoolLanding)); cleanup = hooks.effects[0](); };

describe("landing session resume", () => {
  it.each(["", "/english"])("resumes to the existing learner home under %s without a reload", async base => {
    location.pathname = base + "/";
    resumeLearnerSession.mockResolvedValue(true);
    const navigation = vi.fn();
    window.addEventListener("popstate", navigation);
    mount();
    await vi.waitFor(() => expect(history.replaceState).toHaveBeenCalledWith(null, "", base + "/learn"));
    expect(navigation).toHaveBeenCalledOnce();
    expect(resumeLearnerSession).toHaveBeenCalledOnce();
  });
  it("keeps signup visible when no valid session can be resumed", async () => {
    mount();
    await Promise.resolve();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
  it("rechecks a token on browser back navigation", async () => {
    mount();
    await Promise.resolve();
    resumeLearnerSession.mockResolvedValue(true);
    window.dispatchEvent(new Event("popstate"));
    await vi.waitFor(() => expect(location.pathname).toBe("/learn"));
  });
  it("does not redirect after unmount or keep its navigation listener", async () => {
    let resolve;
    resumeLearnerSession.mockImplementation(() => new Promise(done => { resolve = done; }));
    mount();
    cleanup();
    resolve(true);
    await Promise.resolve();
    window.dispatchEvent(new Event("popstate"));
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(resumeLearnerSession).toHaveBeenCalledOnce();
  });
  it("subscribes App routing to browser history changes and removes the listener", () => {
    const source = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
    expect(source).toContain("window.addEventListener('popstate', handleHash)");
    expect(source).toContain("window.removeEventListener('popstate', handleHash)");
  });
});
