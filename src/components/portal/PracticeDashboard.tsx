import { useEffect, useId, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Clock3, MessageCircle, Sparkles, Target, Trophy } from "lucide-react";
import { Account, portalRequest, remainingMinutes } from "./portalApi";
import { dayKey, minutesLabel, practiceDays, type PracticeReport, type PracticeSession } from "./practiceStats";
import "./practice-dashboard.css";

const fullDate = (date: Date | string) => new Date(date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" });
const goalMinutes = (account: Account) => account.preferences.minutes || account.preferences.plan?.minutes || 10;

function usePractice(token: string) {
  const [report, setReport] = useState<PracticeReport | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError(false);
    void portalRequest<PracticeReport>("/v1/portal/practice", token, undefined, undefined, controller.signal)
      .then(setReport).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [token, retry]);
  return { report, error, retry: () => setRetry(n => n + 1) };
}

function LoadState({ error, retry }: { error: boolean; retry: () => void }) {
  return <div className="pd-load" role="status">{error ? <>הנתונים שמורים, הטעינה התעכבה. <button className="sk-link" onClick={retry}>לנסות שוב</button></> : "טוענים את רגעי התרגול שלך…"}</div>;
}

function Timeline({ sessions, days, goal, selected, onSelect, compact = false }: { sessions: PracticeSession[]; days: number; goal: number; selected?: string; onSelect?: (key: string) => void; compact?: boolean }) {
  const data = practiceDays(sessions, days);
  const scale = Math.max(goal * 60, ...data.map(d => d.seconds)) * 1.15;
  const captionId = useId();
  const ticks = [scale, scale / 2, 0];
  return <figure className={"pd-timeline " + (compact ? "is-compact" : "")} aria-labelledby={captionId}>
    <figcaption id={captionId} className="pd-chart-caption"><span>דקות תרגול ביום</span><div className="pd-legend"><span><i className="pd-key-goal" />יעד יומי · {goal} דקות</span><span><i />תרגול בפועל</span></div></figcaption>
    <div className="pd-chart-scroll"><div className="pd-chart" style={{ minWidth: days > 14 ? 720 : days > 7 ? 450 : undefined }}>
      <div className="pd-axis" aria-hidden="true">{ticks.map((tick, i) => <span key={i}>{Math.round(tick / 60)}</span>)}</div>
      <div className="pd-columns" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
        <div className="pd-goal-band" style={{ height: `${goal * 60 / scale * 100}%` }} aria-hidden="true" />
        {data.map(day => {
          const content = <><span className="pd-bar" style={{ height: day.seconds > 0 ? `max(3px, ${day.seconds / scale * 100}%)` : 0 }} />{day.seconds > 0 && <span className="pd-bar-value" style={{ bottom: `${day.seconds / scale * 100}%` }}>{minutesLabel(day.seconds)}</span>}<span className="pd-day-label">{day.date.toLocaleDateString("he-IL", { timeZone: "UTC", day: "numeric", month: "numeric" })}</span></>;
          const label = fullDate(day.date) + ": " + minutesLabel(day.seconds) + " דקות תרגול; יעד " + goal + " דקות";
          return onSelect ? <button key={day.key} className={"pd-column " + (selected === day.key ? "is-selected" : "")} aria-label={label} aria-pressed={selected === day.key} onClick={() => onSelect(day.key)}>{content}</button> : <div key={day.key} className="pd-column" role="img" aria-label={label}>{content}</div>;
        })}
      </div>
    </div></div>
  </figure>;
}

function SessionDetails({ session, token }: { session: PracticeSession; token: string }) {
  const [transcript, setTranscript] = useState<{ role: string; text: string }[] | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = async () => {
    setBusy(true); setError(false);
    try { const result = await portalRequest<{ transcript: { role: string; text: string }[] | null }>("/v1/portal/sessions/" + encodeURIComponent(session.call_id) + "/transcript", token); setTranscript(result.transcript); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <details className="pd-session"><summary><span className="pd-session-icon"><MessageCircle size={20} /></span><span><strong>{session.summary_he || "עוד צעד באנגלית שלך"}</strong><small>{new Date(session.started_at).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })} · {minutesLabel(session.duration_seconds)} דקות</small></span><ChevronDown size={19} /></summary>
    <div className="pd-session-body"><div className="pd-session-notes"><div><span>מה לקחת מהשיחה</span><p>{session.success_he || "פינית זמן לדבר באנגלית. זה הבסיס להתקדמות."}</p></div><div><span>לשיחה הבאה</span><p>{session.next_step_he || "עוד שיחה קצרה, בקצב שלך."}</p></div></div>
      {transcript === undefined ? <button className="sk-secondary" disabled={busy} onClick={() => void load()}>{busy ? "טוענים את התמלול…" : error ? "לנסות שוב לטעון תמלול" : "לפתוח את תמלול האימון"}<ArrowLeft size={16} /></button> : transcript?.length ? <div className="sk-transcript">{transcript.map((line, i) => <p key={i}><strong>{line.role === "learner" ? "אני" : "המורה"}</strong><span dir="auto">{line.text}</span></p>)}</div> : <p className="pd-muted">לא נשמר תמלול לאימון הזה. לשמירת האימונים הבאים אפשר להפעיל שמירת שיחות בהעדפות.</p>}
      {error && <p role="alert">התמלול לא נטען כרגע. אפשר לנסות שוב.</p>}
    </div>
  </details>;
}

export function PracticeDashboard({ account, token, onGoal, onStart }: { account: Account; token: string; onGoal: () => void; onStart: () => void }) {
  const { report, error, retry } = usePractice(token);
  const [range, setRange] = useState(14);
  const [selected, setSelected] = useState<string | null>(null);
  const goal = goalMinutes(account);
  const days = practiceDays(report?.sessions || [], range);
  const sessions = days.flatMap(d => d.sessions);
  const seconds = days.reduce((sum, d) => sum + d.seconds, 0);
  const activeDays = days.filter(d => d.seconds > 0).length;
  const selectedKey = selected && days.some(d => d.key === selected) ? selected : [...days].reverse().find(d => d.sessions.length)?.key || dayKey(new Date());
  const chosen = days.find(d => d.key === selectedKey)!;
  return <section className="pd-dashboard">
    <div className="pd-stats"><div><Clock3 /><strong>{report ? minutesLabel(seconds) : "—"}</strong><span>דקות של אנגלית</span></div><div><MessageCircle /><strong>{report ? sessions.length : "—"}</strong><span>אימונים בתקופה</span></div><div><Sparkles /><strong>{report ? activeDays : "—"}</strong><span>ימים עם תרגול</span></div></div>
    <section className="pd-card"><div className="pd-section-heading"><div><span className="pd-kicker">כל שיחה מצטברת</span><h2>הקצב שלך, על ציר הזמן.</h2></div><div className="pd-ranges" role="group" aria-label="טווח ציר הזמן">{[7, 14, 30].map(n => <button key={n} aria-pressed={range === n} className={range === n ? "is-active" : ""} onClick={() => { setRange(n); setSelected(null); }}>{n} ימים</button>)}</div></div>
      {report ? <Timeline sessions={report.sessions} days={range} goal={goal} selected={selectedKey} onSelect={setSelected} /> : <LoadState error={error} retry={retry} />}
      <div className="pd-chart-foot"><span><Target size={16} />השטח המוצל הוא יעד יומי לפי משך האימון שבחרת, לא אימונים שנקבעו.</span><button className="sk-link" onClick={onGoal}>לשנות יעד<ArrowLeft size={14} /></button></div>
    </section>
    {report && <section className="pd-card pd-day-detail" aria-label="אימוני היום הנבחר"><div className="pd-section-heading"><div><span className="pd-kicker">לחיצה על יום מציגה את האימונים שלו</span><h2>{fullDate(chosen.date)}</h2></div><span className="pd-pill">{minutesLabel(chosen.seconds)} דקות תרגול</span></div>{chosen.sessions.length ? chosen.sessions.map(session => <SessionDetails key={session.call_id} session={session} token={token} />) : <div className="pd-empty"><Sparkles /><h3>יש מקום לשיחה הבאה שלך.</h3><p>גם כמה דקות של אנגלית הן צעד קדימה.</p><button className="sk-secondary" onClick={onStart}>מתחילים לדבר<ArrowLeft size={16} /></button></div>}</section>}
  </section>;
}

export function HomeDashboard({ account, token, teacherName, children, onProgress, onGoal }: { account: Account; token: string; teacherName: string; children: React.ReactNode; onProgress: () => void; onGoal: () => void }) {
  const { report, error, retry } = usePractice(token);
  const days = practiceDays(report?.sessions || [], 7);
  const seconds = days.reduce((sum, d) => sum + d.seconds, 0);
  const activeDays = days.filter(d => d.seconds > 0).length;
  const goal = goalMinutes(account);
  const todaySeconds = days.at(-1)!.seconds;
  const goalMet = todaySeconds >= goal * 60;
  const lastLesson = account.progress.sessions[0];
  return <div className="pd-home">
    <section className="pd-home-hero"><div className="pd-home-copy"><span className="pd-kicker"><span className="sk-status-dot" />המקום שלך לדבר אנגלית</span><h2>משיחה לשיחה,<br /><em>הביטחון גדל.</em></h2><p>{teacherName} מחכה לשיחה הבאה שלך.<br />כמה דקות, בקצב שלך. מכאן ממשיכים.</p>{children}</div><div className="pd-daily"><div className="pd-ring" style={{ background: `conic-gradient(var(--accent) ${report ? Math.min(100, todaySeconds / (goal * 60) * 100) : 0}%, #34453a 0)` }}><div><span>{goalMet ? <Check size={22} /> : <Target size={22} />}<strong>{report ? minutesLabel(todaySeconds) : "—"}</strong><span>דקות היום</span></div></div><strong>{goalMet ? "הגעת ליעד. כל הכבוד!" : "עוד קצת אנגלית ביום שלך"}</strong><button className="sk-link" onClick={onGoal}>היעד היומי שלך: {goal} דקות<ArrowLeft size={14} /></button></div></section>
    <div className="pd-stats pd-home-stats"><div><Clock3 /><strong>{account.progress.total_minutes.toLocaleString("he-IL")}</strong><span>דקות שדיברת עד היום</span></div><div><MessageCircle /><strong>{account.progress.session_count.toLocaleString("he-IL")}</strong><span>שיחות שמקדמות אותך</span></div><div><Trophy /><strong>{remainingMinutes(account).toLocaleString("he-IL")}</strong><span>דקות זמינות בחבילה</span></div></div>
    <div className="pd-home-bottom"><section className="pd-card"><div className="pd-section-heading"><div><span className="pd-kicker">שבעת הימים האחרונים</span><h2>זמן לאנגלית שלך.</h2></div><button className="pd-round-link" aria-label="לכל ההתקדמות" onClick={onProgress}><ArrowLeft /></button></div>{report ? <><div className="pd-week-total"><strong>{minutesLabel(seconds)}</strong><span>דקות תרגול<br />ב־{activeDays} ימים</span></div><Timeline sessions={report.sessions} days={7} goal={goal} compact onSelect={onProgress} /></> : <LoadState error={error} retry={retry} />}</section>
      <section className="pd-card pd-next"><span className="pd-kicker">לוקחים איתנו הלאה</span><span className="pd-next-symbol"><Sparkles size={30} /></span><h2>{lastLesson ? "כבר יש על מה לבנות." : "ההתחלה שלך כאן."}</h2><p>{lastLesson?.success_he || "לא צריך אנגלית מושלמת כדי להתחיל. רק משפט אחד, ומורה שמקשיב."}</p>{lastLesson?.next_step_he && <div className="pd-next-step"><span>הצעד הבא שלך</span><p>{lastLesson.next_step_he}</p></div>}<button className="sk-link" onClick={onProgress}>לדרך שכבר עשית<ArrowLeft size={16} /></button></section>
    </div>
  </div>;
}
