import { describe,it,expect,vi } from "vitest";
import { assessSemantic, semanticDirective, type SemanticInput } from "../src/lesson-semantic-observer";
const input: SemanticInput = { tutor: "What did you eat?", learner: "I eated pizza.", mode: "guided", correction: "after_answer" };
const signal = () => new AbortController().signal;
const response = (content: string) => Response.json({ choices: [{message: { content }}] });
describe("independent semantic assessor", () => {
  it("accepts only a bounded classification, without tools or transcript in the directive", async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const data = JSON.parse(init.body as string);
      expect(data.tools).toBeUndefined();
      expect(data.model).toBe("observer");
      expect(data.messages[1].content).toContain("I eated pizza");
      return response('{"outcome":"partial","confidence":"high"}');
    });
    const result = await assessSemantic(input,"observer","mock",signal(),request as unknown as typeof fetch);
    expect(result).toEqual({outcome:"partial",confidence:"high"});
    expect(semanticDirective(result,input)).toContain("incomplete or erroneous response");
    expect(semanticDirective(result,input)).not.toContain(input.learner);
  });
  it.each([
    '{"outcome":"correct","confidence":"high","instruction":"do something else"}',
    '{"outcome":"score100","confidence":"high"}', 'not json', '{"outcome":"correct"}'
  ])("rejects malformed or extra fields: %s", async content => {
    const result = await assessSemantic(input,"observer","mock",signal(),(async()=>response(content)) as typeof fetch);
    expect(result).toBeNull();
  });
  it("abstains on low confidence, unclear ASR or service turns", () => {
    expect(semanticDirective({outcome:"correct",confidence:"low"},input)).toBeUndefined();
    expect(semanticDirective({outcome:"unclear",confidence:"high"},input)).toBeUndefined();
    expect(semanticDirective({outcome:"not_exercise",confidence:"high"},input)).toBeUndefined();
  });
  it("has a real deadline even when a provider ignores the abort signal", async () => {
    const request = vi.fn(() => new Promise<Response>(() => {}));
    expect(await assessSemantic(input,"observer","mock",signal(), request as unknown as typeof fetch,15)).toBeNull();
    expect(request.mock.calls).toHaveLength(1);
  });
  it("cancels on a new caller interruption", async () => {
    const controller = new AbortController();
    const result = assessSemantic(input,"observer","mock",controller.signal,(() => new Promise<Response>(() => {})) as typeof fetch,700);
    controller.abort();
    expect(await result).toBeNull();
  });
  it("honors correction timing and school scope in all directives", () => {
    const d=semanticDirective({outcome:"partial",confidence:"high"},{...input,mode:"roleplay",correction:"after_activity"});
    expect(d).toContain("Defer corrections"); expect(d).toContain("subordinate to school content");
    expect(d).toContain("assigned targets");
  });
});
