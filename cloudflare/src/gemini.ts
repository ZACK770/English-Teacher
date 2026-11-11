import { b64decode, b64encode } from "./audio";

export type GeminiEvent =
  | { type: "audio"; pcm24k: Uint8Array }
  | { type: "interrupted" }
  | { type: "transcript"; role: "learner" | "tutor"; text: string }
  | { type: "turn_complete" }
  | { type: "tool_call"; calls: ToolCall[] }
  | { type: "usage"; usage: Record<string, unknown> }
  | { type: "go_away"; detail: unknown }
  | { type: "closed" };

export interface ToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

/** Server-to-server Gemini Live client; events are delivered in arrival order. */
export class GeminiLive {
  private socket: WebSocket | null = null;
  private queue: GeminiEvent[] = [];
  private waiters: ((e: GeminiEvent) => void)[] = [];
  private closed = false;
  private generation = 0;
  private abort: AbortController | null = null;
  resumeHandle: string | null = null;

  constructor(private url: string, private key: string, private setup: unknown) {}

  async connect(timeoutMs = 20000): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Gemini connect timeout")), timeoutMs);
    });
    try {
      await Promise.race([this.open(), timer]);
    } catch (error) {
      this.close();
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async open(): Promise<void> {
    const generation = ++this.generation;
    this.abort = new AbortController();
    const response = await fetch(this.url.replace(/^wss:/, "https:") + "?key=" + encodeURIComponent(this.key), {
      headers: { Upgrade: "websocket" },
      signal: this.abort.signal,
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(`Gemini upgrade failed: ${response.status}`);
    socket.accept();
    if (this.closed || generation !== this.generation) {
      socket.close(1000, "cancelled");
      throw new Error("Gemini connection cancelled");
    }
    this.socket = socket;
    const ack = new Promise<void>((resolve, reject) => {
      let acknowledged = false;
      let incoming: Promise<void> = Promise.resolve();
      socket.addEventListener("message", (message) => {
        incoming = incoming.then(async () => {
          if (this.closed || generation !== this.generation) return;
          const data = message.data as string | ArrayBuffer | Blob;
          const text = typeof data === "string" ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
          let event: Record<string, any>;
          try {
            event = JSON.parse(text);
          } catch {
            return;
          }
          if (!acknowledged) {
            if ("setupComplete" in event) {
              acknowledged = true;
              resolve();
            } else {
              const detail = event.error?.message;
              reject(new Error("Gemini setup was not acknowledged" + (detail ? ": " + String(detail).slice(0, 200) : "")));
            }
            return;
          }
          this.dispatch(event);
        }).catch((error) => {
          reject(error);
          this.close();
        });
      });
      socket.addEventListener("close", (event) => {
        if (!acknowledged) reject(new Error(`Gemini closed during setup (${event.code}): ${event.reason.slice(0, 200)}`));
        this.finish();
      });
      socket.addEventListener("error", (event) => {
        const detail = event.error instanceof Error ? event.error.message : event.message;
        if (!acknowledged) reject(new Error("Gemini socket error" + (detail ? ": " + detail.slice(0, 200) : "")));
        this.finish();
      });
    });
    this.send(this.setup);
    await ack;
  }

  private dispatch(event: Record<string, any>) {
    if (event.sessionResumptionUpdate) {
      const update = event.sessionResumptionUpdate;
      this.resumeHandle = update.resumable && update.newHandle ? String(update.newHandle) : null;
    }
    const usage = event.usageMetadata;
    if (usage) this.push({ type: "usage", usage });
    const server = event.serverContent ?? {};
    if (server.interrupted) this.push({ type: "interrupted" });
    for (const [key, role] of [["inputTranscription", "learner"], ["outputTranscription", "tutor"]] as const) {
      const text = String(server[key]?.text ?? "").trim();
      if (text) this.push({ type: "transcript", role, text });
    }
    for (const part of server.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.push({ type: "audio", pcm24k: b64decode(part.inlineData.data) });
    }
    if (server.turnComplete) this.push({ type: "turn_complete" });
    const calls = event.toolCall?.functionCalls;
    if (calls?.length) this.push({ type: "tool_call", calls });
    if ("goAway" in event) this.push({ type: "go_away", detail: event.goAway });
  }

  private push(event: GeminiEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.queue.push(event);
  }

  private finish() {
    if (this.closed) return;
    this.closed = true;
    this.push({ type: "closed" });
  }

  next(): Promise<GeminiEvent> {
    const event = this.queue.shift();
    if (event) return Promise.resolve(event);
    if (this.closed) return Promise.resolve({ type: "closed" });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  send(payload: unknown) {
    if (!this.socket || this.closed) throw new Error("Gemini Live socket is not connected");
    this.socket.send(JSON.stringify(payload));
  }

  sendAudio(pcm16k: Uint8Array) {
    this.send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: b64encode(pcm16k) } } });
  }

  startGreeting(text: string) {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
  }

  addContext(text: string) {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } });
  }

  submitToolResult(call: ToolCall, saved: boolean, result?: Record<string, unknown>) {
    this.send({
      toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: result ?? { saved } }] },
    });
  }

  close() {
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, "done");
    } catch {
      /* already closed */
    }
    this.finish();
  }
}
