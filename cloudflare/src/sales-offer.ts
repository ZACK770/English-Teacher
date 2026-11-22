import { BusinessStore } from "./business";
import { fromLocal, localDate, nextCallingSlot, normalizePhone } from "./callbacks";
import { type Env, nowIso } from "./env";
import { PaymentStore, paymentResponse } from "./payments";

export const SALES_EXTENSION_PATH = "/3";
export const SALES_OFFER_TEXT = "רגע לפני שנפרדים. רק היום, ורק בשיחה הזאת: חודש ראשון בספיקול בעשרה שקלים בלבד. כן, עשרה שקלים. אנחנו מציעים את זה רק עכשיו, כי אנחנו בטוחים שאחרי כמה אימונים תרגישו את ההבדל בעצמכם. בחודש הזה תקבלו שלושה אימונים של עשר דקות עם המורה. אחרי החודש הראשון המנוי ממשיך אוטומטית כמנוי סטארט, ב־59 שקלים לחודש, עד שתבטלו. אפשר לבטל בכל רגע בשלוחת המנויים. להצטרפות עכשיו בכרטיס אשראי הקישו 1. לשאר המנויים הקישו 2. לסיום הקישו 0.";
export const OFFER_GUIDANCE = 'This is a short next-day follow-up practice call from SpeakCall after the learner’s trial. Speak Hebrew for guidance. Greet warmly by name if known: "שלום, כאן ספיקול, חזרנו לתרגול קצר". Do a short English practice. Close politely and warmly, not abruptly, and say a short special message follows. Never take card details or quote prices.';

export function salesOfferAllowed(env: Env, phone: string): boolean {
  const normalized = normalizePhone(phone);
  return !!normalized && (env.SALES_OFFER_MODE === "on" || env.SALES_OFFER_MODE === "allowlist" &&
    (env.SALES_OFFER_ALLOWLIST ?? "").split(",").some(p => normalizePhone(p.trim()) === normalized));
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
  return !!await b.db.prepare(`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM payment_orders WHERE customer_id=? AND state='paid')
    OR EXISTS(SELECT 1 FROM sales_receipts r WHERE customer_id=? AND expires_at>? AND (valid_from IS NULL OR valid_from<=?)
      AND minutes*60>COALESCE((SELECT SUM(COALESCE(billed_seconds,reserved_seconds)) FROM usage_allocations WHERE receipt_id=r.id),0))
    OR EXISTS(SELECT 1 FROM subscriptions s LEFT JOIN subscription_members m ON m.subscription_id=s.id AND m.removed_at IS NULL
      WHERE (s.customer_id=? OR m.customer_id=?) AND s.status='active')`)
    .bind(customerId, customerId, now, now, customerId, customerId).first();
}

export async function selectSalesOffers(env: Env, now = new Date()) {
  if (!["on", "allowlist"].includes(env.SALES_OFFER_MODE ?? "")) return;
  const b = new BusinessStore(env.DB);
  const { results } = await env.DB.prepare(`SELECT json_extract(body,'$.customer_id') AS customer_id, MAX(created_at) AS dropped_at
    FROM console_records WHERE kind='ivr-events' AND json_extract(body,'$.route')='sales' AND created_at>?
    GROUP BY json_extract(body,'$.customer_id')`).bind(new Date(+now - 36 * 3600000).toISOString()).all<{ customer_id: string; dropped_at: string }>();
  for (const row of results) {
    const phone = normalizePhone((await b.record("customers", row.customer_id))?.phone ?? "");
    if (!phone || !salesOfferAllowed(env, phone) || await customerBought(b, row.customer_id, now.toISOString())) continue;
    const id = "sales-offer:" + row.customer_id;
    const schedule = offerSchedule(new Date(row.dropped_at));
    const offer = { id, customer_id: row.customer_id, phone, dropped_at: row.dropped_at, status: "queued", expires_at: schedule.expires };
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO console_records(kind,id,body,created_at,updated_at) VALUES ('sales-offers',?,?,?,?)")
        .bind(id, JSON.stringify(offer), now.toISOString(), now.toISOString()),
      env.DB.prepare(`INSERT OR IGNORE INTO callback_requests(id,phone,name,for_whom,goal,timing,preferred_time,source,consent_at,status,attempts,created_at,updated_at,next_attempt_at)
        SELECT ?,?,'','self','Sales offer','scheduled',?,'sales_offer',?,'queued',0,?,?,?
        WHERE EXISTS(SELECT 1 FROM console_records WHERE kind='sales-offers' AND id=? AND created_at=?)`)
        .bind(id, phone, schedule.at, now.toISOString(), now.toISOString(), now.toISOString(), schedule.at, id, now.toISOString()),
    ]);
  }
}

export async function salesOfferDialError(env: Env, id: string, phone: string, now: Date) {
  const b = new BusinessStore(env.DB);
  const offer = await b.record("sales-offers", id);
  if (!salesOfferAllowed(env, phone)) return "Sales offer gate disabled for phone";
  if (!offer || offer.phone !== normalizePhone(phone) || !["queued", "dialed"].includes(offer.status) || offer.expires_at <= now.toISOString()) return "Sales offer unavailable or expired";
  if (await customerBought(b, offer.customer_id, now.toISOString())) return "Sales offer customer already purchased";
  return null;
}

export async function enterSalesOffer(b: BusinessStore, env: Env, callId: string, customerId: string) {
  if ((await b.loadContext(callId)).offer_call) return;
  const customer = await b.record("customers", customerId);
  const phone = normalizePhone(customer?.phone ?? "");
  if (!phone || !salesOfferAllowed(env, phone)) return;
  const row = await b.db.prepare("SELECT id FROM callback_requests WHERE source='sales_offer' AND phone=? AND status IN ('dialing','dialed') AND updated_at>? ORDER BY updated_at DESC LIMIT 1")
    .bind(phone, new Date(Date.now() - 30 * 60000).toISOString()).first<{ id: string }>();
  if (!row || await salesOfferDialError(env, row.id, phone, new Date())) return;
  const offer = await b.record("sales-offers", row.id);
  if (offer?.customer_id !== customerId) return;
  await b.save("sales-offers", { ...offer, status: "answered", answered_at: nowIso(), call_id: callId }, row.id);
  await b.saveContext(callId, { offer_call: row.id });
}

export async function offerGift(b: BusinessStore, env: Env, offerId: string, customerId: string, callId: string) {
  const offer = await b.record("sales-offers", offerId);
  if (!offer || offer.customer_id !== customerId || offer.status !== "answered" || offer.expires_at <= nowIso() ||
    !salesOfferAllowed(env, offer.phone) || await customerBought(b, customerId)) return 0;
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

export async function salesOfferResponse(b: BusinessStore, env: Env, base: string, p: Record<string, string>, customerId: string): Promise<Record<string, any> | null> {
  const context = await b.loadContext(p.PBXcallId);
  if (!context.offer_call) return null;
  const offer = await b.record("sales-offers", context.offer_call);
  if (!offer || offer.customer_id !== customerId || offer.call_id !== p.PBXcallId || offer.expires_at <= nowIso() ||
    !salesOfferAllowed(env, offer.phone) || await customerBought(b, customerId)) return null;
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
      await new PaymentStore(b).create(p.PBXcallId, customerId, "school-offer-week");
    } catch {
      return offerMenu("החבילה אינה זמינה לרכישה. לסיום הקישו 0.", "isaacOfferUnavailable", "0");
    }
    return paymentResponse(new PaymentStore(b), env, base, p, customerId, ["school-offer-week"]);
  }
  return offerMenu(SALES_OFFER_TEXT);
}
