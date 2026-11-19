import { z } from "zod";
import { applyLearnerControls, phoneTeacherFor, saveIntake } from "./learner";
import { downsample24kTo8k, b64encode, concat, wav } from "./audio";
import { BusinessStore } from "./business";
import { adultControls, controlsFromSettings, type TutorControls, VOICE_OPTIONS } from "./controls";
import { type Env, type Settings, HttpError, bearer, randomHex, sha256Hex } from "./env";
import { GeminiLive } from "./gemini";
import { acquireGeminiBudget, GeminiBudgetError } from "./gemini-budget";
import { SessionMeter } from "./meter";
import { runtimeContext } from "./pbx";
import { ProgressStore } from "./progress";
import { compilePrompt } from "./prompt";
import { LearningStore } from "./learning";

interface LiveResult { audio: Uint8Array; text: string; meter: SessionMeter; elapsedSeconds: number }
interface LiveOptions {
  storeTranscript?: boolean;
  beforeConnect?: () => Promise<void>;
  learning?: (args: unknown) => Promise<boolean>;
  intake?: (args: unknown) => Promise<boolean>;
}

async function runLive(env: Env, s: Settings, progress: ProgressStore, profileId: string, callId: string, setup: unknown, opening: string, maxSeconds: number, timeoutMs: number, { storeTranscript = true, beforeConnect, learning, intake }: LiveOptions = {}): Promise<LiveResult> {
  const meter = new SessionMeter();
  const parts: Uint8Array[] = [];
  const output: string[] = [];
  const t0 = Date.now();
  let size = 0;
  let startedAt: number | null = null;
  let elapsedSeconds = 0;
  const ai = new GeminiLive(s.geminiLiveUrl, s.geminiKey, setup);
  let budgetError: GeminiBudgetError | undefined;
  const release = await acquireGeminiBudget(env, () => meter.usage(s).estimated_cost_usd, reason => {
    budgetError = new GeminiBudgetError(reason);
    ai.close();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    await ai.connect();
    startedAt = Date.now();
    await progress.logLatency(profileId, callId, "gemini_connected", Date.now() - t0, 0);
    ai.startGreeting(opening);
    for (;;) {
      const event = await ai.next();
      if (budgetError) throw budgetError;
      if (event.type === "audio") {
        if (size + event.pcm24k.byteLength > 24000 * 2 * maxSeconds) break;
        if (!size) await progress.logLatency(profileId, callId, "first_gemini_audio", Date.now() - t0, 0);
        parts.push(event.pcm24k);
        size += event.pcm24k.byteLength;
        meter.outputAudioBytes += event.pcm24k.byteLength;
      } else if (event.type === "transcript" && event.role === "tutor") {
        output.push(event.text);
        if (storeTranscript) await progress.logTurn(profileId, callId, "output", event.text);
      } else if (event.type === "usage") meter.recordUsage(event.usage);
      else if (event.type === "tool_call") {
        let end = false;
        for (const call of event.calls) {
          end ||= call.name === "end_session";
          const saved = call.name === "save_intake" ? await intake?.(call.args ?? {}) ?? false
            : call.name === "report_learning_batch" ? await learning?.(call.args ?? {}) ?? false
            : call.name === "record_learning_observation" && learning ? false : end || meter.recordLearning(call.name ?? "", call.args ?? {});
          ai.submitToolResult(call, saved);
        }
        if (end) break;
      } else if (event.type === "turn_complete") { meter.tutorTurns = 1; break; }
      else if (event.type === "closed" || event.type === "go_away") break;
    }
  };
  try {
    if (beforeConnect) await beforeConnect();
    if (budgetError) throw budgetError;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); });
    await Promise.race([work(), deadline]);
    if (budgetError) throw budgetError;
  } catch (error) {
    throw budgetError ?? error;
  } finally {
    clearTimeout(timer);
    if (startedAt !== null) elapsedSeconds = (Date.now() - startedAt) / 1000;
    ai.close();
    await release();
  }
  return { audio: concat(parts), text: output.join(" "), meter, elapsedSeconds };
}

function defaults(s: Settings, id: string): TutorControls {
  return id === s.adultStudentId ? adultControls(s.storeTranscripts) : controlsFromSettings(s.storeTranscripts);
}

const TextTurnSchema = z.object({ text: z.string().min(1).max(4000) });

export async function webTurn(request: Request, env: Env, s: Settings, botId: string): Promise<Response> {
  const b = new BusinessStore(env.DB);
  const progress = new ProgressStore(env.DB);
  const customerId = await b.portalCustomer(bearer(request.headers.get("Authorization")) ?? "");
  if (!customerId) throw new HttpError(401, "קישור הכניסה אינו תקין או שפג תוקפו");
  const bot = await progress.getBot(botId);
  if (!bot || !bot.enabled || !bot.web_enabled || !["teacher", "translator"].includes(bot.role)) throw new HttpError(404, "Bot not found");
  let raw: unknown;
  try { raw = await request.json(); } catch { throw new HttpError(422, "Invalid JSON"); }
  const parsed = TextTurnSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "נתונים לא תקינים");
  const text = parsed.data.text;
  const controls = await applyLearnerControls(b, customerId, bot, await progress.loadControls(botId, defaults(s, botId)));
  const callId = "web-" + randomHex(12);
  const allowance = await b.reserveCall(customerId, botId, callId, 120, "text");
  if (allowance.mode === "busy") throw new HttpError(409, "כבר יש לך שיחה פעילה. כדי להתחיל חדשה, יש לסיים את השיחה הקיימת.");
  if (!allowance.seconds) throw new HttpError(402, "אין יתרת שימוש זמינה. פנה לשירות לרכישת חבילה");
  let startedAt: Date | null = null;
  let result: LiveResult | null = null;
  let limited = false;
  try {
    await b.registerWebCall(callId, customerId, botId);
    const learning = new LearningStore(env.DB);
    if (controls.lesson) await learning.begin(customerId, callId, controls.lesson);
    let history = (await progress.lessonContext(customerId)) + (await b.lessonContext(customerId, botId));
    await b.saveContext(callId, await b.loadContext("preferences:" + customerId));
    history += "\n" + (await runtimeContext(b, callId));
    const artifact = await compilePrompt({ ...controls, opening_message: text }, history, botId, s);
    startedAt = new Date();
    if (controls.store_transcripts) {
      await progress.savePromptSnapshot(botId, callId, artifact);
      await progress.logTurn(botId, callId, "input", text);
    }
    await progress.logLatency(botId, callId, "session_started", 0, 0, { channel: "web" });
    result = await runLive(env, s, progress, botId, callId, artifact.setup_message, text, allowance.seconds, (Math.min(120, allowance.seconds) + 15) * 1000, {
      storeTranscript: controls.store_transcripts,
      learning: controls.lesson ? args => learning.record(customerId, callId, args) : undefined,
      intake: async args => saveIntake(b, customerId, await phoneTeacherFor(progress, botId), args, { lessonBotId: botId }),
    });
    if (controls.lesson) await learning.exposures(customerId, callId, controls.lesson.vocabulary, result.text);
  } catch (error) {
    if (error instanceof GeminiBudgetError) { limited = true; throw error; }
    if (!startedAt) throw error;
    await progress.logDiagnostic(botId, callId, "web_turn_failed", { error_type: error instanceof Error ? error.name : "Error", message: (error instanceof Error ? error.message : "").split(s.geminiKey).join("[redacted]").slice(0, 250) });
    throw new HttpError(502, "המורה לא הצליח להשיב כרגע. נסה שוב");
  } finally {
    await b.settleCall(callId, result?.elapsedSeconds ?? 0);
    if (startedAt && !limited) {
      const meter = result?.meter ?? new SessionMeter();
      meter.learnerTurns = 1;
      await progress.saveSession({
        student_id: customerId, call_id: callId, started_at: startedAt, learner_turns: 1, tutor_turns: meter.tutorTurns,
        observations: meter.observations, transcript: controls.store_transcripts ? [{ role: "learner", text }, { role: "tutor", text: result?.text ?? "" }] : null,
        summary: meter.summary(), usage: meter.usage(s), model: controls.model,
      });
    }
  }
  return Response.json({ call_id: callId, text: result.text, audio_wav_base64: b64encode(wav(result.audio, 24000)) });
}

const ANNOUNCER = "You are a professional voice announcer. Read the supplied text exactly, without additions, introductions, comments, or changing any wording. Use the language of the supplied text. Do not call tools.";

export async function renderVoicePreview(request: Request, env: Env, s: Settings, customerId: string): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = z.object({ voice: z.enum(VOICE_OPTIONS) }).safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "הקול הזה לא זמין.");
  const b = new BusinessStore(env.DB);
  const cacheId = "portal-voice-preview:" + parsed.data.voice + ":v1";
  const cached = await b.getAudio(cacheId);
  if (cached) return Response.json({ audio_wav_base64: b64encode(cached.wav) });
  const progress = new ProgressStore(env.DB);
  const text = "Hi! Good to meet you. Let's take it one sentence at a time.";
  const controls = { ...controlsFromSettings(false), base_prompt: ANNOUNCER, opening_message: text, voice: parsed.data.voice, language_code: "en-US" };
  const artifact = await compilePrompt(controls, "", s.studentId, s);
  try {
    const result = await runLive(env, s, progress, s.studentId, "preview-" + randomHex(12), artifact.setup_message, text, 15, 30000, {
      storeTranscript: false,
      beforeConnect: async () => {
        if (!await b.consumeMonthlyQuota("portal-voice-preview", 30) || !await b.consumeMonthlyQuota("portal-voice-preview:" + customerId, 3)) throw new HttpError(429, "מכסת דגימות הקול לחודש הזה נוצלה. אפשר לנסות את המורה בשיחה.");
      },
    });
    if (!result.audio.length) throw new Error("No audio");
    const file = wav(result.audio, 24000);
    await b.saveAudio(cacheId, await sha256Hex(text), file);
    return Response.json({ audio_wav_base64: b64encode(file) });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "הדוגמה לא נטענה. אפשר לנסות שוב, או פשוט להתחיל שיחה.");
  }
}

export async function renderNarration(env: Env, s: Settings, narrationId: string): Promise<Response> {
  const b = new BusinessStore(env.DB);
  const progress = new ProgressStore(env.DB);
  const record = await b.record("narrations", narrationId);
  if (!record) throw new HttpError(404, "Narration not found");
  const profileId = record.bot_id || s.studentId;
  const base = await progress.loadControls(profileId, controlsFromSettings(s.storeTranscripts));
  const controls = { ...base, base_prompt: ANNOUNCER, opening_message: record.text, language_code: record.language, learning_goal: "", custom_instructions: "" };
  const artifact = await compilePrompt(controls, "", profileId, s);
  const callId = "narration-" + randomHex(12);
  await progress.savePromptSnapshot(profileId, callId, artifact);
  let result: LiveResult;
  try {
    result = await runLive(env, s, progress, profileId, callId, artifact.setup_message, record.text, 120, 120_000);
    if (!result.audio.byteLength) throw new Error("No audio received");
  } catch (error) {
    if (error instanceof GeminiBudgetError) throw error;
    await progress.logDiagnostic(profileId, callId, "narration_failed", { error_type: error instanceof Error ? error.name : "Error", message: (error instanceof Error ? error.message : "").split(s.geminiKey).join("[redacted]").slice(0, 250) });
    throw new HttpError(502, "לא ניתן לייצר קריינות כרגע; בדוק את לוג הבוט");
  }
  const [pcm8] = downsample24kTo8k(result.audio);
  const file = wav(pcm8, 8000);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(record.text))), (x) => x.toString(16).padStart(2, "0")).join("");
  await b.saveAudio(narrationId, hash, file);
  const duration = result.audio.byteLength / 48000;
  await progress.saveSession({
    student_id: "system:narration", call_id: callId, started_at: new Date(), learner_turns: 1, tutor_turns: 1, observations: [],
    transcript: [{ role: "tutor", text: result.text }], summary: { summary_he: "ייצור קריינות", success_he: "", next_step_he: "", points: 0 },
    usage: { input_text_tokens: 0, input_audio_tokens: 0, output_text_tokens: 0, output_audio_tokens: 0, thoughts_tokens: 0, estimated_cost_usd: duration / 60 * s.pricing.outputAudioMinute, cost_basis: "narration_duration_estimate" },
    model: controls.model,
  });
  await progress.logDiagnostic(profileId, callId, "narration_generated", { duration_seconds: duration });
  return new Response(file, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
}
