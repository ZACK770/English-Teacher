import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../app/static/console.js", import.meta.url), "utf8");

function editor(item) {
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  const context = createContext({ document: { getElementById: () => ({}) }, sessionStorage: { getItem: () => "" }, window: { addEventListener() {} }, fetch });
  runInContext(source, context);
  runInContext("dialog = (title, fields, save) => { globalThis.fields = fields; globalThis.save = save; };", context);
  context.item = item;
  runInContext('editRecord("packages", item)', context);
  return { context, fetch };
}

describe("console package editor", () => {
  it("leaves a legacy absent call limit blank and does not send a replacement", async () => {
    const { context, fetch } = editor({ id: "legacy", name: "Legacy" });
    expect(context.fields).toContain('id="f_max_call_minutes" data-key="max_call_minutes" type="number" step="any" value=""');
    await context.save({ name: "Renamed", max_call_minutes: null });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("max_call_minutes");
  });

  it("preserves explicit limits and accepts deliberate limit changes", async () => {
    const { context, fetch } = editor({ id: "translator", max_call_minutes: 5 });
    expect(context.fields).toContain('step="any" value="5"');
    await context.save({ max_call_minutes: 12 });
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_call_minutes).toBe(12);
  });

  it("defaults only new packages to fifteen-minute calls", () => {
    expect(editor({}).context.fields).toContain('step="any" value="15"');
  });
});
