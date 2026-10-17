// The runtime shim's clip method (the one WebKit/Safari uses: whole word per letter box, clipped to its slice), run in
// Chrome with window.__harakahSplit = "clip": same elements, one accessible copy per word, لا and harakat folds,
// idempotent re-runs, re-measuring after a size change, and Chrome's default staying on ZWJ padding.
// The ink comparison in WebKit itself is scripts/qa-shim.mjs (npm run qa:shim).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { launch } from "../src/render.ts";
import { RUNTIME_SHIM } from "../src/runtime.ts";

const FONT = path.resolve(import.meta.dirname, "../assets/fonts/Alexandria.ttf");
const letters = (w: string) => [...w].map((c) => (c === " " ? " " : `<span class="ch">${c}</span>`)).join("");
const page = (body: string, mode = "clip") => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:T;src:url("/f.ttf")}#s{font:700 60px/1.5 T;white-space:nowrap;width:max-content}</style></head><body>
<div id="s">${body}</div><script>window.__els=[...document.querySelectorAll('#s .ch')]</script>
<script>${mode ? `window.__harakahSplit=${JSON.stringify(mode)}` : ""}</script>
<script>window.__ready=document.fonts.load('700 60px T').then(()=>document.fonts.ready)</script><script>${RUNTIME_SHIM}</script></body></html>`;

async function withPage<T>(html: string, fn: (p: any) => Promise<T>): Promise<T> {
  const srv = http.createServer((q, r) => {
    if (q.url === "/f.ttf") { r.writeHead(200, { "content-type": "font/ttf" }); return fs.createReadStream(FONT).pipe(r); }
    r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(html);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const browser = await launch();
  try {
    const p = await browser.newPage();
    await p.goto(`http://127.0.0.1:${(srv.address() as any).port}/`, { waitUntil: "domcontentloaded" });
    await p.evaluate(() => (window as any).__ready);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return await fn(p);
  } finally { await browser.close(); srv.close(); }
}

const state = (p: any) => p.evaluate(() => {
  const els = [...document.querySelectorAll("#s .ch")] as HTMLElement[];
  return {
    same: els.length === (window as any).__els.length && els.every((e, i) => e === (window as any).__els[i]),
    ch: els.map((e) => e.getAttribute("data-hz-ch")),
    layers: els.map((e) => { const l = e.querySelector("[data-hz-l]"); return l ? { text: l.textContent, hidden: l.getAttribute("aria-hidden"), clip: (l as HTMLElement).style.clipPath } : null; }),
    struts: els.map((e) => e.querySelector("[data-hz-s]")?.getAttribute("aria-hidden") ?? null),
    sr: [...document.querySelectorAll("#s [data-hz-sr]")].map((e) => [e.textContent, e.getAttribute("aria-hidden")]),
    widths: els.map((e) => e.getBoundingClientRect().width),
    zwj: els.some((e) => /\u200d/.test(e.textContent || "")),
  };
});

test("runtime clip: same elements, whole word per box (aria-hidden), one screen-reader copy per word, لا folded", async () => {
  await withPage(page(letters("الحكايات") + " " + letters("لا")), async (p) => {
    const s = await state(p);
    assert.ok(s.same, "the shim keeps the user's letter elements");
    assert.equal(s.zwj, false, "no ZWJ padding in clip mode");
    assert.deepEqual(s.ch.slice(0, 8), [..."الحكايات"]);
    for (const l of s.layers.slice(0, 8)) { assert.equal(l!.text, "الحكايات"); assert.equal(l!.hidden, "true"); assert.match(l!.clip, /^inset\(/); }
    assert.ok(s.struts.slice(0, 8).every((h: any) => h === "true"));
    // لا: the alef rides in the lam box, so the word is one box of plain text (nothing to join, nothing to clip)
    assert.deepEqual(s.ch.slice(8), [null, null]);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#s .ch")].slice(8).map((e) => e.textContent)), ["لا", ""]);
    assert.deepEqual(s.sr, [["الحكايات", null]], "one readable copy for the clipped word, not hidden");
    // the slices tile the word: their widths add up to the plain word's width
    const plain = await p.evaluate(() => { const m = document.createElement("span"); m.style.font = "700 60px T"; m.textContent = "الحكايات"; document.body.append(m); const w = m.getBoundingClientRect().width; m.remove(); return w; });
    assert.ok(Math.abs(s.widths.slice(0, 8).reduce((a: number, b: number) => a + b, 0) - plain) < 1, `slices ${s.widths} vs ${plain}`);
  });
});

test("runtime clip: harakat in their own boxes fold into the letter before them", async () => {
  await withPage(page(letters("مُحَمَّدٌ")), async (p) => {
    const s = await state(p);
    assert.deepEqual(s.ch, ["مُ", "", "حَ", "", "مَّ", "", "", "دٌ", ""]);
    assert.deepEqual(s.layers.map((l: any) => l.text), ["مُحَمَّدٌ", "", "مُحَمَّدٌ", "", "مُحَمَّدٌ", "", "", "مُحَمَّدٌ", ""]);
  });
});

test("runtime clip: re-running is a no-op; a size change re-measures the slices", async () => {
  await withPage(page(letters("السلام")), async (p) => {
    const a = await state(p);
    await p.evaluate(() => { (window as any).__harakahRun(); });
    await p.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    const b = await state(p);
    assert.deepEqual(b, a, "a second run changes nothing");
    await p.evaluate(() => { document.getElementById("s")!.style.fontSize = "120px"; (window as any).__harakahRelayout(); });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const c = await state(p);
    const sum = (w: number[]) => w.reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum(c.widths) / sum(a.widths) - 2) < 0.02, `${sum(c.widths)} vs ${sum(a.widths)}`);
  });
});

test("runtime: Chrome's default stays ZWJ padding (no clip layers), Latin and mixed groups untouched by clip", async () => {
  await withPage(page(letters("الحكايات"), ""), async (p) => {
    const s = await state(p);
    assert.ok(s.same);
    assert.ok(s.zwj, "ZWJ padding in Chrome");
    assert.ok(s.layers.every((l: any) => l === null));
  });
  await withPage(page(`<span class="w">${letters("حركة")}</span> <span class="w">${letters("AI")}</span>`), async (p) => {
    const n = await p.evaluate(() => [document.querySelectorAll("#s .w")[0].querySelectorAll("[data-hz-l]").length, document.querySelectorAll("#s .w")[1].querySelectorAll("[data-hz-l]").length]);
    assert.deepEqual(n, [4, 0]);
  });
});
