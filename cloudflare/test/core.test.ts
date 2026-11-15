import { describe, expect, it } from "vitest";
import { concat, downsample24kTo8k, upsample8kTo16k, wav, wavToPcm } from "../src/audio";
import { parseStartFrame, transferCommand } from "../src/technoline";
import { controlsFromSettings, TutorControlsSchema } from "../src/controls";
import { buildSystemInstruction } from "../src/controls";
import { buildSetupPayload } from "../src/prompt";
import { settings } from "../src/env";
import type { Env } from "../src/env";
import { SessionMeter } from "../src/meter";
import worker from "../src/index";

const pcm = (values: number[]) => new Uint8Array(Int16Array.from(values).buffer);
const values = (data: Uint8Array) => [...new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2)];
const start = { type: "start", callId: "test-call", caller: "private", token: "test-channel", format: "pcm16;rate=8000;ch=1" };

describe("Technoline protocol", () => {
  it("accepts the exact documented type=start frame", () => {
    expect(parseStartFrame(JSON.stringify(start), "test-channel")).toEqual({ callId: "test-call", caller: "private" });
  });
  it.each([{ ...start, token: "wrong" }, { ...start, type: undefined }, { ...start, callId: "" }, { ...start, format: "pcm16;rate=16000;ch=1" }])("rejects unauthenticated or incompatible start frames", (frame) => {
    expect(() => parseStartFrame(JSON.stringify(frame), "test-channel")).toThrow();
  });
  it("only transfers to IVR paths", () => {
    expect(JSON.parse(transferCommand("/99/9"))).toEqual({ type: "transfer_extension", target: "/99/9" });
    expect(() => transferCommand("+123")).toThrow();
  });
});

describe("PCM conversion parity with Python", () => {
  it("interpolates with Python floor division including negatives", () => {
    expect(values(upsample8kTo16k(pcm([-3, 2, 5])))).toEqual([-3, -3, -1, 2, 3, 5]);
  });
  it("retains incomplete groups across output chunk boundaries", () => {
    const [a, carry] = downsample24kTo8k(pcm([1, 2, 3, -1]));
    const [b, rest] = downsample24kTo8k(pcm([0, 0]), carry);
    expect(values(concat([a, b]))).toEqual([2, -1]);
    expect(rest.byteLength).toBe(0);
  });
  it("roundtrips WAV and PCM", () => expect(wavToPcm(wav(pcm([3, -5, 18]), 8000))).toEqual(pcm([3, -5, 18])));
});

it("preserves configured lesson controls and includes terminal tools and resumable transport", () => {
  const c = controlsFromSettings(false);
  const s = settings({} as Env);
  const setup = buildSetupPayload(c, buildSystemInstruction(c, "history"), "student", s).setup;
  expect(setup.model).toBe(c.model);
  expect(setup.generationConfig.speechConfig).toBeDefined();
  expect(setup.tools[0].functionDeclarations.map((t) => t.name)).toContain("end_session");
  expect(setup.sessionResumption).toEqual({});
  expect(setup.systemInstruction.parts[0].text).toContain(c.base_prompt.trim());
});

it("keeps learner progress and usage independently of bot identity", () => {
  const m = new SessionMeter();
  expect(m.recordLearning("record_learning_observation", { skill: "fluency", result: "used phrase", correction: "", score: 4 })).toBe(true);
  expect(m.summary().points).toBe(8);
  m.inputAudioBytes = 16000 * 2 * 60;
  expect(m.usage(settings({} as Env)).estimated_cost_usd).toBe(0.005);
});

it.each(["student", "adult", "isaac-translator", "voice-navigator-live"])(
  "only exposes school and translator tools for %s, including old bot records",
  (profile) => {
    const controls = controlsFromSettings(false);
    const setup = buildSetupPayload(controls, "lesson", profile, settings({} as Env)).setup;
    expect(setup.tools[0].functionDeclarations.map((tool) => tool.name)).toEqual([
      "record_learning_observation", "record_lesson_summary", "end_session", "save_translation_language",
    ]);
  },
);

it("ignores obsolete navigation controls without losing teacher preferences", () => {
  const controls = TutorControlsSchema.parse({
    ...controlsFromSettings(false), voice: "Aoede", target_lesson_minutes: 10,
    navigation_voice: "gemini", navigation_interrupt: "speech",
  });
  expect(controls.voice).toBe("Aoede");
  expect(controls.target_lesson_minutes).toBe(10);
  expect(controls).not.toHaveProperty("navigation_voice");
  expect(controls).not.toHaveProperty("navigation_interrupt");
});

it.each([
  ["/v1/navigation/positions", "POST"],
  ["/v1/admin/navigation/devices", "GET"],
  ["/v1/admin/app/customers", "GET"],
  ["/v1/app/plans", "GET"],
  ["/v1/app/signup", "POST"],
  ["/v1/openapi.json", "GET"],
])("no longer serves the navigation API %s", async (path, method) => {
  const env = {
    ADMIN_BEARER_SECRET: "test-admin",
    DB: { prepare: () => { throw new Error("Removed endpoints must not query D1"); } },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  } as unknown as Env;
  const response = await worker.fetch(new Request(`https://school.example${path}`, {
    method, headers: { Authorization: "Bearer test-admin" },
  }), env);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ detail: "Not found" });
});
