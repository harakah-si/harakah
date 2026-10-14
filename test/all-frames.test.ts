// Sampling vs every frame: a 3-frame layout glitch that a sampled audit can step over, caught by `audit --all-frames`,
// and the miss rates of each sampling rate (the table in docs/REFERENCE.md, "Layout order and bidi") computed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sampleTimes, allFramesCount, ALL_FRAMES_MAX } from "../src/layout-audit.ts";
import { ASSET_FONT_DIR } from "../src/fonts.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "dist/cli.js");
// a 4 s, 30 fps scene whose per-letter title is laid out left-to-right for frames 50–52 only (0.1 s)
const GLITCH = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@font-face{font-family:P;src:url("${ASSET_FONT_DIR}/IBMPlexSansArabic-Regular.ttf")}body{margin:0;font:48px P}</style></head><body>
<h1 id="t" style="padding:40px">${[..."حكاية"].map((c) => `<span style="display:inline-block">${c}</span>`).join("")}</h1>
<script>window.DUR = 4; window.seek = (t) => { const f = Math.round(t * 30); document.getElementById("t").style.direction = f >= 50 && f <= 52 ? "ltr" : "rtl"; };</script></body></html>`;

function audit(args: string[]) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-allf-"));
  const file = path.join(d, "glitch.html");
  fs.writeFileSync(file, GLITCH);
  try {
    const r = spawnSync(process.execPath, [CLI, "audit", file, "--json", ...args], { encoding: "utf8", timeout: 180_000 });
    return { code: r.status, j: JSON.parse(r.stdout), err: r.stderr };
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test("all frames: a 3-frame flip slips between 2 fps samples, and --all-frames catches it on exactly its frames", { timeout: 240_000 }, () => {
  const sampled = audit(["--fps", "2"]);
  assert.equal(sampled.code, 0, "sampled at 2 fps, the glitch falls between two samples");
  assert.deepEqual(sampled.j.findings, []);
  assert.equal(sampled.j.coverage.gapSeconds, 0.5);

  const all = audit(["--all-frames"]);
  assert.equal(all.code, 1, all.err);
  assert.deepEqual(all.j.coverage, { sampled: 121, gapSeconds: 0.033, total: 121, gapFrames: 1 });
  const letters = all.j.findings.find((f: any) => f.kind === "letters");
  assert.ok(letters, JSON.stringify(all.j.findings));
  assert.deepEqual(letters.frames.map((t: number) => Math.round(t * 30)), [50, 51, 52]);
});

/** Share of glitches of `len` frames (every start position in a `sec` s clip at 30 fps) with no sampled frame on them. */
function missRate(len: number, sampleFps: number, max: number, sec = 4, fps = 30): number {
  const total = Math.round(sec * fps) + 1;
  const frames = new Set(sampleTimes(sec, sampleFps, max).map((t) => Math.round(t * fps)));
  let missed = 0, n = 0;
  for (let s = 0; s + len <= total; s++, n++) if (!Array.from({ length: len }, (_, k) => s + k).some((f) => frames.has(f))) missed++;
  return +(missed / n).toFixed(2);
}

test("all frames: miss rates of the sampling rates in use (4 s clip at 30 fps), as documented", () => {
  const rates = (sf: number, max: number) => [1, 3, 10].map((len) => missRate(len, sf, max));
  assert.deepEqual(rates(10, 300), [0.66, 0, 0], "audit (HTML default 10 fps)");
  assert.deepEqual(rates(6, 300), [0.79, 0.4, 0], "gate --layout, HTML (6 fps)");
  assert.deepEqual(rates(4, 120), [0.86, 0.61, 0], "compare, and audit of Remotion (4 fps)");
  assert.deepEqual(rates(2, 60), [0.93, 0.81, 0.36], "gate --layout, Remotion (2 fps)");
  assert.deepEqual(rates(30, ALL_FRAMES_MAX), [0, 0, 0], "--all-frames");
});

test("all frames: refused above the cap with a way out", () => {
  assert.equal(allFramesCount(4, 30), 121);
  assert.equal(allFramesCount(59.9, 30), 1798);
  assert.throws(() => allFramesCount(61, 30), /--all-frames: 1831 frames \(61s at 30 fps\) is more than 1800\. Audit a shorter clip, or sample with --fps\./);
});
