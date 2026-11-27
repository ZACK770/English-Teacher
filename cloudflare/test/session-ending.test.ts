import { expect, it, vi } from "vitest";
import { controlsFromSettings } from "../src/controls";
import { type Env, settings } from "../src/env";
import { TutorSession } from "../src/session";

function session() {
  const env = {} as Env;
  const tutor = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner") as any;
  tutor.controls = { ...controlsFromSettings(false), ending_policy: "model_discretion", intake_pending: false, lesson: { vocabulary: [], grammar: [] } };
  tutor.progress.logDiagnostic = vi.fn().mockResolvedValue(undefined);
  return tutor;
}

const complete = { name: "end_session", args: { reason: "task_completed" } };

it("refuses empty and repeated unconfirmed completion with a tool response", async () => {
  const tutor = session();
  for (let i = 0; i < 2; i++) {
    expect(await tutor.recordTool(complete)).toMatchObject({ saved: false, reason: "confirmation_required", next_step: expect.stringContaining("רוצה לסיים?") });
    expect(tutor.reason).toBe("");
  }
});

it.each(["כן", "yes"])("accepts a new confirmation after the requested question: %s", async answer => {
  const tutor = session();
  tutor.meter.transcript.push({ role: "learner", text: "כן" });
  await tutor.recordTool(complete);
  tutor.meter.transcript.push({ role: "tutor", text: "רוצה" }, { role: "tutor", text: "לסיים?" }, { role: "learner", text: answer });
  expect(await tutor.recordTool(complete)).toBe(true);
  expect(tutor.reason).toBe("model:task_completed");
});

it.each(["לא", "water please", ""])("does not treat a negative, unrelated or empty answer as consent: %s", async answer => {
  const tutor = session();
  await tutor.recordTool(complete);
  tutor.meter.transcript.push({ role: "tutor", text: "רוצה לסיים?" }, { role: "learner", text: answer });
  expect(await tutor.recordTool(complete)).toMatchObject({ saved: false });
});

it("does not accept an unrelated yes without the confirmation question", async () => {
  const tutor = session();
  await tutor.recordTool(complete);
  tutor.meter.transcript.push({ role: "tutor", text: "Do you want water?" }, { role: "learner", text: "yes" });
  expect(await tutor.recordTool(complete)).toMatchObject({ saved: false });
});

it.each(["learner_only", "before_target", "no_clock"])("continues rather than suggesting an ending when forbidden: %s", async mode => {
  const tutor = session();
  tutor.controls.ending_policy = mode === "learner_only" ? "learner_only" : "after_target_with_permission";
  tutor.controls.target_lesson_minutes = 10;
  tutor.meteredAt = mode === "no_clock" ? null : Date.now() - (mode === "learner_only" ? 700000 : 1000);
  const result = await tutor.recordTool(complete);
  expect(result).toMatchObject({ saved: false, next_step: expect.stringContaining("Continue the lesson") });
  expect(result.next_step).not.toContain("רוצה לסיים");
  expect(tutor.endConfirmationAt).toBeNull();
});

it("requests permission after the configured lesson target", async () => {
  const tutor = session();
  tutor.controls.ending_policy = "after_target_with_permission";
  tutor.controls.target_lesson_minutes = 10;
  tutor.meteredAt = Date.now() - 600000;
  expect(await tutor.recordTool(complete)).toMatchObject({ saved: false, next_step: expect.stringContaining("רוצה לסיים?") });
});

it.each(["explicit", "closing", "quota", "discretion", "translation"])("allows existing permitted endings: %s", async mode => {
  const tutor = session();
  if (mode === "explicit") tutor.meter.transcript.push({ role: "learner", text: "אני רוצה לסיים." });
  if (mode === "closing") tutor.finalSent = true;
  if (mode === "quota") { tutor.meteredAt = Date.now() - 1000; tutor.allowanceMs = 1000; }
  if (mode === "discretion") { tutor.controls.ending_policy = "model_discretion"; tutor.meter.learnerTurns = 1; tutor.meter.lessonSummary = {}; }
  if (mode === "translation") { tutor.controls.lesson = undefined; tutor.meter.learnerTurns = tutor.meter.tutorTurns = 1; }
  expect(await tutor.recordTool(complete)).toBe(true);
});

it.each(["learner_only", "after_target_with_permission"])("does not mistake a saved summary or elapsed target for permission: %s", async policy => {
  const tutor = session();
  tutor.controls.ending_policy = policy;
  tutor.meter.learnerTurns = 2;
  tutor.meter.lessonSummary = {};
  tutor.lessonDurationMs = 1000;
  tutor.meteredAt = Date.now() - 10000;
  tutor.allowanceMs = 600000;
  expect(await tutor.recordTool(complete)).toMatchObject({ saved: false });
});

it.each(["caller_requested", "no_response"])("preserves non-completion end reasons: %s", async reason => {
  const tutor = session();
  expect(await tutor.recordTool({ name: "end_session", args: { reason } })).toBe(true);
});

it("routes a refusal through the Gemini tool response without ending the audio loop", async () => {
  const tutor = session();
  const events = [{ type: "tool_call", calls: [complete] }];
  tutor.ai = { submitToolResult: vi.fn(), next: vi.fn(async () => { const event = events.shift(); if (!event) tutor.abort.abort(); return event; }) };
  await tutor.aiToOutput();
  expect(tutor.ai.submitToolResult).toHaveBeenCalledWith(complete, false, expect.objectContaining({ reason: "confirmation_required" }));
  expect(tutor.reason).toBe("");
});

it.each([
  ["closing", "quota_closing"], ["quota", "quota_exhausted"],
  ["explicit", "explicit_stop"], ["confirmation", "learner_confirmation"],
  ["summary", "lesson_summary_under_policy"], ["translation", "non_lesson_turns"],
])("logs the exact allowed condition: %s", async (mode, condition) => {
  const tutor = session();
  if (mode === "closing") tutor.finalSent = true;
  if (mode === "quota") { tutor.meteredAt = Date.now() - 1000; tutor.allowanceMs = 1000; }
  if (mode === "explicit") tutor.meter.transcript.push({ role: "learner", text: "stop" });
  if (mode === "confirmation") {
    await tutor.recordTool(complete);
    tutor.meter.transcript.push({ role: "tutor", text: "רוצה לסיים?" }, { role: "learner", text: "כן" });
  }
  if (mode === "summary") { tutor.meter.learnerTurns = 1; tutor.meter.lessonSummary = {}; }
  if (mode === "translation") { tutor.controls.lesson = undefined; tutor.meter.learnerTurns = tutor.meter.tutorTurns = 1; }
  expect(await tutor.recordTool(complete)).toBe(true);
  expect(tutor.progress.logDiagnostic).toHaveBeenLastCalledWith("", "", "task_completed_guard", expect.objectContaining({
    allowed: true, condition, confirmation_requested_at_turn: mode === "confirmation" ? 0 : null,
  }));
});

it("logs every empty or repeated refusal without transcript text", async () => {
  const tutor = session();
  tutor.meter.transcript.push({ role: "learner", text: "private learner speech ".repeat(10) });
  for (let i = 0; i < 2; i++) await tutor.recordTool(complete);
  expect(tutor.progress.logDiagnostic).toHaveBeenCalledTimes(2);
  const details = tutor.progress.logDiagnostic.mock.calls[1][3];
  expect(details).toMatchObject({ allowed: false, condition: "confirmation_required", confirmation_requested_at_turn: 1, has_lesson: true, final_sent: false, metered_at: null });
  expect(JSON.stringify(details)).not.toContain("private learner speech");
});

it("logs intake refusals before the normal completion guard", async () => {
  const tutor = session();
  tutor.controls.intake_pending = true;
  expect(await tutor.recordTool(complete)).toBe(false);
  expect(tutor.progress.logDiagnostic).toHaveBeenCalledWith("", "", "task_completed_guard", expect.objectContaining({ allowed: false, condition: "intake_pending" }));
});

it("preserves a short remaining allowance ending before the full allowance expires", async () => {
  const tutor = session();
  tutor.controls.ending_policy = "after_target_with_permission";
  tutor.controls.target_lesson_minutes = 10;
  tutor.meteredAt = Date.now() - 36923;
  tutor.allowanceMs = 61044;
  tutor.meter.learnerTurns = 2;
  tutor.meter.tutorTurns = 3;
  expect(await tutor.recordTool(complete)).toMatchObject({ saved: false });
  tutor.finalSent = true;
  expect(await tutor.recordTool(complete)).toBe(true);
  expect(tutor.progress.logDiagnostic).toHaveBeenLastCalledWith("", "", "task_completed_guard", expect.objectContaining({
    allowed: true, condition: "quota_closing", allowance_ms: 61044, final_sent: true, has_lesson: true, confirmation_requested_at_turn: null,
  }));
});

it("does not change a guard refusal when diagnostic persistence fails", async () => {
  const tutor = session();
  tutor.progress.logDiagnostic.mockRejectedValue(new Error("database unavailable"));
  expect(await tutor.recordTool(complete)).toMatchObject({ saved: false, reason: "confirmation_required" });
  tutor.finalSent = true;
  expect(await tutor.recordTool(complete)).toBe(true);
});

it("flushes a cascade sub-frame tail at turn completion, without waiting for the next response", async () => {
  const tutor = session();
  tutor.controls.lesson = undefined;
  tutor.cascadeConfig = {};
  tutor.partial = Uint8Array.of(1,2,3,4);
  tutor.progress.logLatency = vi.fn().mockResolvedValue(undefined);
  const events = [{type:"turn_complete"}];
  tutor.ai = {next: vi.fn(async()=>{const event=events.shift();if(!event)tutor.abort.abort();return event;})};
  await tutor.aiToOutput();
  expect(tutor.partial.byteLength).toBe(0);
  expect(tutor.output).toHaveLength(1);
  expect([...tutor.output[0].slice(0,5)]).toEqual([1,2,3,4,0]);
});
