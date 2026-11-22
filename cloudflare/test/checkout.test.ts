import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { type Env } from "../src/env";
import worker from "../src/index";
import { standingOrderStart } from "../src/checkout";
import { SubscriptionStore, addMonths } from "../src/subscriptions";
import { attribution } from "./analytics-fixture";
import { PaymentStore } from "../src/payments";

// Execute production SQL, including JSON operations and atomic challenge consumption.
class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
      this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    }
  }
  prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      first: async (column?: string) => { const row = this.sql.prepare(query).get(...args); return row ? column ? row[column] : row : null; },
      all: async () => ({ results: this.sql.prepare(query).all(...args), success: true }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...args).changes) } }),
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.sql.exec("BEGIN");
    try {
      const result = [];
      for (const s of statements) result.push(await s.all());
      this.sql.exec("COMMIT");
      return result;
    } catch (e) { this.sql.exec("ROLLBACK"); throw e; }
  }
}

let db: SqlD1, env: Env, b: BusinessStore, token: string, calls: Record<string, string>[];
const req = (path: string, body?: unknown) => worker.fetch(new Request("https://speakcall.app" + path, {
  method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env);
async function hook(data: Record<string, unknown>) {
  const raw = JSON.stringify(data), ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "." + raw)))].map(x => x.toString(16).padStart(2, "0")).join("");
  return worker.fetch(new Request("https://speakcall.app/v1/payments/nedarim/webhook", { method: "POST", body: raw, headers: { "x-nedarim-timestamp": ts, "x-nedarim-signature": "v1=" + sig } }), env);
}
let keva: Record<string, string> = {};

const paidKeva = {
  KevaId: "12345", Groupe: "חבילות ספיקול", Phone: "+972500000001", Amount: "49",
  Enabled: "1", Currency: "1", Success: "1", ErrorText: "",
};
const paidKevaDetail = {
  KevaId: "12345", KevaGroupe: paidKeva.Groupe, KevaPhone: "0500000001", KevaAmount: "49",
  KevaStatus: "1", KevaCurrency: "1", KevaFrequency: "1", KevaNextDate: "19/12/26",
  HistoryData: [{ ID: "1", Amount: "49 ₪", Date: "19/11/26", TransactionId: "902" }],
};
const syncPaidKeva = () => worker.fetch(new Request("https://speakcall.app/v1/admin/nedarim/kevas/sync", {
  method: "POST", headers: { Authorization: "Bearer a" },
}), env);
function providerKeva(row: Record<string, unknown>, detail: Record<string, unknown>) {
  vi.setSystemTime(new Date("2026-11-22T13:00:00Z"));
  const actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const action = new URLSearchParams(String(init.body)).get("Action") ?? "";
    actions.push(action);
    if (action === "GetKevaJson") return Response.json([row]);
    if (action === "GetKevaId") return Response.json(detail);
    throw new Error("Unexpected provider request");
  }));
  return actions;
}

describe("existing Nedarim subscribers", () => {
  it.each([49, 59])("opens paid phone and portal access for an existing ₪%s monthly payment", async amount => {
    const actions = providerKeva({ ...paidKeva, Amount: String(amount) }, { ...paidKevaDetail,
      KevaAmount: String(amount), HistoryData: [{ ...paidKevaDetail.HistoryData[0], Amount: amount + " ₪" }],
    });
    expect(await b.hasPaidAccess("c1")).toBe(false);
    expect(await (await syncPaidKeva()).json()).toEqual({ synced: 1 });
    expect(await (await syncPaidKeva()).json()).toEqual({ synced: 1 });
    expect(actions).toEqual(["GetKevaJson", "GetKevaId", "GetKevaJson"]);
    expect(db.sql.prepare("SELECT customer_id,plan_id,price_agorot,status FROM subscriptions").all()).toEqual([
      { customer_id: "c1", plan_id: "school-step", price_agorot: amount * 100, status: "active" },
    ]);
    expect(db.sql.prepare("SELECT reference,amount_ils,minutes,expires_at FROM sales_receipts").all()).toEqual([
      { reference: "nedarim:7019554:902", amount_ils: amount, minutes: 60, expires_at: "2027-01-19T00:00:00.000+00:00" },
    ]);
    expect(await b.hasPaidAccess("c1")).toBe(true);
    expect(await (await req("/v1/portal/billing")).json()).toMatchObject({ subscriptions: [{ state: "active", monthly_ils: amount }] });
    await b.save("policies", { product: "school", enabled: true }, "teacher");
    const caller = await b.identifyCall("0500000001", "paid-call", "teacher");
    expect(await b.hasSchoolCallbackMinutes(caller)).toBe(true);
    expect(await b.reserveCall(caller, "teacher", "paid-call", 60)).toEqual({ mode: "paid", seconds: 60 });
    const charge = { MosadNumber: "7019554", KevaId: "12345", Confirmation: "10", Amount: String(amount), Currency: "1" };
    expect(await (await hook({ ...charge, TransactionId: "901" })).json()).toEqual({ ignored: true });
    expect(await (await hook({ ...charge, TransactionId: "902" })).json()).toMatchObject({ duplicate: true });
    const refusal = { MosadNumber: "7019554", KevaId: "12345", Status: "Error", Message: "Declined" };
    expect(await new PaymentStore(b).refusal({ ...refusal, ErrorDate: "18/11/2026 17:11" }, "7019554")).toEqual({ ignored: true });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toEqual({ state: "active" });
    vi.setSystemTime(new Date("2026-12-19T13:00:00Z"));
    expect(await b.hasPaidAccess("c1")).toBe(true);
    expect(await (await hook({ ...charge, TransactionId: "903" })).json()).toMatchObject({ paid: true });
    expect(await b.hasPaidAccess("c1")).toBe(true);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sales_receipts").get()).toEqual({ n: 2 });
    vi.setSystemTime(new Date("2027-01-19T13:00:00Z"));
    expect(await (await hook({ ...refusal, ErrorTime: "19/01/2027 14:00:00" })).json()).toEqual({ recorded: true });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toEqual({ state: "past_due" });
    expect(await b.hasPaidAccess("c1")).toBe(false);
    expect(await b.hasSchoolCallbackMinutes("c1")).toBe(false);
    await b.cancelCallReservation("paid-call");
    expect(await b.reserveCall(caller, "teacher", "blocked-call", 60)).toMatchObject({ mode: "payment_failed", seconds: 0 });
    const portalToken = (await b.portalInvite("c1")).token;
    token = portalToken;
    expect(await (await req("/v1/portal/me")).json()).toMatchObject({ access: { paid: false, payment_failed: true } });
  });

  it("records a refusal newer than a recovered charge even if both arrive later", async () => {
    providerKeva(paidKeva, paidKevaDetail);
    expect((await syncPaidKeva()).status).toBe(200);
    vi.setSystemTime(new Date("2027-01-22T13:00:00Z"));
    const store = new PaymentStore(b), common = { MosadNumber: "7019554", KevaId: "12345" };
    expect(await store.settle({ ...common, TransactionId: "903", Confirmation: "10", Amount: "49", Currency: "1", TransactionTime: "19/12/2026 12:00:00" }, "7019554"))
      .toMatchObject({ paid: true });
    expect(await store.refusal({ ...common, Status: "Error", ErrorDate: "19/01/2027 12:00" }, "7019554")).toEqual({ recorded: true });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toEqual({ state: "past_due" });
  });

  it("reconciles only a full, linked reversal of the current charge and keeps its minutes reversed after recovery", async () => {
    providerKeva(paidKeva, paidKevaDetail);
    expect((await syncPaidKeva()).status).toBe(200);
    vi.setSystemTime(new Date("2026-11-24T13:00:00Z"));
    const common = { Currency: "1", TransactionTime: "23/11/2026 12:00:00", Amount: "-49" };
    const reversal = { ...common, TransactionId: "906", Comments: "זיכוי עסקה: 902" };
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const action = new URLSearchParams(String(init.body)).get("Action");
      return Response.json(action === "GetHistoryJson" ? [
        { ...common, TransactionId: "903", KevaId: "12345", Comments: "החזרת הוראת קבע" },
        { ...reversal, TransactionId: "904", Comments: "זיכוי עסקה: 999" },
        { ...reversal, TransactionId: "905", Amount: "-10" },
        reversal,
      ] : [{ ID: "10", KevaId: "12345", ErrorDate: "22/11/2026 12:00", Error: "Declined" }]);
    }));
    const store = new PaymentStore(b);
    expect(await store.reconcile(env)).toMatchObject({ GetHistoryJson: { received: 4, matched: 1 }, GetErrorLogsJson: { received: 1, matched: 0 } });
    expect(await b.hasPaidAccess("c1")).toBe(false);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_return'").get()).toEqual({ n: 1 });
    expect(await store.settle({ ...reversal, MosadNumber: "7019554" }, "7019554")).toEqual({ ignored: true });
    vi.setSystemTime(new Date("2026-12-19T13:00:00Z"));
    expect(await (await hook({ MosadNumber: "7019554", KevaId: "12345", TransactionId: "907", Amount: "49", Currency: "1", Confirmation: "10", TransactionTime: "19/12/2026 12:00:00" })).json()).toMatchObject({ paid: true });
    expect(await b.hasPaidAccess("c1")).toBe(true);
    expect(await b.schoolPaymentFailed("c1")).toBe(false);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE payment_reversed_at IS NOT NULL").get()).toEqual({ n: 1 });
    expect((await new SubscriptionStore(env.DB).summary("c1"))[0]).toMatchObject({ rollover_minutes: 0, rollover: [] });
  });

  it.each([
    ["declined", { ErrorText: "Card declined" }, {}],
    ["never paid", { Success: "0" }, {}],
    ["disabled", { Enabled: "0" }, {}],
    ["another use of the terminal", { Groupe: "Other", }, {}],
    ["unknown plan", { Amount: "42" }, {}],
    ["unmatched phone", { Phone: "0500000009" }, {}],
    ["conflicting payer", {}, { KevaPhone: "0500000009" }],
    ["non-monthly order", {}, { KevaFrequency: "2" }],
    ["no verified charge", {}, { HistoryData: [] }],
    ["expired charge", {}, { HistoryData: [{ ...paidKevaDetail.HistoryData[0], Date: "19/10/26" }] }],
    ["later cancellation", {}, { HistoryData: [...paidKevaDetail.HistoryData, { ID: "3", Date: "20/11/26" }] }],
  ])("does not open access for %s", async (_reason, row, detail) => {
    providerKeva({ ...paidKeva, ...row }, { ...paidKevaDetail, ...detail });
    expect((await syncPaidKeva()).status).toBe(200);
    expect(await b.hasPaidAccess("c1")).toBe(false);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM payment_orders").get()).toEqual({ n: 0 });
  });
});

it.each([false, true])("attributes reconciled payments without failing settlement on analytics errors (%s)", async failAnalytics => {
  const order = await (await req("/v1/portal/checkout", { package_id: "school-foundations", attribution })).json() as any;
  const store = new PaymentStore(b);
  const charge = { TransactionId: "98768", Confirmation: "5", Amount: String(order.amount_ils), Currency: "1", Groupe: "dibura-" + order.id };
  vi.spyOn(store, "providerRows").mockImplementation(async (_env, action) => action === "GetHistoryJson" ? [charge] : []);
  if (failAnalytics) db.sql.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(FAIL,'analytics unavailable'); END;");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await store.reconcile(env)).toMatchObject({ GetHistoryJson: { received: 1, matched: 1 }, GetErrorLogsJson: { received: 0, matched: 0 } });
    expect(db.sql.prepare("SELECT state FROM payment_orders WHERE id=?").get(order.id)?.state).toBe("paid");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM payment_issues WHERE kind='settlement_review'").get()?.n).toBe(0);
    if (failAnalytics) expect(logged).toHaveBeenCalledWith("Analytics purchase failed", expect.any(Error));
    else {
      expect(db.sql.prepare("SELECT order_id,value,first_touch FROM analytics_events WHERE event='purchase'").all()).toEqual([
        expect.objectContaining({ order_id: order.id, value: order.amount_ils, first_touch: JSON.stringify(attribution.first_touch) }),
      ]);
      db.sql.exec("UPDATE payment_sync SET attempted_at=0");
      await store.reconcile(env);
      expect(db.sql.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE event='purchase'").get()?.n).toBe(1);
    }
  } finally { logged.mockRestore(); }
});

it("returns a paid webhook result when analytics inserts fail without creating settlement review", async () => {
  const order = await (await req("/v1/portal/checkout", { package_id: "school-foundations", attribution })).json() as any;
  db.sql.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(FAIL,'analytics unavailable'); END;");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await hook({ MosadNumber: "7019554", TransactionId: "98766", Confirmation: "5", Amount: String(order.amount_ils), Currency: "1", Groupe: "dibura-" + order.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paid: true, customer_id: "c1", amount_ils: order.amount_ils });
    expect(db.sql.prepare("SELECT state FROM payment_orders WHERE id=?").get(order.id)?.state).toBe("paid");
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM payment_issues WHERE kind='settlement_review'").get()?.n).toBe(0);
    expect(logged).toHaveBeenCalledWith("Analytics purchase failed", expect.any(Error));
  } finally { logged.mockRestore(); }
});

it("keeps a paid webhook successful when attribution lookup fails", async () => {
  const order = await (await req("/v1/portal/checkout", { package_id: "school-foundations", attribution })).json() as any;
  db.sql.exec("DROP TABLE analytics_attribution");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await hook({ MosadNumber: "7019554", TransactionId: "98767", Confirmation: "5", Amount: String(order.amount_ils), Currency: "1", Groupe: "dibura-" + order.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paid: true });
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM payment_issues WHERE kind='settlement_review'").get()?.n).toBe(0);
    expect(logged).toHaveBeenCalledWith("Analytics purchase attribution failed", expect.any(Error));
  } finally { logged.mockRestore(); }
});

it("creates checkout despite an analytics insert failure", async () => {
  db.sql.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(FAIL,'analytics unavailable'); END;");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await req("/v1/portal/checkout", { package_id: "school-foundations", attribution });
    expect(response.status).toBe(200);
    const order = await response.json() as any;
    expect(db.sql.prepare("SELECT customer_id FROM payment_orders WHERE id=?").get(order.id)?.customer_id).toBe("c1");
    expect(logged).toHaveBeenCalledWith("Analytics checkout failed", expect.any(Error));
  } finally { logged.mockRestore(); }
});

it("attributes signed purchases to the stored checkout even without a browser and deduplicates webhook retries", async () => {
  const response = await req("/v1/portal/checkout", { package_id: "school-foundations", attribution });
  expect(response.status).toBe(200);
  const order = await response.json() as any;
  expect(db.sql.prepare("SELECT customer_id,reference,first_touch FROM analytics_events WHERE event='begin_checkout'").get()).toMatchObject({ customer_id: "c1", reference: order.id, first_touch: JSON.stringify(attribution.first_touch) });
  const charge = { MosadNumber: "7019554", TransactionId: "98765", Confirmation: "5", Amount: String(order.amount_ils), Currency: "1", Groupe: "dibura-" + order.id };
  expect((await hook({ ...charge, Amount: "1" })).status).toBe(400);
  expect(db.sql.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE event='purchase'").get()?.n).toBe(0);
  expect((await hook(charge)).status).toBe(200);
  expect((await hook(charge)).status).toBe(200);
  expect(db.sql.prepare("SELECT customer_id,order_id,value,currency,first_touch,last_touch FROM analytics_events WHERE event='purchase'").all()).toEqual([
    expect.objectContaining({ customer_id: "c1", order_id: order.id, value: order.amount_ils, currency: "ILS", first_touch: JSON.stringify(attribution.first_touch), last_touch: JSON.stringify(attribution.last_touch) }),
  ]);
});
beforeEach(async () => {
  db = new SqlD1();
  env = { DB: db, ADMIN_BEARER_SECRET: "a", NEDARIM_MOSAD_ID: "7019554", NEDARIM_API_KEY: "npk_x", NEDARIM_WEBHOOK_SECRET: "whsec_test", NEDARIM_API_VALID: "valid12345" } as unknown as Env;
  b = new BusinessStore(env.DB);
  await b.save("customers", { name: "Dana", phone: "0500000001", source: "test", preferred_bot: "", notes: "" }, "c1");
  token = (await b.portalInvite("c1")).token;
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    calls.push({ url: String(url), ...form });
    if (String(url).includes("CreateTransaction")) return Response.json({ Status: "OK", ID: String(500 + calls.length) });
    if (form.Action === "GetKevaId") return Response.json(keva);
    if (form.Action === "UpdateKevaNew") return Response.json({ Result: "OK" });
    if (form.Action === "DisableKeva") return new Response("OK");
    if (form.Action === "EnableKevaNew") return Response.json({ NextDate: "15/02/26" });
    if (form.Action === "DeleteKeva") return new Response("OK");
    return Response.json({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); db.sql.close(); });

describe("website checkout", () => {
  it("does not restore a failed removal into two active family memberships", async () => {
    const { o, store } = await monthly();
    const member = await store.addMember(o.id, "0502223333", "Child");
    await b.save("customers", { name: "Other owner", phone: "0503334444" }, "c2");
    const other = await store.create("c2", "school-step");
    let raced = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!raced) {
        raced = true;
        await store.addMember(other.id, "0502223333", "Child");
        return Response.json({ Result: "Error" });
      }
      return Response.json({ Result: "OK" });
    }));
    await expect(store.removeMember(o.id, member.customer_id)).rejects.toMatchObject({ status: 502 });
    expect(db.sql.prepare("SELECT subscription_id FROM subscription_members WHERE customer_id=? AND removed_at IS NULL").all(member.customer_id)).toEqual([{ subscription_id: other.id }]);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_family_membership_conflict'").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT monthly_agorot FROM standing_orders").get()?.monthly_agorot).toBe(5900);
  });
  it("accepts a signed late charge after repeated family edits and flags only the collection difference", async () => {
    const { o, store } = await monthly();
    await store.addMember(o.id, "0502223333", "One");
    await store.addMember(o.id, "0502224444", "Two");
    await store.addMember(o.id, "0502225555", "Three");
    const charge = { MosadNumber: "7019554", TransactionId: "102", Confirmation: "6", Amount: "59", Currency: "1", KevaId: "4242" };
    expect((await hook(charge)).status).toBe(200);
    expect((await hook(charge)).status).toBe(200);
    expect((await store.get(o.id)).period_number).toBe(2);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='subscription_amount_difference'").get()?.n).toBe(1);
  });
  async function monthly() {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "100", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    expect((await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).status).toBe(200);
    return { o, store: new SubscriptionStore(env.DB, env) };
  }

  it("updates the same Keva's locked family price using partial updates and accepts matching renewals without collection issues", async () => {
    const { o, store } = await monthly();
    const member = await store.addMember(o.id, "0502223333", "Child");
    expect(calls.at(-1)).toMatchObject({ Action: "UpdateKevaNew", Amount: "98.00", KevaId: "4242", MosadId: "7019554", ApiPassword: "npk_x" });
    expect(Object.keys(calls.at(-1)!).sort()).toEqual(["Action", "Amount", "ApiPassword", "KevaId", "MosadId", "url"]);
    expect(db.sql.prepare("SELECT monthly_agorot FROM standing_orders").get()?.monthly_agorot).toBe(9800);
    expect((await hook({ MosadNumber: "7019554", TransactionId: "101", Confirmation: "6", Amount: "98", Currency: "1", KevaId: "4242" })).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues").get()?.n).toBe(0);
    await store.removeMember(o.id, member.customer_id);
    expect(calls.at(-1)).toMatchObject({ Action: "UpdateKevaNew", Amount: "59.00" });
    expect(db.sql.prepare("SELECT monthly_agorot FROM standing_orders").get()?.monthly_agorot).toBe(5900);
  });

  it.each(["json", "text", "http", "network"])("rolls back family additions/removals on a %s provider failure and releases the mutation lock", async failure => {
    const { o, store } = await monthly();
    const member = await store.addMember(o.id, "0502223333", "Child");
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "http") return new Response("error", { status: 503 });
      return failure === "json" ? Response.json({ Result: "Error", Message: "rejected" }) : new Response("error");
    }));
    await expect(store.removeMember(o.id, member.customer_id)).rejects.toMatchObject({ status: 502, detail: expect.stringContaining("בוטל") });
    expect(db.sql.prepare("SELECT removed_at FROM subscription_members").get()?.removed_at).toBeNull();
    await expect(store.addMember(o.id, "0502224444", "Other")).rejects.toMatchObject({ status: 502 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscription_members WHERE removed_at IS NULL").get()?.n).toBe(1);
    expect(await store.renewalAmount(o.id)).toBe(9800);
    expect(db.sql.prepare("SELECT monthly_agorot FROM standing_orders").get()?.monthly_agorot).toBe(9800);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscription_billing_locks").get()?.n).toBe(0);
  });

  it("disables billing before pausing, keeps state on provider errors and stores the documented enable response", async () => {
    const { o, store } = await monthly();
    const provider = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Error")));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/pause", { days: 7 })).status).toBe(502);
    expect((await store.get(o.id)).status).toBe("active");
    vi.stubGlobal("fetch", provider);
    expect((await req("/v1/portal/subscriptions/" + o.id + "/pause", { days: 7 })).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ Action: "DisableKeva", KevaId: "4242" });
    const paused = await store.get(o.id);
    const expiry = db.sql.prepare("SELECT expires_at FROM sales_receipts").get()?.expires_at;
    for (const body of ["Error", '{"Result":"OK"}', '{"NextDate":"31/02/26"}']) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
      expect((await req("/v1/portal/subscriptions/" + o.id + "/resume", {})).status).toBe(502);
      expect(await store.get(o.id)).toMatchObject({ status: "paused", current_period_end: paused.current_period_end });
      expect(db.sql.prepare("SELECT expires_at FROM sales_receipts").get()?.expires_at).toBe(expiry);
    }
    vi.stubGlobal("fetch", provider);
    expect((await req("/v1/portal/subscriptions/" + o.id + "/resume", {})).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ Action: "EnableKevaNew", KevaId: "4242" });
    expect(db.sql.prepare("SELECT next_date FROM standing_orders").get()?.next_date).toBe("15/02/26");
  });

  it("keeps failed automatic enables paused, records one admin issue and retries without losing frozen days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { o, store } = await monthly();
    await store.pause(o.id, 7);
    const provider = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Error")));
    vi.setSystemTime(new Date("2026-01-08T00:00:00Z"));
    await store.tick(); await store.tick();
    expect((await store.get(o.id)).status).toBe("paused");
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_auto_resume'").get()?.n).toBe(1);
    vi.stubGlobal("fetch", provider);
    vi.setSystemTime(new Date("2026-01-09T00:00:00Z"));
    await store.tick();
    expect(await store.get(o.id)).toMatchObject({ status: "active", pause_days_used: 8, current_period_end: "2026-02-09T00:00:00.000+00:00" });
    expect(db.sql.prepare("SELECT next_date FROM standing_orders").get()?.next_date).toBe("15/02/26");
  });

  it("compensates lost pause and resume responses without changing local state", async () => {
    const { o, store } = await monthly();
    const active = await store.get(o.id);
    const billing = db.sql.prepare("SELECT * FROM standing_orders").get();
    const actions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const action = new URLSearchParams(String(init.body)).get("Action")!;
      actions.push(action);
      if (action === "DisableKeva") throw new Error("response lost");
      return Response.json({ NextDate: "15/02/26" });
    }));
    await expect(store.pause(o.id, 7)).rejects.toMatchObject({ status: 502 });
    expect(actions).toEqual(["DisableKeva", "EnableKevaNew"]);
    expect(await store.get(o.id)).toEqual(active);
    expect(db.sql.prepare("SELECT * FROM standing_orders").get()).toEqual(billing);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK")));
    await store.pause(o.id, 7);
    const paused = await store.get(o.id);
    actions.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const action = new URLSearchParams(String(init.body)).get("Action")!;
      actions.push(action);
      if (action === "EnableKevaNew") throw new Error("response lost");
      return new Response("OK");
    }));
    await expect(store.resume(o.id)).rejects.toMatchObject({ status: 502 });
    expect(actions).toEqual(["EnableKevaNew", "DisableKeva"]);
    expect(await store.get(o.id)).toEqual(paused);
    expect(db.sql.prepare("SELECT * FROM standing_orders").get()).toEqual(billing);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(store.resume(o.id)).rejects.toMatchObject({ status: 502 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_resume_recovery'").get()?.n).toBe(1);
  });

  it("rejects concurrent billing changes and pending Kevas without provider calls", async () => {
    const { o, store } = await monthly();
    db.sql.prepare("INSERT INTO subscription_billing_locks VALUES (?,'other',?)").run(o.id, new Date().toISOString());
    const before = calls.length;
    await expect(store.pause(o.id, 7)).rejects.toMatchObject({ status: 409 });
    expect(calls.length).toBe(before);
    db.sql.exec("DELETE FROM subscription_billing_locks; UPDATE standing_orders SET keva_id=NULL,state='pending'");
    await expect(store.addMember(o.id, "0502223333", "Child")).rejects.toMatchObject({ status: 409 });
    expect(calls.length).toBe(before);
  });

  it("does not credit a retried legacy recurring charge under the new reference format", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "60", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id });
    db.sql.exec("UPDATE standing_orders SET entitlement_id=NULL,state='active',keva_id='4242'; UPDATE payment_orders SET entitlement_id=NULL; UPDATE sales_receipts SET subscription_id=NULL,valid_from=NULL; DELETE FROM subscriptions;");
    const date = "2026-02-01T00:00:00.000+00:00";
    db.sql.prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES ('old-renewal','c1','school-step','school','nedarim:7019554:61',59,0.18,60,?,?)").run(addMonths(date, 2), date);
    db.sql.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES ('payment:keva_charge',?,?)").run(o.subscription.id, date);
    vi.setSystemTime(new Date(date));
    const charge = { MosadNumber: "7019554", TransactionId: "61", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    expect((await hook(charge)).status).toBe(200);
    expect((await hook(charge)).status).toBe(200);
    expect((await hook({ ...charge, Amount: "1" })).status).toBe(400);
    expect((await new SubscriptionStore(env.DB).get(o.id)).period_number).toBe(2);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(2);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscription_renewals").get()?.n).toBe(0);
    expect((await hook({ ...charge, TransactionId: "62" })).status).toBe(200);
    expect((await hook({ ...charge, TransactionId: "62" })).status).toBe(200);
    expect((await new SubscriptionStore(env.DB).get(o.id)).period_number).toBe(3);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(3);
  });
  it("continues the calendar of an adopted standing order after previous paid renewals", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-31T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "70", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id });
    db.sql.exec("UPDATE standing_orders SET entitlement_id=NULL,state='active',keva_id='4242'; UPDATE payment_orders SET entitlement_id=NULL; UPDATE sales_receipts SET subscription_id=NULL,valid_from=NULL; DELETE FROM subscriptions;");
    for (const [id, date] of [["71", "2026-02-28T00:00:00.000+00:00"], ["72", "2026-03-31T00:00:00.000+00:00"]]) {
      db.sql.prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES (?,'c1','school-step','school',?,59,0.18,60,?,?)").run(id, "nedarim:7019554:" + id, addMonths(date, 2), date);
      db.sql.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES ('payment:keva_charge',?,?)").run(o.subscription.id, date);
    }
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
    expect((await hook({ MosadNumber: "7019554", TransactionId: "73", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" })).status).toBe(200);
    expect(await new SubscriptionStore(env.DB).get(o.id)).toMatchObject({ started_at: "2026-01-31T00:00:00.000+00:00", period_number: 4, current_period_start: "2026-04-30T00:00:00.000+00:00", current_period_end: "2026-05-31T00:00:00.000+00:00" });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE subscription_id=?").get(o.id)?.n).toBe(4);
  });
  it("settles legacy mastery snapshots using the configured default domains", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "travel" })).json() as any;
    db.sql.prepare("UPDATE payment_orders SET snapshot=json_remove(snapshot,'$.guarantee_domain') WHERE id=?").run(o.id);
    expect((await hook({ MosadNumber: "7019554", TransactionId: "89", Confirmation: "5", Amount: "1490", Currency: "1", Groupe: "dibura-" + o.id })).status).toBe(200);
    expect(JSON.parse((await new SubscriptionStore(env.DB).get(o.id)).domains_json)).toEqual([{ domain: "everyday", levels: ["beginner"] }, { domain: "everyday", levels: ["intermediate", "fluent"] }]);
  });
  it("adopts a legacy paid standing order without crediting its first receipt again", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "80", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id });
    db.sql.exec("UPDATE standing_orders SET entitlement_id=NULL,state='active',keva_id='4242'; UPDATE payment_orders SET entitlement_id=NULL; UPDATE sales_receipts SET subscription_id=NULL,valid_from=NULL; DELETE FROM subscriptions;");
    const charge = { MosadNumber: "7019554", TransactionId: "81", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    expect((await hook(charge)).status).toBe(200);
    expect((await hook(charge)).status).toBe(200);
    expect(await new SubscriptionStore(env.DB).get(o.id)).toMatchObject({ period_number: 2, price_agorot: 5900 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(2);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE subscription_id=?").get(o.id)?.n).toBe(2);
  });
  it("charges a mastery track in installments with the price fixed server-side and the validation key never returned", async () => {
    expect((await req("/v1/portal/checkout", { package_id: "school-mastery" })).status).toBe(422);
    expect((await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "unknown" })).status).toBe(422);
    const r = await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "travel" });
    const o = await r.json() as any;
    expect(r.status).toBe(200);
    expect(JSON.stringify(o)).not.toContain("valid12345");
    expect(o).toMatchObject({ amount_ils: 1490, installments: 12, subscription: null, steps: [{ kind: "charge" }] });
    expect(o.iframe_url).toContain("MaxPayments=12");
    expect(calls[0]).toMatchObject({ PaymentType: "Ragil", Amount: "1490", Tashlumim: "12", Groupe: "dibura-" + o.id, ApiValid: "valid12345" });
    const again = await (await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "travel" })).json() as any;
    expect(again.id).toBe(o.id);
    expect(((await (await req("/v1/portal/checkout", { package_id: "school-mastery", domain: "business" })).json()) as any).id).toBe(o.id);
    const paid = { MosadNumber: "7019554", TransactionId: "9001", Confirmation: "77", Amount: "1490", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" };
    expect((await hook({ ...paid, Amount: "1" })).status).toBe(400);
    expect((await hook(paid)).status).toBe(200);
    expect((await hook(paid)).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n, MAX(minutes) m FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 1, m: 300 });
    expect((await (await req("/v1/portal/checkout/" + o.id)).json() as any).state).toBe("paid");
    const store = new SubscriptionStore(env.DB);
    const sub = await store.get(o.id);
    expect(sub).toMatchObject({ term_months: 12, monthly_minutes: 300, period_number: 1, price_agorot: 149000 });
    expect(JSON.parse(sub.domains_json)).toContainEqual({ domain: "business" });
    expect(db.sql.prepare("SELECT entitlement_id FROM payment_orders WHERE id=?").get(o.id)?.entitlement_id).toBe(sub.id);
    await store.tick(addMonths(sub.started_at, 1));
    await store.tick(addMonths(sub.started_at, 1));
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 2 });
    await store.tick(addMonths(sub.started_at, 11));
    await store.tick(addMonths(sub.started_at, 11));
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 12 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM installment_grants").get()).toMatchObject({ n: 0 });
  });

  it("opens a monthly plan: first month now, standing order verified with Nedarim, monthly charges renew once each", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any;
    expect(o).toMatchObject({ amount_ils: 119, subscription: { state: "pending", monthly_ils: 119 } });
    expect(o.steps.map((s: any) => s.kind)).toEqual(["charge", "keva"]);
    const first = { MosadNumber: "7019554", TransactionId: "1", Confirmation: "5", Amount: "119", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" };
    expect((await hook({ ...first, Amount: "29" })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscriptions").get()?.n).toBe(0);
    expect((await hook(first)).status).toBe(200);
    expect((await hook(first)).status).toBe(200);
    const store = new SubscriptionStore(env.DB);
    expect(await store.get(o.id)).toMatchObject({ price_agorot: 11900, status: "active", period_number: 1 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT amount_ils FROM sales_receipts").get()?.amount_ils).toBe(119);
    expect(db.sql.prepare("SELECT entitlement_id FROM standing_orders").get()?.entitlement_id).toBe(o.id);
    expect((await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any)).toMatchObject({ id: o.id, steps: [{ kind: "keva" }] });
    expect((await req("/v1/portal/subscriptions/" + o.subscription.id + "/cancel", {})).status).toBe(409);
    expect(calls[1]).toMatchObject({ PaymentType: "HK", Amount: "119", Tashlumim: "", Groupe: "dibura-" + o.subscription.id, ...standingOrderStart() });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-other", KevaAmount: "119", KevaNextDate: "01/01/2027" };
    expect((await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).status).toBe(409);
    keva.KevaGroupe = "dibura-" + o.subscription.id;
    const confirmed = await (await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).json() as any;
    expect(confirmed.subscription).toMatchObject({ state: "active", next_date: "01/01/2027" });
    await hook({ MosadNumber: "7019554", TransactionId: "1", Confirmation: "5", Amount: "119", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" });
    const month = { MosadNumber: "7019554", TransactionId: "2", Confirmation: "6", Amount: "119", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    expect((await hook(month)).status).toBe(200);
    expect((await hook(month)).status).toBe(200);
    expect((await hook({ ...month, TransactionId: "3", Currency: "2" })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 2 });
    expect(await store.get(o.id)).toMatchObject({ period_number: 2 });
    expect((await store.summary("c1"))[0]).toMatchObject({ rollover_minutes: 200 });
    expect(db.sql.prepare("SELECT reference FROM subscription_renewals").get()?.reference).toBe("nedarim-keva:4242:2");
    expect(db.sql.prepare("SELECT amount_ils FROM sales_receipts ORDER BY valid_from DESC LIMIT 1").get()?.amount_ils).toBe(119);
    expect(db.sql.prepare("SELECT next_date FROM standing_orders").get()?.next_date).toBe(standingOrderStart().StartFrom);
    vi.setSystemTime(new Date("2026-02-02T00:00:00Z"));
    const refusal = { MosadNumber: "7019554", Status: "Error", Source: "Keva", KevaId: "4242", ErrorTime: "01/02/2026 10:00:00", Message: "סירוב" };
    await hook(refusal);
    await hook(refusal);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_refusal'").get()).toMatchObject({ n: 1 });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toMatchObject({ state: "past_due" });
    expect((await store.get(o.id)).status).toBe("past_due");
    expect((await req("/v1/portal/subscriptions/" + o.subscription.id + "/cancel", {})).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ Action: "DeleteKeva", KevaId: "4242" });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toMatchObject({ state: "cancelled" });
    expect((await store.get(o.id)).status).toBe("cancelled");
    expect((await hook({ ...month, TransactionId: "999" })).status).toBe(400);
  });

  it("records charges during a pause, shifts future availability on resume and validates the family renewal amount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    expect((await hook({ MosadNumber: "7019554", TransactionId: "10", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id })).status).toBe(200);
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    expect((await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).status).toBe(200);
    const store = new SubscriptionStore(env.DB, env);
    await store.addMember(o.id, "0502223333", "Family");
    const charge = { MosadNumber: "7019554", TransactionId: "11", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    expect((await hook({ ...charge, Currency: "2" })).status).toBe(400);
    expect((await store.get(o.id)).period_number).toBe(1);
    vi.setSystemTime(new Date("2026-01-30T00:00:00Z"));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/pause", { days: 7 })).status).toBe(200);
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    expect((await hook(charge)).status).toBe(200);
    expect((await hook(charge)).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='subscription_amount_difference'").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT message FROM payment_issues WHERE kind='subscription_amount_difference'").get()?.message).toContain("39");
    expect(await store.get(o.id)).toMatchObject({ status: "paused", period_number: 2 });
    vi.setSystemTime(new Date("2026-02-06T00:00:00Z"));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/resume", {})).status).toBe(200);
    expect(await store.get(o.id)).toMatchObject({ status: "active", current_period_start: "2026-02-08T00:00:00.000+00:00", current_period_end: "2026-03-08T00:00:00.000+00:00", pause_days_used: 7 });
    expect(db.sql.prepare("SELECT valid_from FROM sales_receipts ORDER BY valid_from DESC LIMIT 1").get()?.valid_from).toBe("2026-02-08T00:00:00.000+00:00");
    expect((await store.summary("c1"))[0].rollover_minutes).toBe(60);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(2);
    const member = db.sql.prepare("SELECT customer_id FROM subscription_members").get()?.customer_id as string;
    await store.removeMember(o.id, member);
    expect((await hook(charge)).status).toBe(200);
    expect((await hook({ ...charge, TransactionId: "12", Currency: "2" })).status).toBe(400);
    const request = new Request("https://speakcall.app/v1/admin/business/subscriptions/" + o.id + "/cancel", { method: "POST", headers: { Authorization: "Bearer a" }, body: "{}" });
    expect((await worker.fetch(request, env)).status).toBe(200);
    expect((await store.get(o.id)).status).toBe("cancelled");
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()?.state).toBe("cancelled");
    expect(calls.at(-1)).toMatchObject({ Action: "DeleteKeva", KevaId: "4242" });
  });

  it("keeps a refused paused subscription frozen and resumes it as past due", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "20", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" });
    await req("/v1/portal/subscriptions/" + o.id + "/pause", { days: 7 });
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    expect((await hook({ MosadNumber: "7019554", Status: "Error", KevaId: "4242", ErrorTime: "01/01/2026 10:00:00", Message: "refused" })).status).toBe(200);
    const store = new SubscriptionStore(env.DB);
    expect(await store.get(o.id)).toMatchObject({ status: "paused", resume_status: "past_due" });
    await req("/v1/portal/subscriptions/" + o.id + "/resume", {});
    expect((await store.get(o.id)).status).toBe("past_due");
    expect((await hook({ MosadNumber: "7019554", TransactionId: "21", Confirmation: "6", Amount: "59", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242", TransactionTime: "01/01/2026 11:00:00" })).status).toBe(200);
    expect((await store.get(o.id)).status).toBe("active");
  });

  it("rolls back the subscription and first grant when a provider transaction belongs to another order", async () => {
    const a = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    const c = await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any;
    const payment = { MosadNumber: "7019554", TransactionId: "50", Confirmation: "5", Amount: "59", Currency: "1" };
    expect((await hook({ ...payment, Groupe: "dibura-" + a.id })).status).toBe(200);
    expect((await hook({ ...payment, Amount: "119", Groupe: "dibura-" + c.id })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscriptions").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts").get()?.n).toBe(1);
    expect(db.sql.prepare("SELECT state FROM payment_orders WHERE id=?").get(c.id)?.state).toBe("issued");
    expect((await hook({ ...payment, Amount: "119", TransactionId: "51", Groupe: "dibura-" + c.id })).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM subscriptions").get()?.n).toBe(2);
  });

  it("does not cancel either record when DeleteKeva fails", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await hook({ MosadNumber: "7019554", TransactionId: "60", Confirmation: "5", Amount: "59", Currency: "1", Groupe: "dibura-" + o.id });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-" + o.subscription.id, KevaAmount: "59" };
    await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ERROR")));
    expect((await req("/v1/portal/subscriptions/" + o.id + "/cancel", {})).status).toBe(502);
    expect((await new SubscriptionStore(env.DB).get(o.id)).status).toBe("active");
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()?.state).toBe("active");
  });

  it("is closed without the iframe validation key and refuses other customers' orders", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-step" })).json() as any;
    await b.save("customers", { name: "Other", phone: "0500000002", source: "test", preferred_bot: "", notes: "" }, "c2");
    token = (await b.portalInvite("c2")).token;
    expect((await req("/v1/portal/checkout/" + o.id)).status).toBe(404);
    delete env.NEDARIM_API_VALID;
    expect((await req("/v1/portal/checkout", { package_id: "school-step" })).status).toBe(503);
  });
});
