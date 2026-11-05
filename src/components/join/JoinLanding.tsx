import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { PhoneCall, Bot, Gift, CheckCircle, Volume2, Sparkles, ArrowLeft } from 'lucide-react';

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
    }, 500);
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100" dir="rtl">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-6 py-4">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-xl shadow-md">
              ד
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-slate-100 block">לישנא אחרינא</span>
              <span className="text-[11px] text-slate-400 block font-medium">בית ספר ללימוד אנגלית מדוברת בטלפון ובמחשב</span>
            </div>
          </div>

          {/* Campaign A/B Switcher Pill */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
            <span className="text-[11px] text-slate-400 font-semibold px-2">נוסח פנייה:</span>
            <button
              onClick={() => { setVariation('A'); setSubmittedSuccess(false); }}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                variation === 'A' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              נוסח א׳ · שוכי הרובוט
            </button>
            <button
              onClick={() => { setVariation('B'); setSubmittedSuccess(false); }}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                variation === 'B' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
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
          
          {/* Right Column: Narrative Copy */}
          <div className="lg:col-span-7 space-y-6">
            {variation === 'A' ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3.5 py-1.5 rounded-full text-xs font-bold font-mono">
                    <Bot className="w-4 h-4" />
                    <span>שוכי · מורה ה-AI האישי שלך בטלפון ובמחשב</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-emerald-400 border border-slate-800 rounded-full text-xs font-mono">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>קו טלפוני 076-567-3575 · שלוחה 99</span>
                  </div>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-100 leading-tight tracking-tight">
                  ״היי, אני שוכי. אני לא בן אדם.<br />
                  <span className="text-emerald-400">כן, אני רובוט...</span> אבל גם רובוטים צריכים להתפרנס!״
                </h1>

                {/* Interactive Live Shochi Voice Tester Widget */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          if ('speechSynthesis' in window) {
                            window.speechSynthesis.cancel();
                            const u = new SpeechSynthesisUtterance("Hey there! Yes, it's me, Shochi your personal robot teacher. Hear how natural and clear I sound? Start your free gift lesson right now!");
                            u.lang = 'en-US';
                            u.rate = 1.0;
                            window.speechSynthesis.speak(u);
                          }
                        } catch (e) {}
                      }}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center gap-2 transition shadow-md shrink-0 cursor-pointer active:scale-95"
                    >
                      <Volume2 className="w-4 h-4 text-emerald-100" />
                      <span>השמע דגימת קול של שוכי</span>
                    </button>
                    <div>
                      <div className="font-extrabold text-xs text-slate-200">דגימת דיבור מקומית בדפדפן</div>
                      <div className="text-[11px] text-slate-400">איכות שמע ודיבור מבוסס AI לקראת שיחת הטלפון או המחשב</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-4 w-1 bg-emerald-400 rounded-full animate-pulse"></span>
                    <span className="h-6 w-1 bg-emerald-500 rounded-full animate-pulse delay-75"></span>
                    <span className="h-3 w-1 bg-emerald-300 rounded-full animate-pulse delay-150"></span>
                    <span className="h-7 w-1 bg-emerald-400 rounded-full animate-pulse delay-100"></span>
                    <span className="h-4 w-1 bg-emerald-500 rounded-full animate-pulse delay-200"></span>
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl text-sm leading-relaxed text-slate-300 space-y-3.5">
                  <p>
                    אני משמש כמורה פרטי, סבלני ומקצועי, בבית הספר ללמידה אנגלית <strong>'לישנא אחרינא'</strong>.
                    כמוני יש שם עוד מורים ומורות וירטואליים מהשורה הראשונה.
                  </p>
                  <p>
                    <strong>אז למה אני מספר לך על זה?</strong><br />
                    פשוט כי זה הפתרון הכי פרקטי שיש. תמיד רצית לדבר באנגלית שוטף? רצית <em>'חברותא' קולי</em> שלא שופט אותך, סולח על כל טעות ועוזר לך <strong>תכלס לפתוח את הפה</strong>? בשביל זה אני כאן!
                  </p>
                  <p>
                    אין כמו לדבר בפועל כדי לדעת. זו בדיוק הדרך שבה קלטת שפת אם כשהיית ילד – פשוט דיברת.
                  </p>
                  <p>
                    אני מדבר איתך כל יום על נושאים שתבחר: עבודה, תיירות, נדל״ן, או שיחה יומיומית חופשית. בודק איפה אתה עומד – ובונה איתך ביטחון אמיתי!
                  </p>
                </div>

                {/* Practical Value Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold mb-2">1</div>
                    <h4 className="font-bold text-slate-100 mb-1">מורה פרטי סבלני</h4>
                    <p className="text-slate-400">זמין 24/7, לעולם לא נמאס לו וסולח על כל שיבוש בדיבור.</p>
                  </div>

                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold mb-2">2</div>
                    <h4 className="font-bold text-slate-100 mb-1">העלאת חומרי לימוד</h4>
                    <p className="text-slate-400">העלאת ספרים, מסמכים או רשימות מילים הנסרקים והמורה מתרגל עליהם בטלפון.</p>
                  </div>

                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold mb-2">3</div>
                    <h4 className="font-bold text-slate-100 mb-1">מעקב פדגוגי</h4>
                    <p className="text-slate-400">משחקוני חיזוק של 60 שניות, תמלילים וציונים באזור האישי שלך.</p>
                  </div>
                </div>

                {/* Gift Banner */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/30 flex items-center gap-4 text-xs text-slate-200">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Gift className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-emerald-400">
                      20 דקות שיעור ראשונות במתנה מלאה
                    </h4>
                    <p className="text-slate-400 mt-0.5">
                      התנסות טלפונית וממוחשבת ישירה ללא שום עלות וללא צורך בהזנת כרטיס אשראי.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 px-3.5 py-1.5 rounded-full text-xs font-bold font-mono">
                  <Sparkles className="w-4 h-4" />
                  <span>להורים שרוצים שהילדים שלהם באמת ידברו אנגלית</span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-100 leading-tight tracking-tight">
                  הילד שלך יודע את כל הכללים למבחן,<br />
                  <span className="text-emerald-400">אבל נלחץ לדבר מילה אחת באנגלית?</span>
                </h1>

                <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl text-sm leading-relaxed text-slate-300 space-y-3.5">
                  <p>
                    אתם מכירים את הרגע שמתכוננים שעות למבחן באנגלית, מקבלים ציון טוב על הנייר – אבל כשצריך לפתוח את הפה ולומר משפט אחד פשוט, פשוט קופאים מבושה?
                  </p>
                  <p>
                    בבית הספר <strong>'לישנא אחרינא'</strong> פיתחנו מורים וירטואליים סבלניים בטלפון ובמחשב.
                    המורה מדבר בגובה העיניים, מלמד מילים ומשפטים צעד-אחר-צעד, ומפרגן על כל ניסיון.
                  </p>
                  <p>
                    <strong>למה זה עובד?</strong> כי מדברים מהיום הראשון. בלי מבחנים מאיימים, בלי שיפוטיות מול כל הכיתה. פשוט שיחה נעימה בטלפון שנכנסת לשגרה יומית.
                  </p>
                </div>

                {/* Benefit Box */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/30 flex items-center gap-4 text-xs">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
                    <Gift className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-100">
                      20 דקות שיעור ראשונות במתנה מלאה
                    </h4>
                    <p className="text-slate-400 mt-0.5">
                      שיחת היכרות ישירה ללא התחייבות.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Left Column: Interactive Form & Immediate Native Call */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative">
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block mb-1 font-mono">
                שיעור התנסות מיידי במתנה
              </span>
              <h2 className="text-2xl font-black text-slate-100">
                {variation === 'A' ? 'רוצה לדבר עם שוכי? יאללה!' : 'שריינו שיחת היכרות במתנה'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                השאירו פרטים, ומיד תקבלו גישה ישירה לשיחה מהמחשב או חייגו לקו הטלפון.
              </p>
            </div>

            {submittedSuccess ? (
              <div className="text-center py-6 space-y-5">
                <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle className="w-9 h-9" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-slate-100">הרישום הושלם בהצלחה!</h3>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto mt-1">
                    שלום <strong>{name}</strong>, חבילת המתנה (20 דק׳) הופעלה עבור המספר <strong>{phone}</strong>.
                  </p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                  <a
                    href="#learn"
                    className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-sm shadow-xl flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>התחל שיחה קולית ראשונה עכשיו מהמחשב! 🚀</span>
                  </a>

                  <div className="text-xs text-slate-400 pt-1">
                    או חייגו כעת מכל טלפון: <strong className="text-emerald-400 font-mono text-sm">076-567-3575 #99</strong>
                  </div>
                </div>

                <button
                  onClick={() => setSubmittedSuccess(false)}
                  className="text-xs text-slate-500 hover:text-slate-300 underline block mx-auto pt-2 cursor-pointer"
                >
                  רישום מספר נוסף
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                {errorMessage && (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 font-medium">
                    {errorMessage}
                  </div>
                )}

                <div>
                  <label className="font-bold text-slate-300 block mb-1">שם מלא:</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="למשל: יוסף כהן / שרה לוי"
                    className="w-full p-3 rounded-xl border border-slate-800 text-sm focus:outline-none focus:border-emerald-500 bg-slate-950 text-slate-100"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-300 block mb-1">מספר טלפון סלולרי:</label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full p-3 rounded-xl border border-slate-800 text-sm text-right focus:outline-none focus:border-emerald-500 bg-slate-950 text-slate-100 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-slate-300 block mb-1">למי מיועד השיעור?</label>
                    <select
                      value={forWhom}
                      onChange={e => setForWhom(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-200"
                    >
                      <option value="self">בשבילי</option>
                      <option value="daughter">לבת שלי</option>
                      <option value="son">לבן שלי</option>
                      <option value="other">למישהו אחר</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-slate-300 block mb-1">מתי לחייג אליך?</label>
                    <select
                      value={timing}
                      onChange={e => setTiming(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-200"
                    >
                      <option value="now">עכשיו (מיידי!)</option>
                      <option value="scheduled">בשעה אחרת</option>
                    </select>
                  </div>
                </div>

                {timing === 'scheduled' && (
                  <div>
                    <label className="font-bold text-slate-300 block mb-1">מתי נוח לכם שנתקשר?</label>
                    <input
                      type="text"
                      value={preferredTime}
                      onChange={e => setPreferredTime(e.target.value)}
                      placeholder="למשל: היום ב-20:00 בערב"
                      className="w-full p-2.5 rounded-xl border border-slate-800 text-xs bg-slate-950 text-slate-100"
                    />
                  </div>
                )}

                <div>
                  <label className="font-bold text-slate-300 block mb-1">נושא מועדף לתרגול:</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      { label: '💼 ראיון עבודה בהייטק', val: 'הכנה לראיון עבודה באנגלית' },
                      { label: '✈️ שדות תעופה ומלונות', val: 'אנגלית לחו״ל, טיסות ומלונות' },
                      { label: '🏢 עסקאות ונדל״ן', val: 'אנגלית עסקית, מכירות ונדל״ן' },
                      { label: '💬 שיחה יומיומית שוטפת', val: 'ביטחון עצמי ושיחה שוטפת' },
                    ].map(chip => (
                      <button
                        key={chip.val}
                        type="button"
                        onClick={() => setGoal(chip.val)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                          goal === chip.val
                            ? 'bg-emerald-600 text-white border-emerald-500 font-bold'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    placeholder="עבודה ופגישות, עזרה בלימודים, נסיעה לחו״ל..."
                    className="w-full p-2.5 rounded-xl border border-slate-800 text-xs bg-slate-950 text-slate-100"
                  />
                </div>

                <label className="flex items-start gap-2.5 pt-1 text-[11px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={e => setConsent(e.target.checked)}
                    className="mt-0.5 rounded text-emerald-500 focus:ring-0 bg-slate-950 border-slate-700"
                  />
                  <span>
                    אני מאשר/ת קבלת שיחה ממורה ה-AI למספר זה. ניתן להסיר את המספר בכל שלב.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-xl shadow-emerald-950/40 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>{isSubmitting ? 'מעבד...' : (variation === 'A' ? 'קבל חבילת מתנה והתחל שיחה! ←' : 'שריון שיחת היכרות במתנה ←')}</span>
                </button>

                <p className="text-[10px] text-center text-slate-500">
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
