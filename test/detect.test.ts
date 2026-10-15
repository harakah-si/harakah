import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { analyze, fix } from "../src/engine.ts";
import { analyzeJsx } from "../src/jsx.ts";

const FX = path.resolve(import.meta.dirname, "..", "fixtures");
const read = (f: string) => fs.readFileSync(path.join(FX, f), "utf8");

/** fixture -> rule that MUST be detected, and whether `fix` (default options) must make it disappear */
const EXPECT: [string, string, boolean][] = [
  ["01-split-inline-block.html", "HZ01", true],
  ["02-split-runtime.html", "HZ02", true],
  ["03-missing-dir.html", "HZ03", true],
  ["04-ltr-container.html", "HZ03", true],
  ["05-missing-lang.html", "HZ04", true],
  ["06-hyperframes-html-dir.html", "HZ05", true],
  ["07-text-align-left.html", "HZ06", true],
  ["08-letter-spacing.html", "HZ07", true],
  ["09-text-transform.html", "HZ08", true],
  ["10-latin-font.html", "HZ09", true],
  ["11-thmanyah-hosted.html", "HZ10", false],
  ["12-missing-font-face.html", "HZ11", true],
  ["13-mixed-digits.html", "HZ12", true],
  ["14-bidi.html", "HZ13", true],
  ["15-bidi-controls.html", "HZ14", false],
  ["16-reversed.html", "HZ15", false],
  ["17-justify.html", "HZ16", false],
  ["18-diacritics-clip.html", "HZ17", true],
  ["19-word-break.html", "HZ18", true],
  ["20-canvas.html", "HZ19", false],
  ["21-italic.html", "HZ20", false],
  ["23-split-word-strategy.html", "HZ01", true],
  ["25-gsap-splittext.html", "HZ02", true],
  ["26-motion-splittext.html", "HZ02", true],
  ["27-canvas-letters.html", "HZ25", false],
  ["28-three-textgeometry.html", "HZ26", false],
  ["29-troika-no-font.html", "HZ27", false],
];

for (const [file, code, fixable] of EXPECT) {
  test(`${file}: detects ${code}${fixable ? " and auto-fixes it" : " (detect-only)"}`, () => {
    const html = read(file);
    const a = analyze(html);
    assert.ok(a.issues.some((i) => i.code === code), `expected ${code}, got ${a.issues.map((i) => i.code).join(",")}`);
    const r = fix(html);
    if (fixable) {
      assert.ok(r.applied.some((i) => i.code === code), `${code} should be applied`);
      assert.ok(!r.remaining.some((i) => i.code === code && i.severity !== "info"), `${code} should be gone after fix; remaining: ${r.remaining.map((i) => i.code).join(",")}`);
    } else {
      assert.ok(r.remaining.some((i) => i.code === code), `${code} is detect-only and should remain`);
    }
  });
}

test("clean fixture has no issues (no false positives)", () => {
  const a = analyze(read("22-clean.html"));
  assert.deepEqual(a.issues.map((i) => i.code), []);
});

test("fix is idempotent: fixing a fixed file changes nothing", () => {
  for (const [file] of EXPECT) {
    const once = fix(read(file)).html;
    const twice = fix(once);
    assert.equal(twice.html, once, `${file} changed on second fix: ${twice.applied.map((i) => i.code)}`);
  }
});

test("HZ01 zwj strategy keeps the same number of letter boxes; word strategy merges", () => {
  const html = read("01-split-inline-block.html");
  const count = (h: string) => (h.match(/class="ch"/g) || []).length;
  const z = fix(html, { split: "zwj" }).html;
  const w = fix(html, { split: "word" }).html;
  assert.equal(count(z), count(html));
  assert.ok(z.includes("\u200D"));
  assert.equal(count(w), 5 + 4); // 5 words + 4 space boxes
});

test("HZ01 lam-alef: ligature letters are folded into one box", () => {
  const out = fix(read("23-split-word-strategy.html")).html;
  assert.ok(/>\u200D?لا\u200D?</.test(out) || />لا</.test(out), "expected a box containing لا");
});

test("digits policy: eastern default, western option, keep option", () => {
  const html = read("13-mixed-digits.html");
  assert.ok(fix(html).html.includes("الحلقة ١٢ من ١٥"));
  assert.ok(fix(html).html.includes('"ar-EG-u-nu-arab"'));
  const w = fix(html, { digits: "western" }).html;
  assert.ok(w.includes("الحلقة 12 من 15") && w.includes('"ar-EG-u-nu-latn"'));
  const k = fix(html, { digits: "keep" });
  assert.ok(k.html.includes("الحلقة 12 من ١٥"));
  assert.ok(k.remaining.some((i) => i.code === "HZ12"));
});

test("digits: Latin runs like 'Claude Code 7' are not converted; bidi wraps them", () => {
  const out = fix(read("14-bidi.html")).html;
  assert.ok(out.includes("<bdi>Claude Code</bdi>"));
  assert.ok(out.includes("٧"));
});

test("HZ10 Thmanyah: flagged as error when hosted, replaced only with --replace-proprietary", () => {
  const html = read("11-thmanyah-hosted.html");
  const i = analyze(html).issues.find((x) => x.code === "HZ10")!;
  assert.equal(i.severity, "error");
  const r = fix(html, { replaceProprietary: true });
  assert.ok(r.html.includes("font-family:'Thmanyah Sans'".replace("'Thmanyah Sans'", "'IBM Plex Sans Arabic'")) || /font-family:\s*'IBM Plex Sans Arabic'/.test(r.html));
});

test("fonts: injected @font-face uses bundled OFL file and never Thmanyah", () => {
  const r = fix(read("10-latin-font.html"));
  assert.ok(r.html.includes("@font-face{font-family:'IBM Plex Sans Arabic'"));
  assert.ok(r.assets.every((a) => !/thmanyah/i.test(a.rel)));
  assert.ok(/Inter, 'IBM Plex Sans Arabic', 'Helvetica Neue', sans-serif|Inter, 'Helvetica Neue', 'IBM Plex Sans Arabic', sans-serif/.test(r.html));
});

test("Remotion TSX (experimental, detect-only)", () => {
  const codes = analyzeJsx(read("24-remotion.tsx")).map((i) => i.code);
  for (const c of ["HZ02", "HZ07", "HZ09", "HZ03"]) assert.ok(codes.includes(c), `missing ${c} in ${codes}`);
});

test("Motion splitText: chars is HZ02, a words-only split is not", () => {
  const page = (js: string) => `<!doctype html><html lang="ar"><body><h1 id="t" dir="rtl">الموسم الجديد</h1><script type="module">${js}</script></body></html>`;
  const hz02 = (js: string) => analyze(page(js)).issues.filter((i) => i.code === "HZ02");
  assert.equal(hz02(`import { splitText } from "motion-plus"; const { chars } = splitText("#t"); animate(chars, { y: 20 });`).length, 1);
  assert.equal(hz02(`const s = splitText(document.querySelector("#t")); animate(s.chars, { opacity: 1 });`).length, 1);
  assert.equal(hz02(`const { words } = splitText("#t"); animate(words, { y: 20 });`).length, 0);
});

test("TSX: SplitText / Motion splitText on chars is HZ02", () => {
  const tsx = (l: string) => analyzeJsx(`export const T = () => <h1 dir="rtl">الموسم الجديد</h1>;\n${l}\n`).filter((i) => i.code === "HZ02");
  assert.equal(tsx(`useEffect(() => { const { chars } = splitText(ref.current); animate(chars, { y: 20 }); }, []);`).length, 1);
  assert.equal(tsx(`useGSAP(() => { const s = SplitText.create(ref.current, { type: "chars" }); });`).length, 1);
  assert.equal(tsx(`useEffect(() => { const { words } = splitText(ref.current); }, []);`).length, 0);
});

test("canvas / WebGL letters: HZ25 instead of a false HZ02 fix; clean drawing isn't flagged", () => {
  const page = (js: string, lang = "ar") => `<!doctype html><html lang="${lang}"><body><canvas id="c"></canvas><script type="module">${js}</script></body></html>`;
  const C = `const c=document.getElementById("c").getContext("2d");`;
  const codes = (js: string, lang?: string) => analyze(page(js, lang)).issues.map((i) => i.code);
  // the DOM shim can't reach canvas pixels, so a canvas letter loop must not be reported as fixed
  const loop = C + `const W="الحكايات";let x=0;for(const ch of [...W]){c.fillText(ch,x,80);x+=c.measureText(ch).width}`;
  assert.ok(codes(loop).includes("HZ25"));
  assert.ok(!fix(page(loop)).applied.some((i) => i.code === "HZ02"), "HZ02 must not claim a canvas letter loop as fixed");
  for (const js of [
    C + `"مرحبا".split("").forEach((ch,i)=>c.fillText(ch,40+i*50,80))`,
    C + `const w="مرحبا";let x=0;for(const ch of w){c.fillText(ch,x,80);x+=c.measureText(ch).width}`,
    C + `const t="مرحبا";for(let i=0;i<t.length;i++){c.fillText(t[i],40+i*50,80)}`,
    C + `const cs=Array.from("مرحبا");cs.forEach(function(ch,i){c.strokeText(ch,i*40,80)})`,
    `import { Text } from "troika-three-text";const W="الحكايات";for(const ch of [...W]){const t=new Text();t.text=ch;t.font="a.ttf";scene.add(t)}`,
  ]) assert.ok(codes(js).includes("HZ25"), js);
  // whole words, line loops, troika with a font, DOM letters (HZ02 keeps its shim) and Latin are not HZ25–27
  for (const [js, lang] of [
    [C + `c.direction="rtl";c.fillText("مرحبا",400,80)`],
    [C + `const lines=["سطر أول","سطر ثان"];c.direction="rtl";for(const line of lines){c.fillText(line,400,80)}`],
    [`import { Text } from "troika-three-text";const t=new Text();t.text="مرحبا";t.font="IBMPlexSansArabic-Bold.ttf";t.sync()`],
    [C + `const W="HELLO";let x=0;for(const ch of [...W]){c.fillText(ch,x,80);x+=c.measureText(ch).width}`, "en"],
  ]) assert.deepEqual(codes(js, lang).filter((c) => /HZ2[5-7]/.test(c)), [], js);
  const dom = C + `const W="مرحبا";document.querySelector("h1").innerHTML=[...W].map(ch=>"<span>"+ch+"</span>").join("");c.direction="rtl";c.fillText(W,400,80)`;
  assert.ok(fix(page(dom)).applied.some((i) => i.code === "HZ02"), "DOM letter boxes still get the runtime shim");
});

test("TSX: drei <Text3D> is HZ26, drei <Text> without font is HZ27, canvas letter loops are HZ25", () => {
  const codes = (src: string) => analyzeJsx(src).map((i) => i.code);
  assert.ok(codes(`import { Text3D } from "@react-three/drei";\nexport const T = () => <Text3D font="/f.json">مرحبا</Text3D>;`).includes("HZ26"));
  assert.ok(codes(`import { Text } from "@react-three/drei";\nexport const T = () => <Text fontSize={1}>مرحبا</Text>;`).includes("HZ27"));
  assert.ok(!codes(`import { Text } from "@react-three/drei";\nexport const T = () => <Text font="/IBMPlexSansArabic-Bold.ttf">مرحبا</Text>;`).includes("HZ27"));
  assert.ok(!codes(`import { Text } from "./ui";\nexport const T = () => <div dir="rtl"><Text>مرحبا</Text></div>;`).some((c) => /HZ2[5-7]/.test(c)));
  assert.ok(codes(`export const C = () => { useEffect(() => { const c = ref.current.getContext("2d"); const w = "مرحبا"; let x = 0;\n for (const ch of [...w]) { c.fillText(ch, x, 80); x += c.measureText(ch).width; } }, []); return <canvas ref={ref} dir="rtl" />; };`).includes("HZ25"));
});
