import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Badge, BILLING_HE, call, CostLine, DEVICE_MODE_HE, duration, ils, PRODUCT_HE, Row, send, SettingsForm, STATUS_HE, TripTable, when,
} from "./shared";

const A = "/v1/admin/app";
export type PlatformTab = "customers" | "trips" | "plans" | "inventory" | "invoices" | "reports";

const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
};
const shekelToAgorot = (v: string) => Math.round(Number(v) * 100);
const fresh = (ms: number | null | undefined) => (ms == null ? "never" : Date.now() - ms < 2 * 60_000 ? "fresh" : "stale");

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    load().then((d) => alive && (setData(d), setError(""))).catch((e) => alive && setError(e instanceof Error ? e.message : "שגיאה"));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

function useAction(after: () => void) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await action(); setMsg({ ok: true, text: ok }); after(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "שגיאה" }); }
    finally { setBusy(false); }
  };
  const view = msg && <p className={msg.ok ? "nav-success" : "nav-error"} role="status">{msg.text}</p>;
  return { run, busy, view };
}

function CustomerForm({ token, onCreated }: { token: string; onCreated: (id: string) => void }) {
  const plans = useLoad(() => call<Row[]>(`${A}/plans`, token), [token]);
  const devices = useLoad(() => call<Row[]>(`${A}/devices`, token), [token]);
  const [mode, setMode] = useState("none");
  const { run, busy, view } = useAction(() => undefined);
  const free = (devices.data ?? []).filter((d) => !d.customer_id && d.enabled);
  return (
    <form className="nav-form-grid" onSubmit={(e) => {
      const f = form(e);
      const target = e.currentTarget;
      void run(async () => {
        const c = await call<Row>(`${A}/customers`, token, send("POST", {
          name: f.name, phone: f.phone, city: f.city, status: f.status, source: f.source || "admin", notes: f.notes, device_mode: mode,
        }));
        if (f.plan_id) await call(`${A}/subscriptions`, token, send("POST", { customer_id: c.id, plan_id: f.plan_id, status: f.sub_status }));
        if (mode !== "none" && f.device_id) await call("/v1/admin/navigation/assignments", token, send("POST", { customer_id: c.id, device_id: f.device_id }));
        target.reset(); setMode("none"); onCreated(c.id);
      }, "הלקוח נרשם.");
    }}>
      <label>שם מלא<input name="name" required maxLength={100} /></label>
      <label>טלפון ראשי<input name="phone" type="tel" required dir="ltr" minLength={9} maxLength={20} /></label>
      <label>עיר<input name="city" maxLength={80} /></label>
      <label>סטטוס
        <select name="status" defaultValue="active">{["lead", "active", "suspended"].map((s) => <option key={s} value={s}>{STATUS_HE[s]}</option>)}</select>
      </label>
      <label>מקור הגעה<input name="source" maxLength={80} placeholder="המלצה, מודעה, כולל…" /></label>
      <fieldset className="nav-choice">
        <legend>מכשיר איתור</legend>
        {Object.entries(DEVICE_MODE_HE).map(([v, l]) => (
          <label key={v}><input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} /> {l}</label>
        ))}
      </fieldset>
      {mode !== "none" && (
        <label>שיוך מכשיר מהמלאי (אופציונלי)
          <select name="device_id" defaultValue="">
            <option value="">— לשייך מאוחר יותר —</option>
            {free.map((d) => <option key={d.device_id} value={d.device_id}>{d.label} · {d.model || d.device_id}</option>)}
          </select>
        </label>
      )}
      <label>מסלול מנוי (אופציונלי)
        <select name="plan_id" defaultValue="">
          <option value="">— ללא מנוי כרגע —</option>
          {(plans.data ?? []).filter((p) => p.product === "navigation" && p.active).map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {ils(p.price_agorot)} {BILLING_HE[p.billing]}</option>
          ))}
        </select>
      </label>
      <label>מצב המנוי
        <select name="sub_status" defaultValue="trial">{["trial", "active"].map((s) => <option key={s} value={s}>{STATUS_HE[s]}</option>)}</select>
      </label>
      <label className="nav-wide">הערות<textarea name="notes" maxLength={2000} rows={2} /></label>
      <button className="nav-primary" disabled={busy}>{busy ? "שומר…" : "רישום לקוח"}</button>
      {view}
      <small className="nav-wide">פתיחת מנוי אינה מחייבת כסף. חיוב בפועל מתבצע רק דרך נדרים פלוס.</small>
    </form>
  );
}

function CustomerDetail({ token, id, onChanged }: { token: string; id: string; onChanged: () => void }) {
  const d = useLoad(() => call<Row>(`${A}/customers/${encodeURIComponent(id)}?limit=50`, token), [token, id]);
  const plans = useLoad(() => call<Row[]>(`${A}/plans`, token), [token]);
  const devices = useLoad(() => call<Row[]>(`${A}/devices`, token), [token, id]);
  const { run, busy, view } = useAction(() => { d.reload(); devices.reload(); onChanged(); });
  const [code, setCode] = useState<Row | null>(null);
  const loadSettings = useCallback(() => call<Row>(`${A}/customers/${encodeURIComponent(id)}/settings`, token), [token, id]);
  const saveSettings = useCallback((c: Row) => call<Row>(`${A}/customers/${encodeURIComponent(id)}/settings`, token, send("PUT", c)), [token, id]);
  if (d.error) return <p className="nav-error">{d.error}</p>;
  if (!d.data) return <p>טוען…</p>;
  const { customer: c, subscriptions, device, invoices, trips, calls } = d.data;
  const free = (devices.data ?? []).filter((x) => !x.customer_id && x.enabled);
  const patch = (body: Row, ok: string) => run(() => call(`${A}/customers/${encodeURIComponent(id)}`, token, send("PATCH", body)), ok);
  return (
    <div className="nav-detail">
      <header>
        <div>
          <h3>{c.name} <Badge value={c.status} /></h3>
          <p dir="ltr" className="nav-ltr">{c.primary_phone}</p>
          <small>{c.city || "—"} · מקור: {c.source || "—"} · נרשם {when(c.created_at)}</small>
        </div>
        <div className="nav-actions">
          {c.status === "lead" && <button disabled={busy} onClick={() => patch({ status: "active" }, "הלקוח הופעל.")}>הפעלת לקוח</button>}
          {c.status === "active" && <button disabled={busy} onClick={() => confirm("להשהות את הלקוח? הוא לא יוכל להתחבר.") && patch({ status: "suspended" }, "הלקוח הושהה.")}>השהיה</button>}
          {c.status === "suspended" && <button disabled={busy} onClick={() => patch({ status: "active" }, "הלקוח הופעל מחדש.")}>הפעלה מחדש</button>}
          <button disabled={busy || c.status === "suspended" || c.status === "closed"} onClick={() => run(async () => setCode(await call(`${A}/customers/${encodeURIComponent(id)}/login-code`, token, send("POST", {}))), "נוצר קוד כניסה.")}>
            קוד כניסה לאזור האישי
          </button>
        </div>
      </header>
      {view}
      {code && <p className="nav-code">קוד: <strong dir="ltr">{code.code}</strong> · בתוקף עד {when(code.expires_at_ms)}. יש להקריא ללקוח בטלפון; הכניסה בכתובת <a href="/app">/app</a>.</p>}

      <section>
        <h4>מכשיר איתור · {DEVICE_MODE_HE[c.device_mode] ?? c.device_mode}</h4>
        <div className="nav-inline">
          <select value={c.device_mode} disabled={busy} onChange={(e) => patch({ device_mode: e.target.value }, "סוג ההתקשרות עודכן.")}>
            {Object.entries(DEVICE_MODE_HE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {device ? (
          <div className="nav-inline">
            <span className={`nav-dot nav-dot-${fresh(device.last_received_at_ms)}`} />
            <span>{device.label} · {device.model || device.device_id}</span>
            <span>דיווח אחרון: {when(device.last_received_at_ms)}</span>
            <span>סוללה: {device.battery.level_percent ?? "—"}% (הערכת המכשיר)</span>
            {device.sim_iccid && <span dir="ltr">SIM {device.sim_iccid}</span>}
            <button disabled={busy} onClick={() => confirm("להסיר את שיוך המכשיר?") && run(() => call("/v1/admin/navigation/assignments", token, send("DELETE", { customer_id: id })), "השיוך הוסר.")}>הסרת שיוך</button>
          </div>
        ) : (
          <form className="nav-inline" onSubmit={(e) => { const f = form(e); void run(() => call("/v1/admin/navigation/assignments", token, send("POST", { customer_id: id, device_id: f.device_id })), "המכשיר שויך."); }}>
            <span>אין מכשיר משויך.</span>
            <select name="device_id" required defaultValue="">
              <option value="" disabled>בחירת מכשיר פנוי</option>
              {free.map((x) => <option key={x.device_id} value={x.device_id}>{x.label} · {x.model || x.device_id}</option>)}
            </select>
            <button disabled={busy || !free.length}>שיוך</button>
          </form>
        )}
      </section>

      <section>
        <h4>מנויים</h4>
        {subscriptions.length ? (
          <table className="nav-table"><thead><tr><th>מסלול</th><th>סטטוס</th><th>מחיר נעול</th><th>התחלה</th><th>סוף תקופה</th><th /></tr></thead>
            <tbody>{subscriptions.map((s: Row) => (
              <tr key={s.id}>
                <td>{s.plan_name} <small>{PRODUCT_HE[s.product]}</small></td><td><Badge value={s.status} /></td>
                <td>{ils(s.price_agorot)} {BILLING_HE[s.billing]}</td><td>{when(s.started_at)}</td><td>{when(s.current_period_end)}</td>
                <td className="nav-actions">
                  {s.status === "trial" && <button disabled={busy} onClick={() => run(() => call(`${A}/subscriptions/${s.id}`, token, send("PATCH", { status: "active" })), "המנוי הופעל.")}>הפעלה</button>}
                  {!["cancelled", "expired"].includes(s.status) && <button disabled={busy} onClick={() => confirm("לבטל את המנוי?") && run(() => call(`${A}/subscriptions/${s.id}`, token, send("PATCH", { status: "cancelled", cancelled_at: new Date().toISOString() })), "המנוי בוטל.")}>ביטול</button>}
                </td>
              </tr>))}</tbody></table>
        ) : <p className="nav-muted">אין מנויים.</p>}
        <form className="nav-inline" onSubmit={(e) => { const f = form(e); void run(() => call(`${A}/subscriptions`, token, send("POST", { customer_id: id, plan_id: f.plan_id, status: f.status })), "המנוי נוסף."); }}>
          <select name="plan_id" required defaultValue="">
            <option value="" disabled>הוספת מנוי…</option>
            {(plans.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {ils(p.price_agorot)} {BILLING_HE[p.billing]}</option>)}
          </select>
          <select name="status" defaultValue="trial">{["trial", "active"].map((s) => <option key={s} value={s}>{STATUS_HE[s]}</option>)}</select>
          <button disabled={busy}>הוספה</button>
        </form>
      </section>

      <section>
        <h4>הגדרות שיחה ללקוח</h4>
        <SettingsForm load={loadSettings} save={saveSettings} />
      </section>

      <section>
        <h4>נסיעות אחרונות</h4>
        <TripTable trips={trips} load={(t) => call(`${A}/trips/${encodeURIComponent(t)}/path`, token)} />
      </section>

      <section>
        <h4>שיחות אחרונות</h4>
        {calls.length ? (
          <table className="nav-table"><thead><tr><th>מועד</th><th>בוט</th><th>משך</th><th>עלות מחושבת</th><th>סיכום</th></tr></thead>
            <tbody>{calls.map((x: Row) => <tr key={x.call_id}><td>{when(x.created_at)}</td><td>{x.bot_id}</td><td>{duration(x.duration_seconds)}</td><td><CostLine cost={x.cost} /></td><td>{x.summary_he ?? "—"}</td></tr>)}</tbody></table>
        ) : <p className="nav-muted">אין שיחות.</p>}
        <small>תמלול מלא, זמני תגובה וכלים — בלשונית ״שיחות ולוגים״.</small>
      </section>

      <section>
        <h4>חשבוניות</h4>
        <InvoiceTable token={token} rows={invoices} after={d.reload} />
      </section>

      <section>
        <h4>הערות</h4>
        <form onSubmit={(e) => { const f = form(e); void patch({ notes: f.notes }, "ההערות נשמרו."); }}>
          <textarea name="notes" defaultValue={c.notes} rows={3} maxLength={2000} />
          <button disabled={busy}>שמירת הערות</button>
        </form>
      </section>
    </div>
  );
}

function Customers({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => call<Row[]>(`${A}/customers?limit=200&q=${encodeURIComponent(q)}${status ? "&status=" + status : ""}`, token), [token, q, status]);
  return (
    <div className="nav-split">
      <aside className="nav-panel">
        <div className="nav-inline">
          <input type="search" placeholder="חיפוש שם או טלפון" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">כל הסטטוסים</option>
            {["lead", "active", "suspended", "closed"].map((s) => <option key={s} value={s}>{STATUS_HE[s]}</option>)}
          </select>
        </div>
        <button className="nav-primary" onClick={() => { setAdding(true); setSelected(null); }}>+ לקוח חדש</button>
        {list.error && <p className="nav-error">{list.error}</p>}
        <ul className="nav-list">
          {(list.data ?? []).map((c) => (
            <li key={c.id}>
              <button className={selected === c.id ? "active" : ""} onClick={() => { setSelected(c.id); setAdding(false); }}>
                <strong>{c.name}</strong> <Badge value={c.status} />
                <small dir="ltr">{c.primary_phone}</small>
                <small>{c.device_id ? "📍 " + c.device_id : DEVICE_MODE_HE[c.device_mode] ?? ""}{c.source === "web_signup" ? " · הרשמה באתר" : ""}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="nav-panel">
        {adding ? (
          <>
            <h3>רישום לקוח חדש</h3>
            <CustomerForm token={token} onCreated={(id) => { setAdding(false); setSelected(id); list.reload(); }} />
          </>
        ) : selected ? (
          <CustomerDetail token={token} id={selected} onChanged={list.reload} />
        ) : (
          <p className="nav-muted">בחר לקוח מהרשימה או רשום לקוח חדש. לקוחות שנרשמו בטופס הציבורי (/join-navigation) מופיעים בסטטוס ״נרשם״.</p>
        )}
      </section>
    </div>
  );
}

function InvoiceTable({ token, rows, after }: { token: string; rows: Row[]; after: () => void }) {
  const { run, busy, view } = useAction(after);
  if (!rows.length) return <p className="nav-muted">אין חשבוניות.</p>;
  return (
    <div className="nav-table-wrap">
      {view}
      <table className="nav-table"><thead><tr><th>תאריך</th><th>תיאור</th><th>סכום</th><th>סטטוס</th><th>מקור / אסמכתה</th><th /></tr></thead>
        <tbody>{rows.map((i) => (
          <tr key={i.id}>
            <td>{when(i.issued_at)}</td><td>{i.description}</td><td>{ils(i.amount_agorot)} <small>כולל מע״מ {Math.round((i.vat_rate ?? 0) * 100)}%</small></td>
            <td><Badge value={i.status} /></td><td>{i.provider === "manual" ? "ידני" : i.provider} {i.provider_reference && <small dir="ltr">{i.provider_reference}</small>}</td>
            <td>{i.provider !== "manual" ? <small>נעול ({i.provider})</small> : i.status === "open" && (
              <span className="nav-actions">
                <button disabled={busy} onClick={() => run(() => call(`${A}/invoices/${i.id}`, token, send("PATCH", { status: "paid", paid_at: new Date().toISOString() })), "סומן כשולם (רישום בלבד).")}>סימון כשולם</button>
                <button disabled={busy} onClick={() => confirm("לבטל את החשבונית?") && run(() => call(`${A}/invoices/${i.id}`, token, send("PATCH", { status: "void" })), "החשבונית בוטלה.")}>ביטול</button>
              </span>)}
            </td>
          </tr>))}</tbody></table>
    </div>
  );
}

function Invoices({ token }: { token: string }) {
  const list = useLoad(() => call<Row[]>(`${A}/invoices`, token), [token]);
  const customers = useLoad(() => call<Row[]>(`${A}/customers?limit=200`, token), [token]);
  const { run, busy, view } = useAction(list.reload);
  return (
    <section className="nav-panel">
      <h3>חשבוניות ותשלומים</h3>
      <p>רישום חשבונית ידנית אינו מחייב כרטיס ואינו שולח דבר ללקוח. קבלות נדרים פלוס נכנסות אוטומטית ונעולות לעריכה.</p>
      <details>
        <summary>רישום חשבונית ידנית</summary>
        <form className="nav-form-grid" onSubmit={(e) => {
          const f = form(e);
          void run(() => call(`${A}/invoices`, token, send("POST", { customer_id: f.customer_id, description: f.description, amount_agorot: shekelToAgorot(f.amount), status: f.status })), "החשבונית נרשמה.");
        }}>
          <label>לקוח<select name="customer_id" required defaultValue=""><option value="" disabled>בחירה</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>תיאור<input name="description" required maxLength={300} /></label>
          <label>סכום כולל מע״מ (₪)<input name="amount" type="number" min="0" step="0.01" required /></label>
          <label>סטטוס<select name="status" defaultValue="open">{["open", "paid"].map((s) => <option key={s} value={s}>{STATUS_HE[s]}</option>)}</select></label>
          <button disabled={busy}>רישום</button>
        </form>
      </details>
      {view}
      {list.error ? <p className="nav-error">{list.error}</p> : <InvoiceTable token={token} rows={list.data ?? []} after={list.reload} />}
    </section>
  );
}

function Plans({ token }: { token: string }) {
  const list = useLoad(() => call<Row[]>(`${A}/plans`, token), [token]);
  const { run, busy, view } = useAction(list.reload);
  return (
    <section className="nav-panel">
      <h3>מסלולי מחיר</h3>
      <p>מסלולי ניווט ניתנים לעריכה כאן. חבילות בית הספר והמתרגם מוצגות לקריאה בלבד ומנוהלות במערכת הראשית.</p>
      {view}
      <table className="nav-table"><thead><tr><th>שם</th><th>מוצר</th><th>חיוב</th><th>מחיר</th><th>דקות / תוקף</th><th>כולל מכשיר</th><th>פעיל</th></tr></thead>
        <tbody>{(list.data ?? []).map((p) => (
          <tr key={p.id}>
            <td>{p.name}<br /><small>{p.description}</small></td><td>{PRODUCT_HE[p.product] ?? p.product}</td><td>{BILLING_HE[p.billing]}</td><td>{ils(p.price_agorot)}</td>
            <td>{p.included_minutes ?? "∞"} דק׳ · {p.validity_days ? p.validity_days + " ימים" : "—"}</td><td>{p.includes_device ? "כן" : "לא"}</td>
            <td>{p.product === "navigation"
              ? <input type="checkbox" checked={p.active} disabled={busy} onChange={(e) => run(() => call(`${A}/plans/${p.id}`, token, send("PATCH", { active: e.target.checked })), "המסלול עודכן.")} />
              : p.active ? "כן" : "לא"}</td>
          </tr>))}</tbody></table>
      <details>
        <summary>מסלול ניווט חדש</summary>
        <form className="nav-form-grid" onSubmit={(e) => {
          const f = form(e);
          void run(() => call(`${A}/plans`, token, send("POST", {
            name: f.name, billing: f.billing, price_agorot: shekelToAgorot(f.price), included_minutes: f.minutes ? Number(f.minutes) : null,
            validity_days: f.days ? Number(f.days) : null, includes_device: f.includes_device === "on", active: f.active === "on", description: f.description,
          })), "המסלול נוצר.");
        }}>
          <label>שם<input name="name" required maxLength={100} /></label>
          <label>חיוב<select name="billing" defaultValue="monthly">{Object.entries(BILLING_HE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>מחיר (₪)<input name="price" type="number" min="0" step="0.01" required /></label>
          <label>דקות כלולות (ריק = ללא הגבלה)<input name="minutes" type="number" min="0" /></label>
          <label>תוקף בימים<input name="days" type="number" min="1" /></label>
          <label><input type="checkbox" name="includes_device" /> כולל ערכת איתור</label>
          <label><input type="checkbox" name="active" /> פעיל (מוצג בהרשמה)</label>
          <label className="nav-wide">תיאור<input name="description" maxLength={1000} /></label>
          <button disabled={busy}>יצירה</button>
        </form>
      </details>
    </section>
  );
}

function Inventory({ token }: { token: string }) {
  const devices = useLoad(() => call<Row[]>(`${A}/devices`, token), [token]);
  const sims = useLoad(() => call<Row[]>(`${A}/sims`, token), [token]);
  const { run, busy, view } = useAction(() => { devices.reload(); sims.reload(); });
  return (
    <>
      <section className="nav-panel">
        <h3>מכשירי איתור</h3>
        <p>רישום מכשיר חדש לקליטה (מזהה Traccar) — בלשונית ״מכשירים ומיקום״. כאן מנהלים מלאי, דגם, IMEI וסים.</p>
        {view}
        <div className="nav-table-wrap">
          <table className="nav-table"><thead><tr><th>מכשיר</th><th>דגם / IMEI</th><th>סים</th><th>מלאי</th><th>לקוח</th><th>דיווח אחרון</th><th>סוללה</th><th /></tr></thead>
            <tbody>{(devices.data ?? []).map((d) => (
              <tr key={d.device_id}>
                <td>{d.label}<br /><small dir="ltr">{d.device_id}</small></td>
                <td>{d.model || "—"}<br /><small dir="ltr">{d.imei || ""}</small></td>
                <td><small dir="ltr">{d.sim_iccid || "—"}</small></td>
                <td><select value={d.inventory_status} disabled={busy} onChange={(e) => run(() => call(`${A}/devices/${encodeURIComponent(d.device_id)}`, token, send("PATCH", { inventory_status: e.target.value })), "עודכן.")}>
                  {["stock", "in_service", "returned", "faulty", "retired"].map((s) => <option key={s} value={s}>{STATUS_HE[s]}</option>)}</select></td>
                <td>{d.customer_id ? "משויך" : "פנוי"}</td>
                <td><span className={`nav-dot nav-dot-${fresh(d.last_received_at_ms)}`} /> {when(d.last_received_at_ms)}{d.last_report_valid === 0 && <small> · דיווח אחרון לא תקף</small>}</td>
                <td>{d.battery_level_pct ?? "—"}%{d.charging ? " ⚡" : ""}</td>
                <td>
                  <details><summary>עריכה</summary>
                    <form onSubmit={(e) => { const f = form(e); void run(() => call(`${A}/devices/${encodeURIComponent(d.device_id)}`, token, send("PATCH", { model: f.model, imei: f.imei, sim_iccid: f.sim_iccid || null })), "המכשיר עודכן."); }}>
                      <input name="model" placeholder="דגם" defaultValue={d.model} maxLength={80} />
                      <input name="imei" placeholder="IMEI (15 ספרות)" defaultValue={d.imei} pattern="[0-9]{15}|" dir="ltr" />
                      <select name="sim_iccid" defaultValue={d.sim_iccid ?? ""}><option value="">ללא סים</option>{(sims.data ?? []).map((s) => <option key={s.iccid} value={s.iccid}>{s.carrier} {s.iccid}</option>)}</select>
                      <button disabled={busy}>שמירה</button>
                    </form>
                  </details>
                </td>
              </tr>))}</tbody></table>
        </div>
      </section>
      <section className="nav-panel">
        <h3>כרטיסי SIM</h3>
        <table className="nav-table"><thead><tr><th>ICCID</th><th>ספק</th><th>מספר</th><th>חבילה</th><th>עלות חודשית</th><th>סטטוס</th><th>מכשיר</th></tr></thead>
          <tbody>{(sims.data ?? []).map((s) => (
            <tr key={s.iccid}><td dir="ltr">{s.iccid}</td><td>{s.carrier}</td><td dir="ltr">{s.msisdn}</td><td>{s.plan_name} {s.data_mb_month ? `· ${s.data_mb_month}MB` : ""}</td>
              <td>{ils(s.monthly_cost_agorot)}</td><td><Badge value={s.status} /></td><td>{s.device_id ?? "—"}</td></tr>))}</tbody></table>
        <details>
          <summary>הוספה / עדכון סים</summary>
          <form className="nav-form-grid" onSubmit={(e) => {
            const f = form(e);
            void run(() => call(`${A}/sims`, token, send("POST", { iccid: f.iccid, carrier: f.carrier, msisdn: f.msisdn, plan_name: f.plan_name,
              data_mb_month: f.data ? Number(f.data) : null, monthly_cost_agorot: f.cost ? shekelToAgorot(f.cost) : null, status: f.status })), "הסים נשמר.");
          }}>
            <label>ICCID<input name="iccid" required pattern="[0-9]{18,22}F?" dir="ltr" /></label>
            <label>ספק<input name="carrier" maxLength={60} placeholder="019 / HOT / 1NCE" /></label>
            <label>מספר (MSISDN)<input name="msisdn" maxLength={20} dir="ltr" /></label>
            <label>שם חבילה<input name="plan_name" maxLength={100} /></label>
            <label>נפח חודשי (MB)<input name="data" type="number" min="0" /></label>
            <label>עלות חודשית (₪)<input name="cost" type="number" min="0" step="0.01" /></label>
            <label>סטטוס<select name="status" defaultValue="active">{["stock", "active", "suspended", "cancelled"].map((s) => <option key={s} value={s}>{STATUS_HE[s] ?? s}</option>)}</select></label>
            <button disabled={busy}>שמירה</button>
          </form>
        </details>
      </section>
    </>
  );
}

function Trips({ token }: { token: string }) {
  const list = useLoad(() => call<Row[]>(`${A}/trips?limit=200`, token), [token]);
  return (
    <section className="nav-panel">
      <h3>היסטוריית נסיעות</h3>
      <p>כל הנסיעות שנפתחו בשיחה. ״מסלול״ מציג את הדרך שנסעה בפועל לפי ה־GPS, מרחק ומהירויות.</p>
      {list.error ? <p className="nav-error">{list.error}</p> : <TripTable showCustomer trips={list.data ?? []} load={(t) => call(`${A}/trips/${encodeURIComponent(t)}/path`, token)} />}
    </section>
  );
}

function Reports({ token }: { token: string }) {
  const r = useLoad(() => Promise.all([call<Row>(`${A}/reports`, token), call<Row>(`${A}/summary`, token), call<Row[]>(`${A}/devices`, token)]), [token]);
  if (r.error) return <p className="nav-error">{r.error}</p>;
  if (!r.data) return <p>טוען…</p>;
  const [rep, sum, devs] = r.data;
  const online = devs.filter((d) => fresh(d.last_received_at_ms) === "fresh").length;
  const tile = (label: string, value: string | number, note = "") => <div className="nav-tile"><small>{label}</small><strong>{value}</strong>{note && <small>{note}</small>}</div>;
  return (
    <>
      <section className="nav-tiles">
        {tile("לקוחות", sum.customers, Object.entries(rep.customers_by_status).map(([k, v]) => `${STATUS_HE[k] ?? k} ${v}`).join(" · "))}
        {tile("עם ערכה שלנו", rep.customers_by_device_mode.kit ?? 0)}
        {tile("עם מכשיר משלהם", rep.customers_by_device_mode.own ?? 0)}
        {tile("ללא מכשיר", rep.customers_by_device_mode.none ?? 0)}
        {tile("מנויים פעילים", sum.active_subscriptions)}
        {tile("הכנסה חודשית חוזרת", ils(rep.mrr_agorot), "מנויים פעילים, שנתי ÷ 12")}
        {tile("מכשירים מחוברים", `${online} / ${sum.devices}`, "דיווח בשתי הדקות האחרונות")}
        {tile("סימים", sum.sims)}
        {tile("נסיעות", sum.trips)}
        {tile("חשבוניות פתוחות", sum.open_invoices)}
      </section>
      <section className="nav-panel">
        <h3>לפי חודש</h3>
        <table className="nav-table"><thead><tr><th>חודש</th><th>לקוחות חדשים</th><th>נסיעות</th><th>שיחות עם חישוב עלות</th><th>עלות שיחות מחושבת</th></tr></thead>
          <tbody>{rep.months.map((m: Row) => (
            <tr key={m.month}><td>{m.month}</td><td>{m.new_customers}</td><td>{m.trips}</td><td>{m.calls_costed}{m.calls_partial_cost ? <small> ({m.calls_partial_cost} חלקי)</small> : null}</td>
              <td>{m.call_cost_ils.toLocaleString("he-IL", { style: "currency", currency: "ILS" })}</td></tr>))}</tbody></table>
        <small>עלות השיחה מחושבת מנתוני השימוש ש־Google מדווחת ושער בנק ישראל; אינה כוללת טלפוניה ומפות. ״חלקי״ = חסרים נתונים.</small>
      </section>
    </>
  );
}

export function AdminPlatform({ tab, token }: { tab: PlatformTab; token: string }) {
  if (tab === "customers") return <Customers token={token} />;
  if (tab === "trips") return <Trips token={token} />;
  if (tab === "plans") return <Plans token={token} />;
  if (tab === "inventory") return <Inventory token={token} />;
  if (tab === "invoices") return <Invoices token={token} />;
  return <Reports token={token} />;
}
