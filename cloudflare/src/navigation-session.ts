import { AsyncQueue, sleep } from "./async";
import { concat, downsample24kTo8k, FRAME_BYTES, FRAME_MS, SILENCE_FRAME, upsample8kTo16k } from "./audio";
import { customerControlOverrides } from "./platform";
import { BasicTranslator } from "./basic";
import { BusinessStore } from "./business";
import { controlsFromSettings } from "./controls";
import { bearer, type Env, type Settings, randomHex, secureEqual, sha256Hex } from "./env";
import { GeminiLive } from "./gemini";
import { SessionMeter } from "./meter";
import { NavigationCall, NAVIGATION_REQUEST_TOOL } from "./navigation-call";
import { LIVE_SYSTEM, LIVE_TOOLS, LiveNavigator } from "./navigation-live";
import { NavigationSpeechGate, STOP_LISTENER_SETUP } from "./navigation-speech";
import { NavigationLatency } from "./navigation-latency";
import { NavigationAccounting } from "./navigation-cost";
import { loud, ShadowTranscriber } from "./navigation-shadow";
import { classifyIntent, echoOf, filler, INTENT_MODEL, mixedAnswer, ruleIntent, shortAnswer, TRANSCRIBE_MODEL, type IntentRequest } from "./navigation-intent";
import type { Guidance } from "./navigation-route";
import { ProgressStore } from "./progress";
import { buildSetupPayload } from "./prompt";
import { parseStartFrame } from "./technoline";

const SYSTEM = `You understand Hebrew driver speech on a car phone line. Call navigation_request once for each complete request the driver addresses to the navigator, extracting only what the driver actually said. Ignore background noise, radio, passengers, echoes of the navigator's own voice and unintelligible fragments: do not call the tool for them. Every tool response contains spoken_to_driver: the exact sentence the driver heard last. Interpret the next utterance in that context: "כן/נכון/סע" after a yes/no question is confirm, "לא" is decline, "בטל/תבטל/לבטל/למחוק" (the trip) is cancel, also when answering a question; a new destination is destination. A street name in answer to a location question is report, "מה עכשיו/לאן לפנות" is status, "כמה זמן/מתי אגיע/כמה נשאר" is eta; when a destination request also asks how long it takes, send destination with ask_eta true. Never give directions, calculate routes, invent turns, infer a completed turn from a sign, or invent confirmations. The deterministic navigation engine is the sole source of directions and questions; its output is spoken separately. Use destination only when the driver named a destination, passing the words exactly as heard even if they look misheard: the engine checks them against Google Maps and asks the driver "התכוונת ל...?". If the driver spells a name letter by letter, join the letters into the name. confirm/decline only for an explicit answer to the last question. When location or heading is uncertain, never guess. Do not read tool results aloud or produce conversational audio. You have no access to GPS coordinates.`;

export { mixedAnswer, shortAnswer };

/** Identical requests compare by meaning: intent plus destination letters, regardless of key order or punctuation. */
export function requestKey(args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const place = String(a.destination ?? "").replace(/[^\u0590-\u05FF0-9a-zA-Z]+/g, " ").replace(/(^| )(רחוב|רח)(?= )/g, " ").replace(/\s+/g, " ").trim();
  return `${String(a.intent ?? "")}|${place}|${a.ask_eta ? 1 : 0}`;
}

export function navigationStart(raw: string, channel: string, secret: string, authorization: string | null) {
  if (!secureEqual(bearer(authorization), secret)) throw new Error("navigation_auth_failed");
  return parseStartFrame(raw, channel);
}

const NAVIGATION_TTS_VOICE = "Standard-B";
const VOCABULARY = ["עומסי תנועה", "פקקים", "כביש 1", "כביש 2", "כביש 4", "כביש 6", "כביש 443", "כביש 431", "נתיבי איילון", "בני ברק", "ירושלים",
  "תל אביב", "פתח תקווה", "רמת גן", "בית שמש", "אלעד", "מודיעין עילית", "ביתר עילית", "אשדוד", "חיפה", "בטל את הניווט", "כמה זמן נשאר", "פירוט המסלול"];

/** Live Transcribe: speech-to-text only. No prompt, tools or growing context, so each audio second is billed once. */
export function transcribeSetup(custom: string[] = []) {
  return { setup: { model: TRANSCRIBE_MODEL, generationConfig: { responseModalities: ["TEXT"] },
    inputAudioTranscription: { languageCodes: ["he-IL"], mode: "SMART", customVocabulary: [...new Set([...VOCABULARY, ...custom])].slice(0, 100) } } };
}

export class NavigationSession {
  private input = new AsyncQueue<Uint8Array>((data) => data.byteLength);
  private output: Uint8Array[] = [];
  private abort = new AbortController();
  private ai: GeminiLive | null = null;
  private ear: GeminiLive | null = null;
  private gate = new NavigationSpeechGate();
  private earTask: Promise<void> | null = null;
  private earTailUntil = 0;
  private earActiveUntil = 0;
  private firstReplyAt = 0;
  private learnerReadyAt = 0;
  private timing = new NavigationLatency();
  private playbackMarks = new WeakMap<Uint8Array, Record<string, any>>();
  private nextPlaybackMark: Record<string, any> | null = null;
  private accounting: NavigationAccounting | null = null;
  private speechModel = "";
  private earUtterance = 0;
  private controller: NavigationCall | null = null;
  private meter = new SessionMeter();
  private startedAt = new Date();
  private lastInput = Date.now();
  private reason = "";
  private disconnected = false;
  private generation = 0;
  private lastMessage = "";
  private commands: Promise<void> = Promise.resolve();
  private logs: Promise<void> = Promise.resolve();
  private trace: ((direction: string, text: string, meta?: Record<string, unknown>) => void) = () => {};
  private heard = { learner: "", tutor: "" };
  private lastStatus = "";
  private aiCalls = 0;
  private speech: BasicTranslator | null = null;
  private live = false;
  /** Cheapest mode: Live Transcribe for speech, rules or a small text model for meaning, engine speech in Google TTS. */
  private text = false;
  private spokeAt = 0;
  private previousDriver = "";
  private vad = { voicedAt: 0, ended: true };
  private utterances = 0;
  private lastCall = { keys: [] as string[], utterances: -1, at: 0, response: {} as Record<string, unknown> };
  private lastDriver = { text: "", utterance: -1 };
  private shadow: ShadowTranscriber | null = null;
  private stage: (name: string, details: Record<string, unknown>) => void = () => {};
  private navigator: LiveNavigator | null = null;
  private carry: Uint8Array = new Uint8Array();
  private partial: Uint8Array = new Uint8Array();

  constructor(private pbx: WebSocket, private env: Env, private s: Settings, private ownerId: string, private authorization: string | null) {}

  receive(data: string | ArrayBuffer) {
    if (this.abort.signal.aborted) return;
    this.lastInput = Date.now();
    if (typeof data === "string") {
      try { if (["stop", "hangup", "end"].includes(JSON.parse(data).type)) this.stop("caller_disconnected", true); } catch { /* Ignore optional controls. */ }
    } else if (data.byteLength > 128 * 1024 || this.input.size + data.byteLength > 4 * 1024 * 1024) this.stop("invalid_audio_frame");
    else if (data.byteLength % 2 === 0) this.input.push(new Uint8Array(data));
  }

  stop(reason = "admin_requested", disconnected = false) {
    this.reason ||= reason; this.disconnected ||= disconnected;
    this.abort.abort(); this.input.end(); this.ai?.close(); this.ear?.close();
    this.clearSpeech();
  }

  private clearSpeech() { this.generation++; this.output = []; this.nextPlaybackMark = null; }

  private async speak(result: Guidance, speech: BasicTranslator, force = false, source = "reply") {
    if (!result.say || this.abort.signal.aborted) return;
    const text = [result.say, result.then].filter(Boolean).join(". ");
    if (!force && text === this.lastMessage) return;
    this.lastMessage = text;
    this.lastStatus = result.status;
    this.trace("engine", text, { status: result.status, source, gps: this.controller?.gps() ?? null });
    if (source !== "reply" && this.ai && !this.text) {
      // Tool responses already carry spoken_to_driver; other engine speech must reach the AI too, or the reply has no context.
      const context = `spoken_to_driver (status ${result.status}): ${text}`;
      this.ai.addContext(context);
      this.trace("ai_input", context, { kind: "context" });
    }
    await this.play(text, speech);
  }

  private async play(text: string, speech: BasicTranslator) {
    this.clearSpeech();
    const generation = this.generation;
    let first = true;
    for (const chunk of text.match(/[\s\S]{1,500}/g) ?? []) {
      const ttsAt = Date.now();
      this.accounting?.count("tts_characters", chunk.length);
      const pcm = await speech.speak(chunk, "he-IL", NAVIGATION_TTS_VOICE);
      if (generation !== this.generation || this.abort.signal.aborted) return;
      for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
        const frame = new Uint8Array(FRAME_BYTES);
        frame.set(pcm.subarray(offset, offset + FRAME_BYTES));
        if (first) {
          first = false;
          const mark = { ...this.timing.firstAudio(), tts_ms: Date.now() - ttsAt };
          this.stage("tts_ready", mark);
          this.playbackMarks.set(frame, mark);
        }
        this.output.push(frame);
      }
      this.meter.outputAudioBytes += pcm.length * 3;
      while (this.output.length && generation === this.generation && !this.abort.signal.aborted) await sleep(FRAME_MS, this.abort.signal);
      this.spokeAt = Date.now();
    }
    this.meter.tutorTurns++;
  }

  async run(raw: string, profileId: string | null, shared: boolean) {
    const progress = new ProgressStore(this.env.DB);
    const business = new BusinessStore(this.env.DB);
    let callId = "rejected-" + randomHex(12), customerId = "", claimed = false, meteredAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let model = "";
    let tasks: Promise<void>[] = [];
    try {
      if (!profileId || !this.s.navigationBotIds.includes(profileId) || shared) throw new Error("navigation_profile_invalid");
      const bot = await progress.getBot(profileId);
      if (!bot?.enabled) throw new Error("navigation_profile_unavailable");
      const initial = JSON.parse(raw);
      const test = !!this.env.TEST_TEACHER_CHANNEL_ID && initial.token === this.env.TEST_TEACHER_CHANNEL_ID;
      const start = navigationStart(raw, (test ? this.env.TEST_TEACHER_CHANNEL_ID : bot.channel_id) ?? "",
        (test ? this.env.TEST_TEACHER_BEARER_SECRET : this.s.bearerSecret) ?? "", this.authorization);
      callId = start.callId;
      claimed = await progress.claimCall(callId, profileId, this.ownerId);
      if (!claimed) throw new Error("navigation_duplicate_call");
      customerId = await business.identifyCall(start.caller, callId, profileId);
      const tripCall = await sha256Hex(callId);
      this.controller = new NavigationCall(this.env, customerId, tripCall, (unit) => this.accounting?.count(unit));
      const controls = { ...(await progress.loadControls(profileId, controlsFromSettings(false))), ...(await customerControlOverrides(this.env, customerId)) };
      model = controls.model;
      this.speechModel = model;
      this.accounting = new NavigationAccounting(this.env.DB, profileId, callId);
      this.trace = (direction, text, meta = {}) => {
        this.logs = this.logs.then(() => progress.logTurn(profileId, callId, direction, text, meta)).catch(() => {});
      };
      const callStart = Date.now();
      let previousStage = callStart;
      this.stage = (name, details) => {
        const at = Date.now(), since = at - previousStage;
        previousStage = at;
        this.trace("latency", name, details);
        this.logs = this.logs.then(() => progress.logLatency(profileId, callId, name, at - callStart, since, details)).catch(() => {});
      };
      const allowance = await business.reserveCall(customerId, profileId, callId, controls.max_call_minutes * 60);
      if (!allowance.seconds || allowance.mode === "basic") throw new Error("navigation_access_unavailable");
      timer = setTimeout(() => this.stop("hard_time_limit"), allowance.seconds * 1000);
      this.live = controls.navigation_voice === "gemini";
      this.text = controls.navigation_voice === "text";
      if (this.text) this.speechModel = TRANSCRIBE_MODEL;
      const system = this.live ? LIVE_SYSTEM : SYSTEM;
      const payload = buildSetupPayload(controls, system, profileId, this.s);
      if (this.live) this.navigator = new LiveNavigator(this.env, customerId, tripCall);
      payload.setup.tools = [{ functionDeclarations: this.live ? LIVE_TOOLS : [NAVIGATION_REQUEST_TOOL] }];
      if (!this.live) {
        // The engine keeps the trip state; a small window keeps the per-turn price flat in long calls.
        payload.setup.contextWindowCompression = { triggerTokens: Math.min(controls.context_trigger_tokens, 6000),
          slidingWindow: { targetTokens: Math.min(controls.context_target_tokens, 3000) } };
        if (this.env.AI) this.shadow = new ShadowTranscriber(this.env.AI, (r) => {
          this.trace("shadow_stt", r.text || (r.error ? "[שגיאה]" : "[ריק]"), { model: r.model, ms: r.ms, audio_ms: r.audio_ms, utterance: r.utterance, ...(r.error ? { error: r.error } : {}) });
          this.accounting?.count(`shadow_audio_ms:${r.model}`, r.audio_ms);
        });
      }
      const setup = this.text ? transcribeSetup(controls.custom_vocabulary) : payload;
      const stopWords = this.live && controls.navigation_interrupt === "stop_word";
      // NO_INTERRUPTION hides caller transcripts while speaking. Instead keep automatic
      // interruption and feed it silence during playback; the separate STT ear hears stops.
      if (stopWords) payload.setup.realtimeInputConfig.activityHandling = "START_OF_ACTIVITY_INTERRUPTS";
      this.ai = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, setup);
      const greeting = this.live
        ? "(The first turn is a [נתוני ניווט] call_started message with the GPS state and any previous trip; Gemini greets the driver itself.)"
        : "The call has started. Wait for the driver's destination or response; the navigation engine speaks its own greeting.";
      await progress.savePromptSnapshot(profileId, callId, { system_instruction: system, opening_message: greeting, history_context: "",
        setup_message: { ...setup, ...(stopWords ? { stop_listener: STOP_LISTENER_SETUP } : {}) }, fingerprint: await sha256Hex(JSON.stringify(setup)), controls }).catch(() => {});
      const speech = new BasicTranslator(this.env, this.s);
      this.speech = speech;
      tasks = [this.pacedOutput(), this.watchdog()];
      await Promise.race([this.ai.connect(), ...tasks]);
      if (this.abort.signal.aborted) return;
      if (stopWords) {
        this.ear = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, STOP_LISTENER_SETUP);
        try {
          await this.ear.connect(5000);
          this.gate.enabled = true;
          this.accounting.expect("stop_listener");
          this.earTask = this.readEar().catch(() => {
            this.gate.enabled = false;
            this.trace("stop_listener_unavailable", "חזרה לקטיעה רגילה: ערוץ זיהוי מילת העצירה אינו זמין");
          });
        } catch {
          this.ear.close(); this.ear = null;
          this.trace("stop_listener_unavailable", "לא ניתן לפתוח ערוץ זיהוי מילת עצירה; קטיעה רגילה נשארה פעילה");
        }
      }
      meteredAt = Date.now();
      await progress.logDiagnostic(profileId, callId, "navigation_connected", { voice: this.live ? "gemini" : this.text ? "text" : "engine", interruption: this.gate.enabled ? "stop_word" : "speech", selected_voice: controls.voice });
      tasks.push(this.sendInput(), this.readAi(speech), this.poll(speech, progress, callId));
      if (this.navigator) this.push(await this.navigator.open());
      else {
        if (!this.text) {
          this.ai.addContext(greeting);
          this.trace("ai_input", greeting, { kind: "context" });
        }
        const opening = await this.controller.open();
        this.commands = this.speak(opening, speech, true, "opening").catch(() => this.stop("navigation_speech_failed"));
      }
      tasks.push(this.commands);
      // The greeting finishing is not the end of the call.
      await Promise.race(tasks.slice(0, -1));
    } catch (error) {
      if (this.abort.signal.aborted && this.reason) return;
      this.reason ||= "navigation_failed";
      const code = error instanceof Error && /^navigation_[a-z_]+$/.test(error.message) ? error.message : "navigation_setup_failed";
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      this.trace("error", message, { code });
      if (profileId && this.s.navigationBotIds.includes(profileId)) await progress.logDiagnostic(profileId, callId, "navigation_failed", { code, message }).catch(() => {});
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.stop(this.reason || "transport_ended", this.disconnected);
      await Promise.allSettled([...tasks, this.commands]);
      await this.earTask;
      await this.shadow?.drain();
      this.flushHeard();
      this.trace("ended", this.reason || "transport_ended");
      await this.logs;
      if (this.accounting) {
        try {
          const cost = await this.accounting.finish();
          await progress.logTurn(profileId!, callId, "call_cost", JSON.stringify(cost));
        } catch {
          await progress.logDiagnostic(profileId!, callId, "call_cost_failed", { reason: "Cost summary could not be persisted" }).catch(() => {});
        }
      }
      await (this.navigator ?? this.controller)?.close().catch(() => {});
      if (customerId && meteredAt !== null) {
        await business.settleCall(callId, (Date.now() - meteredAt) / 1000).catch(() => {});
        await progress.saveSession({ student_id: customerId, call_id: callId, started_at: this.startedAt,
          learner_turns: this.meter.learnerTurns, tutor_turns: this.meter.tutorTurns, observations: [], transcript: null,
          summary: { summary_he: "שיחת ניווט", success_he: "", next_step_he: "", points: 0 }, usage: this.meter.usage(this.s), model }).catch(() => {});
      }
      if (claimed) await progress.releaseCall(callId, this.ownerId).catch(() => {});
      if (profileId && this.s.navigationBotIds.includes(profileId)) await progress.logDiagnostic(profileId, callId, "navigation_ended", { reason: this.reason }).catch(() => {});
      try { if (!this.disconnected) this.pbx.send(JSON.stringify({ type: "hangup" })); this.pbx.close(1000, "session ended"); } catch { /* Peer closed. */ }
    }
  }

  private flushHeard(interrupted = false) {
    const said = this.heard.learner.trim();
    if (said && !this.live && !/[\u0590-\u05FF]/.test(said)) this.trace("driver_noise", said, { note: "no Hebrew letters; ignored" });
    else if (said) {
      this.utterances++;
      this.lastDriver = { text: said, utterance: this.utterances };
      this.trace("driver", said, { source: this.text ? "transcribe_live" : "gemini_input_transcription" });
      if (this.text) this.understand(said);
      else this.fallback(said);
    }
    if (this.heard.tutor.trim()) {
      if (this.live) { this.meter.tutorTurns++; this.trace("ai_spoke", this.heard.tutor, interrupted ? { cut_off_by_driver: true } : {}); }
      else this.trace("ai_audio_dropped", this.heard.tutor, { note: "Gemini spoke; audio is not played to the caller" });
    }
    this.heard = { learner: "", tutor: "" };
    this.firstReplyAt = 0;
  }

  private async pacedOutput() {
    while (!this.abort.signal.aborted) {
      await sleep(FRAME_MS, this.abort.signal);
      const frame = this.output.shift();
      if (frame) this.gate.played();
      this.pbx.send(frame ?? SILENCE_FRAME);
      if (frame) {
        const mark = this.playbackMarks.get(frame);
        if (mark) {
          const at = Date.now();
          this.stage("first_playback", { ...mark, first_playback_at_ms: at,
            measurement_point: "pbx_websocket_send",
            generation_to_playback_ms: at - mark.first_audio_at_ms,
            speech_end_to_playback_ms: mark.speech_end_estimate_at_ms !== null ? at - mark.speech_end_estimate_at_ms : null });
          this.playbackMarks.delete(frame);
        }
      }
    }
  }
  private async sendInput() {
    while (!this.abort.signal.aborted) {
      const data = await this.input.next(this.abort.signal);
      if (!data) return;
      if (!this.ai) continue;
      const pcm = upsample8kTo16k(data);
      this.meter.inputAudioBytes += pcm.length;
      const blocked = this.gate.blocked(this.output.length > 0);
      if (!blocked) {
        this.timing.input(data);
        this.shadow?.push(data);
      }
      if (blocked) {
        this.gate.remember(pcm);
        this.earActiveUntil = Date.now() + 1500;
        this.earTailUntil = Date.now() + 900;
      }
      if (this.ear && this.gate.enabled && (blocked || Date.now() < this.earTailUntil)) {
        try { this.ear.sendAudio(blocked ? pcm : new Uint8Array(pcm.length)); }
        catch { this.gate.enabled = false; this.trace("stop_listener_unavailable", "ערוץ הזיהוי נסגר; חזרה לקטיעה רגילה"); }
      }
      this.ai.sendAudio(blocked && this.gate.enabled ? new Uint8Array(pcm.length) : pcm);
      if (this.text) this.endOfSpeech(data);
    }
  }
  private async readAi(speech: BasicTranslator) {
    while (!this.abort.signal.aborted) {
      const event = await this.ai!.next();
      if (event.type === "closed" || event.type === "go_away") return;
      if (event.type === "usage") {
        this.meter.recordUsage(event.usage);
        this.accounting?.record("main", this.speechModel, event.usage);
      }
      // Engine speech is replaced only by a newer engine reply; line echo and noise must not cut it off.
      if (event.type === "transcript") {
        if (event.role === "learner" && !this.heard.learner) this.stage("transcript_received", this.timing.transcript());
        this.heard[event.role] += event.text;
        if (event.role === "learner") {
          this.learnerReadyAt = Date.now();
          // Protect the thinking gap too: a repeated question must not restart a reply
          // before its first audio arrives. Bounded for fragments the model ignores.
          if (this.live) this.gate.busy(Date.now(), 6000);
        }
      }
      // Live Transcribe sends each finalized utterance once; it is the whole driver turn.
      if (this.text && event.type === "transcript" && event.role === "learner") this.flushHeard();
      if (this.live) this.voice(event);
      if (event.type === "interrupted" || event.type === "turn_complete") this.flushHeard(event.type === "interrupted");
      if (event.type === "tool_call") this.flushHeard();
      if (event.type === "tool_call") for (const call of event.calls) {
        this.aiCalls++;
        if (this.live) { this.gate.resume(); this.gate.busy(); }
        this.commands = this.commands.then(async () => {
          if (this.abort.signal.aborted) return;
          this.trace("tool_call", JSON.stringify({ name: call.name, args: call.args ?? {} }));
          if (this.navigator) {
            const toolAt = Date.now();
            this.meter.learnerTurns++;
            const result = await this.navigator.tool(call.name ?? "", (call.args ?? {}) as Record<string, unknown>)
              .catch((error) => ({ error: "the navigation system failed on this request", detail: error instanceof Error ? error.message.slice(0, 120) : "" }));
            this.ai!.submitToolResult(call, true, result);
            this.trace("tool_result", JSON.stringify(result), { name: call.name, tool_ms: Date.now() - toolAt });
            return;
          }
          if (call.name !== NAVIGATION_REQUEST_TOOL.name) { this.ai!.submitToolResult(call, false); return; }
          let args: unknown = call.args ?? {};
          const intent = String((args as Record<string, unknown>).intent ?? "");
          const fresh = this.lastDriver.utterance === this.utterances && this.lastCall.utterances !== this.utterances;
          const answer = this.lastStatus === "confirmation_required" && fresh ? shortAnswer(this.lastDriver.text) : null;
          if (answer && intent !== answer) {
            // A bare "כן"/"לא" after an open question is the answer, whatever Gemini made of it.
            this.trace("engine_override", JSON.stringify({ from: args, to: { intent: answer } }), { said: this.lastDriver.text });
            args = { intent: answer };
          }
          const key = requestKey(args), keys = [key, requestKey(call.args ?? {})];
          if (keys.some((k) => this.lastCall.keys.includes(k)) && (this.utterances === this.lastCall.utterances || Date.now() - this.lastCall.at < 5000)) {
            // Same request again (any key order) without new speech, or within seconds: do not re-ask.
            this.ai!.submitToolResult(call, true, this.lastCall.response);
            this.trace("tool_result", JSON.stringify(this.lastCall.response), { note: "duplicate call ignored" });
            return;
          }
          const unclear = this.lastStatus === "confirmation_required" && fresh && intent === "decline" && !answer && mixedAnswer(this.lastDriver.text);
          const utterances = this.utterances;
          const response = await this.handle(unclear ? () => Promise.resolve(this.controller!.clarify()) : args, speech, (r) => this.ai!.submitToolResult(call, true, r), "reply");
          this.lastCall = { keys, utterances, at: Date.now(), response };
          this.trace("tool_result", JSON.stringify(response), unclear ? { note: "mixed answer; asked again" } : {});
        }).catch(() => this.stop("navigation_speech_failed"));
      }
    }
  }

  /** Sends a live data event to Gemini as a turn, so it tells the driver about it in its own words. */
  private push(data: Record<string, unknown>) {
    const text = `[נתוני ניווט] ${JSON.stringify(data)}`;
    this.ai?.startGreeting(text);
    this.timing.event();
    this.gate.resume(); this.gate.busy();
    this.trace("ai_input", text, { kind: "event" });
  }

  /** Plays Gemini's own voice to the caller. */
  private voice(event: Awaited<ReturnType<GeminiLive["next"]>>) {
    if (event.type === "audio") {
      this.gate.generated();
      this.meter.outputAudioBytes += event.pcm24k.byteLength;
      if (this.gate.muted) return;
      this.gate.resume();
      if (!this.firstReplyAt) {
        this.firstReplyAt = Date.now(); this.nextPlaybackMark = this.timing.firstAudio(this.firstReplyAt);
        this.stage("first_generated_audio", this.nextPlaybackMark);
      }
      const [pcm, carry] = downsample24kTo8k(event.pcm24k, this.carry);
      this.carry = carry;
      const data = concat([this.partial, pcm]);
      let offset = 0;
      for (; offset + FRAME_BYTES <= data.length; offset += FRAME_BYTES) {
        const frame = data.slice(offset, offset + FRAME_BYTES);
        if (this.nextPlaybackMark) { this.playbackMarks.set(frame, this.nextPlaybackMark); this.nextPlaybackMark = null; }
        this.output.push(frame);
      }
      this.partial = data.slice(offset);
    }
    if (event.type === "interrupted" || event.type === "turn_complete") {
      if (event.type === "interrupted") this.clearSpeech();
      this.gate.complete();
      this.carry = new Uint8Array(); this.partial = new Uint8Array();
    }
  }

  private async readEar() {
    while (!this.abort.signal.aborted && this.ear) {
      const event = await this.ear.next();
      if (event.type === "voice_activity") {
        if (event.activity === "start") this.earUtterance++;
        continue;
      }
      if (event.type === "closed" || event.type === "go_away") {
        if (!this.abort.signal.aborted) { this.gate.enabled = false; this.trace("stop_listener_unavailable", "ערוץ זיהוי מילת העצירה נסגר; חזרה לקטיעה רגילה"); }
        return;
      }
      if (event.type === "usage") {
        this.accounting?.record("stop_listener", STOP_LISTENER_SETUP.setup.model, event.usage);
        this.trace("stop_listener_usage", JSON.stringify(event.usage));
      }
      const text = event.type === "interim_transcript" ? event.text : event.type === "transcript" && event.role === "learner" ? event.text : "";
      if (!text) continue;
      const utterance = this.earUtterance;
      const stopped = this.gate.stop(text, this.gate.blocked(this.output.length > 0) || Date.now() < this.earActiveUntil, Date.now(), utterance);
      if (event.type === "transcript") this.earUtterance++;
      if (stopped) {
        this.clearSpeech(); this.carry = new Uint8Array(); this.partial = new Uint8Array();
        this.flushHeard(true);
        this.trace("stop_word", text, { word: stopped.word, source: event.type, utterance, replay_audio_ms: Math.round(stopped.audio.byteLength / 32) });
        // The main Live session hears the actual word and receives VAD interruption.
        // Muting queued audio alone would leave its generation active for many seconds.
        if (stopped.audio.length) this.ai?.sendAudio(stopped.audio);
      } else if (event.type === "transcript") {
        this.trace("driver_during_playback", text, { note: "נשמע בערוץ זיהוי העצירה; לא נשלח לשיחה הראשית" });
      }
    }
  }

  private async handle(args: unknown, speech: BasicTranslator, reply: (r: Record<string, unknown>) => void, source = "reply") {
    this.meter.learnerTurns++;
    let result: Guidance;
    const at = Date.now();
    try { result = await (typeof args === "function" ? (args as () => Promise<Guidance>)() : this.controller!.request(args)); }
    catch { result = { status: "navigation_unavailable", say: "לא ניתן לעדכן את הניווט כרגע. אל תסתמך על ההנחיה הקודמת." }; }
    this.stage("engine_decided", { tool_ms: Date.now() - at, status: result.status, source });
    const response = { status: result.status, spoken_to_driver: [result.say, result.then].filter(Boolean).join(". "),
      destination: this.controller!.destination(), pending_destination: this.controller!.pendingDestination(), eta_minutes: this.controller!.eta() };
    reply(response);
    await this.speak(result, speech, true, source);
    return response;
  }

  /** Hybrid VAD: after ~500 ms of quiet following speech, ask Live Transcribe to finalize now instead of waiting. */
  private endOfSpeech(pcm8k: Uint8Array, now = Date.now()) {
    this.accounting?.count("transcribe_audio_ms", pcm8k.length / 16);
    if (loud(pcm8k)) { this.vad = { voicedAt: now, ended: false }; return; }
    if (!this.vad.ended && now - this.vad.voicedAt >= 500) {
      this.vad.ended = true;
      try { this.ai?.send({ realtimeInput: { audioStreamEnd: true } }); } catch { /* The socket reader reports closure. */ }
    }
  }

  /** Text mode: rules first, the small model only for sentences the rules do not cover. */
  private understand(said: string) {
    const speech = this.speech, controller = this.controller;
    if (!speech || !controller) return;
    const utterance = this.utterances, previous = this.previousDriver;
    this.previousDriver = said;
    if (this.lastMessage && (this.output.length > 0 || Date.now() - this.spokeAt < 4000) && echoOf(said, this.lastMessage)) {
      this.trace("driver_echo", said, { note: "matches the navigator's own last sentence; ignored" });
      return;
    }
    const awaiting = controller.awaiting();
    const rule = ruleIntent(said, awaiting);
    const unclear = !rule && awaiting && mixedAnswer(said);
    if (!rule && !unclear && (filler(said) || (!awaiting && shortAnswer(said)))) {
      this.trace("driver_ignored", said, { note: "acknowledgement or filler; no answer needed" });
      return;
    }
    const at = Date.now();
    const decided: Promise<IntentRequest | null> = rule || unclear ? Promise.resolve(rule)
      : classifyIntent(this.s, { said, navigator: this.lastMessage, pending: controller.pendingDestination(), active: controller.destination(), previous })
        .then(({ request, usage }) => { this.accounting?.record("intent", INTENT_MODEL, usage); return request; })
        .catch((error) => { this.trace("intent_error", error instanceof Error ? error.message.slice(0, 200) : "failed"); return null; });
    void decided.then((request) => {
      if (this.abort.signal.aborted || utterance !== this.utterances) return;
      this.trace("intent", JSON.stringify(unclear ? { intent: "clarify" } : request), { source: rule ? "rule" : unclear ? "rule_mixed" : "model", ms: Date.now() - at });
      if (request?.intent === "noise") return;
      // A new request replaces whatever the navigator is still saying.
      this.clearSpeech();
      this.commands = this.commands.then(async () => {
        if (this.abort.signal.aborted) return;
        const args = unclear ? () => Promise.resolve(controller.clarify())
          : request ?? (() => Promise.resolve<Guidance>({ status: "not_understood", say: "לא שמעתי טוב. אפשר לחזור על זה?" }));
        const response = await this.handle(args, speech, () => {}, "reply");
        this.trace("tool_result", JSON.stringify(response), { source: "text_mode" });
      }).catch(() => this.stop("navigation_speech_failed"));
    });
  }

  private fallback(said: string) {
    const intent = this.lastStatus === "confirmation_required" ? shortAnswer(said) : null;
    if (!intent) return;
    const calls = this.aiCalls;
    void sleep(2000, this.abort.signal).then(() => {
      if (this.abort.signal.aborted || this.aiCalls !== calls || this.lastStatus !== "confirmation_required" || !this.speech) return;
      const speech = this.speech;
      this.commands = this.commands.then(async () => {
        if (this.abort.signal.aborted) return;
        this.trace("engine_fallback", JSON.stringify({ intent }), { note: "AI did not call the tool for a bare yes/no answer" });
        const response = await this.handle({ intent }, speech, (r) => this.ai?.addContext(`Handled the driver's answer as ${intent}. spoken_to_driver: ${r.spoken_to_driver}`));
        this.trace("tool_result", JSON.stringify(response), { source: "engine_fallback" });
      }).catch(() => this.stop("navigation_speech_failed"));
    }).catch(() => {});
  }
  private async poll(speech: BasicTranslator, progress: ProgressStore, callId: string) {
    while (!this.abort.signal.aborted) {
      await sleep(this.live ? 2000 : 5000, this.abort.signal);
      if (!await progress.renewCall(callId, this.ownerId)) { this.stop("navigation_lease_lost"); return; }
      if (this.navigator) {
        const event = await this.navigator.poll().catch(() => null);
        if (event && !this.abort.signal.aborted) this.push(event);
        continue;
      }
      const warning = await this.controller!.safetyWarning();
      if (warning) this.clearSpeech();
      this.commands = this.commands.then(async () => {
        if (this.abort.signal.aborted) return;
        try { await this.speak(warning ?? await this.controller!.poll(), speech, false, warning ? "gps_warning" : "poll"); }
        catch { this.clearSpeech(); this.stop("navigation_poll_failed"); }
      }).catch(() => this.stop("navigation_poll_failed"));
    }
  }
  private async watchdog() {
    while (!this.abort.signal.aborted) {
      if (Date.now() - this.lastInput >= 15000) { this.stop("pbx_input_timeout"); return; }
      await sleep(500, this.abort.signal);
    }
  }
}
