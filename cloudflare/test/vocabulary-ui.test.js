import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VocabularyPage } from "../../src/components/portal/VocabularyPage";

vi.mock("../../src/components/portal/portalApi", () => ({ portalRequest: vi.fn(), topics: {} }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null, Check: () => null, Plus: () => null, Trash2: () => null, Upload: () => null }));

describe("learner vocabulary options", () => {
  const render = (materials, preferences = {}, teachers = []) => renderToStaticMarkup(createElement(VocabularyPage, {
    account: { materials, preferences, teachers, progress: { session_count: 0 }, access: { paid: false } },
    token: "test",
    onSave: vi.fn(),
    onActivate: vi.fn(),
    onDelete: vi.fn(),
  }));

  it("offers personal creation as a library card before the catalog finishes loading", () => {
    const html = render([]);
    expect(html).toMatch(/class="sk-domain-grid"><button[^>]*aria-expanded="false"[^>]*>.*יצירת אוצר מילים משלך/);
    expect(html).not.toContain("<form");
  });

  it("shows personal lists in the same grid, free, with the active teacher's choice marked", () => {
    const html = render([
      { id: "first", name: "ראשונה", words: ["garden"] },
      { id: "second", name: "שנייה", words: ["פגישה"], target_count: 0 },
    ], { active_teacher: "teacher", material_id: "first" }, [{ id: "teacher", material_id: "second" }]);
    expect(html).toMatch(/class="sk-domain-grid">.*יצירת אוצר מילים משלך.*<article.*ראשונה.*לקחת לשיחה הבאה.*<article.*שנייה.*ללא ציוני מילים.*aria-pressed="true".*ברשימת השיחה הבאה/);
    expect(html).not.toContain("sk-pro-badge");
  });
});
