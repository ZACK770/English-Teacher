import React, { useEffect, useRef, useState } from "react";
import { track } from '../../analytics';
import { ProChoices } from "./ProBadge";
import { CreditCard, Lock } from "lucide-react";
import { portalRequest, topics } from "./portalApi";

type Step = { kind: "charge" | "keva"; id: string };
type Order = {
  id: string; state: string; package_name: string; minutes: number; validity_days: number; amount_ils: number; installments: number;
  subscription: { id: string; state: string; monthly_ils: number; next_date: string } | null; steps: Step[]; iframe_url: string;
};

export function Checkout({ token, packageId, onDone }: { token: string; packageId: string; onDone: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [height, setHeight] = useState(260);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [domain, setDomain] = useState("");
  const pending = useRef<Step | null>(null);
  const orderRef = useRef<Order | null>(null);
  orderRef.current = order;

  useEffect(() => {
    if (packageId === "school-mastery" && !domain) return;
    portalRequest<Order>("/v1/portal/checkout", token, { package_id: packageId, ...(domain ? { domain } : {}) }).then(setOrder, e => setError(e.message));
  }, [token, packageId, domain]);

  const post = (data: unknown) => frame.current?.contentWindow?.postMessage(data, "https://www.matara.pro");
  const finish = async (o: Order) => {
    for (let i = 0; i < 20; i++) {
      const fresh = await portalRequest<Order>("/v1/portal/checkout/" + o.id, token);
      setOrder(fresh);
      if (fresh.state === "paid" && (!fresh.subscription || fresh.subscription.state === "active")) {
        track('purchase', { reference: fresh.id, value: fresh.amount_ils, currency: 'ILS' }, fresh.id);
        setDone(true); setBusy(false); return;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    setBusy(false);
    setError("התשלום התקבל ומחכה לאישור סופי מחברת הסליקה. המסלול ייפתח אוטומטית בדקות הקרובות, אין צורך לשלם שוב.");
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== "https://www.matara.pro" || !event.data || typeof event.data !== "object") return;
      const { Name, Value } = event.data as { Name?: string; Value?: any };
      if (Name === "Height") setHeight(Math.max(120, Number(Value) || 260) + 28);
      if (Name !== "TransactionResponse" || !pending.current || !orderRef.current) return;
      const step = pending.current, o = orderRef.current;
      pending.current = null;
      if (Value?.Status !== "OK") { setBusy(false); setError(String(Value?.Message || "החיוב לא אושר. אפשר לבדוק את הפרטים ולנסות שוב.")); return; }
      void (async () => {
        try {
          if (step.kind === "keva") await portalRequest("/v1/portal/checkout/" + o.id + "/keva", token, { keva_id: String(Value.ID ?? "") });
          const next = o.steps.find(s => s.kind === "keva" && step.kind === "charge");
          if (next) { pending.current = next; post({ Name: "FinishTransaction", Value: next.id }); return; }
          await finish(o);
        } catch (e) { setBusy(false); setError((e as Error).message); }
      })();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [token]);

  const pay = () => {
    if (!order?.steps.length) return;
    setError(""); setBusy(true);
    pending.current = order.steps[0];
    post({ Name: "FinishTransaction", Value: order.steps[0].id });
  };

  if (!order) return <section className="sk-step-card"><h2>{packageId === "school-mastery" && !domain ? "תחום נוסף לשליטה מלאה" : "מכינים את התשלום…"}</h2>{packageId === "school-mastery" && !domain && <ProChoices kind="domain" label="באיזה תחום נתרגל?" value={domain} onChange={setDomain} values={Object.fromEntries(Object.entries(topics).filter(([id]) => !["recommended", "everyday"].includes(id)))} />}{error && <p role="alert">{error}</p>}</section>;
  const sub = order.subscription;
  return <section className="sk-step-card sk-checkout" dir="rtl">
    <h2>{done ? "ההצטרפות הושלמה · " + order.package_name : "מסלול " + order.package_name}</h2>
    {done ? <><p>התשלום אושר והמסלול זמין.{sub ? " החיוב החודשי יתחדש אוטומטית." : ""}</p><button className="sk-primary" onClick={onDone}>להתחיל לדבר</button></> : <>
      <p>{sub ? <>₪{sub.monthly_ils} לחודש בהוראת קבע: החודש הראשון עכשיו, והחיוב הבא ב-{sub.next_date}. אפשר לבטל בכל עת.</> : order.installments > 1 ? <>₪{order.amount_ils}, עד {order.installments} תשלומים בכרטיס אשראי.</> : <>₪{order.amount_ils}, תשלום אחד.</>} תוקף המסלול: {order.validity_days} ימים.</p>
      <div className="sk-card-frame"><iframe ref={frame} id="NedarimFrame" title="פרטי כרטיס אשראי" src={order.iframe_url} scrolling="no" style={{ width: "100%", height, border: 0, display: "block" }} onLoad={() => post({ Name: "GetHeight" })} /></div>
      {error && <p role="alert" className="sk-access is-empty">{error}</p>}
      <button className="sk-primary" disabled={busy || !order.steps.length} onClick={pay}><CreditCard size={18} />{busy ? "מאשרים מול חברת האשראי…" : "לתשלום ₪" + order.amount_ils}</button>
      <p className="sk-muted"><Lock size={13} /> פרטי הכרטיס מוקלדים ישירות בדף התשלום המאובטח ואינם עוברים דרכנו.</p>
    </>}
  </section>;
}

type Sub = { id: string; state: string; package_name: string; monthly_ils: number; next_date: string | null };
export function Billing({ token }: { token: string }) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [note, setNote] = useState("");
  const load = () => portalRequest<{ subscriptions: Sub[] }>("/v1/portal/billing", token).then(r => setSubs(r.subscriptions), () => undefined);
  useEffect(() => { void load(); }, [token]);
  if (!subs.length && !note) return null;
  return <section className="sk-step-card sk-billing" dir="rtl">
    <h2>המנוי שלי</h2>
    {subs.map(s => <div key={s.id} className="sk-billing-row">
      <p><strong>{s.package_name}</strong> · ₪{s.monthly_ils} לחודש בהוראת קבע{s.next_date ? " · החיוב הבא ב-" + s.next_date : ""}{s.state === "past_due" ? " · החיוב האחרון לא עבר" : ""}</p>
      <button className="sk-link" onClick={() => {
        if (!confirm("לבטל את הוראת הקבע? הגישה תישאר עד סוף התקופה.")) return;
        portalRequest("/v1/portal/subscriptions/" + s.id + "/cancel", token, {}).then(() => { setNote("הוראת הקבע בוטלה. לא יהיו חיובים נוספים."); void load(); }, e => setNote(e.message));
      }}>ביטול הוראת הקבע</button>
    </div>)}
    {note && <p role="status">{note}</p>}
  </section>;
}
