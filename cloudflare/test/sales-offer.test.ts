import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { dispatchCallbacks, submitCallback } from "../src/callbacks";
import type { Env } from "../src/env";
import { PaymentStore } from "../src/payments";
import { SubscriptionStore } from "../src/subscriptions";
import { customerBought, enterSalesOffer, offerGift, offerSchedule, salesOfferAllowed, salesOfferResponse, selectSalesOffers } from "../src/sales-offer";

let sql: DatabaseSync, b: BusinessStore, env: Env;
const now = new Date("2026-06-15T14:00:00Z");
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(now);
  sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const stmt = {
        bind(...values: any[]) { args = values; return stmt; },
        first: async () => sql.prepare(query).get(...args) ?? null,
        all: async () => ({ results: sql.prepare(query).all(...args), success: true }),
        run: async () => ({ success: true, meta: { changes: Number(sql.prepare(query).run(...args).changes) } }),
      };
      return stmt;
    },
    async batch(statements: any[]) { return Promise.all(statements.map(s => s.all())); },
  } as unknown as D1Database;
  env = { DB: db, SALES_OFFER_MODE: "on", TLIVR_SYSTEM_API_KEY: "test", TLIVR_CALLBACK_EXTENSION_ID: "123" } as Env;
  b = new BusinessStore(db);
  await b.save("customers", { name: "Learner", phone: "0501111111" }, "learner");
  await b.save("ivr-events", { customer_id: "learner", route: "sales" }, "event");
  sql.prepare("UPDATE console_records SET created_at=? WHERE id='event'").run("2026-06-14T12:00:00Z");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "OK", errorCode: 0 })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); sql.close(); });
const offerId = "sales-offer:learner";
async function answered() {
  await selectSalesOffers(env);
  sql.prepare("UPDATE callback_requests SET status='dialed',updated_at=?").run(now.toISOString());
  await enterSalesOffer(b, env, "call", "learner");
}

describe("sales offers", () => {
  it("fails closed and normalizes the allowlist", async () => {
    env.SALES_OFFER_MODE = "off";
    expect(salesOfferAllowed(env, "0501111111")).toBe(false);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    env.SALES_OFFER_MODE = "allowlist";
    env.SALES_OFFER_ALLOWLIST = " +972501111111,0502222222 ";
    expect(salesOfferAllowed(env, "0501111111")).toBe(true);
    expect(salesOfferAllowed(env, "0503333333")).toBe(false);
    expect(salesOfferAllowed({ ...env, SALES_OFFER_MODE: "on" }, "private")).toBe(false);
  });
  it("rejects the reserved source on public callback submissions", async () => {
    await expect(submitCallback(new Request("https://example.test", { method: "POST", body: JSON.stringify({
      name: "Learner", phone: "0501111111", for_whom: "self", timing: "now", consent: true, source: "sales_offer",
    }) }), env)).rejects.toMatchObject({ status: 422 });
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("queues once for the next local day at 17:00, expiring on that call day", async () => {
    await selectSalesOffers(env);
    vi.setSystemTime(new Date(+now + 600000));
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(1);
    expect(sql.prepare("SELECT source,status,next_attempt_at FROM callback_requests").get()).toMatchObject({ source: "sales_offer", status: "queued", next_attempt_at: "2026-06-15T14:00:00.000Z" });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ expires_at: "2026-06-15T20:59:59.000Z" });
    expect(offerSchedule(new Date("2026-06-18T12:00:00Z")).at).toBe("2026-06-20T17:00:00.000Z");
  });
  it("does not deduplicate a website callback against an automated offer, but still deduplicates website requests", async () => {
    await selectSalesOffers(env);
    env.SALES_OFFER_MODE = "off";
    const submit = () => submitCallback(new Request("https://example.test", { method: "POST", body: JSON.stringify({
      name: "Learner", phone: "0501111111", for_whom: "self", timing: "scheduled", consent: true, source: "landing",
    }) }), env);
    const first = await submit();
    expect(first.status).toBe(201);
    const result = await first.json() as { id: string };
    expect(result.id).not.toBe(offerId);
    expect(await (await submit()).json()).toMatchObject({ id: result.id, duplicate: true });
    expect(sql.prepare("SELECT source FROM callback_requests ORDER BY source").all()).toEqual([{ source: "landing" }, { source: "sales_offer" }]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("has no candidates for empty history or hidden phones", async () => {
    sql.prepare("DELETE FROM console_records WHERE kind='ivr-events'").run();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("excludes buyers and rechecks them before dialing", async () => {
    await selectSalesOffers(env);
    await b.db.prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES ('receipt','learner','school-step','school','ref',59,0,30,?,?)").bind("2026-07-15T00:00:00Z", now.toISOString()).run();
    expect(await customerBought(b, "learner")).toBe(true);
    await dispatchCallbacks(env);
    expect(sql.prepare("SELECT status,last_error FROM callback_requests").get()).toMatchObject({ status: "failed", last_error: "Sales offer customer already purchased" });
    expect(fetch).not.toHaveBeenCalled();
    sql.prepare("DELETE FROM callback_requests").run();
    sql.prepare("DELETE FROM console_records WHERE kind='sales-offers'").run();
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("rechecks the gate before dialing", async () => {
    await selectSalesOffers(env);
    env.SALES_OFFER_MODE = "off";
    await dispatchCallbacks(env);
    expect(sql.prepare("SELECT status,last_error FROM callback_requests").get()).toMatchObject({ status: "failed", last_error: "Sales offer gate disabled for phone" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("excludes active subscribers and paid orders even without remaining minutes", async () => {
    await new SubscriptionStore(b.db).create("learner", "school-step", "2026-06-01T00:00:00Z");
    expect(await customerBought(b, "learner")).toBe(true);
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
    sql.prepare("UPDATE subscriptions SET status='cancelled'").run();
    sql.prepare("UPDATE sales_receipts SET expires_at='2020-01-01T00:00:00Z'").run();
    sql.prepare("INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES ('paid','purchase','learner','school-step','{}',5900,0,'paid',?,?)").run(now.toISOString(), now.toISOString());
    await selectSalesOffers(env);
    expect(sql.prepare("SELECT * FROM callback_requests").all()).toHaveLength(0);
  });
  it("binds an answered offer to its call, with a single accounted gift", async () => {
    await answered();
    expect(await b.loadContext("call")).toMatchObject({ offer_call: offerId });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ status: "answered", call_id: "call" });
    expect(await offerGift(b, env, offerId, "learner", "segment")).toBe(240);
    expect(await offerGift(b, env, offerId, "learner", "another")).toBe(0);
    expect(sql.prepare("SELECT product,reserved_seconds FROM usage_allocations").get()).toMatchObject({ product: "school-offer-gift", reserved_seconds: 240 });
  });
  it("does not claim stale outbound calls", async () => {
    await selectSalesOffers(env);
    sql.prepare("UPDATE callback_requests SET status='dialed',updated_at=?").run("2026-06-15T12:00:00Z");
    await enterSalesOffer(b, env, "call", "learner");
    expect(await b.loadContext("call")).toEqual({});
  });
  it.each(["0", "ERROR", "2"])("handles offer key %s", async choice => {
    await answered();
    const response = await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: choice }, "learner");
    expect(response).toEqual(choice === "2" ? null : { type: "hangup" });
    expect(await b.record("sales-offers", offerId)).toMatchObject({ status: "declined" });
  });
  it("shows the month offer only in its bound call and handles unavailable package", async () => {
    await answered();
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "other" }, "learner")).toBeNull();
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call" }, "learner")).toMatchObject({ name: "isaacOffer", enabledKeys: "0,1,2" });
    const create = vi.spyOn(PaymentStore.prototype, "create");
    sql.prepare("DELETE FROM console_records WHERE kind='packages' AND id='school-offer-week'").run();
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner")).toMatchObject({ name: "isaacOfferUnavailable" });
    expect(create).toHaveBeenCalledWith("call", "learner", "school-offer-week", false, env);
    expect(await b.record("sales-offers", offerId)).toMatchObject({ status: "accepted" });
  });
  it("continues an available offer into existing terms then credit card flow", async () => {
    await answered();
    env = { ...env, NEDARIM_PHONE_ENABLED: "true", NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "test", NEDARIM_WEBHOOK_SECRET: "test", NEDARIM_PHONE_TERMINAL: "test" };
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1" }, "learner")).toMatchObject({ name: "isaacPayConfirm" });
    expect(await salesOfferResponse(b, env, "/", { PBXcallId: "call", isaacOffer: "1", isaacPayConfirm: "1" }, "learner")).toMatchObject({ type: "creditCard", sum: 59 });
  });
});
