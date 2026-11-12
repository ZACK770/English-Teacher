/** Local speech-end is an acoustic estimate. Provider transcript arrival and actual
 * first playback are independently timed so late transcripts cannot produce negatives. */
export class NavigationLatency {
  private lastVoiceAt = 0;
  private lastLoggedEnd = 0;
  private id = 0;
  private request: { request_id: number; source: string; transcript_at_ms: number | null; speech_end_estimate_at_ms: number | null } | null = null;

  input(pcm8k: Uint8Array, now = Date.now()) {
    const view = new DataView(pcm8k.buffer, pcm8k.byteOffset, pcm8k.byteLength);
    let sum = 0;
    for (let i = 0; i + 1 < pcm8k.length; i += 2) sum += view.getInt16(i, true) ** 2;
    if (pcm8k.length && Math.sqrt(sum / (pcm8k.length / 2)) >= 500) this.lastVoiceAt = now;
    if (this.lastVoiceAt > this.lastLoggedEnd && now - this.lastVoiceAt >= 500) {
      this.lastLoggedEnd = this.lastVoiceAt;
      return { speech_end_estimate_at_ms: this.lastVoiceAt, silence_observed_ms: now - this.lastVoiceAt, method: "local_pcm_rms_500" };
    }
    return null;
  }

  transcript(now = Date.now()) {
    this.request = { request_id: ++this.id, source: "driver", transcript_at_ms: now, speech_end_estimate_at_ms: this.lastVoiceAt && now - this.lastVoiceAt < 60_000 ? this.lastVoiceAt : null };
    return { ...this.request, speech_end_to_transcript_ms: this.request.speech_end_estimate_at_ms === null ? null : now - this.request.speech_end_estimate_at_ms };
  }
  event() { this.request = { request_id: ++this.id, source: "navigation_event", transcript_at_ms: null, speech_end_estimate_at_ms: null }; }
  firstAudio(now = Date.now()) {
    const r = this.request ?? { request_id: ++this.id, source: "unattributed", transcript_at_ms: null, speech_end_estimate_at_ms: null };
    this.request = null;
    return { ...r, first_audio_at_ms: now, transcript_to_first_audio_ms: r.transcript_at_ms !== null && r.transcript_at_ms <= now ? now - r.transcript_at_ms : null };
  }
}
