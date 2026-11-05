export const FRAME_BYTES = 320;
export const FRAME_MS = 20;
export const SILENCE_FRAME = new Uint8Array(FRAME_BYTES);

function samples(data: Uint8Array): Int16Array {
  const usable = data.byteLength - (data.byteLength % 2);
  const copy = new Uint8Array(usable);
  copy.set(data.subarray(0, usable));
  return new Int16Array(copy.buffer);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export function upsample8kTo16k(data: Uint8Array): Uint8Array {
  const source = samples(data);
  if (!source.length) return new Uint8Array();
  const output = new Int16Array(source.length * 2);
  let previous = source[0];
  for (let i = 0; i < source.length; i++) {
    const sample = source[i];
    output[i * 2] = Math.floor((previous + sample) / 2);
    output[i * 2 + 1] = sample;
    previous = sample;
  }
  return new Uint8Array(output.buffer);
}

export function downsample24kTo8k(data: Uint8Array, carry: Uint8Array = new Uint8Array()): [Uint8Array, Uint8Array] {
  const source = samples(concat([carry, data]));
  const usable = source.length - (source.length % 3);
  const output = new Int16Array(usable / 3);
  for (let i = 0; i < usable; i += 3) {
    output[i / 3] = Math.floor((source[i] + source[i + 1] + source[i + 2]) / 3);
  }
  return [new Uint8Array(output.buffer), new Uint8Array(source.slice(usable).buffer)];
}

export function meanSquare(data: Uint8Array): number {
  const source = samples(data);
  if (!source.length) return 0;
  let sum = 0;
  for (const v of source) sum += v * v;
  return sum / source.length;
}

export function wav(pcm: Uint8Array, rate: number): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return concat([new Uint8Array(header.buffer), pcm]);
}

export function wavToPcm(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const id = String.fromCharCode(...data.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return data.slice(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return new Uint8Array();
}

export function b64encode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function b64decode(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
