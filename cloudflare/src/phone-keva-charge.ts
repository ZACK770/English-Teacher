import { BusinessStore } from "./business";
import { type Env, nowIso, paymentsConfigured } from "./env";
import { activatePaidKeva, verifyKevaForActivation, type VerifiedPhoneCharge } from "./keva-sync";
import { manageKeva } from "./nedarim";
import { agorot, PaymentStore } from "./payments";
import { addMonths } from "./subscriptions";

const str = (value: unknown) => String(value ?? "").trim();

export async function claimPhoneKevaFirstCharge(env: Env, orderId: string, kevaId: string) {
  if (!paymentsConfigured(env) || !/^\d{1,20}$/.test(kevaId)) return false;
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO phone_keva_first_charges(order_id,keva_id,state,created_at)
    SELECT o.id,?,'checking',? FROM payment_orders o JOIN phone_keva_enrollments e ON e.order_id=o.id
    WHERE o.id=? AND o.channel='phone' AND o.state='issued' AND json_extract(o.snapshot,'$.billing')='monthly'`)
    .bind(kevaId, nowIso(), orderId).run();
  return !!result.meta.changes;
}

export async function completePhoneKevaFirstCharge(env: Env, orderId: string): Promise<"declined" | undefined> {
  const attempt = await env.DB.prepare("SELECT keva_id FROM phone_keva_first_charges WHERE order_id=? AND state='checking'")
    .bind(orderId).first<{ keva_id: string }>();
  if (!attempt || !paymentsConfigured(env)) return;
  const enrollment = await env.DB.prepare(`SELECT o.*,e.phone FROM payment_orders o JOIN phone_keva_enrollments e ON e.order_id=o.id
    WHERE o.id=? AND o.channel='phone' AND o.state='awaiting_settlement'`).bind(orderId).first<Record<string, any>>();
  if (!enrollment) return;
  const group = "dibura-" + orderId, kevaId = attempt.keva_id;
  const store = new PaymentStore(new BusinessStore(env.DB));
  const issue = (kind: string, message: string) => store.issueForData({ Groupe: group }, kind, message);
  const setState = (state: string) => env.DB.prepare("UPDATE phone_keva_first_charges SET state=? WHERE order_id=?").bind(state, orderId).run();
  try {
    const detail = JSON.parse(await manageKeva(env, { Action: "GetKevaId", KevaId: kevaId }));
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return;
    const row = { KevaId: detail.KevaId, Groupe: detail.KevaGroupe, Phone: detail.KevaPhone, Amount: detail.KevaAmount,
      Currency: detail.KevaCurrency, Enabled: detail.KevaStatus,
      Success: Array.isArray(detail.HistoryData) && detail.HistoryData.some((event: Record<string, unknown>) => str(event.ID) === "1") ? "1" : detail.KevaSuccess,
      CreationDate: detail.CreatedDate,
      ...(detail.MosadNumber != null ? { MosadNumber: detail.MosadNumber } : {}) };
    if (!await verifyKevaForActivation(env, row, kevaId, enrollment, detail)) return;
    if (detail.HistoryData.length) {
      await setState("skipped");
      await activatePaidKeva(env, row, kevaId, enrollment, undefined, detail);
      return;
    }
    if (str(detail.KevaSuccess) !== "0") return;
    const claim = await env.DB.prepare(`UPDATE phone_keva_first_charges SET state='charging' WHERE order_id=? AND state='checking'
      AND EXISTS (SELECT 1 FROM payment_orders WHERE id=? AND state='awaiting_settlement')`).bind(orderId, orderId).run();
    if (!claim.meta.changes) return;
    await issue("phone_keva_charge_unknown", "החיוב הראשון נשלח לבדיקה. אין לבצע חיוב נוסף לפני בדיקת ההיסטוריה בנדרים פלוס.");
    const result = JSON.parse(await manageKeva(env, { Action: "TashlumBodedNew", MosadNumber: env.NEDARIM_MOSAD_ID!,
      KevaId: kevaId, Amount: String(enrollment.amount_agorot / 100), Currency: "1", Tashloumim: "1", Tashlumim: "1",
      JoinToKevaId: "Join", Groupe: group, AjaxId: "dibura-first-" + orderId }));
    if (result?.Status === "Error") {
      await setState("declined");
      await env.DB.prepare("UPDATE payment_orders SET state='failed',updated_at=? WHERE id=? AND state='awaiting_settlement'")
        .bind(nowIso(), orderId).run();
      await issue("phone_keva_declined", "הכרטיס לא אושר והמנוי לא נפתח.");
      await env.DB.prepare("UPDATE payment_issues SET status='resolved',resolved_at=?,resolution=? WHERE order_id=? AND kind='phone_keva_charge_unknown' AND status='open'")
        .bind(nowIso(), "החיוב סורב.", orderId).run();
      try {
        if ((await manageKeva(env, { Action: "DeleteKeva", KevaId: kevaId })).trim() !== "OK") throw new Error("Delete failed");
      } catch {
        await issue("phone_keva_delete_failed", "החיוב סורב אך מחיקת הוראת הקבע לא אושרה. נדרשת בדיקה בנדרים פלוס לפני ניסיון נוסף.");
      }
      return "declined";
    }
    const transactionId = str(result?.TransactionId ?? result?.ID), confirmation = str(result?.Confirmation);
    if (result?.Status !== "OK" || !/^\d{1,30}$/.test(transactionId) || confirmation.length > 100 ||
      (result.ID != null && str(result.ID) !== transactionId) ||
      (result.Amount != null && agorot(result.Amount) !== enrollment.amount_agorot) ||
      (result.Currency != null && str(result.Currency) !== "1") ||
      (str(result.Groupe) && str(result.Groupe) !== group) ||
      (result.KevaId != null && str(result.KevaId).replace(/^-/, "") !== kevaId) ||
      (result.MosadNumber != null && str(result.MosadNumber) !== env.NEDARIM_MOSAD_ID)) throw new Error("Unknown charge result");
    const start = nowIso(), end = addMonths(start, 1);
    const charge: VerifiedPhoneCharge = { transactionId, confirmation, start, end };
    await env.DB.prepare(`UPDATE phone_keva_first_charges SET state='charged',transaction_id=?,confirmation=?,period_start=?,next_date=? WHERE order_id=?`)
      .bind(transactionId, confirmation, start, end, orderId).run();
    await issue("phone_keva_next_date", "החיוב הראשון אושר. עדכון תאריך החיוב הבא טרם אושר; יש לבדוק בנדרים פלוס כדי למנוע חיוב כפול.");
    await env.DB.prepare("UPDATE payment_issues SET status='resolved',resolved_at=?,resolution=? WHERE order_id=? AND kind='phone_keva_charge_unknown' AND status='open'")
      .bind(nowIso(), "החיוב אושר.", orderId).run();
    try {
      await activatePaidKeva(env, row, kevaId, enrollment, charge, detail);
      const paid = await env.DB.prepare("SELECT id FROM payment_orders WHERE id=? AND state='paid'").bind(orderId).first();
      if (!paid) throw new Error("Activation incomplete");
    } catch {
      await issue("phone_keva_activation", "החיוב הראשון אושר אך המנוי טרם נפתח. נדרשת בדיקה לפני ניסיון תשלום נוסף.");
    }
    try {
      const nextDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(end));
      const update = JSON.parse(await manageKeva(env, { Action: "UpdateKevaNew", KevaId: kevaId, NextDate: nextDate }));
      if (update?.Result !== "OK") throw new Error("Next date update failed");
      await env.DB.prepare(`UPDATE payment_issues SET status='resolved',resolved_at=?,resolution=? WHERE order_id=? AND kind='phone_keva_next_date' AND status='open'`)
        .bind(nowIso(), "תאריך החיוב הבא עודכן בנדרים פלוס.", orderId).run();
    } catch {
      // The open issue also covers an interrupted update after a successful charge.
    }
  } catch {
    await env.DB.prepare("UPDATE phone_keva_first_charges SET state='unknown' WHERE order_id=? AND state IN ('checking','charging')").bind(orderId).run();
    await issue("phone_keva_charge_unknown", "לא התקבל אישור סופי לחיוב הראשון. אין לבצע חיוב נוסף לפני בדיקת ההיסטוריה בנדרים פלוס.");
  }
}
