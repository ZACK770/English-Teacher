import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { INITIAL_EMAIL_CAMPAIGNS } from '../../store/initialData';
import { Mail, Copy, Check, Send, PhoneCall, Bot, Users, Sparkles } from 'lucide-react';

export const CampaignsView: React.FC = () => {
  const { showToast, submitCallbackRequest } = useApp();
  const [campaigns, setCampaigns] = useState(INITIAL_EMAIL_CAMPAIGNS);
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaigns[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Test intake call state
  const [intakePhone, setIntakePhone] = useState('050-1234567');
  const [intakeName, setIntakeName] = useState('שיחת בדיקה');
  const [isIntakeCalling, setIsIntakeCalling] = useState(false);

  const activeCamp = campaigns.find(c => c.id === selectedCampaignId) || campaigns[0];

  const handleCopyEmail = (camp: typeof activeCamp) => {
    const fullText = `נושא: ${camp.subject}\n\n${camp.body_text}\n\n[כפתור פעולה]: ${camp.cta_label}`;
    navigator.clipboard.writeText(fullText);
    setCopiedId(camp.id);
    showToast('תוכן המייל הועתק ללוח. אפשר להדביק ישירות במערכת הדיוור!');
    setTimeout(() => setCopiedId(null), 3000);
  };

  const handleTriggerIntakeCall = () => {
    setIsIntakeCalling(true);
    showToast(`יוזם שיחת אינטייק ומכירה אוטומטית למספר ${intakePhone}...`);
    setTimeout(() => {
      setIsIntakeCalling(false);
      submitCallbackRequest({
        name: intakeName,
        phone: intakePhone,
        for_whom: 'self',
        goal: 'שיחת אינטייק מקמפיין דיוור',
        timing: 'now'
      });
      showToast('שיחת האינטייק חוברה בהצלחה! שוכי מחייג כעת.');
    }, 1200);
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Top Head */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">שיווק, דיוור ואינטייק</span>
          <h1 className="text-2xl font-black text-[#172b35] flex items-center gap-2">
            <span>סטודיו דיוור A/B ושירות שיחות אינטייק</span>
          </h1>
          <p className="text-xs text-[#718087] mt-1">
            ניסוחים מלוטשים לשליחה לרשימת התפוצה, השוואת ביצועים ושיגור שיחות היכרות אוטומטיות.
          </p>
        </div>
      </div>

      {/* Campaign Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaigns.map(camp => (
          <div
            key={camp.id}
            onClick={() => setSelectedCampaignId(camp.id)}
            className={`p-5 rounded-2xl border cursor-pointer transition ${
              selectedCampaignId === camp.id
                ? 'bg-white border-[#137c69] shadow-md ring-1 ring-[#137c69]/20'
                : 'bg-[#fafbfc] border-[#e3e8eb] hover:bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                camp.version === 'A' ? 'bg-[#e9f5f0] text-[#137c69]' : 'bg-[#fff4df] text-[#93661e]'
              }`}>
                גרסה {camp.version}
              </span>
              <span className="text-xs text-[#718087]">המרה: {Math.round((camp.conversions_count / camp.clicks_count) * 100)}%</span>
            </div>
            <h3 className="font-bold text-sm text-[#172b35] mb-1">{camp.name}</h3>
            <p className="text-xs text-[#718087] line-clamp-1">{camp.subject}</p>

            <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-[#f0f3f4] text-center text-[11px]">
              <div>
                <span className="text-[#718087] block">נשלחו</span>
                <span className="font-bold text-[#172b35] tabular-nums">{camp.sent_count}</span>
              </div>
              <div>
                <span className="text-[#718087] block">נפתחו</span>
                <span className="font-bold text-[#172b35] tabular-nums">{camp.opened_count}</span>
              </div>
              <div>
                <span className="text-[#718087] block">קליקים</span>
                <span className="font-bold text-[#137c69] tabular-nums">{camp.clicks_count}</span>
              </div>
              <div>
                <span className="text-[#718087] block">המרות (מתנה)</span>
                <span className="font-bold text-[#6d5ce7] tabular-nums">{camp.conversions_count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Active Campaign Detail & Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Email Preview Mockup */}
        <div className="lg:col-span-7 bg-white border border-[#e3e8eb] rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e3e8eb] pb-4 mb-4">
            <div>
              <span className="text-xs font-bold text-[#137c69] block">תצוגה מקדימה של המייל</span>
              <h3 className="font-bold text-sm text-[#172b35] mt-0.5">{activeCamp.subject}</h3>
            </div>
            <button
              onClick={() => handleCopyEmail(activeCamp)}
              className="bg-[#fafbfc] hover:bg-[#e9f5f0] text-[#137c69] border border-[#e3e8eb] px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              {copiedId === activeCamp.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId === activeCamp.id ? 'הועתק!' : 'העתק נוסח מייל'}</span>
            </button>
          </div>

          <div className="bg-[#fafbfc] border border-[#e3e8eb] rounded-2xl p-6 text-xs text-[#172033] leading-relaxed whitespace-pre-line font-sans">
            {activeCamp.body_text}
          </div>

          <div className="mt-4 pt-3 flex justify-center">
            <button
              onClick={() => showToast('בלחיצה במייל הלקוח מועבר לדף הנחיתה שיוצר חיוג מיידי!')}
              className="bg-[#137c69] hover:bg-[#0f6656] text-white px-6 py-2.5 rounded-xl text-xs font-extrabold shadow-sm transition"
            >
              {activeCamp.cta_label}
            </button>
          </div>
        </div>

        {/* Sales & Intake Call Sandbox */}
        <div className="lg:col-span-5 bg-white border border-[#e3e8eb] rounded-3xl p-6 shadow-sm space-y-5">
          <div>
            <span className="text-xs font-bold text-[#137c69] block mb-1">בדיקת שיחת מכירה ואינטייק</span>
            <h3 className="font-bold text-base text-[#172b35]">חיוג אינטייק יזום מבוט שוכי</h3>
            <p className="text-xs text-[#718087] mt-1">
              כשמתקבל ליד מטופס המתנה, מנוע ה-PBX מחייג אליו תוך שניות, מברך אותו, בודק רמה ראשונית ומפעיל את חבילת ה-20 דקות.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-bold text-[#718087] block mb-1">שם הליד לבדיקה:</label>
              <input
                type="text"
                value={intakeName}
                onChange={e => setIntakeName(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs"
              />
            </div>

            <div>
              <label className="font-bold text-[#718087] block mb-1">מספר טלפון לקבלת השיחה:</label>
              <input
                type="tel"
                dir="ltr"
                value={intakePhone}
                onChange={e => setIntakePhone(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-xs text-right"
              />
            </div>

            <button
              onClick={handleTriggerIntakeCall}
              disabled={isIntakeCalling}
              className="w-full bg-[#102d32] hover:bg-[#1a454d] text-white py-3 rounded-xl font-bold text-xs shadow-sm transition flex items-center justify-center gap-2"
            >
              <PhoneCall className="w-4 h-4" />
              <span>{isIntakeCalling ? 'מחייג כעת...' : 'בצע שיחת אינטייק נסיונית למספר'}</span>
            </button>
          </div>

          <div className="p-3.5 bg-[#eff4f3] rounded-xl border border-[#d2e4de] text-xs text-[#137c69] space-y-1">
            <strong>עלות שיחת האינטייק (20 דק׳ מתנה):</strong>
            <p className="text-[11px] text-[#4d6765]">
              סה״כ ₪3.60 בלבד למשתמש. עם שיעור המרה של 8%-10% למסלול בתשלום (₪220+), שיטת שוכי מייצרת החזר השקעה עצום.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
