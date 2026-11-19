import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || "sharp");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { Ear, Mic, RefreshCw } = require("lucide-react");
const output = new URL("../public/brand/teachers/", import.meta.url);
await mkdir(output, { recursive: true });

const ink = "#f0f5ef", accent = "#c0f67d", card = "#1b2726", paper = "#111a1a", sage = "#25362d";
const path = (d, color = ink) => `<path d="${d}" stroke="${color}"/>`;
const svg = (width, height, content, strokeWidth = 1.8) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" stroke="${ink}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
const write = (name, source, width, height) => sharp(Buffer.from(source), { density: 144 }).resize(width * 2, height * 2).png().toFile(new URL(name + ".png", output).pathname);

for (const female of [false, true]) {
  for (let seed = 0; seed < 6; seed++) {
    const shoulders = female ? "M24 82c2-10 9-15 18-17m16 0c9 2 16 7 18 17M43 64v6l7 6 7-6v-6" : "M24 82c2-8 9-12 18-14m16 0c9 2 16 6 18 14M43 69v4l7 5 7-5v-4";
    const head = female
      ? path("M29 60V41c0-15 8-23 21-23s21 8 21 23v19l-7 7M30 39c9-1 17-6 23-13 3 6 9 10 17 13M29 60l7 7", accent)
        + path("M35 41v7c0 12 7 19 15 19s15-7 15-19v-7")
        + path(seed % 3 === 0 ? "M34 30c4-9 13-12 22-10" : "M38 25c5-4 12-5 18-3", accent)
      : path("M33 48v-8c0-8 4-13 10-15m14 0c6 2 10 7 10 15v8M35 36c4-4 9-6 15-6s11 2 15 6")
        + path("M43 25q7-4 14 0q-7 1-14 0Z", accent)
        + path(seed % 3 === 0 ? "M33 48c0 14 6 23 17 23s17-9 17-23" : "M33 48c0 13 7 19 17 22 10-3 17-9 17-22")
        + path("M34 51q4 5 9 2 7-3 14 0 5 3 9-2");
    const glasses = seed % 2 === 1 ? `<rect x="36" y="40" width="12" height="10" rx="4"/><rect x="52" y="40" width="12" height="10" rx="4"/>${path("M48 44q2-2 4 0")}` : "";
    await write(`${female ? "female" : "male"}-${seed}`, svg(100, 100,
      `<circle cx="50" cy="50" r="46" stroke="${accent}" stroke-width="1" opacity=".65"/>`
      + path(shoulders) + head + path("M49 47l-1 6h3M45 58q5 4 10 0")
      + `<circle cx="42" cy="45" r=".9" fill="${ink}" stroke="none"/><circle cx="58" cy="45" r=".9" fill="${ink}" stroke="none"/>` + glasses), 96, 96);
  }
}

await write("voice-hero", svg(320, 270,
  `<g stroke="${accent}" stroke-width=".8" opacity=".5"><circle cx="160" cy="130" r="105"/><circle cx="160" cy="130" r="121"/></g>`
  + path("M74 98q-19 32 0 64M246 98q19 32 0 64M63 89q-26 41 0 82M257 89q26 41 0 82", accent)
  + path("M194 96c-10-12-21-18-36-18-29 0-47 21-47 51s18 51 47 51c12 0 23-4 31-11l20 22v-35l-18-13c-6 13-17 21-33 21-19 0-29-15-29-35s10-35 29-35c12 0 22 6 29 17Z")
  + path("m189 169 20 22v-25", accent), 1.6), 320, 270);

await write("conversation", svg(360, 360,
  `<circle cx="180" cy="180" r="135" fill="${sage}" stroke="none" opacity=".65"/>`
  + `<ellipse cx="180" cy="180" rx="142" ry="63" transform="rotate(-37 180 180)" stroke-width=".75"/>`
  + `<circle cx="292" cy="95" r="7" fill="${accent}" stroke="none"/>`
  + `<path d="M78 97Q78 80 95 80H211Q228 80 228 97V174Q228 191 211 191H132L104 217V191H95Q78 191 78 174Z" fill="${card}" stroke-width="1"/>`
  + `<text x="153" y="151" text-anchor="middle" direction="ltr" font-size="43" font-family="Georgia,serif" fill="${ink}" stroke="none">hello.</text>`
  + `<path d="M145 184Q145 170 159 170H268Q282 170 282 184V246Q282 260 268 260H247V283L218 260H159Q145 260 145 246Z" fill="${accent}" stroke="none"/>`
  + Array.from({ length: 7 }, (_, n) => `<rect x="${180 + n * 11}" y="${203 - (n % 3) * 5}" width="3" height="${24 + (n % 3) * 10}" rx="2" fill="${paper}" stroke="none"/>`).join("")
  + path("M82 265v22m-11-11h22M284 58v17m-8-8h16")
  + `<circle cx="82" cy="232" r="3" fill="${ink}" stroke="none"/><circle cx="277" cy="301" r="3" fill="${ink}" stroke="none"/>`, 1), 360, 360);

for (const [name, icon] of [["listen", Ear], ["speak", Mic], ["repeat", RefreshCw]]) {
  await write(name, renderToStaticMarkup(createElement(icon, { size: 30, color: accent, strokeWidth: 1.5 })), 30, 30);
}
console.log("Generated 17 Pulse PNG illustrations at @2x resolution.");
