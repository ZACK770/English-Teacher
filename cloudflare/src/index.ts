import { type Env, bearer, secureEqual, settings, HttpError } from "./env";
import { handleCallback } from "./pbx";
import { handleAdmin, handlePortal, handleStatic, publicNarration } from "./api";
import { handleWebhook } from "./payments";
import { webTurn } from "./learn";
import { syncCrm } from "./crm";
import { dispatchCallbacks, submitCallback } from "./callbacks";
import { navigationAdmin, receivePosition } from "./navigation";
import { navigationTripsAdmin } from "./navigation-trips";
import { handleApp, platformAdmin, POSITION_HISTORY_DAYS } from "./platform";
export { CallSession } from "./call";

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const s = settings(env);
  const path = url.pathname.replace(/^\/english(\/|$)/, "/") || "/";
  const page = path.replace(/\/$/, "");
  if (page === "/navigation" || page === "/app" || page === "/join-navigation") {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const asset = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
    const html = (await asset.text()).replace(/<title>[^<]*<\/title>/, `<title>${page === "/navigation" ? "וייז כשר · ניהול" : page === "/app" ? "וייז כשר · האזור האישי" : "וייז כשר · הצטרפות"}</title>`)
      .replace(/<link\b[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, "");
    return new Response(request.method === "HEAD" ? null : html, { status: asset.status, headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://www.openstreetmap.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    } });
  }
  if (path === "/healthz") return Response.json({ status: "ok", service: "english-engine" });
  if (path === "/v1/navigation/positions") return receivePosition(request, env);
  if (path === "/status" || path === "/api/status") return Response.json({ service: "English school voice engine", health: "/healthz", websocket: "/v1/technoline/stream", status: "production" });
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
    if (path.startsWith("/v1/admin/navigation/")) return await navigationTripsAdmin(request, env, path) ?? navigationAdmin(request, env, path);
    if (path.startsWith("/v1/admin/app/")) return platformAdmin(request, env, path);
    const response = await handleAdmin(request, env, s, path);
    if (response) return response;
  }
  if (path === "/v1/public/callback" && request.method === "POST") return submitCallback(request, env);
  const app = await handleApp(request, env, path);
  if (app) return app;
  const turn = path.match(/^\/v1\/bots\/([a-z][a-z0-9-]{1,62})\/turn$/);
  if (turn && request.method === "POST") return webTurn(request, env, s, turn[1]);
  if (env.ASSETS) {
    const rawPath = url.pathname;
    const isAsset = rawPath.includes("/assets/") || /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)$/i.test(rawPath);

    if (isAsset) {
      const assetPath = rawPath.includes("/assets/")
        ? rawPath.slice(rawPath.indexOf("/assets/"))
        : "/" + rawPath.split("/").pop();
      const assetUrl = new URL(assetPath, request.url);
      const resp = await env.ASSETS.fetch(new Request(assetUrl));
      if (resp.status < 400) {
        const headers = new Headers(resp.headers);
        if (assetPath.endsWith(".js")) {
          headers.set("Content-Type", "application/javascript; charset=utf-8");
        } else if (assetPath.endsWith(".css")) {
          headers.set("Content-Type", "text/css; charset=utf-8");
        }
        return new Response(resp.body, { status: resp.status, headers });
      }
      return new Response("/* asset not found */", {
        status: 404,
        headers: { "Content-Type": assetPath.endsWith(".js") ? "application/javascript" : "text/plain" }
      });
    }

    const exactResp = await env.ASSETS.fetch(request);
    if (exactResp.status < 400) return exactResp;

    if (request.method === "GET" && !path.startsWith("/v1/")) {
      const indexResp = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
      if (indexResp.ok) {
        return new Response(indexResp.body, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          },
        });
      }
    }
  }
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
    ctx.waitUntil(env.DB.prepare("DELETE FROM navigation_position_history WHERE fix_at_ms<?").bind(Date.now() - POSITION_HISTORY_DAYS * 86400_000).run().catch(() => undefined));
  },
};
