// Harakah for VS Code: Arabic motion/RTL diagnostics from `harakah-fix check --json` on open and save, and a
// quick fix. Templates (.astro/.vue/.svelte) get a preview first: a diff of the patch, applied as one undoable
// edit. Remotion .tsx/.jsx fixes (often several files: the component, a vendored helper, CSS) open as a multi-file
// diff, applied as one undoable workspace edit. Local only: nothing is uploaded.
// حركة داخل VS Code: تنبيهات النص العربي من harakah-fix، وإصلاح سريع بأمر fix.
"use strict";
const vscode = require("vscode");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EXT, TEMPLATE, JSX, PREVIEW, PATTERN, resolveCli, toDiagnostics, fixArgs, minimalEdit } = require("./lib");

const SCHEME = "harakah-fixed";
const previews = new Map(); // fixed-view uri string → { text, source uri string, version, summary }
const codemods = new Map(); // .tsx uri string → { version, fx } of the last preview
const previewEvents = new vscode.EventEmitter();

let collection, output;
const timers = new Map();
const fixableKeys = new Map(); // uri → Set("line:code") of auto-fixable findings (code-action diagnostics are copies)

function cfg() { return vscode.workspace.getConfiguration("harakah"); }
function cli() { return resolveCli(cfg().get("command"), (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)); }
function cwdFor(file) { const f = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)); return f ? f.uri.fsPath : path.dirname(file); }

function run(args, file) {
  const { cmd, args: pre } = cli();
  return new Promise((resolve) => {
    execFile(cmd, [...pre, ...args], { cwd: cwdFor(file), maxBuffer: 32 << 20, timeout: 120000, shell: process.platform === "win32" }, (err, stdout, stderr) =>
      resolve({ code: err && typeof err.code === "number" ? err.code : err ? -1 : 0, stdout: String(stdout || ""), stderr: String(stderr || ""), spawnError: err && err.code === "ENOENT" }));
  });
}

async function check(doc) {
  if (doc.uri.scheme !== "file" || !EXT.test(doc.fileName) || !cfg().get("enable", true)) return;
  const file = doc.fileName;
  const r = await run(["check", file, "--json"], file);
  if (r.spawnError) { output.appendLine(`harakah-fix not found (${cli().cmd}). Set "harakah.command", e.g. "npx harakah-fix" or "node /path/to/dist/cli.js".`); return; }
  let json;
  try { json = JSON.parse(r.stdout); } catch { output.appendLine(`check ${file}: ${r.stderr.trim() || "no JSON output"}`); return; }
  const diags = toDiagnostics(json, file, cfg().get("language", "en")).map((d) => {
    const line = Math.min(d.line, doc.lineCount - 1);
    const range = doc.lineAt(line).range;
    const x = new vscode.Diagnostic(range, d.message, d.severity);
    x.source = "Harakah";
    x.code = d.code;
    return x;
  });
  fixableKeys.set(doc.uri.toString(), new Set(toDiagnostics(json, file, "en").filter((d) => d.fixable).map((d) => `${Math.min(d.line, doc.lineCount - 1)}:${d.code}`)));
  collection.set(doc.uri, diags);
}

function schedule(doc, ms) {
  clearTimeout(timers.get(doc.uri.toString()));
  timers.set(doc.uri.toString(), setTimeout(() => check(doc), ms));
}

const docFor = async (uri) => (uri ? vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
const fixedUri = (doc) => vscode.Uri.from({ scheme: SCHEME, path: doc.uri.path, query: `v=${doc.version}` });

/** Template patch from the CLI (`fix <file> -o <tmp> --json`): the fixed text and its summary; null on failure. */
async function templateFix(doc) {
  if (doc.isDirty) await doc.save();
  const tmp = path.join(os.tmpdir(), `harakah-${process.pid}-${Date.now()}${path.extname(doc.fileName)}`);
  const r = await run(["fix", doc.fileName, "-o", tmp, "--json"], doc.fileName);
  let json = null, text = null;
  try { json = JSON.parse(r.stdout); text = fs.readFileSync(tmp, "utf8"); } catch { /* reported below */ } finally { fs.rmSync(tmp, { force: true }); }
  if (!json || text == null) { vscode.window.showErrorMessage(`Harakah fix failed: ${(r.stderr || r.stdout || "no output").trim().split("\n").pop()}`); return null; }
  const res = (json.results || [])[0] || {};
  return { text, before: json.before, after: json.after, edits: (res.edits || []).length, skipped: res.skipped || [] };
}

/** Codemod changes from the CLI (`fix <file> --dry-run --json`): [{file, text, create}] plus a summary; null on failure. */
async function codemodFix(doc) {
  if (doc.isDirty) await doc.save();
  const r = await run(["fix", doc.fileName, "--dry-run", "--json"], doc.fileName);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (!json || !Array.isArray(json.changes)) { vscode.window.showErrorMessage(`Harakah fix failed: ${(r.stderr || r.stdout || "no output").trim().split("\n").pop()}`); return null; }
  const issues = (json.results || []).flatMap((x) => x.issues || []);
  return { changes: json.changes, fixed: issues.filter((i) => i.fixed || i.fixable).length, manual: issues.filter((i) => !i.fixed && !i.fixable).length }; // a dry run marks what it would fix as fixable
}

/** The codemod's files as one workspace edit (minimal replacement per existing file, created files inserted). */
async function codemodEdit(fx) {
  const we = new vscode.WorkspaceEdit();
  for (const c of fx.changes) {
    const u = vscode.Uri.file(c.file);
    if (c.create) { we.createFile(u, { ignoreIfExists: true }); we.insert(u, new vscode.Position(0, 0), c.text); continue; }
    const d = await vscode.workspace.openTextDocument(u);
    const e = minimalEdit(d.getText(), c.text);
    if (e.start !== e.end || e.text) we.replace(u, new vscode.Range(d.positionAt(e.start), d.positionAt(e.end)), e.text);
  }
  return we;
}

/** Show the fix before it lands: templates as a diff (original ↔ fixed), .tsx/.jsx in the refactor preview. */
async function previewFix(uri) {
  const doc = await docFor(uri);
  if (!doc || !PREVIEW.test(doc.fileName)) return null;
  if (JSX.test(doc.fileName)) {
    const fx = await codemodFix(doc);
    if (!fx) return null;
    if (!fx.changes.length) { vscode.window.setStatusBarMessage("Harakah: nothing to fix automatically · لا يوجد ما يُصلح", 6000); return fx; }
    codemods.set(doc.uri.toString(), { version: doc.version, fx });
    // one diff per file (a created helper against an empty file), in the multi-file diff editor when available
    const tag = `v=${doc.version}&t=${Date.now()}`;
    const rows = fx.changes.map((c) => {
      const right = vscode.Uri.from({ scheme: SCHEME, path: c.file, query: tag });
      const left = c.create ? vscode.Uri.from({ scheme: SCHEME, path: c.file, query: `${tag}&empty` }) : vscode.Uri.file(c.file);
      previews.set(right.toString(), { text: c.text });
      if (c.create) previews.set(left.toString(), { text: "" });
      previewEvents.fire(right);
      return [vscode.Uri.file(c.file), left, right];
    });
    const title = `Harakah fix: ${fx.changes.map((c) => path.basename(c.file)).join(", ")} (${fx.fixed} auto-fix(es))`;
    try { await vscode.commands.executeCommand("vscode.changes", title, rows); } // VS Code ≥ 1.86
    catch { await vscode.commands.executeCommand("vscode.diff", rows[0][1], rows[0][2], title); }
    vscode.window.showInformationMessage(`Harakah: ${fx.changes.length} file(s), ${fx.fixed} auto-fix(es)${fx.manual ? `, ${fx.manual} left for you` : ""}.`, "Apply · طبّق").then((pick) => { if (pick) applyFix(doc.uri); });
    return fx;
  }
  const fx = await templateFix(doc);
  if (!fx) return null;
  const right = fixedUri(doc);
  previews.set(right.toString(), { ...fx, source: doc.uri.toString(), version: doc.version });
  previewEvents.fire(right);
  for (const k of fx.skipped) output.appendLine(`${path.basename(doc.fileName)}:${k.line}  not patched: ${k.why}`);
  if (!fx.edits) { vscode.window.setStatusBarMessage("Harakah: nothing to patch in this template · لا يوجد ما يُصلح", 6000); return fx; }
  await vscode.commands.executeCommand("vscode.diff", doc.uri, right, `${path.basename(doc.fileName)} ↔ Harakah fix (${fx.before} → ${fx.after} findings)`, { preview: true });
  vscode.window.showInformationMessage(`Harakah: ${fx.edits} edit(s), findings ${fx.before} → ${fx.after}${fx.skipped.length ? `, ${fx.skipped.length} left for you (see Output › Harakah)` : ""}.`, "Apply · طبّق").then((pick) => { if (pick) applyFix(doc.uri); });
  return fx;
}

/** Apply the template patch as one undoable edit (the previewed text when the file hasn't changed since). */
async function applyFix(uri) {
  const doc = await docFor(uri);
  if (!doc || !PREVIEW.test(doc.fileName)) return false;
  if (JSX.test(doc.fileName)) {
    const last = codemods.get(doc.uri.toString());
    const fx = last && last.version === doc.version && !doc.isDirty ? last.fx : await codemodFix(doc);
    codemods.delete(doc.uri.toString());
    if (!fx) return false;
    if (!fx.changes.length) return true;
    const ok = await vscode.workspace.applyEdit(await codemodEdit(fx));
    const stale = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.label.startsWith("Harakah fix: "));
    if (stale.length) await vscode.window.tabGroups.close(stale);
    if (ok) vscode.window.setStatusBarMessage(`Harakah: ${fx.changes.length} file(s) changed (unsaved, Ctrl+Z undoes it) · تم التطبيق`, 6000);
    return ok;
  }
  let p = previews.get(fixedUri(doc).toString());
  if (!p || p.version !== doc.version || doc.isDirty) p = await templateFix(doc);
  if (!p) return false;
  const old = doc.getText(), e = minimalEdit(old, p.text);
  if (e.start === e.end && !e.text) return true;
  const we = new vscode.WorkspaceEdit();
  we.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  const ok = await vscode.workspace.applyEdit(we);
  // close the preview of this file: it shows the old version now
  const stale = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme === SCHEME && t.input.modified.path === doc.uri.path);
  if (stale.length) await vscode.window.tabGroups.close(stale);
  if (ok) vscode.window.setStatusBarMessage("Harakah: patch applied (unsaved, Ctrl+Z undoes it) · تم التطبيق", 6000);
  return ok;
}

async function fixFile(uri) {
  const doc = await docFor(uri);
  if (!doc || !EXT.test(doc.fileName)) return;
  if (PREVIEW.test(doc.fileName)) { await applyFix(doc.uri); return; } // undoable edit instead of rewriting files behind the editor
  if (doc.isDirty) await doc.save();
  const r = await run(fixArgs(doc.fileName), doc.fileName);
  output.appendLine(`$ harakah-fix ${fixArgs(doc.fileName).join(" ")}\n${r.stderr}${r.stdout.length < 4000 ? r.stdout : ""}`);
  if (r.code !== 0 && r.code !== 1) { vscode.window.showErrorMessage(`Harakah fix failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`); return; }
  vscode.window.setStatusBarMessage("Harakah: fixed in place; review with git diff · حركة: تم الإصلاح، راجع التغييرات", 6000);
  await check(doc);
}

class FixProvider {
  provideCodeActions(doc, _range, ctx) {
    const mine = ctx.diagnostics.filter((d) => d.source === "Harakah");
    if (!mine.length) return [];
    const keys = fixableKeys.get(doc.uri.toString()) || new Set();
    const n = mine.filter((d) => keys.has(`${d.range.start.line}:${typeof d.code === "object" ? d.code.value : d.code}`)).length;
    const a = new vscode.CodeAction(n ? `Harakah: fix this file (${n} auto-fixable) · أصلح الملف` : "Harakah: fix this file · أصلح الملف", vscode.CodeActionKind.QuickFix);
    a.command = { command: "harakah.fixFile", title: "Harakah: fix file", arguments: [doc.uri] };
    a.diagnostics = mine;
    if (!PREVIEW.test(doc.fileName)) { a.isPreferred = n > 0; return [a]; }
    // templates and .tsx/.jsx: preview first (preferred), or apply directly
    const p = new vscode.CodeAction(`Harakah: preview fix · معاينة الإصلاح`, vscode.CodeActionKind.QuickFix);
    p.command = { command: "harakah.previewFix", title: "Harakah: preview fix", arguments: [doc.uri] };
    p.diagnostics = mine;
    p.isPreferred = n > 0;
    return [p, a];
  }
}

function activate(context) {
  collection = vscode.languages.createDiagnosticCollection("harakah");
  output = vscode.window.createOutputChannel("Harakah");
  context.subscriptions.push(collection, output,
    vscode.commands.registerCommand("harakah.checkFile", () => { const e = vscode.window.activeTextEditor; if (e) check(e.document); }),
    vscode.commands.registerCommand("harakah.fixFile", fixFile),
    vscode.commands.registerCommand("harakah.previewFix", previewFix),
    vscode.commands.registerCommand("harakah.applyFix", applyFix),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { onDidChange: previewEvents.event, provideTextDocumentContent: (u) => (previews.get(u.toString()) || {}).text || "" }),
    vscode.languages.registerCodeActionsProvider({ scheme: "file", pattern: PATTERN }, new FixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.workspace.onDidOpenTextDocument((d) => schedule(d, 300)),
    vscode.workspace.onDidSaveTextDocument((d) => schedule(d, 150)),
    vscode.workspace.onDidCloseTextDocument((d) => { collection.delete(d.uri); fixableKeys.delete(d.uri.toString()); }));
  for (const d of vscode.workspace.textDocuments) schedule(d, 500);
}

function deactivate() { for (const t of timers.values()) clearTimeout(t); }

module.exports = { activate, deactivate };
