import type { Env } from "./env";
import { customerPosition } from "./navigation";
import { NavigationTrips } from "./navigation-trips";
import { bearing, computeNavigationRoute, distance, findPlaces, overlap, project, type NavigationFix, type Route } from "./navigation-route";

/** Tools for the Gemini-led navigator: every tool returns data, never a scripted sentence. */
export const LIVE_TOOLS = [
  { name: "find_place", description: "Search Google Maps for a destination the driver named (address, business, landmark, town). Results are biased to the car's current GPS position. Returns up to 3 candidates with exact addresses.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "What the driver said, in Hebrew, including the town if he gave one." } }, required: ["query"] } },
  { name: "start_route", description: "Start navigating from the car's current GPS position to an address, using Google Routes with live traffic. Replaces any earlier trip. Also use it to continue a previous trip or to switch to the currently fastest route. Returns km, minutes with live traffic and the upcoming turns.",
    parameters: { type: "OBJECT", properties: { destination: { type: "STRING", description: "Full address, preferably exactly as returned by find_place." } }, required: ["destination"] } },
  { name: "get_status", description: "Live state right now: GPS (position, speed, age), whether the car is on the route, the next turn and the distance to it, the turn after it, remaining km and minutes with live traffic. Call it whenever the driver asks where he is, what is next or how long is left, and whenever you are unsure." },
  { name: "stop_navigation", description: "End the current trip, when the driver arrived or wants to cancel." },
];

export const LIVE_SYSTEM = `You are a Hebrew voice navigator talking with a driver on a phone call. He has no screen: you are his live map. You lead the conversation yourself, naturally and briefly, like a sharp friend in the passenger seat. Speak relaxed, everyday Hebrew, one or two short sentences at a time.

The car carries a GPS tracker, so never ask the driver where he is: call get_status. Your tools return live data (GPS, Google Maps places, Google Routes with live traffic); you decide what to say and when.

Typical flow: the driver names a destination -> call find_place (only with a place he actually said; never invent a query, and if you did not catch the place just ask again) -> if there is one clear match just confirm it in a few words ("רבי עקיבא 10 בירושלים, נכון?"), if several ask which one, if none ask him to repeat or spell it -> call start_route with the exact address -> tell him the travel time with traffic and the first thing to do. If he says "כן/נכון/סע" after your question, go ahead; if he corrects you, search again. If he wants to cancel or arrived, call stop_navigation. If he changes destination, just start a new route; nothing needs to be cancelled first.

Messages that start with [נתוני ניווט] are not the driver speaking: they are live data pushed by the tracking system (call started, a turn coming up, the car left the route and a new route was computed, traffic changed, GPS lost or back, arrived). Tell the driver what matters from them right away in your own words. For a turn event say the distance and the instruction; mention "then" only when the event includes it (it is included only when the following turn comes right after). gps.street is the street the car is on right now according to the map (use it when he asks where he is, or when he doubts the route); current_segment_started_with is the last route instruction he passed. If the call starts with a previous_trip, ask casually whether he is still heading there, and if so call start_route with its address.

Facts - left/right, distances, street names, minutes - come only from tool results and [נתוני ניווט] messages. Never guess them or answer from memory: call get_status again, it is cheap. If GPS is unavailable or old, say so plainly and say what you do know. in_meters is measured along the road from the car's GPS position. If the car is not on the route yet (for example parked next to the road), explain how to get onto it using start_instruction and the next turn. If something fails, tell the driver what failed and what he can do.

When the driver says he is lost, made a mistake, missed a turn or names the street he is on, call get_status: it re-reads the GPS and, if the car left the route, already returns a new route from where he really is (rerouted: true). Trust the GPS over the street name he says, but never brush him off: if he insists the route does not fit where he is or the way he is driving, do not reassure him. Tell him what the GPS shows (gps.street, driving_direction) and call start_route again with the same destination: it recomputes from his current position and driving direction, so the new route continues the way he is already going.

Do not repeat yourself. After a short acknowledgement ("אוקיי", "טוב", "תודה", "הבנתי") say nothing, or at most one word. Repeat an instruction only when he asks. Talk to him in the singular ("פנה שמאלה", "תמשיך ישר") even though Google's instructions are written in the plural. Say travel time from the data exactly or rounded to five minutes (109 minutes is "בערך שעה וחמישים", not "שעה וארבעים וחמש"); arrival_clock is the expected arrival time in Israel. gps.tracker_battery_percent is the battery of the GPS tracker in the car, if he asks.

Ignore background noise, radio, passengers and echoes of your own voice. Do not read JSON or field names aloud. Round numbers naturally ("בערך 300 מטר", "עוד רבע שעה").`;

type Data = Record<string, unknown>;
const SKIP = ["DEPART", "STRAIGHT", "NAME_CHANGE", "MANEUVER_UNSPECIFIED"];
const TRAFFIC_CHECK_MS = 150_000;
const LAST_KNOWN_MS = 10 * 60_000;
const OFF_ROUTE_M = 35;
const COMPASS = ["צפון", "צפון-מזרח", "מזרח", "דרום-מזרח", "דרום", "דרום-מערב", "מערב", "צפון-מערב"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];
const clock = (ms: number) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);

/** Street and town at a position, from OpenStreetMap; best effort, so Gemini can answer "which street am I on?". */
export async function streetAt(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&zoom=17&accept-language=he`,
      { headers: { "User-Agent": "english-engine-navigation/1.0" }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const address = ((await response.json()) as { address?: Record<string, string> }).address ?? {};
    const town = address.city ?? address.town ?? address.village ?? "";
    return address.road ? [address.road, town].filter(Boolean).join(", ") : town || null;
  } catch { return null; }
}
const round10 = (m: number) => Math.max(10, Math.round(m / 10) * 10);

export class LiveNavigator {
  private trips: NavigationTrips;
  private tripId: string | null = null;
  private route: Route | null = null;
  private destination = "";
  private along = 0;
  private off = 0;
  private bearing: number | null = null;
  private wrongWay = false;
  private origin: { at: [number, number]; fixAt: number } = { at: [0, 0], fixAt: 0 };
  private offCount = 0;
  private lastFixAt = 0;
  private eta = { seconds: 0, along: 0 };
  private announced = { along: -1, rank: 0 };
  private gpsOk = true;
  private street: { key: string; name: string | null } = { key: "", name: null };
  private last: NavigationFix | null = null;
  private motion: { speed: number; heading: number; at: number } | null = null;
  private course: { deg: number; at: number } | null = null;
  private trafficAt = 0;

  constructor(private env: Env, private customerId: string, private callId: string) { this.trips = new NavigationTrips(env); }

  private async position(withStreet = false) {
    const location = await customerPosition(this.env, this.customerId).catch(() => null);
    let fix = (location?.position ?? null) as NavigationFix | null;
    const live = !!fix;
    // Without a current satellite fix the last known position (up to 10 minutes old) is still better than nothing.
    if (location?.enabled && !fix) {
      const last = await this.env.DB.prepare("SELECT * FROM navigation_positions WHERE device_id=?").bind(location.device_id).first<NavigationFix>().catch(() => null);
      if (last && Date.now() - last.fix_at_ms <= LAST_KNOWN_MS) fix = last;
    }
    // The tracker often reports speed 0 and no heading in slow traffic; derive both from the last two fixes.
    if (fix && live) {
      const last = this.last;
      if (last && fix.fix_at_ms > last.fix_at_ms) {
        const dt = (fix.fix_at_ms - last.fix_at_ms) / 1000, moved = distance([last.latitude, last.longitude], [fix.latitude, fix.longitude]);
        this.motion = dt <= 40 && moved >= 12 && moved / dt <= 50 ? { speed: moved / dt, heading: bearing([last.latitude, last.longitude], [fix.latitude, fix.longitude]), at: fix.fix_at_ms } : null;
      }
      if (!last || fix.fix_at_ms > last.fix_at_ms) this.last = fix;
      if (this.motion?.at === fix.fix_at_ms) fix = { ...fix, speed_mps: Math.max(fix.speed_mps, this.motion.speed), heading: fix.heading ?? this.motion.heading };
      if (fix.speed_mps >= 1.5 && fix.heading !== null) this.course = { deg: fix.heading, at: fix.fix_at_ms };
    }
    const battery = location?.battery.level_percent ?? null;
    const heard = location?.last_received_at_ms ? Math.round((Date.now() - location.last_received_at_ms) / 1000) : null;
    const gps: Data = !location ? { available: false, reason: "no GPS tracker is assigned to this caller" }
      : !location.enabled ? { available: false, reason: "the GPS tracker is disabled" }
      : !fix ? { available: false, reason: location.last_report_valid ? "no recent GPS fix" : "the tracker is online but has no satellite fix (indoors, covered or just switched on)",
        tracker_last_heard_seconds_ago: heard, last_fix_seconds_ago: location.last_valid_fix_at_ms ? Math.round((Date.now() - location.last_valid_fix_at_ms) / 1000) : null }
      : { available: true, seconds_ago: Math.round((Date.now() - fix.fix_at_ms) / 1000), lat: fix.latitude, lng: fix.longitude,
        speed_kmh: Math.round(fix.speed_mps * 3.6), heading_deg: fix.heading === null ? null : Math.round(fix.heading),
        ...(battery === null ? {} : { tracker_battery_percent: battery }),
        ...(live ? {} : { warning: "the tracker has no satellite fix right now; this is only the last known position, the car may have moved since", tracker_last_heard_seconds_ago: heard }) };
    if (withStreet && fix) {
      const key = `${fix.latitude.toFixed(4)},${fix.longitude.toFixed(4)}`;
      if (this.street.key !== key) this.street = { key, name: await streetAt(fix.latitude, fix.longitude) };
      if (this.street.name) gps.street = this.street.name;
    }
    return { fix, gps, live };
  }

  private use(route: Route, destination: string, fix: NavigationFix) {
    this.route = route; this.destination = destination;
    this.origin = { at: [fix.latitude, fix.longitude], fixAt: fix.fix_at_ms };
    this.bearing = null; this.wrongWay = false;
    this.along = 0; this.off = 0; this.offCount = 0; this.lastFixAt = 0;
    this.eta = { seconds: route.seconds, along: 0 };
    this.announced = { along: -1, rank: 0 };
    this.trafficAt = Date.now();
  }

  private track(fix: NavigationFix) {
    if (!this.route || fix.fix_at_ms <= this.lastFixAt) return;
    const dt = this.lastFixAt ? (fix.fix_at_ms - this.lastFixAt) / 1000 : 0;
    this.lastFixAt = fix.fix_at_ms;
    const at = project(this.route, [fix.latitude, fix.longitude], Math.max(0, this.along - 50), this.along + Math.max(300, dt * 45 + 100));
    this.off = at.off;
    this.bearing = Number.isFinite(at.off) ? at.bearing : null;
    // Driving against or across the route's direction means a missed turn even while still close to the route line.
    const course = this.heading(), turned = course === null || this.bearing === null ? 0 : Math.abs(((course - this.bearing + 540) % 360) - 180);
    this.wrongWay = turned > 120 || (turned > 60 && at.off > 15);
    if (this.onRoute()) { this.along = Math.max(this.along, at.along); this.offCount = 0; }
    else this.offCount++;
  }

  /** Direction the car was last seen driving, kept for a short while so a stop at a junction does not erase it. */
  private heading() { return this.course && Date.now() - this.course.at <= 45_000 ? this.course.deg : null; }

  private onRoute() { return this.off <= OFF_ROUTE_M && !this.wrongWay; }

  /** The driver was just told about the next turn (in a tool result), so the pushed event must not repeat it. */
  private told(fix: NavigationFix | null) {
    if (!this.route || !fix) return;
    const at = this.estimate(fix), [next] = this.turns(at);
    if (!next) return;
    const rank = this.rank(next.along - at, fix);
    if (rank && (this.announced.along !== next.along || rank > this.announced.rank)) this.announced = { along: next.along, rank };
  }

  private rank(meters: number, fix: NavigationFix) { return meters <= Math.max(50, fix.speed_mps * 5) ? 2 : meters <= Math.max(300, fix.speed_mps * 25) ? 1 : 0; }

  /** The car is off the route and has really moved since the route was computed, so a new route is worth asking for. */
  private left(fix: NavigationFix) {
    return !this.onRoute() && fix.fix_at_ms > this.origin.fixAt && distance(this.origin.at, [fix.latitude, fix.longitude]) > 40;
  }

  private async reroute(fix: NavigationFix) {
    this.offCount = 0;
    try {
      this.use(await computeNavigationRoute(this.env, fix, this.destination, false, this.heading()), this.destination, fix);
      this.track(fix);
      return true;
    } catch {
      this.origin = { at: [fix.latitude, fix.longitude], fixAt: fix.fix_at_ms };
      return false;
    }
  }

  /** Position along the route now, advancing the last fix by the car's speed since it was taken. */
  private estimate(fix: NavigationFix | null) {
    const total = this.route!.cumulative.at(-1)!;
    if (!fix || !this.onRoute()) return Math.min(total, this.along);
    return Math.min(total, this.along + fix.speed_mps * Math.min(20, Math.max(0, (Date.now() - fix.fix_at_ms) / 1000)));
  }

  private turns(from: number) { return this.route!.steps.filter((s) => s.along >= from - 10 && !SKIP.includes(s.maneuver)); }

  private state(fix: NavigationFix | null): Data {
    if (!this.route) return { navigating: false };
    const total = this.route.cumulative.at(-1)!, at = this.estimate(fix), [next, then] = this.turns(at);
    const depart = this.route.steps.find((s) => s.maneuver === "DEPART");
    const passed = this.route.steps.filter((s) => s.along <= at - 10).at(-1);
    const seconds = this.eta.seconds * Math.max(0, total - at) / Math.max(1, total - this.eta.along);
    return { navigating: true, destination: this.destination,
      on_route: this.onRoute(), ...(this.off > OFF_ROUTE_M && Number.isFinite(this.off) ? { meters_from_route: Math.round(this.off) } : {}),
      ...(this.wrongWay ? { wrong_way: true } : {}),
      ...(passed ? { current_segment_started_with: passed.instruction } : {}),
      ...(at < 80 && depart ? { start_instruction: depart.instruction } : {}),
      ...(this.heading() !== null ? { driving_direction: compass(this.heading()!) } : {}),
      ...(this.bearing !== null ? { route_direction: compass(this.bearing) } : {}),
      next_turn: next ? { instruction: next.instruction, in_meters: round10(next.along - at) } : null,
      then: then ? { instruction: then.instruction, in_meters: round10(then.along - at) } : null,
      remaining_km: Math.round((total - at) / 100) / 10, remaining_minutes_with_traffic: Math.max(1, Math.round(seconds / 60)),
      arrival_clock: clock(Date.now() + seconds * 1000) };
  }

  private async endTrip(status: "completed" | "cancelled") {
    try {
      const trip = await this.trips.current(this.customerId);
      if (trip) await this.trips.finish(this.customerId, trip.id, status);
    } catch { /* Trip bookkeeping must never block the conversation. */ }
    this.tripId = null;
  }

  async open(): Promise<Data> {
    const { gps } = await this.position(true);
    const trip = await this.trips.current(this.customerId).catch(() => null);
    return { event: "call_started", gps, previous_trip: trip ? { destination: trip.destination_label, address: trip.destination_address,
      minutes_since_it_was_active: Math.round((Date.now() - (trip.disconnected_at_ms ?? trip.updated_at_ms)) / 60000) } : null };
  }

  async tool(name: string, args: Data): Promise<Data> {
    const { fix, gps, live } = await this.position(name === "get_status" || name === "start_route");
    if (name === "find_place") {
      const query = String(args.query ?? "").trim();
      if (!query) return { error: "query is required" };
      try {
        const results = await findPlaces(this.env, query, fix);
        return { results: results.map((r) => ({ name: r.label, address: r.address })) };
      } catch { return { error: "Google Places is unavailable right now", hint: "start_route also accepts the address as the driver said it" }; }
    }
    if (name === "start_route") {
      const destination = String(args.destination ?? "").trim();
      if (!destination) return { ok: false, error: "destination is required" };
      if (!fix) return { ok: false, error: "no usable GPS position, so a route cannot start yet", gps };
      let route: Route;
      try { route = await computeNavigationRoute(this.env, fix, destination, false, this.heading()); }
      catch (error) { return { ok: false, error: "Google found no driving route to this destination", detail: error instanceof Error ? error.message.slice(0, 120) : "" }; }
      await this.endTrip("cancelled");
      try {
        const trip = await this.trips.start(this.customerId, { destination_label: destination.slice(0, 80), destination_address: destination });
        await this.trips.connect(this.customerId, trip.id, this.callId, true);
        this.tripId = trip.id;
      } catch { /* The route still works for this call; only resuming after a redial is lost. */ }
      this.use(route, destination, fix);
      this.track(fix);
      this.told(fix);
      const turns = this.turns(0);
      return { ok: true, total_km: Math.round(route.cumulative.at(-1)! / 100) / 10, minutes_with_live_traffic: Math.max(1, Math.round(route.seconds / 60)),
        upcoming_turns: turns.slice(0, 6).map((s) => ({ instruction: s.instruction, at_km: Math.round(s.along / 100) / 10 })), total_turns: turns.length,
        gps, ...this.state(fix) };
    }
    if (name === "get_status") {
      if (fix && live) this.track(fix);
      const rerouted = !!this.route && !!fix && live && this.left(fix) && await this.reroute(fix);
      this.told(fix);
      return { gps, ...(rerouted ? { rerouted: true, note: "the car had left the route; this is a new route from its current position" } : {}), ...this.state(fix) };
    }
    if (name === "stop_navigation") {
      await this.endTrip("completed");
      this.route = null;
      return { ok: true, navigating: false };
    }
    return { error: `unknown tool ${name}` };
  }

  /** Called every few seconds; returns something worth telling the driver, or null. */
  async poll(): Promise<Data | null> {
    if (!this.route) return null;
    if (this.tripId) await this.trips.heartbeat(this.customerId, this.tripId, this.callId).catch(() => {});
    const { fix, gps, live } = await this.position();
    if (!fix || !live) {
      if (!this.gpsOk) return null;
      this.gpsOk = false;
      return { event: "gps_lost", gps };
    }
    const back = !this.gpsOk;
    this.gpsOk = true;
    this.track(fix);
    if (this.offCount >= 2 && this.left(fix)) {
      const done = await this.reroute(fix);
      this.told(fix);
      return done
        ? { event: "rerouted", reason: "the car left the route; this is the new route from the current position", ...this.state(fix) }
        : { event: "off_route", note: "a new route could not be computed yet", ...this.state(fix) };
    }
    const total = this.route.cumulative.at(-1)!, at = this.estimate(fix);
    if (this.onRoute() && total - at < 40) {
      const destination = this.destination;
      await this.endTrip("completed");
      this.route = null;
      return { event: "arrived", destination };
    }
    const [next, then] = this.turns(at);
    if (next && this.onRoute()) {
      const meters = next.along - at, rank = this.rank(meters, fix);
      if (rank && (this.announced.along !== next.along || rank > this.announced.rank)) {
        this.announced = { along: next.along, rank };
        return { event: "turn", when: rank === 2 ? "now" : "soon", in_meters: round10(meters), instruction: next.instruction,
          ...(then && then.along - next.along <= 400 ? { then: { instruction: then.instruction, meters_after: round10(then.along - next.along) } } : {}) };
      }
    }
    if (Date.now() - this.trafficAt >= TRAFFIC_CHECK_MS && this.onRoute()) {
      this.trafficAt = Date.now();
      const fresh = await computeNavigationRoute(this.env, fix, this.destination, false, this.heading()).catch(() => null);
      if (fresh) {
        const current = this.eta.seconds * Math.max(0, total - at) / Math.max(1, total - this.eta.along);
        if (overlap(this.route, fresh) < 0.9) {
          if (current - fresh.seconds >= 180) return { event: "faster_route_available", saves_minutes: Math.round((current - fresh.seconds) / 60),
            minutes_on_faster_route: Math.round(fresh.seconds / 60), how_to_switch: "call start_route with the same destination" };
        } else {
          this.eta = { seconds: fresh.seconds, along: at };
          if (fresh.seconds - current >= 300) return { event: "traffic_delay", ...this.state(fix) };
        }
      }
    }
    return back ? { event: "gps_back", ...this.state(fix) } : null;
  }

  async close() {
    if (this.tripId) await this.trips.disconnect(this.customerId, this.tripId, this.callId).catch(() => {});
  }
}
