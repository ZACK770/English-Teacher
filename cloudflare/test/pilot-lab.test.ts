import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import pilot, { CallSession } from "../src/pbx-pilot-entry";

const origin = "https://speakcall.app";
const base = origin + "/dashboard/pilot-888";
const cookie = "admin_session=" + "a".repeat(64);

function environment(role = "owner") {
  const query = { bind: vi.fn(() => query), first: vi.fn(async () => ({ role })) };
  const adminDb = { prepare: vi.fn(() => query) } as unknown as D1Database;
  return { ADMIN_DB: adminDb, PBX_CASCADE_PILOT: "1" } as Env & { ADMIN_DB: D1Database };
}

afterEach(() => vi.unstubAllGlobals());

describe("pilot voice lab", () => {
  it("renders the unified interface without a pilot key input and rejects unauthenticated history", async () => {
    const env = environment();
    const redirect = await pilot.fetch(new Request(base), env);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe(origin+"/dashboard/crm?view=voice-lab");
    const page = await pilot.fetch(new Request(base+"?embedded=1"), env);
    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    const html = await page.text();
    expect(html).toContain('<select id="model"');
    expect(html).toContain('<select id="voice"');
    expect(html).toContain('Google Standard');
    expect(html).not.toContain('id="token"');
    expect((await pilot.fetch(new Request(base + "/calls"), env)).status).toBe(401);
  });

  it("uses an owner session to read actual pilot history", async () => {
    const stored = [{ call_id: "pilot-test-1", ended: 1 }];
    const all = vi.fn(async () => ({ results: stored }));
    const env = { ...environment(), DB: { prepare: () => ({ all }) } as unknown as D1Database };
    const response = await pilot.fetch(new Request(base + "/calls", { headers: { Cookie: cookie } }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ calls: stored });
    expect(all).toHaveBeenCalledOnce();
  });

  it("defaults legacy settings to capture and exports the saved mix without provider keys", async () => {
    const env = {
      ...environment(),
      PBX_PILOT_ADMIN_TOKEN: "test-admin",
      PBX_PILOT_OPENROUTER_KEY: "test-provider",
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database,
    };
    const state = { storage: { get: async () => ({ active: { model: "qwen/test", voice: "Amos" } }) } } as unknown as DurableObjectState;
    const session = new CallSession(state, env);
    const result = await session.fetch(new Request(origin + "/v1/admin/pilot/settings?export=1", {
      headers: { Authorization: "Bearer test-admin" },
    }));
    const config = await result.json();
    expect(config).toMatchObject({
      target: { extension: "1", status: "handoff_only" },
      pipeline: { model: { id: "qwen/test" }, speech: { voice: "Amos" } },
      lab_transcript_enabled: true,
    });
    expect(JSON.stringify(config)).not.toContain("test-provider");
  });

  it("promotes a saved pilot snapshot and can return the production teacher to Gemini", async () => {
    const values = new Map<string, unknown>([["pilot-settings", { active: { model: "qwen/test", voice: "Amos" } }]]);
    const storage = {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
      delete: async (key: string) => values.delete(key),
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(storage),
    };
    const env = { ...environment(), PBX_PILOT_ADMIN_TOKEN: "test-admin",
      PBX_PILOT_SONIOX_KEY: "test-soniox", PBX_PILOT_OPENROUTER_KEY: "test-openrouter", PBX_PILOT_INWORLD_KEY: "test-inworld" };
    const session = new CallSession({ storage } as unknown as DurableObjectState, env);
    const headers = { Authorization: "Bearer test-admin" };
    const choose = (production: string) => session.fetch(new Request(origin + "/v1/admin/pilot/settings", {
      method: "PUT", headers, body: JSON.stringify({ production }),
    }));
    const readPrivate = () => session.fetch(new Request("https://internal.invalid/v1/internal/school-voice", { headers }));
    const promotion = await choose("cascade");
    expect(await promotion.text()).not.toContain("test-openrouter");
    values.set("pilot-settings", { active: { model: "google/new-test", voice: "Eitan" } });
    expect(await (await readPrivate()).json()).toMatchObject({ model: "qwen/test", openrouterKey: "test-openrouter" });
    expect((await pilot.fetch(new Request(origin + "/v1/internal/school-voice", { headers }), env)).status).toBe(404);
    expect(await (await choose("gemini")).json()).toEqual({ production: null });
    expect(await (await readPrivate()).json()).toBeNull();
  });

  it("checks the origin and uses a Google key only in the provider request", async () => {
    const synthesize = vi.fn(async () => Response.json({ audioContent: "dGVzdA==" }));
    vi.stubGlobal("fetch", synthesize);
    const send = (requestOrigin: string) => pilot.fetch(new Request(base + "/preview", {
      method: "POST", headers: { Cookie: cookie, Origin: requestOrigin },
      body: JSON.stringify({ mode: "google", voice: "he-IL-Standard-B", key: "example-test-key", text: "שלום" }),
    }), environment());
    expect((await send("https://example.net")).status).toBe(403);
    expect(synthesize).not.toHaveBeenCalled();
    const response = await send(origin);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ audio: "dGVzdA==", characters: 4 });
    expect(synthesize).toHaveBeenCalledWith("https://texttospeech.googleapis.com/v1/text:synthesize",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Goog-Api-Key": "example-test-key" }) }));
  });
});
