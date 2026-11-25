import { z } from "zod";
import { wav } from "./audio";
import { analyticsInput, conversion } from "./analytics";
import { BusinessStore } from "./business";
import { type Env, HttpError, nowIso, randomHex, settings, sha256Hex } from "./env";
import { visiblePhone } from "./phone";
import { rollingOfferDispatch, salesOfferDialError } from "./sales-offer";
import { campaignExternalId } from "./technoline-campaign";
import { isQaPhone } from "./qa-customers";

const CALLBACK_IP_PREFIX = "public-callback:ip:";
const CALLBACK_IP_LIMIT = 3;
const HOUR_MS = 60 * 60 * 1000;
export const SPEAKCALL_PHONE = "0765673575";

const callbackHour = (now: number) => new Date(now).toISOString().slice(0, 13);

export function cleanupCallbackQuota(env: Env) {
  return env.DB.prepare("DELETE FROM api_quota WHERE api GLOB ? AND api < ?")
    .bind(CALLBACK_IP_PREFIX + "*", CALLBACK_IP_PREFIX + callbackHour(Date.now())).run();
}

const RequestSchema = z.object({
  attribution: z.unknown().optional(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20),
  for_whom: z.enum(["self", "daughter", "son", "other"]),
  goal: z.string().trim().max(300).default(""),
  timing: z.enum(["now", "scheduled"]),
  preferred_time: z.string().trim().max(80).default(""),
  preferred_at: z.string().datetime({ offset: true }).optional(),
  consent: z.literal(true),
  source: z.string().trim().max(40).regex(/^[a-z0-9_-]*$/).refine(source => !["lesson_followup", "lesson_summary", "sales_offer"].includes(source)).default(""),
  website: z.string().max(0).default(""),
});

const israel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function localDate(date: Date): Date {
  const parts = Object.fromEntries(israel.formatToParts(date).map(p => [p.type, p.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

export function fromLocal(local: Date): Date {
  let result = new Date(local);
  for (let i = 0; i < 4; i++) {
    const delta = local.getTime() - localDate(result).getTime();
    if (!delta) break;
    result = new Date(result.getTime() + delta);
  }
  return result;
}

export function nextImmediateSlot(date: Date): Date {
  const local = localDate(date);
  const day = local.getUTCDay();
  const hour = local.getUTCHours();
  if (!(day === 5 && hour >= 14) && !(day === 6 && hour < 20)) return new Date(date);
  if (day === 5) local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(20, 0, 0, 0);
  return fromLocal(local);
}

export function nextCallingSlot(date: Date): Date {
  let result = nextImmediateSlot(date);
  for (;;) {
    const local = localDate(result);
    const hour = local.getUTCHours();
    if (hour >= 8 && hour < 22) return result;
    if (hour >= 22) local.setUTCDate(local.getUTCDate() + 1);
    local.setUTCHours(8, 0, 0, 0);
    result = nextImmediateSlot(fromLocal(local));
  }
}

export function followupLessonTime(day: string, part: string, now: Date): Date {
  const local = localDate(now);
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const namedDay = weekdays.indexOf(day);
  const fallback = !["today", "tomorrow", ...weekdays].includes(day);
  if (day === "tomorrow") local.setUTCDate(local.getUTCDate() + 1);
  else if (namedDay >= 0) local.setUTCDate(local.getUTCDate() + (namedDay - local.getUTCDay() + 7) % 7);
  const hour = fallback ? 17 : ({ morning: 10, noon: 16, afternoon: 16, evening: 19 }[part] ?? 17);
  local.setUTCHours(hour, 0, 0, 0);
  if (fromLocal(local) <= now) local.setUTCDate(local.getUTCDate() + (namedDay >= 0 ? 7 : 1));
  if (fallback) {
    while ([5, 6].includes(local.getUTCDay())) local.setUTCDate(local.getUTCDate() + 1);
  }
  return nextCallingSlot(fromLocal(local));
}

export function tomorrowAt(time: string, now: Date): Date | null {
  const [hour, minute] = time.split(":").map(Number);
  const local = localDate(now);
  local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(hour!, minute!, 0, 0);
  const at = fromLocal(local);
  return nextCallingSlot(at).getTime() === at.getTime() ? at : null;
}

export async function enqueueLessonCallback(b: BusinessStore, customerId: string, followupId: string, at: Date, now: string, callerPhone = "") {
  const customer = await b.record("customers", customerId);
  const linked = (await b.list("learner-phone-links")).filter(link => link.customer_id === customerId);
  const phone = [callerPhone, customer?.phone ?? "", ...linked.map(link => String(link.phone ?? ""))].map(normalizePhone).find(Boolean);
  if (!phone) throw new HttpError(422, "A visible phone is required for a lesson callback");
  const result = await b.db.prepare(
    "INSERT INTO callback_requests (id,phone,name,for_whom,goal,timing,preferred_time,source,consent_at,status,attempts,created_at,updated_at,next_attempt_at) VALUES (?,?,?,?,?,'scheduled',?,?,?,'queued',0,?,?,?) ON CONFLICT(id) DO UPDATE SET preferred_time=excluded.preferred_time,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at WHERE callback_requests.status='queued'",
  ).bind(followupId, phone, customer?.name || "", "self", "שיעור המשך", at.toISOString(), "lesson_followup", now, now, now, at.toISOString()).run();
  return result.meta.changes === 1;
}

export function parsePreferredTime(text: string, now: Date): Date | null {
  const local = localDate(now);
  let hasDay = false;
  const dateToken = /\b(\d{1,2})\/(\d{1,2})\b/g;
  const date = new RegExp(dateToken).exec(text);
  const timeText = text.replace(dateToken, " ");
  const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const weekday = weekdays.findIndex(day => text.includes(day));
  if (date) {
    const day = +date[1], month = +date[2];
    local.setUTCMonth(month - 1, day);
    if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
    if (local.getTime() < localDate(now).getTime() && month <= localDate(now).getUTCMonth() + 1) local.setUTCFullYear(local.getUTCFullYear() + 1);
    hasDay = true;
  } else if (text.includes("מחרתיים") || text.includes("מחר") || text.includes("היום")) {
    local.setUTCDate(local.getUTCDate() + (text.includes("מחרתיים") ? 2 : text.includes("מחר") ? 1 : 0));
    hasDay = true;
  } else if (weekday >= 0) {
    local.setUTCDate(local.getUTCDate() + (weekday - local.getUTCDay() + 7) % 7);
    hasDay = true;
  }
  const explicitTime = timeText.match(/(?:בשעה\s*|ב[-־]?\s*)(\d{1,2})(?:[:.](\d{2})\b)?(?!\d|:|\.\d)|\b(\d{1,2})[:.](\d{2})\b/);
  const hourOnly = timeText.match(/(\d{1,2})\s*(?:בערב|בבוקר|בצהריים|אחה["״']צ|אחר הצהריים)/);
  const afternoon = /אחה["״']צ|אחר הצהריים/.test(text);
  const evening = text.includes("ערב");
  const noon = text.includes("צהריים");
  const morning = text.includes("בוקר");
  let hour = explicitTime ? +(explicitTime[1] ?? explicitTime[3]) : hourOnly ? +hourOnly[1] : afternoon ? 16 : evening ? 19 : noon ? 13 : morning ? 10 : 8;
  const minute = explicitTime ? +(explicitTime[2] ?? explicitTime[4] ?? 0) : 0;
  if ((evening || afternoon || noon) && (explicitTime || hourOnly) && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return null;
  if (!hasDay && !explicitTime && !hourOnly && !afternoon && !evening && !noon && !morning) return null;
  local.setUTCHours(hour, minute, 0, 0);
  let result = fromLocal(local);
  if (!hasDay && result < now) {
    local.setUTCDate(local.getUTCDate() + 1);
    result = fromLocal(local);
  }
  return result;
}

export function callbackFailure(attempts: number, now: Date): { status: "queued" | "failed"; nextAttemptAt: string | null } {
  return attempts < 3
    ? { status: "queued", nextAttemptAt: nextCallingSlot(new Date(now.getTime() + (attempts === 1 ? 15 : 60) * 60000)).toISOString() }
    : { status: "failed", nextAttemptAt: null };
}

export function normalizePhone(raw: string): string | null {
  if (!visiblePhone(raw)) return null;
  let digits = raw.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+972")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return /^(?:0[57][0-9]{8}|0[23489][0-9]{7})$/.test(digits) ? digits : null;
}

type CallbackExtension = { id: string; name: string | null; path: string };
let cachedExtension: { apiKey: string; extension: CallbackExtension } | undefined;

export async function resolveCallbackExtension(env: Env): Promise<CallbackExtension> {
  const path = settings(env).projectPath;
  if (env.TLIVR_CALLBACK_EXTENSION_ID) return { id: env.TLIVR_CALLBACK_EXTENSION_ID, name: null, path };
  const apiKey = env.TLIVR_SYSTEM_API_KEY;
  if (!apiKey) throw new HttpError(503, "Technoline dialer not configured");
  if (cachedExtension?.apiKey === apiKey && cachedExtension.extension.path === path) return cachedExtension.extension;
  try {
    const url = "https://api.tlivr.com/ivrFilesApi.php?" + new URLSearchParams({ apiKey, action: "folderSettings", path });
    const response = await fetch(url, {
      method: "GET", headers: { "User-Agent": "speakcall-callbacks/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const data: unknown = await response.json();
    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const id = typeof result.id === "number" || typeof result.id === "string" ? String(result.id) : "";
    if (!response.ok || String(result.status).toUpperCase() === "ERROR" || !/^[0-9]+$/.test(id)) throw new Error("Invalid extension");
    const extension = { id, name: typeof result.name === "string" ? result.name : null, path };
    cachedExtension = { apiKey, extension };
    return extension;
  } catch {
    throw new HttpError(502, "Technoline extension resolution failed");
  }
}

export function buildTechnolineCallbackBody(env: Env, phone: string, requestId: string, now: Date, demo = false, singleAttempt = false) {
  const retryAt = new Date(now.getTime() + 30 * 60000);
  const sameStretch = nextCallingSlot(now).getTime() === now.getTime()
    && nextCallingSlot(retryAt).getTime() === retryAt.getTime();
  return {
    action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY, phones: [phone],
    title: "SpeakCall callback", messagesType: "extensionActivation",
    extensionActivation: env.TLIVR_CALLBACK_EXTENSION_ID,
    dialRetries: !singleAttempt && sameStretch ? 2 : 0, betweenRetries: 15, reasonableHours: "no",
    externalID: campaignExternalId(requestId), ...(demo ? { demo: "yes" } : {}),
  };
}

export async function dialTechnolineCallback(env: Env, phone: string, requestId: string, demo = false, singleAttempt = false) {
  if (!env.TLIVR_SYSTEM_API_KEY) throw new HttpError(503, "Technoline dialer not configured");
  const extension = await resolveCallbackExtension(env);
  const response = await fetch("https://api.tlivr.com/campaignApi.php", {
    method: "POST",
    headers: { "User-Agent": "speakcall-callbacks/1.0", "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify(buildTechnolineCallbackBody({ ...env, TLIVR_CALLBACK_EXTENSION_ID: extension.id }, phone, requestId, new Date(), demo, singleAttempt)),
  });
  const data: unknown = await response.json().catch(() => null);
  const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    ok: response.ok && String(result.status).toUpperCase() === "OK" && String(result.errorCode) === "0",
    errorCode: typeof result.errorCode === "string" || typeof result.errorCode === "number" ? result.errorCode : null,
    campaignId: result.campaignId == null ? null : String(result.campaignId),
    billing: result.billing ?? null,
    httpStatus: response.status,
    extension,
  };
}

export function canCallWithLessonSummary(env: Env, phone: string, now = new Date()) {
  const recipient = normalizePhone(phone);
  return !!env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON && !!env.TLIVR_SYSTEM_API_KEY && !!env.TLIVR_SYSTEM_PHONE?.split(",").some(number => number.trim() === SPEAKCALL_PHONE)
    && !!recipient && recipient !== SPEAKCALL_PHONE && nextCallingSlot(now).getTime() === now.getTime();
}

export function lessonSummaryAudioText(points: number | undefined, learnerTurns: number) {
  const result = points === undefined
    ? `היום היו ${learnerTurns} תורות דיבור בשיעור. תודה על התרגול המשותף.`
    : `בתרגול נצברו ${points} נקודות מתוך מאה. תודה על התרגול המשותף.`;
  return `שלום, כאן ספיקול עם סיכום קצר של השיעור. ${result} רוצים להמשיך להתאמן? שמרו את המספר שעל המסך. להתראות!`;
}

export async function callWithLessonSummary(env: Env, phone: string, callId: string, makeAudio: () => Promise<Uint8Array>, now = new Date()) {
  if (!canCallWithLessonSummary(env, phone, now)) return false;
  if (await isQaPhone(env.DB, normalizePhone(phone)!)) return false;
  const recipient = normalizePhone(phone)!;
  const id = (await sha256Hex("lesson-summary:" + callId)).slice(0, 32);
  const at = now.toISOString();
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO callback_requests
    (id,phone,name,for_whom,goal,timing,source,consent_at,status,attempts,created_at,updated_at)
    VALUES (?,?,'','self','סיכום קולי בסיום שיעור','now','lesson_summary',?,'dialing',1,?,?)`).bind(id, recipient, at, at, at).run();
  if (claim.meta.changes !== 1) return false;
  let ok = false;
  let campaignId: string | null = null;
  try {
    const pcm = await makeAudio();
    if (pcm.byteLength < 5 * 8000 * 2 || !canCallWithLessonSummary(env, phone)) return false;
    const body = new FormData();
    for (const [key, value] of Object.entries({
      action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY!,
      title: "SpeakCall lesson summary", messagesType: "audioFile", callId: SPEAKCALL_PHONE,
      dialRetries: "0", betweenRetries: "20", reasonableHours: "yes", externalID: campaignExternalId(id),
    })) body.set(key, value);
    body.set("phones", recipient);
    body.set("audioFile", new Blob([new Uint8Array(wav(pcm, 8000))], { type: "audio/wav" }), "summary.wav");
    const response = await fetch("https://api.tlivr.com/campaignApi.php", {
      method: "POST",
      headers: { "User-Agent": "speakcall-callbacks/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      body,
    });
    const result = await response.json() as Record<string, unknown> | null;
    ok = response.ok && String(result?.status).toUpperCase() === "OK" && String(result?.errorCode) === "0";
    if (ok && result?.campaignId != null) campaignId = String(result.campaignId);
  } catch {
    ok = false;
  } finally {
    await env.DB.prepare("UPDATE callback_requests SET status=?,provider_ref=?,last_error=?,updated_at=? WHERE id=?")
      .bind(ok ? "dialed" : "failed", campaignId, ok ? null : "Voice summary call not accepted", nowIso(), id).run();
  }
  return ok;
}

export async function testCallbackDial(request: Request, env: Env) {
  const parsed = z.object({ phone: z.string().max(20) }).safeParse(await request.json().catch(() => null));
  const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
  if (!phone) throw new HttpError(422, "Invalid phone");
  try {
    const { ok, errorCode, campaignId, billing, extension } = await dialTechnolineCallback(env, phone, "dial-test-" + randomHex(16), true);
    return { ok, errorCode, campaignId, billing, extension };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Technoline unreachable");
  }
}

export async function submitCallback(request: Request, env: Env): Promise<Response> {
  const parsed = RequestSchema.safeParse(await analyticsInput(request));
  if (!parsed.success) throw new HttpError(422, "Invalid request");
  const body = parsed.data;
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(422, "Invalid phone");
  const time = Date.now();
  const now = nowIso();
  const preferred = body.preferred_at ? new Date(body.preferred_at) : null;
  if (preferred && (preferred.getTime() < Date.parse(now) || preferred.getTime() > Date.parse(now) + 30 * 86400000)) throw new HttpError(422, "Invalid preferred_at");
  const scheduled = body.timing === "now" ? new Date(now) : preferred ?? parsePreferredTime(body.preferred_time, new Date(now)) ?? new Date(now);
  const nextAttempt = (body.timing === "now" ? nextImmediateSlot(scheduled) : nextCallingSlot(scheduled)).toISOString();
  const recent = await env.DB.prepare("SELECT id FROM callback_requests WHERE phone=? AND created_at>? AND source NOT IN ('lesson_followup','lesson_summary','sales_offer') LIMIT 1")
    .bind(phone, new Date(time - 86400000).toISOString()).first<{ id: string }>();
  if (recent) return Response.json({ ok: true, id: recent.id, duplicate: true });
  const ipHash = await sha256Hex(request.headers.get("CF-Connecting-IP") || "unknown");
  const key = CALLBACK_IP_PREFIX + callbackHour(time) + ":" + ipHash;
  if (!await new BusinessStore(env.DB).consumeMonthlyQuota(key, CALLBACK_IP_LIMIT)) {
    return Response.json({ detail: "Too many callback requests" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((HOUR_MS - time % HOUR_MS) / 1000)), "Cache-Control": "no-store" },
    });
  }
  const id = randomHex(16);
  await env.DB.prepare(
    "INSERT INTO callback_requests (id,phone,name,for_whom,goal,timing,preferred_time,source,consent_at,status,attempts,created_at,updated_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,'queued',0,?,?,?)",
  ).bind(id, phone, body.name, body.for_whom, body.goal, body.timing, body.preferred_time || null, body.source || "landing", now, now, now, nextAttempt).run();
  await conversion(env, "generate_lead", body.attribution, id).catch(error => console.error("Analytics lead failed", error));
  const shabbat = nextImmediateSlot(scheduled).getTime() !== scheduled.getTime();
  const status = body.timing === "now" && !shabbat && dialerConfigured(env)
    ? await dialCallbackRow(env, { id, phone, attempts: 0, timing: body.timing, source: body.source || "landing" }, new Date(now), true)
    : "queued";
  return Response.json({ ok: true, id, status, ...(status === "queued" && shabbat ? { reason: "shabbat" } : {}) }, { status: 201 });
}

export async function listCallbacks(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    "SELECT id,phone,name,for_whom,goal,timing,preferred_time,source,status,attempts,last_error,created_at,updated_at,next_attempt_at FROM callback_requests ORDER BY created_at DESC LIMIT 200",
  ).all();
  return { items: results, dialer_configured: !!(env.CALLBACK_RELAY_URL && env.CALLBACK_RELAY_SECRET) || !!env.TLIVR_SYSTEM_API_KEY };
}

function dialerConfigured(env: Env): boolean {
  return !!(env.CALLBACK_RELAY_URL && env.CALLBACK_RELAY_SECRET) || !!env.TLIVR_SYSTEM_API_KEY;
}

async function dialCallbackRow(env: Env, item: { id: string; phone: string; attempts: number; timing: string; source: string }, now: Date, immediateForm = false): Promise<"dialing" | "dialed" | "queued" | "failed"> {
  if (await isQaPhone(env.DB, item.phone)) {
    await env.DB.prepare("UPDATE callback_requests SET status='failed',last_error='QA test customer excluded',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='queued'")
      .bind(now.toISOString(), item.id).run();
    return "failed";
  }
  const useRelay = !!env.CALLBACK_RELAY_URL && !!env.CALLBACK_RELAY_SECRET;
  const rolling = item.source === "sales_offer" ? await rollingOfferDispatch(env, item.id, now) : null;
  if (item.source === "sales_offer") {
    const error = (rolling && item.attempts > 0 ? "Rolling sales offer already attempted" : null)
      ?? (rolling && useRelay ? "Rolling sales offers require the direct Technoline dialer" : null)
      ?? await salesOfferDialError(env, item.id, item.phone, now);
    if (error) {
      await env.DB.prepare("UPDATE callback_requests SET status='failed',last_error=?,next_attempt_at=NULL,updated_at=? WHERE id=? AND status='queued'")
        .bind(error, now.toISOString(), item.id).run();
      return "failed";
    }
    if (rolling?.hold) {
      await env.DB.batch([
        env.DB.prepare("UPDATE console_records SET body=json_set(body,'$.expires_at',?),updated_at=? WHERE kind='sales-offers' AND id=?")
          .bind(rolling.hold.expires, now.toISOString(), item.id),
        env.DB.prepare("UPDATE callback_requests SET next_attempt_at=?,updated_at=? WHERE id=? AND status='queued'")
          .bind(rolling.hold.at, now.toISOString(), item.id),
      ]);
      return "queued";
    }
  }
  const slot = immediateForm && item.timing === "now" && item.attempts === 0 ? nextImmediateSlot(now) : nextCallingSlot(now);
  if (slot.getTime() !== now.getTime()) {
    await env.DB.prepare("UPDATE callback_requests SET next_attempt_at=?,updated_at=? WHERE id=? AND status='queued'")
      .bind(slot.toISOString(), nowIso(), item.id).run();
    return "queued";
  }
  if (item.source === "lesson_followup") {
    const b = new BusinessStore(env.DB);
    const followup = await b.record("sales-followups", item.id);
    if (!followup || !await b.hasSchoolCallbackMinutes(followup.customer_id)) {
      await env.DB.prepare("UPDATE callback_requests SET status='failed',last_error='No school minutes available',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='queued'")
        .bind(nowIso(), item.id).run();
      return "failed";
    }
  }
  const provider = useRelay ? "relay" : "technoline";
  const failureState = () => rolling ? { status: "failed" as const, nextAttemptAt: null } : callbackFailure(item.attempts + 1, new Date());
  const claimed = await env.DB.prepare("UPDATE callback_requests SET status='dialing',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' AND next_attempt_at<=? AND attempts=?")
    .bind(nowIso(), item.id, now.toISOString(), item.attempts).run();
  if (claimed.meta.changes !== 1) return "dialing";
  try {
    let ok: boolean;
    let providerRef: string | null;
    let lastError: string;
    if (useRelay) {
      const response = await fetch(env.CALLBACK_RELAY_URL!, {
        method: "POST",
        headers: { Authorization: "Bearer " + env.CALLBACK_RELAY_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: item.id, phone: item.phone }),
        signal: AbortSignal.timeout(10000),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      ok = response.ok && result.ok === true;
      providerRef = ok ? String(result.campaign_id ?? "") : null;
      lastError = "relay " + response.status;
    } else {
      const dialEnv = item.source === "sales_offer" && env.SALES_OFFER_EXTENSION_ID
        ? { ...env, TLIVR_CALLBACK_EXTENSION_ID: env.SALES_OFFER_EXTENSION_ID } : env;
      const result = await dialTechnolineCallback(dialEnv, item.phone, item.id, false, !!rolling);
      ok = result.ok;
      providerRef = ok ? String(result.campaignId ?? "") : null;
      lastError = "technoline " + (result.errorCode || result.httpStatus);
    }
    const failure = failureState();
    await env.DB.prepare("UPDATE callback_requests SET status=?,provider_ref=?,last_error=?,updated_at=?,next_attempt_at=? WHERE id=?")
      .bind(ok ? "dialed" : failure.status, providerRef, ok ? null : lastError, nowIso(), ok ? null : failure.nextAttemptAt, item.id).run();
    if (ok && item.source === "sales_offer") {
      await env.DB.prepare("UPDATE console_records SET body=json_set(body,'$.status','dialed'),updated_at=? WHERE kind='sales-offers' AND id=? AND json_extract(body,'$.status')='queued'")
        .bind(nowIso(), item.id).run();
    }
    return ok ? "dialed" : failure.status;
  } catch {
    const failure = failureState();
    await env.DB.prepare("UPDATE callback_requests SET status=?,last_error=?,updated_at=?,next_attempt_at=? WHERE id=?")
      .bind(failure.status, provider + " unreachable", nowIso(), failure.nextAttemptAt, item.id).run();
    return failure.status;
  }
}

export async function dispatchCallbacks(env: Env): Promise<Record<string, unknown>> {
  if (!dialerConfigured(env)) return { skipped: "dialer not configured" };
  const now = new Date();
  await env.DB.prepare("UPDATE callback_requests SET status='queued',next_attempt_at=?,updated_at=? WHERE status='dialing' AND source!='lesson_summary' AND updated_at<?")
    .bind(now.toISOString(), now.toISOString(), new Date(now.getTime() - 15 * 60000).toISOString()).run();
  const slot = nextCallingSlot(now);
  if (slot.getTime() !== now.getTime()) {
    await env.DB.prepare("UPDATE callback_requests SET next_attempt_at=?,updated_at=? WHERE status='queued' AND next_attempt_at<=?")
      .bind(slot.toISOString(), now.toISOString(), now.toISOString()).run();
    return { skipped: "outside calling hours" };
  }
  const { results } = await env.DB.prepare(
    "SELECT id,phone,attempts,timing,source FROM callback_requests WHERE status='queued' AND source!='lesson_summary' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 20",
  ).bind(now.toISOString()).all<{ id: string; phone: string; attempts: number; timing: string; source: string }>();
  let sent = 0;
  for (const item of results) {
    if (await dialCallbackRow(env, item, new Date()) === "dialed") sent++;
  }
  return { sent, queued: results.length };
}
