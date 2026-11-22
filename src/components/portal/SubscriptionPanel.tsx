import { useEffect, useState } from "react";
import { portalRequest, PortalError, topics } from "./portalApi";
import "./subscriptions.css";

export type SubscriptionSummary = {
  id: string; plan_name: string; status: string; owner: boolean; price_agorot: number; renewal_amount_agorot: number;
  term_months: number | null; current_period_start: string; current_period_end: string; pause_until: string | null;
  access_suspended_at?: string | null;
  pause_days_remaining: number; rollover_minutes: number; rollover: { minutes: number; expires_at: string }[];
  guarantee_status: string | null; extension_months: number; members: { customer_id: string; name: string; phone: string }[];
};
type Plan = { id: string; name: string; product: string; billing: string; duration_months?: number; active: boolean };
const statuses: Record<string, string> = { active: "פעיל", paused: "מוקפא", cancelled: "מבוטל", expired: "הסתיים", past_due: "ממתין לתשלום", trial: "ניסיון" };
const guarantees: Record<string, string> = { pending: "טרם הגיע מועד המדידה", granted: "אושרו 3 חודשים נוספים ללא עלות", not_eligible: "יעד השליטה הושג — אין הארכה" };
const money = (value: number) => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 }).format(value / 100);
const date = (value: string) => new Date(value).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
function errorMessage(error: unknown) {
  if (error instanceof PortalError && error.status === 401) return "הכניסה פגה או שמפתח הניהול שגוי. יש להתחבר מחדש.";
  if (error instanceof PortalError && error.status === 403) return "רק בעל המנוי יכול לבצע את הפעולה הזאת.";
  return "הפעולה לא הושלמה. בדקו שהמנוי פעיל, שנותרו ימי הקפאה, שהאסמכתה ייחודית ושלא חרגתם מארבעה בני משפחה. אפשר לנסות שוב או לפנות לתמיכה.";
}

export function SubscriptionPanel({ token, customerId, subscriptions, onRefresh, manageAccess = false }: { token: string; customerId?: string; subscriptions?: SubscriptionSummary[]; onRefresh?: () => Promise<void>; manageAccess?: boolean }) {
  const admin = !!customerId;
  const [items, setItems] = useState<SubscriptionSummary[]>(subscriptions ?? []);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [domain, setDomain] = useState("travel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const base = admin ? "/v1/admin/business/subscriptions" : "/v1/portal/subscriptions";
  const refresh = async () => {
    const result = await portalRequest<{ items: SubscriptionSummary[] }>(base + (admin ? "?customer_id=" + encodeURIComponent(customerId!) : ""), token);
    setItems(result.items);
    await onRefresh?.();
  };
  useEffect(() => { if (subscriptions) setItems(subscriptions); }, [subscriptions]);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    setError("");
    Promise.all([
      portalRequest<{ items: SubscriptionSummary[] }>(base + "?customer_id=" + encodeURIComponent(customerId!), token),
      portalRequest<{ items: Plan[] }>("/v1/admin/business/packages", token),
    ]).then(([s, p]) => {
      if (!live) return;
      setItems(s.items);
      const available = p.items.filter(p => p.active && p.product === "school" && (p.billing === "monthly" || [6, 12].includes(p.duration_months ?? 0)));
      setPlans(available); setPlanId(available[0]?.id ?? "");
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [customerId, token]);
  const act = async (path: string, body: unknown = {}, method?: string) => {
    setBusy(true); setError(""); setNote("");
    try { await portalRequest(base + path, token, body, method); await refresh(); setNote("המנוי עודכן בהצלחה."); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const changeAccess = async (sub: SubscriptionSummary) => {
    const restore = !!sub.access_suspended_at;
    if (!confirm(restore
      ? 'להסיר את ההשעיה הידנית? החזרה לתרגול כפופה לתוקף המנוי וליתרת הדקות.'
      : 'להשעות את גישת המנוי לתרגול בטלפון ובאתר, גם לבני המשפחה? החיוב לא ישתנה.')) return;
    setBusy(true); setError(""); setNote("");
    try {
      const result = await portalRequest<Pick<SubscriptionSummary, 'id' | 'access_suspended_at'>>(
        "/v1/admin/crm/subscriptions/" + encodeURIComponent(sub.id) + (restore ? "/restore" : "/suspend"), token, {});
      setItems(current => current.map(item => item.id === result.id ? { ...item, access_suspended_at: result.access_suspended_at } : item));
      setNote(restore ? "ההשעיה הידנית הוסרה." : "הגישה דרך המנוי הושעתה.");
    } catch (e) {
      if (e instanceof PortalError && e.status === 401) window.dispatchEvent(new Event('admin-session-expired'));
      setError("לא הצלחנו לעדכן את הגישה למנוי. נסו שוב.");
    } finally { setBusy(false); }
  };
  const selectedPlan = plans.find(p => p.id === planId);
  return <section className={"subscription-panel " + (admin ? "subscription-admin" : "")} dir="rtl" aria-label={admin ? "מנוי" : "המנוי שלי"}>
    <h3>{admin ? "מנוי" : "המנוי שלי"}</h3>
    {error && <p className="subscription-error" role="alert">{error}</p>}
    {note && <p className="subscription-note" role="status">{note}</p>}
    <fieldset disabled={busy}>
      {admin && <div className="subscription-create">
        <label>מסלול<select value={planId} onChange={e => setPlanId(e.target.value)}>{!plans.length && <option value="">אין מסלולים זמינים</option>}{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {selectedPlan?.duration_months === 12 && <label>תחום נוסף לשליטה מלאה<select value={domain} onChange={e => setDomain(e.target.value)}>{Object.entries(topics).filter(([id]) => !["recommended", "everyday"].includes(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
        <button type="button" disabled={!planId} onClick={() => void act("", { customer_id: customerId, plan_id: planId, ...(selectedPlan?.duration_months === 12 ? { domains: [{ domain: "everyday", levels: ["beginner"] }, { domain: "everyday", levels: ["intermediate", "fluent"] }, { domain }] } : {}) })}>יצירת מנוי</button>
        <small>רישום זכאות בלבד — לא מתבצע חיוב אשראי.</small>
      </div>}
      {!items.length && !error && <p>עדיין אין מנוי בחשבון.</p>}
      {items.map(sub => <SubscriptionCard key={sub.id} sub={sub} admin={admin} act={act} changeAccess={manageAccess && admin ? changeAccess : undefined} />)}
    </fieldset>
    {busy && <p role="status">מעדכנים את המנוי…</p>}
  </section>;
}

function SubscriptionCard({ sub, admin, act, changeAccess }: { sub: SubscriptionSummary; admin: boolean; act: (path: string, body?: unknown, method?: string) => Promise<void>; changeAccess?: (sub: SubscriptionSummary) => Promise<void> }) {
  const [days, setDays] = useState(7);
  const [reference, setReference] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const active = sub.status === "active";
  const path = "/" + sub.id;
  return <article className="subscription-card">
    <div className="subscription-heading"><strong>{sub.plan_name}</strong><span>{statuses[sub.status] || "לא ידוע"}</span></div>
    {sub.access_suspended_at && <p className="subscription-error">הגישה דרך המנוי הושעתה על ידי מנהל.</p>}
    {changeAccess && (sub.status !== "expired" || sub.access_suspended_at) && <div className="subscription-actions">
      <button type="button" onClick={() => void changeAccess(sub)}>{sub.access_suspended_at ? "פתיחת גישה מחדש" : "השעיית גישה"}</button>
      <small>גישה לתרגול בלבד, ללא שינוי בחיוב.</small>
    </div>}
    {!admin && !sub.owner && <p className="subscription-note">אתם חלק ממנוי משפחתי. הדקות משותפות, ההתקדמות אישית. ניהול המנוי אצל בעל החשבון.</p>}
    <dl>
      <div><dt>{sub.term_months ? "מחיר המסלול הנעול" : "מחיר חודשי נעול"}</dt><dd>{money(sub.price_agorot)}{sub.term_months ? ` ל־${sub.term_months} חודשים` : " לחודש"}</dd></div>
      {admin && <div><dt>סכום חידוש כולל משפחה</dt><dd>{money(sub.renewal_amount_agorot)}</dd></div>}
      <div><dt>{admin ? "תקופה נוכחית" : "בתוקף עד"}</dt><dd>{admin && <>{date(sub.current_period_start)} — </>}{date(sub.current_period_end)}</dd></div>
      <div><dt>דקות שהועברו מהחודש הקודם</dt><dd>{sub.rollover_minutes.toLocaleString("he-IL", { maximumFractionDigits: 1 })}</dd></div>
      <div><dt>ימי הקפאה שנותרו השנה</dt><dd>{Math.floor(sub.pause_days_remaining)}</dd></div>
      {sub.pause_until && <div><dt>המנוי מוקפא עד</dt><dd>{date(sub.pause_until)}</dd></div>}
      {admin && <div><dt>אחריות</dt><dd>{sub.guarantee_status ? guarantees[sub.guarantee_status] : "לא חלה במסלול זה"}</dd></div>}
    </dl>
    <small>המחיר נעול כל עוד המנוי פעיל</small>
    {sub.rollover.map((r, i) => <p key={i}>{r.minutes.toLocaleString("he-IL", { maximumFractionDigits: 1 })} דקות מועברות · תוקף עד {date(r.expires_at)}{sub.status === "paused" && " · התוקף יוארך בסיום ההקפאה"}</p>)}
    {(admin || sub.owner) && <>
      <div className="subscription-actions">
        {active && <><label>ימי הקפאה (1–60)<input type="number" min="1" max={Math.min(60, Math.floor(sub.pause_days_remaining))} value={days} onChange={e => setDays(Number(e.target.value))} /></label><button type="button" disabled={!Number.isInteger(days) || days < 1 || days > Math.min(60, sub.pause_days_remaining)} onClick={() => void act(path + "/pause", { days })}>הקפאה</button></>}
        {sub.status === "paused" && <button type="button" onClick={() => void act(path + "/resume")}>המשך</button>}
        {admin && ["active", "paused", "past_due"].includes(sub.status) && <button type="button" className="subscription-danger" onClick={() => { if (confirm("לבטל את המנוי? דקות קיימות יישמרו עד תום התוקף.")) void act(path + "/cancel"); }}>ביטול</button>}
      </div>
      {admin && <>
        <div className="subscription-actions"><label>אסמכתת חיוב<input value={reference} onChange={e => setReference(e.target.value)} maxLength={150} /></label><button type="button" disabled={!["active", "paused", "past_due"].includes(sub.status) || !reference.trim()} onClick={() => void act(path + "/renewal", { reference })}>רישום חיוב חודשי</button><button type="button" disabled={!active || sub.guarantee_status !== "pending"} onClick={() => void act(path + "/evaluate-guarantee")}>הערכת אחריות</button></div>
        <h4>בני משפחה ({sub.members.length}/4)</h4>
        {!sub.members.length && <p>אין בני משפחה נוספים.</p>}
        {sub.members.map(m => <div className="subscription-member" key={m.customer_id}><span>{m.name} · <bdi>{m.phone}</bdi></span><button type="button" onClick={() => void act(path + "/members/" + m.customer_id, undefined, "DELETE")}>הסרת בן משפחה</button></div>)}
        <div className="subscription-actions"><label>שם בן המשפחה<input value={name} onChange={e => setName(e.target.value)} maxLength={100} /></label><label>טלפון<input type="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} /></label><button type="button" disabled={!active || sub.members.length >= 4 || !name.trim() || phone.length < 8} onClick={() => void act(path + "/members", { name, phone })}>הוספת בן משפחה</button></div>
      </>}
    </>}
  </article>;
}
