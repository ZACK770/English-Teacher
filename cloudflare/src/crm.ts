import { BusinessStore } from "./business";
import type { Env } from "./env";

const OVERLAP_MS = 3 * 3600 * 1000;

export async function syncCrm(env: Env): Promise<Record<string, unknown>> {
  if (!env.CRM_EVENTS_URL || !env.CRM_INGEST_SECRET) return { skipped: "CRM sync not configured" };
  const b = new BusinessStore(env.DB);
  const state = (await b.setting<{ last_success?: string }>("crm:sync")) ?? {};
  const started = new Date().toISOString();
  const since = new Date(Date.parse(state.last_success ?? new Date(Date.now() - 86400000).toISOString()) - OVERLAP_MS).toISOString();
  const { results: calls } = await env.DB.prepare(
    `SELECT s.call_id, s.student_id, s.started_at, s.duration_seconds, s.estimated_cost_usd, c.bot_id, u.product, u.receipt_id, u.billed_seconds
     FROM sessions s JOIN call_customers c ON c.call_id=s.call_id LEFT JOIN usage_allocations u ON u.call_id=s.call_id
     WHERE s.ended_at>=? AND s.student_id NOT LIKE 'system:%' AND s.student_id NOT LIKE 'anonymous-%' ORDER BY s.ended_at LIMIT 1000`,
  ).bind(since).all<Record<string, any>>();
  const { results: receipts } = await env.DB.prepare("SELECT * FROM sales_receipts WHERE created_at>=? ORDER BY created_at LIMIT 1000").bind(since).all<Record<string, any>>();
  const packages = Object.fromEntries((await b.list("packages")).map((p) => [p.id, p]));
  const customerIds = [...new Set([...calls.map((c) => c.student_id), ...receipts.map((r) => r.customer_id)])];
  const events: Record<string, unknown>[] = [];
  for (const id of customerIds) {
    const phone = await env.DB.prepare("SELECT phone FROM customer_phones WHERE customer_id=?").bind(id).first<{ phone: string }>();
    const record = await b.record("customers", id);
    const freeSecondsUsed = calls
      .filter((c) => c.student_id === id && !c.receipt_id)
      .reduce((acc, c) => acc + (Number(c.duration_seconds) || 0), 0);
    const isTrialExhausted = freeSecondsUsed >= 1200;
    events.push({
      type: "customer",
      customer_id: id,
      phone: phone?.phone ?? "",
      name: record?.name ?? "",
      trial_exhausted: isTrialExhausted,
      lead_status: isTrialExhausted ? "TRIAL_EXHAUSTED_HOT_LEAD" : (freeSecondsUsed > 0 ? "IN_TRIAL" : "NEW_LEAD"),
      free_minutes_used: Math.round(freeSecondsUsed / 60)
    });
  }
  for (const c of calls) {
    events.push({
      type: "call", call_id: c.call_id, customer_id: c.student_id, bot_id: c.bot_id ?? "", product: c.product ?? "",
      mode: c.product ? (c.receipt_id ? "paid" : "free") : "", purchase_id: c.receipt_id ?? null,
      seconds: Math.max(0, Math.min(86400, Number(c.billed_seconds ?? c.duration_seconds) || 0)), cost_usd: Number(c.estimated_cost_usd) || 0, started_at: c.started_at,
    });
  }
  for (const r of receipts) {
    if (r.product !== "school" && r.product !== "translator") continue;
    events.push({
      type: "purchase", purchase_id: r.id, customer_id: r.customer_id, package_id: r.package_id, package_name: packages[r.package_id]?.name ?? "",
      product: r.product, amount: r.amount_ils, vat_rate: r.vat_rate, minutes: r.minutes, expires_at: r.expires_at, created_at: r.created_at,
    });
  }
  for (let i = 0; i < events.length; i += 200) {
    const response = await fetch(env.CRM_EVENTS_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + env.CRM_INGEST_SECRET, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 english-engine" },
      body: JSON.stringify({ events: events.slice(i, i + 200) }),
    });
    if (!response.ok) {
      await b.putSetting("crm:sync", { ...state, last_error: started, last_status: response.status });
      return { ok: false, status: response.status, sent: i };
    }
  }
  await b.putSetting("crm:sync", { last_success: started });
  return { ok: true, since, customers: customerIds.length, calls: calls.length, purchases: receipts.length };
}
