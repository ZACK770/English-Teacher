import { type Env, HttpError } from "./env";

const PART = 5 * 1024 * 1024;
export function encodeUlaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let value = Math.min(32635, Math.abs(sample)) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(value & mask); mask >>= 1) exponent--;
  value = (value >> (exponent + 3)) & 15;
  return ~(sign | (exponent << 4) | value) & 255;
}
export function decodeUlaw(byte: number): number {
  const value = ~byte & 255;
  const sample = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
  return value & 128 ? 132 - sample : sample - 132;
}
export function mixSample(a: number, b: number): number { return Math.max(-32768, Math.min(32767, a + b)); }

export class CallRecorder {
  private inbound: number[] = [];
  private offset = 0;
  private buffer = new Uint8Array(PART);
  private used = 0;
  private bytes = 0;
  private pending = 0;
  private failed = false;
  private upload?: R2MultipartUpload;
  private parts: R2UploadedPart[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private env: Env, private key: string | (() => string)) {}
  private objectKey() { return typeof this.key === "string" ? this.key : this.key(); }
  receive(pcm: Uint8Array) {
    this.safe(() => {
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let i = 0; i + 1 < pcm.length; i += 2) this.inbound.push(view.getInt16(i, true));
      while (this.inbound.length - this.offset > 1600) this.append(this.inbound[this.offset++]);
      this.compact();
    });
  }
  send(pcm: Uint8Array) {
    this.safe(() => {
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let i = 0; i + 1 < pcm.length; i += 2) this.append(mixSample(view.getInt16(i, true), this.offset < this.inbound.length ? this.inbound[this.offset++] : 0));
      this.compact();
    });
  }
  private compact() { this.inbound = this.inbound.slice(this.offset); this.offset = 0; }
  private safe(action: () => void) {
    if (this.failed || !this.env.VOICEMAIL_AUDIO) return;
    try { action(); } catch { this.fail(); }
  }
  private fail() { this.failed = true; this.inbound = []; console.warn("Call recording failed"); }
  private append(sample: number) {
    this.buffer[this.used++] = encodeUlaw(sample);
    this.bytes++;
    if (this.used !== PART) return;
    if (this.pending >= 2) throw new Error("Recording upload backlog");
    const part = this.buffer;
    this.buffer = new Uint8Array(PART); this.used = 0; this.pending++;
    this.chain = this.chain.then(async () => {
      if (this.failed) return;
      this.upload ??= await this.env.VOICEMAIL_AUDIO!.createMultipartUpload(this.objectKey());
      this.parts.push(await this.upload.uploadPart(this.parts.length + 1, part));
    }).catch(() => this.fail()).finally(() => { this.pending--; });
  }
  async finish(callId: string, profileId: string, customerId: string) {
    this.safe(() => { while (this.offset < this.inbound.length) this.append(this.inbound[this.offset++]); this.compact(); });
    await this.chain;
    try {
      if (this.failed || this.bytes < 8000 || !customerId || !this.env.VOICEMAIL_AUDIO) { await this.upload?.abort(); return; }
      const tail = this.buffer.slice(0, this.used);
      if (this.upload) {
        if (tail.length) this.parts.push(await this.upload.uploadPart(this.parts.length + 1, tail));
        await this.upload.complete(this.parts);
      } else await this.env.VOICEMAIL_AUDIO.put(this.objectKey(), tail);
      try {
        await this.env.DB.prepare("INSERT INTO call_recordings(call_id,profile_id,customer_id,r2_key,bytes,duration_ms,created_at) VALUES(?,?,?,?,?,?,?)")
          .bind(callId, profileId, customerId, this.objectKey(), this.bytes, this.bytes / 8, new Date().toISOString()).run();
      } catch { await this.env.VOICEMAIL_AUDIO.delete(this.objectKey()); throw new Error("Recording metadata failed"); }
    } catch { this.fail(); await this.upload?.abort().catch(() => {}); }
  }
}

export function wavHeader(bytes: number): Uint8Array {
  const header = new Uint8Array(44), view = new DataView(header.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const) header.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, 36 + bytes * 2, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, bytes * 2, true);
  return header;
}
export function wavRange(range: string | null, size: number) {
  if (!range) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? { start, end } : null;
}
export async function recordingAudio(env: Env, callId: string, request: Request) {
  const row = await env.DB.prepare("SELECT r2_key,bytes FROM call_recordings WHERE call_id=?").bind(callId).first<{ r2_key: string; bytes: number }>();
  if (!row || !env.VOICEMAIL_AUDIO) throw new HttpError(404, "ההקלטה אינה זמינה");
  const size = 44 + row.bytes * 2, range = wavRange(request.headers.get("Range"), size);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const { start, end } = range;
  const offset = Math.max(0, Math.floor((start - 44) / 2));
  const length = Math.max(0, Math.floor((end - 44) / 2) - offset + 1);
  const object = length ? await env.VOICEMAIL_AUDIO.get(row.r2_key, { range: { offset, length } }) : await env.VOICEMAIL_AUDIO.head(row.r2_key);
  if (!object) throw new HttpError(404, "ההקלטה אינה זמינה");
  let position = 44 + offset * 2;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) { if (start < 44) controller.enqueue(wavHeader(row.bytes).slice(start, Math.min(end + 1, 44))); },
    transform(chunk, controller) {
      const pcm = new Uint8Array(chunk.length * 2), view = new DataView(pcm.buffer);
      chunk.forEach((byte, i) => view.setInt16(i * 2, decodeUlaw(byte), true));
      const from = Math.max(0, start - position), to = Math.min(pcm.length, end + 1 - position);
      if (to > from) controller.enqueue(pcm.subarray(from, to));
      position += pcm.length;
    },
  });
  if ("body" in object) void (object as R2ObjectBody).body.pipeTo(transform.writable).catch(() => {});
  else void transform.writable.getWriter().close();
  const fixed = new FixedLengthStream(end - start + 1);
  void transform.readable.pipeTo(fixed.writable).catch(() => {});
  return new Response(fixed.readable, { status: request.headers.has("Range") ? 206 : 200, headers: {
    "Content-Type": "audio/wav", "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(request.headers.has("Range") ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  } });
}
export async function cleanupRecordings(env: Env) {
  const { results } = await env.DB.prepare("SELECT call_id,r2_key FROM call_recordings WHERE created_at<? ORDER BY created_at LIMIT 100")
    .bind(new Date(Date.now() - 90 * 86400000).toISOString()).all<{ call_id: string; r2_key: string }>();
  if (results.length) await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO recording_deletions(r2_key,created_at) SELECT json_extract(value,'$.r2_key'),? FROM json_each(?)")
      .bind(new Date().toISOString(), JSON.stringify(results)),
    env.DB.prepare("DELETE FROM call_recordings WHERE call_id IN (SELECT json_extract(value,'$.call_id') FROM json_each(?))").bind(JSON.stringify(results)),
  ]);
  await drainRecordingDeletions(env);
}

export async function drainRecordingDeletions(env: Env, keys: string[] | null = null) {
  if (!env.VOICEMAIL_AUDIO) return 0;
  const { results } = await env.DB.prepare(`SELECT r2_key FROM recording_deletions
    WHERE (? IS NULL OR r2_key IN (SELECT value FROM json_each(?))) ORDER BY created_at,r2_key LIMIT 100`)
    .bind(keys === null ? null : JSON.stringify(keys), keys === null ? null : JSON.stringify(keys)).all<{ r2_key: string }>();
  let deleted = 0;
  for (const row of results) {
    try {
      await env.VOICEMAIL_AUDIO.delete(row.r2_key);
      await env.DB.prepare("DELETE FROM recording_deletions WHERE r2_key=?").bind(row.r2_key).run();
      deleted++;
    } catch { console.warn("Recording deletion deferred"); }
  }
  return deleted;
}
