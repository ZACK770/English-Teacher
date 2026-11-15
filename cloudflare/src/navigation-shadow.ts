import type { Env } from "./env";

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const NOVA = "@cf/deepgram/nova-3";
const RATE = 8000, PRE_ROLL = 4800, MAX_BYTES = 15 * 2 * RATE, END_SILENCE_MS = 600, MAX_UTTERANCES = 40;

export function loud(pcm: Uint8Array) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) sum += view.getInt16(i, true) ** 2;
  return pcm.length > 1 && Math.sqrt(sum / (pcm.length / 2)) >= 500;
}

export function wav8k(pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + pcm.length), v = new DataView(out.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  text(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); text(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type ShadowResult = { model: string; text: string; ms: number; audio_ms: number; utterance: number; error?: string };

/** Sends each caller utterance to Workers AI speech models for side-by-side logging only; never affects the call. */
export class ShadowTranscriber {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private voicedAt = 0;
  private utterances = 0;
  private tasks: Promise<void>[] = [];

  constructor(private ai: NonNullable<Env["AI"]>, private log: (r: ShadowResult) => void) {}

  push(pcm8k: Uint8Array, now = Date.now()) {
    if (loud(pcm8k)) this.voicedAt = now;
    this.chunks.push(pcm8k); this.bytes += pcm8k.length;
    if (!this.voicedAt) {
      while (this.bytes - this.chunks[0].length >= PRE_ROLL) this.bytes -= this.chunks.shift()!.length;
      return;
    }
    if (now - this.voicedAt >= END_SILENCE_MS || this.bytes >= MAX_BYTES) this.flush();
  }

  private flush() {
    const pcm = new Uint8Array(this.bytes);
    let offset = 0;
    for (const c of this.chunks) { pcm.set(c, offset); offset += c.length; }
    this.chunks = []; this.bytes = 0; this.voicedAt = 0;
    const audioMs = Math.round(pcm.length / 16);
    if (audioMs < 700 || this.utterances >= MAX_UTTERANCES) return;
    const utterance = ++this.utterances, wav = wav8k(pcm);
    this.tasks.push(this.run(WHISPER, utterance, audioMs, async () => {
      const r = await this.ai.run(WHISPER, { audio: base64(wav), language: "he", task: "transcribe", vad_filter: true, condition_on_previous_text: false }) as { text?: string };
      return r.text ?? "";
    }), this.run(NOVA, utterance, audioMs, async () => {
      const r = await this.ai.run(NOVA, { audio: { body: new Response(wav).body, contentType: "audio/wav" }, language: "he", smart_format: true }) as
        { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
      return r.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    }));
  }

  private async run(model: string, utterance: number, audioMs: number, call: () => Promise<string>) {
    const at = Date.now();
    try { this.log({ model, text: (await call()).trim(), ms: Date.now() - at, audio_ms: audioMs, utterance }); }
    catch (error) { this.log({ model, text: "", ms: Date.now() - at, audio_ms: audioMs, utterance, error: error instanceof Error ? error.message.slice(0, 200) : "failed" }); }
  }

  async drain() { await Promise.allSettled(this.tasks); }
}
