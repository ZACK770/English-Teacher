import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RouteGuidance, usableFix, parseRoute, GUIDANCE_MAX_AGE_MS } from "../src/navigation-route";
import { navigationStart } from "../src/navigation-session";

const NOW = Date.parse("2026-11-10T15:00:00Z");
const fix = (overrides = {}) => ({ latitude: 32, longitude: 34, speed_mps: 10, heading: 90, accuracy_m: 5, fix_at_ms: Date.now(), ...overrides });
const route = () => ({ points: [[32, 34], [32, 34.01], [32.01, 34.01], [32.01, 34.02]],
  cumulative: [0, 943, 2055, 2998], seconds: 500, steps: [
    { along: 0, instruction: "התחל מזרחה", maneuver: "DEPART" },
    { along: 943, instruction: "פנה שמאלה לרחוב בדיקה", maneuver: "TURN_LEFT" },
    { along: 2055, instruction: "בכיכר צא ביציאה השנייה", maneuver: "ROUNDABOUT_RIGHT" },
  ] });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("navigation start-frame boundary", () => {
  const raw = JSON.stringify({ type: "start", token: "navigation-test-channel", callId: "test-nav-call", caller: "private", format: "pcm16;rate=8000;ch=1" });
  it("requires BOTH the configured bearer and channel, not just HTTP 101", () => {
    expect(navigationStart(raw, "navigation-test-channel", "dedicated-bearer", "Bearer dedicated-bearer")).toEqual({ callId: "test-nav-call", caller: "private" });
    for (const [channel, secret, authorization] of [["navigation-test-channel", "dedicated-bearer", null], ["navigation-test-channel", "", "Bearer "], ["wrong-channel", "dedicated-bearer", "Bearer dedicated-bearer"], ["navigation-test-channel", "dedicated-bearer", "Bearer wrong"]]) {
      expect(() => navigationStart(raw, channel, secret, authorization)).toThrow();
    }
  });
});

describe("safe route guidance", () => {
  it("uses a stricter freshness threshold for spoken driving guidance than the management map", () => {
    expect(usableFix(fix())).toBe(true);
    for (const changes of [{ fix_at_ms: NOW - GUIDANCE_MAX_AGE_MS - 1 }, { fix_at_ms: NOW + 1 }, { accuracy_m: 51 }, { latitude: NaN }, { longitude: 181 }, { speed_mps: -1 }]) expect(usableFix(fix(changes))).toBe(false);
  });
  it("speaks exactly two provider maneuvers, without inventing legal-turn counts", () => {
    const result = new RouteGuidance(route()).update(fix(), true);
    expect(result.status).toBe("guidance");
    expect(result.say).toContain("פנה שמאלה לרחוב בדיקה");
    expect(result.then).toBe("לאחר מכן: בכיכר צא ביציאה השנייה");
    expect(result.say).not.toContain("השנייה");
  });
  it("remains silent on long straight sections and suppresses duplicate announcements", () => {
    const nav = new RouteGuidance(route());
    expect(nav.update(fix()).status).toBe("silent");
    expect(nav.update(fix(), true).say).not.toBe("");
    expect(nav.update(fix()).say).toBe("");
  });
  it("never treats a sign report as a completed turn", () => {
    const nav = new RouteGuidance(route());
    const before = nav.update(fix(), true);
    expect(nav.reportSeen().status).toBe("seen");
    expect(nav.update(fix(), true)).toEqual(before);
  });
  it("speaks the provider departure instruction instead of a dead-end heading question while stationary", () => {
    const nav = new RouteGuidance(route());
    expect(nav.update(fix({ speed_mps: 0, heading: 90 }), true)).toEqual({ status: "depart", say: "התחל מזרחה" });
    expect(nav.update(fix({ speed_mps: 0, heading: 90 })).status).toBe("silent");
  });
  it("retains a recent trusted movement heading while stopped, not a stationary course", () => {
    const nav = new RouteGuidance(route());
    nav.update(fix(), true);
    vi.setSystemTime(NOW + 5000);
    expect(nav.update(fix({ speed_mps: 0, heading: 270 }), true).status).toBe("guidance");
  });
  it("requires three DISTINCT contradictory fixes before requesting a reroute", () => {
    const nav = new RouteGuidance(route());
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(NOW + i * 5000);
      const f = fix({ heading: 270 });
      expect(nav.update(f).status).toBe(i < 2 ? "position_uncertain" : "reroute");
      if (i === 0) for (let j = 0; j < 5; j++) expect(nav.update(f).status).toBe("position_uncertain");
    }
  });
  it("does not let stale or future GPS generate directions, even on explicit request", () => {
    for (const f of [null, fix({ fix_at_ms: NOW - GUIDANCE_MAX_AGE_MS - 1000 }), fix({ fix_at_ms: NOW + 1000 })]) {
      expect(new RouteGuidance(route()).update(f, true).status).toBe("gps_unavailable");
    }
  });
  it("gives a conflicting driver report precedence by stopping old instructions", () => {
    const nav = new RouteGuidance(route()); nav.update(fix(), true);
    expect(nav.reportConflict().status).toBe("manual_confirmation");
    expect(nav.update(fix(), true).status).toBe("manual_confirmation");
  });
  it("returns the full verified remaining route only on request", () => {
    const result = new RouteGuidance(route()).update(fix(), true, true);
    expect(result.status).toBe("overview");
    expect(result.say).toContain("פנה שמאלה"); expect(result.say).toContain("בכיכר");
    expect(result.then).toBeUndefined();
  });
  it("rejects malformed/missing geometry and empty provider responses", () => {
    for (const payload of [{}, { routes: [] }, { routes: [{ duration: "5s", legs: [] }] }]) expect(() => parseRoute(payload)).toThrow();
  });
});
