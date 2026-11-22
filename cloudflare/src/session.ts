import { isEmailConfirmation, isSummaryCallConsent, matchesEmailReadBack, normalizeSalesEmail, PHONE_NUMBER_GUIDANCE, recordSalesTool, SALES_TOOL_NAMES, SUMMARY_CALLBACK_GUIDANCE } from "./ad-entry";
import { AsyncQueue, sleep } from "./async";
import { concat, downsample24kTo8k, FRAME_BYTES, FRAME_MS, meanSquare, SILENCE_FRAME, upsample8kTo16k, wavToPcm } from "./audio";
import { BasicTranslator } from "./basic";
import { BusinessStore } from "./business";
import { callWithLessonSummary, canCallWithLessonSummary, lessonSummaryAudioText, normalizePhone } from "./callbacks";
import { adultControls, controlsFromSettings, type TutorControls } from "./controls";
import { type Env, type Settings, bearer, extensionPath, HttpError, paymentsConfigured, randomHex, secureEqual, sha256Hex, withinBase } from "./env";
import { GeminiLive, type ToolCall } from "./gemini";
import { geminiKeyForCall } from "./gemini-key";
import { acquireGeminiBudget, GeminiBudgetError, isGeminiError, reportGeminiOutcome } from "./gemini-budget";
import { SessionMeter } from "./meter";
import { CallRecorder } from "./recordings";
import { markQuickIntro, quickOpening, runtimeContext, startSchool } from "./pbx";
import { ProgressStore } from "./progress";
import { compilePrompt, type PromptArtifact } from "./prompt";
import { parseStartFrame, transferCommand } from "./technoline";
import { applyLearnerControls, goalFromLearnerSpeech, phoneTeacherFor, saveIntake } from "./learner";
import { LearningStore } from "./learning";
import { CALL_FAILURE_MESSAGE, HIDDEN_CALLER_MESSAGE, visiblePhone } from "./phone";

export const SILENCE_NUDGE_MS = 7000;
export const MAX_SILENCE_NUDGES = 2;
export const SILENCE_NUDGE_NOTE = "APPLICATION NOTE: the caller has been silent for several seconds after your last turn. They may not have heard you or may not know what to answer. In one short Hebrew sentence check that they can hear you (for example \"יש קליטה? אפשר לענות גם בעברית\"), then ask your last question again more simply; if it had options, name them briefly.";

export function silenceNudgeDue(now: number, lastHuman: number, lastTutorAudio: number, nudges: number): boolean {
  return nudges < MAX_SILENCE_NUDGES && now - Math.max(lastHuman, lastTutorAudio) >= SILENCE_NUDGE_MS;
}

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
  private reconnectAttempts = 0;
  private lastGeminiError = "";
  private geminiFailure = "";
  private failureStarted: number | null = null;
  private failureGapMs = 0;
  private finalMessage: string | null = null;
  private controls: TutorControls | null = null;
  private artifact: PromptArtifact | null = null;
  private lastInput = Date.now();
  private lastHuman = Date.now();
  private lastTutorAudio = Date.now();
  private silenceNudges = 0;
  private nudgedAt = 0;
  private clockPrevious = this.startedAt.getTime();
  private meteredAt: number | null = null;
  private basicGeminiCost = 0;
  private disconnected = false;
  private reason = "";
  private intakeReminded = false;
  private pendingEmail: { email: string; phase: "readback" | "answer"; text: string; audio: boolean } | null = null;
  private summaryCallbackRequested = false;
  private summaryCallbackSpeech = "";
  private salesWindowOpen = false;
  private practiceStarted: { at: number; failureGapMs: number } | null = null;
  private returnPath: string | null = null;
  private pbxBase: string | null = null;

  private extension(suffix = "") {
    return extensionPath(this.pbxBase ?? this.s.projectPath, suffix);
  }

  private rebase(target: string) {
    const primary = this.s.projectPath;
    return this.pbxBase && this.pbxBase !== primary && withinBase(primary, target) ? this.extension(primary === "/" ? (target === "/" ? "" : target) : target.slice(primary.length)) : target;
  }
  private callId = "";
  private customerId = "";
  private callerPhone = "";
  private leaseCallId = "";
  private profileId = "";
  private firstPbx = false;
  private firstAudio = false;
  private firstSent = false;
  private learnerSeen = false;
  private settling = false;
  private closingSent = false;
  private lessonDurationMs = 0;
  private allowanceMs = 0;
  private finalSent = false;
  private b: BusinessStore;
  private progress: ProgressStore;
  private recorder?: CallRecorder;

  private sendAudio(frame: Uint8Array) {
    this.pbx.send(frame);
    this.recorder?.send(frame);
  }

  constructor(private pbx: WebSocket, private env: Env, private s: Settings, private ownerId: string, private authorization: string | null = null, private portal?: { customerId: string; teacherId: string }) {
    this.b = new BusinessStore(env.DB);
    this.progress = new ProgressStore(env.DB);
    if (portal || env.RECORD_PHONE_CALLS === "1") this.recorder = new CallRecorder(env, () => `recordings/${this.callId}.ulaw`);
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
    this.recorder?.receive(new Uint8Array(data));
    this.input.push(new Uint8Array(data));
  }

  stop(reason = "admin_requested", disconnected = false) {
    this.disconnected ||= disconnected;
    if (this.settling) return;
    this.reason ||= reason;
    this.abort.abort(new Error(this.reason));
    this.input.end();
    this.ai?.close();
  }

  async run(raw: string, requestedProfile: string | null, shared: boolean) {
    let claimed = false;
    let reserved = false;
    let releaseBudget: (() => Promise<void>) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let hardLimit: ReturnType<typeof setTimeout> | undefined;
    let geminiConnected = false;
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
        const start = parseStartFrame(raw, this.s.routerChannels);
        if (this.rejectHiddenCaller(start.caller)) return;
        profileId = (await this.b.loadContext(start.callId)).selected_bot;
        if (!profileId) {
          const customerId = await this.b.identifyCall(start.caller || "private", start.callId, "ivr");
          await startSchool(this.b, this.progress, this.s, start.callId, customerId);
          profileId = (await this.b.loadContext(start.callId)).selected_bot;
        }
        if (!profileId) throw new Error("No phone teacher available");
      }
      if (!profileId) {
        const bots = await this.progress.listBots();
        profileId = bots.find((bot) => bot.channel_id && bot.channel_id === initial.token)?.id ?? this.s.studentId;
      }
      const bot = await this.progress.getBot(profileId);
      if (!bot || !bot.enabled || !(this.portal ? bot.web_enabled : bot.phone_enabled)) throw new Error("Tutor unavailable");
      this.profileId = profileId;
      const channel = this.portal ? "portal" : testChannel ? this.env.TEST_TEACHER_CHANNEL_ID : shared ? this.s.routerChannels : bot.channel_id;
      const start = parseStartFrame(raw, channel ?? "");
      if (!this.portal && this.rejectHiddenCaller(start.caller)) return;
      this.callerPhone = this.portal ? "" : start.caller;
      this.leaseCallId = start.callId;
      if (this.s.radioStreams[profileId]) {
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
        const context = await this.b.loadContext(start.callId);
        this.pbxBase = typeof context.pbx_base === "string" ? context.pbx_base : null;
        await this.b.saveContext(this.callId, context);
      }
      if (this.portal) {
        this.customerId = this.portal.customerId;
        await this.b.registerWebCall(this.callId, this.customerId, profileId);
        await this.b.saveContext(this.callId, await this.b.loadContext("preferences:" + this.customerId));
      } else {
        this.customerId = await this.b.identifyCall(start.caller, this.callId, profileId);
      }
      await this.latency("session_started");
      const defaults = profileId === this.s.adultStudentId ? adultControls(this.s.storeTranscripts) : controlsFromSettings(this.s.storeTranscripts);
      this.controls = await this.progress.loadControls(profileId, defaults);
      this.controls = await applyLearnerControls(this.b, this.customerId, bot, this.controls, this.portal?.teacherId, this.portal ? "web" : "phone");
      const opening = await quickOpening(this.b, this.callId);
      const callContext = await this.b.loadContext(this.callId);
      const adCall = callContext.entry === "ad";
      if (this.controls.lesson && adCall) this.controls = { ...this.controls, sales: true };
      if (this.controls.lesson && !this.portal) {
        const phonePayments = paymentsConfigured(this.env) && adCall
          ? ' If asked to pay by card on the phone, let them know they can use option 3 (packages and payment) from the main menu after the lesson. Do not take card details.' : "";
        this.controls.custom_instructions += "\n" + PHONE_NUMBER_GUIDANCE + phonePayments;
      }
      if (this.controls.lesson && shared && !this.portal && !testChannel && canCallWithLessonSummary(this.env, this.callerPhone)
        && this.controls.session_end_action === "hangup" && callContext.summary_callback_caller === await sha256Hex(normalizePhone(this.callerPhone)!)) {
        this.controls = { ...this.controls, summary_callback: true, custom_instructions: this.controls.custom_instructions + "\n" + SUMMARY_CALLBACK_GUIDANCE };
      }
      if (opening) this.controls = { ...this.controls, opening_message: opening + (this.controls.lesson && !adCall ? " Follow the active SpeakCall lesson configuration for ability, mode, targets and help; it overrides generic suggestions in this greeting." : "") };
      const history = await this.progress.lessonContext(this.customerId) + await this.b.lessonContext(this.customerId, profileId) + "\n" + await runtimeContext(this.b, this.callId);
      this.artifact = await compilePrompt(this.controls, history, profileId, this.s, { customerId: this.customerId });
      if (this.abort.signal.aborted) return;
      const allowance = await this.b.reserveCall(this.customerId, profileId, this.callId, this.controls.max_call_minutes * 60);
      reserved = allowance.seconds > 0;
      if (this.abort.signal.aborted) return;
      await this.latency("access_checked", { mode: allowance.mode });
      if (!allowance.seconds) {
        if (allowance.mode === "busy") {
          this.reason = "customer_busy";
          if (!this.portal && !this.disconnected) await this.queueBusyNotice().catch(() => {});
          return;
        }
        this.returnPath = allowance.extension ? this.rebase(allowance.extension) : null;
        this.reason = allowance.mode === "payment_failed" ? "payment_failed" : "access_blocked";
        return;
      }
      if (this.abort.signal.aborted) return;
      releaseBudget = await acquireGeminiBudget(this.env, () => this.basicGeminiCost || this.meter.usage(this.s).estimated_cost_usd, reason => this.stop(reason));
      if (this.abort.signal.aborted) return;
      if (this.controls.lesson) {
        await new LearningStore(this.env.DB).begin(this.customerId, this.callId, this.controls.lesson);
        await this.latency("learning_plan_ready", { vocabulary_targets: this.controls.lesson.vocabulary.length, grammar_targets: this.controls.lesson.grammar.length, material_rows: this.controls.lesson.material_status?.rows ?? null, material_targets: this.controls.lesson.material_status?.target_count ?? null });
      }
      this.lessonDurationMs = Math.min(allowance.seconds, this.controls.target_lesson_minutes * 60) * 1000;
      this.allowanceMs = allowance.seconds * 1000;
      hardLimit = setTimeout(() => {
        if (this.profileId.startsWith("isaac-")) this.returnPath = this.extension("/3");
        this.stop("hard_time_limit");
      }, (allowance.seconds + 20) * 1000);
      if (this.controls.store_transcripts) await this.progress.savePromptSnapshot(profileId, this.callId, this.artifact);
      if (this.abort.signal.aborted) return;
      if (allowance.mode === "basic") {
        this.controls = { ...this.controls, model: this.s.basicTranslatorModel };
        this.meteredAt = Date.now();
        clearTimeout(hardLimit);
        hardLimit = setTimeout(() => this.stop("hard_time_limit"), allowance.seconds * 1000);
        await this.runTasks([this.basicListen(allowance.intro ?? ""), this.pacedOutput(), this.watchdog()]);
      } else {
        if (this.abort.signal.aborted) return;
        const selected = await geminiKeyForCall(this.env, this.callId, adCall);
        this.s = { ...this.s, geminiKey: selected.key };
        await this.latency("gemini_connect_started", { tier: selected.tier });
        const ai = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, this.artifact.setup_message);
        this.ai = ai;
        await ai.connect();
        if (this.abort.signal.aborted) return;
        if (this.portal) this.pbx.send(JSON.stringify({ type: "ready" }));
        this.meteredAt = Date.now();
        this.lastHuman = Date.now();
        await this.latency("gemini_connected");
        geminiConnected = true;
        ai.startGreeting(this.controls.opening_message);
        if (allowance.mode === "free" || allowance.seconds <= 360) ai.addContext("APPLICATION NOTE: this call is limited to about " + Math.round(allowance.seconds / 60) + " minutes (" + (allowance.mode === "free" ? "free trial call" : "per-call limit of the learner's plan") + "). " + (this.controls.lesson ? "Do not announce this in the opening; answer briefly if asked." : "Mention this once, briefly and warmly in Hebrew, early in the call."));
        await this.latency("greeting_sent");
        clearTimeout(hardLimit);
        hardLimit = setTimeout(() => {
          if (this.profileId.startsWith("isaac-")) this.returnPath = this.extension("/3");
          this.stop("hard_time_limit");
        }, allowance.seconds * 1000);
        await this.runTasks([this.pbxToAi(), this.aiToOutput(), this.pacedOutput(), this.watchdog()]);
      }
    } catch (error) {
      if (error instanceof GeminiBudgetError) {
        this.reason ||= error.reason;
        return;
      }
      if (!this.reason) this.reason = "call_failed";
      if (this.ai && !this.abort.signal.aborted) {
        this.failureStarted ??= Date.now();
        this.finalMessage = CALL_FAILURE_MESSAGE;
      }
      if (this.profileId && this.callId && !this.abort.signal.aborted) {
        const message = (error instanceof Error ? error.message : "Unknown error").split(this.s.geminiKey).join("[redacted]");
        await this.progress.logDiagnostic(this.profileId, this.callId, "call_failed", { error_type: error instanceof Error ? error.name : "Error", message: message.slice(0, 250) });
        if (isGeminiError(error)) {
          geminiConnected = false;
          await reportGeminiOutcome(this.env, false, message);
        }
      }
    } finally {
      if (geminiConnected) void reportGeminiOutcome(this.env, !this.geminiFailure, this.geminiFailure);
      this.settling = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (hardLimit !== undefined) clearTimeout(hardLimit);
      this.abort.abort(new Error("session_finished"));
      this.input.end();
      this.ai?.close();
      const budgetRelease = releaseBudget?.();
      let willCallWithSummary = false;
      try {
        if (this.finalMessage && !this.disconnected) await this.speakFinalMessage(this.finalMessage);
        if (reserved && this.meteredAt === null) await this.b.cancelCallReservation(this.callId);
        if (this.callId && this.customerId && this.controls) {
          try {
            await this.latency("ai_connection_closed", { reason: this.reason || "transport_ended" });
            await this.drainFinalAudio();
          } finally {
            if (reserved && this.meteredAt !== null) {
              const billed = Math.max(0, ((this.failureStarted ?? Date.now()) - this.meteredAt - this.failureGapMs) / 1000);
              await this.b.settleCall(this.callId, billed);
            }
          }
          if (reserved && releaseBudget) {
            await this.progress.saveSession({ student_id: this.customerId, call_id: this.callId, started_at: this.startedAt, learner_turns: this.meter.learnerTurns, tutor_turns: this.meter.tutorTurns, observations: this.meter.observations, transcript: this.controls.store_transcripts ? this.meter.transcript : null, summary: this.meter.summary(), usage: this.meter.usage(this.s), model: this.controls.model });
            await this.latency("session_saved");
          }
        }
        await budgetRelease;
        if (claimed) await this.progress.releaseCall(this.leaseCallId, this.ownerId);
        const target = this.finalMessage || this.reason === "customer_busy" ? null : this.returnPath || (this.controls?.session_end_action === "return_to_menu" ? (shared ? this.extension() : this.s.returnExtension) : null);
        if (!this.disconnected) {
          this.pbx.send(this.portal ? JSON.stringify({ type: "hangup", reason: this.reason }) : target ? transferCommand(target) : JSON.stringify({ type: "hangup" }));
        }
        willCallWithSummary = this.summaryCallbackRequested && !target && ["model:task_completed", "model:caller_requested", "caller_disconnected"].includes(this.reason);
      } finally {
        await budgetRelease;
        if (claimed) await this.progress.releaseCall(this.leaseCallId, this.ownerId).catch(() => {});
        this.output = [];
        try { this.pbx.close(1000, "session ended"); } catch { /* peer already closed */ }
        await this.recorder?.finish(this.callId, this.profileId, this.customerId);
      }
      if (willCallWithSummary) {
        const text = lessonSummaryAudioText(this.meter.lessonSummary?.points, this.meter.learnerTurns);
        const accepted = await callWithLessonSummary(this.env, this.callerPhone, this.leaseCallId,
          () => new BasicTranslator(this.env, this.s).speak(text, "he-IL", "Standard-B", false)).catch(() => false);
        await this.progress.logDiagnostic(this.profileId, this.callId, "summary_callback", { accepted }).catch(() => {});
      }
    }
  }

  private async runTasks(tasks: Promise<void>[]) {
    try { await Promise.race(tasks); }
    catch (error) {
      if (!this.abort.signal.aborted && !this.reason && isGeminiError(error)) this.geminiFailure = (error as Error).message.split(this.s.geminiKey).join("[redacted]").slice(0, 200);
      throw error;
    }
    finally {
      this.abort.abort(new Error("bridge_finished"));
      this.ai?.close();
      this.input.end();
      await Promise.allSettled(tasks);
    }
  }

  private rejectHiddenCaller(caller: string): boolean {
    if (visiblePhone(caller)) return false;
    this.reason = "hidden_caller_rejected";
    this.finalMessage = HIDDEN_CALLER_MESSAGE;
    return true;
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
      if (!this.abort.signal.aborted && !this.reason) {
        try { this.ai!.sendAudio(pcm); } catch { this.ai?.close(); }
      }
    }
  }

  private async aiToOutput() {
    while (!this.abort.signal.aborted) {
      const event = await this.ai!.next();
      if (this.abort.signal.aborted) return;
      if (event.type === "closed") {
        this.reconnecting = this.reconnectGemini();
        await this.reconnecting;
        this.reconnecting = null;
        if (this.reason || this.abort.signal.aborted) return;
        continue;
      }
      if (event.type === "audio") {
        if (this.pendingEmail?.phase === "readback") this.pendingEmail.audio ||= event.pcm24k.byteLength > 0;
        if (!this.firstAudio) { this.firstAudio = true; await this.latency("first_gemini_audio", { tutor_turn: this.meter.tutorTurns + 1 }); }
        this.meter.outputAudioBytes += event.pcm24k.byteLength;
        const [pcm, carry] = downsample24kTo8k(event.pcm24k, this.carry);
        this.carry = carry;
        this.enqueue(pcm);
      } else if (event.type === "interrupted") {
        this.pendingEmail = null;
        this.summaryCallbackSpeech = "";
        this.output = [];
        this.partial = new Uint8Array();
        this.carry = new Uint8Array();
        await this.latency("tutor_interrupted");
      } else if (event.type === "transcript") {
        const pending = this.pendingEmail;
        if (pending) {
          const expected = pending.phase === "readback" ? "tutor" : "learner";
          const text = event.rawText ?? event.text;
          if (event.role === expected && pending.text.length + text.length <= 1024) pending.text += text;
          else this.pendingEmail = null;
        }
        this.meter.transcript.push({ role: event.role, text: event.text });
        if (this.controls?.store_transcripts) await this.progress.logTurn(this.profileId, this.callId, event.role === "learner" ? "input" : "output", event.text);
        if (event.role === "learner") {
          if (this.controls?.summary_callback) {
            this.summaryCallbackSpeech = (this.summaryCallbackSpeech + (event.rawText ?? event.text)).slice(0, 512);
            if (/(?:אל תתקשר|אל תשלח|לא רוצה שיחת סיכום|בלי שיחת סיכום|בטל את שיחת הסיכום)/.test(this.summaryCallbackSpeech)) this.summaryCallbackRequested = false;
          }
          this.lastHuman = Date.now();
          if (!this.learnerSeen) this.meter.learnerTurns++;
          this.learnerSeen = true;
        }
      } else if (event.type === "turn_complete") {
        this.summaryCallbackSpeech = "";
        const pending = this.pendingEmail;
        // Gemini can finish a tool-only turn before speaking the read-back.
        if (pending?.phase !== "readback" || pending.audio || pending.text) {
          this.pendingEmail = pending?.phase === "readback" && pending.audio && matchesEmailReadBack(pending.text, pending.email)
            ? { ...pending, phase: "answer", text: "" } : null;
        }
        this.meter.tutorTurns++;
        this.learnerSeen = false;
        this.firstAudio = false;
        await this.latency("tutor_turn_complete", { tutor_turn: this.meter.tutorTurns });
        if (this.controls?.lesson) {
          await new LearningStore(this.env.DB).exposures(this.customerId, this.callId, this.controls.lesson.vocabulary, this.meter.transcript.filter(t => t.role === "tutor").map(t => t.text).join(" "));
        }
      } else if (event.type === "usage") this.meter.recordUsage(event.usage);
      else if (event.type === "tool_call") {
        for (const call of event.calls) {
          const saved = await this.recordTool(call);
          this.ai!.submitToolResult(call, saved, call.name === "prepare_email" ? {
            prepared: saved,
            next_step: saved ? "Read back the email and wait. After the caller confirms, call save_email." : "Ask the caller to clarify the address.",
          } : undefined);
          if (call.name === "end_session" && saved) return;
        }
      } else if (event.type === "go_away") {
        this.reconnecting = this.reconnectGemini(true);
        await this.reconnecting;
        this.reconnecting = null;
        if (this.reason || this.abort.signal.aborted) return;
      }
    }
  }

  private async reconnectGemini(preservePlayback = false) {
    this.pendingEmail = null;
    this.summaryCallbackSpeech = "";
    this.failureStarted ??= Date.now();
    const handle = this.ai?.resumeHandle;
    this.ai?.close();
    if (!preservePlayback) {
      this.output = [];
      this.partial = new Uint8Array();
      this.carry = new Uint8Array();
    }
    while (!this.abort.signal.aborted && this.reconnectAttempts < 2 && this.artifact) {
      const attempt = ++this.reconnectAttempts;
      const setup = structuredClone(this.artifact.setup_message) as { setup: Record<string, unknown> };
      setup.setup.sessionResumption = handle ? { handle } : {};
      const replacement = new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, setup);
      this.ai = replacement;
      try {
        await replacement.connect(5000);
        if (this.abort.signal.aborted) { replacement.close(); return; }
        if (!handle) replacement.startGreeting("Continue the interrupted lesson without repeating the greeting. Recent conversation: " + JSON.stringify(this.meter.transcript.slice(-20)));
        this.failureGapMs += Date.now() - this.failureStarted!;
        this.failureStarted = null;
        this.lastGeminiError = "";
        this.lastHuman = Date.now();
        await this.progress.logDiagnostic(this.profileId, this.callId, "gemini_reconnected", { attempt, resumed: !!handle }).catch(() => {});
        return;
      } catch (error) {
        replacement.close();
        this.lastGeminiError = (error instanceof Error ? error.message : "").split(this.s.geminiKey).join("[redacted]").slice(0, 150);
        await this.progress.logDiagnostic(this.profileId, this.callId, "gemini_reconnect_failed", { attempt }).catch(() => {});
      }
    }
    if (this.abort.signal.aborted) return;
    this.reason = "gemini_reconnect_exhausted";
    this.geminiFailure = "Gemini reconnect exhausted: " + this.lastGeminiError;
    this.finalMessage = CALL_FAILURE_MESSAGE;
    await this.progress.logDiagnostic(this.profileId, this.callId, this.reason, { attempts: this.reconnectAttempts }).catch(() => {});
  }

  private async speakFinalMessage(text: string) {
    try {
      const pcm = await new BasicTranslator(this.env, this.s).speak(text, "he-IL");
      for (let offset = 0; offset < pcm.length && !this.disconnected; offset += FRAME_BYTES) {
        const frame = new Uint8Array(FRAME_BYTES);
        frame.set(pcm.subarray(offset, offset + FRAME_BYTES));
        this.sendAudio(frame);
        await sleep(FRAME_MS);
      }
      if (!this.disconnected) await sleep(200);
    } catch {
      if (this.callId) await this.progress.logDiagnostic(this.profileId, this.callId, "failure_prompt_failed").catch(() => {});
    }
  }

  private async recordTool(call: ToolCall): Promise<boolean> {
    const args = call.args ?? {};
    if (call.name === "request_summary_callback") {
      if (!this.controls?.summary_callback || !isSummaryCallConsent(this.summaryCallbackSpeech) ||
        !canCallWithLessonSummary(this.env, this.callerPhone)) return false;
      this.summaryCallbackRequested = true;
      return true;
    }
    if (call.name === "start_ad_practice") {
      if (!this.controls?.sales || this.controls.intake_pending || !this.learnerSeen) return false;
      this.practiceStarted ??= { at: Date.now(), failureGapMs: this.failureGapMs };
      return true;
    }
    if (call.name === "report_learning_batch") {
      if (!this.controls?.lesson) return false;
      try {
        const saved = await new LearningStore(this.env.DB).record(this.customerId, this.callId, args);
        await this.progress.logDiagnostic(this.profileId, this.callId, "learning_batch_result", { saved, vocabulary_count: Array.isArray(args.vocabulary) ? args.vocabulary.length : null, grammar_count: Array.isArray(args.grammar) ? args.grammar.length : null }).catch(() => {});
        return saved;
      } catch {
        await this.progress.logDiagnostic(this.profileId, this.callId, "learning_batch_failed");
        return false;
      }
    }
    if (this.controls?.lesson && call.name === "record_learning_observation") return false;
    if (call.name && SALES_TOOL_NAMES.has(call.name)) {
      if (!this.controls?.sales || !this.customerId) return false;
      let allowed = true;
      let saved = false;
      if (call.name === "prepare_email") {
        const email = normalizeSalesEmail(args.email);
        this.pendingEmail = email ? { email, phase: "readback", text: "", audio: false } : null;
        saved = !!email;
      } else {
        if (call.name === "save_email") {
          const pending = this.pendingEmail;
          this.pendingEmail = null;
          allowed = pending?.phase === "answer" && normalizeSalesEmail(args.email) === pending.email && isEmailConfirmation(pending.text);
        }
        if (call.name === "schedule_next_lesson" && !this.salesWindowOpen) allowed = false;
        if (allowed) saved = await recordSalesTool(this.b, this.customerId, this.callId, call.name, args, this.env.PORTAL_EMAIL, this.callerPhone,
          { name: this.controls.teacher_name, female: this.controls.teacher_female }).catch(() => false);
      }
      await this.progress.logDiagnostic(this.profileId, this.callId, "sales_tool", { tool: call.name, saved }).catch(() => {});
      return saved;
    }
    if (call.name === "save_intake") {
      const heard = this.meter.transcript.filter(t => t.role === "learner").map(t => t.text).join(" ");
      const goal = typeof args.goal === "string" && this.controls?.intake_pending ? goalFromLearnerSpeech(args.goal, heard) : args.goal;
      const previewTeacher = this.portal?.teacherId;
      const saved = await saveIntake(this.b, this.customerId, await phoneTeacherFor(this.progress, this.profileId), { ...args, goal }, { lessonBotId: this.profileId, previewTeacher });
      await this.progress.logDiagnostic(this.profileId, this.callId, "intake_saved", { saved, goal, model_goal: args.goal, level: args.level, topic: args.topic ?? null }).catch(() => {});
      if (saved && this.controls) {
        const controls = this.controls = { ...this.controls, intake_pending: false };
        const bot = { id: this.profileId, role: "teacher" } as const;
        const refresh = (teacher?: string) => applyLearnerControls(this.b, this.customerId, bot, controls, teacher, this.portal ? "web" : "phone");
        const lesson = await refresh(previewTeacher).then(c => c.lesson).catch(async error => {
          if (!previewTeacher || !(error instanceof HttpError) || error.status !== 404) throw error;
          const previous = controls.lesson;
          if (!previous || (args.level === undefined && args.topic === undefined)) return previous;
          const updated = (await refresh("")).lesson;
          return {
            ...previous,
            level: args.level === undefined ? previous.level : updated?.level ?? previous.level,
            topic: args.topic === undefined ? previous.topic : updated?.topic ?? previous.topic,
          };
        });
        const access = this.portal ? "These override the requested direction when access is limited." : "The level immediately replaces the earlier conversational level; access limits apply to curriculum, not to the difficulty of your English conversation. Continue assessing only the original targets until the next call.";
        this.ai?.addContext(`APPLICATION NOTE: lesson direction saved (the same settings the website shows). For the rest of this call use the effective topic=${JSON.stringify(lesson?.topic)}, level=${JSON.stringify(lesson?.level)}. ${access} The full saved plan applies from the next call. Start or continue the lesson now.`);
      }
      return saved;
    }
    if (call.name === "end_session") {
      if (this.controls?.intake_pending && !this.intakeReminded && args.reason !== "caller_requested" && args.reason !== "no_response" && !args.destination) {
        this.intakeReminded = true;
        await this.progress.logDiagnostic(this.profileId, this.callId, "intake_missing_at_end").catch(() => {});
        this.ai?.addContext("APPLICATION NOTE: the first-call intake was not saved. Do not hang up yet: call save_intake now with the goal and level the learner gave (omit unknown answers), then say goodbye and call end_session again.");
        return false;
      }
      const reason = ["caller_requested", "task_completed", "no_response"].includes(String(args.reason)) ? String(args.reason) : "task_completed";
      const destinations: Record<string, string> = { main: "", school: "/1", options: "/2" };
      if (reason === "caller_requested" && typeof args.destination === "string" && Object.hasOwn(destinations, args.destination) && this.callId.includes("~")) this.returnPath = this.extension(destinations[args.destination]);
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
      this.sendAudio(audio ?? SILENCE_FRAME);
      if (audio) this.lastTutorAudio = Date.now();
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
      if (!this.reconnecting && Date.now() - this.lastHuman >= this.controls!.idle_timeout_seconds * 1000) { this.stop("idle_timeout"); return; }
      this.maybeOpenSalesWindow(Date.now());
      this.maybeNudgeSilence(Date.now());
      if (this.lessonDurationMs && this.meteredAt !== null && !this.closingSent && !this.reconnecting && !this.output.length) {
        const target = this.lessonDurationMs;
        if (Date.now() - this.meteredAt >= target - Math.min(60000, target / 4)) {
          this.ai?.addContext("APPLICATION CLOCK: closing stage reached. At the next natural pause, begin the configured closing " + (this.controls?.lesson?.closing_activity ?? "short recap") + ", then save the results and the lesson summary (record_lesson_summary) before saying goodbye. Report only demonstrated results. This is not permission to hang up; respect the ending policy and explicit requests to stop.");
          this.closingSent = true;
        }
      }
      if (this.allowanceMs && this.meteredAt !== null && !this.finalSent && !this.reconnecting && Date.now() - this.meteredAt >= this.allowanceMs - 25000) {
        this.ai?.addContext("APPLICATION CLOCK: about 20 seconds remain before the line closes. If not done yet, save the results and lesson summary now, then say one short warm goodbye in Hebrew.");
        this.finalSent = true;
      }
      await sleep(500, this.abort.signal);
    }
  }

  private maybeNudgeSilence(now: number) {
    if (!this.ai || !this.controls?.lesson || this.pendingEmail || !this.firstSent || this.reconnecting || this.closingSent || this.finalSent || this.output.length) return;
    if (this.lastHuman > this.nudgedAt) this.silenceNudges = 0;
    if (!silenceNudgeDue(now, this.lastHuman, this.lastTutorAudio, this.silenceNudges)) return;
    this.silenceNudges++;
    this.nudgedAt = this.lastTutorAudio = now;
    this.ai.prompt(SILENCE_NUDGE_NOTE);
    void this.progress.logDiagnostic(this.profileId, this.callId, "silence_nudge", { nudge: this.silenceNudges }).catch(() => {});
  }

  private maybeOpenSalesWindow(now: number) {
    if (this.practiceStarted && !this.salesWindowOpen && !this.reconnecting && !this.output.length &&
      now - this.practiceStarted.at - (this.failureGapMs - this.practiceStarted.failureGapMs) >= 90000) {
      this.ai?.addContext("APPLICATION CLOCK: the 90-second practice milestone has passed. At a natural pause, offer tomorrow's lesson only if the learner shows interest in continuing.");
      this.salesWindowOpen = true;
    }
  }

  private async queueBusyNotice() {
    const notice = await this.env.ASSETS.fetch(new Request("https://assets.invalid/customer-busy.wav"));
    if (notice.ok) this.enqueue(wavToPcm(new Uint8Array(await notice.arrayBuffer())));
  }

  private async drainFinalAudio() {
    if (this.disconnected || !(this.reason.startsWith("model:") || (this.reason === "customer_busy" && !this.portal))) return;
    if (this.partial.length) {
      const padded = new Uint8Array(FRAME_BYTES);
      padded.set(this.partial);
      this.output.push(padded);
      this.partial = new Uint8Array();
    }
    for (const frame of this.output.splice(0)) {
      if (this.disconnected) break;
      this.sendAudio(frame);
      await sleep(FRAME_MS);
    }
    for (let i = 0; i < 10 && !this.disconnected; i++) { this.sendAudio(SILENCE_FRAME); await sleep(FRAME_MS); }
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
        const result = await translator.translate(utterance, this.abort.signal);
        this.basicGeminiCost += (result.input_tokens * 0.5 + result.output_tokens * 1.5) / 1_000_000;
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
