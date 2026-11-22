import { useId, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Flame, Phone, Sparkles, Target, Trophy } from "lucide-react";
import { calendarDate, monthDays, practiceDateLabel, shiftDay, shiftMonth } from "./practiceCalendar";
import "./practice-journey.css";

export function PracticeJourney({ streak, best, practicedToday, weeklyDone, weeklyGoal, packageName, level, onStart }: {
  streak: number; best: number; practicedToday: boolean; weeklyDone: number; weeklyGoal: number | null;
  packageName: string | null; level: string; onStart?: () => void;
}) {
  const titleId = useId();
  const complete = weeklyGoal !== null && weeklyDone >= weeklyGoal;
  return <section className="pj-journey" aria-labelledby={titleId}>
    <div className="pj-streak">
      <div className={"pj-flame " + (streak ? "is-lit" : "")} aria-hidden="true"><Flame strokeWidth={1.7} /></div>
      <div className="pj-streak-copy"><span className="pj-eyebrow">כל יום של תרגול נחשב</span><h2 id={titleId}><strong>{streak}</strong> {streak === 1 ? "יום ברצף" : "ימים ברצף"}</h2><p>{practicedToday ? "התרגול של היום כבר כאן. כל הכבוד!" : streak ? "הרצף ממשיך — יש עוד הזדמנות לתרגל היום." : "שיחה אחת, והדרך שלך מתחילה מחדש."}</p>
        <span className="pj-record"><Trophy size={15} aria-hidden="true" />השיא שלך: {best} {best === 1 ? "יום" : "ימים"}</span>
      </div>
      {onStart && <button className="sk-primary" onClick={onStart}>{practicedToday ? "לעוד שיחה" : "לתרגול של היום"}<ArrowLeft size={17} /></button>}
    </div>
    <div className="pj-overview">
      <section className={"pj-week " + (complete ? "is-complete" : "")} aria-label="היעד השבועי">
        <div className="pj-card-heading"><span className="pj-icon"><Target size={22} aria-hidden="true" /></span><div><span className="pj-eyebrow">{packageName ? "חבילת " + packageName : "התרגול שלך"}</span><h3>היעד השבועי</h3></div>{complete && <span className="pj-success"><Check size={15} />היעד הושלם</span>}</div>
        {weeklyGoal === null ? <><p className="pj-no-goal">{weeklyDone} ימי תרגול השבוע</p><p className="pj-caption">יעד התרגול יופיע כאן כשיש חבילה פעילה.</p></> : <><div className="pj-week-number"><strong>{weeklyDone}</strong><span>מתוך {weeklyGoal} ימי תרגול</span></div><div className="pj-goal-steps" role="progressbar" aria-label="ימי תרגול השבוע" aria-valuemin={0} aria-valuemax={weeklyGoal} aria-valuenow={Math.min(weeklyDone, weeklyGoal)} aria-valuetext={`${weeklyDone} מתוך ${weeklyGoal} ימי תרגול השבוע`}>{Array.from({ length: weeklyGoal }, (_, i) => <span key={i} className={i < weeklyDone ? "is-done" : ""} aria-hidden="true">{i < weeklyDone ? <Check size={17} strokeWidth={3} /> : i + 1}</span>)}</div><p className="pj-caption">{complete ? "כל שיחה נוספת היא עוד צעד קדימה." : `עוד ${weeklyGoal - weeklyDone} ${weeklyGoal - weeklyDone === 1 ? "יום תרגול להשלמת היעד" : "ימי תרגול להשלמת היעד"}`} · ראשון–שבת</p></>}
      </section>
      <section className="pj-level" aria-label="רמת האנגלית"><div className="pj-card-heading"><span className="pj-icon"><Sparkles size={22} aria-hidden="true" /></span><div><span className="pj-eyebrow">באותו קצב, באתר ובטלפון</span><h3>רמת האנגלית שלך</h3></div></div><strong className="pj-level-name">{({ beginner: "צעדים ראשונים", intermediate: "ביטחון בשיחה", fluent: "שיחה מתקדמת" } as Record<string, string>)[level] || "עדיין לא נבחרה רמה"}</strong><div className="pj-level-steps" aria-hidden="true">{["beginner", "intermediate", "fluent"].map((value, index) => <span key={value} className={index <= ["beginner", "intermediate", "fluent"].indexOf(level) ? "is-reached" : ""} />)}</div><p className="pj-caption">זו הרמה שנבחרה לשיחות, לא ציון או מבחן. שינוי בשיחה עם המורה מתעדכן גם כאן.</p></section>
    </div>
  </section>;
}

export function PracticeCalendar({ today, dates, since, selected, onSelect }: {
  today: string; dates: string[]; since: string; selected: string; onSelect: (key: string) => void;
}) {
  const [chosenMonth, setChosenMonth] = useState(today.slice(0, 7));
  const earliestMonth = since.slice(0, 7);
  const latestMonth = today.slice(0, 7);
  const month = chosenMonth < earliestMonth || chosenMonth > latestMonth ? latestMonth : chosenMonth;
  const { offset, days } = monthDays(month);
  const completed = new Set(dates);
  const titleId = useId();
  return <section className="pj-calendar" aria-labelledby={titleId}>
    <div className="pj-calendar-heading"><div><span className="pj-eyebrow">רואים את ההתמדה שלך</span><h2 id={titleId}>כל יום הוא צעד.</h2></div><div className="pj-month-nav"><button aria-label="לחודש הקודם" disabled={month <= earliestMonth} onClick={() => setChosenMonth(shiftMonth(month, -1))}><ChevronRight size={20} /></button><span aria-live="polite">{calendarDate(month + "-01").toLocaleDateString("he-IL", { month: "long", year: "numeric", timeZone: "UTC" })}</span><button aria-label="לחודש הבא" disabled={month >= latestMonth} onClick={() => setChosenMonth(shiftMonth(month, 1))}><ChevronLeft size={20} /></button></div></div>
    <div className="pj-weekdays" aria-hidden="true">{["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="pj-calendar-grid" role="group" aria-label="ימי החודש">{Array.from({ length: offset }, (_, i) => <span key={"pad-" + i} />)}{days.map(key => {
      const practiced = completed.has(key);
      const future = key > today;
      const unavailable = key < since;
      return <button key={key} className={["pj-day", practiced ? "is-practiced" : "", key === today ? "is-today" : "", practiced && completed.has(shiftDay(key, -1)) ? "has-previous" : "", practiced && completed.has(shiftDay(key, 1)) ? "has-next" : ""].join(" ")} disabled={future || unavailable} aria-current={key === today ? "date" : undefined} aria-pressed={selected === key} aria-label={`${practiceDateLabel(key)}${key === today ? ", היום" : ""}: ${future ? "בהמשך" : unavailable ? "מחוץ לטווח הנתונים" : practiced ? "יום תרגול הושלם" : "ללא יום תרגול"}`} onClick={() => onSelect(key)}><span>{Number(key.slice(-2))}</span>{practiced && <Check size={12} strokeWidth={3} aria-hidden="true" />}</button>;
    })}</div>
    <div className="pj-calendar-legend"><span><i className="is-practiced" />יום תרגול</span><span><i className="is-today" />היום</span><span><i />ללא תרגול</span></div>
    <p className="pj-caption pj-sync"><Phone size={14} aria-hidden="true" />אותם ימי תרגול בטלפון ובאתר · לפי שעון ישראל</p>
  </section>;
}
