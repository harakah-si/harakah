#!/usr/bin/env node
// Visual guards for the static site (harakah.si), in a real Chrome. Builds site/ into a temp folder, serves it locally
// and fails (exit 1) when:
//   · any code sample (pre/code/.code/.term-out/.rj-code/.vt-code) computes direction:rtl, or its characters are out of
//     left-to-right order on a line (bidi scrambling), or an Arabic island in it swallowed code punctuation, or it
//     has ligatures on (coding fonts draw --> as an arrow and turn a comment's closing */ into /*)
//   · a fixed/sticky element covers text in the demo and code areas at sampled scroll positions (390×844)
//   · a page scrolls sideways at 360px or 390px wide
//   · the demo stage shows an Arabic word that isn't the Arabic in the code sample under it
// Every demo tab × before/after state is checked on the Arabic and English landing; /tool/ in both languages and 404 too.
//
//   npm run qa:visual                        guards only
//   node scripts/qa-visual.mjs --shots DIR   also write the screenshot matrix (pages × viewports × states × scroll)
//   node scripts/qa-visual.mjs --site DIR    check an already built site/ instead of building one
// Needs Chrome (HARAKAH_CHROME=… or auto-detected, same as the renderer) and a built dist/ (npm run build).
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });

const PAGES = [
  { id: "ar", url: "/", landing: true },
  { id: "en", url: "/en/", landing: true },
  { id: "tool-en", url: "/tool/" },
  { id: "tool-ar", url: "/tool/?lang=ar" },
  { id: "404", url: "/no-such-page" },
];
const TABS = ["HTML", "GSAP", "HyperFrames", "Remotion"];

async function open(page, url, vp, theme = "dark") {
  await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: vp[2] ?? 1, isMobile: vp[0] < 800, hasTouch: vp[0] < 800 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(BASE + url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
}
// tab + state through the real UI (clicks), then wait out the view transition
async function demoState(page, tab, fixed) {
  await page.evaluate(async (tab, fixed) => {
    document.querySelector(`#vt-tab-${tab}`).click();
    await new Promise((r) => setTimeout(r, 450));
    if ((document.querySelector("#vt-flip").getAttribute("aria-pressed") === "true") !== fixed) document.querySelector("#vt-flip").click();
    await new Promise((r) => setTimeout(r, 600));
  }, tab, fixed);
}

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

const page = await browser.newPage();
page.on("pageerror", (e) => fail("js", e.message));

// 1 + 4: code direction / order and stage word, every page, every demo state, phone and desktop
for (const vp of [[390, 844], [1280, 800]]) {
  for (const P of PAGES) {
    await open(page, P.url, vp);
    for (const m of await page.evaluate(codeChecks)) fail(`${P.id} ${vp[0]}px`, m);
    if (!P.landing) continue;
    for (const tab of TABS) for (const fixed of [false, true]) {
      await demoState(page, tab, fixed);
      const where = `${P.id} ${vp[0]}px ${tab} ${fixed ? "after" : "before"}`;
      for (const m of await page.evaluate(codeChecks)) fail(where, m);
      for (const m of await page.evaluate(wordCheck)) fail(where, m);
    }
  }
}
lap("code direction/order + stage words");
// 2: floating UI over demo/code text, scrolled through the whole landing on a phone. First prove the probe works:
// a pill pinned over the code box (like the one the user saw) has to be reported.
{
  await open(page, "/", [390, 844]); await demoState(page, "HyperFrames", true);
  const caught = await page.evaluate((occ) => {
    document.querySelector("#vt-code").scrollIntoView({ block: "center", behavior: "instant" });
    const pill = Object.assign(document.createElement("div"), { textContent: "pill" });
    pill.style.cssText = "position:fixed;left:120px;bottom:40%;width:150px;height:48px;background:#333;z-index:99";
    document.body.append(pill); const r = (0, eval)(`(${occ})`)(); pill.remove(); return r.length;
  }, occlusion.toString());
  if (!caught) fail("self-test", "a fixed pill over the code box was not detected: the occlusion probe is broken");
}
for (const P of PAGES.filter((p) => p.landing)) for (const vp of [[390, 844], [360, 780]]) {
  await open(page, P.url, vp);
  for (const state of [["Remotion", false], ["HyperFrames", true], ["GSAP", true]]) {
    await demoState(page, ...state);
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += Math.round(vp[1] * 0.4)) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await sleep(40);
      for (const m of await page.evaluate(occlusion)) fail(`${P.id} ${vp[0]}px ${state.join("/")} scrollY=${y}`, m);
    }
  }
}
lap("floating UI over demo/code text");
// 3: no sideways scrolling on narrow phones, in every page and demo state
for (const vp of [[360, 780], [390, 844]]) for (const P of PAGES) {
  await open(page, P.url, vp);
  let o = await page.evaluate(overflow); if (o > 1) fail(`${P.id} ${vp[0]}px`, `page scrolls sideways by ${o}px`);
  if (P.landing) for (const tab of TABS) for (const fixed of [false, true]) {
    await demoState(page, tab, fixed);
    o = await page.evaluate(overflow); if (o > 1) fail(`${P.id} ${vp[0]}px ${tab} ${fixed ? "after" : "before"}`, `page scrolls sideways by ${o}px`);
  }
}

lap("horizontal overflow");
// ---- screenshot matrix (for a human/agent to look at) ----
if (SHOTS) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const VPS = [[360, 780], [390, 844], [768, 1024], [1280, 800], [1440, 900]];
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  for (const vp of VPS) for (const P of PAGES) for (const theme of ["dark", "light"]) {
    if (theme === "light" && vp[0] !== 390) continue; // light theme: one phone width is enough
    await open(page, P.url, vp, theme);
    const tag = `${P.id}_${vp[0]}_${theme}`;
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    let k = 0;
    for (let y = 0; ; y += Math.round(vp[1] * 0.75)) {
      const yy = Math.min(y, H - vp[1]);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), yy); await sleep(450);
      await shot(`${tag}_scroll${String(k++).padStart(2, "0")}`);
      if (yy >= H - vp[1]) break;
    }
    if (!P.landing) continue;
    for (const tab of TABS) for (const fixed of [false, true]) {
      await demoState(page, tab, fixed);
      // the tab bar + stage, then the code box stepped down to its bottom (catches anything floating over it)
      const top = await page.evaluate(() => document.querySelector(".vt-top").getBoundingClientRect().top + scrollY - 90);
      const bottom = await page.evaluate(() => document.querySelector("#vt-panel").getBoundingClientRect().bottom + scrollY);
      let j = 0;
      for (let y = top; ; y += Math.round(vp[1] * 0.75)) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await sleep(250);
        await shot(`${tag}_demo-${tab}-${fixed ? "after" : "before"}_${j++}`);
        if (y + vp[1] >= bottom) break;
      }
    }
    // other toggles: language and theme switch from the nav, digits from the footer
    if (vp[0] === 390 && theme === "dark") {
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); document.querySelector('#digits [data-v="western"]').click(); });
      await page.evaluate(() => document.querySelector("#how .pv").scrollIntoView({ block: "center", behavior: "instant" })); await sleep(500);
      await shot(`${tag}_toggle-digits-western_card`);
      await page.evaluate(() => { document.querySelector('#digits [data-v="eastern"]').click(); window.scrollTo({ top: 0, behavior: "instant" }); }); await sleep(300);
      await page.evaluate((l) => document.querySelector(`#lang [data-v="${l}"]`).click(), P.id === "ar" ? "en" : "ar"); await sleep(400);
      await shot(`${tag}_toggle-lang-switched_top`);
    }
  }
  console.log(`screenshots → ${SHOTS} (${fs.readdirSync(SHOTS).filter((f) => f.endsWith(".png")).length})`);
}

await browser.close(); server.close(); if (!PREBUILT) fs.rmSync(SITE, { recursive: true, force: true });
if (fails.length) { console.error(`\nqa-visual: ${fails.length} problem(s)`); process.exit(1); }
console.log("qa-visual: code reads left to right, stage words match their code, nothing floats over demo text, no sideways scroll ✓");
