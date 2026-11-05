import React from 'react';
import { useApp } from '../../store/AppContext';
import { TrendingUp, Users, DollarSign, Bot, ArrowRight, AlertCircle, Sparkles } from 'lucide-react';

export const OverviewView: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { customers, receipts, bots, activeAiSessions, paymentIssues, paymentOrders } = useApp();

  const totalReceiptsIls = receipts.reduce((acc, r) => acc + r.amount_ils, 0);
  const payingCustomersCount = customers.filter(c => c.has_paid).length;
  const pendingOrders = paymentOrders.filter(o => o.state === 'awaiting_settlement' || o.pending_review);
  const openIssuesCount = paymentIssues.filter(i => i.status === 'open').length;

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div>
        <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">מרכז הניהול / תמונת מצב</span>
        <h1 className="text-3xl font-extrabold text-[#172b35]">העסק, במבט אחד</h1>
        <p className="text-sm text-[#718087] mt-1">
          תמונת מצב עסקית לחודש הנוכחי • נתונים אמיתיים שנרשמו במערכת (טכנוליין, נדרים פלוס, Gemini)
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#102d32] text-white p-5 rounded-2xl shadow-sm">
          <span className="text-xs text-[#acc0bf] block">תקבולים רשומים</span>
          <span className="text-3xl font-black text-[#dceab7] tabular-nums block mt-1.5">
            ₪{totalReceiptsIls.toLocaleString()}
          </span>
          <span className="text-[11px] text-[#8ca4a6] block mt-1">כולל מע״מ • סליקה מאומתת</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-2xs">
          <span className="text-xs text-[#718087] block">לקוחות משלמים</span>
          <span className="text-3xl font-black text-[#172b35] tabular-nums block mt-1.5">
            {payingCustomersCount}
          </span>
          <span className="text-[11px] text-[#718087] block mt-1">מתוך {customers.length} רשומים</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-2xs">
          <span className="text-xs text-[#718087] block">עלות AI משוערת</span>
          <span className="text-3xl font-black text-[#172b35] tabular-nums block mt-1.5">
            ₪84.50
          </span>
          <span className="text-[11px] text-[#718087] block mt-1">אומדן שימוש • Gemini 2.0 Live</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-2xs">
          <span className="text-xs text-[#718087] block">עודף כספי ידוע</span>
          <span className="text-3xl font-black text-[#137c69] tabular-nums block mt-1.5">
            ₪{(totalReceiptsIls - 84.5 - 350).toLocaleString()}
          </span>
          <span className="text-[11px] text-[#137c69] font-bold block mt-1">לפני הוצאות שלא הוזנו</span>
        </div>
      </div>

      {/* Notices */}
      {openIssuesCount > 0 && (
        <div className="p-4 bg-[#fff8e9] border-r-4 border-[#e4b55d] rounded-xl text-xs text-[#725018] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#e4b55d]" />
            <span>
              <strong>מעקב גבייה:</strong> ישנן {openIssuesCount} בעיות גבייה פתוחות ו-{pendingOrders.length} עסקאות הממתינות לאישור סופי בסולק.
            </span>
          </div>
          <button
            onClick={() => onNavigate('packages')}
            className="text-xs font-bold underline hover:opacity-80"
          >
            פתיחת מעקב גבייה ←
          </button>
        </div>
      )}

      {/* Grid: Actions & Growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Operations */}
        <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-[#172b35]">מה תרצה לעשות היום?</h2>
            <span className="text-xs bg-[#e9f5f0] text-[#137c69] px-2.5 py-1 rounded-md font-bold">ניהול שוטף</span>
          </div>

          <div className="space-y-3">
            {[
              { id: 'campaigns', title: 'שיווק, דיוור ואינטייק A/B', sub: 'נוסחי המייל של שוכי וההורים, שיחת אינטייק יזומה' },
              { id: 'excel_economics', title: 'אקסל עלויות ורווח', sub: 'מחשבון עלויות דקה, חבילות מתנה ושולי רווח' },
              { id: 'bots', title: 'ניהול המורים והבוטים', sub: 'שוכי, מאיה, אלכס, פרומפטים, קול ו-VAD' },
              { id: 'customers', title: 'תיקי לקוחות ומעקב אישי', sub: 'היסטוריית שיחות, העדפות ומפיק קישורים' },
              { id: 'pbx', title: 'מרכזייה חיה (טכנוליין)', sub: 'שלוחה 99, עדכון נוסחים חיים, אימות קווים' }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="w-full text-right p-3.5 rounded-xl border border-[#e3e8eb] hover:border-[#137c69] hover:bg-[#fafbfc] transition flex items-center justify-between gap-4"
              >
                <div>
                  <h3 className="font-bold text-sm text-[#172b35]">{item.title}</h3>
                  <p className="text-xs text-[#718087] mt-0.5">{item.sub}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-[#718087] rotate-180" />
              </button>
            ))}
          </div>
        </div>

        {/* Growth & Observability Numbers */}
        <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-[#172b35]">המספרים שמאחורי הצמיחה</h2>
            <span className="text-xs bg-[#f5f6f8] text-[#718087] px-2.5 py-1 rounded-md">זמן אמת</span>
          </div>

          <div className="space-y-3.5 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-[#f0f3f4]">
              <span className="text-[#718087]">סך תלמידים רשומים ב-CRM</span>
              <strong className="text-[#172b35] text-sm tabular-nums">{customers.length}</strong>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-[#f0f3f4]">
              <span className="text-[#718087]">סשני AI פעילים כרגע בקו</span>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <strong className="text-[#137c69] text-sm tabular-nums">{activeAiSessions.length} שיחות חיות</strong>
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-[#f0f3f4]">
              <span className="text-[#718087]">עלות רכישת לקוח נטו (חבילת מתנה 20 דק׳)</span>
              <strong className="text-[#137c69] text-sm tabular-nums">₪3.60 בלבד</strong>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-[#f0f3f4]">
              <span className="text-[#718087]">בוטים מוגדרים ופעילים</span>
              <strong className="text-[#172b35] text-sm tabular-nums">{bots.filter(b => b.enabled).length} בוטים</strong>
            </div>

            <div className="pt-2">
              <button
                onClick={() => onNavigate('excel_economics')}
                className="w-full py-2.5 rounded-xl bg-[#e9f5f0] text-[#137c69] font-bold hover:bg-[#d8efe6] transition flex items-center justify-center gap-1.5"
              >
                <span>למחשבון האקסל ולמודל התמחור המלא</span>
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
