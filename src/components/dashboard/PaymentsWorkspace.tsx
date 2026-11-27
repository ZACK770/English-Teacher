import { useEffect, useState } from 'react';
type Payment = { id: string; customer_id: string; customer_name?: string; phone?: string; amount_ils: number; state: string; created_at: string; reference?: string; subscription_id?: string; receipt_id?: string; next_date?: string; last_charge_at?: string; last_refusal_at?: string };
const labels: Record<string,string> = { verified:'תשלום מאומת',recorded:'רישום זכאות',reversed:'תשלום בוטל',active:'פעילה',pending:'בהמתנה',failed:'נכשלה',cancelled:'בוטלה',past_due:'ממתינה לתשלום',suspended:'מושהית' };
const amount = (value: number) => new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'}).format(value);
const date = (value?: string) => value ? new Date(value).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}) : '—';
export function PaymentsWorkspace({ base, customer }: { base: string; customer?: string }) {
  const query = new URLSearchParams(location.search);
  const [kind,setKind] = useState(query.get('kind') === 'standing' ? 'standing' : 'receipt');
  const id = customer ? null : query.get('payment');
  const [items,setItems] = useState<Payment[]>([]), [more,setMore] = useState(false), [offset,setOffset] = useState(0);
  const [busy,setBusy] = useState(true), [error,setError] = useState('');
  const prefix = base.startsWith('/english/') ? '/english' : '';
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true); setError('');
    const params = new URLSearchParams({kind,offset:String(offset)});
    if (customer) params.set('customer',customer);
    if (id) params.set('id',id);
    fetch(prefix+'/v1/admin/crm/payments?'+params,{signal:abort.signal,cache:'no-store'}).then(async response => {
      if (response.status===401) window.dispatchEvent(new Event('admin-session-expired'));
      if (!response.ok) throw new Error('לא ניתן לטעון את נתוני התשלומים.');
      const data = await response.json();
      setItems(data.items);setMore(data.more);
    }).catch(failure => {if(!abort.signal.aborted)setError(failure.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return ()=>abort.abort();
  },[customer,id,kind,offset,prefix]);
  const recordLink = (record: Payment, type = kind) => base+'?view=payments&kind='+type+'&payment='+encodeURIComponent(record.id);
  return <section className="sc-payments">
    {!customer && <div className="crm-title-row"><div><div className="crm-eyebrow">כספים</div><h1>{id ? 'פרטי רשומה' : 'תשלומים והוראות קבע'}</h1></div>{id && <a className="crm-button" href={base+'?view=payments&kind='+kind}>כל הרשומות</a>}</div>}
    {!id && <div className="sc-record-tabs" aria-label="סוג רשומה">{[['receipt','תשלומים וזכאויות'],['standing','הוראות קבע']].map(([key,label])=><button key={key} aria-pressed={kind===key} onClick={()=>{setKind(key);setOffset(0);const url=new URL(location.href);url.searchParams.set('kind',key);history.replaceState(null,'',url);}}>{label}</button>)}</div>}
    {error && <p role="alert" className="crm-error">{error}</p>}
    {busy ? <p className="crm-loading">טוען רשומות…</p> : id && items[0] ? <article className="sc-record-panel">
      <div className="sc-payment-hero"><span className="crm-badge">{labels[items[0].state] || items[0].state}</span><h2>{amount(items[0].amount_ils)}{kind==='standing' && ' לחודש'}</h2>
      <a className="sc-record-link" href={base+'/'+encodeURIComponent(items[0].customer_id)+'?tab=payments'}>{items[0].customer_name || items[0].phone || 'פתיחת הלקוח'} ←</a></div>
      <dl className="sc-facts"><dt>נוצרה</dt><dd>{date(items[0].created_at)}</dd><dt>מזהה רשומה</dt><dd dir="ltr">{items[0].id}</dd>
      {items[0].reference && <><dt>אסמכתה</dt><dd dir="auto">{items[0].reference}</dd></>}
      {kind==='standing' && <><dt>חיוב אחרון</dt><dd>{date(items[0].last_charge_at)}</dd><dt>חיוב מתוכנן</dt><dd>{date(items[0].next_date)}</dd><dt>סירוב אחרון</dt><dd>{date(items[0].last_refusal_at)}</dd></>}
      {items[0].subscription_id && <><dt>מנוי</dt><dd><a href={base+'/'+encodeURIComponent(items[0].customer_id)+'?tab=payments#subscription-'+encodeURIComponent(items[0].subscription_id)}>פתיחת המנוי בכרטיס הלקוח</a></dd></>}
      {items[0].receipt_id && <><dt>זכאות מההזמנה הראשונה</dt><dd><a href={recordLink({...items[0],id:items[0].receipt_id},'receipt')}>פתיחת הרשומה</a></dd></>}
      </dl>
    </article> : <div className="crm-table-panel"><div className="crm-table-scroll"><table><thead><tr><th>תאריך</th>{!customer && <th>לקוח</th>}<th>סכום{kind==='standing' ? ' חודשי' : ''}</th><th>מצב</th><th>פרטים</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{date(item.created_at)}</td>{!customer && <td><a href={base+'/'+encodeURIComponent(item.customer_id)+'?tab=payments'}>{item.customer_name || item.phone || item.customer_id}</a></td>}<td>{amount(item.amount_ils)}</td><td><span className="crm-badge">{labels[item.state] || item.state}</span></td><td><a className="sc-record-link" href={recordLink(item)}>פתיחת רשומה ←</a></td></tr>)}</tbody></table></div>{!items.length && <p className="crm-empty">{id ? 'הרשומה לא נמצאה.' : 'אין רשומות בתצוגה הזאת.'}</p>}</div>}
    {!id && <div className="crm-pagination">{offset>0 && <button className="crm-button" onClick={()=>setOffset(Math.max(0,offset-100))}>הקודם</button>}{more && <button className="crm-button" onClick={()=>setOffset(offset+100)}>הבא</button>}</div>}
  </section>;
}
