import { z } from "zod";
import type { Env } from "./env";
import { customerPosition } from "./navigation";
import { NavigationTrips } from "./navigation-trips";
import { computeNavigationRoute, findPlaces, overlap, RouteGuidance, usableFix, type Guidance, type NavigationFix, type PlaceMatch, type Route } from "./navigation-route";

/** How often an active trip is re-checked against live Google traffic. */
export const TRAFFIC_CHECK_MS = 150_000;

export const NavigationRequestSchema = z.object({
  intent: z.enum(["destination", "confirm", "decline", "status", "overview", "see", "report", "complete", "cancel"]),
  destination: z.string().trim().min(3).max(300).optional(),
}).strict();

export const NAVIGATION_REQUEST_TOOL = {
  name: "navigation_request",
  description: "Call once for each complete driver request (not for noise or fragments). destination only for a destination explicitly named by the driver, confirm/decline only for an explicit answer to the last question; if the driver rejects a suggested destination and names another, send destination with the new name. see means seeing a sign, NOT reaching it or turning. report means a reported actual position/turn that conflicts with GPS. complete/cancel only when explicitly requested. Never invent a destination or a confirmation.",
  parameters: { type: "OBJECT", properties: {
    intent: { type: "STRING", enum: NavigationRequestSchema.shape.intent.options },
    destination: { type: "STRING", description: "Exact destination with town supplied by driver. Never invent." },
  }, required: ["intent"] },
};

export class NavigationCall {
  private trips: NavigationTrips;
  private trip: Awaited<ReturnType<NavigationTrips["current"]>> = null;
  private engine: RouteGuidance | null = null;
  private pending: { kind: "destination"; address: string; label: string; alternatives: PlaceMatch[] } | { kind: "resume" } | { kind: "faster"; route: Route } | { kind: "completed" } | { kind: "cancelled" } | null = null;
  private linked = false;
  private driverConflict = false;
  private lastLocation: Awaited<ReturnType<typeof customerPosition>> = null;
  private trafficAt = 0;

  constructor(private env: Env, private customerId: string, private callId: string) { this.trips = new NavigationTrips(env); }

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
    try { return await computeNavigationRoute(this.env, fix, address); }
    catch { return null; }
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
    if (command.intent === "destination") {
      if (!command.destination) return { status: "destination_required", say: "מה הכתובת ובאיזו עיר?" };
      let matches: PlaceMatch[] | null = null;
      try { matches = await findPlaces(this.env, command.destination, await this.fix()); } catch { /* Fall back to the spoken text. */ }
      if (matches && !matches.length) {
        this.pending = null;
        return { status: "destination_not_found", say: `לא מצאתי את ${command.destination}. אמור שוב את שם הרחוב והעיר, או אייתי את שם הרחוב.` };
      }
      const [first, ...alternatives] = matches ?? [{ label: command.destination, address: command.destination }];
      this.pending = { kind: "destination", address: first.address, label: first.label, alternatives };
      return { status: "confirmation_required", say: `התכוונת ל${first.label}? להתחיל נסיעה לשם?` };
    }
    if (command.intent === "decline") {
      const pending = this.pending;
      if (pending?.kind === "faster") { this.pending = null; return { status: "guidance", say: "בסדר, נשארים במסלול הנוכחי." }; }
      if (pending?.kind === "destination" && pending.alternatives.length) {
        const [next, ...alternatives] = pending.alternatives;
        this.pending = { kind: "destination", address: next.address, label: next.label, alternatives };
        return { status: "confirmation_required", say: `אולי התכוונת ל${next.label}?` };
      }
      this.pending = null;
      if (pending?.kind === "destination") return { status: "destination_required", say: "אז מה הכתובת המדויקת? אפשר לאיית את שם הרחוב." };
      return { status: "destination_required", say: this.trip ? "הנסיעה הקודמת לא נמחקה. לאן תרצה להגיע?" : "לאן תרצה להגיע?" };
    }
    if (command.intent === "confirm") {
      const pending = this.pending;
      if (!pending) return { status: "confirmation_required", say: "מה ברצונך לאשר?" };
      if (pending.kind === "resume") return this.resume(true);
      if (pending.kind === "faster") {
        this.pending = null;
        const result = this.useRoute(pending.route).update(await this.fix(), true);
        return { ...result, say: `עוברים למסלול המהיר. ${result.say}`.trim() };
      }
      if (pending.kind === "completed" || pending.kind === "cancelled") {
        if (!this.trip || !this.linked) return { status: "confirmation_required", say: "יש לחבר את השיחה לנסיעה לפני סיומה." };
        await this.trips.finish(this.customerId, this.trip.id, pending.kind, this.callId);
        this.trip = null; this.engine = null; this.pending = null; this.linked = false; this.driverConflict = false;
        return { status: "finished", say: "הנסיעה הסתיימה. לאן תרצה להגיע עכשיו?" };
      }
      const fix = await this.fix();
      if (!fix) return { status: "gps_unavailable", say: "אין מיקום עדכני מספיק להתחלת ניווט. ממתין למכשיר האיתור." };
      if (this.trip && !this.linked) return { status: "confirmation_required", say: "קיימת נסיעה קודמת. יש לאשר את המשכה או לבטל אותה לפני פתיחת נסיעה חדשה." };
      const route = await this.route(fix, pending.address);
      if (!route) { this.pending = null; return { status: "route_unavailable", say: `לא מצאתי מסלול אל ${pending.label}. אמור שוב את הכתובת עם שם העיר.` }; }
      if (this.trip) await this.trips.finish(this.customerId, this.trip.id, "cancelled", this.callId);
      this.trip = await this.trips.start(this.customerId, { destination_label: pending.label.slice(0, 80), destination_address: pending.address });
      const connected = await this.trips.connect(this.customerId, this.trip.id, this.callId, true);
      if (connected.action !== "resume") return { status: connected.reason, say: connected.prompt };
      this.trip = connected.trip; this.linked = true; this.pending = null; this.driverConflict = false;
      return this.useRoute(route).update(await this.fix(), true);
    }
    if (!this.trip || !this.linked) return { status: "confirmation_required", say: this.trip ? "האם להמשיך ליעד של הנסיעה הקודמת?" : "לאן תרצה להגיע?" };
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
    const result = this.engine.update(await this.fix(), true, command.intent === "overview");
    const eta = this.eta();
    if ((command.intent === "status" || command.intent === "overview") && eta !== null && ["guidance", "overview", "depart"].includes(result.status)) {
      return { ...result, then: [result.then, `זמן משוער ליעד: כ-${eta} דקות`].filter(Boolean).join(". ") };
    }
    return result;
  }

  /** Minutes left by Google's traffic-aware estimate, when a route is active. */
  eta(): number | null { return this.engine ? Math.max(1, Math.round(this.engine.remainingSeconds() / 60)) : null; }
  destination(): string | null { return this.trip?.destination_label ?? null; }

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
