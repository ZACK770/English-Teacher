import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Phone, Monitor, Ear, Mic, RefreshCw } from "lucide-react";
import { EmailLogin } from "./EmailLogin";
import { DirectVoice } from "./DirectVoice";
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
  const [voiceToken, setVoiceToken] = useState("");
  const base = legalBasePath(location.pathname);
  const learn = base + "/learn";
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
    const section = document.getElementById(location.hash.slice(1));
    if (section?.closest(".sk-land")) section.scrollIntoView();
  }, []);
  if (voiceToken) return <DirectVoice token={voiceToken} onDone={() => { history.replaceState(null, "", base + "/"); setVoiceToken(""); }} />;
  return <div className="speakool sk-land" dir="rtl">
    <header className="sk-shell sk-land-head">
      <a className="sk-land-brand" href={base + "/"} aria-label="SpeakCall — עמוד הבית"><SpeakCallLogo /></a>
      <nav aria-label="ניווט ראשי"><a href="#free-lesson">שיעור ראשון</a><a href="#how">השיטה</a><a href="#plans">מסלולים</a><a className="sk-land-blog" href={base + "/blog"}>מאמרים</a><a className="sk-land-login" href={learn}>כניסה</a></nav>
    </header>
    <main>
      <section className="sk-shell sk-land-hero" aria-labelledby="landing-heading">
        <div>
          <p className="sk-land-kicker">אנגלית מדוברת · שיעור ראשון חינם</p>
          <h1 id="landing-heading">המורה מחכה.<span>עכשיו תור הפה.</span></h1>
          <p className="sk-land-lede">עשר דקות בחינם עם מורה AI סבלני. מדברים בקול, מקבלים עזרה כשנתקעים, וחוזרים למילים בשיחה הבאה.</p>
          <div className="sk-entry-cards">
            <section className="sk-entry-card"><Phone aria-hidden="true" /><h2>המורה יחייג אליי</h2><LessonCallbackForm tel={tel} privacy={base + "/privacy"} /></section>
            <section className="sk-entry-card" id="computer-call"><Monitor aria-hidden="true" /><h2>שיחה מהמחשב</h2><p>קוד קצר במייל — ומתחילים לדבר עם המורה.</p><EmailLogin onToken={token => { history.pushState(null, "", learn); setVoiceToken(token); }} /></section>
          </div>
          <div className="sk-land-options">
            <a href={tel}><Phone aria-hidden="true" size={14} /> לחייג בעצמי: <bdi>{PHONE_LINE}</bdi></a>
          </div>
        </div>
        <figure className="sk-land-call">
          <div className="sk-land-caller"><strong>מורה ה־AI של ספיקול</strong><span>דוגמה משיעור</span></div>
          <svg className="sk-land-voice-art" viewBox="0 0 320 270" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <g className="sk-land-rings"><circle cx="160" cy="130" r="105" /><circle cx="160" cy="130" r="121" /></g>
            <g className="sk-land-signal"><path d="M74 98q-19 32 0 64M246 98q19 32 0 64M63 89q-26 41 0 82M257 89q26 41 0 82" /></g>
            <g className="sk-land-symbol-breathe"><g className="sk-land-draw">
              <path pathLength="1" d="M194 96c-10-12-21-18-36-18-29 0-47 21-47 51s18 51 47 51c12 0 23-4 31-11l20 22v-35l-18-13c-6 13-17 21-33 21-19 0-29-15-29-35s10-35 29-35c12 0 22 6 29 17Z" />
              <path className="sk-land-tail" pathLength="1" d="m189 169 20 22v-25" />
            </g></g>
          </svg>
          <div className="sk-land-quote" dir="ltr" lang="en">“Ready? Let’s talk.”</div>
          <figcaption>
            נתקעת באנגלית? אפשר לשאול בעברית.
            <div className="sk-land-words"><span>מילים שעולות בשיחה</span><div dir="ltr" lang="en"><b>Actually</b><b>Schedule</b><b>Available</b></div></div>
          </figcaption>
        </figure>
      </section>
      <section id="free-lesson" className="sk-shell sk-land-offer" aria-labelledby="free-lesson-title">
        <div className="sk-land-offer-panel">
          <div>
            <p className="sk-land-kicker">שיעור ראשון בחינם</p>
            <h2 id="free-lesson-title">עשר דקות. בלי הרצאות.</h2>
            <p>בוחרים נושא ומדברים בקצב שלך. המורה עוזר כשנתקעים ובסוף מסכם מה כדאי לתרגל בפעם הבאה.</p>
            <div className="sk-land-cta"><a className="sk-primary" href="#lesson-phone">שהמורה יחייג אליי</a><a className="sk-secondary" href="#computer-call">שיחה מהמחשב <ArrowUpRight aria-hidden="true" size={17} /></a></div>
            <small>בלי כרטיס אשראי. בלי צורך להתכונן.</small>
          </div>
          <div className="sk-land-clock" aria-hidden="true">
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" /><circle cx="50" cy="50" r="45" pathLength="100" /></svg>
            <strong>10</strong><span>דקות · חינם</span>
          </div>
        </div>
      </section>
      <section id="how" className="sk-shell sk-land-steps">
        <p className="sk-land-kicker">שיטת ספיקול</p>
        <h2>השיחה חופשית. התרגול לא מקרי.</h2>
        <ol>
          <li><Ear className="sk-land-step-icon" aria-hidden="true" /><b>01</b><h3>שומעים בהקשר</h3><p>בוחרים נושא שחשוב לך. פוגשים מילים בתוך שיחה, לא בתוך רשימה.</p></li>
          <li><Mic className="sk-land-step-icon" aria-hidden="true" /><b>02</b><h3>מנסים בקול</h3><p>המורה נותן רמז כשנתקעים ומשאיר לך את התור לדבר.</p></li>
          <li><RefreshCw className="sk-land-step-icon" aria-hidden="true" /><b>03</b><h3>חוזרים בשיחה אחרת</h3><p>בודקים מה כבר נשלף לבד ומה כדאי לחזק. לא מסמנים שליטה רק כי חזרת אחרי המורה.</p></li>
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
      <section className="sk-shell sk-land-final"><h2>פחות לתרגם. יותר לדבר.</h2><a className="sk-primary" href="#free-lesson">לשיעור ראשון בחינם <ArrowLeft aria-hidden="true" size={18} /></a></section>
    </main>
    <footer className="sk-shell sk-land-foot"><a className="sk-land-brand" href={base + "/"} aria-label="SpeakCall — עמוד הבית"><SpeakCallLogo /></a><a href={base + "/blog"}>מאמרים</a><a href="mailto:support@speakcall.app">תמיכה: <bdi>support@speakcall.app</bdi></a><a href={tel}>{PHONE_LINE}</a></footer>
    <LegalFooter />
  </div>;
}
