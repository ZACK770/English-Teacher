import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { geminiKeyForCall, hasPaidReceipt } from "../src/gemini-key";
import type { Env } from "../src/env";
import { settings } from "../src/env";
import { controlsFromSettings } from "../src/controls";
import { buildSetupPayload, compilePrompt } from "../src/prompt";

describe("Gemini allocation key routing", () => {
  let db: DatabaseSync;
  let env: Env;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE sales_receipts (id TEXT PRIMARY KEY, amount_ils REAL, subscription_id TEXT);
      CREATE TABLE usage_allocations (call_id TEXT PRIMARY KEY, receipt_id TEXT, reserved_seconds INTEGER, billed_seconds INTEGER);
      INSERT INTO sales_receipts VALUES ('purchase',119,NULL),('grant',0,NULL),('prepaid-1',590,'sub-prepaid'),('prepaid-2',0,'sub-prepaid'),('gift-sub',0,'sub-gift');
      INSERT INTO usage_allocations VALUES ('paid','purchase',120,NULL),('grant','grant',120,NULL),
        ('free',NULL,120,NULL),('basic',NULL,120,NULL),('unrestricted',NULL,0,NULL),
        ('finished','purchase',120,60),('empty','purchase',0,NULL),
        ('prepaid-later','prepaid-2',120,NULL),('gift-sub','gift-sub',120,NULL);`);
    env = {
      GEMINI_API_KEY: "default-test-key", GEMINI_PAID_TEACHER_API_KEY: "paid-test-key",
      DB: { prepare: (sql: string) => ({ bind: (...args: string[]) => ({ first: async () => db.prepare(sql).get(...args) ?? null }) }) },
    } as unknown as Env;
  });
  afterEach(() => db.close());

  it("uses the paid key for minutes reserved from a purchase", async () => {
    expect(await geminiKeyForCall(env, "paid")).toEqual({ key: "paid-test-key", tier: "paid" });
  });
  it.each(["grant", "free", "basic", "unrestricted", "finished", "empty", "missing"])("uses the default key for %s", async callId => {
    expect(await geminiKeyForCall(env, callId)).toEqual({ key: "default-test-key", tier: "default" });
  });
  it("treats later periods of a prepaid subscription as paid, but not unpaid subscriptions", async () => {
    expect(await hasPaidReceipt(env, "prepaid-later")).toBe(true);
    expect(await hasPaidReceipt(env, "gift-sub")).toBe(false);
  });
  it("keeps advertisements on the default key even with a paid allocation", async () => {
    expect(await geminiKeyForCall(env, "paid", true)).toEqual({ key: "default-test-key", tier: "default" });
  });
  it.each([undefined, ""])("falls back when the paid secret is %s", async key => {
    env.GEMINI_PAID_TEACHER_API_KEY = key;
    expect(await geminiKeyForCall(env, "paid")).toEqual({ key: "default-test-key", tier: "default" });
  });
  it.each([undefined, "paid-test-key"])("keeps paying callers untuned regardless of paid key availability (%s)", async key => {
    env.GEMINI_PAID_TEACHER_API_KEY = key;
    const paid = await hasPaidReceipt(env, "paid");
    const c = controlsFromSettings(false);
    const original = await compilePrompt(c, "", "teacher", settings(env));
    const artifact = await compilePrompt(c, "", "teacher", settings(env), { freeTuning: !paid });
    expect(JSON.stringify(artifact.setup_message)).toBe(JSON.stringify(original.setup_message));
    const selected = await geminiKeyForCall(env, "paid");
    expect(selected.tier).toBe(key ? "paid" : "default");
  });
  it.each(["free", "grant", "gift-sub"])("tunes non-paying allocation %s", async callId => {
    const paid = await hasPaidReceipt(env, callId);
    const artifact = await compilePrompt(controlsFromSettings(false), "", "teacher", settings(env), { freeTuning: !paid });
    const setup = artifact.setup_message as ReturnType<typeof buildSetupPayload>;
    expect(setup.setup.contextWindowCompression).toEqual({ triggerTokens: 5000, slidingWindow: { targetTokens: 3000 } });
  });
  it("propagates allocation lookup failures rather than guessing paid status", async () => {
    vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("database unavailable"); });
    await expect(geminiKeyForCall(env, "paid")).rejects.toThrow("database unavailable");
  });
});
