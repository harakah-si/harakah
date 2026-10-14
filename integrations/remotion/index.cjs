// Harakah gate for Remotion's own bundler. Use it in remotion.config.ts:
//
//   import { Config } from "@remotion/cli/config";
//   import { withHarakah } from "harakah-fixer/remotion";
//   Config.overrideWebpackConfig(withHarakah());              // or withHarakah(existingOverride, { strict: true })
//
// `remotion render` / `still` / bundle(): the bundle FAILS while Arabic would render broken (split letters,
// wrong direction, Latin fonts…). Studio (watch mode): a small Harakah panel inside the Studio (bottom-left) plus
// terminal warnings, updated on every save; never blocks hot reload. `studioOverlay: false` hides the panel.
// HARAKAH_GATE=off disables it, HARAKAH_GATE=strict also blocks on warnings, HARAKAH_GATE=warn never blocks,
// HARAKAH_GATE=lenient renders when the gate itself couldn't run or finish a check (otherwise that blocks too).
// Render-time props: `remotion render … --props props.json` is followed automatically (read from the Remotion CLI's
// own arguments, with the composition id); or pass withHarakah({ inputProps: {…} | "props.json", composition: "Intro" }).
// Dependency-free CommonJS: the gate itself runs as a child process (`harakah-fix gate --json`).
// بوابة حركة داخل Remotion: يفشل الرندر إذا كان النص العربي سيظهر مكسوراً، وتحذيرات فقط في الاستوديو.
"use strict";
const { execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");

const DEFAULT_CLI = path.resolve(__dirname, "..", "..", "dist", "cli.js");
const OVERLAY = path.join(__dirname, "studio-overlay.cjs");

/** Where the Studio panel reads results from (outside the project, so it never shows up in git or the watcher's ignore list). */
function resultsFile(root) {
  const dir = path.join(os.tmpdir(), "harakah-studio", crypto.createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 12));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "results.json");
}
/** Write only when the content (minus the timestamp) changed, so the watcher doesn't rebuild for nothing. */
function writeResults(file, data) {
  const body = { ...data, at: new Date().toISOString() };
  try {
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    delete prev.at;
    if (JSON.stringify(prev) === JSON.stringify(data)) return false;
  } catch { /* first write */ }
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return true;
}
function toResults(r, mode, layout) {
  if (r.skipped) return { status: "error", note: r.note, mode };
  // nothing broken found, but a check couldn't run: say so instead of "blocked, 0 problems"
  if (!r.ok && !(r.blocking || []).length && (r.inconclusive || []).length) return { status: "error", note: r.inconclusive.map((x) => x.reason).join("; "), mode, ...(layout ? { layout: layoutResults(r) } : {}) };
  const out = { status: r.ok ? "ok" : "blocked", mode, blocking: (r.blocking || []).map((b) => ({ file: b.file, line: b.line, code: b.code, title: b.title, fixable: !!b.fixable })), summary: r.summary, fixCommand: r.fixCommand };
  if (layout) out.layout = layoutResults(r);
  return out;
}
/** Runtime layout audit (HZ24) per composition, for the Studio panel: `[]` = audited and clean. */
function layoutResults(r) {
  const comps = [];
  let note;
  for (const f of r.layout || r.files || []) {
    const m = /#([^\/\\#]+)$/.exec(f.file || "");
    if (!m) { const skip = (f.issues || []).find((i) => i.code === "HZ24" && i.severity === "info" && /did not run|skipped/i.test(i.message && i.message.en || "")); if (skip) note = skip.message.en; continue; }
    const issues = (f.issues || []).filter((i) => i.code === "HZ24" || i.code === "HZ22").map((i) => ({
      code: i.code, severity: i.severity, text: i.snippet || "", frames: (i.frames || []).slice(0, 60), en: i.message && i.message.en, ar: i.message && i.message.ar,
      suggest: i.suggest ? (i.suggest.kind === "dir" ? { kind: "dir", verified: !!i.suggest.verified, tag: (/(?:^|>\s*)([a-z][\w-]*)[^>]*$/.exec(i.suggest.selector || "") || [])[1] || "div" } : { kind: i.suggest.kind }) : undefined,
    }));
    if (issues.length) comps.push({ id: m[1], issues });
  }
  return note ? { compositions: comps, note } : { compositions: comps };
}

/** `--props` value and composition-id candidates from a remotion CLI argv (render/still/studio). */
function renderArgs(argv) {
  const i = argv.findIndex((a) => /^(render|still|studio|preview|benchmark)$/.test(a));
  let props;
  const compositions = [];
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a.startsWith("--props=")) props = a.slice(8);
    else if (a === "--props" && k + 1 < argv.length) props = argv[++k];
    else if (i >= 0 && k > i && !a.startsWith("-") && /^[\w\u0600-\u06FF-]+$/.test(a)) compositions.push(a);
  }
  return { props, compositions };
}

const layoutOn = (o) => (process.env.HARAKAH_LAYOUT ? process.env.HARAKAH_LAYOUT !== "0" && process.env.HARAKAH_LAYOUT !== "off" : !!o.layout);
/** Arguments of the `harakah-fix gate` child process (exported for tests). */
function gateArgs(root, o, cli) {
  const fromArgv = o.argv === false ? { compositions: [] } : renderArgs(o.argv || process.argv);
  const props = o.inputProps != null ? (typeof o.inputProps === "string" ? o.inputProps : JSON.stringify(o.inputProps)) : fromArgv.props;
  const comps = o.composition ? [].concat(o.composition) : fromArgv.compositions;
  const args = [...(o.nodeArgs || []), cli, "gate", root, "--json", ...(o.strict || process.env.HARAKAH_GATE === "strict" ? ["--strict"] : []), ...(o.assumeArabic ? ["--assume-arabic"] : []),
    ...(props ? ["--props", props] : []), ...(props && comps.length ? ["--composition", comps.join(",")] : []),
    // runtime layout audit of the compositions (HZ24): bundles and seeks sampled frames, so it gets a longer timeout
    ...(layoutOn(o) ? ["--layout"] : [])];
  return args;
}
function runGate(root, o) {
  const args = gateArgs(root, o, o.cli || process.env.HARAKAH_CLI || DEFAULT_CLI);
  return new Promise((resolve) => {
    execFile(process.execPath, args, { maxBuffer: 16 << 20, timeout: o.timeoutMs || (layoutOn(o) ? 300000 : 120000) }, (err, stdout, stderr) => {
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ ok: true, skipped: true, note: `harakah gate did not run (${(stderr || (err && err.message) || "no output").toString().trim().split("\n")[0]})` }); }
    });
  });
}

function format(r) {
  const blocking = r.blocking || [];
  if (!blocking.length && (r.inconclusive || []).length) {
    return [`Harakah could not finish checking the Arabic, so the render is blocked · تعذّر إكمال فحص النص العربي`, ...r.inconclusive.map((x) => `  - ${x.file}: ${x.reason}`),
      `Fix the cause, or set HARAKAH_GATE=lenient to render without this check (HARAKAH_GATE=off to bypass Harakah).`].join("\n");
  }
  const lines = blocking.slice(0, 12).map((b) => `  - ${b.file}${b.line ? `:${b.line}` : ""} ${b.code} ${b.title}${b.fixable ? " (auto-fixable)" : ""}`);
  return [`Harakah: ${blocking.length} Arabic problem(s) would render as broken letters/direction · النص العربي سيظهر مكسوراً`, ...lines,
    blocking.length > 12 ? `  … ${blocking.length - 12} more` : "", `Fix: ${r.fixCommand || "harakah-fix fix . --write"}  (HARAKAH_GATE=off to bypass)`].filter(Boolean).join("\n");
}

class HarakahWebpackPlugin {
  constructor(options = {}) { this.o = options; }
  apply(compiler) {
    const o = this.o;
    const mode = process.env.HARAKAH_GATE === "warn" ? "warn" : o.mode || "auto";
    if (process.env.HARAKAH_GATE === "off") return;
    const root = o.root || findRoot(compiler.context || process.cwd());
    const Err = (compiler.webpack && compiler.webpack.WebpackError) || Error;
    const relevant = () => {
      const m = compiler.modifiedFiles;
      // components, CSS, and plain modules (theme.ts / styles.ts); never our own results file
      return !m || [...m].some((f) => /\.(tsx?|jsx?|mjs|cjs|css|scss)$/.test(f) && !f.includes("node_modules") && f !== o.resultsFile);
    };
    let first = true;
    // Render / bundle (single run): block by adding a compilation error.
    compiler.hooks.afterCompile.tapPromise("Harakah", async (compilation) => {
      if (compiler.watchMode || compilation.compiler !== compiler) return;
      const r = await runGate(root, o);
      const mk = (msg) => { const e = new Err(msg); e.details = "Fix the Arabic (harakah-fix fix … --write), then render again · أصلح النص العربي ثم أعد الرندر."; return e; };
      // a gate that didn't run is not a pass: block the render unless told to be lenient (or warn-only)
      if (r.skipped) { (mode === "warn" || process.env.HARAKAH_GATE === "lenient" ? compilation.warnings : compilation.errors).push(mk(`${r.note}. The render is blocked until Harakah can check it; HARAKAH_GATE=lenient renders anyway.`)); return; }
      if (!r.ok) (mode === "warn" ? compilation.warnings : compilation.errors).push(mk(format(r)));
    });
    // Studio (watch): check in the background after a relevant rebuild; never delay hot reload.
    compiler.hooks.done.tap("Harakah", () => {
      if (!compiler.watchMode || (!first && !relevant())) return;
      first = false;
      if (o.resultsFile) writeResults(o.resultsFile, { ...readResults(o.resultsFile), status: "checking" });
      runGate(root, o).then((r) => {
        if (o.resultsFile) writeResults(o.resultsFile, toResults(r, mode === "warn" ? "warn" : "block", layoutOn(o)));
        if (r.skipped) return;
        if (!r.ok) console.warn("\n\x1b[33m" + format(r) + "\x1b[0m\n");
        else if (o.verbose) console.log("Harakah: Arabic OK · النص العربي سليم");
      });
    });
  }
}

function readResults(file) { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); delete j.at; return j; } catch { return {}; } }

function findRoot(start) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, "package.json")) && (fs.existsSync(path.join(d, "remotion.config.ts")) || fs.existsSync(path.join(d, "remotion.config.js")) || fs.existsSync(path.join(d, "src")))) return d;
    const up = path.dirname(d);
    if (up === d) return path.resolve(start);
    d = up;
  }
}

/** Wrap (or create) a Remotion webpack override that adds the Harakah gate. */
function withHarakah(overrideOrOptions, maybeOptions) {
  const prev = typeof overrideOrOptions === "function" ? overrideOrOptions : (c) => c;
  const options = (typeof overrideOrOptions === "function" ? maybeOptions : overrideOrOptions) || {};
  return async (current) => {
    const c = await prev(current);
    // Studio = development build (HMR); renders are production builds and never get the panel
    const studio = c.mode === "development" && options.studioOverlay !== false && process.env.HARAKAH_GATE !== "off";
    if (!studio || !(Array.isArray(c.entry) || typeof c.entry === "string")) return { ...c, plugins: [...(c.plugins || []), new HarakahWebpackPlugin(options)] };
    const root = options.root || findRoot(c.context || process.cwd());
    const file = resultsFile(root);
    if (!fs.existsSync(file)) writeResults(file, { status: "checking" });
    return {
      ...c,
      entry: [...[].concat(c.entry), OVERLAY],
      resolve: { ...(c.resolve || {}), alias: { ...((c.resolve && c.resolve.alias) || {}), "harakah-studio-results$": file } },
      plugins: [...(c.plugins || []), new HarakahWebpackPlugin({ ...options, root, resultsFile: file })],
    };
  };
}

module.exports = { withHarakah, HarakahWebpackPlugin, renderArgs, gateArgs, toResults, resultsFile, OVERLAY };
