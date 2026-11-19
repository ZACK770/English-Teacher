import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTechnolineCallbackBody, callbackFailure, dialTechnolineCallback, dispatchCallbacks, listCallbacks, nextCallingSlot, parsePreferredTime, submitCallback, testCallbackDial } from "../src/callbacks";
import type { Env } from "../src/env";
import worker from "../src/index";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Technoline callback dialer", () => {
  const env = { TLIVR_SYSTEM_API_KEY: "test-key" } as Env;
  it.each([
    ["2026-01-04T10:00:00Z", 2],
    ["2026-01-04T19:29:00Z", 2],
    ["2026-01-04T19:30:00Z", 0],
    ["2026-01-09T11:29:00Z", 2],
    ["2026-01-09T11:30:00Z", 0],
    ["2026-01-04T05:45:00Z", 0],
    ["2026-03-27T10:30:00Z", 0],
    ["2026-01-10T10:00:00Z", 0],
  ])("limits retries at %s", (now, expected) => {
    expect(buildTechnolineCallbackBody(env, "0501234567", "req-1", new Date(now)).dialRetries).toBe(expected);
  });
  it("builds the default campaign without demo and supports an extension override", () => {
    const now = new Date("2026-01-04T10:00:00Z");
    expect(buildTechnolineCallbackBody(env, "0501234567", "req-1", now)).toEqual({
      action: "campaignRun", apiKey: "test-key", phones: ["0501234567"], title: "SpeakCall callback",
      messagesType: "extensionActivation", extensionActivation: "11937", dialRetries: 2,
      betweenRetries: 15, reasonableHours: "yes", externalID: "req-1",
    });
    expect(buildTechnolineCallbackBody({ ...env, TLIVR_CALLBACK_EXTENSION_ID: "123" }, "0501234567", "req-1", now, true))
      .toMatchObject({ demo: "yes", extensionActivation: "123" });
  });
  it.each([
    [200, { status: "OK", errorCode: 0, campaignId: "demo", billing: 0 }, true],
    [200, { status: "ok", errorCode: "0", campaignId: 123 }, true],
    [403, { status: "OK", errorCode: 0 }, false],
    [200, { status: "ERROR", errorCode: 5 }, false],
    [200, { status: "OK" }, false],
    [200, null, false],
  ])("parses status %s and %j", async (status, body, expected) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(body, { status }));
    vi.stubGlobal("fetch", fetcher);
    const result = await dialTechnolineCallback(env, "0501234567", "req-1");
    expect(result.ok).toBe(expected);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.tlivr.com/campaignApi.php");
    expect(init).toMatchObject({ method: "POST", headers: { "User-Agent": "speakcall-callbacks/1.0", "Content-Type": "application/json", Accept: "application/json" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns only demo result fields and never the provider's credential", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "OK", errorCode: 0, campaignId: "demo", billing: 0, apiKey: "test-key" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await testCallbackDial(new Request("https://example.test", { method: "POST", body: JSON.stringify({ phone: "+972501234567" }) }), env);
    expect(result).toEqual({ ok: true, errorCode: 0, campaignId: "demo", billing: 0 });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ demo: "yes", phones: ["0501234567"] });
  });
  it("rejects malformed phones without fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(testCallbackDial(new Request("https://example.test", { method: "POST", body: '{"phone":"bad"}' }), env)).rejects.toMatchObject({ status: 422 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sensitive provider details")));
    await expect(testCallbackDial(new Request("https://example.test", { method: "POST", body: '{"phone":"0501234567"}' }), env)).rejects.toMatchObject({ status: 502, detail: "Technoline unreachable" });
  });
  it("requires admin bearer authentication for dial-test", async () => {
    const response = await worker.fetch(new Request("https://example.test/v1/admin/callbacks/dial-test", { method: "POST", body: '{"phone":"0501234567"}' }), { ...env, ADMIN_BEARER_SECRET: "admin-test" } as Env);
    expect(response.status).toBe(401);
  });
  it("reports a built-in dialer as configured", async () => {
    const DB = { prepare: () => ({ all: async () => ({ results: [] }) }) };
    expect(await listCallbacks({ ...env, DB } as unknown as Env)).toEqual({ items: [], dialer_configured: true });
  });
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
