import { BusinessStore } from "./business";
import { fromLocal, localDate, nextCallingSlot, normalizePhone } from "./callbacks";
import { type Env, HttpError, nowIso } from "./env";
import { PaymentStore, paymentResponse } from "./payments";
import { SCHOOL_FREE_POLICY } from "../../src/pricing";
import { isQaCustomer, qaCustomerSql } from "./qa-customers";

export const SALES_EXTENSION_PATH = "/3";
export const SALES_OFFER_RECORDING = "sales-offer-month20-22a3e286bc65.wav";
export const SALES_OFFER_TEXT = "רוצים לדעת אנגלית?! רגע לפני שנפרדים. רק היום, ורק בשיחה הזאת: חודש ראשון בספיקול בעשרים שקלים בלבד. כן, עשרים שקלים! אנחנו מציעים את זה רק עכשיו, כי אנחנו בטוחים שאחרי כמה אימונים תרגישו את ההבדל בעצמכם. בחודש הזה תקבלו שלושה אימונים של עשר דקות עם המורה. להצטרפות עכשיו בכרטיס אשראי הקישו 1. לשאר המנויים הקישו 2. לסיום הקישו 0.";
export const OFFER_GUIDANCE = 'This is a short next-day follow-up practice call from SpeakCall after the learner’s trial. Speak Hebrew for guidance. Greet warmly by name if known: "שלום, כאן ספיקול, חזרנו לתרגול קצר". Do a short English practice. Close politely and warmly, not abruptly, and say a short special message follows. Never take card details or quote prices.';

export function salesOfferAllowed(env: Env, phone: string): boolean {
  const normalized = normalizePhone(phone);
  return !!normalized && (env.SALES_OFFER_MODE === "on" || env.SALES_OFFER_MODE === "allowlist" &&
    (env.SALES_OFFER_ALLOWLIST ?? "").split(",").some(p => normalizePhone(p.trim()) === normalized));
}

const phoneList = (value = "") => value.split(",").map(p => normalizePhone(p.trim())).filter((p): p is string => !!p);
export function salesOfferTestPhone(env: Env, phone: string): boolean {
  const normalized = normalizePhone(phone);
  return !!normalized && salesOfferAllowed(env, normalized) && phoneList(env.SALES_OFFER_TEST_PHONES).includes(normalized);
}

const buyerSql = (customer: string, at: string) => `(
  EXISTS(SELECT 1 FROM payment_orders WHERE customer_id=${customer} AND state='paid')
  OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.status='active' AND (s.customer_id=${customer} OR EXISTS(
    SELECT 1 FROM subscription_members m WHERE m.subscription_id=s.id AND m.customer_id=${customer} AND m.removed_at IS NULL)))
  OR EXISTS(SELECT 1 FROM sales_receipts r WHERE (r.customer_id=${customer} OR r.subscription_id IN (
    SELECT m.subscription_id FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id
    WHERE m.customer_id=${customer} AND m.removed_at IS NULL AND s.status IN ('active','cancelled','past_due')))
    AND julianday(r.expires_at)>julianday(${at}) AND (r.valid_from IS NULL OR julianday(r.valid_from)<=julianday(${at}))
    AND r.payment_reversed_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=r.subscription_id AND (s.status='paused' OR s.access_suspended_at IS NOT NULL))
    AND NOT EXISTS(SELECT 1 FROM standing_orders o WHERE (o.state='past_due' OR o.last_refusal_at IS NOT NULL)
      AND (o.entitlement_id=r.subscription_id OR (o.entitlement_id IS NULL AND o.first_order_id IN (SELECT id FROM payment_orders WHERE receipt_id=r.id))))
    AND r.minutes*60-COALESCE((SELECT SUM(COALESCE(billed_seconds,reserved_seconds)) FROM usage_allocations WHERE receipt_id=r.id),0)>=1)
)`;

export const QUOTA_EXHAUSTED_CANDIDATES_SQL = `WITH
  school_policies AS (
    SELECT body,updated_at FROM console_records
    WHERE kind='policies' AND COALESCE(json_extract(body,'$.product'),'school')='school'
  ),
  policy AS (
    SELECT COALESCE(json_extract(body,'$.trial_total_seconds'),0) AS trial_seconds,
      COALESCE(json_extract(body,'$.free_calls_month'),0) AS free_calls,
      COALESCE(json_extract(body,'$.opening_seconds'),0) AS opening_seconds
    FROM (SELECT body FROM school_policies WHERE json_extract(body,'$.enabled')=1 ORDER BY updated_at DESC LIMIT 1)
    UNION ALL SELECT 0,${SCHOOL_FREE_POLICY.free_calls_month},${SCHOOL_FREE_POLICY.opening_seconds}
      WHERE NOT EXISTS(SELECT 1 FROM school_policies)
  ),
  trial_usage AS (
    SELECT customer_id,
      SUM(COALESCE(billed_seconds,reserved_seconds)) AS trial_seconds,
      SUM(CASE WHEN product='school' AND created_at LIKE substr(?1,1,7)||'%'
        AND (billed_seconds IS NULL OR billed_seconds>0) THEN 1 ELSE 0 END) AS monthly_calls,
      MAX(CASE WHEN product='school-opening' AND (billed_seconds IS NULL OR billed_seconds>=60) THEN 1 ELSE 0 END) AS opening_used
    FROM usage_allocations
    WHERE (product='school-opening' OR (product='school' AND receipt_id IS NULL))
      AND (billed_seconds IS NULL OR billed_seconds>0)
    GROUP BY customer_id
  )
  SELECT u.customer_id,?1 AS dropped_at FROM trial_usage u CROSS JOIN policy p
  WHERE (p.trial_seconds>0 AND u.trial_seconds>=p.trial_seconds)
    OR (p.trial_seconds=0 AND u.monthly_calls>=p.free_calls AND (p.opening_seconds=0 OR u.opening_used=1))`;

export function offerSchedule(drop: Date) {
  const local = localDate(drop);
  local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(17, 0, 0, 0);
  const at = nextCallingSlot(fromLocal(local));
  const end = localDate(at);
  end.setUTCHours(23, 59, 59, 0);
  return { at: at.toISOString(), expires: fromLocal(end).toISOString() };
}

export async function customerBought(b: BusinessStore, customerId: string, now = nowIso()): Promise<boolean> {
  return !!await b.db.prepare(`SELECT 1 WHERE ${buyerSql("?1", "?2")}`).bind(customerId, now).first();
}

function scheduleAt(at: Date) {
  const end = localDate(at);
  end.setUTCHours(23, 59, 59, 0);
  return { at: at.toISOString(), expires: fromLocal(end).toISOString() };
}

async function queueOffer(b: BusinessStore, env: Env, customerId: string, phone: string, droppedAt: string, schedule: { at: string; expires: string }, now: Date) {
  if (await isQaCustomer(b.db, customerId)) return null;
  const test = salesOfferTestPhone(env, phone);
  if (!salesOfferAllowed(env, phone) || !test && await customerBought(b, customerId, now.toISOString())) return null;
  const id = test ? `sales-offer:test:${customerId}:${schedule.at}` : "sales-offer:" + customerId;
  const offer = { id, customer_id: customerId, phone, dropped_at: droppedAt, status: "queued", expires_at: schedule.expires, test };
  await b.db.batch([
    b.db.prepare(`INSERT OR IGNORE INTO console_records(kind,id,body,created_at,updated_at)
      SELECT 'sales-offers',?,?,?,? WHERE ?=1 OR NOT EXISTS(
        SELECT 1 FROM console_records WHERE kind='sales-offers' AND json_extract(body,'$.customer_id')=?)`)
      .bind(id, JSON.stringify(offer), now.toISOString(), now.toISOString(), test ? 1 : 0, customerId),
    b.db.prepare(`INSERT OR IGNORE INTO callback_requests(id,phone,name,for_whom,goal,timing,preferred_time,source,consent_at,status,attempts,created_at,updated_at,next_attempt_at)
      SELECT ?,?,'','self','Sales offer','scheduled',?,'sales_offer',?,'queued',0,?,?,?
      WHERE EXISTS(SELECT 1 FROM console_records WHERE kind='sales-offers' AND id=? AND json_extract(body,'$.status')='queued')`)
      .bind(id, phone, schedule.at, now.toISOString(), now.toISOString(), now.toISOString(), schedule.at, id),
  ]);
  return id;
}

export async function queueTestSalesOffer(env: Env, rawPhone: string, at: Date) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !salesOfferTestPhone(env, phone)) throw new HttpError(403, "Test phone not enabled");
  if (!Number.isFinite(+at) || +at < Date.now() || +nextCallingSlot(at) !== +at) throw new HttpError(422, "Invalid test calling time");
  const b = new BusinessStore(env.DB);
  const customerId = await b.customerForPhone(phone);
  if (!customerId) throw new HttpError(404, "Test customer not found");
  return queueOffer(b, env, customerId, phone, nowIso(), scheduleAt(at), new Date());
}

export async function selectSalesOffers(env: Env, now = new Date()) {
  if (!["on", "allowlist"].includes(env.SALES_OFFER_MODE ?? "")) return;
  const testAt = new Date(env.SALES_OFFER_TEST_AT ?? "");
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(env.SALES_OFFER_TEST_AT ?? "") && +testAt > +now) {
    for (const phone of new Set(phoneList(env.SALES_OFFER_TEST_PHONES))) {
      if (!salesOfferTestPhone(env, phone)) continue;
      try { await queueTestSalesOffer(env, phone, testAt); } catch {}
    }
  }
  const audience = env.SALES_OFFER_AUDIENCE ?? "dropoffs";
  if (!["dropoffs", "high_interest", "quota_exhausted"].includes(audience)) return;
  const minCalls = Number(env.SALES_OFFER_MIN_TUTOR_CALLS ?? 3);
  const minMinutes = Number(env.SALES_OFFER_MIN_TUTOR_MINUTES ?? 0);
  if (audience === "high_interest" && (env.SALES_OFFER_MIN_TUTOR_CALLS?.trim() === "" || env.SALES_OFFER_MIN_TUTOR_MINUTES?.trim() === "" ||
    !Number.isInteger(minCalls) || minCalls < 0 || !Number.isFinite(minMinutes) || minMinutes < 0)) return;
  const b = new BusinessStore(env.DB);
  const candidates = audience === "quota_exhausted" ? QUOTA_EXHAUSTED_CANDIDATES_SQL
    : audience === "high_interest" ? `SELECT COALESCE(c.customer_id,s.student_id) AS customer_id, ?1 AS dropped_at
    FROM sessions s LEFT JOIN call_customers c ON c.call_id=s.call_id
    LEFT JOIN prompt_snapshots p ON p.call_id=s.call_id
    JOIN bots b ON b.id=COALESCE(c.bot_id,p.profile_id) AND b.role='teacher'
    GROUP BY COALESCE(c.customer_id,s.student_id)
    HAVING COUNT(*)>=?2 AND SUM(MAX(0,s.duration_seconds))>=?3`
    : `SELECT json_extract(body,'$.customer_id') AS customer_id, MAX(created_at) AS dropped_at
      FROM console_records WHERE kind='ivr-events' AND json_extract(body,'$.route')='sales' AND created_at>?2 AND ?3=0
      GROUP BY json_extract(body,'$.customer_id')`;
  const { results } = await env.DB.prepare(`WITH candidates AS (${candidates})
    SELECT t.customer_id,t.dropped_at,ph.phone FROM candidates t JOIN customer_phones ph ON ph.customer_id=t.customer_id
    WHERE length(ph.phone) BETWEEN 8 AND 15 AND ph.phone NOT GLOB '*[^0-9]*' AND ph.phone GLOB '*[1-9]*'
    AND NOT ${qaCustomerSql("t.customer_id")}
    AND (?6='on' OR ph.phone IN (SELECT value FROM json_each(?5)))
    AND (ph.phone IN (SELECT value FROM json_each(?4)) OR (
      NOT ${buyerSql("t.customer_id", "?1")} AND NOT EXISTS(
        SELECT 1 FROM console_records WHERE kind='sales-offers' AND json_extract(body,'$.customer_id')=t.customer_id)))
    ORDER BY t.customer_id LIMIT 100`)
    .bind(now.toISOString(), audience === "high_interest" ? minCalls : new Date(+now - 36 * 3600000).toISOString(),
      audience === "high_interest" ? minMinutes * 60 : 0, JSON.stringify(phoneList(env.SALES_OFFER_TEST_PHONES)),
      JSON.stringify(phoneList(env.SALES_OFFER_ALLOWLIST)), env.SALES_OFFER_MODE).all<{ customer_id: string; dropped_at: string; phone: string }>();
  for (const row of results) {
    await queueOffer(b, env, row.customer_id, row.phone, row.dropped_at, offerSchedule(new Date(row.dropped_at)), now);
  }
}

export async function salesOfferDialError(env: Env, id: string, phone: string, now: Date) {
  const b = new BusinessStore(env.DB);
  const offer = await b.record("sales-offers", id);
  if (offer && await isQaCustomer(b.db, offer.customer_id)) return "QA test customer excluded";
  if (!salesOfferAllowed(env, phone)) return "Sales offer gate disabled for phone";
  if (!offer || offer.phone !== normalizePhone(phone) || !["queued", "dialed"].includes(offer.status) || offer.expires_at <= now.toISOString()) return "Sales offer unavailable or expired";
  if (!salesOfferTestPhone(env, phone) && await customerBought(b, offer.customer_id, now.toISOString())) return "Sales offer customer already purchased";
  return null;
}

export async function enterSalesOffer(b: BusinessStore, env: Env, callId: string, customerId: string) {
  if ((await b.loadContext(callId)).offer_call) return;
  const customer = await b.record("customers", customerId);
  const phone = normalizePhone(customer?.phone ?? "");
  if (!phone || !salesOfferAllowed(env, phone)) return;
  const row = await b.db.prepare("SELECT id FROM callback_requests WHERE source='sales_offer' AND phone=? AND status IN ('dialing','dialed') AND updated_at>? ORDER BY updated_at DESC LIMIT 1")
    .bind(phone, new Date(Date.now() - 45 * 60000).toISOString()).first<{ id: string }>();
  if (!row || await salesOfferDialError(env, row.id, phone, new Date())) return;
  const offer = await b.record("sales-offers", row.id);
  if (offer?.customer_id !== customerId) return;
  await b.save("sales-offers", { ...offer, status: "answered", answered_at: nowIso(), call_id: callId }, row.id);
  await b.saveContext(callId, { offer_call: row.id });
}

export async function offerGift(b: BusinessStore, env: Env, offerId: string, customerId: string, callId: string) {
  const offer = await b.record("sales-offers", offerId);
  if (!offer || offer.customer_id !== customerId || offer.status !== "answered" || offer.expires_at <= nowIso() ||
    !salesOfferAllowed(env, offer.phone) || !salesOfferTestPhone(env, offer.phone) && await customerBought(b, customerId)) return 0;
  const minutes = Number(env.SALES_OFFER_PRACTICE_MINUTES ?? 4);
  const seconds = (Number.isFinite(minutes) && minutes > 0 ? minutes : 4) * 60;
  const result = await b.db.prepare(`INSERT OR IGNORE INTO usage_allocations(call_id,customer_id,product,receipt_id,reserved_seconds,billed_seconds,created_at)
    SELECT ?,?,'school-offer-gift',?,?,NULL,? WHERE NOT EXISTS(SELECT 1 FROM usage_allocations WHERE receipt_id=?)
    AND NOT EXISTS(SELECT 1 FROM usage_allocations WHERE customer_id=? AND billed_seconds IS NULL AND created_at>?)`)
    .bind(callId, customerId, offerId, seconds, nowIso(), offerId, customerId, new Date(Date.now() - 2 * 3600000).toISOString()).run();
  return result.meta.changes === 1 ? seconds : 0;
}

const offerMenu = (text: string, name = "isaacOffer", keys = "0,1,2") => ({
  type: "simpleMenu", name, enabledKeys: keys, times: 2, timeout: 7, errorReturn: "ERROR", post: true, files: [{ text }],
});

async function recordedOfferMenu(env: Env) {
  const menu = offerMenu(SALES_OFFER_TEXT);
  if (!env.PUBLIC_BASE_URL || !env.ASSETS) return menu;
  try {
    const url = new URL(env.PUBLIC_BASE_URL.replace(/\/$/, "") + "/brand/phone/" + SALES_OFFER_RECORDING);
    if (!["https:", "http:"].includes(url.protocol)) return menu;
    const audio = await env.ASSETS.fetch(new Request(url, { method: "HEAD" }));
    if (audio.ok && /^audio\/(?:x-)?wav(?:e)?(?:;|$)/i.test(audio.headers.get("Content-Type") ?? "")) {
      return { ...menu, files: [{ fileLink: url.toString(), fileName: SALES_OFFER_RECORDING.replace(/\.wav$/, "") }] };
    }
  } catch {}
  return menu;
}

export async function salesOfferResponse(b: BusinessStore, env: Env, base: string, p: Record<string, string>, customerId: string): Promise<Record<string, any> | null> {
  const context = await b.loadContext(p.PBXcallId);
  if (!context.offer_call) return null;
  const offer = await b.record("sales-offers", context.offer_call);
  if (!offer || offer.customer_id !== customerId || offer.call_id !== p.PBXcallId || offer.expires_at <= nowIso() ||
    !salesOfferAllowed(env, offer.phone) || !salesOfferTestPhone(env, offer.phone) && await customerBought(b, customerId)) return null;
  if (p.PBXcallStatus === "HANGUP") return { type: "hangup" };
  if (p.isaacOfferUnavailable) return { type: "hangup" };
  if (offer.status === "declined") return null;
  if (offer.status === "accepted") return paymentResponse(new PaymentStore(b), env, base, p, customerId, ["school-offer-week"]);
  if (!["answered", "offered"].includes(offer.status)) return null;
  const choice = p.isaacOffer;
  const status = choice === "1" ? "accepted" : ["0", "2", "ERROR"].includes(choice) ? "declined" : "offered";
  await b.save("sales-offers", { ...offer, status }, context.offer_call);
  if (choice === "2") return null;
  if (["0", "ERROR"].includes(choice)) return { type: "hangup" };
  if (choice === "1") {
    try {
      await new PaymentStore(b).create(p.PBXcallId, customerId, "school-offer-week", false, env);
    } catch {
      return offerMenu("החבילה אינה זמינה לרכישה. לסיום הקישו 0.", "isaacOfferUnavailable", "0");
    }
    return paymentResponse(new PaymentStore(b), env, base, p, customerId, ["school-offer-week"]);
  }
  return recordedOfferMenu(env);
}
