import type { BusinessStore } from "./business";
import { type Env, nowIso } from "./env";
import { visiblePhone } from "./phone";

export const SALES_OFFER_PACKAGE = "school-offer-week";
export const SALES_OFFER_RECORDING = "sales-offer-black-friday-100-8846fe315b50.wav";
export const SALES_OFFER_TEXT = "רוצים לדעת אנגלית?! בלאק פריידיי בספיקול! הטבת חודש ראשון - מוגבלת למאה רוכשים בלבד! מצטרפים עכשיו למנוי החודשי סטארטר, ומשלמים רק עשרים שקלים. כן, עשרים שקלים ואתם על הדרך לדבר אנגלית שוטף! מעוניינים?! הקישו כעת 1.";
export const offerMenu = (text: string, name = "isaacOffer", keys = "1") => ({
  type: "simpleMenu", name, enabledKeys: keys, times: 2, timeout: 7, errorReturn: "ERROR", post: true, files: [{ text }],
});

export async function recordedOfferMenu(env: Env) {
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

/** Read the exact amounts from the order snapshot before explicit payment consent. */
export const salesOfferTerms = (firstPrice: number, renewalPrice: number) => `החודש הראשון רק ${firstPrice} שקלים. לאחר מכן המנוי מתחדש אוטומטית במחיר ${renewalPrice} שקלים לחודש באשראי. אפשר לבטל בשלוחה 3 בתוך שלושים הימים הראשונים כדי שלא להתחייב לחודש נוסף. לאישור והמשך לתשלום הקישו 1. לחזרה הקישו 0.`;
export const SALES_OFFER_TERMS_TEXT = salesOfferTerms(20,59);
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
