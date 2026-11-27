import { BusinessStore } from "./business";
import { fromLocal, localDate, nextCallingSlot, normalizePhone } from "./callbacks";
import { type Env, HttpError, nowIso } from "./env";
import { ExistingMonthlyEnrollmentError, PaymentStore, paymentResponse } from "./payments";
import { SCHOOL_FREE_POLICY } from "../../src/pricing";
import { isQaCustomer, qaCustomerSql } from "./qa-customers";
import { offerMenu, recordedOfferMenu, SALES_OFFER_CAP_SQL } from "./sales-offer-product";
export { SALES_OFFER_RECORDING, SALES_OFFER_TEXT } from "./sales-offer-product";

export const SALES_EXTENSION_PATH = "/3";
export const OFFER_GUIDANCE = 'This is a short next-day follow-up practice call from SpeakCall after the learner’s trial. Speak Hebrew for guidance. Greet warmly by name if known: "שלום, כאן ספיקול, חזרנו לתרגול קצר". Do a short English practice. Close politely and warmly, not abruptly, and say a short special message follows. Never take card details or quote prices.';

export function salesOfferAllowed(env: Env, phone: string): boolean {
  const normalized = normalizePhone(phone);
  return !!normalized && !phoneList(env.SALES_OFFER_EXCLUDE_PHONES).includes(normalized) &&
    (env.SALES_OFFER_MODE === "on" || env.SALES_OFFER_MODE === "allowlist" &&
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

const DAY_MS = 24 * 60 * 60 * 1000;
const rollingBuyerSql = (customer: string) => `(
  ${buyerSql(customer, "?1")} OR EXISTS(SELECT 1 FROM sales_receipts r WHERE
    r.customer_id=${customer} AND r.amount_ils>0 AND r.payment_reversed_at IS NULL)
)`;

const customerPhoneCallsSql = `SELECT c.customer_id,
  CASE WHEN instr(c.call_id,'~')>0 THEN substr(c.call_id,1,instr(c.call_id,'~')-1) ELSE c.call_id END AS call_id,
  MAX(julianday(c.created_at),COALESCE(julianday(s.ended_at),0)) AS at
  FROM call_customers c LEFT JOIN sessions s ON s.call_id=c.call_id WHERE c.channel='phone'
  UNION ALL
  SELECT json_extract(body,'$.customer_id'),json_extract(body,'$.call_id'),julianday(created_at)
  FROM console_records WHERE kind='ivr-events' AND json_extract(body,'$.finished')=1`;

export const ROLLING_SALES_OFFER_CANDIDATES_SQL = `WITH
  exhausted AS (${QUOTA_EXHAUSTED_CANDIDATES_SQL}),
  phone_calls AS (${customerPhoneCallsSql}),
  history AS (
    SELECT customer_id, COUNT(DISTINCT call_id) AS calls, MAX(at) AS last_call
    FROM phone_calls GROUP BY customer_id
  )
  SELECT h.customer_id,ph.phone,strftime('%Y-%m-%dT%H:%M:%fZ',h.last_call) AS last_call_at
  FROM history h JOIN customer_phones ph ON ph.customer_id=h.customer_id
  WHERE (h.calls>=?3 OR EXISTS(SELECT 1 FROM exhausted q WHERE q.customer_id=h.customer_id))
    AND h.last_call<=julianday(?1)-1
    AND length(ph.phone) BETWEEN 8 AND 15 AND ph.phone NOT GLOB '*[^0-9]*' AND ph.phone GLOB '*[1-9]*'
    AND NOT ${qaCustomerSql("h.customer_id")}
    AND NOT ${rollingBuyerSql("h.customer_id")}
    AND ph.phone NOT IN (SELECT value FROM json_each(?2))
    AND NOT EXISTS(SELECT 1 FROM console_records o
      WHERE o.kind='sales-offers' AND json_extract(o.body,'$.customer_id')=h.customer_id)
  ORDER BY h.last_call,h.customer_id`;

function rollingStart(env: Env) {
  const raw = env.SALES_OFFER_ROLLING_START_AT ?? "";
  const start = new Date(raw);
  return /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(+start) &&
    +nextCallingSlot(start) === +start ? start : null;
}

export async function rollingOfferDispatch(env: Env, id: string, now: Date) {
  const b = new BusinessStore(env.DB);
  const offer = await b.record("sales-offers", id);
  if (!offer?.rolling) return null;
  if (offer.status === "queued" && offer.expires_at <= now.toISOString()) {
    await b.save("sales-offers", { ...offer, expires_at: scheduleAt(nextCallingSlot(now)).expires }, id);
  }
  const last = await env.DB.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MAX(at)) AS last_call
    FROM (${customerPhoneCallsSql}) WHERE customer_id=?`)
    .bind(offer.customer_id).first<{ last_call: string | null }>();
  if (last?.last_call == null) return { hold: null };
  const at = nextCallingSlot(new Date(+new Date(last.last_call) + DAY_MS));
  return { hold: +at > +now ? scheduleAt(at) : null };
}

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

async function queueOffer(b: BusinessStore, env: Env, customerId: string, phone: string, droppedAt: string, schedule: { at: string; expires: string }, now: Date, rolling = false) {
  if (!await b.db.prepare(`SELECT 1 WHERE ${SALES_OFFER_CAP_SQL}`).first()) return null;
  if (await isQaCustomer(b.db, customerId)) return null;
  const test = salesOfferTestPhone(env, phone);
  if (!salesOfferAllowed(env, phone) || !test && await customerBought(b, customerId, now.toISOString())) return null;
  const id = test ? `sales-offer:test:${customerId}:${schedule.at}` : "sales-offer:" + customerId;
  const offer = { id, customer_id: customerId, phone, dropped_at: droppedAt, status: "queued", expires_at: schedule.expires, test, ...(rolling ? { rolling: true } : {}) };
  await b.db.batch([
    b.db.prepare(`INSERT OR IGNORE INTO console_records(kind,id,body,created_at,updated_at)
      SELECT 'sales-offers',?,?,?,? WHERE ${SALES_OFFER_CAP_SQL} AND (?=1 OR NOT EXISTS(
        SELECT 1 FROM console_records WHERE kind='sales-offers' AND json_extract(body,'$.customer_id')=?))`)
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

/** An explicit opt-in audience for real recent telephone lessons, rather than IVR visits.
 * Segments of a single parent telephone call count as one call; only meaningful practice counts. */
export const ENGAGED_SALES_CANDIDATES_SQL = `SELECT customer_id, ?1 AS dropped_at FROM (
  SELECT c.customer_id, CASE WHEN instr(s.call_id,'~')>0 THEN substr(s.call_id,1,instr(s.call_id,'~')-1) ELSE s.call_id END AS parent_call,
    SUM(s.duration_seconds) AS seconds
  FROM sessions s JOIN call_customers c ON c.call_id=s.call_id JOIN bots b ON b.id=c.bot_id AND b.role='teacher'
  WHERE c.channel='phone' AND s.duration_seconds>=60 AND s.learner_turns>=3
    AND julianday(s.ended_at) BETWEEN julianday(?1)-7 AND julianday(?1)
  GROUP BY c.customer_id,parent_call
) GROUP BY customer_id HAVING COUNT(*)>=?2 AND SUM(seconds)>=?3`;

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
  if (audience === "rolling") {
    const start = rollingStart(env);
    if (env.SALES_OFFER_MODE !== "on" || !start || +now < +start) return;
    const b = new BusinessStore(env.DB);
    await env.DB.prepare(`UPDATE callback_requests SET status='queued',next_attempt_at=?,updated_at=?,last_error=NULL
      WHERE source='sales_offer' AND attempts=0 AND status='failed' AND last_error='Sales offer unavailable or expired'
      AND EXISTS(SELECT 1 FROM console_records o WHERE o.kind='sales-offers' AND o.id=callback_requests.id
        AND json_extract(o.body,'$.rolling')=1 AND json_extract(o.body,'$.status')='queued')`)
      .bind(nextCallingSlot(now).toISOString(), now.toISOString()).run();
    const configuredCalls = Number(env.SALES_OFFER_MIN_TUTOR_CALLS ?? 4);
    const minCalls = Number.isInteger(configuredCalls) && configuredCalls > 0 ? configuredCalls : 4;
    const { results } = await env.DB.prepare(ROLLING_SALES_OFFER_CANDIDATES_SQL)
      .bind(now.toISOString(), JSON.stringify([...phoneList(env.SALES_OFFER_TEST_PHONES), ...phoneList(env.SALES_OFFER_EXCLUDE_PHONES)]), minCalls)
      .all<{ customer_id: string; phone: string; last_call_at: string }>();
    let queued = 0;
    for (const row of results) {
      const at = nextCallingSlot(new Date(Math.max(+start, +new Date(row.last_call_at) + DAY_MS)));
      if (+at > +now) continue;
      if (await queueOffer(b, env, row.customer_id, row.phone, row.last_call_at, scheduleAt(nextCallingSlot(now)), now, true)) queued++;
      if (queued >= 100) break;
    }
    return;
  }
  if (!["dropoffs", "high_interest", "engaged", "quota_exhausted"].includes(audience)) return;
  const minCalls = Number(env.SALES_OFFER_MIN_TUTOR_CALLS ?? (audience === "engaged" ? 2 : 3));
  const minMinutes = Number(env.SALES_OFFER_MIN_TUTOR_MINUTES ?? (audience === "engaged" ? 5 : 0));
  const practiceAudience = audience === "high_interest" || audience === "engaged";
  if (practiceAudience && (env.SALES_OFFER_MIN_TUTOR_CALLS?.trim() === "" || env.SALES_OFFER_MIN_TUTOR_MINUTES?.trim() === "" ||
    !Number.isInteger(minCalls) || minCalls < 0 || !Number.isFinite(minMinutes) || minMinutes < 0)) return;
  const b = new BusinessStore(env.DB);
  const candidates = audience === "quota_exhausted" ? QUOTA_EXHAUSTED_CANDIDATES_SQL
    : audience === "engaged" ? ENGAGED_SALES_CANDIDATES_SQL
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
    .bind(now.toISOString(), practiceAudience ? minCalls : new Date(+now - 36 * 3600000).toISOString(),
      practiceAudience ? minMinutes * 60 : 0, JSON.stringify(phoneList(env.SALES_OFFER_TEST_PHONES)),
      JSON.stringify(phoneList(env.SALES_OFFER_ALLOWLIST)), env.SALES_OFFER_MODE).all<{ customer_id: string; dropped_at: string; phone: string }>();
  for (const row of results) {
    await queueOffer(b, env, row.customer_id, row.phone, row.dropped_at, offerSchedule(new Date(row.dropped_at)), now);
  }
}

export async function salesOfferDialError(env: Env, id: string, phone: string, now: Date, returning = false) {
  const b = new BusinessStore(env.DB);
  const offer = await b.record("sales-offers", id);
  if (offer && await isQaCustomer(b.db, offer.customer_id)) return "QA test customer excluded";
  if (!salesOfferAllowed(env, phone)) return "Sales offer gate disabled for phone";
  const statuses = returning ? ["queued", "dialed", "answered", "offered", "accepted", "declined"] : ["queued", "dialed"];
  if (!offer || offer.phone !== normalizePhone(phone) || !statuses.includes(offer.status) || offer.expires_at <= now.toISOString()) return "Sales offer unavailable or expired";
  if (!await b.db.prepare(`SELECT 1 WHERE ${SALES_OFFER_CAP_SQL}`).first()) return "Sales offer buyer limit reached";
  if (offer.rolling) {
    const start = rollingStart(env);
    if (env.SALES_OFFER_AUDIENCE !== "rolling" || env.SALES_OFFER_MODE !== "on" ||
      !start || +start > +now || salesOfferTestPhone(env, phone)) return "Rolling sales offers disabled";
    return await b.db.prepare(`SELECT 1 WHERE ${rollingBuyerSql("?2")}`)
      .bind(now.toISOString(), offer.customer_id).first() ? "Sales offer customer already purchased" : null;
  }
  if (!salesOfferTestPhone(env, phone) && await customerBought(b, offer.customer_id, now.toISOString())) return "Sales offer customer already purchased";
  return null;
}

export async function enterSalesOffer(b: BusinessStore, env: Env, callId: string, customerId: string) {
  if ((await b.loadContext(callId)).offer_call) return;
  const customer = await b.record("customers", customerId);
  const phone = normalizePhone(customer?.phone ?? "");
  if (!phone || !salesOfferAllowed(env, phone)) return;
  const row = await b.db.prepare("SELECT id FROM callback_requests WHERE source='sales_offer' AND phone=? AND status IN ('dialing','dialed') AND updated_at>? ORDER BY updated_at DESC LIMIT 1")
    .bind(phone, new Date(Date.now() - 120 * 60000).toISOString()).first<{ id: string }>();
  if (!row || await salesOfferDialError(env, row.id, phone, new Date(), true)) return;
  const offer = await b.record("sales-offers", row.id);
  if (offer?.customer_id !== customerId) return;
  if (offer.call_id && offer.call_id !== callId) {
    await new PaymentStore(b).cancelSelection(offer.call_id);
    await b.saveContext(offer.call_id, { offer_call: null });
  }
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

export async function salesOfferResponse(b: BusinessStore, env: Env, base: string, p: Record<string, string>, customerId: string): Promise<Record<string, any> | null> {
  const context = await b.loadContext(p.PBXcallId);
  if (!context.offer_call) return null;
  const offer = await b.record("sales-offers", context.offer_call);
  if (!offer || offer.customer_id !== customerId || offer.call_id !== p.PBXcallId || offer.expires_at <= nowIso() ||
    !salesOfferAllowed(env, offer.phone) || !salesOfferTestPhone(env, offer.phone) && await customerBought(b, customerId)) return null;
  if (p.PBXcallStatus === "HANGUP") {
    await new PaymentStore(b).cancelSelection(p.PBXcallId);
    return { type: "hangup" };
  }
  if (p.isaacOfferUnavailable) return { type: "hangup" };
  if (offer.status === "declined") return null;
  if (offer.status === "accepted") {
    if (p.isaacPayConfirm === "1" && !p.isaacPayStatus && !await b.db.prepare(`SELECT 1 WHERE ${SALES_OFFER_CAP_SQL}`).first()) {
      await new PaymentStore(b).cancelSelection(p.PBXcallId);
      return { type: "hangup" };
    }
    return paymentResponse(new PaymentStore(b), env, base, p, customerId, ["school-offer-week"]);
  }
  if (!["answered", "offered"].includes(offer.status)) return null;
  const choice = p.isaacOffer;
  if (choice && choice !== "1") {
    await b.save("sales-offers", { ...offer, status: "declined" }, context.offer_call);
    return { type: "hangup" };
  }
  if (choice === "1") {
    const reserved = await b.db.prepare(`UPDATE console_records
      SET body=json_set(body,'$.status','accepted','$.accepted_at',COALESCE(json_extract(body,'$.accepted_at'),?)),updated_at=?
      WHERE kind='sales-offers' AND id=? AND json_extract(body,'$.status') IN ('answered','offered')
      AND ${SALES_OFFER_CAP_SQL}`)
      .bind(nowIso(), nowIso(), context.offer_call).run();
    if (!reserved.meta.changes) return { type: "hangup" };
    try {
      await new PaymentStore(b).create(p.PBXcallId, customerId, "school-offer-week", false, env);
    } catch (error) {
      const text = error instanceof ExistingMonthlyEnrollmentError
        ? "כבר קיים מנוי פעיל בחשבון. לסיום הקישו 0."
        : "החבילה אינה זמינה לרכישה. לסיום הקישו 0.";
      return offerMenu(text, "isaacOfferUnavailable", "0");
    }
    return paymentResponse(new PaymentStore(b), env, base, p, customerId, ["school-offer-week"]);
  }
  if (!await b.db.prepare(`SELECT 1 WHERE ${SALES_OFFER_CAP_SQL}`).first()) return { type: "hangup" };
  await b.save("sales-offers", { ...offer, status: "offered" }, context.offer_call);
  return recordedOfferMenu(env);
}
