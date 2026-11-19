import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { clearEntryChallenges, EntryDialog, type EntryChannel, type EntryMode } from "./QuickEntry";
import { saveLearnerToken } from "./learnerToken";
import { resumeLearnerSession } from "./portalApi";
import { PHONE_LINE } from "./LearnerPortal";
import { LegalFooter } from "../legal/LegalFooter";
import { legalBasePath } from "../../legalRoutes";
import { LessonCallbackForm } from "./LessonCallbackForm";
import { SpeakCallLogo } from "../brand/SpeakCallLogo";
import "./portal.css";
import "./landing.css";
import { FREE_TIER_TEXT, MONTHLY_TERMS, MASTERY_GUARANTEE, PRICING_PACKAGES } from "../../pricing";

const faq = [
  ["מה מקבלים בחינם?", FREE_TIER_TEXT + ". בלי כרטיס אשראי."],
  ["מה אם אני נתקע באנגלית?", "אפשר לשאול בעברית ולקבל רמז, ואז לנסות שוב באנגלית. המורה מתאים את השיחה לקצב שלך."],
  ["מה שונה כאן משיחה רגילה עם AI?", "מתרגלים מילים לפי נושא ורמה, וחוזרים אליהן בהקשר אחר. חזרה אחרי המורה היא תרגול; שליטה נמדדת לפי שימוש עצמאי בשיחות שונות."],
  ["צריך אינטרנט?", "לא. מספיק טלפון רגיל, גם כשר. מי שרוצה יכול לדבר גם מהמחשב."],
  ["למה השיחה מוגבלת בזמן?", "שיחות קצרות ותכופות נדבקות יותר משיעור ארוך פעם בשבוע. במסלולים הגבוהים השיחה ארוכה יותר."],
  ["מה קורה כשהזמן נגמר?", "המורה מודיע לפני הסוף, מסכם, שומר את מה שלמדת ונפרד. שום דבר לא הולך לאיבוד."],
  ["איך משלמים?", "בכרטיס אשראי באתר, בדף המאובטח של נדרים פלוס: מנוי חודשי מתחדש בהוראת קבע וניתן לביטול בכל עת, ומסלולי השליטה אפשר לחלק לתשלומים. תוספת דקות ותרגומון אפשר לרכוש גם בטלפון, מקש 3."],
];

const domains = [
  { title: "נסיעות", mastered: 68, practicing: 20, terms: "Boarding pass · Reservation · Directions" },
  { title: "עבודה", mastered: 54, practicing: 26, terms: "Deadline · Follow up · Proposal" },
  { title: "יומיום", mastered: 82, practicing: 12, terms: "Actually · Makes sense · By the way" },
];

export function SpeakoolLanding() {
  const base = legalBasePath(location.pathname);
  const learn = base + "/learn";
  const [entry, setEntry] = useState<EntryMode | null>(() => {
    const saved = new URLSearchParams(location.search).get("entry");
    return saved === "trial" || saved === "login" ? saved : location.hash === "#computer-call" ? "trial" : null;
  });
  const [channel, setChannel] = useState<EntryChannel>(() => new URLSearchParams(location.search).get("via") === "email" || location.hash === "#computer-call" ? "email" : "phone");
  const [legacyCallback, setLegacyCallback] = useState(location.hash === "#lesson-phone");
  const heroButton = useRef<HTMLButtonElement>(null);
  const entryOpener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    let disposed = false;
    const resume = () => {
      if (location.pathname === learn) return;
      void resumeLearnerSession().then(valid => {
        if (!valid || disposed) return;
        history.replaceState(null, "", learn);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    };
    resume();
    window.addEventListener("popstate", resume);
    return () => { disposed = true; window.removeEventListener("popstate", resume); };
  }, [learn]);
  const tel = "tel:" + PHONE_LINE.replace(/-/g, "");
  const [domain, setDomain] = useState(0);
  const progress = domains[domain];
  useEffect(() => {
    const showHash = () => {
      setLegacyCallback(location.hash === "#lesson-phone");
      if (location.hash === "#computer-call") { setChannel("email"); setEntry("trial"); }
      const section = document.getElementById(location.hash.slice(1));
      if (section?.closest(".sk-land")) section.scrollIntoView();
    };
    showHash();
    window.addEventListener("hashchange", showHash);
    return () => window.removeEventListener("hashchange", showHash);
  }, [legacyCallback]);
  function showEntry(mode: EntryMode | null, via: EntryChannel = "phone") {
    const url = new URL(location.href);
    if (mode) {
      url.searchParams.set("entry", mode);
      url.searchParams.set("via", via);
    } else {
      url.searchParams.delete("entry");
      url.searchParams.delete("via");
      if (url.hash === "#computer-call") url.hash = "";
      clearEntryChallenges();
    }
    history.replaceState(null, "", url);
    setChannel(via);
    setEntry(mode);
  }
  function openEntry(mode: EntryMode, button: HTMLButtonElement) {
    entryOpener.current = button;
    showEntry(mode);
  }
  return <div className="speakool sk-land" dir="rtl">
    <header className="sk-shell sk-land-head">
      <a className="sk-land-brand" href={base + "/"} aria-label="SpeakCall — עמוד הבית"><SpeakCallLogo /></a>
      <nav aria-label="ניווט ראשי"><a href="#how">השיטה</a><a href="#plans">מסלולים</a><a className="sk-land-blog" href={base + "/blog"}>מאמרים</a><button type="button" className="sk-land-login" onClick={e => openEntry("login", e.currentTarget)}>כניסה</button></nav>
    </header>
    <main>
      <section className="sk-shell sk-land-hero" aria-labelledby="landing-heading">
        <div className="sk-land-hero-copy">
          <h1 id="landing-heading">פשוט לדבר <span>באנגלית.</span></h1>
          <p className="sk-land-lede">שיעור ראשון של 10 דקות עם מורה AI.<br />בלי כרטיס אשראי.</p>
          <div className="sk-land-hero-actions"><button ref={heroButton} type="button" className="sk-primary" onClick={e => openEntry("trial", e.currentTarget)}>להתנסות בחינם <ArrowLeft aria-hidden="true" size={19} /></button><a href={tel}>לחייג בעצמי</a></div>
        </div>
        <div className="sk-land-hero-art" aria-hidden="true">
          <img className="sk-land-voice-art" src="/brand/teachers/voice-hero.png" width="320" height="270" alt="" />
        </div>
      </section>
      <section id="free-lesson" className="sk-shell sk-land-offer" aria-labelledby="free-lesson-title">
        <div className="sk-land-offer-panel">
          <div>
            <p className="sk-land-kicker">שיעור ראשון בחינם</p>
            <h2 id="free-lesson-title">עשר דקות. בלי הרצאות.</h2>
            <p>בוחרים נושא ומדברים בקצב שלך. המורה עוזר כשנתקעים ובסוף מסכם מה כדאי לתרגל בפעם הבאה.</p>
            <div className="sk-land-cta"><button type="button" className="sk-primary" onClick={e => openEntry("trial", e.currentTarget)}>להתנסות בחינם <ArrowLeft aria-hidden="true" size={17} /></button></div>
            {legacyCallback && <LessonCallbackForm tel={tel} privacy={base + "/privacy"} />}
          </div>
          <div className="sk-land-clock" aria-hidden="true">
            <strong>10</strong><span>דקות · חינם</span>
          </div>
        </div>
      </section>
      <section id="how" className="sk-shell sk-land-steps">
        <p className="sk-land-kicker">שיטת ספיקול</p>
        <h2>השיחה חופשית. התרגול לא מקרי.</h2>
        <ol>
          <li><img className="sk-land-step-icon" src="/brand/teachers/listen.png" width="30" height="30" alt="" /><b>01</b><h3>שומעים בהקשר</h3><p>בוחרים נושא שחשוב לך. פוגשים מילים בתוך שיחה, לא בתוך רשימה.</p></li>
          <li><img className="sk-land-step-icon" src="/brand/teachers/speak.png" width="30" height="30" alt="" /><b>02</b><h3>מנסים בקול</h3><p>המורה נותן רמז כשנתקעים ומשאיר לך את התור לדבר.</p></li>
          <li><img className="sk-land-step-icon" src="/brand/teachers/repeat.png" width="30" height="30" alt="" /><b>03</b><h3>חוזרים בשיחה אחרת</h3><p>בודקים מה כבר נשלף לבד ומה כדאי לחזק. לא מסמנים שליטה רק כי חזרת אחרי המורה.</p></li>
        </ol>
      </section>
      <section className="sk-shell sk-land-example">
        <div className="sk-land-demo">
          <p className="sk-land-kicker">הצצה לשיחה</p>
          <h2>מרמז קטן למילה שיוצאת לבד.</h2>
          <div className="sk-land-chat">
            <p><b>בשיעור הראשון</b>איך אומרים ״הספקתי המון״?</p>
            <p><b>המורה</b><bdi lang="en">I got a lot done.</bdi> אז מה הספקת הבוקר?</p>
            <p><b>בשיחה אחרת · בלי רמז</b><bdi lang="en">I got a lot done. I unpacked the whole kitchen.</bdi></p>
          </div>
        </div>
        <div className="sk-land-progress">
          <p className="sk-land-kicker">מד שליטה לדוגמה</p>
          <h2>לא מנחשים אם מתקדמים.</h2>
          <div className="sk-land-domains" role="group" aria-label="בחירת תחום לדוגמה">
            {domains.map((item, i) => <button type="button" key={item.title} aria-pressed={i === domain} onClick={() => setDomain(i)}>{item.title}</button>)}
          </div>
          <div aria-live="polite">
            <p className="sk-land-meter"><strong>{progress.mastered}%</strong> מהמילים נשלפות לבד</p>
            <div className="sk-land-meter-track" aria-hidden="true"><span style={{ width: `${progress.mastered}%` }} /><span style={{ width: `${progress.practicing}%` }} /></div>
            <p>{progress.practicing}% בחיזוק · {100 - progress.mastered - progress.practicing}% טרם נבדקו</p>
            <p dir="ltr" lang="en" className="sk-land-terms">{progress.terms}</p>
          </div>
          <small>נתונים להמחשה בלבד, לא ציון כללי באנגלית.</small>
        </div>
      </section>
      <section id="plans" className="sk-shell sk-land-plans">
        <h2>משלמים על דיבור. לא על חוברות.</h2>
        <article><h3>מתחילים בחינם</h3><p>{FREE_TIER_TEXT}. ללא כרטיס אשראי.</p><a className="sk-secondary" href={learn}>להתחיל עכשיו</a></article>
        <h3>מנויים חודשיים · הוראת קבע</h3>
        <p>{MONTHLY_TERMS}</p>
        <div className="sk-land-grid">{PRICING_PACKAGES.filter(p => p.billing === "monthly").map(p => <article key={p.id} className={p.recommended ? "is-pro" : ""}>
          {p.recommended && <em>מומלץ</em>}<h3>{p.name}</h3><p className="sk-land-line">{p.tagline}</p>
          <div className="sk-land-price"><strong>{p.price_ils}</strong><span>₪ לחודש</span></div>
          <ul><li>{p.minutes} דקות בחודש</li><li>עד {p.max_call_minutes} דקות לשיחה</li><li>שנתי: ₪{p.annual_price_ils} · מחיר של 10 חודשים</li></ul>
          <a className={p.recommended ? "sk-primary" : "sk-secondary"} href={learn + "?plan=" + p.id}>להצטרפות · ₪{p.price_ils} לחודש</a>
        </article>)}</div>
        <h3>מסלול שליטה · מחיר קבוע, אפשרות לתשלומים</h3>
        <div className="sk-land-grid">{PRICING_PACKAGES.filter(p => p.duration_months).map(p => <article key={p.id} className={p.recommended ? "is-pro" : ""}>
          {p.recommended && <em>מומלץ</em>}<h3>{p.name}</h3><p>{p.tagline}</p>
          <div className="sk-land-price"><strong>₪{p.price_ils.toLocaleString("he-IL")}</strong><span>ל־{p.duration_months} חודשים</span></div>
          <p>במקום ₪{p.anchor_price_ils?.toLocaleString("he-IL")}</p><small>לעומת מנוי שוטף לאותה תקופה</small>
          <ul><li>עד {p.minutes} דקות בחודש</li><li>עד {p.max_call_minutes} דקות לשיחה</li></ul>
          <a className={p.recommended ? "sk-primary" : "sk-secondary"} href={learn + "?plan=" + p.id}>להצטרפות · עד {p.duration_months} תשלומים</a>
        </article>)}</div>
        <p>{MASTERY_GUARANTEE}</p>
        <h3>תוספות ורכישה חד־פעמית</h3>
        <div className="sk-land-grid">{PRICING_PACKAGES.filter(p => p.automated_purchase).map(p => <article key={p.id}>
          <h3>{p.name}</h3><div className="sk-land-price"><strong>₪{p.price_ils}</strong><span>חד־פעמי</span></div>
          <p>{p.minutes} דקות · תוקף {p.validity_days} ימים</p><p>{p.tagline}</p>
          {p.product === "school" && <p>עד {p.max_call_minutes} דקות לשיחה</p>}
          <a className="sk-secondary" href={tel}>לרכישה בטלפון, מקש 3</a>
        </article>)}</div>
        <p>תוספת משפחתית: ₪39 לחודש לכל בן משפחה נוסף · הצטרפות דרך נציג.</p>
        <small>כל המחירים כוללים מע״מ. התשלום בכרטיס אשראי בדף המאובטח של נדרים פלוס.</small>
      </section>
      <section className="sk-shell sk-land-faq"><h2>שאלות שכולם שואלים</h2>{faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
      <section className="sk-shell sk-land-final"><h2>פחות לתרגם. יותר לדבר.</h2><button type="button" className="sk-primary" onClick={e => openEntry("trial", e.currentTarget)}>להתנסות בחינם <ArrowLeft aria-hidden="true" size={18} /></button></section>
    </main>
    <footer className="sk-shell sk-land-foot"><a className="sk-land-brand" href={base + "/"} aria-label="SpeakCall — עמוד הבית"><SpeakCallLogo /></a><a href={base + "/blog"}>מאמרים</a><a href="mailto:support@speakcall.app">תמיכה: <bdi>support@speakcall.app</bdi></a><a href={tel}>{PHONE_LINE}</a></footer>
    <LegalFooter />
    {entry && <EntryDialog mode={entry} channel={channel} onChannel={via => showEntry(entry, via)}
      privacy={base + "/privacy"} onClose={() => {
        showEntry(null);
        (entryOpener.current || heroButton.current)?.focus({ preventScroll: true });
        entryOpener.current = null;
      }}
      onToken={token => {
        saveLearnerToken(token);
        showEntry(null);
        history.pushState(null, "", learn);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }} />}
  </div>;
}
