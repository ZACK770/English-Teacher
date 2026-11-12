import { afterEach, describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { NavigationAccounting, providerCost } from "../src/navigation-cost";
import { NavigationLatency } from "../src/navigation-latency";

const fx = { usd_ils: 3.172, published_at: "2026-11-11T13:23:00Z", fetched_at: "2026-11-12T11:00:00Z", source: "https://boi.org.il" };
const main = { channel: "main", model: "models/gemini-3.8-live", usage: {
  promptTokensDetails: [{ modality: "TEXT", tokenCount: 1000 }, { modality: "AUDIO", tokenCount: 2000 }],
  responseTokensDetails: [{ modality: "AUDIO", tokenCount: 3000 }], thoughtsTokenCount: 100,
} };
afterEach(() => { vi.unstubAllGlobals(); });

describe("provider-reported call cost", () => {
  it("prices modalities and thoughts separately and preserves a dated ILS rate", () => {
    const r = providerCost([main], ["main"], fx);
    expect(r.status).toBe("complete_ai");
    expect(r.known_subtotal_usd).toBeCloseTo(0.0432);
    expect(r.known_subtotal_ils).toBeCloseTo(0.0432 * 3.172);
    expect(r.exchange_rate).toEqual(fx);
    expect(r.excluded).toContain("telephony");
  });
  it("does not pretend missing listener usage or exchange rate is a free component", () => {
    const r = providerCost([main], ["main", "stop_listener"], null);
    expect(r.status).toBe("partial");
    expect(r.known_subtotal_ils).toBeNull();
    expect(r.channels[1].usd).toBeNull();
    expect(r.channels[1].missing).toContain("provider_usage_not_received");
  });
  it("prices reported listener tokens with the listener price, not the conversation model's price", () => {
    const r = providerCost([{ channel: "stop_listener", model: "gemini-3.5-transcribe-live", usage: {
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }], responseTokensDetails: [{ modality: "TEXT", tokenCount: 1000 }],
    } }], ["stop_listener"], fx);
    expect(r.known_subtotal_usd).toBeCloseTo(0.0245);
    expect(r.status).toBe("complete_ai");
  });
  it("does not infer modality or a price for an unknown model", () => {
    expect(providerCost([{ channel: "main", model: "unknown", usage: { promptTokenCount: 100 } }], ["main"], fx).known_subtotal_usd).toBeNull();
    const r = providerCost([{ channel: "main", model: main.model, usage: { promptTokenCount: 100 } }], ["main"], fx);
    expect(r.status).toBe("partial");
    expect(r.channels[0].missing).toContain("input_modality_breakdown_missing");
  });
  it("persists the exact provider payload and call summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ exchangeRates: [{ key: "USD", unit: 1, currentExchangeRate: 3.172, lastUpdate: new Date().toISOString() }] })));
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../migrations/0006_navigation_call_costs.sql", import.meta.url), "utf8"));
    const wrapper = { prepare(sql) { return { bind(...params) { return { async run() { db.prepare(sql).run(...params); } }; } }; } };
    const accounting = new NavigationAccounting(wrapper, "nav-bot", "test-call");
    accounting.expect("stop_listener"); accounting.record(main.channel, main.model, main.usage);
    const summary = await accounting.finish();
    expect(summary.status).toBe("partial");
    expect(summary.raw_usage_persisted).toBe(true);
    expect(JSON.parse(db.prepare("SELECT usage_json FROM navigation_usage_events").get().usage_json)).toEqual(main.usage);
    expect(JSON.parse(db.prepare("SELECT summary_json FROM navigation_call_costs").get().summary_json).known_subtotal_ils).toBeGreaterThan(0);
    db.close();
  });
});

describe("separate speech, transcript, generation and playback measurements", () => {
  it("times a reply from local speech end without reusing the next turn's transcript", () => {
    const t = new NavigationLatency();
    const speech = new Uint8Array(Int16Array.from([2000, -2000, 2000]).buffer);
    t.input(speech, 1000);
    expect(t.input(new Uint8Array(320), 1500)).toMatchObject({ speech_end_estimate_at_ms: 1000 });
    expect(t.transcript(1800)).toMatchObject({ speech_end_to_transcript_ms: 800 });
    const first = t.firstAudio(2200);
    expect(first.transcript_to_first_audio_ms).toBe(400);
    t.transcript(2500);
    expect(first.transcript_at_ms).toBe(1800);
    t.event();
    expect(t.firstAudio(2600).transcript_to_first_audio_ms).toBeNull();
  });
});
