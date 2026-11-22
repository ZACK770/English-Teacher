import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { PortalError, portalRequest } from "./portalApi";
import "./quick-entry.css";

export type EntryChannel = "phone" | "email";
export type EntryMode = "trial" | "login";
type Challenge = { value: string; id: string; expires: number; retryAt: number };
const entryKey = "speakcall.entry.";
function clearChallenge(channel: EntryChannel) {
  try { sessionStorage.removeItem(entryKey + channel); } catch { /* Private browsing. */ }
}
function readChallenge(channel: EntryChannel): Challenge | null {
  try {
    const value: Challenge | null = JSON.parse(sessionStorage.getItem(entryKey + channel) || "null");
    if (value && value.expires > Date.now()) return value;
  } catch { /* A new challenge can be requested. */ }
  clearChallenge(channel);
  return null;
}

export function clearEntryChallenges() {
  clearChallenge("phone");
  clearChallenge("email");
}

export function EntryForm({ channel, linkToken, onToken, onLinked }: {
  channel: EntryChannel; linkToken?: string; onToken?: (token: string) => void; onLinked?: () => void;
}) {
  const [challenge, setChallenge] = useState(() => linkToken ? null : readChallenge(channel));
  const [value, setValue] = useState(challenge?.value || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [canResend, setCanResend] = useState(!challenge || challenge.retryAt <= Date.now());
  const pending = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const email = channel === "email";
  const path = "/v1/portal/auth" + (email ? "/email/" : "/");
  const invalid = email ? "יש להזין כתובת מייל תקינה." : "יש להזין מספר טלפון ישראלי תקין.";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!challenge) return;
    const delay = challenge.retryAt - Date.now();
    setCanResend(delay <= 0);
    if (delay > 0) {
      const timer = window.setTimeout(() => setCanResend(true), delay);
      return () => window.clearTimeout(timer);
    }
  }, [challenge]);
  async function submit(event?: FormEvent, resend = false) {
    event?.preventDefault();
    if (pending.current) return;
    const sending = !challenge || resend;
    const contact = value.trim();
    if (sending && !(email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) : /^(?:\+?972[-\s]?|0)[2-9]\d{7,8}$/.test(contact.replace(/[\s()-]/g, "")))) {
      setError(invalid);
      input.current?.focus();
      return;
    }
    if (!sending && code.length !== 6) return;
    pending.current = true;
    setBusy(sending ? "send" : "verify");
    setError("");
    try {
      if (sending) {
        const r = await portalRequest<{ challenge: string; expires_in: number; retry_after?: number }>(path + "start", linkToken || "", {
          [email ? "email" : "phone"]: contact,
          ...(linkToken ? { purpose: email ? "link_email" : "link_phone" } : {}),
        });
        if (!mounted.current) return;
        const fresh = { id: r.challenge, value: email ? contact.toLowerCase() : contact, expires: Date.now() + r.expires_in * 1000, retryAt: Date.now() + (r.retry_after ?? 60) * 1000 };
        if (!linkToken) {
          try { sessionStorage.setItem(entryKey + channel, JSON.stringify(fresh)); } catch { /* The current form still works. */ }
        }
        setValue(fresh.value);
        setCode("");
        setChallenge(fresh);
        requestAnimationFrame(() => input.current?.focus());
      } else {
        const result = await portalRequest<{ token?: string; linked?: boolean }>(path + "verify", linkToken || "", { challenge: challenge.id, code });
        if (!mounted.current) return;
        if (linkToken && result.linked) onLinked?.();
        else if (result.token) { clearEntryChallenges(); onToken?.(result.token); }
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof PortalError && e.status === 429) setError("אפשר לנסות שוב בעוד דקה.");
      else if (!sending && e instanceof PortalError && e.status === 401 && !linkToken) setError(email ? "הקוד שגוי או שפג תוקפו. אפשר לבקש חדש." : "הספרות שגויות או שפג תוקפן. אפשר לבקש צלצול נוסף.");
      else if (linkToken && e instanceof PortalError && [401, 403, 409, 422].includes(e.status)) setError(e.message);
      else if (sending) setError(email ? "לא הצלחנו לשלוח קוד. אפשר לנסות שוב." : linkToken ? "לא הצלחנו לשלוח צלצול. אפשר לנסות שוב." : "לא הצלחנו לשלוח צלצול. אפשר לנסות שוב או להיכנס במייל.");
      else setError("לא הצלחנו לאמת. אפשר לנסות שוב.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function changeContact() {
    if (!linkToken) clearChallenge(channel);
    setChallenge(null);
    setCode("");
    setError("");
    requestAnimationFrame(() => input.current?.focus());
  }
  return <div className="sk-entry-fields">
    <form onSubmit={e => void submit(e)} noValidate>
      {challenge && <div className="sk-entry-sent" role="status">
        <strong>{email ? "שלחנו קוד למייל" : "שלחנו צלצול"}</strong>
        <p>{email ? <bdi>{challenge.value}</bdi> : "מקלידים את 6 הספרות האחרונות של המספר שהתקשר."}</p>
      </div>}
      <label htmlFor={id}>{challenge ? (email ? "קוד בן 6 ספרות" : "6 ספרות") : (email ? "כתובת מייל" : "מספר טלפון")}</label>
      <input ref={input} id={id} key={challenge ? "code" : "contact"} dir="ltr"
        type={challenge ? "text" : email ? "email" : "tel"} inputMode={challenge ? "numeric" : email ? "email" : "tel"}
        autoComplete={challenge ? "one-time-code" : email ? "email" : "tel"}
        className={challenge ? "sk-entry-code" : undefined} aria-invalid={!!error}
        aria-describedby={error ? id + "-error" : undefined} readOnly={!!busy}
        required maxLength={challenge ? 6 : email ? 254 : 30}
        placeholder={challenge ? "○ ○ ○ ○ ○ ○" : email ? "name@example.com" : "050-000-0000"}
        value={challenge ? code : value}
        onChange={e => { setError(""); if (challenge) setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); else setValue(e.target.value); }} />
      <button className="sk-primary sk-entry-submit" disabled={!!busy || !!challenge && code.length !== 6}>
        {busy ? busy === "verify" ? "מאמתים…" : "שולחים…" : challenge ? linkToken ? "לחבר לחשבון" : "אימות וכניסה" : email ? "שלחו לי קוד" : "שלחו לי צלצול"}
      </button>
      {!challenge && !email && <p className="sk-entry-hint">אין צורך לענות.</p>}
      {error && <p id={id + "-error"} className="sk-entry-error" role="alert">{error}</p>}
    </form>
    {challenge && <div className="sk-entry-links">
      <button type="button" disabled={!!busy || !canResend} onClick={() => void submit(undefined, true)}>{email ? "קוד חדש" : "צלצול נוסף"}</button>
      <button type="button" disabled={!!busy} onClick={changeContact}>{email ? "שינוי מייל" : "שינוי מספר"}</button>
    </div>}
  </div>;
}

export function QuickEntry({ mode, channel, onChannel, privacy, onToken, onClose, error }: {
  mode: EntryMode; channel: EntryChannel; onChannel: (channel: EntryChannel) => void;
  privacy: string; onToken: (token: string) => void; onClose?: () => void; error?: string;
}) {
  const heading = useId();
  const personal = useRef<HTMLInputElement>(null);
  const [personalError, setPersonalError] = useState(false);
  const title = mode === "trial" ? "איך נתחבר?" : "כניסה לחשבון";
  return <section className="sk-entry-panel" dir="rtl" aria-labelledby={heading}>
    <div className="sk-entry-heading"><h1 id={heading}>{title}</h1>{onClose && <button type="button" aria-label="סגירה" onClick={onClose}><X size={20} /></button>}</div>
    <div className="sk-entry-tabs" role="group" aria-label="דרך כניסה">
      <button type="button" aria-pressed={channel === "phone"} onClick={() => onChannel("phone")}>טלפון</button>
      <button type="button" aria-pressed={channel === "email"} onClick={() => onChannel("email")}>מייל</button>
    </div>
    {error && <p className="sk-entry-error" role="alert">{error}</p>}
    <EntryForm channel={channel} key={channel} onToken={onToken} />
    {mode === "login" && <details className="sk-entry-personal">
      <summary>יש לי קישור אישי</summary>
      <form onSubmit={e => {
        e.preventDefault();
        const input = personal.current?.value.trim() || "";
        const token = input.includes("#") ? input.slice(input.lastIndexOf("#") + 1) : input;
        if (!/^[A-Za-z0-9_-]{30,128}$/.test(token)) { setPersonalError(true); return; }
        onToken(token);
      }}>
        <label htmlFor={heading + "-link"}>הקישור האישי</label><input id={heading + "-link"} ref={personal} required dir="ltr" type="text" />
        <button className="sk-secondary">כניסה עם הקישור</button>
        {personalError && <p className="sk-entry-error" role="alert">יש להדביק את הקישור האישי המלא.</p>}
      </form>
    </details>}
    <a className="sk-entry-privacy" href={privacy}>פרטיות</a>
  </section>;
}

export function EntryDialog({ onClose, ...props }: Parameters<typeof QuickEntry>[0] & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  function close() {
    ref.current?.close();
    onClose();
  }
  return <dialog ref={ref} className="sk-entry-dialog" aria-label={props.mode === "trial" ? "איך נתחבר?" : "כניסה לחשבון"}
    onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <QuickEntry {...props} onClose={close} />
  </dialog>;
}
