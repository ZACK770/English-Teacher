import { type Env, bearer, secureEqual, settings, HttpError } from "./env";
import { ingestEvent } from "./analytics";
import { handleCallback } from "./pbx";
import { handleAdmin, handlePortal, handleStatic, publicNarration } from "./api";
import { handleWebhook } from "./payments";
import { listKevas, syncKevas } from "./keva-sync";
import { PaymentStore } from "./payments";
import { webTurn } from "./learn";
import { syncCrm } from "./crm";
import { cleanupCallbackQuota, dispatchCallbacks, submitCallback } from "./callbacks";
import { learnerVoice } from "./learner";
import { cleanupPortalAuth, phoneAuthStatus, portalAuth } from "./portal-auth";
import { legalBasePath, legalPageForPath } from "../../src/legalRoutes";
import { blogHtml, blogRoute, isBlogPath } from "../../src/blog/routes";
import { geminiBudgetStatus } from "./gemini-budget";
import { dispatchVoicemails } from "./voicemails";
import { cleanupRecordings } from "./recordings";
import { adminAuth, adminIdentity, adminOwners, audit, requireOrigin } from "./admin-auth";
import { SubscriptionStore } from "./subscriptions";
import { BusinessStore } from "./business";
import { crmPeople } from "./crm-people";
import { callCostReport, callReviewReport, runCallReviews, syncCallReviewPhone } from "./call-review";
export { CallSession } from "./call";
export { GeminiBudget } from "./gemini-budget";

async function handle(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const s = settings(env);
  const path = url.pathname.replace(/^\/english(\/|$)/, "/") || "/";
  if (path === "/healthz") return Response.json({ status: "ok", service: "english-engine" });
  if (path === "/v1/public/analytics-config" && request.method === "GET") return Response.json({
    ga_measurement_id: /^G-[A-Z0-9]+$/.test(env.GA_MEASUREMENT_ID || "") ? env.GA_MEASUREMENT_ID : "",
    cf_beacon_token: /^[a-f0-9]{32}$/.test(env.CF_BEACON_TOKEN || "") ? env.CF_BEACON_TOKEN : "",
  }, { headers: { "Cache-Control": "no-store" } });
  if (path === "/v1/public/events" && request.method === "POST") return ingestEvent(request, env);
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
    const crmResponse = await crmPeople(request, env, path, identity);
    if (crmResponse) return crmResponse;
    const ownerResponse = await adminOwners(request, env, path, identity);
    if (ownerResponse) return ownerResponse;
    if (path === "/v1/admin/gemini-budget" && request.method === "GET") return geminiBudgetStatus(env);
    if (request.method === "GET" && ["/v1/admin/call-reviews", "/v1/admin/call-reviews/cost"].includes(path)) {
      if (identity.role !== "owner") throw new HttpError(403, "Forbidden");
      const report = path.endsWith("/cost") ? await callCostReport(env, url.searchParams.get("call_id") ?? "") : await callReviewReport(env);
      return Response.json(report, { headers: { "Cache-Control": "no-store" } });
    }
    if (path === "/v1/admin/nedarim/kevas" && request.method === "GET") return listKevas(env);
    if (path === "/v1/admin/nedarim/kevas/sync" && request.method === "POST") return Response.json({ synced: await syncKevas(env, true) });
    if (path === "/v1/admin/portal-login/status" && request.method === "GET") return Response.json(await phoneAuthStatus(env));
    const response = await handleAdmin(request, env, s, path);
    if (response) return response;
  }
  if (path === "/v1/public/callback" && request.method === "POST") return submitCallback(request, env);
  if (path === "/v1/public/packages" && request.method === "GET") {
    const items = (await new BusinessStore(env.DB).list("packages")).filter(p => p.active && p.product === "school").map(p => ({
      id: p.id, name: p.name, price_ils: p.price_ils, billing: p.billing, duration_months: p.duration_months,
      sessions_per_week: p.sessions_per_week ?? 7, tagline: p.tagline, recommended: p.recommended,
      max_payments: p.max_payments ?? 1, phone_enabled: p.phone_enabled,
    }));
    return Response.json({ items });
  }
  const turn = path.match(/^\/v1\/bots\/([a-z][a-z0-9-]{1,62})\/turn$/);
  if (turn && request.method === "POST") return webTurn(request, env, s, turn[1]);
  const portal = await handlePortal(request, env, path);
  if (portal) return portal;
  if (path.startsWith("/v1/")) return Response.json({ detail: "Not found" }, { status: 404 });
  if (env.ASSETS) {
    if (path.startsWith("/brand/")) {
      const brandUrl = new URL(request.url);
      brandUrl.pathname = path;
      return env.ASSETS.fetch(new Request(brandUrl, request));
    }
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
    const blogPage = request.method === "GET" ? blogRoute(rawPath) : undefined;
    if (request.method === "GET" && isBlogPath(rawPath) && !blogPage) {
      return Response.redirect(new URL(`${legalBasePath(rawPath)}/blog`, request.url).toString(), 302);
    }
    if (!legalPage && !blogPage) {
      const exactResp = await env.ASSETS.fetch(request);
      if (exactResp.status < 400) return exactResp;
    }

    if (request.method === "GET" && !path.startsWith("/v1/")) {
      const indexResp = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
      if (indexResp.ok) {
        let html = await indexResp.text();
        if (blogPage) html = blogHtml(html, blogPage);
        if (legalPage) {
          html = html.replace('<link rel="canonical" href="https://speakool.net/"', `<link rel="canonical" href="https://speakool.net/${legalPage}"`)
            .replace('<meta property="og:url" content="https://speakool.net/"', `<meta property="og:url" content="https://speakool.net/${legalPage}"`);
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
    const url = new URL(request.url);
    const sitePath = url.pathname.replace(/^\/english(\/|$)/, "/");
    const isPageRequest = (request.method === "GET" || request.method === "HEAD") && !request.headers.get("Upgrade")
      && !/^\/(v1|api)(\/|$)/.test(sitePath) && !["/healthz", "/status", "/readyz"].includes(sitePath);
    const portalAlias = isPageRequest && (sitePath === "/portal" || sitePath === "/portal/");
    if (portalAlias) url.pathname = url.pathname.replace(/\/portal\/?$/, "/learn");
    if (portalAlias) return Response.redirect(url.toString(), 302);
    const path = url.pathname.replace(/^\/english(\/|$)/, "/");
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
    if (/^\/dashboard(?:\/crm(?:\/|$)|\/?$)/.test(path) && response.headers.get("Content-Type")?.includes("text/html")) {
      const html = (await response.text()).replace(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, "");
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      response = new Response(html, { status: response.status, headers });
    }
    if (log) await audit(env, request, path, actor, response.status).catch(() => undefined);
    return response;
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(new SubscriptionStore(env.DB, env).tick().catch(() => undefined));
    ctx.waitUntil(syncCrm(env).catch(() => undefined));
    ctx.waitUntil((async () => {
      await syncKevas(env).catch(error => console.error("Keva sync failed", error));
      if (env.NEDARIM_API_KEY) await new PaymentStore(new BusinessStore(env.DB)).reconcile(env);
    })().catch(() => console.error("Nedarim reconciliation failed")));
    ctx.waitUntil(dispatchCallbacks(env).catch(() => undefined));
    ctx.waitUntil(dispatchVoicemails(env).catch(() => undefined));
    ctx.waitUntil(cleanupRecordings(env).catch(() => console.warn("Recording retention failed")));
    ctx.waitUntil(cleanupCallbackQuota(env));
    ctx.waitUntil(cleanupPortalAuth(env));
    ctx.waitUntil(geminiBudgetStatus(env).catch(() => undefined));
    ctx.waitUntil(runCallReviews(env).catch(() => console.error("Call review job failed")));
    ctx.waitUntil(syncCallReviewPhone(env).catch(() => console.error("Call review phone history sync failed")));
    ctx.waitUntil(new BusinessStore(env.DB).releaseStaleReservations());
  },
};
