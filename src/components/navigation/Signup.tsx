import { useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import { BILLING_HE, call, DEVICE_MODE_HE, ils, Row, send } from "./shared";
import "../navigation.css";

export function Signup() {
  const [plans, setPlans] = useState<Row[]>([]);
  const [mode, setMode] = useState("kit");
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { call<Row[]>("/v1/app/plans", null).then((p) => setPlans(p.filter((x) => x.product === "navigation"))).catch(() => undefined); }, []);
  return (
    <div className="navigation-console" dir="rtl">
      <header className="nav-header">
        <div className="nav-brand"><span className="nav-logo"><Navigation size={23} /></span><div><h1>וייז כשר</h1><p>ניווט קולי בטלפון — בלי סמארטפון</p></div></div>
        <nav><a href="/app">כניסה ללקוחות</a></nav>
      </header>
      <main>
        <section className="nav-panel nav-signup">
          <h2>הצטרפות לשירות</h2>
          <p>מתקשרים מכל טלפון, אומרים לאן — ומקבלים הנחיות קוליות בזמן הנסיעה. עם מכשיר איתור ברכב ההנחיות מדויקות לפי המיקום; גם בלי מכשיר אפשר להתחיל.</p>
          {state?.ok ? <p className="nav-success" role="status">{state.text}</p> : (
            <form className="nav-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
              setBusy(true); setState(null);
              try {
                await call("/v1/app/signup", null, send("POST", { name: f.name, phone: f.phone, city: f.city, notes: f.notes, plan_id: f.plan_id || null, device_mode: mode, website: f.website ?? "" }));
                setState({ ok: true, text: "נרשמת בהצלחה. נציג יחזור אליך לתיאום ולהפעלה. לא בוצע חיוב." });
              } catch (err) { setState({ ok: false, text: err instanceof Error ? err.message : "שגיאה" }); }
              finally { setBusy(false); }
            }}>
              <label>שם מלא<input name="name" required minLength={2} maxLength={100} /></label>
              <label>טלפון (המספר שממנו תתקשרו)<input name="phone" type="tel" required dir="ltr" minLength={9} maxLength={20} /></label>
              <label>עיר<input name="city" maxLength={80} /></label>
              <fieldset className="nav-choice nav-wide">
                <legend>מכשיר איתור לרכב</legend>
                {Object.entries(DEVICE_MODE_HE).map(([v, l]) => (
                  <label key={v}><input type="radio" checked={mode === v} onChange={() => setMode(v)} /> {v === "kit" ? "אני רוצה ערכת איתור מוכנה" : v === "own" ? "יש לי מכשיר איתור משלי" : "בלי מכשיר בינתיים"} <small>({l})</small></label>
                ))}
              </fieldset>
              {plans.length > 0 && (
                <label className="nav-wide">מסלול
                  <select name="plan_id" defaultValue="">
                    <option value="">אחליט בשיחה עם נציג</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {ils(p.price_agorot)} {BILLING_HE[p.billing]}{p.includes_device ? " · כולל ערכה" : ""}</option>)}
                  </select>
                </label>
              )}
              <label className="nav-wide">הערות<textarea name="notes" maxLength={500} rows={2} /></label>
              <input name="website" tabIndex={-1} autoComplete="off" className="nav-hp" aria-hidden="true" />
              <button className="nav-primary" disabled={busy}>{busy ? "שולח…" : "הרשמה"}</button>
              {state && <p className="nav-error" role="alert">{state.text}</p>}
            </form>
          )}
        </section>
      </main>
      <footer>ההרשמה אינה מחייבת תשלום · הפרטים משמשים לתיאום השירות בלבד</footer>
    </div>
  );
}
