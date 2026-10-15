/**
 * File / project driver for the Remotion codemod: discovers sources, vendors or imports the helper,
 * fixes CSS modules, runs prettier when the input was prettier-clean, and produces unified diffs.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTwoFilesPatch } from "diff";
import { transformSource, fixCssText, toIssues, fontsLoadedIn, type CodemodOptions, type CodemodResult, type Change } from "./codemod.js";
import type { Issue } from "../engine.js";
import { analyzeArabicProject, type PropsFeed, type StyleUse } from "./props.js";
import { loadI18n } from "./i18n.js";
import { parseProjectCss, type ProjectCss } from "./project-css.js";
import { familyCoverage, type FamilyCoverage } from "../glyphs.js";
import type { InputProps } from "./input-props.js";

export const HELPER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "remotion-arabic", "src", "index.tsx");
export const HELPER_PKG = "@harakah/remotion-arabic";
export const HELPER_FILE = "harakah-arabic.tsx";
const SRC_EXT = /\.(tsx|jsx)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "build", ".remotion", "public"]);

export interface FixRemotionOptions extends CodemodOptions {
  /** Output: directory (project or file) or a .tsx/.jsx path (single file). Omit to write in place. */
  out?: string;
  prettier?: "auto" | "always" | "never";
  helper?: "auto" | "vendor" | "package";
  /** Do not write anything; just compute results and diffs. */
  dryRun?: boolean;
  /** Render-time input props (`remotion render --props`), followed like defaultProps. */
  inputProps?: InputProps;
  /** Composition id(s) the input props apply to (default: all compositions). */
  composition?: string | string[];
  /**
   * The project came from someone else (a web-tool upload or paste): never run its code. Prettier is our own copy, and
   * its options come from static JSON config only (prettier.config.js / .prettierrc.cjs and `plugins` would execute).
   */
  untrusted?: boolean;
}
export interface FileResult {
  file: string;          // original path
  outFile: string;       // where the fixed file goes
  before: string;
  after: string;
  result: CodemodResult;
  diff: string;
  issues: Issue[];
}
export interface CssResult { file: string; outFile: string; before: string; after: string; notes: string[]; diff: string }
export interface FixRemotionResult {
  root: string;
  mode: "project" | "file";
  files: FileResult[];
  css: CssResult[];
  helper?: { mode: "vendor" | "package"; path?: string; refreshed?: boolean; missing?: string[] };
  /** the vendored helper file this fix writes (also computed on a dry run, so an editor can preview it) */
  helperWrite?: { file: string; text: string; exists: boolean };
  outRoot: string;
  /** Components that receive Arabic only through props (props-aware detection), with the reasons. */
  props: PropsFeed[];
  /** Style objects/helpers declared in other files (theme.ts, styles.ts) that Arabic components use. */
  styles: StyleUse[];
  /** <Composition>/<Still> ids registered in the project (for picking which one render props apply to). */
  compositions: string[];
  /** Arabic-script locale files whose keys were followed (messages/ar.json, locales/ar/common.json …). */
  i18n: string[];
}

/** Nearest directory (walking up) whose package.json depends on remotion. */
export function findRemotionRoot(start: string): string | undefined {
  let d = fs.statSync(start).isDirectory() ? path.resolve(start) : path.dirname(path.resolve(start));
  for (;;) {
    const pj = path.join(d, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const j = JSON.parse(fs.readFileSync(pj, "utf8"));
        const deps = { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies };
        if (deps.remotion || deps["@remotion/cli"]) return d;
      } catch {}
    }
    const up = path.dirname(d);
    if (up === d) return undefined;
    d = up;
  }
}
function dependsOnHelper(root: string | undefined): boolean {
  if (!root) return false;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return !!({ ...j.dependencies, ...j.devDependencies })[HELPER_PKG];
  } catch { return false; }
}

const MOD_EXT = /\.(ts|js|mjs|cjs)$/i;
/** Plain .ts/.js modules (theme.ts, styles.ts, utils) under the project's src: analyzed for style objects used by Arabic components. */
export function listModules(target: string): string[] {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return [];
  const base = fs.existsSync(path.join(target, "src")) ? path.join(target, "src") : target;
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(d, e.name)); }
      else if (MOD_EXT.test(e.name) && !e.name.endsWith(".d.ts") && !/\.(config|test|spec|stories)\.|^remotion\.config/.test(e.name)) out.push(path.join(d, e.name));
    }
  };
  walk(path.resolve(base));
  return out.sort();
}

export function listSources(target: string): string[] {
  const st = fs.statSync(target);
  if (st.isFile()) return [path.resolve(target)];
  const base = fs.existsSync(path.join(target, "src")) ? path.join(target, "src") : target;
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(d, e.name)); }
      else if (SRC_EXT.test(e.name) && e.name !== HELPER_FILE && !e.name.endsWith(".d.ts")) out.push(path.join(d, e.name));
    }
  };
  walk(path.resolve(base));
  return out.sort();
}

function copyProject(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "out") continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) fs.cpSync(s, d, { recursive: true });
    else fs.copyFileSync(s, d);
  }
  const nm = path.join(src, "node_modules");
  const dnm = path.join(dst, "node_modules");
  if (fs.existsSync(nm) && !fs.existsSync(dnm)) fs.symlinkSync(nm, dnm, "dir");
}

function relImport(fromFile: string, toFile: string): string {
  let r = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/").replace(/\.(tsx|ts|jsx|js)$/, "");
  if (!r.startsWith(".")) r = "./" + r;
  return r;
}

/** Prettier config files that are plain data (anything else, e.g. prettier.config.js, is code). */
const STATIC_PRETTIER = [".prettierrc", ".prettierrc.json"];
/**
 * Prettier options for an untrusted project, read as data: the nearest .prettierrc / .prettierrc.json (JSON only) or
 * package.json "prettier" object between the file and `root`. Only scalar options are kept, so `plugins` and
 * `overrides` (which can load code) never reach prettier. A JS/TS config means no project options at all.
 */
export function staticPrettierConfig(file: string, root: string): Record<string, string | number | boolean> {
  const top = path.resolve(root);
  for (let d = path.dirname(path.resolve(file)); ; d = path.dirname(d)) {
    const names = fs.existsSync(d) ? fs.readdirSync(d) : [];
    if (names.some((n) => /^(?:\.prettierrc\.(?:[cm]?[jt]s|ya?ml|toml|json5)|prettier\.config\.[cm]?[jt]s)$/.test(n))) return {};
    let cfg: unknown;
    for (const n of STATIC_PRETTIER) if (names.includes(n)) { try { cfg = JSON.parse(fs.readFileSync(path.join(d, n), "utf8")); } catch { return {}; } break; }
    if (cfg === undefined && names.includes("package.json")) { try { cfg = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).prettier; } catch {} }
    if (cfg !== undefined) {
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return {}; // a shared-config module name: not data
      return Object.fromEntries(Object.entries(cfg).filter(([k, v]) => !/^(?:plugins|pluginSearchDirs|overrides|\$schema)$/.test(k) && ["string", "number", "boolean"].includes(typeof v))) as Record<string, string | number | boolean>;
    }
    if (d === top || path.dirname(d) === d || !d.startsWith(top)) return {};
  }
}

async function maybePrettier(original: string, code: string, file: string, mode: FixRemotionOptions["prettier"], untrusted?: { root: string }): Promise<string> {
  if (mode === "never" || code === original) return code;
  try {
    let prettier: any;
    // the project's own prettier first (same version/plugins as the user's formatting), then ours if installed.
    // An untrusted project only ever gets ours, configured from static JSON (resolveConfig would run JS configs).
    if (untrusted) prettier = await import("prettier");
    else try { prettier = await import(pathToFileURL(createRequire(file).resolve("prettier")).href); } catch { prettier = await import("prettier"); }
    prettier = prettier.default ?? prettier;
    const cfg = untrusted ? staticPrettierConfig(file, untrusted.root) : (await prettier.resolveConfig(file)) ?? {};
    const opts = { ...cfg, filepath: file };
    if (mode === "always" || (await prettier.check(original, opts))) return await prettier.format(code, opts);
  } catch {}
  return code;
}

const patch = (name: string, a: string, b: string) => (a === b ? "" : createTwoFilesPatch(`a/${name}`, `b/${name}`, a, b, "", "", { context: 3 }));

/** Fix (or dry-run) a .tsx/.jsx file or a Remotion project folder. */
export async function fixRemotion(target: string, o: FixRemotionOptions = {}): Promise<FixRemotionResult> {
  const abs = path.resolve(target);
  const isDir = fs.statSync(abs).isDirectory();
  const remRoot = findRemotionRoot(abs);
  const root = isDir ? abs : remRoot ?? path.dirname(abs);
  const sources = listSources(abs);
  const write = !o.dryRun;

  // where do outputs go?
  let outRoot = root;
  let mapOut = (f: string) => f;
  if (o.out) {
    if (isDir) {
      outRoot = path.resolve(o.out);
      if (write) copyProject(abs, outRoot);
      mapOut = (f) => path.join(outRoot, path.relative(abs, f));
    } else if (SRC_EXT.test(o.out)) {
      outRoot = path.dirname(path.resolve(o.out));
      mapOut = (f) => (f === abs ? path.resolve(o.out!) : path.join(outRoot, path.basename(f)));
    } else {
      outRoot = path.resolve(o.out);
      mapOut = (f) => path.join(outRoot, path.basename(f));
    }
  }

  const helperMode: "vendor" | "package" = o.helper === "package" || (o.helper !== "vendor" && dependsOnHelper(remRoot)) ? "package" : "vendor";
  const srcBase = isDir ? (fs.existsSync(path.join(abs, "src")) ? path.join(abs, "src") : abs) : path.dirname(abs);
  const helperPath = mapOut(path.join(srcBase, HELPER_FILE));
  // Already vendored helper anywhere in the project? Reuse it.
  const searchIn = isDir ? srcBase : remRoot && fs.existsSync(path.join(remRoot, "src")) ? path.join(remRoot, "src") : srcBase;
  const existingHelper = listAll(searchIn).find((f) => path.basename(f) === HELPER_FILE);
  // a helper outside the output tree (lone file written elsewhere) is re-vendored next to the output
  const vendorAt = existingHelper && (!o.out || isDir) ? mapOut(existingHelper) : helperPath;

  // props-aware detection across the whole project (a lone file still sees Root.tsx's defaultProps)
  const scope = isDir ? sources : remRoot ? listSources(remRoot) : sources;
  const modules = listModules(isDir ? abs : remRoot ?? path.dirname(abs));
  let feeds = new Map<string, PropsFeed[]>();
  let styles: StyleUse[] = [];
  let compositions: string[] = [];
  // Arabic behind translation keys (messages/ar.json, locales/ar/*.json), project mode only
  const i18n = isDir || remRoot ? loadI18n(isDir ? abs : remRoot!) : { keys: new Map<string, string>(), files: [] as string[], otherLocales: [] as string[] };
  try {
    const a = analyzeArabicProject([...new Set([...scope, ...sources, ...modules])].map((f) => ({ file: f, src: fs.readFileSync(f, "utf8") })), { inputProps: o.inputProps, composition: o.composition, i18n: i18n.keys });
    feeds = a.feeds; styles = a.styles; compositions = a.compositions;
  } catch {}
  // theme.ts / styles.ts: fix declarations only Arabic components use; shared ones get overrides at the Arabic usage sites
  const declsByFile = new Map<string, Record<string, "all" | "safe">>();
  const sharedByFile = new Map<string, { local: string; from: string; overrides: Record<string, [string, string, string][]> }[]>();
  for (const st of styles) {
    const mode = st.exclusive ? "all" : st.hasFontFamily || st.hasSplit ? "safe" : undefined;
    if (mode) declsByFile.set(st.file, { ...declsByFile.get(st.file), [st.name]: mode });
    if (!st.exclusive && Object.keys(st.overrides).length)
      for (const [uf, locals] of Object.entries(st.localNames)) for (const local of locals)
        sharedByFile.set(uf, [...(sharedByFile.get(uf) ?? []), { local, from: path.basename(st.file), overrides: st.overrides }]);
  }
  // project context: an app that is RTL as a whole (<html dir="rtl"> in a Next.js layout / _document / index.html),
  // and fonts loaded anywhere in the project (Remotion fonts are global per bundle; FontFace, @font-face, loadFont)
  const projRoot = isDir ? abs : remRoot ?? path.dirname(abs);
  const ctx = projectContext(projRoot, [...new Set([...scope, ...sources, ...modules])]);
  const inTarget = (f: string) => (isDir ? !path.relative(abs, f).startsWith("..") : f === abs);
  const work = [...sources, ...[...declsByFile.keys()].filter((f) => inTarget(f) && !sources.includes(f))];

  const files: FileResult[] = [];
  const css: CssResult[] = [];
  const cssSeen = new Set<string>();
  for (const f of work) {
    const before = fs.readFileSync(f, "utf8");
    const outFile = mapOut(f);
    const helperImport = helperMode === "package" ? HELPER_PKG : relImport(outFile, vendorAt);
    const result = transformSource(before, { ...o, fileName: path.basename(f), helperImport, arabicComponents: (feeds.get(f) ?? []).map((x) => x.component),
      arabicDecls: declsByFile.get(f), sharedStyles: sharedByFile.get(f), project: true, rtlContext: ctx.rtl, loadedFonts: ctx.fonts, fontCoverage: ctx.fontCoverage, remotion: ctx.remotion, i18n: i18n.keys, projectCss: ctx.css,
      multilingual: i18n.otherLocales.length > 0, i18nOnly: (feeds.get(f) ?? []).filter((x) => x.i18nOnly).map((x) => x.component) });
    const after = await maybePrettier(before, result.code, f, o.prettier ?? "auto", o.untrusted ? { root } : undefined);
    const rel = path.relative(root, f) || path.basename(f);
    files.push({ file: f, outFile, before, after, result, diff: patch(rel, before, after), issues: toIssues(result, write) });
    for (const m of result.cssModules) {
      const cf = path.resolve(path.dirname(f), m);
      if (cssSeen.has(cf) || !fs.existsSync(cf)) continue;
      cssSeen.add(cf);
      const cb = fs.readFileSync(cf, "utf8");
      const fixed = fixCssText(cb);
      css.push({ file: cf, outFile: mapOut(cf), before: cb, after: fixed.text, notes: fixed.notes, diff: patch(path.relative(root, cf), cb, fixed.text) });
    }
  }
  const usesHelper = files.some((x) => x.result.changed && x.result.usesHelper && /harakah-arabic|@harakah\/remotion-arabic/.test(x.after));
  let helper: FixRemotionResult["helper"];
  if (usesHelper) helper = helperMode === "package" ? { mode: "package" } : { mode: "vendor", path: vendorAt };

  let helperWrite: FixRemotionResult["helperWrite"];
  if (helper?.mode === "vendor") {
    // Names the fixed files import from the helper; an older vendored copy may lack newer ones.
    const needed = new Set<string>();
    for (const x of files) for (const m of x.after.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*harakah-arabic["']/g)) m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => needed.add(n));
    const existing = fs.existsSync(vendorAt) ? fs.readFileSync(vendorAt, "utf8") : "";
    const missing = [...needed].filter((n) => !new RegExp(`export\\s+(function|const)\\s+${n}\\b`).test(existing));
    const ours = /^\/\/ Vendored (by harakah-fix|copy of packages\/remotion-arabic)/.test(existing);
    if (!existing || (missing.length && ours)) {
      helperWrite = { file: vendorAt, text: `// Vendored by harakah-fix from @harakah/remotion-arabic (MIT). Safe to edit.\n${fs.readFileSync(HELPER_SRC, "utf8")}`, exists: !!existing };
      if (existing) helper.refreshed = true;
    } else if (missing.length) helper.missing = missing;
  }
  if (write) {
    for (const x of files) if (x.after !== x.before || o.out) { fs.mkdirSync(path.dirname(x.outFile), { recursive: true }); fs.writeFileSync(x.outFile, x.after); }
    for (const c of css) if (c.after !== c.before || o.out) { fs.mkdirSync(path.dirname(c.outFile), { recursive: true }); fs.writeFileSync(c.outFile, c.after); }
    if (helperWrite) { fs.mkdirSync(path.dirname(helperWrite.file), { recursive: true }); fs.writeFileSync(helperWrite.file, helperWrite.text); }
  }
  const props = sources.flatMap((f) => feeds.get(f) ?? []);
  return { root, mode: isDir ? "project" : "file", files, css, helper, helperWrite, outRoot, props, compositions, i18n: i18n.files, styles: styles.filter((st) => inTarget(st.file) || Object.keys(st.localNames).some(inTarget)) };
}

// app-level direction: <html dir="rtl">, or a locale-driven <html dir={locale === "ar" ? "rtl" : "ltr"}> / dir={i18n.dir()}
const RTL_HTML = /<(?:html|Html)\b[^>]*\bdir\s*=\s*(?:\{?\s*["'`]rtl["'`]|\{(?!\s*["'`]ltr))/;
const RTL_SCRIPT = /documentElement\.(?:dir\s*=(?!\s*["'`]ltr)|setAttribute\(\s*["'`]dir["'`]\s*,(?!\s*["'`]ltr))/;
// …also through an alias: `const html = document.documentElement; html.setAttribute("dir", lang === "ar" ? "rtl" : "ltr")`
const RTL_SCRIPT_ALIAS = /\b(\w+)\s*=\s*(?:window\.)?document\.documentElement\b[\s\S]{0,600}?\b\1\.(?:dir\s*=(?!\s*["'`]ltr)|setAttribute\(\s*["'`]dir["'`]\s*,(?!\s*["'`]ltr))/;
/** App-level RTL and fonts loaded anywhere in the project. */
export function projectContext(root: string, codeFiles: string[]): { rtl: boolean; fonts: string[]; remotion?: boolean; css: ProjectCss; fontCoverage: Record<string, FamilyCoverage> } {
  const read = (f: string) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
  // a web app (package.json without remotion) never gets @remotion/* loaders; unknown (no package.json) keeps the default
  let remotion: boolean | undefined;
  try {
    const pj = JSON.parse(read(path.join(root, "package.json")) || "null");
    if (pj) remotion = Object.keys({ ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies }).some((d) => d === "remotion" || d.startsWith("@remotion/"));
  } catch {}
  const shells = ["app/layout", "src/app/layout", "pages/_document", "src/pages/_document", "app/root", "src/app/root"].flatMap((b) => [".tsx", ".jsx", ".js", ".ts"].map((e) => path.join(root, b + e)))
    .concat(["index.html", "public/index.html", "src/index.html"].map((b) => path.join(root, b)));
  let all: string[] = [];
  try { all = listAll(root); } catch {}
  // App Router segment layouts too: next-intl apps put <html lang={locale} dir={dir}> in app/[locale]/layout.tsx
  const layouts = all.filter((f) => /(?:^|[\\/])(?:src[\\/])?app[\\/](?:.*[\\/])?layout\.[jt]sx?$/.test(path.relative(root, f))).slice(0, 40);
  let rtl = [...shells, ...layouts].some((f) => RTL_HTML.test(read(f)));
  const fonts = new Set<string>();
  const extra = all.filter((f) => /\.(css|scss|html)$/i.test(f)).slice(0, 400);
  const cssTexts: { file: string; text: string }[] = [];
  const faces = new Map<string, { src: string; base?: string }[]>();
  for (const f of [...codeFiles, ...extra]) {
    const t = read(f);
    for (const [fam, face] of fontSources(t, f, root)) faces.set(fam, [...(faces.get(fam) ?? []), face]);
    if (!rtl && (RTL_SCRIPT.test(t) || RTL_SCRIPT_ALIAS.test(t))) rtl = true;
    for (const fam of fontsLoadedIn(t)) fonts.add(fam);
    // global stylesheets only (CSS modules are scoped and handled per import)
    if (/\.(css|scss)$/i.test(f) && !/\.module\.(css|scss)$/i.test(f) && t.length < 2_000_000) cssTexts.push({ file: path.relative(root, f), text: t });
  }
  // real glyph coverage of the project's own font files (cmap + GSUB): the file beats the name
  const fontCoverage: Record<string, FamilyCoverage> = {};
  for (const [fam, list] of faces) { const fc = familyCoverage(list.slice(0, 40)); if (fc) fontCoverage[fam] = fc; }
  return { rtl, fonts: [...fonts], remotion, css: parseProjectCss(cssTexts), fontCoverage };
}

const famKey = (f: string) => f.replace(/["'`]/g, "").replace(/\s+/g, "").toLowerCase();
/**
 * Font files a source declares, per family (lowercased, no spaces): CSS @font-face src url()s (relative to the
 * stylesheet), `new FontFace("X", "url(/fonts/x.woff2)")` / `` `url(${staticFile("x.woff2")})` `` and
 * @remotion/fonts `loadFont({ family, url: staticFile(...) })` (relative to public/).
 */
export function fontSources(text: string, file: string, root: string): [string, { src: string; base?: string }][] {
  const out: [string, { src: string; base?: string }][] = [];
  const pub = path.join(root, "public");
  const staticUrl = (s: string) => s.replace(/\$\{\s*staticFile\(\s*["'`]\/?([^"'`]+)["'`]\s*\)\s*\}/g, (_, p) => path.join(pub, p));
  for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const fam = m[1].match(/font-family\s*:\s*([^;]+)/i)?.[1];
    const src = m[1].match(/(?:^|;|\s)src\s*:\s*([^;]+)/i)?.[1];
    if (fam && src) out.push([famKey(fam), { src: staticUrl(src), base: path.dirname(file) }]);
  }
  for (const m of text.matchAll(/new\s+FontFace\(\s*["'`]([^"'`]+)["'`]\s*,\s*(["'`])([\s\S]{0,300}?)\2/g)) {
    out.push([famKey(m[1]), { src: staticUrl(m[3]), base: pub }]);
  }
  for (const m of text.matchAll(/loadFont\(\s*\{([^}]*)\}/g)) {
    const fam = m[1].match(/family\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const url = m[1].match(/url\s*:\s*staticFile\(\s*["'`]\/?([^"'`]+)["'`]\s*\)/)?.[1] ?? m[1].match(/url\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    if (fam && url) out.push([famKey(fam), { src: `url("${url.startsWith("/") || /^[a-z]+:/i.test(url) ? url : path.join(pub, url)}")`, base: pub }]);
  }
  return out;
}

function listAll(d: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(x, e.name)); } else out.push(path.join(x, e.name)); } };
  walk(d);
  return out;
}

/** Issues for CSS module changes (reported against the CSS file). */
export function cssIssues(c: CssResult, fixed: boolean): Issue[] {
  return c.notes.map((n) => toIssues({ code: "", changed: true, changes: [{ code: /transform|small-caps/.test(n) ? "HZ08" : /align/.test(n) ? "HZ06" : /break/.test(n) ? "HZ18" : "HZ07", line: 0, en: `CSS module ${path.basename(c.file)}: ${n}.`, ar: `ملف CSS: ${n}.` } as Change], reports: [], usesHelper: false, cssModules: [] }, fixed)[0]);
}
