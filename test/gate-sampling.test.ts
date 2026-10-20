// gate --layout samples a composition evenly (2 fps, at most 60 frames). In a long composition that leaves seconds
// between samples, so a short caption fell between them and the gate passed broken Arabic (OpenMontage's
// CaptionOverlayOnly: 9000 frames, a 3.2 s word caption laid out LTR). Timed windows found in the props
// (startMs/endMs, start/end, from/durationInFrames, ...) are now seeked too.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate } from "../src/gate.ts";
import { auditRemotion } from "../src/remotion/layout.ts";
import { propTimeWindows, windowSampleTimes } from "../src/remotion/prop-times.ts";

const FIX = path.resolve("fixtures/remotion");

// Same structure as OpenMontage's CaptionOverlay: one <Sequence> per page, each word an inline-block, no dir.
const CAPTIONS = `import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
type W = { word: string; startMs: number; endMs: number };
const Page: React.FC<{ words: W[]; startMs: number }> = ({ words, startMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = startMs + (frame / fps) * 1000;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 80 }}>
      <div style={{ background: "rgba(15,23,42,0.75)", padding: "14px 28px", textAlign: "center", maxWidth: "80%" }}>
        <span style={{ fontSize: 58, fontWeight: 700, whiteSpace: "pre-wrap" }}>
          {words.map((w, i) => (
            <React.Fragment key={i}>
              <span style={{ display: "inline-block", whiteSpace: "nowrap", color: w.startMs <= now ? "#facc15" : "#f8fafc" }}>{w.word}</span>
              {i < words.length - 1 ? " " : ""}
            </React.Fragment>
          ))}
        </span>
      </div>
    </AbsoluteFill>
  );
};
export const Captions: React.FC<{ words: W[] }> = ({ words }) => {
  const { fps } = useVideoConfig();
  if (!words.length) return null;
  const startMs = words[0].startMs, endMs = words[words.length - 1].endMs;
  return (
    <AbsoluteFill>
      <Sequence from={Math.round((startMs / 1000) * fps)} durationInFrames={Math.max(1, Math.round(((endMs - startMs) / 1000) * fps))}>
        <Page words={words} startMs={startMs} />
      </Sequence>
    </AbsoluteFill>
  );
};
`;
const ROOT = `import React from "react";
import { Composition } from "remotion";
import { Captions } from "./Captions";
export const RemotionRoot: React.FC = () => (
  <Composition id="CaptionOverlayOnly" component={Captions} durationInFrames={9000} width={1920} height={1080} fps={30} defaultProps={{ words: [] }} />
);
`;
const WORDS = ["أوبن", "مونتاج", "يحوّل", "كلود", "كود", "إلى", "استوديو", "فيديو"].map((word, i) => ({ word, startMs: i * 400, endMs: (i + 1) * 400 }));

function captionProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-gate-sampling-"));
  fs.mkdirSync(path.join(dir, "src"));
  for (const f of ["package.json", "tsconfig.json", "remotion.config.ts"]) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  fs.copyFileSync(path.join(FIX, "src", "index.ts"), path.join(dir, "src", "index.ts"));
  fs.writeFileSync(path.join(dir, "src", "Root.tsx"), ROOT);
  fs.writeFileSync(path.join(dir, "src", "Captions.tsx"), CAPTIONS);
  fs.symlinkSync(path.join(FIX, "node_modules"), path.join(dir, "node_modules"), "dir");
  return dir;
}

test("propTimeWindows: ms, seconds, frame pairs and from/durationInFrames, nested", () => {
  const w = propTimeWindows({ words: [{ startMs: 0, endMs: 400 }], scenes: [{ in_seconds: 2, out_seconds: 3 }, { start: 5, end: 6 }], seq: { from: 30, durationInFrames: 15 }, bad: { startMs: 5, endMs: 5 } }, 30);
  assert.deepEqual(w, [[0, 0.4], [2, 3], [5, 6], [1, 1.5]]);
  assert.deepEqual(windowSampleTimes(w, 10, 30, 10), [0.2, 1.267, 2.5, 5.5]);
  assert.equal(windowSampleTimes(Array.from({ length: 500 }, (_, i) => [i / 100, i / 100 + 0.005] as [number, number]), 10, 30, 20).length, 20);
});

test("gate --layout: a 3.2 s caption in a 9000-frame composition is audited (OpenMontage CaptionOverlayOnly case)", { timeout: 300_000 }, async () => {
  const dir = captionProject();
  try {
    const g = await gate(dir, { layout: true, composition: "CaptionOverlayOnly", inputProps: { words: WORDS } });
    const f = g.files.find((x) => x.file.endsWith("#CaptionOverlayOnly"));
    assert.ok(f && f.issues.some((i) => i.code === "HZ24"), JSON.stringify(g.files.map((x) => ({ file: x.file, issues: x.issues.map((i) => i.code) }))));
    assert.equal(g.ok, false);
    // with the direction set, the same timed samples find nothing
    fs.writeFileSync(path.join(dir, "src", "Captions.tsx"), CAPTIONS.replace(`<div style={{ background`, `<div dir="rtl" style={{ background`));
    const r = await auditRemotion(dir, { compositions: ["CaptionOverlayOnly"], inputProps: { words: WORDS }, fps: 2, maxFrames: 60 });
    assert.ok((r.compositions[0].timedFrames ?? 0) >= 8, JSON.stringify(r.compositions[0].timedFrames));
    assert.deepEqual(r.compositions[0].findings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
