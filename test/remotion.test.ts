import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { transformSource, fixCssText } from "../src/remotion/codemod.ts";
import { fixRemotion } from "../src/remotion/project.ts";
import { splitArabic, formatDigits, isolateLatin } from "../packages/remotion-arabic/src/index.tsx";

const FIX = path.resolve("fixtures/remotion");
const BROKEN = fs.readdirSync(path.join(FIX, "src/broken")).filter((f) => f.endsWith(".tsx")).sort();
const SNAP = path.resolve("test/__snapshots__/remotion");
const opts = { helperImport: "./harakah-arabic" };
const T = (src: string, o = {}) => transformSource(src, { ...opts, ...o });
const read = (f: string) => fs.readFileSync(path.join(FIX, "src", f), "utf8");

/* ---------- splitArabic / formatDigits ---------- */
test("splitArabic: ZWJ-padded graphemes, لا kept, diacritics attached, spaces kept", () => {
  const t = splitArabic("لا إله");
  assert.deepEqual(t, ["لا", " ", "إ", "ل\u200D", "\u200Dه"]);
  assert.equal(splitArabic("سلام").join("").replace(/\u200D/g, ""), "سلام");
  const s = splitArabic("يُسْرًا");
  assert.ok(s[0].startsWith("ي") && s[0].includes("\u064F"), "damma stays on its letter");
  assert.equal(s.length, 4);
  assert.deepEqual(splitArabic("Hi!"), ["H", "i", "!"]);
});
test("splitArabic: word mode and ZWJ only between joining letters", () => {
  assert.deepEqual(splitArabic("سنة من", "word"), ["سنة", " ", "من"]);
  assert.deepEqual(splitArabic("دار"), ["د", "ا", "ر"], "right-joining letters do not join forward");
  assert.deepEqual(splitArabic("بيت"), ["ب\u200D", "\u200Dي\u200D", "\u200Dت"]);
});
test("formatDigits: numbers, strings with Latin runs, western", () => {
  assert.equal(formatDigits(1250000), "١٬٢٥٠٬٠٠٠");
  assert.equal(formatDigits("الحلقة 48 على iPhone 17"), "الحلقة ٤٨ على iPhone 17");
  assert.equal(formatDigits("٤٨ حلقة", "western"), "48 حلقة");
  assert.equal(isolateLatin("على Spotify"), "على \u2068Spotify\u2069");
});

/* ---------- codemod snapshots + idempotence ---------- */
for (const f of BROKEN) {
  test(`codemod snapshot: ${f}`, () => {
    const r = T(read(`broken/${f}`), { fileName: f });
    assert.ok(r.changed, "broken fixture must change");
    const snap = path.join(SNAP, f);
    if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snap)) fs.writeFileSync(snap, r.code);
    assert.equal(r.code, fs.readFileSync(snap, "utf8"));
  });
  test(`codemod idempotent: ${f}`, () => {
    const once = T(read(`broken/${f}`), { fileName: f }).code;
    const twice = T(once, { fileName: f });
    assert.equal(twice.code, once);
    assert.equal(twice.changes.length, 0);
  });
}

/* ---------- specific rewrites ---------- */
test("codemod: all split idioms → splitArabic, comment markers present", () => {
  const all = BROKEN.map((f) => T(read(`broken/${f}`)).code).join("\n");
  const code = all.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.split\(\s*["']{2}\s*\)|Array\.from\(title\)|\[\.\.\.label\]/.test(code));
  assert.match(all, /\/\* harakah: was text\.split\(""\) \*\/ splitArabic\(text\)/);
  assert.match(all, /splitArabic\(title\)/);
  assert.match(all, /splitArabic\(label\)/);
});
test("codemod: --split word passes the word mode", () => {
  assert.match(T(read("broken/CharSplitTitle.tsx"), { split: "word" }).code, /splitArabic\(text, "word"\)/);
});
test("codemod: fonts swapped (display → Alexandria, text → IBM Plex Sans Arabic), weights clamped, arabic subset", () => {
  const c = T(read("broken/YearInReview.tsx")).code;
  assert.match(c, /from "@remotion\/google-fonts\/Alexandria"; \/\/ harakah: was Montserrat/);
  assert.match(c, /from "@remotion\/google-fonts\/IBMPlexSansArabic"; \/\/ harakah: was Inter/);
  assert.match(T(read("broken/CharSplitTitle.tsx")).code, /weights: \["700"\], subsets: \["arabic", "latin"\]/);
  assert.match(T(read("broken/SpreadStats.tsx")).code, /loadFont\("normal", \{ weights: \[[^\]]+\], subsets: \["arabic", "latin"\] \}\)/);
  assert.match(T(read("broken/YearInReview.tsx"), { font: "plex" }).code, /google-fonts\/IBMPlexSansArabic"; \/\/ harakah: was Montserrat/);
});
test("codemod: digits (eastern default, western, keep) and toLocaleString", () => {
  const c = T(read("broken/YearInReview.tsx")).code;
  assert.match(c, /حصاد مساحة ٢٠٢٦/);
  assert.match(c, /\{formatDigits\(listeners\)\}/);
  assert.match(c, /\{formatDigits\(episodes\)\}/);
  const s = T(read("broken/SpreadStats.tsx")).code;
  assert.match(s, /الحلقة \$\{formatDigits\(episode\)\}/);
  const w = T(`export const A = () => <div>الحلقة ٤٨</div>;`, { digits: "western" }).code;
  assert.match(w, /الحلقة 48/);
  const k = T(`export const A = () => <div dir="rtl" lang="ar">الحلقة 48</div>;`, { digits: "keep" });
  assert.equal(k.changed, false);
  const loc = T(`const n = 5; export const A = () => <div dir="rtl">عدد {n.toLocaleString("ar-SA")}</div>;`).code;
  assert.match(loc, /"ar-SA-u-nu-arab"/);
});
test("codemod: escapes, entities and Latin runs keep their digits", () => {
  const src = `export const A = () => <div dir="rtl" lang="ar">{"نص \\u0031 iPhone 17 و 5"} &#8206; الإصدار 2</div>;`;
  const c = T(src).code;
  assert.match(c, /\\u0031/);
  assert.match(c, /iPhone 17/);
  assert.match(c, /&#8206;/);
  assert.match(c, /الإصدار ٢/);
  assert.match(c, /و ٥/);
});
test("codemod: bidi isolation in JSX text (<bdi>) and strings (FSI/PDI)", () => {
  assert.match(T(read("broken/YearInReview.tsx")).code, /<bdi>Spotify<\/bdi> و <bdi>Apple Podcasts<\/bdi>/);
  assert.match(T(read("broken/SpreadStats.tsx")).code, /\\u2068Spotify\\u2069 و \\u2068Apple Podcasts\\u2069/);
  assert.doesNotMatch(T(read("broken/YearInReview.tsx"), { bidi: false }).code, /<bdi>/);
});
test("codemod: style fixes: letterSpacing, textTransform, textAlign, direction, wordBreak", () => {
  const a = T(read("broken/ArrayFromKicker.tsx")).code;
  assert.match(a, /letterSpacing: 0 \/\* harakah: letterSpacing removed for Arabic \(was spacing\) \*\//);
  assert.match(a, /textTransform: "none"/);
  const s = T(read("broken/SpreadStats.tsx")).code;
  assert.match(s, /textAlign: "start"/);
  assert.match(s, /direction: "rtl"/);
  assert.match(T(read("broken/QuranQuote.tsx")).code, /wordBreak: "normal"/);
});
test("codemod: lineHeight with tashkeel fixed; inside a clipping box it is report-only", () => {
  const ok = T(`export const A = () => <p style={{ lineHeight: 1.1 }}>إِنَّ مَعَ الْعُسْرِ</p>;`).code;
  assert.match(ok, /lineHeight: 1\.8/);
  const r = T(read("broken/QuranQuote.tsx"));
  assert.match(r.code, /lineHeight: 1,/);
  assert.ok(r.reports.some((x) => x.code === "HZ17" && /minHeight/.test(x.en)));
});
test("codemod: styled-components template and Tailwind className", () => {
  const c = T(read("broken/StyledTitle.tsx")).code;
  assert.match(c, /letter-spacing: 0; \/\* harakah: was 0\.3em \*\//);
  assert.match(c, /text-transform: none;/);
  const tw = T(`export const A = () => <h1 className="tracking-widest uppercase text-left font-bold">عنوان</h1>;`).code;
  assert.match(tw, /className="tracking-normal normal-case text-start font-bold"/);
  const css = fixCssText(".t{letter-spacing:.12em;text-transform:uppercase;text-align:left}");
  assert.equal(css.notes.length, 3, "minified CSS, last declaration without semicolon");
  assert.equal(fixCssText(css.text).notes.length, 0, "CSS fix is idempotent");
  assert.match(fixCssText(".t{ letter-spacing: .12em; }").text, /letter-spacing: 0;/);
});
test("codemod: helper import merged into an existing import", () => {
  const src = `import { formatDigits } from "./harakah-arabic";\nexport const A = () => { const t = "سلام"; return <div dir="rtl" lang="ar">{t.split("").map((c) => <span style={{ display: "inline-block" }}>{c}</span>)}</div>; };`;
  const c = T(src).code;
  assert.match(c, /import \{ formatDigits, splitArabic \} from "\.\/harakah-arabic";/);
  assert.equal((c.match(/harakah-arabic/g) || []).length, 1);
});

/* ---------- no false positives ---------- */
test("no false positives: clean Arabic composition and Root are untouched", () => {
  for (const f of ["clean/CleanTitle.tsx", "clean/ArabicTextDemo.tsx", "Root.tsx", "index.ts"]) {
    const r = T(read(f));
    assert.equal(r.changed, false, f);
    assert.equal(r.reports.length, 0, f);
  }
});
test("no false positives: Latin-only compositions, non-string spreads, generic Array.from", () => {
  const latin = `import { loadFont } from "@remotion/google-fonts/Inter";\nconst { fontFamily } = loadFont();\nexport const A = () => <div style={{ letterSpacing: 4, textTransform: "uppercase", textAlign: "left" }}>{"HELLO 2026".split("").map((c, i) => <span key={i}>{c}</span>)}</div>;`;
  assert.equal(T(latin).changed, false);
  const arabicMisc = `export const A = () => { const xs = [1, 2]; const ys = [...xs]; const zs = Array.from({ length: 3 }); return <div dir="rtl" lang="ar" style={{ fontFamily: "Cairo" }}>{ys.length}{zs.length} مرحبا</div>; };`;
  const r = T(arabicMisc, { digits: "keep" });
  assert.doesNotMatch(r.code, /splitArabic/);
});

/* ---------- project driver ---------- */
test("fixRemotion: project copy compiles (tsc), helper vendored, CSS module fixed, idempotent", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-rem-"));
  const r = await fixRemotion(FIX, { out });
  assert.equal(r.helper?.mode, "vendor");
  assert.ok(fs.existsSync(path.join(out, "src/harakah-arabic.tsx")));
  assert.match(fs.readFileSync(path.join(out, "src/broken/Title.module.css"), "utf8"), /letter-spacing: 0;/);
  assert.match(fs.readFileSync(path.join(out, "src/broken/YearInReview.tsx"), "utf8"), /from "\.\.\/harakah-arabic"/);
  execFileSync(path.join(FIX, "node_modules/.bin/tsc"), ["--noEmit", "-p", out], { stdio: "pipe" });
  const again = await fixRemotion(out, { dryRun: true });
  assert.equal(again.files.filter((f) => f.after !== f.before).length, 0, "second run changes nothing");
  assert.equal(again.css.filter((c) => c.after !== c.before).length, 0);
  fs.rmSync(out, { recursive: true, force: true });
});
test("fixRemotion: package mode imports @harakah/remotion-arabic", async () => {
  const r = await fixRemotion(path.join(FIX, "src/broken/CharSplitTitle.tsx"), { dryRun: true, helper: "package" });
  assert.match(r.files[0].after, /from "@harakah\/remotion-arabic"/);
  assert.match(r.files[0].diff, /^\+.*splitArabic\(text\)/m);
});

test("vendored fixture helper is in sync with packages/remotion-arabic", () => {
  const pkg = fs.readFileSync("packages/remotion-arabic/src/index.tsx", "utf8");
  const vendored = fs.readFileSync(path.join(FIX, "src/harakah-arabic.tsx"), "utf8");
  assert.equal(vendored.slice(vendored.indexOf("\n") + 1), pkg);
});

/* ---------- Arabic separators ٬ ٫ (U+066C / U+066B) ---------- */
import { normalizeDigits } from "../src/arabic.ts";
test("eastern digits always use ٬ (U+066C) and ٫ (U+066B), never Latin , or .", () => {
  assert.equal(formatDigits(1250000), "١٬٢٥٠٬٠٠٠");
  assert.equal(formatDigits(1234.5), "١٬٢٣٤٫٥");
  assert.equal(formatDigits(0.25, "eastern", { style: "percent" }), "٢٥٪");
  assert.equal(formatDigits(-1250000.75, "eastern", { maximumFractionDigits: 1 }), "-١٬٢٥٠٬٠٠٠٫٨");
  assert.equal(formatDigits(1250000, "western"), "1,250,000");
  for (const n of [0, 7, 999, 1000, 12345.678, 1e9]) assert.doesNotMatch(formatDigits(n), /[,.0-9]/, `formatDigits(${n})`);
  // strings, incl. Eastern digits typed with Latin separators
  assert.equal(formatDigits("أكثر من 1,250,000 مستمع و2.5 ساعة"), "أكثر من ١٬٢٥٠٬٠٠٠ مستمع و٢٫٥ ساعة");
  assert.equal(formatDigits("عدد ١,٢٥٠,٠٠٠ و٢.٥"), "عدد ١٬٢٥٠٬٠٠٠ و٢٫٥");
  assert.equal(formatDigits("١٬٢٥٠٬٠٠٠", "western"), "1,250,000");
  assert.equal(normalizeDigits("١,٢٥٠ و 3.5%", "eastern"), "١٬٢٥٠ و ٣٫٥٪");
  assert.equal(normalizeDigits("نسخة 1,2,3", "eastern"), "نسخة ١,٢,٣", "a list is not a thousands group");
});
test("codemod: Latin separators between Eastern digits → ٬ ٫; idempotent", () => {
  const r = transformSource(`export const A = () => <div dir="rtl" lang="ar">عدد ١,٢٥٠,٠٠٠ مستمع و٢.٥ ساعة</div>;`, {});
  assert.match(r.code, /١٬٢٥٠٬٠٠٠ مستمع و٢٫٥/);
  assert.equal(transformSource(r.code, {}).code, r.code);
});
test("codemod: withArabicSeparators wraps Alexandria only when it shows grouped digits", () => {
  const shows = `import { loadFont } from "@remotion/google-fonts/Alexandria";
import { formatDigits } from "./harakah-arabic";
const { fontFamily: display } = loadFont("normal", { weights: ["800"], subsets: ["arabic"] });
export const A = ({ n }: { n: number }) => <div dir="rtl" lang="ar" style={{ fontFamily: display }}>{formatDigits(n)} مستمع</div>;
`;
  const r = transformSource(shows, { helperImport: "./harakah-arabic" });
  assert.match(r.code, /withArabicSeparators\(loadFont\("normal"/);
  assert.match(r.code, /import \{ formatDigits, withArabicSeparators \} from "\.\/harakah-arabic"/);
  assert.equal(transformSource(r.code, { helperImport: "./harakah-arabic" }).code, r.code, "idempotent");
  // Alexandria only styles the title; digits are in another font → untouched
  const titleOnly = shows.replace(`style={{ fontFamily: display }}>{formatDigits(n)} مستمع</div>`, `><h1 style={{ fontFamily: display }}>حكايات</h1><p>{formatDigits(n)}</p></div>`);
  assert.doesNotMatch(transformSource(titleOnly, { helperImport: "./harakah-arabic" }).code, /withArabicSeparators/);
  // western digits → no wrap
  assert.doesNotMatch(transformSource(shows, { helperImport: "./harakah-arabic", digits: "western" }).code, /withArabicSeparators/);
});
