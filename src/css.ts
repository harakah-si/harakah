import fs from "node:fs";
import path from "node:path";
/**
 * Minimal CSS cascade over a cheerio document: enough to resolve the handful of
 * properties that matter for Arabic (direction, font-family, letter-spacing, ...).
 * Not a full engine: ignores media query evaluation, :hover etc. Specificity + order + inline + !important.
 */
import postcss from "postcss";
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

export interface Decl { prop: string; value: string; important: boolean }
export interface Rule { selector: string; spec: number; order: number; decls: Decl[]; source: string }
/** base: folder the src url()s are relative to (the page for <style>, the stylesheet for <link>) */
export interface FontFace { family: string; src: string; base?: string }

const INHERITED = new Set(["direction", "font-family", "letter-spacing", "line-height", "text-align", "text-transform",
  "word-break", "font-style", "font-size", "font-weight", "font-variant", "font-variant-caps", "word-spacing", "text-align-last", "white-space"]);

export function specificity(sel: string): number {
  const s = sel.replace(/::?[a-z-]+\([^)]*\)/gi, (m) => (m.startsWith(":not(") || m.startsWith(":is(") ? m.slice(m.indexOf("(") + 1, -1) : " "));
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const tags = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + cls * 100 + tags;
}

export function parseInline(style: string | undefined): Decl[] {
  if (!style) return [];
  try {
    const root = postcss.parse(`x{${style}}`);
    const out: Decl[] = [];
    root.walkDecls((d) => { out.push({ prop: d.prop.toLowerCase(), value: d.value, important: !!d.important }); });
    return out;
  } catch {
    return [];
  }
}

export function setInline(style: string | undefined, prop: string, value: string, important = false): string {
  const decls = parseInline(style).filter((d) => d.prop !== prop);
  decls.push({ prop, value, important });
  return decls.map((d) => `${d.prop}:${d.value}${d.important ? " !important" : ""}`).join(";");
}

const AR_LANGS = String.raw`(?:ar|fa|ur|ps|ckb|sd|ug|ku|prs|arz|ary|apc|acm|ajp|aeb)(?:-[\w-]*)?`;
const RTL_CONDS: RegExp[] = [
  /:dir\(\s*rtl\s*\)/gi,
  new RegExp(String.raw`:lang\(\s*["']?${AR_LANGS}["']?\s*\)`, "gi"),
  /\[\s*dir\s*=\s*["']?rtl["']?(?:\s+[is])?\s*\]/gi,
  new RegExp(String.raw`\[\s*lang\s*[|^]?=\s*["']?${AR_LANGS}["']?(?:\s+[is])?\s*\]`, "gi"),
];
/** class conventions for "the page is in RTL/Arabic mode", only on an ancestor compound (`body.rtl .x`, `.is-rtl .x`) */
const RTL_CLASS = /\.(?:rtl|is-rtl|dir-rtl|lang-ar|locale-ar|ar|arabic|rtl-mode)(?![\w-])/gi;
const LTR_COND = /:dir\(\s*ltr\s*\)|\[\s*dir\s*=\s*["']?ltr["']?\s*\]|:lang\(\s*["']?(?!ar|fa|ur|ps|ckb)[a-z]{2}/i;

/**
 * A selector that only applies in RTL/Arabic mode (`html[dir="rtl"] .label`, `.label:dir(rtl)`, `:lang(ar) h1`,
 * `[lang|=ar] .x`, `body.rtl .x`) with that condition removed, so it can be matched against an Arabic element whose page
 * isn't (statically) RTL yet. `root`: the condition sits on <html>/<body>/:root, or is a class convention set by app code,
 * so it only holds when the document itself is RTL.
 */
export function normalizeRtlSelector(sel: string): { sel: string; root: boolean } | null {
  if (LTR_COND.test(sel)) return null;
  // split into compounds, keeping combinators
  const parts = sel.trim().split(/(\s*[>+~]\s*|\s+)/);
  let hit = false, root = false;
  const last = parts.length - 1;
  const out = parts.map((c, i) => {
    if (i % 2 === 1) return c;
    let x = c;
    for (const re of RTL_CONDS) x = x.replace(re, () => { hit = true; if (/^(?:html|body|:root)\b/i.test(c)) root = true; return ""; });
    if (i < last) x = x.replace(RTL_CLASS, () => { hit = true; root = true; return ""; });
    return x === "" ? "*" : x;
  });
  if (!hit) return null;
  return { sel: out.join("").replace(/^\*\s+/, "").trim() || "*", root };
}

/** <html> is RTL/Arabic statically, or app code sets its dir/lang/class at runtime (i18n) */
function documentRtl($: CheerioAPI): boolean {
  const html = $("html").first();
  if (/^rtl$/i.test(html.attr("dir") || "") || new RegExp(`^${AR_LANGS}$`, "i").test(html.attr("lang") || "")) return true;
  const js = $("script:not([src])").text();
  return /documentElement\.(?:dir|lang)\s*=(?!\s*["'`]ltr)|documentElement\.setAttribute\(\s*["'`](?:dir|lang)["'`]\s*,(?!\s*["'`]ltr)|documentElement\.classList\.(?:add|toggle)\(\s*["'`](?:rtl|ar)|body\.classList\.(?:add|toggle)\(\s*["'`](?:rtl|ar)|\bi18n\.dir\(/.test(js);
}

/** "ar": Arabic mode (RTL-conditioned rules apply; <html>-anchored ones only when the document is RTL); "ar+": assume <html> is RTL too */
export type Mode = "ar" | "ar+" | undefined;

export class Cascade {
  rules: Rule[] = [];
  /** RTL-conditioned rules, normalized: element -> rules that apply to it in Arabic mode */
  private rtlMatched = new Map<Element, (Rule & { rtl: string; root: boolean })[]>();
  /** the document itself is RTL (statically, or set by app code) */
  rootRtl = false;
  fontFaces: FontFace[] = [];
  /** element -> matched rules */
  private matched = new Map<Element, Rule[]>();
  private computedCache = new Map<Element, Map<string, string | undefined>>();
  /** baseDir: also read local linked stylesheets (<link rel="stylesheet" href="./x.css">) relative to it, analysis only. */
  constructor(private $: CheerioAPI, baseDir?: string) {
    let order = 0;
    $('style, link[rel~="stylesheet"]').each((_, el) => {
      let css = "";
      let base = baseDir;
      if ((el as Element).name === "link") {
        const href = (el as Element).attribs.href || "";
        if (!baseDir || !href || /^([a-z][\w+.-]*:|\/\/|\/)/i.test(href)) return; // local relative files only
        try {
          const f = path.resolve(baseDir, decodeURIComponent(href.split(/[?#]/)[0]));
          if (!/\.css$/i.test(f) || fs.statSync(f).size > 2_000_000) return;
          css = fs.readFileSync(f, "utf8");
          base = path.dirname(f);
        } catch { return; }
      } else css = $(el).text();
      let root: postcss.Root;
      try { root = postcss.parse(css); } catch { return; }
      root.walkAtRules("font-face", (at) => {
        let family = "", src = "";
        at.walkDecls((d) => {
          if (d.prop.toLowerCase() === "font-family") family = d.value.replace(/['"]/g, "").trim();
          if (d.prop.toLowerCase() === "src") src = d.value;
        });
        if (family) this.fontFaces.push({ family, src, base });
      });
      root.walkRules((r) => {
        const parent = r.parent as postcss.AtRule | undefined;
        if (parent && parent.type === "atrule" && /keyframes|font-face/i.test(parent.name)) return;
        const decls: Decl[] = [];
        r.walkDecls((d) => { decls.push({ prop: d.prop.toLowerCase(), value: d.value, important: !!d.important }); });
        for (const sel of r.selectors) {
          this.rules.push({ selector: sel.trim(), spec: specificity(sel), order: order++, decls, source: r.toString().slice(0, 160) });
        }
      });
    });
    this.rootRtl = documentRtl($);
    for (const rule of this.rules) {
      if (/::|:(before|after|first-letter|first-line|placeholder|selection|marker)/i.test(rule.selector)) continue;
      const n = normalizeRtlSelector(rule.selector);
      if (n) {
        let els: Element[] = [];
        try { els = $(n.sel.replace(/:(hover|focus|active|visited|focus-visible|focus-within)\b/gi, "")).toArray() as Element[]; } catch {}
        for (const el of els) { const arr = this.rtlMatched.get(el) ?? []; arr.push({ ...rule, rtl: rule.selector, root: n.root }); this.rtlMatched.set(el, arr); }
      }
      const sel = rule.selector.replace(/:(hover|focus|active|visited|focus-visible|focus-within)\b/gi, "");
      let els: Element[] = [];
      try { els = $(sel).toArray() as Element[]; } catch { continue; }
      for (const el of els) {
        const arr = this.matched.get(el) ?? [];
        arr.push(rule);
        this.matched.set(el, arr);
      }
    }
  }

  /** Declared (not inherited) value of prop on element, or undefined. */
  declared(el: Element, prop: string, mode?: Mode): { value: string; from: "inline" | "rule" | "attr"; rule?: Rule & { rtl?: string } } | undefined {
    const inline = parseInline(el.attribs?.style).filter((d) => d.prop === prop || (prop === "font-family" && d.prop === "font")).pop();
    let base: (Rule & { rtl?: string })[] = this.matched.get(el) ?? [];
    if (mode) {
      const extra = (this.rtlMatched.get(el) ?? []).filter((r) => mode === "ar+" || !r.root || this.rootRtl);
      // the same rule may already match statically (page already RTL): keep one copy, tagged as the RTL rule
      if (extra.length) base = [...base.filter((r) => !extra.some((x) => x.order === r.order)), ...extra];
    }
    const rules = base.slice().sort((a, b) => a.spec - b.spec || a.order - b.order);
    let best: { d: Decl; r: Rule } | undefined;
    for (const r of rules) for (const d of r.decls) {
      if (d.prop !== prop && !(prop === "font-family" && d.prop === "font")) continue;
      if (!best || d.important || !best.d.important) best = { d, r };
    }
    if (inline && !(best?.d.important && !inline.important)) return { value: this.resolveVars(el, fontValue(inline, prop)), from: "inline" };
    if (best) return { value: this.resolveVars(el, fontValue(best.d, prop)), from: "rule", rule: best.r };
    if (prop === "direction" && el.attribs?.dir) return { value: templateAttr(el.attribs.dir, "dir")!.toLowerCase(), from: "attr" };
    return undefined;
  }

  /**
   * Substitute `var(--x, fallback)` with the custom property's value inherited at el (custom properties always inherit),
   * then the fallback. Unresolvable references stay as written. Nested vars resolve up to 8 levels.
   */
  resolveVars(el: Element, value: string, depth = 0): string {
    if (!value.includes("var(") || depth > 8) return value;
    let out = "", i = 0;
    while (i < value.length) {
      const at = value.indexOf("var(", i);
      if (at < 0) { out += value.slice(i); break; }
      out += value.slice(i, at);
      // find the matching ")"
      let d = 0, j = at + 3;
      for (; j < value.length; j++) { if (value[j] === "(") d++; else if (value[j] === ")" && --d === 0) break; }
      const inner = value.slice(at + 4, j);
      const comma = topLevelComma(inner);
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
      const v = this.customProp(el, name);
      out += v !== undefined ? this.resolveVars(el, v, depth + 1) : fallback !== undefined ? this.resolveVars(el, fallback, depth + 1) : value.slice(at, j + 1);
      i = j + 1;
    }
    return out;
  }

  private customProp(el: Element, name: string): string | undefined {
    if (!name.startsWith("--")) return undefined;
    const key = name.toLowerCase();
    for (let cur: AnyNode | null = el; cur && cur.type === "tag"; cur = cur.parent) {
      const e = cur as Element;
      const inline = parseInline(e.attribs?.style).filter((d) => d.prop === key).pop();
      let best: Decl | undefined;
      for (const r of (this.matched.get(e) ?? []).slice().sort((a, b) => a.spec - b.spec || a.order - b.order)) for (const d of r.decls) {
        if (d.prop === key && (!best || d.important || !best.important)) best = d;
      }
      const d = inline && !(best?.important && !inline.important) ? inline : best;
      if (d) return d.value.trim();
    }
    return undefined;
  }

  computed(el: Element, prop: string, mode?: Mode): string | undefined {
    let m = this.computedCache.get(el);
    if (!m) { m = new Map(); this.computedCache.set(el, m); }
    const key = mode ? `${prop}|${mode}` : prop;
    if (m.has(key)) return m.get(key);
    const d = this.declared(el, prop, mode);
    let v = d?.value;
    if ((v === undefined || v === "inherit") && INHERITED.has(prop)) {
      const p = el.parent as AnyNode | null;
      v = p && p.type === "tag" ? this.computed(p as Element, prop, mode) : undefined;
    }
    m.set(key, v);
    return v;
  }

  /** Which element in the ancestor chain (self first) declares prop. */
  declaringAncestor(el: Element, prop: string, mode?: Mode): Element | undefined {
    let cur: AnyNode | null = el;
    while (cur && cur.type === "tag") {
      if (this.declared(cur as Element, prop, mode)) return cur as Element;
      cur = cur.parent;
    }
    return undefined;
  }

  /** The RTL-conditioned rule that decides prop for el in Arabic mode, if any (`html[dir=rtl] .label`). */
  rtlSource(el: Element, prop: string, mode: Mode = "ar"): string | undefined {
    const a = this.declaringAncestor(el, prop, mode);
    const d = a && this.declared(a, prop, mode);
    return d?.from === "rule" ? d.rule?.rtl : undefined;
  }

  invalidate() { this.computedCache.clear(); }
}

function topLevelComma(s: string): number {
  let d = 0;
  for (let i = 0; i < s.length; i++) { if (s[i] === "(") d++; else if (s[i] === ")") d--; else if (s[i] === "," && d === 0) return i; }
  return -1;
}

/** Split a CSS value on top-level whitespace (parentheses and quotes kept intact; `a / b` glued to `a/b`). */
function cssTokens(v: string): string[] {
  const out: string[] = [];
  let cur = "", depth = 0, q = "";
  for (const ch of v.replace(/\s*\/\s*/g, "/")) {
    if (q) { cur += ch; if (ch === q) q = ""; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const SIZE_TOKEN = /^(?:[\d.]+(?:px|em|rem|pt|pc|%|vw|vh|vmin|vmax|svh|lvh|dvh|cqw|cqh|ch|ex|cap|lh|rlh|cm|mm|in|q)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|(?:calc|clamp|min|max)\(.*\))(?:\/.+)?$/i;

/** The family part of a `font` shorthand (or the value itself for `font-family`). Exported for tests. */
export function shorthandFamily(value: string): string {
  const t = cssTokens(value.trim());
  // the size is the first size-like token, or any token carrying `/line-height` (`var(--s)/1`)
  let i = t.findIndex((x) => SIZE_TOKEN.test(x) || (/\//.test(x) && !/^["']/.test(x)));
  // `font: var(--w) var(--size) var(--family)`: the size is unknowable, the family is the last var()
  if (i < 0 && t.length > 1 && /^var\(/i.test(t[t.length - 1])) i = t.length - 2;
  return i >= 0 && i < t.length - 1 ? t.slice(i + 1).join(" ") : value;
}

function fontValue(d: Decl, prop: string): string {
  // shorthand: family is everything after the size token
  // (`700 64px 'Noto Naskh Arabic', serif`: the weight is not the size;
  //  `700 calc(var(--u)*3.2)/1 var(--display)`: nested parentheses are one token)
  if (prop === "font-family" && d.prop === "font") return shorthandFamily(d.value);
  return d.value;
}

/** Resolve a CSS length to px (best effort). */
export function toPx(v: string | undefined, fontSizePx: number): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (t === "normal" || t === "0") return t === "0" ? 0 : undefined;
  const m = t.match(/^(-?[\d.]+)(px|em|rem|%)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "px": return n;
    case "em": return n * fontSizePx;
    case "rem": return n * 16;
    case "%": return (n / 100) * fontSizePx;
    default: return n === 0 ? 0 : undefined;
  }
}

const TEMPLATE = /\{\{|\{%|<%|\$\{|\[\[/;
/**
 * Attribute values written as template placeholders (starter kits, Jinja/Liquid/Handlebars/EJS/JS templates):
 * `dir="{{DIR|rtl}}"`, `lang="{{ lang | default('ar') }}"`, `dir="<%= dir || 'rtl' %>"`, `dir="${dir ?? "rtl"}"`.
 * Returns the default when one is written; for dir, "rtl" when the expression mentions it, otherwise "auto" (the page
 * decides at runtime; first strong character wins); for lang, undefined (unknown). Plain values pass through.
 */
export function templateAttr(v: string, kind: "dir" | "lang"): string | undefined {
  if (!TEMPLATE.test(v)) return v;
  const def = v.match(/\|\s*(?:default\s*\(\s*)?["']?([A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?|rtl|ltr|auto)\b/) ?? v.match(/(?:\?\?|\|\||\bor\b)\s*["']([A-Za-z-]{2,8})["']/);
  if (def) return def[1];
  if (kind === "dir") return /\brtl\b/i.test(v) ? "rtl" : "auto";
  return undefined;
}

