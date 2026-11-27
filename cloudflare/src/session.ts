import { resolveTurnTuning } from "./turn-tuning";
import { hasEligibleSummaryCallResponse, isEmailConfirmation, matchesEmailReadBack, normalizeSalesEmail, PHONE_NUMBER_GUIDANCE, recordSalesTool, revokesSummaryCall, SALES_TOOL_NAMES, type SalesToolResult, SUMMARY_CALLBACK_GUIDANCE } from "./ad-entry";
import { AsyncQueue, sleep } from "./async";
import { QUOTA_EXTENSION_PATH } from "../../src/pbx-paths";
import { concat, downsample24kTo8k, FRAME_BYTES, FRAME_MS, meanSquare, SILENCE_FRAME, upsample8kTo16k, wavToPcm } from "./audio";
import { BasicTranslator } from "./basic";
import { type ContentDenial, ContentSafetyError, ContentSafetyStore, ContentTurn, confirmCriticalIncident, contentDenialMessage, contentPolicy, pilotContentPolicy } from "./content-safety";
import { type Allowance, BusinessStore } from "./business";
import { callWithLessonSummary, canCallWithLessonSummary, lessonSummaryAudioText, normalizePhone } from "./callbacks";
import { adultControls, controlsFromSettings, type TutorControls } from "./controls";
import { type Env, type Settings, bearer, extensionPath, HttpError, paymentsConfigured, randomHex, secureEqual, sha256Hex, withinBase } from "./env";
import { GeminiLive, type ToolCall } from "./gemini";
import { CascadeLive, synthesizeCascadeNotice, type CascadeConfig } from "./cascade";
import { coachMode, TranscriptCoach } from "./lesson-coach";
import { pilotLog } from "./pbx-pilot-log";
import { geminiKeyForCall, hasPaidReceipt } from "./gemini-key";
import { acquireGeminiBudget, GeminiBudgetError, isGeminiError, reportGeminiOutcome } from "./gemini-budget";
import { SessionMeter } from "./meter";
import { CallRecorder } from "./recordings";
import { markQuickIntro, quickOpening, runtimeContext, startSchool } from "./pbx";
import { ProgressStore } from "./progress";
import { practiceSummary } from "./practice";
import { reminderGuidance, savePracticeReminder } from "./practice-reminders";
import { masteryDomainGuidance, saveMasteryDomain } from "./mastery-domain";
import { compilePrompt, type PromptArtifact } from "./prompt";
import { OFFER_GUIDANCE, offerGift, salesOfferTestPhone, SALES_EXTENSION_PATH } from "./sales-offer";
import { parseStartFrame, transferCommand } from "./technoline";
import { applyLearnerControls, goalFromLearnerSpeech, phoneTeacherFor, saveIntake } from "./learner";
import { LearningStore } from "./learning";
import { CALL_FAILURE_MESSAGE, HIDDEN_CALLER_MESSAGE, visiblePhone } from "./phone";

export const SILENCE_NUDGE_MS = 7000;
export const MAX_SILENCE_NUDGES = 2;
export const SILENCE_NUDGE_NOTE = "APPLICATION NOTE: the caller has been silent for several seconds after your last turn. They may not have heard you or may not know what to answer. In one short Hebrew sentence check that they can hear you (for example \"יש קליטה? גם עברית זה מצוין.\"), then ask your last question again more simply; if it had options, name them briefly.";
export const PHONE_SILENCE_NUDGE_NOTE = SILENCE_NUDGE_NOTE + " Rephrase the question itself in Hebrew, not English. Return to Hebrew and reset the independent-answer count according to the phone language policy.";

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
  private crmUsageLoggedAt = 0;
  private pilotTurnEndedAt: number | null = null;
  private ai: GeminiLive | CascadeLive | null = null;
  private cascadeConfig: CascadeConfig | null = null;
  private pilotTranscriptChunk = "";
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
  private disconnectDetails: Record<string, unknown> = {};
  private intakeReminded = false;
  private endConfirmationAt: number | null = null;
  private pendingEmail: { email: string; phase: "readback" | "answer"; text: string; audio: boolean } | null = null;
  private summaryCallbackRequested = false;
  private summaryCallbackSpeech = "";
  private practiceReminders = false;
  private masteryDomain = false;
  private reminderSpeech = "";
  private salesWindowOpen = false;
  private practiceStarted: { at: number; failureGapMs: number } | null = null;
  private returnPath: string | null = null;
  private offerCall = false;
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
  private tutorAudioReceived = false;
  private firstSent = false;
  private learnerSeen = false;
  private settling = false;
  private closingSent = false;
  private lessonDurationMs = 0;
  private allowanceMs = 0;
  private freeTrial = false;
  private freeFollowup = false;
  private finalSent = false;
  private b: BusinessStore;
  private progress: ProgressStore;
  private recorder?: CallRecorder;
  private safety: ContentTurn | null = null;
  private safetyMuted = false;
  private safetyTimer?: ReturnType<typeof setTimeout>;
  private safetyFollowup?: Promise<void>;

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
        const type = String(p.type ?? "").toLowerCase();
        if (["stop", "hangup", "end"].includes(type)) this.stop("caller_disconnected", true, {
          disconnect_source: "pbx_control", control_type: type,
          ...(Number.isSafeInteger(p.code) ? { control_code: p.code } : {}),
          ...(typeof p.reason === "string" ? { control_reason: this.disconnectReason(p.reason) } : {}),
          ...(typeof p.wasClean === "boolean" ? { was_clean: p.wasClean } : {}),
        });
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

  pbxClosed(event: Pick<CloseEvent, "code" | "reason" | "wasClean">) {
    this.stop("caller_disconnected", true, {
      disconnect_source: "websocket_close", close_code: event.code,
      close_reason: this.disconnectReason(event.reason), was_clean: event.wasClean,
    });
  }

  private disconnectReason(value: string) {
    let text = value;
    for (const secret of [this.s.geminiKey, ...Object.values(this.env)]) {
      if (typeof secret === "string" && secret.length >= 8) text = text.split(secret).join("[redacted]");
    }
    return text.replace(/(?:https?|wss?):\/\/\S+/gi, "[redacted URL]")
      .replace(/\b(?:bearer\s+\S+|(?:token|key|secret|password|authorization)\s*[:=]\s*\S+)/gi, "[redacted]")
      .replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 123);
  }

  stop(reason = "admin_requested", disconnected = false, details?: Record<string, unknown>) {
    this.disconnected ||= disconnected;
    if (this.settling) return;
    if (!this.reason && details) this.disconnectDetails = details;
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
    const cascadePilot = this.env.PBX_CASCADE_PILOT === "1";
    try {
      if (this.abort.signal.aborted) return;
      const initial = JSON.parse(raw);
      let profileId = requestedProfile;
      const testChannel = !!this.env.TEST_TEACHER_CHANNEL_ID && initial.token === this.env.TEST_TEACHER_CHANNEL_ID;
      if (cascadePilot && (!testChannel || shared || this.portal || profileId !== "isaac-basic")) {
        await pilotLog(this.env, "channel_mismatch", {
          token_present: typeof initial.token === "string" && initial.token.length > 0, channel_matches: testChannel,
        });
        throw new Error("Unexpected pilot channel or profile");
      }
      if (testChannel) {
        if (!cascadePilot && !secureEqual(bearer(this.authorization), this.env.TEST_TEACHER_BEARER_SECRET ?? "")) throw new Error("Invalid test-channel authentication");
        const testProfile = cascadePilot ? "isaac-basic" : this.s.studentId;
        if (shared || (profileId && profileId !== testProfile)) throw new Error("Invalid test-channel profile");
        profileId = testProfile;
      }
      if (cascadePilot) {
        const { PBX_PILOT_SONIOX_KEY, PBX_PILOT_OPENROUTER_KEY, PBX_PILOT_INWORLD_KEY } = this.env;
        if (!PBX_PILOT_SONIOX_KEY || !PBX_PILOT_OPENROUTER_KEY || !PBX_PILOT_INWORLD_KEY) throw new Error("Pilot engine is unconfigured");
        const googleKey = this.env.PBX_PILOT_SPEECH === "google" ? this.env.PBX_PILOT_GOOGLE_TTS_KEY : undefined;
        if (this.env.PBX_PILOT_SPEECH === "google" && !googleKey) throw new Error("Pilot Google TTS is unconfigured");
        this.cascadeConfig = {
          sonioxKey: PBX_PILOT_SONIOX_KEY,
          openrouterKey: PBX_PILOT_OPENROUTER_KEY,
          inworldKey: PBX_PILOT_INWORLD_KEY,
          googleKey,
          interruption: this.env.PBX_PILOT_INTERRUPTION,
          endpointMs: this.env.PBX_PILOT_ENDPOINT_MS,
          tuning: this.env.PBX_PILOT_TUNING,
          model: this.env.PBX_PILOT_MODEL || "qwen/qwen3-235b-a22b-2507",
          voice: this.env.PBX_PILOT_VOICE || "Amos",
        };
        this.meter.useCascade();
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
      let start: ReturnType<typeof parseStartFrame>;
      try {
        start = parseStartFrame(raw, channel ?? "");
      } catch (error) {
        if (cascadePilot) await pilotLog(this.env, "start_rejected", { text_frame: true });
        throw error;
      }
      if (cascadePilot) await pilotLog(this.env, "start_validated");
      if (!this.portal && this.rejectHiddenCaller(start.caller)) {
        if (cascadePilot) await pilotLog(this.env, "caller_not_visible");
        return;
      }
      this.callerPhone = this.portal ? "" : start.caller;
      this.leaseCallId = start.callId;
      if (this.s.radioStreams[profileId]) {
        throw new Error("This test endpoint currently supports teachers and translators only");
      }
      claimed = await this.progress.claimCall(start.callId, profileId, this.ownerId);
      if (!claimed) throw new Error("Duplicate call connection");
      heartbeat = setInterval(() => {
        void this.progress.renewCall(this.leaseCallId, this.ownerId).then(async (renewed) => {
          if (!renewed) this.stop("call_lease_lost");
          else if (this.safety && !this.safetyMuted && !this.abort.signal.aborted) await this.checkContentHold();
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
      if (bot.role === "teacher") {
        const policy = cascadePilot ? pilotContentPolicy() : contentPolicy(this.env);
        if (policy) {
          this.safety = new ContentTurn(policy);
          if (await this.checkContentHold()) return;
        }
      }
      await this.latency("session_started", this.cascadeConfig ? {
        model: this.cascadeConfig.model, voice: this.cascadeConfig.voice,
        speech: this.cascadeConfig.googleKey ? "Google Standard" : "Inworld",
        transcript_enabled: this.env.PBX_PILOT_CAPTURE === "1",
      } : {});
      const defaults = profileId === this.s.adultStudentId ? adultControls(this.s.storeTranscripts) : controlsFromSettings(this.s.storeTranscripts);
      this.controls = await this.progress.loadControls(profileId, defaults);
      const callContext = await this.b.loadContext(this.callId);
      this.offerCall = !!callContext.offer_call && !this.portal;
      const adCall = callContext.entry === "ad";
      if (!cascadePilot && shared && !this.portal && bot.role === "teacher" && callContext.primary_teacher_entry &&
          callContext.quick_entry === "school" && !adCall && !this.offerCall && this.env.SCHOOL_VOICE_SETTINGS) {
        const selected = await this.env.SCHOOL_VOICE_SETTINGS.fetch("https://internal.invalid/settings", {
          signal: AbortSignal.timeout(1500),
        }).then(response => response.ok ? response.json<CascadeConfig | null>() : null).catch(() => null);
        if (selected) {
          this.cascadeConfig = selected;
          await this.latency("school_voice_selected", { model: selected.model, voice: selected.voice,
            speech: selected.googleKey ? "Google Standard" : "Inworld" });
        }
        this.controls = { ...this.controls, store_transcripts: true };
      }
      this.controls = await applyLearnerControls(this.b, this.customerId, bot, this.controls, this.portal?.teacherId, this.portal ? "web" : "phone", adCall, this.cascadeConfig?.voice);
      const opening = await quickOpening(this.b, this.callId);
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
      if (bot?.role === "teacher" && !this.customerId.startsWith("anonymous-")) {
        const practice = await practiceSummary(this.env.DB, this.customerId);
        this.practiceReminders = !!practice.package && !!this.controls.lesson;
        if (this.practiceReminders) this.controls.custom_instructions += "\n" + reminderGuidance(!!practice.reminder?.active);
        const domainGuidance = this.controls.lesson ? await masteryDomainGuidance(this.env.DB, this.customerId) : null;
        this.masteryDomain = !!domainGuidance;
        if (domainGuidance) this.controls.custom_instructions += "\n" + domainGuidance;
        const streak = practice.current_streak + (practice.today.practiced ? 0 : 1);
        if (practice.package && streak >= 2 && practice.current_streak > 0) this.controls.opening_message += ` Open briefly in natural Hebrew with "יום ${streak} ברצף!", then continue normally; use gender-neutral language.`;
      }
      const history = await this.progress.lessonContext(this.customerId) + await this.b.lessonContext(this.customerId, profileId) + "\n" + await runtimeContext(this.b, this.callId);
      if (this.abort.signal.aborted) return;
      if (this.offerCall) {
        this.controls.custom_instructions += "\n" + OFFER_GUIDANCE;
        this.controls.opening_message = OFFER_GUIDANCE;
        this.controls.summary_callback = false;
      }
      const testGift = this.offerCall && salesOfferTestPhone(this.env, this.callerPhone)
        ? await offerGift(this.b, this.env, callContext.offer_call, this.customerId, this.callId) : 0;
      let allowance: Allowance = cascadePilot ? { seconds: 300, mode: "pilot" } : testGift ? { seconds: testGift, mode: "free" } : await this.b.reserveCall(this.customerId, profileId, this.callId, this.controls.max_call_minutes * 60);
      if (this.offerCall && !allowance.seconds && ["free", "blocked"].includes(allowance.mode)) {
        const seconds = await offerGift(this.b, this.env, callContext.offer_call, this.customerId, this.callId);
        if (seconds) allowance = { seconds, mode: "free" };
      }
      this.freeTrial = allowance.mode === "free";
      this.freeFollowup = allowance.free_followup === true;
      reserved = !cascadePilot && allowance.seconds > 0;
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
      const paid = allowance.mode === "paid" && await hasPaidReceipt(this.env, this.callId);
      this.artifact = await compilePrompt(this.controls, history, profileId, this.s, { customerId: this.customerId, practiceReminders: this.practiceReminders, masteryDomain: this.masteryDomain });
      if (!this.cascadeConfig || allowance.mode === "basic") releaseBudget = await acquireGeminiBudget(this.env, () => this.basicGeminiCost || this.meter.usage(this.s).estimated_cost_usd, reason => this.stop(reason), { paid });
      if (this.abort.signal.aborted) return;
      if (this.controls.lesson) {
        await new LearningStore(this.env.DB).begin(this.customerId, this.callId, this.controls.lesson);
        await this.latency("learning_plan_ready", { vocabulary_targets: this.controls.lesson.vocabulary.length, grammar_targets: this.controls.lesson.grammar.length, material_rows: this.controls.lesson.material_status?.rows ?? null, material_targets: this.controls.lesson.material_status?.target_count ?? null });
      }
      this.lessonDurationMs = Math.min(allowance.seconds, this.controls.target_lesson_minutes * 60) * 1000;
      this.allowanceMs = allowance.seconds * 1000;
      hardLimit = setTimeout(() => {
        if (this.profileId.startsWith("isaac-")) this.returnPath = this.extension(QUOTA_EXTENSION_PATH);
        this.stop("hard_time_limit");
      }, (allowance.seconds + 20) * 1000);
      if (this.controls.store_transcripts) await this.progress.savePromptSnapshot(profileId, this.callId, this.artifact);
      if (this.abort.signal.aborted) return;
      if (allowance.mode === "basic") {
        this.cascadeConfig = null;
        this.controls = { ...this.controls, model: this.s.basicTranslatorModel };
        this.meteredAt = Date.now();
        clearTimeout(hardLimit);
        hardLimit = setTimeout(() => this.stop("hard_time_limit"), allowance.seconds * 1000);
        await this.runTasks([this.basicListen(allowance.intro ?? ""), this.pacedOutput(), this.watchdog()]);
      } else {
        if (this.abort.signal.aborted) return;
        if (!this.cascadeConfig) {
          const selected = await geminiKeyForCall(this.env, this.callId, adCall);
          this.s = { ...this.s, geminiKey: selected.key };
          await this.latency("gemini_connect_started", { tier: selected.tier });
          if (callContext.primary_teacher_entry && !this.portal) {
            await this.latency("school_voice_selected", { model: this.controls.model, voice: this.controls.voice, speech: "Gemini Live" });
          }
        } else await this.latency("cascade_connect_started", {
          tuning: resolveTurnTuning(this.cascadeConfig.tuning),
          interruption: this.cascadeConfig.interruption,
          endpoint_ms: this.cascadeConfig.endpointMs ?? this.controls.vad_silence_ms,
        });
        if (this.cascadeConfig) this.meter.useCascade();
        const ai = this.makeVoiceEngine(this.artifact.setup_message);
        this.ai = ai;
        const playback = !this.portal && bot.role === "teacher" && !this.offerCall ? this.pacedOutput(true) : undefined;
        void playback?.catch(() => {});
        await ai.connect();
        if (this.abort.signal.aborted) return;
        if (this.portal) this.pbx.send(JSON.stringify({ type: "ready" }));
        this.meteredAt = Date.now();
        this.lastHuman = Date.now();
        await this.latency(this.cascadeConfig ? "cascade_connected" : "gemini_connected");
        geminiConnected = !this.cascadeConfig;
        ai.startGreeting(this.controls.opening_message);
        if (allowance.mode === "free" || allowance.seconds <= 360) ai.addContext("APPLICATION NOTE: this call is limited to about " + Math.round(allowance.seconds / 60) + " minutes (" + (allowance.mode === "free" ? "free trial call" : "per-call limit of the learner's plan") + "). " + (this.controls.lesson ? "Do not announce this in the opening; answer briefly if asked." : "Mention this once, briefly and warmly in Hebrew, early in the call."));
        await this.latency("greeting_sent");
        clearTimeout(hardLimit);
        hardLimit = setTimeout(() => {
          if (this.profileId.startsWith("isaac-")) this.returnPath = this.extension(QUOTA_EXTENSION_PATH);
          this.stop("hard_time_limit");
        }, allowance.seconds * 1000);
        await this.runTasks([this.pbxToAi(), this.aiToOutput(), playback ?? this.pacedOutput(), this.watchdog()]);
      }
    } catch (error) {
      if (this.env.PBX_CASCADE_PILOT === "1" && !this.callId) await pilotLog(this.env, "pre_session_failure");
      if (error instanceof ContentSafetyError) {
        this.endForContent(error.reason);
        return;
      }
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
      if (this.finalSent && this.reason.startsWith("model:") && this.profileId.startsWith("isaac-") && !this.returnPath) this.returnPath = this.extension(QUOTA_EXTENSION_PATH);
      this.settling = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (hardLimit !== undefined) clearTimeout(hardLimit);
      clearTimeout(this.safetyTimer);
      if (this.safetyMuted && this.safety) this.verifyCriticalTurn(this.safety.finish(false));
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
            await this.latency("ai_connection_closed", { reason: this.reason || "transport_ended", ...this.disconnectDetails });
            await this.latency("audio_queue_at_end", { ...this.audioQueueDetails(), disconnected: this.disconnected, phase: "before_drain" }).catch(() => {});
            await this.drainFinalAudio();
          } finally {
            if (reserved && this.meteredAt !== null) {
              const billed = Math.max(0, ((this.failureStarted ?? Date.now()) - this.meteredAt - this.failureGapMs) / 1000);
              await this.b.settleCall(this.callId, billed);
            }
          }
          if ((reserved && releaseBudget) || (this.cascadeConfig && this.meteredAt !== null)) {
            await this.progress.saveSession({ student_id: this.customerId, call_id: this.callId, started_at: this.startedAt, learner_turns: this.meter.learnerTurns, tutor_turns: this.meter.tutorTurns, observations: this.meter.observations, transcript: this.controls.store_transcripts ? this.meter.transcript : null, summary: this.meter.summary(), usage: this.meter.usage(this.s), model: this.cascadeConfig?.model ?? this.controls.model });
            if (this.cascadeConfig) await this.latency("cascade_usage", this.meter.cascadeCosts());
            await this.latency("session_saved");
          }
        }
        await budgetRelease;
        if (claimed) await this.progress.releaseCall(this.leaseCallId, this.ownerId);
        if (this.offerCall && !this.disconnected && !this.safetyMuted) this.returnPath = this.extension(SALES_EXTENSION_PATH);
        const target = this.safetyMuted || cascadePilot ? null : this.offerCall && !this.disconnected ? this.returnPath : this.finalMessage || this.reason === "customer_busy" ? null : this.returnPath || (this.controls?.session_end_action === "return_to_menu" ? (shared ? this.extension() : this.s.returnExtension) : null);
        if (!this.disconnected) {
          this.pbx.send(this.portal ? JSON.stringify({ type: "hangup", reason: this.reason }) : target ? transferCommand(target) : JSON.stringify({ type: "hangup" }));
        }
        willCallWithSummary = !cascadePilot && this.summaryCallbackRequested && !target && ["model:task_completed", "model:caller_requested", "caller_disconnected"].includes(this.reason);
      } finally {
        await budgetRelease;
        if (claimed) await this.progress.releaseCall(this.leaseCallId, this.ownerId).catch(() => {});
        this.output = [];
        try { this.pbx.close(1000, "session ended"); } catch { /* peer already closed */ }
        await this.safetyFollowup;
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

  private muteForContent() {
    if (this.safetyMuted) return;
    this.safetyMuted = true;
    if (this.meteredAt !== null) this.failureStarted ??= Date.now();
    this.output = [];
    this.partial = new Uint8Array();
    this.carry = new Uint8Array();
    if (this.portal && !this.disconnected) {
      try { this.pbx.send(JSON.stringify({ type: "clear_audio" })); } catch { /* Peer closed. */ }
    }
  }

  private endForContent(reason: ContentDenial) {
    if (this.safetyMuted && this.safety) this.verifyCriticalTurn(this.safety.finish(false));
    this.muteForContent();
    this.finalMessage = contentDenialMessage(reason);
    this.reason = reason;
    this.stop(reason);
  }

  private async checkContentHold() {
    const denied = await new ContentSafetyStore(this.env.DB).denied(this.customerId);
    if (denied && !this.abort.signal.aborted) this.endForContent(denied);
    return denied;
  }

  private async blockForTutor(waitForAudio = false) {
    this.muteForContent();
    this.finalMessage = contentDenialMessage("content_blocked");
    this.reason = "content_blocked";
    try {
      await new ContentSafetyStore(this.env.DB).block(this.customerId);
    } catch {
      console.warn("Tutor safety block could not be saved");
      this.endForContent("content_suspended");
      return;
    }
    if (!waitForAudio) { this.endForContent("content_blocked"); return; }
    // Keep only this already-muted turn open briefly to verify the critical word against its audio.
    this.safetyTimer = setTimeout(() => this.endForContent("content_blocked"), 5000);
  }

  private verifyCriticalTurn(result: ReturnType<ContentTurn["finish"]>) {
    if (!result.critical.length) return;
    if (this.cascadeConfig) {
      this.safetyFollowup = this.progress.logDiagnostic(this.profileId, this.callId, "pilot_content_block", {
        matched_terms: result.critical.length,
      }).catch(() => console.warn("Pilot safety incident could not be saved"));
      return;
    }
    this.safetyFollowup = confirmCriticalIncident(this.env, result.audio, result.critical)
      .catch(() => console.warn("Tutor safety incident could not be saved"));
  }

  private async finishContentTurn(safety: ContentTurn, complete = true) {
    const result = safety.finish(complete);
    this.verifyCriticalTurn(result);
    if (result.tutor || this.safetyMuted) {
        if (!this.safetyMuted) await this.blockForTutor();
      if (!this.abort.signal.aborted) this.endForContent("content_blocked");
      return true;
    }
    if (result.learner) {
      try {
        if (await new ContentSafetyStore(this.env.DB).strike(this.customerId, crypto.randomUUID())) {
          this.endForContent("content_blocked");
          return true;
        }
      } catch {
        this.endForContent("content_suspended");
        return true;
      }
    }
    return false;
  }

  private enqueue(pcm8: Uint8Array) {
    const data = concat([this.partial, pcm8]);
    const whole = data.byteLength - data.byteLength % FRAME_BYTES;
    for (let i = 0; i < whole; i += FRAME_BYTES) this.output.push(data.slice(i, i + FRAME_BYTES));
    this.partial = data.slice(whole);
  }

  private audioQueueDetails() {
    const bytes = this.output.reduce((sum, frame) => sum + frame.byteLength, this.partial.byteLength);
    return { queued_audio_bytes: bytes, queued_audio_ms: bytes * FRAME_MS / FRAME_BYTES };
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
      if (!this.abort.signal.aborted && !this.reason && !this.safetyMuted) {
        try { this.ai!.sendAudio(pcm); } catch { this.ai?.close(); }
      }
    }
  }

  private async aiToOutput() {
    while (!this.abort.signal.aborted) {
      const event = await this.ai!.next();
      if (this.abort.signal.aborted) return;
      if (event.type === "closed") {
        if (this.cascadeConfig && event.reason) await this.latency("cascade_provider_closed", { reason: event.reason }).catch(() => {});
        if (this.safetyMuted) { this.endForContent("content_blocked"); return; }
        this.safety?.interrupt();
        this.reconnecting = this.reconnectGemini();
        await this.reconnecting;
        this.reconnecting = null;
        if (this.reason || this.abort.signal.aborted) return;
        continue;
      }
      if (event.type === "lesson_coach") {
        await this.latency("lesson_coach_turn", event.details).catch(() => {});
      } else if (event.type === "lesson_coach_semantic") {
        await this.latency("lesson_coach_semantic", event.details).catch(() => {});
      } else if (event.type === "pilot_interruption") {
        await this.latency("pilot_interruption_" + event.phase, { elapsed_ms: event.elapsed_ms }).catch(() => {});
      } else if (event.type === "voice_activity" && this.cascadeConfig && event.activity === "end") {
        this.pilotTurnEndedAt = Date.now();
      } else if (event.type === "audio") {
        this.safety?.tutorAudio(event.pcm24k);
        if (this.safetyMuted) continue;
        if (event.pcm24k.byteLength) this.tutorAudioReceived = true;
        if (this.pendingEmail?.phase === "readback") this.pendingEmail.audio ||= event.pcm24k.byteLength > 0;
        if (!this.firstAudio) { this.firstAudio = true; await this.latency("first_gemini_audio", { tutor_turn: this.meter.tutorTurns + 1 }); }
        this.meter.outputAudioBytes += event.pcm24k.byteLength;
        const [pcm, carry] = downsample24kTo8k(event.pcm24k, this.carry);
        this.carry = carry;
        this.enqueue(pcm);
      } else if (event.type === "interrupted") {
        if (this.safetyMuted) { this.endForContent("content_blocked"); return; }
        this.safety?.interrupt();
        const queued = this.audioQueueDetails();
        this.pendingEmail = null;
        this.summaryCallbackSpeech = "";
        this.reminderSpeech = "";
        this.output = [];
        this.partial = new Uint8Array();
        this.carry = new Uint8Array();
        let clearSent = false;
        if (this.cascadeConfig?.interruption === "adaptive_clear" && !this.disconnected) {
          try {
            this.pbx.send(JSON.stringify({ type: "clear_audio" }));
            clearSent = true;
          } catch { /* Peer disconnected. */ }
        }
        if (this.ai instanceof CascadeLive) this.ai.acknowledgeInterrupt();
        await this.latency("tutor_interrupted", this.cascadeConfig ? { ...queued, clear_sent: clearSent, candidate_ms: event.pause_ms ?? null } : queued);
      } else if (event.type === "transcript") {
        if (this.safety?.transcript(event.role, event.rawText ?? event.text, event.finished) && !this.safetyMuted) {
          await this.blockForTutor(this.safety.criticalCandidate(event.finished));
        }
        if (this.cascadeConfig && this.env.PBX_PILOT_CAPTURE === "1" && event.role === "tutor") {
          if (!this.safetyMuted) {
            this.pilotTranscriptChunk += event.text;
            if (event.finished || /[.!?…]\s*$/.test(this.pilotTranscriptChunk) || this.pilotTranscriptChunk.length >= 120) {
              const chunk = this.pilotTranscriptChunk;
              this.pilotTranscriptChunk = "";
              await this.progress.logTurn(this.profileId, this.callId, "output", chunk, {}, true).catch(() => {});
            }
          } else this.pilotTranscriptChunk = "";
        }
        if (this.safetyMuted || !event.text) continue;
        const pending = this.pendingEmail;
        if (pending) {
          const expected = pending.phase === "readback" ? "tutor" : "learner";
          const text = event.rawText ?? event.text;
          if (event.role === expected && pending.text.length + text.length <= 1024) pending.text += text;
          else this.pendingEmail = null;
        }
        this.meter.transcript.push({ role: event.role, text: event.text });
        if (this.cascadeConfig && this.env.PBX_PILOT_CAPTURE === "1") {
          if (event.role === "learner") await this.progress.logTurn(this.profileId, this.callId, "input", event.text).catch(() => {});
        } else if (this.controls?.store_transcripts) {
          await this.progress.logTurn(this.profileId, this.callId, event.role === "learner" ? "input" : "output", event.text);
        }
        if (event.role === "learner") {
          if (this.practiceReminders) this.reminderSpeech = (this.reminderSpeech + " " + (event.rawText ?? event.text)).trim().slice(-512);
          if (this.controls?.summary_callback) {
            this.summaryCallbackSpeech = (this.summaryCallbackSpeech + (event.rawText ?? event.text)).slice(0, 512);
            if (revokesSummaryCall(this.summaryCallbackSpeech)) this.summaryCallbackRequested = false;
          }
          this.lastHuman = Date.now();
          if (!this.learnerSeen) this.meter.learnerTurns++;
          this.learnerSeen = true;
        }
      } else if (event.type === "turn_complete") {
        if (this.safety && await this.finishContentTurn(this.safety)) return;
        // Cascade speech often ends with a sub-frame tail. Pad it now, otherwise
        // it stays in partial forever and the next genuinely heard answer is
        // incorrectly rejected by the lesson observer's playback gate.
        if (this.cascadeConfig && this.partial.length) this.enqueue(new Uint8Array(FRAME_BYTES - this.partial.length));
        this.summaryCallbackSpeech = "";
        this.reminderSpeech = "";
        const pending = this.pendingEmail;
        // Gemini can finish a tool-only turn before speaking the read-back.
        if (pending?.phase !== "readback" || pending.audio || pending.text) {
          this.pendingEmail = pending?.phase === "readback" && pending.audio && matchesEmailReadBack(pending.text, pending.email)
            ? { ...pending, phase: "answer", text: "" } : null;
        }
        this.meter.tutorTurns++;
        this.learnerSeen = false;
        this.firstAudio = false;
        await this.latency("tutor_turn_complete", { tutor_turn: this.meter.tutorTurns, ...this.audioQueueDetails() });
        if (this.controls?.lesson) {
          await new LearningStore(this.env.DB).exposures(this.customerId, this.callId, this.controls.lesson.vocabulary, this.meter.transcript.filter(t => t.role === "tutor").map(t => t.text).join(" "));
        }
      } else if (event.type === "usage") {
        this.meter.recordUsage(event.usage);
        if (this.cascadeConfig && typeof event.usage.cascade_input_tokens === "number") {
          const totals = this.meter.usage(this.s);
          await this.latency("pilot_usage", {
            ...this.meter.cascadeCosts(), input: totals.input_text_tokens, output: totals.output_text_tokens,
          }).catch(() => {});
        } else if (!this.cascadeConfig && this.controls?.store_transcripts && Date.now() - this.crmUsageLoggedAt >= 3000) {
          this.crmUsageLoggedAt = Date.now();
          const totals = this.meter.usage(this.s);
          await this.latency("crm_usage", { input: totals.input_text_tokens + totals.input_audio_tokens,
            output: totals.output_text_tokens + totals.output_audio_tokens, total: totals.estimated_cost_usd }).catch(() => {});
        }
      } else if (event.type === "tool_call") {
        if (this.safetyMuted) continue;
        for (const call of event.calls) {
          const result = await this.recordTool(call);
          const saved = typeof result === "boolean" ? result : result.saved;
          if (this.cascadeConfig) await this.latency("pilot_tool", { name: call.name, saved }).catch(() => {});
          if (call.name === "end_session" && saved && this.safety && await this.finishContentTurn(this.safety, false)) return;
          this.ai!.submitToolResult(call, saved, call.name === "prepare_email" ? {
            prepared: saved,
            next_step: saved ? "Read back the email and wait. After the caller confirms, call save_email." : "Ask the caller to clarify the address.",
          } : typeof result === "boolean" ? undefined : result);
          if (call.name === "end_session" && saved) return;
        }
      } else if (event.type === "go_away") {
        if (this.safetyMuted) { this.endForContent("content_blocked"); return; }
        this.safety?.interrupt();
        this.reconnecting = this.reconnectGemini(true);
        await this.reconnecting;
        this.reconnecting = null;
        if (this.reason || this.abort.signal.aborted) return;
      }
    }
  }

  private makeVoiceEngine(setup: Record<string, unknown>) {
    if (!this.cascadeConfig) return new GeminiLive(this.s.geminiLiveUrl, this.s.geminiKey, setup);
    const mode = coachMode(this.env.LESSON_COACH_MODE);
    const plan = this.controls?.lesson;
    // Only school lessons on the cascade; no translation, sales or payment flow changes.
    const coach = mode && plan && !this.controls?.sales && !this.offerCall ? new TranscriptCoach(plan, mode) : undefined;
    // Sending another transcript excerpt to a separate assessor is explicitly opt-in,
    // and never done when the learner has disabled transcript storage.
    const semanticMode = coachMode(this.env.LESSON_COACH_SEMANTIC_MODE);
    const model = this.env.LESSON_COACH_SEMANTIC_MODEL?.trim();
    const semantic = coach && this.controls?.store_transcripts && semanticMode && model
      ? { model, mode: mode === "active" ? semanticMode : "shadow" as const } : undefined;
    return new CascadeLive(this.cascadeConfig, setup, undefined, coach, () => !this.safetyMuted && this.output.length === 0 && this.partial.byteLength === 0, semantic);
  }

  private async reconnectGemini(preservePlayback = false) {
    this.pendingEmail = null;
    this.summaryCallbackSpeech = "";
    this.reminderSpeech = "";
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
      const replacement = this.makeVoiceEngine(setup);
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
      let pcm: Uint8Array;
      if (this.cascadeConfig) {
        try {
          const notice = await synthesizeCascadeNotice(this.cascadeConfig, text);
          [pcm] = downsample24kTo8k(notice.pcm24k);
          this.meter.recordUsage({ cascade_tts_usd: notice.cost });
        } catch {
          // The conversation TTS might be the failing provider; try independent Cloud TTS.
          pcm = await new BasicTranslator(this.env, this.s).speak(text, "he-IL");
        }
      } else pcm = await new BasicTranslator(this.env, this.s).speak(text, "he-IL");
      if (!pcm.length) throw new Error("empty_final_notice");
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

  private async recordTool(call: ToolCall): Promise<SalesToolResult | { saved: false; reason: "confirmation_required"; next_step: string }> {
    const args = call.args ?? {};
    if (call.name === "save_mastery_domain") {
      if (!this.masteryDomain || !this.controls?.lesson) return false;
      const saved = await saveMasteryDomain(this.env.DB, this.customerId, args.domain).catch(() => false);
      if (saved) {
        this.masteryDomain = false;
        this.ai?.addContext("APPLICATION NOTE: the chosen Master vocabulary domain is saved. Continue the lesson; do not ask again.");
      }
      return saved;
    }
    if (call.name === "save_practice_reminder") {
      if (!this.practiceReminders || !this.controls?.lesson) return false;
      const saved = await savePracticeReminder(this.env.DB, this.customerId, this.reminderSpeech).catch(() => false);
      if (saved) {
        this.reminderSpeech = "";
        this.ai?.addContext("APPLICATION NOTE: reminder preference saved from the learner's answer. Do not ask about reminders again in this call unless the learner requests a change.");
      }
      return saved;
    }
    if (call.name === "request_summary_callback") {
      if (!this.controls?.summary_callback || !hasEligibleSummaryCallResponse(this.summaryCallbackSpeech) ||
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
        // Compare the teacher's claims to independent local evidence, but never overwrite
        // legitimate semantic assessments solely because the conservative observer abstained.
        if (saved && this.ai instanceof CascadeLive && coachMode(this.env.LESSON_COACH_MODE)) {
          const repeated = new Set(this.ai.repetitionOnlyTargets());
          const suspect = Array.isArray(args.vocabulary) ? args.vocabulary.filter(v => v?.score === 100 && repeated.has(v?.word_id)).length : 0;
          if (suspect) await this.latency("lesson_coach_score_check", { repetition_only_100: suspect }).catch(() => {});
        }
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
      let result: SalesToolResult = false;
      if (call.name === "prepare_email") {
        const email = normalizeSalesEmail(args.email);
        this.pendingEmail = email ? { email, phase: "readback", text: "", audio: false } : null;
        result = !!email;
      } else {
        if (call.name === "save_email") {
          const pending = this.pendingEmail;
          this.pendingEmail = null;
          allowed = pending?.phase === "answer" && normalizeSalesEmail(args.email) === pending.email && isEmailConfirmation(pending.text);
        }
        if (call.name === "schedule_next_lesson" && !this.salesWindowOpen) allowed = false;
        if (allowed) result = await recordSalesTool(this.b, this.customerId, this.callId, call.name, args, this.env.PORTAL_EMAIL, this.callerPhone,
          { name: this.controls.teacher_name, female: this.controls.teacher_female }).catch(() => false);
      }
      await this.progress.logDiagnostic(this.profileId, this.callId, "sales_tool", { tool: call.name, ...(typeof result === "boolean" ? { saved: result } : result) }).catch(() => {});
      return result;
    }
    if (call.name === "save_intake") {
      const heard = this.meter.transcript.filter(t => t.role === "learner").map(t => t.text).join(" ");
      const goal = typeof args.goal === "string" && this.controls?.intake_pending ? goalFromLearnerSpeech(args.goal, heard) : args.goal;
      const previewTeacher = this.portal?.teacherId;
      const saved = await saveIntake(this.b, this.customerId, await phoneTeacherFor(this.progress, this.profileId), { ...args, goal }, { lessonBotId: this.profileId, previewTeacher, allowLower: this.controls?.phone_lesson });
      await this.progress.logDiagnostic(this.profileId, this.callId, "intake_saved", { saved, goal, model_goal: args.goal, level: args.level, topic: args.topic ?? null }).catch(() => {});
      if (saved && this.controls) {
        const controls = this.controls = { ...this.controls, intake_pending: false };
        const bot = { id: this.profileId, role: "teacher" } as const;
        const refresh = (teacher?: string) => applyLearnerControls(this.b, this.customerId, bot, controls, teacher, this.portal ? "web" : "phone", false, this.cascadeConfig?.voice);
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
        const access = this.portal ? "These override the requested direction when access is limited." : "Apply the level to conversational difficulty immediately; it does not change the language you speak. Access limits apply to curriculum, not to conversational difficulty. Continue assessing only the original targets until the next call.";
        if (lesson && this.ai instanceof CascadeLive) this.ai.updateCoachDelivery(lesson);
        this.ai?.addContext(`APPLICATION NOTE: lesson direction saved (the same settings the website shows). For the rest of this call use the effective topic=${JSON.stringify(lesson?.topic)}, level=${JSON.stringify(lesson?.level)}, conversation_mode=${JSON.stringify(lesson?.conversation_mode)}, correction_policy=${JSON.stringify(lesson?.correction_policy)}. ${access} The full saved plan applies from the next call. Start or continue the lesson now.`);
      }
      return saved;
    }
    if (call.name === "end_session") {
      const reason = ["caller_requested", "task_completed", "no_response"].includes(String(args.reason)) ? String(args.reason) : "task_completed";
      if (this.controls?.intake_pending && !this.finalSent && !this.intakeReminded && args.reason !== "caller_requested" && args.reason !== "no_response" && !args.destination) {
        this.intakeReminded = true;
        if (reason === "task_completed") await this.logCompletionDecision(false, "intake_pending");
        await this.progress.logDiagnostic(this.profileId, this.callId, "intake_missing_at_end").catch(() => {});
        this.ai?.addContext("APPLICATION NOTE: the first-call intake was not saved. Do not hang up yet: call save_intake now with the goal and level the learner gave (omit unknown answers), then say goodbye and call end_session again.");
        return false;
      }
      if (reason === "task_completed") {
        const condition = this.completionCondition();
        const maySuggest = this.controls?.ending_policy === "model_discretion" || (this.controls?.ending_policy === "after_target_with_permission" && this.meteredAt !== null && Date.now() - this.meteredAt >= this.controls.target_lesson_minutes * 60000);
        if (!condition && maySuggest) this.endConfirmationAt ??= this.meter.transcript.length;
        await this.logCompletionDecision(!!condition, condition ?? "confirmation_required");
        if (!condition) return { saved: false, reason: "confirmation_required", next_step: maySuggest
          ? 'Ask the learner "רוצה לסיים?" and wait for their answer. Only after they agree, say the full goodbye and call end_session again. If they decline, continue the lesson.'
          : "Continue the lesson with another useful exercise. Do not suggest ending or ask for permission to end. End only if the learner explicitly asks to stop or the application signals the allowance is ending." };
      }
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

  private async logCompletionDecision(allowed: boolean, condition: string) {
    await this.progress.logDiagnostic(this.profileId, this.callId, "task_completed_guard", {
      allowed, condition,
      confirmation_requested_at_turn: this.endConfirmationAt,
      transcript_turns: this.meter.transcript.length,
      ending_policy: this.controls?.ending_policy ?? null,
      has_lesson: !!this.controls?.lesson,
      has_lesson_summary: this.meter.lessonSummary !== null,
      learner_turns: this.meter.learnerTurns,
      tutor_turns: this.meter.tutorTurns,
      metered_at: this.meteredAt,
      elapsed_ms: this.meteredAt === null ? null : Date.now() - this.meteredAt,
      allowance_ms: this.allowanceMs,
      target_lesson_minutes: this.controls?.target_lesson_minutes ?? null,
      final_sent: this.finalSent,
    }).catch(() => {});
  }

  private completionCondition() {
    if (this.finalSent) return "quota_closing";
    if (this.meteredAt !== null && this.allowanceMs > 0 && Date.now() - this.meteredAt >= this.allowanceMs) return "quota_exhausted";
    const learner = this.meter.transcript.filter(t => t.role === "learner").at(-1)?.text.trim() ?? "";
    if (/^(?:תפסיק|תפסיקי|די|רוצה לסיים|אני רוצה לסיים|בוא נסיים|להתראות|stop|stop please|please stop|goodbye|bye|I want to stop|let's stop)[.!?\s]*$/i.test(learner)) return "explicit_stop";
    if (this.endConfirmationAt !== null) {
      const turns = this.meter.transcript.slice(this.endConfirmationAt);
      let answer = turns.length - 1;
      while (answer >= 0 && turns[answer].role !== "learner") answer--;
      let previous = answer - 1;
      while (previous >= 0 && turns[previous].role !== "learner") previous--;
      const question = turns.slice(previous + 1, answer).filter(t => t.role === "tutor").map(t => t.text).join(" ");
      if (answer >= 0 && /רוצה לסיים|want to (?:end|stop|finish)/i.test(question) && isEmailConfirmation(turns[answer].text)) return "learner_confirmation";
    }
    if (!this.controls?.lesson) return this.controls && this.meter.learnerTurns > 0 && this.meter.tutorTurns > 0 ? "non_lesson_turns" : null;
    return this.controls.ending_policy === "model_discretion" && this.meter.learnerTurns > 0 && this.meter.lessonSummary !== null ? "lesson_summary_under_policy" : null;
  }

  private async pacedOutput(withConnectingGreeting = false) {
    let greeting: Uint8Array | undefined;
    let offset = 0;
    if (withConnectingGreeting) {
      void this.loadConnectingGreeting().then(pcm => { greeting = pcm; }).catch(() => {});
    }
    while (!this.abort.signal.aborted) {
      await sleep(FRAME_MS, this.abort.signal);
      if (this.abort.signal.aborted) return;
      if (this.safetyMuted) continue;
      if (this.ai instanceof CascadeLive && this.ai.playbackPaused()) {
        this.sendAudio(SILENCE_FRAME);
        continue;
      }
      const audio = this.output.shift();
      if (!audio && !this.tutorAudioReceived && greeting && offset < greeting.length) {
        const frame = new Uint8Array(FRAME_BYTES);
        frame.set(greeting.subarray(offset, offset + FRAME_BYTES));
        offset += FRAME_BYTES;
        this.sendAudio(frame);
        continue;
      }
      if (!audio && withConnectingGreeting && this.meteredAt === null) continue;
      this.sendAudio(audio ?? SILENCE_FRAME);
      if (audio) {
        this.lastTutorAudio = Date.now();
        if (this.pilotTurnEndedAt !== null) {
          const elapsedMs = this.lastTutorAudio - this.pilotTurnEndedAt;
          this.pilotTurnEndedAt = null;
          void this.latency("pilot_turn_to_audio", { elapsed_ms: elapsedMs }).catch(() => {});
        }
      }
      if (audio && !this.firstSent) {
        this.firstSent = true;
        await markQuickIntro(this.b, this.callId, this.customerId);
        await this.latency("first_audio_sent_to_phone", { tutor_turn: 1, queue_frames: this.output.length });
      }
    }
  }

  private async loadConnectingGreeting() {
    const response = await this.env.ASSETS.fetch(new Request("https://assets.invalid/tutor-connecting.wav"));
    if (response.ok) return wavToPcm(new Uint8Array(await response.arrayBuffer()));
  }

  private async watchdog() {
    while (!this.abort.signal.aborted) {
      if (this.safetyMuted) { await sleep(100, this.abort.signal); continue; }
      if (Date.now() - this.lastInput >= 15000) { this.stop("pbx_input_timeout"); return; }
      if (!this.finalSent && !this.reconnecting && Date.now() - this.lastHuman >= this.controls!.idle_timeout_seconds * 1000) { this.stop("idle_timeout"); return; }
      this.maybeOpenSalesWindow(Date.now());
      this.maybeNudgeSilence(Date.now());
      if (this.lessonDurationMs && this.meteredAt !== null && !this.closingSent && !this.finalSent && !this.reconnecting && !this.output.length) {
        const target = this.lessonDurationMs;
        if (Date.now() - this.meteredAt >= target - Math.min(60000, target / 4)) {
          this.ai?.addContext("APPLICATION CLOCK: closing stage reached. At the next natural pause, begin the configured closing " + (this.controls?.lesson?.closing_activity ?? "short recap") + ", then save the results and the lesson summary (record_lesson_summary) before saying goodbye. Report only observed results from this connection. If no actual practice happened, do not give a practice recap or claim practice happened; offer one simple practice question instead. Never invent a recap. This is not permission to hang up; respect the ending policy and explicit requests to stop.");
          this.closingSent = true;
        }
      }
      if (this.ai && this.allowanceMs && this.meteredAt !== null && !this.finalSent && !this.reconnecting && Date.now() - this.meteredAt >= this.allowanceMs - 25000) {
        this.finalSent = true;
        this.ai.prompt("APPLICATION CLOCK: the hard call allowance is ending in at most 25 seconds. This overrides the normal ending policy and unfinished intake. Stop asking questions and speak now in one or two short Hebrew sentences: " + (this.freeTrial ? this.freeFollowup ? '"זמן השיחה הזו הסתיים. אפשר להתקשר שוב ולהמשיך את ההתנסות החינמית."' : '"זמן ההתנסות החינמית הסתיים."' : '"זמן השיחה הסתיים."') + (!this.portal && this.profileId.startsWith("isaac-") && (!this.returnPath || this.returnPath === this.extension(QUOTA_EXTENSION_PATH)) ? ' Then say "מיד נעבור לתפריט, שם אפשר לבחור חבילה להמשך הלימוד."' : "") + " Do not give a practice recap or claim any practice happened. If the lesson summary is not saved yet, call record_lesson_summary silently with only observed results. Finish speaking within the remaining time, then call end_session with reason task_completed. Do not wait for another answer.");
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
    this.ai.prompt(this.controls.phone_lesson ? PHONE_SILENCE_NUDGE_NOTE : SILENCE_NUDGE_NOTE);
    void this.progress.logDiagnostic(this.profileId, this.callId, "silence_nudge", { nudge: this.silenceNudges }).catch(() => {});
  }

  private maybeOpenSalesWindow(now: number) {
    if (this.practiceStarted && !this.salesWindowOpen && !this.finalSent && !this.reconnecting && !this.output.length &&
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
    const deadline = this.meteredAt !== null && this.allowanceMs ? this.meteredAt + this.allowanceMs : Infinity;
    if (this.partial.length) {
      const padded = new Uint8Array(FRAME_BYTES);
      padded.set(this.partial);
      this.output.push(padded);
      this.partial = new Uint8Array();
    }
    for (const frame of this.output.splice(0)) {
      if (this.disconnected || Date.now() + FRAME_MS > deadline) return;
      this.sendAudio(frame);
      await sleep(FRAME_MS);
    }
    for (let i = 0; i < 10 && !this.disconnected; i++) {
      if (Date.now() + FRAME_MS > deadline) return;
      this.sendAudio(SILENCE_FRAME);
      await sleep(FRAME_MS);
    }
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
        if (this.safety) {
          this.safety.transcript("learner", result.heard);
          this.safety.transcript("tutor", result.text);
          if (await this.finishContentTurn(this.safety)) return;
        }
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
