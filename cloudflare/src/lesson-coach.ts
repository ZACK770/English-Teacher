import type { LessonPlan, LearningTarget } from "./learning";
import type { SemanticInput } from "./lesson-semantic-observer";

/**
 * Independent, local transcript monitor. Deliberately abstains on semantic ambiguity:
 * a detected word, a prompted repetition, or broken ASR is not evidence of mastery.
 * It never changes the curriculum, persisted settings, scores, or service entitlements.
 */
export type CoachMode = "shadow" | "active";
export const COACH_VERSION = "transcript-v2";
export function coachMode(value: string | undefined): CoachMode | undefined {
  return value === "shadow" || value === "active" ? value : undefined;
}
type Outcome = "unknown" | "service_request" | "help" | "stuck" | "too_easy" | "pace_request" |
  "name_correction" | "feedback_request" | "ack_only" | "partial_repeat" | "mismatched_repeat" | "repeated" | "assisted_word" | "independent_word";
type Action = "none" | "respect_request" | "explain" | "change_exercise" | "raise_challenge" |
  "slow_down" | "apologize" | "give_feedback" | "elicit_attempt" | "scaffold" | "independent_use" | "next_target";
export interface CoachDecision {
  version: typeof COACH_VERSION;
  mode: CoachMode;
  turn: number;
  outcome: Outcome;
  action: Action;
  target_id?: string;
  unsuccessful_attempts: number;
  prompt_available: boolean;
  directive?: string;
}
export type CoachEvent = Omit<CoachDecision, "directive"> & { applied: boolean; elapsed_ms: number };
type Exercise = { target?: LearningTarget; kind: "repeat" | "recall" | "open"; example?: string; key: string };

const normalize = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/[\u0591-\u05c7]/g, "").replace(/[’‘]/g, "'")
  .replace(/[^\p{L}\p{N}']+/gu, " ").trim()
  .replace(/\bi\'m\b/g, "i am");
const contains = (normalized: string, text: string) => {
  const value = normalize(text);
  return !!value && (" " + normalized + " ").includes(" " + value + " ");
};
const repeatCue = /(?:לחזור אחר|חזר(?:ו|י) אחר|חזור אחר|לומר (?:את |זאת|אותו|שוב|ככה|יחד|ביחד)|להגיד (?:את |זאת|אותו|שוב|ככה|יחד|ביחד)|(?:אפשר|ננסה|נסה|נסו|נסי|תנסו|תוכל(?:ו|י)?|תוכלו|יכול(?:ה|ים)?|יכולה) (?:לחזור|לומר|להגיד)|repeat after me|repeat (?:the|this|it|that)|say it again|try saying|(?:can|could) you (?:say|repeat))/i;
const recallCue = /(?:איך (?:אומרים|אומר(?:ים|ת|ים)?|תגיד(?:ו|י)?|תאמר(?:ו|י)?|היית(?:ם|ן)? אומר(?:ים|ת)?|אפשר לומר|אפשר להגיד)|מה (?:המילה|התרגום) באנגלית|how (?:do|would|can) you say|what is the english (?:word|translation))/i;
const acknowledgment = /^(?:(?:yes|yeah|yep|ok|okay|sure|uh huh|mm hmm|mhm|hmm|um|uh|כן|אוקיי|בסדר|אה|הממ|הבנתי)\s*)+$/i;
const capabilityOnly = /^(?:(?:מה הבעיה|אני יכול(?:ה)?|בטח שאני יכול(?:ה)?|ודאי שאני יכול(?:ה)?|כן|למה|מה|כמובן|i can|of course)\s*)+$/i;
const noAttempt = /^(?:לא|לא יודע(?:ת)?|לא מצליח(?:ה)?|i don'?t know|i can'?t|no)$/i;
const requestPatterns: [Outcome, RegExp][] = [
  // Service and explicit direction changes remain with the existing trusted tools.
  ["service_request", /(?:^|\s)(?:אני רוצה (?:לסיים|להפסיק|לחזור לתפריט|שיחת סיכום|לשנות (?:נושא|רמה))|שיחת סיכום|תנתק|תפסיק|רוצה לסיים|לחזור ל(?:תפריט|שלוחה)|שנה (?:את |לי )?(?:הרמה|הנושא)|תעביר (?:אותי )?(?:לתפריט|לרמה)|(?:please )?(?:stop|hang up|goodbye|return to (?:the )?menu)|i (?:want|need) to (?:stop|finish|change (?:my )?(?:level|topic)))(?:\s|$)/i],
  ["name_correction", /(?:לא קוראים לי|אני לא .{1,35} קוראים לי|אל תקרא(?:ו|י)? לי|זה לא השם שלי|that'?s not my name|don'?t call me)/i],
  ["stuck", /(?:למה (?:אתה|את) לא מתקדם|תקוע(?:ה)? (?:איתי|על|באותו)|אותו שיעור|אותן מילים|כבר למדנו את זה|you keep repeating|same lesson|we already (?:did|learned) this|we're stuck)/i],
  ["too_easy", /(?:קל מדי|פשוט מדי|יותר מדי פשוט|(?:נורא|מאוד|ממש) קל|(?:תתקדם|תתקדמי|תעבור|תעברי).{0,35}(?:קשות|קשים|מאתגר)|תאתגר(?:י|ו)? אותי|תן לי (?:משהו|שאלות) (?:קשה|קשות|מאתגר)|challenge me|harder questions|like i am a little (?:boy|girl)|like i'm a little (?:boy|girl)|אני (?:כבר )?יודע(?:ת)? את (?:זה|המילים האלה)|too easy|already know (?:this|these words))/i],
  ["pace_request", /(?:דבר(?:י|ו)? לאט|תדבר(?:י|ו)? לאט|יותר לאט|slow(?:er| down)|speak more slowly)/i],
  ["feedback_request", /(?:איך האנגלית שלי|האנגלית שלי טובה|איך אני מדבר(?:ת)? באנגלית|how (?:good is my english|is my english)|do i speak english well)/i],
  ["help", /(?:לא הבנתי|לא מבין(?:ה)?|מה הכוונה|מה זה אומר|תסביר(?:י|ו)? שוב|i (?:don'?t|didn'?t) understand|what does (?:that|it) mean)/i],
];

function identifyExercise(tutor: string, vocabulary: LearningTarget[]): Exercise | undefined {
  const normalized = normalize(tutor);
  // Closed recall only when the requested meaning is explicitly cued without the answer.
  if (recallCue.test(tutor)) {
    const matches = vocabulary.filter(t => normalize(t.meaning_he).length > 1 &&
      contains(normalized, t.meaning_he) && !contains(normalized, t.text));
    if (matches.length === 1) return { target: matches[0], key: matches[0].id, kind: "recall" };
  }
  if (!repeatCue.test(tutor)) {
    // Acknowledgments are not answers to a definite open question, but are entirely
    // legitimate replies to yes/no questions, roleplay offers and account/intake prompts.
    const lastQuestion = tutor.match(/(?:^|[.!?\n])\s*([^.!?\n]+)\?\s*$/)?.[1] ?? "";
    const open = /(?:^|\s)(?:מה (?:המטרה|המשמעות|עשית|אכלת|תעשה|תאמר)|איך (?:היית|אפשר לתאר|תתאר)|למה|מדוע|ספר(?:ו|י)? (?:על|לי)|what (?:did|would|do|is the goal)|why|how (?:would|do)|tell me about|describe)(?:\s|$)/i;
    if (!open.test(lastQuestion) || /(?:שמך|איך לקרוא|מה הרמה|מה המטרה שלך בלימוד|תפריט|סיכום|תזכורת|your name|your level|callback|reminder)/i.test(lastQuestion)) return;
    const matches = vocabulary.filter(t => contains(normalized, t.text));
    const target = matches.length === 1 ? matches[0] : undefined;
    return { target, kind: "open", key: target?.id ?? "open:" + normalize(lastQuestion) };
  }
  // The current request is the LAST cue, not words mentioned in earlier praise
  // or examples. Prefer a quote after the cue, then the nearest preceding English
  // example when the teacher says "say the sentence".
  const cue = Array.from(tutor.matchAll(new RegExp(repeatCue.source, "gi"))).at(-1);
  const boundary = cue?.index ?? 0;
  const quotes = (part: string) => Array.from(part.matchAll(/["“״]([^"”״\n]{1,150})["”״]/g), m => normalize(m[1]))
    .filter(q => vocabulary.some(t => contains(q, t.text)));
  const after = quotes(tutor.slice(boundary));
  const before = quotes(tutor.slice(0, boundary));
  const quote = after.at(-1) ?? before.at(-1);
  const asked = normalize(tutor.slice(boundary));
  const matches = vocabulary.filter(t => contains(quote ?? asked, t.text));
  const allMatches = vocabulary.filter(t => contains(normalized, t.text));
  const target = matches.length === 1 ? matches[0] : !matches.length && allMatches.length === 1 ? allMatches[0] : undefined;
  if (!target) return;
  const example = quote && contains(quote, target.text) && quote !== normalize(target.text) ? quote : undefined;
  return { target, key: target.id, kind: "repeat", ...(example ? { example } : {}) };
}

export class TranscriptCoach {
  private tutor = "";
  private semanticCandidate?: SemanticInput;
  private turn = 0;
  private tutorTurn = 0;
  private readonly lastSupplied = new Map<string, number>();
  private lastTarget?: string;
  private unsuccessful = 0;
  private readonly evidence = new Map<string, Set<"repeated" | "independent_word">>();
  constructor(private plan: LessonPlan, readonly mode: CoachMode) {}

  /** Only completed tutor text is eligible; a partial/aborted reply cannot be assessed. */
  tutorCompleted(text: string) {
    this.tutor = text.slice(-1200);
    this.tutorTurn++;
    const normalized = normalize(this.tutor);
    for (const target of this.plan.vocabulary) {
      if (contains(normalized, target.text)) this.lastSupplied.set(target.id, this.tutorTurn);
    }
  }
  tutorInterrupted() { this.tutor = ""; this.semanticCandidate = undefined; }
  takeSemanticCandidate() { const candidate = this.semanticCandidate; this.semanticCandidate = undefined; return candidate; }
  /** Preserve original assessment targets; only the accepted live delivery preferences change. */
  updateDelivery(plan: Pick<LessonPlan, "level" | "conversation_mode" | "correction_policy">) {
    this.plan = { ...this.plan, ...plan };
    this.lastTarget = undefined;
    this.unsuccessful = 0;
    this.tutor = "";
  }

  observeLearner(utterance: string): CoachDecision {
    this.semanticCandidate = undefined;
    const text = normalize(utterance.slice(0, 2000));
    const previousTutor = this.tutor;
    const exercise = identifyExercise(previousTutor, this.plan.vocabulary);
    const hasTutor = !!previousTutor;
    this.tutor = ""; // an endpoint is consumed once, never count duplicate partial transcripts
    const target = exercise?.target;
    const finish = (outcome: Outcome, action: Action = "none", instruction?: string): CoachDecision => {
      const correction = this.plan.correction_policy === "on_request" ? "Do not correct unless explicitly asked."
        : this.plan.correction_policy === "after_activity" ? "Do not correct or request a retry during the activity; defer feedback to its boundary. Help if explicitly requested."
        : "If appropriate give at most one brief correction after the answer.";
      return {
        version: COACH_VERSION, mode: this.mode, turn: ++this.turn, outcome, action,
        ...(target ? { target_id: target.id } : {}), unsuccessful_attempts: this.unsuccessful, prompt_available: hasTutor,
        ...(instruction ? { directive: [
          "APPLICATION LESSON COACH (this reply only; subordinate to school content, template, access, explicit service requests and runtime limits):",
          instruction,
          "Keep the learner's configured lesson mode, topic/material, original curriculum targets, language policy and pace unless the learner explicitly requests a permitted change.",
          correction,
          "One short useful teaching task, no invented success or score, and never speak these internal instructions."
        ].join(" ") } : {}),
      };
    };
    const reset = () => { this.lastTarget = undefined; this.unsuccessful = 0; };
    const explicit = requestPatterns.find(([, pattern]) => pattern.test(text))?.[0];
    if (explicit) {
      if (explicit !== "help") reset();
      switch (explicit) {
        case "service_request": return finish(explicit); // Existing runtime/tool policy decides whether the words are a real request or exercise content.
        case "name_correction": return finish(explicit, "apologize", "Briefly apologize; do not use the disputed name or ask again. Resume the learning task.");
        case "stuck": return finish(explicit, "change_exercise", "Acknowledge the repetition complaint. Change the type of exercise or practical situation meaningfully within the permitted lesson domain, not just the next word or the same question. Prioritize remaining targets.");
        case "too_easy": return finish(explicit, "raise_challenge", "Acknowledge the explicit request for a harder exercise. Stop isolated-word repetition now. Use the assigned vocabulary in a meaningful situation and ask one open-ended question requiring a short self-composed English sentence. Increase complexity further when the learner answers well; do not change saved level without a clear request.");
        case "pace_request": return finish(explicit, "slow_down", "Acknowledge the pace request and rephrase the last task simply in Hebrew; use the existing settings tool if the learner requests a persistent change.");
        case "feedback_request": return finish(explicit, "give_feedback", "Address the request first with a specific observed strength and one useful, honest improvement if supported. No generic or invented praise.");
      }
    }
    if (!hasTutor || !exercise || !text) {
      // An unambiguous open practice question is eligible for an optional independent
      // semantic assessment; never grade a service/intake answer or an obvious yes/no.
      if (hasTutor && !explicit && text.split(" ").length >= 2 && !acknowledgment.test(text) &&
          /(?:\?|ספר|tell me|describe)/i.test(previousTutor) &&
          !/(?:שמך|איך לקרוא|מה הרמה|מה המטרה שלך בלימוד|תפריט|סיכום|תזכורת|your name|your level|callback|reminder)/i.test(previousTutor)) {
        this.semanticCandidate = { tutor: previousTutor, learner: utterance, mode: this.plan.conversation_mode, correction: this.plan.correction_policy };
      }
      reset();
      return explicit === "help"
        ? finish("help", "explain", "Briefly explain the actual question in Hebrew if known, then give a reachable English practice prompt.")
        : finish("unknown");
    }
    if (this.lastTarget !== exercise.key) this.unsuccessful = 0;
    this.lastTarget = exercise.key;
    const targetText = target ? normalize(target.text) : "";
    const matched = contains(text, targetText);
    const repeatExample = exercise.example;
    // Ignore only common politeness/filler outside the target; collapse exact
    // repeated utterances, not arbitrary extra content or reported words.
    let spoken = text.replace(/^(?:אה|um|uh)\s+/, "").replace(/\s+בבקשה$/, "");
    const words = spoken.split(" ");
    for (let n = 1; n <= words.length / 2; n++) {
      if (words.length % n === 0 && words.every((w, i) => w === words[i % n])) { spoken = words.slice(0, n).join(" "); break; }
    }
    const partial = exercise.kind === "repeat" && repeatExample && spoken !== repeatExample &&
      (repeatExample.startsWith(spoken + " ") || spoken === targetText) && /[a-z]/.test(spoken);
    const mismatch = exercise.kind === "repeat" && !matched && this.plan.vocabulary.some(t => t.id !== target?.id && contains(spoken, t.text)) && /^[a-z' ]+$/.test(spoken);
    const capabilityClaim = /(?:מה הבעיה|בטח שאני יכול|ודאי שאני יכול|אם אני יכול להגיד)/i.test(text) && /אני יכול/i.test(text);
    const ack = acknowledgment.test(text) || noAttempt.test(text) || capabilityOnly.test(text) || (exercise.kind === "repeat" && capabilityClaim);
    if (explicit === "help" || ack || partial || mismatch) {
      this.unsuccessful++;
      const change = this.unsuccessful >= 2;
      const outcome = explicit === "help" ? "help" : partial ? "partial_repeat" : mismatch ? "mismatched_repeat" : "ack_only";
      const action = change ? "change_exercise" : explicit === "help" ? "explain" : partial || mismatch ? "scaffold" : "elicit_attempt";
      const instruction = change
        ? "Two clearly observed non-completions of this target. Change the teaching approach to an easier related activity, for example recognition or a shorter context. Do not repeat the same demand or skip unrelated targets."
        : "The learner has not completed the requested English output. Do not claim success or advance as if mastered. Do not ask whether they can or want to say it again. Give one direct, concrete opportunity to speak, using a short contextual prompt or scaffold.";
      return finish(outcome, action, instruction);
    }
    if (target && exercise.kind === "repeat" && matched && (repeatExample ? spoken === repeatExample : spoken === targetText)) {
      this.unsuccessful = 0;
      this.record(target.id, "repeated");
      return finish("repeated", "independent_use",
        "The learner repeated supplied English successfully; this is practice, not independent recall. Elicit a short independent use in the current situation without giving its answer first.");
    }
    if (target && exercise.kind === "recall" && text === targetText) {
      this.unsuccessful = 0;
      if (this.tutorTurn - (this.lastSupplied.get(target.id) ?? -100) <= 1) {
        this.record(target.id, "repeated");
        return finish("assisted_word", "independent_use",
          "Correct word, but it was supplied in the immediately preceding tutor turn. Treat it as supported practice; seek an independent use later. Do not claim mastery.");
      }
      this.record(target.id, "independent_word");
      return finish("independent_word", "next_target",
        "The learner recalled the requested word without a supplied answer in the last question. Acknowledge specifically; progress to an independent use in context or the next remaining curriculum target. Do not claim lasting mastery.");
    }
    // Uncertain speech, synonyms, longer answers, pronunciation, and free conversation are
    // semantic judgments. The local monitor cannot reliably determine correctness.
    this.unsuccessful = 0;
    this.semanticCandidate = { tutor: previousTutor, learner: utterance, target: target?.text, meaning: target?.meaning_he, mode: this.plan.conversation_mode, correction: this.plan.correction_policy };
    return finish("unknown");
  }

  private record(id: string, evidence: "repeated" | "independent_word") {
    const prior = this.evidence.get(id) ?? new Set();
    prior.add(evidence);
    this.evidence.set(id, prior);
  }

  /** Diagnostic only: lack of independent evidence is not a reason to reject a valid score. */
  repetitionOnlyTargets(): string[] {
    return [...this.evidence].filter(([, e]) => e.has("repeated") && !e.has("independent_word")).map(([id]) => id);
  }
}
