import { z } from "zod";
import {
  DEFAULT_ADULT_OPENING_MESSAGE,
  DEFAULT_ADULT_TUTOR_PROMPT,
  DEFAULT_OPENING_MESSAGE,
  DEFAULT_TUTOR_PROMPT,
} from "./defaults";

export const VOICE_OPTIONS = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe",
  "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib",
  "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima",
  "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

const compact = z.array(z.string()).transform((values) => {
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (cleaned && !out.includes(cleaned)) out.push(cleaned.slice(0, 120));
  }
  return out;
});

export const TutorControlsSchema = z
  .object({
    base_prompt: z.string().min(50).max(16000).default(DEFAULT_TUTOR_PROMPT),
    opening_message: z.string().min(10).max(2000).default(DEFAULT_OPENING_MESSAGE),
    learning_goal: z.string().max(2000).default(""),
    custom_instructions: z.string().max(5000).default(""),
    target_lesson_minutes: z.number().int().min(1).max(120).default(15),
    ending_policy: z
      .enum(["learner_only", "after_target_with_permission", "model_discretion"])
      .default("learner_only"),
    voice: z.string().transform((v) => v.trim()).refine((v) => (VOICE_OPTIONS as readonly string[]).includes(v), "unsupported voice").default("Aoede"),
    model: z.string().min(3).max(200).default("models/gemini-3.8-live"),
    language_code: z.string().min(2).max(20).default("he-IL"),
    temperature: z.number().min(0).max(2).nullable().default(null),
    vad_start_sensitivity: z.enum(["START_SENSITIVITY_LOW", "START_SENSITIVITY_HIGH"]).default("START_SENSITIVITY_LOW"),
    vad_end_sensitivity: z.enum(["END_SENSITIVITY_LOW", "END_SENSITIVITY_HIGH"]).default("END_SENSITIVITY_LOW"),
    vad_prefix_ms: z.number().int().min(0).max(1000).default(400),
    vad_silence_ms: z.number().int().min(100).max(2000).default(700),
    activity_handling: z.enum(["START_OF_ACTIVITY_INTERRUPTS", "NO_INTERRUPTION"]).default("START_OF_ACTIVITY_INTERRUPTS"),
    turn_coverage: z
      .enum([
        "TURN_COVERAGE_UNSPECIFIED",
        "TURN_INCLUDES_ONLY_ACTIVITY",
        "TURN_INCLUDES_ALL_INPUT",
        "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO",
      ])
      .default("TURN_INCLUDES_ONLY_ACTIVITY"),
    input_batch_frames: z.number().int().min(1).max(20).default(5),
    transcription_mode: z.enum(["VERBATIM", "SMART"]).default("VERBATIM"),
    transcription_language_codes: compact.pipe(z.array(z.string()).max(10)).default([]),
    custom_vocabulary: compact.pipe(z.array(z.string()).max(100)).default([]),
    store_transcripts: z.boolean().default(false),
    context_trigger_tokens: z.number().int().min(1000).max(120000).default(12000),
    context_target_tokens: z.number().int().min(500).max(100000).default(6000),
    max_call_minutes: z.number().int().min(1).max(120).default(30),
    idle_timeout_seconds: z.number().int().min(15).max(300).default(60),
    idle_audio_threshold: z.number().int().min(50).max(5000).default(300),
    session_end_action: z.enum(["hangup", "return_to_menu"]).default("hangup"),
    navigation_voice: z.enum(["engine", "gemini"]).default("engine"),
    navigation_interrupt: z.enum(["speech", "stop_word"]).default("stop_word"),
  })
  .refine((c) => c.context_target_tokens < c.context_trigger_tokens, "context target must be smaller than trigger");

export type TutorControls = z.output<typeof TutorControlsSchema>;

export function controlsFromSettings(storeTranscripts: boolean): TutorControls {
  return TutorControlsSchema.parse({ store_transcripts: storeTranscripts });
}

export function adultControls(storeTranscripts: boolean): TutorControls {
  return {
    ...controlsFromSettings(storeTranscripts),
    base_prompt: DEFAULT_ADULT_TUTOR_PROMPT,
    opening_message: DEFAULT_ADULT_OPENING_MESSAGE,
    learning_goal: "לשפר שטף, דיוק וניסוח טבעי באנגלית ברמה בינונית־מתקדמת",
    target_lesson_minutes: 25,
    language_code: "en-US",
    transcription_language_codes: ["en-US", "he-IL"],
  };
}

const POLICY: Record<TutorControls["ending_policy"], string> = {
  learner_only:
    "The learner controls when the lesson ends. Never suggest, imply, or initiate ending. After completing an exercise, continue to a new useful exercise. End only when the learner explicitly asks to stop.",
  after_target_with_permission:
    "Do not suggest ending before the target duration. After the target duration, you may ask once whether the learner wants to continue. End only if the learner agrees.",
  model_discretion:
    "You may suggest ending when a meaningful lesson unit has been completed, but continue immediately if the learner wants more practice.",
};

export function buildSystemInstruction(c: TutorControls, history: string): string {
  const controls = [
    "Runtime lesson controls (authoritative):",
    `- Target lesson duration: ${c.target_lesson_minutes} minutes.`,
    `- Ending policy: ${POLICY[c.ending_policy]}`,
    "- Session lifecycle: when the caller asks to stop, hang up, says goodbye, or the permitted task is finished, briefly say goodbye and call end_session. Do not just say goodbye while leaving the session running. Do not wait for a playback acknowledgement: finish generating the FULL summary and goodbye before calling end_session, never halfway through a sentence. Buffered speech will be played in full by the server before the phone disconnects. Do not wait for another caller response after the final goodbye. This applies to every role, including translator, teacher, sales, service and custom bots. Never end a translation session after a single translated sentence unless the caller is done. Respect the ending policy for deciding task completion, but explicit caller requests to stop always permit immediate session closure.",
  ];
  if (c.learning_goal.trim()) controls.push(`- Current learning goal: ${c.learning_goal.trim()}`);
  if (c.custom_instructions.trim()) controls.push(`- Additional administrator instructions: ${c.custom_instructions.trim()}`);
  return [c.base_prompt.trim(), controls.join("\n"), history.trim()].filter(Boolean).join("\n\n");
}
