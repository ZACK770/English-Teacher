import { z } from "zod";
import { type Env, HttpError, sha256Hex } from "./env";
import { qaCustomerSql } from "./qa-customers";

const short = z.string().max(200);
const path = z.string().max(500).regex(/^\/[^?#]*$/);
const touch = z.object({
  utm_source: short.optional(), utm_medium: short.optional(), utm_campaign: short.optional(),
  utm_content: short.optional(), utm_term: short.optional(), gclid: short.optional(), fbclid: short.optional(),
  campaign: short.optional(), referrer: z.string().max(500), landing_path: path, ts: z.string().datetime(),
}).strict();
export const AttributionSchema = z.object({
  visitor_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/), session_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  path, referrer: z.string().max(500), first_touch: touch, last_touch: touch,
}).strict();
export type Attribution = z.infer<typeof AttributionSchema>;
export const EventSchema = z.object({
  event: z.enum(["page_view", "phone_click", "generate_lead", "sign_up", "begin_checkout", "purchase"]),
  attribution: AttributionSchema,
  event_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  value: z.number().finite().min(0).max(1000000).optional(), currency: z.literal("ILS").optional(),
  reference: z.string().max(100).optional(),
  meta: z.object({ method: z.enum(["phone", "email"]).optional() }).strict().optional(),
}).strict();

export async function analyticsInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(422, "Invalid event");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12000) { await reader.cancel(); throw new HttpError(413, "Event too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(422, "Invalid event"); }
}

export function eventStatement(env: Env, event: string, a: Attribution, id: string, origin: "client" | "server", reference?: string, customer?: string, value?: number, meta = {}, orderId?: string) {
  return env.DB.prepare(`INSERT OR IGNORE INTO analytics_events
    (id,event,ts,origin,visitor_id,session_id,path,referrer,first_touch,last_touch,value,currency,customer_id,reference,meta,order_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, event, new Date().toISOString(), origin, a.visitor_id, a.session_id,
    a.path, a.referrer, JSON.stringify(a.first_touch), JSON.stringify(a.last_touch), value ?? null,
    value === undefined ? null : "ILS", customer ?? null, reference ?? null, JSON.stringify(meta), orderId ?? (event === "begin_checkout" ? reference ?? null : null));
}

export async function ingestEvent(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Invalid origin");
  const parsed = EventSchema.safeParse(await analyticsInput(request));
  if (!parsed.success) throw new HttpError(422, "Invalid event");
  const now = new Date().toISOString();
  const ip = await sha256Hex(request.headers.get("CF-Connecting-IP") || "local");
  const key = now.slice(0, 16) + ":" + ip;
  await env.DB.prepare("DELETE FROM analytics_rate_limits WHERE expires<?").bind(now).run();
  const quota = await env.DB.prepare(`INSERT INTO analytics_rate_limits(key,expires,count) VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<120 RETURNING count`)
    .bind(key, new Date(Date.now() + 120000).toISOString()).first();
  if (!quota) throw new HttpError(429, "Too many events");
  const e = parsed.data;
  await eventStatement(env, e.event, e.attribution, "client:" + e.event_id, "client", e.reference, undefined, e.value, e.meta).run();
  return new Response(null, { status: 204 });
}

export async function conversion(env: Env, event: string, attribution: unknown, reference: string, customer?: string, value?: number, orderId?: string) {
  const parsed = AttributionSchema.safeParse(attribution);
  if (!parsed.success) return;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO analytics_attribution(kind,reference,attribution) VALUES (?,?,?)")
      .bind(event, reference, JSON.stringify(parsed.data)),
    eventStatement(env, event, parsed.data, `server:${event}:${reference}`, "server", reference, customer, value, {}, orderId),
  ]);
}

export async function purchaseAttribution(env: Env, receiptId: unknown) {
  if (typeof receiptId !== "string") return;
  const row = await env.DB.prepare(`SELECT r.id,r.customer_id,r.amount_ils,o.id AS order_id,a.attribution FROM sales_receipts r
    JOIN payment_orders o ON o.receipt_id=r.id OR o.id=(
      SELECT s.first_order_id FROM standing_orders s WHERE s.entitlement_id=r.subscription_id LIMIT 1)
    JOIN analytics_attribution a ON a.kind='begin_checkout' AND a.reference=o.id WHERE r.id=?`)
    .bind(receiptId).first<{ id: string; customer_id: string; amount_ils: number; order_id: string; attribution: string }>();
  if (row) await conversion(env, "purchase", JSON.parse(row.attribution), row.id, row.customer_id, row.amount_ils, row.order_id).catch(error => console.error("Analytics purchase failed", error));
}

export async function analyticsSummary(request: Request, env: Env) {
  const query = new URL(request.url).searchParams;
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
  const start = query.get("start") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end = query.get("end") || new Date().toISOString().slice(0, 10);
  if (!date.safeParse(start).success || !date.safeParse(end).success || start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new HttpError(422, "Invalid date range (maximum 366 days)");
  const rows = (await env.DB.prepare(`WITH attributed AS (
    SELECT e.*,COALESCE(e.customer_id,(SELECT customer_id FROM payment_orders WHERE id=e.order_id),
      (SELECT customer_id FROM payment_orders WHERE id=e.reference)) AS owner_id
    FROM analytics_events e
  ) SELECT
    COALESCE(NULLIF(json_extract(first_touch,'$.utm_source'),''),'direct') AS utm_source,
    COALESCE(NULLIF(json_extract(first_touch,'$.utm_campaign'),''),NULLIF(json_extract(first_touch,'$.campaign'),''),'(none)') AS utm_campaign,
    COUNT(DISTINCT visitor_id) AS visitors,
    COUNT(DISTINCT CASE WHEN origin='server' AND event='generate_lead' THEN reference END) AS leads,
    COUNT(DISTINCT CASE WHEN origin='server' AND event='sign_up' THEN reference END) AS signups,
    COUNT(DISTINCT CASE WHEN origin='server' AND event='begin_checkout' THEN reference END) AS checkouts,
    COUNT(DISTINCT CASE WHEN origin='server' AND event='purchase' THEN reference END) AS purchases,
    COALESCE(SUM(CASE WHEN origin='server' AND event='purchase' THEN value ELSE 0 END),0) AS revenue
    FROM attributed e WHERE ts>=? AND ts<?
    AND NOT ${qaCustomerSql("e.owner_id")}
    AND (e.owner_id IS NOT NULL OR e.visitor_id NOT IN (SELECT visitor_id FROM attributed identified WHERE ${qaCustomerSql("identified.owner_id")}))
    GROUP BY 1,2 ORDER BY visitors DESC LIMIT 500`)
    .bind(start + "T00:00:00.000Z", new Date(Date.parse(end) + 86400000).toISOString()).all<Record<string, string | number>>()).results;
  return Response.json({ start, end, currency: "ILS", rows: rows.map(r => ({ ...r,
    lead_rate: Number(r.leads) / Number(r.visitors), signup_rate: Number(r.signups) / Number(r.visitors),
    checkout_rate: Number(r.checkouts) / Number(r.visitors), purchase_rate: Number(r.purchases) / Number(r.visitors),
  })) }, { headers: { "Cache-Control": "no-store" } });
}
