import { z } from "zod";
import { type Env, HttpError } from "./env";
import { customerPosition, navigationBody } from "./navigation";

export const SHORT_RECONNECT_MS = 5 * 60_000;
export const CALL_LEASE_MS = 90_000;
const StartSchema = z.object({
  destination_label: z.string().trim().min(1).max(80),
  destination_address: z.string().trim().min(3).max(300),
  eta_at_ms: z.number().int().positive().safe().optional(),
}).strict();
const CallSchema = z.object({ call_id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) }).strict();
const ConnectSchema = CallSchema.extend({ confirm: z.boolean().default(false) });
const FinishSchema = z.object({ status: z.enum(["completed", "cancelled"]) }).strict();

interface Trip {
  id: string;
  customer_id: string;
  device_id: string;
  destination_label: string;
  destination_address: string;
  status: "active" | "completed" | "cancelled";
  eta_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
  ended_at_ms: number | null;
  last_call_id: string | null;
  connected_at_ms: number | null;
  disconnected_at_ms: number | null;
  call_lease_until_ms: number | null;
  revision: number;
}
type Reason = "no_active_trip" | "no_device" | "device_disabled" | "device_changed" | "gps_unavailable" |
  "same_call" | "another_call_active" | "connection_lost" | "first_connection" | "short_disconnect" | "eta_elapsed" | "long_disconnect";
interface Decision {
  action: "new_trip" | "resume" | "confirm" | "blocked";
  reason: Reason;
  trip: Trip | null;
  prompt: string;
}

export class NavigationTrips {
  constructor(private env: Env) {}

  private async customer(customerId: string) {
    if (!await this.env.DB.prepare("SELECT customer_id FROM customer_phones WHERE customer_id=?").bind(customerId).first()) {
      throw new HttpError(404, "Customer not found");
    }
  }

  async current(customerId: string): Promise<Trip | null> {
    await this.customer(customerId);
    return this.env.DB.prepare("SELECT * FROM navigation_trips WHERE customer_id=? AND status='active'").bind(customerId).first<Trip>();
  }

  async get(customerId: string, tripId: string): Promise<Trip> {
    const trip = await this.env.DB.prepare("SELECT * FROM navigation_trips WHERE customer_id=? AND id=?").bind(customerId, tripId).first<Trip>();
    if (!trip) throw new HttpError(404, "Trip not found");
    return trip;
  }

  async start(customerId: string, data: z.output<typeof StartSchema>): Promise<Trip> {
    await this.customer(customerId);
    const location = await customerPosition(this.env, customerId);
    if (!location?.enabled) throw new HttpError(409, "An enabled assigned device is required");
    const now = Date.now();
    if (data.eta_at_ms !== undefined && (data.eta_at_ms <= now || data.eta_at_ms > now + 30 * 86400_000)) {
      throw new HttpError(422, "Invalid ETA");
    }
    const id = crypto.randomUUID();
    const result = await this.env.DB.prepare(`INSERT INTO navigation_trips
      (id,customer_id,device_id,destination_label,destination_address,eta_at_ms,created_at_ms,updated_at_ms)
      SELECT ?,a.customer_id,a.device_id,?,?,?,?,? FROM navigation_assignments a
      JOIN navigation_devices d ON d.device_id=a.device_id AND d.enabled=1
      WHERE a.customer_id=? AND a.device_id=?
        AND NOT EXISTS(SELECT 1 FROM navigation_trips WHERE (customer_id=? OR device_id=a.device_id) AND status='active')`)
      .bind(id, data.destination_label, data.destination_address, data.eta_at_ms ?? null, now, now,
        customerId, location.device_id, customerId).run();
    if (!result.meta.changes) throw new HttpError(409, "An active trip exists or the device assignment changed");
    return this.get(customerId, id);
  }

  async reconnect(customerId: string, callId: string): Promise<Decision> {
    const trip = await this.current(customerId);
    const location = await customerPosition(this.env, customerId);
    const result = (action: Decision["action"], reason: Reason, prompt: string): Decision => ({ action, reason, trip, prompt });
    if (!location) return result("blocked", "no_device", "לא משויך מכשיר איתור. יש לבדוק את השיוך לפני ניווט.");
    if (!location.enabled) return result("blocked", "device_disabled", "מכשיר האיתור מושבת. לא ניתן להתחיל ניווט.");
    if (!trip) return result("new_trip", "no_active_trip", "לאן תרצה להגיע?");
    if (trip.device_id !== location.device_id) return result("blocked", "device_changed", "מכשיר האיתור הוחלף. יש לפתוח נסיעה חדשה לאחר אימות השיוך.");
    const liveCall = trip.last_call_id && trip.disconnected_at_ms === null && (trip.call_lease_until_ms ?? 0) > Date.now();
    if (liveCall && trip.last_call_id !== callId) {
      return result("blocked", "another_call_active", "כבר מקושרת שיחה לנסיעה. אין לחבר שיחה נוספת במקביל.");
    }
    if (!location.fresh) return result("blocked", "gps_unavailable", "אין מיקום GPS עדכני. לא אתן הוראות נהיגה עד שיתקבל מיקום אמין.");
    if (liveCall && trip.last_call_id === callId) return result("resume", "same_call", "הנסיעה מקושרת לשיחה זו.");
    if (!trip.last_call_id) return result("confirm", "first_connection", `להתחיל נסיעה אל ${trip.destination_label}?`);
    if (trip.disconnected_at_ms === null) return result("confirm", "connection_lost", `הקשר לשיחה הקודמת אבד. האם אתה עדיין בדרך אל ${trip.destination_label}?`);
    const age = trip.disconnected_at_ms === null ? Infinity : Date.now() - trip.disconnected_at_ms;
    if (trip.eta_at_ms !== null && trip.eta_at_ms <= Date.now()) {
      return result("confirm", "eta_elapsed", `האם אתה עדיין בדרך אל ${trip.destination_label}?`);
    }
    if (age >= 0 && age <= SHORT_RECONNECT_MS) return result("resume", "short_disconnect", "נמצאה נסיעה פעילה עם מיקום עדכני.");
    return result("confirm", "long_disconnect", `האם אתה עדיין בדרך אל ${trip.destination_label}?`);
  }

  async connect(customerId: string, tripId: string, callId: string, confirm: boolean): Promise<Decision> {
    const trip = await this.get(customerId, tripId);
    if (trip.status !== "active") throw new HttpError(409, "Trip is no longer active");
    const decision = await this.reconnect(customerId, callId);
    if (decision.trip?.id !== tripId) throw new HttpError(409, "Active trip changed");
    if (decision.action === "blocked" || (decision.action === "confirm" && !confirm)) return decision;
    if (decision.reason === "same_call") return decision;
    const now = Date.now();
    const update = await this.env.DB.prepare(`UPDATE navigation_trips SET
      last_call_id=?,connected_at_ms=?,disconnected_at_ms=NULL,call_lease_until_ms=?,updated_at_ms=?,revision=revision+1
      WHERE id=? AND customer_id=? AND status='active' AND revision=?
        AND EXISTS(SELECT 1 FROM navigation_assignments a JOIN navigation_devices d ON d.device_id=a.device_id
          WHERE a.customer_id=? AND a.device_id=navigation_trips.device_id AND d.enabled=1)`)
      .bind(callId, now, now + CALL_LEASE_MS, now, tripId, customerId, trip.revision, customerId).run();
    if (!update.meta.changes) throw new HttpError(409, "Trip changed; check reconnect state again");
    return { ...decision, action: "resume", trip: await this.get(customerId, tripId), prompt: "הנסיעה מקושרת לשיחה. מנוע ההנחיה הקולית עדיין אינו פעיל." };
  }

  async heartbeat(customerId: string, tripId: string, callId: string): Promise<Trip> {
    await this.get(customerId, tripId);
    const now = Date.now();
    const update = await this.env.DB.prepare(`UPDATE navigation_trips SET call_lease_until_ms=?,updated_at_ms=?,revision=revision+1
      WHERE id=? AND customer_id=? AND status='active' AND last_call_id=? AND disconnected_at_ms IS NULL
        AND EXISTS(SELECT 1 FROM navigation_assignments a JOIN navigation_devices d ON d.device_id=a.device_id
          WHERE a.customer_id=? AND a.device_id=navigation_trips.device_id AND d.enabled=1)`)
      .bind(now + CALL_LEASE_MS, now, tripId, customerId, callId, customerId).run();
    if (!update.meta.changes) throw new HttpError(409, "Call is not linked to this active trip");
    return this.get(customerId, tripId);
  }

  async disconnect(customerId: string, tripId: string, callId: string): Promise<Trip> {
    const trip = await this.get(customerId, tripId);
    if (trip.status !== "active" || trip.last_call_id !== callId) throw new HttpError(409, "Call is not linked to this active trip");
    if (trip.disconnected_at_ms !== null) return trip;
    const now = Date.now();
    const update = await this.env.DB.prepare(`UPDATE navigation_trips SET disconnected_at_ms=?,call_lease_until_ms=NULL,updated_at_ms=?,revision=revision+1
      WHERE id=? AND customer_id=? AND status='active' AND last_call_id=? AND disconnected_at_ms IS NULL AND revision=?`)
      .bind(now, now, tripId, customerId, callId, trip.revision).run();
    if (!update.meta.changes) throw new HttpError(409, "Trip changed; disconnect ignored");
    return this.get(customerId, tripId);
  }

  async finish(customerId: string, tripId: string, status: "completed" | "cancelled"): Promise<Trip> {
    const trip = await this.get(customerId, tripId);
    if (trip.status === status) return trip;
    if (trip.status !== "active") throw new HttpError(409, "Trip already ended");
    const now = Date.now();
    const update = await this.env.DB.prepare(`UPDATE navigation_trips SET status=?,ended_at_ms=?,call_lease_until_ms=NULL,updated_at_ms=?,revision=revision+1
      WHERE id=? AND customer_id=? AND status='active' AND revision=?`).bind(status, now, now, tripId, customerId, trip.revision).run();
    if (!update.meta.changes) throw new HttpError(409, "Trip changed; check state again");
    return this.get(customerId, tripId);
  }
}

export async function navigationTripsAdmin(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/v1\/admin\/navigation\/customers\/([a-zA-Z0-9_-]{1,100})\/(reconnect|trips)(?:\/([a-zA-Z0-9_-]{1,80})(?:\/(connect|disconnect|finish|heartbeat))?)?$/);
  if (!match) return null;
  const [, customerId, resource, tripId, action] = match;
  const trips = new NavigationTrips(env);
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (resource === "reconnect") {
    if (tripId) throw new HttpError(404, "Navigation endpoint not found");
    if (request.method === "POST") {
      const data = await navigationBody(request, CallSchema);
      return json(await trips.reconnect(customerId, data.call_id));
    }
  } else if (!tripId) {
    if (request.method === "GET") return json({ trip: await trips.current(customerId) });
    if (request.method === "POST") return json(await trips.start(customerId, await navigationBody(request, StartSchema)), 201);
  } else if (!action && request.method === "GET") {
    return json(await trips.get(customerId, tripId));
  } else if (action && request.method === "POST") {
    if (action === "finish") {
      const data = await navigationBody(request, FinishSchema);
      return json(await trips.finish(customerId, tripId, data.status));
    }
    if (action === "connect") {
      const data = await navigationBody(request, ConnectSchema);
      return json(await trips.connect(customerId, tripId, data.call_id, data.confirm));
    }
    const data = await navigationBody(request, CallSchema);
    if (action === "heartbeat") return json(await trips.heartbeat(customerId, tripId, data.call_id));
    return json(await trips.disconnect(customerId, tripId, data.call_id));
  }
  return new Response(null, { status: 405, headers: { Allow: resource === "trips" && !action ? (tripId ? "GET" : "GET, POST") : "POST" } });
}
