import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

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
});
