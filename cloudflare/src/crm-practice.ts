type Day = { customer_id: string; day: string; seconds: number };
type Reminder = { customer_id: string; day: string; sent_at: string | null; responded_at: string | null; status: string };
export function practiceMetrics(days: Day[], reminders: Reminder[], today: string) {
  const shift = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const dates = [...new Set(days.filter(d => d.seconds >= 120 && d.day <= today).map(d => d.day))].sort();
  const set = new Set(dates);
  let current_streak = 0, best_streak = 0, run = 0, previous = '';
  for (const day of dates) { run = previous === shift(day, -1) ? run + 1 : 1; best_streak = Math.max(best_streak, run); previous = day; }
  for (let day = set.has(today) ? today : shift(today, -1); set.has(day); day = shift(day, -1)) current_streak++;
  const recent = reminders.filter(r => r.day >= shift(today, -29) && r.day <= today && r.status === 'sent' && r.sent_at);
  const week = shift(today, -new Date(today + 'T12:00:00Z').getUTCDay());
  return { current_streak, best_streak, practice_days_total: dates.length, last_practice_day: dates.at(-1) || null, practice_days_7: dates.filter(d => d >= shift(today, -6)).length, practice_days_30: dates.filter(d => d >= shift(today, -29)).length, practiced_today: set.has(today), practiced_week: dates.some(d => d >= week), reminders_sent: recent.length, reminders_responded: recent.filter(r => r.responded_at).length, minutes_month: days.filter(d => d.day >= today.slice(0, 7) + '-01' && d.day <= today).reduce((sum, d) => sum + d.seconds / 60, 0) };
}
