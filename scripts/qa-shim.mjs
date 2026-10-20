#!/usr/bin/env node
// The runtime shim (dist/runtime.js) in Chrome and in WebKit (Safari's engine), with the bundled Arabic fonts — four
// of them have no cmap entry for U+200D, the case where ZWJ padding breaks in Safari. For every font × text:
//   · at rest: the per-letter boxes after the shim vs the same text as plain running text, ink overlap ≥ 0.97
//     (Chrome: the default ZWJ padding and the forced clip method; WebKit: its default, the clip method)
//   · mid-animation sanity: a translateY + opacity stagger; the clip method vs ZWJ padding in Chrome (where ZWJ is
//     right with any font), reported, and ≥ 0.85 required (they differ only where a glyph overhangs its slice)
//   · rotate/scale: screenshots only (--shots DIR), for the docs
//   npm run qa:shim [-- --shots DIR] [--no-webkit]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { chromium, webkit } from "playwright-core";
import { CHROME } from "../dist/render.js";
import { RUNTIME_SHIM } from "../dist/runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DUMP = args.includes("--dump") ? path.resolve(args[args.indexOf("--dump") + 1]) : "";
const SHOTS = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : "";
const FONTS = ["Alexandria.ttf", "IBMPlexSansArabic-Bold.ttf", "Cairo.ttf", "Tajawal-Bold.ttf", "ReadexPro.ttf", "NotoNaskhArabic.ttf"];
// "|" marks a words,chars split (each word in its own inline-block box, like GSAP SplitText); the rest are flat letter boxes
const TEXTS = ["الحكايات", "السلام عليكم", "لا", "لا إله إلا الله", "العَرَبِيَّةُ", "|مُحَمَّدٌ رَسُولُ", "|حركة AI مجانية"];
const REST_MIN = 0.97, MOTION_MIN = 0.85;

const letters = (w) => [...w].map((c) => (c === " " ? " " : `<span class="ch">${c}</span>`)).join("");
const splitHtml = (t) => t.startsWith("|") ? t.slice(1).split(" ").map((w) => `<span class="w">${letters(w)}</span>`).join(" ") : letters(t);
// the reference for a words,chars split is the same words, unsplit, in their word boxes: Linux WebKit (Playwright's
// WebKitGTK/WPE build) carries harakat y-offsets into the pen position across a run, so a whole phrase drifts
// vertically word by word; a word box restarts the run, in plain text and in the shim's per-word layers alike
const refHtml = (t) => t.startsWith("|") ? t.slice(1).split(" ").map((w) => `<span class="w">${w}</span>`).join(" ") : t;
const page = (font, text, mode, motion) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:T;src:url("/fonts/${font}");font-weight:100 900}
body{margin:0;background:#fff;color:#000}
.row{font:700 84px/1.5 T;white-space:nowrap;padding:70px 48px;width:max-content}
#split span,#ref span{display:inline-block}
</style></head><body>
<div class="row" id="ref">${refHtml(text)}</div>
<div class="row" id="split">${splitHtml(text)}</div>
<script>${mode ? `window.__harakahSplit=${JSON.stringify(mode)};` : ""}</script>
<script>window.__ready=document.fonts.load('700 84px T').then(()=>document.fonts.ready)</script>
<script>${RUNTIME_SHIM}</script>
<script>window.__motion=${JSON.stringify(motion || "")};
window.__apply=()=>{const s=[...document.querySelectorAll('#split .ch')];s.forEach((e,i)=>{
 if(__motion==='stagger'){e.style.transform='translateY('+(((i%3)-1)*14)+'px)';e.style.opacity=String(0.55+0.45*((i%2)))}
 if(__motion==='rotate'){e.style.transform='rotate('+(((i%3)-1)*12)+'deg)'}
 if(__motion==='scale'){e.style.transform='scale('+(1+0.25*((i%2)))+')'}})};</script>
</body></html>`;

let current = "";
const server = http.createServer((q, s) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname.startsWith("/fonts/")) { s.writeHead(200, { "content-type": "font/ttf" }); return fs.createReadStream(path.join(ROOT, "assets", "fonts", path.basename(u.pathname))).pipe(s); }
  s.writeHead(200, { "content-type": "text/html; charset=utf-8" }); s.end(current);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

function darkArea(a) { const I = PNG.sync.read(Buffer.from(a)); let n = 0; for (let i = 0; i < I.data.length; i += 4) if (I.data[i] < 160 || I.data[i + 1] < 160 || I.data[i + 2] < 160) n++; return n; }
// ink overlap of two renders, each cropped to its own ink box (shape, not placement: per-letter inline-blocks can
// sit a pixel or two lower in their line than running text, in both engines, with or without Harakah)
function ink(a, b) {
  const dark = (I, i) => I.data[i] < 160 || I.data[i + 1] < 160 || I.data[i + 2] < 160;
  const box = (I) => { let x0 = I.width, y0 = I.height, x1 = -1, y1 = -1; for (let y = 0; y < I.height; y++) for (let x = 0; x < I.width; x++) if (dark(I, (y * I.width + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1 }; };
  const A = PNG.sync.read(Buffer.from(a)), B = PNG.sync.read(Buffer.from(b)), ba = box(A), bb = box(B);
  if (!ba || !bb) return 0; // nothing drawn at all is a failure, not a match
  const W = Math.max(ba.x1 - ba.x0, bb.x1 - bb.x0) + 1, H = Math.max(ba.y1 - ba.y0, bb.y1 - bb.y0) + 1;
  const at = (I, bx, x, y) => { x = bx.x1 - (W - 1 - x); y = bx.y0 + y; return x >= bx.x0 && y <= bx.y1 && dark(I, (y * I.width + x) * 4); }; // right-aligned (RTL)
  let n = 0, u = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = at(A, ba, x, y), q = at(B, bb, x, y); if (p && q) n++; if (p || q) u++; }
  return u ? n / u : 0;
}

const engines = [["chrome", () => chromium.launch({ executablePath: CHROME })]];
if (!args.includes("--no-webkit")) engines.push(["webkit", () => webkit.launch()]);
const fails = [], rows = [];
const shotsOf = {};
for (const [E, launch] of engines) {
  const browser = await launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fails.push(`${E}: page error ${e.message}`));
  const render = async (font, text, mode, motion) => {
    current = page(font, text, mode, motion);
    await p.goto(BASE + "?" + Math.random(), { waitUntil: "domcontentloaded", timeout: 15000 });
    await p.evaluate(() => window.__ready); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (motion) { await p.evaluate(() => window.__apply()); await p.waitForTimeout(50); }
    const info = await p.evaluate(() => ({ clipped: document.querySelectorAll("#split [data-hz-l]").length, spans: document.querySelectorAll("#split .ch").length }));
    const out = { ref: await p.locator("#ref").screenshot(), split: await p.locator("#split").screenshot(), info };
    if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); const k = `${E}_${mode || "auto"}_${motion || "rest"}_${font.replace(/\.ttf$/, "")}_${TEXTS.indexOf(text)}`; fs.writeFileSync(path.join(DUMP, `${k}_ref.png`), out.ref); fs.writeFileSync(path.join(DUMP, `${k}_split.png`), out.split); }
    return out;
  };
  const modes = E === "chrome" ? [["zwj", ""], ["clip", "clip"]] : [["auto", ""]];
  for (const font of FONTS) for (const text of TEXTS) for (const [mname, mode] of modes) {
    const r = await render(font, text, mode, "");
    const s = ink(r.split, r.ref);
    rows.push({ E, font, text, mode: mname, rest: s, clipped: r.info.clipped });
    // Chrome's default (ZWJ padding) is reported, not gated: it joins, but loses font ligatures such as الله and
    // can place stacked harakat a little differently from running text
    if (s < REST_MIN && mname !== "zwj") fails.push(`${E} ${mname} ${font} «${text}»: at rest ${s.toFixed(3)} < ${REST_MIN}`);
    if (E === "webkit" && r.info.clipped === 0 && text !== "لا") fails.push(`${E} ${font} «${text}»: WebKit didn't use the clip method`);
    if (E === "chrome" && mode === "" && r.info.clipped) fails.push(`chrome ${font} «${text}»: Chrome left ZWJ padding (clipped ${r.info.clipped})`);
  }
  // motion: clip vs ZWJ in Chrome; WebKit's clip motion vs Chrome's ZWJ motion (cross-engine, reported only)
  for (const font of FONTS) for (const text of TEXTS.slice(0, 5)) {
    const m = await render(font, text, E === "chrome" ? "clip" : "", "stagger");
    shotsOf[`${E}|${font}|${text}`] = m.split;
    const area = darkArea(m.split) / Math.max(1, darkArea((await render(font, text, E === "chrome" ? "clip" : "", "")).split));
    rows.push({ E, font, text, mode: "motion ink area / rest", rest: area });
    if (!(area > 0.85 && area < 1.15)) fails.push(`${E} motion ${font} «${text}»: the moving letters draw ${area.toFixed(2)}× the ink they draw at rest`);
    if (E === "chrome") {
      const z = await render(font, text, "zwj", "stagger"); shotsOf[`zwj|${font}|${text}`] = z.split;
      const s = ink(m.split, z.split);
      // ZWJ motion is the reference only where ZWJ matches running text at rest
      const zr = rows.find((r) => r.E === "chrome" && r.mode === "zwj" && r.font === font && r.text === text)?.rest ?? 0;
      rows.push({ E, font, text, mode: zr >= REST_MIN ? "motion clip~zwj" : "motion clip~zwj (zwj off at rest)", rest: s });
      if (zr >= REST_MIN && s < MOTION_MIN) fails.push(`chrome motion ${font} «${text}»: clip vs ZWJ ${s.toFixed(3)} < ${MOTION_MIN}`);
    } else {
      const z = shotsOf[`zwj|${font}|${text}`];
      if (z) rows.push({ E, font, text, mode: "motion vs chrome zwj", rest: ink(m.split, z) });
    }
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `${E}_stagger_${font}_${TEXTS.indexOf(text)}.png`), m.split); }
  }
  if (SHOTS) for (const motion of ["rotate", "scale"]) for (const font of ["Alexandria.ttf", "NotoNaskhArabic.ttf"]) {
    const m = await render(font, "الحكايات", "", motion);
    fs.writeFileSync(path.join(SHOTS, `${E}_${motion}_${font}.png`), m.split);
  }
  await browser.close();
}
server.close();
const fmt = (x) => x.toFixed(3);
for (const E of [...new Set(rows.map((r) => r.E))]) for (const mode of [...new Set(rows.filter((r) => r.E === E).map((r) => r.mode))]) {
  const rs = rows.filter((r) => r.E === E && r.mode === mode), min = Math.min(...rs.map((r) => r.rest));
  const per = (f) => { const v = rs.filter((r) => r.font === f).map((r) => r.rest); return v.length ? fmt(Math.min(...v)) : "–"; };
  console.log(`${E} ${mode}: min ${fmt(min)}  ` + FONTS.map((f) => `${f.replace(/\.ttf$/, "")} ${per(f)}`).join(" · "));
}
if (args.includes("--json")) fs.writeFileSync(args[args.indexOf("--json") + 1], JSON.stringify(rows, null, 1));
if (fails.length) { for (const f of fails) console.error("✗ " + f); console.error(`qa-shim: ${fails.length} problem(s)`); process.exit(1); }
console.log(`qa-shim: ${FONTS.length} fonts × ${TEXTS.length} texts: the clip method matches running text at rest (≥ ${REST_MIN}) in Chrome and WebKit, moving letters keep their ink, clip motion ≈ ZWJ motion (≥ ${MOTION_MIN}) where ZWJ is right ✓`);
