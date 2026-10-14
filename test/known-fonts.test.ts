// HZ09 false positive (launch comp): our own bundled display font Alexandria, declared through `font`
// shorthands like `800 120px/1.3 "Alexandria", sans-serif` and `700 calc(var(--u)*3.2)/1 var(--display)`,
// must be recognised as Arabic-capable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/engine.ts";
import { shorthandFamily } from "../src/css.ts";
import { classify, parseStack } from "../src/fonts.ts";
import { transformSource } from "../src/remotion/codemod.ts";

const hz09 = (html: string) => analyze(html).issues.filter((i) => i.code === "HZ09");
const page = (css: string, body = `<h1 id="title">حركة تنساب</h1>`) =>
  `<html lang="ar" dir="rtl"><head><style>${css}</style></head><body>${body}</body></html>`;

test("known Arabic families: Alexandria, Readex Pro, Plex Arabic, Cairo, Tajawal, any Noto … Arabic", () => {
  for (const f of ["Alexandria", "Readex Pro", "IBM Plex Sans Arabic", "IBM Plex Arabic", "Plex Arabic", "Cairo",
    "Tajawal", "Noto Sans Arabic", "Noto Naskh Arabic", "Noto Kufi Arabic", "Noto Sans Arabic UI", "Noto Naskh Arabic UI",
    "Almarai", "Amiri", "Changa", "El Messiri", "Harmattan", "Lateef", "Markazi Text", "Mada", "Reem Kufi",
    "Scheherazade New", "Kufam", "Marhey", "Zain", "Vazirmatn", "Baloo Bhaijaan 2", "'Alexandria Variable'", "Cairo Bold"]) {
    assert.equal(classify(f), "arabic-ofl", f);
  }
  assert.notEqual(classify("Noto Sans"), "arabic-ofl");
  assert.notEqual(classify("Inter"), "arabic-ofl");
});

test("font shorthand family extraction: weights, size/line-height, nested calc(var()), var() families", () => {
  assert.equal(shorthandFamily(`800 120px/1.3 "Alexandria", sans-serif`), `"Alexandria", sans-serif`);
  assert.equal(shorthandFamily(`120px / 1.3 "Alexandria", sans-serif`), `"Alexandria", sans-serif`);
  assert.equal(shorthandFamily(`700 calc(var(--u)*3.2)/1 var(--display)`), `var(--display)`);
  assert.equal(shorthandFamily(`italic 600 clamp(2rem, calc(1rem + 2vw), 4rem)/1.1 'Readex Pro', serif`), `'Readex Pro', serif`);
  assert.equal(shorthandFamily(`var(--w) var(--size) var(--family)`), `var(--family)`);
  assert.equal(shorthandFamily(`500 var(--fs)/1.2 Cairo`), `Cairo`);
  assert.deepEqual(parseStack(`120px/1.3 "Alexandria", sans-serif`), ["alexandria", "sans-serif"], "leaked prefix stripped");
  assert.deepEqual(parseStack(`"Baloo Bhaijaan 2", serif`), ["baloo bhaijaan 2", "serif"], "digits in a name survive");
});

test("launch-comp patterns: no HZ09 for Alexandria via shorthands and custom properties", () => {
  const css = `:root{--u:1vw;--display:"Alexandria","IBM Plex Sans Arabic",sans-serif;--text:"IBM Plex Sans Arabic",sans-serif}
    h1#title{font:800 120px/1.3 "Alexandria", sans-serif}
    .kicker{font:700 calc(var(--u)*3.2)/1 var(--display)}
    .lede{font:400 calc(var(--u)*1.4)/1.6 var(--text)}
    .solo{font-family:Alexandria}`;
  const body = `<h1 id="title">حركة تنساب</h1><p class="kicker">الحروف موصولة</p><p class="lede">نص تجريبي</p><p class="solo">عنوان</p>`;
  assert.deepEqual(hz09(page(css, body)).map((i) => i.en), []);
  // control: a Latin-only stack is still reported
  assert.equal(hz09(page(`h1{font:800 120px/1.3 "Inter", sans-serif}`)).length, 1);
});

test("Remotion: fontFamily 'Alexandria' / Noto … Arabic on Arabic text is not flagged", () => {
  for (const fam of ["Alexandria", "Readex Pro", "Noto Sans Arabic UI", "IBM Plex Arabic"]) {
    const src = `export const T = () => <h1 style={{ fontFamily: "${fam}, sans-serif" }}>حركة تنساب</h1>;`;
    const r = transformSource(src);
    const all = [...r.changes, ...r.reports];
    assert.ok(!all.some((i) => i.code === "HZ09"), fam + ": " + JSON.stringify(all.map((i) => i.code)));
  }
  // control: a Latin-only family is still caught
  const bad = transformSource(`export const T = () => <h1 style={{ fontFamily: "Inter" }}>حركة تنساب</h1>;`);
  assert.ok([...bad.changes, ...bad.reports].some((i) => i.code === "HZ09"));
});
