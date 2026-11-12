import { concat } from "./audio";

/** Match complete words, including interim STT results. Avoid substrings such as ברגע. */
export function stopWord(text: string): string | null {
  return text.normalize("NFKD").replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "")
    .split(/[^\u05D0-\u05EAa-z]+/i).find((w) => ["רגע", "שתוק", "שתקי", "שקט", "עצור", "עצרי", "סטופ", "stop"].includes(w.toLowerCase())) ?? null;
}

/** Keep casual speech out of Gemini during its reply. Explicit stops replay the real
 * caller audio into Gemini so its generation is actually interrupted, not just hidden. */
export class NavigationSpeechGate {
  enabled = false;
  muted = false;
  private busyUntil = 0;
  private playbackUntil = 0;
  private ring: Uint8Array[] = [];
  private ringBytes = 0;
  private stopped = false;
  private stopAt = 0;

  busy(now = Date.now(), timeoutMs = 15_000) { this.busyUntil = now + timeoutMs; }
  generated() { this.busyUntil = 0; }
  played(now = Date.now()) { this.playbackUntil = now + 200; }
  complete() { this.busyUntil = 0; this.muted = false; }
  interrupted() { this.complete(); }

  blocked(outputPending: boolean, now = Date.now()) {
    return this.enabled && !this.stopped && (outputPending || now < this.playbackUntil || now < this.busyUntil);
  }

  remember(pcm16k: Uint8Array) {
    this.ring.push(pcm16k); this.ringBytes += pcm16k.byteLength;
    while (this.ringBytes > 3 * 32_000 && this.ring.length > 1) this.ringBytes -= this.ring.shift()!.byteLength;
  }

  stop(text: string, active: boolean, now = Date.now()): { word: string; audio: Uint8Array } | null {
    const word = stopWord(text);
    if (!this.enabled || this.stopped || !active || !word || now - this.stopAt < 1500) return null;
    this.stopAt = now; this.stopped = true; this.muted = true;
    this.busyUntil = 0; this.playbackUntil = 0;
    const audio = concat(this.ring);
    this.ring = []; this.ringBytes = 0;
    return { word, audio };
  }

  /** A new request/announcement begins after an explicit stop. */
  resume() { this.stopped = false; }
}

export const STOP_LISTENER_SETUP = {
  setup: {
    model: "models/gemini-3.5-transcribe-live",
    inputAudioTranscription: { languageCodes: ["he-IL"] },
  },
};
