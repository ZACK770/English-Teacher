import { type Env, bearer, secureEqual, settings, HttpError } from "./env";
import { handleCallback } from "./pbx";
import { handleAdmin, handlePortal, handleStatic, publicNarration } from "./api";
import { handleWebhook } from "./payments";
import { webTurn } from "./learn";
import { syncCrm } from "./crm";
import { dispatchCallbacks, submitCallback } from "./callbacks";
export { CallSession } from "./call";

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const s = settings(env);
  const path = url.pathname.replace(/^\/english(\/|$)/, "/") || "/";
  if (path === "/healthz") return Response.json({ status: "ok", service: "english-engine" });
  if (path === "/") return Response.json({ service: "English school voice engine", health: "/healthz", websocket: "/v1/technoline/stream", status: "test deployment" });
  if (path === "/readyz") {
    const configured = !!env.GEMINI_API_KEY && !!env.ADMIN_BEARER_SECRET;
    const db = await env.DB.prepare("SELECT COUNT(*) AS n FROM bots").first<{ n: number }>();
    return Response.json({ status: configured && db?.n ? "ready" : "not_ready", profiles: db?.n ?? 0 }, { status: configured && db?.n ? 200 : 503 });
  }
  const streaming = path === "/v1/technoline/stream" || path.startsWith("/v1/technoline/stream/") || path === "/v1/technoline/router";
  if (streaming) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (s.enforceBearer && !secureEqual(bearer(request.headers.get("Authorization")), s.bearerSecret)) throw new HttpError(401, "Unauthorized");
    let profile: string | null = null;
    if (path.startsWith("/v1/technoline/stream/")) {
      profile = decodeURIComponent(path.slice("/v1/technoline/stream/".length).replace(/^bots\//, ""));
      if (!/^[a-z][a-z0-9-]{1,62}$/.test(profile)) throw new HttpError(404, "Unknown profile");
    }
    if (path === "/v1/technoline/router" && (!s.projectEnabled || !s.routerChannel)) throw new HttpError(503, "Router unavailable");
    const headers = new Headers(request.headers);
    headers.delete("X-Profile"); headers.delete("X-Shared-Router");
    if (profile) headers.set("X-Profile", profile);
    if (path === "/v1/technoline/router") headers.set("X-Shared-Router", "1");
    const stub = env.CALLS.get(env.CALLS.newUniqueId(), { locationHint: "weur" });
    return stub.fetch(new Request(request, { headers }));
  }
  if (path.startsWith("/v1/technoline/ivr/")) {
    return Response.json(await handleCallback(request, env, s, path.slice("/v1/technoline/ivr/".length)));
  }
  const narration = path.match(/^\/v1\/technoline\/narrations\/([^/]+)\/([a-f0-9]{64})\.wav$/);
  if (narration && request.method === "GET") return publicNarration(env, decodeURIComponent(narration[1]), narration[2]);
  if (path === "/v1/payments/nedarim/webhook" && request.method === "POST") return Response.json(await handleWebhook(request, env));
  if (path.startsWith("/v1/admin/") || path.startsWith("/v1/progress/")) {
    if (!secureEqual(bearer(request.headers.get("Authorization")), env.ADMIN_BEARER_SECRET)) throw new HttpError(401, "Unauthorized");
    const response = await handleAdmin(request, env, s, path);
    if (response) return response;
  }
  if (path === "/v1/public/callback" && request.method === "POST") return submitCallback(request, env);
  const turn = path.match(/^\/v1\/bots\/([a-z][a-z0-9-]{1,62})\/turn$/);
  if (turn && request.method === "POST") return webTurn(request, env, s, turn[1]);
  const portal = await handlePortal(request, env, path);
  if (portal) return portal;
  const asset = await handleStatic(request, env, path);
  if (asset) return asset;
  return Response.json({ detail: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); }
    catch (error) {
      if (error instanceof HttpError) return Response.json({ detail: error.detail }, { status: error.status });
      return Response.json({ detail: "Request failed" }, { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncCrm(env).catch(() => undefined));
    ctx.waitUntil(dispatchCallbacks(env).catch(() => undefined));
  },
};
