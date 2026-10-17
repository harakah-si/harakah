#!/usr/bin/env node
// Visual guards for the static site (harakah.si), in a real Chrome and in WebKit with iPhone emulation (Safari's engine:
// its bidi and line layout are what iPhone users see, and Chrome alone passed code that iPhones drew scrambled). Builds
// site/ into a temp folder, serves it locally and fails (exit 1) when:
//   · any code sample (pre/code/.code/.term-out/.rj-code/.vt-code) computes direction:rtl, or its characters are out of
//     left-to-right order on a line (bidi scrambling), or an Arabic island in it swallowed code punctuation, or it
//     has ligatures on (coding fonts draw --> as an arrow and turn a comment's closing */ into /*)
//   · a fixed/sticky element covers text in the demo and code areas at sampled scroll positions (390×844)
//   · any text is drawn over the sticky nav, or shows through it (see-through bar), at those scroll positions
//   · a page scrolls sideways at 360px or 390px wide
//   · the demo stage shows an Arabic word that isn't the Arabic in the code sample under it
//   · a demo code sample doesn't fit its box on a phone 360px or wider (lines would break mid-token or scroll)
//   · English prose with Arabic in it draws its own characters out of order (e.g. «…»: 12 flipping around the Arabic)
//   · a font that draws ZWJ-padded letter boxes doesn't map U+200D and U+200C itself (Safari then draws each letter box
//     in a fallback font: the "joined" word on a real iPhone came out in two fonts), checked against the served files
//   · the joined demo word (every tab's after state, both languages, both themes) differs from the same word set as
//     plain text in the same box: ink overlap below 0.97, in Chrome and in WebKit
// Every demo tab × before/after state is checked on the Arabic and English landing; /tool/ in both languages and 404 too.
//
//   npm run qa:visual                        guards only
//   node scripts/qa-visual.mjs --shots DIR   also write the screenshot matrix (pages × viewports × states × scroll)
//   node scripts/qa-visual.mjs --site DIR    check an already built site/ instead of building one
//   node scripts/qa-visual.mjs --no-webkit   Chrome only (--no-chrome: WebKit only)
// Needs Chrome (HARAKAH_CHROME=… or auto-detected, same as the renderer), a built dist/ (npm run build) and Playwright's
// WebKit (npx playwright-core install --with-deps webkit). Both engines get exactly the fonts the site serves.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { mapsJoiners } from "./font-cmap.mjs";
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
    png: async (sel) => Buffer.from(await (await page.$(sel)).screenshot()),
    close: () => browser.close(),
  };
}
async function webkitDriver() {
  let webkit, devices;
  try { ({ webkit, devices } = await import("playwright-core")); } catch { throw new Error("WebKit pass needs playwright-core (npm ci) and its WebKit (npx playwright-core install --with-deps webkit), or run with --no-webkit"); }
  const browser = await webkit.launch();
  const UA = devices["iPhone 15"].userAgent;
  let ctx = null, page = null;
  return {
    name: "webkit",
    async open(url, vp, theme = "dark", opts = {}) {
      await ctx?.close(); // a fresh context: clean storage, the viewport and theme of this run
      const mobile = vp[0] < 800;
      ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: vp[2] ?? (mobile ? 3 : 2), isMobile: mobile, hasTouch: mobile, colorScheme: theme, ...(mobile ? { userAgent: UA } : {}) });
      // self-test only: serve another file in place of the site's display font (the unpatched Alexandria)
      if (opts.fontSwap) await ctx.route(opts.fontSwap.match, (r) => r.fulfill({ body: opts.fontSwap.body, contentType: "font/ttf" }));
      page = await ctx.newPage();
      page.on("pageerror", (e) => fail("js webkit", e.message));
      await page.goto(BASE + url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await sleep(300);
    },
    ev: (fn, arg) => page.evaluate(fn, arg),
    shot: (file) => page.screenshot({ path: file }),
    png: (sel) => page.locator(sel).screenshot(),
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
// sideways overflow of the page, or of the nav bar (its controls can run off-screen without widening the page)
const overflow = () => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, ...[...document.querySelectorAll("nav .wrap")].map((n) => n.scrollWidth - n.clientWidth));
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

// the sticky nav: nothing is drawn over it, and nothing shows through it (an 82% background let the demo's button read
// through the bar while scrolling). Text under the bar's box must be hidden by an opaque bar that sits on top.
const headerCheck = () => {
  const nav = document.querySelector("nav"); if (!nav) return [];
  const nr = nav.getBoundingClientRect(); if (nr.bottom <= 0) return [];
  const out = [], bg = getComputedStyle(nav).backgroundColor, m = bg.match(/[\d.]+/g) || [];
  const alpha = /^rgba|\/|^color\(/.test(bg) ? parseFloat(bg.includes("/") ? bg.split("/")[1] : m[3] ?? "1") : 1;
  if (bg === "transparent" || alpha < 0.99) out.push(`nav background is see-through (${bg})`);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; const r = document.createRange();
  while ((n = w.nextNode())) {
    if (!n.textContent.trim() || nav.contains(n) || !n.parentElement.getClientRects().length) continue;
    r.selectNodeContents(n);
    for (const rc of r.getClientRects()) {
      if (rc.width < 2 || rc.bottom <= nr.top + 1 || rc.top >= nr.bottom - 1 || rc.right < 0 || rc.left > innerWidth) continue;
      const y = (Math.max(rc.top, nr.top) + Math.min(rc.bottom, nr.bottom)) / 2;
      for (const fx of [0.1, 0.5, 0.9]) {
        const hit = document.elementFromPoint(rc.left + rc.width * fx, y);
        if (hit && !nav.contains(hit)) { out.push(`"${n.textContent.trim().slice(0, 40)}" is drawn over the nav (${hit.tagName.toLowerCase()}.${hit.className})`); break; }
      }
    }
  }
  return [...new Set(out)];
};
// Safari 26 (iOS) paints the strip behind the clock / Dynamic Island in the colour of the fixed or sticky box it finds
// at the top edge, and otherwise lets the page show through it. Emulators can't show that strip, so this repeats
// WebKit's own lookup (LocalFrameView::fixedContainerEdges): hit-test the middle of the top edge 4px down, ignoring
// pointer-events (a pseudo-element counts as its host), walk up to the first fixed/sticky box; transparent ones are
// skipped by retrying with pointer-events honoured. A sticky nav at the top must be what it finds, with an opaque colour.
const topTint = () => {
  const nav = document.querySelector("nav"); if (!nav) return ["the landing has no <nav>"];
  const pos = getComputedStyle(nav).position, nr = nav.getBoundingClientRect();
  if ((pos !== "sticky" && pos !== "fixed") || nr.top > 4 || nr.bottom < 8) return [`the nav isn't pinned to the top edge (position ${pos}, top ${Math.round(nr.top)}px)`];
  const alpha = (c) => { if (c === "transparent") return 0; const m = c.match(/\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const find = (ignorePE) => {
    let st; if (ignorePE) { st = document.createElement("style"); st.textContent = "*,*::before,*::after{pointer-events:auto!important}"; document.head.append(st); }
    const hit = document.elementFromPoint(innerWidth / 2, 4); st?.remove();
    let retry = false;
    for (let el = hit; el; el = el.parentElement) {
      const cs = getComputedStyle(el); if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const rc = el.getBoundingClientRect();
      if (cs.visibility === "hidden" || +cs.opacity < 0.1 || (!alpha(cs.backgroundColor) && cs.backgroundImage === "none" && !el.firstElementChild)
        || rc.height > innerHeight * 1.05 || parseInt(cs.zIndex) < 0) { retry = cs.pointerEvents === "none"; continue; } // hidden, taller than the screen, or below the page
      if (rc.width < innerWidth * 0.9) continue;
      return { el, hit, retry };
    }
    return { el: null, hit, retry };
  };
  let r = find(true); if (!r.el && r.retry) r = find(false);
  const name = (e) => e ? e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "") : "nothing";
  if (r.el !== nav) return [`Safari's status-bar tint finds ${name(r.el)} at the top edge (hit ${name(r.hit)}), not the sticky nav: page content shows behind the clock`];
  const bg = getComputedStyle(nav).backgroundColor;
  return alpha(bg) >= 0.99 ? [] : [`the nav Safari tints the status bar from is see-through (${bg})`];
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

// fonts that draw ZWJ-padded text: for every element holding U+200D, the @font-face sources of each family in its stack
// up to the first generic family. A family with no @font-face (a system font) can't be checked, so it's reported.
const joinerFonts = () => {
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|math|emoji|fangsong)$/;
  const faces = [];
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } for (const r of rules) if (r instanceof CSSFontFaceRule) faces.push(r); }
  const out = new Map(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    if (!n.textContent.includes("\u200d")) continue;
    const el = n.parentElement, name = `${el.tagName.toLowerCase()}.${(el.closest("[class]")?.className || "").split(" ")[0]}`;
    for (const fam of getComputedStyle(el).fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""))) {
      if (GENERIC.test(fam)) break;
      const fs = faces.filter((f) => f.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "") === fam);
      const urls = fs.flatMap((f) => [...f.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)/g)].map((m) => new URL(m[1], location.href).pathname));
      const k = `${fam}|${urls.join(",")}`; if (!out.has(k)) out.set(k, { fam, urls, el: name });
    }
  }
  return [...out.values()];
};
// ink overlap of two screenshots of the same box: pixels away from the box's most common colour count as ink
function inkIoU(a, b) {
  const A = PNG.sync.read(Buffer.from(a)), B = PNG.sync.read(Buffer.from(b));
  const bg = (img) => { const m = new Map(); for (let i = 0; i < img.data.length; i += 4) { const k = img.data.readUInt32BE(i); m.set(k, (m.get(k) || 0) + 1); } const k = [...m].sort((x, y) => y[1] - x[1])[0][0]; return [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255]; };
  const c = bg(B), W = Math.max(A.width, B.width), H = Math.max(A.height, B.height);
  // boxes of different sizes (a split word is wider) are compared right-aligned, the way an RTL word sits
  const ink = (img, x, y) => { x -= W - img.width; if (x < 0 || y >= img.height) return false; const i = (y * img.width + x) * 4;
    return Math.max(Math.abs(img.data[i] - c[0]), Math.abs(img.data[i + 1] - c[1]), Math.abs(img.data[i + 2] - c[2])) > 64; };
  let and = 0, or = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = ink(A, x, y), q = ink(B, x, y); if (p && q) and++; if (p || q) or++; }
  return or ? and / or : 0;
}
// the demo word as the stage draws it vs the same word as one plain text run in the same box
async function stageInk(d) {
  const ok = await d.ev(() => { const w = document.querySelector("#vt-view .vt-word"); if (!w) return false; w.scrollIntoView({ block: "center", behavior: "instant" }); return true; });
  if (!ok) return null;
  // the flip runs a view transition (snapshots cross-fading over the stage) and scrolling the demo in can start its
  // reveal fade: wait until nothing on, around or inside the stage has been animating for a while
  await d.ev(async () => {
    const v = document.querySelector("#vt-view");
    const vt = () => document.getAnimations().some((a) => a.playState === "running" && (String(a.effect?.pseudoElement || "").startsWith("::view-transition")
      || (a.effect?.target && (a.effect.target.contains(v) || v.contains(a.effect.target)))));
    for (let quiet = 0, t = 0; quiet < 6 && t < 100; t++) { await new Promise((r) => setTimeout(r, 50)); quiet = vt() ? 0 : quiet + 1; }
  });
  await sleep(200); const split = await d.png("#vt-view");
  await d.ev(() => { const w = document.querySelector("#vt-view .vt-word"); w.dataset.qaHtml = w.innerHTML; w.textContent = document.querySelector("#vt-view").dataset.word; });
  await sleep(200); const plain = await d.png("#vt-view");
  await d.ev(() => { const w = document.querySelector("#vt-view .vt-word"); w.innerHTML = w.dataset.qaHtml; delete w.dataset.qaHtml; });
  return inkIoU(split, plain);
}
const INK_MIN = 0.97, inkScores = [];

// Chrome: phone + desktop and the full screenshot matrix. WebKit (Safari's engine) with iPhone emulation: iPhone SE,
// 15 and 15 Pro Max widths, the same guards, and its own screenshots of every demo state and the proof card.
const IPHONES = [[375, 667, 2], [393, 852, 3], [430, 932, 3]];
const RUNS = args.includes("--no-chrome") ? [] : [{ make: chromeDriver, code: [[390, 844], [1280, 800]], occ: [[390, 844], [360, 780]], over: [[360, 780], [390, 844]] }];
if (!args.includes("--no-webkit")) RUNS.push({ make: webkitDriver, code: [...IPHONES, [1280, 800]], occ: [[320, 568, 2], [393, 852, 3], [430, 932, 3]], over: [[320, 568, 2], ...IPHONES] });

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
  // 6: fonts behind ZWJ-padded letter boxes map U+200D/U+200C (the served files), first proving the check: the
  // unpatched Alexandria must be reported
  if (mapsJoiners(fs.readFileSync(path.join(ROOT, "assets", "fonts", "Alexandria.ttf")))) fail(`${E} self-test`, "the unpatched Alexandria passed the U+200D/U+200C check: the cmap reader is broken");
  for (const P of PAGES.filter((p) => p.landing)) {
    await d.open(P.url, R.occ[1]); await demoState(d, "HTML", true);
    const used = await d.ev(joinerFonts);
    if (!used.length) fail(`${E} ${P.id}`, "no ZWJ-padded text found on the landing: the font check saw nothing");
    for (const u of used) {
      if (!u.urls.length) { fail(`${E} ${P.id}`, `${u.el} draws ZWJ-padded letters in "${u.fam}", which the site doesn't serve: its joiners can't be checked`); continue; }
      for (const url of u.urls) {
        const f = path.join(SITE, decodeURIComponent(url));
        if (!fs.existsSync(f)) fail(`${E} ${P.id}`, `${u.el}: font ${url} ("${u.fam}") isn't in the built site`);
        else if (!mapsJoiners(fs.readFileSync(f))) fail(`${E} ${P.id}`, `${u.el} draws ZWJ-padded letters in ${url} ("${u.fam}"), which doesn't map U+200D and U+200C: Safari draws those letter boxes in a fallback font`);
      }
    }
  }
  // 7: the joined demo word looks like the plain word (ink overlap), every tab's after state × language × theme.
  // Self-test first: the "before" state (and in WebKit, the after state drawn with the unpatched Alexandria) must fail.
  {
    const vp = R.occ[1];
    await d.open("/", vp); await demoState(d, "HTML", false);
    const before = await stageInk(d);
    if (!(before < INK_MIN)) fail(`${E} self-test`, `the broken "before" word scored ${before?.toFixed(3)} against the plain word: the ink probe is broken`);
    if (E === "webkit") {
      const served = (await d.ev(joinerFonts)).flatMap((u) => u.urls).find((u) => /Alexandria/i.test(u));
      if (served) {
        await d.open("/", vp, "dark", { fontSwap: { match: `**${served}`, body: fs.readFileSync(path.join(ROOT, "assets", "fonts", "Alexandria.ttf")) } });
        await demoState(d, "HTML", true);
        const unpatched = await stageInk(d);
        if (!(unpatched < INK_MIN)) fail(`${E} self-test`, `the joined word drawn with the unpatched Alexandria scored ${unpatched?.toFixed(3)}: the probe can't see the Safari fallback bug`);
        console.log(`  ${E} self-test: before ${before.toFixed(3)}, unpatched Alexandria ${unpatched?.toFixed(3)} (both must be < ${INK_MIN})`);
      } else fail(`${E} self-test`, "no served Alexandria found behind the ZWJ-padded text");
    } else console.log(`  ${E} self-test: before ${before.toFixed(3)} (must be < ${INK_MIN})`);
    for (const P of PAGES.filter((p) => p.landing)) for (const theme of ["dark", "light"]) {
      await d.open(P.url, vp, theme);
      for (const tab of TABS.filter((t) => t !== "Remotion")) { // the Remotion tab shows a rendered PNG
        await demoState(d, tab, true);
        const s = await stageInk(d);
        inkScores.push(`${E} ${P.id} ${theme} ${tab} ${s?.toFixed(3)}`);
        if (s === null) fail(`${E} ${P.id} ${theme} ${tab} after`, "no demo word on the stage");
        else if (s < INK_MIN) fail(`${E} ${P.id} ${theme} ${tab} after`, `joined word ink overlap with the plain word is ${s.toFixed(3)} (< ${INK_MIN}): it doesn't render joined`);
      }
    }
    console.log(`  ${E} ink overlap (joined vs plain): ${inkScores.filter((x) => x.startsWith(E)).map((x) => x.split(" ").slice(1).join(" ")).join(" · ")}`);
  }
  lap(`${E}: joiner fonts + joined word ink`);
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
    // and the status-bar probe: a full-screen overlay above the nav (the grain layer that once sat at z-index 50) is reported
    const tint = await d.ev((tt) => {
      const st = Object.assign(document.createElement("style"), { textContent: "body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:99;opacity:.06;background:#888}" });
      document.head.append(st); const r = (0, eval)(`(${tt})`)(); st.remove(); return r.length;
    }, topTint.toString());
    if (!tint) fail(`${E} self-test`, "an overlay above the nav was not detected: the status-bar probe is broken");
  }
  for (const P of PAGES.filter((p) => p.landing)) for (const vp of R.occ) for (const theme of E === "webkit" ? ["dark", "light"] : ["dark"]) {
    await d.open(P.url, vp, theme);
    for (const state of [["Remotion", false], ["HyperFrames", true], ["GSAP", true]]) {
      await demoState(d, ...state);
      const H = await d.ev(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += Math.round(vp[1] * 0.4)) {
        await d.ev((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await sleep(40);
        for (const m of await d.ev(occlusion)) fail(`${E} ${P.id} ${vp[0]}px ${theme} ${state.join("/")} scrollY=${y}`, m);
        for (const m of await d.ev(headerCheck)) fail(`${E} ${P.id} ${vp[0]}px ${theme} ${state.join("/")} scrollY=${y} header`, m);
        for (const m of await d.ev(topTint)) fail(`${E} ${P.id} ${vp[0]}px ${theme} ${state.join("/")} scrollY=${y} status bar`, m);
      }
    }
  }
  lap(`${E}: floating UI over demo/code text`);
  // the theme toggle repaints the browser bars too: picking light on a dark phone (and back) updates theme-color
  for (const P of PAGES.filter((p) => p.landing)) {
    await d.open(P.url, R.occ[1]);
    for (const t of ["light", "dark", "system"]) {
      const r = await d.ev((t) => { document.querySelector(`#theme [data-v="${t}"]`).click(); const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(); return { bg, metas: [...document.querySelectorAll('meta[name="theme-color"]')].filter((m) => !m.media || matchMedia(m.media).matches).map((m) => m.content) }; }, t);
      if (!r.metas.length || r.metas.some((c) => c.toLowerCase() !== r.bg.toLowerCase())) fail(`${E} ${P.id} theme ${t}`, `the active theme-color ${r.metas.join(", ") || "(none)"} doesn't match the page background ${r.bg}`);
    }
  }
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
  for (const vp of IPHONES) for (const P of PAGES) for (const theme of ["dark", "light"]) {
    if (theme === "light" && vp[0] !== 393) continue; // light theme: one iPhone width
    await d.open(P.url, vp, theme);
    const tag = `${P.id}_${vp[0]}${theme === "light" ? "_light" : ""}`;
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
console.log(`qa-visual (${RUNS.map((r) => (r.make === chromeDriver ? "Chrome" : "WebKit/iPhone")).join(" + ")}): code reads left to right and fits on phones, stage words match their code, English prose keeps its order around Arabic, nothing floats over demo text or the nav, the status bar tints from the nav in both themes, no sideways scroll, ZWJ-padded letters use fonts that map U+200D/U+200C and the joined demo word matches the plain word (ink ≥ 0.97) ✓`);
