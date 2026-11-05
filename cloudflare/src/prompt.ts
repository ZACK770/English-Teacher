import type { Settings } from "./env";
import { sha256Hex } from "./env";
import { buildSystemInstruction, type TutorControls } from "./controls";
import {
  END_SESSION_TOOL,
  LESSON_SUMMARY_TOOL,
  NAV_TOOL,
  OBSERVATION_TOOL,
  ROUTE_TOOL,
  TRANSLATION_LANGUAGE_TOOL,
} from "./tools";

export interface PromptArtifact {
  system_instruction: string;
  opening_message: string;
  setup_message: Record<string, unknown>;
  history_context: string;
  fingerprint: string;
  controls: TutorControls;
}

export function buildSetupPayload(c: TutorControls, systemInstruction: string, profileId: string, s: Settings) {
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["AUDIO"],
    speechConfig: {
      languageCode: c.language_code,
      voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } },
    },
  };
  if (c.temperature !== null && c.temperature !== undefined) generationConfig.temperature = c.temperature;
  const inputTranscription: Record<string, unknown> = { mode: c.transcription_mode };
  if (c.transcription_language_codes.length) inputTranscription.languageCodes = c.transcription_language_codes;
  if (c.custom_vocabulary.length) inputTranscription.customVocabulary = c.custom_vocabulary;
  const tools: Record<string, unknown>[] = [OBSERVATION_TOOL, LESSON_SUMMARY_TOOL, END_SESSION_TOOL, TRANSLATION_LANGUAGE_TOOL];
  if (s.navigationBotIds.includes(profileId)) tools.push(ROUTE_TOOL, NAV_TOOL);
  return {
    setup: {
      model: c.model,
      generationConfig,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      inputAudioTranscription: inputTranscription,
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: tools }],
      contextWindowCompression: {
        triggerTokens: c.context_trigger_tokens,
        slidingWindow: { targetTokens: c.context_target_tokens },
      },
      sessionResumption: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: c.vad_start_sensitivity,
          endOfSpeechSensitivity: c.vad_end_sensitivity,
          prefixPaddingMs: c.vad_prefix_ms,
          silenceDurationMs: c.vad_silence_ms,
        },
        activityHandling: c.activity_handling,
        turnCoverage: c.turn_coverage,
      },
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

export async function compilePrompt(
  controls: TutorControls,
  history: string,
  profileId: string,
  s: Settings,
): Promise<PromptArtifact> {
  const system = buildSystemInstruction(controls, history);
  const setup = buildSetupPayload(controls, system, profileId, s);
  const fingerprint = await sha256Hex(
    canonical({ profile_id: profileId, setup, opening_message: controls.opening_message, history_context: history }),
  );
  return {
    system_instruction: system,
    opening_message: controls.opening_message,
    setup_message: setup,
    history_context: history,
    fingerprint,
    controls,
  };
}
