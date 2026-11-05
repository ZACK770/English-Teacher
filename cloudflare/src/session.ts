import { AsyncQueue, sleep } from "./async";
import { concat, downsample24kTo8k, FRAME_BYTES, FRAME_MS, meanSquare, SILENCE_FRAME, upsample8kTo16k } from "./audio";
import { BasicTranslator } from "./basic";
import { BusinessStore } from "./business";
import { adultControls, controlsFromSettings, type TutorControls } from "./controls";
import { type Env, type Settings, bearer, randomHex, secureEqual } from "./env";
import { GeminiLive, type ToolCall } from "./gemini";
import { SessionMeter } from "./meter";
import { markQuickIntro, quickOpening, runtimeContext } from "./pbx";
import { ProgressStore } from "./progress";
import { compilePrompt, type PromptArtifact } from "./prompt";
import { parseStartFrame, transferCommand } from "./technoline";

export class TutorSession {
  readonly meter = new SessionMeter();
  readonly startedAt = new Date();
  private input = new AsyncQueue<Uint8Array>((data) => data.byteLength);
  private output: Uint8Array[] = [];
  private partial = new Uint8Array();
  private carry: Uint8Array = new Uint8Array();
  private abort = new AbortController();
  private ai: GeminiLive | null = null;
  private reconnecting: Promise<void> | null = null;
  private controls: TutorControls | null = null;
  private artifact: PromptArtifact | null = null;
  private lastInput = Date.now();
  private lastHuman = Date.now();
  private clockPrevious = this.startedAt.getTime();
  private meteredAt: number | null = null;
  private disconnected = false;
  private reason = "";
  private returnPath: string | null = null;
  private callId = "";
  private customerId = "";
  private leaseCallId = "";
  private profileId = "";
  private firstPbx = false;
  private firstAudio = false;
  private firstSent = false;
  private learnerSeen = false;
  private settling = false;
  private b: BusinessStore;
  private progress: ProgressStore;

  constructor(private pbx: WebSocket, private env: Env, private s: Settings, private ownerId: string, private authorization: string | null = null) {
    this.b = new BusinessStore(env.DB);
    this.progress = new ProgressStore(env.DB);
  }

  receive(data: string | ArrayBuffer) {
    if (this.abort.signal.aborted) return;
    this.lastInput = Date.now();
    if (typeof data === "string") {
      try {
        const p = JSON.parse(data);
        if (["stop", "hangup", "end"].includes(String(p.type ?? "").toLowerCase())) this.stop("caller_disconnected", true);
      } catch { /* Invalid optional controls do not affect the audio stream. */ }
      return;
    }
    if (data.byteLength > 128 * 1024 || this.input.size + data.byteLength > 4 * 1024 * 1024) {
      this.stop("invalid_audio_frame");
      return;
    }
    if (data.byteLength % 2) return;
    this.input.push(new Uint8Array(data));
  }

  stop(reason = "admin_requested", disconnected = false) {
    if (this.settling) return;
    this.reason ||= reason;
    this.disconnected ||= disconnected;
    this.abort.abort(new Error(this.reason));
    this.input.end();
    this.ai?.close();
  }

  async run(raw: string, requestedProfile: string | null, shared: boolean) {
    let claimed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let hardLimit: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.abort.signal.aborted) return;
      const initial = JSON.parse(raw);
      let profileId = requestedProfile;
      const testChannel = !!this.env.TEST_TEACHER_CHANNEL_ID && initial.token === this.env.TEST_TEACHER_CHANNEL_ID;
      if (testChannel) {
        if (!secureEqual(bearer(this.authorization), this.env.TEST_TEACHER_BEARER_SECRET ?? "")) throw new Error("Invalid test-channel authentication");
        if (shared || (profileId && profileId !== this.s.studentId)) throw new Error("Invalid test-channel profile");
        profileId = this.s.studentId;
      }
      if (shared) {
        const start = parseStartFrame(raw, this.s.routerChannel ?? "");
        profileId = (await this.b.loadContext(start.callId)).selected_bot;
        if (!profileId) throw new Error("Select a bot in IVR first");
      }
      if (!profileId) {
        const bots = await this.progress.listBots();
        profileId = bots.find((bot) => bot.channel_id && bot.channel_id === initial.token)?.id ?? this.s.studentId;
      }
      const bot = await this.progress.getBot(profileId);
      if (!bot || !bot.enabled || (shared && !bot.phone_enabled)) throw new Error("Tutor unavailable");
      this.profileId = profileId;
      const channel = testChannel ? this.env.TEST_TEACHER_CHANNEL_ID : shared ? this.s.routerChannel : bot.channel_id;
      const start = parseStartFrame(raw, channel ?? "");
      this.leaseCallId = start.callId;
      if (this.s.radioStreams[profileId] || this.s.navigationBotIds.includes(profileId)) {
        throw new Error("This test endpoint currently supports teachers and translators only");
      }
      claimed = await this.progress.claimCall(start.callId, profileId, this.ownerId);
      if (!claimed) throw new Error("Duplicate call connection");
      heartbeat = setInterval(() => {
        void this.progress.renewCall(this.leaseCallId, this.ownerId).then((renewed) => {
          if (!renewed) this.stop("call_lease_lost");
        }).catch(() => this.stop("call_lease_failed"));
      }, 5000);
      this.callId = shared ? start.callId.slice(0, 160) + "~" + randomHex(8) : start.callId;
      if (shared) {
        await this.b.linkCallSegment(start.callId, this.callId, profileId);
        await this.b.saveContext(this.callId, await this.b.loadContext(start.callId));
      }
      this.customerId = await this.b.identifyCall(start.caller, this.callId, profileId);
      await this.latency("session_started");
      const defaults = profileId === this.s.adultStudentId ? adultControls(this.s.storeTranscripts) : controlsFromSettings(this.s.storeTranscripts);
      this.controls = await this.progress.loadControls(profileId, defaults);
      const opening = await quickOpening(this.b, this.callId);
      if (opening) this.controls = { ...this.controls, opening_message: opening };
      const history = await this.progress.lessonContext(this.customerId) + await this.b.lessonContext(this.customerId, profileId) + "\n" + await runtimeContext(this.b, this.callId);
      this.artifact = await compilePrompt(this.controls, history, profileId, this.s);
      const allowance = await this.b.reserveCall(this.customerId, profileId, this.callId, this.controls.max_call_minutes * 60);
      await this.latency("access_checked", { mode: allowance.mode });
      if (!allowance.seconds) {
        this.returnPath = allowance.extension ?? null;
        this.reason = "access_blocked";
        return;
      }
      hardLimit = setTimeout(() => {
        if (this.profileId.startsWith("isaac-")) this.returnPath = this.s.projectPath + "/8";
        this.stop("hard_time_limit");
      }, (allowance.seconds + 20) * 1000);
      await this.progress.savePromptSnapshot(profileId, this.callId, this.artifact);
      if (allowance.mode === "basic") {
        this.controls = { ...this.controls, model: this.s.basicTranslatorModel };
        this.meteredAt = Date.now();
        clearTimeout(hardLimit);
        hardLimit = setTimeout(() => this.stop("hard_time_limit"), allowance.seconds * 1000);
        await this.runTasks([this.basicListen(allowance.intro ?? ""), this.pacedOutput(), this.watchdog()]);
      } else {
        await this.latency("gemini_connect_started");
        if (this.abort.signal.aborted) return;
        const ai = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, this.artifact.setup_message);
        this.ai = ai;
        await ai.connect();
        if (this.abort.signal.aborted) return;
        this.meteredAt = Date.now();
        this.lastHuman = Date.now();
        await this.latency("gemini_connected");
        ai.startGreeting(this.controls.opening_message);
        await this.latency("greeting_sent");
        clearTimeout(hardLimit);
        hardLimit = setTimeout(() => {
          if (this.profileId.startsWith("isaac-")) this.returnPath = this.s.projectPath + "/8";
          this.stop("hard_time_limit");
        }, allowance.seconds * 1000);
        await this.runTasks([this.pbxToAi(), this.aiToOutput(), this.pacedOutput(), this.watchdog()]);
      }
    } catch (error) {
      if (!this.reason) this.reason = "call_failed";
      if (this.profileId && this.callId && !this.abort.signal.aborted) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await this.progress.logDiagnostic(this.profileId, this.callId, "call_failed", { error_type: error instanceof Error ? error.name : "Error", message: message.split(this.s.geminiKey).join("[redacted]").slice(0, 250) });
      }
    } finally {
      this.settling = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (hardLimit !== undefined) clearTimeout(hardLimit);
      this.abort.abort(new Error("session_finished"));
      this.input.end();
      this.ai?.close();
      try {
        if (this.callId && this.customerId && this.controls) {
          await this.latency("ai_connection_closed", { reason: this.reason || "transport_ended" });
          await this.drainFinalAudio();
          const billed = this.meteredAt === null ? 0 : (Date.now() - this.meteredAt) / 1000;
          await this.b.settleCall(this.callId, billed);
          await this.progress.saveSession({ student_id: this.customerId, call_id: this.callId, started_at: this.startedAt, learner_turns: this.meter.learnerTurns, tutor_turns: this.meter.tutorTurns, observations: this.meter.observations, transcript: this.controls.store_transcripts ? this.meter.transcript : null, summary: this.meter.summary(), usage: this.meter.usage(this.s), model: this.controls.model });
          await this.latency("session_saved");
        }
        if (claimed) await this.progress.releaseCall(this.leaseCallId, this.ownerId);
        if (!this.disconnected) {
          const target = this.returnPath || (this.controls?.session_end_action === "return_to_menu" ? (shared ? this.s.projectPath : this.s.returnExtension) : null);
          this.pbx.send(target ? transferCommand(target) : JSON.stringify({ type: "hangup" }));
        }
      } finally {
        if (claimed) await this.progress.releaseCall(this.leaseCallId, this.ownerId).catch(() => {});
        this.output = [];
        try { this.pbx.close(1000, "session ended"); } catch { /* peer already closed */ }
      }
    }
  }

  private async runTasks(tasks: Promise<void>[]) {
    try { await Promise.race(tasks); }
    finally {
      this.abort.abort(new Error("bridge_finished"));
      this.ai?.close();
      this.input.end();
      await Promise.allSettled(tasks);
    }
  }

  private async latency(event: string, details: Record<string, unknown> = {}) {
    const now = Date.now();
    const previous = this.clockPrevious;
    this.clockPrevious = now;
    await this.progress.logLatency(this.profileId, this.callId, event, now - this.startedAt.getTime(), now - previous, details);
  }

  private enqueue(pcm8: Uint8Array) {
    const data = concat([this.partial, pcm8]);
    const whole = data.byteLength - data.byteLength % FRAME_BYTES;
    for (let i = 0; i < whole; i += FRAME_BYTES) this.output.push(data.slice(i, i + FRAME_BYTES));
    this.partial = data.slice(whole);
  }

  private async pbxToAi() {
    let batch: Uint8Array[] = [];
    while (!this.abort.signal.aborted) {
      const audio = await this.input.next(this.abort.signal);
      if (!audio) return;
      if (!this.firstPbx) { this.firstPbx = true; await this.latency("first_pbx_audio", { bytes: audio.byteLength }); }
      if (meanSquare(audio) >= this.controls!.idle_audio_threshold ** 2) this.lastHuman = Date.now();
      batch.push(audio);
      if (batch.length < this.controls!.input_batch_frames) continue;
      const pcm = upsample8kTo16k(concat(batch));
      this.meter.inputAudioBytes += pcm.byteLength;
      batch = [];
      if (this.reconnecting) await this.reconnecting;
      if (!this.abort.signal.aborted) this.ai!.sendAudio(pcm);
    }
  }

  private async aiToOutput() {
    while (!this.abort.signal.aborted) {
      const event = await this.ai!.next();
      if (this.abort.signal.aborted) return;
      if (event.type === "closed") { this.reason ||= "gemini_disconnected"; return; }
      if (event.type === "audio") {
        if (!this.firstAudio) { this.firstAudio = true; await this.latency("first_gemini_audio", { tutor_turn: this.meter.tutorTurns + 1 }); }
        this.meter.outputAudioBytes += event.pcm24k.byteLength;
        const [pcm, carry] = downsample24kTo8k(event.pcm24k, this.carry);
        this.carry = carry;
        this.enqueue(pcm);
      } else if (event.type === "interrupted") {
        this.output = [];
        this.partial = new Uint8Array();
        this.carry = new Uint8Array();
        await this.latency("tutor_interrupted");
      } else if (event.type === "transcript") {
        this.meter.transcript.push({ role: event.role, text: event.text });
        await this.progress.logTurn(this.profileId, this.callId, event.role === "learner" ? "input" : "output", event.text);
        if (event.role === "learner") {
          this.lastHuman = Date.now();
          if (!this.learnerSeen) this.meter.learnerTurns++;
          this.learnerSeen = true;
        }
      } else if (event.type === "turn_complete") {
        this.meter.tutorTurns++;
        this.learnerSeen = false;
        this.firstAudio = false;
        await this.latency("tutor_turn_complete", { tutor_turn: this.meter.tutorTurns });
      } else if (event.type === "usage") this.meter.recordUsage(event.usage);
      else if (event.type === "tool_call") {
        for (const call of event.calls) {
          const saved = await this.recordTool(call);
          this.ai!.submitToolResult(call, saved);
          if (call.name === "end_session") return;
        }
      } else if (event.type === "go_away") {
        const handle = this.ai!.resumeHandle;
        if (!handle || !this.artifact) { this.reason = "gemini_go_away"; return; }
        const setup = structuredClone(this.artifact.setup_message) as { setup: Record<string, unknown> };
        setup.setup.sessionResumption = { handle };
        this.ai!.close();
        const replacement = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, setup);
        this.ai = replacement;
        this.reconnecting = replacement.connect();
        await this.reconnecting;
        this.reconnecting = null;
        await this.latency("gemini_session_resumed");
      }
    }
  }

  private async recordTool(call: ToolCall): Promise<boolean> {
    const args = call.args ?? {};
    if (call.name === "end_session") {
      const reason = ["caller_requested", "task_completed", "no_response"].includes(String(args.reason)) ? String(args.reason) : "task_completed";
      const destinations: Record<string, string> = { main: "", school: "/1", translator: "/2", options: "/9" };
      if (reason === "caller_requested" && typeof args.destination === "string" && Object.hasOwn(destinations, args.destination) && this.callId.includes("~")) this.returnPath = this.s.projectPath + destinations[args.destination];
      this.reason = "model:" + reason;
      return true;
    }
    if (call.name === "save_translation_language") {
      const language = args.language === "auto" ? "" : args.language;
      if (!this.callId.includes("~") || typeof language !== "string" || !["", "English", "Hebrew", "Yiddish", "Arabic", "Russian", "French"].includes(language)) return false;
      if ((await this.b.loadContext(this.callId)).quick_entry !== "translation") return false;
      await this.b.saveContext(this.callId, { language });
      await this.b.saveContext(this.callId.slice(0, this.callId.lastIndexOf("~")), { language });
      await this.b.savePreference(this.customerId, { language });
      return true;
    }
    return this.meter.recordLearning(call.name ?? "", args);
  }

  private async pacedOutput() {
    while (!this.abort.signal.aborted) {
      await sleep(FRAME_MS, this.abort.signal);
      const audio = this.output.shift();
      this.pbx.send(audio ?? SILENCE_FRAME);
      if (audio && !this.firstSent) {
        this.firstSent = true;
        await markQuickIntro(this.b, this.callId, this.customerId);
        await this.latency("first_audio_sent_to_phone", { tutor_turn: 1, queue_frames: this.output.length });
      }
    }
  }

  private async watchdog() {
    while (!this.abort.signal.aborted) {
      if (Date.now() - this.lastInput >= 15000) { this.stop("pbx_input_timeout"); return; }
      if (Date.now() - this.lastHuman >= this.controls!.idle_timeout_seconds * 1000) { this.stop("idle_timeout"); return; }
      await sleep(500, this.abort.signal);
    }
  }

  private async drainFinalAudio() {
    if (this.disconnected || !this.reason.startsWith("model:")) return;
    if (this.partial.length) {
      const padded = new Uint8Array(FRAME_BYTES);
      padded.set(this.partial);
      this.output.push(padded);
      this.partial = new Uint8Array();
    }
    for (const frame of this.output.splice(0)) {
      if (this.disconnected) break;
      this.pbx.send(frame);
      await sleep(FRAME_MS);
    }
    for (let i = 0; i < 10 && !this.disconnected; i++) { this.pbx.send(SILENCE_FRAME); await sleep(FRAME_MS); }
  }

  private async basicListen(intro: string) {
    const context = this.callId.includes("~") ? await this.b.loadContext(this.callId) : {};
    const translator = new BasicTranslator(this.env, this.s, context.language || "");
    const say = async (content: string, language: string) => {
      const pcm = await translator.speak(content, language);
      if (this.abort.signal.aborted) return;
      this.meter.outputAudioBytes += pcm.length * 3;
      this.enqueue(pcm);
      if (this.partial.length) this.enqueue(new Uint8Array(FRAME_BYTES - this.partial.length));
      this.meter.tutorTurns++;
    };
    if (intro) await say(intro, "he-IL");
    let speech: Uint8Array[] = [], bytes = 0, voiced = 0, silent = 0;
    while (!this.abort.signal.aborted) {
      const audio = await this.input.next(this.abort.signal);
      if (!audio) return;
      if (this.output.length) { speech = []; bytes = voiced = silent = 0; this.lastHuman = Date.now(); continue; }
      if (meanSquare(audio) >= this.controls!.idle_audio_threshold ** 2) { speech.push(audio); bytes += audio.length; voiced += audio.length; silent = 0; this.lastHuman = Date.now(); }
      else if (speech.length) { speech.push(audio); bytes += audio.length; silent += audio.length; }
      if (!speech.length || (silent < 12800 && bytes < 240000)) continue;
      const utterance = concat(speech);
      const enough = voiced >= 4800;
      speech = []; bytes = voiced = silent = 0;
      if (!enough) continue;
      this.meter.learnerTurns++;
      this.meter.inputAudioBytes += utterance.length * 2;
      try {
        const result = await translator.translate(utterance);
        if (this.abort.signal.aborted) return;
        if (result.text) {
          this.meter.transcript.push({ role: "learner", text: result.heard }, { role: "tutor", text: result.text });
          await say(result.text, result.language);
        }
      } catch {
        if (!this.abort.signal.aborted) await this.progress.logDiagnostic(this.profileId, this.callId, "basic_translation_failed");
      }
    }
  }
}
