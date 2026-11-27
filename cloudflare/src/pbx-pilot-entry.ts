import { type Env } from "./env";
import { pilotSettingsPage } from "./pbx-pilot-settings-page";
import { pilotLog } from "./pbx-pilot-log";
export { CallSession } from "./call";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const configured = env.PBX_CASCADE_PILOT === "1" && !!env.TEST_TEACHER_CHANNEL_ID &&
      !!env.PBX_PILOT_SONIOX_KEY && !!env.PBX_PILOT_OPENROUTER_KEY && !!env.PBX_PILOT_INWORLD_KEY;
    if (path === "/healthz") return Response.json({ ok: true, configured });
    if (path === "/pilot-settings" && request.method === "GET" && env.PBX_PILOT_ADMIN_TOKEN) return pilotSettingsPage();
    if (path === "/v1/admin/pilot/settings") {
      const call = env.CALLS.get(env.CALLS.idFromName("extension-888"), { locationHint: "weur" });
      return call.fetch(request);
    }
    if (path !== "/v1/technoline/pilot") return new Response("Not found", { status: 404 });
    const trace = (...args: Parameters<typeof pilotLog>) => { if (ctx) ctx.waitUntil(pilotLog(...args)); };
    if (!configured) {
      trace(env, "not_configured");
      return new Response("Pilot not configured", { status: 503 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      trace(env, "missing_upgrade");
      return new Response("Expected WebSocket", { status: 426 });
    }
    trace(env, "upgrade_arrived");
    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    headers.delete("X-Shared-Router");
    headers.delete("X-Portal-Customer");
    headers.delete("X-Portal-Teacher");
    headers.set("X-Profile", "isaac-basic");
    const call = env.CALLS.get(env.CALLS.idFromName("extension-888"), { locationHint: "weur" });
    try {
      const response = await call.fetch(new Request(request, { headers }));
      if (response.status !== 101) trace(env, "durable_rejected", { status: response.status });
      return response;
    } catch (error) {
      trace(env, "durable_failed");
      throw error;
    }
  },
};
