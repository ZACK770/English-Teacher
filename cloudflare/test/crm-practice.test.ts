import { describe, expect, it } from 'vitest';
import { practiceMetrics } from '../src/crm-practice';
describe('returning customer practice aggregation', () => {
  it('handles empty practice and reminders', () => {
    expect(practiceMetrics([], [], '2026-06-10')).toMatchObject({ current_streak: 0, best_streak: 0, practice_days_total: 0, reminders_sent: 0, minutes_month: 0, last_practice_day: null });
  });
  it('counts qualified days, streaks, minutes and sent reminder responses', () => {
    const days = ['2026-06-08', '2026-06-09', '2026-06-10'].map(day => ({ customer_id: 'a', day, seconds: 120 }));
    days.push({ customer_id: 'a', day: '2026-06-07', seconds: 60 });
    const reminders = ['sent', 'failed', 'dry_run', 'skipped_practiced'].map(status => ({ customer_id: 'a', day: '2026-06-10', status, sent_at: '2026-06-10T10:00:00Z', responded_at: '2026-06-10T11:00:00Z' }));
    expect(practiceMetrics(days, reminders, '2026-06-10')).toMatchObject({ current_streak: 3, best_streak: 3, practice_days_total: 3, practice_days_7: 3, practice_days_30: 3, reminders_sent: 1, reminders_responded: 1, minutes_month: 7, practiced_today: true, practiced_week: true });
  });
  it('retains yesterday streak and expires lapsed streaks', () => {
    const days = [{ customer_id: 'a', day: '2026-06-09', seconds: 120 }];
    expect(practiceMetrics(days, [], '2026-06-10').current_streak).toBe(1);
    expect(practiceMetrics(days, [], '2026-06-17')).toMatchObject({ current_streak: 0, best_streak: 1, practice_days_7: 0, practiced_week: false });
  });
});
