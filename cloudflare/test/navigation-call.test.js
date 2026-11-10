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
