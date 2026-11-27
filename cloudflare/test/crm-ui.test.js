import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => Object.fromEntries(["LayoutDashboard","Users","Phone","Wallet","AudioLines","BookOpen","BarChart3","Megaphone","MessageSquare","ListChecks","Search","Menu","ChevronLeft","Activity","SlidersHorizontal"].map(name=>[name,()=>null])));

let CrmPage, Journey, CustomerCount, DeleteCustomer, AdminIdentityContext, resetErrorMessage, ResetConfirmationHint, CallReviewsReport, CallReviewCosts, TeacherSettingsPanel, parseTeacherSettings, ResetTrialButton;
beforeAll(async () => {
  vi.stubGlobal("location", { pathname: "/dashboard/crm" });
  ({ CrmPage, Journey, CustomerCount, DeleteCustomer, resetErrorMessage, ResetConfirmationHint } = await import("../../src/components/dashboard/CrmPage"));
  ({ CallReviewsReport, CallReviewCosts } = await import("../../src/components/dashboard/CallReviewsPanel"));
  ({ AdminIdentityContext } = await import("../../src/components/dashboard/AdminAuthGate"));
  ({ TeacherSettingsPanel, parseTeacherSettings } = await import("../../src/components/dashboard/TeacherSettingsPanel"));
  ({ ResetTrialButton } = await import("../../src/components/dashboard/ResetTrialButton"));
});
afterAll(() => vi.unstubAllGlobals());
const step = (id, kind, call_id) => ({ id, kind, call_id, at: "2026-11-19T10:00:00Z", label: id });
const renderJourney = steps => renderToStaticMarkup(createElement(Journey, { steps }));

describe("CRM teacher settings and trial reset", () => {
  it("links the teacher section from CRM and renders Hebrew RTL controls", () => {
    const page = renderToStaticMarkup(createElement(CrmPage));
    expect(page).toContain('/dashboard/crm?view=teachers');
    expect(page).toContain('מורים והנחיות');
    const html = renderToStaticMarkup(createElement(TeacherSettingsPanel, { request: vi.fn() }));
    expect(html).toContain('dir="rtl"'); expect(html).toContain('בחירת בוט'); expect(html).toContain('טוענים הגדרות');
    const reset = renderToStaticMarkup(createElement(ResetTrialButton, { customerId: 'person1', request: vi.fn(), onReset: vi.fn() }));
    expect(reset).toContain('אפס ניסיון'); expect(reset).toContain('אישור איפוס ניסיון'); expect(reset).toContain('מנויים, תשלומים ופרטי הלקוח לא ישתנו');
  });
  it("accepts advanced JSON objects and rejects invalid, empty and array input with Hebrew errors", () => {
    expect(parseTeacherSettings('{"voice":"Puck","temperature":0.5}')).toEqual({ voice: 'Puck', temperature: 0.5 });
    expect(parseTeacherSettings('{}')).toEqual({});
    for (const input of ['', '{', 'null', '[]', '1']) expect(() => parseTeacherSettings(input)).toThrow(/[\u0590-\u05ff]/);
  });
});

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

describe("CRM call review tab", () => {
  it.each(["owner", "staff"])("uses the %s role to decide whether to show the report", role => {
    const previous = location.search;
    location.search = "?view=call-reviews";
    try {
      const html = renderToStaticMarkup(createElement(AdminIdentityContext.Provider, { value: { username: role, role } }, createElement(CrmPage)));
      if (role === "owner") {
        expect(html).toContain('href="/dashboard/crm?view=call-reviews" aria-current="page"');
        expect(html).toContain('id="crm-call-reviews-title"');
        expect(html).not.toContain("טוענים נתוני אמת");
      } else {
        expect(html).not.toContain("?view=call-reviews");
        expect(html).toContain("זמינה לבעלי החשבון בלבד");
      }
    } finally { location.search = previous; }
  });

  it("presents Hebrew findings, the average transcript review cost, and on-demand per-call costs", () => {
    const report = {
      coverage: [
        { source: "ai", status: "reviewed", logs: 2, review_cost_usd: 0.0004 },
        { source: "ivr", status: "rules_only", logs: 1, review_cost_usd: 0 },
      ],
      findings: [{ code: "menu_error:options", logs: 1 }, { code: "wrong_language", logs: 1 }],
      prompt_candidates: [{
        profile_id: "teacher", profile_label: "המורה שוחי", bot_version: 4, code: "wrong_language", affected: 3, reviewed: 4, learners: 2,
        evidence_call_ids: ["review-1"], proposed_instruction_he: "תן עזרה קצרה בשפת העזר שנבחרה.",
      }],
      recent: [{ source: "ai", status: "reviewed", call_id: "review-1", ended_at: "2026-11-22T12:00:00Z", findings: [{ code: "wrong_language" }] }],
    };
    report.findings.push({ code: "content_drift", logs: 1 });
    report.recent[0].findings.push({ code: "content_drift" });
    const request = vi.fn();
    const html = renderToStaticMarkup(createElement(CallReviewsReport, { report, request }));
    expect(html).toContain("קלט לא תקין בתפריט אפשרויות");
    expect(html).toContain("שפה לא מתאימה");
    expect(html.match(/המורה גלש לנושא שאינו מתאים לשיעור/g)).toHaveLength(2);
    expect(html).toContain("0.0002");
    expect(html).toContain("פירוט עלות");
    expect(html).toContain("המורה שוחי");
    expect(html).toContain("גרסה 4");
    expect(html).toContain("review-1");
    expect(html).toContain("תן עזרה קצרה בשפת העזר שנבחרה.");
    expect(request).not.toHaveBeenCalled();
  });

  it("distinguishes unknown telephony billing from navigation time or a zero cost", () => {
    const cost = { ai_estimated_usd: 0.34, review_estimated_usd: 0, phone: { navigation_seconds: 52, estimated_ils: null } };
    const html = renderToStaticMarkup(createElement(CallReviewCosts, { cost }));
    expect(html).toContain("0.34");
    expect(html).toContain("0.00");
    expect(html).toContain("אין נתון");
    expect(html).toContain("שניות ניווט, לא זמן לחיוב");
  });
});
