import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TeacherMark, isFemale } from "../../src/components/portal/LineTeacher";
import { ConversationArt } from "../../src/components/portal/ConversationArt";

const source = file => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const render = props => renderToStaticMarkup(createElement(TeacherMark, props));

describe("NetFree-safe Pulse teacher artwork", () => {
  it.each(["Aoede", "Kore", "Leda", "Zephyr", "Sulafat"])("selects female PNGs for %s without SVG markup", voice => {
    const html = render({ teacher: { name: "אסתי", voice }, className: "line-teacher-badge" });
    expect(isFemale(voice)).toBe(true);
    expect(html).toMatch(/src="\/brand\/teachers\/female-[0-5]\.png"/);
    expect(html).toContain('alt="דיוקן של אסתי"');
    expect(html).toContain('class="line-teacher line-teacher-badge"');
    expect(html).not.toMatch(/<svg|\.svg/);
  });

  it.each([undefined, "Puck", "unknown"])("uses a valid male fallback for voice %s", voice => {
    expect(isFemale(voice)).toBe(false);
    expect(render({ teacher: { name: "דוד", voice } })).toMatch(/src="\/brand\/teachers\/male-[0-5]\.png"/);
  });

  it("handles missing or empty teacher data and preserves deterministic index/name variants", () => {
    expect(render({})).toContain('src="/brand/teachers/male-0.png"');
    expect(render({})).toContain('alt="דיוקן מורה"');
    expect(render({ index: 7 })).toContain('src="/brand/teachers/male-1.png"');
    expect(render({ teacher: { name: "" } })).toContain('src="/brand/teachers/male-0.png"');
    const teacher = { name: 'אסתי / " <script>', voice: "Aoede" };
    const html = render({ teacher, index: 0 });
    expect(html).toBe(render({ teacher, index: 5 }));
    expect(html).toMatch(/src="\/brand\/teachers\/female-[0-5]\.png"/);
    expect(html).not.toContain("<script>");
  });

  it("ships all reachable portraits and illustrations as nonempty @2x PNGs", () => {
    const dir = new URL("../../public/brand/teachers/", import.meta.url);
    const dimensions = Object.fromEntries(["male", "female"].flatMap(gender => Array.from({ length: 6 }, (_, i) => [`${gender}-${i}`, [192, 192]])));
    Object.assign(dimensions, { "voice-hero": [640, 540], conversation: [720, 720], listen: [60, 60], speak: [60, 60], repeat: [60, 60] });
    expect(readdirSync(dir).filter(name => name.endsWith(".png")).sort()).toEqual(Object.keys(dimensions).map(name => name + ".png").sort());
    for (const [name, [width, height]] of Object.entries(dimensions)) {
      const png = readFileSync(new URL(name + ".png", dir));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(height);
      expect(png.length).toBeGreaterThan(150);
    }
  });

  it("keeps decorative conversation artwork raster and supports small/seed props", () => {
    for (const props of [{}, { small: true, seed: 3 }]) {
      const html = renderToStaticMarkup(createElement(ConversationArt, props));
      expect(html).toContain('src="/brand/teachers/conversation.png"');
      expect(html).toContain('alt=""');
      expect(html).not.toMatch(/<svg|\.svg/);
      if (props.small) expect(html).toContain("sk-art-small");
    }
  });

  it("positions portraits above the card disc and animates images with reduced-motion support", () => {
    const css = source("src/components/portal/line-teacher.css");
    expect(css).toMatch(/\.line-teacher\s*\{[^}]*position:\s*relative/);
    expect(css).toContain("animation: teacher-breathe");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.line-teacher \{ animation: none/);
    expect(source("src/components/portal/portal-polish.css")).toMatch(/prefers-reduced-motion: reduce[^}]*\.sk-conversation-art \{ animation: none/);
  });

  it("uses no inline or fetched SVG for landing/portal illustrations and does not hide the hero", () => {
    for (const file of ["LineTeacher.tsx", "ConversationArt.tsx", "SpeakoolLanding.tsx", "LearnerPortal.tsx"]) {
      expect(source(`src/components/portal/${file}`)).not.toMatch(/<svg|(?:src|url)\([^)]*\.svg|src=[^\n]*\.svg/);
    }
    const landing = source("src/components/portal/SpeakoolLanding.tsx");
    for (const name of ["voice-hero", "listen", "speak", "repeat"]) expect(landing).toContain(`/brand/teachers/${name}.png`);
    const css = source("src/components/portal/landing.css");
    expect(css).not.toMatch(/> figure \{ display: none/);
    expect(css).toContain(".sk-land-clock::before");
    expect(source("src/components/portal/portal-polish.css")).toContain(".speakool .sk-hero-art { display: block; }");
  });
});
