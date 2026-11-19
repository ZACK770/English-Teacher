import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { submitLessonCallback } from "../join/callbackApi";

export function LessonCallbackForm({ tel, privacy }: { tel: string; privacy: string }) {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "invalid" | "error" | "queued" | "duplicate">("idle");
  const phoneInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const clean = phone.trim().replace(/[\s()-]/g, "");
    if (!/^(?:\+?972|0)[57]\d{8}$/.test(clean)) {
      setStatus("invalid");
      phoneInput.current?.focus();
      return;
    }
    submitting.current = true;
    setStatus("sending");
    try {
      const result = await submitLessonCallback(clean);
      setPhone("");
      setStatus(result.duplicate ? "duplicate" : "queued");
    } catch {
      setStatus("error");
    } finally {
      submitting.current = false;
    }
  }

  return <form className="sk-land-callback" onSubmit={handleSubmit} noValidate>
    <label htmlFor="lesson-phone">לאיזה מספר המורה יחייג?</label>
    <div className="sk-land-fields">
      <input id="lesson-phone" ref={phoneInput} type="tel" dir="ltr" autoComplete="tel" maxLength={20} required
        placeholder="05X-XXX-XXXX" value={phone} readOnly={status === "sending"}
        aria-invalid={status === "invalid"} aria-describedby="callback-hint callback-status"
        onChange={event => { setPhone(event.target.value); setStatus("idle"); }} />
      <button className="sk-primary" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "שולחים בקשה…" : "שהמורה יחייג אליי"} <ArrowLeft aria-hidden="true" size={16} />
      </button>
    </div>
    <p id="callback-hint">בלחיצה מאשרים שיחה לשיעור ממורה ה־AI. נחזור אליך בשעות הפעילות. <a href={privacy}>פרטיות</a></p>
    <div id="callback-status" role="status" data-state={status}>
      {status === "invalid" && "יש להזין מספר נייד או מספר 07 תקין."}
      {status === "error" && <>לא הצלחנו לשלוח את הבקשה. אפשר לנסות שוב או <a href={tel}>לחייג אלינו</a>.</>}
      {status === "duplicate" && <>כבר קיבלנו בקשת חיוג למספר הזה ביממה האחרונה. אפשר גם <a href={tel}>לחייג אלינו</a>.</>}
      {status === "queued" && <>בקשת החיוג התקבלה. המורה יחייג בשעות הפעילות. לא רוצה להמתין? <a href={tel}>אפשר לחייג אלינו</a>.</>}
    </div>
  </form>;
}
