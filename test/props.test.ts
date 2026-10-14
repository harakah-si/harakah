// Props-aware Arabic detection (Arabic arriving via props / defaultProps / <Composition defaultProps>)
// and the optional keep-words-together (--wrap-words) codemod mode.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
import { analyzeArabicProps } from "../src/remotion/props.ts";
import { transformSource as T } from "../src/remotion/codemod.ts";
import { fixRemotion, listSources } from "../src/remotion/project.ts";
import { CHROME } from "../src/render.ts";

const FIX = path.resolve("fixtures/remotion");
const read = (f: string) => fs.readFileSync(path.join(FIX, "src", f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

test("props: <Composition defaultProps> feeds PropsTitle; its kicker flows into <Kicker> in another file", () => {
  const files = listSources(FIX).map((file) => ({ file, src: fs.readFileSync(file, "utf8") }));
  const r = analyzeArabicProps(files);
  const all = [...r.values()].flat();
  const by = Object.fromEntries(all.map((x) => [x.component, x]));
  assert.deepEqual(Object.keys(by).sort(), ["Kicker", "PropsTitle"]);
  assert.deepEqual(by.PropsTitle.props.sort(), ["kicker", "title"]);
  assert.match(by.PropsTitle.reasons.join(), /Composition id="PropsTitle"> defaultProps \(Root\.tsx\)/);
  assert.deepEqual(by.Kicker.props, ["label"]);
  assert.match(by.Kicker.reasons[0], /PropsTitle .* → <Kicker>/);
});

test("props: project fix rewrites the props-fed components; Root.tsx registration is not flagged", async () => {
  const r = await fixRemotion(FIX, { dryRun: true });
  const get = (n: string) => r.files.find((f) => f.file.endsWith(n))!;
  assert.match(get("props/PropsTitle.tsx").after, /splitArabic\(title\)/);
  assert.match(get("props/PropsTitle.tsx").after, /google-fonts\/IBMPlexSansArabic/);
  const k = strip(get("props/Kicker.tsx").after);
  assert.match(k, /letterSpacing: 0/);
  assert.match(k, /textTransform: "none"/);
  assert.match(k, /dir="rtl"/);
  assert.equal(get("Root.tsx").issues.length, 0, "registration props are not rendered DOM");
  assert.equal(get("clean/CleanTitle.tsx").after, get("clean/CleanTitle.tsx").before);
  assert.ok(r.props.some((p) => p.component === "PropsTitle"));
  // a lone file still sees Root.tsx through the Remotion root
  const lone = await fixRemotion(path.join(FIX, "src/props/Kicker.tsx"), { dryRun: true });
  assert.match(strip(lone.files[0].after), /letterSpacing: 0/);
});

test("props: same-file usages, X.defaultProps, zod schema defaults, renames, props.x, spreads, memo", () => {
  const base = (body: string) => `import React from "react";\nimport { z } from "zod";\n${body}`;
  const splitComp = (name: string, param: string, expr: string) => `const ${name} = (${param}) => <div>{${expr}.split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</div>;\n`;
  const cases: [string, string, RegExp][] = [
    ["attr literal", splitComp("Title", "{ text }: { text: string }", "text") + `export const Scene = () => <Title text="مرحبا بكم" />;`, /splitArabic\(text\)/],
    ["const ref", splitComp("Title", "{ text }: { text: string }", "text") + `const COPY = "أهلاً";\nexport const Scene = () => <Title text={COPY} />;`, /splitArabic\(text\)/],
    ["renamed", splitComp("Title", "{ text: t }: { text: string }", "t") + `export const Scene = () => <Title text="مرحبا" />;`, /splitArabic\(t\)/],
    ["props.x", splitComp("Title", "props: { text: string }", "props.text") + `export const Scene = () => <Title text="مرحبا" />;`, /splitArabic\(props\.text\)/],
    ["defaultProps", splitComp("Title", "{ text }: { text: string }", "text") + `(Title as any).defaultProps = { text: "سلام" };\nTitle.defaultProps = { text: "سلام" };`, /splitArabic\(text\)/],
    ["spread pass-through", splitComp("Inner", "{ label }: { label: string }", "label") + `const Outer = (props: { label: string }) => <Inner {...props} />;\nexport const Scene = () => <Outer label="مساء الخير" />;`, /splitArabic\(label\)/],
    ["memo", `const Title = React.memo(({ text }: { text: string }) => <div>{text.split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</div>);\nexport const Scene = () => <Title text="مرحبا" />;`, /splitArabic\(text\)/],
    ["children", `const Big = ({ children }: { children: string }) => <h1>{children.split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</h1>;\nexport const Scene = () => <Big>مرحبا</Big>;`, /splitArabic\(children\)/],
  ];
  for (const [name, src, re] of cases) assert.match(T(base(src), { fileName: "S.tsx" }).code, re, name);
  // zod schema default via <Composition schema>
  const files = [{ file: "/p/Root.tsx", src: `import { Composition } from "remotion";\nimport { z } from "zod";\nimport { Card } from "./Card";\nconst schema = z.object({ headline: z.string().default("عنوان"), n: z.number() });\nexport const Root = () => <Composition id="c" component={Card} schema={schema} />;` },
                 { file: "/p/Card.tsx", src: `export const Card = ({ headline }: { headline: string }) => <div>{headline}</div>;` }];
  const z = [...analyzeArabicProps(files).values()].flat();
  assert.deepEqual(z.map((x) => [x.component, x.props]), [["Card", ["headline"]]]);
});

test("props: no false positives for Latin props, numbers, or non-forwarded props", () => {
  const src = `import React from "react";
const Title = ({ text, size }: { text: string; size: number }) => <div style={{ letterSpacing: "0.2em" }}>{text.split("").map((c, i) => <span key={i}>{c}</span>)}</div>;
const Logo = ({ size }: { size: number }) => <svg width={size} style={{ letterSpacing: "0.1em" }} />;
const Wrap = ({ label, size }: { label: string; size: number }) => <><Title text={label} size={size} /><Logo size={size} /></>;
export const A = () => <Title text="Hello" size={40} />;
export const B = () => <Wrap label="مرحبا" size={3} />;`;
  const r = [...analyzeArabicProps([{ file: "/x/A.tsx", src }]).values()].flat();
  const by = Object.fromEntries(r.map((x) => [x.component, x.props]));
  assert.deepEqual(by.Wrap, ["label"]);
  assert.deepEqual(by.Title, ["text"]);
  assert.equal(by.Logo, undefined, "Logo only receives a number: not Arabic");
  const latin = `import React from "react";\nconst Title = ({ text }: { text: string }) => <div>{text.split("").map((c, i) => <span key={i}>{c}</span>)}</div>;\nexport const A = () => <Title text="Hello world" />;`;
  assert.equal(T(latin).code, latin);
});

// ---- keep words together
const WRAP_SRC = read("broken/CharSplitTitle.tsx").replace(`display: "flex", `, "width: 560, ");

test("wrap-words: splitArabic(x).map(cb) → mapArabicWords(splitArabic(x), cb); idempotent; replaces the report", () => {
  const def = T(WRAP_SRC);
  assert.ok(def.reports.some((r) => /middle of a word/.test(r.en)), "default: report-only");
  const r = T(WRAP_SRC, { wrapWords: true, helperImport: "./harakah-arabic" });
  assert.match(r.code, /mapArabicWords\(\s*(\/\*[^*]*\*\/\s*)?splitArabic\(text\), \(char, i\) =>/);
  assert.match(r.code, /import \{[^}]*mapArabicWords[^}]*\} from "\.\/harakah-arabic"/);
  assert.ok(!r.reports.some((x) => /middle of a word/.test(x.en)));
  assert.equal(T(r.code, { wrapWords: true, helperImport: "./harakah-arabic" }).code, r.code, "idempotent");
  // variable form, and a callback that uses the array parameter (skipped with a report)
  const v = T(`import React from "react";\nimport { splitArabic } from "./harakah-arabic";\nexport const A = () => { const t = splitArabic("مرحبا بكم"); return <p>{t.map((c, i) => <span key={i}>{c}</span>)}</p>; };`, { wrapWords: true, helperImport: "./harakah-arabic" });
  assert.match(v.code, /mapArabicWords\(t, \(c, i\) =>/);
  const arr = T(`import React from "react";\nimport { splitArabic } from "./harakah-arabic";\nexport const A = () => <p>{splitArabic("مرحبا بكم").map((c, i, all) => <span key={i}>{c}{i < all.length - 1 ? "" : "."}</span>)}</p>;`, { wrapWords: true, helperImport: "./harakah-arabic" });
  assert.doesNotMatch(arr.code, /mapArabicWords/);
  assert.ok(arr.reports.some((x) => /array parameter/.test(x.en)));
  // word split mode doesn't need it
  assert.doesNotMatch(T(WRAP_SRC, { wrapWords: true, split: "word" }).code, /mapArabicWords/);
});

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
after(async () => { await browser?.close(); });

test("wrap-words: in Chrome, per-letter boxes break mid-word; mapArabicWords keeps every word on one line", { timeout: 60_000 }, async () => {
  const req = createRequire(path.join(FIX, "package.json"));
  const React = req("react");
  const { renderToStaticMarkup } = req("react-dom/server");
  const { splitArabic, mapArabicWords } = await import("../packages/remotion-arabic/src/index.tsx");
  const text = "الصبر مفتاح الفرج والعلم نور يضيء الطريق للسائرين";
  const letter = (ch: string, i: number) => React.createElement("span", { key: i, "data-i": i, style: { display: "inline-block" } }, ch === " " ? "\u00A0" : ch);
  const box = (kids: unknown) => renderToStaticMarkup(React.createElement("div", { dir: "rtl", lang: "ar", style: { width: 330, fontSize: 44, lineHeight: 1.5, fontFamily: "HZ Test Plex" } }, kids));
  const tokens = splitArabic(text);
  const plain = box(tokens.map(letter));
  const kept = box(mapArabicWords(tokens, letter));
  const PLEX = fs.readFileSync(path.resolve("assets/fonts/IBMPlexSansArabic-Regular.ttf")).toString("base64");
  browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const brokenWords = async (html: string) => {
    // the bundled OFL font, not a system one: line breaks must not depend on what the machine has installed
    await page.setContent(`<!doctype html><meta charset=utf-8><style>@font-face{font-family:"HZ Test Plex";src:url(data:font/ttf;base64,${PLEX})}</style><body style="margin:0">${html}</body>`);
    await page.evaluate(`document.fonts.load('44px "HZ Test Plex"', "\u0628")`);
    // a string (not a function) so the test transpiler's helpers don't leak into the page
    return page.evaluate(`(() => {
      const toks = ${JSON.stringify(tokens)};
      const tops = [...document.querySelectorAll("[data-i]")].map((e) => Math.round(e.getBoundingClientRect().top));
      const lines = new Set(tops).size;
      let broken = 0, cur = [];
      const flush = () => { if (new Set(cur).size > 1) broken++; cur = []; };
      toks.forEach((t, i) => (/^\\s+$/.test(t) ? flush() : cur.push(tops[i])));
      flush();
      return { lines, broken };
    })()`) as Promise<{ lines: number; broken: number }>;
  };
  const a = await brokenWords(plain), b = await brokenWords(kept);
  assert.ok(a.lines > 1 && b.lines > 1, "text wraps in both");
  assert.ok(a.broken > 0, `plain per-letter boxes should break at least one word (got ${a.broken})`);
  assert.equal(b.broken, 0, "mapArabicWords: no word split across lines");
});

test("accuracy: module-level style objects used by a props-fed component are fixed", () => {
  const src = `import React from "react";\nconst styles = { title: { fontSize: 90, letterSpacing: 6, textTransform: "uppercase" as const } };\nconst unrelated = { letterSpacing: 2 };\nexport const Title = ({ text }: { text: string }) => <h1 style={styles.title}>{text}</h1>;\nexport const Other = () => <p style={unrelated}>Hi</p>;`;
  const out = T(src, { arabicComponents: ["Title"] }).code.split("\n");
  assert.match(out[1], /letterSpacing: 0 .*textTransform: "none"/);
  assert.match(out[2], /letterSpacing: 2 \}/, "a style object only Latin components use stays");
});

test("accuracy: change lines refer to the original file, also for changes made in later passes", () => {
  const src = read("broken/CharSplitTitle.tsx").replace(`display: "flex", `, "width: 560, ");
  const lines = src.split("\n");
  const r = T(src, { wrapWords: true, helperImport: "./harakah-arabic" });
  const at = (code: string, re: RegExp) => r.changes.filter((c) => c.code === code && re.test(c.en)).map((c) => lines[c.line - 1]);
  assert.ok(at("HZ02", /Keep words together/)[0].includes(`text.split("")`), "pass-2 change maps back to the split line");
  assert.ok(at("HZ02", /Per-character split/)[0].includes(`text.split("")`));
  assert.ok(at("HZ09", /no Arabic glyphs/)[0].includes("google-fonts/Inter"));
  assert.ok(at("HZ03", /AbsoluteFill/)[0].includes("<AbsoluteFill"));
});
