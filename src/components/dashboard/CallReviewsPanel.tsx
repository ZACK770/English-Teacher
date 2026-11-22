import { Fragment, useEffect, useState } from 'react';

type Request = <T,>(path: string, init?: RequestInit) => Promise<T>;
type Source = 'ai' | 'ivr';
type Status = 'reviewed' | 'rules_only' | 'no_transcript' | 'pending' | 'failed';
type Review = { source: Source; status: Status; call_id: string; ended_at: string; findings: { code: string }[] };
type Candidate = {
  profile_id: string; profile_label: string; bot_version: number; code: string; affected: number; reviewed: number; learners: number;
  evidence_call_ids: string[]; proposed_instruction_he: string;
};
type Report = {
  coverage: { source: Source; status: Status; logs: number; review_cost_usd: number }[];
  findings: { code: string; logs: number }[];
  prompt_candidates: Candidate[];
  recent: Review[];
};
type Cost = { ai_estimated_usd: number | null; review_estimated_usd: number | null; phone: { navigation_seconds: number; estimated_ils: number | null } | null };

const endpoint = '/v1/admin/call-reviews';
const sourceLabels: Record<Source, string> = { ai: 'שיחת AI', ivr: 'תפריט טלפוני' };
const statusLabels: Record<Status, string> = { reviewed: 'התמליל נבדק', rules_only: 'נבדק לפי כללים', no_transcript: 'אין תמליל', pending: 'ממתין לבדיקה', failed: 'הבדיקה נכשלה' };
const findingLabels = new Map(Object.entries({
  content_drift: 'המורה גלש לנושא שאינו מתאים לשיעור',
  long_reply: 'תשובה ארוכה מדי', no_practice: 'חסר תרגול בדיבור', missed_correction: 'תיקון חסר',
  wrong_level: 'רמה לא מתאימה', wrong_language: 'שפה לא מתאימה', missed_request: 'בקשת תלמיד לא נענתה',
  menu_confusion: 'הנחיית תפריט שגויה', call_failed: 'שיחה נכשלה', call_lease_lost: 'הקצאת שיחה אבדה',
  call_lease_failed: 'הקצאת שיחה נכשלה', gemini_reconnect_failed: 'חיבור מחדש ל־Gemini נכשל',
  gemini_reconnect_exhausted: 'ניסיונות החיבור מחדש ל־Gemini מוצו', invalid_audio_frame: 'נתוני שמע לא תקינים',
  pbx_input_timeout: 'לא התקבל קלט מהטלפון בזמן', idle_timeout: 'השיחה נסגרה ללא פעילות', gemini_budget_reached: 'הגעה לתקרת תקציב Gemini',
  gemini_guard_unavailable: 'בדיקת תקציב Gemini לא זמינה', system_busy: 'המערכת הייתה עמוסה',
  basic_translation_failed: 'תרגום נכשל', intake_missing_at_end: 'קליטת תלמיד לא הושלמה', no_audio_sent: 'לא נשלח שמע לטלפון',
}));
const menuLabels = new Map(Object.entries({ options: 'אפשרויות', main: 'ראשי', school: 'בית הספר', service: 'שירות', quota: 'מכסה', languages: 'שפות', translator: 'תרגום', teachers: 'מורים', bots: 'מורים', mode: 'מצב שיחה' }));
const finding = (code: string) => {
  if (!code.startsWith('menu_error:')) return findingLabels.get(code) ?? 'ממצא נוסף';
  const route = menuLabels.get(code.slice('menu_error:'.length));
  return route ? 'קלט לא תקין בתפריט ' + route : 'קלט לא תקין בתפריט';
};
const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
const dollars = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const shekels = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('he-IL');
const money = (value: number | null, format: Intl.NumberFormat = dollars) => value === null ? 'אין נתון' : format.format(value);

function useReviewData<T>(request: Request, path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<T>(path, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [request, path, attempt]);
  return { data, error, retry: () => { setError(false); setAttempt(v => v + 1); } };
}

function LoadState({ error, retry }: { error: boolean; retry: () => void }) {
  return error
    ? <p className="crm-error" role="alert">לא הצלחנו לטעון את הנתונים. <button className="crm-button" onClick={retry}>ניסיון חוזר</button></p>
    : <p className="crm-loading" role="status">טוענים נתונים…</p>;
}

export function CallReviewCosts({ cost }: { cost: Cost }) {
  return <div className="crm-cost">
    <span>Gemini בשיחה<b>{money(cost.ai_estimated_usd)}</b></span>
    <span>סקירת השיחה<b>{money(cost.review_estimated_usd)}</b></span>
    <span>טלפוניה<b>{money(cost.phone?.estimated_ils ?? null, shekels)}</b>
      {cost.phone && <small>{number.format(cost.phone.navigation_seconds)} שניות ניווט, לא זמן לחיוב</small>}
    </span>
  </div>;
}

function CallCostDetail({ request, id }: { request: Request; id: string }) {
  const state = useReviewData<Cost>(request, endpoint + '/cost?' + new URLSearchParams({ call_id: id }));
  return state.data ? <CallReviewCosts cost={state.data} /> : <LoadState {...state} />;
}

export function CallReviewsReport({ report, request }: { report: Report; request: Request }) {
  const [open, setOpen] = useState<string | null>(null);
  const transcript = report.coverage.filter(r => r.status === 'reviewed');
  const reviewed = transcript.reduce((sum, r) => sum + r.logs, 0);
  const mean = reviewed ? transcript.reduce((sum, r) => sum + r.review_cost_usd, 0) / reviewed : null;
  if (!report.coverage.length) return <p className="crm-empty">עדיין אין נתוני סקירה לתקופה הזו.</p>;
  return <>
    <div className="crm-kpis">
      <div><span>לוגים בדוח</span><strong>{number.format(report.coverage.reduce((sum, r) => sum + r.logs, 0))}</strong></div>
      <div><span>סקירות תמליל שהושלמו</span><strong>{number.format(reviewed)}</strong></div>
      <div><span>עלות ממוצעת לסקירת תמליל</span><strong>{money(mean)}</strong></div>
    </div>
    <section className="crm-review-section">
      <h2>כיסוי הסקירה</h2>
      <ul>{report.coverage.map(r => <li key={r.source + r.status}>{sourceLabels[r.source]} · {statusLabels[r.status]}: {number.format(r.logs)}</li>)}</ul>
    </section>
    <section className="crm-review-section">
      <h2>ממצאים</h2>
      {report.findings.length ? <ul>{report.findings.map(r => <li key={r.code}>{finding(r.code)}: {number.format(r.logs)} לוגים</li>)}</ul> : <p className="crm-muted">לא סומנו ממצאים בלוגים שנבדקו.</p>}
    </section>
    <section className="crm-review-section">
      <h2>מועמדים לכוונון המורה</h2>
      {report.prompt_candidates.length ? <ul>{report.prompt_candidates.map(r => <li key={JSON.stringify([r.profile_id, r.bot_version, r.code])}>
        <strong><bdi>{r.profile_label || r.profile_id}</bdi> · גרסה {r.bot_version} · {finding(r.code)}</strong>
        <p>{r.affected} מתוך {r.reviewed} סקירות, אצל {r.learners} תלמידים. נדרשת בדיקה לפני שינוי.</p>
        <details><summary>הצעת הנחיה ושיחות תומכות</summary>
          <p>{r.proposed_instruction_he}</p>
          <ul>{r.evidence_call_ids.map(id => <li key={id}><bdi>{id}</bdi></li>)}</ul>
        </details>
      </li>)}</ul> : <p className="crm-muted">עדיין אין דפוס שעובר את הסף להצעת שינוי.</p>}
    </section>
    <section className="crm-review-section">
      <h2>לוגים אחרונים ועלות לשיחה</h2>
      <p className="crm-muted">העלויות הן אומדן בלבד, לא חיוב סופי. לשיחה עשויים להיות כמה לוגים.</p>
      {!report.recent.length ? <p className="crm-empty">אין לוגים להצגה.</p> : <div className="crm-table-panel"><div className="crm-table-scroll">
        <table aria-label="לוגים אחרונים"><thead><tr><th scope="col">סיום</th><th scope="col">מקור ומצב</th><th scope="col">ממצאים</th><th scope="col">עלות לשיחה</th></tr></thead>
          <tbody>{report.recent.map(r => {
            const key = r.source + ':' + r.call_id;
            return <Fragment key={key}>
              <tr><td>{date.format(new Date(r.ended_at))}</td><td>{sourceLabels[r.source]} · {statusLabels[r.status]}</td>
                <td>{r.findings.map(f => finding(f.code)).join(' · ') || 'לא סומנו'}</td>
                <td><button className="crm-button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{open === key ? 'סגירת פירוט' : 'פירוט עלות'}</button></td>
              </tr>
              {open === key && <tr><td colSpan={4}><CallCostDetail request={request} id={r.call_id} /></td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div></div>}
    </section>
  </>;
}

export function CallReviewsPanel({ request }: { request: Request }) {
  const state = useReviewData<Report>(request, endpoint);
  return <section className="crm-analytics" aria-labelledby="crm-call-reviews-title">
    <div className="crm-title-row"><div><h1 id="crm-call-reviews-title">סקירת שיחות</h1>
      <p className="crm-muted">ממצאים משבעת הימים האחרונים. שינויים בהנחיות המורה אינם מוחלים אוטומטית.</p></div></div>
    {state.data ? <CallReviewsReport report={state.data} request={request} /> : <LoadState {...state} />}
  </section>;
}
