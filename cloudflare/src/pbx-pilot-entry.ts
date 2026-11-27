import { channelId } from "./yiddish-channel";
import { adminSessionIdentity } from "./admin-auth";
import { type Env } from "./env";
import { pilotSettingsPage } from "./pbx-pilot-settings-page";
import { pilotLab } from "./pbx-pilot-lab";
import { pilotLog } from "./pbx-pilot-log";
export { CallSession } from "./call";

export default {
  async fetch(request: Request, env: Env & { ADMIN_DB?: D1Database }, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const configured = env.PBX_CASCADE_PILOT === "1" && !!env.TEST_TEACHER_CHANNEL_ID &&
      !!env.PBX_PILOT_SONIOX_KEY && !!env.PBX_PILOT_OPENROUTER_KEY && !!env.PBX_PILOT_INWORLD_KEY;
    if (path === "/healthz") return Response.json({ ok: true, configured });
    const dashboardPath = "/dashboard/pilot-888";
    if (path === "/pilot-settings" && request.method === "GET") {
      return Response.redirect("https://speakcall.app" + dashboardPath, 302);
    }
    if ((path === dashboardPath || path.startsWith(dashboardPath + "/")) &&
        (url.hostname === "speakcall.app" || url.hostname === "speakool.net")) {
      if (path === dashboardPath && request.method === "GET") {
        if (url.searchParams.get("embedded") !== "1") return Response.redirect(url.origin + "/dashboard/crm?view=voice-lab", 302);
        return pilotSettingsPage();
      }
      if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!env.ADMIN_DB) return new Response("Pilot settings unavailable", { status: 503 });
      const identity = await adminSessionIdentity(request, env.ADMIN_DB);
      if (!identity) return new Response("Unauthorized", { status: 401 });
      if (identity.role !== "owner") return new Response("Forbidden", { status: 403 });
      if (path === dashboardPath + "/channels" && ["GET","POST"].includes(request.method)) {
        if (!env.YIDDISH_CHANNELS) return new Response("Unavailable", { status: 503 });
        return env.YIDDISH_CHANNELS.get(env.YIDDISH_CHANNELS.idFromName("registry"), { locationHint: "weur" }).fetch(new Request("https://internal.invalid/registry", { method:request.method,body:request.method==="POST"?await request.arrayBuffer():undefined }));
      }
      const channelRoute=path.match(/\/channels\/([a-z][a-z0-9-]{1,39})\/(settings|preview)$/);
      if ((path === dashboardPath + "/yiddish-settings" && ["GET","PUT"].includes(request.method)) || (channelRoute&&channelId(channelRoute[1])&&((channelRoute[2]==="settings"&&["GET","PUT"].includes(request.method))||(channelRoute[2]==="preview"&&request.method==="POST")))) {
        if (!env.YIDDISH_CHANNELS) return new Response("Unavailable", { status: 503 });
        const id=channelRoute?.[1]||"yiddish";const action=channelRoute?.[2]||"settings";
        const registry=await env.YIDDISH_CHANNELS.get(env.YIDDISH_CHANNELS.idFromName("registry")).fetch("https://internal.invalid/registry");const {channels}=await registry.json<{channels:{id:string}[]}>();if(!channels.some(c=>c.id===id))return new Response("Not found",{status:404});
        return env.YIDDISH_CHANNELS.get(env.YIDDISH_CHANNELS.idFromName(id), { locationHint: "weur" }).fetch(new Request("https://internal.invalid/"+action+"?channel="+id, { method: request.method, body: request.method!=="GET"?await request.arrayBuffer():undefined }));
      }
      if (path !== dashboardPath + "/settings") return pilotLab(request, env, path.slice(dashboardPath.length + 1));
      if (!["GET", "PUT"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
      if (!env.PBX_PILOT_ADMIN_TOKEN) return new Response("Pilot settings unavailable", { status: 503 });
      const headers = new Headers();
      headers.set("Authorization", "Bearer " + env.PBX_PILOT_ADMIN_TOKEN);
      const settingsUrl = new URL("/v1/admin/pilot/settings", url);
      if (request.method === "GET" && url.searchParams.get("export") === "1") settingsUrl.searchParams.set("export", "1");
      const settingsRequest = new Request(settingsUrl, {
        method: request.method,
        headers,
        body: request.method === "PUT" ? await request.arrayBuffer() : undefined,
      });
      return env.CALLS.get(env.CALLS.idFromName("extension-888"), { locationHint: "weur" }).fetch(settingsRequest);
    }
    if (path === "/v1/admin/pilot/settings") {
      const call = env.CALLS.get(env.CALLS.idFromName("extension-888"), { locationHint: "weur" });
      return call.fetch(request);
    }
    const dynamic=path.match(/^\/v1\/technoline\/([a-z][a-z0-9-]{1,39})$/);
    if(dynamic&&channelId(dynamic[1])&&env.YIDDISH_CHANNELS){const id=dynamic[1];const registry=await env.YIDDISH_CHANNELS.get(env.YIDDISH_CHANNELS.idFromName("registry")).fetch("https://internal.invalid/registry");const {channels}=await registry.json<{channels:{id:string}[]}>();if(!channels.some(c=>c.id===id))return new Response("Not found",{status:404});return env.YIDDISH_CHANNELS.get(env.YIDDISH_CHANNELS.idFromName(id),{locationHint:"weur"}).fetch(request);}
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
