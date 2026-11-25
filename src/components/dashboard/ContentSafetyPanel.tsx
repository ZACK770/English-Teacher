import { useEffect, useState } from 'react';

type Hold = { incident_id: string; created_ms: number; reason: 'tutor' | 'learner' | 'critical'; alert_state: string | null };
type State = { enabled: boolean; teacher?: Hold | null; customer?: Hold | null };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const base = '/v1/admin/crm/content-safety';
const alerts: Record<string, string> = {
  pending: 'ממתינה לשיגור', sending: 'אין עדיין אישור מהספק',
  accepted: 'הספק קיבל את בקשת החיוג', failed: 'השיגור לא אושר',
};

export function ContentSafetyPanel({ customerId, request }: { customerId?: string; request: Request }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const path = base + (customerId ? '?' + new URLSearchParams({ customer_id: customerId }) : '');
    void request<State>(path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setState(result);
    }).catch(() => {});
    return () => controller.abort();
  }, [customerId, request, revision]);
  const hold = customerId ? state?.customer : state?.teacher;
  if (!state?.enabled || (!hold && customerId)) return null;
  const label = customerId ? 'שחרור המשתמש' : 'החזרת המורה לפעילות';
  async function restore(incident: string) {
    if (!window.confirm(label + '?')) return;
    setBusy(true);
    setError('');
    try {
      await request(base + '/restore', { method: 'POST', body: JSON.stringify({ incident_id: incident }) });
      setState(current => current ? { ...current, [customerId ? 'customer' : 'teacher']: null } : current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setRevision(n => n + 1);
    }
  }
  return <section className="crm-notice" aria-label="חסימת סינון תוכן">
    <h2>סינון תוכן</h2>
    {hold
      ? <>
        <p>{hold.reason === 'critical' ? 'המורה מושעה לכל המשתמשים' : hold.reason === 'tutor' ? 'המשתמש נחסם בעקבות דברי המורה' : 'המשתמש נחסם בעקבות התבטאויות חוזרות'} · {new Date(hold.created_ms).toLocaleString('he-IL')}</p>
        {hold.alert_state && <p>שיחת אזעקה: {alerts[hold.alert_state]}</p>}
        <button className="crm-button" disabled={busy} onClick={() => void restore(hold.incident_id)}>{label}</button>
      </>
      : <p>המורה פעיל.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
