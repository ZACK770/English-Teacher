import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinLanding } from "../../src/components/join/JoinLanding";

vi.mock("lucide-react", () => ({
  PhoneCall: () => null,
  Gift: () => null,
  CheckCircle: () => null,
  Volume2: () => null,
  Sparkles: () => null,
  ArrowLeft: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("Pulse join page", () => {
  it.each(["/join", "/english/join"])("relies on the shared logo header at %s", pathname => {
    vi.stubGlobal("window", { location: { pathname } });
    const html = renderToStaticMarkup(createElement(JoinLanding));
    expect(html).toContain('class="join-pulse');
    expect(html).not.toMatch(/<header|sc-logo|SpeakCall — עמוד הבית/);
    expect(html).toContain('role="group" aria-label="נוסח פנייה"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('type="submit"');
    expect(html).toContain(`href="${pathname.startsWith('/english/') ? '/english' : ''}/terms"`);
  });

  it("uses Pulse colors across campaign variants and callback states", () => {
    const source = readFileSync(new URL('../../src/components/join/JoinLanding.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../src/components/join/join.css', import.meta.url), 'utf8');
    expect(source).not.toMatch(/(?:bg|text|border|shadow)-(?:slate|emerald)-|#0b0f17/);
    expect(source).toContain('bg-[var(--accent)] text-[var(--paper)]');
    expect(source).toContain('role="alert"');
    for (const color of ['#111a1a', '#1b2726', '#f0f5ef', '#a9bbb4', '#35423e', '#c0f67d']) expect(css).toContain(color);
    expect(css).toContain('color-scheme: dark');
  });
});
