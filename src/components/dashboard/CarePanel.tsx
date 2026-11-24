import { useEffect, useState } from 'react';

type Entry = { id:string; customer:string; kind:'note'|'task'|'callback'; name:string; last:string; title:string; due:string; closed?:string; by?:string; outcome?:string };
type Request = <T,>(path:string, init?:RequestInit) => Promise<T>;
const format = (v:string) => new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem', dateStyle:'short', ...(v.length > 10 ? {timeStyle:'short' as const} : {})});

export function CarePanel({customer, base, request, onSaved}:{customer?:string; base:string; request:Request; onSaved?:()=>void}) {
  const [items,setItems] = useState<Entry[] | null>(null);
  const [error,setError] = useState(''), [revision,refresh] = useState(0), [busy,setBusy] = useState(false);
  const [action,setAction] = useState(''), [selected,select] = useState(''), [title,setTitle] = useState(''), [due,setDue] = useState('');
  const path = '/v1/admin/crm/care' + (customer ? '/' + encodeURIComponent(customer) : '');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    request<Entry[]>(path,{signal:controller.signal}).then(setItems).catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  },[path,request,revision]);
  function start(mode:string,id='') {setAction(mode); select(id); setTitle(''); setDue('');}
  async function submit(event:React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      await request(path,{method:'POST',body:JSON.stringify({action,id:selected,title,due})});
      start(''); refresh(v => v+1); onSaved?.();
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section className="crm-care"><h2>{customer ? 'טיפול ושירות' : 'לטיפול היום'}</h2>
    {customer && <div className="crm-actions"><button className="crm-primary" onClick={()=>start('task')}>קבע מעקב</button><button className="crm-button" onClick={()=>start('note')}>הוסף הערה</button></div>}
    {action && <form onSubmit={submit}><h3>{{task:'מעקב חדש',note:'הערה פנימית',close:'סיום טיפול',postpone:'דחיית טיפול'}[action]}</h3>
      {action!=='postpone' && <label>{action==='close'?'תוצאת הטיפול':'תוכן'}<textarea required maxLength={2000} value={title} onChange={e=>setTitle(e.target.value)}/></label>}
      {['task','postpone'].includes(action) && <label>יום הטיפול<input type="date" required value={due} onChange={e=>setDue(e.target.value)}/></label>}
      <button className="crm-primary" disabled={busy}>שמירה</button> <button type="button" className="crm-button" disabled={busy} onClick={()=>start('')}>ביטול</button></form>}
    {error && <p role="alert">{error} <button onClick={()=>refresh(v=>v+1)}>רענון</button></p>}
    {!items && !error && <p role="status">טוענים…</p>}
    {items?.length===0 && <p>{customer?'אין טיפול מתועד.':'אין פניות שמועד הטיפול בהן הגיע.'}</p>}
    {items?.map(i=><article key={i.id}>
      {!customer && <a href={base+'/'+encodeURIComponent(i.customer)+'?from=today'}>{i.name}</a>}
      <small>{i.kind==='callback'?'בקשת חזרה':i.kind==='note'?'הערה פנימית':'מעקב מנהל'} · {format(i.due)}</small>
      <strong>{i.title}</strong>
      {!customer && i.last && <small>פעילות אחרונה · {format(i.last)}</small>}
      {i.closed ? <span>טופל ב־{format(i.closed)} · {i.by} · {i.outcome}</span> : customer && i.kind!=='note' && <div className="crm-actions"><button className="crm-button" onClick={()=>start('close',i.id)}>סמן כטופל</button><button className="crm-button" onClick={()=>start('postpone',i.id)}>דחה למועד אחר</button></div>}
    </article>)}</section>;
}

