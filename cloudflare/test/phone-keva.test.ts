import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { type Env, settings } from "../src/env";
import { handleCallback } from "../src/pbx";
import { PaymentStore, paymentResponse, handleWebhook } from "../src/payments";
import { syncKevas } from "../src/keva-sync";

class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) {
      this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    }
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

let db: SqlD1, b: BusinessStore, env: Env, store: PaymentStore;
let rows: Record<string, any>[], detail: Record<string, any>;
const ids = ["school-step", "school-pace", "school-fluent", "school-topup"];
const respond = (params: Record<string, string> = {}, callId = "phone-hk") => paymentResponse(store, env, "/", { PBXcallId: callId, ...params }, "c1", ids);
async function issue(choice = "1") {
  expect(await respond({ isaacPackage: choice })).toMatchObject({ name: "isaacPayConfirm" });
  return respond({ isaacPayConfirm: "1" });
}
function provider(category: string, amount = "59") {
  rows = [{ KevaId: "54321", Groupe: category, Phone: "0500000001", Amount: amount, Currency: "1", Enabled: "1", Success: "1", ErrorText: "", CreationDate: "22/11/2026" }];
  detail = { KevaId: "54321", KevaGroupe: category, KevaPhone: "0500000001", KevaAmount: amount,
    KevaCurrency: "1", KevaStatus: "1", KevaFrequency: "1", KevaNextDate: "22/12/2026",
    HistoryData: [{ ID: "1", Amount: amount, Date: "22/11/2026", TransactionId: "987654" }] };
}
async function hook(data: Record<string, unknown>, signed = true) {
  const raw = JSON.stringify(data), timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + raw)))].map(x => x.toString(16).padStart(2, "0")).join("");
  return handleWebhook(new Request("https://example.test/v1/payments/nedarim/webhook", { method: "POST", body: raw,
    headers: signed ? { "X-Nedarim-Timestamp": timestamp, "X-Nedarim-Signature": "v1=" + hex } : {} }), env);
}
const counts = () => ["subscriptions", "sales_receipts", "standing_orders"].map(table => db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T13:00:00Z"));
  db = new SqlD1();
  env = { DB: db, NEDARIM_PHONE_ENABLED: "true", NEDARIM_PHONE_TERMINAL: "test-terminal", NEDARIM_MOSAD_ID: "7019554",
    NEDARIM_API_KEY: "test-key", NEDARIM_WEBHOOK_SECRET: "test-secret" } as unknown as Env;
  b = new BusinessStore(env.DB); store = new PaymentStore(b);
  await b.save("customers", { name: "לקוח בדיקה", phone: "0500000001" }, "c1");
  for (const id of ids) await b.save("packages", { ...await b.record("packages", id), phone_enabled: true }, id);
  rows = []; detail = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body));
    expect(form.get("MosadId")).toBe("7019554");
    expect(form.get("ApiPassword")).toBe("test-key");
    if (form.get("Action") === "GetKevaJson") return Response.json(rows);
    if (form.get("Action") === "GetKevaId") return Response.json(detail);
    throw new Error("Unexpected provider operation");
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); db.sql.close(); });

describe("phone monthly enrollment", () => {
  it("offers phone-enabled monthly packages with server-derived keys and prices on the sales route", async () => {
    Object.assign(env, { TLIVR_PROJECT_ENABLED: "true", TLIVR_CALLBACK_SECRET: "cb", TLIVR_SYSTEM_PHONE: "0765673575", TLIVR_PROJECT_PATH: "/" });
    const response = await handleCallback(new Request("https://example.test/v1/technoline/ivr/sales?key=cb&PBXnum=0765673575&PBXextensionPath=/3&PBXphone=0500000001&PBXcallId=sales-menu"), env, settings(env), "sales");
    expect(response.name).toBe("isaacPackage");
    const text = JSON.stringify(response.files);
    for (const amount of [59, 119, 199, 39]) expect(text).toContain(String(amount));
    const context = await b.loadContext("payments:sales-menu");
    for (const id of ids) expect(context.package_ids).toContain(id);
    expect(context.package_ids).not.toContain("school-foundations");
  });

  it.each([["1", 59], ["2", 119], ["3", 199]])("issues monthly HK for choice %s and activates immediately and idempotently", async (choice, amount) => {
    const module = await issue(choice as string);
    expect(module).toMatchObject({ type: "creditCard", paymentsMode: "kevaMonthly", sum: amount, kevaDay: 22, terminal: "test-terminal", cvv: "yes", tz: "yes" });
    expect(counts()).toEqual([0, 0, 0]);
    provider(String(module.category), String(amount));
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("התשלום אושר");
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("התשלום אושר");
    expect(counts()).toEqual([1, 1, 1]);
    const order = await store.orderForCall("phone-hk");
    expect(order).toMatchObject({ state: "paid", channel: "phone", amount_agorot: Number(amount) * 100 });
    expect(db.sql.prepare("SELECT keva_id,entitlement_id,first_order_id FROM standing_orders").get()).toEqual({ keva_id: "54321", entitlement_id: order!.id, first_order_id: order!.id });
    expect(await b.hasPaidAccess("c1")).toBe(true);
    await syncKevas(env, true);
    await hook({ MosadNumber: "7019554", Groupe: module.category, KevaId: "54321", Amount: String(amount), Currency: "1" });
    expect(counts()).toEqual([1, 1, 1]);
  });

  it("clamps the billing day to 28 and preserves the one-time top-up", async () => {
    vi.setSystemTime(new Date("2026-11-30T13:00:00Z"));
    expect(await issue()).toMatchObject({ kevaDay: 28 });
    const module = await respond({ isaacPackage: "4" }, "topup");
    expect(module.name).toBe("isaacPayConfirm");
    expect(await respond({ isaacPayConfirm: "1" }, "topup")).toMatchObject({ paymentsMode: "regular", payments: 1, sum: 39 });
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM phone_keva_enrollments").get()!.n).toBe(1);
  });

  it.each(["ERROR", "DECLINED"])("does not grant access on PBX %s, even if sync later sees the order", async status => {
    const module = await issue(); provider(String(module.category));
    expect(JSON.stringify(await respond({ isaacPayStatus: status }))).toContain("התשלום לא אושר");
    expect(fetch).not.toHaveBeenCalled();
    await syncKevas(env, true);
    expect(counts()).toEqual([0, 0, 0]);
    expect((await store.orderForCall("phone-hk"))!.state).toBe("failed");
  });

  it.each(["webhook", "sync"])("keeps an invisible Keva pending, then completes through %s", async completion => {
    const module = await issue();
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("בתוך דקות");
    expect(counts()).toEqual([0, 0, 0]);
    provider(String(module.category));
    if (completion === "webhook") {
      await hook({ MosadNumber: "7019554", Groupe: module.category, KevaId: "54321", Amount: "59", Currency: "1" });
      await hook({ MosadNumber: "7019554", Groupe: module.category, KevaId: "54321", Amount: "59", Currency: "1" });
    } else await syncKevas(env, true);
    expect(counts()).toEqual([1, 1, 1]);
    expect((await store.orderForCall("phone-hk"))!.state).toBe("paid");
  });

  it.each(["amount", "phone", "mosad", "detail amount", "detail phone", "detail mosad", "inactive", "no charge", "old Keva", "wrong group"])("does not open access for %s mismatch", async reason => {
    const module = await issue(); provider(String(module.category));
    if (reason === "amount") rows[0].Amount = "119";
    if (reason === "phone") rows[0].Phone = "0500000002";
    if (reason === "mosad") rows[0].MosadNumber = "7000000";
    if (reason === "detail amount") detail.KevaAmount = "119";
    if (reason === "detail phone") detail.KevaPhone = "0500000002";
    if (reason === "detail mosad") detail.MosadNumber = "7000000";
    if (reason === "inactive") detail.KevaStatus = "2";
    if (reason === "no charge") detail.HistoryData = [];
    if (reason === "old Keva") rows[0].CreationDate = "20/10/2026";
    if (reason === "wrong group") rows[0].Groupe = "not-ours";
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("בתוך דקות");
    await syncKevas(env, true);
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("rejects unsigned and wrong-institution HK notifications without granting access", async () => {
    const module = await issue(); provider(String(module.category));
    const event = { MosadNumber: "7019554", Groupe: module.category, KevaId: "54321" };
    await expect(hook(event, false)).rejects.toMatchObject({ status: 401 });
    await expect(hook({ ...event, MosadNumber: "7000000" })).rejects.toMatchObject({ status: 400 });
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("records a signed decline and prevents later activation", async () => {
    const module = await issue(); provider(String(module.category));
    await hook({ MosadNumber: "7019554", Groupe: module.category, KevaId: "54321", Status: "Error", Message: "החיוב סורב" });
    await syncKevas(env, true);
    expect(counts()).toEqual([0, 0, 0]);
    expect((await store.orderForCall("phone-hk"))!.state).toBe("failed");
  });

  it("does not issue when the D1 price changed, or a package is no longer phone-enabled", async () => {
    await respond({ isaacPackage: "1" });
    await b.save("packages", { ...await b.record("packages", "school-step"), price_ils: 69 }, "school-step");
    expect((await respond({ isaacPayConfirm: "1" })).type).not.toBe("creditCard");
    await b.save("packages", { ...await b.record("packages", "school-step"), phone_enabled: false }, "school-step");
    expect((await respond({ isaacPackage: "1" }, "new-call")).name).toBe("isaacPayExit");
  });

  it("gates enrollment and verification on existing phone-payment configuration", async () => {
    const module = await issue(); provider(String(module.category));
    env.NEDARIM_PHONE_ENABLED = "false";
    expect((await respond({ isaacPayStatus: "OK" })).type).not.toBe("creditCard");
    await syncKevas(env, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("keeps access pending on provider errors and prevents overlapping enrollments", async () => {
    await issue();
    expect((await respond({ isaacPackage: "2" }, "another-call")).name).toBe("isaacPayExit");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Provider unavailable"); }));
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("בתוך דקות");
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("renews an activated phone subscription through the existing signed charge handler", async () => {
    const module = await issue(); provider(String(module.category));
    await respond({ isaacPayStatus: "OK" });
    vi.setSystemTime(new Date("2026-12-22T13:00:00Z"));
    const event = { MosadNumber: "7019554", Groupe: module.category, KevaId: "54321", TransactionId: "987655",
      Confirmation: "approval", Amount: "59", Currency: "1", TransactionTime: "22/12/2026 14:00" };
    expect(await hook(event)).toMatchObject({ paid: true });
    expect(await hook(event)).toMatchObject({ duplicate: true });
    expect(counts()).toEqual([1, 2, 1]);
  });

  it("rolls back all grants if a decline arrives during verification", async () => {
    const module = await issue(); provider(String(module.category));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (new URLSearchParams(String(init.body)).get("Action") === "GetKevaJson") return Response.json(rows);
      db.sql.prepare("UPDATE payment_orders SET state='failed' WHERE call_id='phone-hk'").run();
      return Response.json(detail);
    }));
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("התשלום לא אושר");
    expect(counts()).toEqual([0, 0, 0]);
  });
});
