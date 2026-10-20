#!/usr/bin/env node
// <ArabicText> from @harakah/remotion-arabic inside the Remotion Player, in WebKit (Safari's engine) and Chrome, with the
// six bundled Arabic fonts (four have no U+200D). At the last frame the Player's text must match the same words as
// plain text (ink overlap ≥ 0.97); WebKit must use the clip method (and does mid-animation too), Chrome must keep
// the ZWJ boxes (renders unchanged). The Player app is bundled from fixtures/remotion with its own React/Remotion.
//   npm run qa:player [-- --shots DIR]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { chromium, webkit } from "playwright-core";
import { CHROME } from "../dist/render.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "fixtures/remotion");
const args = process.argv.slice(2);
const SHOTS = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : "";
const FONTS = ["Alexandria.ttf", "IBMPlexSansArabic-Bold.ttf", "Cairo.ttf", "Tajawal-Bold.ttf", "ReadexPro.ttf", "NotoNaskhArabic.ttf"];
const TEXTS = ["الحكايات", "السلام عليكم", "قصص تستحق أن تُروى", "مُحَمَّدٌ رَسُولُ"];
const MIN = 0.97;

const APP = fs.readFileSync(path.join(ROOT, "scripts/qa-player-app.tsx"), "utf8"); // resolves react/remotion from fixtures/remotion
const esbuild = createRequire(path.join(FIX, "package.json"))("esbuild");
const bundle = (await esbuild.build({ stdin: { contents: APP, resolveDir: path.join(FIX, "src"), loader: "tsx", sourcefile: "qa-player.tsx" }, bundle: true, write: false, jsx: "automatic", logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"', "process.env.REMOTION_HARAKAH_REFERENCE": '"0"' } })).outputFiles[0].text;

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

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname.startsWith("/fonts/")) { r.writeHead(200, { "content-type": "font/ttf" }); return fs.createReadStream(path.join(ROOT, "assets/fonts", path.basename(u.pathname))).pipe(r); }
  if (u.pathname === "/app.js") { r.writeHead(200, { "content-type": "text/javascript" }); return r.end(bundle); }
  r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise((r) => srv.listen(0, r));
const BASE = `http://localhost:${srv.address().port}/`;
const CLIPPED = '#pl [aria-hidden="true"][style*="clip-path"]';
const fails = [], rows = [];
for (const [E, L] of [["chrome", () => chromium.launch({ executablePath: CHROME })], ["webkit", () => webkit.launch()]]) {
  const b = await L();
  const p = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
  p.on("pageerror", (e) => fails.push(`${E}: page error ${e.message}`));
  const shot = async (font, text, mode, frame) => {
    await p.goto(BASE + "?" + new URLSearchParams({ font, text, mode, frame: String(frame) }), { waitUntil: "domcontentloaded" });
    await p.evaluate(() => window.__ready);
    const ref = await p.locator("#ref").screenshot(), pl = await p.locator("#pl").screenshot(), clipped = await p.evaluate((s) => document.querySelectorAll(s).length, CLIPPED);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `${E}_${mode}_${frame}_${font}_${TEXTS.indexOf(text)}.png`), pl); }
    return { s: ink(pl, ref), clipped };
  };
  for (const font of FONTS) for (const text of TEXTS) {
    const at = await shot(font, text, "auto", 89), mid = await shot(font, text, "auto", 6);
    const row = { E, font, text, rest: at.s, clipped: at.clipped };
    if (E === "webkit") row.zwj = (await shot(font, text, "zwj", 89)).s;
    rows.push(row);
    const tag = `${E} ${font} «${text}»`;
    if (E === "webkit" && at.s < MIN) fails.push(`${tag}: at rest ${at.s.toFixed(3)} < ${MIN}`);
    if (E === "webkit" && (!at.clipped || !mid.clipped)) fails.push(`${tag}: WebKit did not use the clip method`);
    if (E === "chrome" && (at.clipped || mid.clipped)) fails.push(`${tag}: Chrome must keep ZWJ boxes`);
  }
  await b.close();
}
srv.close();
for (const E of ["chrome", "webkit"]) for (const k of E === "webkit" ? ["rest", "zwj"] : ["rest"]) {
  const rs = rows.filter((r) => r.E === E);
  console.log(`${E} ${k === "rest" ? (E === "webkit" ? "clip (auto)" : "zwj (auto, unchanged)") : "zwj forced"}: min ${Math.min(...rs.map((r) => r[k])).toFixed(3)}  ` + FONTS.map((f) => `${f.replace(/\.ttf$/, "")} ${Math.min(...rs.filter((r) => r.font === f).map((r) => r[k])).toFixed(3)}`).join(" · "));
}
if (args.includes("--json")) fs.writeFileSync(args[args.indexOf("--json") + 1], JSON.stringify(rows, null, 1));
for (const f of fails) console.log("✗ " + f);
if (fails.length) { console.log(`qa-player: ${fails.length} problem(s)`); process.exit(1); }
console.log(`qa-player: Remotion Player, ${FONTS.length} fonts × ${TEXTS.length} texts: WebKit clips and matches plain text (≥ ${MIN}), Chrome keeps ZWJ boxes ✓`);
