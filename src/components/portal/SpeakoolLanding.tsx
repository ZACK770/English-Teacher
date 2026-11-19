import { ArrowLeft, Phone } from "lucide-react";
import { PHONE_LINE, TeacherMark } from "./LearnerPortal";
import { LegalFooter } from "../legal/LegalFooter";
import "./portal.css";
import "./landing.css";
import { FREE_TIER_TEXT, MONTHLY_TERMS, MASTERY_GUARANTEE, PRICING_PACKAGES } from "../../pricing";

const faq = [
  ["צריך אינטרנט?", "לא. מספיק טלפון רגיל, גם כשר. מי שרוצה יכול לדבר גם מהמחשב."],
  ["למה השיחה מוגבלת בזמן?", "שיחות קצרות ותכופות נדבקות יותר משיעור ארוך פעם בשבוע. במסלולים הגבוהים השיחה ארוכה יותר."],
  ["מה קורה כשהזמן נגמר?", "המורה מודיע לפני הסוף, מסכם, שומר את מה שלמדת ונפרד. שום דבר לא הולך לאיבוד."],
  ["איך משלמים?", "בכרטיס אשראי באתר, בדף המאובטח של נדרים פלוס: מנוי חודשי מתחדש בהוראת קבע וניתן לביטול בכל עת, ומסלולי השליטה אפשר לחלק לתשלומים. תוספת דקות ותרגומון אפשר לרכוש גם בטלפון, מקש 3."],
];

export function SpeakoolLanding() {
  const base = location.pathname.startsWith("/english") ? "/english" : "";
  const learn = base + "/learn";
  const tel = "tel:" + PHONE_LINE.replace(/-/g, "");
  return <div className="speakool sk-land" dir="rtl">
    <header className="sk-shell sk-land-head">
      <a className="sk-brand" dir="ltr" href={base + "/"}>SpeakCall<span className="sk-brand-dot">.</span></a>
      <nav><a href="#how">איך זה עובד</a><a href="#plans">מסלולים</a><a className="sk-land-login" href={learn}>כניסה</a></nav>
    </header>
    <main>
      <section className="sk-shell sk-land-hero">
        <div>
          <p className="sk-land-kicker">אנגלית מדוברת · בטלפון ובמחשב</p>
          <h1>אנגלית.<br />פשוט לדבר<span>.</span></h1>
          <p className="sk-land-lede">את השפה הראשונה שלך לא למדת מספר. הקשבת, ניסית, טעית. פה עושים את זה שוב, באנגלית, עם מורה שתמיד פנוי ואף פעם לא מאבד סבלנות.</p>
          <div className="sk-land-cta"><a className="sk-primary" href={learn}>מתחילים בחינם <ArrowLeft size={18} /></a><a className="sk-secondary" href={tel}><Phone size={17} />{PHONE_LINE}</a></div>
          <small>שתי שיחות טעימה בחודש. בלי כרטיס אשראי, בלי התחייבות.</small>
        </div>
        <figure className="sk-land-call" aria-label="דוגמה לשיחה">
          <div className="sk-land-caller"><TeacherMark index={0} /><div><strong>דוד</strong><span>על הקו · 04:12</span></div></div>
          <p className="is-tutor">Hi! What did you do this morning?</p>
          <p className="is-you">I… go to work?</p>
          <p className="is-tutor">Nice! <b>I went</b> to work. Now you.</p>
          <p className="is-you">I went to work.</p>
          <figcaption>בלי שינון. מדברים, והמורה מתקן בעדינות.</figcaption>
        </figure>
      </section>
      <section id="how" className="sk-shell sk-land-steps">
        <h2>שלושה צעדים. אפס לחץ.</h2>
        <ol>
          <li><b>01</b><h3>מכירים</h3><p>כמה שאלות קצרות, ונתאים לך את המורה שלך: נושא, רמה, קצב ואופי.</p></li>
          <li><b>02</b><h3>מדברים</h3><p>שיחה קצרה בטלפון או במחשב. טועים בלי להתבייש, והמורה מתקן בזמן הנכון.</p></li>
          <li><b>03</b><h3>רואים שזה עובד</h3><p>כל מילה שמשתמשים בה נספרת. דקדוק בנפרד, אוצר מילים בנפרד, בלי ציונים מומצאים.</p></li>
        </ol>
      </section>
      <section className="sk-shell sk-land-teachers">
        <div><h2>קודם כל, נתאים לך את המורה שלך.</h2><p>טיסות, נדל״ן, רכב או סתם שיחה על היום. כל מורה הוא תבנית שיעור שלמה, ואפשר ליצור כמה.</p></div>
        <div className="sk-land-cards">
          <article><TeacherMark index={0} /><strong>דוד</strong><span>רגוע, סבלני, תיקונים עדינים</span></article>
          <article><TeacherMark index={1} teacher={{ name: "אסתי", voice: "Aoede" } as never} /><strong>אסתי</strong><span>למי שמעדיפה ללמוד עם מורה</span></article>
          <article><TeacherMark index={3} /><strong>המורה שלך</strong><span>הנושא שלך, הקצב שלך</span></article>
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
      <section className="sk-shell sk-land-final"><h2>המשפט הראשון הוא הכי קשה.<br />השאר כבר זורם.</h2><a className="sk-primary" href={learn}>בוא נדבר <ArrowLeft size={18} /></a></section>
    </main>
    <footer className="sk-shell sk-land-foot"><span dir="ltr">SpeakCall<span className="sk-brand-dot">.</span></span><a href="mailto:support@speakcall.app">תמיכה: <bdi>support@speakcall.app</bdi></a><a href={tel}>{PHONE_LINE}</a></footer>
    <LegalFooter />
  </div>;
}
