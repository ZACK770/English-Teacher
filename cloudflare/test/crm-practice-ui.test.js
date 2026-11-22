import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PracticeCard, savePackageQuota } from '../../src/components/dashboard/CrmPractice';
const practice = { current_streak: 0, best_streak: 0, today: { day: '2026-06-10' }, dates: [], week: { done: 0, target: 3 }, month: { minutes_used: 0, minutes_quota: null }, reminder_events: [] };
describe('CRM practice card', () => {
  it('renders empty practice and an unset quota', () => {
    const html = renderToStaticMarkup(createElement(PracticeCard, { practice }));
    expect(html).toContain('תרגול יומי');
    expect(html).toContain('טרם נרשמו תזכורות.');
    expect(html).toContain('לא הוגדרה מכסה');
    expect(html).toContain('פנימי — לא מוצג ללקוח');
    expect(html.replace(/<[^>]*>/g, '')).toContain('0 מתוך 3');
    expect(html.replace(/<[^>]*>/g, '')).toContain('0 דקות — לא הוגדרה מכסה');
  });
  it('highlights practiced dates, over-quota usage and failed reminders', () => {
    const html = renderToStaticMarkup(createElement(PracticeCard, { practice: { ...practice, dates: ['2026-06-10'], month: { minutes_used: 61, minutes_quota: 60 }, reminder_events: [{ day: '2026-06-10', status: 'failed', sent_at: null, responded_at: null }] } }));
    expect(html).toContain('#bbf7d0');
    expect(html).toContain('#dc2626');
    expect(html).toContain('נכשלה');
    expect(html.replace(/<[^>]*>/g, '')).toContain('61 מתוך 60 דקות');
  });
});
describe('package quota saving', () => {
  it('fetches the latest package and preserves edits made since screen load', async () => {
    const current = { id: 'school-step', name: 'שם מעודכן', price_ils: 99, sessions_per_week: 4, monthly_minutes: 60 };
    const request = vi.fn().mockResolvedValueOnce({ items: [current] }).mockResolvedValueOnce({});
    await savePackageQuota(request, 'school-step', 120);
    expect(request.mock.calls[0]).toEqual(['/v1/admin/business/packages']);
    expect(request.mock.calls[1][0]).toBe('/v1/admin/business/packages/school-step');
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ ...current, monthly_minutes: 120 });
  });
  it('does not write a package removed since screen load', async () => {
    const request = vi.fn().mockResolvedValue({ items: [] });
    await expect(savePackageQuota(request, 'school-step', 120)).rejects.toThrow('החבילה לא נמצאה.');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not write if refreshing the current package fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('network'));
    await expect(savePackageQuota(request, 'school-step', 120)).rejects.toThrow('network');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
