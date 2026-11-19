import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiPrefix } from '../portal/portalApi';

const endpoint = apiPrefix + '/v1/admin/crm/voicemails';
const statusLabels: Record<string, string> = {
  pending: 'ממתינה לעיבוד',
  fetching: 'טוענת את ההקלטה',
  transcribing: 'מתמללת',
  ready: 'תומללה',
  quota_exceeded: 'לא תומללה: המכסה היומית נוצלה',
  no_speech: 'לא זוהה דיבור',
  transcription_failed: 'לא הצלחנו לתמלל',
  invalid_audio: 'קובץ ההקלטה לא תקין או חורג מהמגבלה',
  audio_failed: 'לא הצלחנו לקבל את ההקלטה',
  download_failed: 'לא הצלחנו להוריד את ההקלטה ממערכת הטלפוניה',
  storage_failed: 'ההקלטה הורדה אך לא נשמרה באחסון',
};

interface Voicemail {
  id: string;
  customer_id: string;
  customer_name: string | null;
  phone: string | null;
  created_at: string;
  duration_seconds: number | null;
  status: string;
  audio_ready: number;
  transcript: string | null;
}

export function VoicemailInbox({ onOpenCustomer, customerIds }: {
  onOpenCustomer: (id: string) => void;
  customerIds: ReadonlySet<string>;
}) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState<Voicemail[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const audioRequest = useRef<AbortController | null>(null);
  const audioUrl = useRef<string | null>(null);

  const clearAudio = useCallback(() => {
    audioRequest.current?.abort();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }, []);

  const signOut = useCallback(() => {
    listRequest.current?.abort();
    clearAudio();
    sessionStorage.removeItem('adminToken');
    setToken('');
    setPassword('');
    setItems([]);
    setNext(null);
    setAudio(null);
    setLoadingAudio(null);
    setBusy(false);
    setError('');
  }, [clearAudio]);

  const load = useCallback(async (credential: string, before?: string) => {
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint + (before ? '?before=' + encodeURIComponent(before) : ''), {
        headers: { Authorization: 'Bearer ' + credential },
        signal: request.signal,
        cache: 'no-store',
      });
      if (response.status === 401) {
        signOut();
        setError('סיסמת המנהל אינה נכונה או שפג תוקף הכניסה.');
        return;
      }
      if (!response.ok) throw new Error();
      const result: { items: Voicemail[]; next: string | null } = await response.json();
      if (request.signal.aborted) return;
      sessionStorage.setItem('adminToken', credential);
      setToken(credential);
      setPassword('');
      setItems(previous => before ? [...previous, ...result.items] : result.items);
      setNext(result.next);
    } catch {
      if (!request.signal.aborted) setError('לא הצלחנו לטעון את ההודעות. אפשר לנסות שוב.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }, [signOut]);

  useEffect(() => {
    const saved = sessionStorage.getItem('adminToken');
    if (saved) void load(saved);
    return () => { listRequest.current?.abort(); clearAudio(); };
  }, [clearAudio, load]);

  const loadAudio = async (id: string) => {
    clearAudio();
    setAudio(null);
    setError('');
    const request = new AbortController();
    audioRequest.current = request;
    setLoadingAudio(id);
    try {
      const response = await fetch(`${endpoint}/${id}/audio`, {
        headers: { Authorization: 'Bearer ' + token },
        signal: request.signal,
        cache: 'no-store',
      });
      if (response.status === 401) {
        signOut();
        setError('פג תוקף הכניסה. יש להזדהות מחדש.');
        return;
      }
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (request.signal.aborted) return;
      audioUrl.current = URL.createObjectURL(blob);
      setAudio({ id, url: audioUrl.current });
    } catch {
      if (!request.signal.aborted) setError('לא הצלחנו לטעון את קובץ ההקלטה.');
    } finally {
      if (!request.signal.aborted) setLoadingAudio(null);
    }
  };

  const button = 'rounded-lg border border-[#e3e8eb] px-3 py-1.5 text-xs font-semibold text-[#137c69] hover:bg-[#e9f5f0] disabled:opacity-50';

  return (
    <section className="space-y-4 rounded-2xl border border-[#e3e8eb] bg-white p-4 text-[#172b35]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">הודעות קוליות מהטלפון</h2>
          <p className="mt-1 text-xs text-[#718087]">הקלטות שירות הלקוחות והתמלולים שלהן</p>
        </div>
        {token && <div className="flex gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void load(token)}>רענון</button>
          <button type="button" className={button} onClick={signOut}>יציאה מההודעות</button>
        </div>}
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {!token ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void load(password.trim()); }}>
          <label className="text-xs font-semibold">
            סיסמת מנהל
            <input className="mt-1 block rounded-lg border border-[#e3e8eb] px-2 py-1.5" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
          </label>
          <button className={button} disabled={busy || !password.trim()}>{busy ? 'טוען…' : 'פתיחת ההודעות'}</button>
        </form>
      ) : <>
        {!items.length && <p className="text-sm text-[#718087]">אין הודעות קוליות להצגה.</p>}
        {items.map(item => (
          <article key={item.id} className="space-y-2 rounded-xl border border-[#e3e8eb] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {customerIds.has(item.customer_id) ? (
                  <button type="button" className="font-bold text-[#137c69] underline" onClick={() => onOpenCustomer(item.customer_id)}>{item.customer_name || item.phone || 'תיק לקוח'}</button>
                ) : <span className="font-bold">{item.customer_name || item.phone || 'הודעה קולית'}</span>}
                {item.customer_name && item.phone && <span className="mr-2 text-xs text-[#718087]" dir="ltr">{item.phone}</span>}
              </div>
              <span className="text-xs text-[#718087]">{new Date(item.created_at).toLocaleString('he-IL')}{item.duration_seconds ? ` · ${item.duration_seconds} שניות` : ''}</span>
            </div>
            <p className="text-xs text-[#718087]">{statusLabels[item.status]}</p>
            {item.transcript && <p className="whitespace-pre-wrap break-words" dir="auto">{item.transcript}</p>}
            {item.audio_ready === 1 && (audio?.id === item.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <audio controls src={audio.url} aria-label="הודעה קולית" />
                <a className={button} href={audio.url} download={`voicemail-${item.id.slice(0, 12)}.mp3`}>הורדת ההקלטה</a>
              </div>
            ) : <button type="button" className={button} disabled={loadingAudio === item.id} onClick={() => void loadAudio(item.id)}>{loadingAudio === item.id ? 'טוען הקלטה…' : 'טעינת ההקלטה'}</button>)}
          </article>
        ))}
        {next && <button type="button" className={button} disabled={busy} onClick={() => void load(token, next)}>{busy ? 'טוען…' : 'הודעות קודמות'}</button>}
      </>}
    </section>
  );
}
