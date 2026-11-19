import { describe, expect, it, vi } from "vitest";
import { followupText } from "../../src/components/dashboard/AdCampaignsPanel";

vi.mock("../../src/components/portal/portalApi", () => ({ portalRequest: vi.fn() }));
vi.mock("lucide-react", () => ({ Megaphone: () => null }));

describe("lesson follow-up labels", () => {
  it.each([
    ["sunday", "יום ראשון"], ["monday", "יום שני"], ["tuesday", "יום שלישי"],
    ["wednesday", "יום רביעי"], ["thursday", "יום חמישי"], ["friday", "יום שישי"], ["saturday", "שבת"],
  ])("renders %s", (day, label) => {
    expect(followupText({ type: "lesson", day, part_of_day: "noon" })).toBe(`שיעור הבא: ${label} בצהריים`);
  });
  it.each(["2026-01-05T08:00:00Z", "2026-07-06T07:00:00Z"])("shows scheduled_at in Israel time for %s", scheduled_at => {
    const text = followupText({ type: "lesson", day: "tomorrow", part_of_day: "morning", scheduled_at });
    expect(text).toContain("מועד החיוג (שעון ישראל)");
    expect(text).toContain("10:00");
  });
  it.each([undefined, "invalid"])("handles missing or invalid scheduled_at %s", scheduled_at => {
    expect(followupText({ type: "lesson", scheduled_at })).toBe("שיעור הבא: מועד אחר ");
  });
});
