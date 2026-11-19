import { z } from "zod";
import { conversion } from "./analytics";
import { BusinessStore } from "./business";
import { type Env, HttpError, nowIso, randomHex, secureEqual, sha256Hex, tokenUrlsafe } from "./env";
import { learnerBody } from "./learner";
import { sendPortalCode } from "./portal-email";

const prefix = "portal-email:";
const invalidCode = "הקוד שגוי, פג תוקפו או שנוצלו חמשת הניסיונות. אפשר לבקש קוד חדש.";

export async function emailAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith("/v1/portal/auth/email/")) return null;
  if (request.method !== "POST") throw new HttpError(405, "יש לשלוח את הפרטים מהטופס.");
  const b = new BusinessStore(env.DB);
  const headers = { "Cache-Control": "no-store" };
  if (path === "/v1/portal/auth/email/start") {
    const input = await learnerBody(request, z.object({ email: z.string().trim().toLowerCase().max(254).email() }));
    const emailHash = await sha256Hex(input.email);
    const ipHash = await sha256Hex(request.headers.get("CF-Connecting-IP") || "local");
    const now = nowIso();
    for (const [key, limit] of [
      [`portal-email:email:${emailHash}:${now.slice(0, 16)}`, 1],
      [`portal-email:email:${emailHash}:${now.slice(0, 13)}`, 10],
      [`portal-email:ip:${ipHash}:${now.slice(0, 13)}`, 40],
      [`portal-email:day:${now.slice(0, 10)}`, 1000],
    ] as const) {
      if (!await b.consumeMonthlyQuota(key, limit)) throw new HttpError(429, "נשלחו יותר מדי בקשות. המתינו דקה ונסו שוב.");
    }
    const challenge = randomHex(24);
    let value: number;
    do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
    const code = String(value % 1000000).padStart(6, "0");
    await b.putSetting(prefix + challenge, { email: input.email, hash: await sha256Hex(challenge + ":" + code), attempts: 0, expires: Date.now() + 600000 });
    try { await sendPortalCode(env, input.email, code); }
    catch {
      await env.DB.prepare("DELETE FROM console_settings WHERE id=?").bind(prefix + challenge).run();
      throw new HttpError(503, "לא הצלחנו לשלוח את המייל. המתינו דקה ונסו שוב.");
    }
    return Response.json({ challenge, expires_in: 600, retry_after: 60 }, { headers });
  }
  if (path === "/v1/portal/auth/email/verify") {
    const input = await learnerBody(request, z.object({ challenge: z.string().regex(/^[a-f0-9]{48}$/), code: z.string().regex(/^\d{6}$/), attribution: z.unknown().optional() }));
    const key = prefix + input.challenge;
    const row = await env.DB.prepare(`UPDATE console_settings SET body=json_set(body,'$.attempts',json_extract(body,'$.attempts')+1)
      WHERE id=? AND json_extract(body,'$.attempts')<5 AND json_extract(body,'$.expires')>?
      RETURNING body`).bind(key, Date.now()).first<{ body: string }>();
    const claim = row ? JSON.parse(row.body) : null;
    if (!claim || !secureEqual(await sha256Hex(input.challenge + ":" + input.code), claim.hash)) throw new HttpError(401, invalidCode);
    if (!await env.DB.prepare("DELETE FROM console_settings WHERE id=? RETURNING id").bind(key).first()) throw new HttpError(401, invalidCode);
    const existing = await env.DB.prepare("SELECT id FROM console_records WHERE kind='customers' AND lower(trim(json_extract(body,'$.email')))=? ORDER BY created_at,id LIMIT 1").bind(claim.email).first<{ id: string }>();
    const customerId = existing?.id || "email-" + await sha256Hex(claim.email);
    if (!existing) {
      const now = nowIso();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO console_records VALUES ('customers',?,?,?,?)").bind(customerId, JSON.stringify({ name: "", phone: "", email: claim.email, source: "portal", preferred_bot: "", notes: "" }), now, now),
        env.DB.prepare("INSERT OR IGNORE INTO customers(id,name,source,created_at,updated_at) VALUES (?,'','portal',?,?)").bind(customerId, now, now),
      ]);
    }
    const token = tokenUrlsafe(32);
    await env.DB.prepare("INSERT INTO portal_tokens VALUES (?,?,?)").bind(await sha256Hex(token), customerId, new Date(Date.now() + 7 * 86400000).toISOString().replace("Z", "+00:00")).run();
    if (!existing) await conversion(env, "sign_up", input.attribution, customerId, customerId).catch(error => console.error("Analytics signup failed", error));
    return Response.json({ token, new_account: !existing }, { headers });
  }
  throw new HttpError(404, "Not found");
}
