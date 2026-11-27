import { TutorSession } from "./session";
import { type Env, type PilotInterruption, settings, randomHex, secureEqual } from "./env";
import { controlsFromSettings } from "./controls";
import { ProgressStore } from "./progress";
import { pilotLog } from "./pbx-pilot-log";

import { googleStandardVoices, synthesizeGoogleStandard } from "./pbx-pilot-google";

type PilotSettings = { model: string; voice: string; capture?: boolean; interruption?: PilotInterruption; endpointMs?: number; speech?: "inworld" | "google" };
type PilotVersions = { active: PilotSettings; previous?: PilotSettings };
const PILOT_SETTINGS_KEY = "pilot-settings";
const SCHOOL_SETTINGS = "school-teacher-settings";
const GOOGLE_KEY = "pilot-google-tts-key";
const settingsHeaders = { "Cache-Control": "no-store" };

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
    const defaults: PilotSettings = { model: this.env.PBX_PILOT_MODEL || "qwen/qwen3-235b-a22b-2507", voice: this.env.PBX_PILOT_VOICE || "Amos" };
    if (request.method === "GET") {
      const saved = await this.ctx.storage.get<PilotVersions>(PILOT_SETTINGS_KEY);
      const versions = saved ?? { active: defaults };
      const production = await this.ctx.storage.get<PilotSettings>(SCHOOL_SETTINGS);
      if (new URL(request.url).pathname === "/v1/internal/school-voice") {
        const googleKey = production?.speech === "google" ? await this.ctx.storage.get<string>(GOOGLE_KEY) ?? this.env.PBX_PILOT_GOOGLE_TTS_KEY : undefined;
        const { PBX_PILOT_SONIOX_KEY: sonioxKey, PBX_PILOT_OPENROUTER_KEY: openrouterKey, PBX_PILOT_INWORLD_KEY: inworldKey } = this.env;
        const ready = production && sonioxKey && openrouterKey && inworldKey && (production.speech !== "google" || googleKey);
        return Response.json(ready ? { ...production, sonioxKey, openrouterKey, inworldKey, googleKey } : null, { headers: settingsHeaders });
      }
      const active = { ...versions.active, speech: versions.active.speech ?? "inworld", interruption: versions.active.interruption ?? "adaptive", capture: versions.active.capture !== false };
      const headers = settingsHeaders;
      if (new URL(request.url).searchParams.get("export") === "1") {
        const controls = await new ProgressStore(this.env.DB).loadControls("isaac-basic", controlsFromSettings(settings(this.env).storeTranscripts));
        const { model: _geminiModel, voice: _geminiVoice, ...teacher } = controls;
        return Response.json({
          schema_version: 1,
          exported_at: new Date().toISOString(),
          source: { extension: "888", profile_id: "isaac-basic", worker: "english-teacher-pilot-888" },
          target: { extension: "1", status: "handoff_only" },
          audio: { transport: "Technoline WebSocket", encoding: "PCM16", channels: 1, sample_rate_hz: 8000 },
          pipeline: {
            transcription: { provider: "Soniox" },
            model: { provider: "OpenRouter", id: active.model },
            speech: active.speech === "google"
              ? { provider: "Google Cloud Text-to-Speech", model: "Standard", voice: active.voice }
              : { provider: "Inworld", model: "inworld-tts-2-flash", voice: active.voice },
          },
          teacher,
          turn_handling: { interruption: active.interruption, endpoint_ms: active.endpointMs ?? teacher.vad_silence_ms },
          lab_transcript_enabled: active.capture,
          integration_notes: [
            "This is a snapshot of the saved pilot settings, not a production WebSocket or a deployment.",
            "Keep extension 1 customer identity, lesson history, teacher tools and progress storage.",
            "Use the production Technoline channel and the existing provider secret bindings. Do not reuse the isolated 888 endpoint or database.",
            "Verify both a first and follow-up call before moving traffic. Browser-only provider previews are excluded.",
          ],
        }, { headers });
      }
      const googleConfigured = Boolean(await this.ctx.storage.get<string>(GOOGLE_KEY) ?? this.env.PBX_PILOT_GOOGLE_TTS_KEY);
      return Response.json({ ...versions, active, googleConfigured, production: production ?? null }, { headers });
    }
    if (request.method !== "PUT") return new Response("Expected GET or PUT", { status: 405 });
    const body = await request.json<Record<string, unknown>>().catch(() => null);
    if (body?.production === "gemini") {
      await this.ctx.storage.delete(SCHOOL_SETTINGS);
      return Response.json({ production: null }, { headers: settingsHeaders });
    }
    if (body?.production === "cascade") {
      return this.ctx.storage.transaction(async transaction => {
        const saved = await transaction.get<PilotVersions>(PILOT_SETTINGS_KEY);
        const active = saved?.active ?? defaults;
        if (!this.env.PBX_PILOT_SONIOX_KEY || !this.env.PBX_PILOT_OPENROUTER_KEY || !this.env.PBX_PILOT_INWORLD_KEY ||
            (active.speech === "google" && !(await transaction.get<string>(GOOGLE_KEY) ?? this.env.PBX_PILOT_GOOGLE_TTS_KEY))) {
          return Response.json({ error: "חסר חיבור לספק בתמהיל 888." }, { status: 409, headers: settingsHeaders });
        }
        await transaction.put(SCHOOL_SETTINGS, { ...active, interruption: active.interruption ?? "adaptive" });
        return Response.json({ production: active }, { headers: settingsHeaders });
      });
    }
    if (!body || (body.rollback !== true && (
      typeof body.model !== "string" || !/^[\w.-]+\/[\w.:-]+$/.test(body.model) || body.model.length > 150 ||
      typeof body.voice !== "string" || !body.voice.trim() || body.voice.length > 100
    ))) return Response.json({ error: "Supply model and voice, or rollback: true" }, { status: 400 });
    const interruption = body.interruption;
    const endpointMs = body.endpointMs;
    if ((interruption !== undefined && !["legacy", "observe", "adaptive", "adaptive_clear"].includes(String(interruption))) ||
        (endpointMs !== undefined && endpointMs !== null && ![500, 700, 1000, 1500].includes(Number(endpointMs)))) {
      return Response.json({ error: "בחר הגדרות קטיעה וסוף תור מהרשימה." }, { status: 400, headers: settingsHeaders });
    }
    const speech = body.speech;
    if (speech !== undefined && speech !== "inworld" && speech !== "google") {
      return Response.json({ error: "בחר מנוע הקראה זמין." }, { status: 400, headers: settingsHeaders });
    }
    const key = typeof body.googleKey === "string" ? body.googleKey.trim() : "";
    if (key && (speech !== "google" || key.length > 256 || !/^[A-Za-z0-9_-]+$/.test(key))) {
      return Response.json({ error: "הדבק מפתח API תקין של Google Cloud בשדה מפתח Google לטלפון." }, { status: 400, headers: settingsHeaders });
    }
    if (speech === "google" && !googleStandardVoices.some(voice => voice.id === body.voice)) {
      return Response.json({ error: "בחר קול Google Standard מהרשימה." }, { status: 400, headers: settingsHeaders });
    }
    if (key) {
      try {
        const voice = String(body.voice);
        await synthesizeGoogleStandard((input, init) => fetch(input, init), key, voice, voice.startsWith("he-") ? "שלום" : "Hello", AbortSignal.timeout(8000));
      } catch (error) {
        const status = error instanceof Error ? /^google_tts_(\d+)$/.exec(error.message)?.[1] : undefined;
        return Response.json({ error: "בדיקת מפתח Google נכשלה" + (status ? " (HTTP " + status + ")" : "") +
          ". בדוק שהמפתח שייך לפרויקט עם Cloud Text-to-Speech API וחיוב פעיל." }, { status: 400, headers: settingsHeaders });
      }
    }
    return this.ctx.storage.transaction(async transaction => {
      const saved = await transaction.get<PilotVersions>(PILOT_SETTINGS_KEY);
      const previous = saved?.active ?? defaults;
      const selected = body.rollback === true ? saved?.previous : {
        model: body.model as string,
        voice: (body.voice as string).trim(),
        speech: speech ?? previous.speech,
        interruption: (interruption as PilotInterruption | undefined) ?? previous.interruption,
        endpointMs: endpointMs === null ? undefined : endpointMs === undefined ? previous.endpointMs : Number(endpointMs),
        capture: typeof body.capture === "boolean" ? body.capture : previous.capture,
      };
      if (!selected) return Response.json({ error: "No previous settings" }, { status: 409 });
      const active = { ...selected, interruption: selected.interruption ?? "adaptive", speech: selected.speech ?? "inworld", capture: selected.capture !== false };
      const googleConfigured = Boolean(key || ((await transaction.get<string>(GOOGLE_KEY)) ?? this.env.PBX_PILOT_GOOGLE_TTS_KEY));
      if (active.speech === "google" && !googleStandardVoices.some(voice => voice.id === active.voice)) {
        return Response.json({ error: "בחר קול Google Standard מהרשימה." }, { status: 400, headers: settingsHeaders });
      }
      if (active.speech === "google" && !googleConfigured) {
        return Response.json({ error: "הדבק פעם אחת מפתח Google Cloud בשדה מפתח Google לטלפון." }, { status: 400, headers: settingsHeaders });
      }
      if (key) await transaction.put(GOOGLE_KEY, key);
      if (active.model === previous.model && active.voice === previous.voice && active.capture === (previous.capture !== false) && active.speech === (previous.speech ?? "inworld") &&
          active.interruption === (previous.interruption ?? "adaptive") && active.endpointMs === previous.endpointMs) {
        return Response.json({ ...saved, active, googleConfigured }, { headers: settingsHeaders });
      }
      const versions = { active, previous };
      await transaction.put(PILOT_SETTINGS_KEY, versions);
      return Response.json({ ...versions, googleConfigured }, { headers: settingsHeaders });
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (this.env.PBX_CASCADE_PILOT === "1" && ["/v1/admin/pilot/settings", "/v1/internal/school-voice"].includes(new URL(request.url).pathname)) {
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
    const google = pilotVersions?.active.speech === "google";
    const googleKey = google ? await this.ctx.storage.get<string>(GOOGLE_KEY) ?? this.env.PBX_PILOT_GOOGLE_TTS_KEY : undefined;
    const callEnv: Env = isPilot ? {
      ...this.env,
      PBX_PILOT_MODEL: pilotVersions?.active.model ?? this.env.PBX_PILOT_MODEL,
      PBX_PILOT_VOICE: pilotVersions?.active.voice ?? this.env.PBX_PILOT_VOICE,
      PBX_PILOT_INTERRUPTION: pilotVersions?.active.interruption ?? "adaptive",
      PBX_PILOT_ENDPOINT_MS: pilotVersions?.active.endpointMs,
      PBX_PILOT_SPEECH: google ? "google" : "inworld",
      PBX_PILOT_GOOGLE_TTS_KEY: googleKey,
      PBX_PILOT_CAPTURE: pilotVersions?.active.capture === false ? "0" : "1",
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
