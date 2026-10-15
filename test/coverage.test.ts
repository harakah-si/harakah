// Sampled audits say what they covered: how many frames, the gap between samples, and that anything shorter can be missed.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { coverage, coverageText, sampleTimes } from "../src/layout-audit.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("coverage: gap between evenly spaced samples, in seconds and (Remotion) in frames", () => {
  // HTML: 3 s at 10 fps → 31 samples, one every 0.1 s
  assert.equal(sampleTimes(3, 10).length, 31);
  assert.deepEqual(coverage(31, 3), { sampled: 31, gapSeconds: 0.1 });
  // Remotion: 300 frames at 30 fps sampled at 2/s → 21 samples over 299 frames, one every 15 frames
  const c = coverage(21, 299 / 30, 30);
  assert.deepEqual([c.total, c.gapFrames], [300, 15]);
  assert.match(coverageText(c), /21 sampled frame\(s\) of 300, one every 15 frame\(s\): a problem shorter than that can be missed/);
  assert.equal(coverageText(coverage(30, 29 / 30, 30)), "every frame checked (30)");
});

test("coverage: audit --json reports it, and the text output says what can be missed", { timeout: 60_000 }, () => {
  const cli = (...a: string[]) => execFileSync(process.execPath, [path.join(ROOT, "dist/cli.js"), "audit", "fixtures/02-split-runtime.html", ...a], { cwd: ROOT, encoding: "utf8" });
  const j = JSON.parse(cli("--json"));
  assert.equal(j.coverage.sampled, j.frames);
  assert.ok(j.coverage.gapSeconds > 0);
  assert.match(cli(), /sampled frame\(s\), one every [\d.]+s: a problem shorter than that can be missed/);
});
