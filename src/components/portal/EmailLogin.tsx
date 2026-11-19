import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalRequest } from "./portalApi";
import { saveLearnerToken } from "./learnerToken";

export function EmailLogin({ onToken }: { onToken: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(n => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function send() {
    const result = await portalRequest<{ challenge: string; retry_after: number }>("/v1/portal/auth/email/start", "", { email: email.trim() });
    setEmail(email.trim().toLowerCase()); setChallenge(result.challenge); setCode(""); setCooldown(result.retry_after);
  }
  async function submit(event?: FormEvent, resend = false) {
    event?.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (!challenge || resend) await send();
      else {
        const result = await portalRequest<{ token: string }>("/v1/portal/auth/email/verify", "", { challenge, code });
        saveLearnerToken(result.token);
        onToken(result.token);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו להתחבר. נסו שוב."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="sk-email-login" dir="rtl">
    <form onSubmit={event => void submit(event)}>
      {challenge ? <>
        <label htmlFor="email-code">שלחנו קוד בן 6 ספרות ל-<bdi>{email}</bdi></label>
        <input id="email-code" autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
      </> : <>
        <label htmlFor="learner-email">כתובת המייל שלך</label>
        <input id="learner-email" type="email" dir="ltr" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
      </>}
      <button className="sk-primary" disabled={busy}>{busy ? "רק רגע…" : challenge ? "כניסה למורה" : "שלחו לי קוד"}</button>
    </form>
    {challenge && <div className="sk-email-links">
      <button type="button" className="sk-link" disabled={busy || cooldown > 0} onClick={() => void submit(undefined, true)}>שלח שוב{cooldown > 0 ? ` (${cooldown})` : ""}</button>
      <button type="button" className="sk-link" disabled={busy} onClick={() => { setChallenge(""); setCode(""); setError(""); }}>שינוי מייל</button>
    </div>}
    {error && <p className="sk-error" role="alert">{error}</p>}
  </div>;
}
