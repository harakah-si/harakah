// Layout order and bidi: static HZ21 (Arabic in LTR/code boxes), HZ22 (rows), HZ23 (letter boxes / left = i × w),
// and the runtime layout audit HZ24 (visual order measured in headless Chrome at sampled frames).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, fix } from "../src/engine.ts";
import { auditLayoutFile } from "../src/layout-audit.ts";
import { ASSET_FONT_DIR } from "../src/fonts.ts";

const codes = (html: string) => analyze(html).issues.map((i) => i.code);
const issue = (html: string, code: string) => analyze(html).issues.find((i) => i.code === code);
const ar = (body: string, css = "") => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@font-face{font-family:P;src:url("${ASSET_FONT_DIR}/IBMPlexSansArabic-Regular.ttf")}body{margin:0;font:28px P}${css}</style></head><body>${body}</body></html>`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hz-layout-"));
const audit = async (html: string, o: { duration?: number; fps?: number } = {}) => {
  const f = path.join(tmp(), "index.html");
  fs.writeFileSync(f, html);
  return auditLayoutFile(f, { stage: { width: 900, height: 400 }, duration: o.duration ?? 0, fps: o.fps ?? 4 });
};

/* ---------- static ---------- */

test("HZ21: an Arabic run in an LTR terminal is wrapped in <bdi dir=rtl>; trailing ':' stays with the LTR line", () => {
  const html = ar(`<div class="term" style="direction:ltr"><pre>✔ Applied 2 fix(es) · تم تطبيق 2 إصلاح: HZ02, HZ09</pre></div>`);
  const i = issue(html, "HZ21")!;
  assert.equal(i.severity, "warning");
  assert.match(i.message.en, /inside left-to-right boxes/);
  assert.match(fix(html).html, /· <bdi dir="rtl">تم تطبيق 2 إصلاح<\/bdi>: HZ02/);
  // already isolated, or inherits RTL, or an English page quoting a word: nothing to say
  assert.ok(!codes(ar(`<div class="term" style="direction:ltr"><pre>✔ Applied · <bdi dir="rtl">تم تطبيق 2 إصلاح</bdi>: HZ02</pre></div>`)).includes("HZ21"));
  assert.ok(!codes(ar(`<pre>// تعليق بالعربي: const x = 1</pre>`)).includes("HZ21"), "code in an RTL page inherits RTL");
  assert.ok(!codes(`<html lang="en"><body><p>The word for motion is حركة in Arabic.</p></body></html>`).includes("HZ21"));
});

test("HZ21: <code>/terminal boxes are isolated, not flipped to RTL by HZ03", () => {
  const html = ar(`<pre class="code" style="direction:ltr">تم تطبيق الإصلاح</pre>`);
  const c = codes(html);
  assert.ok(c.includes("HZ21") && !c.includes("HZ03"), c.join());
});

test("HZ22: Arabic chip row with direction:ltr → dir=rtl; the project's own :root[lang=ar] override silences it", () => {
  const body = `<div class="chips"><span>نفس المشكلة في:</span><span>HTML</span><span>GSAP</span><span>Remotion</span></div>`;
  const html = ar(body, `.chips{display:flex;gap:8px;direction:ltr}`);
  assert.match(issue(html, "HZ22")!.message.en, /first item renders on the left/);
  assert.match(fix(html).html, /<div class="chips" dir="rtl" style="direction:\s*rtl/);
  assert.ok(!codes(ar(body, `.chips{display:flex;direction:ltr}:root[lang=ar] .chips{direction:rtl}`)).includes("HZ22"));
});

test("HZ22: row-reverse inside RTL is a warning (→ row); ltr + row-reverse is an info (fake RTL)", () => {
  const body = `<nav class="r"><a>الرئيسية</a><a>من نحن</a><a>تواصل</a></nav>`;
  const w = issue(ar(body, `.r{display:flex;flex-direction:row-reverse}`), "HZ22")!;
  assert.equal(w.severity, "warning");
  assert.match(fix(ar(body, `.r{display:flex;flex-direction:row-reverse}`)).html, /flex-direction:\s*row/);
  assert.equal(issue(ar(body, `.r{display:flex;direction:ltr;flex-direction:row-reverse}`), "HZ22")!.severity, "info");
  assert.ok(!codes(ar(body, `.r{display:flex}`)).includes("HZ22"));
});

test("HZ22: a Latin list inside RTL text gets one <bdi> per item", () => {
  const html = ar(`<p>مجانية · تعمل على جهازك · HTML · GSAP · HyperFrames · Remotion</p>`);
  assert.match(issue(html, "HZ22")!.message.en, /first of them \(HTML\)/);
  assert.match(fix(html).html, /<bdi>HTML<\/bdi> · <bdi>GSAP<\/bdi> · <bdi>HyperFrames<\/bdi> · <bdi>Remotion<\/bdi>/);
  assert.ok(!codes(ar(`<p>نستخدم HyperFrames في الفيديو</p>`)).includes("HZ22"), "one Latin word is not a list");
});

test("HZ23: inline-block letter boxes in an LTR parent → dir=rtl (one finding, not HZ03 as well)", () => {
  const html = ar(`<h1 style="direction:ltr">${[..."سلام"].map((c) => `<span style="display:inline-block">${c}</span>`).join("")}</h1>`);
  const c = codes(html);
  assert.ok(c.includes("HZ23") && !c.includes("HZ03"), c.join());
  assert.equal(issue(html, "HZ23")!.severity, "error");
  assert.match(fix(html).html, /<h1 style="direction:\s*rtl[^"]*" dir="rtl"|<h1 dir="rtl" style="direction:\s*rtl/);
});

test("HZ23: a script placing letters by left = i × w is reported; right-anchored maths is not", () => {
  const page = (js: string) => ar(`<h1 id="t">حركة</h1><script>const chars=[...document.getElementById("t").textContent];${js}</script>`);
  const bad = issue(page(`chars.forEach((c, i) => { const s = document.createElement("span"); s.textContent = c; s.style.position = "absolute"; s.style.left = i * 40 + "px"; });`), "HZ23")!;
  assert.match(bad.message.en, /left = i × width/);
  assert.ok(!codes(page(`chars.forEach((c, i) => { const s = document.createElement("span"); s.style.position = "absolute"; s.style.right = i * 40 + "px"; });`)).includes("HZ23"));
  assert.ok(!codes(page(`chars.forEach((c, i) => { const s = document.createElement("span"); s.style.left = (W - i * 40) + "px"; });`)).includes("HZ23"));
});

/* ---------- runtime audit (headless Chrome) ---------- */

test("audit: words as inline-block boxes in an LTR box read backwards (HZ24); the static HZ23 fix makes the audit clean", { timeout: 60000 }, async () => {
  const html = ar(`<div style="direction:ltr;padding:40px">${"تم تطبيق الإصلاح بنجاح".split(" ").map((w) => `<span style="display:inline-block;margin:0 6px">${w}</span>`).join("")}</div>`);
  const before = await audit(html);
  assert.ok(before.findings.some((f) => f.code === "HZ24" && f.kind === "words" && f.problem === "ltr"), JSON.stringify(before.findings));
  assert.equal(before.issues.find((i) => i.code === "HZ24")!.severity, "error");
  const after = await audit(fix(html).html);
  assert.deepEqual(after.findings, []);
});

test("audit: an Arabic chip row laid out LTR (HZ22 at runtime); fixed row is clean", { timeout: 60000 }, async () => {
  const html = ar(`<div class="chips"><span>نفس المشكلة في:</span><span>HTML</span><span>GSAP</span><span>Remotion</span></div>`, `.chips{display:flex;gap:12px;direction:ltr;padding:40px}`);
  const before = await audit(html);
  assert.ok(before.findings.some((f) => f.code === "HZ22" && f.problem === "ltr"), JSON.stringify(before.findings));
  assert.deepEqual((await audit(fix(html).html)).findings, []);
});

test("audit: per-letter spans laid out LTR, then flipped to RTL mid-animation → flip, with the frames", { timeout: 60000 }, async () => {
  const html = ar(`<h1 id="t" style="padding:40px;direction:ltr">${[..."حكاية"].map((c) => `<span style="display:inline-block">${c}</span>`).join("")}</h1>
<script>window.DUR = 2; window.seek = (t) => { document.getElementById("t").style.direction = t < 1 ? "ltr" : "rtl"; };</script>`);
  const r = await audit(html, { duration: 2, fps: 4 });
  const f = r.findings.find((x) => x.kind === "letters" && x.problem === "flip")!;
  assert.ok(f, JSON.stringify(r.findings));
  assert.ok(f.frames.every((t) => t < 1) && f.okFrames.every((t) => t >= 1), JSON.stringify(f));
});

test("audit: labels that swap places between frames (row rebuilt per frame) → swap", { timeout: 60000 }, async () => {
  const html = ar(`<div id="m" style="display:flex;gap:30px;padding:40px"></div>
<script>window.DUR = 2; const L = ["قطع الحبر", "المرجع", "متصلة"];
window.seek = (t) => { const o = t < 1 ? L : [L[1], L[0], L[2]]; document.getElementById("m").innerHTML = o.map((x) => "<div>" + x + "</div>").join(""); }; seek(0);</script>`);
  const r = await audit(html, { duration: 2, fps: 4 });
  assert.ok(r.findings.some((f) => f.problem === "swap"), JSON.stringify(r.findings));
});

test("audit: two stacked copies of a per-letter word colliding (gold over grey) and a Latin list in RTL text", { timeout: 60000 }, async () => {
  const letters = (id: string, dx: number[]) => `<h1 id="${id}" style="position:absolute;top:40px;right:40px;margin:0;direction:rtl">${[..."سنة"].map((c, i) => `<span style="display:inline-block;transform:translateX(${dx[i]}px)">${c}</span>`).join("")}</h1>`;
  const html = ar(letters("grey", [0, 0, 0]) + letters("gold", [-60, 0, 60]) + `<p style="position:absolute;top:200px;right:40px">مجانية · HTML · GSAP · Remotion</p>`);
  const r = await audit(html);
  assert.ok(r.findings.some((f) => f.kind === "layers" && f.problem === "collide"), JSON.stringify(r.findings));
  assert.ok(r.findings.some((f) => f.kind === "list"), JSON.stringify(r.findings));
  // the static fix isolates the list items: the rendered order becomes RTL
  assert.ok(!(await audit(fix(html).html)).findings.some((f) => f.kind === "list"));
});

test("audit: data-harakah-ignore skips a deliberate scatter", { timeout: 60000 }, async () => {
  const html = ar(`<h1 data-harakah-ignore style="padding:40px">${[..."حكاية"].map((c, i) => `<span style="display:inline-block;transform:translateX(${i * 30}px)">${c}</span>`).join("")}</h1>`);
  assert.deepEqual((await audit(html)).findings, []);
});

test("real repro: the launch comp at b028815 (passed `check` with 0 issues) is flagged by the layout audit", { timeout: 120000 }, async () => {
  // the comp as it was at commit b028815, kept as a fixture (it passed `check` but had RTL bugs only a render shows)
  const fx = path.join(import.meta.dirname, "..", "fixtures", "regressions", "launch-comp-b028815");
  const src = fs.readFileSync(path.join(fx, "index.html"), "utf8");
  const split = fs.readFileSync(path.join(fx, "harakah-split.js"), "utf8");
  const d = tmp();
  fs.writeFileSync(path.join(d, "index.html"), src.replaceAll("../../../assets/fonts/", ASSET_FONT_DIR + "/"));
  fs.writeFileSync(path.join(d, "harakah-split.js"), split);
  assert.equal(analyze(src).issues.length, 0, "the static check alone still passes it");
  const r = await auditLayoutFile(path.join(d, "index.html"), { stage: { width: 1920, height: 1080 }, fps: 5 });
  assert.equal(r.duration, 26, "window.DUR is read");
  const kinds = r.findings.map((f) => `${f.kind}:${f.problem}:${f.key}`);
  assert.ok(kinds.some((k) => k.startsWith("layers:collide:#t4b ⟷ #t4j")), kinds.join(" | "));  // gold joined letters over waiting grey letters (≈19 s)
  assert.ok(kinds.some((k) => k.startsWith("list:ltr:#fine")), kinds.join(" | "));            // end-card feature list in one bidi line
  assert.ok(r.findings.find((f) => f.kind === "layers")!.frames.some((x) => x >= 18.5 && x <= 20));
});

test("HZ22: a scrolling ticker with direction:ltr is an info without auto-fix (the LTR is part of the scroll maths)", () => {
  const html = ar(`<div class="ticker" aria-hidden="true"><div class="ticker__track"><span>لنصنع شيئاً</span><span>EDIT</span><span>MOTION</span></div></div>`, `.ticker{direction:ltr}.ticker__track{display:flex;will-change:transform}`);
  const i = issue(html, "HZ22")!;
  assert.equal(i.severity, "info");
  assert.equal(i.fixable, false);
});

test("HZ22 and HZ03 don't both report one LTR Arabic row", () => {
  const c = codes(ar(`<div style="display:flex;direction:ltr"><span>نفس المشكلة</span><span>HTML</span></div>`));
  assert.ok(c.includes("HZ22") && !c.includes("HZ03"), c.join());
});
