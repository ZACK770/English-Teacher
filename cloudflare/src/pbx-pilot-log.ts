import type { Env } from "./env";

type Stage =
  | "upgrade_arrived" | "not_configured" | "missing_upgrade" | "durable_rejected" | "durable_failed"
  | "socket_accepted" | "socket_busy" | "start_timeout" | "start_received" | "start_rejected"
  | "channel_mismatch" | "start_validated" | "caller_not_visible" | "pre_session_failure"
  | "socket_closed" | "socket_error";

export function pilotLog(env: Env, stage: Stage, details: Record<string, boolean | number> = {}) {
  if (env.PBX_CASCADE_PILOT !== "1") return Promise.resolve();
  console.log("PBX pilot", stage, details);
  return env.DB.prepare(
    "INSERT INTO diagnostic_events (created_at, profile_id, call_id, event_type, details_json) VALUES (?, ?, ?, ?, ?)",
  ).bind(new Date().toISOString(), "isaac-basic", "pilot-888", "pilot_transport", JSON.stringify({ stage, ...details }))
    .run().then(() => {}, () => {});
}
