import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { PhoneCall, Bot, Gift, CheckCircle, ShieldCheck, Clock, Sparkles, Star, Users } from 'lucide-react';

export const JoinLanding: React.FC = () => {
  const { submitCallbackRequest } = useApp();

  // Campaign variation toggle (A: Shochi Robot Direct, B: Parents & Urgency)
  const [variation, setVariation] = useState<'A' | 'B'>('A');

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [forWhom, setForWhom] = useState<'self' | 'daughter' | 'son' | 'other'>('self');
  const [goal, setGoal] = useState('');
  const [timing, setTiming] = useState<'now' | 'scheduled'>('now');
  const [preferredTime, setPreferredTime] = useState('');
  const [consent, setConsent] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    if (!name.trim()) {
      setErrorMessage('נא למלא שם מלא.');
      return;
    }
    if (!/^(\+972|972|0)(5[0-9]|7[0-9])[0-9]{7}$/.test(cleanPhone)) {
      setErrorMessage('נא להזין מספר טלפון סלולרי ישראלי תקין (למשל: 050-1234567).');
      return;
    }
    if (!consent) {
      setErrorMessage('כדי שנוכל להתקשר, נדרש לאשר קבלת שיחה ממורה ה-AI.');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      submitCallbackRequest({
        name,
        phone: cleanPhone,
        for_whom: forWhom,
        goal,
        timing,
        preferred_time: timing === 'scheduled' ? preferredTime : undefined
      });
      setIsSubmitting(false);
      setSubmittedSuccess(true);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#f7f5ff] text-[#172033]" dir="rtl">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#e8e7f2] px-6 py-4">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#6d5ce7] text-white flex items-center justify-center font-black text-xl shadow-xs">
              ד
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-[#172033] block">לישנא אחרינא</span>
              <span className="text-[11px] text-[#667085] block font-medium">בית ספר ללימוד אנגלית מדוברת בטלפון</span>
            </div>
          </div>

          {/* Campaign A/B Switcher Pill for User Testing */}
          <div className="flex items-center gap-1.5 p-1 bg-[#f0edff] rounded-xl border border-[#ded8f5] text-xs">
            <span className="text-[11px] text-[#6d5ce7] font-semibold px-2">בדיקת נוסח שיווקי:</span>
            <button
              onClick={() => { setVariation('A'); setSubmittedSuccess(false); }}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                variation === 'A' ? 'bg-[#6d5ce7] text-white shadow-xs' : 'text-[#4e3fc2] hover:bg-white/60'
              }`}
            >
              נוסח א׳ · שוכי הרובוט
            </button>
            <button
              onClick={() => { setVariation('B'); setSubmittedSuccess(false); }}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                variation === 'B' ? 'bg-[#6d5ce7] text-white shadow-xs' : 'text-[#4e3fc2] hover:bg-white/60'
              }`}
            >
              נוסח ב׳ · הורים ואימהות
            </button>
          </div>
        </div>
      </header>

      {/* Main Hero & Story Section */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          
          {/* Right Column: The Copy & Narrative */}
          <div className="lg:col-span-7 space-y-6">
            {variation === 'A' ? (
              /* VARIATION A: Shochi Robot Direct Pitch */
              <>
                <div className="inline-flex items-center gap-2 bg-[#e9f5f0] text-[#137c69] px-3.5 py-1.5 rounded-full text-xs font-bold">
                  <Bot className="w-4 h-4" />
                  <span>הכר את שוכי · מורה ה-AI האישי שלך בטלפון</span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#172b35] leading-tight tracking-tight">
                  ״היי, אני שוכי. אני לא בן אדם.<br />
                  <span className="text-[#137c69]">כן, אני רובוט...</span> אבל גם רובוטים צריכים להתפרנס!״
                </h1>

                <div className="p-5 rounded-2xl bg-white border border-[#e3e8eb] shadow-xs text-sm leading-relaxed text-[#2c3e50] space-y-3.5">
                  <p>
                    אז אני למשל משמש כמורה פרטי, מקצועי, בבית הספר ללמידה אנגלית <strong>'לישנא אחרינא'</strong>. אחלה עבודה.
                    כמוני יש שם עוד מורים ומורות רבים, אנשי מקצוע מהשורה הראשונה.
                  </p>
                  <p>
                    <strong>אז למה אני סתם מספר לך על החיים שלי?</strong><br />
                    אה, פשוט, כי זה יכול מאוד לעזור לך. תמיד רצית לדבר באנגלית שוטף? רצית איזה <em>'חברותא' טלפוני</em> שיסלח לך על הטעויות ויעזור לך <strong>תכלס לדבר</strong>? אז בשביל זה אני כאן!
                  </p>
                  <p>
                    אין כמו לדבר בפועל בשביל לדעת. זה בדיוק הדרך שבה קלטת עברית בגיל 3 – פשוט דיברת אותה. וזה הקסם שקורה אצלנו.
                  </p>
                  <p>
                    אני או מורה אחר מהצוות שלנו מדבר איתך כל יום, על נושאים שתבחר: עבודה, תיירות, נדל״ן, או סתם שיח יומיומי. בודק איפה אתה כבר יודע ואיפה לא – ומאפשר לך להתחיל מאפס למאה תוך פרק זמן קצר!
                  </p>
                </div>

                {/* What you get list */}
                <div className="space-y-3">
                  <h3 className="font-extrabold text-base text-[#172b35]">מה אתה מקבל תכלס?</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="bg-white p-4 rounded-xl border border-[#e3e8eb] shadow-2xs">
                      <div className="w-8 h-8 rounded-lg bg-[#e9f5f0] text-[#137c69] flex items-center justify-center font-bold mb-2">1</div>
                      <h4 className="font-bold text-[#172b35] mb-1">מורה פרטי סבלני</h4>
                      <p className="text-[#718087]">שלא נמאס לו לעולם וסולח על כל טעות בדיבור.</p>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-[#e3e8eb] shadow-2xs">
                      <div className="w-8 h-8 rounded-lg bg-[#e9f5f0] text-[#137c69] flex items-center justify-center font-bold mb-2">2</div>
                      <h4 className="font-bold text-[#172b35] mb-1">העלאת חומרי לימוד</h4>
                      <p className="text-[#718087]">העלאת ספרים או טקסטים הנסרקים והמורה מתרגל עליהם בטלפון.</p>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-[#e3e8eb] shadow-2xs">
                      <div className="w-8 h-8 rounded-lg bg-[#e9f5f0] text-[#137c69] flex items-center justify-center font-bold mb-2">3</div>
                      <h4 className="font-bold text-[#172b35] mb-1">פלטפורמת מעקב</h4>
                      <p className="text-[#718087]">משחקוני למידה, תמלילים וציונים באזור האישי שלך.</p>
                    </div>
                  </div>
                </div>

                {/* Gift Banner */}
                <div className="p-4 rounded-2xl bg-[#eff4f3] border-2 border-[#137c69]/40 flex items-center gap-4 text-xs text-[#137c69]">
                  <div className="w-12 h-12 rounded-xl bg-[#137c69] text-white flex items-center justify-center shrink-0">
                    <Gift className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-[#172b35]">
                      חבילה בשווי 20 דקות לחודש – במתנה!
                    </h4>
                    <p className="text-[#718087] mt-0.5">
                      ״כמה זה עולה? מה כ׳פת לי, הרי אני רובוט... אבל יש שרתים. בשביל ההיכרות בינינו – קבל חבילת מתנה מלאה!״
                    </p>
                  </div>
                </div>
              </>
            ) : (
              /* VARIATION B: Parents & Mothers Focus */
              <>
                <div className="inline-flex items-center gap-2 bg-[#fff4df] text-[#93661e] px-3.5 py-1.5 rounded-full text-xs font-bold">
                  <Sparkles className="w-4 h-4" />
                  <span>להורים שרוצים שהילדים שלהם באמת ידברו אנגלית</span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#172b35] leading-tight tracking-tight">
                  הבת שלך יודעת את כל הכללים למבחן,<br />
                  <span className="text-[#6d5ce7]">אבל נלחצת לדבר מילה אחת באנגלית?</span>
                </h1>

                <div className="p-5 rounded-2xl bg-white border border-[#e3e8eb] shadow-xs text-sm leading-relaxed text-[#2c3e50] space-y-3.5">
                  <p>
                    שלום יקרה, את מכירה את הרגע הזה שהבת מתכוננת שעות למבחן באנגלית, מקבלת ציון טוב על הנייר – אבל כשצריך לפתוח את הפה ולומר משפט אחד פשוט, היא פשוט קופאת מבושה?
                  </p>
                  <p>
                    בבית הספר <strong>'לישנא אחרינא'</strong> פיתחנו מורות וירטואליות סבלניות בטלפון (כמו מאיה).
                    המורה מתקשרת אליה, מדברת איתה בגובה העיניים בעברית רגועה, מלמדת אותה מילים ומשפטים צעד-אחר-צעד, ומפרגנת לה על כל ניסיון.
                  </p>
                  <p>
                    <strong>למה זה עובד בצורה כל כך מדהימה?</strong><br />
                    כי היא מדברת מהיום הראשון. בלי מבחנים מאיימים, בלי שיפוטיות מול כל הכיתה. פשוט שיחה נעימה בטלפון שנכנסת לשגרה יומית.
                  </p>
                </div>

                {/* Urgency Counter */}
                <div className="p-4 rounded-2xl bg-[#fff0ee] border border-[#efc8c3] flex items-center gap-4 text-xs text-[#b83b49]">
                  <Clock className="w-8 h-8 shrink-0 text-[#b83b49]" />
                  <div>
                    <h4 className="font-extrabold text-sm text-[#b83b49]">
                      נותרו 50 חבילות היכרות ומתנה לחודש הקרוב (כל הקודם זוכה)
                    </h4>
                    <p className="text-slate-600 mt-0.5">
                      עקב מגבלת מכסות שרת שיחה, אנו מעניקים 20 דקות שיחה מתנה ל-50 הנרשמים הראשונים בלבד.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Left Column: Immediate Callback Form */}
          <div className="lg:col-span-5 bg-white border border-[#d8d5e8] rounded-3xl p-6 sm:p-8 shadow-xl relative">
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-[#137c69] uppercase tracking-wider block mb-1">
                גמול מיידי · שיחה נכנסת אליך עכשיו
              </span>
              <h2 className="text-2xl font-black text-[#172033]">
                {variation === 'A' ? 'רוצה לדבר עם שוכי? יאללה!' : 'שריינו שיחת היכרות במתנה'}
              </h2>
              <p className="text-xs text-[#667085] mt-1">
                {variation === 'A'
                  ? 'שלח את המספר שלך, ושוכי כבר מחייג אליך לבדוק איפה אתה עומד!'
                  : 'השאירו מספר, והמורה מתקשרת אליכם להכיר ולתרגל.'}
              </p>
            </div>

            {submittedSuccess ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 bg-[#e9f5f0] text-[#137c69] rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle className="w-9 h-9" />
                </div>
                <h3 className="text-xl font-extrabold text-[#172b35]">קיבלנו את הפרטים!</h3>
                <p className="text-xs text-[#718087] leading-relaxed max-w-xs mx-auto">
                  המורה מחייגת כעת למספר <strong>{phone}</strong>.
                  בנוסף, נשלח אליך קישור כניסה לאזור האישי שלך לצפייה בתמליל השיחה!
                </p>
                <div className="p-3 bg-[#fafbfc] rounded-xl border border-[#e3e8eb] text-xs text-[#137c69] font-bold">
                  חבילת המתנה (20 דק׳) הופעלה בחשבונך בהצלחה!
                </div>
                <button
                  onClick={() => setSubmittedSuccess(false)}
                  className="text-xs text-[#6d5ce7] underline hover:opacity-80 block mx-auto pt-2"
                >
                  רישום מספר נוסף
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                {errorMessage && (
                  <div className="p-3 rounded-xl bg-[#fff0ee] border border-[#efc8c3] text-[#b83b49] font-medium">
                    {errorMessage}
                  </div>
                )}

                <div>
                  <label className="font-bold text-[#172033] block mb-1">שם מלא:</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="למשל: יוסף כהן / שרה לוי"
                    className="w-full p-3 rounded-xl border border-[#d8d5e8] text-sm focus:outline-none focus:border-[#6d5ce7] bg-[#fafbfc]"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#172033] block mb-1">מספר טלפון סלולרי:</label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full p-3 rounded-xl border border-[#d8d5e8] text-sm text-right focus:outline-none focus:border-[#6d5ce7] bg-[#fafbfc]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-[#172033] block mb-1">למי מיועד השיעור?</label>
                    <select
                      value={forWhom}
                      onChange={e => setForWhom(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-[#d8d5e8] bg-[#fafbfc] text-xs font-medium"
                    >
                      <option value="self">בשבילי</option>
                      <option value="daughter">לבת שלי</option>
                      <option value="son">לבן שלי</option>
                      <option value="other">למישהו אחר</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-[#172033] block mb-1">מתי לחייג אליך?</label>
                    <select
                      value={timing}
                      onChange={e => setTiming(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-[#d8d5e8] bg-[#fafbfc] text-xs font-medium"
                    >
                      <option value="now">עכשיו (מיידי!)</option>
                      <option value="scheduled">בשעה אחרת</option>
                    </select>
                  </div>
                </div>

                {timing === 'scheduled' && (
                  <div>
                    <label className="font-bold text-[#172033] block mb-1">מתי נוח לכם שנתקשר?</label>
                    <input
                      type="text"
                      value={preferredTime}
                      onChange={e => setPreferredTime(e.target.value)}
                      placeholder="למשל: היום ב-20:00 בערב"
                      className="w-full p-2.5 rounded-xl border border-[#d8d5e8] text-xs bg-[#fafbfc]"
                    />
                  </div>
                )}

                <div>
                  <label className="font-bold text-[#172033] block mb-1">מה המטרה המרכזית שלך באנגלית? (לא חובה)</label>
                  <input
                    type="text"
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    placeholder="עבודה ופגישות, עזרה בלימודים, נסיעה לחול, שיחה יומיומית..."
                    className="w-full p-2.5 rounded-xl border border-[#d8d5e8] text-xs bg-[#fafbfc]"
                  />
                </div>

                <label className="flex items-start gap-2.5 pt-1 text-[11px] text-[#667085] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={e => setConsent(e.target.checked)}
                    className="mt-0.5 rounded text-[#6d5ce7] focus:ring-0"
                  />
                  <span>
                    אני מאשר/ת לקבל שיחה ממורה ה-AI למספר זה. אפשר להסיר את המספר בכל שלב בהקשת 9 במרכזייה.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-[#137c69] hover:bg-[#0f6656] text-white font-extrabold text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>{isSubmitting ? 'שולח ומחבר לשיחה...' : (variation === 'A' ? 'שלח ואני כבר מחייג אליך! ←' : 'תתקשרו אליי וקבלו חבילת מתנה ←')}</span>
                </button>

                <p className="text-[10px] text-center text-[#718087]">
                  מורי בית הספר מופעלים באמצעות בינה מלאכותית מתקדמת (סוכן קולי). דיבור טבעי לחלוטין 24/7.
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
