import { BusinessStore, PackageSchema } from "./business";
import { type Env, HttpError, nowIso, paymentsConfigured, randomHex, secureEqual } from "./env";

export const PREFIX = "dibura-";

export function safeMessage(value: unknown): string {
  let text = String(value).replace(/<[^>]*>/g, " ");
  text = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  text = text.replace(/(?:\d[ -]?){8,}/g, "[פרטים הוסתרו]");
  text = text.replace(/(cvv\s*[:=]?\s*)\d{3,4}/gi, "$1[הוסתר]");
  return text.split(/\s+/).filter(Boolean).join(" ").slice(0, 500);
}

export function agorot(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text) && !/^\d+\.\d*0*$/.test(text)) throw new Error("Invalid payment amount");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.replace(/0+$/, "").length > 2) throw new Error("Invalid payment amount");
  const result = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isFinite(result) || result <= 0) throw new Error("Invalid payment amount");
  return result;
}

async function hmacHex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySignature(raw: Uint8Array, headers: Headers, secret: string, now = Date.now() / 1000): Promise<boolean> {
  const timestamp = headers.get("x-nedarim-timestamp") ?? "";
  const signature = headers.get("x-nedarim-signature") ?? "";
  if (!/^[0-9]{1,12}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300) return false;
  const signed = new Uint8Array([...new TextEncoder().encode(timestamp + "."), ...raw]);
  return secureEqual(signature, "v1=" + (await hmacHex(secret, signed)));
}

export class PaymentStore {
  private db: D1Database;
  constructor(public business: BusinessStore) {
    this.db = business.db;
  }

  async issueForData(data: Record<string, any>, kind: string, message: unknown): Promise<boolean> {
    const category = String(data.Groupe ?? "");
    const orderId = category.startsWith(PREFIX) ? category.slice(PREFIX.length) : "";
    if (!/^[0-9a-f]{32}$/.test(orderId)) return false;
    const clean = kind !== "settlement_review" ? safeMessage(message) : "אי התאמה באישור התשלום, זיכוי או ביטול. יש לבדוק את העסקה מול נדרים פלוס.";
    const fingerprint = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([orderId, kind, clean, String(data.TransactionId ?? "")])))),
    ].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!(await this.db.prepare("SELECT 1 FROM payment_orders WHERE id=?").bind(orderId).first())) return false;
    await this.db.prepare("INSERT OR IGNORE INTO payment_issues (id,order_id,kind,message,created_at) VALUES (?,?,?,?,?)").bind(fingerprint, orderId, kind, clean, nowIso()).run();
    return true;
  }

  async refusal(data: Record<string, any>, mosadId: string) {
    if (String(data.MosadNumber ?? "") !== mosadId) throw new Error("Wrong institution");
    if (String(data.Status ?? "").toLowerCase() !== "error") throw new Error("Invalid refusal");
    if (!(await this.issueForData(data, "refusal", data.Message ?? "החיוב סורב"))) return { ignored: true };
    const orderId = String(data.Groupe).slice(PREFIX.length);
    await this.db.prepare("UPDATE payment_orders SET state='failed',updated_at=? WHERE id=? AND state IN ('issued','awaiting_settlement')").bind(nowIso(), orderId).run();
    return { recorded: true };
  }

  async resolveIssue(issueId: string, note: string) {
    const clean = safeMessage(note);
    if (!clean) throw new Error("יש לציין מה נעשה לטיפול בבעיה");
    const result = await this.db.prepare("UPDATE payment_issues SET status='resolved',resolved_at=?,resolution=? WHERE id=? AND status='open'").bind(nowIso(), clean, issueId).run();
    if (result.meta.changes) await this.business.audit("payment:issue_resolved", issueId);
    return { resolved: !!result.meta.changes };
  }

  async providerRows(env: Env, action: string, lastId: number): Promise<Record<string, any>[]> {
    try {
      const response = await fetch("https://matara.pro/nedarimplus/Reports/Manage3.aspx", {
        method: "POST",
        body: new URLSearchParams({ Action: action, MosadId: env.NEDARIM_MOSAD_ID ?? "", ApiPassword: env.NEDARIM_API_KEY ?? "", LastId: String(lastId), MaxId: "2000" }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!Array.isArray(data) || data.length > 2000) throw new Error("Unexpected provider response");
      return data;
    } catch {
      throw new Error("לא ניתן לקרוא את דוח נדרים פלוס כרגע");
    }
  }

  async reconcile(env: Env) {
    if (!env.NEDARIM_API_KEY) throw new Error("מפתח נדרים אינו מוגדר");
    const mosad = env.NEDARIM_MOSAD_ID ?? "";
    const report: Record<string, unknown> = {};
    for (const [action, idField] of [["GetHistoryJson", "TransactionId"], ["GetErrorLogsJson", "ID"]] as const) {
      await this.db.prepare("INSERT OR IGNORE INTO payment_sync(action) VALUES (?)").bind(action).run();
      const state = await this.db.prepare("SELECT * FROM payment_sync WHERE action=?").bind(action).first<Record<string, any>>();
      if (Date.now() / 1000 - Number(state!.attempted_at) < 180) {
        report[action] = { limited: true };
        continue;
      }
      let cursor = Number(state!.last_id);
      await this.db.prepare("UPDATE payment_sync SET attempted_at=? WHERE action=?").bind(Date.now() / 1000, action).run();
      try {
        const rows = await this.providerRows(env, action, cursor);
        let matched = 0;
        for (const row of rows) {
          if (!row || typeof row !== "object" || !/^\d+$/.test(String(row[idField] ?? ""))) throw new Error("מבנה דוח הספק אינו תקין");
          const event: Record<string, any> = { ...row, MosadNumber: mosad };
          let result: Record<string, unknown>;
          if (action === "GetErrorLogsJson") {
            event.Status = "Error";
            event.Message = row.Error ?? "החיוב סורב";
            result = await this.refusal(event, mosad);
          } else {
            try {
              result = await this.settle(event, mosad);
            } catch (error) {
              await this.issueForData(event, "settlement_review", String(error));
              result = { review: true };
            }
          }
          if (!result.ignored) matched++;
          cursor = Math.max(cursor, Number(row[idField]));
          await this.db.prepare("UPDATE payment_sync SET last_id=? WHERE action=?").bind(cursor, action).run();
        }
        await this.db.prepare("UPDATE payment_sync SET completed_at=?,last_error='' WHERE action=?").bind(nowIso(), action).run();
        report[action] = { received: rows.length, matched, more: rows.length === 2000 };
      } catch (error) {
        const message = safeMessage(String((error as Error).message ?? error));
        await this.db.prepare("UPDATE payment_sync SET last_error=? WHERE action=?").bind(message, action).run();
        report[action] = { error: message };
      }
    }
    return report;
  }

  async orderForCall(callId: string) {
    return this.db.prepare("SELECT * FROM payment_orders WHERE call_id=?").bind(callId).first<Record<string, any>>();
  }

  async cancelSelection(callId: string) {
    await this.db.prepare("UPDATE payment_orders SET state='cancelled',updated_at=? WHERE call_id=? AND state='selected'").bind(nowIso(), callId).run();
  }

  async overview(env: Env, offset = 0, limit = 50, customerId = "", state = "", search = "") {
    const customers = Object.fromEntries((await this.business.list("customers")).map((c) => [c.id, c]));
    const [ordersR, receiptsR, issuesR, syncR] = await this.db.batch<Record<string, any>>([
      this.db.prepare("SELECT * FROM payment_orders ORDER BY created_at DESC,id DESC"),
      this.db.prepare("SELECT * FROM sales_receipts"),
      this.db.prepare("SELECT * FROM payment_issues ORDER BY created_at DESC,id DESC"),
      this.db.prepare("SELECT * FROM payment_sync ORDER BY action"),
    ]);
    const orders = ordersR.results, issues = issuesR.results;
    const summaries: Record<string, any> = Object.fromEntries(
      Object.keys(customers).map((k) => [k, { has_paid: false, paid_ils: 0, verified_ils: 0, manual_ils: 0, latest_state: "none", open_issues: 0 }]),
    );
    let verifiedTotal = 0, manualTotal = 0;
    for (const receipt of receiptsR.results) {
      const verified = String(receipt.reference).startsWith("nedarim:");
      if (verified) verifiedTotal += receipt.amount_ils;
      else manualTotal += receipt.amount_ils;
      const summary = summaries[receipt.customer_id];
      if (summary) {
        summary.paid_ils += receipt.amount_ils;
        summary[verified ? "verified_ils" : "manual_ils"] += receipt.amount_ils;
        summary.has_paid = summary.paid_ils > 0;
      }
    }
    const byOrder = Object.fromEntries(orders.map((o) => [o.id, o]));
    for (const issue of issues) {
      const order = byOrder[issue.order_id] ?? {};
      const customer = customers[order.customer_id] ?? {};
      const pkg = order.snapshot ? JSON.parse(order.snapshot) : {};
      Object.assign(issue, { customer_id: order.customer_id, customer_name: customer.name, customer_phone: customer.phone, package_name: pkg.name });
      if (summaries[order.customer_id] && issue.status === "open") summaries[order.customer_id].open_issues++;
    }
    const counts: Record<string, number> = {};
    let pending = 0, stale = 0;
    for (const order of orders) {
      counts[order.state] = (counts[order.state] ?? 0) + 1;
      const pkg = JSON.parse(order.snapshot);
      delete order.snapshot;
      const customer = customers[order.customer_id] ?? {};
      Object.assign(order, { package_name: pkg.name, product: pkg.product, customer_name: customer.name ?? "לקוח לא זמין", customer_phone: customer.phone ?? "" });
      const summary = summaries[order.customer_id];
      if (summary && summary.latest_state === "none") summary.latest_state = order.state;
      const open = order.state === "issued" || order.state === "awaiting_settlement";
      order.pending_review = open && (Date.now() - Date.parse(order.updated_at)) / 1000 > 900;
      if (order.pending_review) stale++;
      if (open) pending += order.amount_agorot / 100;
      delete order.call_id;
    }
    const needle = search.toLowerCase();
    const filtered = orders.filter(
      (o) => (!customerId || o.customer_id === customerId) && (!state || o.state === state) &&
        (!search || `${o.customer_name} ${o.customer_phone} ${o.id}`.toLowerCase().includes(needle)),
    );
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      configured: paymentsConfigured(env),
      mosad_id: env.NEDARIM_MOSAD_ID ?? "",
      phone_terminal: env.NEDARIM_PHONE_TERMINAL ?? "",
      orders: filtered.slice(offset, offset + limit),
      total: filtered.length, offset, limit, counts,
      issues: issues.filter((i) => !customerId || i.customer_id === customerId).slice(0, 100),
      open_issues: issues.filter((i) => i.status === "open").length,
      customer_summaries: summaries,
      totals: { verified_ils: round(verifiedTotal), manual_ils: round(manualTotal), pending_ils: round(pending), pending_review: stale },
      sync: syncR.results,
      settlement: "signed_webhook_or_authenticated_history",
    };
  }

  async create(callId: string, customerId: string, packageId: string, allowHidden = false) {
    if (customerId.startsWith("anonymous-")) throw new Error("A recognized caller is required");
    const existing = await this.orderForCall(callId);
    if (existing) {
      if (existing.customer_id !== customerId) throw new Error("Customer mismatch");
      return existing;
    }
    const body = await this.business.record("packages", packageId);
    const customer = await this.business.record("customers", customerId);
    if (!body || !customer) throw new Error("Unknown customer or package");
    const pkg = PackageSchema.parse(body);
    if (!pkg.active || (!allowHidden && !pkg.phone_enabled)) throw new Error("Inactive package");
    const amount = agorot(pkg.price_ils);
    const orderId = randomHex(16);
    const now = nowIso();
    await this.db
      .prepare("INSERT INTO payment_orders (id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'selected',?,?)")
      .bind(orderId, callId, customerId, packageId, JSON.stringify(pkg), amount, (await this.business.economics()).vat_rate, now, now)
      .run();
    return (await this.db.prepare("SELECT * FROM payment_orders WHERE id=?").bind(orderId).first<Record<string, any>>())!;
  }

  async issue(callId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
    const result = await this.db
      .prepare("UPDATE payment_orders SET state='issued',updated_at=? WHERE call_id=? AND state='selected' AND created_at>?")
      .bind(nowIso(), callId, cutoff)
      .run();
    return result.meta.changes === 1;
  }

  async recordPbxResult(callId: string, status: string, confirmation: string) {
    await this.db
      .prepare("UPDATE payment_orders SET state=?,confirmation=?,updated_at=? WHERE call_id=? AND state='issued'")
      .bind(status === "OK" ? "awaiting_settlement" : "failed", String(confirmation).slice(0, 100), nowIso(), callId)
      .run();
    const order = await this.db.prepare("SELECT id FROM payment_orders WHERE call_id=?").bind(callId).first<{ id: string }>();
    if (order && status !== "OK") {
      await this.issueForData({ Groupe: PREFIX + order.id }, "pbx_failure", "הפעולה בקו הסתיימה ללא אישור: ביטול, סירוב או תקלה.");
    }
  }

  async settle(data: Record<string, any>, mosadId: string): Promise<Record<string, unknown>> {
    if (String(data.MosadNumber ?? "") !== mosadId) throw new Error("Wrong institution");
    if (![undefined, null, "", "OK"].includes(data.Status)) return { ignored: true };
    const category = String(data.Groupe ?? "");
    if (!category.startsWith(PREFIX)) return { ignored: true };
    const orderId = category.slice(PREFIX.length);
    if (!/^[0-9a-f]{32}$/.test(orderId)) return { ignored: true };
    const transactionId = String(data.TransactionId ?? "");
    const confirmation = String(data.Confirmation ?? "");
    if (!/^[0-9]{1,30}$/.test(transactionId) || !confirmation || confirmation.length > 100 || String(data.Currency ?? "") !== "1" || !["", "0"].includes(String(data.KevaId ?? ""))) {
      throw new Error("Invalid settlement");
    }
    const amount = agorot(data.Amount);
    const order = await this.db.prepare("SELECT * FROM payment_orders WHERE id=?").bind(orderId).first<Record<string, any>>();
    if (!order) return { ignored: true };
    if (amount !== order.amount_agorot) throw new Error("Payment amount mismatch");
    if (order.state === "paid") {
      if (order.transaction_id !== transactionId) throw new Error("Additional transaction requires review");
      return { paid: true, receipt_id: order.receipt_id, duplicate: true };
    }
    if (!["issued", "awaiting_settlement", "failed"].includes(order.state)) throw new Error("Order was not confirmed");
    if (order.confirmation && confirmation !== order.confirmation) throw new Error("Confirmation mismatch");
    const pkg = PackageSchema.parse(JSON.parse(order.snapshot));
    const receiptId = randomHex(10);
    const now = nowIso();
    const expires = new Date(Date.now() + pkg.validity_days * 86400_000).toISOString().replace("Z", "+00:00");
    await this.db.batch([
      this.db.prepare("INSERT INTO sales_receipts VALUES (?,?,?,?,?,?,?,?,?,?)").bind(
        receiptId, order.customer_id, order.package_id, pkg.product, `nedarim:${mosadId}:${transactionId}`, amount / 100, order.vat_rate, pkg.minutes, expires, now,
      ),
      this.db.prepare("UPDATE payment_orders SET state='paid',transaction_id=?,confirmation=?,receipt_id=?,updated_at=? WHERE id=? AND state!='paid'").bind(transactionId, confirmation, receiptId, now, orderId),
      this.db.prepare("UPDATE payment_issues SET status='resolved',resolved_at=?,resolution='התשלום אושר מול הסולק' WHERE order_id=? AND status='open' AND kind IN ('refusal','pbx_failure')").bind(now, orderId),
      this.db.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)").bind("payment:nedarim_verified", orderId, now),
    ]);
    return { paid: true, receipt_id: receiptId, customer_id: order.customer_id, package_id: order.package_id, amount_ils: amount / 100 };
  }
}

const selectionMenu = (name: string, text: string, keys = "0,9") => ({
  type: "simpleMenu", name, enabledKeys: keys, times: 2, timeout: 10, errorReturn: "ERROR", post: true, files: [{ text }],
});

export async function paymentResponse(store: PaymentStore, env: Env, base: string, params: Record<string, string>, customerId: string, packageIds: string[]): Promise<Record<string, unknown>> {
  const callId = params.PBXcallId;
  let order = await store.orderForCall(callId);
  if (order && params.isaacPayStatus) {
    await store.recordPbxResult(callId, params.isaacPayStatus, params.CONFIRM_isaacPayStatus ?? "");
    order = await store.orderForCall(callId);
  }
  if (params.PBXcallStatus === "HANGUP") {
    await store.cancelSelection(callId);
    return { type: "hangup" };
  }
  if (["0", "9", "ERROR"].includes(params.isaacPayExit)) {
    return { type: "goTo", goTo: base + (params.isaacPayExit === "9" ? "/4" : ""), removeParams: ["isaacPackage", "isaacPayConfirm", "isaacPayExit", "isaacSales"] };
  }
  if (!paymentsConfigured(env)) return selectionMenu("isaacPayExit", "התשלום הטלפוני אינו זמין כרגע. לשירות הקישו 9. לחזרה הקישו 0.");
  if (customerId.startsWith("anonymous-")) return selectionMenu("isaacPayExit", "לרכישת חבילה יש להתקשר ממספר גלוי. לשירות הקישו 9. לחזרה הקישו 0.");
  if (order) {
    const state = order.state;
    if (state === "paid") return selectionMenu("isaacPayExit", "התשלום אושר והחבילה נפתחה עבורכם. לחזרה הקישו 0. לשירות הקישו 9.");
    if (state !== "selected") {
      const message = state === "failed" || state === "cancelled"
        ? "התשלום לא אושר או שהרכישה בוטלה."
        : "ממתינים לאישור חברת הסליקה. החבילה תיפתח אוטומטית לאחר קבלת האישור. אין לבצע תשלום נוסף.";
      return selectionMenu("isaacPayExit", message + " לחזרה הקישו 0. לשירות הקישו 9.");
    }
    if (["0", "ERROR"].includes(params.isaacPayConfirm)) {
      await store.cancelSelection(callId);
      return { type: "goTo", goTo: base, removeParams: ["isaacPackage", "isaacPayConfirm", "isaacSales"] };
    }
    const pkg = PackageSchema.parse(JSON.parse(order.snapshot));
    if (params.isaacPayConfirm === "1") {
      if (!(await store.issue(callId))) return selectionMenu("isaacPayExit", "הבקשה כבר בטיפול או פג תוקפה. לחזרה הקישו 0. לשירות הקישו 9.");
      return {
        type: "creditCard", name: "isaacPayStatus", post: true, sum: order.amount_agorot / 100, sumChangeable: "no", payments: 1,
        paymentsMode: "regular", cvv: "yes", tz: "yes", terminal: env.NEDARIM_PHONE_TERMINAL ?? "", category: PREFIX + order.id,
        noFailExit: "no", noSuccess: "yes", noConfirmation: "yes",
      };
    }
    const text = `בחרתם ${pkg.name}. החבילה כוללת ${pkg.minutes} דקות, בתוקף ל-${pkg.validity_days} ימים, במחיר ${order.amount_agorot / 100} שקלים. לתשלום חד פעמי באשראי הקישו 1. לביטול הקישו 0.`;
    return selectionMenu("isaacPayConfirm", text, "0,1");
  }
  const choice = params.isaacPackage ?? "";
  if (["0", "9", "ERROR"].includes(choice)) {
    return { type: "goTo", goTo: base + (choice === "9" ? "/4" : ""), removeParams: ["isaacPackage", "isaacSales"] };
  }
  if (/^\d+$/.test(choice) && Number(choice) >= 1 && Number(choice) <= packageIds.length) {
    try {
      await store.create(callId, customerId, packageIds[Number(choice) - 1]);
    } catch {
      return selectionMenu("isaacPayExit", "החבילה אינה זמינה לרכישה. לחזרה הקישו 0. לשירות הקישו 9.");
    }
    return paymentResponse(store, env, base, params, customerId, packageIds);
  }
  const packages = Object.fromEntries((await store.business.list("packages")).map((p) => [p.id, p]));
  const lines: string[] = [];
  packageIds.forEach((id, index) => {
    const p = packages[id];
    if (p && p.active && p.price_ils > 0 && (p.phone_enabled ?? true)) {
      const product = p.product === "school" ? "בית הספר" : "התרגומון";
      lines.push(`לחבילת ${product}, ${p.name}, במחיר ${p.price_ils} שקלים, הקישו ${index + 1}.`);
    }
  });
  if (!lines.length) return selectionMenu("isaacPayExit", "החבילות עדיין אינן פתוחות לרכישה. לשירות הקישו 9. לחזרה הקישו 0.");
  return selectionMenu("isaacPackage", lines.join(" ") + " לשירות הקישו 9. לחזרה הקישו 0.", ["0", "9", ...packageIds.map((_, i) => String(i + 1))].join(","));
}

export async function handleWebhook(request: Request, env: Env): Promise<Record<string, unknown>> {
  const secret = env.NEDARIM_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "Payments unavailable");
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > 65536) throw new HttpError(413, "Webhook too large");
  if (!(await verifySignature(raw, request.headers, secret))) throw new HttpError(401, "Invalid signature");
  const mosadId = env.NEDARIM_MOSAD_ID ?? "";
  const store = new PaymentStore(new BusinessStore(env.DB));
  let data: Record<string, any>;
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid settlement");
  } catch { throw new HttpError(400, "Settlement requires review"); }
  try {
    if (String(data.Status ?? "").toLowerCase() === "error") return await store.refusal(data, mosadId);
    return await store.settle(data, mosadId);
  } catch {
    if (String(data.MosadNumber ?? "") === mosadId) await store.issueForData(data, "settlement_review", "").catch(() => false);
    throw new HttpError(400, "Settlement requires review");
  }
}
