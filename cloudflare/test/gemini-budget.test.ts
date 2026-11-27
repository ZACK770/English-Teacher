import { afterEach, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { acquireCascadeBudget, CASCADE_BUDGET_GUARD_NAME, acquireGeminiBudget, applyBudget, applyGeminiOutcome, budgetConfig, GeminiBudget, newBudgetLedger, reportGeminiOutcome } from "../src/gemini-budget";

const now = Date.parse("2026-11-19T12:00:00Z");
const limits = budgetConfig({} as Env);

it("shares ten slots across all jobs and releases them without refunding accrued spend", () => {
  const ledger = newBudgetLedger(now);
  for (let i = 0; i < limits.maxJobs; i++) {
    expect(applyBudget(ledger, now, limits, "acquire", "call-" + i).denial).toBeUndefined();
  }
  expect(applyBudget(ledger, now, limits, "acquire", "preview").denial).toBe("system_busy");
  expect(applyBudget(ledger, now + 1000, limits, "release", "call-3", 25_000).estimated_spend_usd).toBe(0.025);
  expect(applyBudget(ledger, now + 1000, limits, "acquire", "preview").active_jobs).toBe(10);
});

it("uses reservations when admitting jobs and stops renewing when measured cost leaves no budget", () => {
  const ledger = newBudgetLedger(now);
  const small = { ...limits, daily: 200_000 };
  applyBudget(ledger, now, small, "acquire", "web");
  applyBudget(ledger, now, small, "acquire", "phone");
  expect(applyBudget(ledger, now, small, "acquire", "text")).toMatchObject({
    denial: "gemini_budget_reached", active_jobs: 2, reserved_usd: 0.175, alert_state: "pending",
  });
  expect(applyBudget(ledger, now + 10_000, small, "check", "web", 150_000)).toMatchObject({
    denial: "gemini_budget_reached", estimated_spend_usd: 0.15,
  });
  applyBudget(ledger, now + 20_000, small, "release", "web", 160_000);
  expect(applyBudget(ledger, now + 20_000, small, "acquire", "text").denial).toBe("gemini_budget_reached");
});

it("retains stale reservations as spend, frees slots, and rejects late renewals", () => {
  const ledger = newBudgetLedger(now);
  applyBudget(ledger, now, limits, "acquire", "lost");
  expect(applyBudget(ledger, now + 35_000, limits, "check", "lost", 0)).toMatchObject({
    denial: "gemini_guard_unavailable", estimated_spend_usd: 0.0875, active_jobs: 0, reserved_usd: 0,
  });
});

it("admits and renews paid leases over the daily cap while still accounting for spend and holds", () => {
  const ledger = newBudgetLedger(now);
  ledger.spent = limits.daily;
  expect(applyBudget(ledger, now, limits, "acquire", "paid", 0, true)).toMatchObject({ active_jobs: 1, reserved_usd: 0.0875 });
  expect(ledger.leases.paid.paid).toBe(true);
  const renewed = applyBudget(ledger, now + 10_000, limits, "check", "paid", 150_000);
  expect(renewed.denial).toBeUndefined();
  expect(renewed).toMatchObject({ estimated_spend_usd: 20.15, reserved_usd: 0.0875, active_jobs: 1 });
  expect(ledger.leases.paid.until).toBe(now + 45_000);
  expect(applyBudget(ledger, now + 10_000, limits, "acquire", "free").denial).toBe("gemini_budget_reached");
  expect(applyBudget(ledger, now + 20_000, limits, "release", "paid", 200_000)).toMatchObject({ estimated_spend_usd: 20.2, active_jobs: 0 });
});

it("does not upgrade a free lease on check and still rejects paid jobs at concurrency or lease expiry", () => {
  const ledger = newBudgetLedger(now);
  const single = { ...limits, maxJobs: 1 };
  applyBudget(ledger, now, single, "acquire", "free");
  ledger.spent = limits.daily;
  expect(applyBudget(ledger, now, single, "check", "free", 0, true).denial).toBe("gemini_budget_reached");
  expect(applyBudget(ledger, now, single, "acquire", "paid", 0, true).denial).toBe("system_busy");
  applyBudget(ledger, now, single, "release", "free");
  expect(applyBudget(ledger, now, single, "acquire", "paid", 0, true).denial).toBeUndefined();
  expect(applyBudget(ledger, now + 35_000, single, "check", "paid", 0, true).denial).toBe("gemini_guard_unavailable");
});

it("resets spend at UTC midnight without dropping active jobs or repeating the prior day's notice", () => {
  const start = Date.parse("2026-11-19T23:59:50Z");
  const ledger = newBudgetLedger(start);
  applyBudget(ledger, start, limits, "acquire", "crosses");
  applyBudget(ledger, start + 5000, limits, "check", "crosses", 17_000_000);
  expect(applyBudget(ledger, start + 10_000, limits, "status")).toMatchObject({
    day_utc: "2026-11-20", estimated_spend_usd: 0, active_jobs: 1, alert_state: "not_triggered",
  });
  expect(applyBudget(ledger, start + 20_000, limits, "release", "crosses", 17_000_000)).toMatchObject({
    estimated_spend_usd: 0.025, active_jobs: 0,
  });
});

it("prorates a cumulative usage report around UTC midnight", () => {
  const start = Date.parse("2026-11-19T23:59:50Z");
  const ledger = newBudgetLedger(start);
  applyBudget(ledger, start, limits, "acquire", "overnight");
  applyBudget(ledger, start + 10_000, limits, "status");
  expect(applyBudget(ledger, start + 20_000, limits, "check", "overnight", 200_000).estimated_spend_usd).toBe(0.1);
  expect(applyBudget(ledger, start + 21_000, limits, "release", "overnight", 210_000).estimated_spend_usd).toBe(0.11);
});

afterEach(() => vi.useRealTimers());

it("fails closed if the admission service is unreachable, and terminates a running job on denial", async () => {
  vi.useFakeTimers();
  const stopped = vi.fn();
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("", { status: 500 }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ denial: "gemini_budget_reached" }))
    .mockResolvedValueOnce(Response.json({}));
  const env = { GEMINI_BUDGET: { getByName: () => ({ fetch }) } } as unknown as Env;
  await expect(acquireGeminiBudget(env, () => 0, stopped)).rejects.toMatchObject({ reason: "gemini_guard_unavailable" });
  const release = await acquireGeminiBudget(env, () => 0.03, stopped);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(stopped).toHaveBeenCalledExactlyOnceWith("gemini_budget_reached");
  await release();
  expect(fetch.mock.lastCall?.[0]).toBe("https://budget.internal/release");
  expect(JSON.parse(fetch.mock.lastCall?.[1].body).cost).toBe(0.03);
});

it("retries a failed alert and records one successful send for the day", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  let persisted: unknown;
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (task: Promise<unknown>) => tasks.push(task),
    storage: { kv: { get: () => structuredClone(persisted), put: (_: string, value: unknown) => { persisted = structuredClone(value); } } },
  } as unknown as DurableObjectState;
  const send = vi.fn().mockRejectedValueOnce(new Error("mail temporarily offline")).mockResolvedValueOnce({});
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const guard = new GeminiBudget(ctx, {
    GEMINI_DAILY_BUDGET_USD: "0.01", GEMINI_BUDGET_EMAIL_TO: "ops@example.com", GEMINI_BUDGET_EMAIL: { send },
  } as unknown as Env);
  const acquire = () => guard.fetch(new Request("https://budget.internal/acquire", {
    method: "POST", body: JSON.stringify({ id: crypto.randomUUID() }),
  }));
  const status = () => guard.fetch(new Request("https://budget.internal/status"));
  try {
    expect(await (await acquire()).json()).toMatchObject({ alert_state: "pending", denial: "gemini_budget_reached" });
    await Promise.all(tasks);
    await acquire();
    expect(send).toHaveBeenCalledTimes(1);
    await status();
    await Promise.all(tasks);
    expect(await (await status()).json()).toMatchObject({ alert_state: "sent" });
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});

const memoryGuard = (env: Partial<Env>) => {
  const store = new Map<string, unknown>();
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (task: Promise<unknown>) => tasks.push(task),
    storage: { kv: { get: (key: string) => structuredClone(store.get(key)), put: (key: string, value: unknown) => { store.set(key, structuredClone(value)); } } },
  } as unknown as DurableObjectState;
  const guard = new GeminiBudget(ctx, env as Env);
  const caller = { ...env, GEMINI_BUDGET: { getByName: () => ({ fetch: (url: string, init?: RequestInit) => guard.fetch(new Request(url, init)) }) } } as unknown as Env;
  return { guard, caller, tasks };
};

it("passes paid admission and heartbeats through the guard without exempting free calls", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const { guard, caller } = memoryGuard({ GEMINI_DAILY_BUDGET_USD: "0.01", GEMINI_MAX_CONCURRENT: "1" });
  const stopped = vi.fn();
  await expect(acquireGeminiBudget(caller, () => 0, stopped)).rejects.toMatchObject({ reason: "gemini_budget_reached" });
  const release = await acquireGeminiBudget(caller, () => 0.2, stopped, { paid: true });
  await expect(acquireGeminiBudget(caller, () => 0, stopped, { paid: true })).rejects.toMatchObject({ reason: "system_busy" });
  await vi.advanceTimersByTimeAsync(40_000);
  expect(stopped).not.toHaveBeenCalled();
  await release();
  expect(await (await guard.fetch(new Request("https://budget.internal/status"))).json()).toMatchObject({ active_jobs: 0, estimated_spend_usd: 0.2 });
});

it.each(["true", 1, null, {}, []])("rejects a non-boolean paid flag: %j", async paid => {
  const { guard } = memoryGuard({});
  for (const op of ["acquire", "check"]) {
    const response = await guard.fetch(new Request("https://budget.internal/" + op, {
      method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), paid }),
    }));
    expect(response.status).toBe(400);
  }
});

it("fails closed for paid calls when the guard is unavailable on admission or renewal", async () => {
  vi.useFakeTimers();
  const stopped = vi.fn();
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({}))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({}));
  const env = { GEMINI_BUDGET: { getByName: () => ({ fetch }) } } as unknown as Env;
  await expect(acquireGeminiBudget(env, () => 0, stopped, { paid: true })).rejects.toMatchObject({ reason: "gemini_guard_unavailable" });
  const release = await acquireGeminiBudget(env, () => 0, stopped, { paid: true });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(stopped).toHaveBeenCalledExactlyOnceWith("gemini_guard_unavailable");
  await release();
});

it("alerts once per hour after three Gemini failures in a row and resets on success", () => {
  let result = applyGeminiOutcome(undefined, now, "failure", "credits depleted");
  result = applyGeminiOutcome(result.state, now + 1000, "failure", "credits depleted");
  expect(result.alert).toBe(false);
  result = applyGeminiOutcome(result.state, now + 2000, "failure", "credits depleted");
  expect(result).toMatchObject({ alert: true, state: { streak: 3, error: "credits depleted" } });
  expect(applyGeminiOutcome(result.state, now + 3000, "failure").alert).toBe(false);
  const reset = applyGeminiOutcome(result.state, now + 4000, "success").state;
  expect(reset.streak).toBe(0);
  let later = applyGeminiOutcome(reset, now + 3_600_000, "failure");
  later = applyGeminiOutcome(later.state, now + 3_601_000, "failure");
  expect(applyGeminiOutcome(later.state, now + 3_602_000, "failure").alert).toBe(true);
  const stale = applyGeminiOutcome(applyGeminiOutcome(undefined, now, "failure").state, now + 31 * 60_000, "failure");
  expect(stale.state.streak).toBe(1);
});

it("applies the caller's current concurrency limit even when the guard started with older settings", async () => {
  const { guard, caller } = memoryGuard({ GEMINI_MAX_CONCURRENT: "25" });
  caller.GEMINI_MAX_CONCURRENT = "40";
  const stopped = vi.fn();
  const releases = [];
  for (let i = 0; i < 40; i++) releases.push(await acquireGeminiBudget(caller, () => 0, stopped));
  await expect(acquireGeminiBudget(caller, () => 0, stopped)).rejects.toMatchObject({ reason: "system_busy" });
  expect(await (await guard.fetch(new Request("https://budget.internal/status"))).json()).toMatchObject({ concurrent_limit: 25, active_jobs: 40 });
  await Promise.all(releases.map(release => release()));
});

it("emails the failure alert address when Gemini calls keep failing", async () => {
  const send = vi.fn().mockResolvedValue({});
  const { caller, tasks } = memoryGuard({ GEMINI_BUDGET_EMAIL: { send } as unknown as SendEmail, GEMINI_BUDGET_EMAIL_TO: "ops@example.com", GEMINI_FAILURE_EMAIL_TO: "owner@example.com" });
  for (let i = 0; i < 3; i++) await reportGeminiOutcome(caller, false, "Gemini closed during setup (1011): quota-detail-7731");
  await reportGeminiOutcome(caller, false, "Gemini closed during setup (1011)");
  await Promise.all(tasks);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0]).toMatchObject({ to: "owner@example.com", from: "alerts@speakcall.app" });
  expect(send.mock.calls[0][0].text).toContain("quota-detail-7731");
});


it("uses a separate cascade bucket, combined cost and hard limit even for paid calls", async () => {
  vi.useFakeTimers();
  const stopped=vi.fn();
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({denial:"gemini_budget_reached"})).mockResolvedValueOnce(Response.json({}));
  const getByName=vi.fn((_name:string)=>({fetch}));
  const env={GEMINI_BUDGET:{getByName},CASCADE_DAILY_BUDGET_USD:"5",CASCADE_MAX_CONCURRENT:"3",GEMINI_DAILY_BUDGET_USD:"99"} as unknown as Env;
  const release=await acquireCascadeBudget(env,()=>0.06,stopped);
  expect(getByName.mock.calls.every(c=>c[0]===CASCADE_BUDGET_GUARD_NAME)).toBe(true);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({paid:false,cost:0.06,config:{GEMINI_DAILY_BUDGET_USD:"5",GEMINI_MAX_CONCURRENT:"3",GEMINI_RESERVE_USD_PER_MINUTE:"0.03"}});
  await vi.advanceTimersByTimeAsync(10000);expect(stopped).toHaveBeenCalledWith("gemini_budget_reached");await release();
});
