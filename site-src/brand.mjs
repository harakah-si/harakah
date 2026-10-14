// Icons and social share images in the Mosaic palette, rendered in Chrome from palettes.mjs and the bundled OFL fonts.
// Writes web/assets/{og-ar,og-en,icon-192,icon-512,apple-touch-icon,favicon-32}.png and favicon.ico.
//   npm run build && node site-src/brand.mjs
// test/consistency.test.ts checks the committed images still use the palette, so rerun this after a palette change.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { P } from "./palettes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, "..");
const OUT = path.join(ROOT, "web", "assets"), FONTS = pathToFileURL(path.join(ROOT, "assets", "fonts")).href;
const { launch } = await import(pathToFileURL(path.join(ROOT, "dist", "render.js")).href);
const t = P.mosaic.dark;

const head = `<meta charset="utf-8"><style>
@font-face{font-family:Alexandria;src:url("${FONTS}/Alexandria.ttf");font-weight:100 900}
@font-face{font-family:Plex;src:url("${FONTS}/IBMPlexSansArabic-Regular.ttf");font-weight:400}
@font-face{font-family:Plex;src:url("${FONTS}/IBMPlexSansArabic-SemiBold.ttf");font-weight:600}
*{box-sizing:border-box}html,body{margin:0}
body{background:${t.bg};color:${t.ink};font-family:Plex,sans-serif;overflow:hidden}
.tiles{position:absolute;inset-inline:0;height:10px;background:repeating-linear-gradient(90deg,${t.acc3} 0 9px,transparent 9px 12px,${t.acc2} 12px 21px,transparent 21px 24px,${t.acc} 24px 33px,transparent 33px 36px);opacity:.7}
</style>`;

// the word that shows the problem: letters drawn one by one (isolated, left to right) next to the joined word
const WORD = "الحكايات";
const broken = [...WORD].map((c) => `<span>${c}</span>`).join("");

function og(lang) {
  const ar = lang === "ar";
  const h1 = ar ? "حرّك العنوان،<br>والحروف تبقى <em>متصلة.</em>" : "Animate Arabic titles.<br>Keep the letters <em lang=\"ar\">متصلة.</em>";
  const sub = ar ? "تكشف وتصلح النص العربي في كود الموشن قبل الرندر: <bdi>HTML</bdi> و<bdi>GSAP</bdi> و<bdi>HyperFrames</bdi> و<bdi>Remotion</bdi>."
    : "Finds and fixes Arabic text in motion code before you render: HTML, GSAP, HyperFrames, Remotion.";
  return `<!doctype html><html lang="${lang}" dir="${ar ? "rtl" : "ltr"}"><head>${head}<style>
body{width:1200px;height:630px;position:relative;padding:64px 64px 0;
  background:radial-gradient(60% 70% at ${ar ? "12%" : "88%"} 8%,${t.acc3}88,transparent 70%),radial-gradient(40% 50% at ${ar ? "90%" : "10%"} 110%,${t.acc}22,transparent 70%),${t.bg}}
.tiles{top:0}
.top{display:flex;justify-content:space-between;align-items:center}
.logo{display:flex;align-items:center;gap:14px;font:800 46px/1 Alexandria}
.logo i{width:15px;height:15px;border-radius:2px;background:${t.acc};transform:translateY(-10px) rotate(9deg)}
.tag{font:500 17px/1 ui-monospace,"DejaVu Sans Mono",monospace;letter-spacing:.14em;color:${t.mute};direction:ltr}
h1{margin:${ar ? "44px" : "62px"} 0 0;font:800 ${ar ? "82px/1.3" : "80px/1.08"} Alexandria;letter-spacing:${ar ? "0" : "-.02em"}}
h1 em{font-style:normal;color:${t.acc};letter-spacing:0}
.foot{position:absolute;inset-inline:64px;bottom:58px;display:flex;justify-content:space-between;align-items:flex-end;gap:40px}
.foot p{margin:0;flex:0 0 ${ar ? "410px" : "390px"};font-size:${ar ? "22px" : "20px"};line-height:1.6;color:${t.mute}}
.demo{display:flex;align-items:center;gap:18px;direction:ltr;font:800 50px/1 Alexandria;flex:0 1 auto;min-width:0}
.broken{display:flex;gap:4px;color:transparent;-webkit-text-stroke:1.5px ${t.mute}}
.arrow{color:${t.acc};font:400 40px/1 Plex}
.joined{direction:rtl;color:${t.ink}}
</style></head><body><div class="tiles"></div>
<div class="top"><div class="logo"><span>حركة</span><i></i></div><div class="tag">HARAKAH · ARABIC MOTION FIXER</div></div>
<h1>${h1}</h1>
<div class="foot"><p>${sub}</p><div class="demo"><div class="broken">${broken}</div><span class="arrow">→</span><span class="joined">${WORD}</span></div></div>
</body></html>`;
}

// app icon: the gold ح on the dark green tile
const icon = (size, { rounded = true } = {}) => `<!doctype html><html><head>${head}<style>
html,body{background:transparent}
.i{width:${size}px;height:${size}px;position:relative;overflow:hidden;background:${t.bg};border-radius:${rounded ? size * 0.22 : 0}px;display:grid;place-items:center}
.i b{font:800 ${size * 0.6}px/1 Alexandria;color:${t.acc};transform:translate(${size * 0.01}px,${-size * 0.17}px)}
</style></head><body><div class="i"><b>ح</b></div></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hz-brand-"));
const browser = await launch();
async function shot(html, w, h, transparent = false) {
  const f = path.join(tmp, `p${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(f, html);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(f).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    return Buffer.from(await page.screenshot({ type: "png", omitBackground: transparent }));
  } finally { await page.close(); }
}
// favicon.ico holding PNG images (every current browser reads PNG-in-ICO)
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12); off += png.length;
  });
  return Buffer.concat([head, ...pngs.map(([, p]) => p)]);
}
try {
  const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(name, (buf.length / 1024).toFixed(1) + " KB"); };
  for (const lang of ["ar", "en"]) write(`og-${lang}.png`, await shot(og(lang), 1200, 630));
  write("icon-512.png", await shot(icon(512), 512, 512, true));
  write("icon-192.png", await shot(icon(192), 192, 192, true));
  write("apple-touch-icon.png", await shot(icon(180, { rounded: false }), 180, 180));
  const f32 = await shot(icon(32), 32, 32, true);
  write("favicon-32.png", f32);
  write("favicon.ico", ico([[16, await shot(icon(16), 16, 16, true)], [32, f32], [48, await shot(icon(48), 48, 48, true)]]));
} finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
