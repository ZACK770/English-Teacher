import { useEffect, useState } from "react";
import { Account, portalRequest } from "./portalApi";
import { VoiceRoom } from "./VoiceRoom";

export function DirectVoice({ token, onDone }: { token: string; onDone: () => void }) {
  const [choice, setChoice] = useState<{ botId: string; teacherId?: string; name: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void portalRequest<Account>("/v1/portal/me", token).then(account => {
      if (disposed) return;
      const teachers = account.bots.filter(b => b.role === "teacher");
      const active = account.teachers.find(t => t.id === account.preferences.active_teacher && teachers.some(b => b.id === t.base_bot));
      const bot = teachers.find(b => b.id === (active?.base_bot || account.preferences.selected_bot || account.customer.preferred_bot)) || teachers.find(b => b.id === "isaac-basic") || teachers[0];
      if (!bot) throw new Error("עדיין אין מורה זמין. אפשר לנסות שוב מאוחר יותר.");
      setChoice({ botId: bot.id, teacherId: active?.id, name: active?.name || bot.label });
    }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : "לא הצלחנו לפתוח שיחה."); });
    return () => { disposed = true; };
  }, [token]);
  return <main className="speakool sk-direct-voice" dir="rtl">
    {choice ? <VoiceRoom token={token} {...choice} onDone={onDone} /> : <div className="sk-call"><h1>המורה שלך</h1><p role={error ? "alert" : "status"}>{error || "רגע, מחברים אותך למורה…"}</p>{error && <button className="sk-primary" onClick={onDone}>בחזרה</button>}</div>}
  </main>;
}
