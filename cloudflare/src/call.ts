import { TutorSession } from "./session";
import { NavigationSession } from "./navigation-session";
import { type Env, settings } from "./env";

export class CallSession {
  private session: TutorSession | NavigationSession | null = null;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/stop") {
      if (!this.session) return Response.json({ detail: "Session no longer active" }, { status: 404 });
      this.session.stop();
      return Response.json({ stopping: true }, { status: 202 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (this.session) return new Response("Call already active", { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    let started = false;
    const timeout = setTimeout(() => { if (!started) server.close(1008, "Start frame timeout"); }, 10000);
    const s = settings(this.env);
    const profile = request.headers.get("X-Profile");
    const shared = request.headers.get("X-Shared-Router") === "1";
    let incoming: Promise<void> = Promise.resolve();
    server.addEventListener("message", (event) => {
      if (started) {
        incoming = incoming.then(async () => {
          const data = event.data as string | ArrayBuffer | Blob;
          this.session?.receive(data instanceof Blob ? await data.arrayBuffer() : data);
        }).catch(() => this.session?.stop("invalid_audio_frame"));
        return;
      }
      started = true;
      clearTimeout(timeout);
      if (typeof event.data !== "string" || event.data.length > 16384) { server.close(1008, "Invalid start frame"); return; }
      const Session = profile && s.navigationBotIds.includes(profile) ? NavigationSession : TutorSession;
      const session = new Session(server, this.env, s, this.ctx.id.toString(), request.headers.get("Authorization"));
      this.session = session;
      this.ctx.waitUntil(session.run(event.data, profile, shared).catch(() => {
        try { server.close(1011, "Call failed"); } catch { /* peer closed */ }
      }).finally(() => { this.session = null; }));
    });
    server.addEventListener("close", () => { clearTimeout(timeout); this.session?.stop("caller_disconnected", true); });
    server.addEventListener("error", () => { clearTimeout(timeout); this.session?.stop("pbx_transport_error", true); });
    return new Response(null, { status: 101, webSocket: client });
  }
}
