import { z } from "zod";
import { BusinessStore, normalizedPhone } from "./business";
import { type Env, HttpError, nowIso, randomHex, secureEqual, sha256Hex, tokenUrlsafe } from "./env";
import { learnerBody, requireLearner } from "./learner";
import { emailAuth } from "./email-auth";

export function cleanupPortalAuth(env: Env) {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  return env.DB.batch([
    env.DB.prepare("DELETE FROM console_settings WHERE (id LIKE 'portal-auth:%' OR id LIKE 'voice-ticket:%' OR id LIKE 'portal-email:%') AND json_extract(body,'$.expires')<?").bind(now),
    env.DB.prepare("DELETE FROM api_quota WHERE api LIKE 'portal-email:%' AND month<?").bind(iso.slice(0, 7)),
    env.DB.prepare(`DELETE FROM api_quota WHERE
      (api GLOB 'portal-ring:day:????-??-??' AND substr(api,-10)<?) OR
      (api GLOB 'portal-ring:*:????-??-??T??' AND substr(api,-13)<?) OR
      (api GLOB 'portal-ring:*:????-??-??T??:??' AND substr(api,-16)<?)`)
      .bind(iso.slice(0, 10), iso.slice(0, 13), iso.slice(0, 16)),
  ]);
}

// Technoline's documented caller-ID verification action; never modifies the PBX tree.
async function ring(env: Env, phone: string, code: string) {
  const url = new URL("https://api.tlivr.com/ivrFilesApi.php");
  url.searchParams.set("action", "makeCall");
  if (env.TLIVR_SYSTEM_API_KEY) url.searchParams.set("apiKey", env.TLIVR_SYSTEM_API_KEY);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ phone, cid: code, mode: "cid" }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null) as { status?: string; errorCode?: string } | null;
  return { ok: response.ok && result?.status?.toUpperCase() === "OK" && String(result.errorCode) === "0", http: response.status, code: result?.errorCode || "" };
}

export async function phoneAuthStatus(env: Env) {
  const result = await ring(env, "invalid", "000000");
  return { available: result.http === 200 && ["1", "3"].includes(String(result.code)), provider_http: result.http, provider_code: result.code };
}

export async function portalAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  const email = await emailAuth(request, env, path);
  if (email) return email;
  if (!path.startsWith("/v1/portal/auth/")) return null;
  if (request.method !== "POST") throw new HttpError(405, "יש לשלוח את הפרטים מהטופס.");
  const b = new BusinessStore(env.DB);
  const noCache = { "Cache-Control": "no-store" };
  if (path === "/v1/portal/auth/start") {
    const input = await learnerBody(request, z.object({ phone: z.string().max(30), purpose: z.enum(["login", "link_phone"]).default("login") }));
    const linkCustomer = input.purpose === "link_phone" ? await requireLearner(request, env) : null;
    let phone: string;
    try { phone = normalizedPhone(input.phone); } catch { throw new HttpError(422, "מה מספר הטלפון שלך? כדאי לבדוק שלא חסרה ספרה."); }
    if (!/^0[2-9]\d{7,8}$/.test(phone)) throw new HttpError(422, "כרגע אפשר להתחבר עם מספר טלפון ישראלי.");
    const phoneHash = (await sha256Hex(phone)).slice(0, 24);
    const ipHash = (await sha256Hex(request.headers.get("CF-Connecting-IP") || "local")).slice(0, 24);
    const hour = nowIso().slice(0, 13), minute = nowIso().slice(0, 16);
    const quotas = [
      [`portal-ring:phone:${phoneHash}:${minute}`, 1],
      [`portal-ring:phone:${phoneHash}:${hour}`, 10],
      [`portal-ring:ip:${ipHash}:${hour}`, 40],
      [`portal-ring:day:${hour.slice(0, 10)}`, 1000],
    ] as const;
    for (const [key, limit] of quotas) {
      if (!await b.consumeMonthlyQuota(key, limit)) throw new HttpError(429, "כבר שלחנו צלצול. נחכה קצת ואז ננסה שוב.");
    }
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const challenge = randomHex(24);
    await b.putSetting("portal-auth:" + challenge, { phone, linkCustomer, hash: await sha256Hex(challenge + ":" + code), attempts: 0, expires: Date.now() + 300000 });
    let sent = false;
    try { sent = (await ring(env, phone, code)).ok; } catch { /* Provider details must stay server-side. */ }
    if (!sent) {
      await Promise.all(quotas.slice(1).map(([key]) => b.refundMonthlyQuota(key, hour.slice(0, 7))));
      await env.DB.prepare("DELETE FROM console_settings WHERE id=?").bind("portal-auth:" + challenge).run();
      throw new HttpError(503, "הכניסה בצלצול לא זמינה כרגע. אפשר להיכנס עם הקישור האישי שקיבלת.");
    }
    return Response.json({ challenge, expires_in: 300 }, { headers: noCache });
  }
  if (path === "/v1/portal/auth/verify") {
    const input = await learnerBody(request, z.object({ challenge: z.string().regex(/^[a-f0-9]{48}$/), code: z.string().regex(/^\d{6}$/) }));
    const key = "portal-auth:" + input.challenge;
    const row = await env.DB.prepare(`UPDATE console_settings SET body=json_set(body,'$.attempts',json_extract(body,'$.attempts')+1)
      WHERE id=? AND json_extract(body,'$.attempts')<5 AND json_extract(body,'$.expires')>?
      RETURNING body`).bind(key, Date.now()).first<{ body: string }>();
    const challenge = row ? JSON.parse(row.body) : null;
    if (!challenge || !secureEqual(await sha256Hex(input.challenge + ":" + input.code), challenge.hash)) throw new HttpError(401, "הספרות לא מתאימות, או שעברו חמש דקות. נבדוק וננסה שוב?");
    if (challenge.linkCustomer && await requireLearner(request, env) !== challenge.linkCustomer) throw new HttpError(403, "הצלצול שייך לחשבון אחר.");
    const consumed = await env.DB.prepare("DELETE FROM console_settings WHERE id=? RETURNING id").bind(key).first();
    if (!consumed) throw new HttpError(401, "הצלצול הזה כבר שימש לכניסה. אפשר לבקש צלצול חדש.");
    const owner = await b.customerForPhone(challenge.phone);
    const existing = owner ? { customer_id: owner } : null;
    if (challenge.linkCustomer) {
      if (owner && owner !== challenge.linkCustomer) throw new HttpError(409, "למספר הזה כבר יש חשבון משלו. לחיבור החשבונות כדאי לפנות לשירות.");
      const links = await env.DB.prepare("SELECT COUNT(*) AS n FROM console_records WHERE kind='learner-phone-links' AND json_extract(body,'$.customer_id')=?").bind(challenge.linkCustomer).first<{ n: number }>();
      if ((links?.n || 0) >= 4 && !owner) throw new HttpError(422, "אפשר לחבר עד ארבעה מספרים נוספים.");
      if (!owner) await b.save("learner-phone-links", { phone: challenge.phone, customer_id: challenge.linkCustomer }, (await sha256Hex(challenge.phone)).slice(0, 24));
      return Response.json({ linked: true }, { headers: noCache });
    }
    const customerId = existing?.customer_id || "tel-" + (await sha256Hex(challenge.phone)).slice(0, 24);
    if (!existing) await b.save("customers", { name: "לקוח מהטלפון", phone: challenge.phone, source: "portal", preferred_bot: "", notes: "" }, customerId);
    const token = tokenUrlsafe(32);
    await env.DB.prepare("INSERT INTO portal_tokens VALUES (?,?,?)").bind(await sha256Hex(token), customerId, new Date(Date.now() + 7 * 86400000).toISOString().replace("Z", "+00:00")).run();
    return Response.json({ token }, { headers: noCache });
  }
  throw new HttpError(404, "Not found");
}
