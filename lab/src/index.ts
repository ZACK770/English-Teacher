import { adultControls, buildSystemInstruction } from "../../cloudflare/src/controls";

interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LAB_PASSCODE?: string;
}
type Message = { role: "user" | "assistant"; content: string };
const SYSTEM = buildSystemInstruction(adultControls(false), "");
const TTS_MODEL = "gemini-3.8-flash-lite-tts";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function upstream(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

function wav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const word = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, "RIFF"); view.setUint32(4, out.length - 8, true); word(8, "WAVE");
  word(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data");
  view.setUint32(40, pcm.length, true); out.set(pcm, 44);
  return out;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

async function chain(request: Request, env: Env) {
  if (!env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured yet" }, 503);
  const start = Date.now();
  const form = await request.formData();
  const audio = form.get("audio");
  const seconds = Number(form.get("seconds"));
  let history: Message[];
  try { history = JSON.parse(String(form.get("history") || "[]")); } catch { return json({ error: "Invalid history" }, 400); }
  if (!(audio instanceof File) || !audio.size || audio.size > 4_000_000 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60 ||
    !Array.isArray(history) || history.length > 40 || history.some(m => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 6000)) {
    return json({ error: "Supply audio (up to 4 MB / 60s), seconds, and up to 40 history messages" }, 400);
  }
  const sttStart = Date.now();
  const stt: any = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: base64(new Uint8Array(await audio.arrayBuffer())) });
  const sttMs = Date.now() - sttStart;
  const transcript = stt.text?.trim();
  if (!transcript) return json({ error: "No speech detected", cost: { whisper: seconds / 60 * 0.000513 }, latency_ms: { stt: sttMs } }, 422);
  const llmStart = Date.now();
  const llm: any = await env.AI.run("@cf/google/gemma-4-26b-a4b-it" as any, {
    messages: [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: transcript }], max_tokens: 160, chat_template_kwargs: { enable_thinking: false },
  });
  const llmMs = Date.now() - llmStart;
  const reply = llm.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("LLM returned no reply");
  const ttsStart = Date.now();
  const tts = await upstream(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: reply }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } } } }),
  });
  const part = tts.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!part?.data) throw new Error("TTS returned no audio");
  const pcm = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
  const rate = Number(/rate=(\d+)/.exec(part.mimeType)?.[1] || 24000);
  const outputSeconds = pcm.length / (rate * 2);
  const inputTokens = llm.usage?.prompt_tokens;
  const outputTokens = llm.usage?.completion_tokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || typeof tts.usageMetadata?.promptTokenCount !== "number") throw new Error("Provider omitted billing usage");
  const audioTokens = tts.usageMetadata.candidatesTokensDetails?.find((d: any) => d.modality === "AUDIO")?.tokenCount ?? outputSeconds * 25;
  const cost = {
    whisper: seconds / 60 * 0.000513,
    llm_input: inputTokens * 0.10 / 1e6, llm_output: outputTokens * 0.30 / 1e6,
    tts_input: tts.usageMetadata.promptTokenCount * 0.50 / 1e6, tts_audio: audioTokens * 6 / 1e6,
  };
  return json({ transcript, reply, audio: base64(wav(pcm, rate)), mime: "audio/wav", model: TTS_MODEL, voice: "Charon",
    cost: { ...cost, total: Object.values(cost).reduce((a, b) => a + b, 0) },
    usage: { inputTokens, outputTokens, tts: tts.usageMetadata, input_seconds: seconds, output_seconds: outputSeconds },
    latency_ms: { stt: sttMs, llm: llmMs, tts: Date.now() - ttsStart, total: Date.now() - start } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!env.LAB_PASSCODE || request.headers.get("Authorization") !== `Bearer ${env.LAB_PASSCODE}`) return json({ error: "Invalid lab passcode" }, 401);
    try {
      if (path === "/api/config" && request.method === "GET") return json({ openai: !!env.OPENAI_API_KEY });
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (Number(request.headers.get("Content-Length")) > 5_000_000) return json({ error: "Request too large" }, 413);
      if (path === "/api/chain") return await chain(request, env);
      if (path === "/api/openai") {
        if (!env.OPENAI_API_KEY) return json({ error: "OpenAI not configured yet — set OPENAI_API_KEY" }, 503);
        return json(await upstream("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: { type: "realtime", model: "gpt-realtime-mini", instructions: SYSTEM,
            audio: { input: { turn_detection: { type: "server_vad" } }, output: { voice: "cedar" } } } }),
        }));
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Provider failure", note: "Failed stages may still incur provider charges; totals only include completed turns." }, 502);
    }
  },
};
