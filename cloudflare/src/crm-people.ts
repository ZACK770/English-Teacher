import { BusinessStore } from "./business";
import { practiceInternal } from "./practice";
import { type Env, HttpError } from "./env";
import { visiblePhone } from "./phone";
import { resetCustomer } from "./crm-reset";
import { practiceMetrics } from "./crm-practice";

export const SHORT_SESSION_SECONDS = 60;
export const INACTIVE_DAYS = 3;
export const DEFAULT_USD_ILS = 3.7;
export const ROUTE_LABELS: Record<string, string> = { main: "תפריט ראשי", options: "אפשרויות", school: "בית הספר", translator: "תרגום", "start-translation": "תחילת תרגום", languages: "בחירת שפה", sales: "חבילות ותשלום", quota: "מכסת שימוש", mode: "בחירת מצב לימוד", teachers: "בחירת מורה", bots: "בחירת בוט", service: "שירות לקוחות", ad: "כניסה מפרסומת", basic: "מסלול בסיסי", advanced: "מסלול מתקדם" };
export const STATUS_LABELS = { new: "חדש", trial: "בניסיון", callback_pending: "מחכה לשיחה חוזרת", offer_no_buy: "הגיע להצעה ולא קנה", dropped: "נפל בדרך", paying: "משלם" };
type Row = Record<string, any>;
export function deriveStatus(v: { paid: boolean; callback: boolean; offered: boolean; activity: boolean; longest: number; last: string; sessions: number }, now = Date.now()): keyof typeof STATUS_LABELS {
  if (v.paid) return "paying";
  if (v.callback) return "callback_pending";
  if (v.offered) return "offer_no_buy";
  if (v.activity && (v.longest <= SHORT_SESSION_SECONDS || now - Date.parse(v.last) > INACTIVE_DAYS * 86400000)) return "dropped";
  return v.sessions ? "trial" : "new";
}
const parse = (value: unknown, fallback: any = {}) => { try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const n = (value: unknown) => Number(value) || 0;
const stamp = (r: Row) => r.at || r.created_at || r.started_at || "";
const phoneKey = (value: string) => visiblePhone(value || "") || value;
const safe = (value: number) => Math.round(value * 10000) / 10000;

async function load(env: Env) {
  // Fixed-size set of batched reads; transcripts are deliberately excluded.
  const queries = [
    "SELECT * FROM customers",
    "SELECT * FROM console_records WHERE kind IN ('customers','ivr-events','ad-entries','sales-followups','learner-phone-links')",
    `SELECT s.call_id,s.student_id,s.started_at,s.ended_at,s.duration_seconds,s.summary_he,s.success_he,s.next_step_he,
      s.input_text_tokens,s.input_audio_tokens,s.output_text_tokens,s.output_audio_tokens,s.thoughts_tokens,
      s.estimated_cost_usd,s.cost_basis,s.model,
      (s.transcript_json IS NOT NULL AND s.transcript_json <> 'null' AND s.transcript_json <> '[]') AS has_transcript,
      EXISTS(SELECT 1 FROM call_recordings r WHERE r.call_id=s.call_id) AS recording,
      c.bot_id,c.channel FROM sessions s LEFT JOIN call_customers c ON c.call_id=s.call_id`,
    "SELECT * FROM sales_receipts WHERE product='school'",
    "SELECT s.*,p.product,p.name AS plan_name FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE p.product='school' OR p.product IS NULL ORDER BY s.created_at,s.id",
    "SELECT * FROM callback_requests",
    "SELECT * FROM ivr_voicemails",
    "SELECT id,label,role FROM bots",
    "SELECT customer_id,first_touch,ts,event,path FROM analytics_events WHERE customer_id IS NOT NULL ORDER BY ts",
    "SELECT * FROM customer_phones",
    `SELECT r.*,s.customer_id FROM subscription_renewals r JOIN subscriptions s ON s.id=r.subscription_id`,
    `SELECT m.*,s.customer_id AS owner_id FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id`,
    "SELECT id,body FROM console_settings WHERE id LIKE 'ivr:preferences:%'",
    "SELECT id,customer_id,package_id,state,channel,amount_agorot,created_at,updated_at,transaction_id,receipt_id FROM payment_orders WHERE channel='web' ORDER BY created_at",
    "SELECT entitlement_id,state,monthly_agorot,last_refusal_at,keva_id FROM standing_orders ORDER BY created_at,id",
    "SELECT customer_id,day,seconds FROM practice_days",
    "SELECT customer_id,day,sent_at,responded_at,status FROM practice_reminder_events WHERE day >= date('now','-31 days')",
    "SELECT id,body FROM console_records WHERE kind='packages'",
  ];
  const [results, economics] = await Promise.all([env.DB.batch<Row>(queries.map(q => env.DB.prepare(q))), new BusinessStore(env.DB).economics()]);
  const [typed, records, allSessions, receipts, subscriptions, callbacks, voicemails, bots, analytics, phones, renewals, members, preferences, paymentOrders, standingOrders] = results.map(r => r.results);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const daysByCustomer = new Map<string, Row[]>(), remindersByCustomer = new Map<string, Row[]>();
  for (const [rows, map] of [[results[15].results, daysByCustomer], [results[16].results, remindersByCustomer]] as const) for (const row of rows) { const rows = map.get(row.customer_id) || []; rows.push(row); map.set(row.customer_id, rows); }
  const practice = new Map(typed.map(p => [p.id, practiceMetrics(daysByCustomer.get(p.id) as any || [], remindersByCustomer.get(p.id) as any || [], today)]));
  const packages = new Map<string, Row>(results[17].results.map(p => [p.id, { ...parse(p.body), id: p.id }]));
  for (const sub of subscriptions) sub.standing_orders = standingOrders.filter(o => o.entitlement_id === sub.id);
  const botRows = new Map(bots.map(b => [b.id, b]));
  // This CRM belongs to the English school. Unknown legacy sessions are retained,
  // but known translator/navigation activity is deliberately excluded.
  const sessions = allSessions.filter(s => {
    const bot = botRows.get(s.bot_id);
    return s.bot_id !== "voice-navigator-live" && bot?.role !== "translator" && bot?.role !== "navigation";
  });
  const people = new Map<string, Row>();
  for (const r of typed) people.set(r.id, { ...r, phone: r.primary_phone || "" });
  const events: Row[] = [], aliases = new Map<string, string>();
  for (const r of renewals) events.push({ ...r, id: r.reference, kind: "subscription-renewal", at: r.created_at });
  for (const m of members) {
    events.push({ id: m.subscription_id + ":" + m.customer_id, kind: "subscription-member", customer_id: m.owner_id, at: m.added_at });
    if (m.removed_at) events.push({ id: m.subscription_id + ":" + m.customer_id, kind: "subscription-member-removed", customer_id: m.owner_id, at: m.removed_at });
  }
  for (const r of records) {
    const body = parse(r.body);
    if (r.kind === "customers") people.set(r.id, { ...people.get(r.id), ...body, id: r.id, created_at: people.get(r.id)?.created_at || r.created_at });
    else if (r.kind === "learner-phone-links") aliases.set(phoneKey(body.phone), body.customer_id);
    else events.push({ ...body, id: r.id, kind: r.kind, at: body.at || r.created_at });
  }
  for (const p of phones) { aliases.set(phoneKey(p.phone), p.customer_id); const person = people.get(p.customer_id); if (person && !person.phone) person.phone = p.phone; }
  for (const row of preferences) {
    const person = people.get(row.id.slice("ivr:preferences:".length));
    const email = parse(row.body).email;
    if (person && !person.email && typeof email === "string") person.email = email;
  }
  for (const p of people.values()) if (p.phone) aliases.set(phoneKey(p.phone), p.id);
  for (const c of callbacks) c.customer_id = aliases.get(phoneKey(c.phone));
  const group = (rows: Row[], key: string) => { const map = new Map<string, Row[]>(); for (const row of rows) { const id = row[key]; if (id) { if (!map.has(id)) map.set(id, []); map.get(id)!.push(row); } } return map; };
  const cardPaymentAvailable = /^[0-9]{1,7}$/.test(env.NEDARIM_IFRAME_MOSAD ?? env.NEDARIM_MOSAD_ID ?? "") && !!env.NEDARIM_API_VALID && !!env.NEDARIM_API_KEY && !!env.NEDARIM_WEBHOOK_SECRET && /^[0-9]{7}$/.test(env.NEDARIM_MOSAD_ID ?? "");
  const familySubscriptions = new Map<string, Row[]>();
  for (const member of members.filter(m => !m.removed_at)) {
    const sub = subscriptions.find(s => s.id === member.subscription_id);
    if (sub) familySubscriptions.set(member.customer_id, [...(familySubscriptions.get(member.customer_id) || []), sub]);
  }
  return { practice, packages, familySubscriptions, people, economics, bots: new Map(bots.map(b => [b.id, b.label])), sessions: group(sessions, "student_id"), receipts: group(receipts, "customer_id"), subscriptions: group(subscriptions, "customer_id"), callbacks: group(callbacks, "customer_id"), callbacksById: new Map(callbacks.map(c => [c.id, c])), voicemails: group(voicemails, "customer_id"), events: group(events, "customer_id"), analytics: group(analytics, "customer_id"), paymentOrders: group(paymentOrders, "customer_id"), cardPaymentAvailable };
}
type Data = Awaited<ReturnType<typeof load>>;
const schoolEvents = (data: Data, id: string) => (data.events.get(id) || []).filter(e => !(e.kind === "ivr-events" && ["translator", "start-translation", "languages"].includes(e.route)));
function personDetails(data: Data, p: Row) {
  const sessions = (data.sessions.get(p.id) || []).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const events = schoolEvents(data, p.id).sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const receipts = data.receipts.get(p.id) || [], subscriptions = data.subscriptions.get(p.id) || [], callbacks = data.callbacks.get(p.id) || [], voicemails = data.voicemails.get(p.id) || [];
  const paymentOrders = data.paymentOrders.get(p.id) || [];
  const times = [...events.map(stamp), ...sessions.flatMap(s => [s.started_at, s.ended_at]), ...receipts.map(stamp), ...subscriptions.flatMap(s => [s.created_at, s.updated_at]), ...callbacks.flatMap(c => [c.created_at, c.updated_at]), ...voicemails.map(stamp), ...(data.analytics.get(p.id) || []).map(e => e.ts)].filter(Boolean).sort();
  const first_seen = [p.created_at, times[0]].filter(Boolean).sort()[0] || null;
  const last_activity = times.at(-1) || first_seen;
  const ad = events.find(e => e.kind === "ad-entries" && e.campaign)?.campaign;
  const touch = parse(data.analytics.get(p.id)?.[0]?.first_touch);
  const ad_source = ad || p.source || touch.utm_campaign || touch.campaign || touch.utm_source || "לא ידוע";
  const last = sessions.at(-1);
  const trackId = p.preferred_bot || last?.bot_id;
  const track = (trackId && (data.bots.get(trackId) || trackId)) || subscriptions.at(-1)?.plan_id || "לא ידוע";
  const calls = sessions.map(s => costCall(data, s));
  const pendingCallback = (c: Row) => ["pending", "scheduled", "queued", "dispatching", "dialing"].includes(c.status);
  const callback = callbacks.some(pendingCallback) || events.some(e => {
    if (e.kind !== "sales-followups" || e.type !== "lesson" || e.status !== "pending") return false;
    const request = data.callbacksById.get(e.callback_id || e.id);
    return request ? pendingCallback(request) : true;
  });
  const status = deriveStatus({ paid: receipts.length > 0 || subscriptions.some(s => s.status === "active"), callback, offered: events.some(e => e.kind === "sales-followups" || (e.kind === "ivr-events" && e.route === "sales")), activity: times.length > 0, longest: Math.max(0, ...sessions.map(s => n(s.duration_seconds))), last: last_activity || "", sessions: sessions.length });
  const lastPayment = paymentOrders.at(-1);
  const familySubscriptions = data.familySubscriptions.get(p.id) || [];
  const candidates = subscriptions.length ? subscriptions : familySubscriptions;
  const sub = candidates.filter(s => s.status === "active").at(-1) || candidates.at(-1);
  const orders: Row[] = sub?.standing_orders || [];
  const order = orders.find(o => o.state === "past_due" || o.last_refusal_at) || orders.at(-1);
  const access = !sub ? "none" : sub.access_suspended_at ? "suspended" : orders.some(o => o.state === "past_due" || o.last_refusal_at) ? "payment_hold" : sub.status === "active" && sub.started_at <= new Date().toISOString() && sub.current_period_end > new Date().toISOString() ? "open" : "inactive";
  const subscription = { id: sub?.id || null, plan_name: sub?.plan_name || null, status: sub?.status || null, current_period_end: sub?.current_period_end || null, access };
  const nedarim = { state: order?.state || "none", amount: order ? n(order.monthly_agorot) / 100 : null, last_refusal_at: order?.last_refusal_at || null, keva_id_present: !!order?.keva_id };
  const summary = { id: p.id, name: p.name || "ללא שם", phone: p.phone || "", email: p.email || "", notes: p.notes || "", channels: [...new Set([...(p.phone ? ["phone"] : []), ...sessions.map(s => s.channel).filter(Boolean), ...(p.email ? ["web"] : [])])], first_seen, last_activity, ad_source, track, minutes_used: safe(sessions.reduce((a, s) => a + n(s.duration_seconds) / 60, 0)), calls_count: sessions.length, total_cost_ils: safe(calls.reduce((a, c) => a + c.total_cost_ils, 0)), revenue_ils: safe(receipts.reduce((a, r) => a + n(r.amount_ils), 0)), status, status_label: STATUS_LABELS[status], card_payment: { available: data.cardPaymentAvailable, orders: paymentOrders.length, paid: paymentOrders.filter(o => o.state === "paid").length, latest_state: lastPayment?.state || "none", latest_at: lastPayment?.updated_at || null } };
  return { summary: { ...summary, subscription, nedarim, current_streak: data.practice.get(p.id)?.current_streak || 0, practice_days_30: data.practice.get(p.id)?.practice_days_30 || 0 }, times, callback };
}
function person(data: Data, p: Row) {
  return personDetails(data, p).summary;
}
function costCall(data: Data, s: Row) {
  const rate = s.channel === "phone" ? data.economics.forecast_cost_per_minute : 0;
  const ai_cost_usd = n(s.estimated_cost_usd), ai_cost_ils = ai_cost_usd * (data.economics.usd_ils || DEFAULT_USD_ILS);
  const telephony_cost_ils = n(s.duration_seconds) / 60 * rate;
  return { ...s, call_id: String(s.call_id), duration_seconds: n(s.duration_seconds), started_at: String(s.started_at), teacher: data.bots.get(s.bot_id) || s.bot_id || "לא ידוע", recording: s.recording ? true : null, has_transcript: !!s.has_transcript, ai_cost_usd, ai_cost_ils: safe(ai_cost_ils), telephony_cost_ils: safe(telephony_cost_ils), telephony_rate_ils: rate, telephony_estimated: true, total_cost_ils: safe(ai_cost_ils + telephony_cost_ils) };
}
function journey(data: Data, id: string) {
  const rows: Row[] = [];
  const add = (kind: string, row: Row, label: string, at = stamp(row), details: Row = {}) => rows.push({ id: kind + ":" + (row.id || row.call_id), kind, at, call_id: row.call_id || null, label, ...details });
  for (const e of schoolEvents(data, id)) {
    if (e.kind === "ivr-events") add(e.kind, e, ROUTE_LABELS[e.route] || "תפריט נוסף", stamp(e), { route: e.route, input: e.input || {}, destination: e.output?.goTo || null });
    if (e.kind === "ad-entries") add(e.kind, e, "כניסה מפרסומת", stamp(e), { campaign: e.campaign });
    if (e.kind === "sales-followups") add(e.kind, e, ({ lesson: "בקשה לשיעור חוזר", email: "שמירת דואר אלקטרוני", payment_link: "בקשה לקישור תשלום" } as Row)[e.type] || "פנייה להמשך טיפול", stamp(e), { status: e.status, plan: e.plan_id, scheduled_at: e.scheduled_at });
    if (e.kind === "subscription-renewal") add(e.kind, e, "חידוש מנוי");
    if (e.kind === "subscription-member") add(e.kind, e, "הוספת בן משפחה למנוי");
    if (e.kind === "subscription-member-removed") add(e.kind, e, "הסרת בן משפחה ממנוי");
  }
  for (const r of data.receipts.get(id) || []) add("receipt", r, "תשלום התקבל", stamp(r), { amount_ils: r.amount_ils });
  for (const s of data.subscriptions.get(id) || []) { add("subscription", s, "יצירת מנוי", s.created_at, { plan: s.plan_id, status: s.status }); if (s.updated_at !== s.created_at) add("subscription-update", s, "עדכון מנוי — מצב נוכחי", s.updated_at, { status: s.status }); }
  for (const c of data.callbacks.get(id) || []) { add("callback", c, "בקשה לשיחה חוזרת", c.created_at, { status: c.status, scheduled_at: c.next_attempt_at }); if (c.updated_at !== c.created_at) add("callback-update", c, "עדכון בקשת שיחה", c.updated_at, { status: c.status }); }
  for (const v of data.voicemails.get(id) || []) add("voicemail", v, "הודעה קולית", stamp(v), { transcript: v.transcript, status: v.status });
  for (const [i, e] of (data.analytics.get(id) || []).entries()) add("website", { ...e, id: String(i) }, "פעילות באתר", e.ts);
  for (const s of data.sessions.get(id) || []) { add("session-start", s, "תחילת שיחה", s.started_at); add("session-end", s, "סיום שיחה", s.ended_at, { summary: s.summary_he }); }
  return rows.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export async function crmPeople(request: Request, env: Env, path: string, actor?: { role: string; username: string }): Promise<Response | null> {
  const access = path.match(/^\/v1\/admin\/crm\/subscriptions\/([^/]+)\/(suspend|restore)$/);
  if (access) {
    if (request.method !== "POST") throw new HttpError(405, "פעולה לא נתמכת");
    if (actor?.role !== "owner") throw new HttpError(403, "רק מנהל יכול לשנות את גישת המנוי");
    const suspended = access[2] === "suspend";
    const sub = await env.DB.prepare(`UPDATE subscriptions
      SET access_suspended_at=CASE WHEN ? THEN COALESCE(access_suspended_at,?) ELSE NULL END
      WHERE id=? AND EXISTS (SELECT 1 FROM plans WHERE id=subscriptions.plan_id AND product='school')
      RETURNING id,access_suspended_at`)
      .bind(Number(suspended), new Date().toISOString(), decodeURIComponent(access[1])).first();
    if (!sub) throw new HttpError(404, "המנוי לא נמצא");
    return Response.json(sub, { headers: { "Cache-Control": "no-store" } });
  }
  const match = path.match(/^\/v1\/admin\/crm\/(people(?:\/([^/]+))?|calls\/([^/]+)\/transcript|analytics|returning|calls)$/);
  if (!match) return null;
  if (request.method !== "GET" && !(request.method === "DELETE" && match[2])) throw new HttpError(405, "פעולה לא נתמכת");
  const ok = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
  if (match[3]) {
    const row = await env.DB.prepare("SELECT transcript_json FROM sessions WHERE call_id=?").bind(decodeURIComponent(match[3])).first<Row>();
    if (!row) throw new HttpError(404, "השיחה לא נמצאה");
    return ok({ call_id: decodeURIComponent(match[3]), turns: parse(row.transcript_json, []), recording: null });
  }
  const data = await load(env);
  if (path === "/v1/admin/crm/returning") {
    const items = [...data.people.values()].flatMap(p => {
      const metrics = data.practice.get(p.id);
      if (!metrics || metrics.practice_days_total < 2) return [];
      const subs = data.subscriptions.get(p.id) || data.familySubscriptions.get(p.id) || [];
      const now = new Date().toISOString();
      const available = (s: Row) => !s.access_suspended_at && !(s.standing_orders || []).some((o: Row) => o.state === "past_due" || o.last_refusal_at);
      const sub = subs.filter(s => s.status === "active" && available(s) && s.started_at <= now && s.current_period_end > now).at(-1);
      const ownReceipts = data.receipts.get(p.id) || [];
      const familyReceipts = (data.familySubscriptions.get(p.id) || []).filter(s => ["active", "cancelled", "past_due"].includes(s.status)).flatMap(s => (data.receipts.get(s.customer_id) || []).filter(r => r.subscription_id === s.id));
      const receipt = [...ownReceipts, ...familyReceipts].filter(r => {
        const ownerSub = (data.subscriptions.get(r.customer_id) || []).find(s => s.id === r.subscription_id);
        return r.package_id !== "school-topup" && !r.payment_reversed_at && r.expires_at > now && (!r.valid_from || r.valid_from <= now) && (!ownerSub || ownerSub.status !== "paused" && available(ownerSub));
      }).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const pkg = data.packages.get(sub?.plan_id) || data.packages.get(receipt?.package_id);
      return [{ id: p.id, name: p.name || "ללא שם", phone: p.phone || "", ...metrics, package: pkg ? { id: pkg.id, name: pkg.name } : null, monthly_minutes: pkg?.monthly_minutes ?? null }];
    });
    const sent = items.reduce((n, p) => n + p.reminders_sent, 0), responded = items.reduce((n, p) => n + p.reminders_responded, 0);
    return ok({ items, totals: { returning: items.length, today: items.filter(p => p.practiced_today).length, week: items.filter(p => p.practiced_week).length, streaks: items.filter(p => p.current_streak >= 3).length, reminder_rate: sent ? responded / sent * 100 : 0 } });
  }
  if (path === "/v1/admin/crm/calls") {
    const params = new URL(request.url).searchParams;
    const from = params.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = params.get("to") || new Date().toISOString().slice(0, 10);
    const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
    if (!validDate(from) || !validDate(to) || from > to) throw new HttpError(422, "טווח תאריכים לא תקין");
    const all = [...data.sessions.entries()].flatMap(([id, sessions]) => sessions.map(s => ({ ...costCall(data, s), customer_id: id, customer_name: data.people.get(id)?.name || "ללא שם" })))
      .filter(s => s.started_at.slice(0, 10) >= from && s.started_at.slice(0, 10) <= to).sort((a, b) => b.started_at.localeCompare(a.started_at) || a.call_id.localeCompare(b.call_id));
    const totals = { calls: all.length, minutes: safe(all.reduce((v, s) => v + n(s.duration_seconds) / 60, 0)), ai_cost_ils: safe(all.reduce((v, s) => v + s.ai_cost_ils, 0)), telephony_cost_ils: safe(all.reduce((v, s) => v + s.telephony_cost_ils, 0)), total_cost_ils: safe(all.reduce((v, s) => v + s.total_cost_ils, 0)) };
    const aggregate = (key: "customer_id" | "teacher") => {
      const rows = new Map<string, { id: string; name: string; calls: number; total_cost_ils: number }>();
      for (const s of all) { const id = String(s[key]); const row = rows.get(id) || { id, name: key === "teacher" ? s.teacher : s.customer_name, calls: 0, total_cost_ils: 0 }; row.calls++; row.total_cost_ils = safe(row.total_cost_ils + s.total_cost_ils); rows.set(id, row); }
      return [...rows.values()].sort((a, b) => b.total_cost_ils - a.total_cost_ils);
    };
    return ok({ from, to, items: all.slice(0, 2000), capped: all.length > 2000, totals, insights: { cost_per_minute: totals.minutes ? safe(totals.total_cost_ils / totals.minutes) : 0, short_call_share: all.length ? safe(all.filter(s => n(s.duration_seconds) < 60).length / all.length) : 0, top_customers: aggregate("customer_id").slice(0, 5), by_teacher: aggregate("teacher") } });
  }
  if (path === "/v1/admin/crm/analytics") {
    const details = [...data.people.values()].map(p => personDetails(data, p));
    const people = details.map(p => p.summary);
    const statuses = Object.fromEntries(Object.keys(STATUS_LABELS).map(k => [k, people.filter(p => p.status === k).length]));
    const sources = new Map<string, { source: string; leads: number; trials: number; paying: number; revenue_ils: number; minutes: number }>();
    for (const p of people) {
      const row = sources.get(p.ad_source) || { source: p.ad_source, leads: 0, trials: 0, paying: 0, revenue_ils: 0, minutes: 0 };
      row.leads++; if (p.calls_count) row.trials++; if (p.status === "paying") row.paying++;
      row.revenue_ils += p.revenue_ils; row.minutes += p.minutes_used; sources.set(p.ad_source, row);
    }
    const days = new Map<string, { date: string; leads: number; active: number; calls: number }>();
    for (let i = 29; i >= 0; i--) { const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); days.set(date, { date, leads: 0, active: 0, calls: 0 }); }
    for (const { summary, times } of details) {
      const first = summary.first_seen?.slice(0, 10);
      if (first && days.has(first)) days.get(first)!.leads++;
      const activityDays = new Set(times.map(time => time.slice(0, 10)));
      if (first) activityDays.add(first);
      for (const date of activityDays) if (days.has(date)) days.get(date)!.active++;
    }
    for (const rows of data.sessions.values()) for (const s of rows) { const date = String(s.started_at).slice(0, 10); if (days.has(date)) days.get(date)!.calls++; }
    const cardOrders = [...data.paymentOrders.values()].flat();
    return ok({ generated_at: new Date().toISOString(), totals: { leads: people.length, customers_with_calls: people.filter(p => p.calls_count).length, calls: people.reduce((a, p) => a + p.calls_count, 0), minutes: safe(people.reduce((a, p) => a + p.minutes_used, 0)), revenue_ils: safe(people.reduce((a, p) => a + p.revenue_ils, 0)), estimated_cost_ils: safe(people.reduce((a, p) => a + p.total_cost_ils, 0)), callbacks_waiting: details.filter(p => p.callback).length, card_orders: cardOrders.length, card_paid: cardOrders.filter(o => o.state === "paid").length }, statuses, sources: [...sources.values()].map(s => ({ ...s, conversion_pct: s.leads ? safe(s.paying / s.leads * 100) : 0 })).sort((a, b) => b.leads - a.leads), days: [...days.values()] });
  }
  if (match[2]) {
    const id = decodeURIComponent(match[2]), p = data.people.get(id);
    if (!p) throw new HttpError(404, "הלקוח לא נמצא");
    if (request.method === "DELETE") return resetCustomer(request, env, person(data, p), actor);
    const practice = await practiceInternal(env.DB, id);
    return ok({ ...person(data, p), practice, journey: journey(data, id), calls: (data.sessions.get(id) || []).map(s => costCall(data, s)).sort((a, b) => b.started_at.localeCompare(a.started_at)), assumptions: { usd_ils: data.economics.usd_ils, telephony_rate_ils: data.economics.forecast_cost_per_minute, telephony_note: "אומדן לפי עלות הדקה החזויה בהנחות העסק; אינו חיוב ספק מאומת" } });
  }
  const params = new URL(request.url).searchParams;
  const subscriptionAccess = params.get("access") || "";
  if (subscriptionAccess && !["open", "suspended", "payment_hold", "inactive", "none"].includes(subscriptionAccess)) throw new HttpError(422, "מסנן מנוי לא תקין");
  const limit = Number(params.get("limit") || 50), cursor = params.get("cursor") || "", status = params.get("status") || "", q = (params.get("q") || "").trim().toLowerCase(), source = params.get("source") || "", sort = params.get("sort") || "last_activity", direction = params.get("direction") === "asc" ? "asc" : "desc";
  const sortable = new Set(["current_streak", "practice_days_30", "name", "status", "ad_source", "track", "first_seen", "last_activity", "calls_count", "minutes_used", "total_cost_ils", "revenue_ils"]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (status && !Object.hasOwn(STATUS_LABELS, status)) || !sortable.has(sort)) throw new HttpError(422, "מסנן לא תקין");
  const terms = q.split(/\s+/).filter(Boolean);
  let rows = [...data.people.values()].map(p => person(data, p)).filter(p => {
    const haystack = [p.name, p.phone, visiblePhone(p.phone), p.email, p.id, p.status, p.status_label, p.ad_source, p.track, p.notes].join(" ").toLowerCase();
    return terms.every(term => haystack.includes(term)) && (!source || p.ad_source === source) && (!subscriptionAccess || p.subscription.access === subscriptionAccess);
  }).sort((a: Row, b: Row) => {
    const av = a[sort] ?? "", bv = b[sort] ?? "";
    const compared = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "he");
    return (direction === "asc" ? compared : -compared) || a.id.localeCompare(b.id);
  });
  const counts: Record<string, number> = Object.fromEntries(Object.keys(STATUS_LABELS).map(k => [k, 0]));
  for (const p of rows) counts[p.status]++;
  const total = rows.length;
  if (status) rows = rows.filter(p => p.status === status);
  const offset = cursor ? rows.findIndex(p => p.id === cursor) + 1 : 0;
  if (cursor && !offset) throw new HttpError(422, "סמן עמוד לא תקין");
  const items = rows.slice(offset, offset + limit);
  return ok({ items, counts, total, cursor: offset + limit < rows.length ? items.at(-1)?.id : null });
}
