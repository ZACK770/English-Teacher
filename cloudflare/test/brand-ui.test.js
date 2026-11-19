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
    [{}, "9.75 42.75 707.75 170.25", "#c0f67d", "#8fd14f"],
    [{ reverse: false }, "9.75 42.75 707.75 170.25", "#5f9e1f", "#497a18"],
    [{ variant: "symbol" }, "0 0 128 128", "#c0f67d", "#8fd14f"],
    [{ variant: "symbol", reverse: false }, "0 0 128 128", "#5f9e1f", "#497a18"],
  ])("renders accessible inline Pulse artwork for %j", (props, viewBox, color, accent) => {
    const html = renderToStaticMarkup(createElement(SpeakCallLogo, props));
    expect(html).toContain(`viewBox="${viewBox}"`);
    expect(html).toContain(`fill="${color}"`);
    expect(html).toContain(`fill="${accent}"`);
    expect(html).toContain('<path');
    const mark = html.match(/<g class="sc-logo-symbol-mark">([\s\S]*?)<\/g>/)[1];
    expect(mark.match(/<path\b/g)).toHaveLength(2);
    expect(html).toContain('role="img" aria-label="SpeakCall — ספיקול"');
    expect(html).not.toMatch(/<(?:img|source|picture)\b|(?:src|href)=/);
  });

  it("only supplies the narrow-screen symbol when collapse is requested", () => {
    const render = collapse => renderToStaticMarkup(createElement(SpeakCallLogo, { collapse }));
    expect(render(true)).toContain('class="sc-logo-compact"');
    expect(render(true).match(/<svg\b/g)).toHaveLength(2);
    expect(render(false)).not.toContain('class="sc-logo-compact"');
    expect(render(false).match(/<svg\b/g)).toHaveLength(1);
    const css = readFileSync(new URL('../../src/components/brand/logo.css', import.meta.url), 'utf8');
    expect(css).toContain('@media (max-width: 960px)');
    expect(css).toContain('.sc-logo-collapse .sc-logo-full { display: none; }');
    expect(css).toContain('.sc-logo-collapse .sc-logo-compact { display: block; }');
  });

  it("provides a matching @2x PNG for every logo, symbol and app icon", () => {
    const dir = new URL('../../public/brand/speakcall/', import.meta.url);
    for (const name of readdirSync(dir).filter(name => /^(logo-|symbol|app-icon).*\.svg$/.test(name))) {
      const svg = readFileSync(new URL(name, dir), 'utf8');
      const png = readFileSync(new URL(name.replace(/\.svg$/, '.png'), dir));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(Math.round(Number(svg.match(/\bwidth="([\d.]+)"/)[1]) * 2));
      expect(png.readUInt32BE(20)).toBe(Math.round(Number(svg.match(/\bheight="([\d.]+)"/)[1]) * 2));
    }
  });

  it("uses a raster favicon rather than requesting an SVG", () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('type="image/png" sizes="32x32" href="/brand/speakcall/favicon-32.png"');
    expect(html).not.toMatch(/(?:href|content)="[^"]*\.svg/);
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
