import { z } from "zod";
import { BusinessStore } from "./business";
import { SPEAKCALL_PHONE } from "./callbacks";
import { type Env, HttpError, nowIso, randomHex, sha256Hex } from "./env";
import { visiblePhone } from "./phone";

const name = "isaacPersonalMessage";
const confirm = "isaacPersonalAnswer";
const phoneNumber = (value: string) => {
  const phone = visiblePhone(value);
  return phone && /^05\d{8}$/.test(phone) ? phone : null;
};
const configuration = z.object({ narration_id: z.string().min(1).max(100), inbound_enabled: z.boolean().default(false) });
const dialOptions = z.object({ extension_id: z.string().regex(/^\d{1,20}$/), inbound_fallback: z.boolean().default(false) });
export const callerMessageAudioPath = "/v1/technoline/caller-messages/audio/message.wav";

export async function callerMessageAdmin(request: Request, env: Env, path: string) {
  const match = /^\/v1\/admin\/caller-messages\/([^/]+)(\/dial)?$/.exec(path);
  if (!match) throw new HttpError(404, "Unknown caller message endpoint");
  const phone = phoneNumber(match[1]);
  if (!phone) throw new HttpError(422, "Invalid recipient phone");
  const db = env.DB;
  if (!match[2] && request.method === "GET") {
    const result = await db.prepare("SELECT phone,narration_id,inbound_enabled,played_at FROM caller_messages WHERE phone=?").bind(phone).first();
    if (!result) throw new HttpError(404, "No caller message");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
  const body = await request.json().catch(() => null);
  if (!match[2]) {
    const parsed = configuration.safeParse(body);
    if (!parsed.success) throw new HttpError(422, "Invalid caller message");
    const { narration_id: id, inbound_enabled: enabled } = parsed.data;
    const b = new BusinessStore(db);
    const [record, audio] = await Promise.all([b.record("narrations", id), b.getAudio(id)]);
    if (!audio || record?.status !== "approved" || record.language !== "he-IL" || audio.text_hash !== await sha256Hex(record.text)) {
      throw new HttpError(409, "An approved Hebrew narration with current audio is required");
    }
    const duration = (audio.wav.byteLength - 44) / 16000;
    if (duration < 1 || duration > 60) throw new HttpError(422, "Caller message must be between 1 and 60 seconds");
    const result = await db.prepare(`INSERT INTO caller_messages(phone,narration_id,audio_hash,duration_seconds,inbound_enabled)
      VALUES (?,?,?,?,?)
      ON CONFLICT(phone) DO UPDATE SET narration_id=excluded.narration_id,audio_hash=excluded.audio_hash,
        duration_seconds=excluded.duration_seconds,inbound_enabled=excluded.inbound_enabled,
        outbound_extension=NULL,outbound_until=0,playback_call_id=NULL,playback_token=NULL,playback_until=0,played_at=NULL
      WHERE caller_messages.played_at IS NOT NULL`).bind(phone, id, await sha256Hex(audio.wav), duration, Number(enabled)).run();
    if (!result.meta.changes) throw new HttpError(409, "This number already has a pending caller message");
    return Response.json({ phone, inbound_enabled: enabled }, { status: 201 });
  }
  const parsed = dialOptions.safeParse(body);
  if (!parsed.success) throw new HttpError(422, "Invalid caller message extension");
  if (!env.TLIVR_SYSTEM_API_KEY || !env.PUBLIC_BASE_URL) throw new HttpError(503, "Caller message dialing unavailable");
  const now = Date.now();
  const result = await db.prepare(`UPDATE caller_messages SET outbound_extension=?,outbound_until=?,inbound_enabled=MAX(inbound_enabled,?)
    WHERE phone=? AND played_at IS NULL AND outbound_until<=? AND playback_until<=?`)
    .bind(parsed.data.extension_id, now + 300_000, Number(parsed.data.inbound_fallback), phone, now, now).run();
  if (!result.meta.changes) throw new HttpError(409, "No pending caller message available to dial");
  try {
    const response = await fetch("https://api.tlivr.com/campaignApi.php", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY, phones: [phone], title: "SpeakCall personal message",
        messagesType: "extensionActivation", extensionActivation: parsed.data.extension_id,
        dialRetries: 0, reasonableHours: "no", externalID: randomHex(16),
      }),
    });
    const report = await response.json() as Record<string, unknown>;
    if (response.ok && String(report.status).toUpperCase() === "OK" && String(report.errorCode) === "0") {
      return Response.json({ accepted: true, campaign_id: report.campaignId ?? null }, { status: 202 });
    }
  } catch { /* Do not retry: the provider may already have accepted the campaign. */ }
  throw new HttpError(502, "Caller message campaign not confirmed");
}

export async function callerMessagePlayback(env: Env, p: Record<string, string>, outbound = false) {
  const phone = phoneNumber(p.PBXphone ?? "");
  if (!phone || p.PBXnum !== SPEAKCALL_PHONE || !env.PUBLIC_BASE_URL) return null;
  if (outbound ? p.PBXcallType !== "out" : p.PBXcallType === "out") return null;
  const db = env.DB, callId = p.PBXcallId, now = Date.now();
  if (p[name] !== undefined || p.PBXcallStatus === "HANGUP") {
    const listened = Number(p["DURATION_" + name]);
    await db.prepare(`UPDATE caller_messages SET played_at=CASE
      WHEN ?=1 AND ?>=CAST(duration_seconds AS INTEGER) THEN ? ELSE played_at END,
      playback_token=NULL,playback_until=0
      WHERE phone=? AND playback_call_id=? AND playback_token IS NOT NULL AND playback_until>?`)
      .bind(Number(p[name] === "finished" && p.PBXcallStatus === "CALL"), Number.isFinite(listened) ? listened : 0,
        nowIso(), phone, callId, now).run();
    return null;
  }
  if (p.PBXcallStatus !== "CALL") return null;
  if (outbound && p[confirm] !== "1") {
    if (p[confirm] !== undefined) return null;
    const pending = await db.prepare(`SELECT 1 FROM caller_messages WHERE phone=? AND played_at IS NULL
      AND playback_until<=? AND outbound_extension=? AND outbound_until>?`).bind(phone, now, p.PBXextensionId ?? "", now).first();
    return pending ? {
      type: "simpleMenu", name: confirm, enabledKeys: "1", times: 1, timeout: 5, errorReturn: "END", post: true,
      files: [{ text: "שלום, כאן ספיקול. להאזנה להודעה אישית, הקישו 1." }],
    } : null;
  }
  const token = randomHex(24);
  const result = await db.prepare(`UPDATE caller_messages SET playback_call_id=?,playback_token=?,playback_until=?
    WHERE phone=? AND played_at IS NULL AND playback_until<=? AND (playback_call_id IS NULL OR playback_call_id<>?)
    AND ((?=0 AND inbound_enabled=1) OR (?=1 AND outbound_extension=? AND outbound_until>?))`)
    .bind(callId, token, now + 120_000, phone, now, callId, Number(outbound), Number(outbound), p.PBXextensionId ?? "", now).run();
  if (!result.meta.changes) return null;
  return {
    type: "audioPlayer", name, beepPlay: "NO",
    keyActions: Object.fromEntries("0 1 2 3 4 5 6 7 8 9 STAR POUND".split(" ").map(key => [key, "none"])),
    files: [{ fileLink: env.PUBLIC_BASE_URL.replace(/\/$/, "") + callerMessageAudioPath + "?token=" + token }],
  };
}

export async function callerMessageAudio(env: Env, token: string | null) {
  if (!token || !/^[0-9a-f]{48}$/.test(token)) throw new HttpError(404, "No caller message audio");
  const claim = await env.DB.prepare("SELECT narration_id,audio_hash FROM caller_messages WHERE playback_token=? AND playback_until>? AND played_at IS NULL")
    .bind(token, Date.now()).first<{ narration_id: string; audio_hash: string }>();
  const audio = claim && await new BusinessStore(env.DB).getAudio(claim.narration_id);
  if (!audio || await sha256Hex(audio.wav) !== claim?.audio_hash) throw new HttpError(404, "No caller message audio");
  return new Response(audio.wav, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
}
