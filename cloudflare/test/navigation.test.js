import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { customerPosition, GPS_MAX_AGE_MS } from "../src/navigation";
import { BusinessStore } from "../src/business";

const NOW = Date.parse("2026-11-10T14:10:00Z");
const SECRET = "test-forward-token-with-at-least-32-characters";
const ADMIN = "test-admin-token-with-at-least-32-characters";
let sql;
let env;

function statement(query) {
  let params = [];
  const s = {
    bind(...values) { params = values; return s; },
    async first() { return sql.prepare(query).get(...params) ?? null; },
    async all() { return { results: sql.prepare(query).all(...params) }; },
    async run() { return { success: true, meta: { changes: Number(sql.prepare(query).run(...params).changes) } }; },
  };
  return s;
}

function payload(overrides = {}, device = {}) {
  return {
    device: { id: 1, uniqueId: "test-device", ...device },
    position: { id: 10, deviceId: 1, valid: true, fixTime: new Date(NOW - 5_000).toISOString(),
      latitude: 32, longitude: 34, speed: 20, course: 90, accuracy: 0, ...overrides },
  };
}

async function call(path, data, token = ADMIN, method = data === undefined ? "GET" : "POST") {
  return worker.fetch(new Request("https://example.test" + path, { method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), env);
}
const send = (data = payload(), secret = SECRET) => call("/v1/navigation/positions", data, secret);
const position = () => call("/v1/admin/navigation/devices/test-device/position").then((r) => r.json());
const stored = () => sql.prepare("SELECT * FROM navigation_positions").all();

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0001_init.sql", "0002_callback_requests.sql", "0003_navigation_gps.sql", "0004_navigation_console.sql", "0006_navigation_call_costs.sql", "0007_platform.sql"]) {
    sql.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  }
  sql.prepare("INSERT INTO navigation_devices(device_id,traccar_device_id,label,created_at) VALUES(?,?,?,?)")
    .run("test-device", 1, "Test car", new Date().toISOString());
  env = { DB: { prepare: statement, async batch(statements) {
    sql.exec("BEGIN");
    try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec("COMMIT"); return results; }
    catch (error) { sql.exec("ROLLBACK"); throw error; }
  } }, ADMIN_BEARER_SECRET: ADMIN, TRACCAR_FORWARD_SECRET: SECRET };
});
afterEach(() => { sql.close(); vi.useRealTimers(); });

describe("GPS ingestion boundary", () => {
  it("fails closed without configuration or with a weak secret", async () => {
    for (const value of [undefined, "short"]) {
      env.TRACCAR_FORWARD_SECRET = value;
      expect((await send()).status).toBe(503);
    }
    expect(stored()).toHaveLength(0);
  });
  it("does not accept the admin token at the webhook", async () => {
    expect((await send(payload(), ADMIN)).status).toBe(401);
    expect(stored()).toHaveLength(0);
  });
  it("does not accept the forwarding token at private read endpoints", async () => {
    expect((await call("/v1/admin/navigation/devices/test-device/position", undefined, SECRET)).status).toBe(401);
  });
  it("only accepts POST and JSON", async () => {
    expect((await call("/v1/navigation/positions", undefined, SECRET)).status).toBe(405);
    const response = await worker.fetch(new Request("https://example.test/v1/navigation/positions", {
      method: "POST", headers: { Authorization: "Bearer " + SECRET, "Content-Type": "text/plain" }, body: "{}",
    }), env);
    expect(response.status).toBe(415);
  });
  it("rejects malformed and oversized bodies without storing anything", async () => {
    for (const [body, status] of [["{", 422], [JSON.stringify({ padding: "x".repeat(33_000) }), 413]]) {
      const response = await worker.fetch(new Request("https://example.test/v1/navigation/positions", {
        method: "POST", headers: { Authorization: "Bearer " + SECRET, "Content-Type": "application/json" }, body,
      }), env);
      expect(response.status).toBe(status);
    }
    expect(stored()).toHaveLength(0);
  });
  it("checks registration and both device identifiers", async () => {
    expect((await send(payload({}, { uniqueId: "another-device" }))).status).toBe(403);
    expect((await send(payload({}, { id: 2 }))).status).toBe(422);
    expect((await send(payload({ deviceId: 2 }, { id: 2 }))).status).toBe(403);
    sql.exec("UPDATE navigation_devices SET enabled=0");
    expect((await send()).status).toBe(403);
    expect(stored()).toHaveLength(0);
  });
  it.each([
    { latitude: 91 }, { longitude: -181 }, { speed: -1 }, { valid: "true" },
    { fixTime: "yesterday" }, { fixTime: "2026-11-10T14:09:55" }, { id: -1 }, { course: 361 }, { accuracy: -1 },
  ])("validates coordinates, units and timestamps: %j", async (bad) => {
    expect((await send(payload(bad))).status).toBe(422);
    expect(stored()).toHaveLength(0);
  });
});

describe("latest safe GPS fix", () => {
  it("accepts pre-database Traccar positions with ID zero, deduplicating by fix time", async () => {
    expect((await (await send(payload({ id: 0 }))).json()).accepted).toBe(true);
    expect((await (await send(payload({ id: 0 }))).json()).accepted).toBe(false);
    await send(payload({ id: 0, fixTime: new Date(NOW - 1_000).toISOString() }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].fix_at_ms).toBe(NOW - 1_000);
  });
  it("accepts Traccar JSON, converts knots and keeps zero accuracy as unknown", async () => {
    const response = await send();
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await position();
    expect(data.fresh).toBe(true);
    expect(data.position.speed_mps).toBeCloseTo(20 * 1852 / 3600);
    expect(data.position.heading).toBe(90);
    expect(data.position.accuracy_m).toBeNull();
  });
  it("does not manufacture a heading for a stationary vehicle", async () => {
    await send(payload({ speed: 0, course: 220 }));
    expect((await position()).position.heading).toBeNull();
  });
  it.each([
    [{ valid: false }, "invalid_fix"],
    [{ fixTime: new Date(NOW - GPS_MAX_AGE_MS - 1).toISOString() }, "stale_fix"],
    [{ fixTime: new Date(NOW + 30_001).toISOString() }, "future_fix"],
    [{ accuracy: 101 }, "inaccurate_fix"],
  ])("acknowledges but does not navigate on unusable fixes: %j", async (bad, reason) => {
    const response = await send(payload(bad));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: false, reason });
    expect(stored()).toHaveLength(0);
    expect((await position()).fresh).toBe(false);
  });
  it("drops duplicates and older messages without overwriting or accumulating history", async () => {
    await send();
    expect((await (await send()).json()).reason).toBe("duplicate_or_out_of_order");
    await send(payload({ id: 9, latitude: 33, fixTime: new Date(NOW - 10_000).toISOString() }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].latitude).toBe(32);
    await send(payload({ id: 11, latitude: 33, fixTime: new Date(NOW - 1_000).toISOString() }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].latitude).toBe(33);
  });
  it("does not let an older valid packet override a newer invalid report", async () => {
    await send();
    await send(payload({ id: 12, valid: false, fixTime: new Date(NOW - 1_000).toISOString() }));
    const response = await send(payload({ id: 11, fixTime: new Date(NOW - 2_000).toISOString() }));
    expect((await response.json()).accepted).toBe(false);
    expect((await position()).position).toBeNull();
    expect(stored()[0].source_position_id).toBe(10);
  });
  it("ignores future clock poisoning and recovers with a real fix", async () => {
    await send(payload({ fixTime: new Date(NOW + 86_400_000).toISOString() }));
    await send();
    expect((await position()).fresh).toBe(true);
  });
  it("does not let an old invalid report erase a newer good report", async () => {
    await send();
    await send(payload({ valid: false, fixTime: new Date(NOW - 60_000).toISOString() }));
    expect((await position()).fresh).toBe(true);
  });
  it("hides coordinates when GPS goes stale or a device is disabled", async () => {
    await send();
    vi.setSystemTime(NOW + GPS_MAX_AGE_MS);
    expect((await position()).position).toBeNull();
    vi.setSystemTime(NOW);
    sql.exec("UPDATE navigation_devices SET enabled=0");
    expect((await position()).position).toBeNull();
  });
});

describe("private device management and customer isolation", () => {
  it("lists real customer phone assignments, and supports removing a mapping", async () => {
    const business = new BusinessStore(env.DB);
    await business.save("customers", { name: "Driver", phone: "0500000000" }, "customer-a");
    await call("/v1/admin/navigation/assignments", { customer_id: "customer-a", device_id: "test-device" });
    const customers = await (await call("/v1/admin/navigation/customers")).json();
    expect(customers).toEqual([{ customer_id: "customer-a", phone: "0500000000", name: "Driver", device_id: "test-device" }]);
    await call("/v1/admin/navigation/assignments", { customer_id: "customer-a" }, ADMIN, "DELETE");
    expect(await customerPosition(env, "customer-a")).toBeNull();
  });
  it("keeps customer destinations separate and prevents cross-customer deletion", async () => {
    sql.exec("INSERT INTO customer_phones VALUES('0500000000','customer-a'),('0500000001','customer-b')");
    const base = "/v1/admin/navigation/customers/";
    const a = base + "customer-a/destinations";
    const b = base + "customer-b/destinations";
    expect((await call(base + "missing/destinations")).status).toBe(404);
    const response = await call(a, { label: "Home", address: "Test street, Test city" });
    expect(response.status).toBe(201);
    const destination = await response.json();
    expect(await (await call(a)).json()).toHaveLength(1);
    expect(await (await call(b)).json()).toEqual([]);
    expect((await call(b + "/" + destination.id, undefined, ADMIN, "DELETE")).status).toBe(404);
    expect((await call(a + "/" + destination.id, undefined, ADMIN, "DELETE")).status).toBe(200);
    expect(await (await call(a)).json()).toEqual([]);
  });
  it("requires authentication for all console data and validates destination payloads", async () => {
    sql.exec("INSERT INTO customer_phones VALUES('0500000000','customer-a')");
    const path = "/v1/admin/navigation/customers/customer-a/destinations";
    for (const p of ["/v1/admin/navigation/customers", path]) {
      expect((await call(p, undefined, "")).status).toBe(401);
      expect((await call(p, undefined, SECRET)).status).toBe(401);
    }
    expect((await call(path, { label: " ", address: "x" })).status).toBe(422);
    const response = await call(path);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("serves a protected console shell without embedding GPS or credentials", async () => {
    env.ASSETS = { fetch: async () => new Response('<html><title>School</title><link href="https://fonts.googleapis.com/font"><div id="root"></div></html>') };
    const response = await call("/navigation");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain('fonts.googleapis');
    expect(html).toContain('וייז כשר');
    expect((await call('/navigation', {}, ADMIN)).status).toBe(405);
  });
  it("can register and disable devices, but rejects identifier reassignment", async () => {
    const path = "/v1/admin/navigation/devices";
    expect((await call(path, { device_id: "second", traccar_device_id: 2, label: "Second car" })).status).toBe(200);
    expect((await call(path, { device_id: "third", traccar_device_id: 2, label: "Third car" })).status).toBe(409);
    expect((await call(path, { device_id: "second", traccar_device_id: 3, label: "Changed" })).status).toBe(409);
    await call(path, { device_id: "test-device", traccar_device_id: 1, label: "Disabled", enabled: false });
    expect((await send()).status).toBe(403);
  });
  it("requires a known customer and only returns their assigned location", async () => {
    const path = "/v1/admin/navigation/assignments";
    expect((await call(path, { customer_id: "missing", device_id: "test-device" })).status).toBe(404);
    sql.exec("INSERT INTO customer_phones VALUES('0500000000','customer-a'),('0500000001','customer-b')");
    expect((await call(path, { customer_id: "customer-a", device_id: "test-device" })).status).toBe(200);
    await send();
    expect((await customerPosition(env, "customer-a")).fresh).toBe(true);
    expect(await customerPosition(env, "customer-b")).toBeNull();
  });
  it("preserves assignments when the existing customer console edits a phone", async () => {
    const business = new BusinessStore(env.DB);
    await business.save("customers", { name: "Test", phone: "0500000000" }, "customer-a");
    await call("/v1/admin/navigation/assignments", { customer_id: "customer-a", device_id: "test-device" });
    await business.save("customers", { name: "Updated", phone: "0500000001" }, "customer-a");
    expect(sql.prepare("SELECT phone FROM customer_phones WHERE customer_id='customer-a'").get().phone).toBe("0500000001");
    expect(sql.prepare("SELECT device_id FROM navigation_assignments WHERE customer_id='customer-a'").get().device_id).toBe("test-device");
  });
  it("leaves health and unauthenticated teacher endpoints unchanged", async () => {
    expect(await (await call("/healthz", undefined, "")).json()).toEqual({ status: "ok", service: "english-engine" });
    expect((await call("/v1/technoline/stream", undefined, "")).status).toBe(426);
    expect((await call("/v1/admin/navigation/devices", undefined, "")).status).toBe(401);
  });
});

describe("reported battery status", () => {
  it("does not invent a battery percentage when the tracker does not report one", async () => {
    await send();
    expect((await position()).battery).toEqual({ level_percent: null, reported_at_ms: null, charging: null });
  });
  it("accepts explicit percentages including zero and reports the measurement time", async () => {
    await send(payload({ attributes: { batteryLevel: 0, charge: true } }));
    expect((await position()).battery).toEqual({ level_percent: 0, reported_at_ms: NOW - 5000, charging: true });
  });
  it("does not mistake voltage or invalid values for a percentage", async () => {
    for (const [i, batteryLevel] of [-1, 101, "80", null].entries()) {
      await send(payload({ fixTime: new Date(NOW - 4000 + i * 1000).toISOString(), attributes: { batteryLevel, battery: 4.2 } }));
      expect((await position()).battery.level_percent).toBeNull();
    }
    expect((await position()).fresh).toBe(true);
  });
  it("does not let an old battery report overwrite the latest report", async () => {
    await send(payload({ attributes: { batteryLevel: 70 } }));
    await send(payload({ fixTime: new Date(NOW - 60_000).toISOString(), attributes: { batteryLevel: 95 } }));
    expect((await position()).battery.level_percent).toBe(70);
    await send(payload({ fixTime: new Date(NOW - 1000).toISOString() }));
    expect((await position()).battery.level_percent).toBeNull();
  });
});

describe("SinoTrack H02 battery", () => {
  it("reads the V8 battery field forwarded by Traccar as io8", async () => {
    await send(payload({ protocol: "h02", attributes: { io5: "9", io6: "26", io7: "38", io8: "80" } }));
    expect((await position()).battery.level_percent).toBe(80);
  });
  it("ignores io8 from other protocols or out of range", async () => {
    await send(payload({ protocol: "teltonika", attributes: { io8: "80" } }));
    expect((await position()).battery.level_percent).toBeNull();
    await send(payload({ fixTime: new Date(NOW - 1000).toISOString(), protocol: "h02", attributes: { io8: "180" } }));
    expect((await position()).battery.level_percent).toBeNull();
  });
});

describe("navigation call log", () => {
  it("lists calls without a prompt snapshot or transcript, newest first, with paging", async () => {
    const ins = (t, call, type) => sql.prepare("INSERT INTO diagnostic_events (created_at, profile_id, call_id, event_type, details_json) VALUES (?,?,?,?,?)")
      .run(t, "voice-navigator-live", call, type, JSON.stringify(type === "navigation_ended" ? { reason: "caller_disconnected" } : {}));
    ins("2026-11-10T19:20:16Z", "old-call", "navigation_connected");
    ins("2026-11-10T19:23:25Z", "old-call", "navigation_ended");
    ins("2026-11-11T11:49:01Z", "new-call", "navigation_connected");
    sql.prepare("INSERT INTO conversation_turns (created_at, profile_id, call_id, direction, text, metadata_json) VALUES (?,?,?,?,?,?)")
      .run("2026-11-11T11:49:09Z", "voice-navigator-live", "new-call", "driver", "לא לא.", "{}");
    ins("2026-11-11T12:00:00Z", "tutor-call", "navigation_connected");
    sql.prepare("UPDATE diagnostic_events SET profile_id='student' WHERE call_id='tutor-call'").run();
    const calls = await (await call("/v1/admin/navigation/calls?limit=1")).json();
    expect(calls.map((c) => c.call_id)).toEqual(["new-call"]);
    expect(calls[0].turns[0].text).toBe("לא לא.");
    expect(calls[0].cost).toBeNull();
    sql.prepare("INSERT INTO navigation_call_costs(call_id,profile_id,computed_at,summary_json) VALUES(?,?,?,?)")
      .run("new-call", "voice-navigator-live", new Date().toISOString(), JSON.stringify({ status: "partial", known_subtotal_ils: 0.1234 }));
    sql.prepare("INSERT INTO navigation_usage_events(call_id,profile_id,channel,model,reported_at,usage_json) VALUES(?,?,?,?,?,?)")
      .run("new-call", "voice-navigator-live", "main", "gemini-3.8-live", new Date().toISOString(), JSON.stringify({ promptTokenCount: 12 }));
    const priced = await (await call("/v1/admin/navigation/calls?limit=1")).json();
    expect(priced[0].cost).toEqual({ status: "partial", known_subtotal_ils: 0.1234 });
    expect(priced[0].reported_usage[0].usage).toEqual({ promptTokenCount: 12 });
    const older = await (await call("/v1/admin/navigation/calls?limit=5&offset=1")).json();
    expect(older.map((c) => c.call_id)).toEqual(["old-call"]);
    expect(older[0]).toMatchObject({ has_prompt: false, turns: [], setup_message: null });
    expect(older[0].events.at(-1).details).toEqual({ reason: "caller_disconnected" });
  });
});
