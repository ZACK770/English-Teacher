import { z } from "zod";
import { BusinessStore, EconomicsSchema, MODELS, ReceiptSchema } from "./business";
import { adultControls, controlsFromSettings, TutorControlsSchema, VOICE_OPTIONS, type TutorControls } from "./controls";
import { type Env, type Settings, HttpError, paymentsConfigured, secureEqual, sha256Hex, tokenUrlsafe, bearer } from "./env";
import { PaymentStore, PREFIX, agorot } from "./payments";
import { IVRCopySchema, getCopy, narrationForSlot } from "./pbx";
import { ProgressStore } from "./progress";
import { compilePrompt } from "./prompt";
import { renderNarration } from "./learn";

const ROLES = ["teacher", "translator", "sales", "service", "custom"] as const;
const channel = z.string().max(200).nullable().optional().transform((v) => (v ?? "").trim() || null);
const BotUpdateSchema = z.object({
  label: z.string().min(2).max(100),
  role: z.enum(ROLES),
  description: z.string().max(1000).default(""),
  channel_id: channel,
  enabled: z.boolean().default(true),
  phone_enabled: z.boolean().default(true),
  web_enabled: z.boolean().default(true),
  audience: z.string().max(40).default("general"),
});
const BotCreateSchema = BotUpdateSchema.extend({
  id: z.string().transform((v) => v.trim().toLowerCase()).pipe(z.string().regex(/^[a-z][a-z0-9-]{1,62}$/)),
  role: z.enum(ROLES).default("teacher"),
});

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try { raw = await request.json(); } catch { throw new HttpError(422, "Invalid JSON"); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "נתונים לא תקינים");
  return parsed.data;
}

async function json(request: Request): Promise<Record<string, any>> {
  try { const v = await request.json(); return v && typeof v === "object" ? (v as Record<string, any>) : {}; } catch { return {}; }
}

async function staticHtml(env: Env, request: Request, file: string, csp: string): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(new URL("/" + file, request.url)));
  return new Response(await asset.text(), { headers: { ...HTML_HEADERS, "Content-Security-Policy": csp } });
}

export async function handleStatic(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === "/dashboard") {
    return staticHtml(env, request, "console.html", "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; base-uri 'none'; form-action 'none'");
  }
  if (path === "/learn") {
    return staticHtml(env, request, "portal.html", "default-src 'self'; media-src blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
  }
  if (path.startsWith("/console-assets/")) {
    const name = path.slice("/console-assets/".length);
    if (!/^[a-z]+\.(js|css)$/.test(name)) return null;
    const asset = await env.ASSETS.fetch(new Request(new URL("/" + name, request.url)));
    if (!asset.ok) return null;
    const headers = new Headers(asset.headers);
    headers.set("Cache-Control", "no-cache");
    return new Response(asset.body, { status: 200, headers });
  }
  return null;
}

function defaults(s: Settings, profileId: string): TutorControls {
  return profileId === s.adultStudentId ? adultControls(s.storeTranscripts) : controlsFromSettings(s.storeTranscripts);
}

async function requireProfile(progress: ProgressStore, id: string) {
  const profile = await progress.getBot(id);
  if (!profile) throw new HttpError(404, "Tutor profile not found");
  return profile;
}

async function configPayload(progress: ProgressStore, s: Settings, profileId: string) {
  const profile = await requireProfile(progress, profileId);
  const controls = await progress.loadControls(profileId, defaults(s, profileId));
  const artifact = await compilePrompt(controls, "", profileId, s);
  return {
    profile,
    controls,
    options: {
      voices: VOICE_OPTIONS,
      vad_start_sensitivity: ["START_SENSITIVITY_LOW", "START_SENSITIVITY_HIGH"],
      vad_end_sensitivity: ["END_SENSITIVITY_LOW", "END_SENSITIVITY_HIGH"],
      activity_handling: ["START_OF_ACTIVITY_INTERRUPTS", "NO_INTERRUPTION"],
      turn_coverage: ["TURN_COVERAGE_UNSPECIFIED", "TURN_INCLUDES_ONLY_ACTIVITY", "TURN_INCLUDES_ALL_INPUT", "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"],
      transcription_mode: ["VERBATIM", "SMART"],
    },
    effective: {
      setup_message: artifact.setup_message,
      opening_client_message: { clientContent: { turns: [{ role: "user", parts: [{ text: controls.opening_message }] }], turnComplete: true } },
      history_context: "",
      prompt_fingerprint: artifact.fingerprint,
      read_only_runtime: {
        profile_id: profileId,
        profile_label: profile.label,
        technoline_websocket_path: profile.websocket_path,
        technoline_channel_configured: profile.channel_configured,
        websocket_endpoint: s.geminiLiveUrl,
        automatic_activity_detection: "enabled",
        automatic_activity_detection_editable: false,
        reason_not_editable: "Disabling it requires a client-side VAD implementation that sends activityStart and activityEnd signals.",
        pbx_input: "PCM16LE mono 8000Hz",
        gemini_input: "PCM16LE mono 16000Hz",
        gemini_output: "PCM16LE mono 24000Hz",
        pbx_output: "PCM16LE mono 8000Hz, paced in 20ms frames",
        speaking_rate_control: "not exposed by Gemini Live",
        session_resumption: "enabled",
      },
    },
  };
}

const TRANSLATOR_PROMPT = "You are a concise telephone translator. Translate Hebrew speech to English and other languages to Hebrew unless the caller selects another target. Return only the translation. Do not add lessons, commentary or quizzes. Ask briefly for clarification only if the input cannot be understood.";

async function narrationAudio(b: BusinessStore, id: string) {
  const record = await b.record("narrations", id);
  const audio = await b.getAudio(id);
  return { record, audio };
}

export async function handleAdmin(request: Request, env: Env, s: Settings, path: string): Promise<Response | null> {
  const method = request.method;
  const url = new URL(request.url);
  const progress = new ProgressStore(env.DB);
  const b = new BusinessStore(env.DB);
  const payments = new PaymentStore(b);
  const seg = path.split("/").slice(1).map(decodeURIComponent);
  const ok = (v: unknown, status = 200) => Response.json(v, { status });

  if (path === "/v1/admin/profiles" && method === "GET") return ok({ profiles: await progress.listBots() });

  if (path === "/v1/admin/active-ai-sessions" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT call_id, profile_id, owner_id, acquired_at FROM active_calls WHERE lease_expires_at > ?").bind(Date.now() / 1000).all<Record<string, any>>();
    return ok({ sessions: results.map((r) => ({ call_id: r.call_id, bot_id: r.profile_id, started_at: new Date(Number(r.acquired_at) * 1000).toISOString(), stopping: false })) });
  }
  if (seg[2] === "active-ai-sessions" && seg.length === 5 && seg[4] === "stop" && method === "POST") {
    const row = await env.DB.prepare("SELECT owner_id FROM active_calls WHERE call_id = ? AND lease_expires_at > ?").bind(seg[3], Date.now() / 1000).first<{ owner_id: string }>();
    if (!row) throw new HttpError(404, "Session is no longer active");
    let id: DurableObjectId;
    try { id = env.CALLS.idFromString(row.owner_id); } catch { throw new HttpError(404, "Session is no longer active"); }
    const r = await env.CALLS.get(id).fetch("https://call/stop", { method: "POST" });
    if (r.status !== 202) throw new HttpError(404, "Session is no longer active");
    return ok({ stopping: true, call_id: seg[3] }, 202);
  }

  if (path === "/v1/admin/bots" && method === "POST") {
    const bot = await body(request, BotCreateSchema);
    let controls = controlsFromSettings(s.storeTranscripts);
    if (bot.role === "translator") controls = { ...controls, base_prompt: TRANSLATOR_PROMPT, opening_message: "אמרו למתקשר בעברית: שלום, נא לומר את המשפט לתרגום.", max_call_minutes: 5 };
    if (await progress.getBot(bot.id)) throw new HttpError(409, "Bot id already exists");
    const created = await progress.createBot(bot, controls);
    return ok({ bot: created, config: await configPayload(progress, s, bot.id) }, 201);
  }
  if (seg[2] === "bots" && seg.length >= 4) {
    const botId = seg[3];
    await requireProfile(progress, botId);
    if (seg.length === 4 && method === "PUT") {
      const u = await body(request, BotUpdateSchema);
      return ok({ bot: await progress.updateBot(botId, u) });
    }
    if (seg[4] === "duplicate" && method === "POST") {
      const bot = await body(request, BotCreateSchema);
      if (await progress.getBot(bot.id)) throw new HttpError(409, "Bot id already exists");
      const controls = await progress.loadControls(botId, defaults(s, botId));
      return ok({ bot: await progress.createBot(bot, controls) }, 201);
    }
    if (seg[4] === "versions" && method === "GET") return ok({ bot_id: botId, versions: await progress.botVersions(botId) });
    if (seg[4] === "restore" && seg[5] && method === "POST") {
      const selected = (await progress.botVersions(botId, 100)).find((v) => v.version === Number(seg[5]));
      if (!selected) throw new HttpError(404, "Version not found");
      const parsed = TutorControlsSchema.safeParse(selected.controls);
      if (!parsed.success) throw new HttpError(422, "Version is invalid");
      await progress.saveControls(botId, parsed.data);
      return ok(await configPayload(progress, s, botId));
    }
    if (seg[4] === "preview" && method === "POST") {
      const controls = await body(request, TutorControlsSchema);
      const a = await compilePrompt(controls, "", botId, s);
      return ok({ system_instruction: a.system_instruction, opening_message: a.opening_message, setup_message: a.setup_message, history_context: a.history_context, fingerprint: a.fingerprint });
    }
  }

  if (path === "/v1/admin/config" || seg[2] === "config") {
    const profileId = seg[3] ?? s.studentId;
    if (method === "GET") return ok(await configPayload(progress, s, profileId));
    await requireProfile(progress, profileId);
    if (method === "PUT") await progress.saveControls(profileId, await body(request, TutorControlsSchema));
    else if (method === "DELETE") await progress.saveControls(profileId, defaults(s, profileId));
    else return null;
    return ok(await configPayload(progress, s, profileId));
  }

  if (seg[2] === "diagnostics" && seg[3]) {
    await requireProfile(progress, seg[3]);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500));
    return ok({ profile_id: seg[3], privacy: "Metadata only; no audio or transcripts.", events: await progress.recentDiagnostics(seg[3], limit) });
  }
  if (seg[2] === "traces" && seg[3]) {
    await requireProfile(progress, seg[3]);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100));
    return ok({ profile_id: seg[3], traces: await progress.recentTraces(seg[3], limit) });
  }
  if (seg[0] === "v1" && seg[1] === "progress" && seg[2]) {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100));
    return ok(await progress.report(seg[2], limit));
  }

  if (seg[2] === "business") {
    const kind = seg[3];
    if (kind === "performance" && seg[4]) return ok(await b.performance(seg[4]));
    if (kind === "customers" && seg[4] && seg[5] === "invite" && method === "POST") {
      try { return ok(await b.portalInvite(seg[4])); } catch { throw new HttpError(404, "Customer not found"); }
    }
    if (kind === "customers" && seg[4] && seg[5] === "detail") {
      try { return ok(await b.customerDetail(seg[4])); } catch { throw new HttpError(404, "Customer not found"); }
    }
    if (kind === "overview") return ok(await b.summary());
    if (kind === "economics" && method === "GET") return ok(await b.economics());
    if (kind === "economics" && method === "PUT") return ok(await b.saveEconomics(await body(request, EconomicsSchema)));
    if (kind === "receipts" && method === "POST" && seg.length === 4) {
      const receipt = await body(request, ReceiptSchema);
      try { return ok(await b.receipt(receipt), 201); } catch { throw new HttpError(409, "רישום כפול או לקוח/חבילה לא תקינים"); }
    }
    if (!kind || !MODELS[kind]) throw new HttpError(404, "Not found");
    if (method === "GET" && seg.length === 4) return ok({ items: await b.list(kind) });
    if ((method === "POST" && seg.length === 4) || (method === "PUT" && seg.length === 5)) {
      const parsed = MODELS[kind].safeParse(await json(request));
      if (!parsed.success) throw new HttpError(422, "נתונים לא תקינים או מספר טלפון שכבר רשום");
      try { return ok(await b.save(kind, parsed.data, seg[4] ?? null), method === "POST" ? 201 : 200); }
      catch { throw new HttpError(422, "נתונים לא תקינים או מספר טלפון שכבר רשום"); }
    }
  }

  if (seg[2] === "payments") {
    if (seg[3] === "status" && method === "GET") {
      const q = url.searchParams;
      const limit = Math.max(1, Math.min(Number(q.get("limit") ?? 50) || 50, 200));
      return ok(await payments.overview(env, Math.max(0, Number(q.get("offset") ?? 0) || 0), limit, q.get("customer_id") ?? "", q.get("state") ?? "", q.get("search") ?? ""));
    }
    if (seg[3] === "reconcile" && method === "POST") {
      try { return ok(await payments.reconcile(env)); } catch (e) { throw new HttpError(409, e instanceof Error ? e.message : "Reconcile failed"); }
    }
    if (seg[3] === "issues" && seg[4] && seg[5] === "resolve" && method === "POST") {
      const note = String((await json(request)).note ?? "").slice(0, 1000);
      try { return ok(await payments.resolveIssue(seg[4], note)); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : "Invalid issue"); }
    }
    if (seg[3] === "test-order" && method === "POST") {
      if (!paymentsConfigured(env)) throw new HttpError(409, "חיבור הסליקה אינו פעיל");
      const input = await json(request);
      const packageId = String(input.package_id ?? "");
      const pkg = (await b.list("packages")).find((p) => p.id === packageId);
      if (!pkg || !pkg.active || agorot(pkg.price_ils) > 100) throw new HttpError(422, "בדיקת סליקה מוגבלת לחבילה פעילה עד שקל אחד");
      const callId = "admin-test-" + tokenUrlsafe(12);
      try {
        const order = await payments.create(callId, String(input.customer_id ?? ""), packageId, true);
        if (!(await payments.issue(callId))) throw new Error("לא ניתן לפתוח בקשת בדיקה");
        return ok({ order_id: order.id, category: PREFIX + order.id, amount_ils: order.amount_agorot / 100, mosad_id: env.NEDARIM_MOSAD_ID });
      } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : "Invalid order"); }
    }
  }

  if (seg[2] === "pbx") {
    if (seg[3] === "config" && method === "GET") {
      return ok({
        copy: await getCopy(b), phone: s.systemPhone, project_path: s.projectPath, enabled: s.projectEnabled,
        api_configured: !!env.TLIVR_SYSTEM_API_KEY, callback_configured: !!s.callbackSecret, payment_configured: paymentsConfigured(env),
        live_dtmf_supported: false, managed_channel_configured: !!s.routerChannel, audio_bindings: await b.loadContext("audio-bindings"),
      });
    }
    if (seg[3] === "config" && method === "PUT") {
      const copy = await body(request, IVRCopySchema);
      await b.putSetting("ivr-copy", copy);
      await b.audit("ivr:copy", "99");
      return ok({ copy });
    }
    if (seg[3] === "events" && method === "GET") return ok({ events: await b.list("ivr-events") });
    if (seg[3] === "status" && method === "GET") {
      if (!env.TLIVR_SYSTEM_API_KEY) throw new HttpError(502, "מפתח המערכת אינו מוגדר בשרת");
      const call = async (action: string) => {
        const u = "https://api.tlivr.com/ivrFilesApi.php?" + new URLSearchParams({ apiKey: env.TLIVR_SYSTEM_API_KEY!, action, path: s.projectPath });
        const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
        const data: any = await r.json().catch(() => null);
        if (!r.ok || !data || String(data.status ?? "").toUpperCase() === "ERROR") throw new HttpError(502, "לא ניתן להשלים את הבקשה לטכנוליין כרגע");
        return data;
      };
      const [folder, visits] = await Promise.all([call("folderSettings"), call("extensionVisits")]);
      return ok({ connected: true, extension: Object.fromEntries(["id", "name", "type", "extension"].map((k) => [k, folder[k] ?? null])), visits });
    }
  }

  if (seg[2] === "narrations" && seg[3]) {
    const id = seg[3];
    if (seg[4] === "audio" && method === "POST") return renderNarration(env, s, id);
    if (seg[4] === "audio" && method === "GET") {
      const { record, audio } = await narrationAudio(b, id);
      if (!record || !audio) throw new HttpError(404, "No generated narration");
      if (audio.text_hash !== (await sha256Hex(record.text))) throw new HttpError(409, "הנוסח השתנה. יש לייצר את הקריינות מחדש");
      return new Response(audio.wav, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    }
    if (seg[4] === "publish-to-ivr" && method === "POST") {
      const slot = String((await json(request)).slot ?? "");
      const copy = await getCopy(b);
      if (!Object.hasOwn(copy, slot)) throw new HttpError(400, "Unknown narration placement");
      const { record, audio } = await narrationAudio(b, id);
      if (!record || record.status !== "approved" || !audio) throw new HttpError(409, "נדרש נוסח מאושר וקובץ קריינות שנוצר");
      if (audio.text_hash !== (await sha256Hex(record.text))) throw new HttpError(409, "הנוסח השתנה; יש לייצר קריינות מחדש");
      const next = IVRCopySchema.safeParse({ ...copy, [slot]: record.text });
      if (!next.success) throw new HttpError(422, "נוסח לא תקין");
      await b.putSetting("ivr-copy", next.data);
      await b.saveContext("audio-bindings", { [slot]: id });
      return ok({ published: true, slot, narration_id: id, delivery: "PBX fileLink; no manual upload required" });
    }
  }
  return null;
}

export async function publicNarration(env: Env, narrationId: string, fingerprint: string): Promise<Response> {
  const b = new BusinessStore(env.DB);
  const copy = await getCopy(b);
  for (const [slot, content] of Object.entries(copy)) {
    const audio = await narrationForSlot(b, slot, content);
    if (audio && audio.id === narrationId && secureEqual(audio.hash, fingerprint)) {
      return new Response(audio.wav, { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=86400, immutable" } });
    }
  }
  throw new HttpError(404, "Narration not published");
}

const PreferenceSchema = z.object({
  selected_bot: z.string().min(2).max(63),
  mode: z.string().regex(/^(course|free|translation)$/).default("course"),
  language: z.string().regex(/^(|English|Hebrew|Yiddish|Arabic|Russian|French)$/).default(""),
});

export async function handlePortal(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith("/v1/portal/")) return null;
  const b = new BusinessStore(env.DB);
  const progress = new ProgressStore(env.DB);
  const customerId = await b.portalCustomer(bearer(request.headers.get("Authorization")) ?? "");
  if (!customerId) throw new HttpError(401, "קישור הכניסה אינו תקין או שפג תוקפו");
  if (path === "/v1/portal/me" && request.method === "GET") {
    const detail: Record<string, any> = await b.customerDetail(customerId);
    const c = detail.customer;
    detail.customer = { id: c.id, name: c.name, phone: c.phone, preferred_bot: c.preferred_bot };
    detail.bots = (await progress.listBots()).filter((x) => x.enabled && x.web_enabled && ["teacher", "translator"].includes(x.role)).map((x) => ({ id: x.id, label: x.label, role: x.role }));
    detail.progress = await progress.report(customerId);
    detail.preferences = await b.loadContext("preferences:" + customerId);
    detail.enrollments = (await b.list("enrollments")).filter((e) => e.customer_id === customerId);
    return Response.json(detail);
  }
  if (path === "/v1/portal/preferences" && request.method === "POST") {
    const input = await body(request, PreferenceSchema);
    const bot = await progress.getBot(input.selected_bot);
    if (!bot || !bot.enabled || !bot.web_enabled) throw new HttpError(404, "Bot not available");
    await b.savePreference(customerId, input);
    return Response.json({ saved: true });
  }
  return null;
}
