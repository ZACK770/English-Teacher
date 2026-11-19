import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinLanding } from "../../src/components/join/JoinLanding";
import { Navbar } from "../../src/components/Navbar";
import { legalBasePath } from "../../src/legalRoutes";

vi.mock("../../src/store/AppContext", () => ({
  useApp: () => ({ currentCustomer: null, streak: { current_streak: 0 } }),
}));

vi.mock("lucide-react", () => ({
  PhoneCall: () => null,
  Gift: () => null,
  CheckCircle: () => null,
  Volume2: () => null,
  Sparkles: () => null,
  ArrowLeft: () => null,
  LayoutDashboard: () => null,
  GraduationCap: () => null,
  Flame: () => null,
  Clock: () => null,
  User: () => null,
  ShieldAlert: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("Pulse join page", () => {
  it.each(["/join", "/english/join"])("links the shared logo to the public home from %s", pathname => {
    const href = `${legalBasePath(pathname)}/`;
    const html = renderToStaticMarkup(createElement(Navbar, { currentView: 'join', onNavigate: () => {}, logoHref: href }));
    expect(html).toContain(`<a href="${href}" aria-label="SpeakCall — עמוד הבית"`);
    const source = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain("logoHref={currentView === 'join' ? `${legalBasePath(window.location.pathname)}/` : undefined}");
  });

  it("keeps the dashboard logo as its existing navigation button when no href is supplied", () => {
    const html = renderToStaticMarkup(createElement(Navbar, { currentView: 'dashboard', onNavigate: () => {} }));
    expect(html).toContain('<button class="flex items-center gap-2.5 cursor-pointer group"><span role="img"');
    expect(html).not.toContain('aria-label="SpeakCall — עמוד הבית"');
  });

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
