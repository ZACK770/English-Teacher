import { useEffect, useState } from 'react';

type Bot = { id: string; label: string; active_version: number; phone_enabled: boolean; web_enabled: boolean };
type Config = { profile: Bot; controls: Record<string, unknown> };
type Version = { version: number; created_at: string };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const fields = [['base_prompt', 'הנחיות בסיס'], ['opening_message', 'הודעת פתיחה'], ['custom_instructions', 'הנחיות נוספות'], ['required_template_instructions', 'כללי תבנית מחייבים (כפופים למדיניות בית הספר)'], ['learning_goal', 'מטרת הלמידה']] as const;

export function parseTeacherSettings(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('ה־JSON אינו תקין. בדקו מרכאות ופסיקים.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ההגדרות חייבות להיות אובייקט JSON.');
  return value as Record<string, unknown>;
}

export function TeacherSettingsPanel({ request }: { request: Request }) {
  const [bots, setBots] = useState<Bot[]>([]), [bot, setBot] = useState('');
  const [config, setConfig] = useState<Config | null>(null), [versions, setVersions] = useState<Version[]>([]);
  const [text, setText] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0), [listRetry, setListRetry] = useState(0);
  const path = '/v1/admin/config/' + encodeURIComponent(bot);
  const versionPath = '/v1/admin/bots/' + encodeURIComponent(bot);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void request<{ bots: Bot[] }>('/v1/admin/bots', { signal: controller.signal }).then(result => { setBots(result.bots); const selected = new URLSearchParams(location.search).get('bot'); setBot(result.bots.some(bot=>bot.id===selected) ? selected! : result.bots[0]?.id || ''); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, listRetry]);
  useEffect(() => {
    if (!bot) return;
    const controller = new AbortController(); setLoading(true); setError(''); setConfig(null); setVersions([]); setNotice('');
    void Promise.all([request<Config>(path, { signal: controller.signal }), request<{ versions: Version[] }>(versionPath + '/versions', { signal: controller.signal })]).then(([value, history]) => { setConfig(value); setText(JSON.stringify(value.controls, null, 2)); setVersions(history.versions); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [bot, path, versionPath, request, retry]);
  let settings: Record<string, unknown> | null = null, jsonError = '';
  try { if (config) settings = parseTeacherSettings(text); } catch (e) { jsonError = (e as Error).message; }
  function change(key: string, value: string) { if (settings) setText(JSON.stringify({ ...settings, [key]: value }, null, 2)); }
  async function publish(version?: number) {
    if (version !== undefined && !confirm('לשחזר את גרסה ' + version + '? תיווצר גרסה חדשה לשיחות הבאות.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request<Config>(version === undefined ? path : versionPath + '/restore/' + version, { method: version === undefined ? 'PUT' : 'POST', ...(version === undefined ? { body: JSON.stringify(parseTeacherSettings(text)) } : {}) });
      setConfig(saved); setText(JSON.stringify(saved.controls, null, 2));
      const history = await request<{ versions: Version[] }>(versionPath + '/versions'); setVersions(history.versions);
      setNotice('נשמרה גרסה ' + saved.profile.active_version + '. השינוי יחול בשיחה הבאה ללא פריסה מחדש.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="crm-teacher-settings" dir="rtl"><h1>תבניות מורה</h1><p className="crm-muted">כאן עורכים את הבסיס המשותף של המורה. בחירה ברשימה פותחת תבנית לעריכה; שמירת גרסה משפיעה על השיחות הבאות שמשתמשות בתבנית הזאת.</p><details className="sc-record-panel"><summary>איך התבנית הופכת למורה שהתלמיד פוגש?</summary><p>המורה האישי שהתלמיד שומר מקושר לתבנית בסיס ומוסיף שם, אופי, קצב והעדפות לימוד. בתחילת השיחה המערכת משלבת את התבנית, המורה האישי, העדפות התלמיד ותוכנית השיעור.</p><p>בשלוחה 1 נבחרת תבנית לפי בחירת המורה, הקורס וההעדפות השמורות, או ברירת המחדל. בחירה ברשימה כאן אינה משנה את השיוך של התלמיד.</p><p>בתבנית כדאי להגדיר עקרונות הוראה כלליים. בשדה כללי תבנית מחייבים אפשר להגדיר דרישות שהמורה לא אמור לשנות בעקבות העדפת תלמיד; עדיין נדרשות בדיקות התנהגות, והשדה אינו מנגנון הרשאות. רמה, נושאי תרגול וסגנון אישי נקבעים גם מהגדרות התלמיד. בתמהיל הטלפוני, המודל והקול הפעילים נקבעים במעבדת הקול.</p></details>
    <label>בחירת תבנית בסיס <select value={bot} disabled={busy || loading} onChange={e => { if (!config || text === JSON.stringify(config.controls, null, 2) || confirm('לעבור לבוט אחר ולאבד שינויים שלא נשמרו?')) { setBot(e.target.value); const url=new URL(location.href); url.searchParams.set('bot',e.target.value); history.replaceState(null,'',url); } }}><option value="">בחרו בוט</option>{bots.map(b => <option key={b.id} value={b.id}>{b.label} · {b.id}{b.phone_enabled ? ' · טלפון' : ''}{b.web_enabled ? ' · אתר' : ''}</option>)}</select></label>
    {loading && <p role="status">טוענים הגדרות…</p>}{error && <p role="alert" className="crm-error">{error} <button className="crm-button" onClick={() => bots.length ? setRetry(v => v + 1) : setListRetry(v => v + 1)}>ניסיון חוזר</button></p>}{notice && <p role="status" className="crm-notice">{notice}</p>}
    {!loading && !bots.length && !error && <p className="crm-empty">אין בוטים להצגה.</p>}
    {config && <><form className="crm-form crm-teacher-form" onSubmit={e => { e.preventDefault(); void publish(); }}><fieldset disabled={busy}><legend>גרסה פעילה: {config.profile.active_version}</legend>{fields.map(([key, label]) => <label key={key}>{label}<textarea rows={key === 'base_prompt' ? 10 : 4} value={typeof settings?.[key] === 'string' ? settings[key] as string : ''} disabled={!settings} onChange={e => change(key, e.target.value)} /></label>)}<details><summary>הגדרות מתקדמות</summary><label>JSON מלא<textarea dir="ltr" rows={18} spellCheck={false} value={text} onChange={e => setText(e.target.value)} /></label></details>{jsonError && <p role="alert" className="crm-error">{jsonError}</p>}<button className="crm-primary" disabled={!settings}>{busy ? 'שומרים…' : 'שמירת גרסה חדשה'}</button></fieldset></form>
      <h2>היסטוריית גרסאות</h2>{versions.length ? <div className="crm-table-panel"><table><thead><tr><th>גרסה</th><th>מועד שמירה</th><th>פעולה</th></tr></thead><tbody>{versions.map(v => <tr key={v.version}><td>{v.version}</td><td>{new Date(v.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</td><td><button className="crm-button" disabled={busy} onClick={() => void publish(v.version)}>שחזר</button></td></tr>)}</tbody></table></div> : <p className="crm-empty">אין גרסאות שמורות.</p>}</>}
  </section>;
}
