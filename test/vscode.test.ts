// VS Code extension: `check --json` → diagnostics mapping (real CLI output), fix arguments per file type
// (applied to temp copies with the real CLI), CLI resolution, and activate() against a stubbed `vscode` module.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const lib = require("../integrations/vscode/lib.js");
const cli = (args: string[]) => { try { return execFileSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return (e as { stdout: string }).stdout; } };

test("vscode: check --json → diagnostics (HTML + Remotion), languages, fixed issues skipped", () => {
  const html = "fixtures/01-split-inline-block.html";
  const d = lib.toDiagnostics(JSON.parse(cli(["check", html, "--json"])), html, "en");
  const hz01 = d.find((x: { code: string }) => x.code === "HZ01");
  assert.ok(hz01, JSON.stringify(d));
  assert.deepEqual([hz01.line, hz01.severity, hz01.fixable], [15, 0, true]);
  assert.match(hz01.message, /^Arabic split into per-letter boxes: /);
  const ar = lib.toDiagnostics(JSON.parse(cli(["check", html, "--json"])), html, "ar");
  assert.match(ar[0].message, /[\u0600-\u06FF]/);
  const tsx = "fixtures/remotion/src/broken/CharSplitTitle.tsx";
  const t = lib.toDiagnostics(JSON.parse(cli(["check", tsx, "--json"])), tsx);
  assert.ok(t.some((x: { code: string; severity: number }) => x.code === "HZ02" && x.severity === 0), JSON.stringify(t.map((x: { code: string }) => x.code)));
  assert.deepEqual(lib.toDiagnostics({ issues: [{ code: "HZ07", severity: "warning", message: { en: "m" }, fixed: true }] }, "a.html"), []);
  assert.deepEqual(lib.toDiagnostics({ issues: [{ code: "HZ07", severity: "info", title: "T", message: "T: m" }] }, "a.html")[0], { line: 0, severity: 2, code: "HZ07", message: "T: m", fixable: false });
});

test("vscode: fix args per file type work with the real CLI; command resolution", () => {
  assert.deepEqual(lib.fixArgs("/p/a.html"), ["fix", "/p/a.html", "-o", "/p/a.html"]);
  assert.deepEqual(lib.fixArgs("/p/T.tsx"), ["fix", "/p/T.tsx", "--write"]);
  assert.deepEqual(lib.fixArgs("/p/C.vue"), ["fix", "/p/C.vue", "--write"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-vsc-"));
  const f = path.join(dir, "scene.html");
  fs.copyFileSync("fixtures/01-split-inline-block.html", f);
  cli(lib.fixArgs(f));
  const after = lib.toDiagnostics(JSON.parse(cli(["check", f, "--json"])), f);
  assert.ok(!after.some((x: { code: string }) => x.code === "HZ01"), "HZ01 fixed in place");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(lib.parseCommand('node "/a b/cli.js" --x'), { cmd: "node", args: ["/a b/cli.js", "--x"] });
  assert.deepEqual(lib.resolveCli("npx harakah-fix", []), { cmd: "npx", args: ["harakah-fix"] });
  assert.deepEqual(lib.resolveCli("", ["/w"], (p: string) => p === path.join("/w", "node_modules", ".bin", "harakah-fix")), { cmd: path.join("/w", "node_modules", ".bin", "harakah-fix"), args: [] });
  assert.deepEqual(lib.resolveCli("", ["/w"], () => false), { cmd: "harakah-fix", args: [] });
});

test("vscode: manifest + activate() registers commands, code actions, diagnostics", () => {
  const pkg = JSON.parse(fs.readFileSync("integrations/vscode/package.json", "utf8"));
  assert.equal(pkg.main, "./extension.js");
  assert.ok(pkg.engines.vscode && pkg.publisher);
  assert.deepEqual(pkg.contributes.commands.map((c: { command: string }) => c.command), ["harakah.checkFile", "harakah.previewFix", "harakah.applyFix", "harakah.fixFile"]);
  // a stock VS Code opens .astro/.vue/.svelte as plaintext: activation and code actions can't rely on those language ids
  assert.ok(pkg.activationEvents.includes("onLanguage:plaintext") && pkg.activationEvents.some((a: string) => a.startsWith("workspaceContains:")));
  const registered: string[] = [];
  const disp = { dispose() {} };
  const stub = {
    languages: { createDiagnosticCollection: () => ({ ...disp, set() {}, delete() {} }), registerCodeActionsProvider: (sel: { pattern?: string }) => { registered.push(`codeActions:${sel.pattern}`); return disp; } },
    window: { createOutputChannel: () => ({ ...disp, appendLine() {} }), activeTextEditor: undefined },
    commands: { registerCommand: (id: string) => { registered.push(id); return disp; } },
    EventEmitter: class { event = () => disp; fire() {} },
    workspace: { registerTextDocumentContentProvider: (scheme: string) => { registered.push(`content:${scheme}`); return disp; }, onDidOpenTextDocument: () => disp, onDidSaveTextDocument: () => disp, onDidCloseTextDocument: () => disp, textDocuments: [], workspaceFolders: [], getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
    CodeActionKind: { QuickFix: "quickfix" },
  };
  const M = Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown };
  const orig = M._load;
  M._load = function (r: string, ...a: unknown[]) { return r === "vscode" ? stub : orig.call(this, r, ...a); };
  try {
    const ext = require("../integrations/vscode/extension.js");
    const ctx = { subscriptions: [] as unknown[] };
    ext.activate(ctx);
    assert.deepEqual(registered.sort(), ["codeActions:**/*.{html,htm,tsx,jsx,astro,vue,svelte}", "content:harakah-fixed", "harakah.applyFix", "harakah.checkFile", "harakah.fixFile", "harakah.previewFix"]);
    assert.ok(ctx.subscriptions.length >= 7);
    ext.deactivate();
  } finally { M._load = orig; }
});

test("vscode: minimalEdit replaces only the changed middle (keeps CRLF and surrogate pairs whole)", () => {
  const apply = (a: string, e: { start: number; end: number; text: string }) => a.slice(0, e.start) + e.text + a.slice(e.end);
  for (const [a, b] of [["<p>iPhone 17</p>", "<p><bdi>iPhone 17</bdi></p>"], ["a\r\nb 12", "a\r\nb ١٢"], ["x 😀 1", "x 😀 ١"], ["same", "same"], ["", "new"], ["old", ""]]) {
    const e = lib.minimalEdit(a, b);
    assert.equal(apply(a, e), b, `${a} → ${b}`);
  }
  assert.deepEqual(lib.minimalEdit("<h2>عرض iPhone</h2>", "<h2>عرض <bdi>iPhone</bdi></h2>"), { start: 8, end: 14, text: "<bdi>iPhone</bdi>" });
});

test("vscode: fix --dry-run --json lists every file the codemod would write (full text, created helper), writes nothing", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-vsc-dry-"));
  fs.mkdirSync(path.join(d, "src"));
  fs.writeFileSync(path.join(d, "package.json"), '{"name":"x","private":true}');
  const f = path.join(d, "src/Title.tsx");
  fs.copyFileSync("fixtures/24-remotion.tsx", f);
  const before = fs.readFileSync(f, "utf8");
  const j = JSON.parse(execFileSync("node", ["dist/cli.js", "fix", f, "--dry-run", "--json"], { encoding: "utf8" }));
  assert.deepEqual(j.changes.map((c: { file: string; create: boolean }) => [path.relative(d, c.file), c.create]), [["src/Title.tsx", false], ["src/harakah-arabic.tsx", true]]);
  assert.match(j.changes[0].text, /harakah-arabic/);
  assert.match(j.changes[1].text, /^\/\/ Vendored by harakah-fix/);
  assert.equal(fs.readFileSync(f, "utf8"), before, "dry run writes nothing");
  assert.ok(!fs.existsSync(path.join(d, "src/harakah-arabic.tsx")));
  // the same texts are what --write produces
  execFileSync("node", ["dist/cli.js", "fix", f, "--write"], { encoding: "utf8" });
  assert.equal(fs.readFileSync(f, "utf8"), j.changes[0].text);
  assert.equal(fs.readFileSync(path.join(d, "src/harakah-arabic.tsx"), "utf8"), j.changes[1].text);
});
