import { useCallback, useEffect, useState } from "react";
import { Account, portalRequest, topics } from "./portalApi";

type Item = { kind: string; id: string; text: string; meaning_he: string; domain: string; level: string; usage_example?: string; score: number | null; attempts: number; exposures: number; last_practiced: string | null; mastered: boolean; status: string };
type Report = { items: Item[]; domains: { domain: string; archived: boolean; total: number; assessed: number; mastered: number; coverage: number; mastery: number; average_score: number | null }[]; scoring: string; syllabus: string; last_lesson: { created_at: string; target_count: number; result_count: number; status: string } | null };
const statuses: Record<string, string> = { unassessed: "טרם נבדק", initial: "ציון ראשוני", developing: "מתבסס", mastered: "שליטה מבוססת" };
const wordLevels: Record<string, string> = { beginner: "מתחיל", intermediate: "בינוני", fluent: "מתקדם", custom: "רשימה אישית ללא דירוג קושי" };
const date = (s: string) => new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

function TargetRow({ item, token }: { item: Item; token: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<{ score: number; created_at: string; activity_id: string }[] | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    setOpen(!open);
    if (!open && !history) {
      try { setError(""); const r = await portalRequest<{ history: NonNullable<typeof history> }>("/v1/portal/learning/history?kind=" + item.kind + "&id=" + encodeURIComponent(item.id), token); setHistory(r.history); }
      catch { setError("לא הצלחנו לטעון את הפרטים. אפשר לסגור ולנסות שוב."); }
    }
  };
  return <article className="sk-target"><button className="sk-target-row" aria-expanded={open} onClick={() => void load()}><span><strong dir="auto">{item.text}</strong><small>{item.meaning_he}</small><small>{wordLevels[item.level] || item.level}</small></span><span><strong>{item.score === null ? "—" : item.score}</strong><small>{statuses[item.status]}</small></span></button>{open && <div className="sk-target-detail">{item.usage_example && <p dir="ltr">{item.usage_example}</p>}<p>{item.attempts} בדיקות · המורה השתמש בה {item.exposures} פעמים</p><p>תרגול אחרון: {item.last_practiced ? date(item.last_practiced) : "עדיין אין בדיקה מתועדת"}</p>{error && <p role="alert">{error}</p>}{history?.length === 0 && <p>עוד לא נבדקה. חזרה מיד אחרי המורה לא נחשבת.</p>}{history?.map((h, i) => <p key={i}>{date(h.created_at)} · {h.activity_id === "practice-1" ? "תרגול" : "פעילות סיכום"} · ציון {h.score}</p>)}</div>}</article>;
}

export function LearningProgress({ token, account }: { token: string; account: Account }) {
  const [report, setReport] = useState<Report | null>(null);
  const [levelFilter, setLevelFilter] = useState("");
  const [error, setError] = useState("");
  const [domain, setDomain] = useState(account.preferences.material_id ? "material:" + account.preferences.material_id : account.preferences.topic || account.preferences.plan?.topic || "everyday");
  const load = useCallback(async () => {
    try { setError(""); setReport(await portalRequest<Report>("/v1/portal/learning", token)); }
    catch { setError("לא הצלחנו לטעון את ההתקדמות."); }
  }, [token]);
  useEffect(() => { void load(); }, [load, account.progress.session_count]);
  useEffect(() => {
    if (report && !report.domains.some(d => d.domain === domain)) setDomain(report.domains.find(d => d.domain === account.preferences.topic)?.domain || report.domains[0]?.domain || "everyday");
  }, [report, domain, account.preferences.topic]);
  const name = (id: string) => topics[id] || account.materials.find(m => "material:" + m.id === id)?.name || "רשימה קודמת";
  if (error) return <div role="alert">{error}<button className="sk-link" onClick={() => void load()}>ננסה שוב</button></div>;
  if (!report) return <p role="status">טוענים את ההתקדמות…</p>;
  return <section className="sk-learning-progress"><h2>מילים שהופכות לשלך.</h2><p>{report.syllabus}</p>
    {report.last_lesson && <aside className="sk-setting" role="status"><strong>השיחה האחרונה · {date(report.last_lesson.created_at)}</strong><p>{report.last_lesson.status === "no_targets" ? "בשיחה הזאת לא היו מילים לבדיקה, אז אין לה ציונים." : report.last_lesson.status === "no_evidence" ? `היו ${report.last_lesson.target_count} מילים לבדיקה, אבל עוד אין עליהן תשובה עצמאית. אין ציון זה לא אפס.` : `נבדקו ${report.last_lesson.result_count} מילים. הציונים כבר למטה.`}</p></aside>}
    <div className="sk-domain-grid">{report.domains.map(d => <button className={"sk-domain-card " + (domain === d.domain ? "is-current" : "")} key={d.domain} onClick={() => setDomain(d.domain)} aria-pressed={domain === d.domain}><strong>{name(d.domain)}{d.archived ? " — היסטוריה" : ""}</strong><span className="sk-domain-count"><b>{d.assessed}</b>/{d.total} נבדקו</span>{d.archived ? <small>הרשימה נמחקה. נשארה רק ההיסטוריה.</small> : <><meter min={0} max={100} value={d.coverage} aria-label={"כיסוי בדיקה ב" + name(d.domain)} /><small>{d.mastered ? d.mastered + " בשליטה מלאה" : "עוד אין מילה בשליטה מלאה"}</small></>}</button>)}</div>
    <h3>{name(domain)}</h3>
    <label>רמה<select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}><option value="">כל הרמות</option>{Object.entries(wordLevels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <div>{report.items.filter(t => t.kind === "vocabulary" && t.domain === domain && (!levelFilter || t.level === levelFilter)).map(t => <TargetRow item={t} token={token} key={t.id} />)}</div>
    {!report.items.some(t => t.kind === "vocabulary" && t.domain === domain && (!levelFilter || t.level === levelFilter)) && <p>אין בתחום הזה פריטים ברמה שנבחרה להצגה.</p>}
    <h2>דקדוק — בנפרד.</h2><p>ציוני דקדוק מגיעים רק ממסלול דקדוק.</p>{report.items.filter(t => t.kind === "grammar").map(t => <TargetRow item={t} token={token} key={t.id} />)}
    <details className="sk-setting"><summary>איך מחשבים?</summary><p>{report.scoring}</p><p>ציוני המורה: 100 — עצמאי ונכון; 50 — חלקי או עם רמז משמעותי; 0 — ניסיון שניתן היה לבדוק ולא הצליח. אלו הערכות מורה שיכוילו מול שיחות אמיתיות. נקודות עידוד אינן ציון ידע.</p><p>ציון מילה הוא ביצוע בשיחה, לא אחוז ידיעה של כל האנגלית. הרמות הן דירוג קושי ראשוני, ואת רמת השיעור משנים בהעדפות.</p></details></section>;
}
