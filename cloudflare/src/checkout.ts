import { z } from "zod";
import { BusinessStore, PackageSchema } from "./business";
import { type Env, HttpError, nowIso, randomHex, sha256Hex } from "./env";
import { PREFIX, agorot, safeMessage } from "./payments";
import { addMonths, SubscriptionStore } from "./subscriptions";
import { vocabularyCatalog } from "./learning";

export const IFRAME_URL = "https://www.matara.pro/nedarimplus/iframe/";
const CREATE_URL = "https://matara.pro/nedarimplus/V6/Files/WebServices/DebitIframe.aspx?Action=CreateTransaction";
const MANAGE_URL = "https://matara.pro/nedarimplus/Reports/Manage3.aspx";
const ORDER_TTL_MS = 30 * 60_000;

type Pkg = z.output<typeof PackageSchema>;

const iframeMosad = (env: Env) => env.NEDARIM_IFRAME_MOSAD ?? env.NEDARIM_MOSAD_ID ?? "";
export const checkoutConfigured = (env: Env) =>
  /^[0-9]{1,7}$/.test(iframeMosad(env)) && !!env.NEDARIM_API_VALID && !!env.NEDARIM_API_KEY && !!env.NEDARIM_WEBHOOK_SECRET && /^[0-9]{7}$/.test(env.NEDARIM_MOSAD_ID ?? "");

export function webTerms(pkg: Pkg) {
  if (!pkg.active || pkg.price_ils <= 0 || pkg.billing === "yearly") return null;
  if (pkg.billing === "monthly") return { now: pkg.price_ils, monthly: pkg.price_ils, installments: 1 };
  return { now: pkg.price_ils, monthly: 0, installments: pkg.duration_months ?? 1 };
}

const MONTH_MS = 30 * 86400_000;
const ddmmyyyy = (d: Date) => [d.getUTCDate(), d.getUTCMonth() + 1].map((n) => String(n).padStart(2, "0")).join("/") + "/" + d.getUTCFullYear();

export function standingOrderStart(now = new Date()) {
  const first = new Date(now.getTime() + 30 * 86400_000);
  return { StartFrom: ddmmyyyy(first), Day: String(Math.min(first.getUTCDate(), 28)) };
}

async function createTransaction(env: Env, fields: Record<string, string>): Promise<string> {
  let data: Record<string, any> | null = null;
  try {
    const response = await fetch(CREATE_URL, {
      method: "POST",
      body: new URLSearchParams({ Mosad: iframeMosad(env), ApiValid: env.NEDARIM_API_VALID ?? "", Currency: "1", ...fields }),
      signal: AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch { /* handled below */ }
  if (data?.Status !== "OK" || !/^[0-9A-Za-z_-]{1,64}$/.test(String(data.ID ?? ""))) {
    throw new HttpError(502, data?.Message ? "נדרים פלוס: " + safeMessage(data.Message) : "לא הצלחנו לפתוח את התשלום כרגע. כדאי לנסות שוב בעוד רגע.");
  }
  return String(data.ID);
}

async function manage(env: Env, fields: Record<string, string>) {
  const response = await fetch(MANAGE_URL, {
    method: "POST",
    body: new URLSearchParams({ MosadId: env.NEDARIM_MOSAD_ID ?? "", ApiPassword: env.NEDARIM_API_KEY ?? "", ...fields }),
    signal: AbortSignal.timeout(15000),
  });
  return response.text();
}

export class CheckoutStore {
  db: D1Database;
  constructor(public business: BusinessStore) {
    this.db = business.db;
  }

  async start(env: Env, customerId: string, packageId: string, domain?: string) {
    if (!checkoutConfigured(env)) throw new HttpError(503, "התשלום באתר עוד לא פתוח. אפשר להצטרף דרך נציג.");
    if (customerId.startsWith("anonymous-")) throw new HttpError(403, "כדי לשלם צריך להתחבר עם מספר טלפון.");
    const body = await this.business.record("packages", packageId);
    const customer = await this.business.record("customers", customerId);
    if (!body || !customer) throw new HttpError(404, "המסלול לא נמצא.");
    const pkg = PackageSchema.parse(body);
    if (pkg.duration_months === 12 && (!domain || domain === "everyday" || !vocabularyCatalog.some(t => t.domain === domain))) throw new HttpError(422, "יש לבחור תחום אוצר מילים נוסף למסלול שליטה מלאה.");
    const terms = webTerms(pkg);
    if (!terms) throw new HttpError(422, "המסלול הזה לא פתוח לרכישה באתר.");
    const cutoff = new Date(Date.now() - ORDER_TTL_MS).toISOString().replace("Z", "+00:00");
    const reusable = await this.db.prepare(
      "SELECT id,snapshot FROM payment_orders WHERE customer_id=? AND package_id=? AND channel='web' AND state='issued' AND created_at>? ORDER BY created_at DESC LIMIT 1",
    ).bind(customerId, packageId, cutoff).first<{ id: string; snapshot: string }>();
    if (reusable) {
      if (pkg.duration_months === 12 && domain) await this.db.prepare("UPDATE payment_orders SET snapshot=?,updated_at=? WHERE id=? AND state='issued'").bind(JSON.stringify({ ...JSON.parse(reusable.snapshot), guarantee_domain: domain }), nowIso(), reusable.id).run();
      return this.view(reusable.id, customerId);
    }
    const unfinished = await this.db.prepare(
      "SELECT o.id FROM payment_orders o JOIN standing_orders s ON s.id=o.subscription_id WHERE o.customer_id=? AND o.package_id=? AND o.state='paid' AND s.state='pending' ORDER BY o.created_at DESC LIMIT 1",
    ).bind(customerId, packageId).first<{ id: string }>();
    if (unfinished) return this.view(unfinished.id, customerId);
    const orderId = randomHex(16);
    const subscriptionId = terms.monthly ? randomHex(16) : null;
    const amount = agorot(terms.now);
    const payer = { FirstName: String(customer.name ?? "").slice(0, 50), Phone: String(customer.phone ?? "").replace(/\D/g, "").slice(0, 20) };
    const charge = await createTransaction(env, {
      ...payer, PaymentType: "Ragil", Amount: String(amount / 100), Tashlumim: String(terms.installments),
      Groupe: PREFIX + orderId, Param1: orderId, Comment: pkg.name, AjaxId: orderId,
    });
    let keva: string | null = null;
    if (subscriptionId) {
      keva = await createTransaction(env, {
        ...payer, PaymentType: "HK", Amount: String(agorot(terms.monthly) / 100), Tashlumim: "",
        Groupe: PREFIX + subscriptionId, Param1: subscriptionId, Comment: pkg.name + " · הוראת קבע", AjaxId: subscriptionId, ...standingOrderStart(),
      });
    }
    const now = nowIso();
    const vat = (await this.business.economics()).vat_rate;
    const statements = [
      this.db.prepare(
        "INSERT INTO payment_orders (id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at,channel,installments,provider_ref,subscription_id) VALUES (?,?,?,?,?,?,?,'issued',?,?,'web',?,?,?)",
      ).bind(orderId, "web-" + orderId, customerId, packageId, JSON.stringify({ ...pkg, guarantee_domain: domain }), amount, vat, now, now, terms.installments, charge, subscriptionId),
    ];
    if (subscriptionId) {
      statements.push(this.db.prepare(
        "INSERT INTO standing_orders (id,customer_id,package_id,snapshot,monthly_agorot,first_order_id,state,provider_ref,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?,?)",
      ).bind(subscriptionId, customerId, packageId, JSON.stringify(pkg), agorot(terms.monthly), orderId, keva, now, now));
    }
    await this.db.batch(statements);
    await this.business.audit("payment:web_checkout", orderId);
    return this.view(orderId, customerId);
  }

  async view(orderId: string, customerId: string) {
    const order = await this.db.prepare("SELECT * FROM payment_orders WHERE id=? AND customer_id=? AND channel='web'").bind(orderId, customerId).first<Record<string, any>>();
    if (!order) throw new HttpError(404, "התשלום לא נמצא.");
    const sub = order.subscription_id ? await this.db.prepare("SELECT * FROM standing_orders WHERE id=?").bind(order.subscription_id).first<Record<string, any>>() : null;
    const pkg = JSON.parse(order.snapshot);
    const steps: { kind: "charge" | "keva"; id: string }[] = [];
    if (order.state === "issued" && Date.now() - Date.parse(order.created_at) < ORDER_TTL_MS) steps.push({ kind: "charge", id: order.provider_ref });
    if (sub && sub.state === "pending" && sub.provider_ref) steps.push({ kind: "keva", id: sub.provider_ref });
    return {
      id: order.id, state: order.state, package_id: order.package_id, package_name: pkg.name, minutes: pkg.minutes, validity_days: pkg.validity_days,
      amount_ils: order.amount_agorot / 100, installments: order.installments,
      subscription: sub ? { id: sub.id, state: sub.state, monthly_ils: sub.monthly_agorot / 100, next_date: sub.next_date ?? standingOrderStart(new Date(sub.created_at)).StartFrom } : null,
      steps, iframe_url: IFRAME_URL + "?Picture=Hide" + (order.installments > 1 ? "&MaxPayments=" + order.installments : ""),
    };
  }

  async activate(subscriptionId: string, kevaId: string, nextDate: string) {
    const result = await this.db.prepare(
      "UPDATE standing_orders SET state='active',keva_id=?,next_date=?,updated_at=? WHERE id=? AND state IN ('pending','failed') AND (keva_id IS NULL OR keva_id=?)",
    ).bind(kevaId, nextDate || null, nowIso(), subscriptionId, kevaId).run();
    if (result.meta.changes) await this.business.audit("payment:keva_active", subscriptionId);
    return !!result.meta.changes;
  }

  // The browser reports the standing-order id; it is trusted only after the provider confirms it.
  async confirmKeva(env: Env, orderId: string, customerId: string, kevaId: string) {
    if (!/^[0-9]{1,20}$/.test(kevaId)) throw new HttpError(422, "מזהה הוראת קבע לא תקין.");
    const order = await this.db.prepare("SELECT subscription_id FROM payment_orders WHERE id=? AND customer_id=? AND channel='web'").bind(orderId, customerId).first<{ subscription_id: string | null }>();
    const sub = order?.subscription_id ? await this.db.prepare("SELECT * FROM standing_orders WHERE id=?").bind(order.subscription_id).first<Record<string, any>>() : null;
    if (!sub) throw new HttpError(404, "המנוי לא נמצא.");
    if (sub.state === "active" && sub.keva_id === kevaId) return this.view(orderId, customerId);
    let keva: Record<string, any> = {};
    try { keva = JSON.parse(await manage(env, { Action: "GetKevaId", KevaId: kevaId })); } catch { /* treated as unverified */ }
    if (String(keva.KevaId ?? "") !== kevaId || String(keva.KevaStatus ?? "") !== "1" || String(keva.KevaGroupe ?? "") !== PREFIX + sub.id) {
      throw new HttpError(409, "עוד לא קיבלנו אישור מנדרים פלוס להוראת הקבע. ננסה שוב בעוד רגע.");
    }
    if (agorot(keva.KevaAmount) !== sub.monthly_agorot) throw new HttpError(409, "סכום הוראת הקבע אינו תואם. נבדוק ונחזור אליך.");
    await this.activate(sub.id, kevaId, String(keva.KevaNextDate ?? ""));
    return this.view(orderId, customerId);
  }

  // Signed standing-order creation webhook.
  async kevaCreated(data: Record<string, any>, mosadId: string) {
    if (String(data.MosadNumber ?? "") !== mosadId) throw new Error("Wrong institution");
    const subId = String(data.Groupe ?? "").slice(PREFIX.length);
    if (!String(data.Groupe ?? "").startsWith(PREFIX) || !/^[0-9a-f]{32}$/.test(subId)) return { ignored: true };
    const sub = await this.db.prepare("SELECT * FROM standing_orders WHERE id=?").bind(subId).first<Record<string, any>>();
    if (!sub) return { ignored: true };
    if (agorot(data.Amount) !== sub.monthly_agorot || String(data.Currency ?? "1") !== "1") throw new Error("Standing order amount mismatch");
    return { active: await this.activate(subId, String(data.KevaId), String(data.NextDate ?? "")) || sub.state === "active" };
  }

  // Signed monthly charge of an active standing order: one receipt per provider transaction.
  async kevaCharge(data: Record<string, any>, mosadId: string) {
    const kevaId = String(data.KevaId);
    const transactionId = String(data.TransactionId ?? "");
    let sub = await this.db.prepare("SELECT * FROM standing_orders WHERE keva_id=?").bind(kevaId).first<Record<string, any>>();
    if (!sub) {
      const subId = String(data.Groupe ?? "").startsWith(PREFIX) ? String(data.Groupe).slice(PREFIX.length) : "";
      sub = /^[0-9a-f]{32}$/.test(subId) ? await this.db.prepare("SELECT * FROM standing_orders WHERE id=? AND keva_id IS NULL").bind(subId).first<Record<string, any>>() : null;
      if (!sub) return { ignored: true };
      await this.activate(sub.id, kevaId, "");
    }
    if (!/^[0-9]{1,30}$/.test(transactionId) || !data.Confirmation || String(data.Currency ?? "") !== "1") throw new Error("Invalid settlement");
    const subscriptions = new SubscriptionStore(this.db);
    if (!sub.entitlement_id) {
      const order = await this.db.prepare("SELECT o.id,r.id AS receipt_id,r.created_at FROM payment_orders o JOIN sales_receipts r ON r.id=o.receipt_id AND r.customer_id=o.customer_id WHERE o.id=? AND o.channel='web' AND o.state='paid'").bind(sub.first_order_id).first<{ id: string; receipt_id: string; created_at: string }>();
      if (!order || sub.state === "cancelled") throw new Error("First payment must settle before renewal");
      const pkg = PackageSchema.parse(JSON.parse(sub.snapshot));
      const receipts = (await this.db.prepare(`SELECT r.id,r.created_at,r.valid_from FROM sales_receipts r
        WHERE r.customer_id=? AND r.package_id=? AND (r.id=? OR (r.reference LIKE ? AND EXISTS
          (SELECT 1 FROM console_audit a WHERE a.action='payment:keva_charge' AND a.entity_id=? AND a.created_at=r.created_at)))
        ORDER BY r.created_at,r.id`).bind(sub.customer_id, sub.package_id, order.receipt_id, `nedarim:${mosadId}:%`, sub.id).all<{ id: string; created_at: string; valid_from: string | null }>()).results;
      const latest = receipts[receipts.length - 1];
      const start = latest.valid_from ?? latest.created_at;
      const entitlement = await subscriptions.create(sub.customer_id, sub.package_id, order.created_at, undefined, {
        id: order.id, priceAgorot: agorot(pkg.price_ils), monthlyMinutes: pkg.minutes, termMonths: null, grantFirstPeriod: false,
        period: { number: receipts.length, start, end: addMonths(start, 1) },
        statements: [
          ...receipts.map(r => this.db.prepare("UPDATE sales_receipts SET subscription_id=?,valid_from=COALESCE(valid_from,created_at) WHERE id=?").bind(order.id, r.id)),
          this.db.prepare("UPDATE payment_orders SET entitlement_id=? WHERE id=?").bind(order.id, order.id),
          this.db.prepare("UPDATE standing_orders SET entitlement_id=? WHERE id=?").bind(order.id, sub.id),
        ],
      });
      sub.entitlement_id = entitlement.id;
    }
    const reference = `nedarim-keva:${kevaId}:${transactionId}`;
    const legacy = await this.db.prepare("SELECT id,amount_ils,customer_id,subscription_id FROM sales_receipts WHERE reference=?").bind(`nedarim:${mosadId}:${transactionId}`).first<{ id: string; amount_ils: number; customer_id: string; subscription_id: string | null }>();
    if (legacy) {
      if (legacy.customer_id !== sub.customer_id || legacy.subscription_id !== sub.entitlement_id || agorot(data.Amount) !== agorot(legacy.amount_ils)) throw new Error("Payment amount mismatch");
      return { paid: true, receipt_id: legacy.id, duplicate: true };
    }
    const existing = await this.db.prepare("SELECT r.id,r.amount_ils FROM subscription_renewals n JOIN sales_receipts r ON r.subscription_id=n.subscription_id AND r.reference='subscription:'||n.subscription_id||':'||n.period_start WHERE n.reference=? AND n.subscription_id=?").bind(reference, sub.entitlement_id).first<{ id: string; amount_ils: number }>();
    if (existing) {
      if (agorot(data.Amount) !== agorot(existing.amount_ils)) throw new Error("Payment amount mismatch");
      return { paid: true, receipt_id: existing.id, duplicate: true };
    }
    const expected = await subscriptions.renewalAmount(sub.entitlement_id);
    const amount = agorot(data.Amount);
    if (amount !== expected && amount !== sub.monthly_agorot) throw new Error("Payment amount mismatch");
    const now = nowIso();
    const renewed = await subscriptions.recordRenewal(sub.entitlement_id, now, reference, { amountAgorot: agorot(data.Amount), vatRate: (await this.business.economics()).vat_rate, statements: [
      ...(amount === expected ? [] : [this.db.prepare("INSERT OR IGNORE INTO payment_issues(id,order_id,kind,message,created_at) VALUES (?,?,?,?,?)").bind((await sha256Hex("subscription_amount_difference:" + reference)).slice(0, 32), sub.first_order_id, "subscription_amount_difference", `הפרש גבייה במנוי: נדרש ${expected / 100} ₪, חויב ${amount / 100} ₪, יתרה להסדרה ${(expected - amount) / 100} ₪`, now)]),
      this.db.prepare("UPDATE standing_orders SET state=CASE WHEN state='cancelled' THEN state ELSE 'active' END,last_charge_at=?,next_date=?,updated_at=? WHERE id=?").bind(now, ddmmyyyy(new Date(Date.now() + MONTH_MS)), now, sub.id),
      this.db.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)").bind("payment:keva_charge", sub.id, now),
    ] });
    const receipt = await this.db.prepare("SELECT r.id FROM subscription_renewals n JOIN sales_receipts r ON r.reference='subscription:'||n.subscription_id||':'||n.period_start WHERE n.reference=?").bind(reference).first<{ id: string }>();
    return { paid: true, receipt_id: receipt?.id, customer_id: sub.customer_id, subscription_id: renewed.id };
  }

  async kevaRefused(data: Record<string, any>) {
    const sub = await this.db.prepare("SELECT * FROM standing_orders WHERE keva_id=?").bind(String(data.KevaId)).first<Record<string, any>>();
    if (!sub) return { ignored: true };
    const now = nowIso();
    await this.db.batch([
      this.db.prepare("INSERT OR IGNORE INTO payment_issues (id,order_id,kind,message,created_at) VALUES (?,?,?,?,?)").bind((await sha256Hex("keva_refusal:" + JSON.stringify(data))).slice(0, 32), sub.first_order_id, "keva_refusal", safeMessage(data.Message ?? "חיוב הוראת הקבע סורב"), now),
      this.db.prepare("UPDATE standing_orders SET state='past_due',updated_at=? WHERE id=? AND state='active'").bind(now, sub.id),
      this.db.prepare("UPDATE subscriptions SET status=CASE WHEN status='paused' THEN 'paused' ELSE 'past_due' END,resume_status='past_due',updated_at=? WHERE id=? AND status IN ('active','paused')").bind(now, sub.entitlement_id),
    ]);
    return { recorded: true };
  }

  async cancel(env: Env, subscriptionId: string, customerId: string) {
    const sub = await this.db.prepare("SELECT * FROM standing_orders WHERE id=? AND customer_id=?").bind(subscriptionId, customerId).first<Record<string, any>>();
    if (!sub) throw new HttpError(404, "המנוי לא נמצא.");
    if (sub.state === "cancelled") {
      if (sub.entitlement_id) await new SubscriptionStore(this.db).cancel(sub.entitlement_id);
      return { cancelled: true };
    }
    if (!sub.keva_id) throw new HttpError(409, "הוראת הקבע עוד לא הוקמה. אם חויבת, פנה אלינו ונבטל ידנית.");
    {
      const text = (await manage(env, { Action: "DeleteKeva", KevaId: sub.keva_id }).catch(() => "")).trim();
      if (text !== "OK") throw new HttpError(502, "לא הצלחנו לבטל מול נדרים פלוס כרגע. נסו שוב או פנו לשירות.");
    }
    const now = nowIso();
    if (sub.entitlement_id) await new SubscriptionStore(this.db).cancel(sub.entitlement_id, now);
    await this.db.prepare("UPDATE standing_orders SET state='cancelled',cancelled_at=?,updated_at=? WHERE id=?").bind(now, now, sub.id).run();
    await this.business.audit("payment:keva_cancelled", sub.id);
    return { cancelled: true };
  }

  async billing(customerId: string) {
    const subs = await this.db.prepare("SELECT * FROM standing_orders WHERE customer_id=? AND state IN ('active','past_due') ORDER BY created_at DESC").bind(customerId).all<Record<string, any>>();
    return {
      subscriptions: subs.results.map((s) => ({ id: s.id, state: s.state, package_name: JSON.parse(s.snapshot).name, monthly_ils: s.monthly_agorot / 100, next_date: s.next_date, last_charge_at: s.last_charge_at })),
    };
  }
}

export async function checkoutRoutes(request: Request, env: Env, path: string, customerId: string): Promise<Response | null> {
  if (!path.startsWith("/v1/portal/checkout") && !path.startsWith("/v1/portal/subscriptions") && path !== "/v1/portal/billing") return null;
  const store = new CheckoutStore(new BusinessStore(env.DB));
  const noCache = { "Cache-Control": "no-store" };
  const json = async <T extends z.ZodTypeAny>(schema: T): Promise<z.output<T>> => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, "הבקשה אינה תקינה.");
    return parsed.data;
  };
  if (path === "/v1/portal/billing" && request.method === "GET") return Response.json(await store.billing(customerId), { headers: noCache });
  if (path === "/v1/portal/checkout" && request.method === "POST") {
    const input = await json(z.object({ package_id: z.string().regex(/^[a-z0-9-]{1,40}$/), domain: z.string().max(40).optional() }));
    return Response.json(await store.start(env, customerId, input.package_id, input.domain), { headers: noCache });
  }
  const order = path.match(/^\/v1\/portal\/checkout\/([a-f0-9]{32})(\/keva)?$/);
  if (order && !order[2] && request.method === "GET") return Response.json(await store.view(order[1], customerId), { headers: noCache });
  if (order && order[2] && request.method === "POST") {
    const input = await json(z.object({ keva_id: z.string().max(20) }));
    return Response.json(await store.confirmKeva(env, order[1], customerId, input.keva_id), { headers: noCache });
  }
  const cancel = path.match(/^\/v1\/portal\/subscriptions\/([a-f0-9]{32})\/cancel$/);
  if (cancel && request.method === "POST") return Response.json(await store.cancel(env, cancel[1], customerId), { headers: noCache });
  return null;
}
