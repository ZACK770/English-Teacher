import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { BusinessStore } from "../src/business";
import { type Env } from "../src/env";
import worker from "../src/index";
import { CheckoutStore, standingOrderStart } from "../src/checkout";

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
    if (form.Action === "DeleteKeva") return new Response("OK");
    return Response.json({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); db.sql.close(); });

describe("website checkout", () => {
  it("charges a mastery track in installments with the price fixed server-side and the validation key never returned", async () => {
    const r = await req("/v1/portal/checkout", { package_id: "school-mastery" });
    const o = await r.json() as any;
    expect(r.status).toBe(200);
    expect(JSON.stringify(o)).not.toContain("valid12345");
    expect(o).toMatchObject({ amount_ils: 1490, installments: 12, subscription: null, steps: [{ kind: "charge" }] });
    expect(o.iframe_url).toContain("MaxPayments=12");
    expect(calls[0]).toMatchObject({ PaymentType: "Ragil", Amount: "1490", Tashlumim: "12", Groupe: "dibura-" + o.id, ApiValid: "valid12345" });
    const again = await (await req("/v1/portal/checkout", { package_id: "school-mastery" })).json() as any;
    expect(again.id).toBe(o.id);
    const paid = { MosadNumber: "7019554", TransactionId: "9001", Confirmation: "77", Amount: "1490", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" };
    expect((await hook({ ...paid, Amount: "1" })).status).toBe(400);
    expect((await hook(paid)).status).toBe(200);
    expect((await hook(paid)).status).toBe(200);
    expect(db.sql.prepare("SELECT COUNT(*) n, MAX(minutes) m FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 1, m: 300 });
    expect((await (await req("/v1/portal/checkout/" + o.id)).json() as any).state).toBe("paid");
    const store = new CheckoutStore(b);
    expect(await store.issueDueGrants()).toBe(0);
    await store.issueDueGrants(Date.now() + 31 * 86400_000);
    await store.issueDueGrants(Date.now() + 31 * 86400_000);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 2 });
    expect(db.sql.prepare("SELECT COUNT(*) n FROM installment_grants").get()).toMatchObject({ n: 11 });
  });

  it("opens a monthly plan: first month now, standing order verified with Nedarim, monthly charges renew once each", async () => {
    const o = await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any;
    expect(o).toMatchObject({ amount_ils: 29, subscription: { state: "pending", monthly_ils: 119 } });
    expect(o.steps.map((s: any) => s.kind)).toEqual(["charge", "keva"]);
    await hook({ MosadNumber: "7019554", TransactionId: "1", Confirmation: "5", Amount: "29", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" });
    expect((await (await req("/v1/portal/checkout", { package_id: "school-pace" })).json() as any)).toMatchObject({ id: o.id, steps: [{ kind: "keva" }] });
    expect((await req("/v1/portal/subscriptions/" + o.subscription.id + "/cancel", {})).status).toBe(409);
    expect(calls[1]).toMatchObject({ PaymentType: "HK", Amount: "119", Tashlumim: "", Groupe: "dibura-" + o.subscription.id, ...standingOrderStart() });
    keva = { KevaId: "4242", KevaStatus: "1", KevaGroupe: "dibura-other", KevaAmount: "119", KevaNextDate: "01/01/2027" };
    expect((await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).status).toBe(409);
    keva.KevaGroupe = "dibura-" + o.subscription.id;
    const confirmed = await (await req("/v1/portal/checkout/" + o.id + "/keva", { keva_id: "4242" })).json() as any;
    expect(confirmed.subscription).toMatchObject({ state: "active", next_date: "01/01/2027" });
    await hook({ MosadNumber: "7019554", TransactionId: "1", Confirmation: "5", Amount: "29", Currency: "1", Groupe: "dibura-" + o.id, KevaId: "" });
    const month = { MosadNumber: "7019554", TransactionId: "2", Confirmation: "6", Amount: "119", Currency: "1", Groupe: "dibura-" + o.subscription.id, KevaId: "4242" };
    expect((await hook(month)).status).toBe(200);
    expect((await hook(month)).status).toBe(200);
    expect((await hook({ ...month, TransactionId: "3", Amount: "1" })).status).toBe(400);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM sales_receipts WHERE customer_id='c1'").get()).toMatchObject({ n: 2 });
    expect(db.sql.prepare("SELECT next_date FROM standing_orders").get()?.next_date).toBe(standingOrderStart().StartFrom);
    const refusal = { MosadNumber: "7019554", Status: "Error", Source: "Keva", KevaId: "4242", Message: "סירוב" };
    await hook(refusal);
    await hook(refusal);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM payment_issues WHERE kind='keva_refusal'").get()).toMatchObject({ n: 1 });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toMatchObject({ state: "past_due" });
    expect((await req("/v1/portal/subscriptions/" + o.subscription.id + "/cancel", {})).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ Action: "DeleteKeva", KevaId: "4242" });
    expect(db.sql.prepare("SELECT state FROM standing_orders").get()).toMatchObject({ state: "cancelled" });
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
