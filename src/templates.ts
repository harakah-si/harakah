/**
 * .astro / .vue / .svelte templates in folder `check` and `gate` (report-only).
 * The template is turned into analysable HTML *in place*: code is blanked, expressions are masked (Arabic string literals in
 * them stay as text), class expressions become their literal class tokens, and newlines are kept, so the HTML engine's line
 * numbers are the template's line numbers. The project's RTL context (a layout with `dir="rtl"` / `dir={…}` plus Arabic
 * content) and its global CSS (imported stylesheets, `<style is:global>`, unscoped Vue styles) are applied, so overrides like
 * `html[dir="rtl"] .display { letter-spacing: 0 }` count. Fixes are not written into templates: a serialiser round-trip would
 * mangle Astro/Vue/Svelte syntax, so every finding is reported with its suggested fix, marked not auto-fixable.
 * قوالب Astro وVue وSvelte: فحص فقط، بأرقام الأسطر الأصلية، مع اتجاه المشروع وأنماطه العامة.
 */
import fs from "node:fs";
import path from "node:path";
import { analyze, type Issue, type Options } from "./engine.js";
import { RULES } from "./rules.js";
import { loadI18n, bySuffix, type I18nKeys } from "./remotion/i18n.js";
import { twDecl } from "./remotion/project-css.js";

export const isTemplate = (f: string) => /\.(astro|vue|svelte)$/i.test(f);
type Flavor = "astro" | "vue" | "svelte";
const flavorOf = (f: string): Flavor => (f.toLowerCase().endsWith(".vue") ? "vue" : f.toLowerCase().endsWith(".svelte") ? "svelte" : "astro");

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP = new Set(["node_modules", ".git", "out", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".astro", ".output", ".cache", ".vercel", "coverage"]);

/** Keep only the newlines of a piece (so line numbers hold). */
const nl = (s: string) => s.replace(/[^\n]/g, "");
const blankKeep = (s: string) => s.replace(/[^\n]/g, " ");

/** Index of the `}` matching the `{` at `i` (JS-aware: strings, template literals with `${}`, comments). -1 if unbalanced. */
export function matchBrace(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "'" || c === '"') { const q = c; for (k++; k < s.length && s[k] !== q; k++) if (s[k] === "\\") k++; continue; }
    if (c === "`") {
      for (k++; k < s.length && s[k] !== "`"; k++) { if (s[k] === "\\") { k++; continue; } if (s[k] === "$" && s[k + 1] === "{") { const e = matchBrace(s, k + 1); if (e < 0) return -1; k = e; } }
      continue;
    }
    if (c === "/" && s[k + 1] === "/") { const e = s.indexOf("\n", k); if (e < 0) return -1; k = e; continue; }
    if (c === "/" && s[k + 1] === "*") { const e = s.indexOf("*/", k + 2); if (e < 0) return -1; k = e + 1; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return k;
  }
  return -1;
}

/** String-literal contents of a JS expression (template literals without their `${}` parts). */
/** Plain '…' / "…" literals with no escapes: value and offset of its first character in `expr` (for source mapping). */
function plainLiterals(expr: string): { value: string; at: number }[] {
  const out: { value: string; at: number }[] = [];
  for (let k = 0; k < expr.length; k++) {
    const c = expr[k];
    if (c === "`") { const e = expr.indexOf("`", k + 1); if (e < 0) break; k = e; continue; } // template literals: not mapped
    if (c !== "'" && c !== '"') continue;
    const e = expr.indexOf(c, k + 1);
    if (e < 0) break;
    const value = expr.slice(k + 1, e);
    if (!value.includes("\\") && !value.includes("\n")) out.push({ value, at: k + 1 });
    k = e;
  }
  return out;
}

export function stringLiterals(expr: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < expr.length; k++) {
    const c = expr[k];
    if (c === "'" || c === '"') { let v = ""; const q = c; for (k++; k < expr.length && expr[k] !== q; k++) { if (expr[k] === "\\") { k++; v += expr[k] ?? ""; continue; } v += expr[k]; } out.push(v); continue; }
    if (c === "`") {
      let v = "";
      for (k++; k < expr.length && expr[k] !== "`"; k++) {
        if (expr[k] === "\\") { k++; v += expr[k] ?? ""; continue; }
        if (expr[k] === "$" && expr[k + 1] === "{") { const e = matchBrace(expr, k + 1); if (e < 0) break; out.push(...stringLiterals(expr.slice(k + 2, e))); v += " "; k = e; continue; }
        v += expr[k];
      }
      out.push(v);
      continue;
    }
    if (c === "/" && expr[k + 1] === "/") { const e = expr.indexOf("\n", k); k = e < 0 ? expr.length : e; }
  }
  return out;
}

/** Class tokens a class expression can produce: string literals and object-literal keys (`{ active: on, 'is-x': y }`). */
export function classTokens(expr: string): string[] {
  const toks = stringLiterals(expr).flatMap((s) => s.split(/\s+/));
  for (const m of expr.matchAll(/[{,]\s*(?:([A-Za-z_$][\w$-]*)|'([^']+)'|"([^"]+)")\s*:/g)) toks.push(...(m[1] ?? m[2] ?? m[3]).split(/\s+/));
  return [...new Set(toks.filter((t) => t && /^[\w:/.\[\]%#()!@&>*+~=-]+$/.test(t) && !/^(true|false|null|undefined)$/.test(t)))];
}

interface Ctx { flavor: Flavor; dyn: { dir: boolean; lang: boolean }; consts: Map<string, string>; dicts: Set<string>; keys: I18nKeys; props: Map<string, string>; tags?: Map<number, TagInfo>; runs?: TextRun[]; tw: Set<string> }
/** A stretch of template text copied verbatim into the analysable HTML: output offset, source offset, length. */
export interface TextRun { out: number; src: number; len: number; /** inside a JS string literal: characters may change, no markup may go in */ lit?: true }
/** A start tag of the original source (patch mode): absolute offsets, so fixes can be written back as position edits. */
export interface TagAttr { name: string; kind: "none" | "str" | "expr"; start: number; end: number; valStart: number; valEnd: number; value: string }
export interface TagInfo { name: string; start: number; nameEnd: number; end: number; attrs: TagAttr[] }

/** Dictionary variables of a component: `const t = ui[lang]`, `const dict = await getDictionary(locale)`, `const m = useTranslations()` (member access form). */
function dictVars(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:([A-Za-z_$][\w$.]*)\s*\[\s*['"`]?[\w$.-]+['"`]?\s*\]|(?:use|get|load)\w*(?:Translations?|Dictionary|Dictionaries|Dict|Messages|I18n|Intl|Locale|Lang|Strings|Copy|Content|Texts?|T)\s*\()/g)) out.add(m[1]);
  for (const m of src.matchAll(/\b(?:export\s+let|let|const)\s*\{([^}]*)\}\s*=\s*(?:Astro\.props|\$props\(\)|defineProps\b)/g)) for (const n of m[1].split(",")) { const id = n.split(/[:=]/)[0].trim(); if (/^(t|dict|dictionary|messages|translations?|strings|copy|i18n|labels|texts?)$/.test(id)) out.add(id); }
  return out;
}

/** Arabic text of a template expression: constants, props, translation calls (`t('a.b')`, `$t`, `$_`, `m.key()`), dictionary paths (`t.card.from`). */
function resolveExpr(inner: string, cx: Pick<Ctx, "consts" | "dicts" | "keys" | "props">): string | undefined {
  const e = inner.trim().replace(/^(?:Astro\.props|props|\$props|this)\./, "");
  if (/^[A-Za-z_$][\w$]*$/.test(e)) return cx.consts.get(e) ?? cx.props.get(e);
  const call = /^(?:\$?t|\$_|\$i18n\.t|i18n\.t|i18next\.t|translate|t\.value|\$tc|\$te)\(\s*(['"`])([^'"`]+)\1/.exec(e);
  const look = (k: string, fuzzy: boolean) => { const v = cx.keys.get(k) ?? (fuzzy ? bySuffix(cx.keys, k) : undefined); return v && ARABIC.test(v) ? v : undefined; };
  if (call) return look(call[2].replace(":", "."), true) ?? look(call[2], true);
  const para = /^m\.([A-Za-z_$][\w$]*)\(/.exec(e);
  if (para) return look(para[1], false);
  const mp = /^([A-Za-z_$][\w$]*)((?:\[[^\]]+\])?)((?:\??\.[A-Za-z_$][\w$]*|\[\d+\])+)$/.exec(e);
  if (mp && cx.keys.size && (cx.dicts.has(mp[1]) || mp[2])) {
    const key = mp[3].replace(/\?\./g, ".").replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
    return look(key, true);
  }
  return undefined;
}

/** Rewrite one start tag `<name …>` (s[a] === "<"). Returns [replacement, endIndex]. */
function rewriteTag(s: string, a: number, cx: Ctx, base = 0): [string, number, string] | null {
  const m = /^<([A-Za-z][\w:.-]*)/.exec(s.slice(a, a + 80));
  if (!m) return null;
  let name = m[1];
  let k = a + m[0].length;
  const keep: string[] = [];
  const classes: string[] = [];
  const attrs: TagAttr[] = [];
  let selfClose = false;
  while (k < s.length) {
    while (/\s/.test(s[k] ?? "")) k++;
    if (s[k] === ">") { k++; break; }
    if (s[k] === "/" && s[k + 1] === ">") { selfClose = true; k += 2; break; }
    if (s[k] === "{") { const e = matchBrace(s, k); if (e < 0) return null; k = e + 1; continue; } // {...spread} / {shorthand}
    const nm = /^[^\s=/>]+/.exec(s.slice(k));
    if (!nm) { k++; continue; }
    const an = nm[0];
    const aStart = k;
    k += an.length;
    let j = k; while (/\s/.test(s[j] ?? "")) j++;
    let kind: "none" | "str" | "expr" = "none", val = "";
    if (s[j] === "=") {
      j++; while (/\s/.test(s[j] ?? "")) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j]; let e = j + 1;
        while (e < s.length && s[e] !== q) { if (s[e] === "{" && cx.flavor !== "vue") { const b = matchBrace(s, e); if (b > 0) { e = b + 1; continue; } } e++; }
        kind = "str"; val = s.slice(j + 1, e); k = e + 1;
      } else if (s[j] === "{") { const e = matchBrace(s, j); if (e < 0) return null; kind = "expr"; val = s.slice(j + 1, e); k = e + 1; }
      else { const u = /^[^\s>]+/.exec(s.slice(j)); kind = "str"; val = u ? u[0] : ""; k = j + (u ? u[0].length : 0); }
    }
    if (cx.tags) { const q = kind === "none" ? 0 : s[k - 1] === '"' || s[k - 1] === "'" || s[k - 1] === "}" ? 1 : 0; attrs.push({ name: an, kind, start: base + aStart, end: base + k, valStart: base + k - q - val.length, valEnd: base + k - q, value: val }); }
    const low = an.toLowerCase();
    // inline `{expr}` inside quoted values (Svelte/Astro): class tokens for class, blank otherwise
    const strClasses = (v: string) => { const out: string[] = []; let rest = v; if (cx.flavor !== "vue") rest = v.replace(/\{[^{}]*\}/g, (x) => { out.push(...classTokens(x.slice(1, -1))); return " "; }); out.push(...rest.split(/\s+/)); return out.filter(Boolean); };
    if (low === "class" || low === "classname") { classes.push(...(kind === "expr" ? classTokens(val) : strClasses(val))); continue; }
    if (low === "class:list" || low === ":class" || low === "v-bind:class" || low === "[class]" || low === "[ngclass]") { classes.push(...classTokens(val)); continue; }
    if (low.startsWith("class:") && cx.flavor === "svelte") { classes.push(an.slice(6)); continue; }
    if (low === "dir" || low === "lang") {
      if (kind === "str" && !/\{/.test(val)) keep.push(`${low}="${val}"`);
      else cx.dyn[low as "dir" | "lang"] = true;
      continue;
    }
    if (low === ":dir" || low === "v-bind:dir" || low === ":lang" || low === "v-bind:lang") { cx.dyn[low.endsWith("dir") ? "dir" : "lang"] = true; continue; }
    if (/^(:|@|#|v-|on:|bind:|use:|transition:|in:|out:|animate:|client:|set:|is:|server:|define:|let:|slot$)/.test(low)) continue;
    if (kind === "expr") continue;
    if (kind === "str" && cx.flavor !== "vue" && /\{/.test(val)) { if (low === "style") keep.push(`style="${val.replace(/\{[^{}]*\}/g, "0")}"`); continue; }
    keep.push(kind === "none" ? an : `${an}="${val.replace(/"/g, "&quot;")}"`);
  }
  const lname = name.toLowerCase();
  if (lname === "template") name = "harakah-template"; // parse5 hides <template> content from the tree
  if (classes.length) { keep.push(`class="${[...new Set(classes)].join(" ")}"`); classes.forEach((c) => cx.tw.add(c)); }
  let pre = "";
  if (keep.includes('dir="ltr"')) {
    const close = s.indexOf(`</${name}`, k);
    const inner = s.slice(k, close < 0 ? k + 300 : Math.min(close, k + 600));
    if (cx.flavor === "vue" ? /\{\{/.test(inner) : /\{/.test(inner)) pre = "<!-- harakah-ignore HZ03 HZ21 -->";
  }
  if (cx.tags) { cx.tags.set(base + a, { name: m[1], start: base + a, nameEnd: base + a + m[0].length, end: base + k, attrs }); keep.push(`data-hz-at="${base + a}"`); }
  const open = `${pre}<${name}${keep.length ? " " + keep.join(" ") : ""}${nl(s.slice(a, k))}>`;
  const close = selfClose && !VOID.has(lname) ? `</${name}>` : "";
  return [open + close, k, lname];
}

/** Process a markup region: tags rewritten, text expressions masked, raw script/style kept (style cleaned). */
function markup(s: string, cx: Ctx, base = 0, obase = 0): string {
  let out = "";
  let k = 0;
  const textExprs = cx.flavor !== "vue";
  while (k < s.length) {
    const c = s[k];
    if (c === "<" && s.startsWith("<!--", k)) { const e = s.indexOf("-->", k); const end = e < 0 ? s.length : e + 3; out += s.slice(k, end); k = end; continue; }
    if (c === "<" && s[k + 1] === "/") {
      const m = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(s.slice(k, k + 80));
      if (m) { out += m[1].toLowerCase() === "template" ? "</harakah-template>" : m[0]; k += m[0].length; continue; }
    }
    if (c === "<" && /[A-Za-z]/.test(s[k + 1] ?? "")) {
      const r = rewriteTag(s, k, cx, base);
      if (r) {
        const [tag, end, lname] = r;
        out += tag; k = end;
        if (lname === "script" || lname === "style") {
          const close = s.toLowerCase().indexOf(`</${lname}`, k);
          const body = s.slice(k, close < 0 ? s.length : close);
          out += lname === "style" ? cleanCss(body, tag) : body;
          k = close < 0 ? s.length : close;
        }
        continue;
      }
    }
    if (c === "{" && cx.flavor === "vue" && s[k + 1] === "{") {
      const e = s.indexOf("}}", k + 2);
      if (e > 0) { out += exprText(s.slice(k + 2, e), s.slice(k, e + 2), cx, base + k + 2, obase + out.length); k = e + 2; continue; }
    }
    if (c === "{" && textExprs) {
      const e = matchBrace(s, k);
      if (e > 0) {
        const whole = s.slice(k, e + 1), inner = s.slice(k + 1, e);
        if (/^[#:/@]/.test(inner.trim())) { out += blankKeep(whole); k = e + 1; continue; } // Svelte {#if} {:else} {/if} {@html}
        const lt = inner.search(/<[A-Za-z]/), gt = inner.lastIndexOf(">");
        if (lt >= 0 && gt > lt) { // markup inside the expression: blank the code around it, process the markup
          const pre = blankKeep("{" + inner.slice(0, lt));
          out += pre + markup(inner.slice(lt, gt + 1), cx, base + k + 1 + lt, obase + out.length + pre.length) + blankKeep(inner.slice(gt + 1) + "}");
        } else out += exprText(inner, whole, cx, base + k + 1, obase + out.length);
        k = e + 1; continue;
      }
    }
    if (cx.runs) { // verbatim text: remember where it came from (text-level patches map back through this)
      const o = obase + out.length, sp = base + k, last = cx.runs[cx.runs.length - 1];
      if (last && !last.lit && last.out + last.len === o && last.src + last.len === sp) last.len++;
      else cx.runs.push({ out: o, src: sp, len: 1 });
    }
    out += c; k++;
  }
  return out;
}

/** A text expression: its Arabic string literals stay as text (`{lang === 'ar' ? 'مرحبا' : 'Hello'}`), the rest is blank. */
function exprText(inner: string, whole: string, cx: Ctx, srcAt = -1, outAt = -1): string {
  const hit = resolveExpr(inner, cx);
  const ar = hit ? [hit] : stringLiterals(inner).filter((x) => ARABIC.test(x));
  const text = ar.join(" ").replace(/\n/g, " ");
  // literals written right here (not resolved from elsewhere) map back to the source: digit fixes can patch them
  if (cx.runs && !hit && srcAt >= 0 && ar.length) {
    const plain = plainLiterals(inner).filter((x) => ARABIC.test(x.value));
    if (plain.length === ar.length && plain.every((x, i) => x.value === ar[i])) {
      let o = outAt;
      for (const x of plain) { cx.runs.push({ out: o, src: srcAt + x.at, len: x.value.length, lit: true }); o += x.value.length + 1; }
    }
  }
  return text + " " + nl(whole);
}

function cleanCss(css: string, openTag: string): string {
  const lang = /lang="(\w+)"/.exec(openTag)?.[1]?.toLowerCase();
  if (lang === "sass" || lang === "stylus" || lang === "styl") return blankKeep(css);
  // Tailwind v4 `@theme { --font-sans: … }` declares custom properties on :root
  let out = css.replace(/@theme(?:\s+[\w-]+)*\s*\{/g, (m) => ":root" + " ".repeat(Math.max(1, m.length - 6)) + "{").replace(/:(?:global|deep|slotted)\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g, "$1").replace(/::v-deep\s*/g, "");
  if (lang === "scss" || lang === "less") out = out.replace(/(^|[^:"'])\/\/[^\n]*/g, (all, p) => p + blankKeep(all.slice(p.length)));
  return out;
}

export interface TemplateProject {
  root: string; rtl: boolean; css: string; files: number; links: string; shell: boolean;
  /** Arabic locale keys (locale JSON/TS modules, inline `{ ar: {…}, en: {…} }` maps) */
  keys?: I18nKeys;
  /** component name → prop → Arabic text passed by some usage (`<Hero title="…">`, `title={t.hero.title}`, Vue `:title="t('x')"`) */
  props?: Map<string, Map<string, string>>;
  /** the project uses Tailwind: utilities in class lists become CSS the engine can see (tracking-*, uppercase, text-left, break-all, rtl:/ltr: variants) */
  tailwind?: boolean;
}

const cssEsc = (c: string) => c.replace(/[^\w-]/g, (x) => "\\" + x);
/** CSS for the Tailwind utilities a template uses (only the properties that matter for Arabic). Breakpoint variants apply;
 *  `rtl:`/`ltr:` are scoped to `[dir]`; state variants (hover:, focus:, dark:, group-*) are skipped. */
export function tailwindCss(tokens: Iterable<string>): string {
  const out: string[] = [];
  for (const tok of new Set(tokens)) {
    const parts = tok.split(":"), util = parts.pop()!;
    if (parts.some((v) => !/^(sm|md|lg|xl|2xl|rtl|ltr|max-\w+|min-\[[^\]]+\])$/.test(v))) continue;
    const d = twDecl(util);
    if (!d) continue;
    const imp = util.startsWith("!") ? " !important" : "";
    const scope = parts.includes("rtl") ? '[dir="rtl"] ' : parts.includes("ltr") ? '[dir="ltr"] ' : "";
    out.push(`${scope}.${cssEsc(tok)}{${d.prop}:${d.value}${imp}}`);
  }
  return out.join("");
}
const componentName = (f: string) => path.basename(f).replace(/\.(astro|vue|svelte)$/i, "").replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase());

/** Arabic props passed to components across the project's templates. */
function propsIndex(files: string[], keys: I18nKeys): Map<string, Map<string, string>> {
  const idx = new Map<string, Map<string, string>>();
  for (const f of files) {
    let src = ""; try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (!/<[A-Z]|<[a-z]+-[a-z]/.test(src)) continue;
    const local = { consts: arabicConsts(src), dicts: dictVars(src), keys, props: new Map<string, string>() };
    for (const m of src.matchAll(/<([A-Z][\w.]*|[a-z]+(?:-[a-z0-9]+)+)\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*)\/?>/g)) {
      const name = m[1].includes("-") ? m[1].replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase()) : m[1].split(".").pop()!;
      for (const a of m[2].matchAll(/([:@]?[\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) {
        const prop = a[1].replace(/^:/, "").replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
        if (a[1].startsWith("@") || /^(class|style|id|key|ref|slot|href|src)$/.test(prop)) continue;
        let v: string | undefined;
        if (a[1].startsWith(":")) v = resolveExpr(a[2] ?? a[3] ?? "", local) ?? stringLiterals(a[2] ?? a[3] ?? "").find((x) => ARABIC.test(x));
        else if (a[4] !== undefined) v = resolveExpr(a[4], local) ?? stringLiterals(a[4]).find((x) => ARABIC.test(x));
        else v = a[2] ?? a[3];
        if (v && ARABIC.test(v)) { const mp = idx.get(name) ?? new Map(); if (!mp.has(prop)) mp.set(prop, v); idx.set(name, mp); }
      }
    }
  }
  return idx;
}

/** tsconfig/jsconfig `paths` (+ SvelteKit `$lib`, `~/`, `@/`) as [prefix, folder] pairs. */
function aliases(root: string): [string, string][] {
  const out: [string, string][] = [["$lib/", path.join(root, "src/lib")], ["~/", path.join(root, "src")], ["@/", path.join(root, "src")]];
  for (const n of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const raw = fs.readFileSync(path.join(root, n), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/[^\n]*/g, "$1").replace(/,(\s*[}\]])/g, "$1");
      const co = JSON.parse(raw).compilerOptions ?? {};
      const base = path.join(root, co.baseUrl ?? ".");
      for (const [k, v] of Object.entries(co.paths ?? {}) as [string, string[]][]) if (v?.[0]) out.unshift([k.replace(/\*$/, ""), path.join(base, v[0].replace(/\*$/, ""))]);
    } catch {}
  }
  return out;
}
function resolveSpec(spec: string, from: string, root: string, al: [string, string][]): string | null {
  const cands: string[] = [];
  if (spec.startsWith(".")) cands.push(path.resolve(path.dirname(from), spec));
  else if (spec.startsWith("/")) cands.push(path.join(root, "public", spec), path.join(root, spec));
  else {
    for (const [pre, dir] of al) if (spec.startsWith(pre)) cands.push(path.join(dir, spec.slice(pre.length)));
    cands.push(path.join(root, "node_modules", spec));
  }
  for (const c of cands) for (const x of [c, c + ".css", path.join(c, "index.css")]) { try { if (fs.statSync(x).isFile()) return x; } catch {} }
  return null;
}
/** A stylesheet with its local `@import`s inlined; `@fontsource` packages that aren't installed become their family's @font-face. */
function readCss(file: string, root: string, al: [string, string][], seen = new Set<string>()): string {
  if (seen.has(file) || seen.size > 60) return "";
  seen.add(file);
  let css = ""; try { css = fs.readFileSync(file, "utf8"); } catch { return ""; }
  return css.replace(/@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?[^;]*;/g, (all, spec: string) => {
    if (/^(https?:)?\/\//.test(spec)) return all;
    const fsrc = /^@fontsource(-variable)?\/([\w-]+)/.exec(spec);
    const hit = resolveSpec(spec, file, root, al);
    if (hit) return readCss(hit, root, al, seen);
    if (fsrc) return `@font-face{font-family:"${fsrc[2].split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}${fsrc[1] ? " Variable" : ""}";src:url("node_modules/${spec}")}`;
    return "";
  });
}

function walk(dir: string, re: RegExp, out: string[], depth = 0, cap = 4000): string[] {
  if (depth > 7 || out.length >= cap) return out;
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, out, depth + 1, cap); else if (re.test(e.name)) out.push(p);
  }
  return out;
}
export const templateFiles = (dir: string) => walk(dir, /\.(astro|vue|svelte)$/i, []);

/** The project root of a file: nearest folder with package.json (or the file's folder). */
export function projectRoot(file: string): string {
  let d = path.dirname(path.resolve(file));
  for (let i = 0; i < 8; i++) { if (fs.existsSync(path.join(d, "package.json"))) return d; const up = path.dirname(d); if (up === d) break; d = up; }
  return path.dirname(path.resolve(file));
}

/**
 * RTL context and global CSS of a template project.
 * RTL: some file sets dir="rtl" statically, or sets dir dynamically / carries `[dir=rtl]` rules, and the project has Arabic content.
 * CSS: stylesheets imported from templates or entry scripts, `<link rel=stylesheet>` to local files, `<style is:global>` and
 * unscoped Vue `<style>` blocks of other components.
 */
export function templateProject(root: string): TemplateProject {
  const srcs = walk(root, /\.(astro|vue|svelte|html?|[cm]?[jt]sx?|json|css)$/i, []).filter((f) => !/package(-lock)?\.json$|tsconfig|\.d\.ts$/.test(f));
  let rtlStatic = false, rtlDyn = false, arabic = false;
  const cssFiles = new Set<string>();
  const globalBlocks: string[] = [];
  const al = aliases(root);
  const links = new Set<string>();
  let shell = false, tailwind = false;
  try { const j = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); tailwind = Object.keys({ ...j.dependencies, ...j.devDependencies }).some((k) => /^(tailwindcss|@tailwindcss\/)/.test(k)); } catch {}
  for (const f of srcs) {
    let s = ""; try { if (fs.statSync(f).size > 1_500_000) continue; s = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (!arabic && ARABIC.test(s)) arabic = true;
    if (/\.css$/i.test(f)) { if (/\[dir=["']?rtl|:dir\(rtl\)/.test(s)) rtlDyn = true; if (/@import\s+["']tailwindcss|@tailwind\s+(base|utilities)/.test(s)) tailwind = true; continue; }
    if (/\bdir\s*=\s*["']rtl["']/.test(s) && /\.(astro|vue|svelte|html?)$/i.test(f)) rtlStatic = true;
    if (/\bdir\s*=\s*\{|:dir\s*=|documentElement\.dir\s*=|dir\s*:\s*["']rtl["']|\[dir=["']?rtl|:dir\(rtl\)|setAttribute\(\s*["']dir["']/.test(s)) rtlDyn = true;
    for (const m of s.matchAll(/import\s+(?:[\w{}\s,*]+\s+from\s+)?["']([^"']+\.(?:css|scss|less))["']/g)) {
      const p = resolveSpec(m[1], f, root, al);
      if (p) cssFiles.add(p);
    }
    if (/\.(astro|vue|svelte|html?)$/i.test(f) && /<html[\s>]|<head[\s>]|<svelte:head>/i.test(s)) shell = true;
    for (const m of s.matchAll(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|bunny)\.[^"']+["'][^>]*>/gi)) links.add(m[0].replace(/\s+/g, " "));
    for (const m of s.matchAll(/@import\s+url\(\s*["']?(https:\/\/fonts\.(?:googleapis|bunny)[^"')]+)/g)) links.add(`<link rel="stylesheet" href="${m[1]}">`);
    for (const m of s.matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)) {
      const href = /href=["']([^"'{}]+)["']/.exec(m[0])?.[1];
      if (!href || /^(https?:)?\/\//.test(href)) continue;
      for (const p of [path.join(root, "public", href), path.join(root, href), path.resolve(path.dirname(f), href)]) if (fs.existsSync(p) && fs.statSync(p).isFile()) { cssFiles.add(p); break; }
    }
    if (/\.(astro|vue|svelte)$/i.test(f)) {
      for (const m of s.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
        const attrs = m[1];
        const global = /is:global/.test(attrs) || (f.endsWith(".vue") && !/\bscoped\b|\bmodule\b/.test(attrs));
        if (global) globalBlocks.push(cleanCss(m[2], `<style${attrs}>`));
        else if (f.endsWith(".svelte")) for (const g of m[2].matchAll(/:global\(([^()]+)\)\s*\{[^}]*\}/g)) globalBlocks.push(cleanCss(g[0], "<style>"));
      }
    }
  }
  let css = "";
  for (const f of cssFiles) { try { css += cleanCss(readCss(f, root, al), /\.scss$/.test(f) ? '<style lang="scss">' : /\.less$/.test(f) ? '<style lang="less">' : "<style>") + "\n"; } catch {} if (css.length > 600_000) break; }
  css += globalBlocks.join("\n");
  for (const m of css.matchAll(/@import\s+url\(\s*["']?(https:\/\/fonts\.(?:googleapis|bunny)[^"')]+)/g)) links.add(`<link rel="stylesheet" href="${m[1]}">`);
  const keys = loadI18n(root).keys;
  const props = propsIndex(srcs.filter((f) => /\.(astro|vue|svelte)$/i.test(f)), keys);
  return { root, rtl: arabic && (rtlStatic || rtlDyn), css: css.slice(0, 800_000), files: srcs.length, links: [...links].join(""), shell, keys, props, tailwind };
}

/** Turn a template into analysable HTML with the same line numbers. */
export function templateToHtml(file: string, src: string, proj: TemplateProject, tags?: Map<number, TagInfo>, runs?: TextRun[]): string {
  const flavor = flavorOf(file);
  const cx: Ctx = { flavor, dyn: { dir: false, lang: false }, consts: arabicConsts(src), dicts: dictVars(src), keys: proj.keys ?? new Map(), props: proj.props?.get(componentName(file)) ?? new Map(), tags, runs, tw: new Set() };
  let body: string;
  if (flavor === "astro") {
    const fm = /^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---[^\n]*/.exec(src);
    body = fm ? blankKeep(fm[0]) + markup(src.slice(fm[0].length), cx, fm[0].length, fm[0].length) : markup(src, cx);
  } else if (flavor === "vue") {
    // top-level blocks: <template> markup, <style> kept, <script> kept raw, custom blocks blanked
    let out = "", k = 0;
    const re = /<(template|script|style|[\w-]+)(\s[^>]*)?>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m.index < k) continue;
      out += blankKeep(src.slice(k, m.index));
      const tag = m[1].toLowerCase();
      // matching close: last </template> for the root template, next close tag otherwise
      const close = tag === "template" ? src.lastIndexOf("</template>") : src.toLowerCase().indexOf(`</${tag}>`, re.lastIndex);
      if (close < 0) { k = m.index; break; }
      const inner = src.slice(re.lastIndex, close);
      const closeLen = `</${tag}>`.length;
      if (tag === "template") out += blankKeep(m[0]) + markup(inner, cx, m.index + m[0].length, out.length + m[0].length) + blankKeep(src.slice(close, close + closeLen));
      else if (tag === "style") out += m[0] + cleanCss(inner, m[0]) + src.slice(close, close + closeLen);
      else if (tag === "script") out += m[0] + inner + src.slice(close, close + closeLen);
      else out += blankKeep(src.slice(m.index, close + closeLen));
      k = close + closeLen;
      re.lastIndex = k;
    }
    body = out + blankKeep(src.slice(k));
  } else body = markup(src, cx);
  const css = proj.css.replace(/\r?\n/g, " ").replace(/<\/style/gi, "<\\/style");
  const tw = proj.tailwind ? tailwindCss(cx.tw) : "";
  const head = proj.links + (tw ? `<style data-harakah-tailwind>${tw}</style>` : "") + (css.trim() ? `<style data-harakah-project>${css}</style>` : "");
  const rtlAttrs = proj.rtl ? ` lang="ar" dir="rtl"` : "";
  // every splice below shifts the text runs that follow it
  const splice = (at: number, del: number, ins: string) => {
    body = body.slice(0, at) + ins + body.slice(at + del);
    if (runs) for (const r of runs) if (r.out >= at + del) r.out += ins.length - del;
  };
  if (/<html[\s>]/i.test(body)) {
    // a layout: give a dynamic <html dir={…}> the project's RTL, inject the project CSS into <head>
    const hm = /<html\b([^>]*)>/i.exec(body)!;
    if (proj.rtl && !/\bdir=/.test(hm[1])) splice(hm.index, hm[0].length, `<html${hm[1].replace(/\s*\blang="[^"]*"/, "")}${rtlAttrs}>`);
    if (head) { const at = /<head\b[^>]*>/i.exec(body) ?? /<html\b[^>]*>/i.exec(body)!; splice(at.index + at[0].length, 0, head); }
  } else splice(0, 0, `<!doctype html><html${rtlAttrs}><head><meta charset="utf-8">${head}</head><body>`);
  // keep only runs that really sit where they claim (a safety net for the offset bookkeeping)
  if (runs) { const ok = runs.filter((r) => body.slice(r.out, r.out + r.len) === src.slice(r.src, r.src + r.len)); runs.length = 0; runs.push(...ok); }
  return body;
}

/** `const title = 'رحلات'`, `export let word = 'حركة'`, `{ title = 'مرحبا' } = Astro.props`: simple Arabic constants of the component. */
function arabicConsts(src: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of src.matchAll(/(?:\b(?:const|let|var)\s+|[{,]\s*)([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]*?)\2/g)) if (ARABIC.test(x[3]) && !x[3].includes("${")) m.set(x[1], x[3]);
  return m;
}

const SPLIT_RE = /\[\s*\.\.\.\s*([^\]]+?)\s*\]|([\w$.'"`\u0600-\u06FF ]+?(?:\([^)]*\))?)\.split\(\s*(?:''|""|``)\s*\)|Array\.from\(\s*([^),]+?)\s*\)/;
/**
 * Per-letter loops in templates: `{#each [...word] as c}`, `v-for="c in title.split('')"`, `{[...title].map((c) => <span>{c}</span>)}`.
 * Each letter in its own element breaks Arabic joining. Error when the split string is Arabic, warning when it comes from a prop.
 */
export function letterLoops(file: string, src: string): Issue[] {
  const flavor = flavorOf(file);
  const loops: { expr: string; v: string; at: number }[] = [];
  if (flavor === "svelte") for (const m of src.matchAll(/\{#each\s+([\s\S]+?)\s+as\s+\(?\s*(\w+)/g)) loops.push({ expr: m[1], v: m[2], at: m.index! });
  if (flavor === "vue") for (const m of src.matchAll(/v-for\s*=\s*"\s*\(?\s*(\w+)[^"]*?\s+(?:in|of)\s+([^"]+)"/g)) loops.push({ expr: m[2], v: m[1], at: m.index! });
  if (flavor !== "vue") for (const m of src.matchAll(/(\[\s*\.\.\.[^\]]+\]|[\w$.]+(?:\.split\([^)]*\))?|Array\.from\([^)]*\))\s*\.map\(\s*\(?\s*(\w+)/g)) loops.push({ expr: m[1], v: m[2], at: m.index! });
  const consts = arabicConsts(src);
  const def = (id: string) => new RegExp(`\\b(?:const|let|var|export\\s+let)\\s+${id.replace(/[$.]/g, "\\$&")}\\s*=\\s*([^;\\n]+)`).exec(src)?.[1];
  const out: Issue[] = [];
  const seen = new Set<number>();
  for (const L of loops) {
    let e = L.expr.trim();
    if (!SPLIT_RE.test(e) && /^[\w$.]+$/.test(e)) e = def(e)?.trim() ?? e;
    const sm = SPLIT_RE.exec(e);
    if (!sm) continue;
    const target = (sm[1] ?? sm[2] ?? sm[3] ?? "").trim();
    if (/^\{?\s*length\s*:/.test(target) || /^\d/.test(target)) continue; // Array.from({length: n}), ranges
    const lit = stringLiterals(target).find((x) => ARABIC.test(x));
    const id = target.replace(/^props\./, "");
    const arabic = !!lit || consts.has(id) || ARABIC.test(def(id) ?? "");
    // the loop must render the item: {c} / {{ c }} after the loop start
    const tail = src.slice(L.at, L.at + 600);
    if (!new RegExp(`\\{\\{?\\s*${L.v}\\s*\\}`).test(tail)) continue;
    if (!arabic && !ARABIC.test(src)) continue;
    const line = src.slice(0, L.at).split("\n").length;
    if (seen.has(line)) continue;
    seen.add(line);
    const sample = lit ?? consts.get(id) ?? target;
    out.push({
      code: "HZ02", name: RULES.HZ02.name, severity: arabic ? "error" : "warning", fixable: false, fixMode: "none", line,
      title: RULES.HZ02.title, why: RULES.HZ02.why,
      message: {
        en: `Template loop renders "${sample.slice(0, 30)}" one letter per element (${e.slice(0, 40)}): each letter takes its isolated form and the word falls apart. Loop over words, or pad each letter with ZWJ (splitArabic() from @harakah/remotion-arabic keeps per-letter animation joined).`,
        ar: `حلقة القالب تعرض «${sample.slice(0, 30)}» حرفاً في كل عنصر: يأخذ كل حرف شكله المنفصل فتتفكك الكلمة. كرّر على الكلمات، أو أضف ZWJ لكل حرف (splitArabic() من @harakah/remotion-arabic).`,
      },
    });
  }
  return out;
}

/** Report-only analysis of one template: engine findings at the template's own lines, never auto-fixable. */
export function analyzeTemplate(file: string, opts: Options, proj?: TemplateProject): Issue[] {
  return analyzeTemplateSource(file, fs.readFileSync(file, "utf8"), opts, proj);
}
/** Same as analyzeTemplate, on a source string (used to verify a patch before it is written). */
export function analyzeTemplateSource(file: string, src: string, opts: Options, proj?: TemplateProject): Issue[] {
  const p = proj ?? templateProject(projectRoot(file));
  if (!ARABIC.test(src) && !p.keys?.size && !p.props?.has(componentName(file))) return [];
  const html = templateToHtml(file, src, p);
  const res = analyze(html, { ...opts, baseDir: path.dirname(file) });
  const fragment = !/<html[\s>]/i.test(html.slice(html.indexOf("<body>") + 6));
  return [...letterLoops(file, src), ...res.issues]
    .filter((i) => !(i.code === "HZ04" && p.rtl)) // lang is set by the layout, not by a component
    .filter((i) => !(fragment && p.shell && i.code === "HZ09" && /\(browser default\)/.test(i.message.en))) // inherits the layout's font
    .map((i) => ({ ...i, fixable: false, message: { en: i.message.en + " (template: report-only here; `harakah-fix fix <file>` emits a reviewable patch)", ar: i.message.ar + " (قالب: `harakah-fix fix` يُخرج تعديلاً قابلاً للمراجعة)" } }));
}

/**
 * Every template with Arabic under a folder. Findings that come from project CSS on the synthetic page (`body`/`html`) are
 * reported once, on the first file, with the number of templates they affect.
 */
export function checkTemplates(dir: string, opts: Options, root = dir): { file: string; issues: Issue[] }[] {
  const files = templateFiles(dir);
  if (!files.length) return [];
  const proj = templateProject(root);
  const out: { file: string; issues: Issue[] }[] = [];
  const shared = new Map<string, { issue: Issue; n: number }>();
  for (const f of files) {
    const issues = analyzeTemplate(f, opts, proj);
    const own: Issue[] = [];
    for (const i of issues) {
      if (i.where === "body" || i.where === "html") {
        const key = i.code + "|" + i.message.en.replace(/\d+ Arabic element\(s\)/, "");
        const e = shared.get(key);
        if (e) { e.n++; continue; }
        shared.set(key, { issue: i, n: 1 });
      }
      own.push(i);
    }
    if (own.length) out.push({ file: f, issues: own });
  }
  for (const { issue, n } of shared.values()) if (n > 1) issue.message = { en: issue.message.en + ` [project CSS: same in ${n} templates]`, ar: issue.message.ar + ` [من أنماط المشروع: في ${n} قالباً]` };
  return out;
}
