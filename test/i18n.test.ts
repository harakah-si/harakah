// i18n follow: Arabic that reaches components through translation keys (next-intl, react-i18next/i18next, react-intl).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixRemotion } from "../src/remotion/project.ts";
import { loadI18n } from "../src/remotion/i18n.ts";

function project(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-i18n-"));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return d;
}
const HERO = `import { useTranslations } from "next-intl";
import { Title } from "./Title";
export function Hero() {
  const t = useTranslations("Hero");
  return (
    <section>
      <span style={{ letterSpacing: 4, textTransform: "uppercase" }}>{t("kicker")}</span>
      <Title text={t("title")} />
      <p style={{ textAlign: "left" }}>{t("body")}</p>
      <small style={{ letterSpacing: 2 }}>{t("brand")}</small>
    </section>
  );
}
`;
const TITLE = `export const Title = ({ text }: { text: string }) => <h1 style={{ display: "flex" }}>{text.split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</h1>;\n`;
const AR = JSON.stringify({ Hero: { kicker: "جديد", title: "منصة التعلم الأولى", body: "تعلّم بسرعة", brand: "Acme" } });
const EN = JSON.stringify({ Hero: { kicker: "New", title: "The first learning platform", body: "Learn fast", brand: "Acme" } });
const run = async (d: string) => {
  const r = await fixRemotion(d, { dryRun: true });
  const by = (name: string) => r.files.find((f) => f.file.endsWith(name))!;
  return { r, hero: by("Hero.tsx"), title: by("Title.tsx") };
};
const codesOf = (f: any) => [...f.result.changes, ...f.result.reports].map((c: any) => c.code);

test("i18n: loadI18n indexes Arabic-script locales only, with namespaces, and notices other locales", () => {
  const d = project({
    "messages/ar.json": AR, "messages/en.json": EN,
    "public/locales/fa/common.json": JSON.stringify({ hi: "سلام دنیا" }),
    "data/ar-stats.json": JSON.stringify({ x: "ليس ملف ترجمة" }), // not in a locale folder, not named after a locale
    "package.json": "{}",
  });
  const { keys, files, otherLocales } = loadI18n(d);
  assert.deepEqual(files.sort(), ["messages/ar.json", "public/locales/fa/common.json"]);
  assert.equal(keys.get("Hero.title"), "منصة التعلم الأولى");
  assert.equal(keys.get("Hero.brand"), "Acme", "Latin values of the Arabic locale are known to be Latin");
  assert.equal(keys.get("common.hi"), "سلام دنیا");
  assert.equal(keys.get("common:hi"), "سلام دنیا");
  assert.equal(keys.get("hi"), "سلام دنیا");
  assert.ok(!keys.has("x"));
  assert.deepEqual(otherLocales, ["en"]);
});

test("i18n: Arabic-only app (messages/ar.json) is fixed like literal Arabic; Latin keys stay untouched", async () => {
  const d = project({ "package.json": `{"dependencies":{"next-intl":"*"}}`, "messages/ar.json": AR, "src/Hero.tsx": HERO, "src/Title.tsx": TITLE });
  const { r, hero, title } = await run(d);
  assert.deepEqual(r.i18n, ["messages/ar.json"]);
  assert.match(hero.after, /<section dir="rtl" lang="ar"/);
  assert.match(hero.after, /letterSpacing: 0 \/\* harakah[^}]*textTransform: "none"/);
  assert.match(hero.after, /textAlign: "start"/);
  assert.match(hero.after, /<small style=\{\{ letterSpacing: 2 \}\}>\{t\("brand"\)\}/, "t('brand') → Acme stays Latin");
  assert.match(title.after, /splitArabic\(text\)/, "props fed through t('title') across files");
  assert.match(title.after, /<h1 dir="rtl" lang="ar"/);
  assert.ok(r.props.some((p) => p.component === "Title" && p.i18nOnly && p.reasons.some((x) => /translation/.test(x))));
});

test("i18n: multilingual app gets locale-aware reports instead of hardcoded RTL; safe fixes still apply", async () => {
  const d = project({ "package.json": "{}", "messages/ar.json": AR, "messages/en.json": EN, "src/Hero.tsx": HERO, "src/Title.tsx": TITLE });
  const { hero, title } = await run(d);
  assert.doesNotMatch(hero.after, /dir="rtl"|letterSpacing: 0|textTransform: "none"/, "nothing that would also hit English");
  assert.match(hero.after, /textAlign: "start"/, "text-align:start is right for every locale");
  assert.match(title.after, /splitArabic\(text\)/, "splitArabic is a no-op for Latin, so it stays automatic");
  assert.doesNotMatch(title.after, /dir="rtl"/);
  const rep = hero.result.reports.map((x: any) => x.code + " " + x.en);
  assert.ok(rep.some((x: string) => /^HZ03 .*dir=\{locale === "ar"/.test(x)), rep.join("\n"));
  assert.ok(rep.some((x: string) => /^HZ07 .*isRtl \? 0/.test(x)));
  assert.equal(rep.filter((x: string) => x.startsWith("HZ03")).length, 1, "one direction note per file");
});

test("i18n: a locale-driven <html dir={…}> layout counts as app-level direction", async () => {
  const d = project({
    "package.json": "{}", "messages/ar.json": AR, "messages/en.json": EN, "src/Hero.tsx": HERO, "src/Title.tsx": TITLE,
    "app/layout.tsx": `export default function L({ children, params }: any) { return <html lang={params.locale} dir={params.locale === "ar" ? "rtl" : "ltr"}><body>{children}</body></html>; }\n`,
  });
  const { hero, title } = await run(d);
  assert.ok(!codesOf(hero).includes("HZ03") && !codesOf(title).includes("HZ03"));
});

test("i18n: react-i18next namespaces, ns:key, react-intl formatMessage; no locale files → no findings", async () => {
  const comp = `import { useTranslation } from "react-i18next";
import { useIntl } from "react-intl";
export function Card() {
  const { t } = useTranslation("common");
  const intl = useIntl();
  return <div><b style={{ letterSpacing: 3 }}>{t("kicker")}</b><i style={{ textTransform: "uppercase" }}>{t("common:cta")}</i><u style={{ letterSpacing: 1 }}>{intl.formatMessage({ id: "promo" })}</u></div>;
}
`;
  const d = project({ "package.json": "{}", "public/locales/ar/common.json": JSON.stringify({ kicker: "جديد", cta: "ابدأ", promo: "عرض خاص" }), "src/Card.tsx": comp });
  const r = await fixRemotion(d, { dryRun: true });
  const out = r.files[0].after;
  assert.equal((out.match(/letterSpacing: 0/g) || []).length, 2, out);
  assert.match(out, /textTransform: "none"/);
  assert.match(out, /<div dir="rtl" lang="ar"/);
  const none = project({ "package.json": "{}", "src/Card.tsx": comp });
  const r2 = await fixRemotion(none, { dryRun: true });
  assert.equal(r2.files[0].after, comp, "without an Arabic locale the component is not Arabic");
});
