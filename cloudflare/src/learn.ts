import { z } from "zod";
import { downsample24kTo8k, b64encode, concat, wav } from "./audio";
import { BusinessStore } from "./business";
import { adultControls, controlsFromSettings, type TutorControls } from "./controls";
import { type Env, type Settings, HttpError, bearer, randomHex } from "./env";
import { GeminiLive } from "./gemini";
import { SessionMeter } from "./meter";
import { runtimeContext } from "./pbx";
import { ProgressStore } from "./progress";
import { compilePrompt } from "./prompt";

interface LiveResult { audio: Uint8Array; text: string; meter: SessionMeter; startedAt: number | null }

async function runLive(s: Settings, progress: ProgressStore, profileId: string, callId: string, setup: unknown, opening: string, maxSeconds: number, timeoutMs: number): Promise<LiveResult> {
  const meter = new SessionMeter();
  const parts: Uint8Array[] = [];
  const output: string[] = [];
  const t0 = Date.now();
  let size = 0;
  let startedAt: number | null = null;
  const ai = new GeminiLive(s.geminiLiveUrl, s.geminiKey, setup);
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs));
  const work = (async () => {
    await ai.connect();
    startedAt = Date.now();
    await progress.logLatency(profileId, callId, "gemini_connected", Date.now() - t0, 0);
    ai.startGreeting(opening);
    for (;;) {
      const event = await ai.next();
      if (event.type === "audio") {
        if (size + event.pcm24k.byteLength > 24000 * 2 * maxSeconds) break;
        if (!size) await progress.logLatency(profileId, callId, "first_gemini_audio", Date.now() - t0, 0);
        parts.push(event.pcm24k);
        size += event.pcm24k.byteLength;
        meter.outputAudioBytes += event.pcm24k.byteLength;
      } else if (event.type === "transcript" && event.role === "tutor") {
        output.push(event.text);
        await progress.logTurn(profileId, callId, "output", event.text);
      } else if (event.type === "usage") meter.recordUsage(event.usage);
      else if (event.type === "tool_call") {
        let end = false;
        for (const call of event.calls) {
          end ||= call.name === "end_session";
          ai.submitToolResult(call, end || meter.recordLearning(call.name ?? "", call.args ?? {}));
        }
        if (end) break;
      } else if (event.type === "turn_complete") { meter.tutorTurns = 1; break; }
      else if (event.type === "closed" || event.type === "go_away") break;
    }
  })();
  try { await Promise.race([work, deadline]); } finally { ai.close(); }
  return { audio: concat(parts), text: output.join(" "), meter, startedAt };
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
  const controls = await progress.loadControls(botId, defaults(s, botId));
  const callId = "web-" + randomHex(12);
  const allowance = await b.reserveCall(customerId, botId, callId, 120);
  if (!allowance.seconds) throw new HttpError(402, "אין יתרת שימוש זמינה. פנה לשירות לרכישת חבילה");
  await b.registerWebCall(callId, customerId, botId);
  let history = (await progress.lessonContext(customerId)) + (await b.lessonContext(customerId, botId));
  await b.saveContext(callId, await b.loadContext("preferences:" + customerId));
  history += "\n" + (await runtimeContext(b, callId));
  const artifact = await compilePrompt({ ...controls, opening_message: text }, history, botId, s);
  const startedAt = new Date();
  let result: LiveResult | null = null;
  try {
    await progress.savePromptSnapshot(botId, callId, artifact);
    await progress.logTurn(botId, callId, "input", text);
    await progress.logLatency(botId, callId, "session_started", 0, 0, { channel: "web" });
    result = await runLive(s, progress, botId, callId, artifact.setup_message, text, allowance.seconds, (Math.min(120, allowance.seconds) + 15) * 1000);
  } catch (error) {
    await progress.logDiagnostic(botId, callId, "web_turn_failed", { error_type: error instanceof Error ? error.name : "Error", message: (error instanceof Error ? error.message : "").split(s.geminiKey).join("[redacted]").slice(0, 250) });
    throw new HttpError(502, "המורה לא הצליח להשיב כרגע. נסה שוב");
  } finally {
    const elapsed = result?.startedAt ? (Date.now() - result.startedAt) / 1000 : 0;
    await b.settleCall(callId, elapsed);
    const meter = result?.meter ?? new SessionMeter();
    meter.learnerTurns = 1;
    await progress.saveSession({
      student_id: customerId, call_id: callId, started_at: startedAt, learner_turns: 1, tutor_turns: meter.tutorTurns,
      observations: meter.observations, transcript: [{ role: "learner", text }, { role: "tutor", text: result?.text ?? "" }],
      summary: meter.summary(), usage: meter.usage(s), model: controls.model,
    });
  }
  return Response.json({ call_id: callId, text: result.text, audio_wav_base64: b64encode(wav(result.audio, 24000)) });
}

const ANNOUNCER = "You are a professional voice announcer. Read the supplied text exactly, without additions, introductions, comments, or changing any wording. Use the language of the supplied text. Do not call tools.";

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
    result = await runLive(s, progress, profileId, callId, artifact.setup_message, record.text, 120, 120_000);
    if (!result.audio.byteLength) throw new Error("No audio received");
  } catch (error) {
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
