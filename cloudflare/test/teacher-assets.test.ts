import { readFileSync, readdirSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

const directory = new NodeURL("../../public/brand/teachers/", import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith(".png"));
const paths = ["", "/english"].flatMap(prefix => files.map(name => `${prefix}/brand/teachers/${name}`));

describe("teacher PNG assets through the Worker", () => {
  it.each(paths)("preserves the nested path for %s", async path => {
    const assetPath = path.replace(/^\/english\//, "/");
    const png = readFileSync(new NodeURL(assetPath.split("/").pop()!, directory));
    const fetch = vi.fn(async (request: Request) => new URL(request.url).pathname === assetPath
      ? new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } })
      : new Response("Not found", { status: 404 }));
    const response = await worker.fetch(new Request(`https://speakool.net${path}`), { ASSETS: { fetch } } as unknown as Env);
    expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([assetPath]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  it.each(["", "/english"])("keeps missing teacher assets out of SPA fallback under %s", async prefix => {
    const fetch = vi.fn(async (_request: Request) => new Response("Not found", { status: 404 }));
    const response = await worker.fetch(new Request(`https://speakool.net${prefix}/brand/teachers/missing.png`), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0].url).pathname).toBe("/brand/teachers/missing.png");
  });

  it("preserves HEAD and query parameters when removing the deployment prefix", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response(null, { headers: { "Content-Type": "image/png" } }));
    const response = await worker.fetch(new Request("https://speakool.net/english/brand/teachers/male-0.png?v=2", { method: "HEAD" }), { ASSETS: { fetch } } as unknown as Env);
    expect(response.status).toBe(200);
    const [request] = fetch.mock.calls[0];
    expect(request.method).toBe("HEAD");
    expect(request.url).toBe("https://speakool.net/brand/teachers/male-0.png?v=2");
    expect(await response.text()).toBe("");
  });
});
