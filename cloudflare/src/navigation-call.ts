import { z } from "zod";
import type { Env } from "./env";
import { customerPosition } from "./navigation";
import { NavigationTrips } from "./navigation-trips";
import { computeNavigationRoute, RouteGuidance, usableFix, type Guidance, type NavigationFix } from "./navigation-route";

export const NavigationRequestSchema = z.object({
  intent: z.enum(["destination", "confirm", "decline", "status", "overview", "see", "report", "complete", "cancel"]),
  destination: z.string().trim().min(3).max(300).optional(),
}).strict();

export const NAVIGATION_REQUEST_TOOL = {
  name: "navigation_request",
  description: "Call for EVERY driver utterance. destination only for a destination explicitly named by the driver, confirm/decline only for an explicit answer to the last question. see means seeing a sign, NOT reaching it or turning. report means a reported actual position/turn that conflicts with GPS. complete/cancel only when explicitly requested. Never invent a destination or a confirmation.",
  parameters: { type: "OBJECT", properties: {
    intent: { type: "STRING", enum: NavigationRequestSchema.shape.intent.options },
    destination: { type: "STRING", description: "Exact destination with town supplied by driver. Never invent." },
  }, required: ["intent"] },
};

export class NavigationCall {
  private trips: NavigationTrips;
  private trip: Awaited<ReturnType<NavigationTrips["current"]>> = null;
  private engine: RouteGuidance | null = null;
  private pending: { kind: "destination"; address: string } | { kind: "resume" } | { kind: "completed" } | { kind: "cancelled" } | null = null;
  private linked = false;
  private driverConflict = false;

  constructor(private env: Env, private customerId: string, private callId: string) { this.trips = new NavigationTrips(env); }

  private async fix(): Promise<NavigationFix | null> {
    const location = await customerPosition(this.env, this.customerId);
    if (!location?.fresh || (this.trip && location.device_id !== this.trip.device_id)) return null;
    return usableFix(location.position) ? location.position : null;
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
    const route = await computeNavigationRoute(this.env, fix, this.trip.destination_address);
    const current = await this.fix();
    if (!current) return { status: "gps_unavailable", say: "המיקום התיישן בזמן חישוב המסלול. ההנחיות מושהות." };
    this.engine = new RouteGuidance(route);
    return this.engine.update(current, force);
  }

  async request(input: unknown): Promise<Guidance> {
    const parsed = NavigationRequestSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid_request", say: "לא הבנתי. מה תרצה לעשות?" };
    const command = parsed.data;
    const decision = await this.trips.reconnect(this.customerId, this.callId);
    if (decision.action === "blocked") return { status: decision.reason, say: decision.prompt };
    if (command.intent === "destination") {
      if (!command.destination) return { status: "destination_required", say: "מה הכתובת ובאיזו עיר?" };
      this.pending = { kind: "destination", address: command.destination };
      return { status: "confirmation_required", say: `היעד הוא ${command.destination}. להתחיל נסיעה לשם?` };
    }
    if (command.intent === "decline") {
      this.pending = null;
      return { status: "destination_required", say: "הנסיעה הקודמת לא נמחקה. לאן תרצה להגיע?" };
    }
    if (command.intent === "confirm") {
      const pending = this.pending;
      if (!pending) return { status: "confirmation_required", say: "מה ברצונך לאשר?" };
      if (pending.kind === "resume") return this.resume(true);
      if (pending.kind === "completed" || pending.kind === "cancelled") {
        if (!this.trip || !this.linked) return { status: "confirmation_required", say: "יש לחבר את השיחה לנסיעה לפני סיומה." };
        await this.trips.finish(this.customerId, this.trip.id, pending.kind, this.callId);
        this.trip = null; this.engine = null; this.pending = null; this.linked = false; this.driverConflict = false;
        return { status: "finished", say: "הנסיעה הסתיימה. לאן תרצה להגיע עכשיו?" };
      }
      const fix = await this.fix();
      if (!fix) return { status: "gps_unavailable", say: "אין מיקום עדכני מספיק להתחלת ניווט. ממתין למכשיר האיתור." };
      if (this.trip && !this.linked) return { status: "confirmation_required", say: "קיימת נסיעה קודמת. יש לאשר את המשכה או לבטל אותה לפני פתיחת נסיעה חדשה." };
      const route = await computeNavigationRoute(this.env, fix, pending.address);
      if (this.trip) await this.trips.finish(this.customerId, this.trip.id, "cancelled", this.callId);
      this.trip = await this.trips.start(this.customerId, { destination_label: pending.address.slice(0, 80), destination_address: pending.address });
      const connected = await this.trips.connect(this.customerId, this.trip.id, this.callId, true);
      if (connected.action !== "resume") return { status: connected.reason, say: connected.prompt };
      this.trip = connected.trip; this.linked = true; this.pending = null; this.driverConflict = false;
      this.engine = new RouteGuidance(route);
      return this.engine.update(await this.fix(), true);
    }
    if (!this.trip || !this.linked) return { status: "confirmation_required", say: this.trip ? "האם להמשיך ליעד של הנסיעה הקודמת?" : "לאן תרצה להגיע?" };
    if (command.intent === "complete" || command.intent === "cancel") {
      this.pending = { kind: command.intent === "complete" ? "completed" : "cancelled" };
      return { status: "confirmation_required", say: command.intent === "complete" ? "לסיים את הנסיעה כי הגעת ליעד?" : "לבטל את הנסיעה?" };
    }
    if (command.intent === "see") return this.engine?.reportSeen() ?? { status: "seen", say: "ראיית שלט אינה מעידה שכבר הגעת אליו או פנית." };
    if (command.intent === "report") {
      this.driverConflict = true;
      return this.engine?.reportConflict() ?? { status: "manual_confirmation", say: "עצרתי את ההנחיות הישנות. באיזה רחוב וצומת אתה נמצא כעת?" };
    }
    if (this.driverConflict) return { status: "manual_confirmation", say: "צריך לאמת את המיקום שמסרת לפני הנחיות נוספות. אפשר לאשר יעד חדש לחישוב מחדש." };
    if (!this.engine) return this.refreshRoute(true);
    return this.engine.update(await this.fix(), true, command.intent === "overview");
  }

  async poll(): Promise<Guidance> {
    if (!this.trip || !this.linked) return { status: "silent", say: "" };
    await this.trips.heartbeat(this.customerId, this.trip.id, this.callId);
    if (this.pending || this.driverConflict) return { status: "silent", say: "" };
    if (!this.engine) return { status: "silent", say: "" };
    const result = this.engine.update(await this.fix());
    if (result.status === "reroute") return this.refreshRoute(true);
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
