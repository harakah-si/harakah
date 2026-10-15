// Web tool: POST /api/layout (runtime layout audit with sampled frames + flagged boxes) and the scrubber panel markup.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawn, type ChildProcess } from "node:child_process";
import { ASSET_FONT_DIR } from "../src/fonts.ts";

const PORT = 4796;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/meta")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
});
after(() => { server?.kill(); });

const FLIP = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@font-face{font-family:P;src:url("${ASSET_FONT_DIR}/IBMPlexSansArabic-Regular.ttf")}body{margin:0;font:48px P}</style></head><body>
<h1 id="t" style="padding:40px;direction:ltr">${[..."حكاية"].map((c) => `<span style="display:inline-block">${c}</span>`).join("")}</h1>
<div style="display:flex;gap:20px;direction:ltr;padding:0 40px"><span>بودكاست</span><span>فيديو</span><span>مقال</span></div>
<script>window.DUR = 2; window.seek = (t) => { document.getElementById("t").style.direction = t < 1 ? "ltr" : "rtl"; };</script></body></html>`;

test("POST /api/layout: frames with JPEGs, boxes on flagged frames, findings, and the after-fix count", { timeout: 120_000 }, async () => {
  const res = await fetch(BASE + "/api/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: FLIP, kind: "html", maxFrames: 9 }) });
  assert.equal(res.status, 200);
  const r: any = await res.json();
  assert.equal(r.kind, "html");
  assert.equal(r.timeline.length, r.frames);
  // coverage: what the sampled frames cover, shown in the panel (a problem shorter than the gap can slip between samples)
  assert.equal(r.coverage.sampled, r.frames);
  assert.ok(r.coverage.gapSeconds > 0 && Math.abs(r.coverage.gapSeconds * (r.frames - 1) - r.duration) < 0.01, JSON.stringify(r.coverage));
  assert.ok(r.timeline.every((f: any) => /^data:image\/jpeg;base64,/.test(f.img)));
  const kinds = r.findings.map((f: any) => `${f.kind}:${f.problem}`).sort();
  assert.deepEqual(kinds, ["letters:flip", "words:ltr"], JSON.stringify(r.findings));
  // letters are boxed only before t = 1 (when they are laid out LTR); the word row is boxed in every frame
  const li = r.findings.findIndex((f: any) => f.kind === "letters");
  for (const f of r.timeline) assert.equal(f.boxes.some((b: any) => b.finding === li), f.t < 1, `t=${f.t}`);
  assert.ok(r.issues.every((i: any) => i.code === "HZ24"));
  // suggestions: direction: rtl on both boxes, verified in Chrome; the after check (static fix + verified CSS) is clean
  assert.ok(r.findings.every((f: any) => f.suggest?.kind === "dir" && f.suggest.verified), JSON.stringify(r.findings.map((f: any) => f.suggest)));
  assert.match(r.after.css, /#t \{ direction: rtl !important; \}/);
  assert.deepEqual(r.after.findings, []);
});

test("web tool: the layout panel (scrubber, overlay, findings list) is in the page, bilingual and labelled", async () => {
  const html = await (await fetch(BASE + "/")).text();
  for (const id of ["lay", "layCard", "layImg", "layBoxes", "layRange", "layTicks", "layList", "layPrev", "layNext"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /id="layRange"[^>]*aria-label="[^"]+"/);
  assert.match(html, /id="layPrev"[^>]*aria-label="[^"]*Previous flagged frame/);
  assert.match(html, /<span lang="ar">دقّق ترتيب العرض عبر الإطارات<\/span><span lang="en">Audit layout over time<\/span>/);
  assert.ok(html.includes('fetch(path') && html.includes('"/api/layout"'));
  assert.ok(html.includes("coverageChip(r.coverage)") && html.includes("one every") && html.includes("واحد كل"), "the panel states the sampling gap");
  assert.ok(html.includes("Verdict from one frame") && html.includes("الحكم من إطار واحد"), "the compare verdict says it is one frame");
  assert.ok(html.includes("r.network?.hosts?.length") && html.includes("The scene loaded from the internet"), "compare lists the internet hosts the scene loaded from");
  // the page's inline scripts parse (a stray quote in a bilingual string stops the whole tool)
  for (const [, js] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(js), "inline script must parse");
});
