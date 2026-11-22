import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPrefix } from '../portal/portalApi';

const endpoint = apiPrefix + '/v1/admin/crm/voicemails';
const statusLabels: Record<string, string> = {
  pending: 'ממתינה לעיבוד',
  fetching: 'טוענת את ההקלטה',
  transcribing: 'בתהליך תמלול',
  ready: 'תומללה',
  quota_exceeded: 'לא תומללה: המכסה היומית נוצלה',
  no_speech: 'לא זוהה דיבור',
  transcription_failed: 'לא הצלחנו לתמלל',
  invalid_audio: 'הקלטה לא תקינה או ארוכה מדי',
  audio_failed: 'ההקלטה לא התקבלה',
  download_failed: 'ההקלטה לא התקבלה',
  storage_failed: 'ההקלטה לא נשמרה',
};
const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short' });

interface Voicemail {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  created_at: string;
  duration_seconds: number | null;
  status: string;
  audio_ready: number;
  transcript: string | null;
}

export function VoicemailInbox({ customerId }: { customerId?: string }) {
  const [items, setItems] = useState<Voicemail[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (before?: string) => {
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setBusy(true);
    setError('');
    const params = new URLSearchParams();
    if (customerId) params.set('customer_id', customerId);
    if (before) params.set('before', before);
    try {
      const response = await fetch(endpoint + '?' + params, { signal: request.signal, cache: 'no-store' });
      if (response.status === 401) window.dispatchEvent(new Event('admin-session-expired'));
      if (!response.ok) throw new Error();
      const result: { items: Voicemail[]; next: string | null } = await response.json();
      if (request.signal.aborted) return;
      setItems(previous => before ? [...previous, ...result.items] : result.items);
      setNext(result.next);
      if (!before) setPlaying(null);
    } catch {
      if (!request.signal.aborted) setError('לא הצלחנו לטעון את ההודעות. אפשר לנסות שוב.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }, [customerId]);

  useEffect(() => { void load(); return () => listRequest.current?.abort(); }, [load]);

  return <section className="crm-notes crm-voicemails" id={customerId ? 'customer-messages' : undefined}>
    <div className="crm-between">
      <div><h2>{customerId ? 'הודעות קוליות מהלקוח' : 'הודעות קוליות'}</h2><p className="crm-muted">הודעות משירות הלקוחות, מהחדשה לישנה · שעון ישראל</p></div>
      <button type="button" className="crm-button" disabled={busy} onClick={() => void load()}>רענון</button>
    </div>
    {busy && <p role="status">טוענים הודעות…</p>}
    {error && <p role="alert" className="crm-error">{error}</p>}
    {!busy && !error && !items.length && <p className="crm-muted">אין הודעות קוליות להצגה.</p>}
    {items.map(item => {
      const name = item.customer_name || item.phone || 'מתקשר ללא זיהוי';
      const customerPath = item.customer_id ? apiPrefix + '/dashboard/crm/' + encodeURIComponent(item.customer_id) : '';
      const audioPath = `${endpoint}/${item.id}/audio`;
      return <article className="crm-call" key={item.id}>
        <div className="crm-between">
          <div><strong>{!customerId && customerPath ? <a className="crm-customer-link" href={customerPath + '#customer-messages'}>{name}</a> : name}</strong>
            {item.customer_name && item.phone && <> · <bdi>{item.phone}</bdi></>}</div>
          <time className="crm-muted" dateTime={item.created_at}>{date.format(new Date(item.created_at))}{item.duration_seconds ? ` · ${item.duration_seconds} שניות` : ''}</time>
        </div>
        <span className="crm-chip">{statusLabels[item.status] || 'מצב לא ידוע'}</span>
        {item.transcript && <p className="crm-message-text" dir="auto">{item.transcript}</p>}
        {item.audio_ready === 1 && (playing === item.id
          ? <div className="crm-actions"><audio controls autoPlay src={audioPath} aria-label="הודעה קולית" onError={() => setError('ההקלטה אינה זמינה כרגע.')} /><a className="crm-button" href={audioPath} download>הורדת הקלטה</a></div>
          : <button type="button" className="crm-button" onClick={() => { setError(''); setPlaying(item.id); }}>האזנה להקלטה</button>)}
      </article>;
    })}
    {next && <button type="button" className="crm-button" disabled={busy} onClick={() => void load(next)}>הודעות קודמות</button>}
  </section>;
}
