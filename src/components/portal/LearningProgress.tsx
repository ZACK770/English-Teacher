import { useCallback, useEffect, useRef, useState } from "react";
import { Account, portalRequest, topics } from "./portalApi";
import "./learning-progress.css";

type Item = { kind: string; id: string; text: string; meaning_he: string; domain: string; level: string; usage_example?: string; score: number | null; attempts: number; exposures: number; last_practiced: string | null; mastered: boolean; status: string };
type Report = { items: Item[]; domains: { domain: string; archived: boolean; total: number; assessed: number; mastered: number; coverage: number; mastery: number; average_score: number | null }[]; scoring: string; syllabus: string; last_lesson: { created_at: string; target_count: number; result_count: number; status: string } | null };
type Attempt = { score: number; created_at: string; activity_id: string; call_id: string };
const statuses: Record<string, string> = { unassessed: "מוכנה לתרגול", initial: "צעד ראשון בדרך", developing: "מתבסס", mastered: "שליטה מבוססת" };
const wordLevels: Record<string, string> = { beginner: "מתחיל", intermediate: "בינוני", fluent: "מתקדם", custom: "רשימה אישית" };
const date = (s: string) => new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

function Conversation({ callId, token }: { callId: string; token: string }) {
  const [transcript, setTranscript] = useState<{ role: string; text: string }[] | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try { const r = await portalRequest<{ transcript: { role: string; text: string }[] | null }>("/v1/portal/sessions/" + encodeURIComponent(callId) + "/transcript", token); setTranscript(r.transcript); }
    catch { setError("טעינת השיחה התעכבה. אפשר לנסות שוב."); }
    finally { setBusy(false); }
  };
  return <div className="sk-attempt-conversation">{transcript === undefined ? <button className="sk-link" disabled={busy} onClick={() => void load()}>{busy ? "טוענים את השיחה…" : "מה המורה אמר ומה אמרתי?"}</button> : transcript?.length ? <details open><summary>מתוך השיחה המלאה</summary>{transcript.map((line, i) => <div className="sk-conversation-quote" key={i}><strong>{line.role === "learner" ? "אני" : "המורה"}</strong><blockquote dir="auto">{line.text}</blockquote></div>)}</details> : <p className="sk-progress-meta">רגעי התרגול נשמרו בציונים. לשמירת המילים המדויקות מהשיחות הבאות אפשר להפעיל שמירת שיחות בהעדפות.</p>}{error && <p role="alert">{error}</p>}</div>;
}

function WordDetails({ item, token }: { item: Item; token: string }) {
  const [history, setHistory] = useState<Attempt[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setHistory(null); setError("");
    void portalRequest<{ history: Attempt[] }>("/v1/portal/learning/history?kind=" + item.kind + "&id=" + encodeURIComponent(item.id), token)
      .then(r => { if (active) setHistory(r.history); })
      .catch(() => { if (active) setError("הפרטים שמורים. טעינת היסטוריית התרגול התעכבה."); });
    return () => { active = false; };
  }, [item.id, item.kind, token, retry]);
  return <div className="sk-word-details">
    <p className="sk-word-meaning">{item.meaning_he || "המשמעות מתבהרת דרך השיחה והתרגול."}</p>
    <span className="sk-tag">{statuses[item.status] || "בדרך לשליטה"}{item.score !== null && ` · ${item.score}/100`}</span>
    {item.usage_example && <section className="sk-word-example"><h3>ככה משתמשים במילה</h3><blockquote dir="auto">{item.usage_example}</blockquote></section>}
    <section><h3>הדרך שלך עם המילה</h3><p className="sk-progress-meta">{item.attempts} ניסיונות עצמאיים · {item.exposures} חשיפות בשיחות · {wordLevels[item.level] || item.level}</p><p className="sk-progress-meta">{item.last_practiced ? "תרגול אחרון: " + date(item.last_practiced) : "התרגול הבא הוא הזדמנות להתחיל לבסס שליטה."}</p>
      {error ? <div role="alert"><p>{error}</p><button className="sk-link" onClick={() => setRetry(n => n + 1)}>טעינה מחדש</button></div> : history === null ? <p role="status">טוענים את רגעי התרגול…</p> : history.length === 0 ? <p>כאן יופיעו הניסיונות העצמאיים שלך אחרי התרגול. כל שיחה היא צעד קדימה.</p> : <ol className="sk-attempts">{history.map((h, i) => <li key={i}><strong>{h.activity_id === "practice-1" ? "תרגול עצמאי" : "פעילות סיכום"}</strong><span className="sk-tag">{h.score}/100</span><small>{date(h.created_at)}</small>{h.call_id && <Conversation callId={h.call_id} token={token} />}</li>)}</ol>}
    </section>
  </div>;
}

export function LearningProgress({ token, account }: { token: string; account: Account }) {
  const [report, setReport] = useState<Report | null>(null);
  const [levelFilter, setLevelFilter] = useState("");
  const [error, setError] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [word, setWord] = useState<Item | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    try { setError(""); setReport(await portalRequest<Report>("/v1/portal/learning", token)); }
    catch { setError("טעינת ההתקדמות התעכבה. אפשר לנסות שוב."); }
  }, [token]);
  useEffect(() => { void load(); }, [load, account.progress.session_count]);
  const opened = domain !== null || word !== null;
  useEffect(() => {
    if (!opened) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; dialog.current?.close(); trigger.current?.focus(); };
  }, [opened]);
  const close = () => { setDomain(null); setWord(null); };
  const name = (id: string) => topics[id] || account.materials.find(m => "material:" + m.id === id)?.name || "רשימה קודמת";
  if (error) return <div role="alert">{error}<button className="sk-link" onClick={() => void load()}>ננסה שוב</button></div>;
  if (!report) return <p role="status">טוענים את ההתקדמות…</p>;
  const words = report.items.filter(t => t.kind === "vocabulary" && t.domain === domain && (!levelFilter || t.level === levelFilter));
  return <section className="sk-learning-progress"><h2>מילים שהופכות לשלך.</h2><p>{report.syllabus}</p>
    {report.last_lesson && <aside className="sk-setting" role="status"><strong>השיחה האחרונה · {date(report.last_lesson.created_at)}</strong><p>{report.last_lesson.status === "no_targets" ? "עוד שיחה של חשיפה לאנגלית. בתרגול הבא אפשר להתקדם גם עם מילים ממוקדות." : report.last_lesson.status === "no_evidence" ? `${report.last_lesson.target_count} מילים מחכות לתרגול עצמאי. החשיפה בשיחה היא הצעד הראשון.` : `תרגלת ${report.last_lesson.result_count} מילים. ההתקדמות שלך מחכה בתחומים למטה.`}</p></aside>}
    <div className="sk-domain-grid">{report.domains.map(d => <button className="sk-domain-card" key={d.domain} onClick={e => { trigger.current = e.currentTarget; setLevelFilter(""); setDomain(d.domain); }} aria-haspopup="dialog"><strong>{name(d.domain)}{d.archived ? " — היסטוריה" : ""}</strong><span className="sk-domain-count"><b>{d.assessed}</b> מילים תרגלת מתוך {d.total}</span><small>נחשפת ל־{report.items.filter(t => t.kind === "vocabulary" && t.domain === d.domain && t.exposures > 0).length} מילים ברשימה המוצגת</small>{d.archived ? <small>רגעי התרגול שלך שמורים כאן.</small> : <><meter min={0} max={100} value={d.coverage} aria-label={"התקדמות התרגול ב" + name(d.domain)} /><small>{d.mastered > 0 ? `${d.mastered} מילים כבר בשליטה מלאה · ` : "כל תרגול מקרב אותך · "}{d.total > 0 && d.mastered >= d.total ? "כל הכבוד, הגעת לשליטה מלאה!" : `עוד ${Math.max(1, Math.round(100 - d.mastery))}% מהמילים לשליטה מלאה`}</small></>}<span className="sk-domain-open">למילים ולרגעי ההצלחה ←</span></button>)}</div>
    {report.domains.length === 0 && <p>כאן יצמח אוצר המילים שלך. מתחילים בשיחה הראשונה.</p>}
    <h2>גם הדקדוק מתקדם.</h2><p>כאן אוספים הצלחות ממסלול הדקדוק.</p><div className="sk-word-grid">{report.items.filter(t => t.kind === "grammar").map(t => <button className="sk-word-chip" key={t.id} onClick={e => { trigger.current = e.currentTarget; setWord(t); }} aria-haspopup="dialog">{t.text}</button>)}</div>
    <details className="sk-setting"><summary>איך מחשבים?</summary><p>{report.scoring}</p><p>ציוני המורה: 100 — עצמאי ונכון; 50 — חלקי או עם רמז משמעותי; 0 — ניסיון שניתן היה לבדוק ולא הצליח. אלו הערכות מורה שיכוילו מול שיחות אמיתיות. נקודות עידוד אינן ציון ידע.</p><p>ציון מילה הוא ביצוע בשיחה, לא אחוז ידיעה של כל האנגלית. הרמות הן דירוג קושי ראשוני, ואת רמת השיעור משנים בהעדפות.</p></details>
    <dialog ref={dialog} className="sk-progress-dialog" dir="rtl" aria-labelledby="sk-progress-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
      <div className="sk-progress-dialog-body"><header><div>{word && domain && <button className="sk-link" onClick={() => setWord(null)}>→ חזרה לכל המילים</button>}<p className="sk-progress-meta">{word ? "מילה אחת, עוד צעד קדימה" : "אוצר המילים שלך"}</p><h2 id="sk-progress-title" dir="auto">{word ? word.text : domain ? name(domain) : ""}</h2></div><button className="sk-dialog-close" aria-label="סגירה" onClick={close} autoFocus>×</button></header>
        {word ? <WordDetails key={word.kind + word.id} item={word} token={token} /> : <><p>בוחרים מילה ומגלים את המשמעות ואת רגעי התרגול שלה.</p><label className="sk-progress-filter">רמה<select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}><option value="">כל הרמות</option>{Object.entries(wordLevels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><div className="sk-word-grid">{words.map(t => <button className="sk-word-chip" key={t.id} onClick={() => setWord(t)} aria-label={t.text + (t.mastered ? " — בשליטה מלאה" : " — פרטי מילה")}><span dir="auto">{t.text}</span>{t.mastered && <span className="sk-mastery-dot" aria-hidden="true" />}</button>)}</div>{words.length === 0 && <p>המילים הבאות מחכות לך ברמה אחרת. אפשר לבחור בכל הרמות ולהמשיך לגלות.</p>}</>}
      </div>
    </dialog>
  </section>;
}
