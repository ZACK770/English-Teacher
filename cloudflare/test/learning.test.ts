import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { LearningStore, grammarCatalog, materialTargets, validateLearningBatch, vocabularyCatalog, vocabularyDomains, type LessonPlan } from "../src/learning";
import { syllabus } from "../src/syllabus";
import { VOCABULARY_BANKS } from "../src/vocabulary/index";
import { BusinessStore } from "../src/business";
import { applyLearnerControls, LearnerPreferencesSchema, saveIntake } from "../src/learner";
import { buildSystemInstruction, controlsFromSettings } from "../src/controls";
import { buildSetupPayload } from "../src/prompt";
import { settings } from "../src/env";

class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    this.sql.exec("PRAGMA foreign_keys=ON");
  }
  prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      first: async () => this.sql.prepare(query).get(...args) ?? null,
      all: async () => ({ results: this.sql.prepare(query).all(...args), success: true }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...args).changes) } }),
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.sql.exec("BEGIN");
    try { const result = []; for (const s of statements) result.push(await s.all()); this.sql.exec("COMMIT"); return result; }
    catch (e) { this.sql.exec("ROLLBACK"); throw e; }
  }
}
let db: SqlD1, store: LearningStore, b: BusinessStore;
const plan: LessonPlan = { level: "intermediate", conversation_mode: "conversation", correction_policy: "after_activity", learning_load: "light", closing_activity: "roleplay", topic: "business", vocabulary: vocabularyCatalog.filter(t => ["business.invoice", "business.payment", "business.receipt"].includes(t.id)), grammar: [] };
const result = (score = 100, activity_id = "practice-1") => ({ activity_id, vocabulary: [{ word_id: "business.invoice", score }] });
beforeEach(() => { db = new SqlD1(); store = new LearningStore(db as unknown as D1Database); b = new BusinessStore(db as unknown as D1Database); });
afterEach(() => db.sql.close());

describe("targeted learning contract and production SQL", () => {
  it("distinguishes no lesson, no targets, no evidence and stored results without fabricating grades", async () => {
    expect((await store.report("alice")).last_lesson).toBe(null);
    await store.begin("alice", "empty", { ...plan, vocabulary: [] });
    expect((await store.report("alice")).last_lesson).toMatchObject({ status: "no_targets", target_count: 0, result_count: 0 });
    await store.begin("alice", "targeted", plan);
    expect((await store.report("alice")).last_lesson).toMatchObject({ call_id: "targeted", status: "no_evidence", target_count: 3, result_count: 0 });
    expect((await store.report("alice")).items.every(t => t.score === null)).toBe(true);
    await store.record("alice", "targeted", result());
    expect((await store.report("alice")).last_lesson).toMatchObject({ status: "assessed", result_count: 1 });
    expect((await store.report("bob")).last_lesson).toBe(null);
  });
  it("persists a batch immediately without waiting for a session summary or disconnect", async () => {
    await store.begin("alice", "call-1", plan);
    expect(await store.record("alice", "call-1", result())).toBe(true);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(0);
    const report = await store.report("alice");
    expect(report.items.find(t => t.id === "business.invoice")).toMatchObject({ score: 100, attempts: 1, status: "initial", mastered: false });
    expect(report.items.find(t => t.id === "business.payment")).toMatchObject({ score: null, attempts: 0, status: "unassessed" });
    const businessTotal = vocabularyCatalog.filter(t => t.domain === "business").length;
    expect(report.domains.find(d => d.domain === "business")).toMatchObject({ total: businessTotal, assessed: 1, mastered: 0, coverage: Math.round(100 / businessTotal), mastery: 0 });
  });
  it("replaces the complete activity atomically, keeping original order and omitting missing rather than zero", async () => {
    await store.begin("alice", "call", plan);
    await store.record("alice", "call", { ...result(), vocabulary: [...result().vocabulary, { word_id: "business.payment", score: 0 }] });
    await store.record("alice", "call", result(50));
    await store.record("alice", "call", result(50));
    const report = await store.report("alice");
    expect(report.items.find(t => t.id === "business.invoice")).toMatchObject({ score: 50, attempts: 1 });
    expect(report.items.find(t => t.id === "business.payment")).toMatchObject({ score: null, attempts: 0 });
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM learning_batches").get()?.n).toBe(1);
    await store.record("alice", "call", { activity_id: "practice-1", vocabulary: [] });
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")?.score).toBe(null);
  });
  it("averages up to the last three real results and requires independent success in two calls", async () => {
    await store.begin("alice", "one", plan);
    await store.record("alice", "one", result(100));
    await store.record("alice", "one", result(100, "closing-roleplay"));
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")?.mastered).toBe(false);
    await store.begin("alice", "two", plan);
    await store.record("alice", "two", result(100));
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")).toMatchObject({ score: 100, mastered: true });
    await store.begin("alice", "three", plan);
    await store.record("alice", "three", result(50));
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")).toMatchObject({ score: 83, mastered: true, attempts: 4 });
    await store.record("alice", "three", result(0, "closing-roleplay"));
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")).toMatchObject({ score: 50, mastered: false, attempts: 5 });
  });
  it("never decays a score or uses practice dates to reorder material", async () => {
    await store.begin("alice", "old", plan); await store.record("alice", "old", result(100));
    const before = await store.select("alice", plan.vocabulary, 3);
    db.sql.exec("UPDATE learning_batches SET created_at='2000-01-01T00:00:00Z'");
    expect(await store.select("alice", plan.vocabulary, 3)).toEqual(before);
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")?.score).toBe(100);
  });
  it("keeps customers and their exposures, scores, history and target lists isolated", async () => {
    await store.begin("alice", "shared-call-id", plan); await store.record("alice", "shared-call-id", result());
    expect(await store.record("bob", "shared-call-id", result())).toBe(false);
    expect(await store.history("bob", "vocabulary", "business.invoice")).toEqual([]);
    expect((await store.report("bob")).items.find(t => t.id === "business.invoice")?.score).toBe(null);
  });
  it.each([75, -1, 101, "100", null, true])("rejects unsupported score %s without modifying old evidence", async score => {
    await store.begin("alice", "call", plan); await store.record("alice", "call", result(100));
    expect(await store.record("alice", "call", { activity_id: "practice-1", vocabulary: [{ word_id: "business.invoice", score }] })).toBe(false);
    expect((await store.report("alice")).items.find(t => t.id === "business.invoice")?.score).toBe(100);
  });
  it("rejects incidental targets, duplicate targets, arbitrary activity IDs, wrong closing type and grammar outside its track", () => {
    for (const input of [
      { ...result(), vocabulary: [{ word_id: "business.liability", score: 100 }] },
      { ...result(), vocabulary: [result().vocabulary[0], result().vocabulary[0]] },
      result(100, "practice-2"), result(100, "closing-quiz"),
      { ...result(), grammar: [{ skill_id: "present", score: 100 }] },
    ]) expect(validateLearningBatch(input, plan)).toBe(null);
  });
  it("stores grammar independently and does not mark vocabulary coverage for it", async () => {
    const grammar = { ...plan, vocabulary: [], grammar: grammarCatalog.filter(t => t.id === "past") };
    await store.begin("alice", "grammar", grammar);
    expect(await store.record("alice", "grammar", { activity_id: "practice-1", vocabulary: [], grammar: [{ skill_id: "past", score: 50 }] })).toBe(true);
    const report = await store.report("alice");
    expect(report.items.find(t => t.kind === "grammar" && t.id === "past")).toMatchObject({ score: 50, attempts: 1 });
    expect(report.domains.every(d => d.assessed === 0)).toBe(true);
  });
  it("counts complete target tokens and phrases in tutor text as estimates, idempotently, without awarding a grade", async () => {
    const targets = [...plan.vocabulary, vocabularyCatalog.find(t => t.id === "flights.boarding-pass")!];
    await store.begin("alice", "call", { ...plan, vocabulary: targets });
    const text = "Invoice, invoice. Invoices are not another exact token. A boarding pass; boarding passenger.";
    await store.exposures("alice", "call", targets, text);
    await store.exposures("alice", "call", targets, text);
    const report = await store.report("alice");
    expect(report.items.find(t => t.id === "business.invoice")).toMatchObject({ exposures: 2, score: null });
    expect(report.items.find(t => t.id === "flights.boarding-pass")).toMatchObject({ exposures: 1, score: null });
  });
  it("gives uploaded English items stable IDs and preserves contextual meaning without grading Hebrew-only text", async () => {
    const targets = await materialTargets({ id: "list", words: ["Invoice — חשבונית", "invoice — חשבונית", "payment", "שלום"] });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ text: "invoice", meaning_he: "חשבונית", domain: "material:list" });
    expect((await materialTargets({ id: "list", words: ["invoice"] }))[0].id).toBe(targets[0].id);
    expect((await materialTargets({ id: "other-list", words: ["invoice"] }))[0].id).not.toBe(targets[0].id);
  });
});

describe("learner settings to Gemini", () => {
  it("keeps the 160 starter targets with examples first and adds every curated bank word once, each with a meaning and explicit level", () => {
    const starter = Object.entries(syllabus).flatMap(([domain, words]) => words.map(([text]) => domain + "." + text.replace(/ /g, "-")));
    expect(vocabularyCatalog.slice(0, 160).map(t => t.id)).toEqual(starter);
    for (const target of vocabularyCatalog.slice(0, 160)) expect(target.usage_example!.length).toBeGreaterThan(0);
    const bankKeys = new Set(VOCABULARY_BANKS.flatMap(bank => bank.levels.flatMap(l => l.words.map(w => bank.id + ":" + w.en.toLowerCase()))));
    expect(vocabularyCatalog.length).toBeGreaterThanOrEqual(bankKeys.size);
    expect(new Set(vocabularyCatalog.map(t => t.id.toLowerCase())).size).toBe(vocabularyCatalog.length);
    for (const target of vocabularyCatalog) {
      expect(["beginner", "intermediate", "fluent"]).toContain(target.level);
      expect(target.meaning_he.length).toBeGreaterThan(0);
    }
    expect(vocabularyCatalog.filter(t => t.domain === "everyday").length).toBeGreaterThanOrEqual(3000);
    expect(vocabularyCatalog.find(t => t.id === "travel.sightseeing")).toMatchObject({ level: "beginner", usage_example: "We spent the morning sightseeing." });
    expect(vocabularyDomains).toEqual(expect.arrayContaining(["everyday", "travel", "career", "business", "school"]));
  });
  it.each(["beginner", "intermediate", "fluent"] as const)("selects level-appropriate targets for %s rather than always choosing the first basic words", async level => {
    await b.savePreference("alice", { topic: "business", level, learning_load: "light" });
    const controls = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(controls.lesson!.vocabulary).toHaveLength(3);
    expect(controls.lesson!.vocabulary.every(t => t.level === level)).toBe(true);
    const prompt = buildSystemInstruction(controls, "");
    for (const target of controls.lesson!.vocabulary) {
      expect(prompt).toContain(target.id);
      expect(prompt).toContain(target.usage_example);
    }
    if (level === "beginner") expect(prompt).not.toContain("business.liability");
  });
  it.each([...new Set(vocabularyCatalog.map(t => t.domain))].flatMap(domain => (["beginner", "intermediate", "fluent"] as const).map(level => [domain, level] as const)))("never sends harder targets than %s / %s and prioritizes the nearest eligible level", async (topic, level) => {
    await b.savePreference("alice", { topic, level, learning_load: "intensive" });
    const controls = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    const rank: Record<string, number> = { beginner: 0, intermediate: 1, fluent: 2 };
    const targets = controls.lesson!.vocabulary;
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.length).toBeLessThanOrEqual(8);
    expect(targets.every(t => t.domain === topic && rank[t.level] <= rank[level])).toBe(true);
    const available = vocabularyCatalog.filter(t => t.domain === topic && rank[t.level] <= rank[level]);
    expect(rank[targets[0].level]).toBe(Math.max(...available.map(t => rank[t.level])));
  });
  it("gives school identity precedence over a teacher persona without changing non-teacher prompts", async () => {
    const base = {
      ...controlsFromSettings(false),
      base_prompt: "You are David, an independent English tutor at an unnamed school.",
      custom_instructions: "Say that you teach independently.",
    };
    const teacher = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, base);
    const prompt = buildSystemInstruction(teacher, "");
    expect(prompt.split("\n\n")[0]).toMatch(/authoritative.*ספיקול \(SpeakCall\).*Never claim as the tutor to teach independently/);
    expect(prompt).toContain(base.base_prompt);
    expect(prompt).toContain(base.custom_instructions);
    const translator = await applyLearnerControls(b, "alice", { id: "translator", role: "translator" }, base);
    expect(buildSystemInstruction(translator, "")).not.toContain("School identity");
  });
  it.each([
    { conversation_mode: "roleplay", closing_activity: "quiz" },
    { conversation_mode: "guided", closing_activity: "roleplay" },
  ])("applies school identity only out of character for %j", async choices => {
    await b.savePreference("alice", choices);
    const teacher = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(teacher.lesson).toMatchObject(choices);
    const [identity] = buildSystemInstruction(teacher, "").split("\n\n");
    expect(identity).toContain("During an in-character role-play scene, stay in character and answer within the fiction; do not insert SpeakCall into the scene.");
    expect(identity).toMatch(/When speaking as the tutor, if asked what the school is called.*ספיקול in Hebrew or SpeakCall in English/);
  });
  it("makes legacy Hebrew-only materials explicitly ungraded without silently changing the selected list", async () => {
    await b.save("learner-materials:alice", { name: "עבודה", words: ["היי מה נשמע", "אני עושה עסקים"] }, "hebrew");
    await b.savePreference("alice", { material_id: "hebrew", topic: "business", level: "intermediate", conversation_mode: "conversation", correction_policy: "after_activity" });
    const controls = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(controls.lesson).toMatchObject({ vocabulary: [], grammar: [], material_status: { id: "hebrew", rows: 2, target_count: 0 } });
    const instruction = buildSystemInstruction(controls, "Old notes: correct after every answer and report observations.");
    expect(instruction).toContain("NO ASSESSMENT TARGETS");
    expect(instruction).toContain("not after each answer");
    expect(instruction).toContain("immediately simplify");
    expect(instruction).toContain("Do not describe a prompted repetition as independent success");
    expect(instruction.indexOf("SPEAKOOL ACTIVE LESSON")).toBeGreaterThan(instruction.indexOf("Old notes:"));
    expect(instruction.match(/SPEAKOOL ACTIVE LESSON/g)).toHaveLength(1);
    expect(buildSetupPayload(controls, instruction, "teacher", settings({} as any)).setup.tools[0].functionDeclarations.map(t => t.name)).toEqual(["record_lesson_summary", "end_session", "save_intake"]);
    expect((await b.loadContext("preferences:alice")).material_id).toBe("hebrew");
  });
  it.each(["he-IL", "en-US"])("keeps technical speech language %s unchanged when changing ability and mode", async language_code => {
    await b.savePreference("alice", { level: "beginner", conversation_mode: "roleplay", correction_policy: "after_answer", learning_load: "normal", closing_activity: "quiz", topic: "business" });
    const controls = await applyLearnerControls(b, "alice", { id: "isaac-advanced", role: "teacher" }, { ...controlsFromSettings(false), language_code });
    expect(controls.language_code).toBe(language_code);
    expect(controls.lesson).toMatchObject({ level: "beginner", conversation_mode: "roleplay", correction_policy: "after_activity", closing_activity: "quiz" });
    expect(controls.lesson?.vocabulary.length).toBeLessThanOrEqual(5);
    expect(buildSystemInstruction(controls, "")).toContain("Explain in Hebrew only when asked");
    const payload = buildSetupPayload(controls, "test", "isaac-advanced", settings({} as any));
    const tools = payload.setup.tools[0].functionDeclarations;
    expect(tools.map(t => t.name)).toEqual(["report_learning_batch", "record_lesson_summary", "end_session", "save_intake"]);
    expect(JSON.stringify(tools)).not.toContain("business.liability");
  });
  it("sends intake minutes as an integer without an enum to Gemini Live", async () => {
    const controls = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    const { setup } = buildSetupPayload(controls, "lesson", "teacher", settings({} as any));
    const intake = setup.tools[0].functionDeclarations.find(tool => tool.name === "save_intake");
    expect(intake).toMatchObject({
      parameters: {
        properties: { minutes: { type: "integer", description: expect.stringContaining("5, 10, or 20") } },
        required: ["goal", "level"],
      },
    });
    expect(intake).not.toHaveProperty("parameters.properties.minutes.enum");
  });
  it("saves a partial phone intake with defaults and marks the first call as pending until then", async () => {
    const before = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(before.intake_pending).toBe(true);
    expect(await saveIntake(b, "alice", "teacher", { goal: "travel", level: "beginner" })).toBe(true);
    const after = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(after.intake_pending).toBe(false);
    expect((await b.loadContext("preferences:alice")).plan).toEqual({ goal: "travel", level: "beginner", difficulty: "speaking", minutes: 10, topic: "recommended" });
  });
  it("does not add grammar to recommended practice and only sends its targets when explicitly selected", async () => {
    await b.savePreference("alice", { topic: "business", track: "recommended" });
    const initial = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(initial.lesson?.grammar).toEqual([]);
    await b.savePreference("alice", { track: "grammar", grammar_targets: ["past", "questions"] });
    const grammar = await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false));
    expect(grammar.lesson?.vocabulary).toEqual([]);
    expect(grammar.lesson?.grammar.map(t => t.id)).toEqual(["past", "questions"]);
  });
  it("leaves translator prompts and technical controls alone", async () => {
    const original = controlsFromSettings(false);
    const controls = await applyLearnerControls(b, "alice", { id: "translator", role: "translator" }, original);
    expect(controls.lesson).toBeUndefined();
    expect(controls.base_prompt).toBe(original.base_prompt);
  });
  it("rejects unknown choices and empty or oversized grammar target sets", () => {
    for (const data of [{ level: "genius" }, { learning_load: "unlimited" }, { grammar_targets: [] }, { grammar_targets: ["not-a-skill"] }, { grammar_targets: ["past", "present", "future", "questions"] }]) expect(LearnerPreferencesSchema.safeParse(data).success).toBe(false);
  });
});

describe("recommended vocabulary when no specific topic was chosen", () => {
  const rank: Record<string, number> = { beginner: 0, intermediate: 1, fluent: 2 };
  const lessonFor = async () => (await applyLearnerControls(b, "alice", { id: "teacher", role: "teacher" }, controlsFromSettings(false))).lesson!;
  const master = async (targets: typeof vocabularyCatalog) => {
    for (let i = 0; i < targets.length; i += 8) {
      const vocabulary = targets.slice(i, i + 8);
      for (const call of ["a" + i, "b" + i]) {
        await store.begin("alice", call, { ...plan, vocabulary });
        expect(await store.record("alice", call, { activity_id: "practice-1", vocabulary: vocabulary.map(t => ({ word_id: t.id, score: 100 })) })).toBe(true);
      }
    }
  };
  const words = (domain: string, level: string) => vocabularyCatalog.filter(t => t.domain === domain && rank[t.level] <= rank[level]);

  it("defaults a learner with no choices to recommended beginner everyday words", async () => {
    const lesson = await lessonFor();
    expect(lesson).toMatchObject({ topic: "everyday", level: "beginner" });
    expect(lesson.vocabulary).toHaveLength(3);
    expect(lesson.vocabulary.every(t => t.domain === "everyday" && t.level === "beginner")).toBe(true);
  });
  it.each(["recommended", "not-a-domain"])("treats topic %s as recommended instead of sending no targets", async topic => {
    await b.savePreference("alice", { topic, level: "intermediate" });
    const lesson = await lessonFor();
    expect(lesson.topic).toBe("everyday");
    expect(lesson.vocabulary.length).toBe(3);
  });
  it("starts beginners on everyday basics and moves to their intake goal once those are mastered", async () => {
    await b.savePreference("alice", { plan: { goal: "travel", level: "beginner", difficulty: "speaking", minutes: 10, topic: "recommended" }, topic: "recommended", learning_load: "intensive" });
    const first = (await lessonFor()).vocabulary;
    expect(first).toHaveLength(8);
    expect(first.slice(6)).toHaveLength(2);
    expect(first.slice(0, 6).every(t => t.domain === "everyday" && t.level === "beginner")).toBe(true);
    expect(first.slice(6).every(t => ["travel", "flights"].includes(t.domain) && t.level === "beginner")).toBe(true);
    await master(words("everyday", "beginner"));
    const next = await lessonFor();
    expect(next.topic).toBe("travel");
    const travel = words("travel", "beginner").map(t => t.id);
    expect(next.vocabulary).toHaveLength(8);
    expect(next.vocabulary.slice(0, Math.min(8, travel.length)).every(t => travel.includes(t.id))).toBe(true);
    expect(next.vocabulary.every(t => ["travel", "flights"].includes(t.domain) && t.level === "beginner")).toBe(true);
  });
  it("starts intermediate learners on their goal domain at their level", async () => {
    await b.savePreference("alice", { plan: { goal: "work", level: "intermediate", difficulty: "speaking", minutes: 10, topic: "recommended" }, topic: "recommended" });
    const lesson = await lessonFor();
    expect(lesson.topic).toBe("career");
    expect(lesson.vocabulary.every(t => t.domain === "career" && t.level === "intermediate")).toBe(true);
  });
  it("draws recommended and explicit lessons from the curated banks and keeps report payloads bounded", async () => {
    await b.savePreference("alice", { topic: "school", level: "beginner", learning_load: "light" });
    const school = await lessonFor();
    const schoolBank = new Set(VOCABULARY_BANKS.find(bank => bank.id === "school")!.levels.flatMap(l => l.words.map(w => w.en)));
    expect(school.vocabulary.length).toBeGreaterThan(0);
    expect(school.vocabulary.every(t => t.domain === "school" && schoolBank.has(t.text))).toBe(true);
    await master(words("everyday", "beginner").slice(0, 200));
    await b.savePreference("alice", { topic: "recommended", level: "beginner", learning_load: "light" });
    const next = await lessonFor();
    const coreA1 = new Set(VOCABULARY_BANKS[0].levels[0].words.map(w => w.en));
    expect(next.vocabulary.every(t => t.domain === "everyday" && coreA1.has(t.text))).toBe(true);
    const report = await store.report("alice");
    expect(report.items.filter(t => t.kind === "vocabulary" && !t.attempts && !t.exposures && t.domain === "everyday")).toHaveLength(40 * 3);
    expect(report.items.filter(t => t.kind === "vocabulary" && !t.attempts && t.domain === "school" && t.level === "fluent")).toHaveLength(40);
    expect(report.domains.find(d => d.domain === "everyday")!.total).toBe(words("everyday", "beginner").length + vocabularyCatalog.filter(t => t.domain === "everyday" && t.level !== "beginner").length);
  });
  it("fills a lesson across domains and steps up a level after the recommended words at the current level are mastered", async () => {
    await b.savePreference("alice", { topic: "recommended", level: "beginner", learning_load: "intensive" });
    const everyday = words("everyday", "beginner");
    await master(everyday.slice(0, -2));
    const mixed = await lessonFor();
    expect(mixed.vocabulary.slice(0, 2).map(t => t.id).sort()).toEqual(everyday.slice(-2).map(t => t.id).sort());
    expect(mixed.vocabulary.slice(2).every(t => t.domain === "everyday" && t.level === "intermediate")).toBe(true);
  });
  it("keeps an explicitly chosen topic even when recommended words would differ", async () => {
    await b.savePreference("alice", { plan: { goal: "travel", level: "beginner", difficulty: "speaking", minutes: 10, topic: "cars" }, topic: "cars" });
    const lesson = await lessonFor();
    expect(lesson.topic).toBe("cars");
    expect(lesson.vocabulary.every(t => t.domain === "cars")).toBe(true);
  });
});
