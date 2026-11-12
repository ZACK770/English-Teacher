import { describe, it, expect } from "vitest";
import { TextNavigationDialogue } from "../src/navigation-text";

describe("text navigator retains free conversation and navigation tools without Live", () => {
  it("passes live facts through a tool round and keeps the conversation for the next question", async () => {
    const requests = [], tools = [];
    const dialogue = new TextNavigationDialogue(async (model, body) => {
      requests.push(structuredClone(body));
      if (requests.length === 1) return { candidates: [{ content: { parts: [{ functionCall: { name: "get_status", args: {} } }] } }] };
      return { candidates: [{ content: { parts: [{ text: requests.length === 2 ? "בעוד 300 מטר פנה ימינה לרש״י." : "עוד 12 דקות." }] } }], usageMetadata: { promptTokenCount: 10 } };
    }, async (name, args) => {
      tools.push({ name, args }); return { next_turn: { instruction: "פנה ימינה לרש״י", in_meters: 300 }, remaining_minutes_with_traffic: 12 };
    });
    const first = await dialogue.reply("מה הפנייה הקרובה?");
    expect(first.text).toContain("300");
    expect(first.calls[0].name).toBe("get_status");
    expect(tools).toEqual([{ name: "get_status", args: {} }]);
    expect(requests[1].contents.at(-1).parts[0].functionResponse.response.remaining_minutes_with_traffic).toBe(12);
    expect((await dialogue.reply("וכמה זמן עוד נשאר?")).text).toBe("עוד 12 דקות.");
    expect(requests[2].contents.some((c) => c.parts.some((p) => p.text === "מה הפנייה הקרובה?"))).toBe(true);
  });
  it("returns a failed tool to the model instead of making up a successful result", async () => {
    let round = 0;
    const dialogue = new TextNavigationDialogue(async (model, body) => {
      if (++round === 1) return { candidates: [{ content: { parts: [{ functionCall: { name: "start_route", args: { destination: "ירושלים" } } }] } }] };
      expect(body.contents.at(-1).parts[0].functionResponse.response.error).toContain("unavailable");
      return { candidates: [{ content: { parts: [{ text: "חישוב המסלול נכשל, נסה שוב." }] } }] };
    }, async () => { throw new Error("offline"); });
    expect((await dialogue.reply("סע לירושלים")).text).toContain("נכשל");
  });
});
