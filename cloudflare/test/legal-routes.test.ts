import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import { legalHref, legalPages } from "../../src/legalRoutes";

const index = readFileSync(new NodeURL("../../index.html", import.meta.url), "utf8");

describe("public legal page SPA routing", () => {
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
    expect(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]).toBe(`https://speakcall.app${canonicalPath}`);
    expect(html.match(/<meta property="og:url" content="([^"]+)"/)?.[1]).toBe(`https://speakcall.app${canonicalPath}`);
    if (path.startsWith("/english/")) expect(html).toContain('"/english/assets/app.js"');
  });
});
