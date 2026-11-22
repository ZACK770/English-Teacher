import { expect, it, vi } from "vitest";
import { FRAME_BYTES, FRAME_MS } from "../src/audio";
import { type Env, settings } from "../src/env";
import { TutorSession } from "../src/session";

function session() {
  const env = {} as Env;
  const tutor = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner") as any;
  tutor.callId = "call";
  tutor.customerId = "customer";
  tutor.profileId = "teacher";
  tutor.controls = { store_transcripts: false };
  tutor.progress = { logLatency: vi.fn().mockResolvedValue(undefined) };
  return tutor;
}

async function output(tutor: any, events: unknown[]) {
  tutor.ai = { next: vi.fn(async () => { const event = events.shift(); if (!event) tutor.abort.abort(); return event; }) };
  await tutor.aiToOutput();
}

it.each([0, 2])("logs queued PCM including partial bytes before interrupt clears it: %s frames", async frames => {
  const tutor = session();
  tutor.output = Array.from({ length: frames }, () => new Uint8Array(FRAME_BYTES));
  tutor.partial = new Uint8Array(frames ? FRAME_BYTES / 2 : 0);
  await output(tutor, [{ type: "interrupted" }]);
  expect(tutor.progress.logLatency).toHaveBeenCalledExactlyOnceWith("teacher", "call", "tutor_interrupted", expect.any(Number), expect.any(Number), {
    queued_audio_bytes: frames ? FRAME_BYTES * 2.5 : 0,
    queued_audio_ms: frames ? FRAME_MS * 2.5 : 0,
  });
  expect(tutor.output).toHaveLength(0);
  expect(tutor.partial.byteLength).toBe(0);
});

it("logs only the boundary rather than each incoming audio frame", async () => {
  const tutor = session();
  tutor.firstAudio = true;
  const events = Array.from({ length: 20 }, () => ({ type: "audio", pcm24k: new Uint8Array(960) }));
  await output(tutor, [...events, { type: "turn_complete" }]);
  expect(tutor.output).toHaveLength(20);
  expect(tutor.progress.logLatency).toHaveBeenCalledExactlyOnceWith("teacher", "call", "tutor_turn_complete", expect.any(Number), expect.any(Number), {
    tutor_turn: 1, queued_audio_bytes: 20 * FRAME_BYTES, queued_audio_ms: 20 * FRAME_MS,
  });
});

it("records an empty completed turn", async () => {
  const tutor = session();
  await output(tutor, [{ type: "turn_complete" }]);
  expect(tutor.progress.logLatency.mock.calls[0][5]).toEqual({ tutor_turn: 1, queued_audio_bytes: 0, queued_audio_ms: 0 });
});

it.each([false, true])("captures output at call end before draining or cleanup: disconnected=%s", async disconnected => {
  const tutor = session();
  tutor.output = [new Uint8Array(FRAME_BYTES)];
  tutor.partial = new Uint8Array(FRAME_BYTES / 2);
  tutor.stop(disconnected ? "caller_disconnected" : "model:task_completed", disconnected);
  const drain = vi.spyOn(tutor, "drainFinalAudio").mockImplementation(async () => {
    const logs = tutor.progress.logLatency.mock.calls.filter((args: unknown[]) => args[2] === "audio_queue_at_end");
    expect(logs).toHaveLength(1);
    expect(logs[0][5]).toEqual({ queued_audio_bytes: FRAME_BYTES * 1.5, queued_audio_ms: FRAME_MS * 1.5, disconnected, phase: "before_drain" });
  });
  await tutor.run("{}", null, false);
  expect(drain).toHaveBeenCalledOnce();
});

it("does not prevent final audio draining when the new end log fails", async () => {
  const tutor = session();
  tutor.stop("model:task_completed");
  tutor.progress.logLatency.mockImplementation(async (_profile: string, _call: string, event: string) => {
    if (event === "audio_queue_at_end") throw new Error("logging unavailable");
  });
  const drain = vi.spyOn(tutor, "drainFinalAudio").mockResolvedValue(undefined);
  await tutor.run("{}", null, false);
  expect(drain).toHaveBeenCalledOnce();
});
