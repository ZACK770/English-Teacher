import { AsyncQueue, sleep } from "./async";
import { concat, downsample24kTo8k, FRAME_BYTES, FRAME_MS, SILENCE_FRAME, upsample8kTo16k } from "./audio";
import { BasicTranslator } from "./basic";
import { BusinessStore } from "./business";
import { controlsFromSettings } from "./controls";
import { bearer, type Env, type Settings, randomHex, secureEqual, sha256Hex } from "./env";
import { GeminiLive } from "./gemini";
import { SessionMeter } from "./meter";
import { NavigationCall, NAVIGATION_REQUEST_TOOL } from "./navigation-call";
import type { Guidance } from "./navigation-route";
import { ProgressStore } from "./progress";
import { buildSetupPayload } from "./prompt";
import { parseStartFrame } from "./technoline";

const SYSTEM = `You understand Hebrew driver speech on a car phone line. Call navigation_request once for each complete request the driver addresses to the navigator, extracting only what the driver actually said. Ignore background noise, radio, passengers, echoes of the navigator's own voice and unintelligible fragments: do not call the tool for them. Every tool response contains spoken_to_driver: the exact sentence the driver heard last. Interpret the next utterance in that context: "כן/נכון/סע" after a yes/no question is confirm, "לא" is decline, a street name in answer to a location question is report, "מה עכשיו/לאן לפנות/כמה נשאר" is status. Never give directions, calculate routes, invent turns, infer a completed turn from a sign, or invent confirmations. The deterministic navigation engine is the sole source of directions and questions; its output is spoken separately. Use destination only when the driver named a destination, passing the words exactly as heard even if they look misheard: the engine checks them against Google Maps and asks the driver "התכוונת ל...?". If the driver spells a name letter by letter, join the letters into the name. confirm/decline only for an explicit answer to the last question. When location or heading is uncertain, never guess. Do not read tool results aloud or produce conversational audio. You have no access to GPS coordinates.`;

const LIVE_SYSTEM = `You are a calm, friendly Hebrew voice navigator on a car phone line, like a good co-driver. Speak short, natural Hebrew: one or two sentences, never lecture. All routing comes from the navigation_request tool, which uses the car's live GPS, Google Maps and live Google traffic. Call it for every destination, yes/no answer to its question, "what now / where do I turn / how long is left" question, sign the driver sees, position report, completion or cancellation. Its response contains spoken_to_driver: tell the driver exactly that content in your own natural words, but keep every direction (right/left/U-turn/exit), distance, street name, place name and number exactly as given, and never add a turn, distance, street, arrival time or confirmation that is not in it. Messages that start with [מנוע הניווט] are live updates from the engine (next turn, reroute, traffic, GPS problem): say them to the driver right away in the same way and add nothing. For any navigation question call the tool instead of answering from memory. You may answer a brief non-navigation remark briefly, but never guess where the car is, which way to turn or how long is left. Ignore background noise, radio, passengers and echoes of your own voice: stay silent and do not call the tool for them. Pass destinations exactly as heard even if they look misheard: the engine checks them against Google Maps and asks "התכוונת ל...?". If the driver spells a name letter by letter, join the letters. "כן/נכון/סע" after a yes/no question is confirm and "לא" is decline. You have no GPS coordinates except through the tool.`;

const DIRECTIONS = [["ימינה", "ימין"], ["שמאלה", "שמאל"], ["פרסה"]];
/** True when spoken text gives a direction or number that the engine's last instruction does not contain. */
export function contradicts(said: string, engine: string): boolean {
  if (DIRECTIONS.some((g) => g.some((w) => said.includes(w)) && !g.some((w) => engine.includes(w)))) return true;
  const allowed = new Set(engine.match(/\d+/g) ?? []);
  return (said.match(/\d+/g) ?? []).some((n) => !allowed.has(n));
}

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
  private engineText = "";
  private muted = false;
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
    this.abort.abort(); this.input.end(); this.ai?.close();
    this.clearSpeech();
  }

  private clearSpeech() { this.generation++; this.output = []; }

  private async speak(result: Guidance, speech: BasicTranslator, force = false, source = "reply") {
    if (!result.say || this.abort.signal.aborted) return;
    const text = [result.say, result.then].filter(Boolean).join(". ");
    if (!force && text === this.lastMessage) return;
    this.lastMessage = text;
    this.lastStatus = result.status;
    this.engineText = text;
    this.trace("engine", text, { status: result.status, source, voice: this.live ? "gemini" : "engine", gps: this.controller?.gps() ?? null });
    if (this.live) {
      // Gemini voices the engine's words; tool replies already carry them, other updates are sent as a turn to speak now.
      if (source !== "reply" && this.ai) {
        const update = `[מנוע הניווט] ${text}`;
        this.ai.startGreeting(update);
        this.trace("ai_input", update, { kind: "engine_update" });
      }
      return;
    }
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
      this.controller = new NavigationCall(this.env, customerId, await sha256Hex(callId));
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
      setup.setup.tools = [{ functionDeclarations: [NAVIGATION_REQUEST_TOOL] }];
      this.ai = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, setup);
      const greeting = this.live
        ? "The call has started. The engine's opening line follows as [מנוע הניווט]; greet the driver with it."
        : "The call has started. Wait for the driver's destination or response; the navigation engine speaks its own greeting.";
      await progress.savePromptSnapshot(profileId, callId, { system_instruction: system, opening_message: greeting, history_context: "",
        setup_message: setup, fingerprint: await sha256Hex(JSON.stringify(setup)), controls }).catch(() => {});
      const speech = new BasicTranslator(this.env, this.s);
      this.speech = speech;
      tasks = [this.pacedOutput(), this.watchdog()];
      await Promise.race([this.ai.connect(), ...tasks]);
      if (this.abort.signal.aborted) return;
      meteredAt = Date.now();
      await progress.logDiagnostic(profileId, callId, "navigation_connected", { voice: this.live ? "gemini" : "engine" });
      this.ai.addContext(greeting);
      this.trace("ai_input", greeting, { kind: "context" });
      tasks.push(this.sendInput(), this.readAi(speech), this.poll(speech, progress, callId));
      const opening = await this.controller.open();
      this.commands = this.speak(opening, speech, true, "opening").catch(() => this.stop("navigation_speech_failed"));
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
      this.flushHeard();
      this.trace("ended", this.reason || "transport_ended");
      await this.logs;
      await this.controller?.close().catch(() => {});
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

  private flushHeard() {
    const said = this.heard.learner.trim();
    if (said) { this.trace("driver", said, { source: "gemini_input_transcription" }); this.fallback(said); }
    if (this.heard.tutor.trim()) {
      if (this.live) { this.meter.tutorTurns++; this.trace("ai_spoke", this.heard.tutor, { engine: this.engineText }); }
      else this.trace("ai_audio_dropped", this.heard.tutor, { note: "Gemini spoke; audio is not played to the caller" });
    }
    this.heard = { learner: "", tutor: "" };
  }

  private async pacedOutput() {
    while (!this.abort.signal.aborted) { await sleep(FRAME_MS, this.abort.signal); this.pbx.send(this.output.shift() ?? SILENCE_FRAME); }
  }
  private async sendInput() {
    while (!this.abort.signal.aborted) {
      const data = await this.input.next(this.abort.signal);
      if (!data) return;
      if (!this.ai) continue;
      const pcm = upsample8kTo16k(data);
      this.meter.inputAudioBytes += pcm.length;
      this.ai.sendAudio(pcm);
    }
  }
  private async readAi(speech: BasicTranslator) {
    while (!this.abort.signal.aborted) {
      const event = await this.ai!.next();
      if (event.type === "closed" || event.type === "go_away") return;
      if (event.type === "usage") this.meter.recordUsage(event.usage);
      // Engine speech is replaced only by a newer engine reply; line echo and noise must not cut it off.
      if (event.type === "transcript") this.heard[event.role] += event.text;
      if (this.live) this.voice(event, speech);
      if (event.type === "interrupted" || event.type === "turn_complete") this.flushHeard();
      if (event.type === "tool_call") this.flushHeard();
      if (event.type === "tool_call") for (const call of event.calls) {
        this.aiCalls++;
        this.commands = this.commands.then(async () => {
          if (this.abort.signal.aborted) return;
          this.trace("tool_call", JSON.stringify({ name: call.name, args: call.args ?? {} }));
          if (call.name !== NAVIGATION_REQUEST_TOOL.name) { this.ai!.submitToolResult(call, false); return; }
          const response = await this.handle(call.args, speech, (r) => this.ai!.submitToolResult(call, true, r), "reply");
          this.trace("tool_result", JSON.stringify(response));
        }).catch(() => this.stop("navigation_speech_failed"));
      }
    }
  }

  /** Plays Gemini's own voice, cutting it off and playing the engine's words if it contradicts them. */
  private voice(event: Awaited<ReturnType<GeminiLive["next"]>>, speech: BasicTranslator) {
    if (event.type === "audio" && !this.muted) {
      this.meter.outputAudioBytes += event.pcm24k.byteLength;
      const [pcm, carry] = downsample24kTo8k(event.pcm24k, this.carry);
      this.carry = carry;
      const data = concat([this.partial, pcm]);
      let offset = 0;
      for (; offset + FRAME_BYTES <= data.length; offset += FRAME_BYTES) this.output.push(data.slice(offset, offset + FRAME_BYTES));
      this.partial = data.slice(offset);
    }
    if (event.type === "interrupted" || event.type === "turn_complete") {
      if (event.type === "interrupted") this.clearSpeech();
      this.muted = false; this.carry = new Uint8Array(); this.partial = new Uint8Array();
    }
    if (event.type === "transcript" && event.role === "tutor" && !this.muted && contradicts(this.heard.tutor, this.engineText)) {
      this.muted = true;
      this.clearSpeech();
      const engine = this.engineText;
      this.trace("guard_blocked", this.heard.tutor, { engine });
      this.ai?.addContext("Your last sentence contradicted the navigation engine and was cut off; the driver heard the engine's exact words instead.");
      if (engine) this.commands = this.commands.then(() => this.play(engine, speech)).catch(() => this.stop("navigation_speech_failed"));
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
        const response = await this.handle({ intent }, speech, (r) => {
          if (!this.live) this.ai?.addContext(`Handled the driver's answer as ${intent}. spoken_to_driver: ${r.spoken_to_driver}`);
        }, this.live ? "engine_fallback" : "reply");
        this.trace("tool_result", JSON.stringify(response), { source: "engine_fallback" });
      }).catch(() => this.stop("navigation_speech_failed"));
    }).catch(() => {});
  }
  private async poll(speech: BasicTranslator, progress: ProgressStore, callId: string) {
    while (!this.abort.signal.aborted) {
      await sleep(5000, this.abort.signal);
      if (!await progress.renewCall(callId, this.ownerId)) { this.stop("navigation_lease_lost"); return; }
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
