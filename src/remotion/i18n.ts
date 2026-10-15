/**
 * i18n follow: Arabic that reaches a component through a translation call, e.g. next-intl `t("hero.title")`
 * with `messages/ar.json`, react-i18next/i18next `t("common:title")` with `locales/ar/common.json`, or react-intl
 * `intl.formatMessage({ id: "title" })`. Only Arabic-script locale files are read (ar, fa, ur, ps, ckb …). All their
 * string values are indexed, so a key that stays Latin in the Arabic locale ("brand": "Acme") is known to be Latin.
 * Locale modules (`locales/ar.ts` exporting an object literal) and dictionary property access (`dict.hero.title`
 * from `getDictionary()`, the Next.js docs pattern, or `t.nav.home` from a custom `useTranslation()`) are followed too.
 * Analysis only: locale files are never edited.
 */
import fs from "node:fs";
import path from "node:path";
import { Node, SyntaxKind, ts } from "ts-morph";
import { hasArabicLetter } from "../arabic.js";

export type I18nKeys = Map<string, string>;
const LANG_SEG = /^(ar|fa|ur|ps|ckb|sd|ug|prs)([-_][A-Za-z]{2,4})?$/i;
const ANY_LANG = /^(en|fr|de|es|it|pt|nl|tr|ru|zh|ja|ko|id|ms|hi|bn|sv|pl|uk|he|el|ro|cs|da|fi|no|nb|vi|th)([-_][A-Za-z]{2,4})?$/i;
const LOCALE_DIR = /^(locales?|messages|i18n|lang|langs|languages|translations?|intl|dictionaries|dict|content)$/i;
const SKIP = new Set(["node_modules", ".git", "out", "dist", "build", ".next", ".cache", ".remotion", ".turbo", "coverage"]);

function flatten(v: unknown, prefix: string, out: [string, string][]) {
  if (typeof v === "string") { if (prefix) out.push([prefix, v]); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => flatten(x, prefix ? `${prefix}.${i}` : String(i), out)); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
}

const LOCALE_FILE = /\.(json|[cm]?[jt]sx?)$/i;
/** Plain value of a locale module: the exported object literal with the most string leaves (`export const ar = {…}`,
 *  `export default {…} as const`, `const ar: Dictionary = {…}; export default ar`). Non-literal values are skipped. */
const unwrapTs = (e: ts.Expression): ts.Expression => ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) ? unwrapTs(e.expression) : e;
const propKey = (n: ts.PropertyName) => ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : undefined;
/** Plain value of a literal expression (strings, arrays, objects); other values are skipped. */
function literalValue(e: ts.Expression, count: { n: number }): unknown {
  e = unwrapTs(e);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { count.n++; return e.text; }
  if (ts.isArrayLiteralExpression(e)) return e.elements.map((x) => literalValue(x, count));
  if (ts.isObjectLiteralExpression(e)) {
    const o: Record<string, unknown> = {};
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const k = propKey(p.name);
      if (k !== undefined) o[k] = literalValue(p.initializer, count);
    }
    return o;
  }
  return undefined;
}
const parseTs = (text: string, file: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, /\.[cm]?js$/i.test(file) ? ts.ScriptKind.JS : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
/** Plain value of a locale module: the exported object literal with the most string leaves (`export const ar = {…}`,
 *  `export default {…} as const`, `const ar: Dictionary = {…}; export default ar`). */
function moduleValue(text: string, file: string): unknown {
  const sf = parseTs(text, file);
  let best: unknown, bestLeaves = 0;
  const consider = (e: ts.Expression | undefined) => {
    if (!e || !ts.isObjectLiteralExpression(unwrapTs(e))) return;
    const c = { n: 0 };
    const v = literalValue(e, c);
    if (c.n > bestLeaves) { best = v; bestLeaves = c.n; }
  };
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => consider(d.initializer));
    else if (ts.isExportAssignment(st)) consider(st.expression);
  }
  return best;
}
/** Inline locale maps in app code: `const translations = { ar: { nav: { home: "الرئيسية" } }, en: { … } }`.
 *  Returns the Arabic-script branches and the other locale keys seen next to them. */
function inlineLocaleMaps(text: string, file: string): { values: unknown[]; other: string[] } {
  const values: unknown[] = [];
  const other: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const props = n.properties.filter(ts.isPropertyAssignment);
      const ar = props.find((p) => LANG_SEG.test(propKey(p.name) ?? ""));
      const others = props.filter((p) => ANY_LANG.test(propKey(p.name) ?? ""));
      if (ar && others.length && ts.isObjectLiteralExpression(unwrapTs(ar.initializer))) {
        values.push(literalValue(ar.initializer, { n: 0 }));
        others.forEach((p) => other.push(propKey(p.name)!.toLowerCase()));
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(parseTs(text, file));
  return { values, other };
}

/** Index Arabic-script locale JSON files under root: full key (with and without the namespace) → Arabic text. */
export function loadI18n(root: string): { keys: I18nKeys; files: string[]; otherLocales: string[] } {
  const keys: I18nKeys = new Map();
  const files: string[] = [];
  const other = new Set<string>();
  const walk = (d: string, depth: number) => {
    if (depth > 6 || keys.size > 50_000) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!LOCALE_FILE.test(e.name) || /\.d\.[cm]?ts$/i.test(e.name)) continue;
      const rel = path.relative(root, p).split(path.sep);
      const segs = [...rel.slice(0, -1), rel[rel.length - 1].replace(LOCALE_FILE, "")];
      const li = segs.findIndex((s) => LANG_SEG.test(s));
      if (li < 0 && /\.[cm]?[jt]sx?$/i.test(e.name) && !/\.d\.[cm]?ts$/i.test(e.name)) {
        let text = "";
        try { if (fs.statSync(p).size < 600_000) text = fs.readFileSync(p, "utf8"); } catch {}
        // quick filter before parsing: an `ar: {` key and some Arabic letters
        if (text && /(?:^|[\s{,])["']?(?:ar|fa|ur)["']?\s*:\s*\{/m.test(text) && hasArabicLetter(text)) {
          const { values, other: o } = inlineLocaleMaps(text, p);
          let n = 0;
          for (const v of values) { const pairs: [string, string][] = []; flatten(v, "", pairs); for (const [k, x] of pairs) { if (!keys.has(k)) keys.set(k, x); if (hasArabicLetter(x)) n++; } }
          if (n) { files.push(path.relative(root, p).replace(/\\/g, "/")); o.forEach((x) => other.add(x)); }
        }
        // fall through: locales/en.ts still marks the app multilingual
      }
      if (li < 0) {
        // en.json / locales/en/common.json next to the Arabic ones → the app is multilingual
        const oi = segs.findIndex((s, i) => ANY_LANG.test(s) && (segs.slice(0, i).some((x) => LOCALE_DIR.test(x)) || i === 0 && segs.length === 1));
        if (oi >= 0) other.add(segs[oi].toLowerCase());
        continue;
      }
      const isFile = li === segs.length - 1;
      // messages/ar.json, ar.json at the root, locales/ar/common.json, public/locales/ar-SA/translation.json
      if (!(segs.slice(0, li).some((s) => LOCALE_DIR.test(s)) || (isFile && li === 0) || (!isFile && LOCALE_DIR.test(segs[li - 1] ?? "")))) continue;
      let j: unknown;
      try { if (fs.statSync(p).size > 2_000_000) continue; const text = fs.readFileSync(p, "utf8"); j = /\.json$/i.test(p) ? JSON.parse(text) : moduleValue(text, p); } catch { continue; }
      const pairs: [string, string][] = [];
      flatten(j, "", pairs);
      const ns = isFile ? "" : segs.slice(li + 1).join(".");
      let n = 0;
      for (const [k, v] of pairs) {
        if (hasArabicLetter(v)) n++;
        keys.set(k, v);
        if (ns) { keys.set(`${ns}.${k}`, v); keys.set(`${ns}:${k}`, v); }
      }
      if (n) files.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(root, 0);
  return { keys, files, otherLocales: files.length ? [...other] : [] };
}

const T_CALLEE = /^(t|\$t|translate|i18n\.t|i18next\.t|props\.t|this\.props\.t)$|\.t$/;
const NS_HOOK = /^(useTranslations|getTranslations|useTranslation|useT|getFixedT|getI18n)$/;
const strArg = (n: Node | undefined): string | undefined => n && (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) ? n.getLiteralValue() : undefined;

/** Namespace bound to a translator, e.g. `const t = useTranslations("Hero")` or `const { t } = useTranslation("common")`. */
function namespaceOf(callee: Node): string | undefined {
  if (!Node.isIdentifier(callee)) return undefined;
  for (const d of callee.getSymbol()?.getDeclarations() ?? []) {
    let decl: Node | undefined = d;
    if (Node.isBindingElement(decl)) decl = decl.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (!decl || !Node.isVariableDeclaration(decl)) continue;
    let init = decl.getInitializer();
    if (init && Node.isAwaitExpression(init)) init = init.getExpression();
    if (!init || !Node.isCallExpression(init)) continue;
    const name = init.getExpression().getText().split(".").pop() ?? "";
    if (!NS_HOOK.test(name)) continue;
    const a0 = init.getArguments()[0];
    const ns = strArg(a0) ?? (a0 && Node.isObjectLiteralExpression(a0) ? strArg((a0.getProperty("namespace") as any)?.getInitializer?.()) : undefined);
    return ns || undefined;
  }
  return undefined;
}

// dictionary objects: `const dict = await getDictionary(lang)`, `const { t } = useTranslation()` (custom, returning an object),
// `const copy = useContent()`; or a prop handed a (sub-)dictionary: `function Hero({ dictionary }) { dictionary.title }`
const DICT_HOOK = /^(use|get|load)\w*(Translations?|Dictionary|Dictionaries|Dict|Messages|Locale|Lang|Language|I18n|Intl|Strings|Copy|Content|Texts?)$/i;
const DICT_PARAM = /^(t|dict|dictionary|messages|translations?|strings|copy|i18n|labels|texts?)$/;
const rootKind = new WeakMap<Node, "hook" | "param" | "">();
function dictRoot(id: Node): "hook" | "param" | "" {
  for (const d of id.getSymbol()?.getDeclarations() ?? []) {
    const hit = rootKind.get(d);
    if (hit !== undefined) { if (hit) return hit; continue; }
    let kind: "hook" | "param" | "" = "";
    const param = d.getFirstAncestorByKind(SyntaxKind.Parameter) ?? (Node.isParameterDeclaration(d) ? d : undefined);
    // a component prop named like a dictionary; not a callback parameter (`items.map((t) => …)`)
    if (param) kind = DICT_PARAM.test(id.getText()) && !Node.isCallExpression(param.getParent()?.getParent()) ? "param" : "";
    else {
      let decl: Node | undefined = d;
      if (Node.isBindingElement(decl)) decl = decl.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      let init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
      if (init && Node.isAwaitExpression(init)) init = init.getExpression();
      if (init && Node.isCallExpression(init) && DICT_HOOK.test(init.getExpression().getText().split(".").pop() ?? "")) kind = "hook";
    }
    rootKind.set(d, kind);
    if (kind) return kind;
  }
  return "";
}
const suffixes = new WeakMap<I18nKeys, Map<string, string>>();
export function bySuffix(keys: I18nKeys, k: string): string | undefined {
  let m = suffixes.get(keys);
  if (!m) {
    m = new Map();
    for (const [full, v] of keys) { const segs = full.split("."); for (let i = 1; i < segs.length; i++) { const s = segs.slice(i).join("."); if (!m.has(s)) m.set(s, v); } }
    suffixes.set(keys, m);
  }
  return m.get(k);
}
/** `dict.hero.title` / `t["nav"]["home"]` / `t.items[0]` → root identifier + dotted key, or undefined. */
function accessPath(n: Node): { root: Node; key: string } | undefined {
  const segs: string[] = [];
  let cur: Node = n;
  for (;;) {
    if (Node.isPropertyAccessExpression(cur)) { segs.unshift(cur.getName()); cur = cur.getExpression(); }
    else if (Node.isElementAccessExpression(cur)) {
      const a = cur.getArgumentExpression();
      if (!a || !(Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a) || Node.isNumericLiteral(a))) return undefined;
      segs.unshift(String(a.getLiteralValue())); cur = cur.getExpression();
    } else if (Node.isNonNullExpression(cur) || Node.isParenthesizedExpression(cur)) cur = cur.getExpression();
    else break;
  }
  return Node.isIdentifier(cur) && segs.length ? { root: cur, key: segs.join(".") } : undefined;
}

// `t.hero.stats.map((stat) => stat.label)`: the callback parameter stands for every item of a dictionary array
const ITER = /^(map|flatMap|forEach|filter|find|findLast|some|every)$/;
type Resolved = { path: string; suffix: boolean };
function resolvePath(n: Node, depth = 0): Resolved | undefined {
  if (depth > 3) return undefined;
  let root: Node, key = "";
  if (Node.isIdentifier(n)) root = n;
  else { const ap = accessPath(n); if (!ap) return undefined; root = ap.root; key = ap.key; }
  const kind = dictRoot(root);
  if (kind) return key ? { path: key, suffix: kind === "param" } : undefined;
  for (const d of root.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isParameterDeclaration(d)) continue;
    const fn = d.getParent();
    if (!fn || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== d) continue;
    const call = fn.getParent();
    if (!call || !Node.isCallExpression(call) || call.getArguments()[0] !== fn) continue;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !ITER.test(callee.getName())) continue;
    const arr = resolvePath(callee.getExpression(), depth + 1);
    if (arr) return { path: `${arr.path}.*${key ? "." + key : ""}`, suffix: arr.suffix };
  }
  return undefined;
}
/** Value at a dotted path; `*` stands for any array index (an Arabic value wins, then one with letters). */
function lookupPath(keys: I18nKeys, r: Resolved): string | undefined {
  const get = (k: string) => keys.get(k) ?? (r.suffix ? bySuffix(keys, k) : undefined);
  const star = r.path.indexOf(".*");
  if (star < 0) return get(r.path);
  const vals: string[] = [];
  for (let i = 0; i < 60; i++) {
    const v = lookupPath(keys, { path: r.path.slice(0, star) + "." + i + r.path.slice(star + 2), suffix: r.suffix });
    if (v === undefined) { if (i > 0) break; continue; }
    vals.push(v);
  }
  return vals.find(hasArabicLetter) ?? vals.find((v) => /[A-Za-z]/.test(v)) ?? vals[0];
}

/** Arabic text behind a translation call (`t("key")`, `intl.formatMessage({ id })`), or undefined. */
export function i18nText(n: Node, keys: I18nKeys | null | undefined): string | undefined {
  const v = i18nValue(n, keys);
  return v !== undefined && hasArabicLetter(v) ? v : undefined;
}

/** The Arabic-locale value behind a translation call (Arabic or not), or undefined when the key is unknown. */
export function i18nValue(n: Node, keys: I18nKeys | null | undefined): string | undefined {
  if (!keys?.size) return undefined;
  if (Node.isPropertyAccessExpression(n) || Node.isElementAccessExpression(n) || Node.isIdentifier(n)) {
    const r = resolvePath(n);
    return r ? lookupPath(keys, r) : undefined;
  }
  if (!Node.isCallExpression(n)) return undefined;
  const callee = n.getExpression();
  const ct = callee.getText();
  let key: string | undefined;
  if (/(^|\.)formatMessage$/.test(ct)) {
    const a0 = n.getArguments()[0];
    if (a0 && Node.isObjectLiteralExpression(a0)) key = strArg((a0.getProperty("id") as any)?.getInitializer?.());
  } else if (T_CALLEE.test(ct) || namespaceOf(callee) !== undefined) {
    key = strArg(n.getArguments()[0]);
    // t("nav", "home") → nav.home (section + key helpers)
    const k2 = strArg(n.getArguments()[1]);
    if (key && k2 && !keys.has(key) && keys.has(`${key}.${k2}`)) key = `${key}.${k2}`;
  }
  if (!key) return undefined;
  const ns = namespaceOf(callee);
  for (const k of ns ? [`${ns}.${key}`, key] : [key, key.replace(":", ".")]) { const v = keys.get(k); if (v !== undefined) return v; }
  return undefined;
}

/** All Arabic texts behind translation calls inside n (n included). */
export function i18nTexts(n: Node, keys: I18nKeys | null | undefined): string[] {
  if (!keys?.size) return [];
  const out: string[] = [];
  const visit = (d: Node) => {
    if (Node.isCallExpression(d) || Node.isPropertyAccessExpression(d) || Node.isElementAccessExpression(d) || Node.isIdentifier(d) && Node.isJsxExpression(d.getParent())) {
      const v = i18nText(d, keys);
      if (v) out.push(v);
    }
  };
  visit(n);
  n.forEachDescendant(visit);
  return out;
}
