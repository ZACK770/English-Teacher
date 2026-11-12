import { FormEvent, useCallback, useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import { Badge, BILLING_HE, call, CostLine, DEVICE_MODE_HE, duration, ils, PlatformError, Row, send, SettingsForm, TripTable, when } from "./shared";
import "../navigation.css";

const P = "/v1/app";
const KEY = "nav_app_session";
type Tab = "home" | "trips" | "calls" | "destinations" | "billing" | "settings";
const TABS: [Tab, string][] = [["home", "ראשי"], ["trips", "נסיעות"], ["calls", "שיחות"], ["destinations", "יעדים קבועים"], ["billing", "מנוי וחשבוניות"], ["settings", "הגדרות"]];

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="nav-login nav-panel">
      <h2>כניסה לאזור האישי</h2>
      <p>הזינו את מספר הטלפון ואת הקוד בן 6 הספרות שקיבלתם מהמוקד. הקוד בתוקף 10 דקות.</p>
      <form onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true); setError("");
        try {
          const r = await call<Row>(`${P}/auth/verify`, null, send("POST", { phone: f.get("phone"), code: f.get("code") }));
          sessionStorage.setItem(KEY, r.token); onLogin(r.token);
        } catch (err) { setError(err instanceof PlatformError && err.status === 401 ? "הקוד שגוי או שפג תוקפו. בקשו קוד חדש מהמוקד." : err instanceof Error ? err.message : "שגיאה"); }
        finally { setBusy(false); }
      }}>
        <label>מספר טלפון<input name="phone" type="tel" required dir="ltr" autoComplete="tel" /></label>
        <label>קוד כניסה<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required dir="ltr" autoComplete="one-time-code" /></label>
        <button className="nav-primary" disabled={busy}>{busy ? "מתחבר…" : "כניסה"}</button>
      </form>
      {error && <p className="nav-error" role="alert">{error}</p>}
      <small>עדיין לא לקוחות? <a href="/join-navigation">להרשמה</a></small>
    </section>
  );
}

function Live({ token }: { token: string }) {
  const [live, setLive] = useState<Row | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const tick = () => call<Row>(`${P}/device/live`, token).then((r) => alive && setLive(r)).catch(() => alive && setLive(null));
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);
  if (live === undefined) return <p>טוען מיקום…</p>;
  if (live === null) return <p className="nav-muted">אין מכשיר איתור משויך, או שהמיקום אינו זמין. אפשר לנווט גם בלי מכשיר — הנהג מתאר בשיחה איפה הוא.</p>;
  const pos = live.position;
  return (
    <div className="nav-inline">
      <span className={`nav-dot nav-dot-${live.fresh ? "fresh" : "stale"}`} />
      <strong>{live.fresh ? "המכשיר מחובר" : "אין דיווח עדכני"}</strong>
      <span>דיווח אחרון: {when(live.last_received_at_ms)}</span>
      {live.fresh && pos && <span>מהירות: {Math.round(pos.speed_mps * 3.6)} קמ״ש</span>}
      <span>סוללה: {live.battery?.level_percent ?? "—"}%{live.battery?.charging ? " (בטעינה)" : ""}</span>
      {live.fresh && pos && (
        <a href={`https://www.openstreetmap.org/?mlat=${pos.latitude}&mlon=${pos.longitude}#map=16/${pos.latitude}/${pos.longitude}`} target="_blank" rel="noreferrer">הצגה במפה</a>
      )}
    </div>
  );
}

function useData<T>(path: string, token: string, n = 0) {
  const [d, setD] = useState<T | null>(null);
  const [e, setE] = useState("");
  useEffect(() => { call<T>(path, token).then(setD).catch((x) => setE(x instanceof Error ? x.message : "שגיאה")); }, [path, token, n]);
  return { d, e };
}

function Calls({ token }: { token: string }) {
  const { d, e } = useData<Row[]>(`${P}/calls?limit=50`, token);
  const [open, setOpen] = useState<string | null>(null);
  const [turns, setTurns] = useState<Row[] | null>(null);
  if (e) return <p className="nav-error">{e}</p>;
  if (!d) return <p>טוען…</p>;
  if (!d.length) return <p className="nav-muted">אין שיחות עדיין.</p>;
  return (
    <ul className="nav-list">
      {d.map((c) => (
        <li key={c.call_id}>
          <button onClick={async () => {
            if (open === c.call_id) { setOpen(null); return; }
            setOpen(c.call_id); setTurns(null);
            setTurns(await call<Row[]>(`${P}/calls/${encodeURIComponent(c.call_id)}/turns`, token).catch(() => []));
          }}>
            <strong>{when(c.created_at)}</strong> · {duration(c.duration_seconds)} · <CostLine cost={c.cost} />
            {c.summary_he && <small>{c.summary_he}</small>}
          </button>
          {open === c.call_id && (
            <div className="nav-transcript">
              {turns === null ? "טוען…" : !turns.length ? <p className="nav-muted">אין תמלול לשיחה זו.</p> : turns.map((t, i) => (
                <p key={i} className={t.direction === "caller" ? "from-caller" : "from-bot"}><small>{t.direction === "caller" ? "אתה" : "הנווט"}</small> {t.text}</p>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Destinations({ token }: { token: string }) {
  const [n, setN] = useState(0);
  const { d, e } = useData<Row[]>(`${P}/destinations`, token, n);
  const [msg, setMsg] = useState("");
  return (
    <>
      <p>אמרו בשיחה ״סע הביתה״ או את שם היעד — והנווט ימצא את הכתובת.</p>
      {e && <p className="nav-error">{e}</p>}
      <ul className="nav-destinations">
        {(d ?? []).map((x) => (
          <li key={x.id}><div><strong>{x.label}</strong><small>{x.address}</small></div>
            <button onClick={async () => { if (!confirm("למחוק את היעד?")) return; await call(`${P}/destinations/${x.id}`, token, { method: "DELETE" }).catch(() => undefined); setN(n + 1); }}>מחיקה</button></li>
        ))}
      </ul>
      <form className="nav-inline" onSubmit={async (ev) => {
        ev.preventDefault();
        const target = ev.currentTarget, f = new FormData(target);
        try { await call(`${P}/destinations`, token, send("POST", { label: f.get("label"), address: f.get("address") })); target.reset(); setMsg("היעד נשמר."); setN(n + 1); }
        catch (x) { setMsg(x instanceof Error ? x.message : "שגיאה"); }
      }}>
        <input name="label" placeholder="שם (בית, ישיבה…)" required maxLength={80} />
        <input name="address" placeholder="כתובת מלאה" required minLength={3} maxLength={300} />
        <button>הוספה</button>
      </form>
      {msg && <small role="status">{msg}</small>}
    </>
  );
}

function Billing({ token, me }: { token: string; me: Row }) {
  const { d } = useData<Row[]>(`${P}/invoices`, token);
  return (
    <>
      <h4>מנויים</h4>
      {me.subscriptions.length ? (
        <ul className="nav-list">{me.subscriptions.map((s: Row) => <li key={s.id}><div><strong>{s.plan_name}</strong> <Badge value={s.status} /> · {ils(s.price_agorot)} {BILLING_HE[s.billing]}{s.current_period_end && <small>בתוקף עד {when(s.current_period_end)}</small>}</div></li>)}</ul>
      ) : <p className="nav-muted">אין מנוי פעיל. לפרטים פנו למוקד.</p>}
      <h4>חשבוניות</h4>
      {!d ? "טוען…" : !d.length ? <p className="nav-muted">אין חשבוניות.</p> : (
        <table className="nav-table"><thead><tr><th>תאריך</th><th>תיאור</th><th>סכום</th><th>סטטוס</th></tr></thead>
          <tbody>{d.map((i) => <tr key={i.id}><td>{when(i.issued_at)}</td><td>{i.description}</td><td>{ils(i.amount_agorot)}</td><td><Badge value={i.status} /></td></tr>)}</tbody></table>
      )}
    </>
  );
}

export function CustomerApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY) ?? "");
  const [me, setMe] = useState<Row | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const logout = useCallback(async () => {
    await call(`${P}/auth/logout`, token, send("POST", {})).catch(() => undefined);
    sessionStorage.removeItem(KEY); setToken(""); setMe(null);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    call<Row>(`${P}/me`, token).then(setMe).catch(() => { sessionStorage.removeItem(KEY); setToken(""); });
  }, [token]);
  const loadSettings = useCallback(() => call<Row>(`${P}/settings`, token), [token]);
  const saveSettings = useCallback((c: Row) => call<Row>(`${P}/settings`, token, send("PUT", c)), [token]);
  return (
    <div className="navigation-console" dir="rtl">
      <header className="nav-header">
        <div className="nav-brand"><span className="nav-logo"><Navigation size={23} /></span><div><h1>וייז כשר</h1><p>האזור האישי</p></div></div>
        {token && <nav><button type="button" onClick={logout}>יציאה</button></nav>}
      </header>
      <main>
        {!token ? <Login onLogin={setToken} /> : !me ? <p>טוען…</p> : (
          <>
            <div className="nav-title"><div><p className="nav-eyebrow">שלום</p><h2>{me.customer.name}</h2><p dir="ltr" className="nav-ltr">{me.customer.primary_phone}</p></div></div>
            <nav className="nav-tabs" role="tablist">
              {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{l}</button>)}
            </nav>
            <section className="nav-panel">
              {tab === "home" && (
                <>
                  <h3>המכשיר שלי · {DEVICE_MODE_HE[me.customer.device_mode] ?? ""}</h3>
                  <Live token={token} />
                  <h3>איך מנווטים</h3>
                  <p>מתקשרים לקו הניווט מהטלפון הרשום ואומרים לאן נוסעים. ההנחיות מוקראות בזמן הנסיעה. אם השיחה נותקה — מתקשרים שוב, והמסלול ממשיך.</p>
                </>
              )}
              {tab === "trips" && <TripsTab token={token} />}
              {tab === "calls" && <Calls token={token} />}
              {tab === "destinations" && <Destinations token={token} />}
              {tab === "billing" && <Billing token={token} me={me} />}
              {tab === "settings" && <><h3>העדפות שיחה</h3><SettingsForm load={loadSettings} save={saveSettings} /></>}
            </section>
          </>
        )}
      </main>
      <footer>הנתונים פרטיים ומוצגים רק לבעל החשבון · אין להפעיל את האתר בזמן נהיגה</footer>
    </div>
  );
}

function TripsTab({ token }: { token: string }) {
  const { d, e } = useData<Row[]>(`${P}/trips?limit=100`, token);
  if (e) return <p className="nav-error">{e}</p>;
  return d ? <TripTable trips={d} load={(t) => call(`${P}/trips/${encodeURIComponent(t)}/path`, token)} /> : <p>טוען…</p>;
}
