import type { BusinessStore } from "./business";
import { type Env, nowIso } from "./env";
import { visiblePhone } from "./phone";

export const SALES_OFFER_PACKAGE = "school-offer-week";
export const SALES_OFFER_TERMS_TEXT = "שימו לב: בהטבת בלאק פריידיי הינכם זכאים להטבת חודש ראשון. בסוף החודש המנוי ממשיך אוטומטית כמנוי סטארט במחירו הקבוע. אם לא תרצו להמשיך, ניתן לבטל את המנוי בשלוחה 3 בתוך שלושים הימים הראשונים, ולא תחויבו על חודש נוסף. לאישור והמשך לתשלום הקישו 1. לחזרה הקישו 0.";
export const SALES_OFFER_BUYERS_SQL = "SELECT DISTINCT customer_id FROM payment_orders WHERE package_id='school-offer-week' AND state='paid'";
export const SALES_OFFER_CAP_SQL = `(SELECT COUNT(*) FROM (${SALES_OFFER_BUYERS_SQL}))<100`;
export const isSalesOfferPackage = (id: string) => id === SALES_OFFER_PACKAGE;
export const phoneFirstPrice = (id: string, pkg: { price_ils: number; first_month_price_ils?: number }) =>
  isSalesOfferPackage(id) ? pkg.first_month_price_ils ?? 20 : pkg.price_ils;

export async function boundSalesOffer(b: BusinessStore, callId: string, customerId: string, env?: Env) {
  if (!env) return false;
  if (!await b.db.prepare(`SELECT 1 WHERE ${SALES_OFFER_CAP_SQL}`).first()) return false;
  const context = await b.loadContext(callId);
  if (!context.offer_call) return false;
  const offer = await b.record("sales-offers", context.offer_call);
  if (!offer || offer.customer_id !== customerId || offer.call_id !== callId || offer.status !== "accepted" || offer.expires_at <= nowIso()) return false;
  const phone = visiblePhone(String(offer.phone ?? ""));
  return !!phone && (env.SALES_OFFER_MODE === "on" || env.SALES_OFFER_MODE === "allowlist" &&
    (env.SALES_OFFER_ALLOWLIST ?? "").split(",").some(p => visiblePhone(p.trim()) === phone));
}
