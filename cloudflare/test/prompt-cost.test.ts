import { describe, expect, it } from "vitest";
import { adRuntimeContext, SALES_TOOLS } from "../src/ad-entry";
import { HAREDI_CONTENT_RULE } from "../src/content-rules";
import { buildSystemInstruction, controlsFromSettings, type TutorControls } from "../src/controls";
import { settings, type Env } from "../src/env";
import { lessonInstruction, type LessonPlan } from "../src/learning";
import { buildSetupPayload, compilePrompt } from "../src/prompt";

const s = settings({} as Env);
const lesson: LessonPlan = {
  level: "beginner", topic: "everyday", conversation_mode: "guided", learning_load: "light",
  correction_policy: "after_answer", closing_activity: "roleplay", vocabulary: [], grammar: [],
};
const controls = { ...controlsFromSettings(true), lesson };
const names = (c: TutorControls = controls, customerId?: string) => buildSetupPayload(c, "test", "teacher", s, { customerId }).setup.tools[0].functionDeclarations.map(t => t.name);

it("requires longer detected speech to start a PBX lesson turn without changing how it ends", () => {
  const vad = (c: TutorControls) => buildSetupPayload(c, "test", "teacher", s).setup.realtimeInputConfig;
  const web = vad(controls);
  expect(web.automaticActivityDetection.prefixPaddingMs).toBe(400);
  expect(vad({ ...controls, phone_lesson: true })).toEqual({
    ...web,
    automaticActivityDetection: {
      startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
      endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
      prefixPaddingMs: 500,
      silenceDurationMs: 700,
    },
  });
  expect(vad({ ...controls, phone_lesson: true, vad_prefix_ms: 650 }).automaticActivityDetection.prefixPaddingMs).toBe(650);
});

describe("call-scoped tool availability", () => {
  it("omits assessment, sales and callback tools when unavailable, but keeps direction changes after intake", () => {
    expect(names({ ...controls, intake_pending: false })).toEqual(["record_lesson_summary", "end_session", "save_intake"]);
    expect(names({ ...controls, intake_pending: true })).toContain("save_intake");
  });

  it("retains every sales action for identified and unknown callers, including actions needed later in the connection", () => {
    for (const customerId of ["customer-1", undefined, ""]) {
      expect(names({ ...controls, sales: true }, customerId)).toEqual([
        "record_lesson_summary", "end_session", "save_intake", ...SALES_TOOLS.map(t => t.name),
      ]);
    }
  });

  it("does not advertise sales persistence to anonymous callers; preserves the practice timer and consent-gated callback", async () => {
    const c = { ...controls, sales: true, summary_callback: true };
    const artifact = await compilePrompt(c, "", "teacher", s, { customerId: "anonymous-123" });
    const setup = artifact.setup_message as ReturnType<typeof buildSetupPayload>;
    expect(setup.setup.tools[0].functionDeclarations.map(t => t.name)).toEqual([
      "record_lesson_summary", "end_session", "save_intake", "start_ad_practice", "request_summary_callback",
    ]);
    expect(names(controls, "customer-anonymous-name")).not.toContain("start_ad_practice");
  });

  it("does not alter non-lesson declarations, vocabulary or compression", () => {
    const c = { ...controlsFromSettings(true), custom_vocabulary: ["ספיקול", "hello"], transcription_language_codes: ["he-IL", "en-US"], context_trigger_tokens: 12000, context_target_tokens: 6000 };
    const { setup } = buildSetupPayload(c, "test", "translator", s, { customerId: "anonymous-1" });
    expect(setup.tools[0].functionDeclarations.map(t => t.name)).toEqual([
      "record_learning_observation", "record_lesson_summary", "end_session", "save_translation_language",
    ]);
    expect(setup.inputAudioTranscription).toMatchObject({ customVocabulary: c.custom_vocabulary, languageCodes: c.transcription_language_codes });
    expect(setup.contextWindowCompression).toEqual({ triggerTokens: 12000, slidingWindow: { targetTokens: 6000 } });
  });
});

describe("compact application instruction contracts", () => {
  it("applies English-school scope with and without a loaded lesson", () => {
    const system = buildSystemInstruction(controls, "");
    expect(system).toContain("English-school scope");
    expect(system).toContain("no internet access");
    expect(system).toContain(HAREDI_CONTENT_RULE);
    expect(system).toContain("subject to the content rules above");
    expect(system).toContain("Do not provide the off-topic answer before redirecting");
    expect(system).toContain("This service is exclusively an English school");
    expect(system).toContain("A question written or spoken in English is not automatically a language exercise");
    expect(system).toContain('"אני כאן רק כדי לתרגל אנגלית", then ask a neutral, level-appropriate question in English');
    expect(buildSystemInstruction(controlsFromSettings(true), "")).toContain("This service is exclusively an English school");
    expect(Object.keys(buildSetupPayload(controls, system, "teacher", s).setup.tools[0])).toEqual(["functionDeclarations"]);
  });

  it("retains administrator/persona/history rules verbatim and all-role lifecycle safeguards", () => {
    const c = { ...controls, base_prompt: "Hebrew/Haredi-appropriate content only. Never ask for passwords.", custom_instructions: "Keep all safety rules intact." };
    const system = buildSystemInstruction(c, "Prior learner notes");
    for (const text of [c.base_prompt, c.custom_instructions, "Prior learner notes", "Session lifecycle (all roles)", "FULL summary and goodbye", "explicit stop requests always permit closure", "A single translation does not end a session unless the caller is done"]) expect(system).toContain(text);
  });

  it("keeps evidence, independent assessment, clock, closing and Hebrew recap constraints", () => {
    const instruction = lessonInstruction(lesson);
    for (const text of ["immediately simplify", "not saved level, targets, pace or technical speech language", "missing is never zero", "Synonyms are not wrong", "Unrelated grammar errors", "meaningfully hinted", "Never invent evidence", "do not estimate the clock", "never require completion after a stop request", "does not authorize hangup", "truthful, concise natural Hebrew", "points encourage, NOT mastery", "Never read recap field names/headings aloud", "Do not describe a prompted repetition as independent success", "NO ASSESSMENT TARGETS"]) expect(instruction).toContain(text);
  });

  it("preserves consent and sales constraints while merging duplicated email instructions", () => {
    expect(adRuntimeContext({})).toBe("");
    const text = adRuntimeContext({ entry: "ad", ad_new_caller: true });
    for (const rule of ["Ask nothing else before practice", "Whenever asked for Hebrew", "not a repeat-after-me drill", "after the application signals 90 seconds", "explicit agreement", "Never request registration email", "preserving all digits and leading zeros", "Await explicit yes", "identical address", "Only its saved=true", "Never claim an SMS was already sent", "Never offer a discounted first month", "29 shekel", "free trial that requires a credit card", "Do not pressure; one offer is enough"]) expect(text).toContain(rule);
    expect(text.match(/call save_email/g)).toHaveLength(1);
    expect(text).toContain("First minute: frame practice in Hebrew");
    expect(text).not.toContain("get a natural, open-ended English question");
    const returning = adRuntimeContext({ entry: "ad", ad_new_caller: false });
    expect(returning).toContain("Returning caller: skip the introductory questionnaire");
    expect(returning).not.toContain("Ask nothing else before practice");
  });
});
