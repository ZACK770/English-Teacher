import { describe, expect, it, vi } from "vitest";
import { hebrewInstruction } from "../src/navigation-route";
import { mixedAnswer, requestKey, shortAnswer } from "../src/navigation-session";
import { ShadowTranscriber, wav8k } from "../src/navigation-shadow";

describe("call 2026-11-12 15:32 regressions", () => {
  it("treats the same request with reordered keys or punctuation as a duplicate", () => {
    expect(requestKey({ intent: "destination", destination: "רחוב הברזל 9 בתל אביב" }))
      .toBe(requestKey({ destination: "הברזל 9, בתל-אביב.", intent: "destination" }));
    expect(requestKey({ intent: "confirm" })).not.toBe(requestKey({ intent: "decline" }));
  });

  it("separates a bare yes, a refusal and a mixed answer", () => {
    expect(shortAnswer("כן.")).toBe("confirm");
    expect(shortAnswer("כן, כן, כן.")).toBe("confirm");
    expect(shortAnswer("לא, עד לא, אני רוצה")).toBe(null);
    expect(mixedAnswer("לא, עד לא, אני רוצה")).toBe(true);
    expect(mixedAnswer("לא, תודה")).toBe(false);
  });

  it("rewrites Google's plural instructions into singular Hebrew with adverbial directions", () => {
    expect(hebrewInstruction("התקדמו דרום על אהרונוביץ' לכיוון חבקוק")).toBe("סע דרומה באהרונוביץ' לכיוון חבקוק");
    expect(hebrewInstruction("פנו ימינה לרחוב חבקוק")).toBe("פנה ימינה לרחוב חבקוק");
    expect(hebrewInstruction("המשיכו צפון מזרח")).toBe("המשך צפון-מזרחה");
    expect(hebrewInstruction("פנה שמאלה לרחוב עזרא")).toBe("פנה שמאלה לרחוב עזרא");
  });
});

describe("shadow speech recognition", () => {
  const tone = (ms, amp) => { const pcm = new Uint8Array(ms * 16), v = new DataView(pcm.buffer); for (let i = 0; i < pcm.length; i += 2) v.setInt16(i, i % 4 ? amp : -amp, true); return pcm; };

  it("writes a valid 8 kHz WAV header", () => {
    const wav = wav8k(new Uint8Array(320)), v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(40, true)).toBe(320);
  });

  it("sends one finished utterance to both models and logs results without throwing", async () => {
    const run = vi.fn(async (model) => model.includes("whisper") ? { text: " כן " } : { results: { channels: [{ alternatives: [{ transcript: "כן" }] }] } });
    const logs = [];
    const shadow = new ShadowTranscriber({ run }, (r) => logs.push(r));
    let now = 0;
    for (let i = 0; i < 50; i++) shadow.push(tone(20, 3000), now += 20);
    for (let i = 0; i < 40; i++) shadow.push(tone(20, 0), now += 20);
    await shadow.drain();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).toMatchObject({ language: "he" });
    expect(logs.map((l) => [l.model, l.text])).toEqual([["@cf/openai/whisper-large-v3-turbo", "כן"], ["@cf/deepgram/nova-3", "כן"]]);
  });

  it("ignores silence and logs model errors", async () => {
    const logs = [];
    const shadow = new ShadowTranscriber({ run: async () => { throw new Error("down"); } }, (r) => logs.push(r));
    let now = 0;
    for (let i = 0; i < 100; i++) shadow.push(tone(20, 0), now += 20);
    for (let i = 0; i < 50; i++) shadow.push(tone(20, 3000), now += 20);
    for (let i = 0; i < 40; i++) shadow.push(tone(20, 0), now += 20);
    await shadow.drain();
    expect(logs).toHaveLength(2);
    expect(logs[0].error).toBe("down");
  });
});
