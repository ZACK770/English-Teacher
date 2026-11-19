import React, { useEffect, useState } from 'react';

type Identity = { username: string; role: 'owner' | 'staff' };
type AdminUser = Identity & { id: string; display_name: string; disabled: number };
type AuditRow = { id: string; ts: string; actor: string; method: string; path: string; status: number };
const prefix = location.pathname.startsWith('/english/') ? '/english' : '';
async function adminApi(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(prefix + '/v1/admin/' + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('admin-session-expired'));
    throw new Error(response.status === 429 ? 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.' : response.status === 401 ? 'שם המשתמש או הסיסמה שגויים, או שהכניסה פגה.' : 'הפעולה נכשלה. בדקו את הנתונים ונסו שוב.');
  }
  return data;
}

function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const load = async () => {
    const [u, a] = await Promise.all([adminApi('users'), adminApi('audit?limit=50&offset=0')]);
    setUsers(u.items); setRows(a.items);
  };
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section dir="rtl" className="p-6 space-y-5">
    <h1 className="text-2xl">משתמשים ויומן פעולות</h1>
    {error && <p role="alert">{error}</p>}
    <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); void act(async () => { await adminApi('users', 'POST', { username, password, role }); setUsername(''); setPassword(''); }); }}>
      <label>שם משתמש <input className="bg-slate-800 p-2" value={username} onChange={e => setUsername(e.target.value)} required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}" autoComplete="off" /></label>
      <label>סיסמה <input className="bg-slate-800 p-2" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} maxLength={1024} autoComplete="new-password" required /></label>
      <label>תפקיד <select className="bg-slate-800 p-2" value={role} onChange={e => setRole(e.target.value)}><option value="staff">צוות</option><option value="owner">מנהל</option></select></label>
      <button disabled={busy} type="submit">יצירת משתמש</button>
    </form>
    <h2>משתמשים</h2>
    {!users.length && <p>אין משתמשים להצגה.</p>}
    <ul className="space-y-3">{users.map(user => <li key={user.id} className="flex flex-wrap gap-4 border-b border-slate-700 p-2">
      <span>{user.username} — {user.display_name} ({user.role}) — {user.disabled ? 'מושבת' : 'פעיל'}</span>
      <button disabled={busy || user.username === 'owner'} onClick={() => void act(() => adminApi('users/' + user.id, 'PUT', { disabled: !user.disabled }))}>{user.disabled ? 'הפעלה' : 'השבתה'}</button>
      <button disabled={busy} onClick={() => { const value = window.prompt('סיסמה חדשה (לפחות 10 תווים)'); if (value) void act(() => adminApi('users/' + user.id, 'PUT', { password: value })); }}>איפוס סיסמה</button>
    </li>)}</ul>
    <h2>50 הפעולות האחרונות</h2>
    <button disabled={busy} onClick={() => void act(async () => {})}>רענון</button>
    {!rows.length ? <p>אין פעולות להצגה.</p> : <div className="overflow-x-auto"><table className="w-full text-right"><thead><tr>{['זמן', 'משתמש', 'שיטה', 'נתיב', 'תוצאה'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{new Date(row.ts).toLocaleString('he-IL')}</td><td>{row.actor}</td><td>{row.method}</td><td dir="ltr">{row.path}</td><td>{row.status}</td></tr>)}</tbody></table></div>}
  </section>;
}

export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [panel, setPanel] = useState(false);
  useEffect(() => {
    let active = true;
    const expired = () => { setIdentity(null); setPanel(false); };
    window.addEventListener('admin-session-expired', expired);
    adminApi('auth/me').then(data => { if (active) setIdentity(data); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('admin-session-expired', expired); };
  }, []);
  if (loading) return <div dir="rtl" role="status" className="p-8">בודקים את הכניסה…</div>;
  if (!identity) return <main dir="rtl" className="min-h-screen bg-slate-950 text-white grid place-items-center"><form className="p-8 space-y-5 max-w-sm w-full" onSubmit={async e => {
    e.preventDefault(); setLoading(true); setError('');
    try { setIdentity(await adminApi('auth/login', 'POST', { username, password })); setPassword(''); } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }}>
    <h1 className="text-2xl">כניסה למרכז הניהול</h1>
    <label className="block">שם משתמש<input className="block w-full bg-slate-800 p-3" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></label>
    <label className="block">סיסמה<input className="block w-full bg-slate-800 p-3" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
    {error && <p role="alert">{error}</p>}
    <button className="bg-emerald-700 p-3 rounded w-full" type="submit">כניסה</button>
  </form></main>;
  return <><header dir="rtl" className="bg-slate-900 text-white p-3 flex flex-wrap gap-5 items-center">
    <span>{identity.username}</span>
    {identity.role === 'owner' && <button onClick={() => setPanel(!panel)}>{panel ? 'חזרה ללוח הניהול' : 'משתמשים ויומן פעולות'}</button>}
    <button onClick={async () => { try { await adminApi('auth/logout', 'POST'); setIdentity(null); setPanel(false); } catch (e) { setError((e as Error).message); } }}>יציאה</button>
    {error && <span role="alert">{error}</span>}
  </header>{panel ? <AdminUsers /> : children}</>;
}
