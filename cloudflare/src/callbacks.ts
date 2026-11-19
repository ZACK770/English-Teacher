import { z } from "zod";
import { BusinessStore } from "./business";
import { type Env, HttpError, nowIso, randomHex, settings, sha256Hex } from "./env";
import { visiblePhone } from "./phone";

const CALLBACK_IP_PREFIX = "public-callback:ip:";
const CALLBACK_IP_LIMIT = 3;
const HOUR_MS = 60 * 60 * 1000;

const callbackHour = (now: number) => new Date(now).toISOString().slice(0, 13);

export function cleanupCallbackQuota(env: Env) {
  return env.DB.prepare("DELETE FROM api_quota WHERE api GLOB ? AND api < ?")
    .bind(CALLBACK_IP_PREFIX + "*", CALLBACK_IP_PREFIX + callbackHour(Date.now())).run();
}

const RequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20),
  for_whom: z.enum(["self", "daughter", "son", "other"]),
  goal: z.string().trim().max(300).default(""),
  timing: z.enum(["now", "scheduled"]),
  preferred_time: z.string().trim().max(80).default(""),
  preferred_at: z.string().datetime({ offset: true }).optional(),
  consent: z.literal(true),
  source: z.string().trim().max(40).regex(/^[a-z0-9_-]*$/).default(""),
  website: z.string().max(0).default(""),
});

const israel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localDate(date: Date): Date {
  const parts = Object.fromEntries(israel.formatToParts(date).map(p => [p.type, p.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

function fromLocal(local: Date): Date {
  let result = new Date(local);
  for (let i = 0; i < 4; i++) {
    const delta = local.getTime() - localDate(result).getTime();
    if (!delta) break;
    result = new Date(result.getTime() + delta);
  }
  return result;
}

export function nextCallingSlot(date: Date): Date {
  const local = localDate(date);
  const day = local.getUTCDay();
  const hour = local.getUTCHours();
  if (day !== 6 && !(day === 5 && hour >= 14) && hour >= 8 && hour < 22) return new Date(date);
  if (hour >= 22 || day === 6 || (day === 5 && hour >= 14)) local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(8, 0, 0, 0);
  if (local.getUTCDay() === 6) local.setUTCDate(local.getUTCDate() + 1);
  return fromLocal(local);
}

export function parsePreferredTime(text: string, now: Date): Date | null {
  const local = localDate(now);
  let hasDay = false;
  const date = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
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
  const clock = text.match(/(\d{1,2}):(\d{2})/);
  const hourOnly = text.match(/(?:בשעה\s*|ב[-־]?\s*)(\d{1,2})(?!\d)/) ?? text.match(/(\d{1,2})\s*(?:בערב|בבוקר|בצהריים|אחה["״']צ|אחר הצהריים)/);
  const afternoon = /אחה["״']צ|אחר הצהריים/.test(text);
  const evening = text.includes("ערב");
  const noon = text.includes("צהריים");
  const morning = text.includes("בוקר");
  let hour = clock ? +clock[1] : hourOnly ? +hourOnly[1] : afternoon ? 16 : evening ? 19 : noon ? 13 : morning ? 10 : 8;
  const minute = clock ? +clock[2] : 0;
  if ((evening || afternoon || noon) && (clock || hourOnly) && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return null;
  if (!hasDay && !clock && !hourOnly && !afternoon && !evening && !noon && !morning) return null;
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
  return /^0(5[0-9]|7[0-9])[0-9]{7}$/.test(digits) ? digits : null;
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

export function buildTechnolineCallbackBody(env: Env, phone: string, requestId: string, now: Date, demo = false) {
  const retryAt = new Date(now.getTime() + 30 * 60000);
  const localNow = localDate(now);
  const localRetry = localDate(retryAt);
  const sameStretch = localNow.toISOString().slice(0, 10) === localRetry.toISOString().slice(0, 10)
    && nextCallingSlot(now).getTime() === now.getTime()
    && nextCallingSlot(retryAt).getTime() === retryAt.getTime();
  return {
    action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY, phones: [phone],
    title: "SpeakCall callback", messagesType: "extensionActivation",
    extensionActivation: env.TLIVR_CALLBACK_EXTENSION_ID,
    dialRetries: sameStretch ? 2 : 0, betweenRetries: 15, reasonableHours: "yes",
    externalID: requestId, ...(demo ? { demo: "yes" } : {}),
  };
}

export async function dialTechnolineCallback(env: Env, phone: string, requestId: string, demo = false) {
  if (!env.TLIVR_SYSTEM_API_KEY) throw new HttpError(503, "Technoline dialer not configured");
  const extension = await resolveCallbackExtension(env);
  const response = await fetch("https://api.tlivr.com/campaignApi.php", {
    method: "POST",
    headers: { "User-Agent": "speakcall-callbacks/1.0", "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify(buildTechnolineCallbackBody({ ...env, TLIVR_CALLBACK_EXTENSION_ID: extension.id }, phone, requestId, new Date(), demo)),
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
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) throw new HttpError(413, "Request too large");
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, "Invalid request");
  const body = parsed.data;
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(422, "Invalid phone");
  const time = Date.now();
  const now = nowIso();
  const preferred = body.preferred_at ? new Date(body.preferred_at) : null;
  if (preferred && (preferred.getTime() < Date.parse(now) || preferred.getTime() > Date.parse(now) + 30 * 86400000)) throw new HttpError(422, "Invalid preferred_at");
  const scheduled = body.timing === "now" ? new Date(now) : preferred ?? parsePreferredTime(body.preferred_time, new Date(now)) ?? new Date(now);
  const nextAttempt = nextCallingSlot(scheduled).toISOString();
  const recent = await env.DB.prepare("SELECT id FROM callback_requests WHERE phone=? AND created_at>? LIMIT 1")
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
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function listCallbacks(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    "SELECT id,phone,name,for_whom,goal,timing,preferred_time,source,status,attempts,last_error,created_at,updated_at,next_attempt_at FROM callback_requests ORDER BY created_at DESC LIMIT 200",
  ).all();
  return { items: results, dialer_configured: !!(env.CALLBACK_RELAY_URL && env.CALLBACK_RELAY_SECRET) || !!env.TLIVR_SYSTEM_API_KEY };
}

export async function dispatchCallbacks(env: Env): Promise<Record<string, unknown>> {
  const useRelay = !!env.CALLBACK_RELAY_URL && !!env.CALLBACK_RELAY_SECRET;
  if (!useRelay && !env.TLIVR_SYSTEM_API_KEY) return { skipped: "dialer not configured" };
  const provider = useRelay ? "relay" : "technoline";
  const now = new Date();
  await env.DB.prepare("UPDATE callback_requests SET status='queued',next_attempt_at=?,updated_at=? WHERE status='dialing' AND updated_at<?")
    .bind(now.toISOString(), now.toISOString(), new Date(now.getTime() - 15 * 60000).toISOString()).run();
  if (nextCallingSlot(now).getTime() !== now.getTime()) return { skipped: "outside calling hours" };
  const { results } = await env.DB.prepare(
    "SELECT id,phone,attempts FROM callback_requests WHERE status='queued' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 20",
  ).bind(now.toISOString()).all<{ id: string; phone: string; attempts: number }>();
  let sent = 0;
  for (const item of results) {
    const claimed = await env.DB.prepare("UPDATE callback_requests SET status='dialing',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' AND next_attempt_at<=? AND attempts=?")
      .bind(nowIso(), item.id, now.toISOString(), item.attempts).run();
    if (claimed.meta.changes !== 1) continue;
    try {
      let ok: boolean;
      let providerRef: string | null;
      let lastError: string;
      if (useRelay) {
        const response = await fetch(env.CALLBACK_RELAY_URL!, {
          method: "POST",
          headers: { Authorization: "Bearer " + env.CALLBACK_RELAY_SECRET, "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: item.id, phone: item.phone }),
        });
        const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        ok = response.ok && result.ok === true;
        providerRef = ok ? String(result.campaign_id ?? "") : null;
        lastError = "relay " + response.status;
      } else {
        const result = await dialTechnolineCallback(env, item.phone, item.id);
        ok = result.ok;
        providerRef = ok ? String(result.campaignId ?? "") : null;
        lastError = "technoline " + (result.errorCode || result.httpStatus);
      }
      const failure = callbackFailure(item.attempts + 1, new Date());
      await env.DB.prepare("UPDATE callback_requests SET status=?,provider_ref=?,last_error=?,updated_at=?,next_attempt_at=? WHERE id=?")
        .bind(ok ? "dialed" : failure.status, providerRef, ok ? null : lastError, nowIso(), ok ? null : failure.nextAttemptAt, item.id).run();
      if (ok) sent++;
    } catch {
      const failure = callbackFailure(item.attempts + 1, new Date());
      await env.DB.prepare("UPDATE callback_requests SET status=?,last_error=?,updated_at=?,next_attempt_at=? WHERE id=?")
        .bind(failure.status, provider + " unreachable", nowIso(), failure.nextAttemptAt, item.id).run();
    }
  }
  return { sent, queued: results.length };
}
