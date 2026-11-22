// Calendar dates from the server are Israeli dates, not browser-local instants.
export function calendarDate(key: string) {
  return new Date(key + "T12:00:00Z");
}

export function shiftDay(key: string, amount: number) {
  const date = calendarDate(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, amount: number) {
  const date = calendarDate(month + "-01");
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

export function monthDays(month: string) {
  const first = calendarDate(month + "-01");
  const next = calendarDate(shiftMonth(month, 1) + "-01");
  const count = Math.round((next.getTime() - first.getTime()) / 86400000);
  return { offset: first.getUTCDay(), days: Array.from({ length: count }, (_, i) => shiftDay(month + "-01", i)) };
}

export const practiceDateLabel = (key: string) => calendarDate(key).toLocaleDateString("he-IL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
