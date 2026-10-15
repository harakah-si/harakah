/**
 * Harakah engine: static analysis + safe auto-fixes for Arabic in HTML motion compositions
 * (HyperFrames, plain HTML/CSS/GSAP). Detection is static (cheerio + postcss + script regexes);
 * runtime splits are handled by injecting a tiny ZWJ shim (see runtime.ts).
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";
import fs from "node:fs";
import path from "node:path";
import { Cascade, setInline, templateAttr, toPx } from "./css.js";
import {
  hasArabic, hasArabicLetter, hasTashkeel, tashkeelLevel, graphemes, zwjPad, isLamAlefBoundary, groupIntoWords,
  digitScripts, normalizeDigits, scriptLang, ARABIC_SCRIPT_LANG_RE, reversedScore, LATIN_RUN_RE as LATIN_SRC_IMPORT, BIDI_CONTROL_RE, ARABIC_LETTER_RE, joiningType,
} from "./arabic.js";
import { parseDirective, covers, merge, type Scope } from "./suppress.js";
import { parseStack, classify, arabicCapable, bundledByFamily, BUNDLED, ASSET_FONT_DIR, norm } from "./fonts.js";
import { RULES, VIDEO_TRACKING, type Severity, type FixMode } from "./rules.js";
import { letterDraws, buildsDom, usesTextGeometry, troikaWithoutFont, MESSAGES } from "./canvas.js";
import { RUNTIME_SHIM } from "./runtime.js";
import { familyCoverage, verifiedClass, describe as describeCoverage, type FamilyCoverage } from "./glyphs.js";

export interface Options {
  /** How to repair per-letter splits: keep per-letter boxes with ZWJ padding (default) or merge into per-word boxes. */
  split?: "zwj" | "word";
  /** Digit policy. Default "eastern" (١٢٣). "keep" = report mixing only. */
  digits?: "eastern" | "western" | "keep";
  /** OFL font used as Arabic fallback / replacement. */
  font?: "plex" | "alexandria" | "readex" | "cairo" | "tajawal" | "naskh";
  /** Directory of the HTML file: local linked stylesheets are read for analysis (CLI/gate only, never the web server). */
  baseDir?: string;
  /** How injected @font-face points at the bundled font file. */
  fontSrc?: "file" | "data" | "google" | "none";
  /** URL prefix for fontSrc=file (default "fonts/"). */
  fontBase?: string;
  /** Replace Thmanyah / commercial Arabic fonts with the OFL font (default false). */
  replaceProprietary?: boolean;
  /** Wrap Latin runs inside Arabic in <bdi> (default true). */
  bidi?: boolean;
  /** Inject the runtime ZWJ shim: auto (when runtime char splitting is detected), always, never. */
  shim?: "auto" | "always" | "never";
  /** Only run these rule codes / skip these. */
  only?: string[];
  /** internal (template patches): tag fixed elements with the element that declared the value */
  markDecl?: boolean;
  disable?: string[];
}
export const DEFAULTS: Required<Omit<Options, "only" | "disable" | "baseDir" | "markDecl">> = {
  split: "zwj", digits: "eastern", font: "plex", fontSrc: "file", fontBase: "fonts/",
  replaceProprietary: false, bidi: true, shim: "auto",
};

export interface Issue {
  /** runtime layout findings: a fix suggestion (see layout-audit.ts LayoutSuggestion) */
  suggest?: { kind: string; [k: string]: unknown };
  /** runtime layout findings: the flagged frames (Remotion: frame numbers) */
  frames?: number[];
  code: string;
  name: string;
  severity: Severity;
  title: { en: string; ar: string };
  why: { en: string; ar: string };
  message: { en: string; ar: string };
  where?: string;
  line?: number;
  snippet?: string;
  count?: number;
  fixMode: FixMode;
  fixable: boolean;
  fixed?: boolean;
}
interface InternalIssue extends Issue { apply?: () => void; order: number }

export interface Analysis {
  issues: Issue[];
  stats: { arabicChars: number; latinChars: number; hyperframes: boolean; document: boolean; scripts: number; arabicBlocks: number };
}

const SKIP = new Set(["script", "style", "noscript", "template", "title", "textarea", "head", "meta", "link"]);
const INLINE = new Set(["span", "b", "strong", "em", "i", "a", "bdi", "bdo", "small", "mark", "sup", "sub", "u", "s",
  "label", "abbr", "q", "code", "font", "tspan", "time", "data", "cite", "kbd", "var", "ins", "del"]);
const ANIM_LIB = /gsap|anime(\.min)?\.js|\banime\(|framer|motion\.dev|motion-plus|velocity|lottie|Splitting|SplitType|SplitText|__timelines|requestAnimationFrame|\.animate\(/i;
const BOXY = /^(inline-block|block|flex|inline-flex|grid|inline-grid|table|inline-table|list-item)$/;
const ORDER = ["HZ05", "HZ01", "HZ02", "HZ23", "HZ12", "HZ15", "HZ03", "HZ21", "HZ22", "HZ04", "HZ06", "HZ07", "HZ08", "HZ18", "HZ17", "HZ09", "HZ10", "HZ11", "HZ13"];

const latin = () => new RegExp(LATIN_SRC_IMPORT.source, "g");
// Template placeholders in text (`{{BADGE_TEXT|متوفر الآن}}`, `{{ price }}`, `{% t "x" %}`, `<%= x %>`): the syntax is masked
// (same length, so offsets hold) and only a written default stays visible. Digit/bidi checks and fixes never touch the tag.
const MASK = "\u0001";
export function tplMask(s: string): string {
  if (!/\{\{|\{%|<%|\[\[/.test(s)) return s;
  const blank = (x: string) => MASK.repeat(x.length);
  return s
    .replace(/\{\{([^{}]*)\}\}/g, (all, inner: string) => {
      const m = inner.match(/^(\s*[#/^>&]?\s*[\w.$-]+\s*\|\s*(?:default\s*\(\s*["']?)?)([\s\S]*?)(["']?\s*\)?\s*)$/);
      // keep the default only when it reads like content (Arabic, digits, spaces), not a filter name (`| upper`)
      if (m && /[\u0600-\u06FF0-9\u0660-\u0669\s]/.test(m[2])) return blank("{{" + m[1]) + m[2] + blank(m[3] + "}}");
      return blank(all);
    })
    .replace(/\{%[\s\S]*?%\}|<%[\s\S]*?%>|\[\[[^\]]*\]\]/g, blank);
}
/** Split text into runs: `keep` for Latin runs and template syntax (left as written), others free to edit. */
function runs(data: string): { text: string; latin: boolean; tpl: boolean }[] {
  const m = tplMask(data);
  const out: { text: string; latin: boolean; tpl: boolean }[] = [];
  let last = 0;
  const push = (a: number, b: number, latinRun: boolean) => {
    // within a span, split masked (template) parts from visible ones
    let i = a;
    while (i < b) {
      const tpl = m[i] === MASK;
      let j = i;
      while (j < b && (m[j] === MASK) === tpl) j++;
      out.push({ text: data.slice(i, j), latin: latinRun && !tpl, tpl });
      i = j;
    }
  };
  for (const x of m.matchAll(latin())) { push(last, x.index!, false); push(x.index!, x.index! + x[0].length, true); last = x.index! + x[0].length; }
  push(last, data.length, false);
  return out;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Ctx {
  $: CheerioAPI;
  css: Cascade;
  opts: typeof DEFAULTS & Options;
  issues: InternalIssue[];
  isDoc: boolean;
  isHF: boolean;
  needFonts: Set<string>;
  needShim: boolean;
  /** a script reverses letters itself: the shim must not also flip the container direction */
  reversedSplit?: boolean;
  /** containers a reversing script writes to (`#outputJS`): the shim leaves their direction alone */
  reversedSelectors?: string[];
  scripts: { el: Element; text: string }[];
  fsCache: Map<Element, number>;
  /** harakah-ignore / harakah-disable-file comments (see src/suppress.ts) */
  supp: { file?: Scope; els: Map<Element, Scope> };
}

export function load(html: string): { $: CheerioAPI; isDoc: boolean } {
  const isDoc = /<html[\s>]/i.test(html) || /<!doctype/i.test(html) || /<body[\s>]/i.test(html);
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true } as any, isDoc);
  return { $, isDoc };
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: AnyNode | null = el;
  while (cur && cur.type === "tag" && parts.length < 4) {
    const e = cur as Element;
    if (e.name === "html" || e.name === "body") { parts.unshift(e.name); break; }
    let p = e.name;
    if (e.attribs.id) { parts.unshift(`${p}#${e.attribs.id}`); break; }
    const cls = (e.attribs.class || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) p += "." + cls.join(".");
    parts.unshift(p);
    cur = e.parent;
  }
  return parts.join(" > ");
}
const lineOf = (el: Element) => (el as any).sourceCodeLocation?.startLine as number | undefined;

function* walk(node: AnyNode): Generator<AnyNode> {
  yield node;
  const kids = (node as any).children as AnyNode[] | undefined;
  if (kids) for (const k of [...kids]) {
    if (k.type === "tag" || k.type === "script" || k.type === "style") {
      if (SKIP.has((k as Element).name)) continue;
    }
    yield* walk(k);
  }
}

function textNodes($: CheerioAPI): Text[] {
  const out: Text[] = [];
  for (const n of walk($.root()[0] as AnyNode)) if (n.type === "text") out.push(n as Text);
  return out;
}

function blockOf(el: Element): Element {
  let cur: Element = el;
  while (INLINE.has(cur.name) && cur.parent && cur.parent.type === "tag" && !["body", "html"].includes((cur.parent as Element).name)) {
    cur = cur.parent as Element;
  }
  return cur;
}

function textOf(el: AnyNode): string {
  let s = "";
  for (const n of walk(el)) if (n.type === "text") s += (n as Text).data;
  return s;
}
const countRe = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) || []).length;

/** a node inside an element preceded by `<!-- harakah-ignore [code] -->` */
function suppressedAt(ctx: Ctx, n: AnyNode, code: string): boolean {
  if (!ctx.supp.els.size) return false;
  for (let a: AnyNode | null = n; a; a = a.parent) if (covers(ctx.supp.els.get(a as Element), code)) return true;
  return false;
}
function add(ctx: Ctx, code: string, p: {
  message: { en: string; ar: string }; el?: Element; severity?: Severity; count?: number;
  apply?: () => void; fixable?: boolean; where?: string; line?: number;
}) {
  if (ctx.opts.only && !ctx.opts.only.includes(code)) return;
  if (ctx.opts.disable && ctx.opts.disable.includes(code)) return;
  if (covers(ctx.supp.file, code)) return;
  if (p.el && suppressedAt(ctx, p.el, code)) return;
  const meta = RULES[code];
  const fixable = p.fixable ?? !!p.apply;
  ctx.issues.push({
    code, name: meta.name, severity: p.severity ?? meta.severity, title: meta.title, why: meta.why, message: p.message,
    where: p.where ?? (p.el ? cssPath(p.el) : undefined), line: p.line ?? (p.el ? lineOf(p.el) : undefined),
    snippet: p.el ? ctx.$.html(p.el).replace(/\s+/g, " ").slice(0, 140) : undefined,
    count: p.count, fixMode: meta.fix, fixable, apply: fixable ? p.apply : undefined, order: ORDER.indexOf(code),
  });
}

function fontSizePx(ctx: Ctx, el: Element): number {
  const c = ctx.fsCache.get(el);
  if (c !== undefined) return c;
  const parent = el.parent && el.parent.type === "tag" ? fontSizePx(ctx, el.parent as Element) : 16;
  const d = ctx.css.declared(el, "font-size");
  let v = parent;
  if (d) {
    const kw: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 };
    v = kw[d.value] ?? toPx(d.value, parent) ?? (/^[\d.]+vw$/.test(d.value) ? parseFloat(d.value) * 12.8 : parent);
  }
  ctx.fsCache.set(el, v);
  return v;
}


/* ---------------- layout order (HZ21 Arabic in LTR boxes, HZ22 rows, HZ23 letter boxes) ---------------- */

const AR_CHAR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
// a maximal Arabic run: starts and ends on an Arabic letter; inside, spaces, digits, joiners and in-sentence punctuation
const AR_RUN = new RegExp(`[${AR_CHAR}](?:[${AR_CHAR}\\s\\u200c\\u200d0-9.,!?()«»"'%-]*[${AR_CHAR}])?`, "g");
const CODEISH_TAG = new Set(["pre", "code", "kbd", "samp", "tt", "var"]);
const CODEISH_CLASS = /(^|[\s_-])(term|terminal|console|shell|cli|code|codeblock|prompt|log|output|stdout|repl|mono)($|[\s_-])/i;
const LIST_SEP = /\s[·•|\/]\s|\s?،\s?/;

function isolates(ctx: Ctx, e: Element): boolean {
  if (e.name === "bdi" || e.name === "bdo") return true;
  if (e.attribs.dir !== undefined) return true; // [dir] is unicode-bidi:isolate in the UA stylesheet
  return /isolate|plaintext/.test((ctx.css.computed(e, "unicode-bidi") || "").toLowerCase());
}
function codeish(e: Element): boolean {
  return CODEISH_TAG.has(e.name) || CODEISH_CLASS.test(`${e.attribs.class || ""} ${e.attribs.id || ""}`);
}
function docRtl(ctx: Ctx): boolean {
  const html = ctx.$("html")[0] as Element | undefined, body = ctx.$("body")[0] as Element | undefined;
  return [html, body].some((e) => e && (/^rtl$/i.test(e.attribs.dir || "") || /^(ar|fa|ur|ps|ckb|sd|ug)\b/i.test(e.attribs.lang || "")));
}

function checkLayoutOrder(ctx: Ctx, arTexts: Text[], majority: (b: Element) => boolean): Set<Element> {
  const { $, css } = ctx;
  const handled = new Set<Element>();
  const rtlDoc = docRtl(ctx);
  const dirOf = (e: Element) => (css.computed(e, "direction", "ar") || "ltr").toLowerCase();

  // HZ23 (a): per-letter/word boxes (inline-block, transformed, positioned) whose parent lays them out LTR
  const letterParents = new Set<Element>();
  $("*").each((_, pe) => {
    const p = pe as Element;
    if (SKIP.has(p.name) || suppressedAt(ctx, p, "HZ23")) return;
    const kids = p.children.filter((c) => c.type === "tag") as Element[];
    if (kids.length < 3 || kids.some((k) => k.children.some((c) => c.type === "tag"))) return;
    const texts = kids.map((k) => textOf(k).replace(/[\u200c\u200d\s]/g, "")).filter(Boolean);
    if (texts.length < 3 || texts.filter((t) => ARABIC_LETTER_RE.test(t)).length < texts.length * 0.6) return;
    const short = texts.every((t) => graphemes(t).length <= 3) ? "letter" : texts.every((t) => !/\s/.test(t)) ? "word" : null;
    if (!short) return;
    const boxy = kids.some((e) => BOXY.test(css.computed(e, "display") || "") || !!css.declared(e, "transform") || /absolute|fixed/.test(css.computed(e, "position") || "") || /left|right/.test(css.computed(e, "float") || ""));
    if (!boxy && !/flex|grid/.test(css.computed(p, "display") || "")) return; // plain inline spans keep the bidi order of the text
    if (/flex/.test(css.computed(p, "display") || "") && /reverse/.test(css.computed(p, "flex-direction") || "")) return; // row-reverse rows: HZ22
    const dir = dirOf(p);
    if (dir === "rtl") return;
    letterParents.add(p);
    const d = css.declared(p, "direction");
    const set = css.declaringAncestor(p, "direction");
    add(ctx, "HZ23", {
      el: p, count: kids.length,
      message: {
        en: `${kids.length} ${short} boxes of "${textOf(p).replace(/[\u200c\u200d]/g, "").trim().slice(0, 40)}" are laid out ${dir}${set ? ` (direction set on ${cssPath(set)})` : " (no RTL direction on their parent)"}: boxes line up in their parent's direction, so the first ${short} lands on the left and the text reads backwards. Fix: dir="rtl" on the ${short} container.`,
        ar: `${kids.length} صندوقاً لـ«${textOf(p).replace(/[\u200c\u200d]/g, "").trim().slice(0, 40)}» مرتّبة من اليسار: الصناديق تتبع اتجاه العنصر الأب، فيقع الأول على اليسار وتُقرأ معكوسة. الإصلاح: dir="rtl" على الحاوية.`,
      },
      apply: () => {
        p.attribs.dir = "rtl";
        if (d && d.from !== "attr") p.attribs.style = setInline(p.attribs.style, "direction", "rtl", d.rule?.decls.some((x) => x.prop === "direction" && x.important));
      },
    });
    handled.add(blockOf(p)); handled.add(p);
  });

  // HZ23 (b): scripts placing letters by left offset ascending (left = i * w, x: i * 40, translateX(i * w))
  const docArabic = arTexts.length > 0 || ctx.scripts.some((s) => hasArabic(s.text));
  if (docArabic) for (const sc of ctx.scripts) {
    if (/^\s*!function|webpackChunk|__webpack_require__/.test(sc.text.slice(0, 400)) && !hasArabic(sc.text)) continue;
    for (const m of sc.text.matchAll(/\b(left|x|translateX|insetInlineStart)\b\s*(?:[:=]|\()\s*[`'"]?\$?\{?\s*\(?\s*(?:\(\s*\w+\s*\)\s*=>\s*)?(i|j|k|idx|index|n|ci|li)\s*\*\s*[\w.$()]+/g)) {
      const near = sc.text.slice(Math.max(0, m.index! - 250), m.index! + m[0].length + 250);
      if (/\bright\b|rtl|\b(?:width|W|w|total|len|length)\s*-\s*|-\s*\(?\s*(?:i|j|k|idx|index|n)\b|\(\s*\w+\s*-\s*1\s*-|reverse\(|-\s*\w+\s*\*\s*(?:i|j|k|idx|index)\b/.test(near)) continue;
      if (!/split|chars|letters|graphemes|Segmenter|\.\.\.\w+|\[\.\.\./.test(near) && !/char|letter|glyph/i.test(near)) continue;
      const line = sc.text.slice(0, m.index!).split("\n").length;
      add(ctx, "HZ23", {
        el: sc.el, severity: "warning", fixable: false,
        message: {
          en: `Script positions letters by ${m[1]} = ${m[2]} × width (script line ${line}: "${m[0].trim().slice(0, 50)}"): letter 0 lands on the left, so Arabic reads backwards. Position from the right (right / inset-inline-end, x = -${m[2]} × w, or (n - 1 - ${m[2]}) × w).`,
          ar: `السكربت يضع الحروف بـ ${m[1]} = ${m[2]} × العرض (السطر ${line}): الحرف الأول على اليسار فتُقرأ العربية معكوسة. ضعها من اليمين (right أو x = -${m[2]} × العرض).`,
        },
      });
      break;
    }
  }

  // HZ21: Arabic runs inside an LTR / code / terminal box without isolation
  const hz21: { t: Text; sev: Severity }[] = [];
  for (const t of arTexts) {
    const p = t.parent as Element;
    if (!p || p.type !== "tag" || SKIP.has(p.name) || suppressedAt(ctx, t, "HZ21") || !ARABIC_LETTER_RE.test(t.data) || /\{\{|\$\{|<%/.test(t.data)) continue;
    if (letterParents.has(p) || letterParents.has(p.parent as Element)) continue;
    const block = blockOf(p);
    let iso = false, code = false;
    for (let e: Element | null = p; e && e.type === "tag"; e = e.parent as Element | null) {
      if (isolates(ctx, e) && e !== block) { iso = true; break; }
      if (codeish(e)) code = true;
      if (e === block) { if (isolates(ctx, e) && dirOf(e) === "rtl") iso = true; break; }
    }
    if (!code) for (let e = block.parent as Element | null; e && e.type === "tag" && e.name !== "body"; e = e.parent as Element | null) if (codeish(e)) { code = true; break; }
    if (iso || dirOf(p) === "rtl") continue;
    const explicit = !!css.declaringAncestor(p, "direction");
    if (majority(block) && !code) continue; // an Arabic block that is LTR: HZ03 sets its direction
    if (!explicit && !code && !rtlDoc) continue; // an English page quoting an Arabic word
    const outside = t.data.replace(AR_RUN, "").trim();
    const runsIn = t.data.match(AR_RUN) ?? [];
    // one Arabic word can't reorder; a conjunction/preposition glued to Latin ("Image وPicture") is part of the LTR phrase
    if (outside && runsIn.length === 1 && graphemes(runsIn[0].trim()).length <= 2) continue;
    const risky = /[0-9\u0660-\u0669().,!?%-]/.test(runsIn.join("")) || (!!outside && runsIn.some((r) => /\S\s+\S/.test(r.trim())));
    hz21.push({ t, sev: risky ? "warning" : "info" });
    if (code) handled.add(block); // isolate, don't flip: HZ03 stays out of code/terminal boxes
  }
  if (hz21.length) {
    const sample = hz21[0].t.data.trim().slice(0, 50);
    const box = (hz21[0].t.parent as Element);
    add(ctx, "HZ21", {
      el: box, count: hz21.length, severity: hz21.some((x) => x.sev === "warning") ? "warning" : "info",
      message: {
        en: `${hz21.length} Arabic run(s) inside left-to-right boxes (terminal, code or Latin UI) without isolation, e.g. "${sample}" in ${cssPath(blockOf(box))}. Digits, punctuation and Latin next to the run can reorder it and a wrap can split it. Fix: wrap each Arabic run in <bdi dir="rtl">.`,
        ar: `${hz21.length} نص عربي داخل صناديق من اليسار لليمين (طرفية أو كود أو واجهة لاتينية) بدون عزل، مثل "${sample}". قد تعيد الأرقام والرموز ترتيبه وقد ينقسم عند الالتفاف. الإصلاح: وضع كل نص عربي داخل <bdi dir="rtl">.`,
      },
      apply: () => {
        for (const { t } of hz21) {
          if (!t.parent) continue;
          let out = "", last = 0;
          for (const m of t.data.matchAll(AR_RUN)) { out += esc(t.data.slice(last, m.index!)) + `<bdi dir="rtl">${esc(m[0])}</bdi>`; last = m.index! + m[0].length; }
          out += esc(t.data.slice(last));
          if (/flex|grid/.test((css.computed(t.parent as Element, "display") || "").toLowerCase())) out = `<span>${out}</span>`;
          $(t).replaceWith(out);
        }
      },
    });
  }

  // HZ22: rows of Arabic items laid out LTR (explicit direction:ltr, or row-reverse in RTL), and Latin lists inside RTL text
  $("*").each((_, re) => {
    const r = re as Element;
    if (SKIP.has(r.name) || suppressedAt(ctx, r, "HZ22")) return;
    const disp = (css.computed(r, "display") || "").toLowerCase();
    if (!/flex|grid/.test(disp)) return;
    const fd = (css.computed(r, "flex-direction") || "row").toLowerCase();
    if (/column/.test(fd)) return;
    if (disp.includes("grid")) { const cols = (css.computed(r, "grid-template-columns") || "").trim(); if (!cols || (!/repeat\(\s*([2-9]|\d\d|auto)/.test(cols) && cols.split(/\s+(?![^(]*\))/).length < 2)) return; }
    const kids = (r.children.filter((c) => c.type === "tag") as Element[]).filter((k) => textOf(k).trim());
    if (kids.length < 2 || letterParents.has(r)) return;
    const texts = kids.map((k) => textOf(k).trim());
    const firstStrong = texts[0].match(/[A-Za-z\u0590-\u08FF]/)?.[0];
    const arItems = texts.filter((x) => ARABIC_LETTER_RE.test(x)).length;
    // the first item decides the reading start (a label + Latin chips is still an Arabic row); otherwise most items must be Arabic
    if (!firstStrong || !ARABIC_LETTER_RE.test(firstStrong) || (arItems < Math.ceil(kids.length / 2) && !ARABIC_LETTER_RE.test(texts[0].slice(0, 3)))) return;
    const parent = r.parent as Element | null;
    const ctxRtl = rtlDoc || (parent && parent.type === "tag" && dirOf(parent) === "rtl");
    if (!ctxRtl) return;
    const dir = dirOf(r);
    const rev = fd === "row-reverse";
    const d = css.declared(r, "direction");
    let msg: { en: string; ar: string } | null = null, sev: Severity = "warning", apply: (() => void) | undefined;
    const label = `"${texts[0].slice(0, 24)}" + ${kids.length - 1} more`;
    // a scrolling marquee/ticker: its LTR direction is usually part of the translateX loop maths, so report without auto-fixing
    let marquee = /tick|marquee|scroller|crawl|loop/i.test((r.attribs.class || "") + " " + Object.keys(r.attribs).join(" ")) || /transform/.test(css.computed(r, "will-change") || "") || !!css.declared(r, "animation") || !!css.declared(r, "animation-name");
    for (let e: Element | null = r; e && e.type === "tag" && !marquee; e = e.parent as Element | null) if (e.attribs["aria-hidden"] === "true") marquee = true;
    if (dir !== "rtl" && !rev && marquee) {
      sev = "info";
      msg = { en: `Scrolling row ${label} runs left-to-right (direction: ${dir}): the first Arabic item enters on the left. Usually deliberate for the scroll maths; if it should read right-to-left, flip the direction together with the scroll offset.`, ar: `شريط متحرك ${label} مرتّب من اليسار لليمين: العنصر العربي الأول يظهر على اليسار. غالباً مقصود لحساب الحركة؛ إن أردته من اليمين فاعكس الاتجاه مع إزاحة الحركة.` };
    } else if (dir !== "rtl" && !rev) {
      msg = { en: `Row of Arabic items ${label} has direction: ${dir}${d ? ` (${d.from === "attr" ? "dir attribute" : "CSS"})` : ""}: the first item renders on the left. Fix: let it follow the page direction (dir="rtl").`, ar: `صف عناصر عربية ${label} اتجاهه ${dir}: العنصر الأول على اليسار. الإصلاح: اتركه يتبع اتجاه الصفحة (dir="rtl").` };
      apply = () => { r.attribs.dir = "rtl"; if (d && d.from !== "attr") r.attribs.style = setInline(r.attribs.style, "direction", "rtl", d.rule?.decls.some((x) => x.prop === "direction" && x.important)); };
    } else if (dir === "rtl" && rev) {
      msg = { en: `Row of Arabic items ${label} uses flex-direction: row-reverse inside RTL: the reversal undoes the RTL order and the first item renders on the left. Fix: flex-direction: row.`, ar: `صف عناصر عربية ${label} يستخدم row-reverse داخل اتجاه من اليمين: العكس يلغي الترتيب الصحيح فيقع الأول على اليسار. الإصلاح: flex-direction: row.` };
      apply = () => { r.attribs.style = setInline(r.attribs.style, "flex-direction", "row"); };
    } else if (dir !== "rtl" && rev) {
      sev = "info";
      msg = { en: `Row of Arabic items ${label} fakes RTL with direction: ltr + row-reverse. It looks right, but keyboard/screen-reader order is reversed and it breaks when the page direction changes. Fix: dir="rtl" + flex-direction: row.`, ar: `صف عناصر عربية ${label} يحاكي الاتجاه من اليمين بـ ltr مع row-reverse: الشكل صحيح لكن ترتيب لوحة المفاتيح وقارئ الشاشة معكوس. الإصلاح: dir="rtl" مع flex-direction: row.` };
      apply = () => { r.attribs.dir = "rtl"; r.attribs.style = setInline(setInline(r.attribs.style, "direction", "rtl"), "flex-direction", "row"); };
    }
    if (msg) add(ctx, "HZ22", { el: r, severity: sev, count: kids.length, message: msg, apply });
    if (msg && dir !== "rtl") handled.add(r); // same fix as HZ03 (dir="rtl"): one finding
  });
  // a Latin list (HTML · GSAP · Remotion) inside RTL text: the items fuse into one LTR run, first item on the left
  for (const t of arTexts) {
    const p = t.parent as Element;
    if (!p || suppressedAt(ctx, t, "HZ22") || dirOf(p) !== "rtl" || !LIST_SEP.test(t.data)) continue;
    // Latin tokens that touch a list separator, chained: "… V8 / V6 / Electric", "HTML · GSAP · Remotion"
    const tokRe = /[A-Za-z][\w.+#-]*(?:\s[A-Za-z][\w.+#-]*)?/g;
    const toks = [...t.data.matchAll(tokRe)].map((m) => ({ w: m[0], a: m.index!, b: m.index! + m[0].length }));
    const chained = new Set<string>();
    // a slash separates items only when spaced: a path (src/pages) is not a list
    for (let i = 0; i + 1 < toks.length; i++) if (/^\s*[·•|،]\s*$|^\s+\/\s+$/.test(t.data.slice(toks[i].b, toks[i + 1].a))) { chained.add(toks[i].w); chained.add(toks[i + 1].w); }
    const latinItems = toks.map((x) => x.w).filter((w) => chained.has(w));
    const adjacent = latinItems.length >= 2;
    const items = t.data.split(/\s*[·•|\/،]\s*/);
    if (!adjacent || !items.some((x) => ARABIC_LETTER_RE.test(x))) continue;
    add(ctx, "HZ22", {
      el: p, count: latinItems.length,
      message: {
        en: `The Latin items of the list "${t.data.trim().slice(0, 60)}" fuse into one left-to-right run inside RTL text, so the first of them (${latinItems[0]}) renders on the left. Fix: isolate each item (<bdi>), so the list follows the RTL order.`,
        ar: `العناصر اللاتينية في القائمة «${t.data.trim().slice(0, 60)}» تندمج في مقطع واحد من اليسار لليمين، فيقع أولها (${latinItems[0]}) على اليسار. الإصلاح: عزل كل عنصر داخل <bdi>.`,
      },
      apply: () => {
        if (!t.parent) return;
        const re = /[A-Za-z][\w.+#-]*(?:\s[A-Za-z][\w.+#-]*)?/g;
        $(t).replaceWith(esc(t.data).replace(re, (w) => (latinItems.includes(w) ? `<bdi>${w}</bdi>` : w)));
      },
    });
  }
  return handled;
}

/** ---------------- checks ---------------- */

function checkSplits(ctx: Ctx) {
  const { $, css } = ctx;
  const animated = ctx.scripts.some((s) => ANIM_LIB.test(s.text)) || $("script[src]").toArray().some((s) => ANIM_LIB.test((s as Element).attribs.src || ""));
  $("*").each((_, pe) => {
    const p = pe as Element;
    if (SKIP.has(p.name)) return;
    const kids = p.children;
    const parts: { el?: Element; text: string; sep?: boolean }[] = [];
    let leaf = 0, single = 0, arabic = 0;
    for (const n of kids) {
      if (n.type === "text") { if (/^[\s\u00A0]*$/.test((n as Text).data)) { if ((n as Text).data.length) parts.push({ text: " ", sep: true }); continue; } return; }
      if (n.type !== "tag") continue;
      const e = n as Element;
      if (e.name === "br") { parts.push({ text: " ", sep: true }); continue; }
      if (e.children.some((c) => c.type === "tag")) return;
      leaf++;
      const t = textOf(e);
      if (/^[\s\u00A0]*$/.test(t)) { parts.push({ el: e, text: t, sep: true }); continue; }
      const g = graphemes(t.replace(/\u200D/g, "")).length;
      if (g <= 2) single++;
      if (hasArabicLetter(t)) arabic++;
      parts.push({ el: e, text: t });
    }
    if (leaf < 3 || arabic < 2 || single / leaf < 0.6) return;
    const letterEls = parts.filter((x) => x.el && !x.sep).map((x) => x.el!);
    const want = desiredZwj(parts);
    if (parts.every((x, i) => x.sep || !x.el || want[i] === x.text)) return; // already correctly ZWJ-padded
    const already = letterEls.some((e) => /\u200D/.test(textOf(e)));
    const pDisp = css.computed(p, "display") || "";
    const boxy = letterEls.some((e) => BOXY.test(css.computed(e, "display") || "") || !!css.declared(e, "transform"));
    const risky = boxy || /flex|grid/.test(pDisp) || animated;
    const strategy = ctx.opts.split;
    add(ctx, "HZ01", {
      el: p, severity: risky ? "error" : "warning", count: letterEls.length,
      message: {
        en: `${letterEls.length} per-letter elements over Arabic text "${textOf(p).trim().slice(0, 40)}"${boxy ? " (inline-block/transform boxes)" : risky ? " (animated / flex children)" : ""}${already ? " — already partly ZWJ-padded" : ""}. Fix: ${strategy === "zwj" ? "pad each letter with ZWJ (keeps per-letter animation)" : "merge into per-word boxes"}.`,
        ar: `${letterEls.length} عنصراً لحروف منفصلة في النص "${textOf(p).trim().slice(0, 40)}"${boxy ? " (صناديق inline-block/transform)" : ""}. الإصلاح: ${strategy === "zwj" ? "إضافة واصل صفري ZWJ لكل حرف مع الإبقاء على حركة الحروف" : "دمج الحروف في كلمات"}.`,
      },
      apply: () => fixSplit(ctx, parts, strategy),
    });
  });
}

function fixSplit(ctx: Ctx, parts: { el?: Element; text: string; sep?: boolean }[], strategy: "zwj" | "word") {
  const $ = ctx.$;
  const setText = (e: Element, t: string) => $(e).text(t);
  if (strategy === "word") {
    const words = groupIntoWords(parts.map((p) => (p.sep ? " " : p.text.replace(/\u200D/g, ""))));
    for (const w of words) {
      const els = parts.slice(w.start, w.end + 1).map((p) => p.el!).filter(Boolean);
      if (els.length < 2) continue;
      setText(els[0], w.text);
      if (!/white-space/.test(els[0].attribs.style || "")) els[0].attribs.style = setInline(els[0].attribs.style, "white-space", "nowrap");
      for (const e of els.slice(1)) $(e).remove();
    }
    return;
  }
  const desired = desiredZwj(parts);
  parts.forEach((p, i) => { if (p.el && !p.sep && desired[i] !== undefined) setText(p.el, desired[i]!); });
}

/** Target texts for ZWJ strategy (undefined for separators). Pure: used for fixing and for "already fixed" detection. */
function desiredZwj(parts: { el?: Element; text: string; sep?: boolean }[]): (string | undefined)[] {
  const out: (string | undefined)[] = parts.map(() => undefined);
  let run: { i: number; text: string }[] = [];
  const flush = () => {
    if (!run.length) return;
    for (let k = 0; k < run.length - 1; k++) {
      if (run[k].text && run[k + 1].text && isLamAlefBoundary(run[k].text, run[k + 1].text) && graphemes(run[k + 1].text).length === 1) {
        run[k].text = run[k].text + run[k + 1].text;
        run[k + 1].text = "";
      }
    }
    const live = run.filter((r) => r.text);
    const padded = zwjPad(live.map((r) => r.text));
    live.forEach((r, k) => (r.text = padded[k]));
    for (const r of run) out[r.i] = r.text;
    run = [];
  };
  parts.forEach((p, i) => {
    if (p.sep || !p.el) { flush(); return; }
    run.push({ i, text: p.text.replace(/\u200D/g, "") });
  });
  flush();
  return out;
}

const NOT_COLLECTION = String.raw`(?![\w$.]*(?:\.(?:children|childNodes|attributes|classList|options|rows|cells|files|elements|images|links|forms)\b|\b(?:document|window)\.|(?:[Ee]ls|[Nn]odes|[Ee]lements|[Ll]ist|[Ii]tems|[Aa]rr|[Ss]et|[Mm]ap)\b))`;
const SPLIT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bSplitText\b[\s\S]{0,200}?chars|\bSplitText\.create\s*\(/, label: "GSAP SplitText (chars)" },
  { re: /\bnew\s+SplitType\s*\(|\bSplitType\.create\s*\(/, label: "SplitType" },
  // Motion+ (motion.dev): `const { chars } = splitText("h1")`, or `splitText(el)` and later `.chars`. Lower-case s, so the GSAP pattern misses it
  { re: /\{[^}]*\bchars\b[^}]*\}\s*=\s*splitText\s*\(|\bsplitText\s*\([\s\S]{0,300}?\bchars\b/, label: "Motion splitText (chars)" },
  { re: /\bSplitting\s*\(/, label: "Splitting.js" },
  { re: /\.split\(\s*(['"`])\1\s*\)/, label: "str.split('')" },
  // [...x] / Array.from(x) on text, not on DOM collections or iterables (el.children, nodes, els, list, map.keys()…)
  { re: new RegExp(String.raw`\[\s*\.\.\.\s*${NOT_COLLECTION}[\w$.]+(?:\.(?:textContent|innerText|innerHTML))?\s*\]\s*(?:\.(?:map|forEach)|;|\))`), label: "[...str]" },
  { re: new RegExp(String.raw`Array\.from\(\s*${NOT_COLLECTION}[\w$.]+(?:\.(?:textContent|innerText))?\s*\)`), label: "Array.from(str)" },
  { re: /\.replace\(\s*\/(?:\\S|\.|\[\^\\s\])\/g\s*,\s*["'`]<span/, label: "regex letter-wrap (anime.js style)" },
];

/** `rtlExp.test(word) ? word : [...word].reverse().join("")`: a deliberate, script-guarded bidi reorder (GreenSock's splitRTLText) */
const GUARD = /\b\w*(?:rtl|arab|hebrew)\w*\s*\.test\([^)]*\)\s*\?\s*[\w.]+\s*:[^;]*$/i;
/** a script pre-reverses Latin words so they read correctly once split inside an RTL line */
function reordersLatin(ctx: Ctx) {
  return ctx.scripts.some((s) => [...s.text.matchAll(/\.reverse\(\)\s*\.join\(/g)].some((m) => GUARD.test(s.text.slice(Math.max(0, m.index! - 240), m.index))));
}

function checkScripts(ctx: Ctx, docArabic: boolean) {
  const { $ } = ctx;
  for (const s of ctx.scripts) {
    const ar = hasArabic(s.text);
    // an inlined, minified third-party bundle (MapLibre, three.js…) without Arabic in it: its array/DOM idioms aren't text splits
    if (!ar && s.text.length > 50000 && s.text.length / (s.text.split("\n").length || 1) > 1000) continue;
    const hits = SPLIT_PATTERNS.filter((p) => p.re.test(s.text)).map((p) => p.label);
    if ($("[data-splitting]").length && !hits.includes("Splitting.js")) hits.push("data-splitting");
    const shimmed = ctx.$('script[data-harakah="runtime"]').length > 0;
    // letters drawn on a canvas or as troika meshes: the DOM shim can't fix those, so don't claim HZ02 for them
    const draws = ar || docArabic ? letterDraws(s.text) : [];
    for (const d of draws) add(ctx, "HZ25", { el: s.el, severity: ar ? "error" : "warning", message: MESSAGES[d] });
    if (usesTextGeometry(s.text) && (ar || docArabic)) add(ctx, "HZ26", { el: s.el, severity: ar ? "error" : "warning", message: MESSAGES.geometry });
    if (troikaWithoutFont(s.text) && (ar || docArabic)) add(ctx, "HZ27", { el: s.el, message: MESSAGES.troikaFont });
    if (hits.length && (ar || docArabic) && !shimmed && (!draws.length || buildsDom(s.text))) {
      add(ctx, "HZ02", {
        el: s.el, severity: ar ? "error" : "warning",
        message: {
          en: `Runtime character splitting detected: ${hits.join(", ")}${ar ? " on Arabic string literals" : " (document contains Arabic)"}. Fix: inject Harakah runtime shim (ZWJ-pads letter boxes, keeps لا ligature, same elements so timelines still work).`,
          ar: `السكربت يقسّم النص إلى حروف أثناء التشغيل (${hits.join("، ")}). الإصلاح: نضيف سكربتاً صغيراً يضع واصلاً صفرياً (ZWJ) بين الحروف ويُبقي العناصر نفسها، فتبقى الحركة كما صمّمتها.`,
        },
        apply: () => { ctx.needShim = true; },
      });
    }
    // a reversal behind an RTL test (`rtlExp.test(word) ? word : [...word].reverse().join("")`) leaves Arabic alone
    const unguarded = [...s.text.matchAll(/\.reverse\(\)\s*\.join\(/g)].some((m) => !GUARD.test(s.text.slice(Math.max(0, m.index! - 240), m.index)));
    // building the string back to front in a character loop (`out.innerHTML = span + out.innerHTML`, prepend, insertBefore(…, firstChild))
    // is the same naive RTL "fix": the boxes end up in reverse logical order, so the joins point at the wrong neighbours
    const charLoop = /charAt\(|\.split\(\s*(['"`])\1\s*\)|\[\s*\.\.\.|Array\.from\(|for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s/.test(s.text);
    const near = (re: RegExp) => [...s.text.matchAll(re)].some((m) => /charAt\(|\.split\(\s*(['"`])\1\s*\)|\[\s*\.\.\.|Array\.from\(|\bfor\s*\(/.test(s.text.slice(Math.max(0, m.index! - 300), m.index! + 100)));
    const prepends = charLoop && (near(/\b([\w$.]+)\.innerHTML\s*=\s*[^;\n]+\+\s*\1\.innerHTML\b/g) || near(/\.prepend\(|\.insertBefore\([^,]+,\s*[\w$.]+\.firstChild\s*\)/g));
    if (prepends && (ar || docArabic)) {
      // scope the "don't flip direction" note to the containers that script writes to, when it names them
      const sels: string[] = [];
      for (const m of s.text.matchAll(/\b([\w$]+)\.innerHTML\s*=\s*[^;\n]+\+\s*\1\.innerHTML\b/g)) {
        const q = s.text.match(new RegExp(String.raw`\b${m[1].replace(/\$/g, "\\$")}\s*=\s*document\.(querySelector|getElementById)\(\s*['"]([^'"]+)['"]\s*\)`));
        if (q) sels.push(q[1] === "getElementById" ? `#${q[2]}` : q[2]); else sels.push("*");
      }
      if (!shimmed) ctx.needShim = true;
      if (!sels.length || sels.includes("*")) ctx.reversedSplit = true;
      else ctx.reversedSelectors = [...new Set([...(ctx.reversedSelectors ?? []), ...sels])];
      add(ctx, "HZ15", { el: s.el, message: { en: "Script builds the letters back to front (prepends each character), a manual RTL 'fix' that puts the letter boxes in reverse logical order, so Arabic joins point at the wrong neighbours. Append in reading order and set dir=\"rtl\" on the container instead.", ar: "السكربت يبني الحروف من الآخر إلى الأول (يضيف كل حرف في البداية)، وهذا عكس يدوي يجعل الحروف تتصل بالجار الخطأ. أضفها بترتيب القراءة وضع dir=\"rtl\" على الحاوية." } });
    }
    if (unguarded && (ar || docArabic)) {
      ctx.reversedSplit = true;
      add(ctx, "HZ15", { el: s.el, message: { en: "Script reverses a string (…reverse().join()) — a naive RTL 'fix' that scrambles Arabic. Remove it; the browser orders RTL text itself.", ar: "السكربت يعكس النص (reverse().join()) وهذا يفسد العربية. احذفه؛ المتصفح يرتب النص تلقائياً." } });
    }
    if (/\.(fillText|strokeText)\s*\(/.test(s.text) && !/\.direction\s*=\s*['"]rtl/.test(s.text) && (ar || docArabic)) {
      add(ctx, "HZ19", { el: s.el, message: { en: "Canvas fillText/strokeText used without ctx.direction = 'rtl'.", ar: "استخدام fillText على Canvas بدون ctx.direction = 'rtl'." } });
    }
    if (/letterSpacing\s*:/.test(s.text) && (ar || docArabic)) {
      add(ctx, "HZ07", { el: s.el, severity: "info", fixable: false, message: { en: "Script animates letterSpacing; on Arabic this breaks joins in many renderers. Animate scale/opacity instead.", ar: "السكربت يحرّك letterSpacing؛ على العربية هذا يقطع الحروف. استخدم scale أو opacity بدلاً منه." } });
    }
  }
}

const LOCALE_RE = /(toLocaleString|toLocaleDateString|toLocaleTimeString|NumberFormat|DateTimeFormat)\(\s*(?:[^,()]*,\s*)?(['"])(ar(?:-[A-Za-z]{2,4})?)\2/g;

const wantsChangeDigits = (found: Set<string>, target: string) => target !== "keep" && [...found].some((d) => d !== target);
function checkDigits(ctx: Ctx, arTexts: Text[]) {
  const target = ctx.opts.digits;
  const found = new Set<string>();
  const samples: string[] = [];
  const nodesWithDigits: Text[] = [];
  let badSep = false; // Eastern digits with Latin "," / "." separators
  for (const t of arTexts) {
    if (suppressedAt(ctx, t, "HZ12")) continue;
    const outside = tplMask(t.data).replace(latin(), "");
    const ds = digitScripts(outside);
    // Persian/Urdu text: ۰-۹ are its Eastern digits (Arabic-Indic ٠-٩ there are tolerated, not "mixed")
    if (scriptLang(t.data) !== "ar" && (ds.has("persian") || ds.has("eastern"))) { ds.delete("persian"); ds.add("eastern"); }
    if (target === "eastern" && /[\u0660-\u0669\u06F0-\u06F9][.,][\u0660-\u0669\u06F0-\u06F9]/.test(outside)) badSep = true;
    if (ds.size) { nodesWithDigits.push(t); ds.forEach((d) => found.add(d)); if (samples.length < 3) samples.push(t.data.trim().slice(0, 30)); }
  }
  const runtime: string[] = [];
  for (const s of ctx.scripts) for (const m of s.text.matchAll(LOCALE_RE)) {
    const loc = m[3];
    // CLDR: Maghreb + some locales default to latn; Egypt/Levant/Gulf default to arab digits in Chrome.
    if (!/^ar-(MA|DZ|TN|LY|EH)$/i.test(loc)) { runtime.push(loc); found.add("eastern"); }
  }
  if (!found.size) return;
  const mixed = found.size > 1;
  const wantsChange = (target !== "keep" && [...found].some((d) => d !== target)) || badSep;
  if (!mixed && !wantsChange) return;
  const list = [...found].join(" + ");
  add(ctx, "HZ12", {
    severity: mixed ? "warning" : "info", count: nodesWithDigits.length + runtime.length,
    where: samples.join(" | ") || runtime.join(", "),
    message: {
      en: `${mixed ? `Mixed digit systems: ${list}` : badSep && !wantsChangeDigits(found, target) ? `Latin separators in Eastern digits` : `Found ${list} digits, policy is ${target}`}${badSep ? " (use ٬ ٫ with ١٢٣, not , .)" : ""}${runtime.length ? ` (runtime Intl locale: ${[...new Set(runtime)].join(", ")})` : ""}. ${target === "keep" ? "Re-run with --digits eastern|western to normalize." : `Normalize to ${target === "eastern" ? "Eastern Arabic ١٢٣" : "Western 123"} (Latin runs like "iPhone 17" untouched).`}`,
      ar: `${mixed ? "خلط بين أنظمة الأرقام" : "الأرقام تخالف الإعداد المختار"}: ${list}. ${target === "keep" ? "أعد التشغيل مع --digits eastern أو western للتوحيد." : `التوحيد إلى ${target === "eastern" ? "الأرقام المشرقية ١٢٣" : "الأرقام الغربية 123"} (الكلمات اللاتينية مثل iPhone 17 لا تتغير).`}`,
    },
    fixable: target !== "keep",
    apply: target === "keep" ? undefined : () => {
      for (const t of nodesWithDigits) {
        const lang = scriptLang(t.data);
        t.data = runs(t.data).map((r) => (r.latin || r.tpl ? r.text : normalizeDigits(r.text, target, lang))).join("");
      }
      for (const s of ctx.scripts) {
        const nu = target === "eastern" ? "arab" : "latn";
        const replaced = s.text.replace(LOCALE_RE, (all, fn, q, loc) => all.replace(`${q}${loc}${q}`, `${q}${loc}-u-nu-${nu}${q}`));
        if (replaced !== s.text) { ctx.$(s.el).text(replaced); s.text = replaced; }
      }
    },
  });
}

// screen-reader-only text (`.sr-only`, `.visually-hidden`, `clip: rect(0 0 0 0)`) is never painted: visual rules skip it
const SR_CLASS = /(^|\s)(sr-only|visually-hidden|visuallyhidden|screen-reader-text|screen-reader-only|a11y-hidden|u-hidden-visually)(\s|$)/;
function srOnly(ctx: Ctx, el: AnyNode | null, memo: Map<AnyNode, boolean>): boolean {
  if (!el || el.type !== "tag") return false;
  const hit = memo.get(el);
  if (hit !== undefined) return hit;
  const e = el as Element;
  const clip = (ctx.css.computed(e, "clip") || "").replace(/\s+/g, "");
  const clipPath = (ctx.css.computed(e, "clip-path") || "").replace(/\s+/g, "");
  const own = SR_CLASS.test(e.attribs.class || "") || /^rect\(0(px)?[,]?0/.test(clip) || /^inset\(50%\)/.test(clipPath);
  const r = own || srOnly(ctx, e.parent, memo);
  memo.set(el, r);
  return r;
}

function checkText(ctx: Ctx) {
  const { $, css } = ctx;
  const srMemo = new Map<AnyNode, boolean>();
  const allText = textNodes($).filter((t) => !srOnly(ctx, t.parent, srMemo));
  const arTexts = allText.filter((t) => hasArabic(t.data));
  const docAll = allText.map((t) => t.data).join(" ");
  const arCount = countRe(docAll, ARABIC_LETTER_RE), laCount = countRe(docAll, /[A-Za-z]/);
  const arEls = [...new Set(arTexts.map((t) => t.parent as Element).filter((e) => e && e.type === "tag"))];
  const blocks = [...new Set(arEls.map(blockOf))];
  // a block of digits only (٧٥١٦ in an LTR number field) is not Arabic text: direction rules need Arabic letters
  const majority = (b: Element) => { const t = textOf(b); const n = countRe(t, ARABIC_LETTER_RE); return n > 0 && n >= countRe(t, /[A-Za-z]/); };
  const arBlocks = blocks.filter(majority);

  // HZ05 HyperFrames html dir
  const html = $("html")[0] as Element | undefined;
  if (ctx.isHF && html && (templateAttr(html.attribs.dir || "", "dir") || "").toLowerCase() === "rtl") {
    add(ctx, "HZ05", {
      el: html, message: { en: "<html dir=\"rtl\"> in a HyperFrames composition. Fix: move dir=\"rtl\" to the [data-composition-id] root.", ar: "<html dir=\"rtl\"> في مشروع HyperFrames. الإصلاح: نقل dir=\"rtl\" إلى جذر المشهد [data-composition-id]." },
      apply: () => { delete html.attribs.dir; $("[data-composition-id]").first().attr("dir", "rtl"); },
    });
  }

  // HZ21 / HZ22 / HZ23 layout order (blocks fully handled there are not re-reported by HZ03)
  const ordered = checkLayoutOrder(ctx, arTexts, majority);

  // HZ03 direction
  for (const b of arBlocks) {
    if (ordered.has(b)) continue;
    const dir = (css.computed(b, "direction") || "ltr").toLowerCase();
    let bad = dir !== "rtl";
    if (dir === "auto") {
      const firstStrong = textOf(b).match(/[A-Za-z\u0590-\u08FF]/);
      bad = !firstStrong || !ARABIC_LETTER_RE.test(firstStrong[0]);
    }
    if (!bad) continue;
    const d = css.declared(b, "direction");
    const explicit = css.declaringAncestor(b, "direction");
    add(ctx, "HZ03", {
      el: b, severity: explicit ? "error" : "warning",
      message: {
        en: `Arabic block resolves to direction "${dir}"${explicit ? ` (set on ${cssPath(explicit)})` : " (no dir anywhere)"}. Fix: dir="rtl"${d && d.from !== "attr" ? " + direction:rtl" : ""}.`,
        ar: `اتجاه هذا النص العربي "${dir}"${explicit ? " (محدد صراحة)" : " (لا يوجد dir)"}. الإصلاح: dir="rtl".`,
      },
      apply: () => {
        b.attribs.dir = "rtl";
        if (d && d.from !== "attr") b.attribs.style = setInline(b.attribs.style, "direction", "rtl", d.rule?.decls.some((x) => x.prop === "direction" && x.important));
      },
    });
  }

  // HZ04 lang
  if (arTexts.length) {
    // lang="fa" / "ur" / "ps"… are correct for Persian/Urdu/Pashto text and are never "fixed" to "ar"
    const hasArLang = (e: Element) => { let c: AnyNode | null = e; while (c && c.type === "tag") { const l = (c as Element).attribs.lang; if (l) { const r = templateAttr(l, "lang"); return r === undefined || ARABIC_SCRIPT_LANG_RE.test(r); } c = c.parent; } return false; };
    const docLang = scriptLang(docAll);
    if (ctx.isDoc && html && arCount >= laCount && arCount > 0) {
      const htmlLang = templateAttr(html.attribs.lang || "", "lang");
      if (htmlLang !== undefined && !ARABIC_SCRIPT_LANG_RE.test(htmlLang)) add(ctx, "HZ04", { el: html, message: { en: `<html lang="${html.attribs.lang || ""}"> but the composition is mostly ${docLang === "fa" ? "Persian" : docLang === "ur" ? "Urdu" : "Arabic"}. Fix: lang="${docLang}".`, ar: `<html lang="${html.attribs.lang || ""}"> بينما المحتوى عربي الحرف في معظمه. الإصلاح: lang="${docLang}".` }, apply: () => { html.attribs.lang = docLang; } });
    } else {
      const missing = arBlocks.filter((b) => !hasArLang(b));
      if (missing.length) add(ctx, "HZ04", { el: missing[0], count: missing.length, message: { en: `${missing.length} Arabic block(s) without an Arabic-script lang (ar/fa/ur…) ancestor. Fix: add lang on each.`, ar: `${missing.length} كتلة عربية بدون lang="ar". الإصلاح: إضافة lang="ar".` }, apply: () => missing.forEach((b) => (b.attribs.lang = scriptLang(textOf(b)))) });
    }
  }

  // HZ06 / HZ16 text-align
  for (const b of arBlocks) {
    const ta = (css.computed(b, "text-align", "ar") || "").toLowerCase();
    const tal = (css.computed(b, "text-align-last", "ar") || "").toLowerCase();
    if (ta === "left") add(ctx, "HZ06", { el: b, message: { en: "text-align:left on Arabic. Fix: text-align:start (follows dir=rtl).", ar: "محاذاة لليسار على نص عربي. الإصلاح: text-align:start." }, apply: () => { b.attribs.style = setInline(b.attribs.style, "text-align", "start"); } });
    if (ta === "justify" || tal === "justify") add(ctx, "HZ16", { el: b, message: { en: "Justified Arabic: Chrome stretches word gaps only (no kashida). Consider start/center, or manual tatweel for display titles.", ar: "نص عربي مضبوط: كروم يوسّع المسافات فقط بدون كشيدة. فكّر في المحاذاة لليمين/الوسط أو كشيدة يدوية للعناوين." } });
  }

  // per-element inherited style checks (dedupe by declaring element)
  const perEl = (code: string, prop: string, bad: (v: string) => boolean, fixVal: string | null, msg: (v: string, n: number, w: string) => { en: string; ar: string }) => {
    const groups = new Map<Element, { els: Element[]; v: string; important: boolean; rtl?: string; pending?: { sel: string; v: string } }>();
    for (const e of arEls) {
      // Arabic mode: the project's own RTL rules (`html[dir=rtl] .label`, `:lang(ar)`, `:dir(rtl)`) apply to Arabic text
      const v = (css.computed(e, prop, "ar") || "").trim();
      if (!v || !bad(v.toLowerCase())) continue;
      const decl = css.declaringAncestor(e, prop, "ar") || e;
      // an <html>-anchored RTL override that never applies here because nothing makes <html> RTL
      const vPlus = (css.computed(e, prop, "ar+") || "").trim();
      const pending = vPlus !== v ? { sel: css.rtlSource(e, prop, "ar+") ?? "", v: vPlus } : undefined;
      const g = groups.get(decl) ?? { els: [], v, important: !!css.declared(decl, prop, "ar")?.rule?.decls.some((d) => d.prop === prop && d.important), rtl: css.rtlSource(e, prop, "ar"), pending };
      g.els.push(e);
      groups.set(decl, g);
    }
    for (const [decl, g] of groups) {
      let message = msg(g.v, g.els.length, cssPath(decl));
      if (g.rtl) message = { en: `${message.en} (This is the project's own RTL value, from \`${g.rtl}\`: softer, but still not 0.)`, ar: `${message.ar} (هذه قيمة المشروع للعربية من \`${g.rtl}\`: أخف لكنها ليست صفراً.)` };
      else if (g.pending) message = { en: `${message.en} (The project's \`${g.pending.sel}\` sets ${g.pending.v}, but only once <html> is RTL, and nothing here makes it so.)`, ar: `${message.ar} (قاعدة المشروع \`${g.pending.sel}\` تضبطها على ${g.pending.v} لكن فقط عندما يكون <html> باتجاه rtl، ولا شيء هنا يفعل ذلك.)` };
      // a HyperFrames composition renders in Chromium 137+, which keeps Arabic letters joined under letter-spacing
      const video = code === "HZ07" && ctx.isHF;
      if (video) message = { en: `${message.en} ${VIDEO_TRACKING.en}`, ar: `${message.ar} ${VIDEO_TRACKING.ar}` };
      add(ctx, code, {
        el: decl, count: g.els.length, message, severity: video ? "info" : undefined,
        apply: fixVal === null ? undefined : () => g.els.forEach((e) => {
          e.attribs.style = setInline(e.attribs.style, prop, fixVal, g.important);
          // template patches: which element declared the value (a page-level rule is fixed once in CSS, not per element)
          if (ctx.opts.markDecl) e.attribs[`data-hz-decl-${prop}`] = decl.attribs["data-hz-at"] ?? decl.name;
        }),
      });
    }
  };
  perEl("HZ07", "letter-spacing", (v) => !/^(?:normal|initial|unset|revert|[-+]?(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?)$/.test(v), "0",
    (v, n, w) => ({ en: `letter-spacing: ${v} applies to ${n} Arabic element(s) (declared on ${w}). Fix: letter-spacing:0 on the Arabic elements.`, ar: `تباعد الحروف ${v} على ${n} عنصر عربي. الإصلاح: letter-spacing:0.` }));
  perEl("HZ08", "text-transform", (v) => v !== "none" && v !== "initial", "none",
    (v, n) => ({ en: `text-transform: ${v} on ${n} Arabic element(s). Fix: text-transform:none.`, ar: `text-transform: ${v} على ${n} عنصر عربي. الإصلاح: none.` }));
  perEl("HZ08", "font-variant", (v) => /small-caps|all-small-caps/.test(v), "normal",
    (v, n) => ({ en: `font-variant: ${v} on ${n} Arabic element(s). Fix: normal.`, ar: `font-variant: ${v} على ${n} عنصر عربي.` }));
  perEl("HZ18", "word-break", (v) => v === "break-all", "normal",
    (v, n) => ({ en: `word-break: break-all on ${n} Arabic element(s). Fix: word-break:normal.`, ar: `word-break: break-all على ${n} عنصر عربي. الإصلاح: normal.` }));
  perEl("HZ20", "font-style", (v) => /italic|oblique/.test(v), null,
    (v, n) => ({ en: `font-style: ${v} on ${n} Arabic element(s). Use weight/color for emphasis instead.`, ar: `خط مائل على ${n} عنصر عربي. استخدم الوزن أو اللون للتأكيد.` }));

  // HZ17 line-height / clipping
  for (const b of arBlocks) {
    const lh = (css.computed(b, "line-height") || "").trim();
    if (!lh || lh === "normal") continue;
    const fsz = fontSizePx(ctx, b);
    let ratio: number | undefined;
    if (/^[\d.]+$/.test(lh)) ratio = parseFloat(lh);
    else { const px = toPx(lh, fsz); if (px !== undefined) ratio = px / fsz; }
    if (ratio === undefined) continue;
    const level = tashkeelLevel(textOf(b));
    const tash = level !== "none";
    const overflowHidden = [b, b.parent as Element].some((e) => e && e.type === "tag" && /hidden|clip/.test(css.declared(e, "overflow")?.value || css.declared(e, "overflow-y")?.value || ""));
    const fixedH = !!css.declared(b, "height") && !/auto/.test(css.declared(b, "height")!.value);
    // one line can't collide with a line above: `nowrap`, or a flex row (no wrap) of single-word items
    const disp = css.computed(b, "display") || "";
    const kids = (b.children || []).filter((k) => k.type === "tag" || (k.type === "text" && (k as any).data.trim()));
    const singleLine = /nowrap|pre\b/.test(css.computed(b, "white-space") || "") ||
      (/flex/.test(disp) && !/column/.test(css.computed(b, "flex-direction") || "") && !/^wrap/.test(css.computed(b, "flex-wrap") || "") &&
        kids.length > 0 && kids.every((k) => !/\s/.test((k.type === "text" ? (k as any).data : textOf(k as Element)).trim())));
    let sev: Severity | null = null;
    let target = tash ? "1.8" : "1.4";
    if (tash && ratio < 1.6 && (level === "dense" || overflowHidden || fixedH)) sev = "warning";
    else if (level === "sparse" && ratio < 1.3 && !singleLine) { sev = "warning"; target = "1.5"; }
    else if (ratio < 1.15 && (overflowHidden || fixedH)) { sev = "warning"; target = "1.4"; }
    else if (ratio < 1.0) sev = "info";
    if (!sev) continue;
    add(ctx, "HZ17", {
      el: b, severity: sev,
      message: {
        en: `line-height ≈ ${ratio.toFixed(2)}× font-size${level === "dense" ? " with full tashkeel" : tash ? " with diacritics" : ""}${overflowHidden ? " inside overflow:hidden" : ""}${fixedH ? " with fixed height" : ""}. ${sev === "warning" ? `Fix: line-height:${target}.` : "Check ascenders/descenders."}${fixedH && overflowHidden ? " Also review the fixed height of the mask." : ""}`,
        ar: `ارتفاع السطر ≈ ${ratio.toFixed(2)} من حجم الخط${tash ? " مع حركات" : ""}${overflowHidden ? " داخل overflow:hidden" : ""}. ${sev === "warning" ? `الإصلاح: line-height:${target}.` : "تحقق من أطراف الحروف."}`,
      },
      apply: sev === "warning" ? () => { b.attribs.style = setInline(b.attribs.style, "line-height", target); } : undefined,
    });
  }

  // Fonts HZ09 / HZ10 / HZ11
  // Google/Bunny Fonts by <link> or by CSS `@import url("https://fonts.googleapis.com/css?family=Amiri")`
  const importedFonts = [...$("style").text().matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s]*fonts\.(?:googleapis\.com|bunny\.net)[^"')\s]*)/gi)].map((m) => m[1]);
  const googleLinks = [...$("link[href*='fonts.googleapis.com'], link[href*='fonts.bunny.net']").toArray().map((l) => (l as Element).attribs.href || ""), ...importedFonts]
    .map((h) => decodeURIComponent(h).replace(/\+/g, " ").toLowerCase());
  const allLinks = $("link[href]").toArray().map((l) => ((l as Element).attribs.href || "").toLowerCase());
  const fontGroups = new Map<string, { target: Element; stack: string; els: Element[] }>();
  for (const e of arEls) {
    const stack = css.computed(e, "font-family") || "";
    const target = css.declaringAncestor(e, "font-family") || blockOf(e);
    const key = `${stack}@@${cssPath(target)}`;
    const g = fontGroups.get(key) ?? { target, stack, els: [] };
    g.els.push(e);
    fontGroups.set(key, g);
  }
  const ofl = BUNDLED[ctx.opts.font];
  const reportedFace = new Set<string>();
  const licenseSeen = new Map<string, any[]>();
  // real glyph coverage for families with @font-face files we can read (cmap + GSUB): the file beats the name
  const coverageOf = new Map<string, FamilyCoverage | null>();
  const famCoverage = (f: string) => {
    if (!coverageOf.has(f)) coverageOf.set(f, familyCoverage(css.fontFaces.filter((ff) => norm(ff.family) === f)));
    return coverageOf.get(f);
  };
  for (const g of fontGroups.values()) {
    const fams = parseStack(g.stack);
    const disp = g.stack.split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    const text = g.els.map((e) => $(e).text()).join(" ");
    const classes = fams.map((f) => verifiedClass(classify(f), famCoverage(f), text));
    if (!classes.some(arabicCapable)) {
      const sev: Severity = classes.some((c) => c === "unknown") ? "info" : "warning";
      const checked = fams.filter((_, i) => classes[i] === "no-arabic").map((f) => describeCoverage(famCoverage(f)!.cov, text));
      const why = checked.length ? ` (checked the font file: ${checked.join("; ")})` : sev === "info" ? " (unknown family — make sure it has Arabic glyphs)" : "";
      const whyAr = checked.length ? " (فحصنا ملف الخط نفسه: لا يغطي الحروف العربية أو لا يصلها)" : "";
      add(ctx, "HZ09", {
        el: g.target, severity: sev, count: g.els.length,
        message: {
          en: `font-family "${g.stack || "(browser default)"}" has no ${checked.length ? "" : "known "}Arabic font${why}. Fix: add '${ofl.family}' (OFL) as Arabic fallback after the Latin font.`,
          ar: `الخطوط "${g.stack || "(افتراضي المتصفح)"}" لا تحتوي خطاً عربياً معروفاً${whyAr}. الإصلاح: إضافة '${ofl.family}' (رخصة OFL) كخط بديل للعربية.`,
        },
        apply: () => {
          const raw = g.stack ? g.stack.split(",").map((x) => x.trim()) : [];
          const gi = raw.findIndex((f) => classify(f) === "generic");
          const ins = `'${ofl.family}'`;
          if (gi >= 0) raw.splice(gi, 0, ins); else raw.push(ins, "sans-serif");
          g.target.attribs.style = setInline(g.target.attribs.style, "font-family", raw.join(", "));
          ctx.needFonts.add(ofl.key);
        },
      });
    }
    // licensing: one issue per font family (not per element), fixes applied to every element using it
    fams.forEach((f) => {
      const c = classify(f); // licensing goes by the name, whatever the file covers
      if (c !== "thmanyah" && c !== "commercial") return;
      const seen = licenseSeen.get(f);
      if (seen) { seen.push(g); return; }
      const groups = [g];
      licenseSeen.set(f, groups);
      const face = css.fontFaces.find((ff) => norm(ff.family) === f);
      const srcUrl = face?.src ?? "";
      // remote = served from the web (http(s), protocol-relative, a font CDN link); file = a font file inside the project
      const remote = /url\(\s*['"]?(https?:|\/\/)/i.test(srcUrl) || allLinks.some((h) => h.includes(f.replace(/\s+/g, "")) || h.includes(f.replace(/\s+/g, "-")));
      const file = !remote && /url\(\s*['"]?(?!data:)/i.test(srcUrl) && !/^\s*local\(/i.test(srcUrl.split(",")[0]);
      const embedded = /url\(\s*['"]?data:/i.test(srcUrl);
      const repl = ctx.opts.replaceProprietary ? () => {
        for (const gg of groups) {
          const raw = gg.stack.split(",").map((x) => x.trim()).map((x) => (norm(x) === f ? `'${ofl.family}'` : x));
          gg.target.attribs.style = setInline(gg.target.attribs.style, "font-family", raw.join(", "));
        }
        ctx.needFonts.add(ofl.key);
      } : undefined;
      if (c === "thmanyah") {
        add(ctx, "HZ10", {
          el: g.target, severity: remote || embedded ? "error" : "warning", count: 1,
          message: {
            en: `Thmanyah font "${f}"${remote ? " is loaded from a web URL (hosting/redistribution is prohibited by its license)" : embedded ? " is embedded as data: (embedding is prohibited)" : file ? " is loaded from a font file in the project: fine for local renders, but never commit, upload or share that file (its license prohibits redistribution)" : ""}. Use it for LOCAL renders only (src: local('Thmanyah Sans')); for hosted/cloud renders swap to an OFL font (--replace-proprietary).`,
            ar: `خط ثمانية "${f}"${remote ? " يُحمَّل من رابط على الويب (الترخيص يمنع الاستضافة وإعادة التوزيع)" : embedded ? " مضمّن كبيانات (التضمين ممنوع)" : file ? " يُحمَّل من ملف داخل المشروع: لا بأس في الرندر المحلي، لكن لا ترفع الملف ولا تشاركه (الترخيص يمنع إعادة التوزيع)" : ""}. استخدمه في الرندر المحلي فقط؛ للرندر السحابي استبدله بخط OFL (--replace-proprietary).`,
          },
          fixable: !!repl, apply: repl,
        });
      } else {
        add(ctx, "HZ10", { el: g.target, severity: "info", message: { en: `"${f}" is a commercial Arabic font: confirm your license covers video rendering and (if hosted) web embedding.`, ar: `"${f}" خط تجاري: تأكد أن ترخيصك يشمل الفيديو والاستضافة على الويب.` }, fixable: !!repl, apply: repl });
      }
    });
    // missing @font-face for first Arabic-capable non-system family
    const idx = classes.findIndex(arabicCapable);
    if (idx >= 0 && classes[idx] !== "system") {
      const f = fams[idx];
      const fd = disp[idx] || f;
      const hasFace = css.fontFaces.some((ff) => norm(ff.family) === f) || googleLinks.some((h) => h.includes(`family=${f}`) || h.includes(`|${f}`) || h.includes(`family=${f.replace(/ /g, "+")}`));
      if (!hasFace && !reportedFace.has(f)) {
        reportedFace.add(f);
        const b = bundledByFamily(f);
        add(ctx, "HZ11", {
          el: g.target, severity: b ? "warning" : "info",
          message: {
            en: `"${fd}" is used without @font-face or a font <link>. ${b ? `Fix: inject @font-face for bundled OFL ${b.family}.` : classes[idx] === "thmanyah" ? "Add @font-face{font-family:'Thmanyah Sans';src:local('Thmanyah Sans')} (local only — do not ship the file)." : "Add an @font-face pointing at a licensed file."}`,
            ar: `الخط "${fd}" مستخدم بدون @font-face. ${b ? `الإصلاح: إضافة @font-face لخط ${b.family} المرفق (OFL).` : "أضف @font-face يشير إلى ملف مرخّص."}`,
          },
          apply: b ? () => { ctx.needFonts.add(b.key); } : undefined,
        });
      }
    }
  }

  // HZ12 digits (Arabic blocks only)
  const arBlockSet = new Set(arBlocks);
  const inArBlock = (t: Text) => { let c: AnyNode | null = t.parent; while (c && c.type === "tag") { if (arBlockSet.has(c as Element)) return true; c = c.parent; } return false; };
  checkDigits(ctx, allText.filter((t) => inArBlock(t) && (hasArabic(t.data) || /[0-9\u0660-\u0669\u06F0-\u06F9]/.test(t.data))));

  // HZ13 bidi isolation (text nodes with Arabic + Latin runs)
  const bidiNodes = arTexts.filter((t) => {
    const p = t.parent as Element;
    if (!p || p.name === "bdi" || p.name === "bdo" || suppressedAt(ctx, t, "HZ13")) return false;
    return latin().test(tplMask(t.data)) && majority(blockOf(p));
  });
  if (bidiNodes.length) {
    const sample = bidiNodes[0].data.trim().slice(0, 50);
    // isolating a word the split script already reverses for RTL would flip it back ("gsap" → "pasg")
    const scripted = reordersLatin(ctx);
    const doFix = ctx.opts.bidi && !scripted;
    add(ctx, "HZ13", {
      el: bidiNodes[0].parent as Element, count: bidiNodes.length,
      message: scripted
        ? { en: `${bidiNodes.length} Arabic text node(s) embed Latin runs, e.g. "${sample}". Not wrapped in <bdi>: a script on this page already reverses Latin words for RTL splitting, and isolating them would flip them back.`, ar: `${bidiNodes.length} نص عربي يحتوي كلمات لاتينية، مثل "${sample}". لم تُعزل داخل <bdi>: سكربت في الصفحة يعكس الكلمات اللاتينية أصلًا عند التقسيم، والعزل سيقلبها مرة أخرى.` }
        : { en: `${bidiNodes.length} Arabic text node(s) embed Latin runs without isolation, e.g. "${sample}". Fix: wrap runs in <bdi>.`, ar: `${bidiNodes.length} نص عربي يحتوي كلمات لاتينية بدون عزل، مثل "${sample}". الإصلاح: وضعها داخل <bdi>.` },
      ...(scripted ? { severity: "info" as const } : {}),
      fixable: doFix,
      apply: doFix ? () => {
        for (const t of bidiNodes) {
          if (!t.parent) continue;
          let out = runs(t.data).map((r) => (r.latin ? `<bdi>${esc(r.text)}</bdi>` : esc(r.text))).join("");
          // In flex/grid containers every child becomes an item: keep the text a single item.
          const pd = (css.computed(t.parent as Element, "display") || "").toLowerCase();
          if (/flex|grid/.test(pd)) out = `<span>${out}</span>`;
          $(t).replaceWith(out);
        }
      } : undefined,
    });
  }

  // HZ14 bidi controls
  const ctl = allText.filter((t) => new RegExp(BIDI_CONTROL_RE.source).test(t.data));
  if (ctl.length) add(ctx, "HZ14", { el: ctl[0].parent as Element, count: ctl.length, message: { en: `${ctl.length} text node(s) contain raw bidi control characters (U+202A–202E / U+2066–2069).`, ar: `${ctl.length} نص يحتوي محارف تحكم اتجاه خام.` } });

  // HZ15 reversed text
  for (const b of arBlocks) {
    const r = reversedScore(textOf(b));
    if (r.suspicious >= 1 && r.score >= 0.25) add(ctx, "HZ15", { el: b, message: { en: `Text "${textOf(b).trim().slice(0, 40)}" looks reversed (${r.suspicious}/${r.words} words start with ة/ى or end in reversed "ال").`, ar: `النص "${textOf(b).trim().slice(0, 40)}" يبدو معكوساً.` } });
  }

  return { arCount, laCount, arBlocks: arBlocks.length, docArabic: arTexts.length > 0 || ctx.scripts.some((s) => hasArabic(s.text)) };
}

/** ---------------- public API ---------------- */

/** `<!-- harakah-ignore [HZ..] -->` covers the next element and its subtree; `harakah-disable-file` in any comment (HTML, CSS or JS) covers the file. */
function suppressions($: CheerioAPI, html: string): Ctx["supp"] {
  let file: Scope | undefined;
  for (const d of parseDirective(html)) if (d.kind === "disable-file") file = merge(file, d.scope);
  const els = new Map<Element, Scope>();
  const all: AnyNode[] = [];
  const visit = (n: AnyNode) => { all.push(n); for (const k of ((n as any).children ?? []) as AnyNode[]) visit(k); };
  visit($.root()[0] as AnyNode);
  for (const n of all) {
    if (n.type !== "comment") continue;
    for (const d of parseDirective((n as any).data || "")) {
      if (d.kind === "disable-file") continue;
      let next = n.next;
      while (next && (next.type === "comment" || (next.type === "text" && !(next as Text).data.trim()))) next = next.next;
      if (next && (next.type === "tag" || next.type === "script" || next.type === "style")) els.set(next as Element, merge(els.get(next as Element), d.scope));
    }
  }
  return { file, els };
}

function makeCtx(html: string, options: Options): Ctx {
  const { $, isDoc } = load(html);
  const opts = { ...DEFAULTS, ...options } as typeof DEFAULTS & Options;
  const scripts = $("script").toArray().filter((s) => !(s as Element).attribs.src && !(s as Element).attribs["data-harakah"] && !/json|template|text\/html/i.test((s as Element).attribs.type || "")).map((s) => ({ el: s as Element, text: $(s).text() }));
  return { $, css: new Cascade($, opts.baseDir), opts, issues: [], isDoc, isHF: $("[data-composition-id]").length > 0, needFonts: new Set(), needShim: false, scripts, fsCache: new Map(), supp: suppressions($, html) };
}

function run(ctx: Ctx) {
  checkSplits(ctx);
  const t = checkText(ctx);
  checkScripts(ctx, t.docArabic);
  ctx.issues.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.code.localeCompare(b.code));
  return t;
}
const sevRank = (s: Severity) => (s === "error" ? 0 : s === "warning" ? 1 : 2);
const strip = (i: InternalIssue): Issue => { const { apply, order, ...rest } = i; return rest; };

export function analyze(html: string, options: Options = {}): Analysis {
  const ctx = makeCtx(html, options);
  const t = run(ctx);
  return {
    issues: ctx.issues.map(strip),
    stats: { arabicChars: t.arCount, latinChars: t.laCount, hyperframes: ctx.isHF, document: ctx.isDoc, scripts: ctx.scripts.length, arabicBlocks: t.arBlocks },
  };
}

export interface FixResult {
  html: string;
  applied: Issue[];
  remaining: Issue[];
  /** Files the output references (copy them next to the output when fontSrc = "file"). */
  assets: { src: string; rel: string }[];
  shimInjected: boolean;
}

export function fix(html: string, options: Options = {}): FixResult {
  const ctx = makeCtx(html, options);
  run(ctx);
  const todo = ctx.issues.filter((i) => i.fixable && i.apply).sort((a, b) => a.order - b.order);
  for (const i of todo) { try { i.apply!(); i.fixed = true; } catch (e) { i.fixed = false; } }
  const { $, opts } = ctx;
  if (opts.shim === "always" || (opts.shim === "auto" && ctx.needShim)) {
    const host: any = $("body").length ? $("body") : $.root();
    host.append(`\n<script data-harakah="runtime">${reordersLatin(ctx) ? "window.__harakahKeepLatin=1;" : ""}${ctx.reversedSplit ? "window.__harakahNoDir=1;" : ctx.reversedSelectors?.length ? `window.__harakahNoDir=${JSON.stringify(ctx.reversedSelectors).replace(/</g, "\\u003c")};` : ""}${RUNTIME_SHIM}</script>\n`);
    ctx.needShim = true;
  } else ctx.needShim = false;
  const assets: { src: string; rel: string }[] = [];
  if (ctx.needFonts.size && opts.fontSrc !== "none") {
    let css = "";
    let links = "";
    for (const key of ctx.needFonts) {
      const b = BUNDLED[key];
      if (opts.fontSrc === "google") {
        links += `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${b.family.replace(/ /g, "+")}:wght@400;700&display=swap" data-harakah="fonts">\n`;
        continue;
      }
      for (const f of b.faces) {
        const abs = path.join(ASSET_FONT_DIR, f.file);
        let url: string;
        if (opts.fontSrc === "data") url = `data:font/ttf;base64,${fs.readFileSync(abs).toString("base64")}`;
        else { url = `${opts.fontBase}${f.file}`; assets.push({ src: abs, rel: f.file }); }
        css += `@font-face{font-family:'${b.family}';src:local('${b.family}'),url('${url}') format('truetype');font-weight:${f.weight};font-display:block}\n`;
      }
      // Alexandria draws ٬ ٫ ٪ with its Latin comma glyph; with Eastern digits, draw just those from IBM Plex Sans Arabic.
      if (key === "alexandria" && opts.digits === "eastern") {
        for (const [file, weight] of [["IBMPlexSansArabic-Regular.ttf", "100 450"], ["IBMPlexSansArabic-Bold.ttf", "451 900"]]) {
          const abs = path.join(ASSET_FONT_DIR, file);
          let url: string;
          if (opts.fontSrc === "data") url = `data:font/ttf;base64,${fs.readFileSync(abs).toString("base64")}`;
          else { url = `${opts.fontBase}${file}`; if (!assets.some((a) => a.rel === file)) assets.push({ src: abs, rel: file }); }
          css += `@font-face{font-family:'${b.family}';src:url('${url}') format('truetype');font-weight:${weight};unicode-range:U+066A-066C;font-display:block} /* harakah: Arabic separators */\n`;
        }
      }
    }
    const tag = (css ? `<style data-harakah="fonts">\n/* Bundled by harakah-fix — SIL Open Font License 1.1 */\n${css}</style>\n` : "") + links;
    if ($("head").length) $("head").prepend(tag); else $.root().prepend(tag);
  }
  const out = $.html();
  const after = analyze(out, options);
  return { html: out, applied: todo.filter((i) => i.fixed).map(strip), remaining: after.issues, assets, shimInjected: ctx.needShim };
}
