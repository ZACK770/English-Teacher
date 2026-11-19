import { useEffect, useState } from 'react';

type Row = { utm_source: string; utm_campaign: string; visitors: number; leads: number; signups: number; checkouts: number; purchases: number; revenue: number; lead_rate: number; signup_rate: number; checkout_rate: number; purchase_rate: number };
export function AnalyticsView() {
  const [start, setStart] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [range, setRange] = useState({ start, end });
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const prefix = location.pathname.startsWith('/english/') ? '/english' : '';
    void fetch(prefix + '/v1/admin/analytics?' + new URLSearchParams(range), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 401) window.dispatchEvent(new Event('admin-session-expired'));
        if (!response.ok) throw new Error('לא ניתן לטעון נתונים. בדקו את טווח התאריכים (עד שנה) ואת ההרשאות.');
        return response.json();
      }).then(data => setRows(data.rows))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range]);
  const percent = (n: number) => (n * 100).toLocaleString('he-IL', { maximumFractionDigits: 1 }) + '%';
  return <section dir="rtl" className="space-y-6 text-[#172b35]">
    <header><h1 className="text-3xl font-extrabold">אנליטיקס</h1><p className="text-sm mt-2">משפך לפי מקור וקמפיין במגע הראשון. תאריכים ב־UTC. המרות ותשלומים מאומתים בשרת; אירועי דפדפן אינם נספרים שוב.</p></header>
    <form className="flex flex-wrap items-end gap-4" onSubmit={e => { e.preventDefault(); setRange({ start, end }); }}>
      <label>מתאריך <input className="block bg-white border rounded p-2" type="date" required value={start} max={end} onChange={e => setStart(e.target.value)} /></label>
      <label>עד תאריך <input className="block bg-white border rounded p-2" type="date" required value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
      <button className="bg-emerald-700 text-white rounded px-4 py-2" disabled={loading}>הצגת נתונים</button>
    </form>
    {loading && <p role="status">טוענים נתונים…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !rows.length && <p>אין נתונים בטווח התאריכים שנבחר.</p>}
    {!loading && !error && rows.length > 0 && <div className="overflow-x-auto bg-white border rounded-xl p-4"><table className="w-full text-right text-sm whitespace-nowrap">
      <caption className="text-right pb-4">מבקרים ייחודיים לפי מזהה אנונימי; לידים, הרשמות, הזמנות ורכישות לפי רשומה ייחודית. שיעורי ההמרה הם ביחס למבקרים באותו טווח, לא ניתוח עוקבה. עד 500 קמפיינים.</caption>
      <thead><tr>{['מקור', 'קמפיין', 'מבקרים', 'לידים', 'הרשמות', 'התחלות תשלום', 'רכישות', 'הכנסות ₪', 'ליד / מבקר', 'הרשמה / מבקר', 'תשלום / מבקר', 'רכישה / מבקר'].map(label => <th className="p-2 border-b" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={JSON.stringify([row.utm_source, row.utm_campaign])}>
        {[row.utm_source, row.utm_campaign, row.visitors, row.leads, row.signups, row.checkouts, row.purchases,
          row.revenue.toLocaleString('he-IL', { maximumFractionDigits: 2 }), percent(row.lead_rate), percent(row.signup_rate), percent(row.checkout_rate), percent(row.purchase_rate)]
          .map((value, i) => <td className="p-2 border-b" key={i}>{value}</td>)}
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
