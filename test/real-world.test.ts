// Regressions distilled from running Harakah on public Arabic/Persian Remotion & HTML projects (ROADMAP P0 #6).
// Every snippet below is a minimal re-creation written for this repo, not code copied from those projects.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, fix } from "../src/engine.ts";
import { transformSource } from "../src/remotion/codemod.ts";
import { projectContext } from "../src/remotion/project.ts";
import { normalizeDigits, scriptLang } from "../src/arabic.ts";

const T = (src: string, o: any = {}) => transformSource(src, { helperImport: "./harakah-arabic", ...o });
const codes = (r: { changes: { code: string }[]; reports: { code: string }[] }) => [...r.changes, ...r.reports].map((c) => c.code);
const H = `import React from "react";\nimport { AbsoluteFill } from "remotion";\n`;

test("real-world: Persian text gets lang=fa and Persian digits, never 'fixed' to Arabic", () => {
  assert.equal(scriptLang("این یک ویدیوی کوتاه است"), "fa");
  assert.equal(scriptLang("هذا فيديو قصير"), "ar");
  assert.equal(normalizeDigits("سال 1404", "eastern", "fa"), "سال ۱۴۰۴");
  const r = T(H + `export const A = () => <AbsoluteFill><h1>این ویدیو ۳ دقیقه است</h1></AbsoluteFill>;`);
  assert.match(r.code, /dir="rtl" lang="fa"/);
  assert.doesNotMatch(r.code, /lang="ar"/);
  assert.match(r.code, /۳/, "Persian digits stay Persian");
  const html = analyze(`<html lang="fa" dir="rtl"><body><p>سلام دنیا، این یک آزمایش است</p></body></html>`);
  assert.ok(!html.issues.some((i) => i.code === "HZ04"), "lang=fa is a valid Arabic-script language");
});

test("real-world: non-text splits are not per-letter Arabic splits", () => {
  const cases = [
    `const bars = Array.from({ length: 12 }).map((_, i) => <i key={i} />);`,
    `const shown = "مرحبا بكم".split("").slice(0, 4).join("");`, // typewriter: split → join
    `const digits = String(1234).split("").map((d, i) => <span key={i} style={{ display: "inline-block" }}>{d}</span>);`, // odometer
    `const fa = "۰۱۲۳۴۵۶۷۸۹".split("").map((d, i) => <b key={i} style={{ display: "inline-block" }}>{d}</b>);`,
    `const n = (42).toFixed(0).split("").map((d) => <span style={{ display: "inline-block" }}>{d}</span>);`,
  ];
  for (const c of cases) {
    const r = T(H + `export const A = () => { ${c} return <AbsoluteFill dir="rtl" lang="ar"><p>نص عربي</p></AbsoluteFill>; };`);
    assert.ok(!codes(r).includes("HZ02"), `no HZ02 for: ${c}\n${r.code}`);
  }
});

test("real-world: opacity/color-only letter spans inside a plain block are left alone (they shape-join in Chrome)", () => {
  const plain = T(H + `export const A = ({ f }: { f: number }) => <AbsoluteFill dir="rtl" lang="ar"><p>{"مرحبا".split("").map((c, i) => <span key={i} style={{ opacity: f > i ? 1 : 0.2 }}>{c}</span>)}</p></AbsoluteFill>;`);
  assert.ok(!codes(plain).includes("HZ02"), plain.code);
  const boxed = T(H + `export const A = ({ f }: { f: number }) => <AbsoluteFill dir="rtl" lang="ar"><p>{"مرحبا".split("").map((c, i) => <span key={i} style={{ display: "inline-block", opacity: f }}>{c}</span>)}</p></AbsoluteFill>;`);
  assert.ok(codes(boxed).includes("HZ02"), "inline-block per-letter boxes still break joining");
  const flexHost = T(H + `export const A = ({ f }: { f: number }) => <AbsoluteFill dir="rtl" lang="ar"><div style={{ display: "flex" }}>{"مرحبا".split("").map((c, i) => <span key={i} style={{ opacity: f }}>{c}</span>)}</div></AbsoluteFill>;`);
  assert.ok(codes(flexHost).includes("HZ02"), "flex items are blockified: still broken");
});

test("real-world: dir is never added to custom components; wrapper components own their children's direction", () => {
  const src = H + `const Fa = ({ children }: { children: React.ReactNode }) => <span dir="rtl" lang="fa">{children}</span>;
const Layer = ({ children }: { children: React.ReactNode }) => <AbsoluteFill>{children}</AbsoluteFill>;
export const A = () => <Layer><Fa>سلام</Fa></Layer>;`;
  const r = T(src);
  assert.doesNotMatch(r.code, /<Fa [^>]*dir=/, "no dir prop on <Fa>");
  assert.doesNotMatch(r.code, /<Layer [^>]*dir=/, "no dir prop on <Layer>");
  assert.ok(!codes(r).includes("HZ03"), r.code);
});

test("real-world: JSX-valued expressions and Latin-only labels are not Arabic text sites", () => {
  const r = T(H + `const body = <p dir="rtl" lang="ar">مرحبا</p>;
const it = { show: () => <em dir="rtl">نص</em> };
const label = "WEEKLY ROUNDUP";
export const A = () => <AbsoluteFill><div>{body}</div><div>{it.show()}</div><div style={{ letterSpacing: 6 }}>{label}</div></AbsoluteFill>;`);
  assert.ok(!codes(r).includes("HZ03"), r.code);
  assert.ok(!codes(r).includes("HZ07"), "letterSpacing on Latin-only text is fine");
});

test("real-world: Latin model names with non-breaking hyphens keep their digits", () => {
  const r = T(H + `export const A = () => <AbsoluteFill dir="rtl" lang="ar"><p>إطلاق GPT\u20115 اليوم و 3 ميزات</p></AbsoluteFill>;`);
  assert.match(r.code, /GPT\u20115/);
  assert.match(r.code, /٣ ميزات/);
});

test("real-world: fonts loaded with FontFace / @font-face count as loaded", () => {
  const r = T(H + `const f = new FontFace("Vazirmatn", "url(/fonts/Vazirmatn.woff2)");
export const A = () => <AbsoluteFill dir="rtl" lang="fa" style={{ fontFamily: "Vazirmatn" }}><p>سلام دنیا</p></AbsoluteFill>;`);
  assert.ok(![...r.changes, ...r.reports].some((c) => c.code === "HZ09" && /never loaded|not loaded/i.test(c.en)), r.reports.map((c) => c.en).join("\n"));
});

test("real-world: Next.js <html dir=rtl> makes the whole app RTL (no dir on every component root)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-next-"));
  fs.mkdirSync(path.join(d, "app"));
  fs.writeFileSync(path.join(d, "app", "layout.tsx"), `export default function L({ children }) { return <html lang="ar" dir="rtl"><body>{children}</body></html>; }`);
  fs.writeFileSync(path.join(d, "app", "font.css"), `@font-face { font-family: "Tajawal"; src: url(t.woff2); }`);
  const ctx = projectContext(d, [path.join(d, "app", "layout.tsx")]);
  assert.equal(ctx.rtl, true);
  assert.ok(ctx.fonts.includes("tajawal"));
  const r = T(`export const Hero = () => <section><h1>مرحبا</h1></section>;`, { project: true, rtlContext: ctx.rtl, loadedFonts: ctx.fonts });
  assert.doesNotMatch(r.code, /dir="rtl"/);
});

test("real-world: Tailwind fixes carry per-token rule codes", () => {
  const r = T(`export const A = () => <div dir="rtl" lang="ar" className="tracking-widest uppercase text-left break-all">مرحبا بكم</div>;`);
  const c = r.changes.map((x) => x.code);
  for (const k of ["HZ07", "HZ08", "HZ06", "HZ18"]) assert.ok(c.includes(k), `${k} in ${c.join(",")}`);
});

test("real-world: harakah-ignore comments suppress findings", () => {
  const base = `<div style={{ display: "inline-block" }}>{"مرحبا".split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</div>`;
  const on = T(H + `export const A = () => <AbsoluteFill dir="rtl" lang="ar">${base}</AbsoluteFill>;`);
  assert.ok(codes(on).includes("HZ02"));
  const nextLine = T(H + `export const A = () => (<AbsoluteFill dir="rtl" lang="ar">\n{/* harakah-ignore-next-line */}\n${base}</AbsoluteFill>);`);
  assert.ok(!codes(nextLine).includes("HZ02"), nextLine.code);
  const file = T(`// harakah-disable-file\n` + H + `export const A = () => <AbsoluteFill>${base}</AbsoluteFill>;`);
  assert.equal(file.changes.length + file.reports.length, 0);
});

test("real-world HTML: digits-only LTR inputs, .children collections, and per-family Thmanyah warnings", () => {
  const a = analyze(`<html lang="ar" dir="rtl"><body>
<p>مرحبا بكم في الصفحة</p><input dir="ltr" value="0501234567"><div id="ticks"></div>
<script>Array.from(document.getElementById("ticks").children).forEach((t) => t.remove());</script></body></html>`);
  assert.ok(!a.issues.some((i) => i.code === "HZ03"), "a digits-only LTR field is not an RTL miss");
  assert.ok(!a.issues.some((i) => i.code === "HZ02"), "Array.from(el.children) is not a text split");
  const t = analyze(`<html lang="ar" dir="rtl"><head><style>@font-face{font-family:"Thmanyah Sans";src:url(fonts/thmanyah-sans.woff2)}
h1,h2,p{font-family:"Thmanyah Sans"}</style></head><body><h1>عنوان</h1><h2>فرعي</h2><p>نص</p></body></html>`);
  const hz10 = t.issues.filter((i) => i.code === "HZ10");
  assert.equal(hz10.length, 1, "one finding per family, not per element");
  assert.equal(hz10[0].severity, "warning", "a local project font file is a warning (local use is allowed)");
  const web = analyze(`<html lang="ar" dir="rtl"><head><style>@font-face{font-family:"Thmanyah Sans";src:url(https://cdn.example.com/thmanyah.woff2)}
p{font-family:"Thmanyah Sans"}</style></head><body><p>نص</p></body></html>`);
  assert.equal(web.issues.find((i) => i.code === "HZ10")?.severity, "error", "hosting Thmanyah on the web stays an error");
});

test("real-world HTML: @font-face in a local linked stylesheet is read when baseDir is given (CLI only)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-link-"));
  fs.writeFileSync(path.join(d, "site.css"), `@font-face { font-family: "Vazirmatn"; src: url(Vazirmatn.woff2); }\nbody { font-family: "Vazirmatn"; }`);
  const html = `<html lang="fa" dir="rtl"><head><link rel="stylesheet" href="site.css"></head><body><p>سلام دنیا</p></body></html>`;
  const withBase = analyze(html, { baseDir: d });
  assert.ok(!withBase.issues.some((i) => i.code === "HZ09"), withBase.issues.map((i) => i.code + " " + i.message.en).join("\n"));
  const remote = analyze(`<html lang="fa" dir="rtl"><head><link rel="stylesheet" href="https://example.com/x.css"></head><body><p>سلام</p></body></html>`, { baseDir: d });
  assert.ok(Array.isArray(remote.issues), "remote stylesheets are ignored, not fetched");
});

test("real-world: HZ17 scales with how vocalized the text is", () => {
  const lh = (style: string, text: string) => analyze(`<html lang="ar" dir="rtl"><body><div style="font-size:40px;${style}">${text}</div></body></html>`).issues.filter((i) => i.code === "HZ17");
  assert.equal(lh("line-height:1.55", "لماذا صحيحة؟ الرقمان الأخيران بلا باقٍ فيقبل القسمة على أربعة").length, 0, "one tanween in a callout at 1.55 is fine");
  assert.equal(lh("line-height:1.55", "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ").length, 1, "full tashkeel still needs ~1.8");
  assert.equal(lh("line-height:1.1;display:flex", "<span>أكاديمية</span><span>قُدرة</span>").length, 0, "single-line flex row of words");
  const two = lh("line-height:1.15", "جرّب القاعدة بيدك الآن قبل أن تنتهي المهلة");
  assert.equal(two.length, 1, "sparse marks on wrapping text at 1.15 still collide");
  assert.match(two[0].message.en, /line-height:1\.5/);
  const r = T(H + `export const A = () => <AbsoluteFill dir="rtl" lang="fa"><p style={{ lineHeight: 1.3 }}>کتابِ من</p><p style={{ lineHeight: 1.2 }}>بِسْمِ اللَّهِ الرَّحْمَٰنِ</p></AbsoluteFill>;`);
  assert.doesNotMatch(r.code, /lineHeight: 1\.3 \/\*|room for tashkeel \(was 1\.3\)/, "an ezafe kasra at 1.3 is fine");
  assert.match(r.code, /1\.8 \/\* harakah: room for tashkeel \(was 1\.2\)/);
});

test("real-world: `check <folder>` also scans HTML compositions in the folder", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-folder-"));
  fs.mkdirSync(path.join(d, "examples"));
  fs.writeFileSync(path.join(d, "examples", "card.html"), `<html><body><h1 style="letter-spacing:4px">مرحبا بكم</h1></body></html>`);
  fs.writeFileSync(path.join(d, "examples", "latin.html"), `<html><body><h1>Hello</h1></body></html>`);
  const { execFileSync } = await import("node:child_process");
  let out = "";
  try { out = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "..", "dist", "cli.js"), "check", d, "--json"], { encoding: "utf8" }); } catch (e: any) { out = e.stdout; }
  const rep = JSON.parse(out);
  assert.equal(rep.files, 1, "the Arabic HTML file is scanned, the Latin one skipped");
  const codes = rep.results.flatMap((x: any) => x.issues.map((i: any) => i.code));
  assert.ok(codes.includes("HZ07") && codes.includes("HZ03"), codes.join(","));
});

test("suppression comments in HTML: element subtree, rule codes, whole file", () => {
  const page = (body: string, head = "") => `<html lang="ar" dir="rtl"><head>${head}</head><body>${body}</body></html>`;
  const demo = `<h2 style="letter-spacing:6px;text-transform:uppercase">قبل الإصلاح 12</h2>`;
  const codes = (h: string) => analyze(h).issues.map((i) => i.code);
  assert.ok(codes(page(demo)).includes("HZ07"));
  assert.ok(!codes(page(`<!-- harakah-ignore -->\n<section>${demo}</section>`)).some((c) => ["HZ07", "HZ08", "HZ12"].includes(c)), "whole subtree, incl. aggregated digits");
  const onlyTracking = codes(page(`<!-- harakah-ignore HZ07 -->${demo}`));
  assert.ok(!onlyTracking.includes("HZ07") && onlyTracking.includes("HZ08"), onlyTracking.join(","));
  assert.ok(!codes(page(demo, `<style>/* harakah-disable-file HZ07 */</style>`)).includes("HZ07"));
  assert.equal(analyze(page(demo) + "<!-- harakah-disable-file -->").issues.length, 0);
  // the fix leaves an ignored demo byte-for-byte alone and still fixes the rest
  const r = fix(page(`<!-- harakah-ignore -->${demo}<p style="letter-spacing:3px">نص 7</p>`));
  assert.match(r.html, /<h2 style="letter-spacing:6px;text-transform:uppercase">قبل الإصلاح 12<\/h2>/);
  assert.match(r.html, /<p style="letter-spacing:\s*0[^"]*">نص ٧<\/p>/);
});

test("suppression comments in TSX accept rule codes", () => {
  const src = H + `export const A = () => <AbsoluteFill dir="rtl" lang="ar">\n{/* harakah-ignore-next-line HZ07 */}\n<h2 style={{ letterSpacing: 6, textTransform: "uppercase" }}>عنوان</h2></AbsoluteFill>;`;
  const r = T(src);
  assert.ok(!codes(r).includes("HZ07") && codes(r).includes("HZ08"), codes(r).join(","));
  assert.ok(!codes(T(`// harakah-disable-file HZ08\n` + src)).includes("HZ08"));
});

test("CSS custom properties: var() resolves through :root and ancestors, with fallbacks", () => {
  const html = `<html lang="ar" dir="rtl"><head><style>
:root { --tracking: 0.2em; --case: uppercase; --font-display: Inter, sans-serif; --align: left; --t2: var(--tracking) }
.card { --lh: 1.1 }
.kicker { letter-spacing: var(--t2); text-transform: var(--case); font-family: var(--font-display); text-align: var(--align) }
.quote { line-height: var(--lh, 2) }
.fallback { letter-spacing: var(--nope, 4px) }
.zero { --tracking: normal; letter-spacing: var(--tracking) }
</style></head><body><div class="card"><p class="kicker">مرحبا بكم</p><p class="quote">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p></div>
<p class="fallback">نص آخر</p><p class="zero">نص ثالث</p><p class="kicker" lang="en" dir="ltr">LATIN</p></body></html>`;
  const a = analyze(html);
  const at = (code: string) => a.issues.filter((i) => i.code === code).map((i) => i.where).join(" | ");
  assert.match(at("HZ07"), /p\.kicker/, "nested var(--t2) → var(--tracking) → 0.2em");
  assert.match(at("HZ07"), /p\.fallback/);
  assert.doesNotMatch(at("HZ07"), /p\.zero/, "a token that resolves to normal is fine (it was flagged before var() resolution)");
  assert.match(at("HZ08"), /kicker/);
  assert.match(at("HZ06"), /kicker/);
  assert.match(at("HZ09"), /kicker/, "font stack behind a variable is classified");
  assert.match(at("HZ17"), /quote/, "--lh inherited from .card");
  const r = fix(html);
  assert.match(r.html, /<p class="kicker" lang="en" dir="ltr">LATIN<\/p>/, "Latin use of the same tokens untouched");
  assert.deepEqual(r.remaining.filter((i) => ["HZ06", "HZ07", "HZ08", "HZ17"].includes(i.code)), []);
});
