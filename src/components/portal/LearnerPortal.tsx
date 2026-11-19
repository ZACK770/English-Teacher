import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpLeft, AudioLines, BookOpen, Check, ChevronDown, Clock3, History, LogOut, Mic, MoreHorizontal, Phone, Plus, Settings2, Sprout, Trash2, Trophy, Upload, Users, X } from "lucide-react";
import { Billing, Checkout } from "./Checkout";
import { Account, futureMinutes, initialToken, Lesson, LessonSettings, Material, Plan, portalRequest, PortalError, Preferences, practiceDays, remainingMinutes, Teacher, topics, tracks } from "./portalApi";
import { VoiceRoom } from "./VoiceRoom";
import { EntryForm, QuickEntry, type EntryChannel } from "./QuickEntry";
import { legalBasePath } from "../../legalRoutes";
import { clearLearnerToken, saveLearnerToken } from "./learnerToken";
import { LearningProgress } from "./LearningProgress";
import { SpeakCallLogo } from "../brand/SpeakCallLogo";
import { ConversationArt } from "./ConversationArt";
import { SubscriptionPanel } from "./SubscriptionPanel";
import { LessonSettingsFields, levelNames, loadNames, modeNames, correctionPolicies, grammarNames } from "./LessonSettingsFields";
import { isFemale, TeacherMark } from "./LineTeacher";
export { TeacherMark } from "./LineTeacher";
import "./portal.css";
import "./logo-breathing.css";

type Page = "home" | "teachers" | "materials" | "history" | "achievements" | "settings" | "intake" | "plan" | "checkout";
const paceNames: Record<string, string> = { slow: "לאט ובנחת", normal: "בקצב טבעי", fast: "אפשר להגביר" };
const personalities: Record<string, string> = { warm: "חם ומעודד", focused: "ישר לעניין", playful: "עם חיוך" };
const DEFAULT_NAME = "דוד";
const FEMALE_NAME = "אסתי";
const voices = [{ value: "Aoede", label: "רך ובהיר" }, { value: "Puck", label: "קליל וחם" }, { value: "Charon", label: "עמוק ורגוע" }];
const lessonDate = (s: string) => new Date(s).toLocaleDateString("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });

function IconButton({ label, children, onClick, active = false }: { label: string; children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return <button type="button" className={"sk-icon " + (active ? "is-active" : "")} aria-label={label} aria-pressed={active} title={label} onClick={onClick}>{children}<span className="sk-tooltip">{label}</span></button>;
}
function Brand({ onClick, collapse = false }: { onClick: () => void; collapse?: boolean }) {
  return <button className="sk-brand" dir="ltr" onClick={onClick} aria-label="ספיקול — למסך הבית"><SpeakCallLogo collapse={collapse} /></button>;
}
function Modal({ title, children, onClose, error, busy }: { title: string; children: React.ReactNode; onClose: () => void; error?: string; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="sk-modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="sk-modal-top"><h2>{title}</h2><IconButton label="סגירה" onClick={onClose}><X /></IconButton></div>{error && <p className="sk-error" role="alert">{error}</p>}<fieldset className="sk-content-fieldset" disabled={busy}>{children}</fieldset></dialog>;
}
function Options({ values, value, onChange }: { values: Record<string, string>; value?: string; onChange: (v: string) => void }) {
  return <div className="sk-options">{Object.entries(values).map(([key, label]) => <button key={key} type="button" className={"sk-choice " + (key === value ? "is-selected" : "")} aria-pressed={key === value} onClick={() => onChange(key)}><span>{label}</span>{key === value ? <Check size={17} /> : <ArrowUpLeft size={16} />}</button>)}</div>;
}
const nextWords = (topic?: string) => topic && topic !== "recommended" && topics[topic] ? "בשיחה הבאה: מילים מעולם " + topics[topic] : "בשיחה הבאה: מילים שנבחרות לפי הרמה, המטרה וההתקדמות שלך";
function TopicPicker({ value, onChange, recommended = ["recommended", "everyday", "travel", "business"] }: { value?: string; onChange: (v: string) => void; recommended?: string[] }) {
  return <><Options value={value} values={Object.fromEntries(recommended.map(k => [k, topics[k]]))} onChange={onChange} /><details className="sk-more"><summary>יש לי משהו אחר בראש <ChevronDown size={14} /></summary><Options value={value} values={Object.fromEntries(Object.entries(topics).filter(([k]) => !recommended.includes(k)))} onChange={onChange} /></details></>;
}

function Login({ onToken, error }: { onToken: (token: string) => void; error: string }) {
  const [channel, setChannel] = useState<EntryChannel>("phone");
  return <main className="sk-entry-page"><QuickEntry mode="login" channel={channel} onChannel={setChannel}
    privacy={legalBasePath(location.pathname) + "/privacy"} onToken={onToken} error={error} /></main>;
}

const quickLevels = { beginner: "צעדים ראשונים", intermediate: "מסתדר בשיחה", fluent: "מדבר ורוצה לדייק" };

function QuickDirection({ busy, error, onStart }: { busy: boolean; error: string; onStart: (choices?: { level: string; personality: string }) => void }) {
  const [level, setLevel] = useState("");
  const [personality, setPersonality] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="sk-quick-direction">
    <h1 ref={heading} tabIndex={-1}>להתאים את המורה</h1>
    <form onSubmit={e => { e.preventDefault(); if (!busy && level && personality) onStart({ level, personality }); }}>
      <fieldset disabled={busy}><legend>מה רמת האנגלית שלך?</legend>{Object.entries(quickLevels).map(([id, label]) => <label key={id}><input type="radio" name="quick-level" checked={level === id} onChange={() => setLevel(id)} />{label}</label>)}</fieldset>
      <fieldset disabled={busy}><legend>איזה סגנון מתאים לך?</legend>{Object.entries(personalities).map(([id, label]) => <label key={id}><input type="radio" name="quick-style" checked={personality === id} onChange={() => setPersonality(id)} />{label}</label>)}</fieldset>
      <button className="sk-primary" disabled={busy || !level || !personality}>להתחיל לדבר</button>
      <button type="button" className="sk-link" disabled={busy} onClick={() => onStart()}>להתנסות בלי התאמה</button>
      {error && <p className="sk-error" role="alert">{error}</p>}
    </form>
  </main>;
}

export const LearnerPortal: React.FC = () => {
  const [token, setToken] = useState(initialToken);
  const [account, setAccount] = useState<Account | null>(null);
  const [checkoutPlan] = useState(() => new URLSearchParams(location.search).get("plan") || "");
  const [page, setPage] = useState<Page>(() => checkoutPlan ? "checkout" : "home");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const startingQuick = useRef(false);
  const [loading, setLoading] = useState(true);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [linkChannel, setLinkChannel] = useState<EntryChannel | null>(null);
  const [voice, setVoice] = useState<{ botId: string; teacherId?: string; name: string } | null>(null);
  const [builder, setBuilder] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ role: string; text: string }[] | null | undefined>();
  const mainRef = useRef<HTMLElement>(null);
  const login = (value: string) => { saveLearnerToken(value); setLoading(true); setToken(value); setError(""); };
  const logout = () => { clearLearnerToken(); setAccount(null); setToken(""); setPage("home"); };
  const refresh = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try { const data = await portalRequest<Account>("/v1/portal/me", token); setAccount(data); }
    catch (e) { if (e instanceof PortalError && e.status === 401) { setToken(""); setAccount(null); } setError(e instanceof Error ? e.message : "לא הצלחנו לטעון את החשבון."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(""), 4500); return () => clearTimeout(t); } }, [note]);
  const navigate = (next: Page) => { setPage(next); setError(""); setExpanded(null); setTranscript(undefined); window.scrollTo({ top: 0, behavior: "instant" }); requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true })); };
  const run = async (action: () => Promise<void>, success = "") => {
    setBusy(true); setError("");
    try { await action(); await refresh(); if (success) setNote(success); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו לשמור. אפשר לנסות שוב."); return false; }
    finally { setBusy(false); }
  };
  const save = async (input: Preferences) => { await portalRequest("/v1/portal/preferences", token, input); };
  const p = account?.preferences || {};
  const active = account?.teachers.find(t => t.id === p.active_teacher);
  const activeMaterial = account?.materials.find(m => m.id === (active?.material_id || p.material_id));
  const webTeachers = account?.bots.filter(b => b.role === "teacher") || [];
  const baseTeachers = webTeachers.filter(b => b.phone_enabled);
  const botId = [active?.base_bot, p.selected_bot, account?.customer.preferred_bot, "isaac-basic"].find(id => baseTeachers.some(b => b.id === id)) || baseTeachers[0]?.id;
  const defaultBase = baseTeachers.find(b => b.id === "isaac-basic") || baseTeachers[0];
  const webBotId = [active?.base_bot, p.selected_bot, account?.customer.preferred_bot, "isaac-basic"].find(id => webTeachers.some(b => b.id === id)) || webTeachers[0]?.id;
  const defaultWeb = defaultBase || webTeachers.find(b => b.id === "isaac-basic") || webTeachers[0];
  const teacherName = active?.name || DEFAULT_NAME;
  const hasDirection = !!(p.plan || active || p.trial_setup === "selected");
  const needsQuickDirection = account && !checkoutPlan && !hasDirection && !account.teachers.length && !p.trial_setup
    && !account.progress.session_count && !remainingMinutes(account)
    && !account.subscriptions?.some(s => s.status === "active");
  const talk = (teacher?: Teacher, bot?: { id: string; label: string }) => {
    const id = teacher?.base_bot || bot?.id || webBotId;
    if (!id) { setError("עדיין אין מורה זמין לשיחה. אפשר לנסות שוב מאוחר יותר."); return; }
    setVoice({ botId: id, teacherId: teacher?.id || (!bot ? active?.id : undefined), name: teacher?.name || bot?.label || teacherName });
  };
  async function startQuick(choices?: { level: string; personality: string }) {
    if (startingQuick.current) return;
    if (!webBotId) { setError("אין מורה זמין כרגע. אפשר לנסות שוב מאוחר יותר."); return; }
    startingQuick.current = true;
    setBusy(true);
    setError("");
    try {
      const input: Preferences = choices
        ? { ...choices, selected_bot: webBotId, mode: "free", trial_setup: "selected" }
        : { trial_setup: "skipped" };
      await save(input);
      setAccount(current => current && ({ ...current, preferences: { ...current.preferences, ...input } }));
      talk();
    } catch {
      setError("לא הצלחנו לשמור את הבחירות. אפשר לנסות שוב.");
    } finally { startingQuick.current = false; setBusy(false); }
  }
  const headings: Record<Page, [string, string]> = {
    home: ["עוד שיחה. קצת יותר ביטחון.", "כיף שחזרת."],
    teachers: ["עם מי בא לך לדבר?", "המורים שלי"],
    materials: ["המילים שלך. השיחה שלנו.", "אוצר מילים"],
    history: ["תראה כמה כבר דיברת.", "השיחות שלי"],
    achievements: ["האנגלית כבר זזה.", "ההתקדמות שלי"],
    settings: ["בקצב שלך. בדרך שלך.", "העדפות"],
    intake: [p.plan ? "נשנה קצת את הכיוון." : "בוא נכיר רגע.", "התוכנית שלך"],
    plan: ["יופי. יש לנו כיוון.", "התוכנית שלך"],
    checkout: ["עוד רגע מתחילים.", "הצטרפות למסלול"],
  };
  const lastLesson = account?.progress.sessions[0];
  const firstName = account && account.customer.name !== "לקוח מהטלפון" ? account.customer.name.split(" ")[0] : "";
  const nav: [Page, string, React.ReactNode][] = [["home", "בית", <Sprout key="i" />], ["teachers", "המורים שלי", <Users key="i" />], ["materials", "אוצר מילים", <BookOpen key="i" />], ["achievements", "ההתקדמות", <Trophy key="i" />], ["history", "השיחות שלי", <History key="i" />], ["settings", "העדפות", <Settings2 key="i" />]];
  const renderHome = () => account && <>
    <section className="sk-hero">
      <div>
        <h2>השיחה הבאה שלך</h2>
        <p>{teacherName} כבר על הקו · {p.minutes || p.plan?.minutes || 10} דקות · {levelNames[(p.level || p.plan?.level || "beginner") as keyof typeof levelNames]}</p>
        {p.track !== "grammar" && activeMaterial?.target_count === 0 && <p role="status" className="sk-notice">לרשימה ״{activeMaterial.name}״ עוד אין יעדי אנגלית, אז מדברים בלי ציוני מילים. <button className="sk-link" onClick={() => navigate("materials")}>לרשימות</button></p>}
        <div className="sk-actions"><button className="sk-primary" onClick={() => talk()}><Mic size={18} />להתחיל שיחה</button><button className="sk-link" onClick={() => setPhoneOpen(true)}>לדבר בטלפון</button></div>
      </div>
      <div className="sk-hero-art"><ConversationArt /></div>
    </section>
    <div className="sk-metrics">
      <div className="sk-metric"><strong>{remainingMinutes(account)}</strong><span>דקות בחבילה</span></div>
      <div className="sk-metric"><strong>{account.progress.session_count}</strong><span>שיחות עד היום</span></div>
      <div className="sk-metric"><strong>{practiceDays(account.progress.sessions)}</strong><span>ימי תרגול לאחרונה</span></div>
    </div>
    <AccessNotice account={account} />
    <div className="sk-dash-bottom">
      {lastLesson ? <button className="sk-panel-card" onClick={() => navigate("history")}><strong>השיחה האחרונה</strong><p>{lastLesson.summary_he || "עוד שיחה קטנה באנגלית."}</p><p className="sk-accent-text">הצעד הבא: {lastLesson.next_step_he || "ממשיכים לדבר."}</p></button>
        : <button className="sk-panel-card" onClick={() => navigate("teachers")}><strong>{teacherName}</strong><p>המורה שמחכה לך בטלפון. אפשר להחליף מתי שבא לך.</p></button>}
      <button className="sk-panel-card" onClick={() => navigate("achievements")}><strong>המילים שלך</strong><p>{activeMaterial ? "בשיחה הבאה: " + activeMaterial.name : nextWords(p.topic || p.plan?.topic)}</p><p>ציון מתעדכן רק כשמילה נבדקה באמת בשיחה.</p></button>
    </div>
  </>;
  if (needsQuickDirection && !voice) return <div className="speakool" dir="rtl"><div className="sk-shell">
    <header className="sk-header"><a className="sk-brand" href={legalBasePath(location.pathname) + "/"} aria-label="ספיקול"><SpeakCallLogo /></a></header>
    <QuickDirection busy={busy} error={error} onStart={choices => void startQuick(choices)} />
  </div></div>;
  return <div className="speakool" dir="rtl">
    <div className={"sk-shell" + (account ? " has-side" : "")}>{account ? <aside className="sk-side"><Brand collapse onClick={() => navigate("home")} /><nav className="sk-sidenav" aria-label="הפורטל שלי">{nav.map(([id, label, icon]) => <button key={id} aria-label={label} className={page === id || (id === "home" && (page === "plan" || page === "intake")) ? "is-active" : ""} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}>{icon}<span>{label}</span></button>)}</nav><button className="sk-side-out" aria-label="יציאה" onClick={logout}><LogOut size={20} /><span>יציאה</span></button></aside> : <header className="sk-header"><Brand onClick={() => navigate("home")} /></header>}
      {loading ? <main className="sk-loading"><div className="sk-loading-shape" /><h1>רגע, פותחים את המחברת.</h1></main> : !token ? <Login onToken={login} error={error} /> : !account ? <main className="sk-empty"><p role="alert">{error || "לא הצלחנו להתחבר כרגע."}</p><button className="sk-primary" onClick={() => { setLoading(true); void refresh(); }}>ננסה שוב</button><button className="sk-link" onClick={logout}>כניסה מחדש</button></main> : <main ref={mainRef} tabIndex={-1} className="sk-main">
        <div className="sk-page-heading"><div><h1>{headings[page][0]}</h1>{page === "home" && <p>{firstName ? "היי " + firstName + ", " : ""}כיף שחזרת. מתחילים במשפט אחד.</p>}</div></div>
        {error && <div className="sk-error" role="alert">{error}<button aria-label="סגירת הודעה" onClick={() => setError("")}><X size={15} /></button></div>}
        <fieldset className="sk-content-fieldset" disabled={busy}>
          {page === "home" && renderHome()}
          {page === "intake" && <Direction purpose="plan" initial={directionDraft(p, active)} editing={!!p.plan} askTeacher={!account.teachers.length} saving={busy} onFinish={async d => { if (await run(async () => {
            const plan: Plan = { goal: d.goal, level: d.level, difficulty: d.difficulty, minutes: d.minutes, topic: d.topic };
            await save({ plan, level: d.level, conversation_mode: d.conversation_mode, pace: d.pace, correction_policy: d.correction_policy, minutes: d.minutes, topic: d.topic, ...(p.track ? {} : { track: "recommended" }), mode: "free", learner_name: d.learner_name.trim(), ...(!active && botId ? { selected_bot: botId } : {}) });
            if (!account.teachers.length && defaultBase) {
              const female = d.teacher_gender === "female";
              const created = await portalRequest<Teacher>("/v1/portal/teachers", token, { name: female ? FEMALE_NAME : DEFAULT_NAME, base_bot: defaultBase.id, personality: d.personality, voice: female ? "Aoede" : "Puck", explanation: "hebrew", pace: d.pace, corrections: "gentle", topic: d.topic, material_id: "", level: d.level, conversation_mode: d.conversation_mode, learning_load: d.learning_load || "light", correction_policy: d.correction_policy, closing_activity: d.closing_activity || "roleplay" });
              await save({ active_teacher: created.id });
            }
          }, account.teachers.length ? "הכיוון נשמר. ככה " + teacherName + (isFemale(active?.voice) ? " תלמד" : " ילמד") + " גם בטלפון." : (d.teacher_gender === "female" ? "הכרנו לך את " + FEMALE_NAME + ". היא כבר מחכה בטלפון." : "הכרנו לך את " + DEFAULT_NAME + ". הוא כבר מחכה בטלפון."))) navigate("plan"); }} />}
          {page === "plan" && <div className="sk-plan"><div><h2>{topics[p.topic || p.plan?.topic || "recommended"]}<span className="sk-accent">, בוא נדבר.</span></h2><p>{teacherName} · {p.minutes || p.plan?.minutes || 10} דקות בכל פעם</p><p>{directionSummary(p, active)}</p><p>{loadNames[(p.learning_load || "light") as keyof typeof loadNames]} · {p.track === "grammar" ? "תרגול דקדוק נפרד" : "ללא תרגול דקדוק ייעודי"}</p><div className="sk-actions"><button className="sk-primary" onClick={() => setPhoneOpen(true)}><Phone size={17} />התחל בטלפון</button><button className="sk-link" onClick={() => talk()}>התחל כאן <ArrowUpLeft size={15} /></button></div><button className="sk-quiet-link" onClick={() => navigate("intake")}>נשנה קצת את הכיוון?</button><p className="sk-muted">אותו כיוון גם בטלפון: אפשר פשוט לבקש מהמורה בשיחה לשנות אותו.</p></div><ConversationArt /></div>}
          {page === "teachers" && <>
            <div className="sk-section-intro"><p>כל מורה, שילוב אחר. רק אחד מקבל את השיחה הבאה שלך.</p><button className="sk-secondary" onClick={() => setBuilder(true)} disabled={!baseTeachers.length}><Plus size={16} />מורה חדש</button></div>
            <div className="sk-teacher-grid">{account.teachers.map((teacher, index) => <article key={teacher.id} className={"sk-teacher-card " + (active?.id === teacher.id ? "is-current" : "")}><div className="sk-card-top"><span className="sk-tag">{active?.id === teacher.id ? <><span className="sk-status-dot" />בטלפון שלך</> : personalities[teacher.personality]}</span><IconButton label={"מחיקת " + teacher.name} onClick={() => { if (confirm("למחוק את המורה " + teacher.name + "?")) void run(async () => { await portalRequest("/v1/portal/teachers/" + teacher.id, token, undefined, "DELETE"); }); }}><Trash2 size={15} /></IconButton></div><div className="sk-teacher-art"><TeacherMark teacher={teacher} index={index} /></div><h2>{teacher.name}</h2><p>{paceNames[teacher.pace]} · {topics[teacher.topic] || teacher.topic}</p><button className="sk-primary" onClick={() => talk(teacher)}><Mic size={16} />שוחח עכשיו</button>{active?.id !== teacher.id && <button className="sk-link" onClick={() => void run(() => save({ active_teacher: teacher.id }), "זה המורה שיחכה לך בטלפון.")}>לבחור לטלפון <ArrowLeft size={14} /></button>}</article>)}
              {(defaultWeb ? [defaultWeb] : []).map((bot, index) => <article className={"sk-teacher-card sk-base-teacher " + (!active && botId === bot.id ? "is-current" : "")} key={bot.id}><span className="sk-tag">{!active && botId === bot.id ? "בטלפון שלך" : "מצוות ספיקול"}</span><div className="sk-teacher-art"><TeacherMark index={index} /></div><h2>{DEFAULT_NAME}</h2><p>נקודת פתיחה טובה. פשוט להתחיל.</p><button className="sk-primary" onClick={() => talk(undefined, { ...bot, label: DEFAULT_NAME })}><Mic size={16} />שוחח עכשיו</button>{bot.phone_enabled && (active || botId !== bot.id) && <button className="sk-link" onClick={() => void run(() => save({ selected_bot: bot.id, active_teacher: "", mode: "free" }), "המורה שלך בטלפון עודכן.")}>לבחור לטלפון <ArrowLeft size={14} /></button>}</article>)}
            </div>{!webTeachers.length && <Empty icon={<Users />} title="המורים עוד לא כאן." text="אין כרגע מורה זמין. אפשר לנסות שוב מאוחר יותר." />}
          </>}
          {page === "materials" && <Materials account={account} onSave={async (name, words) => await run(async () => { const r = await portalRequest<Material>("/v1/portal/materials", token, { name, words }); await save({ material_id: r.id }); setNote(r.target_count === 0 ? "נשמר כחומר לשיחה בלבד; טרם הוכנו יעדי אנגלית למדידה." : "המילים נשמרו. יעדי האנגלית מוכנים לשיחה הבאה."); })} onActivate={id => void run(() => save({ material_id: id }), id ? account.materials.find(m => m.id === id)?.target_count === 0 ? "נבחר חומר לשיחה בלבד, ללא ציוני מילים." : "הרשימה מחכה לשיחה הבאה." : "הרשימה האישית הוסרה מהשיחה הבאה.")} onDelete={id => void run(async () => { await portalRequest("/v1/portal/materials/" + id, token, undefined, "DELETE"); }, "הרשימה נמחקה.")} />}
          {page === "history" && <div className="sk-history">{account.progress.sessions.length === 0 ? <Empty icon={<History />} title="הסיפור שלנו עוד מתחיל." text="אחרי השיחה הראשונה יחכו לך כאן סיכום קטן וצעד הבא." action={() => setPhoneOpen(true)} actionLabel="בוא נדבר" /> : account.progress.sessions.map((lesson, index) => <article className="sk-history-item" key={lesson.call_id || index}><button className="sk-history-row" aria-expanded={expanded === lesson.call_id} onClick={() => { setExpanded(expanded === lesson.call_id ? null : lesson.call_id); setTranscript(undefined); }}><span className={"sk-history-dot " + (lesson.success_he ? "has-success" : "")} /><time dateTime={lesson.started_at}>{lessonDate(lesson.started_at)}</time><span>{lesson.summary_he || "עוד שיחה קטנה באנגלית"}</span><small>{Math.max(1, Math.round(lesson.duration_seconds / 60))} דקות</small><ChevronDown size={16} /></button>{expanded === lesson.call_id && <div className="sk-history-detail"><dl><dt>מה הצליח</dt><dd>{lesson.success_he || "כל שיחה היא עוד תרגול."}</dd><dt>כדאי לחזק</dt><dd>{lesson.observations.find(o => o.correction)?.correction || "עדיין אין הערה לשיחה הזאת."}</dd><dt>הצעד הבא</dt><dd>{lesson.next_step_he || "ממשיכים לדבר."}</dd></dl>{lesson.observations.length > 0 && <div className="sk-tags">{lesson.observations.slice(0, 6).map((o, i) => <span className="sk-tag" key={i}>{o.skill}</span>)}</div>}<button className="sk-quiet-link" onClick={() => void run(async () => { const r = await portalRequest<{ transcript: { role: string; text: string }[] | null }>("/v1/portal/sessions/" + encodeURIComponent(lesson.call_id) + "/transcript", token); setTranscript(r.transcript); })}>הצג את השיחה</button>{transcript === null && <p className="sk-muted">לא נשמר תמליל לשיחה הזאת. אפשר לבחור שמירת שיחות בהעדפות.</p>}{transcript && <div className="sk-transcript">{transcript.map((t, i) => <p key={i}><strong>{t.role === "learner" ? "אני" : "המורה"}: </strong><span dir="auto">{t.text}</span></p>)}</div>}</div>}</article>)}</div>}
          {page === "checkout" && <Checkout token={token} packageId={checkoutPlan} onDone={() => { history.replaceState(null, "", location.pathname); void refresh(); navigate("home"); }} />}
          {page === "achievements" && <Achievements account={account} token={token} />}
          {page === "settings" && <>
            <ProfileNext account={account} hasDirection={hasDirection} onDirection={() => navigate("intake")} onLink={setLinkChannel} />
            <PreferencesForm key={JSON.stringify(p)} preferences={p} account={account} onDirection={hasDirection ? () => navigate("intake") : undefined} onSave={input => void run(() => save(input), "סגור. השיחה הבאה תהיה בדרך שלך.")} onTeachers={() => navigate("teachers")} onMaterials={() => navigate("materials")} onLogout={logout} phonesPanel={hasPhone(account) && <PhoneLinks account={account} token={token} onRefresh={refresh} />} subscriptionPanel={<SubscriptionPanel token={token} subscriptions={account.subscriptions} onRefresh={refresh} />} />
          </>}
          {page === "settings" && <Billing token={token} />}
        </fieldset>
      </main>}

    </div>
    {note && <div className="sk-toast" role="status"><Check size={16} />{note}</div>}
    {busy && <span className="sk-saving" role="status">רק רגע, שומרים…</span>}
    {phoneOpen && account && <Modal title="לדבר בטלפון" onClose={() => setPhoneOpen(false)}>
      {hasPhone(account) ? <PhoneInstructions account={account} teacherName={teacherName} /> : <button type="button" className="sk-primary" onClick={() => { setPhoneOpen(false); setLinkChannel("phone"); }}>לחבר מספר</button>}
    </Modal>}
    {linkChannel && account && <Modal title={linkChannel === "phone" ? "לחבר מספר" : "לחבר מייל"} onClose={() => setLinkChannel(null)}>
      <EntryForm channel={linkChannel} linkToken={token} onLinked={() => { setLinkChannel(null); void refresh(); }} />
    </Modal>}
    {voice && <Modal title="בוא נדבר." onClose={() => { setVoice(null); void refresh(); }}><VoiceRoom token={token} {...voice} onDone={() => { setVoice(null); void refresh(); }} /></Modal>}
    {builder && account && <Modal title="מורה. בדיוק בראש שלך." error={error} busy={busy} onClose={() => setBuilder(false)}><Direction purpose="teacher" initial={directionDraft(p, active)} materials={account.materials} saving={busy} onFinish={async d => { if (await run(async () => { const saved = await portalRequest<Teacher>("/v1/portal/teachers", token, { name: d.name.trim(), base_bot: botId || baseTeachers[0]?.id || "", personality: d.personality, voice: d.voice, explanation: "hebrew", pace: d.pace, corrections: "gentle", topic: d.topic, material_id: d.material_id, level: d.level, conversation_mode: d.conversation_mode, learning_load: d.learning_load || "light", correction_policy: d.correction_policy, closing_activity: d.closing_activity || "roleplay" }); await save({ active_teacher: saved.id }); }, "נעים להכיר. המורה החדש שלך כבר בטלפון.")) setBuilder(false); }} onPreview={voiceName => {
      void run(async () => { const r = await portalRequest<{ audio_wav_base64: string }>("/v1/portal/voice-preview", token, { voice: voiceName }); const audio = new Audio("data:audio/wav;base64," + r.audio_wav_base64); await audio.play(); });
    }} /></Modal>}
  </div>;
};

function PhoneInstructions({ account, teacherName }: { account: Account; teacherName: string }) {
  return <><p>מתקשרים מהמספר שמחובר לחשבון שלך, ומגיעים אל {teacherName}.</p><a className="sk-phone-number" href={"tel:" + account.phone} dir="ltr">{account.phone.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3")}<Phone size={23} /></a><p>מקישים <strong>1</strong> ונכנסים ישר לשיעור. מקש <strong>2</strong> הוא האזור האישי: מורה, סוג שיעור וחבילות. ובאמצע שיחה אפשר פשוט לבקש מהמורה לשנות כיוון — זה נשמר גם כאן.</p><div className="sk-phone-note"><Check size={16} />המורה, ההעדפות והמילים שלך כבר מחכים שם.</div><small>המספר המחובר: <bdi>{account.customer.phone || "טרם חובר מספר טלפון — אפשר להוסיף מספר בהעדפות"}</bdi></small></>;
}

function Empty({ icon, title, text, action, actionLabel }: { icon: React.ReactNode; title: string; text: string; action?: () => void; actionLabel?: string }) {
  return <div className="sk-empty"><div className="sk-empty-mark">{icon}</div><h2>{title}</h2><p>{text}</p>{action && <button className="sk-primary" onClick={action}>{actionLabel}<ArrowLeft size={16} /></button>}</div>;
}
type DirectionDraft = Plan & LessonSettings & { learner_name: string; personality: string; teacher_gender: string; voice: string; pace: string; name: string; material_id: string };
type DirectionStep = { key: keyof DirectionDraft; title: string; sub: string; values: Record<string, string> };
const goalNames: Record<string, string> = { work: "בשביל העבודה", travel: "בשביל החו״ל", study: "בשביל הלימודים" };
export const directionSummary = (p: Preferences, teacher?: Teacher) => [
  levelNames[(teacher?.level || p.level || p.plan?.level || "beginner") as keyof typeof levelNames],
  modeNames[(teacher?.conversation_mode || p.conversation_mode || "guided") as keyof typeof modeNames],
  paceNames[teacher?.pace || p.pace || "normal"],
  (p.minutes || p.plan?.minutes || 10) + " דקות",
  topics[teacher?.topic || p.topic || p.plan?.topic || "recommended"],
].join(" · ");
function directionDraft(p: Preferences, teacher?: Teacher): DirectionDraft {
  const level = teacher?.level || p.level || p.plan?.level || "beginner";
  const mode = teacher?.conversation_mode || p.conversation_mode || (level === "fluent" ? "conversation" : "guided");
  return {
    goal: p.plan?.goal || "work", difficulty: p.plan?.difficulty || "speaking", minutes: p.minutes || p.plan?.minutes || 10, topic: teacher?.topic || p.topic || p.plan?.topic || "recommended",
    level, conversation_mode: mode, pace: teacher?.pace || p.pace || (level === "beginner" ? "slow" : "normal"),
    correction_policy: teacher?.correction_policy || p.correction_policy || (mode === "guided" ? "after_answer" : "after_activity"),
    learning_load: teacher?.learning_load || p.learning_load || "light", closing_activity: teacher?.closing_activity || p.closing_activity || "roleplay",
    learner_name: p.learner_name || "", personality: teacher?.personality || p.personality || "warm", teacher_gender: isFemale(teacher?.voice) ? "female" : "male", voice: teacher?.voice || "Puck", name: "", material_id: teacher?.material_id || p.material_id || "",
  };
}
function directionSteps(d: DirectionDraft, purpose: "plan" | "teacher", askTeacher: boolean): DirectionStep[] {
  const all: Record<string, DirectionStep> = {
    goal: { key: "goal", title: "בשביל מה האנגלית שלך?", sub: "לא למבחן. לחיים שלך.", values: goalNames },
    level: { key: "level", title: "איפה אתה היום?", sub: "אין כאן תשובה לא נכונה.", values: levelNames },
    difficulty: { key: "difficulty", title: "איפה זה נתקע?", sub: "שם בדיוק נתחיל.", values: { speaking: "כשצריך לדבר", listening: "כשמדברים אליי", writing: "כשצריך לכתוב" } },
    conversation_mode: { key: "conversation_mode", title: "איך נלמד יחד?", sub: "כמה עזרה בעברית ואיך בנוי השיעור.", values: modeNames },
    pace: { key: "pace", title: "באיזה קצב נדבר?", sub: "הקצב נפרד מהרמה.", values: paceNames },
    correction_policy: { key: "correction_policy", title: "מתי לתקן טעויות?", sub: "בלי להפריע לשטף, אם לא בא לך.", values: d.conversation_mode === "roleplay" ? { on_request: correctionPolicies.on_request, after_activity: correctionPolicies.after_activity } : correctionPolicies },
    personality: { key: "personality", title: "איזה מורה יעשה לך טוב?", sub: "אפשר להחליף מתי שבא לך.", values: personalities },
    teacher_gender: { key: "teacher_gender", title: "עם מי נוח לך יותר?", sub: "נתאים את הקול והשם.", values: { male: "עם מורה", female: "עם מורָה" } },
    voice: { key: "voice", title: "איך זה נשמע לך?", sub: "אפשר לשמוע לפני שבוחרים.", values: Object.fromEntries(voices.map(v => [v.value, v.label])) },
    minutes: { key: "minutes", title: "כמה זמן יש לך?", sub: "גם חמש דקות הן התחלה של משהו.", values: { "5": "חמש דקות", "10": "עשר דקות", "20": "עשרים דקות" } },
  };
  const keys = purpose === "teacher"
    ? ["personality", "voice", "level", "conversation_mode", "pace", "correction_policy"]
    : ["goal", "level", "difficulty", "conversation_mode", "pace", "correction_policy", ...(askTeacher ? ["personality", "teacher_gender"] : []), "minutes"];
  return keys.map(k => all[k]);
}
function Direction({ initial, purpose, askTeacher = false, editing = false, materials = [], saving, onFinish, onPreview }: { initial: DirectionDraft; purpose: "plan" | "teacher"; askTeacher?: boolean; editing?: boolean; materials?: Material[]; saving: boolean; onFinish: (d: DirectionDraft) => Promise<void>; onPreview?: (voice: string) => void }) {
  const [d, setD] = useState(initial);
  const [step, setStep] = useState(0);
  const [named, setNamed] = useState(purpose === "teacher" || !!initial.learner_name);
  const steps = directionSteps(d, purpose, askTeacher);
  const total = steps.length + (purpose === "teacher" ? 2 : 1);
  const choose = (key: keyof DirectionDraft, value: string) => { setD(x => ({ ...x, [key]: key === "minutes" ? Number(value) : value, ...(key === "conversation_mode" && value === "roleplay" && x.correction_policy === "after_answer" ? { correction_policy: "after_activity" } : {}) })); setStep(n => n + 1); };
  const finish = (next: DirectionDraft) => {
    setD(next);
    if (!saving) void onFinish(next);
  };
  if (!named) return <section className="sk-step-card"><h2>איך לקרוא לך?</h2><p>ככה המורה יפנה אליך.</p><form className="sk-name-form" onSubmit={e => { e.preventDefault(); setNamed(true); }}><input aria-label="השם שלך" maxLength={40} value={d.learner_name} onChange={e => setD(x => ({ ...x, learner_name: e.target.value }))} placeholder="השם הפרטי שלך" autoFocus /><button className="sk-primary" type="submit">{d.learner_name.trim() ? "נעים מאוד" : "אולי אחר כך"}</button></form></section>;
  const q = steps[step];
  const topicStep = step === steps.length;
  const recommended = ["recommended", ...(d.goal === "work" ? ["career", "business", "property", "everyday"] : d.goal === "study" ? ["school", "academic", "medicine", "everyday"] : ["travel", "flights", "everyday"])];
  return <section className={"sk-step-card" + (purpose === "teacher" ? " is-teacher" : "")}>
    <div className="sk-step-top"><span>{step + 1} / {total}</span><div className="sk-step-dots">{Array.from({ length: total }, (_, n) => n).map(n => <i className={n <= step ? "is-done" : ""} key={n} />)}</div></div>
    {purpose === "teacher" && <div className="sk-builder-mark"><TeacherMark teacher={{ name: d.name || "מורה", voice: d.voice }} /></div>}
    <h2>{q?.title || (topicStep ? "על מה בא לך לדבר?" : "איך נקרא למורה שלך?")}</h2>
    {(q?.key === "conversation_mode" || q?.key === "pace") && <p>{q.sub}</p>}
    {q ? <Options value={String(d[q.key] ?? "")} values={q.values} onChange={v => choose(q.key, v)} />
      : topicStep ? <TopicPicker value={d.topic} onChange={v => purpose === "plan" ? finish({ ...d, topic: v }) : (setD(x => ({ ...x, topic: v })), setStep(n => n + 1))} recommended={recommended} />
      : <form className="sk-name-form" onSubmit={e => { e.preventDefault(); if (d.name.trim()) finish(d); }}>
        <input id="teacher-name" name="teacher_name" aria-label="שם למורה" maxLength={40} value={d.name} onChange={e => setD(x => ({ ...x, name: e.target.value }))} placeholder="שם שכיף לך לשמוע" autoFocus />
        {materials.length > 0 && <label>מילים מהמגירה שלך<select value={d.material_id} onChange={e => setD(x => ({ ...x, material_id: e.target.value }))}><option value="">הרשימה הפעילה שלי</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        <button className="sk-primary" type="submit" disabled={!d.name.trim() || saving}>נעים להכיר. שומרים.<ArrowLeft size={16} /></button>
      </form>}
    {q?.key === "voice" && onPreview && <button className="sk-link" onClick={() => onPreview(d.voice)}><AudioLines size={16} />בוא נשמע רגע</button>}
    {q?.key === "goal" && <button className="sk-quiet-link" onClick={() => choose("goal", "other")}>משהו אחר <MoreHorizontal size={14} /></button>}
    {step > 0 && <button className="sk-quiet-link" onClick={() => setStep(n => n - 1)}><ArrowRight size={13} />רגע, אחורה</button>}
    {editing && purpose === "plan" && !topicStep && <button className="sk-quiet-link" onClick={() => finish(d)}><Check size={13} />זה הכול, שומרים</button>}
  </section>;
}

function Materials({ account, onSave, onActivate, onDelete }: { account: Account; onSave: (n: string, w: string[]) => Promise<boolean>; onActivate: (id: string) => void; onDelete: (id: string) => void }) {
  const [adding, setAdding] = useState(account.materials.length === 0);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const words = [...new Set(text.split(/[\n,;]+/).map(w => w.trim()).filter(Boolean))];
  const file = async (file?: File) => {
    if (!file) return;
    if (!/\.(txt|csv)$/i.test(file.name) || file.size > 200000) { setError("אפשר קובץ TXT או CSV עד 200KB. לכל רשימה עד מאה מילים או ביטויים."); return; }
    const content = await file.text(); setText(content.replace(/^\uFEFF/, "")); if (!name) setName(file.name.replace(/\.[^.]+$/, "").slice(0, 80)); setError("");
  };
  const chosenTeacher = account.teachers.find(t => t.id === account.preferences.active_teacher);
  const activeId = chosenTeacher?.material_id || account.preferences.material_id || "";
  return <><div className="sk-section-intro"><p>מילים שהבאת מהחיים. המורה ישלב אותן בשיחה.</p><button className="sk-secondary" onClick={() => setAdding(!adding)}><Plus size={16} />רשימה חדשה</button></div>{adding && <form className="sk-material-form" onSubmit={e => { e.preventDefault(); if (!words.length || words.length > 100 || words.some(w => w.length > 120)) { setError("עד מאה מילים או ביטויים, עד 120 תווים בכל שורה."); return; } void onSave(name.trim(), words).then(saved => { if (saved) { setText(""); setName(""); setError(""); } }); }}><label htmlFor="word-name">שם קטן לרשימה</label><input id="word-name" maxLength={80} required value={name} onChange={e => setName(e.target.value)} placeholder="למשל: השיחה הבאה בעבודה" /><label htmlFor="word-text">אילו מילים נכנסות לשיחה?</label><textarea id="word-text" required dir="auto" maxLength={12500} value={text} onChange={e => setText(e.target.value)} placeholder={"appointment — פגישה\nopportunity — הזדמנות\nLet's give it a try"} rows={6} /><div className="sk-material-bottom"><label className="sk-file-button"><Upload size={16} />או קובץ משלך<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={e => { void file(e.target.files?.[0]); e.target.value = ""; }} /><small>TXT / CSV · עד מאה מילים</small></label><span className="sk-muted">{words.length} / 100</span></div>{error && <p className="sk-error" role="alert">{error}</p>}<button className="sk-primary" disabled={!name.trim() || !words.length}>שומרים לשיחה הבאה<ArrowLeft size={16} /></button></form>}
    <div className="sk-material-list">{account.materials.map(m => <article key={m.id} className="sk-material-card"><div className="sk-card-top"><BookOpen strokeWidth={1.3} /><IconButton label={"מחיקת " + m.name} onClick={() => { if (confirm("למחוק את הרשימה " + m.name + "?")) onDelete(m.id); }}><Trash2 size={16} /></IconButton></div><h2>{m.name}</h2><p>{m.words.length} מילים וביטויים · {m.target_count ?? "—"} יעדי אנגלית ייחודיים למדידה</p>{m.target_count === 0 && <p role="status">הרשימה נשמרה כחומר לשיחה בלבד. טרם הוכנו לה יעדי אנגלית, ולכן לא יהיו עליה ציוני מילים.</p>}<div className="sk-tags">{m.words.slice(0, 5).map(w => <span className="sk-tag" dir="auto" key={w}>{w}</span>)}{m.words.length > 5 && <span className="sk-tag">ועוד {m.words.length - 5}</span>}</div><button className={activeId === m.id ? "sk-quiet-link sk-accent" : "sk-link"} onClick={() => onActivate(activeId === m.id ? "" : m.id)}>{activeId === m.id ? <><Check size={15} />ברשימת השיחה הבאה</> : "לקחת לשיחה הבאה"}<ArrowLeft size={14} /></button></article>)}</div></>;
}
function Achievements({ account, token }: { account: Account; token: string }) {
  const progress = account.progress;
  return <section className="sk-achievements"><LearningProgress token={token} account={account} /><div className="sk-persistence"><span><Clock3 size={16} />{progress.total_minutes} דקות של אנגלית</span><span>{progress.session_count} שיחות</span><span>{progress.total_points} נקודות עידוד — לא ציון ידע</span><span>{practiceDays(progress.sessions)} ימי תרגול בשיחות האחרונות</span></div></section>;
}
const hasPhone = (account: Account) => !!(account.customer.phone || account.phones.length);

function ProfileNext({ account, hasDirection, onDirection, onLink }: { account: Account; hasDirection: boolean; onDirection: () => void; onLink: (channel: EntryChannel) => void }) {
  const missing: EntryChannel[] = [...(!hasPhone(account) ? ["phone" as const] : []), ...(!account.customer.has_email ? ["email" as const] : [])];
  if (hasDirection && !missing.length) return null;
  return <section className="sk-profile-next" aria-label="להשלים את הפרופיל">
    <h2>להשלים את הפרופיל</h2>
    {!hasDirection && <div className="sk-setting-row"><span>התאמת המורה</span><button type="button" className="sk-link" onClick={onDirection}>לשנות כיוון</button></div>}
    {missing.slice(0, hasDirection ? 2 : 1).map(channel => <div key={channel} className="sk-setting-row">
      <span>{channel === "phone" ? "מספר טלפון" : "כתובת מייל"}</span>
      <button type="button" className="sk-link" onClick={() => onLink(channel)}>{channel === "phone" ? "לחבר מספר" : "לחבר מייל"}</button>
    </div>)}
  </section>;
}

function PreferencesForm({ preferences, account, onSave, onDirection, onTeachers, onMaterials, onLogout, phonesPanel, subscriptionPanel }: { preferences: Preferences; account: Account; onSave: (p: Preferences) => void; onDirection?: () => void; onTeachers: () => void; onMaterials: () => void; onLogout: () => void; phonesPanel: React.ReactNode; subscriptionPanel: React.ReactNode }) {
  const [draft, setDraft] = useState<Preferences>({ pace: "normal", corrections: "gentle", minutes: 10, language: "", track: "recommended", topic: "recommended", store_transcripts: false, ...preferences });
  const change = (key: string, value: string | boolean | number) => setDraft(p => ({ ...p, [key]: value }));
  return <form className="sk-settings" onSubmit={e => { e.preventDefault(); const { active_teacher, selected_bot, personality, trial_setup, ...values } = draft; onSave(values); }}><div className="sk-setting-row"><span>המורה שלי<small>מורה אחד, שמחכה לך בקו</small></span><button type="button" className="sk-link" onClick={onTeachers}>למורים שלי<ArrowUpLeft size={15} /></button></div>
    <Setting title="מסלול תרגול" value={tracks[draft.track || "recommended"]}><Options values={Object.fromEntries(Object.entries(tracks).slice(0, 3))} value={draft.track} onChange={v => change("track", v)} /><Options values={{ grammar: tracks.grammar }} value={draft.track} onChange={v => change("track", v)} />{draft.track === "grammar" && <fieldset><legend>מה נתרגל? עד שלוש מיומנויות</legend>{Object.entries(grammarNames).map(([id, label]) => <label key={id}><input type="checkbox" checked={(draft.grammar_targets || ["present"]).includes(id)} onChange={e => {
      const current = draft.grammar_targets || ["present"];
      const next = e.target.checked ? [...current, id] : current.filter(v => v !== id);
      if (next.length > 0 && next.length <= 3) setDraft(p => ({ ...p, grammar_targets: next }));
    }} />{label}</label>)}</fieldset>}</Setting>
    {onDirection && <div className="sk-setting-row"><span>הכיוון שלי<small>{directionSummary(draft)}</small></span><button type="button" className="sk-link" onClick={onDirection}>לשנות כיוון<ArrowUpLeft size={15} /></button></div>}
    <Setting title="כיוונון עדין" value={loadNames[(draft.learning_load || "light") as keyof typeof loadNames]}><LessonSettingsFields compact value={draft} onChange={next => setDraft(p => ({ ...p, ...next }))} /></Setting>
    <Setting title="שפת התרגום" value={draft.language || "זיהוי אוטומטי"}><label>השפה שלך<select value={draft.language} onChange={e => change("language", e.target.value)}><option value="">זיהוי אוטומטי</option>{["English", "Hebrew", "Yiddish", "Arabic", "Russian", "French"].map(l => <option key={l}>{l}</option>)}</select></label></Setting>
    <div className="sk-setting-row"><span>אוצר המילים שלי<small>{account.materials.length} רשימות שמורות</small></span><button type="button" className="sk-link" onClick={onMaterials}>לרשימות שלי<ArrowUpLeft size={15} /></button></div>
    {phonesPanel && <Setting title="טלפונים מחוברים" value={account.customer.phone}>{phonesPanel}</Setting>}
    <Setting title="החבילה שלי" value={remainingMinutes(account) + " דקות בחבילה"}>{futureMinutes(account) > 0 && <p>{futureMinutes(account)} דקות לתקופות עתידיות (עדיין לא זמינות)</p>}{account.receipts.length ? <ul className="sk-receipts">{account.receipts.map(r => <li key={r.id}>{r.minutes} דקות · {r.product === "school" ? "בית הספר" : "תרגומון"}{r.valid_from && new Date(r.valid_from).getTime() > Date.now() ? <> · זמינות מ־{lessonDate(r.valid_from)}</> : null} · עד {lessonDate(r.expires_at)}</li>)}</ul> : <p>עדיין אין חבילה בתשלום בחשבון.</p>}<a className="sk-link" href={"tel:" + account.phone}>להוספת דקות: חייגו, הקישו 2 ואז 3 <Phone size={15} /></a></Setting>
    {subscriptionPanel}
    <div className="sk-setting-row"><label htmlFor="save-transcripts">לשמור גם את המילים<small>תמליל השיחות הבאות. סיכומים נשמרים גם בלי זה.</small></label><input id="save-transcripts" type="checkbox" role="switch" checked={draft.store_transcripts === true} onChange={e => change("store_transcripts", e.target.checked)} /></div>
    <div className="sk-actions"><button className="sk-primary" type="submit">ככה מתאים לי<Check size={16} /></button><button type="button" className="sk-link" onClick={onLogout}><LogOut size={15} />יציאה</button></div>
  </form>;
}
function Setting({ title, value, children }: { title: string; value?: string; children: React.ReactNode }) {
  return <details className="sk-setting"><summary><span>{title}</span><span>{value}<ChevronDown size={15} /></span></summary><div className="sk-setting-body">{children}</div></details>;
}

function PhoneLinks({ account, token, onRefresh }: { account: Account; token: string; onRefresh: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (!challenge) { const r = await portalRequest<{ challenge: string }>("/v1/portal/auth/start", token, { phone, purpose: "link_phone" }); setChallenge(r.challenge); }
      else { await portalRequest("/v1/portal/auth/verify", token, { challenge, code }); await onRefresh(); setAdding(false); setChallenge(""); setPhone(""); setCode(""); }
    } catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו לחבר את המספר."); }
    finally { setBusy(false); }
  };
  return <div><p>המספר הראשי: <bdi>{account.customer.phone}</bdi></p>{account.phones.map(p => <div className="sk-setting-row" key={p.id}><bdi>{p.phone}</bdi><button type="button" className="sk-link" onClick={async () => { if (confirm("לנתק את המספר מהחשבון?")) { try { await portalRequest("/v1/portal/phones/" + p.id, token, undefined, "DELETE"); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו לנתק את המספר."); } } }}>ניתוק</button></div>)}{!adding ? <button type="button" className="sk-link" onClick={() => setAdding(true)}><Plus size={15} />לחבר עוד טלפון</button> : <div><label>{challenge ? "שש הספרות האחרונות של המספר שצלצל" : "איזה מספר נחבר?"}<input type={challenge ? "text" : "tel"} dir="ltr" inputMode={challenge ? "numeric" : "tel"} maxLength={challenge ? 6 : 30} value={challenge ? code : phone} onChange={e => challenge ? setCode(e.target.value.replace(/\D/g, "")) : setPhone(e.target.value)} /></label><button type="button" className="sk-secondary" disabled={busy || (challenge ? code.length !== 6 : phone.length < 9)} onClick={() => void submit()}>{busy ? "רק רגע…" : challenge ? "לחבר לחשבון" : "שלחו לי צלצול"}</button><button type="button" className="sk-quiet-link" onClick={() => { setAdding(false); setChallenge(""); }}>ביטול</button></div>}{error && <p className="sk-error" role="alert">{error}</p>}</div>;
}

export const PHONE_LINE = "076-5673575";
function AccessNotice({ account }: { account: Account }) {
  const a = account.access;
  if (!a?.limited) return null;
  const minutes = remainingMinutes(account);
  if (minutes > 0) return <p role="status" className="sk-access"><strong>מסלול {a.plan_name || "פעיל"}</strong> · נשארו {minutes} דקות · עד {a.max_call_minutes || 5} דקות בכל שיחה. בסוף כל שיחה המורה מסכם ושומר הכול.</p>;
  if (a.opening_minutes) return <p role="status" className="sk-access"><strong>שיעור פתיחה קולי ללא עלות</strong> · עד {a.opening_minutes} דקות, באופן חד־פעמי בטלפון או במיקרופון. לאחריו 2 שיחות של עד 5 דקות בחודש.</p>;
  if (a.free_calls_left > 0) return <p role="status" className="sk-access"><strong>מסלול טעימה</strong> · נשארו לך {a.free_calls_left} שיחות החודש, עד {a.free_call_minutes} דקות כל אחת. רוצה יותר? <a href={"tel:" + PHONE_LINE.replace(/-/g, "")}>חייגו {PHONE_LINE}, מקש 3</a></p>;
  return <p role="alert" className="sk-access is-empty"><strong>שיחות הטעימה של החודש נוצלו.</strong> כל מה שלמדת שמור. כדי להמשיך עכשיו: <a href={"tel:" + PHONE_LINE.replace(/-/g, "")}>חייגו {PHONE_LINE} והקישו 3</a> לבחירת מסלול.</p>;
}
