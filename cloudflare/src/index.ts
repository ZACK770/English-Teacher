import { type Env, bearer, secureEqual, settings, HttpError } from "./env";
import { handleCallback } from "./pbx";
import { handleAdmin, handlePortal, handleStatic, publicNarration } from "./api";
import { handleWebhook } from "./payments";
import { webTurn } from "./learn";
import { syncCrm } from "./crm";
import { cleanupCallbackQuota, dispatchCallbacks, submitCallback } from "./callbacks";
import { learnerVoice } from "./learner";
import { cleanupPortalAuth, phoneAuthStatus, portalAuth } from "./portal-auth";
import { legalBasePath, legalPageForPath } from "../../src/legalRoutes";
import { geminiBudgetStatus } from "./gemini-budget";
import { dispatchVoicemails } from "./voicemails";
import { adminAuth, adminIdentity, adminOwners, audit, requireOrigin } from "./admin-auth";
export { CallSession } from "./call";
export { GeminiBudget } from "./gemini-budget";

async function handle(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const s = settings(env);
  const path = url.pathname.replace(/^\/english(\/|$)/, "/") || "/";
  if (path === "/healthz") return Response.json({ status: "ok", service: "english-engine" });
  if (path === "/status" || path === "/api/status") return Response.json({ service: "English school voice engine", health: "/healthz", websocket: "/v1/technoline/stream", status: "production" });
  if (path === "/readyz") {
    const configured = !!env.GEMINI_API_KEY && !!env.ADMIN_BEARER_SECRET;
    const db = await env.DB.prepare("SELECT COUNT(*) AS n FROM bots").first<{ n: number }>();
    return Response.json({ status: configured && db?.n ? "ready" : "not_ready", profiles: db?.n ?? 0 }, { status: configured && db?.n ? 200 : 503 });
  }
  if (path === "/v1/portal/voice") return learnerVoice(request, env);
  const auth = await portalAuth(request, env, path);
  if (auth) return auth;
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
    headers.delete("X-Portal-Customer"); headers.delete("X-Portal-Teacher");
    if (profile) headers.set("X-Profile", profile);
    if (path === "/v1/technoline/router") headers.set("X-Shared-Router", "1");
    const stub = env.CALLS.get(env.CALLS.newUniqueId(), { locationHint: "weur" });
    return stub.fetch(new Request(request, { headers }));
  }
  if (path.startsWith("/v1/technoline/ivr/")) {
    return Response.json(await handleCallback(request, env, s, path.slice("/v1/technoline/ivr/".length), ctx));
  }
  const narration = path.match(/^\/v1\/technoline\/narrations\/([^/]+)\/([a-f0-9]{64})\.wav$/);
  if (narration && request.method === "GET") return publicNarration(env, decodeURIComponent(narration[1]), narration[2]);
  if (path === "/v1/payments/nedarim/webhook" && request.method === "POST") return Response.json(await handleWebhook(request, env));
  if (path.startsWith("/v1/admin/") || path.startsWith("/v1/progress/")) {
    if (path.startsWith("/v1/admin/auth/")) return adminAuth(request, env, path);
    const identity = await adminIdentity(request, env);
    if (!identity) throw new HttpError(401, "Unauthorized");
    if (!identity.bearer && request.method !== "GET") requireOrigin(request);
    const ownerResponse = await adminOwners(request, env, path, identity);
    if (ownerResponse) return ownerResponse;
    if (path === "/v1/admin/gemini-budget" && request.method === "GET") return geminiBudgetStatus(env);
    if (path === "/v1/admin/portal-login/status" && request.method === "GET") return Response.json(await phoneAuthStatus(env));
    const response = await handleAdmin(request, env, s, path);
    if (response) return response;
  }
  if (path === "/v1/public/callback" && request.method === "POST") return submitCallback(request, env);
  const turn = path.match(/^\/v1\/bots\/([a-z][a-z0-9-]{1,62})\/turn$/);
  if (turn && request.method === "POST") return webTurn(request, env, s, turn[1]);
  const portal = await handlePortal(request, env, path);
  if (portal) return portal;
  if (path.startsWith("/v1/")) return Response.json({ detail: "Not found" }, { status: 404 });
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

    const legalPage = request.method === "GET" ? legalPageForPath(rawPath) : undefined;
    if (!legalPage) {
      const exactResp = await env.ASSETS.fetch(request);
      if (exactResp.status < 400) return exactResp;
    }

    if (request.method === "GET" && !path.startsWith("/v1/")) {
      const indexResp = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
      if (indexResp.ok) {
        let html = await indexResp.text();
        if (legalPage) {
          html = html.replace('<link rel="canonical" href="https://speakcall.app/"', `<link rel="canonical" href="https://speakcall.app/${legalPage}"`)
            .replace('<meta property="og:url" content="https://speakcall.app/"', `<meta property="og:url" content="https://speakcall.app/${legalPage}"`);
        }
        if (legalBasePath(rawPath)) html = html.replaceAll('"/assets/', '"/english/assets/');
        return new Response(html, {
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
  const asset = await handleStatic(request, env, path);
  if (asset) return asset;
  return Response.json({ detail: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/^\/english(\/|$)/, "/");
    const log = request.method !== "GET" && (path.startsWith("/v1/admin/") || path.startsWith("/v1/progress/"));
    let actor = "anonymous";
    if (log) {
      if (path === "/v1/admin/auth/login") {
        try { const data = await request.clone().json() as { username?: unknown }; actor = typeof data.username === "string" ? data.username.trim().toLowerCase().slice(0, 64) : "anonymous"; } catch { /* invalid login */ }
      } else {
        try { actor = (await adminIdentity(request, env))?.username || actor; } catch { /* authentication will fail closed */ }
      }
    }
    let response: Response;
    try { response = await handle(request, env, ctx); }
    catch (error) {
      response = error instanceof HttpError ? Response.json({ detail: error.detail }, { status: error.status }) : Response.json({ detail: "Request failed" }, { status: 500 });
    }
    if (log) await audit(env, request, path, actor, response.status).catch(() => undefined);
    return response;
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncCrm(env).catch(() => undefined));
    ctx.waitUntil(dispatchCallbacks(env).catch(() => undefined));
    ctx.waitUntil(dispatchVoicemails(env).catch(() => undefined));
    ctx.waitUntil(cleanupCallbackQuota(env));
    ctx.waitUntil(cleanupPortalAuth(env));
    ctx.waitUntil(geminiBudgetStatus(env).catch(() => undefined));
  },
};
