import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareHtml } from "../src/pipeline.ts";

const FX = path.resolve(import.meta.dirname, "..", "fixtures");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "harakah-test-"));

for (const [file, split] of [["01-split-inline-block.html", "zwj"], ["01-split-inline-block.html", "word"], ["02-split-runtime.html", "zwj"], ["23-split-word-strategy.html", "zwj"], ["25-gsap-splittext.html", "zwj"]] as const) {
  test(`render: ${file} (${split}) — broken before, letters joined after (ink components match plain-text reference)`, { timeout: 60000 }, async () => {
    const html = fs.readFileSync(path.join(FX, file), "utf8");
    const r = await compareHtml(html, tmp(), { split }, {}, FX);
    assert.ok(r.joins.length >= 1, "a per-letter split title should be found in the live DOM");
    // At least one title must be broken before; every title must be joined after.
    assert.ok(r.joins.some((j) => !j.joinedBefore), `expected a broken title before: ${JSON.stringify(r.joins)}`);
    for (const j of r.joins) {
      assert.equal(j.joinedAfter, true, `after should be joined: ${JSON.stringify(j)}`);
      if (!j.joinedBefore) assert.ok(j.before > j.reference || j.widthBefore > j.widthReference * 1.04, "broken render has more pieces or wider ink than the reference");
    }
    assert.ok(fs.statSync(r.comparePng).size > 10000);
  });
}

test("render: compare MP4 via the fast capture path (piped JPEG → ffmpeg), capped by maxDuration", { timeout: 90000 }, async () => {
  const { execFileSync } = await import("node:child_process");
  const html = fs.readFileSync(path.join(FX, "02-split-runtime.html"), "utf8");
  const r = await compareHtml(html, tmp(), {}, { video: true, fps: 24, maxDuration: 1.5 }, FX);
  assert.ok(r.mp4 && fs.statSync(r.mp4).size > 5000, "an MP4 is written");
  assert.ok(r.duration <= 1.5, `duration capped: ${r.duration}`);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt:format=duration", "-of", "json", r.mp4!], { encoding: "utf8" }));
  assert.equal(probe.streams[0].codec_name, "h264");
  assert.equal(probe.streams[0].pix_fmt, "yuv420p", "plays in browsers / QuickTime");
  assert.ok(Number(probe.format.duration) < 4, `short clip: ${probe.format.duration}s`);
  // the after panel is joined in the still too (separate browsers: no stale background-tab frame)
  for (const j of r.joins) assert.equal(j.joinedAfter, true, JSON.stringify(j));
});
