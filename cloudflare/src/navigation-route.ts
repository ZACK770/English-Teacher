import { z } from "zod";
import type { Env } from "./env";
import { googleToken, postJson } from "./google";
import { BusinessStore } from "./business";
import { settings } from "./env";

export interface NavigationFix {
  latitude: number;
  longitude: number;
  fix_at_ms: number;
  speed_mps: number;
  heading: number | null;
  accuracy_m: number | null;
}
type Point = [number, number];
interface Step { along: number; instruction: string; maneuver: string }
export interface Route { points: Point[]; cumulative: number[]; steps: Step[]; seconds: number }
export interface Guidance { status: string; say: string; then?: string }
const R = Math.PI / 180;
// The tracker reports every ~10 s and delivery adds ~4 s, so 15 s caused constant "stale GPS" warnings.
export const GUIDANCE_MAX_AGE_MS = 25_000;
const coordinate = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const resultSchema = z.object({ routes: z.array(z.object({
  duration: z.string().regex(/^\d+(\.\d+)?s$/),
  legs: z.array(z.object({ steps: z.array(z.object({
    polyline: z.object({ encodedPolyline: z.string().max(100_000) }),
    startLocation: z.object({ latLng: coordinate }),
    navigationInstruction: z.object({ instructions: z.string().max(1000), maneuver: z.string() }).optional(),
  })).min(1).max(2000) })).min(1),
})).max(1) });

export function distance(a: Point, b: Point): number {
  const x = (b[1] - a[1]) * R * Math.cos((a[0] + b[0]) / 2 * R);
  const y = (b[0] - a[0]) * R;
  return Math.hypot(x, y) * 6371000;
}
function bearing(a: Point, b: Point): number {
  return (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * R), b[0] - a[0]) / R + 360) % 360;
}
function decodePolyline(encoded: string): Point[] {
  let index = 0, lat = 0, lng = 0;
  const delta = () => {
    let value = 0, shift = 0, part: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error("Invalid route polyline");
      part = encoded.charCodeAt(index++) - 63;
      if (part < 0 || part > 63) throw new Error("Invalid route polyline");
      value |= (part & 31) << shift; shift += 5;
    } while (part >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  const points: Point[] = [];
  while (index < encoded.length) {
    lat += delta(); lng += delta();
    const p: Point = [lat / 1e5, lng / 1e5];
    if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) throw new Error("Invalid route coordinate");
    points.push(p);
  }
  return points;
}

export function parseRoute(data: unknown): Route {
  const raw = resultSchema.parse(data).routes[0];
  if (!raw) throw new Error("No driving route found");
  const route: Route = { points: [], cumulative: [], steps: [], seconds: Number(raw.duration.slice(0, -1)) };
  let along = 0;
  for (const leg of raw.legs) for (const step of leg.steps) {
    const points = decodePolyline(step.polyline.encodedPolyline);
    const start = step.startLocation.latLng;
    if (!points.length || distance(points[0], [start.latitude, start.longitude]) > 30) throw new Error("Incomplete route geometry");
    if (route.points.length && distance(route.points.at(-1)!, points[0]) > 30) throw new Error("Disconnected route geometry");
    if (step.navigationInstruction) route.steps.push({ along, instruction: step.navigationInstruction.instructions, maneuver: step.navigationInstruction.maneuver });
    for (const point of points) {
      if (route.points.length) along += distance(route.points.at(-1)!, point);
      route.points.push(point); route.cumulative.push(along);
    }
  }
  if (route.points.length < 2 || along < 1 || !Number.isFinite(route.seconds) || route.seconds > 30 * 86400) throw new Error("Incomplete route");
  return route;
}

export async function computeNavigationRoute(env: Env, fix: NavigationFix, destination: string): Promise<Route> {
  if (!usableFix(fix)) throw new Error("Fresh GPS required");
  if (!destination.trim() || destination.length > 300) throw new Error("Invalid destination");
  const { token, project } = await googleToken(env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON, env.GOOGLE_TTS_PROJECT);
  if (!await new BusinessStore(env.DB).consumeMonthlyQuota("routes", settings(env).routesMonthlyLimit)) throw new Error("Route allowance unavailable");
  const body = {
    origin: { location: { latLng: { latitude: fix.latitude, longitude: fix.longitude } } },
    destination: { address: destination }, travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE",
    languageCode: "he", regionCode: "IL", units: "METRIC", polylineQuality: "HIGH_QUALITY",
  };
  const data = await postJson("https://routes.googleapis.com/directions/v2:computeRoutes", body, {
    Authorization: "Bearer " + token,
    ...(project ? { "x-goog-user-project": project } : {}),
    "X-Goog-FieldMask": "routes.duration,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.startLocation,routes.legs.steps.navigationInstruction",
  }, 10_000);
  return parseRoute(data);
}

export interface PlaceMatch { label: string; address: string }

/** Resolves a spoken (possibly mis-transcribed) destination to real Google Places candidates near the driver. */
export async function findPlaces(env: Env, text: string, near: NavigationFix | null): Promise<PlaceMatch[]> {
  const { token, project } = await googleToken(env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON, env.GOOGLE_TTS_PROJECT);
  if (!await new BusinessStore(env.DB).consumeMonthlyQuota("places", settings(env).placesMonthlyLimit)) throw new Error("Places allowance unavailable");
  const body: Record<string, unknown> = { textQuery: text, languageCode: "he", regionCode: "IL", pageSize: 3 };
  if (near) body.locationBias = { circle: { center: { latitude: near.latitude, longitude: near.longitude }, radius: 30000 } };
  const data = await postJson("https://places.googleapis.com/v1/places:searchText", body, {
    Authorization: "Bearer " + token,
    ...(project ? { "x-goog-user-project": project } : {}),
    "X-Goog-FieldMask": "places.formattedAddress,places.displayName",
  }, 8_000);
  const seen = new Set<string>(), out: PlaceMatch[] = [];
  for (const p of (data?.places ?? []) as { formattedAddress?: string; displayName?: { text?: string } }[]) {
    const address = String(p.formattedAddress ?? "").replace(/,?\s*ישראל$/, "").trim();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const name = String(p.displayName?.text ?? "").trim();
    out.push({ address, label: name && !address.startsWith(name) ? `${name}, ${address}` : address });
  }
  return out;
}

export function usableFix(fix: NavigationFix | null): fix is NavigationFix {
  if (!fix) return false;
  const age = Date.now() - fix.fix_at_ms;
  return Number.isFinite(age) && age >= 0 && age <= GUIDANCE_MAX_AGE_MS &&
    Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90 && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180 &&
    Number.isFinite(fix.speed_mps) && fix.speed_mps >= 0 && fix.speed_mps <= 112 &&
    (fix.accuracy_m === null || (Number.isFinite(fix.accuracy_m) && fix.accuracy_m >= 0 && fix.accuracy_m <= 50));
}

function project(route: Route, point: Point, minimum: number, maximum: number) {
  let best = { off: Infinity, along: 0, bearing: 0 };
  const scale = Math.cos(point[0] * R);
  for (let i = 1; i < route.points.length; i++) {
    if (route.cumulative[i] < minimum || route.cumulative[i - 1] > maximum) continue;
    const a = route.points[i - 1], b = route.points[i];
    const x = (b[1] - a[1]) * scale, y = b[0] - a[0];
    const px = (point[1] - a[1]) * scale, py = point[0] - a[0];
    const t = Math.max(0, Math.min(1, (px * x + py * y) / (x * x + y * y || 1)));
    const on: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const off = distance(point, on);
    if (off < best.off - 0.1) best = { off, along: route.cumulative[i - 1] + t * (route.cumulative[i] - route.cumulative[i - 1]), bearing: bearing(a, b) };
  }
  return best;
}

export class RouteGuidance {
  private along = 0;
  private previous: NavigationFix | null = null;
  private heading: { value: number; at: number } | null = null;
  private deviations = 0;
  private spoken = "";
  private manualConflict = false;

  constructor(readonly route: Route) {}

  reportSeen(): Guidance { return { status: "seen", say: "ראיית שלט אינה אומרת שכבר הגעת אליו או פנית. ההנחיה תתבסס על המיקום המאומת." }; }
  reportConflict(): Guidance {
    this.manualConflict = true;
    return { status: "manual_confirmation", say: "קיבלתי את הדיווח שלך. עצרתי את ההנחיות הישנות. באיזה רחוב וצומת אתה נמצא כעת?" };
  }

  update(fix: NavigationFix | null, force = false, overview = false): Guidance {
    if (this.manualConflict) return { status: "manual_confirmation", say: "יש לברר את המיקום לפי הדיווח שלך לפני שאמשיך בהנחיות." };
    if (!usableFix(fix)) return { status: "gps_unavailable", say: "המיקום אינו עדכני או מדויק מספיק. אין להסתמך על ההנחיה הקודמת." };
    if (this.previous && fix.fix_at_ms < this.previous.fix_at_ms) return { status: "silent", say: "" };
    const duplicate = this.previous?.fix_at_ms === fix.fix_at_ms;
    const dt = this.previous ? (fix.fix_at_ms - this.previous.fix_at_ms) / 1000 : 0;
    const p: Point = [fix.latitude, fix.longitude];
    if (!duplicate && this.previous && distance([this.previous.latitude, this.previous.longitude], p) > Math.max(100, 60 * dt)) {
      return { status: "position_jump", say: "זוהתה קפיצה במיקום. ההנחיות מושהות עד לקבלת מיקום אמין." };
    }
    if (!duplicate && fix.speed_mps >= 1.5 && fix.heading !== null && Number.isFinite(fix.heading) && fix.heading >= 0 && fix.heading < 360) this.heading = { value: fix.heading, at: fix.fix_at_ms };
    if (!duplicate && !this.heading && this.previous && distance([this.previous.latitude, this.previous.longitude], p) >= 15) {
      this.heading = { value: bearing([this.previous.latitude, this.previous.longitude], p), at: fix.fix_at_ms };
    }
    const projected = project(this.route, p, Math.max(0, this.along - 40), this.along + Math.max(150, dt * 60 + 50));
    this.previous = fix;
    const wrongWay = fix.speed_mps >= 1.5 && this.heading && Math.abs(((this.heading.value - projected.bearing + 540) % 360) - 180) > 120;
    if (!duplicate) this.deviations = projected.off > Math.max(35, (fix.accuracy_m ?? 10) * 2) || wrongWay ? this.deviations + 1 : 0;
    if (this.deviations >= 3) return { status: "reroute", say: "זוהתה סטייה מהמסלול. מחשב מסלול מחדש." };
    if (projected.off > 35 || wrongWay) return { status: "position_uncertain", say: "המיקום או הכיוון אינם תואמים למסלול. ממתין לאימות לפני הנחיה." };
    this.along = Math.max(this.along, projected.along);
    const remaining = this.route.cumulative.at(-1)! - this.along;
    if (remaining < 25 && distance(p, this.route.points.at(-1)!) < 25 && fix.speed_mps < 1.5) return { status: "arrival_confirmation", say: "נראה שאתה ליד היעד. האם הגעת?" };
    const depart = this.route.steps.find((s) => s.maneuver === "DEPART");
    if (!this.heading && depart && this.along < 50) {
      if (!force && this.spoken === "depart") return { status: "silent", say: "" };
      this.spoken = "depart";
      return { status: "depart", say: depart.instruction };
    }
    const steps = this.route.steps.filter((s) => s.along >= this.along - 8 && !["DEPART", "STRAIGHT", "NAME_CHANGE", "MANEUVER_UNSPECIFIED"].includes(s.maneuver));
    if (overview) return { status: "overview", say: steps.map((s) => s.instruction).join(". ") || "אין פניות נוספות במסלול המאומת." };
    const next = steps[0];
    if (!next) return { status: force ? "guidance" : "silent", say: force ? "אין פניות נוספות במסלול המאומת." : "" };
    const meters = Math.max(0, next.along - this.along);
    const near = Math.max(120, fix.speed_mps * 15);
    const band = meters <= 40 ? "near" : meters <= near ? "approach" : "far";
    const key = `${next.along}:${band}`;
    if (!force && (band === "far" || key === this.spoken)) return { status: "silent", say: "" };
    this.spoken = key;
    return { status: "guidance", say: `בעוד ${Math.max(10, Math.round(meters / 10) * 10)} מטרים: ${next.instruction}`,
      ...(steps[1] ? { then: `לאחר מכן: ${steps[1].instruction}` } : {}) };
  }
}
