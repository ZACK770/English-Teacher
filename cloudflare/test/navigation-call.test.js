import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationCall } from "../src/navigation-call";

const NOW = Date.parse("2026-11-10T15:00:00Z");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: "test@example.iam.gserviceaccount.com", project_id: "test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
let db, env, requests, places;

function encode(points) {
  let out = "", plat = 0, plng = 0;
  const one = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 32) { out += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
  for (const [lat, lng] of points) { const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5); one(a - plat); one(b - plng); plat = a; plng = b; }
  return out;
}
const step = (points, instructions, maneuver) => ({ polyline: { encodedPolyline: encode(points) }, startLocation: { latLng: { latitude: points[0][0], longitude: points[0][1] } }, navigationInstruction: { instructions, maneuver } });
const ROUTE = { routes: [{ duration: "420s", legs: [{ steps: [
  step([[32, 34], [32, 34.01]], "התחל מזרחה", "DEPART"),
  step([[32, 34.01], [32.01, 34.01]], "פנה שמאלה לרחוב עזרא", "TURN_LEFT"),
] }] }] };

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, dir), "utf8"));
  db.prepare("INSERT INTO customer_phones(phone,customer_id) VALUES(?,?)").run("0500000001", "a");
  db.prepare("INSERT INTO navigation_devices(device_id,traccar_device_id,label,created_at,last_report_valid) VALUES(?,?,?,?,1)").run("device-a", 1, "Test", new Date().toISOString());
  db.prepare("INSERT INTO navigation_assignments(customer_id,device_id,updated_at) VALUES(?,?,?)").run("a", "device-a", new Date().toISOString());
  db.prepare("INSERT INTO navigation_positions(device_id,source_position_id,fix_at_ms,received_at_ms,latitude,longitude,speed_mps) VALUES(?,1,?,?,32,34,10)").run("device-a", NOW, NOW);
  env = { DB: { prepare }, GOOGLE_TTS_SERVICE_ACCOUNT_JSON: SA };
  requests = [];
  places = { places: [
    { formattedAddress: "עזרא 14, בני ברק, ישראל", displayName: { text: "עזרא 14" } },
    { formattedAddress: "עזרא 14, ירושלים, ישראל", displayName: { text: "עזרא 14" } },
  ] };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), body: init?.body });
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "t", expires_in: 3600 });
    if (String(url).includes("places:searchText")) return places instanceof Error ? new Response("down", { status: 503 }) : Response.json(places);
    if (String(url).includes("computeRoutes")) return Response.json(ROUTE);
    if (String(url).includes("nominatim")) return Response.json({ address: { road: "חזון איש", town: "בני ברק" } });
    throw new Error("unexpected " + url);
  }));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const callBody = (part) => JSON.parse(requests.find((r) => r.url.includes(part)).body);

describe("spoken destination → Google Places → confirmation → traffic-aware route", () => {
  it("asks 'התכוונת ל...?', offers the next match on decline, and routes to the confirmed address with live traffic", async () => {
    const nav = new NavigationCall(env, "a", "call-1");
    expect((await nav.open()).status).toBe("destination_required");
    const asked = await nav.request({ intent: "destination", destination: "עזרה 14 בני ברק" });
    expect(asked).toEqual({ status: "confirmation_required", say: "התכוונת לעזרא 14, בני ברק? להתחיל נסיעה לשם?" });
    const search = callBody("places:searchText");
    expect(search).toMatchObject({ textQuery: "עזרה 14 בני ברק", languageCode: "he", regionCode: "IL", locationBias: { circle: { center: { latitude: 32, longitude: 34 } } } });
    expect(await nav.request({ intent: "decline" })).toEqual({ status: "confirmation_required", say: "אולי התכוונת לעזרא 14, ירושלים?" });
    const started = await nav.request({ intent: "confirm" });
    expect(started).toMatchObject({ status: "depart", say: "התחל מזרחה" });
    expect(callBody("computeRoutes")).toMatchObject({ destination: { address: "עזרא 14, ירושלים" }, routingPreference: "TRAFFIC_AWARE", travelMode: "DRIVE", origin: { location: { latLng: { latitude: 32, longitude: 34 } } } });
    expect(db.prepare("SELECT destination_address FROM navigation_trips").get().destination_address).toBe("עזרא 14, ירושלים");
  });

  it("asks for the exact address after the last suggestion is declined", async () => {
    places = { places: [places.places[0]] };
    const nav = new NavigationCall(env, "a", "call-1");
    await nav.open();
    await nav.request({ intent: "destination", destination: "עזרה 14" });
    expect((await nav.request({ intent: "decline" })).say).toBe("אז מה הכתובת המדויקת? אפשר לאיית את שם הרחוב.");
    expect((await nav.request({ intent: "confirm" })).say).toBe("מה ברצונך לאשר?");
  });

  it("says it found nothing instead of routing to an unknown place", async () => {
    places = {};
    const nav = new NavigationCall(env, "a", "call-1");
    await nav.open();
    expect(await nav.request({ intent: "destination", destination: "אזזל" })).toEqual({ status: "destination_not_found", say: "לא מצאתי את אזזל. אמור שוב את שם הרחוב והעיר, או אייתי את שם הרחוב." });
    expect(requests.some((r) => r.url.includes("computeRoutes"))).toBe(false);
  });

  it("falls back to the heard text when Places is unavailable", async () => {
    places = new Error("down");
    const nav = new NavigationCall(env, "a", "call-1");
    await nav.open();
    expect((await nav.request({ intent: "destination", destination: "מירון" })).say).toBe("התכוונת למירון? להתחיל נסיעה לשם?");
    expect((await nav.request({ intent: "confirm" })).status).toBe("depart");
    expect(callBody("computeRoutes").destination).toEqual({ address: "מירון" });
  });
});

import { shortAnswer } from "../src/navigation-session";
describe("bare yes/no fallback", () => {
  it("classifies only bare Hebrew answers", () => {
    expect(shortAnswer("לא לא.")).toBe("decline");
    expect(shortAnswer("לא נכון")).toBe("decline");
    expect(shortAnswer("כן, נכון!")).toBe("confirm");
    expect(shortAnswer("סע")).toBe("confirm");
    expect(shortAnswer("לא, לרחוב רבי עקיבא")).toBeNull();
    expect(shortAnswer("כן לא")).toBeNull();
    expect(shortAnswer("")).toBeNull();
  });
});

import { TRAFFIC_CHECK_MS } from "../src/navigation-call";
describe("live traffic re-check", () => {
  const far = (seconds) => ({ routes: [{ duration: `${seconds}s`, legs: [{ steps: [
    step([[32, 34], [32, 34.03]], "התחל מזרחה", "DEPART"),
    step([[32, 34.03], [32.01, 34.03]], "פנה שמאלה לרחוב עזרא", "TURN_LEFT"),
  ] }] }] });
  async function driving(next) {
    const nav = new NavigationCall(env, "a", "call-1");
    await nav.open();
    await nav.request({ intent: "destination", destination: "עזרא 14 ירושלים" });
    await nav.request({ intent: "confirm" });
    fetch.mockImplementation(async (url, init) => {
      requests.push({ url: String(url), body: init?.body });
      if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "t", expires_in: 3600 });
      if (String(url).includes("computeRoutes")) return Response.json(next);
      throw new Error("unexpected " + url);
    });
    const t = NOW + TRAFFIC_CHECK_MS + 1000;
    vi.setSystemTime(t);
    db.prepare("UPDATE navigation_positions SET source_position_id=2, fix_at_ms=?, received_at_ms=?, longitude=34.0001, heading=90 WHERE device_id=?").run(t, t, "device-a");
    return nav;
  }

  it("offers a clearly faster different route and switches on confirm", async () => {
    const nav = await driving({ routes: [{ duration: "60s", legs: [{ steps: [
      step([[32, 34], [31.99, 34]], "התחל דרומה", "DEPART"),
      step([[31.99, 34], [31.99, 34.01]], "פנה ימינה לרחוב הרצל", "TURN_RIGHT"),
    ] }] }] });
    const offer = await nav.poll();
    expect(offer.status).toBe("confirmation_required");
    expect(offer.say).toMatch(/דרך מהירה יותר שחוסכת כ-6 דקות/);
    expect((await nav.request({ intent: "confirm" })).say).toMatch(/^עוברים למסלול המהיר/);
  });

  it("reports a major delay on the same roads", async () => {
    const nav = await driving({ routes: [{ duration: "1200s", legs: ROUTE.routes[0].legs }] });
    expect(await nav.poll()).toEqual({ status: "traffic_delay", say: "יש עומס בהמשך הדרך. זמן ההגעה התארך לכ-20 דקות." });
    expect((await nav.request({ intent: "status" })).then).toMatch(/זמן משוער ליעד: כ-20 דקות/);
  });
});

describe("previous trip on a new call", () => {
  async function previous() {
    const first = new NavigationCall(env, "a", "call-1");
    await first.open();
    await first.request({ intent: "destination", destination: "חיד\"א 3 בני ברק" });
    expect((await first.request({ intent: "confirm" })).status).toBe("depart");
    await first.close();
    vi.setSystemTime(NOW + 10 * 60_000);
    db.prepare("UPDATE navigation_positions SET fix_at_ms=?, received_at_ms=?").run(NOW + 10 * 60_000, NOW + 10 * 60_000);
    const nav = new NavigationCall(env, "a", "call-2");
    return { nav, opening: await nav.open() };
  }

  it("starts the new destination after the old trip is declined", async () => {
    const { nav, opening } = await previous();
    expect(opening.status).toBe("confirmation_required");
    expect((await nav.request({ intent: "decline" })).say).toBe("בסדר, לא ממשיכים לשם. לאן תרצה להגיע?");
    await nav.request({ intent: "destination", destination: "רבי עקיבא 10 ירושלים" });
    expect((await nav.request({ intent: "confirm" })).status).toBe("depart");
    expect(db.prepare("SELECT status FROM navigation_trips ORDER BY created_at_ms, rowid").all().map((r) => r.status)).toEqual(["cancelled", "active"]);
  });

  it("cancels the old trip when asked", async () => {
    const { nav } = await previous();
    expect(await nav.request({ intent: "cancel" })).toEqual({ status: "destination_required", say: "הנסיעה הקודמת בוטלה. לאן תרצה להגיע?" });
    expect(db.prepare("SELECT status FROM navigation_trips").get().status).toBe("cancelled");
  });
});

import { LiveNavigator } from "../src/navigation-live";
describe("Gemini-led navigator tools return data", () => {
  it("finds a place, starts a traffic-aware route, reports status and pushes a turn event", async () => {
    const nav = new LiveNavigator(env, "a", "call-1");
    expect(await nav.open()).toMatchObject({ event: "call_started", previous_trip: null, gps: { available: true, lat: 32, lng: 34, street: "חזון איש, בני ברק" } });
    expect(await nav.tool("find_place", { query: "עזרה 14" })).toEqual({ results: [
      { name: "עזרא 14, בני ברק", address: "עזרא 14, בני ברק" }, { name: "עזרא 14, ירושלים", address: "עזרא 14, ירושלים" }] });
    const started = await nav.tool("start_route", { destination: "עזרא 14, בני ברק" });
    expect(started).toMatchObject({ ok: true, minutes_with_live_traffic: 7, navigating: true, on_route: true, start_instruction: "התחל מזרחה",
      next_turn: { instruction: "פנה שמאלה לרחוב עזרא" }, upcoming_turns: [{ instruction: "פנה שמאלה לרחוב עזרא" }] });
    expect(callBody("computeRoutes")).toMatchObject({ routingPreference: "TRAFFIC_AWARE", destination: { address: "עזרא 14, בני ברק" } });
    expect(db.prepare("SELECT status, destination_address FROM navigation_trips").get()).toEqual({ status: "active", destination_address: "עזרא 14, בני ברק" });
    const t = NOW + 10_000;
    vi.setSystemTime(t);
    db.prepare("UPDATE navigation_positions SET source_position_id=2, fix_at_ms=?, received_at_ms=?, longitude=34.008, heading=90 WHERE device_id=?").run(t, t, "device-a");
    expect(await nav.poll()).toMatchObject({ event: "turn", when: "soon", instruction: "פנה שמאלה לרחוב עזרא" });
    expect(await nav.poll()).toBeNull();
    expect(await nav.tool("get_status", {})).toMatchObject({ navigating: true, on_route: true, gps: { available: true } });
    // The car leaves the route: asking for the status already returns a new route from the real position.
    vi.setSystemTime(t + 10_000);
    db.prepare("UPDATE navigation_positions SET source_position_id=3, fix_at_ms=?, received_at_ms=?, latitude=32.003, longitude=34.008 WHERE device_id=?").run(t + 10_000, t + 10_000, "device-a");
    const before = requests.filter((r) => r.url.includes("computeRoutes")).length;
    expect(await nav.tool("get_status", {})).toMatchObject({ rerouted: true, navigating: true });
    expect(requests.filter((r) => r.url.includes("computeRoutes")).length).toBe(before + 1);
    expect(JSON.parse(requests.filter((r) => r.url.includes("computeRoutes")).at(-1).body).origin.location).toEqual({ latLng: { latitude: 32.003, longitude: 34.008 }, heading: 90 });
    db.prepare("UPDATE navigation_positions SET latitude=32, longitude=34.008 WHERE device_id=?").run("device-a");
    // The tracker loses its satellite fix: Gemini is told once, and the last known position still serves status and new routes.
    vi.setSystemTime(t + 150_000);
    db.prepare("UPDATE navigation_devices SET last_report_valid=0").run();
    expect(await nav.poll()).toMatchObject({ event: "gps_lost", gps: { available: true, seconds_ago: 140, warning: expect.stringContaining("last known position") } });
    expect(await nav.poll()).toBeNull();
    expect((await nav.tool("start_route", { destination: "עזרא 14, בני ברק" })).ok).toBe(true);
    db.prepare("UPDATE navigation_devices SET last_report_valid=1").run();
    db.prepare("UPDATE navigation_positions SET fix_at_ms=?, received_at_ms=? WHERE device_id=?").run(t + 150_000, t + 150_000, "device-a");
    expect((await nav.poll()).event).toMatch(/gps_back|turn/);
    // A new call sees the trip and a new destination simply replaces it.
    await nav.close();
    const again = new LiveNavigator(env, "a", "call-2");
    expect((await again.open()).previous_trip).toMatchObject({ address: "עזרא 14, בני ברק" });
    expect((await again.tool("start_route", { destination: "עזרא 14, ירושלים" })).ok).toBe(true);
    expect(db.prepare("SELECT status FROM navigation_trips ORDER BY created_at_ms, rowid").all().map((r) => r.status)).toEqual(["cancelled", "cancelled", "active"]);
    expect(await again.tool("stop_navigation", {})).toEqual({ ok: true, navigating: false });
  });
});
