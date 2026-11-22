import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let SubscriptionPanel;
let remainingMinutes, futureMinutes;
beforeAll(async () => {
  vi.stubGlobal("location", { pathname: "/learn" });
  SubscriptionPanel = (await import("../../src/components/portal/SubscriptionPanel")).SubscriptionPanel;
  ({ remainingMinutes, futureMinutes } = await import("../../src/components/portal/portalApi"));
});
afterAll(() => vi.unstubAllGlobals());
const sub = { id: "sub", plan_name: "צעד", status: "active", owner: true, price_agorot: 5900, renewal_amount_agorot: 5900, term_months: null, current_period_start: "2026-01-01", current_period_end: "2026-02-01", pause_until: null, pause_days_remaining: 53, rollover_minutes: 12, rollover: [{ minutes: 12, expires_at: "2026-03-01" }], guarantee_status: null, extension_months: 0, members: [] };
const render = subscriptions => renderToStaticMarkup(createElement(SubscriptionPanel, { token: "local", subscriptions }));
describe("subscription UI states", () => {
  it("separates spendable, future and expired receipt balances", () => {
    const now = Date.now();
    const receipt = { id: "r", product: "school", minutes: 60, spent_seconds: 60, expires_at: new Date(now + 86400000).toISOString() };
    const account = { receipts: [receipt, { ...receipt, valid_from: new Date(now + 3600000).toISOString() }, { ...receipt, expires_at: new Date(now - 86400000).toISOString() }] };
    expect(remainingMinutes(account)).toBe(59);
    expect(futureMinutes(account)).toBe(59);
    expect(remainingMinutes({ receipts: [] })).toBe(0);
    expect(futureMinutes({ receipts: [] })).toBe(0);
    expect(remainingMinutes({ receipts: [{ ...receipt, valid_from: "invalid" }] })).toBe(0);
  });
  it("shows an empty account without exposing management actions", () => {
    const html = render([]);
    expect(html).toContain("עדיין אין מנוי בחשבון");
    expect(html).not.toContain("ימי הקפאה (1–60)");
  });
  it("shows locked price and owner pause controls without internal minute balances", () => {
    const html = render([sub]);
    expect(html).toContain("המחיר נעול כל עוד המנוי פעיל");
    expect(html).not.toContain("דקות");
    expect(html).toContain("בתוקף עד");
    expect(html).toContain("ימי הקפאה (1–60)");
    expect(html).toContain("53");
  });
  it("shows resume for paused owners and no management controls for family learners", () => {
    expect(render([{ ...sub, status: "paused", pause_until: "2026-01-15" }])).toContain(">המשך</button>");
    const html = render([{ ...sub, owner: false }]);
    expect(html).toContain("זהו מנוי משפחתי");
    expect(html).not.toContain("<button");
  });
  it("allows administrators to manage a subscription when viewing a family member", () => {
    const html = renderToStaticMarkup(createElement(SubscriptionPanel, { token: "local", customerId: "member", subscriptions: [{ ...sub, owner: false }] }));
    expect(html).toContain("רישום חיוב חודשי");
    expect(html).toContain("הוספת בן משפחה");
    expect(html).toContain("הערכת אחריות");
    expect(html).not.toContain("ניהול המנוי בחשבון הראשי");
  });
  it("shows access management only in the CRM and explains that billing is unchanged", () => {
    const crm = subscriptions => renderToStaticMarkup(createElement(SubscriptionPanel, { token: "", customerId: "owner", manageAccess: true, subscriptions }));
    const suspended = { ...sub, access_suspended_at: "2026-01-01" };
    expect(crm([sub])).toContain("השעיית גישה");
    expect(crm([sub])).toContain("ללא שינוי בחיוב");
    expect(crm([suspended])).toContain("פתיחת גישה מחדש");
    expect(render([suspended])).toContain("הגישה דרך המנוי הושעתה");
    expect(render([suspended])).not.toContain("פתיחת גישה מחדש");
  });
  it("labels prepaid mastery prices as a term price rather than a monthly charge", () => {
    const html = render([{ ...sub, term_months: 12, price_agorot: 149000 }]);
    expect(html).toContain("מחיר המסלול הנעול");
    expect(html).toContain("ל־12 חודשים");
    expect(html).not.toContain("מחיר חודשי נעול");
  });
  it("keeps cancellation and manual renewal available to administrators for past-due subscriptions", () => {
    const html = renderToStaticMarkup(createElement(SubscriptionPanel, { token: "local", customerId: "owner", subscriptions: [{ ...sub, status: "past_due" }] }));
    expect(html).toContain("ממתין לתשלום");
    expect(html).toContain(">ביטול</button>");
    expect(html).toContain("רישום חיוב חודשי");
    expect(html).not.toContain("ימי הקפאה (1–60)");
  });
});
