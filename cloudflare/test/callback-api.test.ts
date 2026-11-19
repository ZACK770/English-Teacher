import { afterEach, describe, expect, it, vi } from "vitest";
import { submitCallback } from "../../src/components/join/callbackApi";

afterEach(() => vi.unstubAllGlobals());

describe("join callback submission", () => {
  const request = { name: "Learner", phone: "0501234567", for_whom: "self" as const, goal: "", timing: "now" as const, preferred_time: "", consent: true as const };

  it.each(["/join", "/english/join"])("posts to the existing server endpoint from %s", async pathname => {
    vi.stubGlobal("location", { pathname });
    const fetch = vi.fn(async () => Response.json({ ok: true, id: "lead" }));
    vi.stubGlobal("fetch", fetch);
    await submitCallback(request);
    expect(fetch).toHaveBeenCalledWith((pathname.startsWith("/english/") ? "/english" : "") + "/v1/public/callback", expect.objectContaining({ method: "POST", body: JSON.stringify({ ...request, source: "pricing_join" }) }));
  });

  it.each([new Response("", { status: 201 }), Response.json({ detail: "Invalid request" }, { status: 422 })])("rejects empty and unsuccessful server responses", async response => {
    vi.stubGlobal("location", { pathname: "/join" });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(submitCallback(request)).rejects.toThrow("לא הצלחנו לשלוח");
  });

  it("propagates connection failure without reporting success", async () => {
    vi.stubGlobal("location", { pathname: "/join" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(submitCallback(request)).rejects.toThrow("offline");
  });
});
