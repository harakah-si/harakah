#!/usr/bin/env node
// Visual guards for the static site (harakah.si), in a real Chrome and in WebKit with iPhone emulation (Safari's engine:
// its bidi and line layout are what iPhone users see, and Chrome alone passed code that iPhones drew scrambled). Builds
// site/ into a temp folder, serves it locally and fails (exit 1) when:
//   · any code sample (pre/code/.code/.term-out/.rj-code/.vt-code) computes direction:rtl, or its characters are out of
//     left-to-right order on a line (bidi scrambling), or an Arabic island in it swallowed code punctuation, or it
//     has ligatures on (coding fonts draw --> as an arrow and turn a comment's closing */ into /*)
//   · a fixed/sticky element covers text in the demo and code areas at sampled scroll positions (390×844)
//   · a page scrolls sideways at 360px or 390px wide
//   · the demo stage shows an Arabic word that isn't the Arabic in the code sample under it
//   · a demo code sample doesn't fit its box on a phone 360px or wider (lines would break mid-token or scroll)
//   · English prose with Arabic in it draws its own characters out of order (e.g. «…»: 12 flipping around the Arabic)
// Every demo tab × before/after state is checked on the Arabic and English landing; /tool/ in both languages and 404 too.
//
//   npm run qa:visual                        guards only
//   node scripts/qa-visual.mjs --shots DIR   also write the screenshot matrix (pages × viewports × states × scroll)
//   node scripts/qa-visual.mjs --site DIR    check an already built site/ instead of building one
//   node scripts/qa-visual.mjs --no-webkit   Chrome only (--no-chrome: WebKit only)
// Needs Chrome (HARAKAH_CHROME=… or auto-detected, same as the renderer), a built dist/ (npm run build) and Playwright's
// WebKit (npx playwright-core install --with-deps webkit). Linux WebKit draws ZWJ-padded letters as tofu with fonts that
// don't map U+200D (Alexandria), which iOS doesn't: the screenshots stand in a ZWJ-mapped copy of it (QA only, see zwjFont).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { CHROME } from "../dist/render.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const SHOTS = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : "";
// --site DIR checks an already built site/ (e.g. an older build, to see the guards catch what they should)
const PREBUILT = args.includes("--site") ? path.resolve(args[args.indexOf("--site") + 1]) : "";
const SITE = PREBUILT || fs.mkdtempSync(path.join(os.tmpdir(), "hz-qa-site-"));
if (!PREBUILT) execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-static.mjs")], { env: { ...process.env, HARAKAH_SITE_OUT: SITE, SITE_ORIGIN: "" }, stdio: "ignore" });

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf", ".mp4": "video/mp4", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const server = http.createServer((q, s) => {
  let f = path.join(SITE, decodeURIComponent(new URL(q.url, "http://x").pathname));
  if (!f.startsWith(SITE)) { s.writeHead(403); return s.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { s.writeHead(404, { "content-type": TYPES[".html"] }); return s.end(fs.readFileSync(path.join(SITE, "404.html"))); }
  s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const t0 = Date.now(), lap = (s) => console.log(`· ${s} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const fail = (where, msg) => { fails.push(`${where}: ${msg}`); console.error(`✗ ${where}: ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  { id: "ar", url: "/", landing: true },
  { id: "en", url: "/en/", landing: true },
  { id: "tool-en", url: "/tool/" },
  { id: "tool-ar", url: "/tool/?lang=ar" },
  { id: "404", url: "/no-such-page" },
];
const TABS = ["HTML", "GSAP", "HyperFrames", "Remotion"];

// one small driver per engine: open(url, viewport, theme), ev(fn, arg), shot(file)
async function chromeDriver() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => fail("js chrome", e.message));
  return {
    name: "chrome",
    async open(url, vp, theme = "dark") {
      await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: vp[2] ?? 1, isMobile: vp[0] < 800, hasTouch: vp[0] < 800 });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await page.goto(BASE + url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await sleep(300);
    },
    ev: (fn, arg) => page.evaluate(fn, arg),
    shot: (file) => page.screenshot({ path: file }),
    close: () => browser.close(),
  };
}
// Linux WebKit only: Alexandria has no cmap entry for U+200D, and WebKitGTK/WPE then draws each ZWJ-padded letter box as
// tofu (iOS CoreText and Chrome join them). For screenshots, serve a copy whose cmap also maps ZWJ/ZWNJ to the font's
// empty zero-width glyph (uni200B): the best cmap subtable is rewritten as one format-12 table appended to the file. The
// shipped font is untouched.
function zwjFont(buf) {
  const u16 = (o) => buf.readUInt16BE(o), u32 = (o) => buf.readUInt32BE(o);
  const T = {}; for (let i = 0; i < u16(4); i++) { const r = 12 + i * 16; T[buf.toString("latin1", r, r + 4)] = { rec: r, off: u32(r + 8), len: u32(r + 12) }; }
  const { post, cmap } = T; if (!post || !cmap || u32(post.off) !== 0x20000) return buf;
  const ng = u16(post.off + 32), names = []; // post v2 glyph names → glyph id of uni200B
  for (let p = post.off + 34 + ng * 2; p < post.off + post.len; p += 1 + buf[p]) names.push(buf.toString("latin1", p + 1, p + 1 + buf[p]));
  let zw = -1; for (let g = 0; g < ng && zw < 0; g++) if (names[u16(post.off + 34 + g * 2) - 258] === "uni200B") zw = g;
  if (zw < 0) return buf;
  const recs = [...Array(u16(cmap.off + 2))].map((_, i) => ({ pid: u16(cmap.off + 4 + i * 8), eid: u16(cmap.off + 6 + i * 8), off: u32(cmap.off + 8 + i * 8) }));
  const best = recs.find((r) => r.pid === 3 && r.eid === 10) || recs.find((r) => r.pid === 3 && r.eid === 1); if (!best) return buf;
  const map = new Map(), b = cmap.off + best.off;
  if (u16(b) === 4) {
    const n = u16(b + 6) / 2, E = b + 14, S = E + n * 2 + 2, D = S + n * 2, R = D + n * 2;
    for (let i = 0; i < n; i++) for (let c = u16(S + i * 2); c <= u16(E + i * 2) && c !== 0xffff; c++) {
      const ro = u16(R + i * 2), gi = ro ? u16(R + i * 2 + ro + (c - u16(S + i * 2)) * 2) : c, g = gi ? (gi + u16(D + i * 2)) & 0xffff : 0;
      if (g) map.set(c, g);
    }
  } else if (u16(b) === 12) { for (let i = 0; i < u32(b + 12); i++) { const o = b + 16 + i * 12; for (let c = u32(o); c <= u32(o + 4); c++) map.set(c, u32(o + 8) + c - u32(o)); } }
  else return buf;
  map.set(0x200c, zw); map.set(0x200d, zw);
  const groups = []; for (const c of [...map.keys()].sort((x, y) => x - y)) { const g = map.get(c), l = groups.at(-1); if (l && c === l[1] + 1 && g === l[2] + c - l[0]) l[1] = c; else groups.push([c, c, g]); }
  const t = Buffer.alloc(12 + 16 + groups.length * 12); // cmap header + one (3,10) record, then the format-12 subtable
  t.writeUInt16BE(1, 2); t.writeUInt16BE(3, 4); t.writeUInt16BE(10, 6); t.writeUInt32BE(12, 8);
  t.writeUInt16BE(12, 12); t.writeUInt32BE(16 + groups.length * 12, 16); t.writeUInt32BE(groups.length, 24);
  groups.forEach(([x, y, g], i) => { t.writeUInt32BE(x, 28 + i * 12); t.writeUInt32BE(y, 32 + i * 12); t.writeUInt32BE(g, 36 + i * 12); });
  const at = Math.ceil(buf.length / 4) * 4, out = Buffer.concat([buf, Buffer.alloc(at - buf.length), t, Buffer.alloc((4 - (t.length % 4)) % 4)]);
  out.writeUInt32BE(at, cmap.rec + 8); out.writeUInt32BE(t.length, cmap.rec + 12);
  return out;
}
async function webkitDriver() {
  let webkit, devices;
  try { ({ webkit, devices } = await import("playwright-core")); } catch { throw new Error("WebKit pass needs playwright-core (npm ci) and its WebKit (npx playwright-core install --with-deps webkit), or run with --no-webkit"); }
  const browser = await webkit.launch();
  const UA = devices["iPhone 15"].userAgent, font = zwjFont(fs.readFileSync(path.join(SITE, "fonts", "Alexandria.ttf")));
  let ctx = null, page = null;
  return {
    name: "webkit",
    async open(url, vp, theme = "dark") {
      await ctx?.close(); // a fresh context: clean storage, the viewport and theme of this run
      const mobile = vp[0] < 800;
      ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: vp[2] ?? (mobile ? 3 : 2), isMobile: mobile, hasTouch: mobile, colorScheme: theme, ...(mobile ? { userAgent: UA } : {}) });
      if (SHOTS) await ctx.route("**/fonts/Alexandria.ttf", (r) => r.fulfill({ body: font, contentType: "font/ttf" }));
      page = await ctx.newPage();
      page.on("pageerror", (e) => fail("js webkit", e.message));
      await page.goto(BASE + url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await sleep(300);
    },
    ev: (fn, arg) => page.evaluate(fn, arg),
    shot: (file) => page.screenshot({ path: file }),
    close: () => browser.close(),
  };
}
// tab + state through the real UI (clicks), then wait out the view transition
// (WebKit runs view transitions slower headless: until they finish, hit tests land on the transition overlay)
const demoState = (d, tab, fixed) => d.ev(async ([tab, fixed]) => {
  const settle = async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    const vt = document.getAnimations().filter((a) => String(a.effect?.pseudoElement || "").startsWith("::view-transition"));
    await Promise.race([Promise.all(vt.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 4000))]);
  };
  document.querySelector(`#vt-tab-${tab}`).click();
  await settle(450);
  if ((document.querySelector("#vt-flip").getAttribute("aria-pressed") === "true") !== fixed) document.querySelector("#vt-flip").click();
  await settle(600);
}, [tab, fixed]);

// ---- in-page checks ----
const codeChecks = () => {
  const out = [];
  const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  for (const el of document.querySelectorAll("pre, code, .code, .term-out, .rj-code, .vt-code")) {
    if (!el.getClientRects().length) continue; // hidden (other language)
    const name = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className || ""}`;
    if (getComputedStyle(el).direction !== "ltr") out.push(`${name} has direction ${getComputedStyle(el).direction}`);
    const cs = getComputedStyle(el); // coding fonts would otherwise draw --> as an arrow and */ as /*
    if (cs.fontVariantLigatures !== "none" || !/"calt" 0/.test(cs.fontFeatureSettings)) out.push(`${name} has programming ligatures on (${cs.fontVariantLigatures} | ${cs.fontFeatureSettings})`);
    for (const b of el.querySelectorAll("bdi[dir=rtl]")) if (/[<>="=;(){}\[\]\n]/.test(b.textContent)) out.push(`${name}: Arabic island swallowed code: ${JSON.stringify(b.textContent.slice(0, 60))}`);
    // visual order: every non-Arabic character on a line sits to the right of the one before it
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let prev = null, n;
    const r = document.createRange();
    while ((n = w.nextNode())) {
      const t = n.textContent;
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i]) || AR.test(t[i])) continue;
        r.setStart(n, i); r.setEnd(n, i + 1);
        const rc = [...r.getClientRects()].filter((x) => x.width > 0)[0]; if (!rc) continue;
        if (prev && Math.abs(rc.top - prev.top) < 3 && rc.left < prev.left - 0.5) { out.push(`${name}: ${JSON.stringify(t[i])} drawn left of ${JSON.stringify(prev.ch)} on line "${t.slice(Math.max(0, i - 20), i + 10).replace(/\n/g, "⏎")}"`); break; }
        prev = { top: rc.top, left: rc.left, ch: t[i] };
      }
    }
  }
  return out;
};
const wordCheck = () => {
  const view = document.querySelector("#vt-view"), code = document.querySelector("#vt-code");
  const word = view?.dataset.word || "";
  const runs = [...code.textContent.matchAll(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[ \u00A0]+[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g)].map((m) => m[0]);
  const shown = (view.querySelector(".vt-word") ? view.querySelector(".vt-word").textContent : word).replace(/[\u200C\u200D]/g, ""); // the fixed word carries ZWJ padding
  const out = [];
  if (!word) out.push("stage has no data-word");
  if (shown !== word) out.push(`stage shows ${JSON.stringify(shown)} but data-word is ${JSON.stringify(word)}`);
  if (!runs.includes(word)) out.push(`code never mentions the stage word ${JSON.stringify(word)} (Arabic in code: ${JSON.stringify(runs)})`);
  for (const r of runs) if (r !== word && r !== "لا" && !word.includes(r)) out.push(`code has Arabic ${JSON.stringify(r)} that isn't the stage word ${JSON.stringify(word)}`);
  return out;
};
const overflow = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
// text in the demo/code areas that a fixed or sticky element (not its own container) is drawn over
const occlusion = () => {
  const AREAS = "#vt-panel, #vt-code, .vt-top, .reel, .pv, .term, .rj-code, .rj-head, .cta .cmd";
  const floats = [...document.querySelectorAll("body *")].filter((e) => { const p = getComputedStyle(e).position; return (p === "fixed" || p === "sticky") && e.getClientRects().length; });
  const bars = floats.filter((e) => { const r = e.getBoundingClientRect(); return r.top <= 1 && r.width >= innerWidth - 2 && r.height < innerHeight * 0.25; }); // top bars: what's under them is scrolled away
  const barBottom = Math.max(0, ...bars.map((e) => e.getBoundingClientRect().bottom));
  const out = [];
  for (const area of document.querySelectorAll(AREAS)) {
    const ar = area.getBoundingClientRect(); if (ar.bottom < 0 || ar.top > innerHeight || !ar.height) continue;
    const w = document.createTreeWalker(area, NodeFilter.SHOW_TEXT); let n; const r = document.createRange();
    while ((n = w.nextNode())) {
      if (!n.textContent.trim() || !n.parentElement.getClientRects().length) continue;
      r.selectNodeContents(n);
      for (const rc of r.getClientRects()) {
        if (rc.width < 2) continue;
        for (const [fx, fy] of [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]]) {
          const x = rc.left + rc.width * fx, y = rc.top + rc.height * fy;
          if (y <= barBottom + 1 || y >= innerHeight - 1 || x < 0 || x > innerWidth) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit || n.parentElement.contains(hit) || hit.contains(n.parentElement)) continue;
          const f = floats.find((e) => e.contains(hit) && !e.contains(n.parentElement));
          const op = parseFloat(getComputedStyle(n.parentElement).opacity);
          if (f && op > 0) { out.push(`${f.tagName.toLowerCase()}${f.id ? "#" + f.id : ""}.${f.className} covers "${n.textContent.trim().slice(0, 40)}" at y=${Math.round(y)}`); break; }
        }
      }
    }
  }
  return [...new Set(out)];
};

// demo code samples fit their box (no sideways scroll inside it): checked from 360px up
const codeFit = () => [...document.querySelectorAll(".vt-code")].filter((el) => el.getClientRects().length && el.scrollWidth - el.clientWidth > 1)
  .map((el) => `#${el.id} is ${el.scrollWidth - el.clientWidth}px wider than its box: "${[...el.textContent.split("\n")].sort((a, b) => b.length - a.length)[0].trim().slice(0, 50)}"`);
// English prose with Arabic in it: the non-Arabic characters of a line keep their left-to-right order
const proseOrder = () => {
  const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/, out = [];
  if (document.documentElement.dir === "rtl") return out;
  for (const el of document.querySelectorAll("p, li, h1, h2, h3, small, figcaption, td, .vt-note")) {
    if (!el.getClientRects().length || !AR.test(el.textContent) || el.closest("pre, code, [dir=rtl], .keep")) continue;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest("[dir=rtl], .keep, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let prev = null, n; const r = document.createRange();
    while ((n = w.nextNode())) {
      const t = n.textContent;
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i]) || AR.test(t[i])) continue;
        r.setStart(n, i); r.setEnd(n, i + 1);
        const rc = [...r.getClientRects()].filter((x) => x.width > 0)[0]; if (!rc) continue;
        if (prev && Math.abs(rc.top - prev.top) < 3 && rc.left < prev.left - 0.5) { out.push(`"${el.textContent.trim().slice(0, 70)}": ${JSON.stringify(t[i])} drawn left of ${JSON.stringify(prev.ch)}`); prev = null; break; }
        prev = { top: rc.top, left: rc.left, ch: t[i] };
      }
    }
  }
  return out;
};

// Chrome: phone + desktop and the full screenshot matrix. WebKit (Safari's engine) with iPhone emulation: iPhone SE,
// 15 and 15 Pro Max widths, the same guards, and its own screenshots of every demo state and the proof card.
const IPHONES = [[375, 667, 2], [393, 852, 3], [430, 932, 3]];
const RUNS = args.includes("--no-chrome") ? [] : [{ make: chromeDriver, code: [[390, 844], [1280, 800]], occ: [[390, 844], [360, 780]], over: [[360, 780], [390, 844]] }];
if (!args.includes("--no-webkit")) RUNS.push({ make: webkitDriver, code: [...IPHONES, [1280, 800]], occ: [[393, 852, 3]], over: IPHONES });

for (const R of RUNS) {
  const d = await R.make(), E = d.name;
  // 1 + 4 + 5: code direction / order / fit and stage word, every page, every demo state
  for (const vp of R.code) {
    for (const P of PAGES) {
      await d.open(P.url, vp);
      for (const m of await d.ev(codeChecks)) fail(`${E} ${P.id} ${vp[0]}px`, m);
      for (const m of await d.ev(proseOrder)) fail(`${E} ${P.id} ${vp[0]}px prose`, m);
      if (!P.landing) continue;
      for (const tab of TABS) for (const fixed of [false, true]) {
        await demoState(d, tab, fixed);
        const where = `${E} ${P.id} ${vp[0]}px ${tab} ${fixed ? "after" : "before"}`;
        for (const m of await d.ev(codeChecks)) fail(where, m);
        for (const m of await d.ev(wordCheck)) fail(where, m);
        if (vp[0] >= 360) for (const m of await d.ev(codeFit)) fail(where, m);
      }
    }
  }
  lap(`${E}: code direction/order/fit + stage words + prose order`);
  // 2: floating UI over demo/code text, scrolled through the whole landing on a phone. First prove the probe works:
  // a pill pinned over the code box (like the one the user saw) has to be reported.
  {
    await d.open("/", R.occ[0]); await demoState(d, "HyperFrames", true);
    const caught = await d.ev((occ) => {
      document.querySelector("#vt-code").scrollIntoView({ block: "center", behavior: "instant" });
      const pill = Object.assign(document.createElement("div"), { textContent: "pill" });
      pill.style.cssText = "position:fixed;left:120px;bottom:40%;width:150px;height:48px;background:#333;z-index:99";
      document.body.append(pill); const r = (0, eval)(`(${occ})`)(); pill.remove(); return r.length;
    }, occlusion.toString());
    if (!caught) fail(`${E} self-test`, "a fixed pill over the code box was not detected: the occlusion probe is broken");
  }
  for (const P of PAGES.filter((p) => p.landing)) for (const vp of R.occ) {
    await d.open(P.url, vp);
    for (const state of [["Remotion", false], ["HyperFrames", true], ["GSAP", true]]) {
      await demoState(d, ...state);
      const H = await d.ev(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += Math.round(vp[1] * 0.4)) {
        await d.ev((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await sleep(40);
        for (const m of await d.ev(occlusion)) fail(`${E} ${P.id} ${vp[0]}px ${state.join("/")} scrollY=${y}`, m);
      }
    }
  }
  lap(`${E}: floating UI over demo/code text`);
  // 3: no sideways scrolling on narrow phones, in every page and demo state
  for (const vp of R.over) for (const P of PAGES) {
    await d.open(P.url, vp);
    let o = await d.ev(overflow); if (o > 1) fail(`${E} ${P.id} ${vp[0]}px`, `page scrolls sideways by ${o}px`);
    if (P.landing) for (const tab of TABS) for (const fixed of [false, true]) {
      await demoState(d, tab, fixed);
      o = await d.ev(overflow); if (o > 1) fail(`${E} ${P.id} ${vp[0]}px ${tab} ${fixed ? "after" : "before"}`, `page scrolls sideways by ${o}px`);
    }
  }
  lap(`${E}: horizontal overflow`);

  // ---- screenshots (for a human/agent to look at) ----
  if (SHOTS && E === "chrome") await chromeShots(d);
  if (SHOTS && E === "webkit") await webkitShots(d);
  await d.close();
}

async function chromeShots(d) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const VPS = [[360, 780], [390, 844], [768, 1024], [1280, 800], [1440, 900]];
  const shot = (name) => d.shot(path.join(SHOTS, `${name}.png`));
  for (const vp of VPS) for (const P of PAGES) for (const theme of ["dark", "light"]) {
    if (theme === "light" && vp[0] !== 390) continue; // light theme: one phone width is enough
    await d.open(P.url, vp, theme);
    const tag = `${P.id}_${vp[0]}_${theme}`;
    const H = await d.ev(() => document.documentElement.scrollHeight);
    let k = 0;
    for (let y = 0; ; y += Math.round(vp[1] * 0.75)) {
      const yy = Math.min(y, H - vp[1]);
      await d.ev((y) => window.scrollTo({ top: y, behavior: "instant" }), yy); await sleep(450);
      await shot(`${tag}_scroll${String(k++).padStart(2, "0")}`);
      if (yy >= H - vp[1]) break;
    }
    if (!P.landing) continue;
    for (const tab of TABS) for (const fixed of [false, true]) {
      await demoState(d, tab, fixed);
      // the tab bar + stage, then the code box stepped down to its bottom (catches anything floating over it)
      const top = await d.ev(() => document.querySelector(".vt-top").getBoundingClientRect().top + scrollY - 90);
      const bottom = await d.ev(() => document.querySelector("#vt-panel").getBoundingClientRect().bottom + scrollY);
      let j = 0;
      for (let y = top; ; y += Math.round(vp[1] * 0.75)) {
        await d.ev((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await sleep(250);
        await shot(`${tag}_demo-${tab}-${fixed ? "after" : "before"}_${j++}`);
        if (y + vp[1] >= bottom) break;
      }
    }
    // other toggles: language and theme switch from the nav, digits from the footer
    if (vp[0] === 390 && theme === "dark") {
      await d.ev(() => { window.scrollTo({ top: 0, behavior: "instant" }); document.querySelector('#digits [data-v="western"]').click(); });
      await d.ev(() => document.querySelector("#how .pv").scrollIntoView({ block: "center", behavior: "instant" })); await sleep(500);
      await shot(`${tag}_toggle-digits-western_card`);
      await d.ev(() => { document.querySelector('#digits [data-v="eastern"]').click(); window.scrollTo({ top: 0, behavior: "instant" }); }); await sleep(300);
      await d.ev((l) => document.querySelector(`#lang [data-v="${l}"]`).click(), P.id === "ar" ? "en" : "ar"); await sleep(400);
      await shot(`${tag}_toggle-lang-switched_top`);
    }
  }
}
// WebKit/iPhone: each demo state with its code box just under the nav, and the proof card before and after the compare step
async function webkitShots(d) {
  const dir = path.join(SHOTS, "webkit"); fs.mkdirSync(dir, { recursive: true });
  for (const vp of IPHONES) for (const P of PAGES) {
    await d.open(P.url, vp);
    const tag = `${P.id}_${vp[0]}`;
    if (!P.landing) { await d.shot(path.join(dir, `${tag}_top.png`)); continue; }
    for (const tab of TABS) for (const fixed of [false, true]) {
      await demoState(d, tab, fixed);
      await d.ev(() => { const nav = document.querySelector("header, nav"), hb = nav ? nav.getBoundingClientRect().bottom : 0; window.scrollTo({ top: document.querySelector("#vt-panel").getBoundingClientRect().top + scrollY - hb - 8, behavior: "instant" }); }); await sleep(300);
      await d.shot(path.join(dir, `${tag}_demo-${tab}-${fixed ? "after" : "before"}.png`));
    }
    await d.ev(() => document.querySelector('.hstep[data-step="0"]').scrollIntoView({ block: "center", behavior: "instant" })); await sleep(1500);
    await d.shot(path.join(dir, `${tag}_card-start.png`));
    await d.ev(() => document.querySelector('.hstep[data-step="2"]').scrollIntoView({ block: "end", behavior: "instant" })); await sleep(6000);
    await d.shot(path.join(dir, `${tag}_card-compared.png`));
  }
}
if (SHOTS) console.log(`screenshots → ${SHOTS}`);

server.close(); if (!PREBUILT) fs.rmSync(SITE, { recursive: true, force: true });
if (fails.length) { console.error(`\nqa-visual: ${fails.length} problem(s)`); process.exit(1); }
console.log(`qa-visual (${RUNS.map((r) => (r.make === chromeDriver ? "Chrome" : "WebKit/iPhone")).join(" + ")}): code reads left to right and fits on phones, stage words match their code, English prose keeps its order around Arabic, nothing floats over demo text, no sideways scroll ✓`);
