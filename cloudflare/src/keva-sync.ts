import { BusinessStore, PackageSchema } from "./business";
import { type Env, nowIso, paymentsConfigured, sha256Hex } from "./env";
import { manageKeva, providerDay, providerTime } from "./nedarim";
import { agorot } from "./payments";
import { visiblePhone } from "./phone";
import { addMonths, SubscriptionStore } from "./subscriptions";

const str = (value: unknown) => (value == null ? "" : String(value)).trim();
const tail9 = (phone: string) => phone.replace(/\D/g, "").slice(-9);
const LEGACY_GROUP = "חבילות ספיקול";

async function activatePaidKeva(env: Env, row: Record<string, unknown>, kevaId: string, enrollment?: Record<string, any>) {
  const group = enrollment ? "dibura-" + enrollment.id : LEGACY_GROUP;
  if (!/^\d{1,20}$/.test(kevaId) || str(row.Groupe) !== group || str(row.Enabled) !== "1" ||
    str(row.Currency) !== "1" || !/^\d+$/.test(str(row.Success)) || Number(row.Success) < 1 || str(row.ErrorText)) return;
  const phone = visiblePhone(str(row.Phone));
  if (!phone) return;
  if (enrollment && (phone !== enrollment.phone || agorot(row.Amount) !== enrollment.amount_agorot ||
    !["issued", "awaiting_settlement"].includes(enrollment.state))) return;
  if (enrollment) {
    const created = providerTime(row.CreationDate) || providerDay(row.CreationDate);
    if (!created || Date.parse(created) < Date.parse(enrollment.created_at) - 86400000 || Date.parse(created) > Date.now() + 86400000) return;
  }
  if (row.MosadNumber != null && str(row.MosadNumber) !== env.NEDARIM_MOSAD_ID) return;
  const db = env.DB;
  // Entitlement must follow the same verified primary phone used to sign in or call.
  const owner = await db.prepare(`SELECT p.customer_id FROM customer_phones p JOIN customers c ON c.id=p.customer_id
    WHERE p.phone=? AND NOT EXISTS (SELECT 1 FROM standing_orders s WHERE s.keva_id=? OR (s.customer_id=c.id AND s.state IN ('pending','active','past_due')))
    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id=c.id AND s.status IN ('active','paused','past_due'))`)
    .bind(phone, kevaId).first<{ customer_id: string }>();
  if (!owner) return;
  if (enrollment && owner.customer_id !== enrollment.customer_id) return;

  const monthlyAgorot = enrollment?.amount_agorot ?? agorot(row.Amount);
  const business = new BusinessStore(db);
  const saved = enrollment ? PackageSchema.safeParse(JSON.parse(enrollment.snapshot)) : null;
  if (saved && (!saved.success || saved.data.billing !== "monthly" || saved.data.product !== "school" || saved.data.minutes < 1)) return;
  const plans = enrollment && saved?.success ? [{ id: enrollment.package_id, included_minutes: saved.data.minutes }] : (await db.prepare(`SELECT id,included_minutes FROM plans WHERE product='school' AND billing='monthly' AND active=1
    AND CASE WHEN ?1=4900 THEN id='school-step' ELSE price_agorot=?1 END`).bind(monthlyAgorot)
    .all<{ id: string; included_minutes: number }>()).results;
  if (plans.length !== 1 || plans[0].included_minutes < 1) return;
  const plan = plans[0];
  const pkg = saved ?? PackageSchema.safeParse(await business.record("packages", plan.id));
  if (!pkg.success || (!enrollment && !pkg.data.active) || pkg.data.billing !== "monthly" || pkg.data.product !== "school") return;

  const detail = JSON.parse(await manageKeva(env, { Action: "GetKevaId", KevaId: kevaId }));
  if (str(detail?.KevaId) !== kevaId || str(detail.KevaStatus) !== "1" || str(detail.KevaFrequency) !== "1" ||
    str(detail.KevaCurrency) !== "1" || str(detail.KevaGroupe) !== group || visiblePhone(str(detail.KevaPhone)) !== phone ||
    agorot(detail.KevaAmount) !== monthlyAgorot || !Array.isArray(detail.HistoryData)) return;
  if (detail.MosadNumber != null && str(detail.MosadNumber) !== env.NEDARIM_MOSAD_ID) return;

  const events = detail.HistoryData.map((event: Record<string, unknown>) => ({ event, day: providerDay(event.Date) }));
  if (events.some(({ day }: { day: string }) => !day)) return;
  const start = events.map(({ day }: { day: string }) => day).sort().at(-1);
  const latest = events.filter(({ day }: { day: string }) => day === start);
  if (!start || latest.length !== 1 || str(latest[0].event.ID) !== "1") return;
  const charge = latest[0].event;
  if (enrollment && Date.parse(start) < Date.parse(enrollment.created_at) - 86400000) return;
  const transactionId = str(charge.TransactionId);
  if (!/^\d{1,30}$/.test(transactionId) || agorot(str(charge.Amount).replace(/\s*₪$/, "")) !== monthlyAgorot) return;
  const nextDate = providerDay(detail.KevaNextDate), now = nowIso();
  if (!nextDate || start > now) return;
  const end = [nextDate, addMonths(start, 1)].sort()[0];
  if (end <= now) return;

  const customerId = owner.customer_id;
  const id = enrollment?.id ?? (await sha256Hex("legacy-keva:" + kevaId)).slice(0, 32);
  const receiptId = (await sha256Hex("legacy-keva-receipt:" + kevaId + ":" + transactionId)).slice(0, 20);
  const reference = `nedarim:${env.NEDARIM_MOSAD_ID}:${transactionId}`;
  if (await db.prepare("SELECT 1 FROM sales_receipts WHERE reference=?").bind(reference).first()) return;
  const vat = enrollment?.vat_rate ?? (await business.economics()).vat_rate;
  const snapshot = JSON.stringify({ ...pkg.data, price_ils: monthlyAgorot / 100 });
  await new SubscriptionStore(db).create(customerId, plan.id, start, enrollment ? [] : undefined, {
    id, priceAgorot: monthlyAgorot, monthlyMinutes: plan.included_minutes, termMonths: null, grantFirstPeriod: false,
    period: { number: 1, start, end },
    statements: [
      db.prepare(`INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at,subscription_id,valid_from)
        VALUES (?,?,?,'school',?,?,?,?,?,?,?,?)`).bind(receiptId, customerId, plan.id, reference, monthlyAgorot / 100, vat, plan.included_minutes, addMonths(end, 1), start, id, start),
      ...(enrollment ? [
        db.prepare(`UPDATE payment_orders SET state='paid',transaction_id=?,receipt_id=?,subscription_id=?,entitlement_id=?,updated_at=?
          WHERE id=? AND state IN ('issued','awaiting_settlement')`).bind(transactionId, receiptId, id, id, now, enrollment.id),
        db.prepare("UPDATE phone_keva_enrollments SET keva_id=? WHERE order_id=?").bind(kevaId, enrollment.id),
      ] : [db.prepare(`INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,channel,transaction_id,receipt_id,subscription_id,entitlement_id,created_at,updated_at)
        VALUES (?1,?2,(SELECT p.customer_id FROM customer_phones p WHERE p.phone=?3 AND p.customer_id=?4
          AND NOT EXISTS (SELECT 1 FROM standing_orders s WHERE s.customer_id=p.customer_id AND s.state IN ('pending','active','past_due'))
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id=p.customer_id AND s.id<>?1 AND s.status IN ('active','paused','past_due'))),
          ?5,?6,?7,?8,'paid','nedarim',?9,?10,?1,?1,?11,?12)`).bind(id, "legacy-keva-" + kevaId, phone, customerId, plan.id, snapshot, monthlyAgorot, vat, transactionId, receiptId, start, now)]),
      db.prepare(`INSERT INTO standing_orders(id,customer_id,package_id,snapshot,monthly_agorot,first_order_id,state,keva_id,next_date,last_charge_at,entitlement_id,created_at,updated_at)
        VALUES (?,(SELECT ? WHERE ? IS NULL OR EXISTS (
          SELECT 1 FROM payment_orders o WHERE o.id=? AND o.state='paid' AND o.transaction_id=?
          AND NOT EXISTS (SELECT 1 FROM standing_orders s WHERE s.customer_id=o.customer_id AND s.state IN ('pending','active','past_due'))
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id=o.customer_id AND s.id<>? AND s.status IN ('active','paused','past_due'))
        )),?,?,?,?,'active',?,?,?,?,?,?)`).bind(id, customerId, enrollment?.id ?? null, id, transactionId, id, plan.id, snapshot, monthlyAgorot, id, kevaId, str(detail.KevaNextDate), start, id, start, now),
      db.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)").bind(enrollment ? "payment:phone_keva_activated" : "payment:keva_imported", id, now),
    ],
  });
}

export async function activatePhoneKeva(env: Env, row: Record<string, unknown>) {
  if (!paymentsConfigured(env)) return false;
  const match = /^dibura-([0-9a-f]{32})$/.exec(str(row.Groupe));
  if (!match) return false;
  const enrollment = await env.DB.prepare(`SELECT o.*,e.phone FROM payment_orders o JOIN phone_keva_enrollments e ON e.order_id=o.id WHERE o.id=?`)
    .bind(match[1]).first<Record<string, any>>();
  if (!enrollment) return false;
  if (enrollment.state !== "paid") await activatePaidKeva(env, row, str(row.KevaId), enrollment);
  return true;
}

export async function reconcilePhoneKeva(env: Env, orderId: string, kevaId?: string) {
  if (!paymentsConfigured(env)) return;
  let lastId = "";
  for (let page = 0; page < 5; page++) {
    const rows = JSON.parse(await manageKeva(env, { Action: "GetKevaJson", MaxId: "2000", ...(lastId ? { LastId: lastId } : {}) }));
    if (!Array.isArray(rows)) throw new Error("Invalid standing order report");
    const matches = rows.filter(row => str(row.Groupe) === "dibura-" + orderId && (!kevaId || str(row.KevaId) === kevaId));
    if (matches.length > 1) return;
    if (matches.length === 1) { await activatePhoneKeva(env, matches[0]); return; }
    if (rows.length < 2000) return;
    lastId = str(rows.at(-1)?.KevaId);
    if (!/^\d+$/.test(lastId)) return;
  }
}

export async function syncKevas(env: Env, force = false): Promise<number> {
  if (!env.NEDARIM_MOSAD_ID || !env.NEDARIM_API_KEY) return 0;
  if (!force) {
    const last = await env.DB.prepare("SELECT MAX(synced_at) AS at FROM nedarim_kevas").first<{ at: string | null }>();
    if (last?.at && Date.now() - Date.parse(last.at) < 55 * 60_000) return 0;
  }
  const now = new Date().toISOString();
  let lastId = "";
  let total = 0;
  for (let page = 0; page < 5; page++) {
    const fields: Record<string, string> = { Action: "GetKevaJson", MaxId: "2000" };
    if (lastId) fields.LastId = lastId;
    const rows = JSON.parse(await manageKeva(env, fields));
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const kevaId = str(row.KevaId);
      if (!kevaId) continue;
      const phone = str(row.Phone);
      const digits = tail9(phone);
      const match = digits.length === 9
        ? await env.DB.prepare(
          "SELECT customer_id AS id FROM customer_phones WHERE substr(replace(replace(phone,'-',''),'+',''),-9)=?1 UNION SELECT id FROM customers WHERE substr(replace(replace(primary_phone,'-',''),'+',''),-9)=?1 LIMIT 1",
        ).bind(digits).first<{ id: string }>()
        : null;
      await env.DB.prepare(
        `INSERT INTO nedarim_kevas (keva_id,name,phone,mail,amount,groupe,comments,enabled,itra,success,error_text,creation_date,next_date,customer_id,raw,synced_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(keva_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,mail=excluded.mail,amount=excluded.amount,groupe=excluded.groupe,
         comments=excluded.comments,enabled=excluded.enabled,itra=excluded.itra,success=excluded.success,error_text=excluded.error_text,
         creation_date=excluded.creation_date,next_date=excluded.next_date,customer_id=excluded.customer_id,raw=excluded.raw,synced_at=excluded.synced_at`,
      ).bind(kevaId, str(row.ClientName), phone, str(row.Mail), str(row.Amount), str(row.Groupe), str(row.Comments), str(row.Enabled) === "1" ? 1 : 0,
        str(row.Itra), str(row.Success), str(row.ErrorText), str(row.CreationDate), str(row.NextDate), match?.id ?? null, JSON.stringify(row), now).run();
      await (async () => {
        if (!(await activatePhoneKeva(env, row))) await activatePaidKeva(env, row, kevaId);
      })().catch(() => console.error("Paid standing order activation failed"));
      lastId = kevaId;
      total++;
    }
    if (rows.length < 2000) break;
  }
  return total;
}

export async function listKevas(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT k.keva_id,k.name,k.phone,k.mail,k.amount,k.groupe,k.comments,k.enabled,k.itra,k.success,k.error_text,k.creation_date,k.next_date,k.customer_id,c.name AS customer_name,k.synced_at FROM nedarim_kevas k LEFT JOIN customers c ON c.id=k.customer_id ORDER BY k.creation_date DESC",
  ).all();
  return Response.json({ kevas: results });
}
