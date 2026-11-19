import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpLeft, AudioLines, BookOpen, Check, ChevronDown, Clock3, History, LogOut, Mic, MoreHorizontal, Phone, Plus, Settings2, Sprout, Trash2, Trophy, Upload, Users, X } from "lucide-react";
import { Billing, Checkout } from "./Checkout";
import { Account, futureMinutes, initialToken, Lesson, Material, Plan, portalRequest, PortalError, Preferences, practiceDays, remainingMinutes, Teacher, topics, tracks } from "./portalApi";
import { VoiceRoom } from "./VoiceRoom";
import { LearningProgress } from "./LearningProgress";
import { SubscriptionPanel } from "./SubscriptionPanel";
import { LessonSettingsFields, levelNames, loadNames, modeNames, correctionPolicies, grammarNames } from "./LessonSettingsFields";
import { TeacherMark } from "./LineTeacher";
export { TeacherMark } from "./LineTeacher";
import "./portal.css";

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
function Brand({ onClick }: { onClick: () => void }) {
  return <button className="sk-brand" dir="ltr" onClick={onClick} aria-label="ספיקול — למסך הבית"><AudioLines strokeWidth={1.5} /><span>SpeakCall<span className="sk-brand-dot">.</span></span></button>;
}
function ConversationArt({ seed = 0, small = false }: { seed?: number; small?: boolean }) {
  return <svg className={"sk-art " + (small ? "sk-art-small" : "")} viewBox="0 0 360 360" aria-hidden="true">
    <circle className="sk-art-halo sk-conversation-halo" cx="180" cy="180" r="135" />
    <g className="sk-orbit" style={{ transformOrigin: "180px 180px", animationDelay: `${seed % 5 * -.8}s` }}>
      <ellipse cx="180" cy="180" rx="142" ry="63" transform="rotate(-37 180 180)" fill="none" stroke="currentColor" strokeWidth=".75" />
      <circle cx="292" cy="95" r="7" className="sk-art-accent" />
    </g>
    <g className="sk-conversation-breathe">
      <path d="M78 97Q78 80 95 80H211Q228 80 228 97V174Q228 191 211 191H132L104 217V191H95Q78 191 78 174Z" className="sk-art-paper" />
      <text x="153" y="151" textAnchor="middle" direction="ltr" fontSize="43" fontFamily="Georgia,serif" fill="currentColor">hello.</text>
    </g>
    <g className="sk-conversation-breathe sk-conversation-second">
      <path d="M145 184Q145 170 159 170H268Q282 170 282 184V246Q282 260 268 260H247V283L218 260H159Q145 260 145 246Z" className="sk-art-accent" />
      {[0, 1, 2, 3, 4, 5, 6].map(n => <rect key={n} className="sk-sound-bar" x={180 + n * 11} y={203 - (n % 3) * 5} width="3" height={24 + (n % 3) * 10} rx="2" fill="#fffef9" style={{ animationDelay: `${n * -.18}s` }} />)}
    </g>
    <path d="M82 265v22m-11-11h22M284 58v17m-8-8h16" stroke="currentColor" strokeWidth="1" />
    <circle cx="82" cy="232" r="3" fill="currentColor" /><circle cx="277" cy="301" r="3" fill="currentColor" />
      </svg>;
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
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [personal, setPersonal] = useState("");
  const [notice, setNotice] = useState(error);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setNotice("");
    try {
      if (!challenge) { const r = await portalRequest<{ challenge: string }>("/v1/portal/auth/start", "", { phone }); setChallenge(r.challenge); }
      else { const r = await portalRequest<{ token: string }>("/v1/portal/auth/verify", "", { challenge, code }); onToken(r.token); }
    } catch (e) { setNotice(e instanceof Error ? e.message : "לא הצלחנו להתחבר."); }
    finally { setBusy(false); }
  };
  return <main className="sk-login">
    <section className="sk-login-copy"><h1>פשוט<br />לדבר<span>.</span></h1><p className="sk-lede">את השפה הראשונה שלך לא למדת מספר.<br />הקשבת. ניסית. דיברת.<br />בוא נעשה את זה שוב. הפעם באנגלית.</p>
      <form onSubmit={submit} className="sk-login-form">
        <label htmlFor="sk-phone">{challenge ? "מה שש הספרות האחרונות של המספר שצלצל?" : "באיזה מספר נדבר?"}</label>
        {!challenge ? <input id="sk-phone" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="050-000-0000" required /> : <input id="sk-phone" key="otp" autoFocus dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" pattern="[0-9]{6}" required />}
        <button className="sk-primary" disabled={busy}>{busy ? "רק רגע…" : challenge ? "בוא ניכנס" : "שלחו לי צלצול"}<ArrowLeft size={17} /></button>
        <small>{challenge ? "לא צריך לענות. רק להעתיק את שש הספרות האחרונות." : "צלצול אחד, בלי הודעות ובלי סיסמאות."}</small>
        {challenge && <button type="button" className="sk-link" onClick={() => { setChallenge(""); setCode(""); }}>מספר אחר או צלצול נוסף</button>}
      </form>
      <details className="sk-more"><summary>יש לי קישור אישי <Plus size={13} /></summary><form onSubmit={e => { e.preventDefault(); const t = personal.includes("#") ? personal.split("#").pop()! : personal.trim(); if (/^[A-Za-z0-9_-]{30,128}$/.test(t)) onToken(t); else setNotice("אפשר להדביק כאן את הקישור האישי המלא שקיבלת."); }}><label htmlFor="personal-link" className="sk-sr">קישור אישי</label><input id="personal-link" type="text" dir="ltr" value={personal} onChange={e => setPersonal(e.target.value)} placeholder="הקישור שקיבלת" required /><button className="sk-secondary">כניסה עם הקישור</button></form></details>
      {notice && <p className="sk-error" role="alert">{notice}</p>}
    </section><div className="sk-login-art"><ConversationArt /><p>לא צריך לדבר שוטף.<br />צריך רק להתחיל.</p></div>
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
  const [loading, setLoading] = useState(true);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [voice, setVoice] = useState<{ botId: string; teacherId?: string; name: string } | null>(null);
  const [builder, setBuilder] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ role: string; text: string }[] | null | undefined>();
  const mainRef = useRef<HTMLElement>(null);
  const login = (value: string) => { sessionStorage.setItem("learnerToken", value); setToken(value); setError(""); };
  const logout = () => { sessionStorage.removeItem("learnerToken"); setAccount(null); setToken(""); setPage("home"); };
  const refresh = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try { const data = await portalRequest<Account>("/v1/portal/me", token); setAccount(data); }
    catch (e) { if (e instanceof PortalError && e.status === 401) { sessionStorage.removeItem("learnerToken"); setToken(""); setAccount(null); } setError(e instanceof Error ? e.message : "לא הצלחנו לטעון את החשבון."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(""), 4500); return () => clearTimeout(t); } }, [note]);
  const navigate = (next: Page) => { setPage(next); setError(""); setExpanded(null); setTranscript(undefined); window.scrollTo({ top: 0, behavior: "instant" }); requestAnimationFrame(() => mainRef.current?.focus()); };
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
  const talk = (teacher?: Teacher, bot?: { id: string; label: string }) => {
    const id = teacher?.base_bot || bot?.id || webBotId;
    if (!id) { setError("עדיין אין מורה זמין לשיחה. אפשר לנסות שוב מאוחר יותר."); return; }
    setVoice({ botId: id, teacherId: teacher?.id || (!bot ? active?.id : undefined), name: teacher?.name || bot?.label || teacherName });
  };
  const headings: Record<Page, [string, string]> = {
    home: ["עוד שיחה. קצת יותר ביטחון.", "כיף שחזרת."],
    teachers: ["עם מי בא לך לדבר?", "המורים שלי"],
    materials: ["המילים שלך. השיחה שלנו.", "אוצר מילים"],
    history: ["תראה כמה כבר דיברת.", "השיחות שלי"],
    achievements: ["האנגלית כבר זזה.", "ההתקדמות שלי"],
    settings: ["בקצב שלך. בדרך שלך.", "העדפות"],
    intake: ["בוא נכיר רגע.", "התוכנית שלך"],
    plan: ["יופי. יש לנו כיוון.", "התוכנית שלך"],
    checkout: ["עוד רגע מתחילים.", "הצטרפות למסלול"],
  };
  const lastLesson = account?.progress.sessions[0];
  const firstName = account && account.customer.name !== "לקוח מהטלפון" ? account.customer.name.split(" ")[0] : "";
  const nav: [Page, string, React.ReactNode][] = [["home", "בית", <Sprout key="i" />], ["teachers", "המורים שלי", <Users key="i" />], ["materials", "אוצר מילים", <BookOpen key="i" />], ["achievements", "ההתקדמות", <Trophy key="i" />], ["history", "השיחות שלי", <History key="i" />], ["settings", "העדפות", <Settings2 key="i" />]];
  const renderHome = () => account && <>
    <section className="sk-hero">
      <div>
        <h2>{p.plan ? <>{topics[p.topic || p.plan.topic] || "שיחה קטנה"}. במילים שלך.</> : <>פשוט לדבר.</>}</h2>
        <p>{teacherName} כבר על הקו · {p.minutes || p.plan?.minutes || 10} דקות · {levelNames[(p.level || p.plan?.level || "beginner") as keyof typeof levelNames]}</p>
        {p.track !== "grammar" && activeMaterial?.target_count === 0 && <p role="status" className="sk-notice">לרשימה ״{activeMaterial.name}״ עוד אין יעדי אנגלית, אז מדברים בלי ציוני מילים. <button className="sk-link" onClick={() => navigate("materials")}>לרשימות</button></p>}
        <div className="sk-actions"><button className="sk-primary" onClick={() => setPhoneOpen(true)}><Phone size={19} />{account.progress.session_count ? "להמשיך בטלפון" : "בוא נדבר בטלפון"}</button><button className="sk-secondary" onClick={() => talk()}><Mic size={18} />לדבר כאן</button><button className="sk-link" onClick={() => navigate(p.plan ? "plan" : "intake")}>{p.plan ? "התוכנית שלי" : "נכיר רגע?"}</button></div>
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
  return <div className="speakool" dir="rtl">
    <div className={"sk-shell" + (account ? " has-side" : "")}>{account ? <aside className="sk-side"><Brand onClick={() => navigate("home")} /><nav className="sk-sidenav" aria-label="הפורטל שלי">{nav.map(([id, label, icon]) => <button key={id} aria-label={label} className={page === id || (id === "home" && (page === "plan" || page === "intake")) ? "is-active" : ""} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}>{icon}<span>{label}</span></button>)}</nav><button className="sk-side-out" aria-label="יציאה" onClick={logout}><LogOut size={20} /><span>יציאה</span></button></aside> : <header className="sk-header"><Brand onClick={() => navigate("home")} /></header>}
      {loading ? <main className="sk-loading"><div className="sk-loading-shape" /><h1>רגע, פותחים את המחברת.</h1></main> : !token ? <Login onToken={login} error={error} /> : !account ? <main className="sk-empty"><p role="alert">{error || "לא הצלחנו להתחבר כרגע."}</p><button className="sk-primary" onClick={() => { setLoading(true); void refresh(); }}>ננסה שוב</button><button className="sk-link" onClick={logout}>כניסה מחדש</button></main> : <main ref={mainRef} tabIndex={-1} className="sk-main">
        <div className="sk-page-heading"><div><h1>{headings[page][0]}</h1>{page === "home" && <p>{firstName ? "היי " + firstName + ", " : ""}כיף שחזרת. מתחילים במשפט אחד.</p>}</div></div>
        {error && <div className="sk-error" role="alert">{error}<button aria-label="סגירת הודעה" onClick={() => setError("")}><X size={15} /></button></div>}
        <fieldset className="sk-content-fieldset" disabled={busy}>
          {page === "home" && renderHome()}
          {page === "intake" && <Intake initial={p.plan} initialName={p.learner_name || ""} askPersonality={!account.teachers.length} saving={busy} onFinish={async (plan, extra) => { if (await run(async () => {
            await save({ plan, minutes: plan.minutes, topic: plan.topic, track: "recommended", mode: "free", learner_name: extra.learner_name.trim(), ...(!active && botId ? { selected_bot: botId } : {}) });
            if (!account.teachers.length && defaultBase) {
              const fluent = plan.level === "fluent";
              const female = extra.teacher_gender === "female";
              const created = await portalRequest<Teacher>("/v1/portal/teachers", token, { name: female ? FEMALE_NAME : DEFAULT_NAME, base_bot: defaultBase.id, personality: extra.personality, voice: female ? "Aoede" : "Puck", explanation: "hebrew", pace: plan.level === "beginner" ? "slow" : "normal", corrections: "gentle", topic: plan.topic, material_id: "", level: plan.level, conversation_mode: fluent ? "conversation" : "guided", learning_load: "light", correction_policy: fluent ? "after_activity" : "after_answer", closing_activity: "roleplay" });
              await save({ active_teacher: created.id });
            }
          }, account.teachers.length ? "התוכנית שלך מחכה גם בטלפון." : (extra.teacher_gender === "female" ? "הכרנו לך את " + FEMALE_NAME + ". היא כבר מחכה בטלפון." : "הכרנו לך את " + DEFAULT_NAME + ". הוא כבר מחכה בטלפון."))) navigate("plan"); }} />}
          {page === "plan" && <div className="sk-plan"><div><h2>{topics[p.topic || p.plan?.topic || "recommended"]}<span className="sk-accent">, בוא נדבר.</span></h2><p>{teacherName} · {p.minutes || p.plan?.minutes || 10} דקות בכל פעם</p><p>רמת השיעור: {levelNames[(p.level || "beginner") as keyof typeof levelNames]} · {modeNames[(p.conversation_mode || "guided") as keyof typeof modeNames]}</p><p>{loadNames[(p.learning_load || "light") as keyof typeof loadNames]} · {p.track === "grammar" ? "תרגול דקדוק נפרד" : "ללא תרגול דקדוק ייעודי"}</p><div className="sk-actions"><button className="sk-primary" onClick={() => setPhoneOpen(true)}><Phone size={17} />התחל בטלפון</button><button className="sk-link" onClick={() => talk()}>התחל כאן <ArrowUpLeft size={15} /></button></div><button className="sk-quiet-link" onClick={() => navigate("intake")}>נשנה קצת את הכיוון?</button></div><ConversationArt /></div>}
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
          {page === "settings" && <PreferencesForm key={JSON.stringify(p)} preferences={p} account={account} onSave={input => void run(() => save(input), "סגור. השיחה הבאה תהיה בדרך שלך.")} onTeachers={() => navigate("teachers")} onMaterials={() => navigate("materials")} onLogout={logout} phonesPanel={<PhoneLinks account={account} token={token} onRefresh={refresh} />} subscriptionPanel={<SubscriptionPanel token={token} subscriptions={account.subscriptions} onRefresh={refresh} />} />}
          {page === "settings" && <Billing token={token} />}
        </fieldset>
      </main>}

    </div>
    {note && <div className="sk-toast" role="status"><Check size={16} />{note}</div>}
    {busy && <span className="sk-saving" role="status">רק רגע, שומרים…</span>}
    {phoneOpen && account && <Modal title="נתראה בצד השני של הקו." onClose={() => setPhoneOpen(false)}><p>מתקשרים מהמספר שמחובר לחשבון שלך, ומגיעים אל {teacherName}.</p><a className="sk-phone-number" href={"tel:" + account.phone} dir="ltr">{account.phone.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3")}<Phone size={23} /></a><p>מקישים <strong>1</strong> ונכנסים ישר לשיעור. מקש <strong>2</strong> הוא האזור האישי: מורה, סוג שיעור וחבילות.</p><div className="sk-phone-note"><Check size={16} />המורה, ההעדפות והמילים שלך כבר מחכים שם.</div><small>המספר המחובר: <bdi>{account.customer.phone}</bdi></small></Modal>}
    {voice && <Modal title="בוא נדבר." onClose={() => { setVoice(null); void refresh(); }}><VoiceRoom token={token} {...voice} onDone={() => { setVoice(null); void refresh(); }} /></Modal>}
    {builder && account && <Modal title="מורה. בדיוק בראש שלך." error={error} busy={busy} onClose={() => setBuilder(false)}><TeacherBuilder defaultBot={botId || baseTeachers[0]?.id || ""} materials={account.materials} onSave={async teacher => { if (await run(async () => { const saved = await portalRequest<Teacher>("/v1/portal/teachers", token, teacher); await save({ active_teacher: saved.id }); }, "נעים להכיר. המורה החדש שלך כבר בטלפון.")) setBuilder(false); }} onPreview={voiceName => {
      void run(async () => { const r = await portalRequest<{ audio_wav_base64: string }>("/v1/portal/voice-preview", token, { voice: voiceName }); const audio = new Audio("data:audio/wav;base64," + r.audio_wav_base64); await audio.play(); });
    }} /></Modal>}
  </div>;
};

function Empty({ icon, title, text, action, actionLabel }: { icon: React.ReactNode; title: string; text: string; action?: () => void; actionLabel?: string }) {
  return <div className="sk-empty"><div className="sk-empty-mark">{icon}</div><h2>{title}</h2><p>{text}</p>{action && <button className="sk-primary" onClick={action}>{actionLabel}<ArrowLeft size={16} /></button>}</div>;
}
type IntakeExtra = { learner_name: string; personality: string; teacher_gender: string };
function Intake({ initial, initialName, askPersonality, onFinish, saving }: { initial?: Plan; initialName: string; askPersonality: boolean; onFinish: (p: Plan, extra: IntakeExtra) => Promise<void>; saving: boolean }) {
  const [step, setStep] = useState(0);
  const [extra, setExtra] = useState<IntakeExtra>({ learner_name: initialName, personality: "warm", teacher_gender: "male" });
  const [named, setNamed] = useState(!!initialName);
  const [plan, setPlan] = useState<Plan>(initial || { goal: "travel", level: "beginner", difficulty: "speaking", minutes: 10, topic: "recommended" });
  const [thinking, setThinking] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  const questions: { key: string; title: string; sub: string; values: Record<string, string> }[] = [
    { key: "goal", title: "בשביל מה האנגלית שלך?", sub: "לא למבחן. לחיים שלך.", values: { work: "בשביל העבודה", travel: "בשביל החו״ל", study: "בשביל הלימודים" } },
    { key: "level", title: "איפה אתה היום?", sub: "אין כאן תשובה לא נכונה.", values: { beginner: "ממש בהתחלה", intermediate: "מסתדר איכשהו", fluent: "מדבר, רוצה לדייק" } },
    { key: "difficulty", title: "איפה זה נתקע?", sub: "שם בדיוק נתחיל.", values: { speaking: "כשצריך לדבר", listening: "כשמדברים אליי", writing: "כשצריך לכתוב" } },
    ...(askPersonality ? [{ key: "personality", title: "איזה מורה יעשה לך טוב?", sub: "אפשר להחליף מתי שבא לך.", values: personalities }, { key: "teacher_gender", title: "עם מי נוח לך יותר?", sub: "נתאים את הקול והשם.", values: { male: "עם מורה", female: "עם מורָה" } }] : []),
    { key: "minutes", title: "כמה זמן יש לך?", sub: "גם חמש דקות הן התחלה של משהו.", values: { "5": "חמש דקות", "10": "עשר דקות", "20": "עשרים דקות" } },
  ];
  const choose = (key: string, value: string) => { if (key === "personality" || key === "teacher_gender") setExtra(x => ({ ...x, [key]: value })); else setPlan(p => ({ ...p, [key]: key === "minutes" ? Number(value) : value })); setStep(n => n + 1); };
  const finish = (topic: string) => {
    const next = { ...plan, topic }; setPlan(next); setThinking(true);
    timeout.current = setTimeout(() => { void onFinish(next, extra).finally(() => setThinking(false)); }, 1600);
  };
  if (thinking || saving) return <div className="sk-thinking"><div className="sk-loading-shape" /><h2>מרכיבים לך תוכנית.</h2><p>קצת ממה שצריך. הרבה ממה שבא לך.</p></div>;
  if (!named) return <section className="sk-step-card"><h2>איך לקרוא לך?</h2><p>ככה המורה יפנה אליך.</p><form className="sk-name-form" onSubmit={e => { e.preventDefault(); setNamed(true); }}><input aria-label="השם שלך" maxLength={40} value={extra.learner_name} onChange={e => setExtra(x => ({ ...x, learner_name: e.target.value }))} placeholder="השם הפרטי שלך" autoFocus /><button className="sk-primary" type="submit">{extra.learner_name.trim() ? "נעים מאוד" : "אולי אחר כך"}</button></form></section>;
  const q = questions[step];
  const total = questions.length + 1;
  return <section className="sk-step-card"><div className="sk-step-top"><span>{step + 1} / {total}</span><div className="sk-step-dots">{Array.from({ length: total }, (_, n) => n).map(n => <i className={n <= step ? "is-done" : ""} key={n} />)}</div></div><h2>{q?.title || "על מה בא לך לדבר?"}</h2><p>{q?.sub || "משהו שתוכל להשתמש בו כבר מחר."}</p>{q ? <Options value={q.key === "personality" || q.key === "teacher_gender" ? extra[q.key] : String(plan[q.key as keyof Plan])} values={q.values as Record<string, string>} onChange={v => choose(q.key, v)} /> : <TopicPicker value={plan.topic} onChange={finish} recommended={["recommended", ...(plan.goal === "work" ? ["career", "business", "property", "everyday"] : plan.goal === "study" ? ["school", "academic", "medicine", "everyday"] : ["travel", "flights", "everyday"])]} />}{step === 0 && <button className="sk-quiet-link" onClick={() => choose("goal", "other")}>משהו אחר <MoreHorizontal size={14} /></button>}{step > 0 && <button className="sk-quiet-link" onClick={() => setStep(n => n - 1)}><ArrowRight size={13} />רגע, אחורה</button>}</section>;
}

function TeacherBuilder({ defaultBot, materials, onSave, onPreview }: { defaultBot: string; materials: Material[]; onSave: (t: Omit<Teacher, "id">) => Promise<void>; onPreview: (v: string) => void }) {
  const [step, setStep] = useState(0);
  const [teacher, setTeacher] = useState<Omit<Teacher, "id">>({ name: "", base_bot: defaultBot, personality: "warm", voice: "Aoede", explanation: "hebrew", pace: "normal", corrections: "gentle", topic: "recommended", material_id: "", level: "beginner", conversation_mode: "guided", learning_load: "light", correction_policy: "after_answer", closing_activity: "roleplay" });
  const update = (key: string, value: string) => setTeacher(t => ({ ...t, [key]: value, ...(key === "conversation_mode" && value === "roleplay" && t.correction_policy === "after_answer" ? { correction_policy: "after_activity" } : {}) }));
  const steps = [{ title: "איזה אופי יעשה לך טוב?", key: "personality", values: personalities }, { title: "איך זה נשמע לך?", key: "voice", values: Object.fromEntries(voices.map(v => [v.value, v.label])) }, { title: "איך נלמד יחד?", key: "conversation_mode", values: modeNames }, { title: "באיזה קצב נדבר?", key: "pace", values: paceNames }, { title: "מתי נתקן טעויות?", key: "correction_policy", values: teacher.conversation_mode === "roleplay" ? { on_request: correctionPolicies.on_request, after_activity: correctionPolicies.after_activity } : correctionPolicies }];
  const current = steps[step];
  return <div className="sk-builder"><p className="sk-eyebrow">צעד {step + 1} מתוך 7</p><div className="sk-builder-mark"><TeacherMark teacher={teacher} /></div><h3>{current?.title || (step === 5 ? "על מה נדבר?" : "איך נקרא למורה שלך?")}</h3>
    {current ? <Options values={current.values as Record<string, string>} value={teacher[current.key as keyof typeof teacher]} onChange={v => update(current.key, v)} /> : step === 5 ? <TopicPicker value={teacher.topic} onChange={v => update("topic", v)} /> : <>
      <LessonSettingsFields value={teacher} compact onChange={next => setTeacher(t => ({ ...t, ...next }))} />
      <label htmlFor="teacher-name">שם למורה</label><input id="teacher-name" maxLength={40} value={teacher.name} onChange={e => update("name", e.target.value)} placeholder="שם שכיף לך לשמוע" autoFocus />
      {materials.length > 0 && <label>מילים מהמגירה שלך<select value={teacher.material_id} onChange={e => update("material_id", e.target.value)}><option value="">הרשימה הפעילה שלי</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}</>}
    {step === 1 && <button className="sk-link" onClick={() => onPreview(teacher.voice)}><AudioLines size={16} />בוא נשמע רגע</button>}<div className="sk-actions"><button className="sk-primary" disabled={step === 6 && !teacher.name.trim()} onClick={() => { if (step < 6) setStep(n => n + 1); else void onSave(teacher); }}>{step === 6 ? "נעים להכיר. שומרים." : "ממשיכים"}<ArrowLeft size={16} /></button>{step > 0 && <button className="sk-link" onClick={() => setStep(n => n - 1)}>אחורה</button>}</div></div>;
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
function PreferencesForm({ preferences, account, onSave, onTeachers, onMaterials, onLogout, phonesPanel, subscriptionPanel }: { preferences: Preferences; account: Account; onSave: (p: Preferences) => void; onTeachers: () => void; onMaterials: () => void; onLogout: () => void; phonesPanel: React.ReactNode; subscriptionPanel: React.ReactNode }) {
  const [draft, setDraft] = useState<Preferences>({ pace: "normal", corrections: "gentle", minutes: 10, language: "", track: "recommended", topic: "recommended", store_transcripts: false, ...preferences });
  const change = (key: string, value: string | boolean | number) => setDraft(p => ({ ...p, [key]: value }));
  return <form className="sk-settings" onSubmit={e => { e.preventDefault(); const { active_teacher, selected_bot, ...values } = draft; onSave(values); }}><div className="sk-setting-row"><span>המורה שלי<small>מורה אחד, שמחכה לך בקו</small></span><button type="button" className="sk-link" onClick={onTeachers}>למורים שלי<ArrowUpLeft size={15} /></button></div>
    <Setting title="מסלול תרגול" value={tracks[draft.track || "recommended"]}><Options values={Object.fromEntries(Object.entries(tracks).slice(0, 3))} value={draft.track} onChange={v => change("track", v)} /><Options values={{ grammar: tracks.grammar }} value={draft.track} onChange={v => change("track", v)} />{draft.track === "grammar" && <fieldset><legend>מה נתרגל? עד שלוש מיומנויות</legend>{Object.entries(grammarNames).map(([id, label]) => <label key={id}><input type="checkbox" checked={(draft.grammar_targets || ["present"]).includes(id)} onChange={e => {
      const current = draft.grammar_targets || ["present"];
      const next = e.target.checked ? [...current, id] : current.filter(v => v !== id);
      if (next.length > 0 && next.length <= 3) setDraft(p => ({ ...p, grammar_targets: next }));
    }} />{label}</label>)}</fieldset>}</Setting>
    <Setting title="רמה וסגנון למידה" value={modeNames[(draft.conversation_mode || "guided") as keyof typeof modeNames]}><div className="sk-tags"><button type="button" className="sk-link" onClick={() => setDraft(p => ({ ...p, level: "beginner", conversation_mode: "guided", pace: "slow", learning_load: "light", correction_policy: "after_answer", closing_activity: "roleplay" }))}>צעדים ראשונים</button><button type="button" className="sk-link" onClick={() => setDraft(p => ({ ...p, level: "intermediate", conversation_mode: "conversation", pace: "normal", learning_load: "normal", correction_policy: "after_activity", closing_activity: "roleplay" }))}>לומדים בשיחה</button><button type="button" className="sk-link" onClick={() => setDraft(p => ({ ...p, level: "fluent", conversation_mode: "roleplay", pace: "normal", learning_load: "light", correction_policy: "after_activity", closing_activity: "roleplay" }))}>סימולציה מתקדמת</button></div><LessonSettingsFields value={{ level: draft.level || draft.plan?.level || "beginner", ...draft }} onChange={next => setDraft(p => ({ ...p, ...next }))} /></Setting>
    <Setting title="על מה נדבר?" value={topics[draft.topic || "recommended"]}><TopicPicker value={draft.topic} onChange={v => change("topic", v)} /></Setting>
    <Setting title="קצב דיבור" value={paceNames[draft.pace || "normal"]}><Options values={paceNames} value={draft.pace} onChange={v => change("pace", v)} /></Setting>
    <Setting title="כמה זמן בכל פעם?" value={draft.minutes + " דקות"}><Options values={{ "5": "5 דקות", "10": "10 דקות", "20": "20 דקות" }} value={String(draft.minutes)} onChange={v => change("minutes", Number(v))} /></Setting>
    <Setting title="שפת התרגום" value={draft.language || "זיהוי אוטומטי"}><label>השפה שלך<select value={draft.language} onChange={e => change("language", e.target.value)}><option value="">זיהוי אוטומטי</option>{["English", "Hebrew", "Yiddish", "Arabic", "Russian", "French"].map(l => <option key={l}>{l}</option>)}</select></label></Setting>
    <div className="sk-setting-row"><span>אוצר המילים שלי<small>{account.materials.length} רשימות שמורות</small></span><button type="button" className="sk-link" onClick={onMaterials}>לרשימות שלי<ArrowUpLeft size={15} /></button></div>
    <Setting title="טלפונים מחוברים" value={account.customer.phone}>{phonesPanel}</Setting>
    <Setting title="החבילה שלי" value={remainingMinutes(account) + " דקות בחבילה"}>{futureMinutes(account) > 0 && <p>{futureMinutes(account)} דקות לתקופות עתידיות (עדיין לא זמינות)</p>}{account.receipts.length ? account.receipts.map(r => <p key={r.id}>{r.minutes} דקות · {r.product === "school" ? "בית הספר" : "תרגומון"}{r.valid_from && new Date(r.valid_from).getTime() > Date.now() ? <> · זמינות מ־{lessonDate(r.valid_from)}</> : null} · עד {lessonDate(r.expires_at)}</p>) : <p>עדיין אין חבילה בתשלום בחשבון.</p>}<a className="sk-link" href={"tel:" + account.phone}>להוספת דקות: חייגו, הקישו 2 ואז 3 <Phone size={15} /></a></Setting>
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
