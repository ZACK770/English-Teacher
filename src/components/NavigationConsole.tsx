import { FormEvent, useEffect, useState } from "react";
import {
  Battery,
  LockKeyhole,
  MapPin,
  Navigation,
  RefreshCw,
  Satellite,
  Users,
} from "lucide-react";
import "./navigation.css";

interface Device {
  device_id: string;
  traccar_device_id: number;
  label: string;
  enabled: number;
}
interface Customer {
  customer_id: string;
  name: string;
  phone: string;
  device_id: string | null;
}
interface Destination {
  id: string;
  label: string;
  address: string;
}
interface PositionReport {
  device_id: string;
  enabled: boolean;
  fresh: boolean;
  last_report_valid: boolean;
  last_received_at_ms: number | null;
  last_valid_fix_at_ms: number | null;
  battery: {
    level_percent: number | null;
    reported_at_ms: number | null;
    charging: boolean | null;
  };
  position: {
    latitude: number;
    longitude: number;
    fix_at_ms: number;
    speed_mps: number;
    heading: number | null;
    accuracy_m: number | null;
  } | null;
}
const API = "/v1/admin/navigation";

interface CallTrace {
  call_id: string;
  created_at: string;
  system_instruction: string;
  opening_message: string;
  setup_message: unknown;
  has_prompt: boolean;
  session: { duration_seconds: number; ended_at: string } | null;
  turns: { created_at: string; direction: string; text: string; metadata: Record<string, unknown> }[];
  events: { created_at: string; event_type: string; details: Record<string, unknown> }[];
}

const TURN_LABELS: Record<string, string> = {
  driver: "🗣 הנהג אמר (תמלול)",
  tool_call: "🧠 ה-AI הבין (קריאה למנוע)",
  tool_result: "↩ תשובה שנשלחה ל-AI",
  engine: "🔊 המערכת השמיעה לנהג",
  ai_input: "➡ הודעה שנשלחה ל-AI",
  ai_audio_dropped: "⚠ ה-AI דיבר בעצמו (לא הושמע)",
  ai_spoke: "🗣 Gemini אמר לנהג",
  engine_fallback: "🛟 המנוע זיהה כן/לא בעצמו (ה-AI לא הגיב)",
  error: "❌ שגיאה",
  ended: "■ סיום שיחה",
};

function gpsText(meta: Record<string, unknown>) {
  const g = meta.gps as Record<string, unknown> | null | undefined;
  if (!g) return "";
  if (g.lat == null) return g.fresh ? "GPS: אין מיקום" : "GPS: לא עדכני";
  return `GPS ${g.fresh ? "עדכני" : "ישן"} · ${Number(g.lat).toFixed(5)},${Number(g.lng).toFixed(5)} · גיל ${g.age_s} ש׳ · ${g.speed_kmh} קמ״ש · כיוון ${g.heading ?? "לא ידוע"}`;
}

const NAV_BOT = "voice-navigator-live";

function VoiceMode({ token }: { token: string }) {
  const [controls, setControls] = useState<Record<string, unknown> | null>(null);
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<{ controls: Record<string, unknown> }>(`/v1/admin/config/${NAV_BOT}`, token)
      .then((r) => setControls(r.controls)).catch(() => setState("טעינת המצב נכשלה"));
  }, [token]);
  const save = async (change: Record<string, unknown>) => {
    if (!controls || saving) return;
    setSaving(true);
    setState("שומר...");
    try {
      const r = await api<{ controls: Record<string, unknown> }>(`/v1/admin/config/${NAV_BOT}`, token, { method: "PUT", body: JSON.stringify({ ...controls, ...change }) });
      setControls(r.controls);
      setState("נשמר. ייכנס לתוקף מהשיחה הבאה.");
    } catch { setState("השמירה נכשלה"); }
    finally { setSaving(false); }
  };
  const voice = (controls?.navigation_voice as string | undefined) ?? "engine";
  return (
    <section className="nav-panel">
      <h2>מצב הקול בשיחת ניווט</h2>
      <label><input type="radio" checked={voice === "engine"} disabled={!controls || saving} onChange={() => save({ navigation_voice: "engine" })} /> מנוע קבוע: משפטים מוגדרים מראש בקול Google (זול)</label>
      <br />
      <label><input type="radio" checked={voice === "gemini"} disabled={!controls || saving} onChange={() => save({ navigation_voice: "gemini" })} /> Gemini מדבר: Gemini מנהל את השיחה בעצמו ומקבל נתונים חיים (GPS, Google Maps, פקקים)</label>
      {voice === "gemini" && <div>
        <p><label>קול לשיחה הבאה: <select value={String(controls?.voice ?? "Aoede")} disabled={!controls || saving} onChange={(e) => save({ voice: e.target.value })}>
          <option value="Charon">Charon — גברי</option>
          <option value="Puck">Puck — גברי</option>
          <option value="Fenrir">Fenrir — גברי</option>
          <option value="Aoede">Aoede — נשי</option>
          <option value="Kore">Kore — נשי</option>
          {typeof controls?.voice === "string" && !["Charon", "Puck", "Fenrir", "Aoede", "Kore"].includes(controls.voice) && <option value={controls.voice}>{controls.voice}</option>}
        </select></label></p>
        <label><input type="checkbox" checked={(controls?.navigation_interrupt ?? "stop_word") === "stop_word"} disabled={!controls || saving} onChange={(e) => save({ navigation_interrupt: e.target.checked ? "stop_word" : "speech" })} /> בזמן תשובה — עצירה רק ב״רגע״, ״שתוק״, ״שקט״ או ״עצור״</label>
      </div>}
      {state && <p>{state}</p>}
    </section>
  );
}

function CallLog({ token }: { token: string }) {
  const [calls, setCalls] = useState<CallTrace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [more, setMore] = useState(true);
  async function load(append = false) {
    setLoading(true);
    try {
      const page = await api<CallTrace[]>(`${API}/calls?limit=20&offset=${append ? calls?.length ?? 0 : 0}`, token);
      setCalls(append ? [...(calls ?? []), ...page] : page);
      setMore(page.length === 20);
      setFailure("");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "טעינת השיחות נכשלה");
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="nav-panel nav-calls">
      <div className="nav-map-heading">
        <h3>
          <Navigation size={18} /> לוג שיחות ניווט מלא ופרומפט יוצא
        </h3>
        <button className="nav-primary" onClick={() => load()} disabled={loading}>
          <RefreshCw size={15} /> {calls ? "רענן" : "טען שיחות אחרונות"}
        </button>
      </div>
      {failure && <p className="nav-error">{failure}</p>}
      {calls && !calls.length && <p>עדיין אין שיחות ניווט.</p>}
      {calls?.map((c) => (
        <details key={c.call_id} className="nav-call">
          <summary>
            {new Date(c.created_at).toLocaleString("he-IL")} · {c.turns.filter((t) => t.direction === "driver").length} פניות נהג ·{" "}
            {c.turns.filter((t) => t.direction === "engine").length} הודעות מערכת
            {(() => { const v = c.events.find((e) => e.event_type === "navigation_connected")?.details.voice; return v ? (v === "gemini" ? " · Gemini מדבר" : " · מנוע קבוע") : ""; })()}
            {c.session ? ` · ${c.session.duration_seconds} ש׳` : ""}
            {(() => { const end = c.events.find((e) => e.event_type === "navigation_ended")?.details.reason; return end ? ` · סיום: ${String(end)}` : ""; })()}
            {c.events.some((e) => e.event_type === "navigation_failed") ? " · ❌ נכשלה" : ""}
            {!c.turns.length ? " · ללא תמליל" : ""}
          </summary>
          {!c.turns.length && <p>לשיחה זו לא נשמר תמליל (בוצעה לפני הפעלת התיעוד המלא). מוצגים רק אירועי המערכת.</p>}
          {c.has_prompt && <details>
            <summary>הפרומפט וההגדרות שנשלחו ל-AI בפועל</summary>
            <pre dir="ltr">{c.system_instruction}</pre>
            <pre dir="ltr">{JSON.stringify(c.setup_message, null, 2)}</pre>
          </details>}
          <table className="nav-call-table">
            <thead>
              <tr><th>שעה</th><th>שלב</th><th>תוכן</th><th>פרטים</th></tr>
            </thead>
            <tbody>
              {c.turns.map((t, i) => (
                <tr key={i} className={`nav-turn-${t.direction}`}>
                  <td>{new Date(t.created_at).toLocaleTimeString("he-IL")}</td>
                  <td>{TURN_LABELS[t.direction] ?? t.direction}</td>
                  <td dir="auto">{t.text}</td>
                  <td>
                    {[t.metadata.status ? `סטטוס: ${t.metadata.status}` : "", t.metadata.source ? `מקור: ${t.metadata.source}` : "", gpsText(t.metadata)]
                      .filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
              {c.events.map((e, i) => (
                <tr key={`e${i}`} className="nav-turn-event">
                  <td>{new Date(e.created_at).toLocaleTimeString("he-IL")}</td>
                  <td>אירוע מערכת</td>
                  <td>{e.event_type}</td>
                  <td dir="ltr">{JSON.stringify(e.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      {calls && more && (
        <button className="nav-primary" onClick={() => load(true)} disabled={loading}>טען שיחות ישנות יותר</button>
      )}
    </section>
  );
}
const time = (ms: number | null | undefined) =>
  ms == null
    ? "טרם התקבל דיווח"
    : new Date(ms).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
class ApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? "מפתח הניהול אינו תקין או שהגישה פגה."
        : status === 422
          ? "בדוק את הנתונים. ייתכן שמספר הטלפון כבר רשום."
          : "הבקשה לא הושלמה. נסה לרענן.",
    );
  }
}
async function api<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

export function NavigationConsole() {
  const [token, setToken] = useState("");
  const [credential, setCredential] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<PositionReport | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [assignmentDevice, setAssignmentDevice] = useState("");
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [mapConsent, setMapConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setReport(null);
    setMapConsent(false);
  }, [selected, token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [ds, cs, pos] = await Promise.all([
          api<Device[]>(`${API}/devices`, token, { signal: controller.signal }),
          api<Customer[]>(`${API}/customers`, token, {
            signal: controller.signal,
          }),
          selected
            ? api<PositionReport>(
                `${API}/devices/${encodeURIComponent(selected)}/position`,
                token,
                { signal: controller.signal },
              )
            : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        setDevices(ds);
        setCustomers(cs);
        setReport(pos);
        setError("");
        if (!selected && ds.length) setSelected(ds[0].device_id);
      } catch (err) {
        if (controller.signal.aborted) return;
        setReport(null);
        setError(
          err instanceof ApiError
            ? err.message
            : "אין חיבור לשרת. המיקום מוסתר עד לחידוש החיבור.",
        );
        if (err instanceof ApiError && err.status === 401) setToken("");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 15_000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, selected, version]);
  useEffect(() => {
    setDestinations([]);
    if (!customerId || !token) return;
    const controller = new AbortController();
    void api<Destination[]>(
      `${API}/customers/${encodeURIComponent(customerId)}/destinations`,
      token,
      { signal: controller.signal },
    )
      .then((items) => {
        if (!controller.signal.aborted) setDestinations(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "לא ניתן לטעון יעדים.");
      });
    return () => controller.abort();
  }, [customerId, token, version]);

  const device = devices.find((d) => d.device_id === selected);
  const customer = customers.find((c) => c.customer_id === customerId);
  const currentReport = report?.device_id === selected ? report : null;
  const p = currentReport?.position;
  const fresh = !!(
    currentReport?.enabled &&
    currentReport.fresh &&
    p &&
    now - p.fix_at_ms <= 120_000 &&
    now - p.fix_at_ms >= -30_000
  );
  const battery = currentReport?.battery;
  const batteryFresh =
    battery?.reported_at_ms != null &&
    now - battery.reported_at_ms <= 120_000 &&
    now - battery.reported_at_ms >= -30_000;
  const mapUrl =
    fresh && p
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${Math.max(-180, p.longitude - 0.008)},${Math.max(-90, p.latitude - 0.005)},${Math.min(180, p.longitude + 0.008)},${Math.min(90, p.latitude + 0.005)}&layer=mapnik&marker=${p.latitude},${p.longitude}`
      : "";

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const ds = await api<Device[]>(`${API}/devices`, credential);
      setDevices(ds);
      setSelected(ds[0]?.device_id || "");
      setToken(credential);
      setCredential("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "לא ניתן להתחבר לשרת.");
    } finally {
      setBusy(false);
    }
  }
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה.");
      if (err instanceof ApiError && err.status === 401) logout();
    } finally {
      setBusy(false);
    }
  }
  function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    value: Record<string, unknown>,
    message: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    void mutate(async () => {
      await api(path, token, { method: "POST", body: JSON.stringify(value) });
      form.reset();
    }, message);
  }
  function logout() {
    setToken("");
    setCredential("");
    setDevices([]);
    setCustomers([]);
    setReport(null);
    setSelected("");
    setCustomerId("");
    setDestinations([]);
    setMapConsent(false);
    setNotice("");
    setError("");
  }

  return (
    <div className="navigation-console" dir="rtl">
      <header className="nav-header">
        <div className="nav-brand">
          <span className="nav-logo">
            <Navigation size={23} />
          </span>
          <div>
            <h1>וייז כשר</h1>
            <p>ניהול מיקום ומכשירים · Cloudflare</p>
          </div>
        </div>
        <nav>
          <a href="/">מערכת ראשית</a>
          <a
            href="https://docs.google.com/spreadsheets/d/1KOCkMrLGWR8kOk9phPOAsBBcBiejCF4OcGaYJ6sBh50/edit?gid=364182393#gid=364182393"
            target="_blank"
            rel="noreferrer"
          >
            תכנית העבודה
          </a>
          {token && (
            <button type="button" onClick={logout}>
              יציאה
            </button>
          )}
        </nav>
      </header>
      <main>
        {!token ? (
          <section className="nav-login nav-panel">
            <LockKeyhole size={28} />
            <h2>כניסה פרטית לניהול</h2>
            <p>מיקום המכשיר ופרטי הלקוחות אינם ציבוריים.</p>
            <form onSubmit={login}>
              <label>
                מפתח הניהול הקיים
                <input
                  name="admin_key"
                  type="password"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              <button disabled={busy} className="nav-primary">
                {busy ? "מתחבר…" : "כניסה מאובטחת"}
              </button>
            </form>
            <small>
              המפתח נשמר בזיכרון העמוד בלבד. סגירה או רענון מחייבים כניסה מחדש.
            </small>
            {error && (
              <p className="nav-error" role="alert">
                {error}
              </p>
            )}
          </section>
        ) : (
          <>
            <div className="nav-title">
              <div>
                <p className="nav-eyebrow">מרכז הבקרה</p>
                <h2>המכשיר שלך, בזמן אמת</h2>
                <p>
                  רענון אוטומטי כל 15 שניות. נתוני מיקום ישנים או לא תקפים
                  מוסתרים.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVersion((v) => v + 1)}
                disabled={busy}
              >
                <RefreshCw size={16} /> רענון
              </button>
            </div>
            <div className="nav-banner">
              קליטת GPS ומסך ניהול בלבד. ניווט קולי, היסטוריית מסלולים ודוחות
              נסיעה עדיין בפיתוח.
            </div>
            {error && (
              <p className="nav-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="nav-success" role="status">
                {notice}
              </p>
            )}
            <div className="nav-workspace">
              <aside className="nav-panel nav-devices">
                <h3>
                  <Satellite size={18} /> מכשירים ({devices.length})
                </h3>
                {!devices.length && (
                  <p>
                    אין מכשירים רשומים. ניתן לרשום מכשיר המחובר ל־Traccar בטופס
                    למטה.
                  </p>
                )}
                {devices.map((d) => (
                  <button
                    className={`nav-device ${selected === d.device_id ? "selected" : ""}`}
                    key={d.device_id}
                    onClick={() => {
                      setSelected(d.device_id);
                      setNotice("");
                    }}
                    aria-pressed={selected === d.device_id}
                  >
                    <strong>{d.label}</strong>
                    <span dir="ltr">{d.device_id}</span>
                    <small>{d.enabled ? "קליטה מאופשרת" : "מושבת"}</small>
                  </button>
                ))}
              </aside>
              <section className="nav-location">
                <div className="nav-cards">
                  <article className="nav-panel">
                    <Satellite size={19} />
                    <span>מצב מיקום</span>
                    <strong className={fresh ? "nav-green" : "nav-amber"}>
                      {!device
                        ? "בחר מכשיר"
                        : !device.enabled
                          ? "המכשיר מושבת"
                          : fresh
                            ? "GPS עדכני"
                            : currentReport && !currentReport.last_report_valid
                              ? "אין GPS תקף"
                              : "מיקום לא זמין / ישן"}
                    </strong>
                    <small>
                      GPS תקף אחרון: {time(currentReport?.last_valid_fix_at_ms)}
                    </small>
                  </article>
                  <article className="nav-panel">
                    <Battery size={19} />
                    <span>סוללה</span>
                    <strong>
                      {battery?.level_percent == null
                        ? "לא מדווחת"
                        : `${battery.level_percent}%${batteryFresh ? "" : " · דיווח ישן"}`}
                    </strong>
                    <small>
                      {battery?.reported_at_ms
                        ? `זמן הדיווח: ${time(battery.reported_at_ms)}`
                        : "המכשיר לא מסר אחוז סוללה בדיווח האחרון."}
                      {battery?.charging === true ? " · בטעינה" : ""}
                    </small>
                  </article>
                  <article className="nav-panel">
                    <Navigation size={19} />
                    <span>מהירות וכיוון</span>
                    <strong>
                      {fresh && p
                        ? `${Math.round(p.speed_mps * 3.6)} קמ״ש`
                        : "לא זמין"}
                    </strong>
                    <small>
                      {fresh && p?.heading != null
                        ? `כיוון תנועה: ${Math.round(p.heading)}°`
                        : "אין כיוון תנועה אמין"}
                    </small>
                  </article>
                </div>
                <div className="nav-panel nav-map">
                  <div className="nav-map-heading">
                    <h3>
                      <MapPin size={18} /> מיקום על המפה
                    </h3>
                    <span className="nav-chip">
                      {device?.label || "טרם נבחר מכשיר"}
                    </span>
                  </div>
                  {fresh && p ? (
                    <>
                      <div className="nav-coordinate">
                        <span dir="ltr">
                          {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}
                        </span>
                        <small>
                          זמן GPS: {time(p.fix_at_ms)}
                          {p.accuracy_m != null
                            ? ` · דיוק מדווח: ${Math.round(p.accuracy_m)} מטר`
                            : " · דיוק במטרים לא נמסר"}
                        </small>
                      </div>
                      {mapConsent ? (
                        <iframe
                          title="מיקום המכשיר ב־OpenStreetMap"
                          src={mapUrl}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="nav-map-empty">
                          <MapPin size={32} />
                          <h4>המיקום התקף זמין לצפייה</h4>
                          <p>
                            הצגת המפה תעביר את הקואורדינטות לשירות
                            OpenStreetMap. לא נשלחים שם, טלפון או מפתח גישה.
                          </p>
                          <button
                            className="nav-primary"
                            onClick={() => setMapConsent(true)}
                          >
                            הצג מיקום במפה חיצונית
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="nav-map-empty">
                      <Satellite size={34} />
                      <h4>אין מיקום עדכני להצגה</h4>
                      <p>
                        לא נציג נקודה ישנה כאילו היא חיה. כשהמכשיר ישדר GPS תקף,
                        המיקום יתעדכן כאן אוטומטית.
                      </p>
                    </div>
                  )}
                  <small>
                    דיווח אחרון שהגיע לשרת:{" "}
                    {time(currentReport?.last_received_at_ms)}. המפה מציגה נתוני
                    GPS בלבד, לא מסלול נהיגה.
                  </small>
                </div>
              </section>
            </div>
            <div className="nav-bottom-grid">
              <section className="nav-panel">
                <h3>
                  <Users size={18} /> משתמשים ושיוך טלפון למכשיר
                </h3>
                <label>
                  לקוח קיים
                  <select
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      setAssignmentDevice("");
                    }}
                  >
                    <option value="">בחר לקוח</option>
                    {customers.map((c) => (
                      <option key={c.customer_id} value={c.customer_id}>
                        {c.name || "ללא שם"} · {c.phone}
                      </option>
                    ))}
                  </select>
                </label>
                {customer && (
                  <>
                    <p>
                      שיוך נוכחי:{" "}
                      <strong>
                        {devices.find((d) => d.device_id === customer.device_id)
                          ?.label ||
                          customer.device_id ||
                          "ללא מכשיר"}
                      </strong>
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate(
                          () =>
                            api(`${API}/assignments`, token, {
                              method: "POST",
                              body: JSON.stringify({
                                customer_id: customerId,
                                device_id: assignmentDevice || selected,
                              }),
                            }),
                          "השיוך נשמר.",
                        );
                      }}
                    >
                      <label>
                        מכשיר לשיוך
                        <select
                          value={assignmentDevice || selected}
                          onChange={(e) => setAssignmentDevice(e.target.value)}
                          required
                        >
                          <option value="">בחר מכשיר</option>
                          {devices.map((d) => (
                            <option key={d.device_id} value={d.device_id}>
                              {d.label}
                              {d.enabled ? "" : " (מושבת)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="nav-actions">
                        <button
                          className="nav-primary"
                          disabled={busy || !devices.length}
                        >
                          שמירת שיוך
                        </button>
                        <button
                          type="button"
                          disabled={busy || !customer.device_id}
                          onClick={() => {
                            if (confirm("להסיר את שיוך המכשיר מהלקוח?"))
                              void mutate(
                                () =>
                                  api(`${API}/assignments`, token, {
                                    method: "DELETE",
                                    body: JSON.stringify({
                                      customer_id: customerId,
                                    }),
                                  }),
                                "השיוך הוסר.",
                              );
                          }}
                        >
                          הסרת שיוך
                        </button>
                      </div>
                    </form>
                  </>
                )}
                <details>
                  <summary>הוספת לקוח לפי מספר טלפון</summary>
                  <form
                    onSubmit={(e) => {
                      const data = new FormData(e.currentTarget);
                      submit(
                        e,
                        "/v1/admin/business/customers",
                        {
                          name: data.get("name"),
                          phone: data.get("phone"),
                          source: "navigation_console",
                        },
                        "הלקוח נוצר. ניתן לבחור אותו ולשייך מכשיר.",
                      );
                    }}
                  >
                    <label>
                      שם
                      <input name="name" required maxLength={100} />
                    </label>
                    <label>
                      מספר טלפון
                      <input
                        name="phone"
                        type="tel"
                        required
                        minLength={5}
                        maxLength={40}
                        dir="ltr"
                      />
                    </label>
                    <button disabled={busy}>הוספת לקוח</button>
                  </form>
                </details>
              </section>
              <section className="nav-panel">
                <h3>
                  <MapPin size={18} /> יעדים קבועים
                </h3>
                <p>
                  היעדים נשמרים לכל לקוח בנפרד. הכתובת טרם מאומתת מול ספק מפות
                  ואינה מסלול מחושב.
                </p>
                {!customerId ? (
                  <p>בחר לקוח כדי לנהל את היעדים שלו.</p>
                ) : (
                  <>
                    <ul className="nav-destinations">
                      {destinations.map((d) => (
                        <li key={d.id}>
                          <div>
                            <strong>{d.label}</strong>
                            <p>{d.address}</p>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`מחיקת היעד ${d.label}`}
                            onClick={() => {
                              if (confirm(`למחוק את היעד ״${d.label}״?`))
                                void mutate(
                                  () =>
                                    api(
                                      `${API}/customers/${encodeURIComponent(customerId)}/destinations/${encodeURIComponent(d.id)}`,
                                      token,
                                      { method: "DELETE" },
                                    ),
                                  "היעד נמחק.",
                                );
                            }}
                          >
                            מחיקה
                          </button>
                        </li>
                      ))}
                    </ul>
                    {!destinations.length && <p>אין יעדים שמורים ללקוח זה.</p>}
                    <form
                      onSubmit={(e) => {
                        const data = new FormData(e.currentTarget);
                        submit(
                          e,
                          `${API}/customers/${encodeURIComponent(customerId)}/destinations`,
                          {
                            label: data.get("label"),
                            address: data.get("address"),
                          },
                          "היעד נשמר ללקוח.",
                        );
                      }}
                    >
                      <label>
                        שם היעד
                        <input
                          name="label"
                          required
                          maxLength={80}
                          placeholder="למשל: בית"
                        />
                      </label>
                      <label>
                        כתובת מלאה ויישוב
                        <input
                          name="address"
                          required
                          minLength={3}
                          maxLength={300}
                        />
                      </label>
                      <button className="nav-primary" disabled={busy}>
                        שמירת יעד קבוע
                      </button>
                    </form>
                  </>
                )}
              </section>
            </div>
            <VoiceMode token={token} />
            <CallLog token={token} />
            <details className="nav-panel">
              <summary>ניהול קליטה ורישום מכשירים</summary>
              <p>
                רישום כאן אינו מגדיר את מכשיר האיתור או את שרת Traccar. נדרשת
                התאמה למזהים הרשומים במקלט.
              </p>
              {device && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        device.enabled
                          ? "להשבית קליטת GPS למכשיר זה? המיקום יוסתר."
                          : "להפעיל מחדש קליטת GPS למכשיר?",
                      )
                    )
                      void mutate(
                        () =>
                          api(`${API}/devices`, token, {
                            method: "POST",
                            body: JSON.stringify({
                              ...device,
                              enabled: !device.enabled,
                            }),
                          }),
                        device.enabled
                          ? "קליטת המכשיר הושבתה."
                          : "קליטת המכשיר הופעלה.",
                      );
                  }}
                >
                  {device.enabled ? "השבתת קליטה" : "הפעלת קליטה"}:{" "}
                  {device.label}
                </button>
              )}
              <form
                className="nav-register"
                onSubmit={(e) => {
                  const data = new FormData(e.currentTarget);
                  submit(
                    e,
                    `${API}/devices`,
                    {
                      device_id: data.get("device_id"),
                      traccar_device_id: Number(data.get("traccar_id")),
                      label: data.get("label"),
                    },
                    "המכשיר נרשם לקליטה.",
                  );
                }}
              >
                <label>
                  מזהה המכשיר (Unique ID)
                  <input
                    name="device_id"
                    required
                    maxLength={80}
                    pattern="[a-zA-Z0-9_-]+"
                    dir="ltr"
                  />
                </label>
                <label>
                  מזהה מספרי ב־Traccar
                  <input
                    name="traccar_id"
                    type="number"
                    required
                    min={1}
                    max={Number.MAX_SAFE_INTEGER}
                    step={1}
                  />
                </label>
                <label>
                  שם להצגה
                  <input name="label" required maxLength={100} />
                </label>
                <button disabled={busy}>רישום מכשיר</button>
              </form>
            </details>
          </>
        )}
      </main>
      <footer>
        <LockKeyhole size={13} /> נתוני GPS פרטיים · ללא נתוני הדגמה · אין לשנות
        הגדרות בזמן נהיגה
      </footer>
    </div>
  );
}
