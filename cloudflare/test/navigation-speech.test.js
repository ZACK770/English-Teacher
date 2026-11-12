import { describe, it, expect } from "vitest";
import { NavigationSpeechGate, stopWord } from "../src/navigation-speech";

describe("explicit stop word instead of every voice activity", () => {
  it("matches full words and Hebrew punctuation/nikud", () => {
    for (const text of ["רגע!", "רֶגַע רגע", "שתוק", "שתקי בבקשה", "עצור", "שקט", "STOP"]) expect(stopWord(text)).not.toBeNull();
    for (const text of ["מה עכשיו", "רגעים", "ברגע שתגיע", "אני רוצה להגיע לרחוב הרגעים"]) expect(stopWord(text)).toBeNull();
  });
  it("gates speech while working or playing, but an explicit stop reopens input and replays its actual audio", () => {
    const gate = new NavigationSpeechGate(); gate.enabled = true;
    expect(gate.blocked(false, 10000)).toBe(false);
    gate.busy(10000);
    expect(gate.blocked(false, 10500)).toBe(true);
    gate.generated(); gate.played(11000);
    expect(gate.blocked(false, 11100)).toBe(true);
    expect(gate.blocked(false, 11300)).toBe(false);
    expect(gate.blocked(true, 11300)).toBe(true);
    gate.remember(new Uint8Array([1, 2, 3, 4]));
    expect(gate.stop("שמעת אותי?", true, 11400)).toBeNull();
    const stopped = gate.stop("רגע רגע", true, 11500);
    expect(stopped.word).toBe("רגע");
    expect([...stopped.audio]).toEqual([1, 2, 3, 4]);
    expect(gate.muted).toBe(true);
    expect(gate.blocked(true, 11600)).toBe(false);
    expect(gate.stop("רגע רגע", true, 15000)).toBeNull(); // interim + final must stop only once
    gate.interrupted();
    expect(gate.muted).toBe(false);
    gate.resume(); gate.played(16000);
    expect(gate.blocked(true, 16000)).toBe(true);
    expect(gate.stop("שתוק", true, 16500).word).toBe("שתוק");
  });
  it("doesn't gate when listener is unavailable; the replay buffer stays bounded", () => {
    const gate = new NavigationSpeechGate(); gate.busy(10000);
    expect(gate.blocked(true, 11000)).toBe(false);
    gate.enabled = true;
    for (let i = 0; i < 10; i++) gate.remember(new Uint8Array(32000));
    expect(gate.stop("רגע", true, 11000).audio.byteLength).toBeLessThanOrEqual(96000);
  });
});
