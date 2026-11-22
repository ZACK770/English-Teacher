import { BusinessStore } from "./business";
import { normalizePhone, SPEAKCALL_PHONE } from "./callbacks";
import { type Env, sha256Hex } from "./env";
import { PRACTICE_DAY_MIN_SECONDS } from "./practice";

export const PRACTICE_REMINDER_TOOL = {
  name: "save_practice_reminder",
  description: "Save or change the practice reminder after the learner answers the reminder question or explicitly requests a change. Use their latest spoken answer; do not invent consent or a time. If they decline, disable the reminder.",
  parameters: { type: "object", properties: {} },
};

export function reminderWeekdays(sessionsPerWeek: number): number[] {
  return sessionsPerWeek === 3 ? [0, 2, 4] : sessionsPerWeek === 5 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5];
}

export function parseReminderAnswer(answer: string): { active: boolean; time_local?: string } | null {
  const text = answer.trim().replace(/[.,!?״"']/g, "").replace(/\s+/g, " ");
  if (/^(?:לא(?: תודה)?|לא רוצה(?: תזכורת)?|בלי תזכורת|לבטל(?: את)? התזכורת|ביטול|בטל(?: את)? התזכורת|אל תזכיר(?: לי)?)$/.test(text)) return { active: false };
  if (/(?:^|\s)לא(?:\s|$)/.test(text)) return null;
  const numeric = text.match(/(?:^|\s)(?:ב|בשעה\s*)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/);
  const hours: Record<string, number> = { אחת: 1, שתיים: 2, שתים: 2, שלוש: 3, ארבע: 4, חמש: 5, שש: 6, שבע: 7, שמונה: 8, תשע: 9, עשר: 10, "אחת עשרה": 11, "שתים עשרה": 12, "שתיים עשרה": 12 };
  for (const [word, value] of Object.entries(hours)) if (value >= 3 && value <= 9) hours[word + " עשרה"] = value + 10;
  Object.assign(hours, { עשרים: 20, "עשרים ואחת": 21, "עשרים ושתיים": 22, "עשרים ושתים": 22, "עשרים ושלוש": 23 });
  let hour = numeric ? Number(numeric[1]) : undefined;
  if (hour === undefined) {
    for (const [word, value] of Object.entries(hours).sort((a, b) => b[0].length - a[0].length)) {
      if (new RegExp(`(?:^|\\s)(?:ב|בשעה\\s*)?${word}(?=\\s|$)`).test(text)) { hour = value; break; }
    }
  }
  if (hour === undefined || hour > 23) return null;
  const minute = numeric?.[2] ? Number(numeric[2]) : /וחצי/.test(text) ? 30 : /ורבע/.test(text) ? 15 : 0;
  if (minute > 59 || /רבע ל/.test(text)) return null;
  const afternoon = /בערב|אחר הצהריים|אחרי הצהריים|בצהריים/.test(text);
  const morning = /בבוקר/.test(text);
  const night = /בלילה/.test(text);
  const explicitClock = !!numeric && (numeric[2] !== undefined || numeric[1].startsWith("0"));
  if (afternoon && hour < 12) hour += 12;
  else if (night && hour >= 6 && hour < 12) hour += 12;
  else if ((morning || night) && hour === 12) hour = 0;
  else if (!explicitClock && !morning && !night && !afternoon && hour >= 1 && hour <= 6) hour += 12;
  return { active: true, time_local: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export async function savePracticeReminder(db: D1Database, customerId: string, answer: string, now = new Date()): Promise<boolean> {
  if (customerId.startsWith("anonymous-")) return false;
  const parsed = parseReminderAnswer(answer);
  if (!parsed) return false;
  const pkg = await new BusinessStore(db).activeSchoolPackage(customerId, now.toISOString());
  if (!pkg) return false;
  const at = now.toISOString();
  if (!parsed.active) {
    await db.prepare("UPDATE practice_reminders SET active=0,updated_at=? WHERE customer_id=?").bind(at, customerId).run();
    return true;
  }
  await db.prepare(`INSERT INTO practice_reminders(customer_id,time_local,weekdays,active,source,created_at,updated_at)
    VALUES (?,?,?,1,'lesson',?,?) ON CONFLICT(customer_id) DO UPDATE SET
    time_local=excluded.time_local,weekdays=excluded.weekdays,active=1,source=excluded.source,updated_at=excluded.updated_at`)
    .bind(customerId, parsed.time_local!, JSON.stringify(reminderWeekdays(pkg.sessions_per_week)), at, at).run();
  return true;
}

export function reminderGuidance(active: boolean): string {
  return (active
    ? "An active practice reminder is already saved. Do not offer another one; only change or cancel it if the learner asks."
    : 'At a natural end of this lesson, ask once in natural, gender-neutral Hebrew: "רוצה תזכורת לתרגול הבא? באיזו שעה נוח?" Wait for the answer. Do not interrupt practice to ask, delay an urgent goodbye, or ask again after a refusal.')
    + ' Use save_practice_reminder after explicit consent with a time, a requested change, or a refusal. Never ask them to say a special confirmation phrase. If the time is missing or ambiguous, ask a short clarification. The reminder is a ring-only ping on the package practice weekdays, never Saturday, not a spoken callback. Only confirm saving when saved=true. After saving, do not offer again in this call.';
}

function localParts(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, time: `${parts.hour}:${parts.minute}`, weekday: new Date(day + "T12:00:00Z").getUTCDay() };
}

export async function dispatchPracticeReminders(env: Env, now = new Date()): Promise<void> {
  const mode = env.REMINDERS_MODE ?? "off";
  if (!["dry_run", "live"].includes(mode) || localParts(now).weekday === 6) return;
  const allowlist = env.REMINDERS_ALLOWLIST?.trim()
    ? new Set(env.REMINDERS_ALLOWLIST.split(",").map(p => normalizePhone(p.trim())).filter(Boolean)) : null;
  if (mode === "live" && !env.TLIVR_SYSTEM_API_KEY) return;
  const slots = Array.from({ length: 10 }, (_, minute) => {
    const at = new Date(Math.floor(now.getTime() / 60000) * 60000 - minute * 60000);
    return { ...localParts(at), at: at.toISOString() };
  });
  const rows = await env.DB.prepare(`SELECT r.customer_id,r.time_local,r.weekdays,c.primary_phone AS phone
    FROM practice_reminders r JOIN customers c ON c.id=r.customer_id WHERE r.active=1`)
    .all<{ customer_id: string; time_local: string; weekdays: string; phone: string }>();
  for (const row of rows.results) {
    try {
      const weekdays: unknown = JSON.parse(row.weekdays);
      if (!Array.isArray(weekdays)) continue;
      const due = slots.find(s => s.weekday !== 6 && s.time === row.time_local && weekdays.includes(s.weekday));
      if (!due) continue;
      const business = new BusinessStore(env.DB);
      const preferences = await business.loadContext("preferences:" + row.customer_id);
      const lastCaller = typeof preferences.last_verified_caller === "string" ? normalizePhone(preferences.last_verified_caller) : null;
      const phone = lastCaller && await business.customerForPhone(lastCaller) === row.customer_id ? lastCaller : normalizePhone(row.phone);
      if (!phone || (mode === "live" && allowlist && !allowlist.has(phone))) continue;
      if (!await new BusinessStore(env.DB).hasPaidAccess(row.customer_id, now.toISOString())) continue;
      const id = await sha256Hex("practice-reminder:" + row.customer_id + ":" + due.day);
      const claim = await env.DB.prepare(`INSERT OR IGNORE INTO practice_reminder_events(id,customer_id,day,scheduled_for,status)
        SELECT ?,?,?,?,CASE WHEN COALESCE((SELECT seconds FROM practice_days WHERE customer_id=? AND day=?),0)>=?
          THEN 'skipped_practiced' ELSE ? END RETURNING status`)
        .bind(id, row.customer_id, due.day, due.at, row.customer_id, due.day, PRACTICE_DAY_MIN_SECONDS, mode === "dry_run" ? "dry_run" : "failed").first<{ status: string }>();
      if (!claim || claim.status === "skipped_practiced" || mode === "dry_run") continue;
      let sent = false;
      try {
        const response = await fetch("https://api.tlivr.com/campaignApi.php", {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "speakcall-practice/1.0" },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({ action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY, phones: [phone],
            title: "SpeakCall practice reminder", messagesType: "RH", callId: SPEAKCALL_PHONE,
            dialRetries: 0, reasonableHours: "no", externalID: id }),
        });
        const result = await response.json<{ status?: string; errorCode?: string | number }>();
        sent = response.ok && String(result?.status).toUpperCase() === "OK" && String(result?.errorCode) === "0";
      } catch { /* Keep the claimed event failed; never retry an uncertain send. */ }
      if (sent) await env.DB.prepare("UPDATE practice_reminder_events SET status='sent',sent_at=? WHERE id=?")
        .bind(now.toISOString(), id).run();
    } catch { console.warn("Practice reminder could not be processed"); }
  }
}
