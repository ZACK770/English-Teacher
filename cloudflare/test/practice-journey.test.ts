import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PracticeCalendar, PracticeJourney } from "../../src/components/portal/PracticeJourney";
import { monthDays, shiftDay, shiftMonth } from "../../src/components/portal/practiceCalendar";

describe("practice journey", () => {
  const props = { streak: 4, best: 12, practicedToday: false, weeklyDone: 2, weeklyGoal: 3, packageName: "סטארט", level: "intermediate" };
  it("shows server progress, not minutes or an invented level score", () => {
    const html = renderToStaticMarkup(createElement(PracticeJourney, props));
    expect(html).toContain("השיא שלך: 12 ימים");
    expect(html).toContain("חבילת סטארט");
    expect(html).toContain('aria-valuemax="3" aria-valuenow="2"');
    expect(html).toContain("ביטחון בשיחה");
    expect(html).not.toMatch(/דקות|XP|נקודות/);
  });
  it("supports daily packages, overachievement, zero activity and no package", () => {
    const complete = renderToStaticMarkup(createElement(PracticeJourney, { ...props, weeklyDone: 8, weeklyGoal: 7, practicedToday: true }));
    expect(complete).toContain('aria-valuemax="7" aria-valuenow="7"');
    expect(complete).toContain("היעד הושלם");
    const empty = renderToStaticMarkup(createElement(PracticeJourney, { ...props, streak: 0, best: 0, weeklyDone: 0, weeklyGoal: null, packageName: null }));
    expect(empty).not.toContain('role="progressbar"');
    expect(empty).toContain("כשיש חבילה פעילה");
    expect(empty).not.toContain("NaN");
  });
  it("marks only server-qualified dates and disables future days", () => {
    const html = renderToStaticMarkup(createElement(PracticeCalendar, { today: "2026-11-22", dates: ["2026-11-20", "2026-11-21"], since: "2026-07-26", selected: "2026-11-22", onSelect: () => {} }));
    expect(html.match(/יום תרגול הושלם/g)).toHaveLength(2);
    expect(html).toContain('aria-current="date" aria-pressed="true"');
    expect(html).toMatch(/disabled=""[^>]+aria-label="[^"]+בהמשך/);
    expect(html).toContain("ללא יום תרגול");
  });
});

describe("calendar boundaries", () => {
  it("keeps day arithmetic stable across Israel DST and year boundaries", () => {
    expect(shiftDay("2026-10-25", -1)).toBe("2026-10-24");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
  it("aligns Sunday-first calendar grids, leap years and short months", () => {
    expect(monthDays("2026-11")).toMatchObject({ offset: 0 });
    expect(monthDays("2026-11").days).toHaveLength(30);
    expect(monthDays("2028-02").days.at(-1)).toBe("2028-02-29");
    expect(monthDays("2027-02").days.at(-1)).toBe("2027-02-28");
  });
});
