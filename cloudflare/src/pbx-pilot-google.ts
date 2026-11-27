import { b64decode, wavToPcm } from "./audio";

export const googleStandardVoices = [
  { id: "he-IL-Standard-B", name: "עברית · Standard B" },
  { id: "en-US-Standard-J", name: "אנגלית · Standard J" },
];

export async function synthesizeGoogleStandard(
  request: typeof fetch, key: string, voice: string, text: string, signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await request("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    signal,
    headers: { "X-Goog-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { name: voice, languageCode: voice.slice(0, 5) },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
    }),
  });
  if (!response.ok) throw new Error("google_tts_" + response.status);
  const { audioContent } = await response.json<{ audioContent?: string }>();
  if (!audioContent) throw new Error("google_tts_empty");
  const pcm = wavToPcm(b64decode(audioContent));
  if (!pcm.length || pcm.length % 2) throw new Error("google_tts_invalid_audio");
  return pcm;
}
