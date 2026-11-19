import { afterEach, describe, expect, it, vi } from "vitest";
import { callbackFailure, dispatchCallbacks, nextCallingSlot, parsePreferredTime, submitCallback } from "../src/callbacks";
import type { Env } from "../src/env";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Israeli calling hours", () => {
  it.each([
    ["2026-01-04T19:59:00Z", "2026-01-04T19:59:00Z"],
    ["2026-01-04T20:00:00Z", "2026-01-05T06:00:00Z"],
    ["2026-01-04T01:00:00Z", "2026-01-04T06:00:00Z"],
    ["2026-01-09T13:00:00Z", "2026-01-11T06:00:00Z"],
    ["2026-03-27T12:00:00Z", "2026-03-29T05:00:00Z"],
    ["2026-07-05T00:00:00Z", "2026-07-05T05:00:00Z"],
    ["2026-01-09T11:59:00Z", "2026-01-09T11:59:00Z"],
  ])("moves %s to %s", (input, expected) => {
    expect(nextCallingSlot(new Date(input)).toISOString()).toBe(new Date(expected).toISOString());
  });
});

describe("preferred time parsing", () => {
  const now = new Date("2026-01-04T10:00:00Z");
  it.each([
    ["היום ב-20", "2026-01-04T18:00:00Z"],
    ["מחר בשעה 8", "2026-01-05T06:00:00Z"],
    ["מחרתיים בבוקר", "2026-01-06T08:00:00Z"],
    ["יום שני 8 בערב", "2026-01-05T18:00:00Z"],
    ["שבת בצהריים", "2026-01-10T11:00:00Z"],
    ['מחר אחה"צ', "2026-01-05T14:00:00Z"],
    ["מחר אחר הצהריים", "2026-01-05T14:00:00Z"],
    ["מחר בערב", "2026-01-05T17:00:00Z"],
    ["08:30", "2026-01-05T06:30:00Z"],
    ["14:30", "2026-01-04T12:30:00Z"],
    ["12/01 15:45", "2026-01-12T13:45:00Z"],
  ])("parses %s", (text, expected) => {
    expect(parsePreferredTime(text, now)?.toISOString()).toBe(new Date(expected).toISOString());
  });
  it.each(["", "כשאפשר", "25:00", "12:99", "31/02"])("rejects %s", text => {
    expect(parsePreferredTime(text, now)).toBeNull();
  });
});

describe("callback retries", () => {
  it("backs off fifteen minutes, then sixty, then stops", () => {
    const now = new Date("2026-01-04T10:00:00Z");
    expect(callbackFailure(1, now)).toEqual({ status: "queued", nextAttemptAt: "2026-01-04T10:15:00.000Z" });
    expect(callbackFailure(2, now)).toEqual({ status: "queued", nextAttemptAt: "2026-01-04T11:00:00.000Z" });
    expect(callbackFailure(3, now)).toEqual({ status: "failed", nextAttemptAt: null });
  });
  it("defers retries across Shabbat", () => {
    expect(callbackFailure(1, new Date("2026-01-09T11:50:00Z")).nextAttemptAt).toBe("2026-01-11T06:00:00.000Z");
  });
  it("does not touch the queue without a dialer", async () => {
    expect(await dispatchCallbacks({} as Env)).toEqual({ skipped: "dialer not configured" });
  });
  it("recovers stale claims but does not dial out of hours", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-04T01:00:00Z"));
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { CALLBACK_RELAY_URL: "https://relay.test", CALLBACK_RELAY_SECRET: "test", DB: { prepare } } as unknown as Env;
    expect(await dispatchCallbacks(env)).toEqual({ skipped: "outside calling hours" });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith("2026-01-04T01:00:00.000Z", "2026-01-04T01:00:00.000Z", "2026-01-04T00:45:00.000Z");
  });
});

describe("callback requests", () => {
  it.each([
    [{ timing: "scheduled", preferred_at: "2026-01-09T13:00:00Z" }, "2026-01-11T06:00:00.000Z"],
    [{ timing: "scheduled", preferred_time: "מחר בערב" }, "2026-01-05T17:00:00.000Z"],
    [{ timing: "scheduled", preferred_time: "" }, "2026-01-04T10:00:00.000Z"],
    [{ timing: "now" }, "2026-01-04T10:00:00.000Z"],
  ])("persists the scheduled slot for %j", async (schedule, expected) => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-04T10:00:00Z"));
    const run = vi.fn().mockResolvedValue({});
    const insert = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValueOnce({ bind: () => ({ first: async () => null }) }).mockReturnValueOnce({ bind: insert });
    const request = new Request("https://example.test/v1/public/callback", { method: "POST", body: JSON.stringify({ name: "Test", phone: "0501234567", for_whom: "self", consent: true, ...schedule }) });
    expect((await submitCallback(request, { DB: { prepare } } as unknown as Env)).status).toBe(201);
    expect(insert.mock.calls[0].at(-1)).toBe(expected);
  });
  it.each(["not-a-date", "2025-01-01T10:00:00Z", "2027-01-01T10:00:00Z"])("rejects invalid preferred_at %s", async preferred_at => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-04T10:00:00Z"));
    const request = new Request("https://example.test/v1/public/callback", { method: "POST", body: JSON.stringify({ name: "Test", phone: "0501234567", for_whom: "self", timing: "scheduled", consent: true, preferred_at }) });
    await expect(submitCallback(request, {} as Env)).rejects.toMatchObject({ status: 422 });
  });
});
