import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SpeakCallLogo } from "../../src/components/brand/SpeakCallLogo";

describe("SpeakCall Pulse branding", () => {
  it.each(["join/JoinLanding.tsx", "dashboard/AdminAuthGate.tsx"])("keeps %s logo home links within the deployment base", file => {
    const source = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), "utf8");
    expect(source).toContain('href={`${legalBasePath(window.location.pathname)}/`}');
  });

  it.each([
    [{}, "logo-en-reverse.svg"],
    [{ reverse: false }, "logo-en.svg"],
    [{ variant: "symbol" }, "symbol-reverse.svg"],
    [{ variant: "symbol", reverse: false }, "symbol.svg"],
  ])("renders the requested asset for %j", (props, asset) => {
    const html = renderToStaticMarkup(createElement(SpeakCallLogo, props));
    expect(html).toContain(`/brand/speakcall/${asset}`);
    expect(html).toContain('alt="SpeakCall — ספיקול"');
  });

  it("only supplies the narrow-screen symbol when collapse is requested", () => {
    const render = collapse => renderToStaticMarkup(createElement(SpeakCallLogo, { collapse }));
    expect(render(true)).toContain('media="(max-width: 960px)"');
    expect(render(true)).toContain('srcSet="/brand/speakcall/symbol-reverse.svg"');
    expect(render(false)).not.toContain("<source");
  });

  it("removes the blue/teal palette from every SVG and preserves mono assets", () => {
    const dir = new URL("../../public/brand/speakcall/", import.meta.url);
    for (const name of readdirSync(dir).filter(name => name.endsWith(".svg"))) {
      const svg = readFileSync(new URL(name, dir), "utf8");
      expect(svg).not.toMatch(/#(?:3156d8|148f95|a9beff|6dd8cf|e7edff|ddf3ed)/i);
      if (name.includes("-black")) expect([...new Set(svg.match(/#[0-9a-f]{6}/gi))]).toEqual(["#111111"]);
      if (name.includes("-white")) expect([...new Set(svg.match(/#[0-9a-f]{6}/gi))]).toEqual(["#FFFFFF"]);
    }
  });
});
