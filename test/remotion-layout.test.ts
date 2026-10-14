// Runtime layout audit (HZ24) for Remotion: the bundle is driven in headless Chrome, sampled frames are seeked
// (remotion_setFrame), and the Arabic visual order is read from DOM boxes. Wired into audit / gate / compare / withHarakah.
// Also: frame capture for the web scrubber (JPEG per sampled frame + flagged boxes).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { auditRemotion } from "../src/remotion/layout.ts";
import { compareRemotion } from "../src/remotion/compare.ts";
import { gate } from "../src/gate.ts";
import { auditLayoutFile } from "../src/layout-audit.ts";
import { ASSET_FONT_DIR } from "../src/fonts.ts";

const FIX = path.resolve("fixtures/remotion");
const CLI = path.resolve("dist/cli.js");
const { gateArgs } = createRequire(import.meta.url)("../integrations/remotion/index.cjs");

test("remotion audit: per-letter titles laid out LTR are flagged at their frames; clean compositions are not", { timeout: 240_000 }, async () => {
  const r = await auditRemotion(FIX, { fps: 2, maxFrames: 12, compositions: ["CharSplitTitle", "CleanTitle", "ArabicTextDemo", "QuranQuote", "LowerThird", "PropsTitle"] });
  const by = Object.fromEntries(r.compositions.map((c) => [c.id, c]));
  const cs = by.CharSplitTitle.findings.find((f) => f.kind === "letters" && f.problem === "ltr");
  assert.ok(cs, JSON.stringify(by.CharSplitTitle.findings));
  assert.ok(cs!.frames.length > 0 && by.CharSplitTitle.frames >= 2);
  assert.ok(by.CharSplitTitle.issues.every((i) => i.code === "HZ24" && i.where!.startsWith("CharSplitTitle: ")));
  // text from <Composition defaultProps> is audited too (the props reach the rendered DOM)
  assert.ok(by.PropsTitle.findings.some((f) => f.kind === "letters"));
  for (const id of ["CleanTitle", "ArabicTextDemo", "QuranQuote", "LowerThird"]) assert.deepEqual(by[id].findings, [], `${id}: ${JSON.stringify(by[id].findings)}`);
});

test("remotion audit: gate --layout reports HZ24 per composition (#id); compare audits both bundles (before flagged, after clean)", { timeout: 300_000 }, async () => {
  const g = await gate(FIX, { layout: true, composition: "CharSplitTitle" });
  const f = g.files.find((x) => x.file.endsWith("#CharSplitTitle"));
  assert.ok(f && f.issues.some((i) => i.code === "HZ24"), JSON.stringify(g.files.map((x) => x.file)));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-rl-"));
  const r = await compareRemotion(FIX, { outDir: out, compositions: ["CharSplitTitle"] });
  const x = r.renders[0];
  assert.ok(x.layout, "layout result");
  assert.ok(x.layout!.before.length > 0, JSON.stringify(x.layout));
  assert.equal(x.layout!.after.length, 0, JSON.stringify(x.layout!.after));
  fs.rmSync(out, { recursive: true, force: true });
});

test("remotion audit: CLI `audit <project> --composition` prints HZ24 and exits 1; --json carries the compositions", { timeout: 240_000 }, () => {
  let code = 0, out = "";
  try { out = execFileSync(process.execPath, [CLI, "audit", FIX, "--composition", "CharSplitTitle", "--max-frames", "6", "--json"], { encoding: "utf8" }); } catch (e: any) { code = e.status; out = e.stdout; }
  assert.equal(code, 1, out.slice(0, 400));
  const j = JSON.parse(out);
  const c = (j.compositions ?? []).find((x: any) => x.id === "CharSplitTitle");
  assert.ok(c && c.findings.length, out.slice(0, 400));
});

test("remotion audit: --all-frames checks each frame of the composition", { timeout: 240_000 }, () => {
  let out = "";
  try { out = execFileSync(process.execPath, [CLI, "audit", FIX, "--composition", "QuranQuote", "--all-frames", "--json"], { encoding: "utf8" }); } catch (e: any) { out = e.stdout; }
  const c = JSON.parse(out).compositions.find((x: any) => x.id === "QuranQuote");
  assert.equal(c.durationInFrames, 60);
  assert.equal(c.frames, 60, "one probe per frame");
  assert.deepEqual(c.coverage, { sampled: 60, gapSeconds: 0.033, total: 60, gapFrames: 1 });
});

test("withHarakah: layout option / HARAKAH_LAYOUT add --layout to the gate run", () => {
  assert.ok(!gateArgs("/p", { argv: false }, "cli.js").includes("--layout"));
  assert.ok(gateArgs("/p", { argv: false, layout: true }, "cli.js").includes("--layout"));
  const prev = process.env.HARAKAH_LAYOUT;
  try {
    process.env.HARAKAH_LAYOUT = "1"; assert.ok(gateArgs("/p", { argv: false }, "cli.js").includes("--layout"));
    process.env.HARAKAH_LAYOUT = "off"; assert.ok(!gateArgs("/p", { argv: false, layout: true }, "cli.js").includes("--layout"));
  } finally { if (prev === undefined) delete process.env.HARAKAH_LAYOUT; else process.env.HARAKAH_LAYOUT = prev; }
});

test("capture: a JPEG per sampled frame, flagged boxes only on the frames where the order is wrong", { timeout: 60_000 }, async () => {
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@font-face{font-family:P;src:url("${ASSET_FONT_DIR}/IBMPlexSansArabic-Regular.ttf")}body{margin:0;font:28px P}</style></head><body><h1 id="t" style="padding:40px;direction:ltr">${[..."حكاية"].map((c) => `<span style="display:inline-block">${c}</span>`).join("")}</h1>
<script>window.DUR = 2; window.seek = (t) => { document.getElementById("t").style.direction = t < 1 ? "ltr" : "rtl"; };</script></body></html>`;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hz-cap-")), "index.html");
  fs.writeFileSync(f, html);
  const r = await auditLayoutFile(f, { stage: { width: 900, height: 400 }, duration: 2, fps: 4, capture: { width: 450 } });
  assert.equal(r.timeline!.length, r.frames);
  assert.deepEqual(r.viewport, { width: 900, height: 400 });
  assert.ok(r.timeline!.every((x) => x.img!.startsWith("data:image/jpeg;base64,")));
  const flagged = r.timeline!.filter((x) => x.boxes.length).map((x) => x.t);
  assert.ok(flagged.length && flagged.every((t) => t < 1), JSON.stringify(flagged));
  const box = r.timeline!.find((x) => x.boxes.length)!.boxes[0];
  assert.equal(box.code, "HZ24");
  assert.equal(box.rects.length, 5);
  for (const [x, y, w, h] of box.rects) assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 900 && y + h <= 400, JSON.stringify(box.rects));
});
