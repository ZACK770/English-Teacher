import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let Journey, CustomerCount;
beforeAll(async () => {
  vi.stubGlobal("location", { pathname: "/dashboard/crm" });
  ({ Journey, CustomerCount } = await import("../../src/components/dashboard/CrmPage"));
});
afterAll(() => vi.unstubAllGlobals());
const step = (id, kind, call_id) => ({ id, kind, call_id, at: "2026-11-19T10:00:00Z", label: id });
const renderJourney = steps => renderToStaticMarkup(createElement(Journey, { steps }));

describe("CRM physical call grouping", () => {
  it("groups multiple suffixed bot sessions with their IVR/ad call under a single heading", () => {
    const html = renderJourney([
      step("ad", "ad-entries", "pbx"), step("menu", "ivr-events", "pbx"),
      step("start1", "session-start", "pbx123"), step("end1", "session-end", "pbx123"),
      step("start2", "session-start", "pbx456"), step("end2", "session-end", "pbx456"),
    ]);
    expect(html.match(/<h3>/g)).toHaveLength(1);
    expect(html.match(/class="crm-step"/g)).toHaveLength(6);
  });
  it("prefers exact matches and then the longest physical-call prefix", () => {
    const html = renderJourney([
      step("short-menu", "ivr-events", "pbx"),
      step("long-menu", "ivr-events", "pbx123"),
      step("exact", "session-start", "pbx123"),
      step("suffix", "session-end", "pbx123abc"),
    ]);
    const groups = html.split('class="crm-journey-group"').slice(1);
    expect(groups).toHaveLength(2);
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
