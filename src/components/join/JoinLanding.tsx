import React, { useState } from 'react';
import { submitCallback } from './callbackApi';
import { LegalFooter } from '../legal/LegalFooter';
import { PhoneCall, Gift, CheckCircle, Volume2, Sparkles, ArrowLeft } from 'lucide-react';

import { TeacherMark } from "../portal/LineTeacher";
import { INITIAL_CONTROLS } from '../../store/initialData';
import "./join.css";

const SHOW_SCHEDULED_CALLBACK = true;
const scheduleWindow = 30 * 86400000;
const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const JoinLanding: React.FC = () => {
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
  const now = new Date();

  const handleSubmit = async (e: React.FormEvent) => {
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

    const callbackTiming = SHOW_SCHEDULED_CALLBACK ? timing : 'now';
    const preferredAt = callbackTiming === 'scheduled' ? new Date(preferredTime) : null;
    if (preferredAt && preferredAt.getTime() > Date.now() + scheduleWindow) {
      setErrorMessage('אפשר לתאם שיחה עד 30 יום מראש');
      return;
    }
    setIsSubmitting(true);
    try {
      if (preferredAt && (!Number.isFinite(preferredAt.getTime()) || preferredAt.getTime() < Date.now())) {
        throw new Error('invalid schedule');
      }
      const readableTime = preferredAt?.toLocaleString('he-IL') ?? '';
      await submitCallback({
        name,
        phone: cleanPhone,
        for_whom: forWhom,
        goal,
        timing: callbackTiming,
        preferred_time: readableTime,
        preferred_at: preferredAt?.toISOString(),
        consent: true
      });
      setSubmittedSuccess(true);
    } catch {
      setErrorMessage('לא הצלחנו לשמור את הבקשה. בדקו את מועד השיחה ונסו שוב.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="join-pulse min-h-screen bg-[var(--paper)] text-[var(--ink)]" dir="rtl">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Campaign A/B Switcher Pill */}
        <div role="group" aria-label="נוסח פנייה" className="inline-flex flex-wrap items-center gap-1.5 p-1 bg-[var(--paper)] rounded-xl border border-[var(--line)] text-xs">
          <span className="text-[11px] text-[var(--quiet)] font-semibold px-2">נוסח פנייה:</span>
          <button
            onClick={() => { setVariation('A'); setSubmittedSuccess(false); }}
            aria-pressed={variation === 'A'}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              variation === 'A' ? 'bg-[var(--accent)] text-[var(--paper)] shadow-xs' : 'text-[var(--quiet)] hover:text-[var(--ink)]'
            }`}
          >
            נוסח א׳ · שוכי הרובוט
          </button>
          <button
            onClick={() => { setVariation('B'); setSubmittedSuccess(false); }}
            aria-pressed={variation === 'B'}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
              variation === 'B' ? 'bg-[var(--accent)] text-[var(--paper)] shadow-xs' : 'text-[var(--quiet)] hover:text-[var(--ink)]'
            }`}
          >
            נוסח ב׳ · הורים ואימהות
          </button>
        </div>
      </div>

      {/* Main Hero & Story Section */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          
          {/* Right Column: Narrative Copy */}
          <div className="lg:col-span-7 space-y-6">
            {variation === 'A' ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 bg-[var(--sage)] border border-[var(--line)] text-[var(--accent)] px-3.5 py-1.5 rounded-full text-xs font-bold font-mono">
                    <TeacherMark className="line-teacher-badge" teacher={{ name: "Shochi", voice: INITIAL_CONTROLS['shochi-robot'].voice }} />
                    <span>שוכי · מורה ה-AI האישי שלך בטלפון ובמחשב</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--card)] text-[var(--accent)] border border-[var(--line)] rounded-full text-xs font-mono">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse"></span>
                    <span>קו טלפוני 076-567-3575 · ללמידה הקישו 1</span>
                  </div>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[var(--ink)] leading-tight tracking-tight">
                  ״היי, אני שוכי. אני לא בן אדם.<br />
                  <span className="text-[var(--accent)]">כן, אני רובוט...</span> אבל גם רובוטים צריכים להתפרנס!״
                </h1>

                {/* Interactive Live Shochi Voice Tester Widget */}
                <div className="p-4 rounded-2xl bg-[var(--card)] border border-[var(--line)] text-[var(--ink)] shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
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
                      className="px-4 py-2.5 bg-[var(--accent)] hover:bg-[#8fd14f] text-[var(--paper)] rounded-xl font-bold text-xs flex items-center gap-2 transition shadow-md shrink-0 cursor-pointer active:scale-95"
                    >
                      <Volume2 className="w-4 h-4 text-[var(--paper)]" />
                      <span>השמע דגימת קול של שוכי</span>
                    </button>
                    <div>
                      <div className="font-extrabold text-xs text-[var(--ink)]">דגימת דיבור מקומית בדפדפן</div>
                      <div className="text-[11px] text-[var(--quiet)]">איכות שמע ודיבור מבוסס AI לקראת שיחת הטלפון או המחשב</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-4 w-1 bg-[var(--accent)] rounded-full animate-pulse"></span>
                    <span className="h-6 w-1 bg-[var(--accent)] rounded-full animate-pulse delay-75"></span>
                    <span className="h-3 w-1 bg-[var(--accent)] rounded-full animate-pulse delay-150"></span>
                    <span className="h-7 w-1 bg-[var(--accent)] rounded-full animate-pulse delay-100"></span>
                    <span className="h-4 w-1 bg-[var(--accent)] rounded-full animate-pulse delay-200"></span>
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-[var(--card)] border border-[var(--line)] shadow-xl text-sm leading-relaxed text-[var(--quiet)] space-y-3.5">
                  <p>
                    אני משמש כמורה פרטי, סבלני ומקצועי, בבית הספר ללמידה אנגלית <strong>ספיקול</strong>.
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
                  <div className="bg-[var(--card)] p-4 rounded-xl border border-[var(--line)]">
                    <div className="w-8 h-8 rounded-lg bg-[var(--sage)] text-[var(--accent)] flex items-center justify-center font-bold mb-2">1</div>
                    <h4 className="font-bold text-[var(--ink)] mb-1">מורה פרטי סבלני</h4>
                    <p className="text-[var(--quiet)]">זמין 24/7, לעולם לא נמאס לו וסולח על כל שיבוש בדיבור.</p>
                  </div>

                  <div className="bg-[var(--card)] p-4 rounded-xl border border-[var(--line)]">
                    <div className="w-8 h-8 rounded-lg bg-[var(--sage)] text-[var(--accent)] flex items-center justify-center font-bold mb-2">2</div>
                    <h4 className="font-bold text-[var(--ink)] mb-1">העלאת חומרי לימוד</h4>
                    <p className="text-[var(--quiet)]">העלאת ספרים, מסמכים או רשימות מילים הנסרקים והמורה מתרגל עליהם בטלפון.</p>
                  </div>

                  <div className="bg-[var(--card)] p-4 rounded-xl border border-[var(--line)]">
                    <div className="w-8 h-8 rounded-lg bg-[var(--sage)] text-[var(--accent)] flex items-center justify-center font-bold mb-2">3</div>
                    <h4 className="font-bold text-[var(--ink)] mb-1">מעקב פדגוגי</h4>
                    <p className="text-[var(--quiet)]">משחקוני חיזוק של 60 שניות, תמלילים וציונים באזור האישי שלך.</p>
                  </div>
                </div>

                {/* Gift Banner */}
                <div className="p-4 rounded-2xl bg-[var(--card)] border border-[var(--line)] flex items-center gap-4 text-xs text-[var(--ink)]">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)] text-[var(--paper)] flex items-center justify-center shrink-0">
                    <Gift className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-[var(--accent)]">
                      שיעור פתיחה חד־פעמי של 10 דקות, ולאחריו 2 שיחות של עד 5 דקות בחודש
                    </h4>
                    <p className="text-[var(--quiet)] mt-0.5">
                      התנסות טלפונית וממוחשבת ישירה ללא שום עלות וללא צורך בהזנת כרטיס אשראי.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="inline-flex items-center gap-2 bg-[var(--sage)] border border-[var(--line)] text-[var(--accent)] px-3.5 py-1.5 rounded-full text-xs font-bold font-mono">
                  <Sparkles className="w-4 h-4" />
                  <span>להורים שרוצים שהילדים שלהם באמת ידברו אנגלית</span>
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[var(--ink)] leading-tight tracking-tight">
                  הילד שלך יודע את כל הכללים למבחן,<br />
                  <span className="text-[var(--accent)]">אבל נלחץ לדבר מילה אחת באנגלית?</span>
                </h1>

                <div className="p-6 rounded-2xl bg-[var(--card)] border border-[var(--line)] shadow-xl text-sm leading-relaxed text-[var(--quiet)] space-y-3.5">
                  <p>
                    אתם מכירים את הרגע שמתכוננים שעות למבחן באנגלית, מקבלים ציון טוב על הנייר – אבל כשצריך לפתוח את הפה ולומר משפט אחד פשוט, פשוט קופאים מבושה?
                  </p>
                  <p>
                    בבית הספר <strong>ספיקול</strong> פיתחנו מורים וירטואליים סבלניים בטלפון ובמחשב.
                    המורה מדבר בגובה העיניים, מלמד מילים ומשפטים צעד-אחר-צעד, ומפרגן על כל ניסיון.
                  </p>
                  <p>
                    <strong>למה זה עובד?</strong> כי מדברים מהיום הראשון. בלי מבחנים מאיימים, בלי שיפוטיות מול כל הכיתה. פשוט שיחה נעימה בטלפון שנכנסת לשגרה יומית.
                  </p>
                </div>

                {/* Benefit Box */}
                <div className="p-4 rounded-2xl bg-[var(--card)] border border-[var(--line)] flex items-center gap-4 text-xs">
                  <div className="w-10 h-10 rounded-xl bg-[var(--sage)] border border-[var(--line)] text-[var(--accent)] flex items-center justify-center shrink-0">
                    <Gift className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-[var(--ink)]">
                      שיעור פתיחה חד־פעמי של 10 דקות, ולאחריו 2 שיחות של עד 5 דקות בחודש
                    </h4>
                    <p className="text-[var(--quiet)] mt-0.5">
                      שיחת היכרות ישירה ללא התחייבות.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Left Column: Interactive Form & Immediate Native Call */}
          <div className="lg:col-span-5 bg-[var(--card)] border border-[var(--line)] rounded-3xl p-6 sm:p-8 shadow-2xl relative">
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider block mb-1 font-mono">
                שיעור התנסות מיידי במתנה
              </span>
              <h2 className="text-2xl font-black text-[var(--ink)]">
                {variation === 'A' ? 'רוצה לדבר עם שוכי? יאללה!' : 'שריינו שיחת היכרות במתנה'}
              </h2>
              <p className="text-xs text-[var(--quiet)] mt-1">
                השאירו פרטים, ומיד תקבלו גישה ישירה לשיחה מהמחשב או חייגו לקו הטלפון.
              </p>
            </div>

            {submittedSuccess ? (
              <div className="text-center py-6 space-y-5">
                <div className="w-16 h-16 bg-[var(--sage)] border border-[var(--line)] text-[var(--accent)] rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle className="w-9 h-9" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-[var(--ink)]">הרישום הושלם בהצלחה!</h3>
                  <p className="text-xs text-[var(--quiet)] leading-relaxed max-w-xs mx-auto mt-1">
                    שלום <strong>{name}</strong>, בקשת ההצטרפות נשלחה עבור המספר <strong>{phone}</strong>. ההתנסות כוללת שיעור פתיחה חד־פעמי של 10 דקות, ולאחריו 2 שיחות של עד 5 דקות בחודש.
                  </p>
                </div>

                <div className="p-4 bg-[var(--paper)] rounded-2xl border border-[var(--line)] space-y-3">
                  <a
                    href="#learn"
                    className="w-full py-3.5 px-4 bg-[var(--accent)] hover:bg-[#8fd14f] text-[var(--paper)] rounded-xl font-black text-sm shadow-xl flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>התחל שיחה קולית ראשונה עכשיו מהמחשב! 🚀</span>
                  </a>

                  <div className="text-xs text-[var(--quiet)] pt-1">
                    או חייגו כעת מכל טלפון: <strong className="text-[var(--accent)] font-mono text-sm">076-567-3575</strong> וללמידה הקישו 1
                  </div>
                </div>

                <button
                  onClick={() => setSubmittedSuccess(false)}
                  className="text-xs text-[var(--quiet)] hover:text-[var(--quiet)] underline block mx-auto pt-2 cursor-pointer"
                >
                  רישום מספר נוסף
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                {errorMessage && (
                  <div role="alert" className="p-3 rounded-xl bg-[#48282d] border border-[#ffb3b8]/40 text-[#ffb3b8] font-medium">
                    {errorMessage}
                  </div>
                )}

                <div>
                  <label className="font-bold text-[var(--quiet)] block mb-1">שם מלא:</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="למשל: יוסף כהן / שרה לוי"
                    className="w-full p-3 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] bg-[var(--paper)] text-[var(--ink)]"
                  />
                </div>

                <div>
                  <label className="font-bold text-[var(--quiet)] block mb-1">מספר טלפון סלולרי:</label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full p-3 rounded-xl border border-[var(--line)] text-sm text-right focus:outline-none focus:border-[var(--accent)] bg-[var(--paper)] text-[var(--ink)] font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-[var(--quiet)] block mb-1">למי מיועד השיעור?</label>
                    <select
                      value={forWhom}
                      onChange={e => setForWhom(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-[var(--line)] bg-[var(--paper)] text-xs text-[var(--ink)]"
                    >
                      <option value="self">בשבילי</option>
                      <option value="daughter">לבת שלי</option>
                      <option value="son">לבן שלי</option>
                      <option value="other">למישהו אחר</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-[var(--quiet)] block mb-1">מתי לחייג אליך?</label>
                    <select
                      value={timing}
                      onChange={e => setTiming(e.target.value as any)}
                      className="w-full p-2.5 rounded-xl border border-[var(--line)] bg-[var(--paper)] text-xs text-[var(--ink)]"
                    >
                      <option value="now">עכשיו (מיידי!)</option>
                      {SHOW_SCHEDULED_CALLBACK && <option value="scheduled">בשעה אחרת</option>}
                    </select>
                  </div>
                </div>

                {SHOW_SCHEDULED_CALLBACK && timing === 'scheduled' && (
                  <div>
                    <label className="font-bold text-[var(--quiet)] block mb-1">מתי נוח לכם שנתקשר?</label>
                    <input
                      type="datetime-local"
                      required
                      min={localDateTime(now)}
                      max={localDateTime(new Date(now.getTime() + scheduleWindow))}
                      value={preferredTime}
                      onChange={e => {
                        e.target.setCustomValidity('');
                        setPreferredTime(e.target.value);
                      }}
                      onInvalid={e => {
                        if (e.currentTarget.validity.rangeOverflow) {
                          e.currentTarget.setCustomValidity('אפשר לתאם שיחה עד 30 יום מראש');
                        }
                      }}
                      className="w-full p-2.5 rounded-xl border border-[var(--line)] text-xs bg-[var(--paper)] text-[var(--ink)]"
                    />
                    <p className="text-[var(--quiet)] mt-1">נחייג בין 08:00 ל-22:00, לא בשבת</p>
                  </div>
                )}

                <div>
                  <label className="font-bold text-[var(--quiet)] block mb-1">נושא מועדף לתרגול:</label>
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
                            ? 'bg-[var(--accent)] text-[var(--paper)] border-[var(--accent)] font-bold'
                            : 'bg-[var(--paper)] text-[var(--quiet)] border-[var(--line)] hover:bg-[var(--sage)]'
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
                    className="w-full p-2.5 rounded-xl border border-[var(--line)] text-xs bg-[var(--paper)] text-[var(--ink)]"
                  />
                </div>

                <label className="flex items-start gap-2.5 pt-1 text-[11px] text-[var(--quiet)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={e => setConsent(e.target.checked)}
                    className="mt-0.5 rounded text-[var(--accent)] focus:ring-0 bg-[var(--paper)] border-[var(--line)]"
                  />
                  <span>
                    אני מאשר/ת קבלת שיחה ממורה ה-AI למספר זה. ניתן להסיר את המספר בכל שלב.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-2xl bg-[var(--accent)] hover:bg-[#8fd14f] text-[var(--paper)] font-extrabold text-sm shadow-xl shadow-[#070d0d]/40 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>{isSubmitting ? 'מעבד...' : (variation === 'A' ? 'קבל חבילת מתנה והתחל שיחה! ←' : 'שריון שיחת היכרות במתנה ←')}</span>
                </button>

                <p className="text-[10px] text-center text-[var(--quiet)]">
                  מורי בית הספר מופעלים באמצעות בינה מלאכותית מתקדמת (סוכן קולי). דיבור טבעי לחלוטין 24/7.
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
};
