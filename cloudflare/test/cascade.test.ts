import { describe, expect, it, vi } from "vitest";
import { b64encode, wav } from "../src/audio";
import { CascadeLive } from "../src/cascade";
import { type Env, type Settings } from "../src/env";
import { SessionMeter } from "../src/meter";
import pilot from "../src/pbx-pilot-entry";
import { ContentTurn, contentPolicy, pilotContentPolicy } from "../src/content-safety";

const config = { sonioxKey: "mock-stt", openrouterKey: "mock-llm", inworldKey: "mock-tts", model: "mock", voice: "mock" };
function sse(...chunks: object[]) {
  return new Response(chunks.map((chunk) => "data: " + JSON.stringify(chunk)).join("\n") + "\ndata: [DONE]\n");
}

function fixture(google = false, adaptive = false) {
  const listeners = new Map<string, (event: { data: string }) => void>();
  const socket = {
    accept: vi.fn(), send: vi.fn(), close: vi.fn(),
    addEventListener: (name: string, fn: (event: { data: string }) => void) => listeners.set(name, fn),
  };
  const requests: { url: string; body: any }[] = [];
  const request = (async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, body });
    if (url.startsWith("https://stt-rt")) return { webSocket: socket } as unknown as Response;
    if (url.startsWith("https://openrouter")) {
      if (!body.messages.some((message: any) => message.role === "tool")) {
        return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1",
          function: { name: "record_lesson_summary", arguments: '{"points":3}' } }] } }] });
      }
      return sse(
        { choices: [{ delta: { content: "Nice work." } }] },
        { usage: { cost: 0.00004, prompt_tokens: 100, completion_tokens: 7 } },
      );
    }
    if (url.startsWith("https://texttospeech.googleapis.com/")) {
      return Response.json({ audioContent: b64encode(wav(Uint8Array.of(1, 0, 2, 0), 24000)) });
    }
    return new Response(JSON.stringify({ result: { audioContent: "AQACAA==" } }) + "\n");
  }) as typeof fetch;
  const engine = new CascadeLive({ ...config, ...(google ? { googleKey: "mock-google", voice: "he-IL-Standard-B" } : {}), interruption: adaptive ? "adaptive" : undefined }, { setup: {
    systemInstruction: { parts: [{ text: "Original teacher instructions" }] },
    tools: [{ functionDeclarations: [{ name: "record_lesson_summary", parameters: { type: "object" } }] }],
  } }, request);
  return { engine, socket, requests, result: (obj: object) => listeners.get("message")!({ data: JSON.stringify(obj) }) };
}

describe("isolated Technoline cascade", () => {
  it("calls Workers' native fetch with the global receiver", async () => {
    const socket = { accept: vi.fn(), send: vi.fn(), addEventListener: vi.fn(), close: vi.fn() };
    const request = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve({ webSocket: socket });
    });
    vi.stubGlobal("fetch", request);
    const engine = new CascadeLive(config, {});
    try {
      await engine.connect();
      expect(socket.accept).toHaveBeenCalledOnce();
    } finally {
      engine.close();
      vi.unstubAllGlobals();
    }
  });

  it("enforces local content blocking without production alert credentials", () => {
    expect(() => contentPolicy({ CONTENT_SAFETY_MODE: "on" } as Env)).toThrow();
    const turn = new ContentTurn(pilotContentPolicy());
    expect(turn.transcript("tutor", "Let's practice the word apple.", true)).toBe(false);
    expect(turn.transcript("tutor", " We can talk about movies.", true)).toBe(true);
    expect(turn.finish().tutor).toBe(true);
  });
  it("reuses the prompt, calls the lesson tools and emits audio and usage", async () => {
    const { engine, socket, requests, result } = fixture();
    await engine.connect();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ sample_rate: 16000, language_hints: ["he", "en"] });
    const pcm = new Uint8Array(3200);
    engine.sendAudio(pcm);
    expect(socket.send).toHaveBeenLastCalledWith(pcm);
    result({ tokens: [{ text: "Hello", is_final: true }, { text: "<end>", is_final: true }] });
    const events = [];
    for (let i = 0; i < 16; i++) {
      const event = await engine.next();
      events.push(event);
      if (event.type === "tool_call") engine.submitToolResult(event.calls[0], true);
      if (event.type === "turn_complete") break;
    }
    expect(events.map((event) => event.type)).toContain("turn_complete");
    expect(events).toContainEqual({ type: "transcript", role: "learner", text: "Hello", finished: true });
    expect(events).toContainEqual({ type: "audio", pcm24k: Uint8Array.of(1, 0, 2, 0) });
    expect(events).toContainEqual({ type: "usage", usage: {
      cascade_llm_usd: 0.00004, cascade_input_tokens: 100, cascade_output_tokens: 7,
    } });
    const requestsToModel = requests.filter((entry) => entry.url.startsWith("https://openrouter"));
    expect(requestsToModel[0].body.messages[0]).toEqual({ role: "system", content: "Original teacher instructions" });
    expect(requestsToModel[1].body.messages).toContainEqual({ role: "tool", tool_call_id: "t1", content: '{"saved":true}' });
    engine.close();
  });

  it("sends Google Standard audio through the telephone cascade when selected", async () => {
    const { engine, requests, result } = fixture(true);
    await engine.connect();
    try {
      result({ tokens: [{ text: "Hello", is_final: true }, { text: "<end>", is_final: true }] });
      const events = [];
      for (let i = 0; i < 16; i++) {
        const event = await engine.next();
        events.push(event);
        if (event.type === "tool_call") engine.submitToolResult(event.calls[0], true);
        if (event.type === "turn_complete") break;
      }
      expect(events).toContainEqual({ type: "audio", pcm24k: Uint8Array.of(1, 0, 2, 0) });
      expect(events).toContainEqual({ type: "usage", usage: { cascade_tts_usd: 0.00004 } });
      expect(requests.find(({ url }) => url.includes("texttospeech.googleapis.com"))?.body).toMatchObject({
        voice: { name: "he-IL-Standard-B", languageCode: "he-IL" },
        audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
      });
      expect(requests.some(({ url }) => url.includes("api.inworld.ai"))).toBe(false);
    } finally {
      engine.close();
    }
  });

  it("ignores short noises and separated bursts but accepts an early recognized word", async () => {
    const { engine, result } = fixture(false, true);
    await engine.connect();
    const burst = new Uint8Array(new Int16Array(1600).fill(3000).buffer);
    try {
      engine.startGreeting("Hello");
      for (let i = 0; i < 4; i++) {
        engine.sendAudio(burst);
        expect(engine.playbackPaused()).toBe(false);
      }
      engine.sendAudio(new Uint8Array(3200));
      engine.sendAudio(burst);
      expect(engine.playbackPaused()).toBe(false);
      result({ tokens: [{ text: "Wait", is_final: false }] });
      expect(await engine.next()).toMatchObject({ type: "interrupted" });
      expect(engine.playbackPaused()).toBe(true);
      engine.acknowledgeInterrupt();
      expect(engine.playbackPaused()).toBe(false);
    } finally {
      engine.close();
    }
  });

  it("resumes after an unconfirmed noise and holds old audio until a confirmed interruption is drained", async () => {
    const { engine, result } = fixture(false, true);
    await engine.connect();
    const loud = new Uint8Array(new Int16Array(8000).fill(3000).buffer);
    try {
      engine.startGreeting("Hello");
      engine.sendAudio(loud);
      expect(engine.playbackPaused()).toBe(true);
      expect(await engine.next()).toMatchObject({ type: "pilot_interruption", phase: "candidate" });
      expect(engine.playbackPaused(Date.now() + 500)).toBe(false);
      expect(await engine.next()).toMatchObject({ type: "pilot_interruption", phase: "resumed" });
      engine.sendAudio(new Uint8Array(3200));
      engine.sendAudio(loud);
      result({ tokens: [{ text: "Wait", is_final: false }] });
      expect(await engine.next()).toMatchObject({ type: "pilot_interruption", phase: "candidate" });
      expect(await engine.next()).toMatchObject({ type: "interrupted" });
      expect(engine.playbackPaused()).toBe(true);
      engine.acknowledgeInterrupt();
      expect(engine.playbackPaused()).toBe(false);
    } finally {
      engine.close();
    }
  });

  it("keeps cascade costs separate from Gemini prices", () => {
    const meter = new SessionMeter();
    meter.useCascade();
    meter.inputAudioBytes = 9_600_000;
    meter.recordUsage({ cascade_llm_usd: 0.001, cascade_tts_usd: 0.005, cascade_input_tokens: 800, cascade_output_tokens: 50 });
    expect(meter.cascadeCosts()).toMatchObject({ stt_estimated_usd: 0.01, llm_reported_usd: 0.001, tts_estimated_usd: 0.005 });
    expect(meter.usage({} as Settings)).toMatchObject({ estimated_cost_usd: 0.016, input_text_tokens: 800, output_text_tokens: 50 });
  });

  it("gates the pilot and leaves production paths unavailable", async () => {
    const route = "https://pilot.invalid/v1/technoline/pilot";
    const env = { PBX_CASCADE_PILOT: "1", TEST_TEACHER_CHANNEL_ID: "pilot",
      PBX_PILOT_SONIOX_KEY: "fake", PBX_PILOT_OPENROUTER_KEY: "fake", PBX_PILOT_INWORLD_KEY: "fake" } as Env;
    expect((await pilot.fetch(new Request(route), {} as Env)).status).toBe(503);
    expect((await pilot.fetch(new Request("https://pilot.invalid/v1/technoline/router"), env)).status).toBe(404);
    expect((await pilot.fetch(new Request(route), env)).status).toBe(426);
  });
});
