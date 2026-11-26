import { afterEach, expect, it, vi } from "../../cloudflare/node_modules/vitest";
import worker from "./index";

afterEach(() => vi.unstubAllGlobals());
const headers = { Authorization: "Bearer test" };
const env = (run = vi.fn()) => ({ AI: { run }, ASSETS: {}, LAB_PASSCODE: "test", GEMINI_API_KEY: "test" }) as any;
function turn() {
  const body = new FormData();
  body.set("audio", new File([new Uint8Array([1, 2])], "test.wav"));
  body.set("seconds", "2");
  return new Request("https://lab/api/chain", { method: "POST", headers, body });
}

it("protects API and disables unconfigured OpenAI", async () => {
  expect((await worker.fetch(new Request("https://lab/api/config"), env())).status).toBe(401);
  const result = await worker.fetch(new Request("https://lab/api/openai", { method: "POST", headers }), env());
  expect(result.status).toBe(503);
  expect(await result.text()).toContain("not configured yet");
});

it("rejects empty input and stops after empty transcription", async () => {
  expect((await worker.fetch(new Request("https://lab/api/chain", { method: "POST", headers, body: new FormData() }), env())).status).toBe(400);
  const run = vi.fn().mockResolvedValue({ text: "" });
  expect((await worker.fetch(turn(), env(run))).status).toBe(422);
  expect(run).toHaveBeenCalledTimes(1);
});

it("returns shared persona reply, WAV, usage costs and stage timing", async () => {
  const run = vi.fn().mockResolvedValueOnce({ text: "שלום" }).mockResolvedValueOnce({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: btoa("\0\0"), mimeType: "audio/L16;rate=24000" } }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 1 }] } })));
  const response = await worker.fetch(turn(), env(run));
  expect(response.status).toBe(200);
  const [reply, audio, body] = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(reply.transcript).toBe("שלום");
  expect(reply.reply).toBe("Hello");
  expect(atob(audio.audio).slice(0, 4)).toBe("RIFF");
  expect(body.cost.total).toBeCloseTo(2 / 60 * .000513 + 10 * .1 / 1e6 + 2 * .3 / 1e6 + .5 / 1e6 + 6 / 1e6);
  expect(body.latency_ms.total).toBeGreaterThanOrEqual(0);
  expect(run.mock.calls[1][1].messages[0].content).toContain("You are Alex");
  expect(run.mock.calls[1][1].messages[0].content).toContain("1–3 short spoken sentences");
  expect(run.mock.calls[1][1].max_tokens).toBe(150);
});

it("starts sentence synthesis in parallel but streams audio in sentence order", async () => {
  let finishFirst!: (r: Response) => void;
  const tts = () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: btoa("\0\0"), mimeType: "audio/L16;rate=24000" } }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 3 }] } });
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve; })).mockResolvedValueOnce(tts());
  vi.stubGlobal("fetch", fetch);
  const run = vi.fn().mockResolvedValueOnce({ text: "שלום" }).mockResolvedValueOnce({ choices: [{ message: { content: "Hello! How are you?" } }], usage: { prompt_tokens: 10, completion_tokens: 8 } });
  const response = await worker.fetch(turn(), env(run));
  expect(fetch).toHaveBeenCalledTimes(2);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"reply"');
  finishFirst(tts());
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  expect(first.index).toBe(0);
  const second = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  expect(second.index).toBe(1);
  const done = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  expect(done.cost.tts_input).toBe(4 * .5 / 1e6);
  expect(done.cost.tts_audio).toBe(6 * 6 / 1e6);
  expect(done.errors).toEqual([]);
});

it("reports failed TTS parts while retaining successful part costs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
  const run = vi.fn().mockResolvedValueOnce({ text: "שלום" }).mockResolvedValueOnce({ choices: [{ message: { content: "Hello." } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  const response = await worker.fetch(turn(), env(run));
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(events[1].errors).toEqual([{ index: 0, error: "Provider returned HTTP 503" }]);
  expect(events[1].cost.tts_audio).toBe(0);
  expect(events[1].cost.llm_input).toBeGreaterThan(0);
});

it("reports provider failures without exposing provider body", async () => {
  const response = await worker.fetch(turn(), env(vi.fn().mockRejectedValue(new Error("Provider unavailable"))));
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("Provider unavailable");
});
