import { AsyncQueue, sleep } from "./async";
import { concat, downsample24kTo8k, FRAME_BYTES, FRAME_MS, SILENCE_FRAME, upsample8kTo16k } from "./audio";
import { BasicTranslator } from "./basic";
import { BusinessStore } from "./business";
import { controlsFromSettings } from "./controls";
import { bearer, type Env, type Settings, randomHex, secureEqual, sha256Hex } from "./env";
import { GeminiLive } from "./gemini";
import { SessionMeter } from "./meter";
import { NavigationCall, NAVIGATION_REQUEST_TOOL } from "./navigation-call";
import { LIVE_SYSTEM, LIVE_TOOLS, LiveNavigator } from "./navigation-live";
import { NavigationSpeechGate, STOP_LISTENER_SETUP } from "./navigation-speech";
import type { Guidance } from "./navigation-route";
import { ProgressStore } from "./progress";
import { buildSetupPayload } from "./prompt";
import { parseStartFrame } from "./technoline";

const SYSTEM = `You understand Hebrew driver speech on a car phone line. Call navigation_request once for each complete request the driver addresses to the navigator, extracting only what the driver actually said. Ignore background noise, radio, passengers, echoes of the navigator's own voice and unintelligible fragments: do not call the tool for them. Every tool response contains spoken_to_driver: the exact sentence the driver heard last. Interpret the next utterance in that context: "כן/נכון/סע" after a yes/no question is confirm, "לא" is decline, "בטל/תבטל/לבטל/למחוק" (the trip) is cancel, also when answering a question; a new destination is destination. A street name in answer to a location question is report, "מה עכשיו/לאן לפנות/כמה נשאר" is status. Never give directions, calculate routes, invent turns, infer a completed turn from a sign, or invent confirmations. The deterministic navigation engine is the sole source of directions and questions; its output is spoken separately. Use destination only when the driver named a destination, passing the words exactly as heard even if they look misheard: the engine checks them against Google Maps and asks the driver "התכוונת ל...?". If the driver spells a name letter by letter, join the letters into the name. confirm/decline only for an explicit answer to the last question. When location or heading is uncertain, never guess. Do not read tool results aloud or produce conversational audio. You have no access to GPS coordinates.`;

const YES = new Set(["כן", "נכון", "בטח", "סע", "יאללה", "אישור", "מאשר", "בדיוק", "אוקיי"]);
const NO = new Set(["לא", "ממש"]);

/** A bare yes/no answer, used when the AI hears it but does not call the tool. */
export function shortAnswer(text: string): "confirm" | "decline" | null {
  const words = text.replace(/[^\u0590-\u05FF\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  if (words.every((w) => YES.has(w))) return "confirm";
  if (words.includes("לא") && words.every((w) => NO.has(w) || w === "נכון")) return "decline";
  return null;
}

export function navigationStart(raw: string, channel: string, secret: string, authorization: string | null) {
  if (!secureEqual(bearer(authorization), secret)) throw new Error("navigation_auth_failed");
  return parseStartFrame(raw, channel);
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
  private utterances = 0;
  private lastCall = { key: "", utterances: -1, response: {} as Record<string, unknown> };
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

  private clearSpeech() { this.generation++; this.output = []; }

  private async speak(result: Guidance, speech: BasicTranslator, force = false, source = "reply") {
    if (!result.say || this.abort.signal.aborted) return;
    const text = [result.say, result.then].filter(Boolean).join(". ");
    if (!force && text === this.lastMessage) return;
    this.lastMessage = text;
    this.lastStatus = result.status;
    this.trace("engine", text, { status: result.status, source, gps: this.controller?.gps() ?? null });
    if (source !== "reply" && this.ai) {
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
    for (const chunk of text.match(/[\s\S]{1,500}/g) ?? []) {
      const pcm = await speech.speak(chunk, "he-IL");
      if (generation !== this.generation || this.abort.signal.aborted) return;
      for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
        const frame = new Uint8Array(FRAME_BYTES);
        frame.set(pcm.subarray(offset, offset + FRAME_BYTES));
        this.output.push(frame);
      }
      this.meter.outputAudioBytes += pcm.length * 3;
      while (this.output.length && generation === this.generation && !this.abort.signal.aborted) await sleep(FRAME_MS, this.abort.signal);
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
      this.controller = new NavigationCall(this.env, customerId, tripCall);
      const controls = await progress.loadControls(profileId, controlsFromSettings(false));
      model = controls.model;
      this.trace = (direction, text, meta = {}) => {
        this.logs = this.logs.then(() => progress.logTurn(profileId, callId, direction, text, meta)).catch(() => {});
      };
      const allowance = await business.reserveCall(customerId, profileId, callId, controls.max_call_minutes * 60);
      if (!allowance.seconds || allowance.mode === "basic") throw new Error("navigation_access_unavailable");
      timer = setTimeout(() => this.stop("hard_time_limit"), allowance.seconds * 1000);
      this.live = controls.navigation_voice === "gemini";
      const system = this.live ? LIVE_SYSTEM : SYSTEM;
      const setup = buildSetupPayload(controls, system, profileId, this.s);
      if (this.live) this.navigator = new LiveNavigator(this.env, customerId, tripCall);
      setup.setup.tools = [{ functionDeclarations: this.live ? LIVE_TOOLS : [NAVIGATION_REQUEST_TOOL] }];
      const stopWords = this.live && controls.navigation_interrupt === "stop_word";
      // NO_INTERRUPTION hides caller transcripts while speaking. Instead keep automatic
      // interruption and feed it silence during playback; the separate STT ear hears stops.
      if (stopWords) setup.setup.realtimeInputConfig.activityHandling = "START_OF_ACTIVITY_INTERRUPTS";
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
      await progress.logDiagnostic(profileId, callId, "navigation_connected", { voice: this.live ? "gemini" : "engine", interruption: this.gate.enabled ? "stop_word" : "speech", selected_voice: controls.voice });
      tasks.push(this.sendInput(), this.readAi(speech), this.poll(speech, progress, callId));
      if (this.navigator) this.push(await this.navigator.open());
      else {
        this.ai.addContext(greeting);
        this.trace("ai_input", greeting, { kind: "context" });
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
      this.flushHeard();
      this.trace("ended", this.reason || "transport_ended");
      await this.logs;
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
    if (said) { this.utterances++; this.trace("driver", said, { source: "gemini_input_transcription" }); this.fallback(said); }
    if (this.heard.tutor.trim()) {
      if (this.live) { this.meter.tutorTurns++; this.trace("ai_spoke", this.heard.tutor, { ...(interrupted ? { cut_off_by_driver: true } : {}), ...(this.firstReplyAt && this.learnerReadyAt ? { first_audio_after_transcript_ms: this.firstReplyAt - this.learnerReadyAt } : {}) }); }
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
    }
  }
  private async readAi(speech: BasicTranslator) {
    while (!this.abort.signal.aborted) {
      const event = await this.ai!.next();
      if (event.type === "closed" || event.type === "go_away") return;
      if (event.type === "usage") this.meter.recordUsage(event.usage);
      // Engine speech is replaced only by a newer engine reply; line echo and noise must not cut it off.
      if (event.type === "transcript") {
        this.heard[event.role] += event.text;
        if (event.role === "learner") {
          this.learnerReadyAt = Date.now();
          // Protect the thinking gap too: a repeated question must not restart a reply
          // before its first audio arrives. Bounded for fragments the model ignores.
          if (this.live) this.gate.busy(Date.now(), 6000);
        }
      }
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
            this.meter.learnerTurns++;
            const result = await this.navigator.tool(call.name ?? "", (call.args ?? {}) as Record<string, unknown>)
              .catch((error) => ({ error: "the navigation system failed on this request", detail: error instanceof Error ? error.message.slice(0, 120) : "" }));
            this.ai!.submitToolResult(call, true, result);
            this.trace("tool_result", JSON.stringify(result));
            return;
          }
          if (call.name !== NAVIGATION_REQUEST_TOOL.name) { this.ai!.submitToolResult(call, false); return; }
          const key = JSON.stringify(call.args ?? {});
          if (key === this.lastCall.key && this.utterances === this.lastCall.utterances) {
            // Gemini repeated the same request without the driver saying anything new.
            this.ai!.submitToolResult(call, true, this.lastCall.response);
            this.trace("tool_result", JSON.stringify(this.lastCall.response), { note: "duplicate call ignored" });
            return;
          }
          const utterances = this.utterances;
          const response = await this.handle(call.args, speech, (r) => this.ai!.submitToolResult(call, true, r), "reply");
          this.lastCall = { key, utterances, response };
          this.trace("tool_result", JSON.stringify(response));
        }).catch(() => this.stop("navigation_speech_failed"));
      }
    }
  }

  /** Sends a live data event to Gemini as a turn, so it tells the driver about it in its own words. */
  private push(data: Record<string, unknown>) {
    const text = `[נתוני ניווט] ${JSON.stringify(data)}`;
    this.ai?.startGreeting(text);
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
      if (!this.firstReplyAt) this.firstReplyAt = Date.now();
      const [pcm, carry] = downsample24kTo8k(event.pcm24k, this.carry);
      this.carry = carry;
      const data = concat([this.partial, pcm]);
      let offset = 0;
      for (; offset + FRAME_BYTES <= data.length; offset += FRAME_BYTES) this.output.push(data.slice(offset, offset + FRAME_BYTES));
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
      if (event.type === "closed" || event.type === "go_away") {
        if (!this.abort.signal.aborted) { this.gate.enabled = false; this.trace("stop_listener_unavailable", "ערוץ זיהוי מילת העצירה נסגר; חזרה לקטיעה רגילה"); }
        return;
      }
      if (event.type === "usage") this.trace("stop_listener_usage", JSON.stringify(event.usage));
      const text = event.type === "interim_transcript" ? event.text : event.type === "transcript" && event.role === "learner" ? event.text : "";
      if (!text) continue;
      const stopped = this.gate.stop(text, this.gate.blocked(this.output.length > 0) || Date.now() < this.earActiveUntil);
      if (stopped) {
        this.clearSpeech(); this.carry = new Uint8Array(); this.partial = new Uint8Array();
        this.flushHeard(true);
        this.trace("stop_word", text, { word: stopped.word, source: event.type, replay_audio_ms: Math.round(stopped.audio.byteLength / 32) });
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
    try { result = await this.controller!.request(args); }
    catch { result = { status: "navigation_unavailable", say: "לא ניתן לעדכן את הניווט כרגע. אל תסתמך על ההנחיה הקודמת." }; }
    const response = { status: result.status, spoken_to_driver: [result.say, result.then].filter(Boolean).join(". "),
      destination: this.controller!.destination(), eta_minutes: this.controller!.eta() };
    reply(response);
    await this.speak(result, speech, true, source);
    return response;
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
      await sleep(5000, this.abort.signal);
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
