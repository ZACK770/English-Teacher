import type { Env } from "./env";
import { customerPosition } from "./navigation";
import { NavigationTrips } from "./navigation-trips";
import { computeNavigationRoute, findPlaces, overlap, project, type NavigationFix, type Route } from "./navigation-route";

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

Typical flow: the driver names a destination -> call find_place -> if there is one clear match just confirm it in a few words ("רבי עקיבא 10 בירושלים, נכון?"), if several ask which one, if none ask him to repeat or spell it -> call start_route with the exact address -> tell him the travel time with traffic and the first thing to do. If he says "כן/נכון/סע" after your question, go ahead; if he corrects you, search again. If he wants to cancel or arrived, call stop_navigation. If he changes destination, just start a new route; nothing needs to be cancelled first.

Messages that start with [נתוני ניווט] are not the driver speaking: they are live data pushed by the tracking system (call started, a turn coming up, the car left the route and a new route was computed, traffic changed, GPS lost or back, arrived). Tell the driver what matters from them right away in your own words. For a turn event say the distance and the instruction; when "then" is close, mention it too. If the call starts with a previous_trip, ask casually whether he is still heading there, and if so call start_route with its address.

Facts - left/right, distances, street names, minutes - come only from tool results and [נתוני ניווט] messages. Never guess them or answer from memory: call get_status again, it is cheap. If GPS is unavailable or old, say so plainly and say what you do know. If the car is not on the route yet (for example parked next to the road), explain how to get onto it using start_instruction and the next turn. If something fails, tell the driver what failed and what he can do.

Ignore background noise, radio, passengers and echoes of your own voice. Do not read JSON or field names aloud. Round numbers naturally ("בערך 300 מטר", "עוד רבע שעה").`;

type Data = Record<string, unknown>;
const SKIP = ["DEPART", "STRAIGHT", "NAME_CHANGE", "MANEUVER_UNSPECIFIED"];
const TRAFFIC_CHECK_MS = 150_000;
const LAST_KNOWN_MS = 10 * 60_000;
const round10 = (m: number) => Math.max(10, Math.round(m / 10) * 10);

export class LiveNavigator {
  private trips: NavigationTrips;
  private tripId: string | null = null;
  private route: Route | null = null;
  private destination = "";
  private along = 0;
  private off = 0;
  private offCount = 0;
  private lastFixAt = 0;
  private eta = { seconds: 0, along: 0 };
  private announced = { along: -1, rank: 0 };
  private gpsOk = true;
  private trafficAt = 0;

  constructor(private env: Env, private customerId: string, private callId: string) { this.trips = new NavigationTrips(env); }

  private async position() {
    const location = await customerPosition(this.env, this.customerId).catch(() => null);
    let fix = (location?.position ?? null) as NavigationFix | null;
    const live = !!fix;
    // Without a current satellite fix the last known position (up to 10 minutes old) is still better than nothing.
    if (location?.enabled && !fix) {
      const last = await this.env.DB.prepare("SELECT * FROM navigation_positions WHERE device_id=?").bind(location.device_id).first<NavigationFix>().catch(() => null);
      if (last && Date.now() - last.fix_at_ms <= LAST_KNOWN_MS) fix = last;
    }
    const heard = location?.last_received_at_ms ? Math.round((Date.now() - location.last_received_at_ms) / 1000) : null;
    const gps: Data = !location ? { available: false, reason: "no GPS tracker is assigned to this caller" }
      : !location.enabled ? { available: false, reason: "the GPS tracker is disabled" }
      : !fix ? { available: false, reason: location.last_report_valid ? "no recent GPS fix" : "the tracker is online but has no satellite fix (indoors, covered or just switched on)",
        tracker_last_heard_seconds_ago: heard, last_fix_seconds_ago: location.last_valid_fix_at_ms ? Math.round((Date.now() - location.last_valid_fix_at_ms) / 1000) : null }
      : { available: true, seconds_ago: Math.round((Date.now() - fix.fix_at_ms) / 1000), lat: fix.latitude, lng: fix.longitude,
        speed_kmh: Math.round(fix.speed_mps * 3.6), heading_deg: fix.heading,
        ...(live ? {} : { warning: "the tracker has no satellite fix right now; this is only the last known position, the car may have moved since", tracker_last_heard_seconds_ago: heard }) };
    return { fix, gps, live };
  }

  private use(route: Route, destination: string) {
    this.route = route; this.destination = destination;
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
    if (at.off <= 50) { this.along = Math.max(this.along, at.along); this.offCount = 0; }
    else if (fix.speed_mps >= 2) this.offCount++;
  }

  /** Position along the route now, advancing the last fix by the car's speed since it was taken. */
  private estimate(fix: NavigationFix | null) {
    const total = this.route!.cumulative.at(-1)!;
    if (!fix || this.off > 50) return Math.min(total, this.along);
    return Math.min(total, this.along + fix.speed_mps * Math.min(20, Math.max(0, (Date.now() - fix.fix_at_ms) / 1000)));
  }

  private turns(from: number) { return this.route!.steps.filter((s) => s.along >= from - 10 && !SKIP.includes(s.maneuver)); }

  private state(fix: NavigationFix | null): Data {
    if (!this.route) return { navigating: false };
    const total = this.route.cumulative.at(-1)!, at = this.estimate(fix), [next, then] = this.turns(at);
    const depart = this.route.steps.find((s) => s.maneuver === "DEPART");
    const seconds = this.eta.seconds * Math.max(0, total - at) / Math.max(1, total - this.eta.along);
    return { navigating: true, destination: this.destination,
      on_route: this.off <= 50, ...(this.off > 50 && Number.isFinite(this.off) ? { meters_from_route: Math.round(this.off) } : {}),
      ...(at < 80 && depart ? { start_instruction: depart.instruction } : {}),
      next_turn: next ? { instruction: next.instruction, in_meters: round10(next.along - at) } : null,
      then: then ? { instruction: then.instruction, in_meters: round10(then.along - at) } : null,
      remaining_km: Math.round((total - at) / 100) / 10, remaining_minutes_with_traffic: Math.max(1, Math.round(seconds / 60)) };
  }

  private async endTrip(status: "completed" | "cancelled") {
    try {
      const trip = await this.trips.current(this.customerId);
      if (trip) await this.trips.finish(this.customerId, trip.id, status);
    } catch { /* Trip bookkeeping must never block the conversation. */ }
    this.tripId = null;
  }

  async open(): Promise<Data> {
    const { gps } = await this.position();
    const trip = await this.trips.current(this.customerId).catch(() => null);
    return { event: "call_started", gps, previous_trip: trip ? { destination: trip.destination_label, address: trip.destination_address,
      minutes_since_it_was_active: Math.round((Date.now() - (trip.disconnected_at_ms ?? trip.updated_at_ms)) / 60000) } : null };
  }

  async tool(name: string, args: Data): Promise<Data> {
    const { fix, gps, live } = await this.position();
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
      try { route = await computeNavigationRoute(this.env, fix, destination, false); }
      catch (error) { return { ok: false, error: "Google found no driving route to this destination", detail: error instanceof Error ? error.message.slice(0, 120) : "" }; }
      await this.endTrip("cancelled");
      try {
        const trip = await this.trips.start(this.customerId, { destination_label: destination.slice(0, 80), destination_address: destination });
        await this.trips.connect(this.customerId, trip.id, this.callId, true);
        this.tripId = trip.id;
      } catch { /* The route still works for this call; only resuming after a redial is lost. */ }
      this.use(route, destination);
      this.track(fix);
      const turns = this.turns(0);
      return { ok: true, total_km: Math.round(route.cumulative.at(-1)! / 100) / 10, minutes_with_live_traffic: Math.max(1, Math.round(route.seconds / 60)),
        upcoming_turns: turns.slice(0, 6).map((s) => ({ instruction: s.instruction, at_km: Math.round(s.along / 100) / 10 })), total_turns: turns.length,
        gps, ...this.state(fix) };
    }
    if (name === "get_status") {
      if (fix && live) this.track(fix);
      return { gps, ...this.state(fix) };
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
    if (this.offCount >= 3) {
      this.offCount = 0;
      try {
        this.use(await computeNavigationRoute(this.env, fix, this.destination, false), this.destination);
        this.track(fix);
        return { event: "rerouted", reason: "the car left the route; this is the new route from the current position", ...this.state(fix) };
      } catch { return { event: "off_route", note: "a new route could not be computed yet", ...this.state(fix) }; }
    }
    const total = this.route.cumulative.at(-1)!, at = this.estimate(fix);
    if (this.off <= 50 && total - at < 40) {
      const destination = this.destination;
      await this.endTrip("completed");
      this.route = null;
      return { event: "arrived", destination };
    }
    const [next, then] = this.turns(at);
    if (next && this.off <= 50) {
      const meters = next.along - at;
      const rank = meters <= Math.max(50, fix.speed_mps * 5) ? 2 : meters <= Math.max(300, fix.speed_mps * 25) ? 1 : 0;
      if (rank && (this.announced.along !== next.along || rank > this.announced.rank)) {
        this.announced = { along: next.along, rank };
        return { event: "turn", when: rank === 2 ? "now" : "soon", in_meters: round10(meters), instruction: next.instruction,
          then: then ? { instruction: then.instruction, meters_after: round10(then.along - next.along) } : null };
      }
    }
    if (Date.now() - this.trafficAt >= TRAFFIC_CHECK_MS && this.off <= 50) {
      this.trafficAt = Date.now();
      const fresh = await computeNavigationRoute(this.env, fix, this.destination, false).catch(() => null);
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
