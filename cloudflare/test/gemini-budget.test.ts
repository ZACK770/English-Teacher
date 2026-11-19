import { afterEach, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { acquireGeminiBudget, applyBudget, budgetConfig, GeminiBudget, newBudgetLedger } from "../src/gemini-budget";

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
