import { useEffect, useState } from 'react';

type Row = { call_id: string; customer_id: string; customer_name: string; teacher: string; started_at: string; duration_seconds: number; ai_cost_ils: number; telephony_cost_ils: number; total_cost_ils: number };
type Group = { id: string; name: string; calls: number; total_cost_ils: number };
type Report = { items: Row[]; capped: boolean; totals: { calls: number; minutes: number; ai_cost_ils: number; telephony_cost_ils: number; total_cost_ils: number }; insights: { cost_per_minute: number; short_call_share: number; top_customers: Group[]; by_teacher: Group[] } };
const money = (v: number) => v.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });
const num = (v: number) => v.toLocaleString('he-IL', { maximumFractionDigits: 1 });
export function CrmCostsPanel({ request, base }: { request: <T>(path: string, init?: RequestInit) => Promise<T>; base: string }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [range, setRange] = useState({ from, to }), [report, setReport] = useState<Report | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<keyof Row>('total_cost_ils'), [ascending, setAscending] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void request<Report>('/v1/admin/crm/calls?' + new URLSearchParams(range), { signal: controller.signal }).then(setReport).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, request]);
  const columns: [keyof Row, string][] = [['customer_name', 'לקוח'], ['teacher', 'מורה'], ['started_at', 'מועד שיחה'], ['duration_seconds', 'משך בדקות'], ['ai_cost_ils', 'בינה מלאכותית'], ['telephony_cost_ils', 'טלפוניה'], ['total_cost_ils', 'סה״כ']];
  const rows = [...(report?.items || [])].sort((a, b) => { const x = a[sort], y = b[sort]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he')) * (ascending ? 1 : -1); });
  return <section><h1>עלויות ותובנות</h1><p className="crm-muted">שיחות בית הספר בלבד · עלויות משוערות, לא חשבונית ספק · תאריכים לפי זמן אוניברסלי</p>
    <form className="crm-tools" onSubmit={e => { e.preventDefault(); setRange({ from, to }); }}><label>מתאריך<input type="date" required value={from} max={to} onChange={e => setFrom(e.target.value)} /></label><label>עד תאריך<input type="date" required value={to} min={from} onChange={e => setTo(e.target.value)} /></label><button className="crm-primary" disabled={loading}>הצגת נתונים</button></form>
    {loading && <p role="status">טוענים עלויות…</p>}{error && <p className="crm-error" role="alert">{error}</p>}
    {!loading && !error && report && <><div className="crm-kpis">{[['שיחות', num(report.totals.calls)], ['דקות', num(report.totals.minutes)], ['בינה מלאכותית', money(report.totals.ai_cost_ils)], ['טלפוניה', money(report.totals.telephony_cost_ils)], ['סה״כ משוער', money(report.totals.total_cost_ils)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="crm-subscription-bar"><span>עלות לדקה: <b>{money(report.insights.cost_per_minute)}</b></span><span>שיחות קצרות מדקה: <b>{num(report.insights.short_call_share * 100)}%</b></span></div>
      <div className="crm-detail-grid">{[['לקוחות מובילים בעלות', report.insights.top_customers], ['עלות לפי מורה', report.insights.by_teacher]].map(([title, groups]) => <section key={String(title)}><h2>{String(title)}</h2>{(groups as Group[]).map(g => <p key={g.id}>{title === 'לקוחות מובילים בעלות' ? <a href={base + '/' + encodeURIComponent(g.id)}>{g.name}</a> : g.name} · {g.calls} שיחות · <b>{money(g.total_cost_ils)}</b></p>)}</section>)}</div>
      {report.capped && <p role="status">מוצגות 2,000 השיחות האחרונות בלבד. הסיכומים כוללים את כל הטווח.</p>}
      {!rows.length ? <p className="crm-empty">אין שיחות בטווח שנבחר.</p> : <div className="crm-table-panel crm-table-scroll"><table><thead><tr>{columns.map(([key, label]) => <th key={key}><button className="crm-sort" onClick={() => { setAscending(sort === key ? !ascending : false); setSort(key); }}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ' ↕'}</button></th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.call_id}><td><a href={base + '/' + encodeURIComponent(r.customer_id)}>{r.customer_name}</a></td><td>{r.teacher}</td><td>{new Date(r.started_at).toLocaleString('he-IL')}</td><td>{num(r.duration_seconds / 60)}</td><td>{money(r.ai_cost_ils)}</td><td>{money(r.telephony_cost_ils)}</td><td>{money(r.total_cost_ils)}</td></tr>)}</tbody></table></div>}</>}
  </section>;
}
