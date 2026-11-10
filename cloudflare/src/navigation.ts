import { z } from "zod";
import { bearer, type Env, HttpError, nowIso, secureEqual } from "./env";

export const GPS_MAX_AGE_MS = 120_000;
const MAX_BODY_BYTES = 32_768;
const deviceId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const positiveId = z.number().int().positive().safe();
const timestamp = z.string().datetime({ offset: true });
const ForwardSchema = z.object({
  device: z.object({ id: positiveId, uniqueId: deviceId }),
  position: z.object({
    // Traccar forwards positions before assigning their database ID.
    id: z.number().int().nonnegative().safe(),
    deviceId: positiveId,
    valid: z.boolean(),
    fixTime: timestamp,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    speed: z.number().finite().min(0).max(400),
    course: z.number().finite().min(0).max(360).nullable().optional(),
    accuracy: z.number().finite().min(0).nullable().optional(),
  }),
});
const DeviceSchema = z.object({
  device_id: deviceId,
  traccar_device_id: positiveId,
  label: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
});
const AssignmentSchema = z.object({ customer_id: z.string().min(1).max(100), device_id: deviceId });

interface Device {
  device_id: string;
  traccar_device_id: number;
  label: string;
  enabled: number;
  last_received_at_ms: number | null;
  last_report_at_ms: number | null;
  last_report_valid: number | null;
}
interface Position {
  source_position_id: number;
  fix_at_ms: number;
  received_at_ms: number;
  latitude: number;
  longitude: number;
  speed_mps: number;
  heading: number | null;
  accuracy_m: number | null;
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "Expected application/json");
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) throw new HttpError(413, "Payload too large");
  if (!request.body) throw new HttpError(422, "Missing JSON body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Payload too large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(422, "Invalid JSON"); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "Invalid navigation data");
  return parsed.data;
}

export async function receivePosition(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!env.TRACCAR_FORWARD_SECRET || env.TRACCAR_FORWARD_SECRET.length < 32) throw new HttpError(503, "GPS ingestion not configured");
  if (!secureEqual(bearer(request.headers.get("Authorization")), env.TRACCAR_FORWARD_SECRET)) throw new HttpError(401, "Unauthorized");
  const { device, position: p } = await body(request, ForwardSchema);
  if (device.id !== p.deviceId) throw new HttpError(422, "Device identity mismatch");
  const registered = await env.DB.prepare("SELECT device_id FROM navigation_devices WHERE device_id=? AND traccar_device_id=? AND enabled=1")
    .bind(device.uniqueId, device.id).first();
  if (!registered) throw new HttpError(403, "Device not enabled");
  const now = Date.now();
  const fix = Date.parse(p.fixTime);
  if (fix > now + 30_000) return json({ accepted: false, reason: "future_fix" }, 202);
  const reason = !p.valid ? "invalid_fix" : now - fix > GPS_MAX_AGE_MS ? "stale_fix" : (p.accuracy ?? 0) > 100 ? "inaccurate_fix" : null;
  const report = env.DB.prepare(`UPDATE navigation_devices SET
    last_received_at_ms=MAX(COALESCE(last_received_at_ms,0),?),
    last_report_valid=CASE WHEN last_report_at_ms IS NULL OR ? > last_report_at_ms THEN ? ELSE last_report_valid END,
    last_report_at_ms=MAX(COALESCE(last_report_at_ms,0),?)
    WHERE device_id=? AND enabled=1`).bind(now, fix, reason ? 0 : 1, fix, device.uniqueId);
  if (reason) { await report.run(); return json({ accepted: false, reason }, 202); }
  const speed = p.speed * 1852 / 3600;
  const heading = speed >= 1.5 ? p.course ?? null : null;
  const upsert = env.DB.prepare(`INSERT INTO navigation_positions
    (device_id,source_position_id,fix_at_ms,received_at_ms,latitude,longitude,speed_mps,heading,accuracy_m)
    SELECT ?,?,?,?,?,?,?,?,? FROM navigation_devices
      WHERE device_id=? AND enabled=1 AND last_report_valid=1 AND last_report_at_ms=?
    ON CONFLICT(device_id) DO UPDATE SET
      source_position_id=excluded.source_position_id,fix_at_ms=excluded.fix_at_ms,received_at_ms=excluded.received_at_ms,
      latitude=excluded.latitude,longitude=excluded.longitude,speed_mps=excluded.speed_mps,heading=excluded.heading,accuracy_m=excluded.accuracy_m
    WHERE excluded.fix_at_ms > navigation_positions.fix_at_ms`)
    .bind(device.uniqueId, p.id, fix, now, p.latitude, p.longitude, speed, heading, (p.accuracy ?? 0) > 0 ? p.accuracy : null, device.uniqueId, fix);
  const results = await env.DB.batch([report, upsert]);
  const accepted = results[1].meta.changes > 0;
  return json({ accepted, ...(accepted ? {} : { reason: "duplicate_or_out_of_order" }) });
}

export async function latestPosition(env: Env, id: string) {
  const device = await env.DB.prepare("SELECT * FROM navigation_devices WHERE device_id=?").bind(id).first<Device>();
  if (!device) throw new HttpError(404, "Device not found");
  const position = await env.DB.prepare("SELECT * FROM navigation_positions WHERE device_id=?").bind(id).first<Position>();
  const age = position ? Date.now() - position.fix_at_ms : null;
  const fresh = !!device.enabled && device.last_report_valid === 1 && age !== null && age >= -30_000 && age <= GPS_MAX_AGE_MS;
  return { device_id: id, label: device.label, enabled: !!device.enabled, last_received_at_ms: device.last_received_at_ms,
    last_report_valid: device.last_report_valid === 1, last_valid_fix_at_ms: position?.fix_at_ms ?? null,
    fresh, position: fresh ? position : null };
}

export async function customerPosition(env: Env, customerId: string) {
  const assignment = await env.DB.prepare("SELECT device_id FROM navigation_assignments WHERE customer_id=?").bind(customerId).first<{ device_id: string }>();
  return assignment ? latestPosition(env, assignment.device_id) : null;
}

export async function navigationAdmin(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/v1/admin/navigation/devices") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT device_id,traccar_device_id,label,enabled,last_received_at_ms,last_report_valid FROM navigation_devices ORDER BY device_id").all<Device>();
      return json(results);
    }
    if (request.method === "POST") {
      const d = await body(request, DeviceSchema);
      const other = await env.DB.prepare("SELECT device_id FROM navigation_devices WHERE traccar_device_id=? AND device_id<>?").bind(d.traccar_device_id, d.device_id).first();
      if (other) throw new HttpError(409, "Traccar identifier already registered");
      const existing = await env.DB.prepare("SELECT traccar_device_id FROM navigation_devices WHERE device_id=?").bind(d.device_id).first<Device>();
      if (existing && existing.traccar_device_id !== d.traccar_device_id) throw new HttpError(409, "Device identity cannot be reassigned");
      await env.DB.prepare(`INSERT INTO navigation_devices(device_id,traccar_device_id,label,enabled,created_at) VALUES(?,?,?,?,?)
        ON CONFLICT(device_id) DO UPDATE SET label=excluded.label,enabled=excluded.enabled`)
        .bind(d.device_id, d.traccar_device_id, d.label, d.enabled ? 1 : 0, nowIso()).run();
      return json({ device_id: d.device_id, enabled: d.enabled });
    }
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  }
  if (path === "/v1/admin/navigation/assignments" && request.method === "POST") {
    const a = await body(request, AssignmentSchema);
    const customer = await env.DB.prepare("SELECT customer_id FROM customer_phones WHERE customer_id=?").bind(a.customer_id).first();
    if (!customer) throw new HttpError(404, "Customer not found");
    await latestPosition(env, a.device_id);
    await env.DB.prepare(`INSERT INTO navigation_assignments(customer_id,device_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET device_id=excluded.device_id,updated_at=excluded.updated_at`)
      .bind(a.customer_id, a.device_id, nowIso()).run();
    return json({ assigned: true });
  }
  const match = path.match(/^\/v1\/admin\/navigation\/devices\/([a-zA-Z0-9_-]{1,80})\/position$/);
  if (match && request.method === "GET") return json(await latestPosition(env, match[1]));
  throw new HttpError(404, "Navigation endpoint not found");
}
