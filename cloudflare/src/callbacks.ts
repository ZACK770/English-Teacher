import { z } from "zod";
import { type Env, HttpError, nowIso, randomHex } from "./env";

const RequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20),
  for_whom: z.enum(["self", "daughter", "son", "other"]),
  goal: z.string().trim().max(300).default(""),
  timing: z.enum(["now", "scheduled"]),
  preferred_time: z.string().trim().max(80).default(""),
  consent: z.literal(true),
  source: z.string().trim().max(40).regex(/^[a-z0-9_-]*$/).default(""),
  website: z.string().max(0).default(""),
});

export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+972")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return /^0(5[0-9]|7[0-9])[0-9]{7}$/.test(digits) ? digits : null;
}

export async function submitCallback(request: Request, env: Env): Promise<Response> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) throw new HttpError(413, "Request too large");
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, "Invalid request");
  const body = parsed.data;
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(422, "Invalid phone");
  const recent = await env.DB.prepare("SELECT id FROM callback_requests WHERE phone=? AND created_at>? LIMIT 1")
    .bind(phone, new Date(Date.now() - 86400000).toISOString()).first<{ id: string }>();
  if (recent) return Response.json({ ok: true, id: recent.id, duplicate: true });
  const id = randomHex(16);
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO callback_requests (id,phone,name,for_whom,goal,timing,preferred_time,source,consent_at,status,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'queued',0,?,?)",
  ).bind(id, phone, body.name, body.for_whom, body.goal, body.timing, body.preferred_time || null, body.source || "landing", now, now, now).run();
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function listCallbacks(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    "SELECT id,phone,name,for_whom,goal,timing,preferred_time,source,status,attempts,last_error,created_at,updated_at FROM callback_requests ORDER BY created_at DESC LIMIT 200",
  ).all();
  return { items: results, dialer_configured: !!env.CALLBACK_RELAY_URL && !!env.CALLBACK_RELAY_SECRET };
}

export async function dispatchCallbacks(env: Env): Promise<Record<string, unknown>> {
  if (!env.CALLBACK_RELAY_URL || !env.CALLBACK_RELAY_SECRET) return { skipped: "dialer not configured" };
  const { results } = await env.DB.prepare(
    "SELECT id,phone FROM callback_requests WHERE status='queued' AND timing='now' AND created_at>? ORDER BY created_at LIMIT 20",
  ).bind(new Date(Date.now() - 6 * 3600000).toISOString()).all<{ id: string; phone: string }>();
  let sent = 0;
  for (const item of results) {
    const claimed = await env.DB.prepare("UPDATE callback_requests SET status='dialing',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'")
      .bind(nowIso(), item.id).run();
    if (claimed.meta.changes !== 1) continue;
    try {
      const response = await fetch(env.CALLBACK_RELAY_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + env.CALLBACK_RELAY_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: item.id, phone: item.phone }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const ok = response.ok && result.ok === true;
      await env.DB.prepare("UPDATE callback_requests SET status=?,provider_ref=?,last_error=?,updated_at=? WHERE id=?")
        .bind(ok ? "dialed" : "failed", ok ? String(result.campaign_id ?? "") : null, ok ? null : "relay " + response.status, nowIso(), item.id).run();
      if (ok) sent++;
    } catch {
      await env.DB.prepare("UPDATE callback_requests SET status='failed',last_error='relay unreachable',updated_at=? WHERE id=?").bind(nowIso(), item.id).run();
    }
  }
  return { sent, queued: results.length };
}
