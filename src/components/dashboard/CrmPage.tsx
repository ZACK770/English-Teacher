import { useEffect, useRef, useState } from 'react';
import { useAdminIdentity } from './AdminAuthGate';
import './crm.css';

type Status = 'new' | 'trial' | 'callback_pending' | 'offer_no_buy' | 'dropped' | 'paying';
type Person = { id: string; name: string; phone: string; email: string; channels: string[]; first_seen: string; last_activity: string; ad_source: string; track: string; calls_count: number; minutes_used: number; total_cost_ils: number; revenue_ils: number; status: Status; status_label: string };
type Call = { call_id: string; started_at: string; duration_seconds: number; teacher: string; summary_he: string; success_he: string; next_step_he: string; has_transcript: boolean; ai_cost_usd: number; ai_cost_ils: number; telephony_cost_ils: number; total_cost_ils: number; cost_basis: string; input_text_tokens: number; input_audio_tokens: number; output_text_tokens: number; output_audio_tokens: number; thoughts_tokens: number };
type Step = { id: string; kind: string; call_id: string | null; at: string; label: string; input?: Record<string, unknown>; destination?: string; campaign?: string; status?: string; amount_ils?: number; plan?: string; summary?: string; transcript?: string; scheduled_at?: string };
type Card = Person & { calls: Call[]; journey: Step[]; assumptions: { telephony_note: string; usd_ils: number; telephony_rate_ils: number } };
const labels: Record<Status, string> = { new: 'חדשים', trial: 'בניסיון', callback_pending: 'מחכים לשיחה חוזרת', offer_no_buy: 'הגיעו להצעה ולא קנו', dropped: 'נפלו בדרך', paying: 'משלמים' };
const states: Record<string, string> = { pending: 'ממתין', queued: 'בתור', scheduled: 'מתוזמן', sent: 'נשלח', active: 'פעיל', cancelled: 'בוטל', completed: 'הושלם', failed: 'נכשל', expired: 'פג תוקף', dispatching: 'בביצוע', past_due: 'ממתין לתשלום', trial: 'ניסיון', paused: 'מוקפא' };
const date = (v: string) => v ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : 'אין מידע';
const money = (v: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(v);
const num = (v: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(v);
const prefix = location.pathname.startsWith('/english/') ? '/english' : '';
const base = prefix + '/dashboard/crm';
async function read<T,>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(prefix + '/v1/admin/crm/' + path, { credentials: 'same-origin', cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'הכניסה פגה. יש להתחבר מחדש.' : response.status === 404 ? 'הרשומה לא נמצאה.' : 'לא ניתן לטעון את הנתונים. נסו שוב.');
  return response.json();
}
function Badge({ person }: { person: Person }) { return <span className={'crm-badge crm-' + person.status}>{person.status_label}</span>; }
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
function CallCard({ call }: { call: Call }) {
  const [open, setOpen] = useState(false), [turns, setTurns] = useState<{ role?: string; text?: string }[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function toggle() {
    setOpen(!open);
    if (turns || busy || open) return;
    setBusy(true); setError('');
    try { const result = await read<{ turns: { role?: string; text?: string }[] }>('calls/' + encodeURIComponent(call.call_id) + '/transcript'); setTurns(result.turns || []); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <article className="crm-call"><div className="crm-between"><div><span className="crm-eyebrow">שיחה עם {call.teacher}</span><h3>{date(call.started_at)}</h3></div><span className="crm-chip">{num(call.duration_seconds / 60)} דקות</span></div><p>{call.summary_he || 'לא נשמר סיכום לשיחה זו.'}</p>{call.success_he && <p className="crm-success">מה הצליח · {call.success_he}</p>}{call.next_step_he && <p>הצעד הבא · {call.next_step_he}</p>}<div className="crm-cost"><span>בינה מלאכותית <b>{money(call.ai_cost_ils)}</b><small>{call.ai_cost_usd.toFixed(4)} דולר · {call.cost_basis === 'gemini_usage_metadata' ? 'לפי דיווח אסימונים' : 'אומדן שימוש'}</small></span><span>טלפוניה — אומדן <b>{money(call.telephony_cost_ils)}</b><small>לפי עלות דקה חזויה, לא חיוב ספק</small></span><span>סה״כ משוער <b>{money(call.total_cost_ils)}</b></span></div><details className="crm-muted"><summary>פירוט אסימונים</summary>קלט טקסט: {call.input_text_tokens} · קלט קול: {call.input_audio_tokens} · פלט טקסט: {call.output_text_tokens} · פלט קול: {call.output_audio_tokens} · חשיבה: {call.thoughts_tokens}</details><div className="crm-between crm-call-footer"><span className="crm-muted">הקלטה: לא נשמרת עדיין</span>{call.has_transcript ? <button className="crm-button" onClick={() => void toggle()} aria-expanded={open}>{open ? 'סגירת תמלול' : 'פתיחת תמלול'}</button> : <span className="crm-muted">לא נשמר תמלול</span>}</div>{open && <div className="crm-transcript" aria-live="polite">{busy && <p>טוענים תמלול…</p>}{error && <div role="alert">{error} <button onClick={() => { setOpen(false); }}>סגירה וניסיון חוזר</button></div>}{turns?.length === 0 && <p>התמלול ריק.</p>}{turns?.map((t, i) => <div key={i}><b>{['learner', 'user'].includes(t.role || '') ? 'לומד/ת' : 'מורה'}</b><p dir="auto">{t.text}</p></div>)}</div>}</article>;
}
export function Journey({ steps }: { steps: Step[] }) {
  const physicalCalls = [...new Set(steps.filter(s => ['ivr-events', 'ad-entries'].includes(s.kind) && s.call_id).map(s => s.call_id!))].sort((a, b) => b.length - a.length);
  const groups = new Map<string, Step[]>();
  for (const step of steps) {
    const callId = step.call_id;
    const key = (callId && (physicalCalls.find(id => id === callId) || physicalCalls.find(id => callId.startsWith(id + '~')) || callId)) || 'event:' + step.id;
    groups.set(key, [...(groups.get(key) || []), step]);
  }
  return <div className="crm-timeline">{[...groups.entries()].map(([key, events]) => <section className="crm-journey-group" key={key}><h3>{events[0].call_id ? 'שיחה · ' + date(events[0].at) : 'פעילות נוספת'}</h3>{events.map(e => <article className="crm-step" key={e.id}><time>{date(e.at)}</time><strong>{e.label}</strong>{e.input && Object.keys(e.input).length > 0 && <div className="crm-choices">{Object.entries(e.input).map(([k, v]) => <code key={k} dir="ltr">{k} = {String(v)}</code>)}</div>}{e.destination && <p>הועברו אל: <b dir="ltr">{e.destination}</b></p>}{e.campaign && <p>מקור פרסומת: {e.campaign}</p>}{e.status && <p>מצב: {states[e.status] || 'מצב נוסף שנרשם במערכת'}</p>}{e.plan && <p>מסלול: <span dir="auto">{e.plan}</span></p>}{e.amount_ils !== undefined && <p>{money(e.amount_ils)}</p>}{e.scheduled_at && <p>מועד מתוכנן: {date(e.scheduled_at)}</p>}{(e.summary || e.transcript) && <p>{e.summary || e.transcript}</p>}</article>)}</section>)}</div>;
}
export function CustomerCount({ list, status }: { list: { total: number; counts: Record<string, number> } | null; status: string }) {
  return <div className="crm-total"><strong>{list ? status ? list.counts[status] ?? 0 : list.total : '—'}</strong><span>לקוחות בתצוגה</span></div>;
}
export function CrmPage() {
  const id = location.pathname.slice(base.length).replace(/^\//, '');
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [source, setSource] = useState('');
  const [list, setList] = useState<{ items: Person[]; counts: Record<string, number>; total: number; cursor: string | null } | null>(null), [card, setCard] = useState<Card | null>(null);
  const [cursor, setCursor] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const timer = setTimeout(() => {
      const promise = id ? read<Card>('people/' + id, controller.signal).then(setCard) : read<NonNullable<typeof list>>('people?' + new URLSearchParams({ q, status, source, cursor, limit: '50' }), controller.signal).then(setList);
      void promise.catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, q, status, source, cursor, retry]);
  return <div className="crm-root" dir="rtl"><header className="crm-header"><a className="crm-wordmark" href={base}>ספיקול<span>מרכז קשרי לקוחות</span></a><div className="crm-header-links"><span className="crm-live">תצוגת נתונים · קריאה בלבד</span><a href={prefix + '/dashboard'}>למרכז הניהול ←</a></div></header><main className="crm-main">{!id && new URLSearchParams(location.search).get('reset') === 'success' && <p className="crm-success" role="status">הלקוח נמחק. בשיחה הבאה המספר יתחיל כמתקשר חדש.</p>}{error ? <div role="alert" className="crm-error">{error} <button className="crm-button" onClick={() => setRetry(retry + 1)}>ניסיון חוזר</button></div> : null}{id ? <><a className="crm-back" href={base}>→ לכל הלקוחות</a>{card && <><div className="crm-title-row"><div><div className="crm-eyebrow">כרטיס לקוח</div><h1>{card.name}</h1><div className="crm-profile"><span dir="ltr">{card.phone}</span><span>{card.email}</span><span>{card.channels.map(c => c === 'phone' ? 'טלפון' : 'אתר').join(' + ')}</span></div></div><div className="crm-header-links"><Badge person={card} /><DeleteCustomer person={card} /></div></div><div className="crm-profile crm-profile-info"><span>מקור: {card.ad_source}</span><span>מסלול: {card.track}</span><span>נראה לראשונה: {date(card.first_seen)}</span><span>פעילות אחרונה: {date(card.last_activity)}</span></div><Kpis items={[["שיחות", num(card.calls_count)], ["דקות תרגול", num(card.minutes_used)], ["עלות כוללת משוערת", money(card.total_cost_ils)], ["הכנסה", money(card.revenue_ils)], ["יתרה לאחר עלות משוערת", money(card.revenue_ils - card.total_cost_ils)]]} /><p className="crm-muted">העלויות הן אומדן, לא דוח רווח חשבונאי. שער דולר: {card.assumptions.usd_ils} ₪; דקת טלפוניה: {money(card.assumptions.telephony_rate_ils)} לפי הנחות העסק.</p><div className="crm-detail-grid"><section><h2>מסע במערכת <span>{card.journey.length} אירועים</span></h2><p className="crm-muted">אירועים שנשמרו בלבד · מקובצים לפי שיחה · שעון ישראל</p>{card.journey.length ? <Journey steps={card.journey} /> : <p className="crm-empty">טרם נרשמה פעילות.</p>}</section><section><h2>שיחות <span>{card.calls.length}</span></h2>{card.calls.length ? card.calls.map(c => <CallCard call={c} key={c.call_id} />) : <p className="crm-empty">עדיין אין שיחות שמורות.</p>}</section></div></>}</> : <><div className="crm-title-row"><div><div className="crm-eyebrow">אנשים, לא רק מספרים</div><h1>כל לקוח. כל שלב בדרך.</h1><p className="crm-muted">מבט אחד על האנשים, השיחות וההזדמנויות בספיקול.</p></div><CustomerCount list={list} status={status} /></div><nav className="crm-tabs" aria-label="סינון לפי מצב">{[['', 'הכול'], ...Object.entries(labels)].map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => { setStatus(key); setCursor(''); }}>{label}<b>{key ? list?.counts[key] ?? 0 : list?.total ?? 0}</b></button>)}</nav><section className="crm-table-panel"><div className="crm-tools"><label><span>חיפוש לקוח</span><input value={q} onChange={e => { setQ(e.target.value); setCursor(''); }} placeholder="שם, טלפון או דואר אלקטרוני" type="search" /></label><label><span>מקור פרסומת</span><input value={source} placeholder="כל המקורות" onChange={e => { setSource(e.target.value); setCursor(''); }} /></label><span className="crm-muted">עלות כוללת משוערת · זמני ישראל</span></div><div className="crm-table-scroll"><table><thead><tr>{['שם / טלפון', 'סטטוס', 'מקור פרסומת', 'מסלול', 'שיחות', 'דקות', 'עלות ₪', 'הכנסה ₪', 'פעילות אחרונה'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{!loading && !error && list?.items.map(p => <tr key={p.id} onClick={() => { location.href = base + '/' + encodeURIComponent(p.id); }}><td><a href={base + '/' + encodeURIComponent(p.id)}>{p.name}</a><small dir="ltr">{p.phone || p.email || 'אין פרטי קשר'}</small></td><td><Badge person={p} /></td><td>{p.ad_source}</td><td>{p.track}</td><td>{num(p.calls_count)}</td><td>{num(p.minutes_used)}</td><td>{money(p.total_cost_ils)}</td><td>{money(p.revenue_ils)}</td><td>{date(p.last_activity)}</td></tr>)}</tbody></table></div>{!loading && !error && !list?.items.length && <div className="crm-empty">לא נמצאו לקוחות. נסו לשנות את החיפוש או המסננים.</div>}<footer className="crm-pagination"><span className="crm-muted">{list?.items.length ?? 0} לקוחות בעמוד</span>{cursor && <button className="crm-button" onClick={() => setCursor('')}>לעמוד הראשון</button>}{list?.cursor && <button className="crm-button" onClick={() => setCursor(list.cursor!)}>לעמוד הבא ←</button>}</footer></section></>}{loading && <p className="crm-loading" role="status">טוענים את התמונה המלאה…</p>}<footer className="crm-footnote">ספיקול · קשר אנושי, תמונה מלאה. הנתונים הקיימים מוצגים ללא שינוי.</footer></main></div>;
}
