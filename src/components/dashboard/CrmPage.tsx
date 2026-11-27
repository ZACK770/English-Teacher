import { CarePanel } from './CarePanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdminIdentity } from './AdminAuthGate';
import { CallReviewsPanel } from './CallReviewsPanel';
import { mergeTranscriptSegments } from './transcript';
import { VoicemailInbox } from './VoicemailInbox';
import { SubscriptionPanel } from '../portal/SubscriptionPanel';
import { AnalyticsView } from './AnalyticsView';
import { AdCampaignsPanel } from './AdCampaignsPanel';
import { CrmCostsPanel } from './CrmCostsPanel';
import { PracticeCard, ReturningPractice, type Practice } from './CrmPractice';
import { TeacherSettingsPanel } from './TeacherSettingsPanel';
import { ResetTrialButton } from './ResetTrialButton';
import { ContentSafetyPanel } from './ContentSafetyPanel';
import './crm.css';
import './crm-enhanced.css';
import { Workspace, workspaceTitles } from './Workspace';
import { PaymentsWorkspace } from './PaymentsWorkspace';
import './workspace.css';

type Status = 'new' | 'trial' | 'callback_pending' | 'offer_no_buy' | 'dropped' | 'paying';
type Access = 'open' | 'suspended' | 'payment_hold' | 'inactive' | 'none';
type Subscription = { subscription: { id: string | null; plan_name: string | null; status: string | null; current_period_end: string | null; access: Access }; nedarim: { id?: string | null; state: string; amount: number | null; last_refusal_at: string | null; keva_id_present: boolean } };
type CardPayment = { available: boolean; orders: number; paid: number; latest_state: string; latest_at: string | null };
type Person = Subscription & { verified_revenue_ils: number; latest_payment?: { id: string; amount_ils: number; at: string } | null; current_streak: number; practice_days_30: number; id: string; name: string; phone: string; email: string; notes: string; channels: string[]; first_seen: string; last_activity: string; ad_source: string; track: string; calls_count: number; minutes_used: number; total_cost_ils: number; revenue_ils: number; status: Status; status_label: string; card_payment: CardPayment };
type Call = { bot_id?: string; recording?: boolean; call_id: string; started_at: string; duration_seconds: number; teacher: string; summary_he: string; success_he: string; next_step_he: string; has_transcript: boolean; ai_cost_usd: number; ai_cost_ils: number; telephony_cost_ils: number; total_cost_ils: number; cost_basis: string; input_text_tokens: number; input_audio_tokens: number; output_text_tokens: number; output_audio_tokens: number; thoughts_tokens: number };
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

type CallTurn = { role?: string; text?: string };
type VoiceEvent = { event_name: string; since_call_start_ms: number; details: Record<string, unknown> };
type VoiceDetails = { turns: CallTurn[]; events: VoiceEvent[]; summary: { model?: string; estimated_cost_usd?: number; input_text_tokens?: number; output_text_tokens?: number } | null };
type ActiveCall = { call_id: string; started_at: string; customer_id: string; teacher: string; name?: string };

function VoiceMeasurements({ details }: { details: VoiceDetails }) {
  const events = details.events;
  const model = events.slice().reverse().find(event => ['school_voice_selected','gemini_connect_started','session_started'].includes(event.event_name) && event.details.model);
  const latency = events.find(event => event.event_name === 'first_audio_sent_to_phone');
  const usage = events.slice().reverse().find(event => ['pilot_usage','cascade_usage','crm_usage'].includes(event.event_name))?.details;
  const totals = events.slice().reverse().find(event => ['pilot_usage','crm_usage'].includes(event.event_name))?.details;
  const usd = (value: unknown) => typeof value === 'number' ? '$' + value.toFixed(5) : '—';
  const show = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? String(value) : '—';
  return <div className="crm-muted">
    <p>מודל: {show(details.summary?.model || model?.details.model)} · קול: {show(model?.details.voice)} · שמע ראשון: {latency ? Math.round(latency.since_call_start_ms) + ' ms' : '—'}</p>
    <p>טוקנים קלט / פלט: {show(details.summary?.input_text_tokens ?? totals?.input)} / {show(details.summary?.output_text_tokens ?? totals?.output)} · עלות AI: {usd(details.summary?.estimated_cost_usd ?? usage?.total)}</p>
    {usage?.llm_reported_usd !== undefined && <p>מודל מדווח {usd(usage.llm_reported_usd)} · תמלול משוער {usd(usage.stt_estimated_usd)} · הקראה משוערת {usd(usage.tts_estimated_usd)}</p>}
    <details><summary>אירועי שיחה וכלי מורה</summary>{events.map((event, i) => <p key={i}>{Math.round(event.since_call_start_ms)} ms · {event.event_name}{typeof event.details.name === 'string' ? ' · ' + event.details.name : ''}{typeof event.details.elapsed_ms === 'number' ? ' · ' + event.details.elapsed_ms + ' ms' : ''}</p>)}</details>
  </div>;
}

function ActiveVoiceCalls({ customer }: { customer?: string }) {
  const [calls, setCalls] = useState<ActiveCall[]>([]), [selected, setSelected] = useState(''), [details, setDetails] = useState<VoiceDetails | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const list = await read<{ calls: ActiveCall[] }>('active-calls' + (customer ? '/' + encodeURIComponent(customer) : ''));
        if (stopped) return;
        setCalls(list.calls);
        if (selected) {
          const result = await read<VoiceDetails>('calls/' + encodeURIComponent(selected) + '/details');
          if (stopped) return;
          setDetails(result);
        }
        setError('');
      } catch (failure) {
        if (!stopped) setError((failure as Error).message);
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [customer, selected]);
  return <section className="crm-call"><h2>שיחות פעילות</h2>{error && <p role="alert">{error}</p>}
    <select aria-label="שיחה פעילה" value={selected} onChange={event => { setDetails(null); setSelected(event.target.value); }}>
      <option value="">{calls.length ? 'בחר שיחה לצפייה בלייב' : 'אין שיחות פעילות'}</option>
      {calls.map(call => <option key={call.call_id} value={call.call_id}>{call.name || call.teacher} · {date(call.started_at)}</option>)}
      {selected && !calls.some(call => call.call_id === selected) && <option value={selected}>השיחה שנבחרה הסתיימה</option>}
    </select>
    {!customer && calls.find(call => call.call_id === selected) && <a href={base + '/' + encodeURIComponent(calls.find(call => call.call_id === selected)!.customer_id)}>כרטיס לקוח</a>}
    {details && <><VoiceMeasurements details={details} /><div className="crm-transcript" aria-label="תמלול שיחה פעילה">
      {details.turns.length === 0 && <p>ממתין לתמלול.</p>}
      {mergeTranscriptSegments(details.turns).map((turn, i) => <div key={i}><b>{turn.role === 'learner' ? 'לומד/ת' : 'מורה'}</b><p dir="auto">{turn.text}</p></div>)}
    </div></>}
  </section>;
}

function CallCard({ call }: { call: Call }) {
  const [open, setOpen] = useState(false), [turns, setTurns] = useState<{ role?: string; text?: string }[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<VoiceDetails | null>(null);
  async function toggle() { setOpen(!open); if (turns || busy || open) return; setBusy(true); setError(''); try { const result = await read<VoiceDetails>('calls/' + encodeURIComponent(call.call_id) + '/details'); setTurns(result.turns || []); setDetails(result); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <article className="crm-call"><div className="crm-between"><div><span className="crm-eyebrow">שיחה עם {call.bot_id ? <a href={base+'?view=teachers&bot='+encodeURIComponent(call.bot_id)}>{call.teacher}</a> : call.teacher}</span><h3>{date(call.started_at)}</h3></div><span className="crm-chip">{num(call.duration_seconds / 60)} דקות</span></div><p>{call.summary_he || 'לא נשמר סיכום לשיחה זו.'}</p>{call.success_he && <p className="crm-success">מה הצליח · {call.success_he}</p>}{call.next_step_he && <p>הצעד הבא · {call.next_step_he}</p>}<div className="crm-cost"><span>בינה מלאכותית <b>{money(call.ai_cost_ils)}</b><small>{call.ai_cost_usd.toFixed(4)} דולר · {call.cost_basis === 'gemini_usage_metadata' ? 'לפי דיווח אסימונים' : 'אומדן שימוש'}</small></span><span>טלפוניה — אומדן <b>{money(call.telephony_cost_ils)}</b><small>לפי עלות דקה חזויה, לא חיוב ספק</small></span><span>סה״כ משוער <b>{money(call.total_cost_ils)}</b></span></div><details className="crm-muted"><summary>פירוט אסימונים</summary>קלט טקסט: {call.input_text_tokens} · קלט קול: {call.input_audio_tokens} · פלט טקסט: {call.output_text_tokens} · פלט קול: {call.output_audio_tokens} · חשיבה: {call.thoughts_tokens}</details><div className="crm-between crm-call-footer">{call.recording ? <audio controls preload="none" aria-label="הקלטת השיחה" src={prefix + '/v1/admin/crm/recordings/' + encodeURIComponent(call.call_id) + '/audio'} /> : <span className="crm-muted">אין הקלטה זמינה</span>}{<button className="crm-button" onClick={() => void toggle()} aria-expanded={open}>{open ? 'סגירת פרטי השיחה' : 'תמלול ופרטי השיחה'}</button>}</div>{open && <div className="crm-transcript" aria-live="polite" tabIndex={0} role="region" aria-label="תמלול השיחה">{details && <VoiceMeasurements details={details} />}{busy && <p>טוענים תמלול…</p>}{error && <div role="alert">{error}</div>}{turns?.length === 0 && <p>התמלול ריק.</p>}{(turns && mergeTranscriptSegments(turns))?.map((t, i) => <div key={i}><b>{['learner', 'user'].includes(t.role || '') ? 'לומד/ת' : 'מורה'}</b><p dir="auto">{t.text}</p></div>)}</div>}</article>;
}

export function Journey({ steps, customer, calls = [] }: { steps: Step[]; customer?: string; calls?: Call[] }) {
  const physicalCalls = [...new Set(steps.filter(s => ['ivr-events', 'ad-entries'].includes(s.kind) && s.call_id).map(s => s.call_id!))].sort((a, b) => b.length - a.length);
  const groups = new Map<string, Step[]>();
  for (const step of steps) { const callId = step.call_id; const key = (callId && (physicalCalls.find(id => id === callId) || physicalCalls.find(id => callId.startsWith(id + '~')) || callId)) || 'event:' + step.id; groups.set(key, [...(groups.get(key) || []), step]); }
  return <div className="crm-timeline">{[...groups.entries()].map(([key, events]) => <section className="crm-journey-group" key={key}><h3>{events[0].call_id ? 'שיחה · ' + date(events[0].at) : 'פעילות נוספת'}</h3>{events.map(e => <article className="crm-step" key={e.id}><time>{date(e.at)}</time><strong>{e.label}</strong>{e.input && Object.keys(e.input).length > 0 && <div className="crm-choices">{Object.entries(e.input).map(([k, v]) => <code key={k} dir="ltr">{k} = {String(v)}</code>)}</div>}{e.destination && <p>הועברו אל: <b dir="ltr">{e.destination}</b></p>}{e.campaign && <p>מקור פרסומת: {e.campaign}</p>}{e.status && <p>מצב: {states[e.status] || e.status}</p>}{e.plan && <p>מסלול: <span dir="auto">{e.plan}</span></p>}{e.amount_ils !== undefined && <p>{money(e.amount_ils)}</p>}{customer && e.call_id && calls.some(call=>call.call_id===e.call_id) && <a href={base+'/'+encodeURIComponent(customer)+'?tab=calls#call-'+encodeURIComponent(e.call_id)}>פתיחת השיחה ←</a>}{customer && /^(subscription|receipt|order)/.test(e.kind) && <a href={e.kind==='receipt' ? base+'?view=payments&kind=receipt&payment='+encodeURIComponent(e.id.slice('receipt:'.length)) : base+'/'+encodeURIComponent(customer)+'?tab=payments'}>{e.kind==='receipt' ? 'פתיחת רשומת התשלום ←' : 'מנוי ותשלומים ←'}</a>}{e.scheduled_at && <p>מועד מתוכנן: {date(e.scheduled_at)}</p>}{(e.summary || e.transcript) && <p>{e.summary || e.transcript}</p>}</article>)}</section>)}</div>;
}

export function CustomerCount({ list, status }: { list: { total: number; counts: Record<string, number> } | null; status: string }) { return <div className="crm-total"><strong>{list ? status ? list.counts[status] ?? 0 : list.total : '—'}</strong><span>לקוחות בתצוגה</span></div>; }

function AnalyticsPanel({ data }: { data: Analytics }) {
  const [sourceSort, setSourceSort] = useState('leads'), [sourceDirection, setSourceDirection] = useState<SortDirection>('desc');
  const [daySort, setDaySort] = useState('date'), [dayDirection, setDayDirection] = useState<SortDirection>('desc');
  const sortRows = (field: string, current: string, direction: SortDirection, setField: (v: string) => void, setDirection: (v: SortDirection) => void) => { if (field === current) setDirection(direction === 'asc' ? 'desc' : 'asc'); else { setField(field); setDirection('desc'); } };
  const sourceRows = useMemo(() => [...data.sources].sort((a, b) => { const av = a[sourceSort as keyof typeof a], bv = b[sourceSort as keyof typeof b]; const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'he'); return sourceDirection === 'asc' ? c : -c; }), [data.sources, sourceSort, sourceDirection]);
  const dayRows = useMemo(() => [...data.days].sort((a, b) => { const av = a[daySort as keyof typeof a], bv = b[daySort as keyof typeof b]; const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv)); return dayDirection === 'asc' ? c : -c; }), [data.days, daySort, dayDirection]);
  return <section className="crm-analytics" aria-label="אנליטיקה"><Kpis items={[["לידים", num(data.totals.leads)], ["התחילו לדבר", num(data.totals.customers_with_calls)], ["שיחות אנגלית", num(data.totals.calls)], ["דקות תרגול", num(data.totals.minutes)], ["ממתינים לחזרה", num(data.totals.callbacks_waiting)]]} /><Kpis items={[["תקבולים רשומים", money(data.totals.revenue_ils)], ["עלות משוערת", money(data.totals.estimated_cost_ils)], ["טפסי אשראי", num(data.totals.card_orders)], ["תשלומי אשראי", num(data.totals.card_paid)], ["המרה לשיחה", data.totals.leads ? num(data.totals.customers_with_calls / data.totals.leads * 100) + '%' : '0%']]} /><div className="crm-analytics-grid"><section className="crm-table-panel"><h2 className="crm-panel-title">ביצועים לפי מקור</h2><div className="crm-table-scroll"><table><thead><tr>{[['source','מקור'],['leads','לידים'],['trials','התחילו שיחה'],['paying','משלמים'],['conversion_pct','המרה'],['minutes','דקות'],['revenue_ils','תקבולים רשומים']].map(([f,l]) => <th key={f}><SortButton field={f} active={sourceSort} direction={sourceDirection} onSort={field => sortRows(field, sourceSort, sourceDirection, setSourceSort, setSourceDirection)}>{l}</SortButton></th>)}</tr></thead><tbody>{sourceRows.map(row => <tr key={row.source}><td>{row.source}</td><td>{row.leads}</td><td>{row.trials}</td><td>{row.paying}</td><td>{num(row.conversion_pct)}%</td><td>{num(row.minutes)}</td><td>{money(row.revenue_ils)}</td></tr>)}</tbody></table></div></section><section className="crm-table-panel"><h2 className="crm-panel-title">פעילות ב־30 הימים האחרונים</h2><div className="crm-table-scroll crm-days"><table><thead><tr>{[['date','תאריך'],['leads','לידים חדשים'],['active','פעילים'],['calls','שיחות']].map(([f,l]) => <th key={f}><SortButton field={f} active={daySort} direction={dayDirection} onSort={field => sortRows(field, daySort, dayDirection, setDaySort, setDayDirection)}>{l}</SortButton></th>)}</tr></thead><tbody>{dayRows.map(row => <tr key={row.date}><td>{day(row.date)}</td><td>{row.leads}</td><td>{row.active}</td><td>{row.calls}</td></tr>)}</tbody></table></div></section></div><p className="crm-muted">עודכן: {date(data.generated_at)} · פעילות תרגומון וניווט אינה נכללת במדדי השיחות.</p></section>;
}

function CustomerForm({ card, onSaved, onClose }: { card?: Card; onSaved: (id: string) => void; onClose: () => void }) {
  const [form, setForm] = useState({ name: card?.name || '', phone: card?.phone || '', email: card?.email || '', source: card?.ad_source === 'לא ידוע' ? 'crm' : card?.ad_source || 'crm', notes: card?.notes || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const saved = await api<{ id: string }>('/v1/admin/business/customers' + (card ? '/' + encodeURIComponent(card.id) : ''), { method: card ? 'PUT' : 'POST', body: JSON.stringify(form) }); onSaved(saved.id); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <div className="crm-modal" role="dialog" aria-modal="true" aria-label={card ? 'עריכת לקוח' : 'לקוח חדש'}><form className="crm-form" onSubmit={submit}><div className="crm-between"><h2>{card ? 'עריכת פרטי לקוח' : 'הוספת ליד או תלמיד'}</h2><button type="button" className="crm-button" onClick={onClose}>סגירה</button></div>{error && <p className="crm-error" role="alert">{error}</p>}<label>שם<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>טלפון<input dir="ltr" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>דואר אלקטרוני<input dir="ltr" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>מקור<input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></label><label>הערות<textarea rows={5} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><button className="crm-primary" disabled={busy}>{busy ? 'שומרים…' : 'שמירה ב־CRM'}</button></form></div>;
}

export function CrmPage() {
  const identity = useAdminIdentity();
  const [routeRevision, setRouteRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRouteRevision(value => value + 1);
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element)?.closest('a');
      if (!anchor || !anchor.closest('.sc-workspace') || anchor.target || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || !(url.pathname === base || url.pathname.startsWith(base+'/'))) return;
      event.preventDefault(); history.pushState(null,'',url); changed();
      if (!url.hash) window.scrollTo(0,0);
    };
    document.addEventListener('click',navigate); window.addEventListener('popstate',changed);
    return () => { document.removeEventListener('click',navigate); window.removeEventListener('popstate',changed); };
  }, []);
  const id = location.pathname.startsWith(base + '/') ? location.pathname.slice(base.length + 1).replace(/\/$/, '') : '';
  const requested = new URLSearchParams(location.search).get('view');
  const view = id ? 'people' : requested && workspaceTitles[requested] ? requested : !requested && !location.search ? 'today' : 'people';
  const loadsCustomers = view === 'people' || view === 'analytics';
  const params = new URLSearchParams(location.search);
  const [access, setAccess] = useState(params.get('access') || '');
  const [timeline, setTimeline] = useState('all');
  const tabs = [['overview','סקירה'],['calls','שיחות ותמלול'],['practice','לימוד ותרגול'],['payments','מנוי ותשלומים'],['service','שירות והודעות'],['journey','ציר זמן'],['settings','הגדרות']] as const;
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab')! : location.hash === '#customer-messages' ? 'service' : 'overview';
  const tabLink = (key: string) => base + '/' + encodeURIComponent(id) + '?' + new URLSearchParams({tab:key, ...(params.get('return') ? {return:params.get('return')!} : {})});
  const [q, setQ] = useState(params.get('q') || ''), [status, setStatus] = useState(params.get('status') || ''), [source, setSource] = useState(params.get('source') || '');
  const [sort, setSort] = useState(params.get('sort') || 'last_activity'), [direction, setDirection] = useState<SortDirection>(params.get('direction') === 'asc' ? 'asc' : 'desc');
  const [list, setList] = useState<{ items: Person[]; counts: Record<string, number>; total: number; cursor: string | null } | null>(null), [card, setCard] = useState<Card | null>(null), [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [cursor, setCursor] = useState(params.get('cursor') || ''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [editing, setEditing] = useState(false), [creating, setCreating] = useState(false), [notice, setNotice] = useState('');
  const listQuery = new URLSearchParams({view:"people", q, status, source, access, cursor, sort, direction});
  const customerLink = (key:string) => base + "/" + encodeURIComponent(key) + "?return=" + encodeURIComponent(listQuery.toString() + "&y=" + Math.round(window.scrollY));
  const returnList = base + "?" + (params.get("return") || "view=people");
  const restored = useRef(false);
  useEffect(() => {
    const current = new URLSearchParams(location.search);
    setQ(current.get('q') || ''); setStatus(current.get('status') || ''); setSource(current.get('source') || '');
    setAccess(current.get('access') || ''); setCursor(current.get('cursor') || ''); setSort(current.get('sort') || 'last_activity'); setDirection(current.get('direction') === 'asc' ? 'asc' : 'desc');
    setNotice(''); setEditing(false); setCreating(false); restored.current = false;
  }, [routeRevision]);
  useEffect(() => { setCard(null); }, [id]);
  useEffect(() => {
    if (list && !id && !restored.current) {
      restored.current = true;
      window.scrollTo(0, Number(new URLSearchParams(location.search).get("y")) || 0);
    }
  }, [list,id]);
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
    if (card && location.hash) requestAnimationFrame(()=>document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({block:'start'}));
  }, [card, routeRevision]);
  async function invite() { if (!card) return; try { const result = await api<{ token: string }>('/v1/admin/business/customers/' + encodeURIComponent(card.id) + '/invite', { method: 'POST', body: '{}' }); const url = location.origin + prefix + '/learn#' + result.token; await navigator.clipboard.writeText(url); setNotice('קישור אישי לאזור התלמיד ולתשלום בכרטיס הועתק.'); } catch (e) { setError((e as Error).message); } }
  const updatePerson = (person: Person) => { setCard(c => c?.id === person.id ? { ...c, ...person } : c); setList(l => l ? { ...l, items: l.items.map(p => p.id === person.id ? person : p) } : l); };
  const saved = (savedId: string) => { setEditing(false); setCreating(false); if (id === savedId) setRetry(v => v + 1); else location.href = base + '/' + encodeURIComponent(savedId); };
  return <div className="crm-root"><Workspace base={base} view={view} owner={identity?.role === 'owner'} customerName={id ? card?.name : undefined}>
    {view === 'active-calls' && <><div className="crm-title-row"><div><div className="crm-eyebrow">בזמן אמת</div><h1>שיחות פעילות</h1><p className="crm-muted">תמלול ומדידות מהשיחה · רענון בכל 3 שניות</p></div></div><ActiveVoiceCalls /></>}
    {view === 'today' && <><div className="crm-title-row"><div><div className="crm-eyebrow">מרכז העבודה</div><h1>לטיפול היום</h1><p className="crm-muted">הלקוחות, המשימות וההמשך שדורשים תשומת לב.</p></div><a className="crm-button" href={base+'?view=people'}>כל הלקוחות ←</a></div><CarePanel request={api} base={base} /></>}
    {view === 'returning' && <ReturningPractice request={api} owner={identity?.role === 'owner'} base={base} />}
    {view === 'costs' && <CrmCostsPanel request={api} base={base} />}
    {view === 'payments' && <PaymentsWorkspace key={location.search} base={base} />}
    {view === 'teachers' && <><TeacherSettingsPanel request={api} />{identity?.role === 'owner' && <ContentSafetyPanel request={api} />}</>}
    {view === 'voice-lab' && (identity?.role === 'owner' ? <><div className="crm-title-row"><div><div className="crm-eyebrow">ניסוי · מדידה · פרסום</div><h1>מעבדת הקול</h1><p className="crm-muted">כוונון שלוחה 888, מעקב שיחות ובחירת הגרסה לשלוחה 1.</p></div><a className="crm-button" href={base+'?view=teachers'}>הנחיות המורים ←</a></div><iframe className="sc-voice-lab" title="מעבדת הקול — הגדרות ושיחות אמת" src={prefix+'/dashboard/pilot-888?embedded=1'} /></> : <p className="crm-empty">מעבדת הקול זמינה לבעלי החשבון.</p>)}
    {view === 'site' && <AnalyticsView />}{view === 'ads' && <AdCampaignsPanel />}{view === 'messages' && <VoicemailInbox />}
    {view === 'call-reviews' && (identity?.role === 'owner' ? <CallReviewsPanel request={api} /> : <p className="crm-empty">סקירת השיחות זמינה לבעלי החשבון בלבד.</p>)}
    {view === 'analytics' && analytics && <><h1>פעילות בית הספר</h1><AnalyticsPanel data={analytics} /></>}
    {notice && <div className="crm-notice" role="status">{notice}</div>}
    {loadsCustomers && error && <div role="alert" className="crm-error">{error} <button className="crm-button" onClick={() => setRetry(retry + 1)}>ניסיון חוזר</button></div>}
    {view === 'people' && (id ? <>
      <a className="crm-back" href={params.get('from') === 'today' ? base : returnList}>→ חזרה לרשימה</a>
      {card && <>
        <header className="sc-customer-header"><div className="sc-customer-identity"><span className="sc-avatar" aria-hidden="true">{card.name?.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('') || 'ל'}</span><div><div className="crm-eyebrow">כרטיס לקוח</div><h1>{card.name || 'לקוח ללא שם'}</h1><div className="crm-profile">{card.phone && <a href={'tel:'+card.phone} dir="ltr">{card.phone}</a>}{card.email && <a href={'mailto:'+card.email}>{card.email}</a>}</div></div></div><div className="crm-actions"><Badge person={card}/><button className="crm-button" onClick={()=>setEditing(true)}>עריכת פרטים</button><button className="crm-primary" onClick={()=>void invite()}>העתקת קישור תלמיד חדש</button></div></header>
        <nav className="sc-record-tabs sc-customer-tabs" aria-label="לשוניות כרטיס לקוח">{tabs.map(([key,label])=><a key={key} href={tabLink(key)} aria-current={tab===key?'page':undefined}>{label}{key==='calls' && <span>{card.calls_count}</span>}</a>)}</nav>
        <div className="sc-customer-content" key={tab}>
        {tab === 'overview' && <>
          <Kpis items={[["שיחות אנגלית",num(card.calls_count)],["דקות תרגול",num(card.minutes_used)],["הכנסה מאומתת",money(card.verified_revenue_ils)],["עלות משוערת",money(card.total_cost_ils)]]}/>
          <div className="sc-overview-grid"><section className="sc-record-panel"><div className="crm-between"><h2>תמונת לקוח</h2><SubscriptionBadge person={card}/></div><dl className="sc-facts"><dt>מסלול</dt><dd>{card.subscription.plan_name || card.track || '—'}</dd><dt>פעילות אחרונה</dt><dd>{date(card.last_activity)}</dd><dt>הצטרפות</dt><dd>{date(card.first_seen)}</dd><dt>מקור</dt><dd>{card.ad_source}</dd><dt>ערוצי קשר</dt><dd>{card.channels.map(c=>c==='phone'?'טלפון':'אתר').join(' · ') || '—'}</dd><dt>חיוב אחרון מאומת</dt><dd>{card.latest_payment ? <a href={base+'?view=payments&kind=receipt&payment='+encodeURIComponent(card.latest_payment.id)}>{money(card.latest_payment.amount_ils)} · {date(card.latest_payment.at)} ←</a> : 'אין חיוב מאומת'}</dd><dt>מנוי</dt><dd><a href={tabLink('payments')}>מנוי, תשלומים והוראת קבע ←</a></dd></dl></section>
          <section className="sc-record-panel"><div className="crm-between"><h2>השיחה האחרונה</h2><a href={tabLink('calls')}>כל השיחות ←</a></div>{card.calls[0] ? <><p className="crm-muted">{date(card.calls[0].started_at)} · {card.calls[0].teacher}</p><p className="sc-call-summary">{card.calls[0].summary_he || 'אין סיכום שמור לשיחה.'}</p>{card.calls[0].next_step_he && <p className="sc-next-step">{card.calls[0].next_step_he}</p>}<a className="crm-button" href={tabLink('calls')+'#call-'+encodeURIComponent(card.calls[0].call_id)}>תמלול ומדידות ←</a></> : <p className="crm-empty">עדיין אין שיחות שמורות.</p>}</section></div>
          <CarePanel customer={card.id} request={api} base={base}/>
          {card.notes && <section className="crm-notes"><div className="crm-between"><h2>הערות ניהוליות</h2><button className="crm-button" onClick={()=>setEditing(true)}>עריכה</button></div><p>{card.notes}</p></section>}
        </>}
        {tab === 'calls' && <><ActiveVoiceCalls customer={card.id}/><div className="crm-between"><h2>היסטוריית שיחות</h2><span className="crm-muted">{card.calls.length} שיחות שמורות בתצוגה</span></div>{card.calls.length ? card.calls.map(call=><div key={call.call_id} id={'call-'+call.call_id}><CallCard call={call}/><details className="sc-call-route"><summary>מסלול והקשות</summary><CallPath callId={call.call_id} steps={card.journey}/></details></div>) : <p className="crm-empty">עדיין אין שיחות אנגלית שמורות.</p>}</>}
        {tab === 'practice' && <><h2>לימוד ותרגול</h2><PracticeCard practice={card.practice}/><CustomerCosts calls={card.calls}/></>}
        {tab === 'payments' && <><section className="crm-subscription-bar"><div><h2>מנוי וגישה</h2><SubscriptionBadge person={card}/> <b>{card.subscription.plan_name}</b>{card.subscription.current_period_end && <p>תום תקופה: {date(card.subscription.current_period_end)}</p>}</div><div><h3>הוראת קבע</h3><NedarimStatus person={card}/>{card.nedarim.id && <p><a href={base+'?view=payments&kind=standing&payment='+encodeURIComponent(card.nedarim.id)}>פתיחת הוראת הקבע ←</a></p>}</div><AccessButton person={card} onUpdate={updatePerson}/></section>
          <PaymentsWorkspace base={base} customer={card.id}/>
          {identity?.role === 'owner' && <SubscriptionPanel key={card.id+':'+card.subscription.access} token="" customerId={card.id} manageAccess onRefresh={async()=>setRetry(v=>v+1)}/>}
          <details className="sc-record-panel"><summary>מצב סליקה בכרטיס</summary><p>{card.card_payment.available ? states[card.card_payment.latest_state] || card.card_payment.latest_state : 'החיבור אינו מוגדר במלואו'}</p><p>{card.card_payment.paid} תשלומים מאומתים · {card.card_payment.orders} ניסיונות תשלום</p></details>
        </>}
        {tab === 'service' && <><CarePanel customer={card.id} request={api} base={base}/><VoicemailInbox customerId={card.id}/></>}
        {tab === 'journey' && <><div className="crm-between"><div><h2>ציר הזמן</h2><p className="crm-muted">אירועים שנשמרו · לפי שעון ישראל</p></div><select aria-label="סינון ציר הזמן" value={timeline} onChange={event=>setTimeline(event.target.value)}><option value="all">כל האירועים</option><option value="calls">שיחות</option><option value="service">שירות</option><option value="payments">מנוי ותשלומים</option></select></div>{card.journey.length ? <Journey steps={card.journey.filter(e=>timeline==='all'||(timeline==='payments'?/^(subscription|receipt|order)/:timeline==='service'?/^(callback|voicemail|sales-followups)/:/^(session|ivr-events|ad-entries)/).test(e.kind))} customer={card.id} calls={card.calls}/> : <p className="crm-empty">טרם נרשמה פעילות.</p>}</>}
        {tab === 'settings' && <>{identity?.role === 'owner' && <ContentSafetyPanel customerId={card.id} request={api}/>}<section className="sc-record-panel"><h2>פעולות ניהול</h2><div className="crm-actions"><button className="crm-button" onClick={()=>setEditing(true)}>פרטי קשר והערות</button><ResetTrialButton customerId={card.id} request={api} onReset={()=>setRetry(v=>v+1)}/><DeleteCustomer person={card}/></div></section></>}
        </div>
      </>}
    </> : <>
      {params.get('reset')==='success' && <p className="crm-success" role="status">הלקוח נמחק. בשיחה הבאה המספר יתחיל כמתקשר חדש.</p>}
      <div className="crm-title-row"><div><div className="crm-eyebrow">קשרים שמתקדמים</div><h1>לקוחות</h1><p className="crm-muted">כל לקוח, עם ההקשר והפעולה הבאה.</p></div><div className="crm-actions"><CustomerCount list={list} status={status}/><button className="crm-primary" onClick={()=>setCreating(true)}>+ לקוח חדש</button></div></div>
      <nav className="crm-tabs" aria-label="סינון לפי מצב">{[['','הכול'],...Object.entries(labels)].map(([key,label])=><button key={key} aria-pressed={status===key} onClick={()=>{setStatus(key);setCursor('');}}>{label}<b>{list ? key ? list.counts[key] ?? 0 : list.total : '—'}</b></button>)}</nav>
      <section className="crm-table-panel"><div className="crm-tools"><label><span>חיפוש לקוח</span><input value={q} onChange={event=>{setQ(event.target.value);setCursor('');}} placeholder="שם, טלפון, דוא״ל או הערה" type="search"/></label><label><span>מקור</span><input value={source} placeholder="כל המקורות" onChange={event=>{setSource(event.target.value);setCursor('');}}/></label><label><span>גישת מנוי</span><select value={access} onChange={event=>{setAccess(event.target.value);setCursor('');}}><option value="">כל המנויים</option>{Object.entries(accessLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className="crm-table-scroll"><table className="sc-people-table"><thead><tr>{[['name','לקוח'],['status','מצב'],['last_activity','פעילות אחרונה'],['calls_count','שיחות'],['minutes_used','דקות'],['verified_revenue_ils','הכנסה מאומתת']].map(([field,label])=><th key={field}><SortButton field={field} active={sort} direction={direction} onSort={changeSort}>{label}</SortButton></th>)}<th>מנוי</th><th>כספים</th></tr></thead><tbody>{!loading && !error && list?.items.map(person=><tr key={person.id}><td><a className="sc-person-cell" href={customerLink(person.id)}><span className="sc-avatar sc-avatar-small" aria-hidden="true">{person.name?.[0] || 'ל'}</span><span><strong>{person.name || 'ללא שם'}</strong><small dir="ltr">{person.phone || person.email || 'אין פרטי קשר'}</small></span></a></td><td><Badge person={person}/></td><td>{date(person.last_activity)}</td><td><a href={customerLink(person.id)+'&tab=calls'}>{num(person.calls_count)}</a></td><td>{num(person.minutes_used)}</td><td>{money(person.verified_revenue_ils)}</td><td><a href={customerLink(person.id)+'&tab=payments'}><SubscriptionBadge person={person}/></a></td><td><a className="sc-record-link" href={customerLink(person.id)+'&tab=payments'}>תשלומים ←</a></td></tr>)}</tbody></table></div>
      {!loading && !error && !list?.items.length && <div className="crm-empty">לא נמצאו לקוחות. נסו מונח או מסנן אחר.</div>}
      <footer className="crm-pagination"><span className="crm-muted">{list?.items.length ?? 0} לקוחות בעמוד</span>{cursor && <button className="crm-button" onClick={()=>setCursor('')}>לעמוד הראשון</button>}{list?.cursor && <button className="crm-button" onClick={()=>setCursor(list.cursor!)}>לעמוד הבא ←</button>}</footer></section>
    </>)}
    {loadsCustomers && loading && <p className="crm-loading" role="status">טוענים נתוני אמת…</p>}
    {editing && card && <CustomerForm card={card} onSaved={saved} onClose={()=>setEditing(false)}/>}{creating && <CustomerForm onSaved={saved} onClose={()=>setCreating(false)}/>}
    <footer className="crm-footnote">ספיקול · סביבת העבודה שלך</footer>
  </Workspace></div>;
}
