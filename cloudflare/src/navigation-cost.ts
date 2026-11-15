export const PRICE_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";
export const FX_SOURCE = "https://boi.org.il/PublicApi/GetExchangeRates?asXml=false";
const VERIFIED_AT = "2026-11-12";
type Rates = { input_text: number; input_audio: number; output_text: number; output_audio: number };
const LIVE: Rates = { input_text: 0.75, input_audio: 3, output_text: 4.5, output_audio: 12 };
const RATES: Record<string, Rates> = {
  "gemini-3.8-live": LIVE,
  "gemini-3.8-live-extended-thinking": LIVE,
  "gemini-3.1-flash-live-preview": LIVE,
  "gemini-3.5-transcribe-live": { input_text: 0, input_audio: 3.5, output_text: 21, output_audio: 0 },
  "gemini-3.5-flash-lite": { input_text: 0.3, input_audio: 0.3, output_text: 2.5, output_audio: 0 },
};
export interface ExchangeRate { usd_ils: number; published_at: string; fetched_at: string; source: string }
let cached: ExchangeRate | null = null;

export async function usdIls(): Promise<ExchangeRate | null> {
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 3600_000) return cached;
  try {
    const response = await fetch(FX_SOURCE, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const data = await response.json() as { exchangeRates?: { key: string; currentExchangeRate: number; unit: number; lastUpdate: string }[] };
    const rate = data.exchangeRates?.find((r) => r.key === "USD");
    if (!rate || rate.unit !== 1 || !Number.isFinite(rate.currentExchangeRate) || rate.currentExchangeRate <= 0 || !Number.isFinite(Date.parse(rate.lastUpdate)) || Date.now() - Date.parse(rate.lastUpdate) > 7 * 86400_000) return null;
    cached = { usd_ils: rate.currentExchangeRate, published_at: rate.lastUpdate, fetched_at: new Date().toISOString(), source: FX_SOURCE };
    return cached;
  } catch { return null; }
}

export type UsageRecord = { channel: string; model: string; usage: Record<string, any> };
export function providerCost(records: UsageRecord[], expected: string[], fx: ExchangeRate | null) {
  const channels = [...new Set([...expected, ...records.map((r) => r.channel)])].map((channel) => {
    const rows = records.filter((r) => r.channel === channel), model = rows[0]?.model ?? null;
    const rates = model ? RATES[model.replace(/^models\//, "")] : undefined;
    const tokens = { input_text: 0, input_audio: 0, output_text: 0, output_audio: 0, thoughts: 0 };
    const missing: string[] = [];
    if (!rows.length) missing.push("provider_usage_not_received");
    if (model && !rates) missing.push("model_price_not_configured");
    for (const { usage: u } of rows) {
      const add = (details: unknown, direction: "input" | "output", total: unknown) => {
        if (!Array.isArray(details)) {
          // Text-only models report no output breakdown; their output can only be text.
          if (direction === "output" && rates && !rates.output_audio && Number(total) > 0) { tokens.output_text += Number(total); return; }
          if (Number(total) > 0) missing.push(`${direction}_modality_breakdown_missing`);
          return;
        }
        for (const d of details) {
          const n = Number(d.tokenCount), mode = String(d.modality).toLowerCase();
          if (!Number.isFinite(n) || n < 0 || !["audio", "text"].includes(mode)) { missing.push("unsupported_usage_modality"); continue; }
          tokens[`${direction}_${mode}` as "input_audio"] += n;
        }
      };
      add(u.promptTokensDetails, "input", u.promptTokenCount);
      add(u.responseTokensDetails ?? u.candidatesTokensDetails, "output", u.responseTokenCount ?? u.candidatesTokenCount);
      const thought = Number(u.thoughtsTokenCount ?? 0);
      if (Number.isFinite(thought) && thought >= 0) tokens.thoughts += thought;
      if (!("promptTokenCount" in u || "totalTokenCount" in u || u.promptTokensDetails || u.responseTokensDetails || u.candidatesTokensDetails)) missing.push("unrecognized_usage_payload");
    }
    // Thoughts are priced as output text. No audio-duration extrapolation is called reported usage.
    const usd = rates && rows.length ? (tokens.input_text * rates.input_text + tokens.input_audio * rates.input_audio + (tokens.output_text + tokens.thoughts) * rates.output_text + tokens.output_audio * rates.output_audio) / 1e6 : null;
    return { channel, model, event_count: rows.length, tokens, usd, ils: usd !== null && fx ? usd * fx.usd_ils : null, missing: [...new Set(missing)], rates_per_million: rates ?? null };
  });
  const known = channels.filter((c) => c.usd !== null), usd = known.length ? known.reduce((n, c) => n + c.usd!, 0) : null;
  return { basis: "google_reported_tokens_x_published_prices", status: channels.every((c) => !c.missing.length) && fx ? "complete_ai" : "partial",
    known_subtotal_usd: usd, known_subtotal_ils: usd !== null && fx ? usd * fx.usd_ils : null,
    exchange_rate: fx, price_source: PRICE_SOURCE, price_verified_at: VERIFIED_AT,
    channels, excluded: ["google_maps_places_routes", "telephony", "cloud_tts_if_used", "taxes"],
    note: "Calculated from reported usage, not a final Google invoice. A partial subtotal excludes missing components." };
}

/** Persist each raw provider report before calculating a dated, reproducible call summary. */
export class NavigationAccounting {
  private records: UsageRecord[] = [];
  private expected = ["main"];
  private pending = Promise.resolve();
  private storageFailed = false;
  private fx = usdIls(); // Background fetch: never hold the greeting waiting for currency data.
  constructor(private db: D1Database, private profileId: string, private callId: string) {}
  private units: Record<string, number> = {};
  /** Non-Gemini usage counted per call (Places, Routes, TTS characters, shadow STT seconds); not priced yet. */
  count(unit: string, amount = 1) { this.units[unit] = (this.units[unit] ?? 0) + amount; }
  expect(channel: string) { if (!this.expected.includes(channel)) this.expected.push(channel); }
  record(channel: string, model: string, usage: Record<string, unknown>) {
    this.records.push({ channel, model, usage });
    const at = new Date().toISOString();
    this.pending = this.pending.then(async () => {
      await this.db.prepare("INSERT INTO navigation_usage_events(call_id,profile_id,channel,model,reported_at,usage_json) VALUES(?,?,?,?,?,?)")
        .bind(this.callId, this.profileId, channel, model, at, JSON.stringify(usage)).run();
    }).catch(() => { this.storageFailed = true; });
  }
  async finish() {
    await this.pending;
    const fx = await this.fx;
    const summary = { ...providerCost(this.records, this.expected, fx), raw_usage_persisted: !this.storageFailed, metered_units: this.units,
      ...estimates(this.units, this.records, fx) };
    if (this.storageFailed) summary.status = "partial";
    await this.db.prepare("INSERT OR REPLACE INTO navigation_call_costs(call_id,profile_id,computed_at,summary_json) VALUES(?,?,?,?)")
      .bind(this.callId, this.profileId, new Date().toISOString(), JSON.stringify(summary)).run();
    return summary;
  }
}

/** Published per-minute prices for streams whose usage may not be reported per event (Live Transcribe). */
const PER_MINUTE_USD: Record<string, number> = { "transcribe_audio_ms": 0.009 };

/** Estimated cost of metered streams with no provider token report, kept apart from the reported subtotal. */
export function estimates(units: Record<string, number>, records: UsageRecord[], fx: ExchangeRate | null) {
  const reported = records.some((r) => r.model.replace(/^models\//, "") === "gemini-3.5-transcribe-live");
  const usd = reported ? 0 : Object.entries(PER_MINUTE_USD).reduce((n, [unit, rate]) => n + (units[unit] ?? 0) / 60000 * rate, 0);
  return usd ? { estimated_unreported_usd: usd, estimated_unreported_ils: fx ? usd * fx.usd_ils : null, estimate_basis: "published blended Live Transcribe rate ~$0.009/min x streamed audio" } : {};
}
