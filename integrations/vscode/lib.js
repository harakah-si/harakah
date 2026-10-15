// Pure helpers (no `vscode` import) so they can be unit-tested with node: CLI command resolution, the
// `harakah-fix check --json` → diagnostic mapping, and the fix arguments per file type.
"use strict";
const path = require("path");
const fs = require("fs");

const LANGS = ["html", "javascriptreact", "typescriptreact", "astro", "vue", "svelte"];
const EXT = /\.(html?|tsx|jsx|astro|vue|svelte)$/i;
/** Document selector by file pattern: a stock VS Code has no astro/vue/svelte language, those files open as plaintext. */
const PATTERN = "**/*.{html,htm,tsx,jsx,astro,vue,svelte}";
const TEMPLATE = /\.(astro|vue|svelte)$/i;
const JSX = /\.(tsx|jsx)$/i;
/** files whose fix the extension previews and applies itself (templates: diff; .tsx/.jsx: multi-file refactor preview) */
const PREVIEW = /\.(astro|vue|svelte|tsx|jsx)$/i;

/** "node /x/dist/cli.js" → ["node", ["/x/dist/cli.js"]]; quotes keep spaces. */
function parseCommand(s) {
  const parts = (String(s).match(/"[^"]*"|'[^']*'|\S+/g) || []).map((p) => p.replace(/^(["'])(.*)\1$/, "$2"));
  return { cmd: parts[0], args: parts.slice(1) };
}

/** Configured command, else the workspace's node_modules/.bin/harakah-fix, else harakah-fix on PATH. */
function resolveCli(setting, folders, exists = fs.existsSync) {
  if (setting && String(setting).trim()) return parseCommand(setting);
  for (const f of folders || []) {
    const bin = path.join(f, "node_modules", ".bin", process.platform === "win32" ? "harakah-fix.cmd" : "harakah-fix");
    if (exists(bin)) return { cmd: bin, args: [] };
  }
  return { cmd: "harakah-fix", args: [] };
}

const SEV = { error: 0, warning: 1, info: 2 }; // vscode.DiagnosticSeverity Error / Warning / Information

function text(t, lang) {
  if (t == null) return "";
  if (typeof t === "string") return t;
  if (lang === "ar") return t.ar || t.en || "";
  if (lang === "both") return t.ar && t.en ? `${t.en}\n${t.ar}` : t.en || t.ar || "";
  return t.en || t.ar || "";
}

/**
 * check --json (single HTML: {file, issues}; .tsx / templates / folders: {results: [{file, issues}]}) →
 * plain diagnostics for `file`: {line (0-based), severity, code, message, fixable}.
 */
function toDiagnostics(json, file, lang = "en") {
  const groups = Array.isArray(json && json.results) ? json.results : json && Array.isArray(json.issues) ? [{ file: json.file, issues: json.issues }] : [];
  const want = path.resolve(file);
  const mine = groups.filter((g) => !g.file || path.resolve(g.file) === want || groups.length === 1);
  const out = [];
  for (const g of mine) for (const i of g.issues || []) {
    if (i.fixed) continue;
    const title = text(i.title, lang), msg = text(i.message, lang);
    out.push({
      line: Math.max(0, (Number(i.line) || 1) - 1),
      severity: SEV[i.severity] ?? 1,
      code: i.code,
      message: title && msg && !msg.startsWith(title) ? `${title}: ${msg}` : msg || title,
      fixable: !!i.fixable,
    });
  }
  return out;
}

/** The smallest single replacement that turns `a` into `b`: {start, end} in `a` and the new text. */
function minimalEdit(a, b) {
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  // never split a surrogate pair or a CRLF
  while (p > 0 && (/[\uDC00-\uDFFF]/.test(a[p] || "") || (a[p] === "\n" && a[p - 1] === "\r"))) p--;
  return { start: p, end: a.length - s, text: b.slice(p, b.length - s) };
}

/** Arguments that fix `file` in place: HTML → -o same file; .tsx/.jsx and templates → --write (templates: patch-based). */
function fixArgs(file) {
  if (TEMPLATE.test(file) || JSX.test(file)) return ["fix", file, "--write"];
  return ["fix", file, "-o", file];
}

module.exports = { LANGS, EXT, TEMPLATE, JSX, PREVIEW, PATTERN, parseCommand, resolveCli, toDiagnostics, fixArgs, minimalEdit, text };
