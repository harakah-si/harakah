// ROADMAP P0: .astro / .vue / .svelte templates (report-only, original line numbers, project RTL + CSS),
// and className={cn(…)} / clsx / template literals in the codemod className step.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeTemplate, checkTemplates, templateProject, templateToHtml, classTokens, letterLoops } from "../src/templates.ts";
import { checkTarget, gate } from "../src/gate.ts";
import { transformSource } from "../src/remotion/codemod.ts";

const CLI = path.resolve("dist/cli.js");
function project(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-tpl-"));
  fs.writeFileSync(path.join(d, "package.json"), '{"name":"t"}');
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  return d;
}
const LAYOUT = `---\nimport '../styles/global.css';\nconst { lang = 'ar' } = Astro.props;\n---\n<html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>\n  <head><title>x</title></head>\n  <body><slot /></body>\n</html>\n`;
const CSS = `@font-face { font-family: "IBM Plex Sans Arabic"; src: url("/fonts/plex.woff2"); }\nbody { font-family: "IBM Plex Sans Arabic", sans-serif; }\n.display { letter-spacing: .2em; text-transform: uppercase; }\nhtml[dir="rtl"] .display { letter-spacing: 0; text-transform: none; }\n.kick { letter-spacing: .3em; }\n`;
const HERO = `---\nconst title = 'رحلات الصحراء';\n---\n<section class="hero">\n  <h1 class="display">{title}</h1>\n  <p class={cn('kick', active && 'on')}>اكتشف المدينة</p>\n  {items.map((x) => (\n    <span class="chip">{x}</span>\n  ))}\n  <Btn label="x" />\n  <p style="text-align:left">نص محاذى لليسار</p>\n</section>\n`;

test("astro: findings at the template's own lines; class expressions become classes; frontmatter constants become text", () => {
  const d = project({ "src/layouts/Base.astro": LAYOUT, "src/styles/global.css": CSS, "src/components/Hero.astro": HERO });
  const issues = analyzeTemplate(path.join(d, "src/components/Hero.astro"), { digits: "eastern" });
  const at = issues.map((i) => `${i.code}@${i.line}`).sort();
  assert.deepEqual(at, ["HZ06@11", "HZ07@6"], JSON.stringify(issues.map((i) => i.message.en)));
  assert.ok(issues.every((i) => !i.fixable && /reviewable patch/.test(i.message.en)));
  // the project's own html[dir=rtl] .display override is honoured (no HZ07/HZ08 on the {title} heading)…
  assert.ok(!issues.some((i) => i.line === 5));
  // …and without it the heading is reported
  const d2 = project({ "src/layouts/Base.astro": LAYOUT, "src/styles/global.css": CSS.replace(/html\[dir="rtl"\][^\n]*\n/, ""), "src/components/Hero.astro": HERO });
  assert.ok(analyzeTemplate(path.join(d2, "src/components/Hero.astro"), { digits: "eastern" }).some((i) => i.code === "HZ07" && i.line === 5));
});

test("astro: line numbers survive frontmatter, multi-line expressions and self-closing components", () => {
  const p = { root: "/", rtl: true, css: "", files: 0, links: "", shell: true };
  const html = templateToHtml("x.astro", HERO, p);
  assert.equal(html.split("\n").length, HERO.split("\n").length);
  assert.match(html, /<Btn label="x"><\/Btn>/);
  assert.match(html, /<p class="kick on">/);
  assert.match(html, /<h1 class="display">رحلات الصحراء/);
});

test("vue: <template> markup, :class arrays/objects, scoped <style>; {{ }} masked", () => {
  const d = project({
    "index.html": `<!doctype html><html lang="ar" dir="rtl"><head><link href="https://fonts.googleapis.com/css2?family=Cairo" rel="stylesheet"></head><body><div id="app"></div></body></html>`,
    "src/components/Card.vue": `<script setup>\nconst props = defineProps(['title'])\n</script>\n\n<template>\n  <div class="card">\n    <h2 :class="['title', { upper: true }]">{{ props.title }}</h2>\n    <p class="body">مرحبا بكم في الموقع</p>\n    <template v-if="x"><p :class="{ upper: on }">قسم</p></template>\n  </div>\n</template>\n\n<style scoped>\nbody { font-family: Cairo, sans-serif; }\n.upper { text-transform: uppercase; letter-spacing: 1px; }\n.body { letter-spacing: 2px; }\n</style>\n`,
  });
  const issues = analyzeTemplate(path.join(d, "src/components/Card.vue"), { digits: "eastern" });
  const hz07 = issues.filter((i) => i.code === "HZ07").map((i) => i.line).sort();
  assert.deepEqual(hz07, [8, 9], JSON.stringify(issues.map((i) => `${i.code}@${i.line} ${i.message.en}`)));  // nested <template v-if> content is analysed
  assert.ok(!issues.some((i) => i.code === "HZ11" || i.code === "HZ09"), "the index.html Google Fonts link loads Cairo");
});

test("svelte: {#each [...'حركة'] as c} per-letter loop is an error; class:x, quoted {expr} and :global() handled", () => {
  const src = `<script>\n  export let word = 'حركة';\n  let chars = [...word];\n</script>\n\n<h1 class:big={true}>\n  {#each chars as c, i}<span style="display:inline-block">{c}</span>{/each}\n</h1>\n<p class="lead {extra}">النص الأساسي</p>\n\n<style>\n  .lead { font-style: italic; }\n  :global(.big) { word-break: break-all; }\n</style>\n`;
  const d = project({ "src/App.svelte": src, "src/app.html": `<html lang="ar" dir="rtl"><head></head><body></body></html>` });
  const issues = analyzeTemplate(path.join(d, "src/App.svelte"), { digits: "eastern" });
  const loop = issues.find((i) => i.code === "HZ02")!;
  assert.equal(loop.line, 7);
  assert.equal(loop.severity, "error");
  assert.match(loop.message.en, /"حركة" one letter per element/);
  assert.ok(issues.some((i) => i.code === "HZ20" && i.line === 9));
  // loops that aren't letter splits: Array.from({length}), word lists, Latin-only components
  assert.equal(letterLoops("a.svelte", `{#each Array.from({ length: 5 }) as _, i}<i>{i}</i>{/each}<p>نص</p>`).length, 0);
  assert.equal(letterLoops("a.svelte", `<script>let words = 'مرحبا بالعالم'.split(' ');</script>{#each words as w}<span>{w}</span>{/each}`).length, 0);
  assert.equal(letterLoops("a.vue", `<template><span v-for="c in title.split('')">{{ c }}</span></template><script>const title = 'Hello'</script>`).length, 0);
  assert.equal(letterLoops("a.vue", `<template><span v-for="c in title.split('')">{{ c }}</span></template><script>const title = 'مرحبا'</script>`)[0].severity, "error");
  assert.equal(letterLoops("a.astro", `---\nconst t = 'سلام';\n---\n<h1>{[...t].map((c) => <span>{c}</span>)}</h1>`)[0].line, 4);
});

test("project context: Tailwind @theme fonts, tsconfig path aliases, @import chains and @fontsource packages", () => {
  const d = project({
    "tsconfig.json": `{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@styles/*": ["src/styles/*"] } } }`,
    "src/layouts/L.astro": `---\nimport '@styles/global.css';\n---\n<html lang="ar" dir="rtl"><body><slot/></body></html>`,
    "src/styles/global.css": `@import 'tailwindcss';\n@import '@fontsource-variable/alexandria/index.css';\n@import './fonts.css';\n@theme { --font-heading: 'Alexandria Variable', sans-serif; }\nh1 { font-family: var(--font-heading); }`,
    "src/styles/fonts.css": `@theme inline { --font-sans: 'Tajawal', sans-serif; }\nbody { font-family: var(--font-sans); }\n@font-face { font-family: Tajawal; src: url(/t.woff2); }`,
    "src/pages/index.astro": `<h1>عنوان</h1>\n<p>نص</p>`,
  });
  const p = templateProject(d);
  assert.ok(p.rtl && p.shell);
  assert.match(p.css, /font-family:"Alexandria Variable"/);
  assert.match(p.css, /:root\s*\{ --font-sans: 'Tajawal'/);
  const issues = analyzeTemplate(path.join(d, "src/pages/index.astro"), { digits: "eastern" }, p);
  assert.ok(!issues.some((i) => /HZ09|HZ11/.test(i.code)), JSON.stringify(issues.map((i) => i.message.en)));
});

test("folder scan: project-CSS findings on body are reported once; dir=ltr on dynamic content is the author's call", () => {
  const d = project({
    "src/app.css": `body { letter-spacing: -0.01em; font-family: Tajawal, sans-serif; }`,
    "src/main.ts": `import './app.css';`,
    "index.html": `<html lang="ar" dir="rtl"><head></head><body></body></html>`,
    "src/A.svelte": `<p>أول</p>`, "src/B.svelte": `<p>ثاني</p>`, "src/C.svelte": `<div dir="ltr">{price} <span>د.ع</span></div>`,
  });
  const res = checkTemplates(d, { digits: "eastern" });
  const body = res.flatMap((r) => r.issues).filter((i) => i.code === "HZ07");
  assert.equal(body.length, 1);
  assert.match(body[0].message.en, /\[project CSS: same in 3 templates\]/);
  assert.ok(!res.flatMap((r) => r.issues).some((i) => i.code === "HZ03"), "author-set dir=ltr around {price} + currency");
});

test("gate / CLI: templates are scanned in folders and single files; fix emits a patch (nothing to patch for a letter loop)", async () => {
  const d = project({ "src/layouts/Base.astro": LAYOUT, "src/styles/global.css": CSS, "src/components/Split.svelte": `<script>let c = [...'حركة'];</script>\n{#each c as x}<span>{x}</span>{/each}` });
  const files = await checkTarget(d);
  assert.ok(files.some((f) => f.kind === "template" && f.file.endsWith("Split.svelte")));
  const g = await gate(d);
  assert.equal(g.ok, false);
  assert.match(g.fixCommand!, /--patch harakah-templates\.patch/);
  const single = await checkTarget(path.join(d, "src/components/Split.svelte"));
  assert.equal(single[0].issues[0].code, "HZ02");
  let out = "";
  try { execFileSync("node", [CLI, "check", path.join(d, "src/components/Split.svelte"), "--json"], { encoding: "utf8" }); } catch (e: any) { out = e.stdout; assert.equal(e.status, 1); }
  assert.equal(JSON.parse(out).kind, "template");
  // a per-letter loop is not an attribute fix: the patch is empty and the finding stays
  const j = JSON.parse(execFileSync("node", [CLI, "fix", path.join(d, "src/components/Split.svelte"), "--json"], { encoding: "utf8" }));
  assert.equal(j.kind, "template");
  assert.equal(j.patch, "");
  assert.ok(j.results[0].remaining.some((i: any) => i.code === "HZ02"));
});

test("classTokens: literals, object keys, template parts", () => {
  assert.deepEqual(classTokens(`cn('a b', on && "c", { d: x, 'e-f': y }, \`g \${h ? 'i' : ''}\`)`).sort(), ["a", "b", "c", "d", "e-f", "g", "i"]);
});

/* ---------- codemod: className expressions ---------- */

const TSX = `import { cn } from "@/lib/utils";
import clsx from "clsx";
export const T = ({ big, on, size }) => (
  <div>
    <h1 className={cn("text-6xl tracking-widest", big && "uppercase", { "text-left": on, capitalize: big })}>مرحبا بالعالم</h1>
    <p className={\`px-4 \${on ? "tracking-wide" : ""} text-left\`}>نص عربي</p>
    <span className={clsx(["break-all", on ? "font-bold" : "tracking-tight"])}>كلمة</span>
    <b className={cn("tracking-wider rtl:tracking-wide")}>عنوان</b>
    <i className={\`tracking-\${size}\`}>حجم</i>
    <a className={cn("tracking-widest")}>hello@example.com</a>
    <u className={["uppercase", on && "tracking-wide"].join(" ")}>تسطير</u>
  </div>
);`;

test("codemod: cn()/clsx()/template literals/arrays/object keys get Arabic-safe Tailwind tokens, one edit per token", () => {
  const r = transformSource(TSX, {});
  const lines = r.code.split("\n");
  assert.equal(lines[4].trim(), `<h1 className={cn("text-6xl tracking-normal", big && "normal-case", { "text-start": on, "normal-case": big })}>مرحبا بالعالم</h1>`);
  assert.equal(lines[5].trim(), "<p className={`px-4 ${on ? \"tracking-normal\" : \"\"} text-start`}>نص عربي</p>");
  assert.equal(lines[6].trim(), `<span className={clsx(["break-normal", on ? "font-bold" : "tracking-normal"])}>كلمة</span>`);
  assert.equal(lines[7].trim(), `<b className={cn("tracking-wider rtl:tracking-normal")}>عنوان</b>`, "the author's rtl: variant is the thing fixed; LTR keeps tracking-wider");
  assert.equal(lines[8].trim(), "<i className={`tracking-${size}`}>حجم</i>", "a token glued to ${} is left alone");
  assert.equal(lines[9].trim(), `<a className={cn("tracking-widest")}>hello@example.com</a>`, "Latin-only element");
  assert.equal(lines[10].trim(), `<u className={["normal-case", on && "tracking-normal"].join(" ")}>تسطير</u>`);
  const codes = r.changes.filter((c) => /className/.test(c.en)).map((c) => c.code);
  assert.deepEqual([...new Set(codes)].sort(), ["HZ06", "HZ07", "HZ08", "HZ18"]);
  assert.equal(transformSource(r.code, {}).changes.filter((c) => /className/.test(c.en)).length, 0, "idempotent");
});

test("codemod: a variable or cva() className is not touched", () => {
  const src = `const v = "tracking-widest";\nexport const A = () => <h1 className={v}>مرحبا</h1>;\nexport const B = () => <h1 className={button({ intent: "primary" })}>مرحبا</h1>;\n`;
  const r = transformSource(src, {});
  assert.ok(!r.changes.some((c) => /className/.test(c.en)));
});

// Locale files and props: Arabic text that lives outside the template is followed into it.
const LOCALE_UI = `export const ui = {\n  en: { hero: { title: 'Desert tours', kick: 'Explore' } },\n  ar: { hero: { title: 'رحلات الصحراء', kick: 'اكتشف المدينة' } },\n} as const;\n`;
const TCSS = `.kick { letter-spacing: .3em; }\n.up { text-transform: uppercase; }\n`;

test("templates: dictionary paths (const t = ui[lang]) resolve to the Arabic locale branch", () => {
  const page = `---\nimport { ui } from '../i18n/ui';\nimport '../styles/global.css';\nconst lang = 'ar';\nconst t = ui[lang];\n---\n<html lang="ar" dir="rtl"><body>\n  <h1>{t.hero.title}</h1>\n  <p class="kick">{t.hero.kick}</p>\n  <p class="kick">{t.hero.missing}</p>\n</body></html>\n`;
  const d = project({ "src/i18n/ui.ts": LOCALE_UI, "src/styles/global.css": TCSS, "src/pages/index.astro": page });
  const p = templateProject(d);
  assert.equal(p.keys!.get("hero.kick"), "اكتشف المدينة");
  const issues = analyzeTemplate(path.join(d, "src/pages/index.astro"), {}, p);
  assert.deepEqual(issues.filter((i) => i.code === "HZ07").map((i) => i.line), [9], JSON.stringify(issues.map((i) => [i.code, i.line])));
});

test("templates: translation calls in vue ($t) and svelte ($_ / t) use locale JSON keys", () => {
  const vue = `<template>\n  <div dir="rtl" lang="ar">\n    <p class="kick">{{ $t('nav.home') }}</p>\n    <p class="up">{{ t("nav.about") }}</p>\n  </div>\n</template>\n<script setup>\nconst { t } = useI18n();\n</script>\n<style>\n.kick { letter-spacing: .3em; }\n.up { text-transform: uppercase; }\n</style>\n`;
  const svelte = `<div dir="rtl" lang="ar">\n  <p class="kick">{$_('nav.home')}</p>\n</div>\n<style>\n.kick { letter-spacing: .3em; }\n</style>\n`;
  const d = project({ "src/locales/ar.json": JSON.stringify({ nav: { home: "الرئيسية", about: "من نحن" } }), "src/locales/en.json": JSON.stringify({ nav: { home: "Home", about: "About" } }), "src/App.vue": vue, "src/Nav.svelte": svelte });
  const p = templateProject(d);
  const v = analyzeTemplate(path.join(d, "src/App.vue"), {}, p).map((i) => `${i.code}@${i.line}`);
  assert.ok(v.includes("HZ07@3") && v.includes("HZ08@4"), v.join(","));
  const s = analyzeTemplate(path.join(d, "src/Nav.svelte"), {}, p).map((i) => `${i.code}@${i.line}`);
  assert.ok(s.includes("HZ07@2"), s.join(","));
});

test("templates: props passed as Arabic (literal or locale path) reach the component's {prop}", () => {
  const card = `---\nconst { title, label } = Astro.props;\n---\n<article>\n  <h3 class="kick">{title}</h3>\n  <span class="up">{label}</span>\n</article>\n`;
  const vcard = `<template>\n  <h3 class="kick">{{ heading }}</h3>\n</template>\n<script setup>\ndefineProps(['heading']);\n</script>\n<style>\n.kick { letter-spacing: .3em; }\n</style>\n`;
  const page = `---\nimport Card from '../components/Card.astro';\nimport { ui } from '../i18n/ui';\nimport '../styles/global.css';\nconst t = ui['ar'];\n---\n<html lang="ar" dir="rtl"><body>\n  <Card title="جولة المدينة" label={t.hero.kick} />\n  <tour-card :heading="'جولة'" />\n</body></html>\n`;
  const d = project({ "src/i18n/ui.ts": LOCALE_UI, "src/styles/global.css": TCSS, "src/components/Card.astro": card, "src/components/TourCard.vue": vcard, "src/pages/index.astro": page });
  const p = templateProject(d);
  assert.equal(p.props!.get("Card")!.get("label"), "اكتشف المدينة");
  const at = analyzeTemplate(path.join(d, "src/components/Card.astro"), {}, p).map((i) => `${i.code}@${i.line}`);
  assert.ok(at.includes("HZ07@5") && at.includes("HZ08@6"), at.join(","));
  const vat = analyzeTemplate(path.join(d, "src/components/TourCard.vue"), {}, p).map((i) => `${i.code}@${i.line}`);
  assert.ok(vat.includes("HZ07@2"), vat.join(","));
  // no usage → nothing to report
  const d2 = project({ "src/styles/global.css": TCSS, "src/components/Card.astro": card, "src/pages/index.astro": `<html lang="ar" dir="rtl"><body><p>مرحبا</p></body></html>\n` });
  assert.deepEqual(analyzeTemplate(path.join(d2, "src/components/Card.astro"), {}), []);
});

// Template auto-fix as a reviewable patch: position edits on the original source, no serializer round-trip.
import { templatePatch } from "../src/template-patch.ts";
const TWPKG = '{"name":"t","devDependencies":{"tailwindcss":"^4.0.0"}}';
const PCSS = `.label { letter-spacing: .2em; }\n`;
const PCARD = `---\nconst { x } = Astro.props;\n---\n<section>\n  <ul style="display:flex;gap:8px;direction:ltr"><li>بودكاست</li><li>فيديو</li><li>مقال</li></ul>\n  <p class="kick tracking-[.3em] md:uppercase">اكتشف المدينة</p>\n  <p class="label" style="color: red">رحلات</p>\n  <p class="label" style={x}>جولات</p>\n  <Card class="label">بطاقة</Card>\n  <p style="text-align:left">نص محاذى</p>\n</section>\n`;

test("template patch: token swaps, attribute inserts and static style appends; dynamic attributes and components are listed, not touched", () => {
  const d = project({ "package.json": TWPKG, "src/layouts/Base.astro": LAYOUT, "src/styles/global.css": PCSS, "src/components/Card.astro": PCARD });
  const f = path.join(d, "src/components/Card.astro");
  const r = templatePatch(f, {});
  const src = fs.readFileSync(f, "utf8");
  assert.equal(r.fixed.split("\n").length, src.split("\n").length, "line count kept");
  assert.match(r.fixed, /<ul [^>]*direction:\s*rtl|<ul dir="rtl"/, r.patch);
  assert.match(r.fixed, /class="kick tracking-normal md:normal-case"/);
  assert.match(r.fixed, /<p class="label" style="color: red; letter-spacing: 0">/);
  assert.match(r.fixed, /<p style="text-align:start">نص محاذى<\/p>/);
  assert.match(r.fixed, /<p class="label" style=\{x\}>/, "dynamic style untouched");
  assert.match(r.fixed, /<Card class="label">/, "component untouched");
  assert.ok(r.skipped.some((k) => /style is dynamic/.test(k.why)) && r.skipped.some((k) => /component/.test(k.why)), JSON.stringify(r.skipped));
  assert.ok(r.after.length < r.before.length, `${r.before.length} → ${r.after.length}`);
  assert.ok(r.patch.startsWith("===") || r.patch.includes("--- a/src/components/Card.astro"));
  // the patch applies cleanly with git, and a second run has nothing left to patch for the fixed lines
  execFileSync("git", ["init", "-q"], { cwd: d });
  fs.writeFileSync(path.join(d, "fix.patch"), r.patch);
  execFileSync("git", ["apply", "--check", "fix.patch"], { cwd: d });
  execFileSync("git", ["apply", "fix.patch"], { cwd: d });
  assert.equal(fs.readFileSync(f, "utf8"), r.fixed);
  const again = templatePatch(f, {});
  assert.deepEqual(again.edits, [], JSON.stringify(again.edits));
});

test("template patch: vue :class literals and svelte class strings; CLI prints the patch, --write applies it", () => {
  const vue = `<template>\n  <div dir="rtl" lang="ar">\n    <h2 :class="['title', big && 'uppercase']">عنوان</h2>\n  </div>\n</template>\n`;
  const svelte = `<div dir="rtl" lang="ar">\n  <p class="eyebrow tracking-widest {extra}">مرحبا</p>\n</div>\n`;
  const d = project({ "package.json": TWPKG, "src/App.vue": vue, "src/Hi.svelte": svelte });
  assert.match(templatePatch(path.join(d, "src/App.vue"), {}).fixed, /:class="\['title', big && 'normal-case'\]"/);
  assert.match(templatePatch(path.join(d, "src/Hi.svelte"), {}).fixed, /class="eyebrow tracking-normal \{extra\}"/);
  const out = execFileSync("node", [CLI, "fix", path.join(d, "src")], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  assert.match(out, /^-.*tracking-widest/m);
  assert.match(out, /^\+.*tracking-normal/m);
  assert.equal(fs.readFileSync(path.join(d, "src/Hi.svelte"), "utf8"), svelte, "print-only by default");
  execFileSync("node", [CLI, "fix", path.join(d, "src"), "--write"], { encoding: "utf8" });
  assert.match(fs.readFileSync(path.join(d, "src/Hi.svelte"), "utf8"), /tracking-normal/);
  assert.match(fs.readFileSync(path.join(d, "src/App.vue"), "utf8"), /'normal-case'/);
});

test("template patch, text level: digits and <bdi> wraps become edits on the original characters; expression text is listed", () => {
  const astro = `---\nconst { model } = Astro.props;\n---\n<section lang="ar" dir="rtl">\n  <h2>عرض خاص على iPhone 17 بسعر 999 دولار</h2>\n  <p>السعر {model} دينار 25</p>\n  <p>{model ? 'هاتف 12' : 'جهاز'}</p>\n  <p>{model ? 'منتج من Apple' : 'منتج'}</p>\n  <ul style="display:flex"><li>HTML · GSAP · Remotion للحركة</li></ul>\n</section>\n`;
  const vue = `<template>\r\n  <div dir="rtl" lang="ar">\r\n    <p>{{ count }} طلب من أصل 120</p>\r\n    <p>السعر 25&nbsp;&amp; أكثر من Apple 3</p>\r\n  </div>\r\n</template>\r\n<script setup>\r\nconst count = 3\r\n</script>\r\n`;
  const svelte = `<script>let n = 2;</script>\n<div dir="rtl" lang="ar">\n  {#if n}<p>عندك {n} رسائل في Gmail اليوم 30</p>{/if}\n</div>\n`;
  const d = project({ "package.json": '{"name":"t"}', "src/Card.astro": astro, "src/App.vue": vue, "src/Hi.svelte": svelte });
  const a = templatePatch(path.join(d, "src/Card.astro"), {});
  assert.match(a.fixed, /<h2>عرض خاص على <bdi>iPhone 17<\/bdi> بسعر ٩٩٩ دولار<\/h2>/, a.patch);
  assert.match(a.fixed, /<p>السعر \{model\} دينار ٢٥<\/p>/, "text around an expression is patched, the expression kept");
  assert.match(a.fixed, /<li><bdi>HTML<\/bdi> · <bdi>GSAP<\/bdi> · <bdi>Remotion<\/bdi> للحركة<\/li>/);
  assert.match(a.fixed, /\{model \? 'هاتف ١٢' : 'جهاز'\}/, "digits inside a plain string literal are patched in place");
  assert.match(a.fixed, /\{model \? 'منتج من Apple' : 'منتج'\}/, "no <bdi> inside a JS string literal");
  assert.ok(a.skipped.some((k) => k.line === 8 && /string literal/.test(k.why)), JSON.stringify(a.skipped));
  assert.ok(a.edits.some((e) => /^<bdi> \+ digits: iPhone 17 بسعر 999 → <bdi>iPhone 17<\/bdi> بسعر ٩٩٩$/.test(e.what)), JSON.stringify(a.edits.map((e) => e.what)));
  // left: only the Latin run inside the string literal (line 8); no digit finding remains
  assert.deepEqual(a.after.filter((i) => i.code === "HZ13" || i.code === "HZ12").map((i) => `${i.code}@${i.line}`), ["HZ13@8"], JSON.stringify(a.after.map((i) => `${i.code}@${i.line}`)));
  const v = templatePatch(path.join(d, "src/App.vue"), {});
  assert.equal(v.fixed, vue.replace("120", "١٢٠").replace("السعر 25&nbsp;&amp; أكثر من Apple 3", "السعر ٢٥&nbsp;&amp; أكثر من <bdi>Apple 3</bdi>"), "entities and CRLF kept byte for byte");
  const s = templatePatch(path.join(d, "src/Hi.svelte"), {});
  assert.match(s.fixed, /\{#if n\}<p>عندك \{n\} رسائل في <bdi>Gmail<\/bdi> اليوم ٣٠<\/p>\{\/if\}/);
  assert.deepEqual(s.after.filter((i) => i.code === "HZ12" || i.code === "HZ13"), []);
  // --digits keep and --no-bidi turn the text edits off
  assert.equal(templatePatch(path.join(d, "src/Hi.svelte"), { digits: "keep", bidi: false }).edits.length, 0);
  // the patch applies with git, and a second run has nothing left
  execFileSync("git", ["init", "-q"], { cwd: d });
  fs.writeFileSync(path.join(d, "fix.patch"), a.patch + v.patch + s.patch);
  execFileSync("git", ["apply", "fix.patch"], { cwd: d });
  for (const [f, r] of [["src/Card.astro", a], ["src/App.vue", v], ["src/Hi.svelte", s]] as const) {
    assert.equal(fs.readFileSync(path.join(d, f), "utf8"), r.fixed);
    assert.deepEqual(templatePatch(path.join(d, f), {}).edits, [], f);
  }
});
