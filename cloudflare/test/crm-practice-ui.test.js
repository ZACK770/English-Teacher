import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PracticeCard } from '../../src/components/dashboard/CrmPractice';
const practice = { current_streak: 0, best_streak: 0, today: { day: '2026-06-10' }, dates: [], week: { done: 0, target: 3 }, month: { minutes_used: 0, minutes_quota: null }, reminder_events: [] };
describe('CRM practice card', () => {
  it('renders empty practice and an unset quota', () => {
    const html = renderToStaticMarkup(createElement(PracticeCard, { practice }));
    expect(html).toContain('תרגול יומי');
    expect(html).toContain('טרם נרשמו תזכורות.');
    expect(html).toContain('לא הוגדרה מכסה');
    expect(html).toContain('פנימי — לא מוצג ללקוח');
  });
  it('highlights practiced dates, over-quota usage and failed reminders', () => {
    const html = renderToStaticMarkup(createElement(PracticeCard, { practice: { ...practice, dates: ['2026-06-10'], month: { minutes_used: 61, minutes_quota: 60 }, reminder_events: [{ day: '2026-06-10', status: 'failed', sent_at: null, responded_at: null }] } }));
    expect(html).toContain('#bbf7d0');
    expect(html).toContain('#dc2626');
    expect(html).toContain('נכשלה');
  });
});
