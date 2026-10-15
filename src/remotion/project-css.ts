/**
 * The project's global CSS as far as Arabic is concerned: simple class rules (`.label { letter-spacing: … }`), the
 * author's RTL overrides (`html[dir="rtl"] .label`, `[dir=rtl] .x`, `:lang(ar) .x`, `.x:dir(rtl)`, `body.rtl .x`) and
 * `:root` custom properties, so the codemod can use the author's RTL value instead of guessing.
 */
import postcss from "postcss";
import { normalizeRtlSelector } from "../css.js";

export const ARABIC_PROPS = ["letter-spacing", "text-transform", "text-align", "word-break", "font-variant"] as const;
export type ArabicProp = (typeof ARABIC_PROPS)[number];
export interface ProjRule { classes: string[]; tag?: string; prop: ArabicProp; value: string; important: boolean; selector: string; file: string; rtl: boolean; root: boolean; order: number }
export interface ProjectCss { rules: ProjRule[]; vars: Record<string, string> }

/** Tailwind utilities (in @apply or className) → the CSS they set, for the properties that matter */
export function twDecl(util: string): { prop: ArabicProp; value: string } | undefined {
  const u = util.replace(/^!/, "");
  let m: RegExpMatchArray | null;
  if ((m = u.match(/^tracking-(.+)$/))) {
    const t = m[1];
    const named: Record<string, string> = { tighter: "-0.05em", tight: "-0.025em", normal: "0", wide: "0.025em", wider: "0.05em", widest: "0.1em", "0": "0" };
    return { prop: "letter-spacing", value: named[t] ?? (t.startsWith("[") ? t.slice(1, -1).replace(/_/g, " ") : t) };
  }
  if (/^(uppercase|lowercase|capitalize|normal-case)$/.test(u)) return { prop: "text-transform", value: u === "normal-case" ? "none" : u };
  if ((m = u.match(/^text-(left|right|center|justify|start|end)$/))) return { prop: "text-align", value: m[1] };
  if ((m = u.match(/^break-(all|normal|words|keep)$/))) return { prop: "word-break", value: m[1] === "all" ? "break-all" : m[1] === "keep" ? "keep-all" : "normal" };
  if (/^(small-caps|normal-nums)$/.test(u)) return u === "small-caps" ? { prop: "font-variant", value: "small-caps" } : undefined;
  return undefined;
}

/** a value that doesn't hurt Arabic */
export function arabicSafe(prop: string, v: string): boolean {
  const x = v.trim().toLowerCase();
  if (prop === "letter-spacing") return /^(?:normal|initial|unset|revert|[-+]?(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?)$/.test(x);
  if (prop === "text-transform") return /^(none|initial|unset|revert)$/.test(x);
  if (prop === "text-align") return x !== "left";
  if (prop === "word-break") return x !== "break-all";
  if (prop === "font-variant") return !/small-caps/.test(x);
  return true;
}

const SUBJECT = /^([a-z][\w-]*)?((?:\.[\w-]+)+)$/i;

export function parseProjectCss(files: { file: string; text: string }[]): ProjectCss {
  const rules: ProjRule[] = [];
  const vars: Record<string, string> = {};
  let order = 0;
  for (const { file, text } of files) {
    let root: postcss.Root;
    try { root = postcss.parse(text); } catch { continue; }
    root.walkRules((r) => {
      const parent = r.parent as postcss.AtRule | undefined;
      if (parent?.type === "atrule" && /keyframes|font-face/i.test(parent.name)) return;
      const decls: { prop: string; value: string; important: boolean }[] = [];
      r.each((n) => {
        if (n.type === "decl") decls.push({ prop: n.prop.toLowerCase(), value: n.value, important: !!n.important });
        else if (n.type === "atrule" && n.name === "apply") for (const t of n.params.split(/\s+/)) { const d = twDecl(t); if (d) decls.push({ ...d, important: t.startsWith("!") }); }
      });
      for (const raw of r.selectors) {
        const sel = raw.trim();
        if (/^(?::root|html)$/i.test(sel)) for (const d of decls) if (d.prop.startsWith("--")) vars[d.prop] = d.value.trim();
        const n = normalizeRtlSelector(sel);
        // ancestors that are always there (html, body, *) don't constrain the element
        const s = (n ? n.sel : sel).replace(/^(?:(?:html|body|:root|\*)\s*[> ]\s*)+/i, "").trim();
        const m = s.match(SUBJECT);
        if (!m) continue;
        const classes = m[2].slice(1).split(".");
        for (const d of decls) if ((ARABIC_PROPS as readonly string[]).includes(d.prop))
          rules.push({ classes, tag: m[1]?.toLowerCase(), prop: d.prop as ArabicProp, value: d.value.trim(), important: d.important, selector: sel, file, rtl: !!n, root: !!n?.root, order: order++ });
      }
    });
  }
  return { rules, vars };
}

export function resolveVar(v: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 6 || !v.includes("var(")) return v;
  return resolveVar(v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (all, name, fb) => vars[name] ?? (fb !== undefined ? fb.trim() : all)), vars, depth + 1);
}

/**
 * What the project's CSS says about prop on an element with these classes: the base (non-RTL) value and the RTL value.
 * Later rules win (same specificity order as the cascade for single-compound selectors; RTL rules carry an extra
 * attribute/pseudo so they outrank the base rule and Tailwind utilities).
 */
export function projectValue(pc: ProjectCss | undefined, classes: string[], tag: string, prop: ArabicProp) {
  if (!pc) return {};
  const hit = (r: ProjRule) => r.prop === prop && r.classes.every((c) => classes.includes(c)) && (!r.tag || r.tag === tag);
  const pick = (rs: ProjRule[]) => rs.sort((a, b) => Number(a.important) - Number(b.important) || a.classes.length - b.classes.length || a.order - b.order).pop();
  const base = pick(pc.rules.filter((r) => !r.rtl && hit(r)));
  const rtl = pick(pc.rules.filter((r) => r.rtl && hit(r)));
  return {
    base: base && { ...base, value: resolveVar(base.value, pc.vars) },
    rtl: rtl && { ...rtl, value: resolveVar(rtl.value, pc.vars) },
  };
}
