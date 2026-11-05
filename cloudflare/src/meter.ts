import type { Settings } from "./env";
import type { LessonSummary, Observation, UsageTotals } from "./progress";

const number = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0;
function modality(details: unknown, name: string): number {
  if (!Array.isArray(details)) return 0;
  return details.filter((d) => d && String(d.modality ?? "").toUpperCase() === name).reduce((n, d) => n + number(d.tokenCount), 0);
}

export class SessionMeter {
  learnerTurns = 0;
  tutorTurns = 0;
  observations: Observation[] = [];
  lessonSummary: LessonSummary | null = null;
  transcript: { role: string; text: string }[] = [];
  inputAudioBytes = 0;
  outputAudioBytes = 0;
  private inputText = 0;
  private inputAudio = 0;
  private outputText = 0;
  private outputAudio = 0;
  private thoughts = 0;

  recordUsage(usage: Record<string, unknown>) {
    this.inputText += modality(usage.promptTokensDetails, "TEXT");
    this.inputAudio += modality(usage.promptTokensDetails, "AUDIO");
    this.outputText += modality(usage.responseTokensDetails, "TEXT");
    this.outputAudio += modality(usage.responseTokensDetails, "AUDIO");
    this.thoughts += number(usage.thoughtsTokenCount);
  }

  recordLearning(name: string, args: Record<string, unknown>): boolean {
    if (name === "record_learning_observation") {
      if (!["skill", "result", "correction", "score"].every((key) => key in args) || !Number.isFinite(Number(args.score))) return false;
      this.observations.push({ skill: String(args.skill).slice(0, 40), result: String(args.result).slice(0, 160), correction: String(args.correction).slice(0, 160), score: Math.max(1, Math.min(5, Math.trunc(Number(args.score)))) });
      return true;
    }
    if (name === "record_lesson_summary") {
      if (!["summary_he", "success_he", "next_step_he", "points"].every((key) => key in args) || !Number.isFinite(Number(args.points))) return false;
      this.lessonSummary = { summary_he: String(args.summary_he).trim().slice(0, 500), success_he: String(args.success_he).trim().slice(0, 300), next_step_he: String(args.next_step_he).trim().slice(0, 300), points: Math.max(0, Math.min(100, Math.trunc(Number(args.points)))) };
      return true;
    }
    return false;
  }

  summary(): LessonSummary {
    if (this.lessonSummary) return this.lessonSummary;
    const points = Math.min(100, this.learnerTurns * 5 + this.observations.reduce((n, o) => n + o.score * 2, 0));
    if (this.observations.length) {
      const best = this.observations.reduce((a, b) => a.score >= b.score ? a : b);
      const correction = [...this.observations].reverse().find((o) => o.correction)?.correction ?? "להמשיך לתרגל משפטים קצרים בקול.";
      return { summary_he: `בשיחה תורגלו ${this.observations.length} מיומנויות באנגלית.`, success_he: best.result || "הייתה השתתפות טובה בתרגול.", next_step_he: correction, points };
    }
    return { summary_he: "השיחה הסתיימה לפני שנאסף מספיק מידע לסיכום מלא.", success_he: "עצם הכניסה לתרגול היא התחלה טובה.", next_step_he: "בשיחה הבאה נתחיל ממשפט אנגלי קצר אחד.", points };
  }

  usage(s: Settings): UsageTotals {
    let cost: number;
    let basis: string;
    if (this.inputText || this.inputAudio || this.outputText || this.outputAudio || this.thoughts) {
      cost = (this.inputText * s.pricing.inputText + this.inputAudio * s.pricing.inputAudio + (this.outputText + this.thoughts) * s.pricing.outputText + this.outputAudio * s.pricing.outputAudio) / 1_000_000;
      basis = "gemini_usage_metadata";
    } else {
      cost = this.inputAudioBytes / (16000 * 2 * 60) * s.pricing.inputAudioMinute + this.outputAudioBytes / (24000 * 2 * 60) * s.pricing.outputAudioMinute;
      basis = cost ? "audio_duration_estimate" : "none";
    }
    return { input_text_tokens: this.inputText, input_audio_tokens: this.inputAudio, output_text_tokens: this.outputText, output_audio_tokens: this.outputAudio, thoughts_tokens: this.thoughts, estimated_cost_usd: Math.round(cost * 1e8) / 1e8, cost_basis: basis };
  }
}
