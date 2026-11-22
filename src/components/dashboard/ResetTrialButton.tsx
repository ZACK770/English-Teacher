import { useRef, useState } from 'react';

type Result = { deleted_rows: number; freed_seconds: number; allowance: { opening_minutes: number; free_calls_left: number; free_call_minutes: number } };
export function ResetTrialButton({ customerId, request, onReset }: { customerId: string; request: <T>(path: string, init?: RequestInit) => Promise<T>; onReset: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Result | null>(null);
  async function reset() {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await request<Result>('/v1/admin/crm/people/' + encodeURIComponent(customerId) + '/reset-trial', { method: 'POST' })); dialog.current?.close(); onReset(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <><button className="crm-button" onClick={() => { setError(''); dialog.current?.showModal(); }}>אפס ניסיון</button><dialog className="crm-reset-dialog" ref={dialog} dir="rtl" aria-labelledby="crm-trial-title" onCancel={e => { if (busy) e.preventDefault(); }}><h2 id="crm-trial-title">איפוס ניסיון חינם</h2><p>לאפס את השימוש בניסיון החינמי? שימוש בתשלום, מנויים, תשלומים ופרטי הלקוח לא ישתנו.</p>{error && <p role="alert" className="crm-error">{error}</p>}<div className="crm-actions"><button className="crm-button" disabled={busy} onClick={() => dialog.current?.close()}>ביטול</button><button className="crm-primary" disabled={busy} onClick={() => void reset()}>{busy ? 'מאפסים…' : 'אישור איפוס ניסיון'}</button></div></dialog>{result && <span role="status">הניסיון אופס: {result.deleted_rows} רשומות, {(result.freed_seconds / 60).toLocaleString('he-IL', { maximumFractionDigits: 1 })} דקות שוחררו. יתרה: {result.allowance.opening_minutes} דקות פתיחה, {result.allowance.free_calls_left} שיחות של עד {result.allowance.free_call_minutes} דקות.</span>}</>;
}
