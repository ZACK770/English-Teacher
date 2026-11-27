import { yiddishVoices, isYiddishVoice, yiddishPreview } from "./yiddish-channel";
import type { Env } from "./env";
import { googleStandardVoices } from "./pbx-pilot-google";

const models = [
  { id: "qwen/qwen3-235b-a22b-2507", name: "Qwen 3 235B · הקו הנוכחי" },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
];
const voices = {
  yiddish: yiddishVoices,
  inworld: [{ id: "Amos", name: "Amos" }],
  google: googleStandardVoices,
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function catalog() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error();
    const { data } = await response.json<{ data: { id: string; supported_parameters?: string[] }[] }>();
    const available = new Set(data.filter(model => model.supported_parameters?.includes("tools")).map(model => model.id));
    return json({ models: models.filter((model, index) => index === 0 || available.has(model.id)), voices });
  } catch {
    return json({ models: models.slice(0, 1), voices });
  }
}

async function calls(db: D1Database, id: string | null, after: number, afterTurn: number) {
  if (!id) {
    const { results } = await db.prepare(`
      SELECT e.call_id, MAX(e.created_at) AS last_at, MIN(e.created_at) AS started_at,
        MAX(CASE WHEN e.event_name IN ('session_saved','ai_connection_closed') THEN 1 ELSE 0 END) AS ended,
        s.model, s.duration_seconds, s.estimated_cost_usd
      FROM latency_events e LEFT JOIN sessions s ON s.call_id=e.call_id
      WHERE e.profile_id='isaac-basic' AND e.call_id<>''
      GROUP BY e.call_id ORDER BY MAX(e.id) DESC LIMIT 30
    `).all();
    return json({ calls: results });
  }
  if (id.length > 160) return json({ error: "מזהה השיחה אינו תקין." }, 400);
  const [events, turns, summary, measurements, configuration] = await db.batch([
    db.prepare(`SELECT id, created_at, event_name, since_call_start_ms, details_json FROM latency_events
      WHERE call_id=? AND profile_id='isaac-basic' AND id>? ORDER BY id LIMIT 200`).bind(id, after),
    db.prepare(`SELECT id, created_at, direction, text FROM conversation_turns
      WHERE call_id=? AND profile_id='isaac-basic' AND id>? ORDER BY id LIMIT 200`).bind(id, afterTurn),
    db.prepare(`SELECT duration_seconds, model, learner_turns, tutor_turns, summary_he, success_he, next_step_he,
      input_text_tokens, output_text_tokens, estimated_cost_usd, cost_basis FROM sessions
      WHERE call_id=? AND EXISTS (SELECT 1 FROM latency_events WHERE call_id=? AND profile_id='isaac-basic')`).bind(id, id),
    db.prepare(`SELECT COUNT(*) AS events_count,
      SUM(event_name='pilot_interruption_candidate') AS pauses,
      SUM(event_name='pilot_interruption_resumed') AS resumes,
      SUM(event_name='tutor_interrupted') AS interruptions,
      AVG(CASE WHEN event_name='pilot_turn_to_audio' AND json_valid(details_json)
        THEN json_extract(details_json,'$.elapsed_ms') END) AS response_ms
      FROM latency_events WHERE call_id=? AND profile_id='isaac-basic'`).bind(id),
    db.prepare(`SELECT details_json FROM latency_events WHERE call_id=? AND profile_id='isaac-basic'
      AND event_name='cascade_connect_started' ORDER BY id LIMIT 1`).bind(id),
  ]);
  return json({ events: events.results, turns: turns.results, summary: summary.results[0] ?? null,
    measurements: measurements.results[0] ?? null, configuration: configuration.results[0] ?? null });
}

async function preview(request: Request, env: Env) {
  const raw = await request.text();
  if (raw.length > 12_000) return json({ error: "הבקשה ארוכה מדי." }, 413);
  const body = JSON.parse(raw) as Record<string, unknown> | null;
  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > 1000) {
    return json({ error: "הזן משפט לבדיקה, עד 1000 תווים." }, 400);
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const signal = AbortSignal.timeout(12_000);
  if (body.mode === "yiddish" && isYiddishVoice(body.voice)) return yiddishPreview({...env,YIDDISH_TOOLS_API_KEY:key||env.YIDDISH_TOOLS_API_KEY}, body.text, body.voice);
  if (body.mode === "model" && models.some(model => model.id === body.model)) {
    const credential = key || env.PBX_PILOT_OPENROUTER_KEY;
    if (!credential) return json({ error: "הדבק מפתח OpenRouter קיים בשדה מפתח ספק, או השאר ריק כשהוא מוגדר בשרת." }, 400);
    const start = Date.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal, headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
      body: JSON.stringify({ model: body.model, max_tokens: 240, messages: [
        { role: "system", content: typeof body.prompt === "string" ? body.prompt.slice(0, 4000) : "You are an English tutor. Give a short correction and ask the learner to try again." },
        { role: "user", content: body.text },
      ] }),
    });
    if (!response.ok) return json({ error: "OpenRouter החזיר שגיאה " + response.status }, 502);
    const result = await response.json<{ choices?: { message?: { content?: string } }[]; usage?: Record<string, number> }>();
    return json({ text: result.choices?.[0]?.message?.content, usage: result.usage, ms: Date.now() - start });
  }
  if (body.mode === "google" && voices.google.some(voice => voice.id === body.voice)) {
    if (!key) return json({ error: "בשדה מפתח ספק הדבק מפתח Google Cloud קיים שמורשה ל־Text-to-Speech." }, 400);
    const voice = String(body.voice);
    const start = Date.now();
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST", signal, headers: { "X-Goog-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text: body.text }, voice: { name: voice, languageCode: voice.slice(0, 5) }, audioConfig: { audioEncoding: "MP3" } }),
    });
    if (!response.ok) return json({ error: "Google Text-to-Speech החזיר שגיאה " + response.status }, 502);
    const { audioContent } = await response.json<{ audioContent: string }>();
    return json({ audio: audioContent, ms: Date.now() - start, characters: Array.from(body.text).length });
  }
  if (body.mode === "inworld" && voices.inworld.some(voice => voice.id === body.voice)) {
    const language = body.language ?? "auto";
    const modelId = body.ttsModel ?? "inworld-tts-2-flash";
    if (!["auto", "ydd", "yi", "he", "en"].includes(String(language)) || typeof language !== "string" ||
        !["inworld-tts-2-flash", "inworld-tts-2"].includes(String(modelId)) || typeof modelId !== "string") {
      return json({ error: "בחר שפה ומודל Inworld נתמכים." }, 400);
    }
    const credential = key || env.PBX_PILOT_INWORLD_KEY;
    if (!credential) return json({ error: "הדבק מפתח Inworld קיים בשדה מפתח ספק." }, 400);
    const start = Date.now();
    const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
      method: "POST", signal, headers: { Authorization: "Basic " + credential, "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.text, voiceId: body.voice, modelId, ...(language === "auto" ? {} : { language }), audioConfig: { audioEncoding: "MP3" } }),
    });
    if (!response.ok) return json({ error: "Inworld החזיר שגיאה " + response.status }, 502);
    const { audioContent } = await response.json<{ audioContent: string }>();
    return json({ audio: audioContent, ms: Date.now() - start, characters: Array.from(body.text).length });
  }
  return json({ error: "בחר ספק, מודל וקול נתמכים." }, 400);
}

export async function pilotLab(request: Request, env: Env, section: string): Promise<Response> {
  const query = new URL(request.url).searchParams;
  try {
    if (section === "catalog" && request.method === "GET") return catalog();
    if (section === "calls" && request.method === "GET") {
      return await calls(env.DB, query.get("id"), Number(query.get("after")) || 0, Number(query.get("afterTurn")) || 0);
    }
    if (section === "preview" && request.method === "POST") return await preview(request, env);
    return json({ error: "פעולה לא מוכרת." }, 404);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "פורמט הבקשה אינו תקין." }, 400);
    return json({ error: "הפעולה לא הושלמה. נסה שוב." }, 502);
  }
}
