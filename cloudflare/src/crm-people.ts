import { BusinessStore } from "./business";
import { type Env, HttpError } from "./env";
import { visiblePhone } from "./phone";

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
      c.bot_id,c.channel FROM sessions s LEFT JOIN call_customers c ON c.call_id=s.call_id`,
    "SELECT * FROM sales_receipts",
    "SELECT * FROM subscriptions ORDER BY created_at,id",
    "SELECT * FROM callback_requests",
    "SELECT * FROM ivr_voicemails",
    "SELECT id,label FROM bots",
    "SELECT customer_id,first_touch,ts,event,path FROM analytics_events WHERE customer_id IS NOT NULL ORDER BY ts",
    "SELECT * FROM customer_phones",
    `SELECT r.*,s.customer_id FROM subscription_renewals r JOIN subscriptions s ON s.id=r.subscription_id`,
    `SELECT m.*,s.customer_id AS owner_id FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id`,
    "SELECT id,body FROM console_settings WHERE id LIKE 'ivr:preferences:%'",
  ];
  const [results, economics] = await Promise.all([env.DB.batch<Row>(queries.map(q => env.DB.prepare(q))), new BusinessStore(env.DB).economics()]);
  const [typed, records, sessions, receipts, subscriptions, callbacks, voicemails, bots, analytics, phones, renewals, members, preferences] = results.map(r => r.results);
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
  return { people, economics, bots: new Map(bots.map(b => [b.id, b.label])), sessions: group(sessions, "student_id"), receipts: group(receipts, "customer_id"), subscriptions: group(subscriptions, "customer_id"), callbacks: group(callbacks, "customer_id"), callbacksById: new Map(callbacks.map(c => [c.id, c])), voicemails: group(voicemails, "customer_id"), events: group(events, "customer_id"), analytics: group(analytics, "customer_id") };
}
type Data = Awaited<ReturnType<typeof load>>;
function person(data: Data, p: Row) {
  const sessions = (data.sessions.get(p.id) || []).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const events = (data.events.get(p.id) || []).sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const receipts = data.receipts.get(p.id) || [], subscriptions = data.subscriptions.get(p.id) || [], callbacks = data.callbacks.get(p.id) || [], voicemails = data.voicemails.get(p.id) || [];
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
  return { id: p.id, name: p.name || "ללא שם", phone: p.phone || "", email: p.email || "", channels: [...new Set([...(p.phone ? ["phone"] : []), ...sessions.map(s => s.channel).filter(Boolean), ...(p.email ? ["web"] : [])])], first_seen, last_activity, ad_source, track, minutes_used: safe(sessions.reduce((a, s) => a + n(s.duration_seconds) / 60, 0)), calls_count: sessions.length, total_cost_ils: safe(calls.reduce((a, c) => a + c.total_cost_ils, 0)), revenue_ils: safe(receipts.reduce((a, r) => a + n(r.amount_ils), 0)), status, status_label: STATUS_LABELS[status] };
}
function costCall(data: Data, s: Row) {
  const rate = s.channel === "phone" ? data.economics.forecast_cost_per_minute : 0;
  const ai_cost_usd = n(s.estimated_cost_usd), ai_cost_ils = ai_cost_usd * (data.economics.usd_ils || DEFAULT_USD_ILS);
  const telephony_cost_ils = n(s.duration_seconds) / 60 * rate;
  return { ...s, started_at: String(s.started_at), teacher: data.bots.get(s.bot_id) || s.bot_id || "לא ידוע", recording: null, has_transcript: !!s.has_transcript, ai_cost_usd, ai_cost_ils: safe(ai_cost_ils), telephony_cost_ils: safe(telephony_cost_ils), telephony_rate_ils: rate, telephony_estimated: true, total_cost_ils: safe(ai_cost_ils + telephony_cost_ils) };
}
function journey(data: Data, id: string) {
  const rows: Row[] = [];
  const add = (kind: string, row: Row, label: string, at = stamp(row), details: Row = {}) => rows.push({ id: kind + ":" + (row.id || row.call_id), kind, at, call_id: row.call_id || null, label, ...details });
  for (const e of data.events.get(id) || []) {
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
export async function crmPeople(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/v1\/admin\/crm\/(people(?:\/([^/]+))?|calls\/([^/]+)\/transcript)$/);
  if (!match) return null;
  if (request.method !== "GET") throw new HttpError(405, "קריאה בלבד");
  const ok = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
  if (match[3]) {
    const row = await env.DB.prepare("SELECT transcript_json FROM sessions WHERE call_id=?").bind(decodeURIComponent(match[3])).first<Row>();
    if (!row) throw new HttpError(404, "השיחה לא נמצאה");
    return ok({ call_id: decodeURIComponent(match[3]), turns: parse(row.transcript_json, []), recording: null });
  }
  const data = await load(env);
  if (match[2]) {
    const id = decodeURIComponent(match[2]), p = data.people.get(id);
    if (!p) throw new HttpError(404, "הלקוח לא נמצא");
    return ok({ ...person(data, p), journey: journey(data, id), calls: (data.sessions.get(id) || []).map(s => costCall(data, s)).sort((a, b) => b.started_at.localeCompare(a.started_at)), assumptions: { usd_ils: data.economics.usd_ils, telephony_rate_ils: data.economics.forecast_cost_per_minute, telephony_note: "אומדן לפי עלות הדקה החזויה בהנחות העסק; אינו חיוב ספק מאומת" } });
  }
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") || 50), cursor = params.get("cursor") || "", status = params.get("status") || "", q = (params.get("q") || "").trim().toLowerCase(), source = params.get("source") || "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (status && !Object.hasOwn(STATUS_LABELS, status))) throw new HttpError(422, "מסנן לא תקין");
  let rows = [...data.people.values()].map(p => person(data, p)).filter(p => (!q || [p.name, p.phone, p.email, p.id].some(v => v.toLowerCase().includes(q))) && (!source || p.ad_source === source)).sort((a, b) => a.id.localeCompare(b.id));
  const counts: Record<string, number> = Object.fromEntries(Object.keys(STATUS_LABELS).map(k => [k, 0]));
  for (const p of rows) counts[p.status]++;
  const total = rows.length;
  if (status) rows = rows.filter(p => p.status === status);
  const offset = cursor ? rows.findIndex(p => p.id === cursor) + 1 : 0;
  if (cursor && !offset) throw new HttpError(422, "סמן עמוד לא תקין");
  const items = rows.slice(offset, offset + limit);
  return ok({ items, counts, total, cursor: offset + limit < rows.length ? items.at(-1)?.id : null });
}
