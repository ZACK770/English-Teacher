import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, MessageCircle, Phone, RefreshCw, Sparkles } from "lucide-react";
import { Account, portalRequest } from "./portalApi";
import { dayKey, type PracticeReport, type PracticeSession } from "./practiceStats";
import { PracticeCalendar, PracticeJourney } from "./PracticeJourney";
import { practiceDateLabel, shiftDay } from "./practiceCalendar";
import "./practice-dashboard.css";

const accountLevel = (account: Account) => {
  const active = account.teachers.find(t => t.id === account.preferences.active_teacher);
  const bot = active?.base_bot || account.preferences.selected_bot || account.customer.preferred_bot;
  return active?.level || account.preferences.level || account.preferences.plan?.level || (bot === "isaac-advanced" ? "fluent" : "beginner");
};

function usePractice(token: string, progress: Account["progress"]) {
  const [report, setReport] = useState<PracticeReport | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void portalRequest<PracticeReport>("/v1/portal/practice", token, undefined, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setReport(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [token, progress, retry]);
  return { report, error, retry: () => setRetry(n => n + 1) };
}

function LoadState({ error, retry }: { error: boolean; retry: () => void }) {
  return <div className="pd-load" role="status">{error ? <>טעינת הנתונים התעכבה. <button className="sk-link" onClick={retry}>לנסות שוב</button></> : "טוענים את רגעי התרגול שלך…"}</div>;
}

function Journey({ account, onStart }: { account: Account; onStart?: () => void }) {
  const data = account.daily_practice;
  // Missing data is not a zero-day streak. This also handles rolling deploys.
  if (!data) return <div className="pd-card pd-load" role="status">נתוני ההתמדה עדיין לא זמינים. אפשר לרענן את החשבון בעוד רגע.</div>;
  return <PracticeJourney streak={data.current_streak} best={data.best_streak} practicedToday={data.today.practiced} weeklyDone={data.week.done} weeklyGoal={data.package && data.week.target > 0 ? data.week.target : null} packageName={data.package?.name || null} level={accountLevel(account)} onStart={onStart} />;
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
  return <details className="pd-session"><summary><span className="pd-session-icon"><MessageCircle size={20} aria-hidden="true" /></span><span><strong>{session.summary_he || "עוד צעד באנגלית שלך"}</strong><small>{new Date(session.started_at).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
    <div className="pd-session-body"><div className="pd-session-notes"><div><span>מה לקחת מהשיחה</span><p>{session.success_he || "כל שיחה באנגלית היא צעד בדרך."}</p></div><div><span>לשיחה הבאה</span><p>{session.next_step_he || "עוד שיחה קצרה, בקצב שלך."}</p></div></div>
      {transcript === undefined ? <button className="sk-secondary" disabled={busy} onClick={() => void load()}>{busy ? "טוענים את התמלול…" : error ? "לנסות שוב לטעון תמלול" : "לפתוח את תמלול השיחה"}<ArrowLeft size={16} /></button> : transcript?.length ? <div className="sk-transcript">{transcript.map((line, i) => <p key={i}><strong>{line.role === "learner" ? "אני" : "המורה"}</strong><span dir="auto">{line.text}</span></p>)}</div> : <p className="pd-muted">לא נשמר תמלול לשיחה הזאת. לשמירת השיחות הבאות אפשר להפעיל שמירת שיחות בהעדפות.</p>}
      {error && <p role="alert">התמלול לא נטען כרגע. אפשר לנסות שוב.</p>}
    </div>
  </details>;
}

export function PracticeDashboard({ account, token, onGoal, onStart, onRefresh }: { account: Account; token: string; onGoal: () => void; onStart: () => void; onRefresh: () => Promise<void> }) {
  const { report, error, retry } = usePractice(token, account.progress);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = account.daily_practice;
  const today = data?.today.day;
  const selectedDay = selected || today;
  const chosen = report?.sessions.filter(s => dayKey(new Date(s.started_at)) === selectedDay) || [];
  const practiced = selectedDay ? data?.dates.includes(selectedDay) : false;
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  return <section className="pd-dashboard">
    <div className="pj-toolbar"><span><Phone size={15} aria-hidden="true" />התרגול בטלפון ובאתר נפגש כאן</span><button className="sk-link" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" />{refreshing ? "מתעדכן…" : "לרענן נתונים"}</button></div>
    <Journey account={account} onStart={onStart} />
    {data && today && selectedDay && <PracticeCalendar today={today} dates={data.dates} since={shiftDay(today, -119)} selected={selectedDay} onSelect={setSelected} />}
    {selectedDay && <section className="pd-card pd-day-detail" aria-label="השיחות ביום הנבחר"><div className="pd-section-heading"><div><span className="pd-kicker">הסיפור מאחורי היום בלוח</span><h2>{practiceDateLabel(selectedDay)}</h2></div>{practiced && <span className="pd-pill"><Check size={14} aria-hidden="true" /> יום תרגול הושלם</span>}</div>
      {error ? <LoadState error retry={retry} /> : !report ? <LoadState error={false} retry={retry} /> : chosen.length ? <>{!practiced && <p className="pj-caption">השיחות כבר כאן. עוד קצת תרגול, והיום ייספר גם ברצף וביעד השבועי.</p>}{chosen.map(session => <SessionDetails key={session.call_id} session={session} token={token} />)}</> : <div className="pd-empty"><Sparkles aria-hidden="true" /><h3>{practiced ? "יום תרגול נוסף בדרך שלך." : "יש מקום לשיחה הבאה שלך."}</h3><p>{practiced ? "יום התרגול שמור. פרטי השיחה יופיעו כשהסיכום יהיה מוכן." : "גם שיחה קטנה יכולה לפתוח דרך חדשה."}</p>{selectedDay === today && <button className="sk-secondary" onClick={onStart}>מתחילים לדבר<ArrowLeft size={16} /></button>}</div>}
    </section>}
    <div className="pj-footnote"><p>כל יום נספר פעם אחת, גם אם היו כמה שיחות. הרצף מתעדכן אחרי סיום השיחה.</p><button className="sk-link" onClick={onGoal}>לשנות את כיוון הלמידה<ArrowLeft size={14} /></button></div>
  </section>;
}

export function HomeDashboard({ account, children, onProgress, onGoal }: { account: Account; token: string; teacherName: string; children: React.ReactNode; onProgress: () => void; onGoal: () => void }) {
  const lastLesson = account.progress.sessions[0];
  return <div className="pd-home">
    <section className="pd-home-welcome"><span className="pd-kicker"><span className="sk-status-dot" />המקום שלך לדבר אנגלית</span><h2>משיחה לשיחה, <em>הביטחון גדל.</em></h2><p>כל תרגול מצטבר. מכאן ממשיכים, בקצב שלך.</p>{children}</section>
    <Journey account={account} />
    <div className="pd-home-bottom"><section className="pd-card pd-next"><span className="pd-kicker">הדרך שכבר עשית</span><h2>{account.progress.session_count.toLocaleString("he-IL")} שיחות באנגלית</h2><p>הרצף, ימי התרגול והיעד השבועי — הכול במקום אחד, גם אחרי שיחה בטלפון.</p><button className="sk-link" onClick={onProgress}>לכל ההתקדמות שלי<ArrowLeft size={16} /></button></section>
      <section className="pd-card pd-next"><span className="pd-kicker">לוקחים איתנו הלאה</span><span className="pd-next-symbol"><Sparkles size={30} aria-hidden="true" /></span><h2>{lastLesson ? "כבר יש על מה לבנות." : "ההתחלה שלך כאן."}</h2><p>{lastLesson?.success_he || "לא צריך אנגלית מושלמת כדי להתחיל. רק משפט אחד, ושיחה בגובה העיניים."}</p>{lastLesson?.next_step_he && <div className="pd-next-step"><span>הצעד הבא שלך</span><p>{lastLesson.next_step_he}</p></div>}<button className="sk-link" onClick={onGoal}>לכיוון הלמידה שלי<ArrowLeft size={16} /></button></section>
    </div>
  </div>;
}
