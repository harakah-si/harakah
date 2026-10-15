// Accessibility: axe-core (WCAG 2.1 A/AA + best practices) on the landing page and the tool,
// in Arabic and English, dark and light. Also checks prefers-reduced-motion behavior.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import puppeteer, { type Browser } from "puppeteer-core";
import { CHROME } from "../src/render.ts";

const PORT = 4791;
const BASE = `http://127.0.0.1:${PORT}`;
const AXE = fs.readFileSync(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
let server: ChildProcess, browser: Browser;

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/meta")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(page: string, lang: string, theme: string, reduce = true) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }]);
  await p.evaluateOnNewDocument((t, l) => { localStorage.setItem("hz-theme", t); localStorage.setItem("hz-lang", l); }, theme, lang);
  await p.goto(`${BASE}/${page === "landing" ? "landing" : ""}`, { waitUntil: "networkidle0" });
  return p;
}

for (const page of ["landing", "tool"]) for (const lang of ["ar", "en"]) for (const theme of ["dark", "light"]) {
  test(`a11y: ${page} ${lang} ${theme} has no axe violations`, async () => {
    const p = await open(page, lang, theme);
    if (page === "tool") {
      await p.select("#example", "remotion/broken/CharSplitTitle.tsx");
      await p.waitForFunction(() => (document.querySelector("#out") as HTMLTextAreaElement).value, { timeout: 20000 });
    }
    assert.equal(await p.evaluate(() => document.documentElement.dir), lang === "en" ? "ltr" : "rtl");
    await p.evaluate(AXE);
    const v = await p.evaluate(async () => (await (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations
      .map((x: any) => `${x.id}: ${x.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(", ")}`));
    await p.close();
    assert.deepEqual(v, []);
  });
}

test("reduced motion: hero letters don't animate, video starts paused, reveals are visible", async () => {
  const p = await open("landing", "ar", "dark", true);
  await new Promise((r) => setTimeout(r, 400));
  const s = await p.evaluate(() => ({
    playing: document.querySelector("#kin")!.classList.contains("play"),
    broken: getComputedStyle(document.querySelector("#kin .broken")!).display,
    paused: (document.querySelector("#vid") as HTMLVideoElement).paused,
    reveal: getComputedStyle(document.querySelector("[data-reveal]")!).opacity,
  }));
  await p.close();
  assert.deepEqual(s, { playing: false, broken: "none", paused: true, reveal: "1" });
  const q = await open("landing", "ar", "dark", false);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await q.evaluate(() => document.querySelector("#kin")!.classList.contains("play")), true, "animates without the preference");
  await q.close();
});

test("social meta: absolute OG/Twitter tags per language, 1200×630 images, icons + manifest served", async () => {
  for (const [pathname, lang] of [["/landing", "ar"], ["/landing?lang=en", "en"], ["/", "en"], ["/?lang=ar", "ar"], ["/?lang=en", "en"]] as const) {
    const html = await (await fetch(BASE + pathname)).text();
    const meta = (k: string) => html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`))?.[1];
    assert.equal(meta("og:image"), `${BASE}/assets/og-${lang}.png`, pathname);
    assert.equal(meta("twitter:card"), "summary_large_image");
    assert.equal(meta("og:locale"), lang === "en" ? "en_US" : "ar_AR");
    assert.ok(meta("og:title") && meta("og:description") && meta("og:image:alt"), pathname);
    assert.doesNotMatch(html, /\{\{\w+\}\}/, "all placeholders filled");
  }
  for (const lang of ["ar", "en"]) {
    const buf = Buffer.from(await (await fetch(`${BASE}/assets/og-${lang}.png`)).arrayBuffer());
    assert.equal(buf.readUInt32BE(16), 1200); assert.equal(buf.readUInt32BE(20), 630); // PNG IHDR
  }
  for (const u of ["/favicon.ico", "/assets/favicon-32.png", "/assets/apple-touch-icon.png", "/assets/icon-192.png", "/assets/icon-512.png"]) assert.equal((await fetch(BASE + u)).status, 200, u);
  const man = await (await fetch(BASE + "/site.webmanifest")).json();
  assert.equal(man.dir, "rtl"); assert.equal(man.icons.length, 2);
  assert.equal((await fetch(BASE + "/assets/../src/server.ts")).status, 404);
});

// Monospace fonts (DejaVu Sans Mono on Linux, Consolas on Windows) draw Arabic as unjoined glyphs.
// Both pages route Arabic code points in var(--mono) to the bundled IBM Plex Sans Arabic ("HZ Mono Arabic").
for (const page of ["landing", "tool"]) {
  test(`fonts: Arabic inside code on the ${page} page uses the joining Plex face, not a mono font`, async () => {
    const p = await open(page, "ar", "dark");
    await p.evaluate(() => { const e = document.createElement("code"); e.id = "hz-probe"; e.style.fontFamily = "var(--mono)"; e.textContent = "سلام عليكم"; document.body.append(e); });
    await p.evaluate("document.fonts.ready");
    const c = await p.createCDPSession();
    await c.send("DOM.enable"); await c.send("CSS.enable");
    const { root } = await c.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#hz-probe" });
    const { fonts } = await c.send("CSS.getPlatformFontsForNode", { nodeId });
    const plex = fonts.find((f: any) => f.familyName === "IBM Plex Sans Arabic" && f.isCustomFont);
    assert.ok(plex && plex.glyphCount >= 8, `Arabic glyphs from Plex: ${JSON.stringify(fonts)}`);
    assert.ok(!fonts.some((f: any) => /Mono|Consolas|Courier/.test(f.familyName) && f.glyphCount > 1), `no Arabic glyphs from a mono font: ${JSON.stringify(fonts)}`);
    await p.close();
  });
}

test("api: Remotion analyze honours wrapWords (keep words together) from the tool's option", async () => {
  const src = fs.readFileSync(path.resolve("fixtures/remotion/src/broken/CharSplitTitle.tsx"), "utf8").replace(`display: "flex", `, "width: 560, ");
  const call = async (wrapWords: boolean) => (await (await fetch(`${BASE}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: src, kind: "remotion", name: "CharSplitTitle.tsx", options: { wrapWords } }) })).json()) as any;
  assert.match((await call(true)).fixedHtml, /mapArabicWords\(/);
  const off = await call(false);
  assert.doesNotMatch(off.fixedHtml, /mapArabicWords\(/);
  assert.ok(off.remaining.some((i: any) => /middle of a word/.test(i.message.en)));
});
