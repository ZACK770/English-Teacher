import { describe, expect, it, vi } from "vitest";
import { CascadeLive } from "../src/cascade";
import { TranscriptCoach, type CoachMode } from "../src/lesson-coach";
import type { GeminiEvent } from "../src/gemini";
import type { LessonPlan } from "../src/learning";

const plan: LessonPlan = { level: "beginner", conversation_mode: "guided", correction_policy: "after_answer",
  learning_load: "light", topic: "travel", closing_activity: "roleplay", grammar: [],
  vocabulary: [{ id: "travel.reservation", text: "reservation", meaning_he: "הזמנה", domain: "travel", level: "beginner" }] };
const question = 'אפשר לחזור אחריי: "I have a reservation"?';
function sse(text: string) {
  return new Response("data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\ndata: [DONE]\n");
}
function fixture(mode?: CoachMode, semantic?: { model: string; mode: CoachMode }) {
  const listeners = new Map<string, (event: { data: string }) => void>();
  const socket = { accept: vi.fn(), send: vi.fn(), close: vi.fn(), addEventListener: (name: string, fn: (event: { data: string }) => void) => listeners.set(name, fn) };
  const modelRequests: any[] = []; const requests: string[] = [];
  const request = (async (url: string, init: RequestInit) => {
    requests.push(url);
    if (url.startsWith("https://stt-rt")) return { webSocket: socket } as unknown as Response;
    if (url.startsWith("https://openrouter")) {
      const body = JSON.parse(init.body as string);
      if (body.model === "observer") {
        await new Promise(resolve => setTimeout(resolve, 20));
        return Response.json({ choices: [{ message: { content: '{"outcome":"partial","confidence":"high"}' } }] });
      }
      modelRequests.push(body); return sse(question);
    }
    return new Response(JSON.stringify({ result: { audioContent: "AQACAA==" } }) + "\n");
  }) as typeof fetch;
  const engine = new CascadeLive({ sonioxKey: "mock", openrouterKey: "mock", inworldKey: "mock", model: "mock", voice: "mock" },
    { setup: { systemInstruction: { parts: [{ text: "Original school rules; teach English only." }] } } }, request,
    mode ? new TranscriptCoach(plan, mode) : undefined, () => true, semantic);
  const input = (text: string, final = true) => listeners.get("message")!({ data: JSON.stringify({ tokens: [{ text, is_final: final }, ...(final ? [{ text: "<end>", is_final: true }] : [])] }) });
  const complete = async () => {
    const events: GeminiEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const event = await engine.next(); events.push(event);
      if (event.type === "turn_complete") break;
    }
    // Our mock produces <1ms of audio; let the real generation/audio clock finish
    // so following input is a genuine post-playback response, not an interruption.
    await new Promise(resolve => setTimeout(resolve, 5));
    return events;
  };
  return { engine, modelRequests, requests, input, complete };
}
describe("pre-generation hook in the actual CascadeLive engine", () => {
  it("evaluates the final Soniox transcript before the next LLM request in active mode", async () => {
    const f = fixture("active"); await f.engine.connect();
    try {
      f.engine.startGreeting("Start now"); await f.complete();
      f.input("Yes", false);
      expect(f.modelRequests).toHaveLength(1); // No decision/generation from interim transcript.
      f.input("Yes");
      const turn = await f.complete();
      expect(turn).toContainEqual(expect.objectContaining({ type: "lesson_coach", details: expect.objectContaining({ outcome: "ack_only", applied: true }) }));
      expect(f.modelRequests[1].messages[0].content).toContain("has not completed the requested English output");
      expect(f.modelRequests[1].messages[0].content).toContain("Original school rules");
      f.input("No"); await f.complete();
      expect(f.modelRequests[2].messages[0].content).toContain("Two clearly observed non-completions");
      // Three ordinary assistant generations only. The coach never calls a model/provider.
      expect(f.requests.filter(u => u.startsWith("https://openrouter"))).toHaveLength(3);
      f.input("an ambiguous response"); await f.complete();
      expect(f.modelRequests[3].messages[0].content).not.toContain("APPLICATION LESSON COACH");
    } finally { f.engine.close(); }
  });
  it("records decisions without changing prompts in shadow mode", async () => {
    const f = fixture("shadow"); await f.engine.connect();
    try {
      f.engine.startGreeting("Start now"); await f.complete();
      f.input("Yes"); const turn = await f.complete();
      expect(turn).toContainEqual(expect.objectContaining({ type: "lesson_coach", details: expect.objectContaining({ outcome: "ack_only", applied: false, mode: "shadow" }) }));
      expect(f.modelRequests[1].messages[0].content).toBe("Original school rules; teach English only.");
    } finally { f.engine.close(); }
  });
  it("incorporates the optional independent semantic assessment before generating when active", async () => {
    const f = fixture("active", {model:"observer",mode:"active"}); await f.engine.connect();
    try {
      f.engine.startGreeting("Start now"); await f.complete();
      f.input("I got a room"); const turn = await f.complete();
      expect(turn).toContainEqual(expect.objectContaining({type:"lesson_coach_semantic",details:expect.objectContaining({outcome:"partial",applied:true})}));
      expect(f.modelRequests[1].messages[0].content).toContain("incomplete or erroneous response");
      f.input("Yes"); await f.complete();
      expect(f.modelRequests[2].messages[0].content).not.toContain("independent assessment sees");
    } finally {f.engine.close();}
  });
  it("does not wait for or inject semantic results in shadow mode", async () => {
    const f = fixture("active", {model:"observer",mode:"shadow"}); await f.engine.connect();
    try {
      f.engine.startGreeting("Start now"); await f.complete();
      f.input("I got a room"); await f.complete();
      expect(f.modelRequests[1].messages[0].content).not.toContain("APPLICATION LESSON COACH");
      await new Promise(resolve=>setTimeout(resolve,30));
      expect(await f.engine.next()).toMatchObject({type:"lesson_coach_semantic",details:{applied:false,mode:"shadow"}});
    } finally {f.engine.close();}
  });
  it("does not create observations for internal prompts, or affect the disabled voice path", async () => {
    const f = fixture(); await f.engine.connect();
    try {
      f.engine.startGreeting("Start now"); await f.complete();
      f.input("Yes"); expect((await f.complete()).some(e => e.type === "lesson_coach")).toBe(false);
      expect(f.modelRequests[1].messages[0].content).not.toContain("APPLICATION LESSON COACH");
    } finally { f.engine.close(); }
    const active = fixture("active"); await active.engine.connect();
    try {
      active.engine.startGreeting("Start now"); await active.complete();
      active.engine.prompt("APPLICATION CLOCK: closing stage reached");
      expect((await active.complete()).some(e => e.type === "lesson_coach")).toBe(false);
    } finally { active.engine.close(); }
  });
});
