import React, { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { portalRequest } from '../portal/portalApi';

type CampaignRow = { campaign: string; calls: number; new_callers: number; returning_callers: number; lessons_booked: number; emails: number; payment_links: number };
type Followup = { id: string; type: string; campaign: string; customer_id: string; phone?: string; at: string; scheduled_at?: string; plan_id?: string; channel?: string; email?: string; link?: string; day?: string; part_of_day?: string };
type Report = { campaigns: CampaignRow[]; followups: Followup[] };

const days: Record<string, string> = { today: 'היום', tomorrow: 'מחר', this_week: 'השבוע', other: 'מועד אחר', sunday: 'יום ראשון', monday: 'יום שני', tuesday: 'יום שלישי', wednesday: 'יום רביעי', thursday: 'יום חמישי', friday: 'יום שישי', saturday: 'שבת' };
const parts: Record<string, string> = { morning: 'בבוקר', noon: 'בצהריים', afternoon: 'אחר הצהריים', evening: 'בערב' };

export function followupText(f: Followup) {
  if (f.type === 'lesson') {
    const scheduled = f.scheduled_at ? new Date(f.scheduled_at) : null;
    const time = scheduled && Number.isFinite(scheduled.getTime()) ? ` · מועד החיוג (שעון ישראל): ${scheduled.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}` : '';
    return `שיעור הבא: ${days[f.day ?? ''] ?? 'מועד אחר'} ${parts[f.part_of_day ?? ''] ?? ''}${time}`;
  }
  if (f.type === 'email') return `מייל לשליחת המילים: ${f.email}`;
  return `לשלוח קישור תשלום (${f.channel === 'sms' ? 'SMS' : 'מייל'}) למסלול ${f.plan_id}: ${f.link}`;
}

export const AdCampaignsPanel: React.FC = () => {
  const { adminToken } = useApp();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!adminToken) return;
    let live = true;
    portalRequest<Report>('/v1/admin/ad-campaigns', adminToken)
      .then(r => { if (live) { setReport(r); setError(''); } })
      .catch(() => { if (live) setError('לא הצלחנו לטעון את נתוני הפרסומות. יש לבדוק את מפתח הניהול.'); });
    return () => { live = false; };
  }, [adminToken]);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
      <h2 className="text-lg font-black text-[#172b35] flex items-center gap-2"><Megaphone className="w-5 h-5 text-[#137c69]" />מתקשרים מפרסומת (הקישו 1)</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!adminToken && <p className="text-sm text-slate-500">יש להתחבר עם מפתח ניהול כדי לראות את הנתונים.</p>}
      {report && (report.campaigns.length === 0
        ? <p className="text-sm text-slate-500">עדיין אין שיחות מפרסומת.</p>
        : (
          <table className="w-full text-sm text-right">
            <thead className="text-slate-500"><tr><th>קמפיין</th><th>שיחות</th><th>חדשים</th><th>חוזרים</th><th>שיעורים שנקבעו</th><th>מיילים</th><th>בקשות קישור תשלום</th></tr></thead>
            <tbody>
              {report.campaigns.map(r => (
                <tr key={r.campaign} className="border-t border-slate-100"><td className="font-bold">{r.campaign}</td><td>{r.calls}</td><td>{r.new_callers}</td><td>{r.returning_callers}</td><td>{r.lessons_booked}</td><td>{r.emails}</td><td>{r.payment_links}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
      {report && report.followups.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold text-[#172b35]">לטיפול הצוות</h3>
          <ul className="text-sm space-y-1">
            {report.followups.map(f => <li key={f.id} className="break-all">{new Date(f.at).toLocaleString('he-IL')} · {f.phone || f.customer_id} · {f.campaign} · {followupText(f)}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
};
