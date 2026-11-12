import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { CALL_LEASE_MS, NavigationTrips, SHORT_RECONNECT_MS } from "../src/navigation-trips";

const NOW = Date.parse("2026-11-10T15:00:00Z");
const ADMIN = "test-admin-token-with-at-least-32-characters";
const BASE = "/v1/admin/navigation/customers/";
const DESTINATION = { destination_label: "יעד בדיקה", destination_address: "כתובת בדיקה בלבד" };
let db;
let env;
let trips;

function prepare(query) {
  let values = [];
  const statement = {
    bind(...params) { values = params; return statement; },
    async first() { return db.prepare(query).get(...values) ?? null; },
    async all() { return { results: db.prepare(query).all(...values) }; },
    async run() { return { success: true, meta: { changes: Number(db.prepare(query).run(...values).changes) } }; },
  };
  return statement;
}
async function call(path, data, method = data === undefined ? "GET" : "POST", token = ADMIN) {
  return worker.fetch(new Request("https://example.test" + BASE + path, {
    method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env);
}
async function start(customer = "a", data = DESTINATION) {
  const r = await call(customer + "/trips", data);
  expect(r.status).toBe(201);
  return r.json();
}
const connect = (trip, call_id = "call-1", confirm = true) => call("a/trips/" + trip.id + "/connect", { call_id, confirm });
const disconnect = (trip, call_id = "call-1") => call("a/trips/" + trip.id + "/disconnect", { call_id });
const fresh = () => db.prepare("UPDATE navigation_positions SET fix_at_ms=?").run(Date.now());

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, dir), "utf8"));
  for (const [customer, device, traccar, phone] of [["a", "device-a", 1, "0500000001"], ["b", "device-b", 2, "0500000002"]]) {
    db.prepare("INSERT INTO customer_phones(phone,customer_id) VALUES(?,?)").run(phone, customer);
    db.prepare("INSERT INTO navigation_devices(device_id,traccar_device_id,label,created_at,last_report_valid) VALUES(?,?,?,?,1)")
      .run(device, traccar, "Test device", new Date().toISOString());
    db.prepare("INSERT INTO navigation_assignments(customer_id,device_id,updated_at) VALUES(?,?,?)").run(customer, device, new Date().toISOString());
    db.prepare("INSERT INTO navigation_positions(device_id,source_position_id,fix_at_ms,received_at_ms,latitude,longitude,speed_mps) VALUES(?,1,?,?,32,34,10)")
      .run(device, NOW, NOW);
  }
  env = { DB: { prepare }, ADMIN_BEARER_SECRET: ADMIN, TRACCAR_FORWARD_SECRET: "test-forward-token-with-at-least-32-characters" };
  trips = new NavigationTrips(env);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("persistent trip boundaries", () => {
  it("requires admin authorization, not the tracker forwarding credential", async () => {
    for (const token of ["", "wrong", env.TRACCAR_FORWARD_SECRET]) {
      expect((await call("a/trips", DESTINATION, "POST", token)).status).toBe(401);
      expect((await call("a/reconnect", { call_id: "call-1" }, "POST", token)).status).toBe(401);
    }
    expect(db.prepare("SELECT * FROM navigation_trips").all()).toHaveLength(0);
  });
  it("saves caller-owned destination text without coordinates or provider route data", async () => {
    const trip = await start();
    expect(trip).toMatchObject({ ...DESTINATION, customer_id: "a", device_id: "device-a", status: "active", revision: 0 });
    expect(trip).not.toHaveProperty("latitude");
    expect(trip).not.toHaveProperty("longitude");
    expect((await call("a/trips")).headers.get("Cache-Control")).toBe("no-store");
  });
  it("requires a known customer with an enabled assigned device", async () => {
    expect((await call("unknown/trips", DESTINATION)).status).toBe(404);
    db.prepare("DELETE FROM navigation_assignments WHERE customer_id='a'").run();
    expect((await call("a/trips", DESTINATION)).status).toBe(409);
    db.prepare("UPDATE navigation_devices SET enabled=0 WHERE device_id='device-b'").run();
    expect((await call("b/trips", DESTINATION)).status).toBe(409);
  });
  it("creates only one active trip even for simultaneous requests", async () => {
    const results = await Promise.all([call("a/trips", DESTINATION), call("a/trips", DESTINATION)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(db.prepare("SELECT * FROM navigation_trips WHERE customer_id='a'").all()).toHaveLength(1);
  });
  it("keeps customer trip reads and mutations isolated", async () => {
    const a = await start();
    const b = await start("b", { destination_label: "יעד נפרד", destination_address: "כתובת נפרדת" });
    for (const [suffix, body] of [["", undefined], ["/connect", { call_id: "call-2", confirm: true }], ["/disconnect", { call_id: "call-1" }], ["/heartbeat", { call_id: "call-1" }], ["/finish", { status: "completed" }]]) {
      expect((await call("b/trips/" + a.id + suffix, body)).status).toBe(404);
    }
    expect((await trips.current("b")).id).toBe(b.id);
    expect((await trips.current("a")).status).toBe("active");
  });
  it("does not create conflicting trips when two phones share a vehicle", async () => {
    await start();
    db.prepare("UPDATE navigation_assignments SET device_id='device-a' WHERE customer_id='b'").run();
    expect((await call("b/trips", DESTINATION)).status).toBe(409);
    expect(await trips.current("b")).toBeNull();
  });
  it("rejects empty, oversized, invalid, and provider-shaped destinations", async () => {
    for (const data of [{}, { ...DESTINATION, destination_label: " " }, { ...DESTINATION, destination_address: "x" },
      { ...DESTINATION, destination_address: "x".repeat(301) }, { ...DESTINATION, latitude: 32 }, { ...DESTINATION, route: {} },
      { ...DESTINATION, eta_at_ms: NOW }, { ...DESTINATION, eta_at_ms: NOW + 31 * 86400_000 }, { ...DESTINATION, eta_at_ms: 1.5 }]) {
      expect((await call("a/trips", data)).status).toBe(422);
    }
  });
  it("rejects malformed or oversized JSON and invalid HTTP methods", async () => {
    for (const [body, type, status] of [["{", "application/json", 422], [" ".repeat(32769), "application/json", 413], ["{}", "text/plain", 415]]) {
      const r = await worker.fetch(new Request("https://example.test" + BASE + "a/trips", {
        method: "POST", headers: { Authorization: "Bearer " + ADMIN, "Content-Type": type }, body,
      }), env);
      expect(r.status).toBe(status);
    }
    expect((await call("a/trips", undefined, "DELETE")).status).toBe(405);
    expect((await call("a/reconnect")).status).toBe(405);
    expect((await call("a/reconnect/extra", { call_id: "call-1" })).status).toBe(404);
  });
});

describe("reconnect state and lifecycle", () => {
  it("starts a clean conversation only when there is no active trip", async () => {
    expect(await trips.reconnect("a", "call-1")).toMatchObject({ action: "new_trip", reason: "no_active_trip", trip: null });
    const trip = await start();
    await trips.finish("a", trip.id, "completed");
    expect(await trips.reconnect("a", "call-2")).toMatchObject({ action: "new_trip", trip: null });
  });
  it("requires explicit confirmation on first connection", async () => {
    const trip = await start();
    const r = await connect(trip, "call-1", false);
    expect(await r.json()).toMatchObject({ action: "confirm", reason: "first_connection" });
    expect((await trips.get("a", trip.id)).last_call_id).toBeNull();
    expect(await (await connect(trip)).json()).toMatchObject({ action: "resume", trip: { last_call_id: "call-1" } });
  });
  it("automatically restores a short disconnection with fresh GPS and preserves the destination", async () => {
    const trip = await start("a", { ...DESTINATION, eta_at_ms: NOW + 3600_000 });
    await connect(trip); await disconnect(trip);
    vi.setSystemTime(NOW + 60_000); fresh();
    const r = await connect(trip, "call-2", false);
    expect(await r.json()).toMatchObject({ action: "resume", reason: "short_disconnect", trip: { ...DESTINATION, last_call_id: "call-2" } });
  });
  it("reconstructs state from D1 in a new store instance after restart", async () => {
    const trip = await start(); await connect(trip); await disconnect(trip);
    const restored = new NavigationTrips({ ...env });
    expect(await restored.reconnect("a", "call-2")).toMatchObject({ action: "resume", reason: "short_disconnect", trip: { id: trip.id, ...DESTINATION } });
  });
  it("makes reconnect checks read-only and duplicate connects idempotent", async () => {
    const trip = await start(); await connect(trip);
    const before = await trips.get("a", trip.id);
    await trips.reconnect("a", "call-1"); await connect(trip);
    expect(await trips.get("a", trip.id)).toEqual(before);
  });
  it("does not permit another call to take over, including with confirmation", async () => {
    const trip = await start(); await connect(trip);
    expect(await (await connect(trip, "call-2", true)).json()).toMatchObject({ action: "blocked", reason: "another_call_active" });
    expect((await trips.get("a", trip.id)).last_call_id).toBe("call-1");
  });
  it("allows at most one competing first connection", async () => {
    const trip = await start();
    const results = await Promise.all([connect(trip, "call-1"), connect(trip, "call-2")]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => b.action === "resume")).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("asks after an abrupt restart with no disconnect event instead of leaving a permanent call lock", async () => {
    const trip = await start(); await connect(trip);
    vi.setSystemTime(NOW + CALL_LEASE_MS); fresh();
    const restored = new NavigationTrips(env);
    expect(await restored.reconnect("a", "call-2")).toMatchObject({ action: "confirm", reason: "connection_lost" });
    expect(await (await connect(trip, "call-2", false)).json()).toMatchObject({ action: "confirm" });
    expect(await (await connect(trip, "call-2", true)).json()).toMatchObject({ action: "resume", trip: { last_call_id: "call-2" } });
    expect((await call("a/trips/" + trip.id + "/heartbeat", { call_id: "call-1" })).status).toBe(409);
  });
  it("keeps a live call protected with heartbeats and rejects mismatched calls", async () => {
    const trip = await start(); await connect(trip);
    vi.setSystemTime(NOW + CALL_LEASE_MS - 1);
    expect((await call("a/trips/" + trip.id + "/heartbeat", { call_id: "wrong" })).status).toBe(409);
    const r = await call("a/trips/" + trip.id + "/heartbeat", { call_id: "call-1" });
    expect(r.status).toBe(200);
    expect((await r.json()).call_lease_until_ms).toBe(Date.now() + CALL_LEASE_MS);
    vi.setSystemTime(NOW + CALL_LEASE_MS + 1); fresh();
    expect(await trips.reconnect("a", "call-2")).toMatchObject({ action: "blocked", reason: "another_call_active" });
    await disconnect(trip);
    expect((await call("a/trips/" + trip.id + "/heartbeat", { call_id: "call-1" })).status).toBe(409);
  });
  it("does not use stale, invalid, future, or disabled GPS even with confirmation", async () => {
    const trip = await start();
    for (const time of [NOW - 120_001, NOW + 30_001]) {
      db.prepare("UPDATE navigation_positions SET fix_at_ms=? WHERE device_id='device-a'").run(time);
      expect(await (await connect(trip)).json()).toMatchObject({ action: "blocked", reason: "gps_unavailable" });
    }
    fresh();
    db.prepare("UPDATE navigation_devices SET last_report_valid=0 WHERE device_id='device-a'").run();
    expect(await (await connect(trip)).json()).toMatchObject({ action: "blocked", reason: "gps_unavailable" });
    db.prepare("UPDATE navigation_devices SET enabled=0 WHERE device_id='device-a'").run();
    expect(await (await connect(trip)).json()).toMatchObject({ action: "blocked", reason: "device_disabled" });
    expect((await trips.get("a", trip.id)).last_call_id).toBeNull();
  });
  it("blocks resume after a device reassignment, even if both devices have fresh GPS", async () => {
    const trip = await start(); await connect(trip); await disconnect(trip);
    db.prepare("UPDATE navigation_assignments SET device_id='device-b' WHERE customer_id='a'").run();
    expect(await (await connect(trip, "call-2")).json()).toMatchObject({ action: "blocked", reason: "device_changed" });
  });
  it("rechecks assignment in the atomic connect write instead of trusting an earlier read", async () => {
    const trip = await start();
    env.DB.prepare = (query) => {
      const s = prepare(query);
      if (query.includes("last_call_id=?,connected_at_ms=?")) {
        const run = s.run;
        s.run = async () => {
          db.prepare("UPDATE navigation_assignments SET device_id='device-b' WHERE customer_id='a'").run();
          return run();
        };
      }
      return s;
    };
    expect((await connect(trip)).status).toBe(409);
    expect((await trips.get("a", trip.id)).last_call_id).toBeNull();
  });
  it("blocks missing assignments rather than reviving an old device", async () => {
    const trip = await start();
    db.prepare("DELETE FROM navigation_assignments WHERE customer_id='a'").run();
    expect(await (await connect(trip)).json()).toMatchObject({ action: "blocked", reason: "no_device" });
  });
  it("asks a focused destination question after a long disconnection", async () => {
    const trip = await start(); await connect(trip); await disconnect(trip);
    vi.setSystemTime(NOW + SHORT_RECONNECT_MS + 1); fresh();
    const decision = await (await connect(trip, "call-2", false)).json();
    expect(decision).toMatchObject({ action: "confirm", reason: "long_disconnect" });
    expect(decision.prompt).toContain(DESTINATION.destination_label);
    expect((await trips.get("a", trip.id)).last_call_id).toBe("call-1");
    expect(await (await connect(trip, "call-2", true)).json()).toMatchObject({ action: "resume" });
  });
  it("does not guess that a trip ended from elapsed ETA alone", async () => {
    const trip = await start("a", { ...DESTINATION, eta_at_ms: NOW + 30_000 });
    await connect(trip); await disconnect(trip);
    vi.setSystemTime(NOW + 8 * 3600_000); fresh();
    expect(await trips.reconnect("a", "call-2")).toMatchObject({ action: "confirm", reason: "eta_elapsed" });
    expect((await trips.get("a", trip.id)).status).toBe("active");
  });
  it("treats future disconnection timestamps as ambiguous", async () => {
    const trip = await start(); await connect(trip); await disconnect(trip);
    db.prepare("UPDATE navigation_trips SET disconnected_at_ms=? WHERE id=?").run(NOW + 1, trip.id);
    expect(await trips.reconnect("a", "call-2")).toMatchObject({ action: "confirm", reason: "long_disconnect" });
  });
  it("makes repeated disconnects idempotent and ignores late disconnects from an old call", async () => {
    const trip = await start(); await connect(trip);
    const first = await (await disconnect(trip)).json();
    expect(await (await disconnect(trip)).json()).toEqual(first);
    await connect(trip, "call-2", false);
    expect((await disconnect(trip, "call-1")).status).toBe(409);
    expect(await trips.get("a", trip.id)).toMatchObject({ last_call_id: "call-2", disconnected_at_ms: null });
  });
  it("does not finish or resurrect a trip through a stale call event", async () => {
    const trip = await start(); await connect(trip);
    const finished = await trips.finish("a", trip.id, "completed");
    expect(await trips.finish("a", trip.id, "completed")).toEqual(finished);
    expect((await connect(trip)).status).toBe(409);
    expect((await disconnect(trip)).status).toBe(409);
    expect((await call("a/trips/" + trip.id + "/finish", { status: "cancelled" })).status).toBe(409);
    expect((await start()).id).not.toBe(trip.id);
  });
  it("only accepts explicit terminal statuses and bounded call identifiers", async () => {
    const trip = await start();
    for (const status of ["active", "expired", null]) expect((await call("a/trips/" + trip.id + "/finish", { status })).status).toBe(422);
    for (const call_id of ["", "a".repeat(161), "call/unsafe", null]) expect((await call("a/reconnect", { call_id })).status).toBe(422);
    expect((await call("a/trips/" + trip.id + "/finish", { status: "cancelled" })).status).toBe(200);
    expect(await trips.current("a")).toBeNull();
  });
});
