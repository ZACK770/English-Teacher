import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { type Env, sha256Hex } from "../src/env";
import { AttributionSchema, EventSchema, conversion } from "../src/analytics";
import worker from "../src/index";
import { attribution } from "./analytics-fixture";

let sql: DatabaseSync, env: Env;
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL("../migrations/" + file, import.meta.url), "utf8"));
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const statement = {
        bind: (...values: any[]) => { args = values; return statement; },
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({ results: sql.prepare(query).all(...args), success: true }),
        run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...args).changes) }, success: true }),
      };
      return statement;
    },
    async batch(statements: any[]) { return Promise.all(statements.map(s => s.all())); },
  };
  env = { DB: db, ADMIN_BEARER_SECRET: "analytics-admin-test" } as unknown as Env;
});
afterEach(() => { sql.close(); vi.useRealTimers(); });
const event = () => ({ event: "page_view", attribution, event_id: crypto.randomUUID() });
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => worker.fetch(new Request("https://speakool.net" + path, {
  method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env);

describe("analytics ingestion and funnel", () => {
  it("excludes QA conversions and their linked anonymous visitor from the funnel", async () => {
    const at = new Date().toISOString();
    sql.prepare("INSERT INTO customers(id,source,created_at,updated_at) VALUES ('qa','qa-test',?,?)").run(at, at);
    await request("/v1/public/events", event());
    await conversion(env, "purchase", attribution, "qa-receipt", "qa", 59);
    sql.prepare("INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES ('qa-order','qa-call','qa','p','{}',5900,0,'handoff',?,?)").run(at, at);
    await conversion(env, "begin_checkout", { ...attribution, visitor_id: "qa-order-visitor" }, "qa-order", undefined, undefined, "qa-order");
    const headers = { Authorization: "Bearer analytics-admin-test" };
    expect(await (await request("/v1/admin/analytics", undefined, headers)).json()).toMatchObject({ rows: [] });
    await conversion(env, "purchase", { ...attribution, visitor_id: "real-visitor" }, "real-receipt", "real", 100);
    expect(await (await request("/v1/admin/analytics", undefined, headers)).json()).toMatchObject({ rows: [expect.objectContaining({ visitors: 1, purchases: 1, revenue: 100 })] });
  });
  it("preserves real customer and order revenue on a browser also used by QA", async () => {
    const at = new Date().toISOString();
    sql.prepare("INSERT INTO customers(id,source,created_at,updated_at) VALUES ('qa','qa-test',?,?)").run(at, at);
    sql.prepare("INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES ('real-order','real-call','real','p','{}',10000,0,'paid',?,?)").run(at, at);
    await request("/v1/public/events", event());
    await conversion(env, "begin_checkout", attribution, "qa-checkout", "qa");
    await conversion(env, "purchase", attribution, "qa-receipt", "qa", 59);
    await conversion(env, "purchase", attribution, "real-receipt", "real", 100);
    await conversion(env, "purchase", attribution, "real-order-receipt", undefined, 100, "real-order");
    const result = await (await request("/v1/admin/analytics", undefined, { Authorization: "Bearer analytics-admin-test" })).json() as any;
    expect(result.rows).toEqual([expect.objectContaining({ visitors: 1, checkouts: 0, purchases: 2, revenue: 200 })]);
  });
  it("accepts a lead despite a failing analytics insert", async () => {
    sql.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(FAIL,'analytics unavailable'); END;");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request("/v1/public/callback", { name: "Test", phone: "0501234567", for_whom: "self", timing: "now", consent: true, attribution });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ ok: true });
      expect(sql.prepare("SELECT COUNT(*) AS n FROM callback_requests").get()?.n).toBe(1);
      expect(logged).toHaveBeenCalledWith("Analytics lead failed", expect.any(Error));
    } finally { logged.mockRestore(); }
  });
  it.each(["email", "phone"])("completes %s verification despite a failing analytics insert", async method => {
    const challenge = "1".repeat(48), code = "123456";
    const claim = { email: "test@example.com", phone: "0501234567", hash: await sha256Hex(challenge + ":" + code), attempts: 0, expires: Date.now() + 60000 };
    sql.prepare("INSERT INTO console_settings(id,body) VALUES (?,?)").run((method === "email" ? "portal-email:" : "portal-auth:") + challenge, JSON.stringify(claim));
    sql.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(FAIL,'analytics unavailable'); END;");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request("/v1/portal/auth/" + (method === "email" ? "email/" : "") + "verify", { challenge, code, attribution });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ token: expect.any(String), new_account: true });
      expect(sql.prepare("SELECT COUNT(*) AS n FROM portal_tokens").get()?.n).toBe(1);
      expect(logged).toHaveBeenCalledWith("Analytics signup failed", expect.any(Error));
    } finally { logged.mockRestore(); }
  });
  it.each(["page_view", "phone_click", "generate_lead", "sign_up", "begin_checkout", "purchase"])("accepts and persists allowlisted %s", async name => {
    expect((await request("/v1/public/events", { ...event(), event: name, value: 59, currency: "ILS" })).status).toBe(204);
    const row = sql.prepare("SELECT * FROM analytics_events").get()!;
    expect(row).toMatchObject({ event: name, origin: "client", visitor_id: attribution.visitor_id, session_id: attribution.session_id, path: "/learn", value: 59, currency: "ILS", customer_id: null });
    expect(JSON.parse(String(row.first_touch))).toEqual(attribution.first_touch);
    expect(JSON.parse(String(row.last_touch))).toEqual(attribution.last_touch);
  });
  it.each([{}, { event: "unknown" }, { value: -1 }, { value: 1000001 }, { currency: "USD" }, { customer_id: "spoofed" }, { meta: { email: "private@example.com" } }, { attribution: { ...attribution, path: "/learn?token=secret" } }, { attribution: { ...attribution, visitor_id: "" } }])("rejects invalid events %j", async change => {
    const body = Object.keys(change).length ? { ...event(), ...change } : {};
    expect((await request("/v1/public/events", body)).status).toBe(422);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM analytics_events").get()?.n).toBe(0);
  });
  it("rejects oversized bodies, malformed JSON, and cross-origin requests", async () => {
    expect((await request("/v1/public/events", { data: "x".repeat(12001) })).status).toBe(413);
    expect((await worker.fetch(new Request("https://speakool.net/v1/public/events", { method: "POST", body: "{" }), env)).status).toBe(422);
    expect((await request("/v1/public/events", event(), { Origin: "https://other.example" })).status).toBe(403);
  });
  it("deduplicates event ids and rate limits by IP/minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const body = event();
    for (let i = 0; i < 120; i++) expect((await request("/v1/public/events", body)).status).toBe(204);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM analytics_events").get()?.n).toBe(1);
    expect((await request("/v1/public/events", event())).status).toBe(429);
    expect((await request("/v1/public/events", event(), { "CF-Connecting-IP": "192.0.2.1" })).status).toBe(204);
  });
  it("serves empty optional configuration and validates configured IDs", async () => {
    expect(await (await request("/v1/public/analytics-config")).json()).toEqual({ ga_measurement_id: "", cf_beacon_token: "" });
    env.GA_MEASUREMENT_ID = "G-TEST123"; env.CF_BEACON_TOKEN = "a".repeat(32);
    expect(await (await request("/v1/public/analytics-config")).json()).toEqual({ ga_measurement_id: "G-TEST123", cf_beacon_token: "a".repeat(32) });
    env.GA_MEASUREMENT_ID = '<script>';
    expect(await (await request("/v1/public/analytics-config")).json()).toMatchObject({ ga_measurement_id: "" });
  });
  it("authenticates summaries, validates dates and returns an empty range", async () => {
    expect((await request("/v1/admin/analytics")).status).toBe(401);
    const headers = { Authorization: "Bearer analytics-admin-test" };
    for (const query of ["start=bad", "start=2026-02-30", "start=2026-11-20&end=2026-11-01", "start=2020-01-01&end=2026-01-01"]) expect((await request("/v1/admin/analytics?" + query, undefined, headers)).status).toBe(422);
    expect(await (await request("/v1/admin/analytics", undefined, headers)).json()).toMatchObject({ rows: [] });
  });
  it("groups by first touch and only counts authoritative conversions once", async () => {
    await request("/v1/public/events", event());
    await request("/v1/public/events", { ...event(), event: "purchase", value: 999, currency: "ILS" });
    for (const [name, ref] of [["generate_lead", "lead1"], ["sign_up", "customer1"], ["begin_checkout", "order1"], ["purchase", "receipt1"]]) {
      await conversion(env, name, attribution, ref, "customer1", name === "purchase" ? 59 : undefined);
      await conversion(env, name, attribution, ref, "customer1", name === "purchase" ? 59 : undefined);
    }
    const result = await (await request("/v1/admin/analytics", undefined, { Authorization: "Bearer analytics-admin-test" })).json() as any;
    expect(result.rows).toEqual([expect.objectContaining({ utm_source: "capsule", utm_campaign: "capsule1", visitors: 1, leads: 1, signups: 1, checkouts: 1, purchases: 1, revenue: 59, purchase_rate: 1 })]);
    expect(await (await request("/v1/admin/analytics?start=2020-01-01&end=2020-01-02", undefined, { Authorization: "Bearer analytics-admin-test" })).json()).toMatchObject({ rows: [] });
  });
  it("stores an attributed callback lead only for a new request", async () => {
    const input = { name: "Test", phone: "0501234567", for_whom: "self", timing: "now", consent: true, attribution };
    const response = await request("/v1/public/callback", input);
    expect(response.status).toBe(201);
    const lead = await response.json() as any;
    expect(await (await request("/v1/public/callback", input)).json()).toMatchObject({ duplicate: true });
    expect(sql.prepare("SELECT event,reference FROM analytics_events").all()).toEqual([{ event: "generate_lead", reference: lead.id }]);
  });
  it.each(["email", "phone"])("records %s signup on new account verification, not returning login", async method => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const challenge = String(attempt + 1).repeat(48), code = "123456";
      const claim = { email: "test@example.com", phone: "0501234567", hash: await sha256Hex(challenge + ":" + code), attempts: 0, expires: Date.now() + 60000 };
      sql.prepare("INSERT INTO console_settings(id,body) VALUES (?,?)").run((method === "email" ? "portal-email:" : "portal-auth:") + challenge, JSON.stringify(claim));
      const response = await request("/v1/portal/auth/" + (method === "email" ? "email/" : "") + "verify", { challenge, code, attribution });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ new_account: attempt === 0 });
    }
    expect(sql.prepare("SELECT event,customer_id FROM analytics_events").all()).toEqual([{ event: "sign_up", customer_id: expect.any(String) }]);
  });
  it("rejects malformed attribution and ignores missing optional attribution for older clients", async () => {
    expect(AttributionSchema.safeParse({}).success).toBe(false);
    expect(EventSchema.safeParse({ ...event(), value: Infinity }).success).toBe(false);
    await conversion(env, "sign_up", undefined, "old-client");
    expect(sql.prepare("SELECT COUNT(*) AS n FROM analytics_events").get()?.n).toBe(0);
  });
});
