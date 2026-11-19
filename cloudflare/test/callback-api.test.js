import { afterEach, describe, expect, it, vi } from "vitest";
import { submitCallback, submitLessonCallback } from "../../src/components/join/callbackApi";

afterEach(() => vi.unstubAllGlobals());

describe("join callback submission", () => {
  const request = { name: "Learner", phone: "0501234567", for_whom: "self", goal: "", timing: "now", preferred_time: "", consent: true };

  it.each(["/join", "/english/join"])("posts to the existing server endpoint from %s", async pathname => {
    vi.stubGlobal("location", { pathname });
    const fetch = vi.fn(async () => Response.json({ ok: true, id: "lead" }));
    vi.stubGlobal("fetch", fetch);
    await submitCallback(request);
    expect(fetch).toHaveBeenCalledWith((pathname.startsWith("/english/") ? "/english" : "") + "/v1/public/callback", expect.objectContaining({ method: "POST", body: JSON.stringify({ ...request, source: "pricing_join", website: "" }) }));
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

describe("landing callback submission", () => {
  it.each([
    ["dialed", undefined, "dialed"],
    ["dialing", undefined, "dialed"],
    ["queued", "shabbat", "queued"],
    ["queued", undefined, "queued"],
  ])("propagates %s feedback", async (status, reason, expected) => {
    vi.stubGlobal("location", { pathname: "/" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, status, reason })));
    await expect(submitLessonCallback("0500000000")).resolves.toEqual({ duplicate: false, status: expected, reason });
  });
  it.each([["/", false], ["/english/", true]])("uses the public endpoint and distinguishes duplicate requests from new ones at %s", async (pathname, duplicate) => {
    vi.stubGlobal("location", { pathname });
    const fetch = vi.fn(async () => Response.json(duplicate ? { ok: true, duplicate } : { ok: true }, { status: duplicate ? 200 : 201 }));
    vi.stubGlobal("fetch", fetch);
    const phone = "0500000000";
    await expect(submitLessonCallback(phone)).resolves.toEqual({ duplicate, status: "queued", reason: undefined });
    const [[url, request]] = fetch.mock.calls;
    expect(url).toBe((pathname === "/" ? "" : "/english") + "/v1/public/callback");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({
      phone, name: "שיעור היכרות", for_whom: "self", timing: "now", consent: true,
      goal: "", preferred_time: "", source: "home_landing", website: "",
    });
  });

  it.each([
    new Response("unavailable", { status: 503 }),
    new Response("", { status: 201 }),
    Response.json({ ok: true }, { status: 422 }),
    Response.json({ ok: false }),
    Response.json({}),
  ])("does not report a callback queued without a successful response and explicit acceptance", async response => {
    vi.stubGlobal("location", { pathname: "/" });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(submitLessonCallback("0500000000")).rejects.toThrow("לא הצלחנו לשלוח");
  });
});
