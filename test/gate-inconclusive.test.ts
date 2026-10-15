// A gate that couldn't check is not a pass: when the layout audit can't run (no Chrome, a launch or bundle error) or
// the gate itself doesn't run, renders are blocked with the reason, unless HARAKAH_GATE=lenient. Also: Remotion gets a
// headless mode the given Chrome binary still has.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { remotionChromeMode } from "../src/render.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIX = path.join(ROOT, "fixtures/remotion");
const CLI = path.join(ROOT, "dist/cli.js");
const { withHarakah, toResults } = createRequire(import.meta.url)("../integrations/remotion/index.cjs");

/** Run the built CLI; returns exit code and output. */
function cli(args: string[], env: Record<string, string> = {}) {
  try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" }) }; }
  catch (e: any) { return { code: e.status as number, out: String(e.stdout) + String(e.stderr) }; }
}
const NO_CHROME = { HARAKAH_CHROME: "/bin/false" }; // exists, but isn't a browser: every launch fails

test("remotion chrome mode: old headless only for chrome-headless-shell, new headless for any other Chrome", () => {
  assert.equal(remotionChromeMode("/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"), "headless-shell");
  assert.equal(remotionChromeMode("/home/me/.cache/chrome-headless-shell/linux-141/chrome-headless-shell"), "headless-shell");
  assert.equal(remotionChromeMode("/usr/bin/google-chrome"), "chrome-for-testing");
  assert.equal(remotionChromeMode("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "chrome-for-testing");
  assert.equal(remotionChromeMode("google-chrome"), "chrome-for-testing");
  if (process.platform !== "win32") {
    // a symlink is judged by what it points to (Playwright's /opt/pw-browsers/chromium → …/chrome)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-mode-"));
    try {
      fs.mkdirSync(path.join(dir, "shell"));
      fs.writeFileSync(path.join(dir, "shell", "headless_shell"), "");
      fs.symlinkSync(path.join(dir, "shell", "headless_shell"), path.join(dir, "chrome"));
      assert.equal(remotionChromeMode(path.join(dir, "chrome")), "headless-shell");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("gate --layout: HTML whose layout audit can't run exits 2 with the reason; HARAKAH_GATE=lenient passes and says what wasn't checked", { timeout: 120_000 }, () => {
  const file = "fixtures/22-clean.html";
  assert.equal(cli(["gate", file]).code, 0, "static gate: clean");
  const r = cli(["gate", file, "--layout", "--json"], NO_CHROME);
  assert.equal(r.code, 2, r.out);
  const j = JSON.parse(r.out.slice(0, r.out.lastIndexOf("}") + 1));
  assert.equal(j.ok, false);
  assert.deepEqual(j.blocking, []);
  assert.equal(j.inconclusive.length, 1);
  assert.match(j.inconclusive[0].reason, /layout audit did not run/);
  const text = cli(["gate", file, "--layout"], NO_CHROME);
  assert.equal(text.code, 2);
  assert.match(text.out, /could not finish checking/);
  assert.match(text.out, /HARAKAH_GATE=lenient/);
  const lenient = cli(["gate", file, "--layout"], { ...NO_CHROME, HARAKAH_GATE: "lenient" });
  assert.equal(lenient.code, 0, lenient.out);
  assert.match(lenient.out, /Not checked \(HARAKAH_GATE=lenient\)/);
});

test("gate --layout: a Remotion composition whose audit can't launch Chrome exits 2, not 0", { timeout: 300_000 }, () => {
  const r = cli(["gate", "fixtures/remotion/src/clean/CleanTitle.tsx", "--layout", "--json"], NO_CHROME);
  assert.equal(r.code, 2, r.out);
  const j = JSON.parse(r.out.slice(0, r.out.lastIndexOf("}") + 1));
  assert.equal(j.ok, false);
  assert.match(j.inconclusive[0].reason, /Remotion layout audit did not run/);
});

test("withHarakah: a render is blocked when the gate itself can't run; HARAKAH_GATE=lenient renders; Studio shows it as an error, not 0 problems", { timeout: 300_000 }, async () => {
  const req = createRequire(path.join(FIX, "package.json"));
  const { bundle } = req("@remotion/bundler");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-gate-closed-"));
  const clean = path.join(out, "clean");
  try {
    fs.mkdirSync(path.join(clean, "src", "clean"), { recursive: true });
    for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(FIX, f), path.join(clean, f));
    fs.symlinkSync(path.join(FIX, "node_modules"), path.join(clean, "node_modules"), "dir");
    for (const f of ["clean/CleanTitle.tsx", "harakah-arabic.tsx", "global.d.ts"]) fs.copyFileSync(path.join(FIX, "src", f), path.join(clean, "src", f));
    fs.writeFileSync(path.join(clean, "src/Root.tsx"), `import React from "react";\nimport { Composition } from "remotion";\nimport { CleanTitle } from "./clean/CleanTitle";\nexport const RemotionRoot: React.FC = () => <Composition id="CleanTitle" component={CleanTitle} durationInFrames={30} width={640} height={360} fps={30} />;\n`);
    fs.writeFileSync(path.join(clean, "src/index.ts"), `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root";\nregisterRoot(RemotionRoot);\n`);
    const broken = { root: clean, cli: path.join(out, "missing-cli.js") }; // the gate can't start
    await assert.rejects(bundle({ entryPoint: path.join(clean, "src/index.ts"), outDir: path.join(out, "b1"), webpackOverride: withHarakah(broken) }),
      (e: Error) => /harakah gate did not run/.test(e.message) && /HARAKAH_GATE=lenient/.test(e.message));
    process.env.HARAKAH_GATE = "lenient";
    try {
      const served = await bundle({ entryPoint: path.join(clean, "src/index.ts"), outDir: path.join(out, "b2"), webpackOverride: withHarakah(broken) });
      assert.ok(fs.existsSync(path.join(served, "index.html")));
    } finally { delete process.env.HARAKAH_GATE; }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  const studio = toResults({ ok: false, blocking: [], inconclusive: [{ file: "x", reason: "Remotion layout audit did not run: no Chrome" }] }, "block", false);
  assert.deepEqual([studio.status, studio.note], ["error", "Remotion layout audit did not run: no Chrome"]);
});
