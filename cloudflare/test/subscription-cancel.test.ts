import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import type { Env } from "../src/env";
import { SubscriptionStore } from "../src/subscriptions";
import { subscriptionCancellationResponse } from "../src/subscription-cancel";
import { PaymentStore, paymentResponse } from "../src/payments";

class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) {
      this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    }
    this.sql.exec("PRAGMA foreign_keys=ON");
  }
  prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      first: async () => this.sql.prepare(query).get(...args) ?? null,
      all: async () => ({ results: this.sql.prepare(query).all(...args), success: true }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...args).changes) } }),
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.sql.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      this.sql.exec("COMMIT");
      return results;
    } catch (error) { this.sql.exec("ROLLBACK"); throw error; }
  }
}

let db: SqlD1, env: Env, b: BusinessStore, store: SubscriptionStore;
const now = "2026-06-15T14:00:00.000+00:00";
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(now));
  db = new SqlD1();
  env = { DB: db as unknown as D1Database, NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "test", SALES_OFFER_MODE: "off" } as Env;
  b = new BusinessStore(env.DB);
  store = new SubscriptionStore(env.DB, env);
  await b.save("customers", { name: "Learner", phone: "0501111111" }, "owner");
  await b.save("customers", { name: "Other", phone: "0502222222" }, "other");
  await b.save("policies", { enabled: true, product: "school", opening_seconds: 0, free_calls_month: 0 }, "teacher");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://matara.pro/nedarimplus/Reports/Manage3.aspx");
    expect(new URLSearchParams(String(init.body)).get("Action")).toBe("DeleteKeva");
    return new Response("OK");
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); db.sql.close(); });

const respond = (params: Record<string, string> = {}, customerId = "owner", base = "/") =>
  subscriptionCancellationResponse(b, env, base, { PBXcallId: "phone-call", PBXphone: "+972501111111", isaacSinglePackage: "8", isaacSalesService: "3", ...params }, customerId);
const messages = (result: Record<string, any>) => result.files?.map((f: { text: string }) => f.text).join(" ") ?? "";
async function subscribe(letter = "a", customerId = "owner", standing = true, planId = "school-step") {
  const id = letter.repeat(32);
  const pkg = (await b.record("packages", planId))!;
  const sub = await store.create(customerId, planId, now, undefined, { id, priceAgorot: pkg.price_ils * 100, monthlyMinutes: pkg.minutes, termMonths: null });
  if (standing) {
    await env.DB.prepare(`INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at,subscription_id,entitlement_id)
      VALUES (?,?,?,?,?,?,0,'paid',?,?,?,?)`).bind(id, "purchase-" + letter, customerId, planId, JSON.stringify(pkg), pkg.price_ils * 100, now, now, id, id).run();
    await env.DB.prepare(`INSERT INTO standing_orders(id,customer_id,package_id,snapshot,monthly_agorot,first_order_id,state,keva_id,entitlement_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',?,?,?,?)`).bind(id, customerId, planId, JSON.stringify(pkg), pkg.price_ils * 100, id, letter === "a" ? "12345" : "67890", id, now, now).run();
  }
  return sub;
}

describe("phone subscription cancellation", () => {
  it("routes paymentResponse 8→3 through confirmation, cancellation and back to the service submenu", async () => {
    const sub = await subscribe();
    const configured = { ...env, SALES_MENU_MODE: "single", NEDARIM_PHONE_ENABLED: "true", NEDARIM_PHONE_TERMINAL: "test", NEDARIM_WEBHOOK_SECRET: "test" } as Env;
    const params = { PBXcallId: "menu-call", PBXphone: "0501111111", isaacSinglePackage: "8", isaacSalesService: "3" };
    const pay = new PaymentStore(b);
    expect(await paymentResponse(pay, configured, "/", params, "owner", ["school-step"]))
      .toMatchObject({ name: "isaacCancelSubscription", enabledKeys: "0,1" });
    expect(fetch).not.toHaveBeenCalled();
    expect(messages(await paymentResponse(pay, configured, "/", { ...params, isaacCancelSubscription: "1" }, "owner", ["school-step"])))
      .toContain("ביטול המנוי הושלם");
    expect((await store.get(sub.id)).status).toBe("cancelled");
    expect(await paymentResponse(pay, configured, "/", { ...params, isaacCancelSubscription: "0" }, "owner", ["school-step"]))
      .toMatchObject({ type: "goTo", goTo: "/3", removeParams: ["isaacSalesService", "isaacCancelSubscription"] });
  });
  it("speaks Hebrew when no subscription exists, then returns to the service submenu", async () => {
    const response = await respond();
    expect(response).toMatchObject({ type: "simpleMenu", name: "isaacCancelSubscription", enabledKeys: "0" });
    expect(messages(response)).toContain("לא נמצא מנוי פעיל");
    expect(await respond({ isaacCancelSubscription: "0" })).toEqual({
      type: "goTo", goTo: "/3", removeParams: ["isaacSalesService", "isaacCancelSubscription"],
    });
    expect(fetch).not.toHaveBeenCalled();
    const events = await b.list("ivr-events");
    expect(events).toHaveLength(2);
    expect(events.every(e => e.route === "subscription-cancel" && e.customer_id === "owner" && e.output)).toBe(true);
  });
  it("reads back the subscription before accepting confirmation", async () => {
    const sub = await subscribe();
    const response = await respond({ isaacCancelSubscription: "1" });
    expect(messages(response)).toContain("מנוי סטארט");
    expect(messages(response)).toContain("לאישור ביטול המנוי הקישו 1, לחזרה הקישו 0");
    expect((await store.get(sub.id)).status).toBe("active");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reuses DeleteKeva and local cancellation, preserving paid access and refusing renewal", async () => {
    const sub = await subscribe();
    const receipt = db.sql.prepare("SELECT * FROM sales_receipts WHERE subscription_id=?").get(sub.id)!;
    await respond();
    const response = await respond({ isaacCancelSubscription: "1" });
    expect(messages(response)).toContain("ביטול המנוי הושלם");
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body.get("KevaId")).toBe("12345");
    expect((await store.get(sub.id)).status).toBe("cancelled");
    expect(db.sql.prepare("SELECT state FROM standing_orders WHERE id=?").get(sub.id)).toMatchObject({ state: "cancelled" });
    expect(db.sql.prepare("SELECT expires_at FROM sales_receipts WHERE id=?").get(String(receipt.id))).toMatchObject({ expires_at: receipt.expires_at });
    expect(await b.reserveCall("owner", "teacher", "paid-after-cancel", 60)).toMatchObject({ mode: "paid" });
    await expect(store.recordRenewal(sub.id, now, "must-not-renew")).rejects.toThrow("not renewable");
    expect((await b.list("ivr-events")).some(e => e.input.isaacCancelSubscription === "1" && messages(e.output).includes("ביטול המנוי הושלם"))).toBe(true);
  });
  it.each(["0", "ERROR"])("backs out without cancelling on %s", async key => {
    const sub = await subscribe();
    await respond();
    expect(await respond({ isaacCancelSubscription: key }, "owner", "/99")).toMatchObject({ type: "goTo", goTo: "/99/3" });
    expect((await store.get(sub.id)).status).toBe("active");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("handles repeated confirmations idempotently", async () => {
    const sub = await subscribe();
    await respond();
    const first = await respond({ isaacCancelSubscription: "1" });
    const repeat = await respond({ isaacCancelSubscription: "1" });
    expect(repeat).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await store.get(sub.id)).status).toBe("cancelled");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM console_audit WHERE action='payment:keva_cancelled'").get()!.n).toBe(1);
  });
  it("cancels only the caller's confirmed snapshot, not another owner or a new subscription", async () => {
    const first = await subscribe();
    const other = await subscribe("b", "other");
    await respond();
    const addedLater = await subscribe("c", "owner", false);
    await respond({ isaacCancelSubscription: "1" });
    expect((await store.get(first.id)).status).toBe("cancelled");
    expect((await store.get(other.id)).status).toBe("active");
    expect((await store.get(addedLater.id)).status).toBe("active");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reads and cancels all confirmed school subscriptions", async () => {
    const first = await subscribe();
    const second = await subscribe("b", "owner", true, "school-pace");
    const response = await respond();
    expect(messages(response)).toContain("מנוי סטארט");
    expect(messages(response)).toContain("מנוי סמול טוק");
    await respond({ isaacCancelSubscription: "1" });
    expect((await store.get(first.id)).status).toBe("cancelled");
    expect((await store.get(second.id)).status).toBe("cancelled");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reports provider failure honestly and permits an idempotent retry", async () => {
    const sub = await subscribe();
    await respond();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ERROR"));
    expect(messages(await respond({ isaacCancelSubscription: "1" }))).toContain("לא התקבל אישור סופי");
    expect((await store.get(sub.id)).status).toBe("active");
    expect(db.sql.prepare("SELECT state FROM standing_orders WHERE id=?").get(sub.id)).toMatchObject({ state: "active" });
    expect(messages(await respond({ isaacCancelSubscription: "1" }))).toContain("ביטול המנוי הושלם");
    expect((await store.get(sub.id)).status).toBe("cancelled");
  });
  it("uses local subscription cancellation when there is no standing order", async () => {
    const sub = await subscribe("a", "owner", false);
    await respond();
    await respond({ isaacCancelSubscription: "1" });
    expect((await store.get(sub.id)).status).toBe("cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses mismatched caller identity and ignores hangup confirmations", async () => {
    const sub = await subscribe();
    expect(messages(await respond({ isaacCancelSubscription: "1", PBXphone: "0502222222" }))).toContain("לא נמצא מנוי פעיל");
    await respond();
    expect(await respond({ isaacCancelSubscription: "1", PBXcallStatus: "HANGUP" })).toEqual({ type: "hangup" });
    expect((await store.get(sub.id)).status).toBe("active");
    expect(fetch).not.toHaveBeenCalled();
  });
});
