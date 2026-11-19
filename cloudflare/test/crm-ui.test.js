import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let Journey, CustomerCount, DeleteCustomer, AdminIdentityContext, resetErrorMessage, ResetConfirmationHint;
beforeAll(async () => {
  vi.stubGlobal("location", { pathname: "/dashboard/crm" });
  ({ Journey, CustomerCount, DeleteCustomer, resetErrorMessage, ResetConfirmationHint } = await import("../../src/components/dashboard/CrmPage"));
  ({ AdminIdentityContext } = await import("../../src/components/dashboard/AdminAuthGate"));
});
afterAll(() => vi.unstubAllGlobals());
const step = (id, kind, call_id) => ({ id, kind, call_id, at: "2026-11-19T10:00:00Z", label: id });
const renderJourney = steps => renderToStaticMarkup(createElement(Journey, { steps }));

describe("CRM physical call grouping", () => {
  it("groups multiple suffixed bot sessions with their IVR/ad call under a single heading", () => {
    const html = renderJourney([
      step("ad", "ad-entries", "pbx"), step("menu", "ivr-events", "pbx"),
      step("start1", "session-start", "pbx~123"), step("end1", "session-end", "pbx~123"),
      step("start2", "session-start", "pbx~456"), step("end2", "session-end", "pbx~456"),
    ]);
    expect(html.match(/<h3>/g)).toHaveLength(1);
    expect(html.match(/class="crm-step"/g)).toHaveLength(6);
  });
  it("prefers exact matches and then the longest physical-call prefix", () => {
    const html = renderJourney([
      step("short-menu", "ivr-events", "pbx"),
      step("long-menu", "ivr-events", "pbx123"),
      step("exact", "session-start", "pbx123"),
      step("suffix", "session-end", "pbx123~abc"),
      step("unrelated", "session-start", "pbx1234"),
    ]);
    const groups = html.split('class="crm-journey-group"').slice(1);
    expect(groups).toHaveLength(3);
    expect(groups[2]).toContain("<strong>unrelated</strong>");
    expect(groups[0]).not.toContain("<strong>exact</strong>");
    expect(groups[1]).toContain("<strong>exact</strong>");
    expect(groups[1]).toContain("<strong>suffix</strong>");
  });
  it("keeps unmatched calls, unassociated activity and empty journeys independent", () => {
    const html = renderJourney([
      step("menu", "ivr-events", "pbx"), step("web", "session-start", "other"),
      step("activity", "receipt", null),
    ]);
    expect(html.match(/<h3>/g)).toHaveLength(3);
    expect(renderJourney([])).not.toContain("<h3>");
  });
});

describe("CRM customer reset confirmation", () => {
  it.each(["detail", "message", "error"])("shows the server Hebrew %s message", field => {
    expect(resetErrorMessage({ [field]: "מחיקת הלקוח נכשלה עקב שגיאת שרת" })).toBe("מחיקת הלקוח נכשלה עקב שגיאת שרת");
  });
  it.each([null, {}, { detail: "Request failed" }, { detail: 500 }])("uses a Hebrew fallback for unavailable server detail %j", body => {
    expect(resetErrorMessage(body)).toBe("מחיקת הלקוח נכשלה. נסו שוב או פנו לתמיכה.");
  });
  it.each(["", "wrong", "0501234567"])("shows a Hebrew confirmation hint unless %s matches", confirm => {
    const html = renderToStaticMarkup(createElement(ResetConfirmationHint, { confirm, expected: "0501234567" }));
    if (confirm === "0501234567") expect(html).toBe("");
    else expect(html).toContain("האישור אינו תואם");
  });
  it.each(["staff", null])("hides delete controls for role %s", role => {
    const html = renderToStaticMarkup(createElement(AdminIdentityContext.Provider, { value: role ? { username: "staff", role } : null }, createElement(DeleteCustomer, { person: { id: "person1", phone: "0501234567" } })));
    expect(html).toBe("");
  });
  it.each(["0501234567", ""])("explains destructive reset, provider billing and confirmation for phone %s", phone => {
    const html = renderToStaticMarkup(createElement(AdminIdentityContext.Provider, { value: { username: "owner", role: "owner" } }, createElement(DeleteCustomer, { person: { id: "person1", phone } })));
    expect(html).toContain("מחיקת לקוח");
    expect(html).toContain("איפוס למתקשר חדש");
    expect(html).toContain("המחיקה אינה מבטלת חיובים אצל ספק התשלום");
    expect(html).toContain("לא ניתן לבטל את המחיקה");
    expect(html).toContain(phone || "person1");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(html).toContain('aria-describedby="crm-reset-hint"');
    expect(html).toContain("האישור אינו תואם");
  });
});

describe("CRM filtered customer KPI", () => {
  const list = { total: 174, counts: { trial: 12, paying: 0 } };
  it.each([["", "174"], ["trial", "12"], ["paying", "0"], ["new", "0"]])("shows the full filtered count for status %s", (status, count) => {
    const html = renderToStaticMarkup(createElement(CustomerCount, { list, status }));
    expect(html).toContain(`<strong>${count}</strong>`);
    expect(html).toContain("לקוחות בתצוגה");
  });
  it("shows a placeholder before results load", () => {
    expect(renderToStaticMarkup(createElement(CustomerCount, { list: null, status: "trial" }))).toContain("<strong>—</strong>");
  });
});
