import { z } from "zod";
import { bearer, type Env, HttpError, nowIso, secureEqual, settings } from "./env";
import { ProgressStore } from "./progress";

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
    protocol: z.string().optional(),
    attributes: z.object({ batteryLevel: z.unknown().optional(), charge: z.unknown().optional(), io8: z.unknown().optional() }).optional(),
  }),
});
const DeviceSchema = z.object({
  device_id: deviceId,
  traccar_device_id: positiveId,
  label: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
});
const AssignmentSchema = z.object({ customer_id: z.string().min(1).max(100), device_id: deviceId });
const CustomerIdSchema = z.object({ customer_id: z.string().min(1).max(100) });
const DestinationSchema = z.object({ label: z.string().trim().min(1).max(80), address: z.string().trim().min(3).max(300) });

interface Device {
  device_id: string;
  traccar_device_id: number;
  label: string;
  enabled: number;
  last_received_at_ms: number | null;
  last_report_at_ms: number | null;
  last_report_valid: number | null;
  battery_level_pct: number | null;
  battery_at_ms: number | null;
  charging: number | null;
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

export async function navigationBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
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
  const { device, position: p } = await navigationBody(request, ForwardSchema);
  if (device.id !== p.deviceId) throw new HttpError(422, "Device identity mismatch");
  const registered = await env.DB.prepare("SELECT device_id FROM navigation_devices WHERE device_id=? AND traccar_device_id=? AND enabled=1")
    .bind(device.uniqueId, device.id).first();
  if (!registered) throw new HttpError(403, "Device not enabled");
  const now = Date.now();
  const fix = Date.parse(p.fixTime);
  if (fix > now + 30_000) return json({ accepted: false, reason: "future_fix" }, 202);
  const reason = !p.valid ? "invalid_fix" : now - fix > GPS_MAX_AGE_MS ? "stale_fix" : (p.accuracy ?? 0) > 100 ? "inaccurate_fix" : null;
  const level = z.number().finite().min(0).max(100).safeParse(p.attributes?.batteryLevel);
  const batteryLevel = level.success ? level.data : h02Battery(p.protocol, p.attributes?.io8);
  const charging = typeof p.attributes?.charge === "boolean" ? (p.attributes.charge ? 1 : 0) : null;
  const report = env.DB.prepare(`UPDATE navigation_devices SET
    last_received_at_ms=MAX(COALESCE(last_received_at_ms,0),?),
    battery_level_pct=CASE WHEN last_report_at_ms IS NULL OR ? > last_report_at_ms THEN ? ELSE battery_level_pct END,
    battery_at_ms=CASE WHEN last_report_at_ms IS NULL OR ? > last_report_at_ms THEN ? ELSE battery_at_ms END,
    charging=CASE WHEN last_report_at_ms IS NULL OR ? > last_report_at_ms THEN ? ELSE charging END,
    last_report_valid=CASE WHEN last_report_at_ms IS NULL OR ? > last_report_at_ms THEN ? ELSE last_report_valid END,
    last_report_at_ms=MAX(COALESCE(last_report_at_ms,0),?)
    WHERE device_id=? AND enabled=1`).bind(now, fix, batteryLevel, fix, batteryLevel !== null || charging !== null ? fix : null,
      fix, charging, fix, reason ? 0 : 1, fix, device.uniqueId);
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
  const history = env.DB.prepare(`INSERT OR IGNORE INTO navigation_position_history
    (device_id,fix_at_ms,latitude,longitude,speed_mps,heading,accuracy_m)
    SELECT ?,?,?,?,?,?,? FROM navigation_devices WHERE device_id=? AND enabled=1 AND last_report_valid=1 AND last_report_at_ms=?`)
    .bind(device.uniqueId, fix, p.latitude, p.longitude, speed, heading, (p.accuracy ?? 0) > 0 ? p.accuracy : null, device.uniqueId, fix);
  const results = await env.DB.batch([report, upsert, history]);
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
    battery: { level_percent: device.battery_level_pct, reported_at_ms: device.battery_at_ms, charging: device.charging === null ? null : device.charging === 1 },
    fresh, position: fresh ? position : null };
}

export async function customerPosition(env: Env, customerId: string) {
  const assignment = await env.DB.prepare("SELECT device_id FROM navigation_assignments WHERE customer_id=?").bind(customerId).first<{ device_id: string }>();
  return assignment ? latestPosition(env, assignment.device_id) : null;
}

/** SinoTrack V8 reports append satellites, GSM signal, an unverified field and the battery percentage, which Traccar stores as io5..io8. */
export function h02Battery(protocol: string | undefined, value: unknown): number | null {
  if (protocol !== "h02" || typeof value !== "string" || !/^\d{1,3}$/.test(value.trim())) return null;
  const level = Number(value);
  return level <= 100 ? level : null;
}

const parse = (text: string | null | undefined) => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } };

/** Every navigation call, newest first, including calls recorded before full tracing existed. */
export async function navigationCalls(env: Env, bots: string[], limit: number, offset: number) {
  if (!bots.length) return [];
  const ph = bots.map(() => "?").join(",");
  const { results: calls } = await env.DB.prepare(`SELECT call_id, MIN(created_at) AS created_at, MIN(profile_id) AS profile_id FROM (
    SELECT call_id, created_at, profile_id FROM prompt_snapshots WHERE profile_id IN (${ph})
    UNION ALL SELECT call_id, created_at, profile_id FROM diagnostic_events WHERE profile_id IN (${ph})
    UNION ALL SELECT call_id, created_at, profile_id FROM conversation_turns WHERE profile_id IN (${ph}))
    GROUP BY call_id ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...bots, ...bots, ...bots, limit, offset).all<Record<string, string>>();
  const out = [];
  for (const c of calls) {
    const [snapshot, turns, events, latency, session, costs, usage] = await Promise.all([
      env.DB.prepare("SELECT system_instruction, opening_message, setup_json, bot_version FROM prompt_snapshots WHERE call_id=?").bind(c.call_id).all<Record<string, any>>(),
      env.DB.prepare("SELECT created_at, direction, text, metadata_json FROM conversation_turns WHERE call_id=? ORDER BY id").bind(c.call_id).all<Record<string, any>>(),
      env.DB.prepare("SELECT created_at, event_type, details_json FROM diagnostic_events WHERE call_id=? ORDER BY id").bind(c.call_id).all<Record<string, any>>(),
      env.DB.prepare("SELECT created_at, event_name, since_call_start_ms, details_json FROM latency_events WHERE call_id=? ORDER BY id").bind(c.call_id).all<Record<string, any>>(),
      env.DB.prepare("SELECT started_at, ended_at, duration_seconds, learner_turns, tutor_turns, estimated_cost_usd, model FROM sessions WHERE call_id=?").bind(c.call_id).all<Record<string, any>>(),
      env.DB.prepare("SELECT summary_json FROM navigation_call_costs WHERE call_id=?").bind(c.call_id).all<Record<string, any>>(),
      env.DB.prepare("SELECT channel,model,reported_at,usage_json FROM navigation_usage_events WHERE call_id=? ORDER BY id").bind(c.call_id).all<Record<string, any>>(),
    ]);
    const s = snapshot.results[0];
    out.push({ call_id: c.call_id, created_at: c.created_at, profile_id: c.profile_id, has_prompt: !!s,
      system_instruction: s?.system_instruction ?? "", opening_message: s?.opening_message ?? "", bot_version: s ? Number(s.bot_version) : null,
      setup_message: s ? parse(s.setup_json) : null, session: session.results[0] ?? null,
      cost: costs.results[0] ? parse(costs.results[0].summary_json) : null,
      reported_usage: usage.results.map((r) => ({ channel: r.channel, model: r.model, reported_at: r.reported_at, usage: parse(r.usage_json) })),
      turns: turns.results.map((r) => ({ created_at: r.created_at, direction: r.direction, text: r.text, metadata: parse(r.metadata_json) })),
      events: events.results.map((r) => ({ created_at: r.created_at, event_type: r.event_type, details: parse(r.details_json) })),
      latency: latency.results.map((r) => ({ created_at: r.created_at, event_name: r.event_name, since_call_start_ms: r.since_call_start_ms, details: parse(r.details_json) })) });
  }
  return out;
}

export async function navigationAdmin(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/v1/admin/navigation/calls" && request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const limit = Math.max(1, Math.min(Number(params.get("limit")) || 15, 50));
    const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
    return json(await navigationCalls(env, settings(env).navigationBotIds, limit, offset));
  }
  if (path === "/v1/admin/navigation/customers" && request.method === "GET") {
    const { results } = await env.DB.prepare(`SELECT p.customer_id,p.phone,
      COALESCE(json_extract(c.body,'$.name'),'') AS name,a.device_id
      FROM customer_phones p LEFT JOIN console_records c ON c.kind='customers' AND c.id=p.customer_id
      LEFT JOIN navigation_assignments a ON a.customer_id=p.customer_id ORDER BY p.customer_id`).all();
    return json(results);
  }
  const destinationPath = path.match(/^\/v1\/admin\/navigation\/customers\/([a-zA-Z0-9_-]{1,100})\/destinations(?:\/([a-zA-Z0-9_-]{1,80}))?$/);
  if (destinationPath) {
    const [, customerId, destinationId] = destinationPath;
    const customer = await env.DB.prepare("SELECT customer_id FROM customer_phones WHERE customer_id=?").bind(customerId).first();
    if (!customer) throw new HttpError(404, "Customer not found");
    if (!destinationId && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id,label,address,updated_at FROM navigation_destinations WHERE customer_id=? ORDER BY updated_at DESC")
        .bind(customerId).all();
      return json(results);
    }
    if (!destinationId && request.method === "POST") {
      const d = await navigationBody(request, DestinationSchema);
      const id = crypto.randomUUID();
      const now = nowIso();
      await env.DB.prepare("INSERT INTO navigation_destinations(id,customer_id,label,address,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .bind(id, customerId, d.label, d.address, now, now).run();
      return json({ id, ...d }, 201);
    }
    if (destinationId && request.method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM navigation_destinations WHERE id=? AND customer_id=?").bind(destinationId, customerId).run();
      if (!result.meta.changes) throw new HttpError(404, "Destination not found");
      return json({ deleted: true });
    }
    return new Response(null, { status: 405, headers: { Allow: destinationId ? "DELETE" : "GET, POST" } });
  }
  if (path === "/v1/admin/navigation/devices") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT device_id,traccar_device_id,label,enabled,last_received_at_ms,last_report_valid FROM navigation_devices ORDER BY device_id").all<Device>();
      return json(results);
    }
    if (request.method === "POST") {
      const d = await navigationBody(request, DeviceSchema);
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
    const a = await navigationBody(request, AssignmentSchema);
    const customer = await env.DB.prepare("SELECT customer_id FROM customer_phones WHERE customer_id=?").bind(a.customer_id).first();
    if (!customer) throw new HttpError(404, "Customer not found");
    await latestPosition(env, a.device_id);
    await env.DB.prepare(`INSERT INTO navigation_assignments(customer_id,device_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET device_id=excluded.device_id,updated_at=excluded.updated_at`)
      .bind(a.customer_id, a.device_id, nowIso()).run();
    return json({ assigned: true });
  }
  if (path === "/v1/admin/navigation/assignments" && request.method === "DELETE") {
    const a = await navigationBody(request, CustomerIdSchema);
    await env.DB.prepare("DELETE FROM navigation_assignments WHERE customer_id=?").bind(a.customer_id).run();
    return json({ assigned: false });
  }
  const match = path.match(/^\/v1\/admin\/navigation\/devices\/([a-zA-Z0-9_-]{1,80})\/position$/);
  if (match && request.method === "GET") return json(await latestPosition(env, match[1]));
  throw new HttpError(404, "Navigation endpoint not found");
}
