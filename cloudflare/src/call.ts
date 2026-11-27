import { TutorSession } from "./session";
import { type Env, settings, randomHex, secureEqual } from "./env";
import { pilotLog } from "./pbx-pilot-log";

type PilotSettings = { model: string; voice: string };
type PilotVersions = { active: PilotSettings; previous?: PilotSettings };
const PILOT_SETTINGS_KEY = "pilot-settings";

export class CallSession {
  private session: TutorSession | null = null;
  private pilotPending = false;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  private async pilotSettings(request: Request): Promise<Response> {
    const token = this.env.PBX_PILOT_ADMIN_TOKEN;
    if (!token) return new Response("Not found", { status: 404 });
    if (!secureEqual(request.headers.get("Authorization") ?? "", "Bearer " + token)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const defaults = { model: this.env.PBX_PILOT_MODEL || "qwen/qwen3-235b-a22b-2507", voice: this.env.PBX_PILOT_VOICE || "Amos" };
    if (request.method === "GET") {
      const saved = await this.ctx.storage.get<PilotVersions>(PILOT_SETTINGS_KEY);
      return Response.json(saved ?? { active: defaults }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "PUT") return new Response("Expected GET or PUT", { status: 405 });
    const body = await request.json<Record<string, unknown>>().catch(() => null);
    if (!body || (body.rollback !== true && (
      typeof body.model !== "string" || !/^[\w.-]+\/[\w.:-]+$/.test(body.model) || body.model.length > 150 ||
      typeof body.voice !== "string" || !body.voice.trim() || body.voice.length > 100
    ))) return Response.json({ error: "Supply model and voice, or rollback: true" }, { status: 400 });
    return this.ctx.storage.transaction(async transaction => {
      const saved = await transaction.get<PilotVersions>(PILOT_SETTINGS_KEY);
      const active = body.rollback === true ? saved?.previous : { model: body.model as string, voice: (body.voice as string).trim() };
      if (!active) return Response.json({ error: "No previous settings" }, { status: 409 });
      const previous = saved?.active ?? defaults;
      if (active.model === previous.model && active.voice === previous.voice) {
        return Response.json(saved ?? { active: defaults });
      }
      const versions = { active, previous };
      await transaction.put(PILOT_SETTINGS_KEY, versions);
      return Response.json(versions, { headers: { "Cache-Control": "no-store" } });
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (this.env.PBX_CASCADE_PILOT === "1" && new URL(request.url).pathname === "/v1/admin/pilot/settings") {
      return this.pilotSettings(request);
    }
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
    const pilotVersions = isPilot ? await this.ctx.storage.get<PilotVersions>(PILOT_SETTINGS_KEY) : undefined;
    const callEnv = pilotVersions ? {
      ...this.env, PBX_PILOT_MODEL: pilotVersions.active.model, PBX_PILOT_VOICE: pilotVersions.active.voice,
    } : this.env;
    const s = settings(callEnv);
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
      const session = new TutorSession(server, callEnv, s, this.ctx.id.toString(), request.headers.get("Authorization"));
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
