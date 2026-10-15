/** Real Remotion renders (bundler + renderer + Chrome): broken before, joined after. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareRemotion } from "../src/remotion/compare.ts";

const FIX = path.resolve("fixtures/remotion");

test("Remotion project: per-letter titles render disconnected before and joined after", { timeout: 300_000 }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-rr-"));
  const r = await compareRemotion(FIX, { outDir: out, compositions: ["CharSplitTitle", "SpreadStats", "CleanTitle", "ArabicTextDemo", "PropsTitle"] });
  const by = Object.fromEntries(r.renders.map((x) => [x.id, x]));
  // PropsTitle has no Arabic in its own file: the text arrives via <Composition defaultProps> (props-aware detection)
  for (const id of ["CharSplitTitle", "SpreadStats", "PropsTitle"]) {
    const x = by[id];
    assert.ok(x.joinedAfter, `${id}: after should match the running-text reference (diff ${x.diffAfter})`);
    assert.ok(!x.joinedBefore, `${id}: before should be broken`);
    assert.ok(x.before.components > x.after.components, `${id}: isolated letters = more ink pieces before (${x.before.components} vs ${x.after.components})`);
    assert.ok(x.diffAfter < 0.05);
    for (const f of [x.beforePng, x.afterPng, x.comparePng]) assert.ok(fs.statSync(f).size > 5000, f);
  }
  const clean = r.fix.files.find((f) => f.file.endsWith("CleanTitle.tsx"))!;
  assert.equal(clean.after, clean.before, "clean composition untouched");
  assert.ok(by.CleanTitle.joinedAfter);
  // <ArabicText> is per-letter motion but already joined: before == after == running-text reference
  assert.ok(by.ArabicTextDemo.joinedBefore && by.ArabicTextDemo.joinedAfter, `ArabicText joined (diff ${by.ArabicTextDemo.diffBefore})`);
  fs.rmSync(out, { recursive: true, force: true });
});

test("Remotion lone .tsx (scaffolded project): joined after", { timeout: 300_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-lone-"));
  fs.copyFileSync(path.join(FIX, "src/broken/ArrayFromKicker.tsx"), path.join(dir, "ArrayFromKicker.tsx"));
  const out = path.join(dir, "out");
  const r = await compareRemotion(path.join(dir, "ArrayFromKicker.tsx"), { outDir: out, durationInFrames: 90 });
  assert.equal(r.renders.length, 1);
  assert.ok(r.renders[0].joinedAfter && !r.renders[0].joinedBefore);
  fs.rmSync(dir, { recursive: true, force: true });
});
