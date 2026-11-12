import { b64decode, b64encode, wav, wavToPcm } from "./audio";
import { LIVE_SYSTEM, LIVE_TOOLS } from "./navigation-live";

type Part = Record<string, any>;
type Content = { role: "user" | "model"; parts: Part[] };
type Generate = (model: string, body: Record<string, unknown>) => Promise<Record<string, any>>;
type Tool = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Experimental dialogue backend without any Live/WebSocket model. Uses exactly the
 * same navigation facts/tools and natural-language instructions as Gemini Live. */
export class TextNavigationDialogue {
  private contents: Content[] = [];
  constructor(private generate: Generate, private tool: Tool, private model = "gemini-3.5-flash-lite") {}

  async reply(text: string) {
    this.contents.push({ role: "user", parts: [{ text }] });
    // Retain recent complete exchanges, never an orphan function result.
    if (this.contents.length > 40) {
      const nextUser = this.contents.findIndex((c, i) => i >= this.contents.length - 30 && c.role === "user" && c.parts.some((p) => p.text));
      if (nextUser > 0) this.contents = this.contents.slice(nextUser);
    }
    const usage: Record<string, unknown>[] = [], calls: { name: string; args: Record<string, unknown>; result: Record<string, unknown> }[] = [];
    for (let round = 0; round < 8; round++) {
      const result = await this.generate(this.model, {
        systemInstruction: { parts: [{ text: LIVE_SYSTEM }] },
        contents: this.contents,
        tools: [{ functionDeclarations: LIVE_TOOLS }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      });
      usage.push(result.usageMetadata ?? {});
      // Preserve all provider parts/signatures for function calling across models.
      const parts: Part[] = result.candidates?.[0]?.content?.parts ?? [];
      if (!parts.length) throw new Error("Text navigator returned no candidate");
      this.contents.push({ role: "model", parts });
      const functions = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      if (!functions.length) return { text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim(), calls, usage };
      const responses: Part[] = [];
      for (const call of functions) {
        const name = String(call.name ?? ""), args = call.args ?? {};
        let response: Record<string, unknown>;
        if (!LIVE_TOOLS.some((t) => t.name === name)) response = { error: "Unknown navigation tool" };
        else {
          try { response = await this.tool(name, args); }
          catch { response = { error: "Navigation tool unavailable; say what failed and ask the driver to try again" }; }
        }
        calls.push({ name, args, result: response });
        responses.push({ functionResponse: { name, ...(call.id ? { id: call.id } : {}), response } });
      }
      this.contents.push({ role: "user", parts: responses });
    }
    throw new Error("Text navigator exceeded tool round limit");
  }
}

/** Per-utterance recognition: no open AI audio connection while the driver is silent. */
export async function transcribeNavigation(generate: Generate, pcm16k: Uint8Array) {
  const r = await generate("gemini-3.5-flash-lite", {
    contents: [{ role: "user", parts: [
      { text: "Transcribe exactly the Hebrew words spoken by the phone caller, including street names and numbers. Do not answer or invent missing words. For unintelligible noise, silence or music return an empty heard string." },
      { inlineData: { mimeType: "audio/wav", data: b64encode(wav(pcm16k, 16000)) } },
    ] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: {
      type: "OBJECT", properties: { heard: { type: "STRING" } }, required: ["heard"],
    } },
  });
  const data = JSON.parse((r.candidates?.[0]?.content?.parts ?? []).map((p: Part) => p.text ?? "").join(""));
  return { text: String(data.heard ?? "").trim(), usage: r.usageMetadata ?? {} };
}

export async function speakNavigation(generate: Generate, text: string, voice = "Charon") {
  const r = await generate("gemini-3.8-flash-lite-tts", {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  });
  const part = (r.candidates?.[0]?.content?.parts ?? []).find((p: Part) => p.inlineData);
  if (!part) throw new Error("Navigation speech returned no audio");
  const data = b64decode(part.inlineData.data);
  return { pcm24k: new TextDecoder().decode(data.subarray(0, 4)) === "RIFF" ? wavToPcm(data) : data, usage: r.usageMetadata ?? {} };
}
