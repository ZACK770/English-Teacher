import { DatabaseSync } from "node:sqlite";
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
    expect(html).toContain('id="minSoundMs" type="range"');
    expect(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/)![1])).not.toThrow();
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

  it("persists tuning, restores it and promotes the saved snapshot", async () => {
    const values = new Map<string, any>();
    const storage = {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
      transaction: async (fn: any) => fn(storage),
    };
    const env = { ...environment(), PBX_PILOT_ADMIN_TOKEN: "test-admin", PBX_PILOT_SONIOX_KEY: "stt",
      PBX_PILOT_OPENROUTER_KEY: "llm", PBX_PILOT_INWORLD_KEY: "tts" };
    const session = new CallSession({storage} as unknown as DurableObjectState, env);
    const update = (body: object) => session.fetch(new Request(origin+"/v1/admin/pilot/settings", {
      method:"PUT", headers:{Authorization:"Bearer test-admin"}, body:JSON.stringify(body),
    }));
    const tuning = {energyThreshold:1800,minSoundMs:700,resumeSilenceMs:600};
    expect((await update({model:"qwen/test",voice:"Amos",tuning:{...tuning,minSoundMs:1}})).status).toBe(400);
    expect(values.size).toBe(0);
    expect(await (await update({model:"qwen/test",voice:"Amos",tuning})).json()).toMatchObject({active:{tuning}});
    await update({production:"cascade"});
    await update({model:"qwen/test",voice:"Amos",tuning:{...tuning,minSoundMs:900}});
    expect(values.get("school-teacher-settings").tuning).toEqual(tuning);
    expect(await (await update({rollback:true})).json()).toMatchObject({active:{tuning}});
  });

  it("measures the entire call even when the event feed is paginated", async () => {
    const sql = new DatabaseSync(":memory:");
    sql.exec(`CREATE TABLE latency_events(id INTEGER PRIMARY KEY,call_id TEXT,profile_id TEXT,created_at TEXT,event_name TEXT,since_call_start_ms INTEGER,details_json TEXT);
      CREATE TABLE conversation_turns(id INTEGER,call_id TEXT,profile_id TEXT,created_at TEXT,direction TEXT,text TEXT);
      CREATE TABLE sessions(call_id TEXT,duration_seconds INTEGER,model TEXT,learner_turns INTEGER,tutor_turns INTEGER,summary_he TEXT,success_he TEXT,next_step_he TEXT,input_text_tokens INTEGER,output_text_tokens INTEGER,estimated_cost_usd REAL,cost_basis TEXT);`);
    const add = sql.prepare("INSERT INTO latency_events(call_id,profile_id,event_name,details_json) VALUES ('call','isaac-basic',?,?)");
    for (let i=0;i<202;i++) add.run("pilot_interruption_candidate","{}");
    add.run("pilot_interruption_resumed","{}");
    add.run("tutor_interrupted","{}");
    add.run("pilot_turn_to_audio",JSON.stringify({elapsed_ms:800}));
    add.run("pilot_turn_to_audio",JSON.stringify({elapsed_ms:1200}));
    add.run("cascade_connect_started",JSON.stringify({tuning:{minSoundMs:700}}));
    const db = {
      prepare(query: string) { return {bind: (...args: any[]) => ({all: async () => ({results:sql.prepare(query).all(...args)})})}; },
      batch: (statements: any[]) => Promise.all(statements.map(statement=>statement.all())),
    };
    try {
      const response = await pilot.fetch(new Request(base+"/calls?id=call",{headers:{Cookie:cookie}}), {...environment(),DB:db} as any);
      const result = await response.json() as any;
      expect(response.status).toBe(200);
      expect(result.events).toHaveLength(200);
      expect(result.measurements).toMatchObject({pauses:202,resumes:1,interruptions:1,response_ms:1000});
      expect(JSON.parse(result.configuration.details_json)).toEqual({tuning:{minSoundMs:700}});
    } finally { sql.close(); }
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
