import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdminIdentity } from './AdminAuthGate';
import { CallReviewsPanel } from './CallReviewsPanel';
import { VoicemailInbox } from './VoicemailInbox';
import { SubscriptionPanel } from '../portal/SubscriptionPanel';
import { AnalyticsView } from './AnalyticsView';
import { AdCampaignsPanel } from './AdCampaignsPanel';
import { CrmCostsPanel } from './CrmCostsPanel';
import { PracticeCard, ReturningPractice, type Practice } from './CrmPractice';
import { TeacherSettingsPanel } from './TeacherSettingsPanel';
import { ResetTrialButton } from './ResetTrialButton';
import './crm.css';
import './crm-enhanced.css';

type Status = 'new' | 'trial' | 'callback_pending' | 'offer_no_buy' | 'dropped' | 'paying';
type Access = 'open' | 'suspended' | 'payment_hold' | 'inactive' | 'none';
type Subscription = { subscription: { id: string | null; plan_name: string | null; status: string | null; current_period_end: string | null; access: Access }; nedarim: { state: string; amount: number | null; last_refusal_at: string | null; keva_id_present: boolean } };
type CardPayment = { available: boolean; orders: number; paid: number; latest_state: string; latest_at: string | null };
type Person = Subscription & { current_streak: number; practice_days_30: number; id: string; name: string; phone: string; email: string; notes: string; channels: string[]; first_seen: string; last_activity: string; ad_source: string; track: string; calls_count: number; minutes_used: number; total_cost_ils: number; revenue_ils: number; status: Status; status_label: string; card_payment: CardPayment };
type Call = { recording?: boolean; call_id: string; started_at: string; duration_seconds: number; teacher: string; summary_he: string; success_he: string; next_step_he: string; has_transcript: boolean; ai_cost_usd: number; ai_cost_ils: number; telephony_cost_ils: number; total_cost_ils: number; cost_basis: string; input_text_tokens: number; input_audio_tokens: number; output_text_tokens: number; output_audio_tokens: number; thoughts_tokens: number };
type Step = { id: string; kind: string; call_id: string | null; at: string; label: string; input?: Record<string, unknown>; destination?: string; campaign?: string; status?: string; amount_ils?: number; plan?: string; summary?: string; transcript?: string; scheduled_at?: string };
type Card = Person & { practice: Practice; calls: Call[]; journey: Step[]; assumptions: { telephony_note: string; usd_ils: number; telephony_rate_ils: number } };
type Analytics = { generated_at: string; totals: { leads: number; customers_with_calls: number; calls: number; minutes: number; revenue_ils: number; estimated_cost_ils: number; callbacks_waiting: number; card_orders: number; card_paid: number }; statuses: Record<string, number>; sources: { source: string; leads: number; trials: number; paying: number; revenue_ils: number; minutes: number; conversion_pct: number }[]; days: { date: string; leads: number; active: number; calls: number }[] };
type SortDirection = 'asc' | 'desc';

const labels: Record<Status, string> = { new: 'חדשים', trial: 'בניסיון', callback_pending: 'מחכים לשיחה חוזרת', offer_no_buy: 'הגיעו להצעה ולא קנו', dropped: 'נפלו בדרך', paying: 'משלמים' };
const states: Record<string, string> = { none: 'טרם נפתח תשלום', issued: 'טופס אשראי נפתח', awaiting_settlement: 'ממתין לאישור סליקה', paid: 'שולם בכרטיס', failed: 'תשלום נכשל', cancelled: 'בוטל', pending: 'ממתין', queued: 'בתור', scheduled: 'מתוזמן', sent: 'נשלח', active: 'פעיל', completed: 'הושלם', expired: 'פג תוקף', dispatching: 'בביצוע', past_due: 'ממתין לתשלום', trial: 'ניסיון', paused: 'מוקפא' };
const date = (v: string) => v ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(v)) : 'אין מידע';
const day = (v: string) => v ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(v + 'T12:00:00Z')) : '—';
const money = (v: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(v || 0);
const prefix = location.pathname.startsWith('/english/') ? '/english' : '';
const base = prefix + '/dashboard/crm';

async function api<T,>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(prefix + path, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (response.status === 401) window.dispatchEvent(new Event('admin-session-expired'));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(response.status === 401 ? 'הכניסה פגה. יש להתחבר מחדש.' : typeof body?.detail === 'string' && /[\u0590-\u05ff]/.test(body.detail) ? body.detail : response.status === 404 ? 'הרשומה לא נמצאה.' : 'הפעולה נכשלה. נסו שוב.');
  }
  return response.json();
}
const read = <T,>(path: string, signal?: AbortSignal) => api<T>('/v1/admin/crm/' + path, { signal });

function Badge({ person }: { person: Person }) { return <span className={'crm-badge crm-' + person.status}>{person.status_label}</span>; }
const accessLabels: Record<Access, string> = { open: 'פעיל', suspended: 'מושהה ידנית', payment_hold: 'עצור עקב תשלום', inactive: 'לא פעיל', none: 'ללא מנוי' };
function SubscriptionBadge({ person }: { person: Person }) { return <span className={'crm-badge crm-access-' + person.subscription.access}>{accessLabels[person.subscription.access]}</span>; }
function NedarimStatus({ person }: { person: Person }) { const order = person.nedarim; return <span>{order.state === 'none' ? 'אין הוראת קבע' : <>{states[order.state] || 'מצב לא מוכר'} · {money(order.amount || 0)}{order.last_refusal_at && <small>סירוב אחרון: {date(order.last_refusal_at)}</small>}{!order.keva_id_present && <small>טרם התקבל מזהה מהספק</small>}</>}</span>; }
function AccessButton({ person, onUpdate }: { person: Person; onUpdate: (person: Person) => void }) {
  const identity = useAdminIdentity();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (identity?.role !== 'owner' || !person.subscription.id) return null;
  const suspended = person.subscription.access === 'suspended';
  async function change() {
    if (!window.confirm(suspended ? 'לפתוח מחדש את הגישה למנוי? חסימת תשלום, אם קיימת, תישאר בתוקף.' : 'להשעות ידנית את הגישה למנוי? החיוב בהוראת הקבע לא ישתנה.')) return;
    setBusy(true); setError('');
    try { await api('/v1/admin/crm/subscriptions/' + encodeURIComponent(person.subscription.id!) + '/' + (suspended ? 'restore' : 'suspend'), { method: 'POST', body: '{}' }); onUpdate(await read<Person>('people/' + encodeURIComponent(person.id))); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <span onClick={e => e.stopPropagation()}><button className="crm-button" disabled={busy} onClick={() => void change()}>{busy ? 'מעדכנים…' : suspended ? 'פתיחת מנוי' : 'השעיית מנוי'}</button>{error && <small role="alert">{error}</small>}</span>;
}
export function resetErrorMessage(body: unknown) {
  if (body && typeof body === 'object') {
    const result = body as Record<string, unknown>;
    for (const value of [result.detail, result.message, result.error]) if (typeof value === 'string' && /[\u0590-\u05ff]/.test(value)) return value;
  }
  return 'מחיקת הלקוח נכשלה. נסו שוב או פנו לתמיכה.';
}
export function ResetConfirmationHint({ confirm, expected }: { confirm: string; expected: string }) {
  return confirm !== expected ? <p id="crm-reset-hint" role="status">האישור אינו תואם. יש להקליד את הטלפון או המזהה בדיוק כפי שמוצג למעלה.</p> : null;
}
export function DeleteCustomer({ person }: { person: Pick<Person, 'id' | 'phone'> }) {
  const identity = useAdminIdentity();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const expected = person.phone || person.id;
  async function remove(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(prefix + '/v1/admin/crm/people/' + encodeURIComponent(person.id), { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setError(resetErrorMessage(result)); return; }
      location.href = base + '?reset=success';
    } catch { setError('מחיקת הלקוח נכשלה. בדקו את החיבור ונסו שוב.'); }
    finally { setBusy(false); }
  }
  if (identity?.role !== 'owner') return null;
  return <><button className="crm-button crm-danger" onClick={() => { setConfirm(''); setError(''); dialog.current?.showModal(); }}>מחיקת לקוח</button><dialog className="crm-reset-dialog" ref={dialog} aria-labelledby="crm-reset-title" onCancel={e => { if (busy) e.preventDefault(); }}><form onSubmit={e => void remove(e)}><h2 id="crm-reset-title">איפוס למתקשר חדש</h2><p>פעולה זו מוחקת לצמיתות את כל היסטוריית הלקוח, ההעדפות והשיחות, כדי שהטלפון יתחיל כמתקשר חדש. לא ניתן לבטל את המחיקה.</p><p>המחיקה אינה מבטלת חיובים אצל ספק התשלום. הוראת קבע או חיוב מתחדש פעיל יש לבטל אצל הספק לפני המחיקה.</p><label htmlFor="crm-reset-confirm">לאישור, הקלידו את {person.phone ? 'מספר הטלפון' : 'מזהה הלקוח'}: <b dir="ltr">{expected}</b></label><input id="crm-reset-confirm" dir="ltr" autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} autoFocus />{error && <p role="alert">{error}</p>}<div className="crm-between"><button className="crm-button" type="button" disabled={busy} onClick={() => dialog.current?.close()}>ביטול</button><button className="crm-button crm-danger" type="submit" aria-describedby={confirm !== expected ? 'crm-reset-hint' : undefined} disabled={busy || confirm !== expected}>{busy ? 'מוחקים…' : 'מחיקה לצמיתות'}</button></div><ResetConfirmationHint confirm={confirm} expected={expected} /></form></dialog></>;
}
function Kpis({ items }: { items: [string, string][] }) { return <div className="crm-kpis">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }
function CustomerCosts({ calls }: { calls: Call[] }) {
  const total = calls.reduce((v, c) => v + c.total_cost_ils, 0);
  const months = new Map<string, number>();
  for (const c of calls) { const month = c.started_at.slice(0, 7); months.set(month, (months.get(month) || 0) + c.total_cost_ils); }
  return <section><h2>סיכום עלויות לקוח — אומדן</h2><Kpis items={[["בינה מלאכותית", money(calls.reduce((v, c) => v + c.ai_cost_ils, 0))], ["טלפוניה", money(calls.reduce((v, c) => v + c.telephony_cost_ils, 0))], ["סה״כ", money(total)], ["ממוצע לשיחה", money(calls.length ? total / calls.length : 0)]]} /><div className="crm-month-costs">{[...months].sort(([a], [b]) => b.localeCompare(a)).map(([month, cost]) => <span key={month}>{month}: <b>{money(cost)}</b></span>)}{!calls.length && <p>עדיין אין עלויות שיחה.</p>}</div></section>;
}
function CallPath({ callId, steps }: { callId: string; steps: Step[] }) {
  const physical = [...new Set(steps.filter(s => ['ivr-events', 'ad-entries'].includes(s.kind) && s.call_id).map(s => s.call_id!))].sort((a, b) => b.length - a.length);
  const group = physical.find(id => id === callId) || physical.find(id => callId.startsWith(id + '~')) || callId;
  const events = steps.filter(s => s.kind === 'ivr-events' && s.call_id === group);
  return <div className="crm-call-path"><b>מסלול והקשות בשיחה</b>{events.length ? events.map(e => <p key={e.id}>{e.label}{e.input && Object.values(e.input).length > 0 && <> · הקשה: <b dir="ltr">{Object.values(e.input).map(String).join(', ')}</b></>}</p>) : <p>לא נשמרו הקשות לשיחה זו.</p>}</div>;
}
function SortButton({ field, active, direction, onSort, children }: { field: string; active: string; direction: SortDirection; onSort: (field: string) => void; children: React.ReactNode }) {
  return <button className="crm-sort" onClick={() => onSort(field)} aria-label={`מיון לפי ${String(children)}`}>{children}<span aria-hidden="true">{active === field ? direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button>;
}

function CallCard({ call }: { call: Call }) {
  const [open, setOpen] = useState(false), [turns, setTurns] = useState<{ role?: string; text?: string }[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function toggle() { setOpen(!open); if (turns || busy || open) return; setBusy(true); setError(''); try { const result = await read<{ turns: { role?: string; text?: string }[] }>('calls/' + encodeURIComponent(call.call_id) + '/transcript'); setTurns(result.turns || []); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <article className="crm-call"><div className="crm-between"><div><span className="crm-eyebrow">שיחה עם {call.teacher}</span><h3>{date(call.started_at)}</h3></div><span className="crm-chip">{num(call.duration_seconds / 60)} דקות</span></div><p>{call.summary_he || 'לא נשמר סיכום לשיחה זו.'}</p>{call.success_he && <p className="crm-success">מה הצליח · {call.success_he}</p>}{call.next_step_he && <p>הצעד הבא · {call.next_step_he}</p>}<div className="crm-cost"><span>בינה מלאכותית <b>{money(call.ai_cost_ils)}</b><small>{call.ai_cost_usd.toFixed(4)} דולר · {call.cost_basis === 'gemini_usage_metadata' ? 'לפי דיווח אסימונים' : 'אומדן שימוש'}</small></span><span>טלפוניה — אומדן <b>{money(call.telephony_cost_ils)}</b><small>לפי עלות דקה חזויה, לא חיוב ספק</small></span><span>סה״כ משוער <b>{money(call.total_cost_ils)}</b></span></div><details className="crm-muted"><summary>פירוט אסימונים</summary>קלט טקסט: {call.input_text_tokens} · קלט קול: {call.input_audio_tokens} · פלט טקסט: {call.output_text_tokens} · פלט קול: {call.output_audio_tokens} · חשיבה: {call.thoughts_tokens}</details><div className="crm-between crm-call-footer">{call.recording ? <audio controls preload="none" aria-label="הקלטת השיחה" src={prefix + '/v1/admin/crm/recordings/' + encodeURIComponent(call.call_id) + '/audio'} /> : <span className="crm-muted">אין הקלטה זמינה</span>}{call.has_transcript ? <button className="crm-button" onClick={() => void toggle()} aria-expanded={open}>{open ? 'סגירת תמלול' : 'פתיחת תמלול'}</button> : <span className="crm-muted">לא נשמר תמלול</span>}</div>{open && <div className="crm-transcript" aria-live="polite">{busy && <p>טוענים תמלול…</p>}{error && <div role="alert">{error}</div>}{turns?.length === 0 && <p>התמלול ריק.</p>}{turns?.map((t, i) => <div key={i}><b>{['learner', 'user'].includes(t.role || '') ? 'לומד/ת' : 'מורה'}</b><p dir="auto">{t.text}</p></div>)}</div>}</article>;
}

export function Journey({ steps }: { steps: Step[] }) {
  const physicalCalls = [...new Set(steps.filter(s => ['ivr-events', 'ad-entries'].includes(s.kind) && s.call_id).map(s => s.call_id!))].sort((a, b) => b.length - a.length);
  const groups = new Map<string, Step[]>();
  for (const step of steps) { const callId = step.call_id; const key = (callId && (physicalCalls.find(id => id === callId) || physicalCalls.find(id => callId.startsWith(id + '~')) || callId)) || 'event:' + step.id; groups.set(key, [...(groups.get(key) || []), step]); }
  return <div className="crm-timeline">{[...groups.entries()].map(([key, events]) => <section className="crm-journey-group" key={key}><h3>{events[0].call_id ? 'שיחה · ' + date(events[0].at) : 'פעילות נוספת'}</h3>{events.map(e => <article className="crm-step" key={e.id}><time>{date(e.at)}</time><strong>{e.label}</strong>{e.input && Object.keys(e.input).length > 0 && <div className="crm-choices">{Object.entries(e.input).map(([k, v]) => <code key={k} dir="ltr">{k} = {String(v)}</code>)}</div>}{e.destination && <p>הועברו אל: <b dir="ltr">{e.destination}</b></p>}{e.campaign && <p>מקור פרסומת: {e.campaign}</p>}{e.status && <p>מצב: {states[e.status] || e.status}</p>}{e.plan && <p>מסלול: <span dir="auto">{e.plan}</span></p>}{e.amount_ils !== undefined && <p>{money(e.amount_ils)}</p>}{e.scheduled_at && <p>מועד מתוכנן: {date(e.scheduled_at)}</p>}{(e.summary || e.transcript) && <p>{e.summary || e.transcript}</p>}</article>)}</section>)}</div>;
}

export function CustomerCount({ list, status }: { list: { total: number; counts: Record<string, number> } | null; status: string }) { return <div className="crm-total"><strong>{list ? status ? list.counts[status] ?? 0 : list.total : '—'}</strong><span>לקוחות בתצוגה</span></div>; }

function AnalyticsPanel({ data }: { data: Analytics }) {
  const [sourceSort, setSourceSort] = useState('leads'), [sourceDirection, setSourceDirection] = useState<SortDirection>('desc');
  const [daySort, setDaySort] = useState('date'), [dayDirection, setDayDirection] = useState<SortDirection>('desc');
  const sortRows = (field: string, current: string, direction: SortDirection, setField: (v: string) => void, setDirection: (v: SortDirection) => void) => { if (field === current) setDirection(direction === 'asc' ? 'desc' : 'asc'); else { setField(field); setDirection('desc'); } };
  const sourceRows = useMemo(() => [...data.sources].sort((a, b) => { const av = a[sourceSort as keyof typeof a], bv = b[sourceSort as keyof typeof b]; const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'he'); return sourceDirection === 'asc' ? c : -c; }), [data.sources, sourceSort, sourceDirection]);
  const dayRows = useMemo(() => [...data.days].sort((a, b) => { const av = a[daySort as keyof typeof a], bv = b[daySort as keyof typeof b]; const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv)); return dayDirection === 'asc' ? c : -c; }), [data.days, daySort, dayDirection]);
  return <section className="crm-analytics" aria-label="אנליטיקה"><Kpis items={[["לידים", num(data.totals.leads)], ["התחילו לדבר", num(data.totals.customers_with_calls)], ["שיחות אנגלית", num(data.totals.calls)], ["דקות תרגול", num(data.totals.minutes)], ["ממתינים לחזרה", num(data.totals.callbacks_waiting)]]} /><Kpis items={[["הכנסה מאומתת", money(data.totals.revenue_ils)], ["עלות משוערת", money(data.totals.estimated_cost_ils)], ["טפסי אשראי", num(data.totals.card_orders)], ["תשלומי אשראי", num(data.totals.card_paid)], ["המרה לשיחה", data.totals.leads ? num(data.totals.customers_with_calls / data.totals.leads * 100) + '%' : '0%']]} /><div className="crm-analytics-grid"><section className="crm-table-panel"><h2 className="crm-panel-title">ביצועים לפי מקור</h2><div className="crm-table-scroll"><table><thead><tr>{[['source','מקור'],['leads','לידים'],['trials','התחילו שיחה'],['paying','משלמים'],['conversion_pct','המרה'],['minutes','דקות'],['revenue_ils','הכנסה']].map(([f,l]) => <th key={f}><SortButton field={f} active={sourceSort} direction={sourceDirection} onSort={field => sortRows(field, sourceSort, sourceDirection, setSourceSort, setSourceDirection)}>{l}</SortButton></th>)}</tr></thead><tbody>{sourceRows.map(row => <tr key={row.source}><td>{row.source}</td><td>{row.leads}</td><td>{row.trials}</td><td>{row.paying}</td><td>{num(row.conversion_pct)}%</td><td>{num(row.minutes)}</td><td>{money(row.revenue_ils)}</td></tr>)}</tbody></table></div></section><section className="crm-table-panel"><h2 className="crm-panel-title">פעילות ב־30 הימים האחרונים</h2><div className="crm-table-scroll crm-days"><table><thead><tr>{[['date','תאריך'],['leads','לידים חדשים'],['active','פעילים'],['calls','שיחות']].map(([f,l]) => <th key={f}><SortButton field={f} active={daySort} direction={dayDirection} onSort={field => sortRows(field, daySort, dayDirection, setDaySort, setDayDirection)}>{l}</SortButton></th>)}</tr></thead><tbody>{dayRows.map(row => <tr key={row.date}><td>{day(row.date)}</td><td>{row.leads}</td><td>{row.active}</td><td>{row.calls}</td></tr>)}</tbody></table></div></section></div><p className="crm-muted">עודכן: {date(data.generated_at)} · פעילות תרגומון וניווט אינה נכללת במדדי השיחות.</p></section>;
}

function CustomerForm({ card, onSaved, onClose }: { card?: Card; onSaved: (id: string) => void; onClose: () => void }) {
  const [form, setForm] = useState({ name: card?.name || '', phone: card?.phone || '', email: card?.email || '', source: card?.ad_source === 'לא ידוע' ? 'crm' : card?.ad_source || 'crm', notes: card?.notes || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const saved = await api<{ id: string }>('/v1/admin/business/customers' + (card ? '/' + encodeURIComponent(card.id) : ''), { method: card ? 'PUT' : 'POST', body: JSON.stringify(form) }); onSaved(saved.id); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <div className="crm-modal" role="dialog" aria-modal="true" aria-label={card ? 'עריכת לקוח' : 'לקוח חדש'}><form className="crm-form" onSubmit={submit}><div className="crm-between"><h2>{card ? 'עריכת פרטי לקוח' : 'הוספת ליד או תלמיד'}</h2><button type="button" className="crm-button" onClick={onClose}>סגירה</button></div>{error && <p className="crm-error" role="alert">{error}</p>}<label>שם<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>טלפון<input dir="ltr" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>דואר אלקטרוני<input dir="ltr" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>מקור<input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></label><label>הערות<textarea rows={5} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><button className="crm-primary" disabled={busy}>{busy ? 'שומרים…' : 'שמירה ב־CRM'}</button></form></div>;
}

export function CrmPage() {
  const identity = useAdminIdentity();
  const id = location.pathname.startsWith(base + '/') ? location.pathname.slice(base.length + 1).replace(/\/$/, '') : '';
  const requested = new URLSearchParams(location.search).get('view');
  const view = !id && (requested === 'teachers' || requested === 'returning' || requested === 'messages' || requested === 'analytics' || requested === 'call-reviews' || requested === 'costs' || requested === 'site' || requested === 'ads') ? requested : 'people';
  const loadsCustomers = view === 'people' || view === 'analytics';
  const [access, setAccess] = useState('');
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [source, setSource] = useState('');
  const [sort, setSort] = useState('last_activity'), [direction, setDirection] = useState<SortDirection>('desc');
  const [list, setList] = useState<{ items: Person[]; counts: Record<string, number>; total: number; cursor: string | null } | null>(null), [card, setCard] = useState<Card | null>(null), [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [cursor, setCursor] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [editing, setEditing] = useState(false), [creating, setCreating] = useState(false), [notice, setNotice] = useState('');
  const changeSort = (field: string) => { if (sort === field) setDirection(direction === 'asc' ? 'desc' : 'asc'); else { setSort(field); setDirection('desc'); } setCursor(''); };
  useEffect(() => {
    if (!loadsCustomers) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      const signal = controller.signal;
      const promise = id ? read<Card>('people/' + id, signal).then(setCard)
        : view === 'analytics' ? read<Analytics>('analytics', signal).then(setAnalytics)
          : read<NonNullable<typeof list>>('people?' + new URLSearchParams({ q, status, source, access, cursor, limit: '50', sort, direction }), signal).then(setList);
      void promise.catch(e => { if (!signal.aborted) setError(e.message); }).finally(() => { if (!signal.aborted) setLoading(false); });
    }, view === 'people' && !id ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, loadsCustomers, id, q, status, source, access, cursor, sort, direction, retry]);
  useEffect(() => {
    if (card && location.hash === '#customer-messages') document.getElementById('customer-messages')?.scrollIntoView();
  }, [card]);
  async function invite() { if (!card) return; try { const result = await api<{ token: string }>('/v1/admin/business/customers/' + encodeURIComponent(card.id) + '/invite', { method: 'POST', body: '{}' }); const url = location.origin + prefix + '/learn#' + result.token; await navigator.clipboard.writeText(url); setNotice('קישור אישי לאזור התלמיד ולתשלום בכרטיס הועתק.'); } catch (e) { setError((e as Error).message); } }
  const updatePerson = (person: Person) => { setCard(c => c?.id === person.id ? { ...c, ...person } : c); setList(l => l ? { ...l, items: l.items.map(p => p.id === person.id ? person : p) } : l); };
  const saved = (savedId: string) => { setEditing(false); setCreating(false); if (id === savedId) setRetry(v => v + 1); else location.href = base + '/' + encodeURIComponent(savedId); };
  return <div className="crm-root" dir="rtl"><div className="crm-main">
    <nav className="crm-workspace-nav" aria-label="ניווט קשרי לקוחות">
      {([['people', 'לקוחות'], ['teachers', 'הנחיות המורה'], ['returning', 'לקוחות חוזרים'], ['messages', 'הודעות קוליות'], ['analytics', 'מדדי לקוחות'], ['costs', 'עלויות ותובנות'], ['site', 'אנליטיקת אתר'], ['ads', 'פרסומות ומעקב']] as const).map(([key, label]) =>
        <a key={key} href={key === 'people' ? base : base + '?view=' + key} aria-current={view === key ? 'page' : undefined}>{label}</a>)}
      {identity?.role === 'owner' && <a href={base + '?view=call-reviews'} aria-current={view === 'call-reviews' ? 'page' : undefined}>סקירת שיחות</a>}
    </nav>
    {view === 'returning' && <ReturningPractice request={api} owner={identity?.role === 'owner'} base={base} />}
    {view === 'costs' && <CrmCostsPanel request={api} base={base} />}
    {view === 'teachers' && <TeacherSettingsPanel request={api} />}
    {view === 'site' && <AnalyticsView />}
    {view === 'ads' && <AdCampaignsPanel />}
    {view === 'messages' && <VoicemailInbox />}
    {view === 'call-reviews' && (identity?.role === 'owner' ? <CallReviewsPanel request={api} /> : <p className="crm-empty">סקירת השיחות זמינה לבעלי החשבון בלבד.</p>)}
    {view === 'analytics' && analytics && <AnalyticsPanel data={analytics} />}
    {view === 'people' && <>{!id && new URLSearchParams(location.search).get("reset") === "success" && <p className="crm-success" role="status">הלקוח נמחק. בשיחה הבאה המספר יתחיל כמתקשר חדש.</p>}{notice && <div className="crm-notice" role="status">{notice}</div>}</>}
    {loadsCustomers && error && <div role="alert" className="crm-error">{error} <button className="crm-button" onClick={() => setRetry(retry + 1)}>ניסיון חוזר</button></div>}
    {view === 'people' && <>{id ? <><a className="crm-back" href={base}>→ לכל הלקוחות</a>{card && <><div className="crm-title-row"><div><div className="crm-eyebrow">כרטיס לקוח פעיל</div><h1>{card.name}</h1><div className="crm-profile"><span dir="ltr">{card.phone}</span><span>{card.email}</span><span>{card.channels.map(c => c === 'phone' ? 'טלפון' : 'אתר').join(' + ')}</span></div></div><div className="crm-actions"><Badge person={card} /><DeleteCustomer person={card} /><button className="crm-button" onClick={() => setEditing(true)}>עריכת פרטים והערות</button><button className="crm-primary" onClick={() => void invite()}>{card.card_payment.available ? 'העתקת קישור תלמיד ותשלום' : 'העתקת קישור תלמיד'}</button></div></div><div className="crm-profile crm-profile-info"><span>כניסה ראשונה: <b>{date(card.first_seen)}</b></span><span>פעילות אחרונה: <b>{date(card.last_activity)}</b></span><span>מקור: {card.ad_source}</span><span>מסלול: {card.track}</span></div><section className="crm-subscription-bar"><div><h2>מנוי וגישה</h2><SubscriptionBadge person={card} /> <b>{card.subscription.plan_name}</b>{card.subscription.current_period_end && <p>תום תקופה: {date(card.subscription.current_period_end)}</p>}</div><div><h3>הוראת קבע</h3><NedarimStatus person={card} /></div><AccessButton person={card} onUpdate={updatePerson} /></section><PracticeCard practice={card.practice} /><CustomerCosts calls={card.calls} /><Kpis items={[["שיחות אנגלית", num(card.calls_count)], ["דקות תרגול", num(card.minutes_used)], ["עלות משוערת", money(card.total_cost_ils)], ["הכנסה מאומתת", money(card.revenue_ils)], ["יתרה משוערת", money(card.revenue_ils - card.total_cost_ils)]]} /><section className="crm-payment"><div><span className="crm-eyebrow">סליקה בכרטיס אשראי</span><h2>{card.card_payment.available ? states[card.card_payment.latest_state] || card.card_payment.latest_state : 'החיבור אינו מוגדר במלואו'}</h2><p>{card.card_payment.available ? 'הקישור האישי מוביל לאזור התלמיד, שבו ניתן לרכוש חבילה בכרטיס.' : 'חסרה לפחות אחת מהגדרות הסליקה הנדרשות; המערכת אינה מציגה אפשרות תשלום שאינה פעילה.'}</p></div><div><b>{card.card_payment.paid}</b><span>תשלומים מאומתים</span><small>{card.card_payment.orders} ניסיונות תשלום בכרטיס</small></div></section>{identity?.role === 'owner' && <SubscriptionPanel key={card.id + ':' + card.subscription.access} token="" customerId={card.id} manageAccess onRefresh={async () => setRetry(v => v + 1)} />}
    {view === 'people' && id && card && <div className="crm-actions"><ResetTrialButton key={card.id} customerId={card.id} request={api} onReset={() => setRetry(v => v + 1)} /></div>}
    <VoicemailInbox key={'messages:' + card.id} customerId={card.id} />
    {card.notes && <section className="crm-notes"><h2>הערות ניהוליות</h2><p>{card.notes}</p></section>}<div className="crm-detail-grid"><section><h2>מסע במערכת <span>{card.journey.length} אירועים</span></h2><p className="crm-muted">אירועים שנשמרו בלבד · שעה מדויקת לפי שעון ישראל</p>{card.journey.length ? <Journey steps={card.journey} /> : <p className="crm-empty">טרם נרשמה פעילות.</p>}</section><section><h2>שיחות אנגלית <span>{card.calls.length}</span></h2>{card.calls.length ? card.calls.map(c => <div key={c.call_id}><CallCard call={c} /><CallPath callId={c.call_id} steps={card.journey} /></div>) : <p className="crm-empty">עדיין אין שיחות אנגלית שמורות.</p>}</section></div></>}</> : <><div className="crm-title-row"><div><div className="crm-eyebrow">מרכז עבודה אחד</div><h1>לידים, תלמידים והכנסות — בזמן אמת.</h1><p className="crm-muted">חיפוש חכם, סטטוסים מחושבים, פעילות מדויקת ואנליטיקה של בית הספר בלבד.</p></div><div className="crm-actions"><CustomerCount list={list} status={status} /><button className="crm-primary" onClick={() => setCreating(true)}>+ ליד או תלמיד חדש</button></div></div><nav className="crm-tabs" aria-label="סינון לפי מצב">{[['', 'הכול'], ...Object.entries(labels)].map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => { setStatus(key); setCursor(''); }}>{label}<b>{key ? list?.counts[key] ?? 0 : list?.total ?? 0}</b></button>)}</nav><section className="crm-table-panel"><div className="crm-tools"><label><span>חיפוש חכם</span><input value={q} onChange={e => { setQ(e.target.value); setCursor(''); }} placeholder="שם, טלפון, מייל, סטטוס, מקור, מסלול או הערה" type="search" /></label><label><span>מקור מדויק</span><input value={source} placeholder="כל המקורות" onChange={e => { setSource(e.target.value); setCursor(''); }} /></label><label><span>גישת מנוי</span><select value={access} onChange={e => { setAccess(e.target.value); setCursor(''); }}><option value="">כל המנויים</option>{Object.entries(accessLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span className="crm-muted">לחיצה על כל כותרת ממיינת את הטבלה</span></div><div className="crm-table-scroll"><table><thead><tr>{[['name','שם / פרטי קשר'],['status','סטטוס'],['ad_source','מקור'],['track','מסלול'],['first_seen','כניסה ראשונה'],['last_activity','פעילות אחרונה'],['calls_count','שיחות'],['current_streak','רצף'],['practice_days_30','ימי תרגול 30 יום'],['minutes_used','דקות'],['total_cost_ils','עלות'],['revenue_ils','הכנסה']].map(([field, label]) => <th key={field}><SortButton field={field} active={sort} direction={direction} onSort={changeSort}>{label}</SortButton></th>)}<th>מנוי</th><th>הוראת קבע</th><th>פעולות מנוי</th></tr></thead><tbody>{!loading && !error && list?.items.map(p => <tr key={p.id} onClick={() => { location.href = base + '/' + encodeURIComponent(p.id); }}><td><a href={base + '/' + encodeURIComponent(p.id)}>{p.name}</a><small dir="ltr">{p.phone || p.email || 'אין פרטי קשר'}</small></td><td><Badge person={p} /></td><td>{p.ad_source}</td><td>{p.track}</td><td>{date(p.first_seen)}</td><td>{date(p.last_activity)}</td><td>{num(p.calls_count)}</td><td>{num(p.current_streak)}</td><td>{num(p.practice_days_30)}</td><td>{num(p.minutes_used)}</td><td>{money(p.total_cost_ils)}</td><td>{money(p.revenue_ils)}</td><td><SubscriptionBadge person={p} /></td><td><NedarimStatus person={p} /></td><td><AccessButton person={p} onUpdate={updatePerson} /></td></tr>)}</tbody></table></div>{!loading && !error && !list?.items.length && <div className="crm-empty">לא נמצאו לקוחות. נסו מונח או מסנן אחר.</div>}<footer className="crm-pagination"><span className="crm-muted">{list?.items.length ?? 0} לקוחות בעמוד</span>{cursor && <button className="crm-button" onClick={() => setCursor('')}>לעמוד הראשון</button>}{list?.cursor && <button className="crm-button" onClick={() => setCursor(list.cursor!)}>לעמוד הבא ←</button>}</footer></section></>}
    </>}{loadsCustomers && loading && <p className="crm-loading" role="status">טוענים נתוני אמת…</p>}{editing && card && <CustomerForm card={card} onSaved={saved} onClose={() => setEditing(false)} />}{creating && <CustomerForm onSaved={saved} onClose={() => setCreating(false)} />}<footer className="crm-footnote">ספיקול · מרכז קשרי לקוחות</footer></div></div>;
}
