import { describe, expect, it } from "vitest";
import { dayKey, minutesLabel, practiceDays, type PracticeSession } from "../../src/components/portal/practiceStats";

const session = (started_at: string, duration_seconds: number): PracticeSession => ({ call_id: started_at, started_at, duration_seconds, summary_he: "", success_he: "", next_step_he: "" });

describe("Israeli practice calendar", () => {
  it("combines sessions by Israeli date rather than UTC or the browser timezone", () => {
    const days = practiceDays([session("2026-11-18T22:30:00Z", 90), session("2026-11-19T04:00:00Z", 30), session("2026-11-18T21:30:00Z", 60)], 7, new Date("2026-11-19T10:00:00Z"));
    expect(days.at(-1)).toMatchObject({ key: "2026-11-19", seconds: 120 });
    expect(days.at(-2)).toMatchObject({ key: "2026-11-18", seconds: 60 });
    expect(days[0]).toMatchObject({ key: "2026-11-13", seconds: 0 });
    expect(minutesLabel(30)).toBe("0.5");
  });
  it("keeps unique consecutive calendar days across Israel's DST change", () => {
    const days = practiceDays([], 7, new Date("2026-10-27T00:00:00Z"));
    expect(days.map(d => d.key)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(dayKey(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25");
  });
  it("does not invent activity on empty days or include out-of-range activity", () => {
    const days = practiceDays([session("2026-10-01T10:00:00Z", 600)], 30, new Date("2026-11-19T10:00:00Z"));
    expect(days).toHaveLength(30);
    expect(days.every(d => d.seconds === 0 && d.sessions.length === 0)).toBe(true);
  });
});
