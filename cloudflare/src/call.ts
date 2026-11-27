import { TutorSession } from "./session";
import { type Env, settings, randomHex } from "./env";
import { pilotLog } from "./pbx-pilot-log";

export class CallSession {
  private session: TutorSession | null = null;
  private pilotPending = false;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/stop") {
      if (!this.session) return Response.json({ detail: "Session no longer active" }, { status: 404 });
      this.session.stop();
      return Response.json({ stopping: true }, { status: 202 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const isPilot = this.env.PBX_CASCADE_PILOT === "1";
    const trace = (stage: Parameters<typeof pilotLog>[1], details?: Parameters<typeof pilotLog>[2]) => {
      if (isPilot) this.ctx.waitUntil(pilotLog(this.env, stage, details));
    };
    if (this.session || this.pilotPending) {
      trace("socket_busy");
      return new Response("Call already active", { status: 409 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    trace("socket_accepted");
    let started = false;
    let expired = false;
    if (isPilot) this.pilotPending = true;
    const timeout = setTimeout(() => {
      if (!started) {
        expired = true;
        trace("start_timeout");
        if (isPilot) this.pilotPending = false;
        server.close(1008, "Start frame timeout");
      }
    }, 10000);
    const s = settings(this.env);
    const profile = request.headers.get("X-Profile");
    let incoming: Promise<void> = Promise.resolve();
    const portalCustomer = new URL(request.url).pathname === "/v1/portal/voice" ? request.headers.get("X-Portal-Customer") : null;
    if (portalCustomer && profile) {
      const session = new TutorSession(server, this.env, s, this.ctx.id.toString(), null, { customerId: portalCustomer, teacherId: request.headers.get("X-Portal-Teacher") || "" });
      this.session = session;
      clearTimeout(timeout);
      server.addEventListener("message", (event) => {
        incoming = incoming.then(async () => {
          const data = event.data as string | ArrayBuffer | Blob;
          session.receive(data instanceof Blob ? await data.arrayBuffer() : data);
        }).catch(() => session.stop("invalid_audio_frame"));
      });
      server.addEventListener("close", event => session.pbxClosed(event));
      server.addEventListener("error", () => session.stop("web_transport_error", true));
      this.ctx.waitUntil(session.run(JSON.stringify({ type: "start", token: "portal", callId: "web-" + randomHex(12), format: "pcm16;rate=8000;ch=1" }), profile, false)
        .catch(() => { try { server.close(1011, "Call failed"); } catch { /* Peer closed. */ } })
        .finally(() => { this.session = null; }));
      return new Response(null, { status: 101, webSocket: client });
    }
    const shared = request.headers.get("X-Shared-Router") === "1";
    server.addEventListener("message", (event) => {
      if (expired) return;
      if (started) {
        incoming = incoming.then(async () => {
          const data = event.data as string | ArrayBuffer | Blob;
          this.session?.receive(data instanceof Blob ? await data.arrayBuffer() : data);
        }).catch(() => this.session?.stop("invalid_audio_frame"));
        return;
      }
      started = true;
      if (isPilot) this.pilotPending = false;
      clearTimeout(timeout);
      if (typeof event.data !== "string" || event.data.length > 16384) {
        trace("start_rejected", { text_frame: typeof event.data === "string" });
        server.close(1008, "Invalid start frame");
        return;
      }
      trace("start_received");
      const session = new TutorSession(server, this.env, s, this.ctx.id.toString(), request.headers.get("Authorization"));
      this.session = session;
      this.ctx.waitUntil(session.run(event.data, profile, shared).catch(() => {
        try { server.close(1011, "Call failed"); } catch { /* peer closed */ }
      }).finally(() => { this.session = null; }));
    });
    server.addEventListener("close", event => {
      clearTimeout(timeout);
      trace("socket_closed", { code: event.code, start_received: started });
      if (expired) return;
      if (isPilot && !started) this.pilotPending = false;
      else this.session?.pbxClosed(event);
    });
    server.addEventListener("error", () => {
      clearTimeout(timeout);
      trace("socket_error", { start_received: started });
      if (expired) return;
      if (isPilot && !started) this.pilotPending = false;
      else this.session?.stop("pbx_transport_error", true);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}
