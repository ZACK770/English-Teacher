import type { Lesson } from "./portalApi";

export type PracticeSession = Pick<Lesson, "call_id" | "started_at" | "duration_seconds" | "summary_he" | "success_he" | "next_step_he">;
export type PracticeReport = { sessions: PracticeSession[]; since: string; until: string };
export const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const minutesLabel = (seconds: number) => new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(Math.max(0, seconds) / 60);

export function practiceDays(sessions: PracticeSession[], count: number, now = new Date()) {
  // Calendar arithmetic at UTC noon avoids both browser timezone and DST shifts.
  const today = new Date(dayKey(now) + "T12:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - count + index + 1);
    const key = date.toISOString().slice(0, 10);
    const lessons = sessions.filter(s => dayKey(new Date(s.started_at)) === key);
    return { key, date, sessions: lessons, seconds: lessons.reduce((sum, s) => sum + Math.max(0, s.duration_seconds), 0) };
  });
}
