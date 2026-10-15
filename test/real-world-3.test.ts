// Third real-world round: public HyperFrames compositions and GSAP SplitText pens that char-split Arabic.
// Every snippet is a minimal re-creation written for this repo, not code copied from those projects.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { analyze, fix } from "../src/engine.ts";
import { toIssues, transformSource } from "../src/remotion/codemod.ts";
import { launch } from "../src/render.ts";

const GSAP = "file://" + path.resolve(import.meta.dirname, "..", "node_modules", "gsap", "dist");
const codes = (html: string) => analyze(html).issues.map((i) => `${i.code}:${i.severity}`);

/** load HTML from a data-free file:// page and return, per container, its letters in left-to-right screen order */
async function screenOrder(html: string, sel: string) {
  const fs = await import("node:fs"); const os = await import("node:os");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hz-rw3-")), "p.html"); fs.writeFileSync(f, html);
  const b = await launch();
  try {
    const p = await b.newPage(); await p.goto("file://" + f, { waitUntil: "load" }); await new Promise((r) => setTimeout(r, 400));
    return await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => ({
      dir: getComputedStyle(c).direction,
      ltr: [...c.querySelectorAll("*")].filter((e) => !e.children.length && (e.textContent || "").trim())
        .map((e) => ({ x: e.getBoundingClientRect().left, t: (e.textContent || "").replace(/\u200d/g, "") }))
        .sort((a, b) => a.x - b.x).map((e) => e.t).join(""),
    })), sel);
  } finally { await b.close(); }
}
const rev = (s: string) => [...s].reverse().join("");

test("round 3: SplitText chars of an Arabic word inside an LTR heading read right-to-left after the fix", { timeout: 60000 }, async () => {
  const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><script src="${GSAP}/gsap.min.js"></script><script src="${GSAP}/SplitText.min.js"></script>
<style>.c{display:inline-block}</style></head><body>${body}<script>gsap.registerPlugin(SplitText);SplitText.create("#w",{type:"chars",charsClass:"c"});</script></body></html>`;
  const html = page(`<h2>Result: <span id="w">قمر</span></h2>`);
  const before = await screenOrder(html, "#w");
  assert.equal(before[0].ltr, "قمر", "LTR parent lines the boxes up left-to-right, so the word reads backwards");
  const out = fix(html).html;
  assert.match(out, /data-harakah="runtime"/);
  const after = await screenOrder(out, "#w");
  assert.equal(after[0].dir, "rtl");
  assert.equal(after[0].ltr, rev("قمر"), "boxes now run right-to-left (logical order read from the right)");
});

test("round 3: a split Latin word inside the newly RTL container keeps LTR order", { timeout: 60000 }, async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>i{display:inline-block;font-style:normal}b{display:inline-block}</style></head><body>
<p id="row"><b><i>م</i><i>ع</i></b> <b><i>ك</i><i>ل</i><i>م</i><i>ة</i></b> <b id="lat"><i>C</i><i>S</i><i>S</i></b></p>
<script>void [..."split"];</script></body></html>`;
  const after = await screenOrder(fix(html, { shim: "always" }).html, "#lat");
  assert.equal(after[0].ltr, "CSS");
});

test("round 3: letters prepended one by one (manual RTL) are reported and padded in reverse DOM order, direction untouched", { timeout: 60000 }, async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>.l{display:inline-block}</style></head><body>
<h3>Out: <span id="src">نور</span> <span id="out"></span></h3>
<script>var s=document.getElementById('src').textContent, out=document.getElementById('out');
for (var i=0;i<s.length;i++){ out.innerHTML = '<span class="l">'+s.charAt(i)+'</span>' + out.innerHTML; }</script></body></html>`;
  const a = analyze(html);
  assert.ok(a.issues.some((i) => i.code === "HZ15" && /back to front/.test(i.message.en)), JSON.stringify(a.issues.map((i) => i.code)));
  const out = fix(html).html;
  assert.match(out, /window\.__harakahNoDir=\["#out"\];/);
  const b = await launch();
  try {
    const fs = await import("node:fs"); const os = await import("node:os");
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hz-rw3-")), "p.html"); fs.writeFileSync(f, out);
    const p = await b.newPage(); await p.goto("file://" + f, { waitUntil: "load" }); await new Promise((r) => setTimeout(r, 300));
    const r = await p.evaluate(() => ({
      dir: getComputedStyle(document.getElementById("out")!).direction,
      boxes: [...document.querySelectorAll("#out .l")].map((e) => e.textContent!.replace(/\u200d/g, "+")),
      screen: [...document.querySelectorAll("#out .l")].sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left).map((e) => e.textContent!.replace(/\u200d/g, "")).join(""),
    }));
    // DOM is ر و ن (reversed); logical نور: ن joins forward, و is right-joining (joins back only), ر stands alone after و
    // the heading itself became dir=rtl (HZ03), so the pre-reversed span is pinned to LTR and still reads نور from the right
    assert.equal(r.dir, "ltr");
    assert.equal(r.screen, "نور");
    assert.deepEqual(r.boxes, ["ر", "+و", "ن+"]);
  } finally { await b.close(); }
});

test("round 3: an unresolvable prepend target falls back to the global no-direction flag", () => {
  const html = `<html><body><p>نص</p><script>function go(el,s){for(const ch of s){ el.innerHTML = '<i>'+ch+'</i>' + el.innerHTML; }} go(document.querySelector('h1'),'شكرا');</script></body></html>`;
  assert.match(fix(html, { shim: "always" }).html, /window\.__harakahNoDir=1;/);
});

test("round 3: GreenSock's guarded splitRTLText helper: no HZ15, and Latin words are not wrapped in <bdi> (would flip 'gsap')", () => {
  const html = `<html lang="ar"><body><div dir="rtl" id="d">نص تجريبي مع gsap</div><script>
const rtlExp=/[\\u0600-\\u06FF]/, seg=new Intl.Segmenter("ar",{granularity:"grapheme"});
const prep=(t)=>t.split(" ").map(w=>rtlExp.test(w) ? w : [...seg.segment(w)].map(s=>s.segment).reverse().join("")).join(" ");
SplitText.create("#d",{type:"words,chars",prepareText:prep});</script></body></html>`;
  const a = analyze(html);
  assert.ok(!a.issues.some((i) => i.code === "HZ15"), "guarded reverse is deliberate");
  const hz13 = a.issues.find((i) => i.code === "HZ13")!;
  assert.equal(hz13.severity, "info");
  assert.ok(!fix(html).html.includes("<bdi>"));
  // without the helper the bdi isolation still applies
  assert.ok(fix(`<html lang="ar"><body><div dir="rtl">نص تجريبي مع gsap</div></body></html>`).html.includes("<bdi>gsap</bdi>"));
});

test("round 3: visually-hidden headings (sr-only, clip rect) are ignored by text checks", () => {
  const html = `<html lang="ar" dir="rtl"><body><div dir="ltr" class="brand"><h1 class="sr-only">اسم الموقع</h1><span>LOGO</span></div>
<div dir="ltr"><h2 style="position:absolute;clip:rect(0 0 0 0)">عنوان مخفي</h2></div></body></html>`;
  assert.ok(!codes(html).some((c) => c.startsWith("HZ03")), codes(html).join());
});

test("round 3: a Google font pulled in with @import counts as loaded (no HZ11)", () => {
  const html = `<html lang="ar" dir="rtl"><head><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
body{font-family:'Cairo',sans-serif}</style></head><body><p>مرحبا بكم</p></body></html>`;
  assert.ok(!codes(html).some((c) => c.startsWith("HZ11")), codes(html).join());
});

test("round 3: font shorthand with a weight before the size resolves the family (no false HZ09)", () => {
  const html = `<html lang="ar" dir="rtl"><head><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic');
h1{font:700 64px/1.4 'Noto Naskh Arabic',serif}</style></head><body><h1>عنوان</h1></body></html>`;
  assert.ok(!codes(html).some((c) => c.startsWith("HZ09")), codes(html).join());
});

test("round 3: tracking in a HyperFrames composition is info (Chromium 137+ keeps joins), on a web page a warning", () => {
  const hf = `<html lang="ar"><body><div data-composition-id="m" dir="rtl"><h1 style="letter-spacing:4px">عنوان الحلقة</h1></div></body></html>`;
  const web = `<html lang="ar"><body><div dir="rtl"><h1 style="letter-spacing:4px">عنوان الحلقة</h1></div></body></html>`;
  const i = analyze(hf).issues.find((x) => x.code === "HZ07")!;
  assert.equal(i.severity, "info"); assert.match(i.message.en, /Chromium 137\+/);
  assert.equal(analyze(web).issues.find((x) => x.code === "HZ07")!.severity, "warning");
});

test("round 3: Remotion tracking is info by default, warning when the source also ships to the web (remotion:false)", () => {
  const src = `export const T = () => <h1 style={{ letterSpacing: 6 }}>عنوان</h1>;`;
  const v = transformSource(src, { helperImport: "./harakah-arabic" });
  const hz = (r: any) => toIssues(r, false).find((x) => x.code === "HZ07")!;
  assert.equal(hz(v).severity, "info");
  const w = transformSource(src, { helperImport: "./harakah-arabic", remotion: false });
  assert.notEqual(hz(w).severity, "info");
});

test("round 3: an unguarded .reverse().join('') on Arabic stays an HZ15 error", () => {
  const html = `<html lang="ar"><body><h1 id="t">مرحبا</h1><script>const t=document.getElementById('t');t.textContent=[...t.textContent].reverse().join('');</script></body></html>`;
  assert.ok(codes(html).some((c) => c === "HZ15:error"), codes(html).join());
});

test("round 3: a spread in the non-Arabic branch of an Arabic test is the author's own guard (no HZ02)", () => {
  const src = `export const Name = ({ name }: { name: any }) => {
  const units = /[\\u0600-\\u06FF]/.test(name) ? name.split(/(\\s+)/) : [...name];
  return <h1>{units.map((u: any, i: number) => <span key={i}>{u}</span>)}</h1>;
};`;
  const r = transformSource(src, { helperImport: "./harakah-arabic", assumeArabic: true });
  assert.ok(![...r.changes, ...r.reports].some((c) => c.code === "HZ02"), JSON.stringify(r.reports));
  // the Arabic branch itself is still fixed
  const bad = transformSource(`export const N = ({ name }: { name: string }) => { const u = isArabic(name) ? [...name] : name.split(" "); return <h1>{u.map((c, i) => <span key={i}>{c}</span>)}</h1>; };`, { helperImport: "./harakah-arabic", assumeArabic: true });
  assert.ok(bad.changes.some((c) => c.code === "HZ02"));
});

test("round 3: array copies in state updaters are not reported as possible text splits", () => {
  const src = `export const S = () => { const [o, setO] = useState<any>([]); const go = (x: any) => setO((prev: any) => { const next = [...prev]; next.push(x); return next; }); return <h1 onClick={() => go(1)}>مدونة</h1>; };`;
  const r = transformSource(src, { helperImport: "./harakah-arabic", assumeArabic: true });
  assert.ok(![...r.changes, ...r.reports].some((c) => c.code === "HZ02"), JSON.stringify(r.reports));
});

test("round 3: an inlined minified library bundle without Arabic is not scanned for split idioms", () => {
  const lib = `!function(){${"var a=[1,2,3];a.unshift(0);for(var i=0;i<a.length;i++){var s=[...a];}n.insertBefore(c,n.firstChild);".repeat(700)}}();`;
  const html = `<html lang="ar" dir="rtl"><body><p>خريطة المسار</p><script>${lib}</script></body></html>`;
  assert.ok(!analyze(html).issues.some((i) => i.code === "HZ02" || i.code === "HZ15"));
});

test("round 3: fontFamily 'inherit' / var(--font) defers to the parent stack (no HZ09)", () => {
  for (const v of ["inherit", "var(--font-arabic)"]) {
    const r = transformSource(`export const C = () => <input style={{ fontFamily: "${v}" }} placeholder="اسمك" />;`, { helperImport: "./harakah-arabic", assumeArabic: true });
    assert.ok(![...r.changes, ...r.reports].some((c) => c.code === "HZ09"), v);
  }
});

test("round 3: next-intl segment layout (app/[locale]/layout.tsx) with <html dir={dir}> counts as app-level direction", async () => {
  const fs = await import("node:fs"); const os = await import("node:os");
  const { projectContext } = await import("../src/remotion/project.ts");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-rw3-"));
  fs.mkdirSync(path.join(d, "app", "[locale]"), { recursive: true });
  fs.writeFileSync(path.join(d, "app", "[locale]", "layout.tsx"), `export default function L({ children, params }: any) { const dir = params.locale === "ar" ? "rtl" : "ltr"; return <html lang={params.locale} dir={dir}><body>{children}</body></html>; }`);
  assert.equal(projectContext(d, []).rtl, true);
});
