import { describe, expect, it } from "vitest";
import { withRecordedAudio } from "../src/phone-audio";
import { HIDDEN_CALLER_MESSAGE } from "../src/phone";

describe("recorded phone audio", () => {
  it("replaces known prompts with recorded files and keeps unknown text", () => {
    const result = withRecordedAudio({ type: "simpleMenu", files: [{ text: HIDDEN_CALLER_MESSAGE }, { text: "טקסט אחר" }] }, "https://example.test/");
    expect(result.files[0].fileLink).toMatch(/^https:\/\/example\.test\/brand\/phone\/hidden_caller-[0-9a-f]{12}\.wav$/);
    expect(result.files[1]).toEqual({ text: "טקסט אחר" });
  });
  it("leaves text when no public URL is configured", () => {
    expect(withRecordedAudio({ files: [{ text: HIDDEN_CALLER_MESSAGE }] }).files[0]).toEqual({ text: HIDDEN_CALLER_MESSAGE });
  });
});
