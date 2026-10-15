// Harakah inside Remotion Studio: withHarakah() adds a small panel to development (Studio) builds only. It shows
// the latest check and updates live (webpack HMR) when files are fixed. Real `remotion studio` + Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
import { CHROME } from "../src/render.ts";

const ROOT = path.resolve(".");
const FIXNM = path.resolve("fixtures/remotion/node_modules");
const { withHarakah, resultsFile, OVERLAY } = createRequire(import.meta.url)("../integrations/remotion/index.cjs");

test("studio: overlay entry + results alias only in development builds", async () => {
  const dev = await withHarakah({ root: "/tmp/hz-x" })({ mode: "development", entry: ["a.js", "b.js"], resolve: { alias: { x: "y" } }, plugins: [] });
  assert.deepEqual(dev.entry, ["a.js", "b.js", OVERLAY]);
  assert.equal(dev.resolve.alias.x, "y");
  assert.equal(dev.resolve.alias["harakah-studio-results$"], resultsFile("/tmp/hz-x"));
  assert.equal(dev.plugins[0].o.resultsFile, resultsFile("/tmp/hz-x"));
  assert.ok(fs.existsSync(resultsFile("/tmp/hz-x")));
  const prod = await withHarakah({ root: "/tmp/hz-x" })({ mode: "production", entry: ["a.js"], plugins: [] });
  assert.deepEqual(prod.entry, ["a.js"]);
  const off = await withHarakah({ root: "/tmp/hz-x", studioOverlay: false })({ mode: "development", entry: ["a.js"], plugins: [] });
  assert.deepEqual(off.entry, ["a.js"]);
});

test("studio: real `remotion studio` shows the Harakah panel, updates live after a fix", { timeout: 300_000 }, async () => {
  // temp copy of the theme fixture with withHarakah() in remotion.config.ts (harakah-fixer linked into node_modules)
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "hz-studio-"));
  fs.cpSync(path.resolve("fixtures/remotion-theme"), proj, { recursive: true });
  fs.mkdirSync(path.join(proj, "node_modules"));
  for (const e of fs.readdirSync(FIXNM)) fs.symlinkSync(path.join(FIXNM, e), path.join(proj, "node_modules", e));
  fs.symlinkSync(ROOT, path.join(proj, "node_modules", "harakah-fixer"));
  fs.writeFileSync(path.join(proj, "remotion.config.ts"), `import { Config } from "@remotion/cli/config";\nimport { withHarakah } from "harakah-fixer/remotion";\nConfig.overrideWebpackConfig(withHarakah());\n`);
  fs.rmSync(resultsFile(proj), { force: true });
  const port = 3300 + Math.floor(Math.random() * 500);
  const studio = spawn(process.execPath, [path.join(FIXNM, "@remotion/cli/remotion-cli.js"), "studio", "src/index.ts", "--port", String(port), "--no-open"],
    // NODE_PATH: @remotion/cli resolves from its real path (the shared fixture node_modules)
    { cwd: proj, env: { ...process.env, NODE_PATH: path.join(proj, "node_modules"), HARAKAH_CLI: path.join(ROOT, "dist/cli.js") }, stdio: "pipe", detached: true });
  let log = "";
  studio.stdout!.on("data", (d) => (log += d)); studio.stderr!.on("data", (d) => (log += d));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  try {
    for (let i = 0; i < 200 && !/Built in/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
    assert.match(log, /Built in/, log);
    const p = await browser.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://localhost:${port}/ArabicTitle`, { waitUntil: "networkidle2", timeout: 60000 });
    const state = `(() => { const r = document.querySelector("harakah-studio")?.shadowRoot; return r ? { cls: r.querySelector(".hz")?.className, text: r.textContent } : null; })()`;
    await p.waitForFunction(`${state}?.cls === "hz blocked"`, { timeout: 90000 });
    const s: any = await p.evaluate(state);
    assert.match(s.text, /HZ02/);
    assert.match(s.text, /src\/utils\/letters\.ts:3/);
    assert.match(s.text, /مشكلة عربية واحدة/);
    assert.match(s.text, /harakah-fix fix .* --write/);
    assert.deepEqual(errors, []);
    // fix the project on disk → the panel turns green without a reload
    execFileSync(process.execPath, [path.join(ROOT, "dist/cli.js"), "fix", proj, "--write"], { stdio: "ignore" });
    await p.waitForFunction(`${state}?.cls === "hz ok"`, { timeout: 90000 });
    assert.match((await p.evaluate(state) as any).text, /النص العربي سليم/);
    // the ok panel collapses to the pill by itself
    await p.waitForFunction(`!document.querySelector("harakah-studio").shadowRoot.querySelector(".panel")`, { timeout: 10000 });
  } finally {
    await browser.close();
    try { process.kill(-studio.pid!, "SIGTERM"); } catch { studio.kill(); }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
