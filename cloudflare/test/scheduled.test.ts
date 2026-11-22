import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { URL as FileURL } from "node:url";
import type { Env } from "../src/env";
import worker from "../src/index";

describe("cron isolation", () => {
  it.each(["../wrangler.toml", "../../wrangler.toml"])("configures maintenance and reminder schedules in %s", path => {
    expect(readFileSync(new FileURL(path, import.meta.url), "utf8")).toContain('crons = ["*/10 * * * *", "*/5 * * * *"]');
  });
  it.each(["*/5 * * * *", "unknown"])("does not run maintenance on %s", async cron => {
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date("2026-06-14T17:04:00Z"));
    try {
      const prepare = vi.fn((_query: string) => ({ all: async () => ({ results: [] }) }));
      const env = { DB: { prepare }, REMINDERS_MODE: "dry_run" } as unknown as Env;
      const work: Promise<unknown>[] = [];
      const ctx = { waitUntil(task: Promise<unknown>) { work.push(task); } } as ExecutionContext;
      await worker.scheduled({ cron } as ScheduledController, env, ctx);
      await Promise.all(work);
      expect(prepare).toHaveBeenCalledTimes(cron === "unknown" ? 0 : 1);
      if (cron !== "unknown") expect(prepare.mock.calls[0][0]).toContain("FROM practice_reminders");
    } finally { vi.useRealTimers(); }
  });
});
