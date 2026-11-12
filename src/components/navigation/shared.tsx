import { Fragment, useEffect, useState } from "react";

export type Row = Record<string, any>;

export class PlatformError extends Error {
  constructor(public status: number, detail = "") {
    super(
      status === 401
        ? "החיבור פג או שהמפתח שגוי. יש להתחבר מחדש."
        : status === 404
          ? "לא נמצא."
          : status === 409
            ? detail || "הפעולה מתנגשת בנתונים קיימים."
            : status === 422
              ? detail || "בדוק את הנתונים שהוזנו."
              : status === 429
                ? "יותר מדי בקשות. נסה שוב בעוד כמה דקות."
                : "הבקשה לא הושלמה. נסה שוב.",
    );
  }
}

export async function call<T = any>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new PlatformError(response.status, typeof body?.detail === "string" ? body.detail : typeof body?.error === "string" ? body.error : "");
  }
  return response.json();
}

export const send = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const ils = (agorot: number | null | undefined) =>
  agorot == null ? "—" : (agorot / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS" });
export const shekel = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
export const when = (v: number | string | null | undefined) =>
  v == null || v === "" ? "—" : new Date(v).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });
export const duration = (s: number | null | undefined) =>
  s == null ? "—" : s < 60 ? `${s} שנ׳` : s < 3600 ? `${Math.round(s / 60)} דק׳` : `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, "0")} שע׳`;

export const STATUS_HE: Record<string, string> = {
  lead: "נרשם", active: "פעיל", suspended: "מושהה", closed: "סגור", trial: "ניסיון", past_due: "בפיגור", cancelled: "בוטל",
  expired: "פג", open: "פתוחה", paid: "שולמה", void: "מבוטלת", refunded: "הוחזרה", completed: "הושלמה", stock: "במלאי",
  in_service: "בשימוש", returned: "הוחזר", faulty: "תקול", retired: "הוצא משימוש",
};
export const DEVICE_MODE_HE: Record<string, string> = { none: "ללא מכשיר", kit: "ערכת איתור שלנו", own: "מכשיר של הלקוח" };
export const BILLING_HE: Record<string, string> = { monthly: "חודשי", yearly: "שנתי", one_time: "חד־פעמי", prepaid: "מראש" };
export const PRODUCT_HE: Record<string, string> = { navigation: "ניווט", school: "בית ספר", translator: "מתרגם" };

export const Badge = ({ value }: { value: string | null | undefined }) =>
  value ? <span className={`nav-badge nav-badge-${value}`}>{STATUS_HE[value] ?? value}</span> : null;

export function CostLine({ cost }: { cost: Row | null | undefined }) {
  if (!cost) return <span className="nav-muted">אין נתוני עלות</span>;
  return (
    <span title={cost.basis ?? ""}>
      {shekel(cost.known_subtotal_ils)}
      {cost.status !== "complete" && <small> · חלקי</small>}
    </span>
  );
}

/** Driven path drawn as SVG (no map tiles, so no coordinates leave the browser). */
export function PathView({ path }: { path: Row | null }) {
  if (!path) return null;
  const pts: number[][] = path.points ?? [];
  if (pts.length < 2)
    return <p className="nav-muted">לא נשמר מסלול לנסיעה זו (היסטוריית מיקום נשמרת מגרסה זו ואילך, 90 יום).</p>;
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const w = Math.max((maxLng - minLng) * kx, 1e-6), h = Math.max(maxLat - minLat, 1e-6), s = 280 / Math.max(w, h);
  const xy = (p: number[]) => [10 + (p[1] - minLng) * kx * s, 10 + (maxLat - p[0]) * s];
  const line = pts.map((p) => xy(p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const [sx, sy] = xy(pts[0]), [ex, ey] = xy(pts[pts.length - 1]);
  return (
    <div className="nav-path">
      <svg viewBox={`0 0 ${20 + w * s} ${20 + h * s}`} role="img" aria-label="מסלול הנסיעה">
        <polyline points={line} fill="none" stroke="#5fd4a5" strokeWidth="3" strokeLinejoin="round" />
        <circle cx={sx} cy={sy} r="6" fill="#7fb8ff" />
        <circle cx={ex} cy={ey} r="6" fill="#ff8f70" />
      </svg>
      <dl className="nav-stats">
        <div><dt>מרחק</dt><dd>{(path.distance_m / 1000).toFixed(1)} ק״מ</dd></div>
        <div><dt>מהירות ממוצעת</dt><dd>{path.avg_speed_kmh ?? "—"} קמ״ש</dd></div>
        <div><dt>מהירות מרבית</dt><dd>{path.max_speed_kmh} קמ״ש</dd></div>
        <div><dt>נקודות GPS</dt><dd>{path.point_count}</dd></div>
      </dl>
      <small>כחול: התחלה · כתום: סוף. מהירות לפי דיווח המכשיר.</small>
    </div>
  );
}

export function TripTable({ trips, load, showCustomer = false }: { trips: Row[]; load: (id: string) => Promise<Row>; showCustomer?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [path, setPath] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  if (!trips.length) return <p className="nav-muted">אין נסיעות עדיין.</p>;
  return (
    <div className="nav-table-wrap">
      <table className="nav-table">
        <thead>
          <tr>
            <th>התחלה</th>{showCustomer && <th>לקוח</th>}<th>יעד</th><th>סטטוס</th><th>משך</th><th>עלות שיחה</th><th />
          </tr>
        </thead>
        <tbody>
          {trips.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <td>{when(t.created_at_ms)}</td>
                {showCustomer && <td>{t.customer_name ?? t.customer_id}</td>}
                <td>{t.destination_label}<br /><small>{t.destination_address}</small></td>
                <td><Badge value={t.status} /></td>
                <td>{duration(t.duration_s)}</td>
                <td><CostLine cost={t.last_call_cost} /></td>
                <td>
                  <button type="button" onClick={async () => {
                    if (open === t.id) { setOpen(null); return; }
                    setOpen(t.id); setPath(null); setErr("");
                    try { setPath(await load(t.id)); } catch (e) { setErr(e instanceof Error ? e.message : "שגיאה"); }
                  }}>{open === t.id ? "סגירה" : "מסלול"}</button>
                </td>
              </tr>
              {open === t.id && (
                <tr><td colSpan={showCustomer ? 7 : 6}>{err ? <p className="nav-error">{err}</p> : path ? <PathView path={path} /> : "טוען…"}</td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsForm({ load, save }: { load: () => Promise<Row>; save: (change: Row) => Promise<Row> }) {
  const [s, setS] = useState<Row | null>(null);
  const [state, setState] = useState("");
  useEffect(() => { load().then(setS).catch(() => setState("טעינת ההגדרות נכשלה")); }, [load]);
  const change = async (c: Row) => {
    setState("שומר…");
    try { setS(await save(c)); setState("נשמר. ייכנס לתוקף מהשיחה הבאה."); } catch (e) { setState(e instanceof Error ? e.message : "השמירה נכשלה"); }
  };
  const select = (key: string, label: string, options: [string, string][]) => (
    <label>
      {label}
      <select value={s?.[key] ?? ""} disabled={!s} onChange={(e) => change({ [key]: e.target.value || null })}>
        <option value="">ברירת המחדל של המערכת</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <div className="nav-form-grid">
      {select("navigation_voice", "מצב שיחת ניווט", [["engine", "מנוע קבוע (הנחיות קצרות, זול)"], ["gemini", "Gemini מדבר (שיחה חופשית)"]])}
      {select("voice", "קול (במצב Gemini)", [["Charon", "Charon — גברי"], ["Puck", "Puck — גברי"], ["Fenrir", "Fenrir — גברי"], ["Aoede", "Aoede — נשי"], ["Kore", "Kore — נשי"]])}
      {select("navigation_interrupt", "קטיעה בזמן תשובה", [["stop_word", "רק במילת עצירה (״רגע״, ״עצור״, ״שקט״)"], ["speech", "בכל דיבור"]])}
      {state && <small role="status">{state}</small>}
    </div>
  );
}
