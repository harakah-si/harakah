// Style objects imported from theme.ts / styles.ts / utils: fixed where declared when only Arabic components use
// them; when Latin components share them, the shared object keeps its look and the Arabic usage sites get overrides.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixRemotion } from "../src/remotion/project.ts";
import { compareRemotion } from "../src/remotion/compare.ts";

const FX = path.resolve("fixtures/remotion-theme");
const after = (r: any, rel: string) => r.files.find((f: any) => f.file === path.join(FX, "src", rel));

test("theme: exclusive vs shared style declarations across files", async () => {
  const r = await fixRemotion(FX, { dryRun: true });
  const st = Object.fromEntries(r.styles.map((s) => [s.name, s]));
  assert.equal(st.arabicHeadline.exclusive, true);
  assert.deepEqual(st.arabicHeadline.arabicUsers, ["ArabicTitle (ArabicTitle.tsx)"]);
  assert.equal(st.theme.exclusive, false);
  assert.deepEqual(st.theme.latinUsers, ["EnglishTitle (EnglishTitle.tsx)"]);
  assert.ok(st.theme.arabicUsers.includes("PromoCard (PromoCard.tsx)"), "Arabic via defaultProps counts as an Arabic user");
  assert.deepEqual(st.theme.overrides.title.map(([k, v]) => `${k}:${v}`), ["letterSpacing:0", 'textTransform:"none"']);
  assert.equal(st.letters.hasSplit, true);

  // styles.ts (Arabic-only): fixed in place, `as const` literal included
  const styles = after(r, "styles.ts").after;
  assert.match(styles, /letterSpacing: 0 \/\* harakah/);
  assert.match(styles, /textAlign: "start" \/\* harakah: follows dir=rtl \*\/ as const/);
  assert.match(styles, /'IBM Plex Sans Arabic'/);
  // theme.ts (shared): Latin look kept, only the harmless Arabic font fallback added (and loaded)
  const theme = after(r, "theme.ts").after;
  assert.match(theme, /letterSpacing: "0\.08em", textTransform: "uppercase" as const/);
  assert.match(theme, /letterSpacing: 6 \}/);
  assert.match(theme, /Montserrat, 'IBM Plex Sans Arabic', sans-serif/);
  assert.match(theme, /^import \{ loadFont as loadArabicFont \}.*\nloadArabicFont\([^\n]*\);\n\/\/ Brand theme/);
  // utils/letters.ts (shared): splitArabic is identical for Latin text, so the split is fixed in the helper
  assert.match(after(r, "utils/letters.ts").after, /splitArabic\(text\)/);
  assert.match(after(r, "utils/letters.ts").after, /from "\.\.\/harakah-arabic"/);
  // Arabic usage sites get overrides; spread overrides go right after the spread, before later props
  const ar = after(r, "scenes/ArabicTitle.tsx").after;
  assert.match(ar, /style=\{\{ \.\.\.theme\.title, letterSpacing: 0, textTransform: "none" \/\* harakah: Arabic override of shared theme\.ts style \*\/ \}\}/);
  assert.match(ar, /\{ \.\.\.theme\.caption, letterSpacing: 0 \/\* harakah[^*]*\*\/, margin: 0 \}/);
  const promo = after(r, "scenes/PromoCard.tsx");
  assert.match(promo.after, /\.\.\.theme\.title, letterSpacing: 0, textTransform: "none" \/\* harakah[^*]*\*\/, fontSize: 80/);
  assert.ok(promo.result.reports.some((x: any) => /theme\.caption.*can't rewrite/.test(x.en)), "prop-passed shared style is reported");
  // English scene untouched
  const en = after(r, "scenes/EnglishTitle.tsx");
  assert.equal(en.after, en.before);
});

test("theme: a lone Arabic file still sees the project's theme; fixing twice changes nothing", async () => {
  const lone = await fixRemotion(path.join(FX, "src/scenes/ArabicTitle.tsx"), { dryRun: true });
  assert.match(lone.files[0].after, /\.\.\.theme\.title, letterSpacing: 0/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-theme-"));
  await fixRemotion(FX, { out });
  const again = await fixRemotion(out, { dryRun: true });
  assert.equal(again.files.filter((f) => f.after !== f.before).length, 0);
  fs.rmSync(out, { recursive: true, force: true });
});

test("theme: real render: Arabic scene joins after the fix, English scene renders the same", { timeout: 300_000 }, async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "hz-theme-r-"));
  fs.cpSync(FX, proj, { recursive: true });
  fs.symlinkSync(path.resolve("fixtures/remotion/node_modules"), path.join(proj, "node_modules"), "dir");
  const outDir = path.join(proj, "cmp");
  const r = await compareRemotion(proj, { outDir, compositions: ["ArabicTitle", "EnglishTitle"], frame: 50 });
  const by = Object.fromEntries(r.renders.map((x) => [x.id, x]));
  assert.equal(by.ArabicTitle.joinedBefore, false);
  assert.equal(by.ArabicTitle.joinedAfter, true, `after ${by.ArabicTitle.after.components}/${by.ArabicTitle.after.width} ref ${by.ArabicTitle.reference.components}/${by.ArabicTitle.reference.width} diff ${by.ArabicTitle.diffAfter}`);
  assert.equal(by.EnglishTitle.after.components, by.EnglishTitle.before.components);
  assert.equal(by.EnglishTitle.after.width, by.EnglishTitle.before.width);
  // refresh the committed demo image only on request: tests must not modify tracked files
  if (process.env.UPDATE_DEMO) fs.copyFileSync(path.join(outDir, "ArabicTitle", "compare.png"), path.resolve("docs/media/remotion-theme-compare.png"));
  fs.rmSync(proj, { recursive: true, force: true });
});
