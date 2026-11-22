import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { type Env, settings } from "../src/env";
import { handleCallback } from "../src/pbx";
import { PaymentStore, paymentResponse, handleWebhook, SALES_MENU_TEXT, SCHOOL_SALES_PACKAGE_IDS, TERMS_STEP_TEXT, TERMS_TEXT } from "../src/payments";
import worker from "../src/index";
import { reconcilePhoneKeva, syncKevas } from "../src/keva-sync";
import { masteryDomainGuidance, saveMasteryDomain } from "../src/mastery-domain";
import { TutorSession } from "../src/session";
import { controlsFromSettings } from "../src/controls";
import { buildSetupPayload } from "../src/prompt";

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
const ids = [...SCHOOL_SALES_PACKAGE_IDS];
const respond = (params: Record<string, string> = {}, callId = "phone-hk") => paymentResponse(store, env, "/", { PBXcallId: callId, ...params }, "c1", ids);
async function issue(choice = "1") {
  expect(await respond({ isaacPackage: choice })).toMatchObject({ name: "isaacPayConfirm" });
  return respond({ isaacPayConfirm: "2" });
}
async function purchaseMaster() {
  const module = await issue("5");
  await hook({ MosadNumber: "7019554", Groupe: module.category, Amount: "1490", Currency: "1", TransactionId: "987654", Confirmation: "approved" });
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
const providerForms = () => vi.mocked(fetch).mock.calls.map(([, init]) => new URLSearchParams(String(init!.body)));
function immediateProvider(category: string, amount = "59", options: { charge?: unknown; update?: unknown; deletion?: string; network?: string } = {}) {
  provider(category, amount);
  rows[0].Success = "0";
  Object.assign(detail, { CreatedDate: "22/11/2026", KevaSuccess: "0", KevaNextDate: "22/11/2026", HistoryData: [] });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body)), action = form.get("Action");
    expect(form.get("MosadId")).toBe("7019554");
    expect(form.get("ApiPassword")).toBe("test-key");
    if (options.network === action) throw new Error("Provider unavailable");
    if (action === "GetKevaJson") return Response.json(rows);
    if (action === "GetKevaId") return Response.json(detail);
    if (action === "TashlumBodedNew") return Response.json(options.charge ?? { Status: "OK", TransactionId: "987654", ID: "987654", Confirmation: "0012345", Amount: amount, Currency: "1", KevaId: "54321" });
    if (action === "UpdateKevaNew") return Response.json(options.update ?? { Result: "OK" });
    if (action === "DeleteKeva") return new Response(options.deletion ?? "OK");
    throw new Error("Unexpected provider operation");
  }));
}

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

describe("in-call first monthly charge", () => {
  const result = { isaacPayStatus: "OK", CONFIRM_isaacPayStatus: "54321" };
  const actions = () => providerForms().map(form => form.get("Action"));

  it.each([["1", "59", 60], ["2", "119", 200], ["3", "199", 300]])("charges and activates plan %s during the same callback", async (choice, amount, minutes) => {
    const module = await issue(String(choice));
    immediateProvider(String(module.category), String(amount));
    expect(JSON.stringify(await respond(result))).toContain("התשלום אושר והחבילה נפתחה");
    expect(actions()).toEqual(["GetKevaId", "TashlumBodedNew", "UpdateKevaNew"]);
    const order = (await store.orderForCall("phone-hk"))!;
    expect(Object.fromEntries(providerForms()[1])).toMatchObject({ Action: "TashlumBodedNew", MosadNumber: "7019554", MosadId: "7019554", ApiPassword: "test-key",
      KevaId: "54321", Amount: String(amount), Currency: "1", Tashloumim: "1", Tashlumim: "1", JoinToKevaId: "Join", Groupe: "dibura-" + order.id, AjaxId: "dibura-first-" + order.id });
    expect(Object.fromEntries(providerForms()[2])).toMatchObject({ Action: "UpdateKevaNew", KevaId: "54321", NextDate: "22/12/2026" });
    expect(order).toMatchObject({ state: "paid", transaction_id: "987654", confirmation: "0012345", amount_agorot: Number(amount) * 100 });
    expect(counts()).toEqual([1, 1, 1]);
    expect(db.sql.prepare("SELECT monthly_minutes,current_period_end FROM subscriptions").get()).toEqual({ monthly_minutes: minutes, current_period_end: "2026-12-22T13:00:00.000+00:00" });
    expect(db.sql.prepare("SELECT keva_id,next_date FROM standing_orders").get()).toEqual({ keva_id: "54321", next_date: "22/12/2026" });
    expect(db.sql.prepare("SELECT keva_id FROM phone_keva_enrollments").get()).toEqual({ keva_id: "54321" });
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM payment_issues WHERE status='open'").get()!.n).toBe(0);
    expect(await b.hasPaidAccess("c1")).toBe(true);
  });

  it("deletes a declined Keva, fails the order and retains back/service navigation", async () => {
    const module = await issue();
    immediateProvider(String(module.category), "59", { charge: { Status: "Error", ErrorCode: "033" } });
    expect(await respond(result)).toMatchObject({ name: "isaacPayExit", enabledKeys: "0,9",
      files: [{ text: "הכרטיס לא אושר והמנוי לא נפתח. לחזרה הקישו 0. לשירות הקישו 9." }] });
    expect(actions()).toEqual(["GetKevaId", "TashlumBodedNew", "DeleteKeva"]);
    expect(providerForms()[2].get("KevaId")).toBe("54321");
    expect((await store.orderForCall("phone-hk"))!.state).toBe("failed");
    expect(counts()).toEqual([0, 0, 0]);
    expect(await respond({ isaacPayExit: "0" })).toMatchObject({ goTo: "/" });
    expect(await respond({ isaacPayExit: "9" })).toMatchObject({ goTo: "/4" });
  });

  it("records a visible issue when decline cleanup fails", async () => {
    const module = await issue();
    immediateProvider(String(module.category), "59", { charge: { Status: "Error" }, deletion: "Unable to delete" });
    expect(JSON.stringify(await respond(result))).toContain("הכרטיס לא אושר");
    expect((await store.orderForCall("phone-hk"))!.state).toBe("failed");
    expect(db.sql.prepare("SELECT kind FROM payment_issues WHERE kind='phone_keva_delete_failed' AND status='open'").get()).toBeTruthy();
    await syncKevas(env, true);
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("charges exactly once across concurrent and repeated PBX callbacks", async () => {
    const module = await issue(); immediateProvider(String(module.category));
    await Promise.all([respond(result), respond(result), respond(result)]);
    expect(JSON.stringify(await respond(result))).toContain("התשלום אושר");
    expect(actions().filter(action => action === "TashlumBodedNew")).toHaveLength(1);
    expect(actions().filter(action => action === "UpdateKevaNew")).toHaveLength(1);
    expect(counts()).toEqual([1, 1, 1]);
    expect(db.sql.prepare("SELECT state,transaction_id,confirmation FROM phone_keva_first_charges").get()).toEqual({ state: "charged", transaction_id: "987654", confirmation: "0012345" });
  });

  it("activates an already-charged Keva without charging or changing its billing date", async () => {
    const module = await issue(); immediateProvider(String(module.category));
    Object.assign(detail, { KevaNextDate: "22/12/2026", HistoryData: [{ ID: "1", Amount: "59", Date: "22/11/2026", TransactionId: "987654" }] });
    expect(JSON.stringify(await respond(result))).toContain("התשלום אושר");
    expect(actions()).toEqual(["GetKevaId"]);
    expect(counts()).toEqual([1, 1, 1]);
  });

  it.each(["refused", "network", "empty"])("activates but leaves an open issue for a %s NextDate update", async failure => {
    const module = await issue();
    immediateProvider(String(module.category), "59", failure === "network" ? { network: "UpdateKevaNew" } : { update: failure === "empty" ? {} : { Result: "Error" } });
    expect(JSON.stringify(await respond(result))).toContain("התשלום אושר");
    expect((await store.orderForCall("phone-hk"))!.state).toBe("paid");
    expect(counts()).toEqual([1, 1, 1]);
    expect(db.sql.prepare("SELECT kind,status FROM payment_issues WHERE kind='phone_keva_next_date'").get()).toEqual({ kind: "phone_keva_next_date", status: "open" });
    await respond(result);
    expect(actions().filter(action => action === "TashlumBodedNew")).toHaveLength(1);
  });

  it.each(["network", "empty", "unknown", "missing transaction", "amount mismatch"])("holds a %s charge result without deleting or retrying", async failure => {
    const module = await issue();
    const charge = failure === "empty" ? {} : failure === "unknown" ? { Status: "Pending" } : failure === "missing transaction" ? { Status: "OK", Confirmation: "123" }
      : { Status: "OK", TransactionId: "987654", Confirmation: "123", Amount: "119" };
    immediateProvider(String(module.category), "59", failure === "network" ? { network: "TashlumBodedNew" } : { charge });
    expect(JSON.stringify(await respond(result))).toContain("בקרוב לאחר קבלת האישור");
    await respond(result);
    expect((await store.orderForCall("phone-hk"))!.state).toBe("awaiting_settlement");
    expect(counts()).toEqual([0, 0, 0]);
    expect(actions().filter(action => action === "TashlumBodedNew")).toHaveLength(1);
    expect(actions()).not.toContain("DeleteKeva");
    expect(actions()).not.toContain("UpdateKevaNew");
    expect(db.sql.prepare("SELECT kind FROM payment_issues WHERE kind='phone_keva_charge_unknown' AND status='open'").get()).toBeTruthy();
    provider(String(module.category));
    await syncKevas(env, true);
    expect(counts()).toEqual([1, 1, 1]);
    expect(actions().filter(action => action === "TashlumBodedNew")).toHaveLength(1);
  });

  it.each(["group", "phone", "amount", "status", "currency", "frequency", "institution", "old", "missing creation", "unknown history", "existing attempt", "success without history"])("does not charge an unverified %s Keva", async mismatch => {
    const module = await issue(); immediateProvider(String(module.category));
    if (mismatch === "group") detail.KevaGroupe = "dibura-other";
    if (mismatch === "phone") detail.KevaPhone = "0500000002";
    if (mismatch === "amount") detail.KevaAmount = "119";
    if (mismatch === "status") detail.KevaStatus = "2";
    if (mismatch === "currency") detail.KevaCurrency = "2";
    if (mismatch === "frequency") detail.KevaFrequency = "2";
    if (mismatch === "institution") detail.MosadNumber = "7000000";
    if (mismatch === "old") detail.CreatedDate = "20/10/2026";
    if (mismatch === "missing creation") delete detail.CreatedDate;
    if (mismatch === "unknown history") delete detail.HistoryData;
    if (mismatch === "existing attempt") detail.HistoryData = [{ ID: "2", Date: "22/11/2026" }];
    if (mismatch === "success without history") detail.KevaSuccess = "1";
    expect(JSON.stringify(await respond(result))).toContain("בקרוב לאחר קבלת האישור");
    expect(actions()).toEqual(["GetKevaId"]);
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("keeps existing awaiting orders and scheduled reconciliation strictly read-only at the provider", async () => {
    const module = await issue(); immediateProvider(String(module.category));
    await store.recordPbxResult("phone-hk", "OK", "54321");
    await respond(result);
    const order = (await store.orderForCall("phone-hk"))!;
    await reconcilePhoneKeva(env, order.id, "54321");
    await syncKevas(env, true);
    expect(actions()).not.toContain("TashlumBodedNew");
    expect(actions()).not.toContain("UpdateKevaNew");
    expect(actions()).not.toContain("DeleteKeva");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM phone_keva_first_charges").get()!.n).toBe(0);
    expect((await store.orderForCall("phone-hk"))!.state).toBe("awaiting_settlement");
    expect(counts()).toEqual([0, 0, 0]);
  });

  it("uses the returned ID alias when no separate confirmation is present", async () => {
    const module = await issue(); immediateProvider(String(module.category), "59", { charge: { Status: "OK", ID: "987654" } });
    expect(JSON.stringify(await respond(result))).toContain("התשלום אושר");
    expect((await store.orderForCall("phone-hk"))!.transaction_id).toBe("987654");
    expect(counts()).toEqual([1, 1, 1]);
  });
});

describe("phone monthly enrollment", () => {
  it("offers phone-enabled monthly packages with server-derived keys and prices on the sales route", async () => {
    Object.assign(env, { TLIVR_PROJECT_ENABLED: "true", TLIVR_CALLBACK_SECRET: "cb", TLIVR_SYSTEM_PHONE: "0765673575", TLIVR_PROJECT_PATH: "/" });
    const response = await handleCallback(new Request("https://example.test/v1/technoline/ivr/sales?key=cb&PBXnum=0765673575&PBXextensionPath=/3&PBXphone=0500000001&PBXcallId=sales-menu"), env, settings(env), "sales");
    expect(response.name).toBe("isaacPackage");
    const text = JSON.stringify(response.files);
    expect(response.files).toEqual([{ text: SALES_MENU_TEXT }]);
    expect(text).not.toContain("דקות");
    const context = await b.loadContext("payments:sales-menu");
    expect(context.package_ids).toEqual(ids);
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
    const topup = (params: Record<string, string>) => paymentResponse(store, env, "/", { PBXcallId: "topup", ...params }, "c1", ["school-topup"]);
    const module = await topup({ isaacPackage: "1" });
    expect(module.name).toBe("isaacPayConfirm");
    expect(await topup({ isaacPayConfirm: "2" })).toMatchObject({ paymentsMode: "regular", payments: 1, sum: 39 });
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
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("בקרוב");
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
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("בקרוב");
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
    expect((await respond({ isaacPayConfirm: "2" })).type).not.toBe("creditCard");
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
    expect(JSON.stringify(await respond({ isaacPayStatus: "OK" }))).toContain("בקרוב");
    expect(counts()).toEqual([0, 0, 0]);
  });

  it.each(["pending", "active", "past_due"])("explains an existing %s standing order instead of generic unavailability", async state => {
    db.sql.prepare(`INSERT INTO standing_orders(id,customer_id,package_id,snapshot,monthly_agorot,first_order_id,state,created_at,updated_at)
      VALUES ('existing','c1','school-step','{}',5900,'first',?,'2026-11-22','2026-11-22')`).run(state);
    expect(await respond({ isaacPackage: "1" })).toMatchObject({ name: "isaacPayExit", enabledKeys: "0,9",
      files: [{ text: "כבר קיים מנוי פעיל בחשבון. לחזרה הקישו 0. לשירות הקישו 9." }] });
    expect(await store.orderForCall("phone-hk")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await respond({ isaacPayExit: "0" })).toMatchObject({ type: "goTo", goTo: "/" });
    expect(await respond({ isaacPayExit: "9" })).toMatchObject({ type: "goTo", goTo: "/4" });
  });

  it.each(["active", "paused", "past_due"])("explains an existing %s subscription", async status => {
    db.sql.prepare(`INSERT INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,created_at,updated_at)
      VALUES ('existing','c1','school-step',?,5900,'2026-11-22','2026-11-22','2026-11-22')`).run(status);
    expect(await respond({ isaacPackage: "1" })).toMatchObject({ name: "isaacPayExit",
      files: [{ text: "כבר קיים מנוי פעיל בחשבון. לחזרה הקישו 0. לשירות הקישו 9." }] });
    expect(await store.orderForCall("phone-hk")).toBeNull();
  });

  it.each(["selected", "issued", "awaiting_settlement"])("explains an existing %s phone enrollment", async state => {
    await store.create("another-call", "c1", "school-step");
    db.sql.prepare("UPDATE payment_orders SET state=? WHERE call_id='another-call'").run(state);
    expect(await respond({ isaacPackage: "1" })).toMatchObject({ name: "isaacPayExit",
      files: [{ text: "כבר קיים מנוי פעיל בחשבון. לחזרה הקישו 0. לשירות הקישו 9." }] });
    expect(await store.orderForCall("phone-hk")).toBeNull();
  });

  it("explains a pending-phone unique-index conflict after a concurrent selection", async () => {
    const batch = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async statements => {
      await store.create("winning-call", "c1", "school-step");
      return batch(statements);
    });
    expect(await respond({ isaacPackage: "1" })).toMatchObject({ name: "isaacPayExit",
      files: [{ text: "כבר קיים מנוי פעיל בחשבון. לחזרה הקישו 0. לשירות הקישו 9." }] });
    expect(await store.orderForCall("phone-hk")).toBeNull();
    expect((await store.orderForCall("winning-call"))!.state).toBe("selected");
  });

  it("keeps other purchase failures generic", async () => {
    await b.save("packages", { ...await b.record("packages", "school-step"), active: false }, "school-step");
    const unavailable = { name: "isaacPayExit", files: [{ text: "החבילה אינה זמינה לרכישה. לחזרה הקישו 0. לשירות הקישו 9." }] };
    expect(await respond({ isaacPackage: "1" })).toMatchObject(unavailable);
    vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("Database unavailable"));
    expect(await respond({ isaacPackage: "2" })).toMatchObject(unavailable);
    expect(await store.orderForCall("phone-hk")).toBeNull();
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

  it.each(["callback", "webhook", "sync"])("honors issued price, minutes and terms after catalog edits through %s", async completion => {
    const module = await issue();
    provider(String(module.category));
    await b.save("packages", { ...await b.record("packages", "school-step"), active: false, phone_enabled: false,
      price_ils: 99, minutes: 999, billing: "one_time", duration_months: 6 }, "school-step");
    if (completion === "callback") await respond({ isaacPayStatus: "OK" });
    else if (completion === "webhook") await hook({ MosadNumber: "7019554", Groupe: module.category, KevaId: "54321", Amount: "59", Currency: "1" });
    else await syncKevas(env, true);
    expect(counts()).toEqual([1, 1, 1]);
    expect(db.sql.prepare("SELECT price_agorot,monthly_minutes,term_months FROM subscriptions").get()).toEqual({ price_agorot: 5900, monthly_minutes: 60, term_months: null });
    expect(db.sql.prepare("SELECT amount_ils,minutes FROM sales_receipts").get()).toEqual({ amount_ils: 59, minutes: 60 });
    const standing = db.sql.prepare("SELECT monthly_agorot,snapshot FROM standing_orders").get()!;
    expect(standing.monthly_agorot).toBe(5900);
    expect(JSON.parse(String(standing.snapshot))).toMatchObject({ price_ils: 59, minutes: 60, billing: "monthly" });
  });

  it.each([["0", "/"], ["9", "/4"], ["ERROR", "/"]])("allows exit %s while payments are unavailable without processing results", async (key, destination) => {
    await issue();
    env.NEDARIM_PHONE_ENABLED = "false";
    expect(await respond({ isaacPayExit: key, isaacPayStatus: "OK" })).toMatchObject({ type: "goTo", goTo: destination });
    expect((await store.orderForCall("phone-hk"))!.state).toBe("issued");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles hangup and cancels selection even when payments become unavailable", async () => {
    await respond({ isaacPackage: "1" });
    env.NEDARIM_PHONE_ENABLED = "false";
    expect(await respond({ PBXcallStatus: "HANGUP", isaacPayStatus: "OK" })).toEqual({ type: "hangup" });
    expect((await store.orderForCall("phone-hk"))!.state).toBe("cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("announces representative-only monthly plans but does not offer them as purchase keys", async () => {
    await b.save("packages", { ...await b.record("packages", "school-pace"), phone_enabled: false }, "school-pace");
    const menu = await respond();
    const text = JSON.stringify(menu.files);
    expect(text).toContain("סמול טוק, ב-119 שקלים לחודש");
    expect(text).not.toContain("דקות");
    expect(text).toContain("באמצעות נציג");
    expect(text).not.toContain("למנוי סמול טוק:");
    expect(text).toContain("למנוי סטארט:");
    expect(text).toContain("למנוי פרו:");
    expect((await respond({ isaacPackage: "2" })).name).toBe("isaacPayExit");
    expect(counts()).toEqual([0, 0, 0]);
  });
});

describe("five-package phone sales", () => {
  it("keeps the phone Master default, then saves the first-lesson choice through the tutor tool", async () => {
    await purchaseMaster();
    const original = db.sql.prepare("SELECT domains_json FROM subscriptions").get()!;
    expect(JSON.parse(String(original.domains_json)).every((d: any) => d.domain === "everyday")).toBe(true);
    expect(await masteryDomainGuidance(env.DB, "c1")).toContain("באיזה תחום הכי חשוב לך להתחזק?");
    const session = new TutorSession({} as WebSocket, env, settings(env), "owner") as any;
    session.customerId = "c1";
    session.controls = { lesson: {} };
    session.masteryDomain = true;
    session.ai = { addContext: vi.fn() };
    expect(await session.recordTool({ name: "save_mastery_domain", args: { domain: "travel" } })).toBe(true);
    expect(JSON.parse(String(db.sql.prepare("SELECT domains_json FROM subscriptions").get()!.domains_json))).toEqual([...JSON.parse(String(original.domains_json)), { domain: "travel" }]);
    expect(JSON.parse(String(db.sql.prepare("SELECT snapshot FROM payment_orders").get()!.snapshot)).guarantee_domain).toBe("travel");
    expect(await masteryDomainGuidance(env.DB, "c1")).toBeNull();
    expect(await session.recordTool({ name: "save_mastery_domain", args: { domain: "business" } })).toBe(false);
  });
  it("does not offer or save a domain for missing, unpaid, anonymous or other customers", async () => {
    expect(await masteryDomainGuidance(env.DB, "c1")).toBeNull();
    const module = await issue("5");
    expect(await masteryDomainGuidance(env.DB, "c1")).toBeNull();
    expect(await saveMasteryDomain(env.DB, "c1", "travel")).toBe(false);
    await hook({ MosadNumber: "7019554", Groupe: module.category, Amount: "1490", Currency: "1", TransactionId: "987654", Confirmation: "approved" });
    for (const id of ["anonymous-1", "other", ""]) {
      expect(await masteryDomainGuidance(env.DB, id)).toBeNull();
      expect(await saveMasteryDomain(env.DB, id, "travel")).toBe(false);
    }
    for (const domain of [undefined, "", "everyday", "invented"]) expect(await saveMasteryDomain(env.DB, "c1", domain)).toBe(false);
    expect(await masteryDomainGuidance(env.DB, "c1")).not.toBeNull();
  });
  it("does not offer the phone choice for a web subscription or suspended access", async () => {
    await purchaseMaster();
    db.sql.exec("UPDATE payment_orders SET channel='web'");
    expect(await masteryDomainGuidance(env.DB, "c1")).toBeNull();
    expect(await saveMasteryDomain(env.DB, "c1", "travel")).toBe(false);
    db.sql.exec("UPDATE payment_orders SET channel='phone'; UPDATE subscriptions SET access_suspended_at='2026-11-22T13:00:00Z'");
    expect(await masteryDomainGuidance(env.DB, "c1")).toBeNull();
  });
  it("offers only in the first school lesson after purchase, not on subsequent lessons", async () => {
    await purchaseMaster();
    db.sql.exec(`INSERT INTO bots(id,label,role,created_at,updated_at) VALUES('master-teacher','Teacher','teacher','2026-11-01','2026-11-01');
      INSERT INTO call_customers(call_id,customer_id,bot_id,channel,created_at) VALUES('past-lesson','c1','master-teacher','phone','2026-11-22');
      INSERT INTO sessions(student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,observations_json)
      VALUES('c1','past-lesson','2026-11-22T12:00:00Z','2026-11-22T12:05:00Z',300,1,1,'[]')`);
    expect(await masteryDomainGuidance(env.DB, "c1")).not.toBeNull();
    db.sql.exec("UPDATE sessions SET started_at='2026-11-22T13:01:00Z',ended_at='2026-11-22T13:06:00Z'");
    vi.setSystemTime(new Date("2026-11-22T13:10:00Z"));
    expect(await masteryDomainGuidance(env.DB, "c1")).toBeNull();
  });
  it("rolls back the domain choice if updating the purchase snapshot fails", async () => {
    await purchaseMaster();
    const original = db.sql.prepare("SELECT domains_json FROM subscriptions").get();
    db.sql.exec("CREATE TRIGGER domain_failure BEFORE UPDATE OF snapshot ON payment_orders BEGIN SELECT RAISE(ABORT,'snapshot update failed'); END");
    await expect(saveMasteryDomain(env.DB, "c1", "travel")).rejects.toThrow("snapshot update failed");
    expect(db.sql.prepare("SELECT domains_json FROM subscriptions").get()).toEqual(original);
  });
  it("exposes the domain tool only for eligible identified lessons", () => {
    const controls: Parameters<typeof buildSetupPayload>[0] = { ...controlsFromSettings(true), lesson: { level: "beginner", topic: "everyday", conversation_mode: "guided", learning_load: "light", correction_policy: "after_answer", closing_activity: "roleplay", vocabulary: [], grammar: [] } };
    for (const [customerId, masteryDomain, expected] of [["c1", true, true], ["c1", false, false], ["anonymous-1", true, false], [undefined, true, false]] as const) {
      expect(buildSetupPayload(controls, "test", "teacher", settings(env), { customerId, masteryDomain }).setup.tools[0].functionDeclarations.some(t => t.name === "save_mastery_domain")).toBe(expected);
    }
    expect(buildSetupPayload(controlsFromSettings(true), "test", "translator", settings(env), { customerId: "c1", masteryDomain: true }).setup.tools[0].functionDeclarations.some(t => t.name === "save_mastery_domain")).toBe(false);
  });
  it.each(SCHOOL_SALES_PACKAGE_IDS)("quotes the current price instead of stale text or recording for %s", async id => {
    env.SALES_MENU_AUDIO_URL = "https://example.test/menu.wav";
    env.SALES_MENU_AUDIO_VERSION = "v1";
    await b.save("packages", { ...await b.record("packages", id), price_ils: 321 }, id);
    const menu = await respond();
    expect(menu.files).not.toEqual([{ text: SALES_MENU_TEXT }]);
    const text = JSON.stringify(menu.files);
    expect(text).toContain("321 שקלים");
    expect(text).not.toContain("fileLink");
    expect(text).not.toContain("דקות");
  });
  it.each(["school-foundations", "school-mastery"])("quotes the current installment maximum for %s", async id => {
    env.SALES_MENU_AUDIO_URL = "https://example.test/menu.wav";
    env.SALES_MENU_AUDIO_VERSION = "v1";
    await b.save("packages", { ...await b.record("packages", id), max_payments: 3 }, id);
    const menu = await respond();
    const text = JSON.stringify(menu.files);
    expect(menu.files).not.toEqual([{ text: SALES_MENU_TEXT }]);
    expect(text).toContain("עד 3 תשלומים");
    expect(text).not.toContain("fileLink");
    expect(text).not.toContain("דקות");
  });
  it("uses one combined versioned recording, falling back to the exact approved text", async () => {
    expect((await respond()).files).toEqual([{ text: SALES_MENU_TEXT }]);
    env.SALES_MENU_AUDIO_URL = "https://example.test/sales.wav";
    expect((await respond()).files).toEqual([{ text: SALES_MENU_TEXT }]);
    env.SALES_MENU_AUDIO_VERSION = "v3";
    expect(await respond()).toMatchObject({ enabledKeys: "0,1,2,3,4,5,9", files: [{ fileLink: "https://example.test/sales.wav", fileName: "sales-menu-v3" }] });
    Object.assign(env, { TLIVR_PROJECT_ENABLED: "true", TLIVR_CALLBACK_SECRET: "cb", TLIVR_SYSTEM_PHONE: "0765673575", TLIVR_PROJECT_PATH: "/" });
    const response = await handleCallback(new Request("https://example.test/v1/technoline/ivr/sales?key=cb&PBXnum=0765673575&PBXextensionPath=/3&PBXphone=0500000001&PBXcallId=recorded-sales"), env, settings(env), "sales");
    expect(response.files).toEqual([{ fileLink: "https://example.test/sales.wav", fileName: "sales-menu-v3" }]);
    expect(await respond({ isaacPackage: "0" })).toMatchObject({ type: "goTo", goTo: "/" });
    expect(await respond({ isaacPackage: "9" })).toMatchObject({ type: "goTo", goTo: "/4" });
  });

  it("reads the approved terms on 1, returns to terms, and only issues on 2", async () => {
    expect(await respond({ isaacPackage: "1" })).toMatchObject({ name: "isaacPayConfirm", enabledKeys: "0,1,2", files: [{ text: TERMS_STEP_TEXT }] });
    for (let i = 0; i < 2; i++) {
      expect(await respond({ isaacPayConfirm: "1" })).toMatchObject({ type: "simpleMenu", name: "isaacPayConfirm", files: [{ text: TERMS_TEXT }, { text: TERMS_STEP_TEXT }] });
      expect((await store.orderForCall("phone-hk"))?.state).toBe("selected");
    }
    expect(await respond({ isaacPayConfirm: "2" })).toMatchObject({ type: "creditCard", paymentsMode: "kevaMonthly", payments: 1, sum: 59 });
    expect(JSON.stringify(await respond())).not.toContain("דקות");
    expect(TERMS_TEXT).toContain("עד 60 דקות בחודש");
    expect(TERMS_TEXT).not.toContain("לא עוברות");
  });

  it.each([["4", 690, 6], ["5", 1490, 12]])("allows regular installments and grants the term subscription for key %s", async (choice, amount, months) => {
    expect((await respond({ isaacPackage: String(choice) })).files).toEqual([{ text: TERMS_STEP_TEXT }]);
    const module = await respond({ isaacPayConfirm: "2" });
    expect(module).toMatchObject({ type: "creditCard", sum: amount, payments: months, paymentsMode: "regular" });
    expect(module).not.toHaveProperty("kevaDay");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM phone_keva_enrollments").get()!.n).toBe(0);
    const event = { MosadNumber: "7019554", Groupe: module.category, Amount: String(amount), Currency: "1", TransactionId: "987654", Confirmation: "approved" };
    await expect(hook({ ...event, Amount: "1" })).rejects.toMatchObject({ status: 400 });
    expect(counts()).toEqual([0, 0, 0]);
    expect(await hook(event)).toMatchObject({ paid: true });
    expect(await hook(event)).toMatchObject({ paid: true, duplicate: true });
    expect(counts()).toEqual([1, 1, 0]);
    expect(db.sql.prepare("SELECT term_months,monthly_minutes,period_number FROM subscriptions").get()).toMatchObject({ term_months: months, monthly_minutes: 150, period_number: 1 });
    expect(await b.hasPaidAccess("c1")).toBe(true);
  });

  it("reconciles one-time duration purchases through the same entitlement path", async () => {
    await respond({ isaacPackage: "4" });
    const module = await respond({ isaacPayConfirm: "2" });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const action = new URLSearchParams(String(init.body)).get("Action");
      return Response.json(action === "GetHistoryJson" ? [{ Groupe: module.category, Amount: "690", Currency: "1", TransactionId: "987654", Confirmation: "approved" }] : []);
    }));
    expect(await store.reconcile(env)).toMatchObject({ GetHistoryJson: { matched: 1 } });
    expect(counts()).toEqual([1, 1, 0]);
  });

  it("cancels at terms without charging or exposing minute wording", async () => {
    for (const choice of ["1", "2", "3", "4", "5"]) {
      const call = "cancel-" + choice;
      expect(JSON.stringify(await respond({ isaacPackage: choice }, call))).not.toContain("דקות");
      expect(await respond({ isaacPayConfirm: "0" }, call)).toMatchObject({ type: "goTo" });
      expect((await store.orderForCall(call))?.state).toBe("cancelled");
    }
    expect(counts()).toEqual([0, 0, 0]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("publishes cadence but never the internal quota", async () => {
    const response = await worker.fetch(new Request("https://example.test/v1/public/packages"), env);
    expect(response.status).toBe(200);
    const data = await response.json() as { items: Record<string, any>[] };
    expect(data.items.find(p => p.id === "school-step")).toMatchObject({ name: "סטארט", sessions_per_week: 3 });
    expect(data.items.find(p => p.id === "school-mastery")).toMatchObject({ sessions_per_week: 7, max_payments: 12 });
    expect(JSON.stringify(data)).not.toContain("monthly_minutes");
  });

  it("offers service and return when the catalog is empty", async () => {
    db.sql.exec("UPDATE console_records SET body=json_set(body,'$.active',json('false')) WHERE kind='packages'");
    const response = await paymentResponse(store, env, "/", { PBXcallId: "empty-sales" }, "c1", []);
    expect(response).toMatchObject({ type: "simpleMenu", name: "isaacPayExit", enabledKeys: "0,9" });
    expect(JSON.stringify(response)).not.toContain("דקות");
  });
});
