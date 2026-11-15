import { z } from "zod";
import type { Env } from "./env";
import { customerPosition } from "./navigation";
import { NavigationTrips } from "./navigation-trips";
import { computeNavigationRoute, computeRouteOptions, findPlaces, overlap, RouteGuidance, usableFix, type Guidance, type NavigationFix, type PlaceMatch, type Route } from "./navigation-route";

/** How often an active trip is re-checked against live Google traffic. */
export const TRAFFIC_CHECK_MS = 150_000;

export const NavigationRequestSchema = z.object({
  intent: z.enum(["destination", "confirm", "decline", "status", "eta", "traffic", "overview", "route_via", "see", "report", "complete", "cancel", "unknown"]),
  destination: z.string().trim().min(3).max(300).optional(),
  ask_eta: z.boolean().optional(),
  via: z.string().trim().min(1).max(80).optional(),
}).strict();

export const NAVIGATION_REQUEST_TOOL = {
  name: "navigation_request",
  description: "Call once for each complete driver request (not for noise or fragments). destination only for a destination explicitly named by the driver, confirm/decline only for an explicit answer to the last question; if the driver rejects a suggested destination and names another, send destination with the new name. see means seeing a sign, NOT reaching it or turning. report means a reported actual position/turn that conflicts with GPS. eta means the driver asks how long the drive takes or when he will arrive. complete/cancel only when explicitly requested. Never invent a destination or a confirmation.",
  parameters: { type: "OBJECT", properties: {
    intent: { type: "STRING", enum: NavigationRequestSchema.shape.intent.options },
    destination: { type: "STRING", description: "Exact destination with town supplied by driver. Never invent." },
    ask_eta: { type: "BOOLEAN", description: "True when the driver also asked how long the drive takes." },
    via: { type: "STRING", description: "For route_via: the road the driver asked to drive through, e.g. כביש 443." },
  }, required: ["intent"] },
};

export class NavigationCall {
  private trips: NavigationTrips;
  private trip: Awaited<ReturnType<NavigationTrips["current"]>> = null;
  private engine: RouteGuidance | null = null;
  private pending: { kind: "destination"; address: string; label: string; alternatives: PlaceMatch[]; route?: Route; routedAt?: number } | { kind: "resume" } | { kind: "faster"; route: Route } | { kind: "switch"; route: Route; label: string } | { kind: "completed" } | { kind: "cancelled" } | null = null;
  private linked = false;
  private driverConflict = false;
  private lastLocation: Awaited<ReturnType<typeof customerPosition>> = null;
  private trafficAt = 0;

  constructor(private env: Env, private customerId: string, private callId: string, private meter: (unit: "places_requests" | "routes_requests") => void = () => {}) {
    this.trips = new NavigationTrips(env);
  }

  private async fix(): Promise<NavigationFix | null> {
    const location = await customerPosition(this.env, this.customerId);
    this.lastLocation = location;
    if (!location?.fresh || (this.trip && location.device_id !== this.trip.device_id)) return null;
    return usableFix(location.position) ? location.position : null;
  }

  gps() {
    const location = this.lastLocation, p = location?.position;
    if (!location) return null;
    return { fresh: location.fresh, device_id: location.device_id, ...(p ? { lat: p.latitude, lng: p.longitude,
      age_s: Math.round((Date.now() - p.fix_at_ms) / 100) / 10, speed_kmh: Math.round(p.speed_mps * 36) / 10, heading: p.heading, accuracy_m: p.accuracy_m } : {}) };
  }

  private async route(fix: NavigationFix, address: string) {
    this.meter("routes_requests");
    try { return await computeNavigationRoute(this.env, fix, address); }
    catch { return null; }
  }

  private async routeOptions(fix: NavigationFix, address: string, alternatives: boolean) {
    this.meter("routes_requests");
    try { return await computeRouteOptions(this.env, fix, address, alternatives); }
    catch { return []; }
  }

  async open(): Promise<Guidance> {
    const decision = await this.trips.reconnect(this.customerId, this.callId);
    this.trip = decision.trip;
    if (decision.action === "blocked") return { status: decision.reason, say: decision.prompt };
    if (decision.action === "new_trip") return { status: "destination_required", say: decision.prompt };
    if (decision.action === "confirm") {
      this.pending = { kind: "resume" };
      return { status: "confirmation_required", say: decision.prompt };
    }
    return this.resume(false);
  }

  private async resume(confirm: boolean): Promise<Guidance> {
    if (!this.trip) return { status: "destination_required", say: "לאן תרצה להגיע?" };
    const decision = await this.trips.connect(this.customerId, this.trip.id, this.callId, confirm);
    if (decision.action !== "resume") return { status: decision.reason, say: decision.prompt };
    this.trip = decision.trip;
    this.linked = true; this.pending = null;
    return this.refreshRoute(true);
  }

  private async refreshRoute(force: boolean): Promise<Guidance> {
    this.engine = null;
    const fix = await this.fix();
    if (!fix || !this.trip) return { status: "gps_unavailable", say: "אין מיקום מדויק מהשניות האחרונות. ההנחיות מושהות עד לקבלת מיקום אמין." };
    const route = await this.route(fix, this.trip.destination_address);
    if (!route) return { status: "route_unavailable", say: `לא הצלחתי לחשב מסלול אל ${this.trip.destination_label}. נסה לומר שוב את הכתובת המלאה עם שם העיר.` };
    const current = await this.fix();
    if (!current) return { status: "gps_unavailable", say: "המיקום התיישן בזמן חישוב המסלול. ההנחיות מושהות." };
    return this.useRoute(route).update(current, force);
  }

  async request(input: unknown): Promise<Guidance> {
    const parsed = NavigationRequestSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid_request", say: "לא הבנתי. מה תרצה לעשות?" };
    const command = parsed.data;
    const decision = await this.trips.reconnect(this.customerId, this.callId);
    if (decision.action === "blocked") return { status: decision.reason, say: decision.prompt };
    if (command.intent === "unknown") return { status: "unknown", say: "על זה אני עוד לא יודע לענות. אפשר לשאול כמה זמן נשאר, אם יש עומסים, או לבקש את פירוט המסלול." };
    if (["traffic", "overview", "route_via"].includes(command.intent) && this.pending?.kind === "destination") return this.pendingRouteQuestion(command.intent, command.via);
    if (command.intent === "destination") {
      if (!command.destination) return { status: "destination_required", say: "מה הכתובת ובאיזו עיר?" };
      let matches: PlaceMatch[] | null = null;
      this.meter("places_requests");
      try { matches = await findPlaces(this.env, command.destination, await this.fix()); } catch { /* Fall back to the spoken text. */ }
      if (matches && !matches.length) {
        this.pending = null;
        return { status: "destination_not_found", say: `לא מצאתי את ${command.destination}. אמור שוב את שם הרחוב והעיר, או אייתי את שם הרחוב.` };
      }
      const [first, ...alternatives] = matches ?? [{ label: command.destination, address: command.destination }];
      this.pending = { kind: "destination", address: first.address, label: first.label, alternatives };
      const minutes = command.ask_eta ? await this.pendingMinutes() : null;
      return { status: "confirmation_required", say: `התכוונת ל${first.label}?${minutes ? ` הנסיעה כ-${minutes} דקות.` : ""} להתחיל נסיעה לשם?` };
    }
    if (command.intent === "eta") {
      if (this.engine && this.linked) return { status: "eta", say: `זמן משוער ליעד: כ-${this.eta()} דקות.` };
      if (this.pending?.kind === "destination") {
        const minutes = await this.pendingMinutes();
        return { status: "confirmation_required", say: minutes
          ? `הנסיעה ל${this.pending.label} כ-${minutes} דקות. להתחיל נסיעה לשם?`
          : `אחשב את זמן הנסיעה כשהמיקום יתעדכן. להתחיל נסיעה ל${this.pending.label}?` };
      }
      if (!this.trip) return { status: "destination_required", say: "עדיין לא נקבע יעד. לאן תרצה להגיע?" };
    }
    if (command.intent === "decline") {
      const pending = this.pending;
      if (pending?.kind === "faster" || pending?.kind === "switch") { this.pending = null; return { status: "guidance", say: "בסדר, נשארים במסלול הנוכחי." }; }
      if (pending?.kind === "destination" && pending.alternatives.length) {
        const [next, ...alternatives] = pending.alternatives;
        this.pending = { kind: "destination", address: next.address, label: next.label, alternatives };
        return { status: "confirmation_required", say: `אולי התכוונת ל${next.label}?` };
      }
      this.pending = null;
      if (pending?.kind === "destination") return { status: "destination_required", say: "אז מה הכתובת המדויקת? אפשר לאיית את שם הרחוב." };
      return { status: "destination_required", say: pending?.kind === "resume" ? "בסדר, לא ממשיכים לשם. לאן תרצה להגיע?" : "לאן תרצה להגיע?" };
    }
    if (command.intent === "confirm") {
      const pending = this.pending;
      // A stray "yes" with nothing to answer must not raise a new question.
      if (!pending) return { status: "silent", say: "" };
      if (pending.kind === "resume") return this.resume(true);
      if (pending.kind === "faster") {
        this.pending = null;
        const result = this.useRoute(pending.route).update(await this.fix(), true);
        return { ...result, say: `עוברים למסלול המהיר. ${result.say}`.trim() };
      }
      if (pending.kind === "switch") {
        this.pending = null;
        const result = this.useRoute(pending.route).update(await this.fix(), true);
        return { ...result, say: `עוברים למסלול דרך ${pending.label}. ${result.say}`.trim() };
      }
      if (pending.kind === "completed" || pending.kind === "cancelled") {
        if (!this.trip || !this.linked) return { status: "confirmation_required", say: "יש לחבר את השיחה לנסיעה לפני סיומה." };
        await this.trips.finish(this.customerId, this.trip.id, pending.kind, this.callId);
        this.trip = null; this.engine = null; this.pending = null; this.linked = false; this.driverConflict = false;
        return { status: "finished", say: "הנסיעה הסתיימה. לאן תרצה להגיע עכשיו?" };
      }
      const fresh = pending.route && Date.now() - (pending.routedAt ?? 0) < 60_000 ? pending.route : null;
      const fix = fresh ? null : await this.fix();
      if (!fresh && !fix) return { status: "gps_unavailable", say: "אין מיקום עדכני מספיק להתחלת ניווט. ממתין למכשיר האיתור." };
      const route = fresh ?? await this.route(fix!, pending.address);
      if (!route) { this.pending = null; return { status: "route_unavailable", say: `לא מצאתי מסלול אל ${pending.label}. אמור שוב את הכתובת עם שם העיר.` }; }
      // Confirming a new destination replaces any earlier trip.
      const blocked = await this.dropPrevious();
      if (blocked) return blocked;
      this.trip = await this.trips.start(this.customerId, { destination_label: pending.label.slice(0, 80), destination_address: pending.address });
      const connected = await this.trips.connect(this.customerId, this.trip.id, this.callId, true);
      if (connected.action !== "resume") return { status: connected.reason, say: connected.prompt };
      this.trip = connected.trip; this.linked = true; this.pending = null; this.driverConflict = false;
      const result = this.useRoute(route).update(await this.fix(), true);
      if (!["depart", "guidance"].includes(result.status)) return result;
      return { ...result, say: `יוצאים ל${pending.label}. הנסיעה כ-${Math.max(1, Math.round(route.seconds / 60))} דקות. ${result.say}` };
    }
    if (command.intent === "cancel" && this.trip && !this.linked) {
      this.pending = null;
      return await this.dropPrevious() ?? { status: "destination_required", say: "הנסיעה הקודמת בוטלה. לאן תרצה להגיע?" };
    }
    if (!this.trip || !this.linked) {
      if (this.trip) this.pending = { kind: "resume" };
      return this.trip ? { status: "confirmation_required", say: `להמשיך בנסיעה הקודמת אל ${this.trip.destination_label}? אפשר לומר כן, לבטל, או יעד חדש.` } : { status: "destination_required", say: "לאן תרצה להגיע?" };
    }
    if (command.intent === "complete" || command.intent === "cancel") {
      this.pending = { kind: command.intent === "complete" ? "completed" : "cancelled" };
      return { status: "confirmation_required", say: command.intent === "complete" ? "לסיים את הנסיעה כי הגעת ליעד?" : "לבטל את הנסיעה?" };
    }
    if (command.intent === "see") return this.engine?.reportSeen() ?? { status: "seen", say: "ראיית שלט אינה מעידה שכבר הגעת אליו או פנית." };
    if (command.intent === "report") {
      // A spoken position cannot be geolocated reliably; recompute from the current GPS fix instead of freezing guidance.
      const result = await this.refreshRoute(true);
      return { ...result, say: result.status === "guidance" || result.status === "depart" ? `מחשב מחדש לפי המיקום הנוכחי. ${result.say}` : result.say };
    }
    if (this.driverConflict) return { status: "manual_confirmation", say: "צריך לאמת את המיקום שמסרת לפני הנחיות נוספות. אפשר לאשר יעד חדש לחישוב מחדש." };
    if (!this.engine) return this.refreshRoute(true);
    if (command.intent === "overview") return this.engine.summary();
    if (command.intent === "traffic") return this.activeTraffic();
    if (command.intent === "route_via") return this.activeVia(command.via);
    const result = this.engine.update(await this.fix(), true);
    const eta = this.eta();
    if (command.intent === "status" && eta !== null && ["guidance", "depart"].includes(result.status)) {
      return { ...result, then: [result.then, `זמן משוער ליעד: כ-${eta} דקות`].filter(Boolean).join(". ") };
    }
    return result;
  }

  /** Traffic-aware minutes to the destination awaiting confirmation; the route is reused if confirmed. */
  private async pendingMinutes(): Promise<number | null> {
    const pending = this.pending;
    if (pending?.kind !== "destination") return null;
    if (!pending.route) {
      const fix = await this.fix();
      const route = fix ? await this.route(fix, pending.address) : null;
      if (!route) return null;
      pending.route = route; pending.routedAt = Date.now();
    }
    return Math.max(1, Math.round(pending.route.seconds / 60));
  }

  /** Questions about a destination that is not confirmed yet: answered from a fresh route, then the open question repeats. */
  private async pendingRouteQuestion(intent: string, via?: string): Promise<Guidance> {
    const pending = this.pending as Extract<NonNullable<NavigationCall["pending"]>, { kind: "destination" }>;
    const fix = await this.fix();
    if (!fix) return { status: "confirmation_required", say: `אבדוק את המסלול כשהמיקום יתעדכן. להתחיל נסיעה ל${pending.label}?` };
    const options = await this.routeOptions(fix, pending.address, intent === "route_via");
    if (!options.length) return { status: "confirmation_required", say: `לא הצלחתי לחשב מסלול כרגע. להתחיל נסיעה ל${pending.label}?` };
    const chosen = intent === "route_via" && via ? options.find((r) => passesThrough(r, via)) : options[0];
    pending.route = chosen ?? options[0]; pending.routedAt = Date.now();
    const minutes = Math.max(1, Math.round(pending.route.seconds / 60));
    if (intent === "traffic") return { status: "confirmation_required", say: `${trafficText(pending.route)} להתחיל נסיעה לשם?` };
    if (intent === "route_via" && via) return { status: "confirmation_required", say: chosen
      ? `יש מסלול דרך ${via}, כ-${minutes} דקות. להתחיל נסיעה בו?`
      : `לא מצאתי מסלול דרך ${via}. המסלול המהיר${routeVia(options[0])}, כ-${minutes} דקות. להתחיל נסיעה בו?` };
    return { status: "confirmation_required", say: `המסלול ל${pending.label}${routeVia(pending.route)}, כ-${minutes} דקות. להתחיל נסיעה לשם?` };
  }

  /** "יש עומסים?": Google's live duration against its no-traffic duration; offers a clearly faster different route. */
  private async activeTraffic(): Promise<Guidance> {
    const fix = await this.fix();
    if (!fix || !this.trip || !this.engine) return { status: "gps_unavailable", say: "אין מיקום עדכני לבדיקת עומסים כרגע." };
    const route = await this.route(fix, this.trip.destination_address);
    if (!route) return { status: "route_unavailable", say: "לא הצלחתי לבדוק עומסים כרגע." };
    this.trafficAt = Date.now();
    const current = this.engine.remainingSeconds();
    if (overlap(this.engine.route, route) < 0.9 && current - route.seconds >= 180) {
      this.pending = { kind: "faster", route };
      return { status: "confirmation_required", say: `${trafficText(route)} מצאתי דרך מהירה יותר שחוסכת כ-${Math.round((current - route.seconds) / 60)} דקות. לעבור אליה?` };
    }
    this.engine.retime(route.seconds);
    return { status: "traffic", say: trafficText(route) };
  }

  /** "אפשר דרך 443?": compares Google's alternatives with the current route. */
  private async activeVia(via?: string): Promise<Guidance> {
    if (!via) return this.engine!.summary();
    if (passesThrough(this.engine!.route, via)) return { status: "overview", say: `המסלול הנוכחי כבר עובר דרך ${via}.` };
    const fix = await this.fix();
    if (!fix || !this.trip) return { status: "gps_unavailable", say: "אין מיקום עדכני לחישוב מסלול חלופי." };
    const options = await this.routeOptions(fix, this.trip.destination_address, true);
    const current = Math.max(1, Math.round(this.engine!.remainingSeconds() / 60));
    const match = options.find((r) => passesThrough(r, via));
    if (!match) return { status: "overview", say: `לא מצאתי מסלול דרך ${via}. המסלול הנוכחי${routeVia(this.engine!.route)}, כ-${current} דקות.` };
    this.pending = { kind: "switch", route: match, label: via };
    return { status: "confirmation_required", say: `יש מסלול דרך ${via}, כ-${Math.max(1, Math.round(match.seconds / 60))} דקות, לעומת כ-${current} דקות במסלול הנוכחי. לעבור אליו?` };
  }

  /** Whether a yes/no (or route choice) question is open. */
  awaiting(): boolean { return !!this.pending; }

  /** A mixed answer ("לא... אני רוצה") repeats the open question instead of acting on it. */
  clarify(): Guidance {
    const pending = this.pending;
    if (pending?.kind === "destination") return { status: "confirmation_required", say: `לא הבנתי. להתחיל נסיעה ל${pending.label}? כן או לא?` };
    return { status: "confirmation_required", say: "לא הבנתי. כן או לא?" };
  }
  pendingDestination(): string | null { return this.pending?.kind === "destination" ? this.pending.label : null; }

  /** Minutes left by Google's traffic-aware estimate, when a route is active. */
  eta(): number | null { return this.engine ? Math.max(1, Math.round(this.engine.remainingSeconds() / 60)) : null; }
  destination(): string | null { return this.trip?.destination_label ?? null; }

  /** Ends the earlier trip of this customer (taking it over from the old call first). Returns guidance only on failure. */
  private async dropPrevious(): Promise<Guidance | null> {
    if (!this.trip) return null;
    if (!this.linked) {
      const connected = await this.trips.connect(this.customerId, this.trip.id, this.callId, true);
      if (connected.action !== "resume") return { status: connected.reason, say: connected.prompt };
      this.trip = connected.trip; this.linked = true;
    }
    const trip = this.trip;
    if (trip) await this.trips.finish(this.customerId, trip.id, "cancelled", this.callId);
    this.trip = null; this.engine = null; this.linked = false; this.driverConflict = false;
    return null;
  }

  private useRoute(route: Route) {
    this.engine = new RouteGuidance(route);
    this.trafficAt = Date.now();
    return this.engine;
  }

  /** Re-asks Google with live traffic; offers a clearly faster different route, or reports a major delay. */
  private async traffic(): Promise<Guidance | null> {
    if (!this.engine || !this.trip || Date.now() - this.trafficAt < TRAFFIC_CHECK_MS) return null;
    this.trafficAt = Date.now();
    const fix = await this.fix();
    if (!fix) return null;
    const route = await this.route(fix, this.trip.destination_address);
    if (!route) return null;
    const current = this.engine.remainingSeconds();
    if (overlap(this.engine.route, route) < 0.9) {
      if (current - route.seconds < 180) return null;
      this.pending = { kind: "faster", route };
      return { status: "confirmation_required", say: `יש עומס במסלול הנוכחי. מצאתי דרך מהירה יותר שחוסכת כ-${Math.round((current - route.seconds) / 60)} דקות. לעבור אליה?` };
    }
    this.engine.retime(route.seconds);
    if (route.seconds - current < 300) return null;
    return { status: "traffic_delay", say: `יש עומס בהמשך הדרך. זמן ההגעה התארך לכ-${Math.round(route.seconds / 60)} דקות.` };
  }

  async poll(): Promise<Guidance> {
    if (!this.trip || !this.linked) return { status: "silent", say: "" };
    await this.trips.heartbeat(this.customerId, this.trip.id, this.callId);
    if (this.pending || this.driverConflict) return { status: "silent", say: "" };
    if (!this.engine) return { status: "silent", say: "" };
    const result = this.engine.update(await this.fix());
    if (result.status === "reroute") return this.refreshRoute(true);
    if (result.status === "silent") return await this.traffic() ?? result;
    return result;
  }

  async safetyWarning(): Promise<Guidance | null> {
    if (!this.trip || !this.linked) return null;
    await this.trips.heartbeat(this.customerId, this.trip.id, this.callId);
    return await this.fix() ? null : { status: "gps_unavailable", say: "המיקום אינו עדכני או מדויק מספיק. אין להסתמך על ההנחיה הקודמת." };
  }

  async close() {
    if (this.trip && this.linked) await this.trips.disconnect(this.customerId, this.trip.id, this.callId);
  }
}

/** Google's route description (e.g. "כביש 1") or instructions mention the road; road numbers match whole numbers only. */
export function passesThrough(route: Route, via: string): boolean {
  const text = [route.description ?? "", ...route.steps.map((s) => s.instruction)].join(" ");
  const number = via.match(/\d+/)?.[0];
  if (number) return new RegExp(`(^|\\D)${number}(\\D|$)`).test(text);
  const name = via.replace(/^(כביש|דרך|רחוב)\s+/, "").trim();
  return name.length >= 2 && text.includes(name);
}

function routeVia(route: Route) { return route.description ? ` דרך ${route.description}` : ""; }

export function trafficText(route: Route): string {
  const minutes = Math.max(1, Math.round(route.seconds / 60));
  if (route.staticSeconds === undefined) return `זמן הנסיעה עם התנועה כרגע: כ-${minutes} דקות.`;
  const delay = Math.round((route.seconds - route.staticSeconds) / 60);
  return delay >= 3 ? `יש עומסים בדרך, תוספת של כ-${delay} דקות. זמן משוער כ-${minutes} דקות.` : `אין עומסים מיוחדים. זמן משוער כ-${minutes} דקות.`;
}
