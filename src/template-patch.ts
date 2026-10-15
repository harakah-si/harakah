/**
 * Template auto-fix as a reviewable patch (.astro / .vue / .svelte).
 *
 * No serializer round-trip: the template is converted to HTML with every start tag tagged by its source offset,
 * the HTML engine's own fixes run on that page, and the attribute changes it makes (dir, lang, inline style) are
 * written back to the original source as position edits: a Tailwind token swap when the element's own class carries
 * the bad value, otherwise an attribute insert or a static style append. Text-level fixes (digit normalization, <bdi>
 * isolation) are mapped back the same way: the converter records where each verbatim text run came from, so a changed
 * digit becomes a one-character replace and a <bdi> wrap becomes two inserts around the original characters. Dynamic
 * attributes, components and text that comes from an expression ({cond ? 'نص' : …}) are left as findings. The result
 * is a unified diff plus the patched text, re-analysed so the caller knows what the patch clears.
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { createTwoFilesPatch } from "diff";
import { fix, type Issue, type Options } from "./engine.js";
import { analyzeTemplateSource, projectRoot, templateFiles, templateProject, templateToHtml, type TagInfo, type TemplateProject, type TextRun } from "./templates.js";
import { twDecl } from "./remotion/project-css.js";

/** Rules whose fix is an attribute change on an existing element (safe to map back to the source). */
const PATCH_CODES = ["HZ03", "HZ04", "HZ06", "HZ07", "HZ08", "HZ17", "HZ18", "HZ22", "HZ23"];
/** Rules whose fix rewrites a text node: digits (HZ12), <bdi> isolation (HZ13, HZ21; HZ22's Latin lists). */
const TEXT_CODES = ["HZ12", "HZ13", "HZ21"];
const PROPS = new Set(["letter-spacing", "text-transform", "text-align", "word-break", "font-variant", "line-height", "direction"]);
/** the Tailwind utility that undoes a bad value */
const TW_SAFE: Record<string, string> = { "letter-spacing": "tracking-normal", "text-transform": "normal-case", "text-align": "text-start", "word-break": "break-normal", "font-variant": "normal-nums" };

export interface TemplateEdit { start: number; end: number; text: string; line: number; what: string }
export interface TemplatePatch {
  file: string;
  /** unified diff (empty when nothing can be patched) */
  patch: string;
  /** patched source */
  fixed: string;
  edits: TemplateEdit[];
  before: Issue[];
  after: Issue[];
  /** elements the engine would change but the patch can't reach (dynamic attribute, component, synthetic page) */
  skipped: { line: number; why: string }[];
}

const parseStyle = (s = "") => {
  const m = new Map<string, string>();
  for (const d of s.split(";")) { const i = d.indexOf(":"); if (i > 0) m.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()); }
  return m;
};
const lineAt = (src: string, i: number) => src.slice(0, i).split("\n").length;
const isComponent = (name: string, file: string) => /^[A-Z]/.test(name) || /[.:]/.test(name) || (/\.vue$/i.test(file) && name.includes("-")) || name.toLowerCase() === "template" || name.toLowerCase() === "slot";

/** A class token on this tag that sets `prop` to a bad value → its safe replacement (variant prefix kept). */
function tokenEdits(src: string, tag: TagInfo, prop: string): TemplateEdit[] {
  const out: TemplateEdit[] = [];
  for (const a of tag.attrs) {
    const low = a.name.toLowerCase();
    if (!/^(class|classname|class:list|:class|v-bind:class)$/.test(low) || a.kind === "none") continue;
    const re = /(?<![\w:\-[\]./])((?:[a-z0-9-]+:)*)(!?[a-z][\w-]*(?:-\[[^\]\s]+\])?)(?![\w\-[\]])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(a.value))) {
      const variants = m[1], util = m[2];
      if (/(^|:)ltr:$/.test(variants) || /(^|:)rtl:$/.test(variants)) continue;
      const d = twDecl(util);
      if (!d || d.prop !== prop) continue;
      const safe = TW_SAFE[prop];
      if (!safe || util.replace(/^!/, "") === safe || d.value === "0" || d.value === "none" || d.value === "normal" || d.value === "start" || d.value === "right") continue;
      const at = a.valStart + m.index + variants.length;
      out.push({ start: at, end: at + util.length, text: (util.startsWith("!") ? "!" : "") + safe, line: lineAt(src, at), what: `class ${util} → ${safe}` });
    }
  }
  return out;
}

const PARENT_KEYS = new Set(["html", "head", "body"]);
const keyOf = (el: any): string | undefined => el?.attribs?.["data-hz-at"] ?? (PARENT_KEYS.has(el?.name) ? el.name : undefined);
/** what separates the text stretches of a parent: source elements (anchored by offset), comments, parser-made elements */
const boundary = (n: any, fixedSide: boolean): string | null => {
  if (n.type === "comment") return "!";
  if (n.type !== "tag" && n.type !== "script" && n.type !== "style") return null;
  if (n.attribs?.["data-hz-at"]) return n.attribs["data-hz-at"];
  return fixedSide && (n.name === "bdi" || n.name === "span") ? null : n.name;
};
/** children → [boundaries, text stretches between them] */
function stretches(kids: any[], fixedSide: boolean): { marks: string[]; parts: any[][] } {
  const marks: string[] = [], parts: any[][] = [[]];
  for (const n of kids) { const b = boundary(n, fixedSide); if (b === null) parts[parts.length - 1].push(n); else { marks.push(b); parts.push([]); } }
  return { marks, parts };
}
type Piece = { ch: string } | { tag: string; close: boolean };
function flatten(nodes: any[], out: Piece[] = []): Piece[] {
  for (const n of nodes) {
    if (n.type === "text") for (let j = 0; j < n.data.length; j++) out.push({ ch: n.data[j] }); // code units, like the offsets
    else if (n.type === "tag") {
      const attrs = Object.entries(n.attribs as Record<string, string>).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)).join("");
      out.push({ tag: `<${n.name}${attrs}>`, close: false });
      flatten(n.children, out);
      out.push({ tag: `</${n.name}>`, close: true });
    }
  }
  return out;
}
/** decoded text ↔ raw markup: per decoded code unit, its raw [start, end) (an entity or CRLF is one unit); null when they don't line up */
function alignRaw(raw: string, data: string, base: number): { at: number[]; end: number[] } | null {
  const at: number[] = [], end: number[] = [];
  let r = 0;
  for (let d = 0; d < data.length;) {
    const ent = raw[r] === "&" ? /^&(?:#(\d+)|#x([0-9a-f]+)|[a-z][a-z0-9]*);/i.exec(raw.slice(r, r + 40)) : null;
    let n = 1, w = 1;
    if (ent) { w = ent[0].length; n = ent[1] || ent[2] ? String.fromCodePoint(parseInt(ent[1] ?? ent[2], ent[1] ? 10 : 16)).length : 1; }
    else if (raw[r] === "\r" && raw[r + 1] === "\n" && data[d] === "\n") w = 2;
    else if (raw[r] !== data[d]) return null;
    for (let j = 0; j < n; j++) { at.push(base + r); end.push(base + r + w); }
    d += n; r += w;
  }
  return r === raw.length ? { at, end } : null;
}
const clip = (t: string) => (t.length > 48 ? t.slice(0, 47) + "…" : t).replace(/\s+/g, " ");

/** Text nodes the engine rewrote (digits, <bdi> wraps) → position edits on the original characters. */
function textEdits(src: string, html: string, $a: cheerio.CheerioAPI, $b: cheerio.CheerioAPI, runs: TextRun[], edits: TemplateEdit[], skipped: TemplatePatch["skipped"]) {
  const fixedByKey = new Map<string, any>();
  $b("*").each((_, el: any) => { const k = keyOf(el); if (k && !fixedByKey.has(k)) fixedByKey.set(k, el); });
  // output offset → source offset (−1 when the character is not verbatim template text)
  const runAt = (o: number): TextRun | undefined => {
    let lo = 0, hi = runs.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, r = runs[m]; if (o < r.out) hi = m - 1; else if (o >= r.out + r.len) lo = m + 1; else return r; }
    return undefined;
  };
  const srcAt = (o: number): number => { const r = runAt(o); return r ? r.src + o - r.out : -1; };
  // markup may only go where the neighbouring character is template text, never inside a JS string literal
  const tagAt = (o: number): number => { const r = runAt(o); return r && !r.lit ? r.src + o - r.out : -1; };
  const why = new Set<string>();
  const skip = (at: number, w: string) => { const line = at >= 0 ? lineAt(src, at) : 0; if (!why.has(line + w)) { why.add(line + w); skipped.push({ line, why: w }); } };
  $a("*").each((_, el: any) => {
    const k = keyOf(el);
    if (!k || el.name === "script" || el.name === "style") return;
    const fb = fixedByKey.get(k);
    if (!fb) return;
    const A = stretches(el.children, false), B = stretches(fb.children, true);
    if (A.marks.join("|") !== B.marks.join("|")) return; // the engine restructured more than text: leave it
    A.parts.forEach((part, i) => {
      if (part.length !== 1 || part[0].type !== "text") return;
      const t = part[0], data: string = t.data;
      const pieces = flatten(B.parts[i]);
      const chars = pieces.filter((x): x is { ch: string } => "ch" in x).map((x) => x.ch).join("");
      if (chars === data && pieces.every((x) => "ch" in x)) return; // untouched
      const loc = t.sourceCodeLocation, start0 = loc ? srcAt(loc.startOffset) : -1;
      const lead = loc ? srcAt(loc.startOffset + Math.max(0, data.search(/\S/))) : -1;
      const first = start0 >= 0 ? start0 : lead >= 0 ? lead : /^\d+$/.test(k) ? Number(k) : -1; // else: the parent tag's line
      if (chars.length !== data.length) { skip(first, "text rewrite is not character-for-character: fix this text by hand"); return; }
      const map = loc && alignRaw(html.slice(loc.startOffset, loc.endOffset), data, loc.startOffset);
      if (!map) { skip(first, "text markup does not line up with its decoded text: wrap/convert it by hand"); return; }
      // the fixed text as (position in the original text, inserted markup) + changed characters
      const local: { start: number; end: number; text: string }[] = [];
      let i2 = 0, bad = false, inLit = false;
      for (const pc of pieces) {
        if ("ch" in pc) {
          if (pc.ch !== data[i2]) {
            const sp = srcAt(map.at[i2]);
            if (sp < 0 || map.end[i2] - map.at[i2] !== 1 || src[sp] !== data[i2]) { bad = true; break; }
            local.push({ start: sp, end: sp + 1, text: pc.ch });
          }
          i2++;
          continue;
        }
        // opening tags stick to the next character, closing tags to the previous one
        const next = i2 < data.length ? tagAt(map.at[i2]) : -1, prev = i2 > 0 ? tagAt(map.end[i2 - 1] - 1) : -1;
        const at = pc.close ? (prev >= 0 ? prev + 1 : next) : (next >= 0 ? next : prev >= 0 ? prev + 1 : -1);
        if (at < 0) { bad = true; inLit = (i2 < data.length && !!runAt(map.at[i2])?.lit) || (i2 > 0 && !!runAt(map.end[i2 - 1] - 1)?.lit); break; }
        local.push({ start: at, end: at, text: pc.tag });
      }
      if (bad) { skip(first, inLit ? "text in a string literal ({cond ? '…' : …}): add the <bdi> by hand (digits were not changed either)" : "text comes from an expression ({…}): change the string by hand"); return; }
      // merge touching edits (stable: inserts at one point keep their order)
      const merged: { start: number; end: number; text: string }[] = [];
      for (const e of local.map((e, n) => ({ ...e, n })).sort((x, y) => x.start - y.start || x.n - y.n)) {
        const last = merged[merged.length - 1];
        if (last && e.start === last.end) { last.text += e.text; last.end = e.end; }
        else if (last && e.start < last.end) { bad = true; break; }
        else merged.push({ start: e.start, end: e.end, text: e.text });
      }
      if (bad || !merged.length) return;
      const s0 = merged[0].start, s1 = merged[merged.length - 1].end;
      let after = src.slice(s0, s1);
      for (const e of [...merged].reverse()) after = after.slice(0, e.start - s0) + e.text + after.slice(e.end - s0);
      const kinds = [/<bdi/.test(after) && "<bdi>", merged.some((e) => e.end > e.start) && "digits"].filter(Boolean).join(" + ");
      const what = `${kinds}: ${clip(src.slice(s0, s1))} → ${clip(after)}`;
      merged.forEach((e, n) => edits.push({ ...e, line: lineAt(src, e.start), what: n ? `(same text, part ${n + 1}/${merged.length})` : what }));
    });
  });
}

/** Patch for one template (does not write). */
export function templatePatch(file: string, opts: Options = {}, proj?: TemplateProject, src = fs.readFileSync(file, "utf8")): TemplatePatch {
  const p = proj ?? templateProject(projectRoot(file));
  const before = analyzeTemplateSource(file, src, opts, p);
  const empty: TemplatePatch = { file, patch: "", fixed: src, edits: [], before, after: before, skipped: [] };
  if (!before.length) return empty;
  const tags = new Map<number, TagInfo>();
  const runs: TextRun[] = [];
  const html = templateToHtml(file, src, p, tags, runs);
  const fixedHtml = fix(html, { ...opts, only: [...PATCH_CODES, ...TEXT_CODES.filter((c) => opts.bidi !== false || c === "HZ12")], shim: "never", fontSrc: "none", markDecl: true, baseDir: path.dirname(file) }).html;
  const $a = cheerio.load(html, { sourceCodeLocationInfo: true } as any), $b = cheerio.load(fixedHtml);
  const orig = new Map<string, Record<string, string>>();
  $a("[data-hz-at]").each((_, el: any) => { orig.set(el.attribs["data-hz-at"], { ...el.attribs }); });
  const edits: TemplateEdit[] = [];
  const skipped: TemplatePatch["skipped"] = [];
  const pageLevel = new Map<string, string>();
  $b("[data-hz-at]").each((_, el: any) => {
    const at = el.attribs["data-hz-at"], tag = tags.get(Number(at)), was = orig.get(at);
    if (!tag || !was) return;
    const line = lineAt(src, tag.start);
    const attr = (n: string) => tag.attrs.find((x) => x.name.toLowerCase() === n || x.name.toLowerCase() === ":" + n || x.name.toLowerCase() === "v-bind:" + n);
    const changes: { dir?: string; lang?: string; style: Map<string, string> } = { style: new Map() };
    for (const n of ["dir", "lang"] as const) if ((el.attribs[n] ?? "") !== (was[n] ?? "") && el.attribs[n]) changes[n] = el.attribs[n];
    const s0 = parseStyle(was.style), s1 = parseStyle(el.attribs.style);
    for (const [k, v] of s1) {
      if (!PROPS.has(k) || s0.get(k) === v) continue;
      // declared on <html>/<body> or the project's page CSS: one stylesheet fix, not an inline style on every element
      const decl = el.attribs[`data-hz-decl-${k}`];
      const declTag = decl && /^\d+$/.test(decl) ? tags.get(Number(decl))?.name.toLowerCase() : decl;
      if (declTag === "html" || declTag === "body") { if (!pageLevel.has(k)) pageLevel.set(k, v.replace(/\s*!important$/, "")); continue; }
      changes.style.set(k, v);
    }
    if (!changes.dir && !changes.lang && !changes.style.size) return;
    if (isComponent(tag.name, file)) { skipped.push({ line, why: `<${tag.name}> is a component: set it inside the component` }); return; }
    for (const n of ["dir", "lang"] as const) {
      const v = changes[n]; if (!v) continue;
      const a = attr(n);
      if (!a) edits.push({ start: tag.nameEnd, end: tag.nameEnd, text: ` ${n}="${v}"`, line, what: `${n}="${v}"` });
      else if (a.kind === "str" && a.name.toLowerCase() === n && !/[{]/.test(a.value)) edits.push({ start: a.valStart, end: a.valEnd, text: v, line, what: `${n}="${a.value}" → "${v}"` });
      else skipped.push({ line, why: `${a.name} is dynamic: make it ${v} for Arabic` });
    }
    const inline: string[] = [];
    for (const [k, v] of changes.style) {
      const tok = tokenEdits(src, tag, k);
      if (tok.length) { edits.push(...tok); continue; }
      inline.push(`${k}: ${v.replace(/\s*!important$/, "")}`);
    }
    if (inline.length) {
      const st = attr("style");
      if (!st) edits.push({ start: tag.nameEnd, end: tag.nameEnd, text: ` style="${inline.join("; ")}"`, line, what: `style ${inline.join("; ")}` });
      else if (st.kind === "str" && st.name.toLowerCase() === "style" && !/[{]/.test(st.value)) {
        // replace the value of a declaration that is already there, append the rest
        const add: string[] = [];
        for (const d of inline) {
          const [prop, val] = [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1).trim()];
          const m = new RegExp(`(^|;)\\s*${prop}\\s*:\\s*([^;]*?)\\s*(?=;|$)`, "i").exec(st.value);
          if (m) { const vs = st.valStart + m.index + m[0].length - m[2].length; edits.push({ start: vs, end: vs + m[2].length, text: val, line, what: `style ${prop}: ${m[2]} → ${val}` }); }
          else add.push(d);
        }
        if (add.length) {
          const sep = st.value.trim() === "" ? "" : /;\s*$/.test(st.value) ? " " : "; ";
          edits.push({ start: st.valEnd, end: st.valEnd, text: sep + add.join("; "), line, what: `style += ${add.join("; ")}` });
        }
      } else skipped.push({ line, why: `style is dynamic: add ${inline.join("; ")} for Arabic` });
    }
  });
  textEdits(src, html, $a, $b, runs, edits, skipped);
  for (const [k, v] of pageLevel) skipped.push({ line: 0, why: `${k} comes from page-level CSS (html/body): set \`:lang(ar) { ${k}: ${v} }\` (or fix the rule) once in the stylesheet` });
  // non-overlapping, applied back to front
  const uniq = [...new Map(edits.map((e) => [`${e.start}:${e.end}:${e.text}`, e])).values()].map((e, n) => ({ e, n })).sort((x, y) => x.e.start - y.e.start || x.e.end - y.e.end || x.n - y.n).map((x) => x.e);
  const ok: TemplateEdit[] = [];
  for (const e of uniq) { const last = ok[ok.length - 1]; if (last && e.start < last.end) continue; if (last && e.start === last.start && e.end === last.end) continue; ok.push(e); }
  if (!ok.length) return { ...empty, skipped };
  let fixed = src;
  for (const e of [...ok].reverse()) fixed = fixed.slice(0, e.start) + e.text + fixed.slice(e.end);
  const after = analyzeTemplateSource(file, fixed, opts, p);
  const rel = path.relative(p.root, file).split(path.sep).join("/");
  const patch = createTwoFilesPatch(`a/${rel}`, `b/${rel}`, src, fixed, "", "", { context: 3 });
  return { file, patch, fixed, edits: ok, before, after, skipped };
}

/** Patches for every template under a folder (or one file). */
export function templatePatches(target: string, opts: Options = {}): TemplatePatch[] {
  const abs = path.resolve(target);
  const files = fs.statSync(abs).isDirectory() ? templateFiles(abs) : [abs];
  if (!files.length) return [];
  const root = projectRoot(fs.statSync(abs).isDirectory() ? path.join(abs, "_") : abs);
  const p = templateProject(root);
  return files.map((f) => templatePatch(f, opts, p));
}
