import { Buffer } from "node:buffer";
import { normalizedPhone } from "./business";
import { type Env, HttpError, sha256Hex } from "./env";

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_SECONDS = 60;
const MAX_BYTES = 1_000_000;
const DAILY_INTAKE = 600;
const DAILY_CALLER_ATTEMPTS = 3;
const DAILY_GLOBAL_SECONDS = 6_000;
const FETCH_ATTEMPTS = 2;
const LEASE_MS = 120_000;
const day = () => new Date().toISOString().slice(0, 10);
const key = (id: string) => `voicemails/${id}.mp3`;

export async function enqueueVoicemail(env: Env, system: string, customer: string, caller: string, file: string, duration?: string) {
  if (!env.VOICEMAIL_AUDIO || !env.TLIVR_SYSTEM_API_KEY || !/^[a-zA-Z0-9_.-]{1,100}$/.test(file)) return null;
  const seconds = duration ? Number(duration) : null;
  if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS)) return null;
  let callerKey = "hidden";
  try { callerKey = await sha256Hex(normalizedPhone(caller)); } catch { /* Hidden numbers share one allowance. */ }
  const now = new Date().toISOString();
  const id = await sha256Hex(`${system}:${file}`);
  return env.DB.prepare(`INSERT INTO ivr_voicemails (id,system_phone,file_id,customer_id,caller_key,created_at,intake_day)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM ivr_voicemails WHERE intake_day=?) < ?
    ON CONFLICT(system_phone,file_id) DO NOTHING RETURNING id`)
    .bind(id, system, file, customer, callerKey, now, now.slice(0, 10), now.slice(0, 10), DAILY_INTAKE)
    .first<string>("id");
}

function mp3Seconds(bytes: Uint8Array): number {
  let offset = 0, seconds = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length >= 10) {
    const size = bytes.subarray(6, 10);
    if (size.some(byte => byte > 127)) return 0;
    offset = 10 + size.reduce((acc, byte) => acc * 128 + byte, 0) + ((bytes[5] & 0x10) ? 10 : 0);
  }
  const end = bytes.length >= 128 && bytes[bytes.length - 128] === 0x54 && bytes[bytes.length - 127] === 0x41 && bytes[bytes.length - 126] === 0x47
    ? bytes.length - 128 : bytes.length;
  const rates = [44100, 48000, 32000];
  const mpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  while (offset + 4 <= end) {
    const [, flags, format] = bytes.subarray(offset, offset + 3);
    const version = (flags >> 3) & 3;
    if (bytes[offset] !== 0xff || (flags & 0xe6) !== 0xe2 || version === 1) return 0;
    const rate = rates[(format >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? mpeg1 : mpeg2)[format >> 4];
    if (!rate || !bitrate) return 0;
    const samples = version === 3 ? 1152 : 576;
    offset += Math.floor(samples * bitrate * 125 / rate) + ((format >> 1) & 1);
    seconds += samples / rate;
    if (seconds > MAX_SECONDS + 0.15) return 0;
  }
  return offset === end ? Math.ceil(seconds) : 0;
}

class InvalidAudio extends Error {}
class DownloadResponseError extends Error {
  constructor(readonly status: number) { super("Unexpected Technoline download response"); }
}

async function download(fileId: string, apiKey: string): Promise<Uint8Array> {
  const params = new URLSearchParams({ action: "fileDownload", audio: fileId, apiKey });
  const response = await fetch(`https://api.tlivr.com/ivrFilesApi.php?${params}`, {
    headers: { "User-Agent": "speakcall-voicemails/1.0", Accept: "audio/mpeg, audio/mp3" },
    signal: AbortSignal.timeout(15_000), redirect: "manual",
  });
  const mime = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (!response.ok || !response.body || (mime !== "audio/mp3" && mime !== "audio/mpeg")) {
    await response.body?.cancel();
    throw new DownloadResponseError(response.status);
  }
  if (Number(response.headers.get("Content-Length")) > MAX_BYTES) {
    await response.body.cancel();
    throw new InvalidAudio();
  }
  const reader = response.body.getReader();
  const content = new Uint8Array(MAX_BYTES);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > MAX_BYTES) {
        await reader.cancel();
        throw new InvalidAudio();
      }
      content.set(value, length);
      length += value.length;
    }
  } finally { reader.releaseLock(); }
  return content.subarray(0, length);
}

export async function processVoicemail(env: Env, id: string) {
  if (!env.VOICEMAIL_AUDIO || !env.TLIVR_SYSTEM_API_KEY) return;
  const now = Date.now();
  const job = await env.DB.prepare(`UPDATE ivr_voicemails SET status='fetching', fetch_attempts=fetch_attempts+1, lease_until=?
    WHERE id=? AND fetch_attempts<? AND (status='pending' OR (status='fetching' AND lease_until<=?))
    RETURNING file_id, caller_key, fetch_attempts`)
    .bind(now + LEASE_MS, id, FETCH_ATTEMPTS, now)
    .first<{ file_id: string; caller_key: string; fetch_attempts: number }>();
  if (!job) return;

  const stillFetching = "WHERE id=? AND status='fetching' AND fetch_attempts=?";
  const fail = (status: "invalid_audio" | "download_failed" | "storage_failed") =>
    env.DB.prepare(`UPDATE ivr_voicemails SET status=? ${stillFetching}`)
      .bind(status !== "invalid_audio" && job.fetch_attempts < FETCH_ATTEMPTS ? "pending" : status, id, job.fetch_attempts).run();
  let audio: Uint8Array, seconds: number;
  try {
    audio = await download(job.file_id, env.TLIVR_SYSTEM_API_KEY);
    seconds = mp3Seconds(audio);
    if (!seconds) throw new InvalidAudio();
  } catch (e) {
    if (e instanceof InvalidAudio) {
      await fail("invalid_audio");
    } else {
      console.warn("Voicemail download failed", e instanceof DownloadResponseError ? { http_status: e.status } : {});
      await fail("download_failed");
    }
    return;
  }
  try {
    await env.VOICEMAIL_AUDIO.put(key(id), audio, { httpMetadata: { contentType: "audio/mpeg" } });
  } catch {
    console.warn("Voicemail R2 write failed");
    await fail("storage_failed");
    return;
  }

  if (!env.AI) {
    await env.DB.prepare(`UPDATE ivr_voicemails SET audio_ready=1,duration_seconds=?,status='transcription_failed' ${stillFetching}`)
      .bind(seconds, id, job.fetch_attempts).run();
    return;
  }
  const today = day();
  const claim = await env.DB.prepare(`UPDATE ivr_voicemails SET audio_ready=1,duration_seconds=?,
    status='transcribing',transcription_day=?,reserved_seconds=?,lease_until=?
    ${stillFetching}
    AND (SELECT COUNT(*) FROM ivr_voicemails WHERE transcription_day=? AND caller_key=?) < ?
    AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ivr_voicemails WHERE transcription_day=?) + ? <= ?
    RETURNING id`).bind(seconds, today, seconds, Date.now() + LEASE_MS, id, job.fetch_attempts,
      today, job.caller_key, DAILY_CALLER_ATTEMPTS, today, seconds, DAILY_GLOBAL_SECONDS).first<string>("id");
  if (!claim) {
    await env.DB.prepare(`UPDATE ivr_voicemails SET audio_ready=1,duration_seconds=?,status='quota_exceeded' ${stillFetching}`)
      .bind(seconds, id, job.fetch_attempts).run();
    return;
  }

  let transcript: string | null = null;
  let status = "transcription_failed";
  try {
    const result = await env.AI.run(MODEL, { audio: Buffer.from(audio).toString("base64"), task: "transcribe", language: "he", vad_filter: true });
    if (typeof result.text === "string") {
      transcript = result.text.trim().slice(0, 12_000) || null;
      status = transcript ? "ready" : "no_speech";
    }
  } catch { /* A billed attempt is never retried. */ }
  await env.DB.prepare("UPDATE ivr_voicemails SET status=?,transcript=? WHERE id=? AND status='transcribing'")
    .bind(status, transcript, id).run();
}

export async function dispatchVoicemails(env: Env) {
  if (!env.VOICEMAIL_AUDIO) return;
  const now = Date.now();
  await env.DB.prepare(`UPDATE ivr_voicemails SET status=CASE status WHEN 'fetching' THEN 'audio_failed' ELSE 'transcription_failed' END
    WHERE lease_until<=? AND (status='transcribing' OR (status='fetching' AND fetch_attempts>=?))`).bind(now, FETCH_ATTEMPTS).run();
  const { results } = await env.DB.prepare(`SELECT id FROM ivr_voicemails
    WHERE status='pending' OR (status='fetching' AND lease_until<=?) ORDER BY created_at LIMIT 12`).bind(now).all<{ id: string }>();
  await Promise.all(results.map(({ id }) => processVoicemail(env, id)));
}

export async function listVoicemails(env: Env, before: string | null) {
  if (before && !/^[a-f0-9]{64}$/.test(before)) throw new HttpError(400, "בקשה לא תקינה");
  const { results } = await env.DB.prepare(`SELECT v.id,v.customer_id,v.created_at,v.duration_seconds,v.audio_ready,v.status,v.transcript,
    c.name AS customer_name,c.primary_phone AS phone
    FROM ivr_voicemails v LEFT JOIN customers c ON c.id=v.customer_id
    WHERE (? IS NULL OR (v.created_at,v.id) < (SELECT created_at,id FROM ivr_voicemails WHERE id=?))
    ORDER BY v.created_at DESC,v.id DESC LIMIT 51`).bind(before, before).all<{ id: string }>();
  const items = results.slice(0, 50);
  return { items, next: results.length > items.length ? items.at(-1)?.id : null };
}

export async function voicemailAudio(env: Env, id: string) {
  const exists = await env.DB.prepare("SELECT id FROM ivr_voicemails WHERE id=? AND audio_ready=1").bind(id).first();
  const object = exists && await env.VOICEMAIL_AUDIO?.get(key(id));
  if (!object) throw new HttpError(404, "ההקלטה אינה זמינה");
  return new Response(object.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
