import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hfProject, isHyperFrames } from "../src/hyperframes.ts";

test("hfProject: copies ../ scripts and file:// fonts into assets/, rewrites URLs, drops <base>", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-hf-"));
  const font = path.resolve("assets/fonts/Alexandria.ttf");
  const html = `<base href="file:///x/"><script src="../node_modules/gsap/dist/gsap.min.js"></script><style>@font-face{src:url("${pathToFileURL(font).href}")}</style><img src="https://example.com/a.png"><div data-composition-id="main"></div>`;
  hfProject(html, path.resolve("demo"), dir);
  const out = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.doesNotMatch(out, /<base|\.\.\/node_modules|file:\/\//);
  assert.match(out, /src="assets\/0-gsap\.min\.js"/);
  assert.match(out, /url\("assets\/1-Alexandria\.ttf"\)/);
  assert.match(out, /https:\/\/example\.com\/a\.png/);
  assert.ok(fs.existsSync(path.join(dir, "assets/1-Alexandria.ttf")));
  assert.ok(isHyperFrames(html));
  fs.rmSync(dir, { recursive: true, force: true });
});
