import { BusinessStore } from "./business";

export const PRACTICE_DAY_MIN_SECONDS = 120;
export type PracticeSummary = {
  current_streak: number;
  best_streak: number;
  today: { day: string; practiced: boolean; seconds: number };
  dates: string[];
  week: { start: string; target: number; done: number };
  package: { id: string; name: string; sessions_per_week: number } | null;
  reminder: { time_local: string; weekdays: number[]; active: boolean } | null;
};
export type PracticeInternal = PracticeSummary & {
  month: { start: string; minutes_used: number; minutes_quota: number | null };
  reminder_events: { day: string; sent_at: string | null; status: string; responded_at: string | null }[];
};

function localDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
function shift(day: string, days: number): string {
  const at = new Date(day + "T12:00:00Z");
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export async function recordPractice(db: D1Database, customerId: string, seconds: number, at: Date): Promise<void> {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(at.getTime())) throw new Error("Invalid practice duration or date");
  if (customerId.startsWith("anonymous-")) return;
  await db.prepare(`INSERT INTO practice_days(customer_id,day,seconds,calls,first_at,last_at) VALUES (?,?,?,1,?,?)
    ON CONFLICT(customer_id,day) DO UPDATE SET seconds=seconds+excluded.seconds,calls=calls+1,
    first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at)`)
    .bind(customerId, localDay(at), Math.floor(seconds), at.toISOString(), at.toISOString()).run();
}

async function load(db: D1Database, customerId: string, now: Date) {
  const day = localDay(now);
  const [days, pkg, reminder] = await Promise.all([
    db.prepare("SELECT day,seconds FROM practice_days WHERE customer_id=? AND day<=? ORDER BY day").bind(customerId, day).all<{ day: string; seconds: number }>(),
    new BusinessStore(db).activeSchoolPackage(customerId, now.toISOString()),
    db.prepare("SELECT time_local,weekdays,active FROM practice_reminders WHERE customer_id=?").bind(customerId).first<{ time_local: string; weekdays: string; active: number }>(),
  ]);
  const dates = days.results.filter(d => d.seconds >= PRACTICE_DAY_MIN_SECONDS).map(d => d.day);
  const practiced = new Set(dates);
  let current = practiced.has(day) ? day : shift(day, -1), current_streak = 0, best_streak = 0, run = 0, previous = "";
  while (practiced.has(current)) { current_streak++; current = shift(current, -1); }
  for (const date of dates) { run = previous && shift(previous, 1) === date ? run + 1 : 1; best_streak = Math.max(best_streak, run); previous = date; }
  const start = shift(day, -new Date(day + "T12:00:00Z").getUTCDay());
  const cadence = Number(pkg?.sessions_per_week ?? 7);
  const summary: PracticeSummary = {
    current_streak, best_streak,
    today: { day, practiced: practiced.has(day), seconds: days.results.find(d => d.day === day)?.seconds ?? 0 },
    dates: dates.filter(d => d >= shift(day, -119)),
    week: { start, target: pkg ? cadence : 0, done: dates.filter(d => d >= start).length },
    package: pkg ? { id: pkg.id, name: String(pkg.name), sessions_per_week: cadence } : null,
    reminder: reminder ? { time_local: reminder.time_local, weekdays: JSON.parse(reminder.weekdays), active: !!reminder.active } : null,
  };
  return { summary, days: days.results, pkg };
}

export async function practiceSummary(db: D1Database, customerId: string, now = new Date()): Promise<PracticeSummary> {
  return (await load(db, customerId, now)).summary;
}

export async function practiceInternal(db: D1Database, customerId: string, now = new Date()): Promise<PracticeInternal> {
  const { summary, days, pkg } = await load(db, customerId, now);
  const start = summary.today.day.slice(0, 7) + "-01";
  const events = await db.prepare("SELECT day,sent_at,status,responded_at FROM practice_reminder_events WHERE customer_id=? ORDER BY scheduled_for DESC LIMIT 30")
    .bind(customerId).all<PracticeInternal["reminder_events"][number]>();
  return { ...summary, month: { start, minutes_used: days.filter(d => d.day >= start).reduce((sum, d) => sum + d.seconds, 0) / 60, minutes_quota: pkg?.monthly_minutes == null ? null : Number(pkg.monthly_minutes) }, reminder_events: events.results };
}
