// The project's own RTL overrides (html[dir=rtl] / [dir=rtl] / :dir(rtl) / :lang(ar) / body.rtl, Tailwind rtl: variants)
// decide the Arabic value: 0/normal silences the finding, a softer value is reported with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, fix } from "../src/engine.ts";
import { normalizeRtlSelector } from "../src/css.ts";
import { transformSource } from "../src/remotion/codemod.ts";
import { parseProjectCss, projectValue } from "../src/remotion/project-css.ts";
import { fixRemotion } from "../src/remotion/project.ts";

const hz = (html: string, code = "HZ07") => analyze(html).issues.filter((i) => i.code === code);
const P = `<p class="label">عنوان القسم</p>`;

test("normalizeRtlSelector: conditions removed, <html>/class anchors marked root, LTR rules ignored", () => {
  assert.deepEqual(normalizeRtlSelector(`html[dir="rtl"] .label`), { sel: "html .label", root: true });
  assert.deepEqual(normalizeRtlSelector(`[dir=rtl] .label`), { sel: ".label", root: false });
  assert.deepEqual(normalizeRtlSelector(`.label:dir(rtl)`), { sel: ".label", root: false });
  assert.deepEqual(normalizeRtlSelector(`:lang(ar) h1.t`), { sel: "h1.t", root: false });
  assert.deepEqual(normalizeRtlSelector(`[lang|="ar"] .x`), { sel: ".x", root: false });
  assert.deepEqual(normalizeRtlSelector(`body.rtl .x`), { sel: "body .x", root: true });
  assert.equal(normalizeRtlSelector(`.label`), null);
  assert.equal(normalizeRtlSelector(`[dir=ltr] .label`), null);
  assert.equal(normalizeRtlSelector(`.rtl`), null, "a .rtl class on the subject itself is just a class");
});

test("HTML: :lang(ar), :dir(rtl), [dir=rtl] and logical text-align overrides silence the finding", () => {
  const page = (css: string, body = `<div lang="ar">${P}</div>`) => `<html lang="en"><head><style>${css}</style></head><body>${body}</body></html>`;
  assert.equal(hz(page(`.label{letter-spacing:.2em} :lang(ar) .label{letter-spacing:0}`)).length, 0);
  assert.equal(hz(page(`.label{letter-spacing:.2em} .label:dir(rtl){letter-spacing:normal}`)).length, 0);
  assert.equal(hz(page(`.label{letter-spacing:.2em} [dir=rtl] .label{letter-spacing:0}`)).length, 0, "HZ03 puts dir=rtl on the Arabic block, so [dir=rtl] holds");
  assert.equal(hz(page(`.label{text-align:left} [dir=rtl] .label{text-align:right}`), "HZ06").length, 0);
  assert.equal(hz(page(`.label{text-align:left} :lang(ar) .label{text-align:start}`), "HZ06").length, 0);
  // still flagged without an override, and an LTR-only rule never counts
  assert.equal(hz(page(`.label{letter-spacing:.2em}`)).length, 1);
  assert.equal(hz(page(`.label{letter-spacing:.2em} [dir=ltr] .label{letter-spacing:0}`)).length, 1);
});

test("HTML: a softer RTL value is reported as the author's value; the fix's inline 0 still wins", () => {
  const html = `<html lang="en"><head><style>.label{letter-spacing:.2em} html[dir=rtl] .label{letter-spacing:.04em}</style></head><body><div lang="ar" dir="rtl">${P}</div>
<script>document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";</script></body></html>`;
  const i = hz(html)[0];
  assert.match(i.message.en, /^letter-spacing: \.04em/);
  assert.match(i.message.en, /project's own RTL value, from `html\[dir=rtl\] \.label`/);
  assert.match(fix(html).html, /<p class="label" style="letter-spacing:0/);
});

test("HTML: an <html>-anchored override that nothing activates is called out", () => {
  const html = `<html lang="en"><head><style>.label{letter-spacing:.2em} html[dir=rtl] .label{letter-spacing:0}</style></head><body><div lang="ar" dir="rtl">${P}</div></body></html>`;
  const i = hz(html)[0];
  assert.match(i.message.en, /^letter-spacing: \.2em/);
  assert.match(i.message.en, /only once <html> is RTL/);
  // …and once app code sets it (body class convention), the override applies
  const js = html.replace("</body>", `<script>document.body.classList.add("rtl")</script></body>`).replace("html[dir=rtl] .label", "body.rtl .label");
  assert.equal(hz(js).length, 0);
});

test("HTML: letter-spacing values with a leading zero (0.04em) are no longer mistaken for 0", () => {
  for (const v of ["0.04em", "0.5px", "-0.02em"]) assert.equal(hz(`<html lang="ar" dir="rtl"><body><p style="letter-spacing:${v}">مرحبا بكم</p></body></html>`).length, 1, v);
  for (const v of ["0", "0.0em", ".0em", "0px", "normal"]) assert.equal(hz(`<html lang="ar" dir="rtl"><body><p style="letter-spacing:${v}">مرحبا بكم</p></body></html>`).length, 0, v);
});

test("project CSS index: classes, @apply, :root vars, RTL rules", () => {
  const pc = parseProjectCss([{ file: "globals.css", text: `:root{--tl:.18em} .label{letter-spacing:var(--tl);text-transform:uppercase}
html[dir="rtl"] .label, html[dir="rtl"] .btn { letter-spacing: .04em }
:lang(ar) .chip { @apply tracking-normal normal-case; } .card .label{letter-spacing:1px} @media (min-width:600px){ [dir=rtl] .nav{letter-spacing:0} }` }]);
  const l = projectValue(pc, ["label", "mb-2"], "p", "letter-spacing");
  assert.equal(l.base?.value, ".18em"); assert.equal(l.rtl?.value, ".04em"); assert.equal(l.rtl?.root, true);
  assert.equal(projectValue(pc, ["chip"], "span", "letter-spacing").rtl?.value, "0");
  assert.equal(projectValue(pc, ["chip"], "span", "text-transform").rtl?.value, "none");
  assert.equal(projectValue(pc, ["nav"], "nav", "letter-spacing").rtl?.value, "0");
  assert.equal(projectValue(pc, ["label"], "p", "letter-spacing").base?.selector, ".label", "descendant rules (.card .label) can't be verified from className");
});

test("TSX: Tailwind rtl: variants are the author's RTL value (safe → no edit; soft → the variant is fixed, LTR kept)", () => {
  const T = (cls: string) => transformSource(`export const C = () => <h2 className="${cls}">عنوان القسم</h2>;`, { helperImport: "./h", assumeArabic: true });
  const safe = T("tracking-widest rtl:tracking-normal uppercase rtl:normal-case");
  assert.ok(!safe.changes.some((c) => c.code === "HZ07" || c.code === "HZ08"), JSON.stringify(safe.changes));
  assert.match(safe.code, /className="tracking-widest rtl:tracking-normal uppercase rtl:normal-case"/);
  const soft = T("tracking-widest rtl:tracking-wide");
  assert.match(soft.code, /className="tracking-widest rtl:tracking-normal"/);
  assert.ok(soft.changes.some((c) => c.code === "HZ07" && /author's RTL value 0\.025em/.test(c.en)));
  // no variant: the usual edit
  assert.match(T("tracking-widest").code, /className="tracking-normal"/);
});

test("TSX project: a plain class from globals.css is reported once per file with the author's softer RTL value; 0 silences it", async () => {
  const mk = (rtlValue: string) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-rtlcss-"));
    fs.mkdirSync(path.join(d, "src", "styles"), { recursive: true });
    fs.mkdirSync(path.join(d, "src", "app"), { recursive: true });
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "x", dependencies: { next: "15" } }));
    fs.writeFileSync(path.join(d, "src", "styles", "globals.css"), `:root{--tracking-label:.18em}\n.label{letter-spacing:var(--tracking-label)}\nhtml[dir="rtl"] .label{letter-spacing:${rtlValue}}\n`);
    fs.writeFileSync(path.join(d, "src", "app", "layout.tsx"), `export default function L({ children }: any) { return <html lang="ar" dir="rtl"><body>{children}</body></html>; }`);
    fs.writeFileSync(path.join(d, "src", "app", "page.tsx"), `export default function P() { return <main><p className="label mb-2">عن المشروع</p><p className="label">تواصل معنا</p></main>; }`);
    return d;
  };
  const soft = await fixRemotion(mk(".04em"), { write: false } as any);
  const issues = soft.files.flatMap((f: any) => f.issues).filter((i: any) => i.code === "HZ07");
  assert.equal(issues.length, 1, JSON.stringify(issues.map((i: any) => i.message.en)));
  assert.match(issues[0].message.en, /^\.label in src\/styles\/globals\.css sets letter-spacing: \.18em on Arabic text \(2 elements in this file/);
  assert.match(issues[0].message.en, /project's own RTL value is \.04em/);
  const zero = await fixRemotion(mk("0"), { write: false } as any);
  assert.equal(zero.files.flatMap((f: any) => f.issues).filter((i: any) => i.code === "HZ07").length, 0);
});
