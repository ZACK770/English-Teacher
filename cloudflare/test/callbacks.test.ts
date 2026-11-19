import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTechnolineCallbackBody, callbackFailure, dialTechnolineCallback, dispatchCallbacks, followupLessonTime, listCallbacks, nextCallingSlot, nextImmediateSlot, parsePreferredTime, resolveCallbackExtension, submitCallback, testCallbackDial } from "../src/callbacks";
import type { Env } from "../src/env";
import worker from "../src/index";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Technoline callback dialer", () => {
  const env = { TLIVR_SYSTEM_API_KEY: "test-key", TLIVR_CALLBACK_EXTENSION_ID: "456", TLIVR_PROJECT_PATH: "/" } as Env;
  it.each([
    ["2026-01-04T10:00:00Z", 2],
    ["2026-01-04T19:29:00Z", 2],
    ["2026-01-04T19:30:00Z", 0],
    ["2026-01-04T21:45:00Z", 0],
    ["2026-01-09T11:29:00Z", 2],
    ["2026-01-09T11:30:00Z", 0],
    ["2026-01-04T05:45:00Z", 0],
    ["2026-03-27T10:30:00Z", 0],
    ["2026-01-10T10:00:00Z", 0],
  ])("limits retries at %s", (now, expected) => {
    expect(buildTechnolineCallbackBody(env, "0501234567", "req-1", new Date(now)).dialRetries).toBe(expected);
  });
  it("builds the campaign without demo and has no hardcoded extension default", () => {
    const now = new Date("2026-01-04T10:00:00Z");
    expect(buildTechnolineCallbackBody(env, "0501234567", "req-1", now)).toEqual({
      action: "campaignRun", apiKey: "test-key", phones: ["0501234567"], title: "SpeakCall callback",
      messagesType: "extensionActivation", extensionActivation: "456", dialRetries: 2,
      betweenRetries: 15, reasonableHours: "no", externalID: "req-1",
    });
    expect(buildTechnolineCallbackBody({ ...env, TLIVR_CALLBACK_EXTENSION_ID: "123" }, "0501234567", "req-1", now, true))
      .toMatchObject({ demo: "yes", extensionActivation: "123" });
    expect(buildTechnolineCallbackBody({ ...env, TLIVR_CALLBACK_EXTENSION_ID: undefined }, "0501234567", "req-1", now).extensionActivation).toBeUndefined();
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
    expect(result).toEqual({ ok: true, errorCode: 0, campaignId: "demo", billing: 0, extension: { id: "456", name: null, path: "/" } });
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

describe("callback extension resolution", () => {
  it("resolves the project base, uses it for dialing, and caches it per isolate", async () => {
    const env = { TLIVR_SYSTEM_API_KEY: "resolve-test", TLIVR_PROJECT_PATH: "/" } as Env;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "OK", id: 654, name: "Live teacher" }))
      .mockResolvedValueOnce(Response.json({ status: "OK", errorCode: 0, campaignId: "demo" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await dialTechnolineCallback(env, "0501234567", "test", true);
    expect(result.extension).toEqual({ id: "654", name: "Live teacher", path: "/" });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).pathname).toBe("/ivrFilesApi.php");
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ apiKey: "resolve-test", action: "folderSettings", path: "/" });
    expect(init).toMatchObject({ method: "GET", headers: { "User-Agent": "speakcall-callbacks/1.0" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ extensionActivation: "654", demo: "yes" });
    expect(await resolveCallbackExtension(env)).toEqual(result.extension);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await resolveCallbackExtension({ ...env, TLIVR_CALLBACK_EXTENSION_ID: "777" })).toEqual({ id: "777", name: null, path: "/" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    [403, { id: 654 }], [200, { status: "ERROR", id: 654 }], [200, {}], [200, null], [200, { id: "not-numeric" }],
  ])("does not dial or cache failed resolution %s %j", async (status, body) => {
    const env = { TLIVR_SYSTEM_API_KEY: "resolution-failure", TLIVR_PROJECT_PATH: "/live" } as Env;
    const fetcher = vi.fn().mockImplementation(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetcher);
    await expect(dialTechnolineCallback(env, "0501234567", "test")).rejects.toMatchObject({ status: 502, detail: "Technoline extension resolution failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(resolveCallbackExtension(env)).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("sanitizes resolution transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sensitive URL")));
    await expect(resolveCallbackExtension({ TLIVR_SYSTEM_API_KEY: "transport-failure" } as Env)).rejects.toMatchObject({ status: 502, detail: "Technoline extension resolution failed" });
  });
});

describe("Israeli calling hours", () => {
  it("keeps only immediate form calls exempt from overnight hours", () => {
    const night = new Date("2026-01-04T01:00:00Z");
    expect(nextImmediateSlot(night)).toEqual(night);
    expect(nextCallingSlot(night).toISOString()).toBe("2026-01-04T06:00:00.000Z");
    expect(callbackFailure(1, night).nextAttemptAt).toBe("2026-01-04T06:00:00.000Z");
  });
  it.each([
    ["2026-01-04T19:59:00Z", "2026-01-04T19:59:00Z"],
    ["2026-01-04T20:00:00Z", "2026-01-05T06:00:00Z"],
    ["2026-01-04T01:00:00Z", "2026-01-04T06:00:00Z"],
    ["2026-01-09T13:00:00Z", "2026-01-10T18:00:00Z"],
    ["2026-03-27T12:00:00Z", "2026-03-28T17:00:00Z"],
    ["2026-07-05T00:00:00Z", "2026-07-05T05:00:00Z"],
    ["2026-03-28T16:59:00Z", "2026-03-28T17:00:00Z"],
    ["2026-03-28T17:00:00Z", "2026-03-28T17:00:00Z"],
    ["2026-10-24T21:00:00Z", "2026-10-25T06:00:00Z"],
    ["2026-01-09T11:59:00Z", "2026-01-09T11:59:00Z"],
  ])("moves %s to %s", (input, expected) => {
    expect(nextCallingSlot(new Date(input)).toISOString()).toBe(new Date(expected).toISOString());
  });
});

describe("follow-up lesson times", () => {
  it.each([
    ["tomorrow", "morning", "2026-01-05T08:00:00.000Z"],
    ["tomorrow", "noon", "2026-01-05T14:00:00.000Z"],
    ["tomorrow", "afternoon", "2026-01-05T14:00:00.000Z"],
    ["tomorrow", "evening", "2026-01-05T17:00:00.000Z"],
    ["monday", "morning", "2026-01-05T08:00:00.000Z"],
    ["today", "morning", "2026-01-05T08:00:00.000Z"],
    ["friday", "evening", "2026-01-10T18:00:00.000Z"],
    ["this_week", "morning", "2026-01-04T15:00:00.000Z"],
    ["other", "evening", "2026-01-04T15:00:00.000Z"],
    ["unknown", "morning", "2026-01-04T15:00:00.000Z"],
    ["", "", "2026-01-04T15:00:00.000Z"],
  ])("resolves %s %s", (day, part, expected) => {
    expect(followupLessonTime(day, part, new Date("2026-01-04T10:00:00Z")).toISOString()).toBe(expected);
  });
  it("moves an ambiguous weekend request to Sunday at 17:00 Israel time", () => {
    expect(followupLessonTime("other", "evening", new Date("2026-01-09T10:00:00Z")).toISOString()).toBe("2026-01-11T15:00:00.000Z");
  });
  it("uses summer Israel time", () => {
    expect(followupLessonTime("tomorrow", "morning", new Date("2026-07-05T10:00:00Z")).toISOString()).toBe("2026-07-06T07:00:00.000Z");
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
    ["ב-12/01 בשעה 15", "2026-01-12T13:00:00Z"],
    ["12/01 ב-9", "2026-01-12T07:00:00Z"],
    ["בשעה 15 ב-12/01", "2026-01-12T13:00:00Z"],
    ["12.01 בשעה 15", "2026-01-04T10:01:00Z"],
    ["ב-12.01 בשעה 15", "2026-01-04T10:01:00Z"],
    ["בשעה 15 ב-12.01", "2026-01-04T13:00:00Z"],
    ["ב-12.01 15:00", "2026-01-04T10:01:00Z"],
    ["12.01 ב-9", "2026-01-04T10:01:00Z"],
    ["בשעה 15 12.01", "2026-01-04T13:00:00Z"],
    ["10.00", "2026-01-05T08:00:00Z"],
    ["9.30", "2026-01-05T07:30:00Z"],
    ["בשעה 10.05", "2026-01-05T08:05:00Z"],
    ["מחר בשעה 10.00", "2026-01-05T08:00:00Z"],
    ["מחר ב-10.05", "2026-01-05T08:05:00Z"],
    ["מחר ב10.05", "2026-01-05T08:05:00Z"],
    ["12.01", "2026-01-04T10:01:00Z"],
    ["מחר בשעה 10.05 עד 12:00", "2026-01-05T08:05:00Z"],
    ["מחר בשעה 15.", "2026-01-05T13:00:00Z"],
    ["מחר ב-9.", "2026-01-05T07:00:00Z"],
    ["10.05 עד 12:00", "2026-01-05T08:05:00Z"],
    ["מחר ב-9 עד בשעה 15", "2026-01-05T07:00:00Z"],
    ["מחר 14:00 בשעה 15", "2026-01-05T12:00:00Z"],
    ["יום שני 12.01", "2026-01-05T10:01:00Z"],
    ["מחר 12/01 15:00", "2026-01-12T13:00:00Z"],
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
    expect(callbackFailure(1, new Date("2026-01-09T11:50:00Z")).nextAttemptAt).toBe("2026-01-10T18:00:00.000Z");
  });
  it("does not touch the queue without a dialer", async () => {
    expect(await dispatchCallbacks({} as Env)).toEqual({ skipped: "dialer not configured" });
  });
  it("recovers stale claims but does not dial out of hours", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-10T01:00:00Z"));
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { CALLBACK_RELAY_URL: "https://relay.test", CALLBACK_RELAY_SECRET: "test", DB: { prepare } } as unknown as Env;
    expect(await dispatchCallbacks(env)).toEqual({ skipped: "outside calling hours" });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(bind).toHaveBeenCalledWith("2026-01-10T01:00:00.000Z", "2026-01-10T01:00:00.000Z", "2026-01-10T00:45:00.000Z");
  });
});

describe("callback requests", () => {
  it.each([
    [{ timing: "scheduled", preferred_at: "2026-01-09T13:00:00Z" }, "2026-01-10T18:00:00.000Z"],
    [{ timing: "scheduled", preferred_time: "מחר בערב" }, "2026-01-05T17:00:00.000Z"],
    [{ timing: "scheduled", preferred_time: "" }, "2026-01-04T10:00:00.000Z"],
    [{ timing: "now" }, "2026-01-04T10:00:00.000Z"],
  ])("persists the scheduled slot for %j", async (schedule, expected) => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-04T10:00:00Z"));
    const run = vi.fn().mockResolvedValue({});
    const insert = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn()
      .mockReturnValueOnce({ bind: () => ({ first: async () => null }) })
      .mockReturnValueOnce({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) })
      .mockReturnValueOnce({ bind: insert });
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

describe("immediate callback submission", () => {
  function setup(now = "2026-01-04T01:00:00Z", duplicate = false, configured = true) {
    vi.useFakeTimers().setSystemTime(new Date(now));
    const writes: unknown[][] = [];
    const DB = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
      first: async () => duplicate ? { id: "existing" } : null,
      run: async () => { writes.push([sql, ...args]); return { meta: { changes: 1 } }; },
    }) }) };
    const env = { DB, ...(configured ? { TLIVR_SYSTEM_API_KEY: "mock", TLIVR_CALLBACK_EXTENSION_ID: "456" } : {}) } as unknown as Env;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "OK", errorCode: 0, campaignId: "campaign" }));
    vi.stubGlobal("fetch", fetcher);
    const submit = (timing = "now") => submitCallback(new Request("https://speakcall.app/v1/public/callback", {
      method: "POST", body: JSON.stringify({ name: "Test", phone: "0501234567", for_whom: "self", timing, consent: true }),
    }), env);
    return { submit, fetcher, writes };
  }
  it("claims and dials an overnight request immediately", async () => {
    const { submit, fetcher, writes } = setup();
    expect(await (await submit()).json()).toMatchObject({ ok: true, status: "dialed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "campaignRun", reasonableHours: "no" });
    expect(writes.some(row => String(row[0]).includes("status='dialing'"))).toBe(true);
    expect(writes.at(-1)?.slice(1, 4)).toEqual(["dialed", "campaign", null]);
  });
  it("queues during Shabbat without dialing", async () => {
    const { submit, fetcher } = setup("2026-01-09T12:00:00Z");
    expect(await (await submit()).json()).toMatchObject({ status: "queued", reason: "shabbat" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("queues without a configured dialer", async () => {
    const { submit, fetcher } = setup(undefined, false, false);
    expect(await (await submit()).json()).toMatchObject({ status: "queued" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["rejected", "offline"])("queues with a retry after %s dial failure", async failure => {
    const { submit, fetcher, writes } = setup();
    if (failure === "offline") fetcher.mockRejectedValue(new Error("offline"));
    else fetcher.mockResolvedValue(Response.json({ status: "ERROR", errorCode: 5 }));
    expect(await (await submit()).json()).toMatchObject({ status: "queued" });
    expect(writes.at(-1)).toContain("2026-01-04T06:00:00.000Z");
  });
  it("does not dial duplicates", async () => {
    const { submit, fetcher, writes } = setup(undefined, true);
    expect(await (await submit()).json()).toEqual({ ok: true, id: "existing", duplicate: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
  it("does not immediately dial scheduled requests", async () => {
    const { submit, fetcher } = setup();
    expect(await (await submit("scheduled")).json()).toMatchObject({ status: "queued" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("legacy hostname redirect", () => {
  it.each(["speakcall.app", "www.speakcall.app"])("redirects %s before API handling", async host => {
    const response = await worker.fetch(new Request("http://" + host + "/english/learn?x=a%2Fb&y=2"), {} as Env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://speakool.net/english/learn?x=a%2Fb&y=2");
  });

  it.each([
    ["/v1/technoline/router", { Upgrade: "websocket" }],
    ["/english/v1/public/stats", {}],
    ["/healthz", {}],
    ["/learn", { Upgrade: "websocket" }],
  ])("does not redirect API, health or WebSocket request %s", async (path, headers) => {
    const response = await worker.fetch(new Request("https://speakcall.app" + path, { headers }), {} as Env).catch(() => null);
    expect(response?.status).not.toBe(302);
  });

  it("does not redirect legacy POST submissions", async () => {
    const response = await worker.fetch(new Request("http://speakcall.app/v1/public/callback", { method: "POST" }), {} as Env).catch(() => null);
    expect(response?.status).not.toBe(302);
  });
});
