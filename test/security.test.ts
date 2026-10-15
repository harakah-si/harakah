// The web tool's API only answers its own page (no drive-by posts from other sites, no DNS rebinding), and uploaded
// projects are never executed (prettier JS configs and plugins).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { requestGuard, isLoopbackBind } from "../src/public.ts";
import { analyzeProject, filesFromList } from "../src/project-upload.ts";
import { staticPrettierConfig } from "../src/remotion/project.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const req = (method: string, headers: Record<string, string>) => ({ method, headers }) as unknown as http.IncomingMessage;

test("security: requestGuard refuses cross-site posts, preflight-free bodies and rebound hosts", () => {
  const H = { host: "127.0.0.1:4747" };
  const ok = (r: ReturnType<typeof requestGuard>) => assert.equal(r, null);
  ok(requestGuard(req("POST", { ...H, "content-type": "application/json" }), { loopback: true }));
  ok(requestGuard(req("POST", { ...H, "content-type": "application/json; charset=utf-8", origin: "http://127.0.0.1:4747", "sec-fetch-site": "same-origin" }), { loopback: true }));
  ok(requestGuard(req("POST", { ...H, "content-type": "application/zip" }), { loopback: true }));
  ok(requestGuard(req("GET", { host: "localhost:4747" }), { loopback: true }));
  assert.equal(requestGuard(req("POST", { ...H, "content-type": "text/plain" }), { loopback: true })?.status, 415);
  assert.equal(requestGuard(req("POST", { ...H }), { loopback: true })?.status, 415);
  assert.equal(requestGuard(req("POST", { ...H, "content-type": "application/json", origin: "https://evil.example" }), { loopback: true })?.status, 403);
  assert.equal(requestGuard(req("POST", { ...H, "content-type": "application/json", origin: "null" }), { loopback: true })?.status, 403);
  assert.equal(requestGuard(req("POST", { ...H, "content-type": "application/json", "sec-fetch-site": "cross-site" }), { loopback: true })?.status, 403);
  // DNS rebinding: same origin as far as the page knows, but the Host isn't loopback
  assert.equal(requestGuard(req("GET", { host: "evil.example:4747" }), { loopback: true })?.status, 403);
  assert.equal(requestGuard(req("POST", { host: "evil.example:4747", origin: "http://evil.example:4747", "content-type": "application/json" }), { loopback: true })?.status, 403);
  // bound to 0.0.0.0 (Docker, LAN): any Host, still same-origin only
  ok(requestGuard(req("POST", { host: "tool.example", origin: "https://tool.example", "content-type": "application/json" }), { loopback: false }));
  assert.equal(requestGuard(req("POST", { host: "tool.example", origin: "https://evil.example", "content-type": "application/json" }), { loopback: false })?.status, 403);
  assert.deepEqual(["127.0.0.1", "localhost", "::1", "0.0.0.0", "192.168.1.5"].map(isLoopbackBind), [true, true, true, false, false]);
});

/** Raw request (fetch can't set Host). */
function raw(port: number, method: string, p: string, headers: Record<string, string>, body = ""): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...headers, "content-length": Buffer.byteLength(body) } }, (res) => {
      let text = ""; res.on("data", (d) => (text += d)); res.on("end", () => resolve({ status: res.statusCode!, text }));
    });
    r.on("error", reject);
    r.end(body);
  });
}

test("security: real server answers its own page, refuses a drive-by text/plain post, another Origin and a rebound Host", { timeout: 60_000 }, async () => {
  const child = spawn(process.execPath, ["dist/server.js"], { cwd: ROOT, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (d) => { out += d; const m = /127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
      child.on("exit", (c) => reject(new Error("server exited " + c + out)));
    });
    const H = `127.0.0.1:${port}`;
    const body = JSON.stringify({ html: "<p>مرحبا</p>", kind: "html" });
    assert.equal((await raw(port, "POST", "/api/analyze", { host: H, "content-type": "application/json", origin: `http://${H}`, "sec-fetch-site": "same-origin" }, body)).status, 200, "the tool page");
    assert.equal((await raw(port, "POST", "/api/analyze", { host: H, "content-type": "application/json" }, body)).status, 200, "curl / agents");
    // what a page on another site can send without a preflight
    const driveBy = await raw(port, "POST", "/api/compare", { host: H, "content-type": "text/plain;charset=UTF-8", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body);
    assert.equal(driveBy.status, 403);
    assert.match(JSON.parse(driveBy.text).error, /cross-site/);
    assert.equal((await raw(port, "POST", "/api/project", { host: H, "content-type": "text/plain" }, JSON.stringify({ files: [] }))).status, 415);
    assert.equal((await raw(port, "GET", "/api/meta", { host: `rebound.example:${port}` })).status, 403, "DNS rebinding");
    assert.equal((await raw(port, "GET", "/", { host: `localhost:${port}` })).status, 200);
  } finally { child.kill(); }
});

test("security: an uploaded project's prettier.config.js and plugins never run; static JSON options still apply", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hz-sec-"));
  const marker = (n: string) => path.join(tmp, n);
  const prettier = (await import("prettier")).default;
  const src = await prettier.format(`export const Title = () => <h1>{"مرحبا بكم".split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</h1>;\n`, { filepath: "Title.tsx", singleQuote: true });
  const pkg = JSON.stringify({ name: "x", dependencies: { remotion: "4" } });
  try {
    // a JS config: would run on resolveConfig
    const js = await analyzeProject(filesFromList([
      { path: "package.json", text: pkg },
      { path: "prettier.config.js", text: `require("fs").writeFileSync(${JSON.stringify(marker("config"))}, "ran"); module.exports = { singleQuote: true };` },
      { path: "src/Title.tsx", text: src },
    ]), "js-config");
    assert.ok(js.changed.includes("src/Title.tsx"), "the codemod still ran");
    assert.equal(fs.existsSync(marker("config")), false, "prettier.config.js was executed");
    // a JSON config with a plugin: options apply, the plugin never loads
    const plugin = `require("fs").writeFileSync(${JSON.stringify(marker("plugin"))}, "ran"); module.exports = {};`;
    const json = await analyzeProject(filesFromList([
      { path: "package.json", text: pkg },
      { path: ".prettierrc.json", text: JSON.stringify({ singleQuote: true, plugins: ["./evil-plugin.cjs"], overrides: [{ files: "*.tsx", options: { plugins: ["./evil-plugin.cjs"] } }] }) },
      { path: "evil-plugin.cjs", text: plugin },
      { path: "src/Title.tsx", text: src },
    ]), "json-config");
    assert.equal(fs.existsSync(marker("plugin")), false, "a prettier plugin from the upload was loaded");
    assert.match(json.patch, /^\+import \{ splitArabic \} from '\.\/harakah-arabic';/m, "singleQuote from .prettierrc.json applied");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("security: staticPrettierConfig reads data only, nearest first, never above the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hz-prc-"));
  const put = (rel: string, s: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), s); };
  try {
    put("package.json", JSON.stringify({ prettier: { semi: false, plugins: ["x"], printWidth: 100 } }));
    put("src/a/Title.tsx", "");
    assert.deepEqual(staticPrettierConfig(path.join(root, "src/a/Title.tsx"), root), { semi: false, printWidth: 100 });
    put("src/.prettierrc", JSON.stringify({ singleQuote: true }));
    assert.deepEqual(staticPrettierConfig(path.join(root, "src/a/Title.tsx"), root), { singleQuote: true }, "nearest config wins");
    put("src/a/.prettierrc.cjs", "module.exports = {}");
    assert.deepEqual(staticPrettierConfig(path.join(root, "src/a/Title.tsx"), root), {}, "a JS config means no project options");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ prettier: "@acme/prettier-config" }));
    assert.deepEqual(staticPrettierConfig(path.join(root, "Root.tsx"), root), {}, "a shared-config module name is not data");
    assert.deepEqual(staticPrettierConfig(path.join(root, "src/b/X.tsx"), path.join(root, "src/b")), {}, "nothing above the root is read");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("hyperframes pre-commit: finds Arabic with plain grep (no -P), skips Latin-only files", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "hz-precommit-"));
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
    git("init", "-q");
    fs.writeFileSync(path.join(repo, "broken.html"), fs.readFileSync(path.join(ROOT, "fixtures/01-split-inline-block.html")));
    fs.writeFileSync(path.join(repo, "latin.html"), "<h1>Hello é 中文</h1>\n");
    git("add", ".");
    const env = { ...process.env, HARAKAH_FIX: `${process.execPath} ${path.join(ROOT, "dist/cli.js")}` };
    let code = 0, err = "";
    try { execFileSync("bash", [path.join(ROOT, "integrations/hyperframes/pre-commit")], { cwd: repo, env, encoding: "utf8", stdio: "pipe" }); }
    catch (e: any) { code = e.status; err = String(e.stderr); }
    assert.equal(code, 1, "the broken Arabic file blocks the commit");
    assert.match(err, /broken\.html/);
    assert.doesNotMatch(err, /latin\.html/);
    git("rm", "-q", "--cached", "broken.html");
    execFileSync("bash", [path.join(ROOT, "integrations/hyperframes/pre-commit")], { cwd: repo, env, stdio: "pipe" }); // Latin only: passes
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
