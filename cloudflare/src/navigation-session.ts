import { AsyncQueue, sleep } from "./async";
import { concat, FRAME_BYTES, FRAME_MS, SILENCE_FRAME, upsample8kTo16k } from "./audio";
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

const SYSTEM = `You understand Hebrew driver speech on a car phone line. Call navigation_request once for each complete request the driver addresses to the navigator, extracting only what the driver actually said. Ignore background noise, radio, passengers, echoes of the navigator's own voice and unintelligible fragments: do not call the tool for them. Every tool response contains spoken_to_driver: the exact sentence the driver heard last. Interpret the next utterance in that context: "כן/נכון/סע" after a yes/no question is confirm, "לא" is decline, a street name in answer to a location question is report, "מה עכשיו/לאן לפנות/כמה נשאר" is status. Never give directions, calculate routes, invent turns, infer a completed turn from a sign, or invent confirmations. The deterministic navigation engine is the sole source of directions and questions; its output is spoken separately. Use destination only when the driver named a destination, confirm/decline only for an explicit answer to the last question. When location or heading is uncertain, never guess. Do not read tool results aloud or produce conversational audio. You have no access to GPS coordinates.`;

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
    this.trace("engine", text, { status: result.status, source, gps: this.controller?.gps() ?? null });
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
      const setup = buildSetupPayload(controls, SYSTEM, profileId, this.s);
      setup.setup.tools = [{ functionDeclarations: [NAVIGATION_REQUEST_TOOL] }];
      this.ai = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, setup);
      const greeting = "The call has started. Wait for the driver's destination or response; the navigation engine speaks its own greeting.";
      await progress.savePromptSnapshot(profileId, callId, { system_instruction: SYSTEM, opening_message: greeting, history_context: "",
        setup_message: setup, fingerprint: await sha256Hex(JSON.stringify(setup)), controls }).catch(() => {});
      const speech = new BasicTranslator(this.env, this.s);
      tasks = [this.pacedOutput(), this.watchdog()];
      await Promise.race([this.ai.connect(), ...tasks]);
      if (this.abort.signal.aborted) return;
      meteredAt = Date.now();
      await progress.logDiagnostic(profileId, callId, "navigation_connected");
      this.ai.startGreeting(greeting);
      this.trace("ai_input", greeting, { kind: "clientContent" });
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
    if (this.heard.learner.trim()) this.trace("driver", this.heard.learner, { source: "gemini_input_transcription" });
    if (this.heard.tutor.trim()) this.trace("ai_audio_dropped", this.heard.tutor, { note: "Gemini spoke; audio is not played to the caller" });
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
      if (event.type === "interrupted" || event.type === "turn_complete") this.flushHeard();
      if (event.type === "tool_call") this.flushHeard();
      if (event.type === "tool_call") for (const call of event.calls) {
        this.commands = this.commands.then(async () => {
          if (this.abort.signal.aborted) return;
          this.trace("tool_call", JSON.stringify({ name: call.name, args: call.args ?? {} }));
          if (call.name !== NAVIGATION_REQUEST_TOOL.name) { this.ai!.submitToolResult(call, false); return; }
          this.meter.learnerTurns++;
          let result: Guidance;
          try { result = await this.controller!.request(call.args); }
          catch { result = { status: "navigation_unavailable", say: "לא ניתן לעדכן את הניווט כרגע. אל תסתמך על ההנחיה הקודמת." }; }
          const response = { status: result.status, spoken_to_driver: [result.say, result.then].filter(Boolean).join(". ") };
          this.ai!.submitToolResult(call, true, response);
          this.trace("tool_result", JSON.stringify(response));
          await this.speak(result, speech, true);
        }).catch(() => this.stop("navigation_speech_failed"));
      }
    }
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
