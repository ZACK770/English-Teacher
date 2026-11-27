import { resolveTurnTuning, type TurnTuning } from "./turn-tuning";
import { b64decode, meanSquare } from "./audio";
import { synthesizeGoogleStandard } from "./pbx-pilot-google";
import type { PilotInterruption } from "./env";
import { AsyncQueue } from "./async";
import type { GeminiEvent, ToolCall } from "./gemini";
import type { TranscriptCoach, CoachDecision } from "./lesson-coach";
import type { LessonPlan } from "./learning";
import { assessSemantic, semanticDirective, type SemanticInput } from "./lesson-semantic-observer";

type Message = Record<string, unknown>;
export type CascadeConfig = {
  sonioxKey: string;
  openrouterKey: string;
  inworldKey: string;
  googleKey?: string;
  interruption?: PilotInterruption;
  endpointMs?: number;
  tuning?: TurnTuning;
  model: string;
  voice: string;
};
type Setup = {
  setup?: {
    systemInstruction?: { parts?: { text?: string }[] };
    tools?: { functionDeclarations?: { name: string; description?: string; parameters?: Message }[] }[];
    inputAudioTranscription?: { languageCodes?: string[]; customVocabulary?: string[] };
    generationConfig?: { temperature?: number };
    realtimeInputConfig?: {
      activityHandling?: string;
      automaticActivityDetection?: { silenceDurationMs?: number };
    };
  };
};
type GeneratedTool = { id: string; type: "function"; function: { name: string; arguments: string } };

// Acoustic evidence alone needs sustained sound; recognized speech may interrupt sooner.
const RECOGNIZED_SPEECH_SECONDS = 0.09;

const ENDPOINTS = new Set(["<end>", "<fin>"]);
const STT_URL = "https://stt-rt.soniox.com/transcribe-websocket";
const LLM_URL = "https://openrouter.ai/api/v1/chat/completions";
const SPEECH_URL = "https://api.inworld.ai/tts/v1/voice:stream";

async function* lines(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("empty_body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done) break;
      let offset: number;
      while ((offset = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, offset).trim();
        buffer = buffer.slice(offset + 1);
      }
      if (buffer.length > 2_000_000) throw new Error("frame_too_large");
    }
    if (buffer.trim()) yield buffer.trim();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class CascadeLive {
  readonly resumeHandle = null;
  private readonly events = new AsyncQueue<GeminiEvent>();
  private readonly history: Message[] = [];
  private readonly context: string[] = [];
  private readonly toolReplies = new Map<string, (value: Message) => void>();
  private readonly tuning: TurnTuning;
  private readonly setup: NonNullable<Setup["setup"]>;
  private socket: WebSocket | null = null;
  private generation: AbortController | null = null;
  private closed = false;
  private learnerText = "";
  private speechFrames = 0;
  private audioUntil = 0;
  private learnerActive = false;
  private pauseStarted: number | null = null;
  private lastLoud = 0;
  private holdOutputForInterrupt = false;
  private candidateSuppressed = false;

  private get adaptive() {
    return this.config.interruption === "adaptive" || this.config.interruption === "adaptive_clear";
  }

  playbackPaused(now = Date.now()) {
    if (this.pauseStarted !== null && (now - this.lastLoud >= this.tuning.resumeSilenceMs || now - this.pauseStarted >= 1100)) {
      this.events.push({ type: "pilot_interruption", phase: "resumed", elapsed_ms: now - this.pauseStarted });
      this.pauseStarted = null;
    }
    return this.adaptive && (this.pauseStarted !== null || this.holdOutputForInterrupt);
  }

  acknowledgeInterrupt() { this.holdOutputForInterrupt = false; }

  constructor(
    private readonly config: CascadeConfig,
    setup: Setup,
    private readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly coach?: TranscriptCoach,
    private readonly tutorPlaybackDrained: () => boolean = () => true,
    private readonly semantic?: { model: string; mode: "shadow" | "active" },
  ) {
    this.setup = setup.setup ?? {};
    this.tuning = resolveTurnTuning(config.tuning);
  }

  async connect(timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await this.request(STT_URL, {
      headers: { Upgrade: "websocket", Authorization: "Bearer " + this.config.sonioxKey },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    const socket = response.webSocket;
    if (!socket) throw new Error("Cascade Soniox upgrade failed: " + response.status);
    if (this.closed) return;
    this.socket = socket;
    socket.accept();
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || this.closed) return;
      try { this.transcription(JSON.parse(event.data)); } catch { this.close(); }
    });
    socket.addEventListener("close", () => this.close());
    socket.addEventListener("error", () => this.close());
    const languages = this.setup.inputAudioTranscription?.languageCodes
      ?.map((language) => language.toLowerCase().split("-")[0])
      .filter((language) => /^[a-z]{2}$/.test(language));
    const terms = this.setup.inputAudioTranscription?.customVocabulary?.slice(0, 100);
    const silenceMs = this.config.endpointMs ?? this.setup.realtimeInputConfig?.automaticActivityDetection?.silenceDurationMs ?? 500;
    socket.send(JSON.stringify({
      model: "stt-rt-v6", audio_format: "pcm_s16le", num_channels: 1, sample_rate: 16000,
      language_hints: languages?.length ? [...new Set(languages)] : ["he", "en"],
      enable_endpoint_detection: true, max_endpoint_delay_ms: Math.min(3000, Math.max(500, silenceMs)),
      ...(terms?.length ? { context: { terms } } : {}),
    }));
  }

  next(): Promise<GeminiEvent> {
    return this.events.next().then((event) => event ?? { type: "closed" });
  }

  sendAudio(pcm: Uint8Array) {
    if (!this.socket || this.closed || !pcm.byteLength) return;
    this.socket.send(pcm);
    const sampleSeconds = pcm.byteLength / 32000;
    if (this.setup.realtimeInputConfig?.activityHandling !== "NO_INTERRUPTION" &&
        (this.generation || Date.now() < this.audioUntil)) {
      this.speechFrames = meanSquare(pcm) > this.tuning.energyThreshold ** 2 ? this.speechFrames + sampleSeconds : 0;
      const now = Date.now();
      if (this.speechFrames === 0) this.candidateSuppressed = false;
      else this.lastLoud = now;
      const minimum = this.adaptive ? this.tuning.minSoundMs / 1000 : RECOGNIZED_SPEECH_SECONDS;
      if (this.speechFrames + 1e-9 < minimum) return;
      if (!this.adaptive && this.config.interruption !== "observe") {
        this.interrupt();
      } else if (this.pauseStarted === null && !this.candidateSuppressed) {
        this.candidateSuppressed = true;
        this.pauseStarted = now;
        this.events.push({ type: "pilot_interruption", phase: "candidate", elapsed_ms: 0 });
      }
    } else {
      this.speechFrames = 0;
      this.candidateSuppressed = false;
    }
  }

  startGreeting(text: string) { this.prompt(text); }
  addContext(text: string) { this.context.push(text); }
  prompt(text: string) { this.launch(text); }
  updateCoachDelivery(plan: Pick<LessonPlan, "level" | "conversation_mode" | "correction_policy">) { this.coach?.updateDelivery(plan); }
  repetitionOnlyTargets() { return this.coach?.repetitionOnlyTargets() ?? []; }

  submitToolResult(call: ToolCall, saved: boolean, result?: Message) {
    if (call.id) this.toolReplies.get(call.id)?.(result ?? { saved });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation?.abort();
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(1000, "done"); } catch { /* already closed */ }
    this.events.end();
  }

  private interrupt() {
    this.coach?.tutorInterrupted();
    const pauseMs = this.pauseStarted === null ? undefined : Date.now() - this.pauseStarted;
    this.pauseStarted = null;
    this.candidateSuppressed = false;
    this.holdOutputForInterrupt = this.adaptive;
    this.generation?.abort();
    this.generation = null;
    this.audioUntil = 0;
    this.speechFrames = 0;
    this.events.discard((event) => event.type === "audio");
    this.events.push({ type: "interrupted", pause_ms: pauseMs });
  }

  private transcription(event: { error_code?: number; error_type?: string; tokens?: { text?: string; is_final?: boolean }[] }) {
    if (event.error_code || event.error_type) {
      const code = event.error_type || String(event.error_code);
      console.warn("Teacher pilot Soniox", /^[a-z0-9_]{1,64}$/.test(code) ? code : "provider_error");
      this.close();
      return;
    }
    let partial = "";
    for (const token of event.tokens ?? []) {
      const text = token.text ?? "";
      const recognizedInterruption = this.speechFrames >= RECOGNIZED_SPEECH_SECONDS &&
        (this.generation !== null || Date.now() < this.audioUntil);
      if (this.adaptive && this.setup.realtimeInputConfig?.activityHandling !== "NO_INTERRUPTION" &&
          (this.pauseStarted !== null || recognizedInterruption) &&
          !ENDPOINTS.has(text) && /[\p{L}\p{N}]/u.test(text)) {
        this.interrupt();
      }
      if (text && !ENDPOINTS.has(text) && !this.learnerActive) {
        this.learnerActive = true;
        this.events.push({ type: "voice_activity", activity: "start", offset_ms: null });
      }
      if (ENDPOINTS.has(text) && token.is_final) {
        const utterance = this.learnerText.trim();
        this.learnerText = "";
        this.learnerActive = false;
        if (!utterance) continue;
        this.events.push({ type: "voice_activity", activity: "end", offset_ms: null });
        this.events.push({ type: "transcript", role: "learner", text: utterance, finished: true });
        this.launch(utterance, true);
      } else if (token.is_final) this.learnerText += text;
      else partial += text;
    }
    if (partial) this.events.push({ type: "interim_transcript", text: this.learnerText + partial });
  }

  private launch(text: string, learner = false) {
    if (!text.trim() || this.closed) return;
    if (this.generation || Date.now() < this.audioUntil) this.interrupt();
    // Soniox has emitted a final endpoint, and the next LLM request has not begun.
    // No extra provider call or delay; the coach consumes only the previous complete turn.
    let decision: CoachDecision | undefined;
    if (learner && this.coach) {
      const started = performance.now();
      try {
        if (!this.tutorPlaybackDrained()) this.coach.tutorInterrupted();
        decision = this.coach.observeLearner(text);
        const { directive, ...details } = decision;
        this.events.push({ type: "lesson_coach", details: {
          ...details, applied: decision.mode === "active" && !!directive, elapsed_ms: performance.now() - started
        } });
      } catch {
        // Observation must not prevent a lesson from continuing.
        console.warn("Lesson coach observation failed");
      }
    }
    const generation = new AbortController();
    this.generation = generation;
    // An optional, separately configured assessor gets only the ambiguous final turn.
    // Shadow never waits; active is bounded and must be separately validated.
    const semanticInput = this.coach?.takeSemanticCandidate();
    void this.answerWithCoach(text, generation.signal, decision, semanticInput).catch(() => {
      if (!generation.signal.aborted) {
        console.warn("Teacher pilot response failed");
        this.close();
      }
    }).finally(() => {
      if (this.generation === generation) this.generation = null;
    });
  }

  private async answerWithCoach(text: string, signal: AbortSignal, decision?: CoachDecision, input?: SemanticInput) {
    let guidance = decision?.mode === "active" ? decision.directive : undefined;
    if (this.semantic && input && decision?.outcome === "unknown") {
      const settings = this.semantic;
      const observe = async () => {
        const started = Date.now();
        const result = await assessSemantic(input, settings.model, this.config.openrouterKey, signal, this.request);
        const directive = semanticDirective(result, input);
        if (!signal.aborted) this.events.push({ type: "lesson_coach_semantic", details: {
          version: "semantic-v1", turn: decision.turn, mode: settings.mode,
          outcome: result?.outcome ?? "unavailable", confidence: result?.confidence ?? "low",
          applied: settings.mode === "active" && decision.mode === "active" && !!directive,
          elapsed_ms: Date.now() - started,
        } });
        return directive;
      };
      if (settings.mode === "active" && decision.mode === "active") guidance = await observe();
      else void observe().catch(() => {}); // no extra wait or teacher self-report in shadow
    }
    if (!signal.aborted) await this.answer(text, signal, guidance);
  }

  private async answer(text: string, signal: AbortSignal, guidance?: string) {
    const system = this.setup.systemInstruction?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
    const tools = (this.setup.tools ?? []).flatMap((group) => group.functionDeclarations ?? [])
      .map(({ name, description, parameters }) => ({
        type: "function", function: { name, description, parameters: parameters ?? { type: "object" } },
      }));
    this.history.push({ role: "user", content: text });
    let spokenText = "";
    for (let step = 0; step < 5; step++) {
      const response = await this.request(LLM_URL, {
        method: "POST", signal, headers: {
          Authorization: "Bearer " + this.config.openrouterKey, "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model, messages: [
            { role: "system", content: [system, ...this.context, ...(guidance ? [guidance] : [])].join("\n\n") }, ...this.history,
          ],
          ...(tools.length ? { tools } : {}),
          temperature: this.setup.generationConfig?.temperature,
          max_tokens: 300, stream: true, stream_options: { include_usage: true }, provider: { sort: "latency" },
        }),
      });
      if (!response.ok) throw new Error("openrouter_" + response.status);
      const calls = new Map<number, GeneratedTool>();
      let fullText = "";
      let pending = "";
      let speech = Promise.resolve();
      const queueSpeech = (chunk: string) => {
        const speak = chunk.trim();
        if (!speak) return;
        speech = speech.then(() => this.speak(speak, signal));
        void speech.catch(() => {});
      };
      for await (const line of lines(response)) {
        if (!line.startsWith("data:") || line === "data: [DONE]") continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.error) throw new Error("openrouter_stream");
        if (event.usage) this.events.push({ type: "usage", usage: {
          cascade_llm_usd: event.usage.cost ?? 0, cascade_input_tokens: event.usage.prompt_tokens,
          cascade_output_tokens: event.usage.completion_tokens,
        } });
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          fullText += delta.content;
          pending += delta.content;
          this.events.push({ type: "transcript", role: "tutor", text: delta.content, rawText: delta.content });
          const boundary = pending.match(/^[\s\S]*?[.!?…](?:\s|$)/);
          if (boundary) {
            queueSpeech(boundary[0]);
            pending = pending.slice(boundary[0].length);
          }
        }
        for (const part of delta.tool_calls ?? []) {
          const current = calls.get(part.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
          current.id += part.id ?? "";
          current.function.name += part.function?.name ?? "";
          current.function.arguments += part.function?.arguments ?? "";
          calls.set(part.index, current);
        }
      }
      if (pending) queueSpeech(pending);
      await speech;
      if (signal.aborted) return;
      spokenText += " " + fullText;
      const toolCalls = [...calls.values()].filter((call) => call.id && tools.some((tool) => tool.function.name === call.function.name));
      if (!toolCalls.length) {
        this.history.push({ role: "assistant", content: fullText });
        this.coach?.tutorCompleted(spokenText);
        this.events.push({ type: "transcript", role: "tutor", text: "", finished: true });
        this.events.push({ type: "turn_complete" });
        return;
      }
      const toolExchange: Message[] = [{ role: "assistant", content: fullText || null, tool_calls: toolCalls }];
      for (const call of toolCalls) {
        let args: Message;
        try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
        const result = await this.waitForTool({ id: call.id, name: call.function.name, args }, signal);
        if (signal.aborted) return;
        toolExchange.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      this.history.push(...toolExchange);
    }
    this.events.push({ type: "turn_complete" });
  }

  private waitForTool(call: ToolCall, signal: AbortSignal): Promise<Message> {
    return new Promise((resolve) => {
      const id = call.id!;
      const finish = (result: Message) => {
        this.toolReplies.delete(id);
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = () => finish({ saved: false });
      const timer = setTimeout(abort, 8000);
      this.toolReplies.set(id, finish);
      signal.addEventListener("abort", abort, { once: true });
      this.events.push({ type: "tool_call", calls: [call] });
    });
  }

  private async speak(text: string, signal: AbortSignal) {
    if (this.config.googleKey) {
      const pcm24k = await synthesizeGoogleStandard(
        this.request, this.config.googleKey, this.config.voice, text,
        AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      );
      if (signal.aborted) return;
      this.events.push({ type: "usage", usage: { cascade_tts_usd: Array.from(text).length * 4 / 1_000_000 } });
      this.audioUntil = Math.max(Date.now(), this.audioUntil) + pcm24k.byteLength / 48;
      this.events.push({ type: "audio", pcm24k });
      return;
    }
    const response = await this.request(SPEECH_URL, {
      method: "POST", signal, headers: { Authorization: "Basic " + this.config.inworldKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text, voiceId: this.config.voice, modelId: "inworld-tts-2-flash",
        audioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000 },
      }),
    });
    if (!response.ok) throw new Error("inworld_" + response.status);
    this.events.push({ type: "usage", usage: { cascade_tts_usd: text.length * 15 / 1_000_000 } });
    for await (const line of lines(response)) {
      if (!line || signal.aborted) continue;
      const event = JSON.parse(line);
      if (event.error || event.result?.error) throw new Error("inworld_stream");
      if (!event.result?.audioContent) continue;
      const pcm24k = b64decode(event.result.audioContent);
      this.audioUntil = Math.max(Date.now(), this.audioUntil) + pcm24k.byteLength / 48;
      this.events.push({ type: "audio", pcm24k });
    }
  }
}
