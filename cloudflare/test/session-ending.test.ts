import { expect, it, vi } from "vitest";
import { controlsFromSettings } from "../src/controls";
import { type Env, settings } from "../src/env";
import { TutorSession } from "../src/session";

function session() {
  const env = {} as Env;
  const tutor = new TutorSession({ send: vi.fn(), close: vi.fn() } as unknown as WebSocket, env, settings(env), "owner") as any;
  tutor.controls = { ...controlsFromSettings(false), intake_pending: false, lesson: { vocabulary: [], grammar: [] } };
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
