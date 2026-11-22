import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CallRecorder, cleanupRecordings, decodeUlaw, encodeUlaw, mixSample, recordingAudio, wavHeader, wavRange } from "../src/recordings";
import type { Env } from "../src/env";

beforeAll(() => vi.stubGlobal("FixedLengthStream", class extends TransformStream {
  constructor(length: number) {
    let received = 0;
    super({
      transform(chunk, controller) { received += chunk.length; controller.enqueue(chunk); },
      flush() { expect(received).toBe(length); },
    });
  }
}));
afterAll(() => vi.unstubAllGlobals());

function fixture() {
  const objects = new Map<string, Uint8Array>();
  const rows: any[] = [];
  const bucket = {
    put: vi.fn(async (key: string, data: Uint8Array) => { objects.set(key, data.slice()); }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
    get: vi.fn(async (key: string, options: any) => {
      const data = objects.get(key); if (!data) return null;
      const chunk = data.slice(options.range.offset, options.range.offset + options.range.length);
      return { body: new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } }) };
    }),
    head: vi.fn(async (key: string) => objects.has(key) ? {} : null),
    createMultipartUpload: vi.fn(async (key: string) => {
      const parts: Uint8Array[] = [];
      return {
        uploadPart: vi.fn(async (part: number, data: Uint8Array) => { parts[part - 1] = data.slice(); return { partNumber: part, etag: String(part) }; }),
        complete: vi.fn(async () => { const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const p of parts) { all.set(p, offset); offset += p.length; } objects.set(key, all); }),
        abort: vi.fn(),
      };
    }),
  };
  const db = { prepare: vi.fn((query: string) => {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      run: vi.fn(async () => {
        if (query.startsWith("INSERT")) rows.push({ call_id: args[0], r2_key: args[3], bytes: args[4], created_at: args[6] });
        if (query.startsWith("DELETE")) rows.splice(rows.findIndex(r => r.call_id === args[0]), 1);
      }),
      first: async () => rows.find(r => r.call_id === args[0]) ?? null,
      all: async () => ({ results: rows.filter(r => r.created_at < args[0]).slice(0, 100) }),
    }; return statement;
  }) };
  return { env: { DB: db, VOICEMAIL_AUDIO: bucket } as unknown as Env, bucket, rows, objects };
}
const pcm = (sample: number, count = 160) => { const data = new Uint8Array(count * 2); const view = new DataView(data.buffer); for (let i = 0; i < count; i++) view.setInt16(i * 2, sample, true); return data; };

describe("call recordings", () => {
  it("round trips signed PCM through standard G.711 mu-law", () => {
    expect(encodeUlaw(0)).toBe(255); expect(decodeUlaw(255)).toBe(0);
    for (const sample of [-32000, -10000, -1000, 0, 1000, 10000, 32000]) expect(Math.abs(decodeUlaw(encodeUlaw(sample)) - sample)).toBeLessThan(650);
  });
  it("mixes with clipping", () => { expect(mixSample(30000, 10000)).toBe(32767); expect(mixSample(-30000, -10000)).toBe(-32768); expect(mixSample(50, -40)).toBe(10); });
  it("writes PCM WAV headers and validates byte ranges", () => {
    const h = new DataView(wavHeader(8000).buffer); expect(h.getUint32(24, true)).toBe(8000); expect(h.getUint32(40, true)).toBe(16000);
    expect(wavRange(null, 100)).toEqual({ start: 0, end: 99 }); expect(wavRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(wavRange("bytes=45-48", 100)).toEqual({ start: 45, end: 48 });
    for (const range of ["bytes=100-", "bytes=5-4", "bytes=-0", "bytes=0-1,3-4", "invalid"]) expect(wavRange(range, 100)).toBeNull();
  });
  it("records one minute at 480000 bytes, mixes inbound, and streams seekable WAV", async () => {
    const f = fixture(), recorder = new CallRecorder(f.env, "recordings/test.ulaw");
    for (let i = 0; i < 3000; i++) { recorder.receive(pcm(1000)); recorder.send(pcm(2000)); }
    await recorder.finish("test", "teacher", "person");
    expect(f.objects.get("recordings/test.ulaw")?.length).toBe(480000);
    expect(decodeUlaw(f.objects.get("recordings/test.ulaw")![0])).toBeCloseTo(3000, -2);
    const full = await recordingAudio(f.env, "test", new Request("https://local/audio"));
    const bytes = new Uint8Array(await full.arrayBuffer()); expect(bytes.length).toBe(960044);
    for (const range of ["bytes=0-43", "bytes=43-48", "bytes=45-48", "bytes=-17"]) {
      const response = await recordingAudio(f.env, "test", new Request("https://local/audio", { headers: { Range: range } }));
      const { start, end } = wavRange(range, bytes.length)!;
      expect(response.status).toBe(206); expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
    }
  });
  it("uses multipart at five MiB and flushes inbound without outbound", async () => {
    const f = fixture(), recorder = new CallRecorder(f.env, "recordings/long.ulaw");
    for (let i = 0; i < 700; i++) { recorder.receive(pcm(100, 8000)); await Promise.resolve(); }
    await recorder.finish("long", "teacher", "person");
    expect(f.bucket.createMultipartUpload).toHaveBeenCalledTimes(1); expect(f.bucket.put).not.toHaveBeenCalled(); expect(f.rows[0].bytes).toBe(5600000);
  });
  it("skips empty and subsecond audio and isolates storage failures", async () => {
    const f = fixture(); const empty = new CallRecorder(f.env, "empty"); await empty.finish("empty", "t", "c");
    empty.send(pcm(0)); await empty.finish("short", "t", "c"); expect(f.bucket.put).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    f.bucket.put.mockRejectedValueOnce(new Error("offline")); const broken = new CallRecorder(f.env, "broken"); broken.send(pcm(1, 8000));
    await expect(broken.finish("broken", "t", "c")).resolves.toBeUndefined(); expect(f.rows).toHaveLength(0); vi.restoreAllMocks();
  });
  it("deletes only expired rows, in bounded batches, R2 before D1", async () => {
    const f = fixture();
    for (let i = 0; i < 101; i++) f.rows.push({ call_id: String(i), r2_key: String(i), created_at: "2000-01-01" });
    f.rows.push({ call_id: "fresh", created_at: new Date().toISOString() });
    await cleanupRecordings(f.env); expect(f.bucket.delete).toHaveBeenCalledTimes(100); expect(f.rows).toHaveLength(2);
    f.bucket.delete.mockRejectedValueOnce(new Error("offline")); await expect(cleanupRecordings(f.env)).rejects.toThrow("offline"); expect(f.rows).toHaveLength(2);
    await cleanupRecordings(f.env); await cleanupRecordings(f.env); expect(f.rows.map(r => r.call_id)).toEqual(["fresh"]);
  });
  it("rejects missing recordings", async () => { await expect(recordingAudio(fixture().env, "missing", new Request("https://local"))).rejects.toThrow(); });
});
