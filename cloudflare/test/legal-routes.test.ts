import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import { legalHref, legalPages } from "../../src/legalRoutes";

const index = readFileSync(new NodeURL("../../index.html", import.meta.url), "utf8");

describe("public legal page SPA routing", () => {
  it.each(["/portal", "/portal/", "/english/portal"])("redirects %s to learning without losing the query", async path => {
    const response = await worker.fetch(new Request(`https://example.com${path}?invite=a%2Fb&plan=school-step`), {} as Env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`https://example.com${path.startsWith("/english") ? "/english" : ""}/learn?invite=a%2Fb&plan=school-step`);
  });
  it("redirects an empty portal query and leaves portal API authentication intact", async () => {
    const page = await worker.fetch(new Request("https://example.com/portal"), {} as Env);
    expect(page.headers.get("Location")).toBe("https://example.com/learn");
    const api = await worker.fetch(new Request("https://example.com/v1/portal/me"), {} as Env);
    expect(api.status).toBe(401);
    expect(api.headers.get("Location")).toBeNull();
  });
  it("combines the legacy hostname and portal redirects", async () => {
    const response = await worker.fetch(new Request("https://speakcall.app/english/portal?invite=a%2Fb"), {} as Env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://speakool.net/english/learn?invite=a%2Fb");
  });
  it.each(["/terms", "/privacy", "/accessibility", "/english/accessibility", "/terms/"])("serves the SPA on direct load of %s", async (path) => {
    const fetch = vi.fn(async (request: Request) => new URL(request.url).pathname === "/index.html"
      ? new Response('<div id="root"></div>', { headers: { "Content-Type": "text/html" } })
      : new Response("Not found", { status: 404 }));
    const response = await worker.fetch(new Request(`https://example.com${path}`), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain('id="root"');
  });

  it("does not replace a missing JavaScript asset with HTML", async () => {
    const fetch = vi.fn(async () => new Response("Not found", { status: 404 }));
    const response = await worker.fetch(new Request("https://example.com/assets/missing.js"), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('id="root"');
  });

  it.each(["/", "/english/", "/english/terms", "/english-other"])("generates legal links that preserve the site base for %s", pathname => {
    const prefix = pathname === "/english/" || pathname === "/english/terms" ? "/english" : "";
    expect(legalPages.map(page => legalHref(pathname, page))).toEqual([
      prefix + "/terms", prefix + "/privacy", prefix + "/accessibility",
    ]);
  });

  it.each([
    ["/", "/"],
    ["/terms", "/terms"],
    ["/privacy", "/privacy"],
    ["/accessibility", "/accessibility"],
    ["/english/terms/", "/terms"],
    ["/english/privacy", "/privacy"],
    ["/english/accessibility", "/accessibility"],
    ["/english-extra/terms", "/"],
  ])("serves the canonical and Open Graph URL for %s before JS loads", async (path, canonicalPath) => {
    const fetch = vi.fn(async () => new Response(index.replace('"/src/main.tsx"', '"/assets/app.js"')));
    const response = await worker.fetch(new Request(`https://example.com${path}?source=test`), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]).toBe(`https://speakool.net${canonicalPath}`);
    expect(html.match(/<meta property="og:url" content="([^"]+)"/)?.[1]).toBe(`https://speakool.net${canonicalPath}`);
    if (path.startsWith("/english/")) expect(html).toContain('"/english/assets/app.js"');
  });
});

describe("public brand assets", () => {
  it.each([
    ["/brand/speakcall/favicon.svg", "image/svg+xml"],
    ["/english/brand/speakcall/logo-en-reverse.svg", "image/svg+xml"],
    ["/brand/speakcall/site.webmanifest", "application/manifest+json"],
  ])("serves %s from the nested assets directory", async (path, type) => {
    const fetch = vi.fn(async (request: Request) => new URL(request.url).pathname === path.replace(/^\/english\//, "/")
      ? new Response("brand asset", { headers: { "Content-Type": type } })
      : new Response("Not found", { status: 404 }));
    const response = await worker.fetch(new Request(`https://example.com${path}`), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(type);
    expect(await response.text()).toBe("brand asset");
  });

  it("does not serve the SPA for missing brand assets", async () => {
    const fetch = vi.fn(async () => new Response("Not found", { status: 404 }));
    const response = await worker.fetch(new Request("https://example.com/brand/speakcall/missing.svg"), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
