// Second real-world round (multilingual Next.js/Vite sites, an HTML starter kit with template placeholders, GSAP pages).
// Every snippet is a minimal re-creation written for this repo, not code copied from those projects.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, fix } from "../src/engine.ts";
import { transformSource } from "../src/remotion/codemod.ts";
import { fixRemotion, projectContext } from "../src/remotion/project.ts";
import { i18nValue, loadI18n } from "../src/remotion/i18n.ts";
import { Project, SyntaxKind } from "ts-morph";

const T = (src: string, o: any = {}) => transformSource(src, { helperImport: "./harakah-arabic", ...o });
const project = (files: Record<string, string>) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-rw2-"));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return d;
};
const issuesOf = (f: any) => [...f.result.changes.map((c: any) => ({ ...c, auto: true })), ...f.result.reports.map((c: any) => ({ ...c, auto: false }))];

test("round 2: literal Arabic inside a locale branch is per-locale content (no hardcoded dir/tracking fixes)", () => {
  const src = `export default function Footer() {
  const { t, lang } = useLang();
  return (
    <footer>
      {lang === "ar" ? <span className="text-3xl">قهوتنا</span> : <span className="text-3xl">Our Coffee</span>}
      <h3 className="font-mono uppercase tracking-widest">{t("footer.explore")}</h3>
    </footer>
  );
}`;
  const r = T(src);
  assert.doesNotMatch(r.code, /tracking-normal/, "the h3 also renders English: not rewritten");
  assert.doesNotMatch(r.code, /dir="rtl"/, "no dir hardcoded on a component that renders both languages");
  assert.ok(r.reports.some((x) => x.code === "HZ03"), "direction reported, locale-aware");
});

test("round 2: per element: literal Arabic is fixed, translated text next to it is only reported", () => {
  const src = `export default function Card() {
  const { t } = useLang();
  return (
    <div>
      <span style={{ letterSpacing: 2 }}>المشاريع</span>
      <span style={{ letterSpacing: 2 }}>{t("projects.eyebrow")}</span>
    </div>
  );
}`;
  const keys = new Map([["projects.eyebrow", "العقارات"]]);
  const r = T(src, { i18n: keys, multilingual: true });
  assert.ok(r.changes.some((c) => c.code === "HZ07"), "literal Arabic span fixed");
  assert.ok(r.reports.some((c) => c.code === "HZ07" && /translations/.test(c.en)), "translated span reported");
  assert.equal((r.code.match(/letterSpacing: 2/g) ?? []).length, 1, r.code);
});

test("round 2: an Arabic literal in the ar branch of a ternary is safe to edit (digits)", () => {
  const r = T(`export const Spec = ({ isArabic }) => <p>{isArabic ? "3 غرف" : "3 rooms"}</p>;`);
  assert.match(r.code, /"٣ غرف"/);
  assert.match(r.code, /"3 rooms"/);
});

test("round 2: aliased documentElement dir (const html = document.documentElement) is app-level RTL", () => {
  const d = project({ "src/ctx.tsx": `useEffect(() => { const html = document.documentElement; html.setAttribute("dir", lang === "ar" ? "rtl" : "ltr"); }, [lang]);` });
  assert.equal(projectContext(d, [path.join(d, "src/ctx.tsx")]).rtl, true);
  const ltr = project({ "src/ctx.tsx": `const el = document.documentElement; el.setAttribute("dir", "ltr");` });
  assert.equal(projectContext(ltr, [path.join(ltr, "src/ctx.tsx")]).rtl, false);
});

test("round 2: TS locale modules + dictionary property access (getDictionary / custom useTranslation)", async () => {
  const d = project({
    "package.json": JSON.stringify({ dependencies: { next: "15" } }),
    "src/i18n/locales/ar.ts": `import type { Dict } from "../types";\nexport const ar: Dict = { hero: { kicker: "جديد", brand: "Acme" }, items: ["أول", "ثاني"] } as const;\n`,
    "src/i18n/locales/en.ts": `export const en = { hero: { kicker: "New", brand: "Acme" }, items: ["First", "Second"] };\n`,
    "src/components/Hero.tsx": `import { useTranslation } from "../i18n/useTranslation";
export default function Hero() {
  const { t } = useTranslation();
  return (<section>
    <p className="uppercase tracking-widest">{t.hero.kicker}</p>
    <small className="tracking-widest">{t.hero.brand}</small>
    <i style={{ letterSpacing: 3 }}>{t["items"][0]}</i>
  </section>);
}`,
    "src/components/Promo.tsx": `export function Promo({ dictionary }: { dictionary: any }) { return <b style={{ letterSpacing: 2 }}>{dictionary.kicker}</b>; }`,
  });
  const i = loadI18n(d);
  assert.equal(i.keys.get("hero.kicker"), "جديد");
  assert.equal(i.keys.get("items.1"), "ثاني");
  assert.deepEqual(i.otherLocales, ["en"]);
  const r = await fixRemotion(d, { dryRun: true });
  const hero = issuesOf(r.files.find((f) => f.file.endsWith("Hero.tsx")));
  assert.ok(hero.some((x) => x.code === "HZ07" && x.line === 5 && !x.auto), JSON.stringify(hero));
  assert.ok(hero.some((x) => x.code === "HZ08" && x.line === 5), "uppercase on Arabic kicker");
  assert.ok(!hero.some((x) => x.line === 6), "brand stays Latin in the Arabic locale: not flagged");
  assert.ok(hero.some((x) => x.code === "HZ07" && x.line === 7), "element access t['items'][0]");
  const promo = issuesOf(r.files.find((f) => f.file.endsWith("Promo.tsx")));
  assert.ok(promo.some((x) => x.code === "HZ07"), "a sub-dictionary prop resolves by key suffix");
});

test("round 2: inline locale maps ({ ar: {…}, en: {…} }) and t(section, key) helpers", async () => {
  const d = project({
    "package.json": JSON.stringify({ dependencies: { react: "19", vite: "6" } }),
    "src/i18n/Lang.jsx": `const translations = { ar: { about: { eyebrow: "من نحن" } }, en: { about: { eyebrow: "ABOUT" } } };
export const useLanguage = () => ({ t: (s, k) => translations.ar[s][k] });`,
    "src/pages/About.jsx": `import { useLanguage } from "../i18n/Lang";
export default function About() {
  const { t } = useLanguage();
  return <span style={{ letterSpacing: 1 }}>{t("about", "eyebrow")}</span>;
}`,
  });
  const i = loadI18n(d);
  assert.equal(i.keys.get("about.eyebrow"), "من نحن");
  assert.deepEqual(i.otherLocales, ["en"]);
  const r = await fixRemotion(d, { dryRun: true });
  const about = issuesOf(r.files.find((f) => f.file.endsWith("About.jsx")));
  assert.ok(about.some((x) => x.code === "HZ07" && !x.auto), JSON.stringify(about));
});

test("round 2: Tailwind break-all/tracking on an element that only shows Latin is left alone", () => {
  const r = T(`export const C = () => <div><p>راسلنا</p><a className="font-medium break-all tracking-wide">hello@example.com</a></div>;`);
  assert.match(r.code, /break-all tracking-wide/, r.code);
});

test("round 2: web apps (no remotion dependency): no @remotion/google-fonts loader; project @font-face families trusted", async () => {
  const d = project({
    "package.json": JSON.stringify({ dependencies: { react: "19", vite: "6" } }),
    "src/index.css": `@font-face { font-family: 'Brand Sans'; src: url('./brand.otf'); }`,
    "src/A.jsx": `export const A = () => <div><p style={{ fontFamily: "'Brand Sans', sans-serif" }}>مرحبا بكم</p><p style={{ fontFamily: "Inter, sans-serif" }}>أهلاً</p></div>;`,
  });
  const r = await fixRemotion(d, { dryRun: true });
  const f = r.files.find((x) => x.file.endsWith("A.jsx"))!;
  const iss = issuesOf(f);
  assert.equal(iss.filter((x) => x.code === "HZ09").length, 1, JSON.stringify(iss));
  assert.ok(iss.some((x) => x.code === "HZ09" && !x.auto && /Inter/.test(x.en)), "Inter reported, not rewritten");
  assert.doesNotMatch(f.after, /@remotion\/google-fonts/);
});

test("round 2: HTML template placeholders: dir/lang defaults honoured, tags never edited", () => {
  const html = `<!DOCTYPE html><html lang="{{LANG|ar}}" dir="{{DIR|rtl}}"><head><style>.b{font-family:"IBM Plex Sans Arabic"}</style></head><body class="b">
<h1>{{TITLE|منتجات مختارة بعناية}}</h1><span>{{BADGE_TEXT|متوفر الآن · شحن 2 أيام}}</span><p>{{ STAT_1 }} عميل سعيد</p></body></html>`;
  const a = analyze(html);
  const codes = a.issues.map((i) => i.code);
  assert.ok(!codes.includes("HZ03"), JSON.stringify(a.issues.map((i) => i.code)));
  assert.ok(!codes.includes("HZ04"));
  assert.ok(!codes.includes("HZ13"), "placeholder names are not Latin runs");
  const out = fix(html).html;
  assert.match(out, /\{\{BADGE_TEXT\|متوفر الآن · شحن ٢ أيام\}\}/, "digit fixed inside the default, the tag intact");
  assert.match(out, /\{\{ STAT_1 \}\}/);
  assert.match(out, /dir="\{\{DIR\|rtl\}\}"/, "template attribute kept as written");
  // no default and no rtl hint: runtime decides (dir=auto)
  assert.ok(!analyze(`<html dir="{{ dir }}" lang="{{ lang }}"><body><p>مرحبا بكم في الموقع</p></body></html>`).issues.some((i) => i.code === "HZ03" || i.code === "HZ04"));
});

test("round 2: digits in a translated element of a multilingual app are reported, not forced to ١٢٣ for every locale", () => {
  const src = `export function Foot() { const { t } = useTranslation(); const year = 2026; return <p>© {year} {t("footer.rights")}</p>; }`;
  const r = T(src, { i18n: new Map([["footer.rights", "جميع الحقوق محفوظة"]]), multilingual: true });
  assert.doesNotMatch(r.code, /formatDigits/, r.code);
  assert.ok(r.reports.some((x) => x.code === "HZ12"));
});

test("round 2: dictionary arrays through .map(): item fields resolve per locale value; callback `t` isn't a dictionary", async () => {
  const d = project({
    "package.json": JSON.stringify({ dependencies: { next: "15" } }),
    "src/i18n/locales/ar.ts": `export const ar = { hero: { stats: [{ value: "3+", label: "سنوات خبرة" }, { value: "AI + Web", label: "تركيز" }], tags: ["تصميم", "حركة"] }, title: "عنوان" };\n`,
    "src/i18n/locales/en.ts": `export const en = { hero: { stats: [{ value: "3+", label: "Years" }], tags: ["Design"] }, title: "Title" };\n`,
    "src/Stats.tsx": `export function Stats() {
  const { t } = useTranslation();
  return (<div>
    {t.hero.stats.map((stat) => (<div key={stat.label}>
      <p className="tracking-tight">{stat.value}</p>
      <p className="tracking-widest">{stat.label}</p>
    </div>))}
    {t.hero.tags.map((tag) => <span key={tag} className="uppercase">{tag}</span>)}
    {[{ title: "x" }].map((t) => <b key={t.title} className="tracking-wide">{t.title}</b>)}
  </div>);
}`,
  });
  const r = await fixRemotion(d, { dryRun: true });
  const iss = issuesOf(r.files.find((f) => f.file.endsWith("Stats.tsx")));
  assert.ok(!iss.some((x) => x.line === 5), "Latin stat.value: not flagged " + JSON.stringify(iss));
  assert.ok(iss.some((x) => x.code === "HZ07" && x.line === 6), "Arabic stat.label flagged");
  assert.ok(iss.some((x) => x.code === "HZ08" && x.line === 8), "string array items via {tag}");
  // resolution itself: a callback parameter named `t` is not a dictionary, the mapped item of a real one is
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("x.tsx", `const { t } = useTranslation();\nconst a = t.hero.stats.map((s) => s.label);\nconst b = [{ title: "x" }].map((t) => t.title);\n`);
  const keys = loadI18n(d).keys;
  const pa = sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  assert.equal(i18nValue(pa.find((x) => x.getText() === "s.label")!, keys), "سنوات خبرة");
  assert.equal(i18nValue(pa.find((x) => x.getText() === "t.title")!, keys), undefined);
});
