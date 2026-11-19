import { z } from "zod";
import { BusinessStore } from "./business";
import { type Env, HttpError, nowIso, randomHex, secureEqual, sha256Hex, tokenUrlsafe } from "./env";
import { learnerBody, requireLearner } from "./learner";
import { sendPortalCode } from "./portal-email";

const prefix = "portal-email:";
const invalidCode = "הקוד שגוי, פג תוקפו או שנוצלו חמשת הניסיונות. אפשר לבקש קוד חדש.";
const conflict = "הפרט הזה כבר מחובר לחשבון אחר. אפשר להיכנס דרכו או לפנות לתמיכה.";
const emailLookup = "SELECT id FROM console_records WHERE kind='customers' AND lower(trim(json_extract(body,'$.email')))=?";

async function emailOwner(db: D1Database, email: string, linkCustomer?: string): Promise<string> {
  const now = nowIso();
  if (linkCustomer) {
    const linked = await db.prepare(`UPDATE console_records SET body=json_set(body,'$.email',?), updated_at=?
      WHERE kind='customers' AND id=? AND COALESCE(lower(trim(json_extract(body,'$.email'))),'') IN ('',?)
        AND NOT EXISTS (SELECT 1 FROM (${emailLookup}) WHERE id<>?)
      RETURNING id`).bind(email, now, linkCustomer, email, email, linkCustomer).first<{ id: string }>();
    if (!linked) throw new HttpError(409, conflict);
    return linked.id;
  }
  const emailCustomer = "email-" + randomHex(16);
  await db.batch([
    db.prepare(`INSERT INTO console_records(kind,id,body,created_at,updated_at)
      SELECT 'customers',?,?,?,? WHERE NOT EXISTS (${emailLookup})`)
      .bind(emailCustomer, JSON.stringify({ name: "", phone: "", email, source: "portal", preferred_bot: "", notes: "" }), now, now, email),
    db.prepare(`INSERT INTO customers(id,name,source,created_at,updated_at)
      SELECT ?,'','portal',?,? WHERE EXISTS (SELECT 1 FROM console_records WHERE kind='customers' AND id=?)`)
      .bind(emailCustomer, now, now, emailCustomer),
  ]);
  const owner = await db.prepare(emailLookup + " ORDER BY created_at,id LIMIT 1").bind(email).first<{ id: string }>();
  if (!owner) throw new HttpError(503, "לא הצלחנו לחבר את המייל. אפשר לנסות שוב.");
  return owner.id;
}

export async function emailAuth(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith("/v1/portal/auth/email/")) return null;
  if (request.method !== "POST") throw new HttpError(405, "יש לשלוח את הפרטים מהטופס.");
  const b = new BusinessStore(env.DB);
  const headers = { "Cache-Control": "no-store" };
  if (path === "/v1/portal/auth/email/start") {
    const input = await learnerBody(request, z.object({
      email: z.string().trim().toLowerCase().max(254).email(),
      purpose: z.enum(["login", "link_email"]).default("login"),
    }));
    const linkCustomer = input.purpose === "link_email" ? await requireLearner(request, env) : undefined;
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
    await b.putSetting(prefix + challenge, { email: input.email, linkCustomer, hash: await sha256Hex(challenge + ":" + code), attempts: 0, expires: Date.now() + 600000 });
    try { await sendPortalCode(env, input.email, code); }
    catch {
      await env.DB.prepare("DELETE FROM console_settings WHERE id=?").bind(prefix + challenge).run();
      throw new HttpError(503, "לא הצלחנו לשלוח את המייל. המתינו דקה ונסו שוב.");
    }
    return Response.json({ challenge, expires_in: 600, retry_after: 60 }, { headers });
  }
  if (path === "/v1/portal/auth/email/verify") {
    const input = await learnerBody(request, z.object({ challenge: z.string().regex(/^[a-f0-9]{48}$/), code: z.string().regex(/^\d{6}$/) }));
    const key = prefix + input.challenge;
    const row = await env.DB.prepare(`UPDATE console_settings SET body=json_set(body,'$.attempts',json_extract(body,'$.attempts')+1)
      WHERE id=? AND json_extract(body,'$.attempts')<5 AND json_extract(body,'$.expires')>?
      RETURNING body`).bind(key, Date.now()).first<{ body: string }>();
    const claim = row ? JSON.parse(row.body) : null;
    if (!claim || !secureEqual(await sha256Hex(input.challenge + ":" + input.code), claim.hash)) throw new HttpError(401, invalidCode);
    if (claim.linkCustomer && await requireLearner(request, env) !== claim.linkCustomer) throw new HttpError(403, "הקוד שייך לחשבון אחר.");
    if (!await env.DB.prepare("DELETE FROM console_settings WHERE id=? RETURNING id").bind(key).first()) throw new HttpError(401, invalidCode);
    const customerId = await emailOwner(env.DB, claim.email, claim.linkCustomer);
    if (claim.linkCustomer) return Response.json({ linked: true }, { headers });
    const token = tokenUrlsafe(32);
    const issued = await env.DB.prepare(`INSERT INTO portal_tokens
      SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM (${emailLookup}) WHERE id=?) RETURNING customer_id`)
      .bind(await sha256Hex(token), customerId, new Date(Date.now() + 7 * 86400000).toISOString().replace("Z", "+00:00"), claim.email, customerId).first();
    if (!issued) throw new HttpError(401, invalidCode);
    return Response.json({ token }, { headers });
  }
  throw new HttpError(404, "Not found");
}
