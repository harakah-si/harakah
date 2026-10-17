/**
 * AST codemod for Remotion / React (.tsx/.jsx): rewrites Arabic-breaking patterns.
 * Parsing + types via ts-morph; edits are collected as non-overlapping text replacements and the
 * transform is re-run to a fixpoint (handles nested edits and guarantees idempotence).
 */
import { arabicSafe, projectValue, twDecl, type ArabicProp, type ProjectCss } from "./project-css.js";
import { Project, SyntaxKind, Node, ts, type SourceFile } from "ts-morph";
import { RULES, VIDEO_TRACKING } from "../rules.js";
import type { Issue } from "../engine.js";
import { lineSuppressions, covers } from "../suppress.js";
import { i18nTexts, i18nValue, type I18nKeys } from "./i18n.js";
import { hasArabic, hasArabicLetter, hasTashkeel, tashkeelLevel, ARABIC_RE, scriptLang, normalizeDigits } from "../arabic.js";
import { STYLE_FIX, analyzeArabicProps } from "./props.js";
import { LATIN_ONLY, ARABIC_OFL, classify, arabicCapable, parseStack } from "../fonts.js";
import { verifiedClass, describe as describeCoverage, type FamilyCoverage } from "../glyphs.js";

export interface CodemodOptions {
  split?: "zwj" | "word";
  digits?: "eastern" | "western" | "keep";
  /** auto: display families → Alexandria, text families → IBM Plex Sans Arabic. */
  font?: "auto" | "plex" | "alexandria";
  bidi?: boolean;
  /** Treat every component in the file as Arabic (e.g. Arabic arrives via props/defaultProps). */
  assumeArabic?: boolean;
  /** Module specifier used to import splitArabic/formatDigits. */
  helperImport?: string;
  fileName?: string;
  /** Components in this file that receive Arabic through props (from analyzeArabicProps). Computed for the file itself when omitted. */
  arabicComponents?: string[];
  /** Keep words together: wrap per-letter tokens of each word in a nowrap inline-block span (fixes mid-word line breaks). */
  wrapWords?: boolean;
  /**
   * Module-level declarations in this file used by Arabic components elsewhere (theme.ts / styles.ts):
   * "all" = only Arabic components use it, apply every rule; "safe" = shared with Latin components, only add the
   * Arabic font fallback (harmless for Latin text).
   */
  arabicDecls?: Record<string, "all" | "safe">;
  /** Shared style objects imported into this file: override the Arabic-breaking props at Arabic usage sites. */
  sharedStyles?: { local: string; from: string; overrides: Record<string, [string, string, string][]> }[];
  /** Project mode: imported components were analyzed too (a custom element with Arabic children gets its own dir in its file). */
  project?: boolean;
  /** The whole app is already RTL (`<html dir="rtl">` in a Next.js layout / index.html): don't add dir to component roots. */
  rtlContext?: boolean;
  /** Font families loaded anywhere in the project (FontFace, @remotion/fonts, @font-face, google-fonts imports), lowercased, no spaces. */
  loadedFonts?: string[];
  /** Real glyph coverage of the project's own font files, by family (lowercased, no spaces). */
  fontCoverage?: Record<string, FamilyCoverage>;
  /** project mode: global CSS class rules + the author's RTL overrides (`html[dir=rtl] .label`), see project-css.ts */
  projectCss?: ProjectCss;
  /** false for a web app (package.json without remotion): no @remotion/google-fonts loaders, font fixes become reports. */
  remotion?: boolean;
  /** Project mode: Arabic texts behind translation keys (from ar/fa/ur locale files, see i18n.ts). */
  i18n?: I18nKeys | null;
  /** The project ships non-Arabic locales too: components whose Arabic comes only from translations get locale-aware reports, not hardcoded RTL styles. */
  multilingual?: boolean;
  /** Components fed Arabic only through translation keys (from props.ts). */
  i18nOnly?: string[];
}
export const CODEMOD_DEFAULTS = { split: "zwj", digits: "eastern", font: "auto", bidi: true, assumeArabic: false, helperImport: "@harakah/remotion-arabic", fileName: "Composition.tsx", arabicComponents: [] as string[], wrapWords: false, arabicDecls: {} as Record<string, "all" | "safe">, sharedStyles: [] as { local: string; from: string; overrides: Record<string, [string, string, string][]> }[], project: false, rtlContext: false, loadedFonts: [] as string[], fontCoverage: {} as Record<string, FamilyCoverage>, i18n: null as I18nKeys | null, multilingual: false, i18nOnly: [] as string[] } as const;

/** Font families a source file loads itself (lowercased, spaces removed): FontFace API, @remotion/fonts loadFont, CSS @font-face, @remotion/google-fonts imports. */
/** Locale-aware suggestions for multilingual apps (Arabic only through translations). Splits, fonts and text-align:start stay automatic: they are correct for every locale. */
const LOCALE_AWARE: Record<string, { en: string; ar: string }> = {
  HZ03: { en: `Set the direction from the locale once, at the app root: <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}> (next-intl: useLocale(); i18next: i18n.dir()).`, ar: `النص يأتي من ملفات الترجمة والمكوّن يعرض لغات أخرى أيضاً: اضبط الاتجاه من اللغة في جذر التطبيق، مثل <html dir={locale === "ar" ? "rtl" : "ltr"}>.` },
  HZ07: { en: `Make it locale-aware: letterSpacing: isRtl ? 0 : <current>, or Tailwind rtl:tracking-normal.`, ar: `اجعله حسب اللغة: letterSpacing: isRtl ? 0 : القيمة الحالية، أو rtl:tracking-normal في Tailwind.` },
  HZ08: { en: `Make it locale-aware: textTransform: isRtl ? "none" : <current>, or Tailwind rtl:normal-case.`, ar: `اجعله حسب اللغة: textTransform: isRtl ? "none" : القيمة الحالية، أو rtl:normal-case.` },
  HZ17: { en: `Make it locale-aware: lineHeight: isRtl ? 1.8 : <current>.`, ar: `اجعله حسب اللغة: lineHeight: isRtl ? 1.8 : القيمة الحالية.` },
  HZ18: { en: `Make it locale-aware: wordBreak: isRtl ? "normal" : <current>, or Tailwind rtl:break-normal.`, ar: `اجعله حسب اللغة: wordBreak: isRtl ? "normal" : القيمة الحالية.` },
  HZ12: { en: `Format digits per locale: formatDigits(n) only when isRtl, or new Intl.NumberFormat(locale).format(n).`, ar: `نسّق الأرقام حسب اللغة: formatDigits(n) عند العربية فقط، أو new Intl.NumberFormat(locale).format(n).` },
  HZ20: { en: `Make it locale-aware: fontStyle: isRtl ? "normal" : <current>.`, ar: `اجعله حسب اللغة: fontStyle: isRtl ? "normal" : القيمة الحالية.` },
};

export function fontsLoadedIn(text: string): string[] {
  const out = new Set<string>();
  const add = (f: string) => out.add(f.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase());
  for (const m of text.matchAll(/new\s+FontFace\(\s*["'`]([^"'`]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/loadFont\(\s*\{[^}]*?family\s*:\s*["'`]([^"'`]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*["']?([^;"'}]+)/g)) add(m[1]);
  for (const m of text.matchAll(/@remotion\/google-fonts\/(\w+)/g)) add(m[1]);
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"':]+)/g)) add(decodeURIComponent(m[1]).replace(/\+/g, " "));
  return [...out];
}

export interface Change { code: string; line: number; en: string; ar: string; /** overrides the rule's severity (plain inline letter spans: a warning) */ severity?: "error" | "warning" | "info" }
export interface CodemodResult {
  code: string;
  changed: boolean;
  changes: Change[];
  reports: Change[];
  usesHelper: boolean;
  cssModules: string[];
  /** rendered by Chromium (Remotion) rather than shipped as a web page (`remotion: false`) */
  video?: boolean;
}

interface Edit { start: number; end: number; text: string; change?: Change; prio?: number }

const DISPLAY = new Set(["bebasneue", "anton", "oswald", "montserrat", "archivoblack", "unbounded", "syne", "leaguespartan", "poppins",
  "druk", "spacegrotesk", "clashdisplay", "sora", "bricolagegrotesque", "bigshoulders", "playfairdisplay", "dmserifdisplay", "archivo", "outfit", "lexend"]);
const LATIN_MODULES = new Set([...LATIN_ONLY].map((f) => f.replace(/\s+/g, "")));
const ARABIC_MODULES = new Set([...ARABIC_OFL].map((f) => f.replace(/\s+/g, "")));
/** Arabic-capable families shipped as @remotion/google-fonts modules. */
const GF_ARABIC = ["Alexandria", "Almarai", "Amiri", "AmiriQuran", "BalooBhaijaan2", "Cairo", "CairoPlay", "Changa", "ElMessiri", "Gulzar", "Harmattan",
  "IBMPlexSansArabic", "Kufam", "Lalezar", "Lateef", "Lemonada", "Mada", "Marhey", "MarkaziText", "NotoKufiArabic", "NotoNaskhArabic", "NotoSansArabic",
  "PlaypenSansArabic", "ReadexPro", "ReemKufi", "ReemKufiFun", "ReemKufiInk", "Rubik", "ScheherazadeNew", "Tajawal", "Vazirmatn", "Vibes", "Zain"];
const PLEX_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700"];
const LATIN_RUN = /[A-Za-z][A-Za-z0-9]*(?:[ .\-\u2010-\u2015_'’+&#@/:]+[A-Za-z0-9]+)*/g;
const ESCAPE = /\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g;
const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|\w+);/g;

/** Apply fn to the parts of `raw` that are not escape sequences (or entities). */
function outside(raw: string, re: RegExp, fn: (s: string) => string): string {
  let out = "", last = 0;
  for (const m of raw.matchAll(new RegExp(re.source, "g"))) { out += fn(raw.slice(last, m.index)) + m[0]; last = m.index! + m[0].length; }
  return out + fn(raw.slice(last));
}
function normDigitsText(s: string, to: "eastern" | "western", lang: "ar" | "fa" | "ur" = "ar"): string {
  let out = "", last = 0;
  const conv = (x: string) => to === "eastern" && lang !== "ar"
    ? normalizeDigits(x, "eastern", lang)
    : to === "eastern"
    ? x.replace(/(\d)\.(?=\d)/g, "$1\u066B").replace(/(\d),(?=\d{3}\b)/g, "$1\u066C").replace(/(\d)%/g, "$1\u066A").replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d))).replace(/([\u0660-\u0669]),(?=[\u0660-\u0669]{3}(?![\u0660-\u0669]))/g, "$1\u066C").replace(/([\u0660-\u0669])\.(?=[\u0660-\u0669])/g, "$1\u066B")
    : x.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\u066B/g, ".").replace(/\u066C/g, ",").replace(/\u066A/g, "%");
  for (const m of s.matchAll(new RegExp(LATIN_RUN.source, "g"))) { out += conv(s.slice(last, m.index)) + m[0]; last = m.index! + m[0].length; }
  return out + conv(s.slice(last));
}
function isolateRuns(s: string, open: string, close: string, alreadyOpen: RegExp): string {
  return s.replace(new RegExp(LATIN_RUN.source, "g"), (m, off: number, all: string) => {
    if (alreadyOpen.test(all.slice(Math.max(0, off - 6), off))) return m;
    return `${open}${m}${close}`;
  });
}
const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\s+/g, " ");

function unwrap(n: Node | undefined): Node | undefined {
  while (n && (Node.isParenthesizedExpression(n) || Node.isAsExpression(n))) n = n.getExpression();
  return n;
}
const isJsx = (n: Node | undefined) => !!n && (Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n) || Node.isJsxFragment(n));

function propName(p: Node): string | undefined {
  if (!Node.isPropertyAssignment(p)) return undefined;
  const nm = p.getNameNode();
  if (Node.isIdentifier(nm)) return nm.getText();
  if (Node.isStringLiteral(nm)) return nm.getLiteralValue();
  return undefined;
}

function pass(src: string, o: Required<CodemodOptions>): { edits: Edit[]; reports: Change[]; usesHelper: boolean; cssModules: string[] } {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true, strict: false, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] } });
  const sf: SourceFile = project.createSourceFile(o.fileName.replace(/\.(jsx|js)$/, ".tsx"), src, { overwrite: true });
  const edits: Edit[] = [];
  const reports: Change[] = [];
  const cssModules: string[] = [];
  let usesHelper = /\b(splitArabic|formatDigits|mapArabicWords)\s*\(/.test(src) && new RegExp(`from\\s+["']${o.helperImport.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`).test(src);
  const needHelper = new Set<string>();
  const line = (n: Node) => n.getStartLineNumber();
  // `// harakah-ignore` (same line), `// harakah-ignore-next-line` (or `{/* … */}` in JSX), `harakah-disable-file`
  const supp = lineSuppressions(src);
  if (supp.file === "all") return { edits, reports, usesHelper, cssModules };
  const ignoredAt = (ln: number, code: string) => covers(supp.file, code) || covers(supp.lines.get(ln), code);
  // multilingual apps: inside a component whose Arabic comes only from translations, direction/style fixes would also
  // hit the other locales, so they become reports with a locale-aware suggestion (assigned once components are known)
  let localeAware: (pos: number) => boolean = () => false;
  const localeReported = new Set<string>();
  const edit = (n: Node | { start: number; end: number }, text: string, code: string, en: string, ar: string): boolean => {
    const start = n instanceof Node ? n.getStart() : n.start;
    const end = n instanceof Node ? n.getEnd() : n.end;
    const ln = n instanceof Node ? line(n) : sf.getLineAndColumnAtPos(start).line;
    if (ignoredAt(ln, code)) return false;
    if (LOCALE_AWARE[code] && localeAware(start)) {
      const key = code === "HZ03" ? "HZ03" : `${code}@${ln}`; // one direction note per file, one per line otherwise
      if (localeReported.has(key)) return false;
      localeReported.add(key);
      reports.push({ code, line: ln, en: `${en.replace(/: added /, ": would add ").replace(/\.$/, "")}: not applied, because this text comes from translations and the component also renders other locales. ${LOCALE_AWARE[code].en}`, ar: `${LOCALE_AWARE[code].ar}` });
      return false;
    }
    edits.push({ start, end, text, change: { code, line: ln, en, ar } });
    return true;
  };
  const report = (n: Node, code: string, en: string, ar: string) => { if (!ignoredAt(line(n), code)) reports.push({ code, line: line(n), en, ar }); };

  const fed = new Set(o.arabicComponents ?? []);
  const decls = o.arabicDecls ?? {};
  const shared = o.sharedStyles ?? [];
  // translation calls whose key resolves to Arabic in an ar/fa/ur locale file count as Arabic text
  const i18nAr = (n: Node) => i18nTexts(n, o.i18n);
  const hasI18n = !!o.i18n?.size && i18nAr(sf).length > 0;
  if (!hasArabic(src) && !hasI18n && !o.assumeArabic && !fed.size && !Object.keys(decls).length && !shared.length) return { edits, reports, usesHelper, cssModules };

  // ---- module-level Arabic constants and components
  const arabicConsts = new Set<string>();
  sf.getVariableDeclarations().forEach((d) => { const init = d.getInitializer(); if (init && hasArabic(init.getText())) arabicConsts.add(d.getName()); });
  const components: Node[] = [];
  sf.forEachDescendant((n) => {
    if (!(Node.isArrowFunction(n) || Node.isFunctionDeclaration(n) || Node.isFunctionExpression(n))) return;
    if (n.getFirstAncestor((a) => isJsx(a) || Node.isJsxExpression(a) || Node.isCallExpression(a) && /\.map$|forEach$/.test(a.getExpression().getText()))) return;
    let returnsJsx = false;
    const body = n.getBody();
    if (body && isJsx(unwrap(body))) returnsJsx = true;
    else body?.forEachDescendant((d, t) => {
      if (Node.isArrowFunction(d) || Node.isFunctionDeclaration(d) || Node.isFunctionExpression(d)) { t.skip(); return; }
      if (Node.isReturnStatement(d) && isJsx(unwrap(d.getExpression()))) returnsJsx = true;
    });
    if (returnsJsx) components.push(n);
  });
  const compName = (c: Node): string | undefined => Node.isFunctionDeclaration(c) ? c.getName() : c.getFirstAncestorByKind(ts.SyntaxKind.VariableDeclaration)?.getName();
  // Remotion registration elements (<Composition defaultProps={{…}}>, <Still>, <Folder>) aren't rendered DOM:
  // Arabic in their props belongs to the registered component (see props.ts), not to the Root.
  const REG = /^(Composition|Still|Folder)$/;
  const ownText = (c: Node) => {
    let t = c.getText();
    const base = c.getStart();
    const regs = c.getDescendants().filter((d) => (Node.isJsxSelfClosingElement(d) || Node.isJsxOpeningElement(d)) && REG.test(d.getTagNameNode().getText().split(".").pop()!));
    for (const r of regs.sort((a, b) => b.getStart() - a.getStart())) t = t.slice(0, r.getStart() - base) + t.slice(r.getEnd() - base);
    return t;
  };
  const isArabicComp = (c: Node) => o.assumeArabic || ARABIC_RE.test(ownText(c)) || (hasI18n && i18nAr(c).length > 0) || (fed.size > 0 && fed.has(compName(c) ?? "")) || [...arabicConsts].some((k) => new RegExp(`\\b${k}\\b`).test(ownText(c)));
  const arabicComps = components.filter(isArabicComp);
  // ---- multilingual: which Arabic is per-locale content (translations, `lang === "ar" ? "…" : "…"`, `{ ar: "…", en: "…" }`)
  // and which is literal. Direction/style fixes on per-locale content would also hit the other locales.
  const LOCALE_COND = /\b(?:lang|locale|language|isRtl|isRTL|rtl|isArabic|isAr|dir|direction|currentLang|currentLocale|activeLocale)\b|\.language\b|["'`](?:ar|fa|ur|ps|ckb)(?:-\w+)?["'`]/;
  const OTHER_LANG_KEY = /^["'`]?(?:en|fr|de|es|it|pt|tr|ru|zh|ja|ko|id|ms|nl|hi|he|en[-_]\w+)["'`]?$/;
  const AR_KEY = /^["'`]?(?:ar|fa|ur|ps|ckb)(?:[-_]\w+)?["'`]?$/;
  const isLocaleMap = (n: Node) => Node.isObjectLiteralExpression(n) && (() => {
    const names = n.getProperties().map((p) => Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p) ? p.getNameNode().getText() : "");
    return names.some((k) => AR_KEY.test(k)) && names.some((k) => OTHER_LANG_KEY.test(k));
  })();
  const inLocaleBranch = (n: Node) => n.getAncestors().some((a) => {
    if (Node.isConditionalExpression(a)) {
      const c = a.getCondition();
      return !(c.getPos() <= n.getStart() && n.getEnd() <= c.getEnd()) && LOCALE_COND.test(c.getText());
    }
    if (Node.isBinaryExpression(a) && a.getOperatorToken().getKind() === ts.SyntaxKind.AmpersandAmpersandToken) return a.getRight().getPos() <= n.getStart() && LOCALE_COND.test(a.getLeft().getText());
    return isLocaleMap(a);
  });
  const localeMapConsts = new Set([...arabicConsts].filter((k) => {
    const init = sf.getVariableDeclaration(k)?.getInitializer();
    return !!init && (isLocaleMap(init) || Node.isAsExpression(init) && isLocaleMap(init.getExpression()));
  }));
  const LIT = (d: Node) => (Node.isJsxText(d) || Node.isStringLiteral(d) || Node.isNoSubstitutionTemplateLiteral(d) || Node.isTemplateHead(d) || Node.isTemplateMiddle(d) || Node.isTemplateTail(d)) && hasArabic(d.getText()) && !Node.isImportDeclaration(d.getParent()!);
  const arabicBits = (n: Node) => [n, ...n.getDescendants()].filter((d) => LIT(d) || Node.isIdentifier(d) && arabicConsts.has(d.getText()) && !Node.isVariableDeclaration(d.getParent()!));
  const perLocale = (d: Node) => inLocaleBranch(d) || Node.isIdentifier(d) && localeMapConsts.has(d.getText());
  const hasLiteral = (n: Node) => arabicBits(n).some((d) => !perLocale(d));
  const translated = (n: Node) => (hasI18n && i18nAr(n).length > 0) || arabicBits(n).some(perLocale);
  const fileMultilingual = !!o.multilingual || localeMapConsts.size > 0 || sf.getDescendants().some((d) => LIT(d) && inLocaleBranch(d));
  if (fileMultilingual && !o.assumeArabic) {
    const i18nFed = new Set(o.i18nOnly ?? []);
    const onlyComps = arabicComps.filter((c) => {
      const name = compName(c) ?? "";
      return !hasLiteral(c) && (!fed.has(name) || i18nFed.has(name)) && (translated(c) || i18nFed.has(name));
    });
    localeAware = (pos) => {
      // decide per element first: an element showing literal Arabic is Arabic-only; one showing per-locale text isn't
      const at = sf.getDescendantAtPos(pos);
      // editing inside an Arabic literal (the ar branch of `isAr ? "٣ غرف" : "3 rooms"`) only changes Arabic text
      if (at && LIT(at)) return false;
      const el = at && [at, ...at.getAncestors()].find((a) => Node.isJsxElement(a) || Node.isJsxSelfClosingElement(a));
      if (el) {
        if (hasLiteral(el)) return false;
        if (translated(el)) return true;
      }
      return onlyComps.some((c) => c.getStart() <= pos && pos <= c.getEnd());
    };
  }
  // module-level declarations (e.g. `const styles = {…}`) used by an Arabic component count as Arabic too
  const usedByArabic = new Set<string>();
  for (const c of arabicComps) c.forEachDescendant((d) => { if (Node.isIdentifier(d)) usedByArabic.add(d.getText()); });
  const topLevelName = (n: Node) => {
    for (const a of n.getAncestors()) {
      if (Node.isVariableDeclaration(a)) { const st = a.getVariableStatement(); if (st && Node.isSourceFile(st.getParent())) return a.getName(); }
      if (Node.isFunctionDeclaration(a) && Node.isSourceFile(a.getParent())) return a.getName();
    }
    return undefined;
  };
  const declMode = (n: Node) => { const t = topLevelName(n); return t ? decls[t] : undefined; };
  const inArabic = (n: Node) => o.assumeArabic || arabicComps.some((c) => c.getStart() <= n.getStart() && n.getEnd() <= c.getEnd()) || declMode(n) === "all" ||
    (!n.getFirstAncestor((a) => Node.isArrowFunction(a) || Node.isFunctionDeclaration(a) || Node.isFunctionExpression(a)) && (hasArabic(src) || usedByArabic.has(topLevelName(n) ?? "\0")));

  // ---- 1. per-character splits
  const splitTargets: { node: Node; target: Node; how: string }[] = [];
  sf.forEachDescendant((n) => {
    if (Node.isCallExpression(n)) {
      const ex = n.getExpression();
      const args = n.getArguments();
      if (Node.isPropertyAccessExpression(ex) && ex.getName() === "split" && args.length === 1 && (Node.isStringLiteral(args[0]) || Node.isNoSubstitutionTemplateLiteral(args[0])) && (args[0] as any).getLiteralValue() === "")
        splitTargets.push({ node: n, target: ex.getExpression(), how: ".split('')" });
      else if (ex.getText() === "Array.from" && args.length === 1) splitTargets.push({ node: n, target: args[0], how: "Array.from()" });
    } else if (Node.isArrayLiteralExpression(n)) {
      const els = n.getElements();
      if (els.length === 1 && Node.isSpreadElement(els[0])) splitTargets.push({ node: n, target: els[0].getExpression(), how: "[...str]" });
    }
  });
  // the value of an expression when it is built only from string/number literals and module consts
  const constText = (e: Node | undefined, depth = 0): string | undefined => {
    e = unwrap(e);
    if (!e || depth > 4) return undefined;
    if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) return e.getLiteralValue();
    if (Node.isNumericLiteral(e)) return e.getText();
    if (Node.isBinaryExpression(e) && e.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
      const a = constText(e.getLeft(), depth + 1), b = constText(e.getRight(), depth + 1);
      return a !== undefined && b !== undefined ? a + b : undefined;
    }
    if (Node.isElementAccessExpression(e)) return constText(e.getExpression(), depth + 1); // one char of it
    if (Node.isIdentifier(e)) {
      for (const d of e.getSymbol()?.getDeclarations() ?? []) if (Node.isVariableDeclaration(d) && d.getVariableStatement()?.getDeclarationKind() === "const") return constText(d.getInitializer(), depth + 1);
    }
    return undefined;
  };
  const notStringTyped = (e: Node) => { try { const t = e.getType(); return !(t.isString() || t.isStringLiteral() || t.isAny() || t.isUnknown()); } catch { return false; } };
  // String(n).padStart(4, "0"), n.toFixed(1), `${n}`: digits, never joined letters
  const numericString = (e: Node | undefined, depth = 0): boolean => {
    e = unwrap(e);
    if (!e || depth > 3) return false;
    if (Node.isCallExpression(e)) {
      const ex = e.getExpression();
      const args = e.getArguments();
      if (ex.getText() === "String" && args.length === 1) return notStringTyped(args[0]) || /^(value|count|n|num|number|total|amount|score|year|percent|digits?|index|i)$/i.test(args[0].getText());
      if (Node.isPropertyAccessExpression(ex)) {
        const nm = ex.getName();
        if (/^(toFixed|toPrecision|toExponential)$/.test(nm)) return true;
        if (nm === "toString") return notStringTyped(ex.getExpression());
        if (/^(padStart|padEnd)$/.test(nm) && args[1] && /^["'`][0\s]["'`]$/.test(args[1].getText())) return true;
        if (/^(padStart|padEnd|trim|slice|substring)$/.test(nm)) return numericString(ex.getExpression(), depth + 1);
      }
    }
    if (Node.isTemplateExpression(e)) return e.getHead().getLiteralText() === "" && e.getTemplateSpans().every((sp) => sp.getLiteral().getLiteralText() === "" && notStringTyped(sp.getExpression()));
    if (Node.isIdentifier(e)) { for (const d of e.getSymbol()?.getDeclarations() ?? []) if (Node.isVariableDeclaration(d)) return numericString(d.getInitializer(), depth + 1); }
    return false;
  };
  // Array.from({ length: 12 }), [...new Set(x)], Array.from(el.children), map.keys(): not text
  const notText = (e: Node) => {
    const u = unwrap(e)!;
    if (Node.isObjectLiteralExpression(u) || Node.isArrayLiteralExpression(u) || Node.isNewExpression(u) || Node.isNumericLiteral(u)) return true;
    if (Node.isCallExpression(u) && /\.(keys|values|entries|querySelectorAll|getElementsByClassName|getElementsByTagName)$/.test(u.getExpression().getText())) return true;
    return /\.(children|childNodes)$/.test(u.getText());
  };
  // chars.slice(0, n).join("") (typewriter): the letters are joined back into one string, never boxed
  const rejoined = (node: Node) => {
    let p: Node = node;
    for (;;) {
      const pa = p.getParent();
      if (!pa || !Node.isPropertyAccessExpression(pa) || pa.getExpression() !== p) break;
      const nm = pa.getName();
      if (nm === "join" || nm === "length") return true;
      const call = pa.getParent();
      if (/^(slice|filter|concat)$/.test(nm) && call && Node.isCallExpression(call)) { p = call; continue; }
      break;
    }
    const d = node.getParentIfKind(SyntaxKind.VariableDeclaration);
    const nameNode = d?.getNameNode();
    if (!d || !nameNode || !Node.isIdentifier(nameNode)) return false;
    const scope = d.getFirstAncestor((a) => Node.isBlock(a) || Node.isSourceFile(a)) ?? sf;
    const uses = scope.getDescendantsOfKind(SyntaxKind.Identifier).filter((id) => id.getText() === nameNode.getText() && id !== nameNode);
    return uses.length > 0 && uses.every((id) => {
      const after = src.slice(id.getEnd(), id.getEnd() + 80);
      return /^\s*\.\s*(length\b|join\s*\(|slice\s*\([^()]*\)\s*\.\s*join\s*\()/.test(after);
    });
  };
  // .map((c) => <span style={{ opacity }}>{c}</span>) in a block container: plain inline boxes keep Chrome's shaping
  // across the span boundaries (measured: same width as running text), so the letters join in the render. Still
  // fixed, as a warning: other browsers (Safari previews of Studio / Player) may shape each span alone, and the first transform,
  // inline-block or padding added to the span breaks the word in Chrome too. splitArabic() renders the same in Chrome.
  const INLINE_TAGS = /^(span|b|i|em|strong|small|mark|u|s|sup|sub)$/;
  const SAFE_STYLE = /^(opacity|color|textShadow|background|backgroundColor|WebkitTextFillColor|textDecoration|textDecorationColor)$/;
  const plainInlineMap = (splitNode: Node) => {
    const pa = splitNode.getParent();
    if (!pa || !Node.isPropertyAccessExpression(pa) || pa.getName() !== "map") return false;
    const call = pa.getParent();
    if (!call || !Node.isCallExpression(call)) return false;
    const cb = call.getArguments()[0];
    if (!cb || !(Node.isArrowFunction(cb) || Node.isFunctionExpression(cb))) return false;
    let body = unwrap(cb.getBody() as Node);
    if (body && Node.isBlock(body)) { const rets = body.getDescendantsOfKind(SyntaxKind.ReturnStatement); body = rets.length === 1 ? unwrap(rets[0].getExpression()) : undefined; }
    if (!body || !(Node.isJsxElement(body) || Node.isJsxSelfClosingElement(body))) return false;
    const op = Node.isJsxElement(body) ? body.getOpeningElement() : body;
    if (!INLINE_TAGS.test(op.getTagNameNode().getText())) return false;
    for (const a of op.getAttributes()) {
      if (!Node.isJsxAttribute(a)) return false;
      const nm = a.getNameNode().getText();
      if (nm === "key" || /^(aria-|data-)/.test(nm)) continue;
      if (nm !== "style") return false;
      const ex = (a.getInitializer() as any)?.getExpression?.();
      if (!ex || !Node.isObjectLiteralExpression(ex)) return false;
      if (!ex.getProperties().every((pp) => Node.isPropertyAssignment(pp) && SAFE_STYLE.test(propName(pp) ?? ""))) return false;
    }
    const host = call.getFirstAncestor((a) => Node.isJsxElement(a));
    if (!host || !Node.isJsxElement(host)) return false;
    const hostOpen = host.getOpeningElement();
    if (!/^[a-z]/.test(hostOpen.getTagNameNode().getText())) return false;
    return !/display\s*:\s*["'`](inline-)?(flex|grid)|className=/.test(hostOpen.getText());
  };
  // `/[\u0600-\u06FF]/.test(name) ? name.split(/(\s+)/) : [...name]`: the author already splits Arabic per word and only
  // character-splits the non-Arabic branch (also `isArabic(x) ? … : …`, `!rtl.test(x) ? [...x] : …`, if/else, early return)
  const ARABIC_TEST = /[\u0600-\u06FF]|\\u06[0-9a-f]{2}|\\u0?6[0-9a-f]{2}|\b\w*(?:arab|rtl|isAr)\w*\b|lang(?:uage)?\s*={2,3}\s*["'`]ar|locale\s*={2,3}\s*["'`]ar/i;
  const negated = (c: Node) => { const t = c.getText().trim(); return t.startsWith("!") && !t.startsWith("!="); };
  const arabicGuarded = (n: Node): boolean => {
    let child: Node = n;
    for (let a = n.getParent(); a; child = a, a = a.getParent()) {
      if (Node.isArrowFunction(a) || Node.isFunctionDeclaration(a) || Node.isFunctionExpression(a) || Node.isMethodDeclaration(a)) return false;
      if (Node.isConditionalExpression(a) || Node.isIfStatement(a)) {
        const cond = Node.isConditionalExpression(a) ? a.getCondition() : a.getExpression();
        if (cond === child || !ARABIC_TEST.test(cond.getText())) continue;
        const elseSide = Node.isConditionalExpression(a) ? a.getWhenFalse() : a.getElseStatement();
        // the split sits in the branch taken when the text is NOT Arabic
        if ((child === elseSide) !== negated(cond)) return true;
      }
    }
    return false;
  };
  // `const next = [...prev]; next.push(x)` / `[...items]`: an array copy (setState updaters), not a string split
  const COLLECTION_NAME = /^(?:prev|next|state|draft|items?|list|arr(?:ay)?|rows|nodes|els|elements|children|keys|values|entries|ids|data|queue|stack|selected|opened|open|tags|slugs)$/i;
  const arrayCopy = (s: { node: Node; target: Node; how: string }) => {
    if (s.how !== "[...str]" && s.how !== "Array.from()") return false;
    if (Node.isIdentifier(s.target) && COLLECTION_NAME.test(s.target.getText())) return true;
    const d = s.node.getParentIfKind(SyntaxKind.VariableDeclaration);
    return !!d && new RegExp(`\\b${d.getName()}\\s*\\.\\s*(?:push|pop|splice|unshift|shift|fill)\\s*\\(`).test(src);
  };
  for (const s of splitTargets) {
    // shared helpers ("safe") too: splitArabic returns the same graphemes as split("") for Latin text
    if (!inArabic(s.node) && declMode(s.node) !== "safe") continue;
    if (notText(s.target) || numericString(s.target) || rejoined(s.node)) continue;
    const ct = constText(s.target);
    if (ct !== undefined && !hasArabicLetter(ct)) continue; // digits/punctuation only: nothing to join
    const plain = plainInlineMap(s.node);
    if (arabicGuarded(s.node)) continue;
    let stringy = Node.isStringLiteral(s.target) || Node.isNoSubstitutionTemplateLiteral(s.target) || Node.isTemplateExpression(s.target) || (hasI18n && i18nAr(s.target).length > 0);
    let unknown = false;
    if (!stringy) {
      try {
        const t = s.target.getType();
        if (t.isString() || t.isStringLiteral() || (t.isUnion() && t.getUnionTypes().every((u) => u.isString() || u.isStringLiteral()))) stringy = true;
        else if (t.isAny() || t.isUnknown()) unknown = true;
      } catch { unknown = true; }
    }
    const consumedByMap = (() => { const p = s.node.getParent(); return !!p && Node.isPropertyAccessExpression(p) && p.getName() === "map"; })();
    const assignedThenMapped = (() => {
      const d = s.node.getParentIfKind(SyntaxKind.VariableDeclaration);
      if (!d) return false;
      return new RegExp(`\\b${d.getName()}\\s*\\.\\s*map\\s*\\(`).test(src);
    })();
    if (stringy || (unknown && (consumedByMap || assignedThenMapped) && /text|title|label|word|str|line|caption|headline|name|heading|copy|kicker/i.test(s.target.getText()))) {
      const arg = s.target.getText() + (o.split === "word" ? `, "word"` : "");
      const kind = o.split === "word" ? "per-word" : "ZWJ-padded graphemes, لا kept, diacritics attached";
      const kindAr = o.split === "word" ? "كلمة كلمة" : "حروف متصلة بواصل صفري مع «لا» والتشكيل";
      if (!edit(s.node, `/* harakah: was ${short(s.node.getText().replace(/\*\//g, ""), 30)} */ splitArabic(${arg})`, "HZ02",
        plain
          ? `Per-character split ${s.how} → splitArabic() (${kind}). These plain spans still join in Chrome's render, but the letters can come apart in other browsers (Safari previews of Remotion Studio or Player) and do as soon as a span gets a transform, inline-block or padding.`
          : `Per-character split ${s.how} → splitArabic() (${kind}).`,
        plain
          ? `تقسيم الحروف ${s.how} ← splitArabic() (${kindAr}). الحروف هنا متصلة في رندر Chrome، لكنها قد تظهر مقطّعة في متصفحات أخرى (مثل معاينة Safari في Remotion Studio أو Player)، وتتقطّع فعلاً بمجرد أن تضيف transform أو inline-block أو padding للحرف.`
          : `تقسيم الحروف ${s.how} ← splitArabic() (${kindAr}).`)) continue;
      if (plain) edits[edits.length - 1].change!.severity = "warning";
      needHelper.add("splitArabic");
      if (o.split !== "word" && !plain) {
        const host = s.node.getFirstAncestor((a) => Node.isJsxElement(a));
        const open = host && Node.isJsxElement(host) ? host.getOpeningElement().getText() : "";
        if (host && !/display\s*:\s*["'`](inline-)?flex|whiteSpace\s*:\s*["'`]nowrap|flex|nowrap/.test(open) && !(o.wrapWords && (consumedByMap || assignedThenMapped))) {
          report(s.node, "HZ02", `Per-letter boxes inside a wrapping container can break a line in the middle of a word. Wrap each word in a nowrap box (as <ArabicText> does), add whiteSpace: "nowrap" to the container, or use --split word.`,
            `صناديق الحروف داخل حاوية تلتف قد تكسر السطر وسط الكلمة؛ ضع كل كلمة في صندوق nowrap (كما يفعل ArabicText) أو استخدم --split word.`);
        }
      }
    } else if (unknown && !arrayCopy(s)) {
      report(s.node, "HZ02", `Possible per-character split ${s.how} on "${short(s.target.getText(), 30)}" (type unknown). If it is text, replace with splitArabic(${short(s.target.getText(), 30)}).`,
        `احتمال تقسيم نص إلى حروف ${s.how}؛ إن كان نصاً فاستبدله بـ splitArabic().`);
    }
  }

  // ---- 1b. keep words together (--wrap-words): splitArabic(x).map(cb) → mapArabicWords(splitArabic(x), cb)
  if (o.wrapWords && o.split !== "word") {
    const splitVars = new Set<string>();
    sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach((d) => { const i = unwrap(d.getInitializer()); if (i && Node.isCallExpression(i) && i.getExpression().getText() === "splitArabic" && !/"word"|'word'/.test(i.getArguments()[1]?.getText() ?? "")) splitVars.add(d.getName()); });
    sf.forEachDescendant((n) => {
      if (!Node.isCallExpression(n)) return;
      const ex = n.getExpression();
      if (!Node.isPropertyAccessExpression(ex) || ex.getName() !== "map" || n.getArguments().length !== 1) return;
      const obj = ex.getExpression();
      const isSplit = (Node.isCallExpression(obj) && obj.getExpression().getText() === "splitArabic" && !/"word"|'word'/.test(obj.getArguments()[1]?.getText() ?? "")) || (Node.isIdentifier(obj) && splitVars.has(obj.getText()));
      if (!isSplit || !inArabic(n)) return;
      const cb = n.getArguments()[0];
      // the callback must render JSX and must not use the 3rd (array) parameter, whose meaning would change
      if ((Node.isArrowFunction(cb) || Node.isFunctionExpression(cb)) && cb.getParameters().length > 2) {
        report(n, "HZ02", "Keep-words-together skipped: the .map callback uses its array parameter. Wrap each word in a nowrap span manually.", "تعذّر تجميع الكلمات تلقائياً: الدالة تستخدم المصفوفة؛ ضع كل كلمة في صندوق nowrap يدوياً.");
        return;
      }
      if (!isJsx(unwrap(Node.isArrowFunction(cb) || Node.isFunctionExpression(cb) ? (cb.getBody() as Node) : cb)) && !/<\w/.test(cb.getText())) return;
      if (edit(n, `mapArabicWords(${obj.getText()}, ${cb.getText()}) /* harakah: words kept together */`, "HZ02",
        "Keep words together: per-letter boxes grouped into nowrap word boxes (mapArabicWords), so lines break only between words. Letter animation and stagger unchanged.",
        "تجميع حروف كل كلمة في صندوق لا يلتف (mapArabicWords): يلتف السطر بين الكلمات فقط، والحركة كما هي.")) needHelper.add("mapArabicWords");
    });
  }

  // ---- 2. style properties
  const styleProps: Record<string, (init: Node, prop: Node) => void> = {
    letterSpacing: (init) => {
      const v = init.getText();
      if (/^(0|["'`](0(px|em)?|normal)["'`])$/.test(v)) return;
      edit(init, `0 /* harakah: letterSpacing removed for Arabic (was ${short(v.replace(/\*\//g, ""), 30)}) */`, "HZ07",
        `letterSpacing ${short(v, 24)} → 0 (tracking: Arabic joins break in Safari/Firefox, word gaps widen in Chrome${Node.isLiteralExpression(init) ? "" : "; animate scale/opacity instead"}).`, `letterSpacing ${short(v, 24)} ← 0.`);
    },
    textTransform: (init) => {
      if (/^["'`]none["'`]$/.test(init.getText())) return;
      edit(init, `"none" /* harakah: no case in Arabic */`, "HZ08", `textTransform ${init.getText()} → "none".`, `textTransform ← none.`);
    },
    fontVariant: (init) => { if (/small-caps/.test(init.getText())) edit(init, `"normal" /* harakah */`, "HZ08", `fontVariant small-caps → normal.`, `fontVariant ← normal.`); },
    textAlign: (init) => { if (/^["'`]left["'`]$/.test(init.getText())) edit(init, `"start" /* harakah: follows dir=rtl */`, "HZ06", `textAlign "left" → "start".`, `textAlign ← start.`); },
    wordBreak: (init) => { if (/^["'`]break-all["'`]$/.test(init.getText())) edit(init, `"normal" /* harakah */`, "HZ18", `wordBreak "break-all" → "normal".`, `wordBreak ← normal.`); },
    direction: (init) => { if (/^["'`]ltr["'`]$/.test(init.getText())) edit(init, `"rtl" /* harakah */`, "HZ03", `direction "ltr" → "rtl" on Arabic content.`, `direction ← rtl.`); },
    lineHeight: (init, prop) => {
      if (!Node.isNumericLiteral(init)) return;
      const v = Number(init.getText());
      const el = prop.getFirstAncestor((a) => Node.isJsxElement(a));
      const txt = el ? el.getText() : "";
      const level = tashkeelLevel(txt);
      // an occasional shadda/tanween fits normal leading; full vocalization needs ~1.8
      if (level === "none" || v >= 1.6 || (level === "sparse" && v >= 1.3)) return;
      const clip = prop.getAncestors().filter((a) => Node.isJsxElement(a)).slice(1, 4).find((a) => {
        const st = (a as any).getOpeningElement().getText() as string;
        return /overflow\s*:\s*["'`](hidden|clip)/.test(st) && /\b(height|maxHeight)\s*:\s*["'`]?\d/.test(st);
      });
      if (clip) { report(prop, "HZ17", `lineHeight ${v} with tashkeel inside a fixed-height overflow:hidden box (line ${clip.getStartLineNumber()}): raising lineHeight would clip more. Suggested patch: lineHeight: 1.8 and replace the fixed height with minHeight (or remove overflow: hidden).`, `ارتفاع السطر ${v} مع تشكيل داخل صندوق بارتفاع ثابت وoverflow مخفي؛ اقترح: lineHeight: 1.8 واستبدال height بـ minHeight.`); return; }
      const to = level === "dense" ? "1.8" : "1.5";
      edit(init, `${to} /* harakah: room for tashkeel (was ${v}) */`, "HZ17", `lineHeight ${v} → ${to} (diacritics).`, `lineHeight ${v} ← ${to} (للتشكيل).`);
    },
    fontStyle: (init, prop) => { if (/italic|oblique/.test(init.getText())) report(prop, "HZ20", `fontStyle ${init.getText()} on Arabic: most Arabic fonts have no italic.`, `خط مائل على نص عربي.`); },
  };
  // the element a `style={{ … }}` literal belongs to, when its content is static text with no Arabic letter
  // (e.g. a "WEEKLY ROUNDUP" kicker inside an Arabic scene): the Latin look stays
  const staticLatin = (ch: Node): boolean => {
    if (Node.isJsxText(ch)) return !hasArabicLetter(ch.getText());
    if (Node.isJsxExpression(ch)) {
      const e = unwrap(ch.getExpression());
      if (!e) return true;
      if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) return !hasArabicLetter(e.getLiteralValue());
      // {t("brand")} where the Arabic locale keeps it Latin ("Acme")
      if ((Node.isCallExpression(e) || Node.isPropertyAccessExpression(e) || Node.isElementAccessExpression(e)) && o.i18n?.size) { const v = i18nValue(e, o.i18n); return v !== undefined && /[A-Za-z]/.test(v) && !hasArabicLetter(v); }
      // {item} mapped over a dictionary array whose values stay Latin
      if (Node.isIdentifier(e) && o.i18n?.size) { const v = i18nValue(e, o.i18n); if (v !== undefined) return /[A-Za-z]/.test(v) && !hasArabicLetter(v); }
      // {label} where `const label = "WEEKLY ROUNDUP"` (a const bound to a Latin literal)
      if (Node.isIdentifier(e)) {
        const d = e.getSymbol()?.getDeclarations()?.find((x) => Node.isVariableDeclaration(x));
        const init = d && Node.isVariableDeclaration(d) && d.getVariableStatement()?.getDeclarationKind() === "const" ? unwrap(d.getInitializer()) : undefined;
        return !!init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) && /[A-Za-z]/.test(init.getLiteralValue()) && !hasArabicLetter(init.getLiteralValue());
      }
      return false;
    }
    if (Node.isJsxElement(ch)) return /^[a-z]/.test(ch.getOpeningElement().getTagNameNode().getText()) && ch.getJsxChildren().every(staticLatin);
    if (Node.isJsxSelfClosingElement(ch)) return /^(br|img|hr|svg|path|i)$/.test(ch.getTagNameNode().getText());
    return false;
  };
  const latinOnlyElement = (prop: Node) => {
    const lit = prop.getParent();
    const jx = lit?.getParent();
    const at = jx?.getParent();
    if (!lit || !jx || !at || !Node.isJsxExpression(jx) || !Node.isJsxAttribute(at) || at.getNameNode().getText() !== "style") return false;
    const op = at.getParent()?.getParent();
    const el = op && Node.isJsxOpeningElement(op) ? op.getParent() : undefined;
    if (!el || !Node.isJsxElement(el)) return false;
    const kids = el.getJsxChildren().filter((k) => !(Node.isJsxText(k) && !k.getText().trim()));
    return kids.length > 0 && kids.every(staticLatin);
  };
  sf.forEachDescendant((n) => {
    if (!Node.isPropertyAssignment(n)) return;
    const nm = propName(n);
    if (!nm || !(nm in styleProps)) return;
    if (!Node.isObjectLiteralExpression(n.getParent())) return;
    if (!inArabic(n)) return;
    if (latinOnlyElement(n)) return;
    // `"left" as const` / `"uppercase" satisfies …`: fix the literal inside
    let init = n.getInitializer();
    while (init && (Node.isAsExpression(init) || Node.isSatisfiesExpression(init) || Node.isParenthesizedExpression(init))) init = init.getExpression();
    if (init) styleProps[nm](init, n);
  });

  // ---- 2b. shared style objects from other files (theme.ts / styles.ts also used by Latin components):
  // keep the shared object, override the Arabic-breaking props where an Arabic component uses it
  if (shared.length) {
    const REF = /^([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*|\[["'][^"'\]]+["']\])*)$/;
    const lookup = (e: Node | undefined) => {
      const m = e && unwrap(e)?.getText().match(REF);
      if (!m) return undefined;
      const st = shared.find((x) => x.local === m[1]);
      const at = m[2].replace(/\[["']([^"']+)["']\]/g, ".$1").replace(/^\./, "");
      const ov = st?.overrides[at];
      return st && ov?.length ? { st, ov, text: unwrap(e)!.getText() } : undefined;
    };
    const describe = (st: { from: string }, ov: [string, string, string][], text: string) => [
      `Shared style ${text} (${st.from}, also used by Latin components) kept as is; Arabic override here: ${ov.map(([k, v, was]) => `${k} ${short(was, 16)} → ${v}`).join(", ")}.`,
      `النمط المشترك ${text} من ${st.from} بقي كما هو للنص اللاتيني، وأُضيف تعديل عربي هنا: ${ov.map(([k, v]) => `${k} ← ${v}`).join("، ")}.`] as const;
    const handled = new Set<string>();
    // already overridden in an earlier pass (`{ ...theme.title, letterSpacing: 0 }`) counts as handled
    sf.forEachDescendant((n) => { if (Node.isSpreadAssignment(n)) { const h = lookup(n.getExpression()); if (h) handled.add(h.text); } });
    sf.forEachDescendant((n) => {
      // style={theme.title} → style={{ ...theme.title, letterSpacing: 0 }}
      if (Node.isJsxAttribute(n) && /style$/i.test(n.getNameNode().getText()) && inArabic(n)) {
        const init = n.getInitializer();
        const ex = init && Node.isJsxExpression(init) ? init.getExpression() : undefined;
        const hit = lookup(ex);
        if (!hit || !ex) return;
        const [en, ar] = describe(hit.st, hit.ov, hit.text);
        edit(ex, `{ ...${hit.text}, ${hit.ov.map(([k, v]) => `${k}: ${v}`).join(", ")} /* harakah: Arabic override of shared ${hit.st.from} style */ }`, STYLE_FIX[hit.ov[0][0]]?.code ?? "HZ07", en, ar);
        handled.add(hit.text);
      }
      // { ...theme.title, color } → { ...theme.title, letterSpacing: 0, color } (unless set later in the literal)
      else if (Node.isSpreadAssignment(n) && Node.isObjectLiteralExpression(n.getParent()) && inArabic(n)) {
        const hit = lookup(n.getExpression());
        if (!hit) return;
        const lit = n.getParent() as import("ts-morph").ObjectLiteralExpression;
        const later = new Set(lit.getProperties().filter((p) => p.getStart() > n.getStart()).map((p) => (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p) ? p.getName().replace(/^["'`]|["'`]$/g, "") : "")));
        const ov = hit.ov.filter(([k]) => !later.has(k));
        if (!ov.length) return;
        const [en, ar] = describe(hit.st, ov, hit.text);
        edit({ start: n.getEnd(), end: n.getEnd() }, `, ${ov.map(([k, v]) => `${k}: ${v}`).join(", ")} /* harakah: Arabic override of shared ${hit.st.from} style */`, STYLE_FIX[ov[0][0]]?.code ?? "HZ07", en, ar);
        handled.add(hit.text);
      }
    });
    // shared style paths used by Arabic code in a way we can't rewrite (passed as a prop, merged by a function…)
    sf.forEachDescendant((n) => {
      if (!Node.isPropertyAccessExpression(n) && !Node.isIdentifier(n)) return;
      if (Node.isPropertyAccessExpression(n.getParent()!) && (n.getParent() as any).getExpression() === n) return; // only the full chain
      const hit = lookup(n);
      if (!hit || handled.has(hit.text) || !inArabic(n) || n.getFirstAncestor((x) => Node.isImportDeclaration(x))) return;
      handled.add(hit.text);
      report(n, STYLE_FIX[hit.ov[0][0]]?.code ?? "HZ07", `Shared style ${hit.text} (${hit.st.from}, also used by Latin components) has ${hit.ov.map(([k, , was]) => `${k}: ${short(was, 16)}`).join(", ")}, which breaks Arabic. It is used here in a way Harakah can't rewrite; override it for Arabic: { ...${hit.text}, ${hit.ov.map(([k, v]) => `${k}: ${v}`).join(", ")} }.`,
        `النمط المشترك ${hit.text} من ${hit.st.from} يكسر العربية (${hit.ov.map(([k]) => k).join("، ")})؛ أضف تعديلاً عربياً حيث يُستخدم.`);
    });
  }

  // ---- 3. tagged CSS templates (styled-components / emotion / css``)
  sf.forEachDescendant((n) => {
    if (!Node.isTaggedTemplateExpression(n)) return;
    const tag = n.getTag().getText();
    if (!/^(styled\b|css$|keyframes$|createGlobalStyle$|styled\()/.test(tag)) return;
    const tpl = n.getTemplate();
    const raw = tpl.getText();
    const fixed = fixCssText(raw);
    if (fixed.text !== raw) edit(tpl, fixed.text, "HZ07", `CSS-in-JS (${short(tag, 20)}): ${fixed.notes.join(", ")}.`, `CSS داخل JS: ${fixed.notes.join("، ")}.`);
  });

  // ---- 4. className: Tailwind tokens, the author's RTL variants (`rtl:tracking-normal`) and project CSS classes
  // (`.label { letter-spacing: … }` softened by `html[dir="rtl"] .label`). The author's RTL value decides.
  const PROP_CODE: Record<ArabicProp, string> = { "letter-spacing": "HZ07", "text-transform": "HZ08", "font-variant": "HZ08", "text-align": "HZ06", "word-break": "HZ18" };
  const RTL_VARIANT = /^(?:rtl|ar|\[dir=rtl\]|\[\[dir=rtl\]_&\]|\[\[dir=rtl\]_\&\]|\[&:dir\(rtl\)\]|\[&:lang\(ar\)\]|\[:lang\(ar\)_&\]|group-\[\[dir=rtl\]\]):(.+)$/;
  const SAFE_TW: Record<ArabicProp, string> = { "letter-spacing": "tracking-normal", "text-transform": "normal-case", "font-variant": "normal-nums", "text-align": "text-start", "word-break": "break-normal" };
  const classUses = new Map<string, { node: Node; code: string; lines: number[]; en: string; ar: string }>();
  sf.forEachDescendant((n) => {
    if (!Node.isJsxAttribute(n) || n.getNameNode().getText() !== "className") return;
    const init = n.getInitializer();
    if (!init || !inArabic(n)) return;
    // literal pieces of the class value: "…", {`… ${x} …`}, {cn("…", on && "…", { "…": c }, ["…"])}, clsx/classnames/cx/twMerge/twJoin
    const segs = classSegments(init);
    if (!segs.length) return;
    // <a className="… break-all">name@example.com</a>: the element only shows Latin
    const owner = n.getParent()?.getParent();
    const ownerEl = owner && Node.isJsxOpeningElement(owner) ? owner.getParent() : undefined;
    if (ownerEl && Node.isJsxElement(ownerEl)) {
      const kids = ownerEl.getJsxChildren().filter((k) => !(Node.isJsxText(k) && !k.getText().trim()));
      if (kids.length > 0 && kids.every(staticLatin)) return;
    }
    const tag = owner && (Node.isJsxOpeningElement(owner) || Node.isJsxSelfClosingElement(owner)) ? owner.getTagNameNode().getText() : "";
    const v = segs.map((x) => x.text).join(" ");
    const toks = v.split(/\s+/).filter(Boolean);
    // the author's RTL value for a property: an rtl: variant on this element, else a project RTL rule on its classes
    const rtlValue = (prop: ArabicProp) => {
      for (const t of toks) { const m = t.match(RTL_VARIANT); const d = m && twDecl(m[1]); if (d && d.prop === prop) return { value: d.value, from: t, token: t, root: false }; }
      const pv = projectValue(o.projectCss, toks, tag, prop).rtl;
      return pv ? { value: pv.value, from: `${pv.selector} (${pv.file})`, token: undefined as string | undefined, root: pv.root } : undefined;
    };
    const map: Record<string, string> = { uppercase: "normal-case", capitalize: "normal-case", "text-left": "text-start", "break-all": "break-normal" };
    const safeTok = (t: string) => (/^tracking-(?!normal)/.test(t) ? "tracking-normal" : map[t] ?? t);
    const twCode = (t: string) => (/^tracking-/.test(t) ? "HZ07" : /^(uppercase|capitalize)$/.test(t) ? "HZ08" : t === "text-left" ? "HZ06" : t === "break-all" ? "HZ18" : "HZ07");
    const twProp = (t: string) => twDecl(t)?.prop;
    // decide per token: the author's RTL value may already make it safe, or be the thing to fix
    type Plan = { to: string; note?: string; skip?: boolean; variant?: { token: string; to: string; was: string }; report?: string };
    const decide = (t: string): Plan => {
      const to = safeTok(t);
      if (to === t) return { to: t };
      const prop = twProp(t);
      const r = prop && rtlValue(prop);
      if (!r || (r.root && !o.rtlContext)) return { to, note: r ? ` (The project's ${r.from} sets ${r.value}, but only once <html> is RTL, and nothing in this app makes it so.)` : "" };
      if (arabicSafe(prop!, r.value)) return { to: t, skip: true };
      // a soft RTL value: fix the rtl: variant itself (LTR untouched), or report the project rule (it outranks utilities)
      if (r.token) return { to: t, variant: { token: r.token, to: r.token.replace(/:.+$/, ":" + SAFE_TW[prop!]), was: r.value } };
      return { to: t, report: `className: ${t} on Arabic text; the project's own RTL value ${r.value} from ${r.from} applies instead and outranks the utility, but it is not 0. Set it to ${prop === "letter-spacing" ? "0" : "none"} there (or add a :lang(ar) rule).` };
    };
    const where = segs.length === 1 && Node.isStringLiteral(init) ? "" : " (in a class expression)";
    for (const sg of segs) {
      // an identifier key in a class object ({ uppercase: isTitle }): replace the key with the safe class as a string key
      if (sg.ident) {
        const p = decide(sg.text);
        if (p.report) report(n, twCode(sg.text), p.report, `className: ${sg.text}: قيمة المشروع للعربية ليست صفراً؛ اضبطها على 0 في ملف CSS.`);
        else if (p.to !== sg.text && !p.variant) edit(sg.ident, JSON.stringify(p.to), twCode(sg.text), `className: ${sg.text} → ${p.to} (Tailwind, Arabic-safe)${where}.${p.note ?? ""}`, `className: ${sg.text} ← ${p.to}.`);
        continue;
      }
      if (sg.escaped) { // escapes in a plain literal: replace it whole
        const lt = sg.node!;
        const lv = Node.isStringLiteral(lt) ? lt.getLiteralValue() : sg.text;
        const lts = lv.split(/\s+/).filter(Boolean);
        const whole = lts.map((t) => { const p = decide(t); return p.variant ? p.variant.to : p.to; });
        if (whole.join(" ") !== lts.join(" ")) edit(lt, JSON.stringify(whole.join(" ")), twCode(lts.find((t, i) => whole[i] !== t)!), `className "${short(lv, 30)}" → "${short(whole.join(" "), 30)}" (Tailwind tracking/case/align).`, `تعديل أصناف Tailwind للعربية.`);
        continue;
      }
      // one edit per token, so each carries its own rule code (tracking HZ07, case HZ08, text-left HZ06, break-all HZ18)
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sg.text))) {
        const t = m[0];
        if ((m.index === 0 && sg.partialStart) || (m.index + t.length === sg.text.length && sg.partialEnd)) continue; // glued to ${…}
        const p = decide(t);
        if (p.variant) {
          // the rtl: variant may sit in another piece of the expression
          for (const s2 of segs) {
            const at = s2.ident ? -1 : s2.text.search(new RegExp(`(^|\\s)${p.variant.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`));
            if (at < 0) continue;
            const off = at + (/\s/.test(s2.text[at]) ? 1 : 0);
            edit({ start: s2.base + off, end: s2.base + off + p.variant.token.length }, p.variant.to, twCode(t),
              `className: ${p.variant.token} (the author's RTL value ${p.variant.was}) → ${p.variant.to}: still breaks Arabic joins in Safari/Firefox. LTR keeps ${t}.`, `className: ${p.variant.token} ← ${p.variant.to}.`);
            break;
          }
        } else if (p.report) report(n, twCode(t), p.report, `className: ${t}: قيمة المشروع للعربية ليست صفراً؛ اضبطها على 0 في ملف CSS.`);
        else if (p.to !== t) edit({ start: sg.base + m.index, end: sg.base + m.index + t.length }, p.to, twCode(t), `className: ${t} → ${p.to} (Tailwind, Arabic-safe)${where}.${p.note ?? ""}`, `className: ${t} ← ${p.to}.`);
      }
    }
    // plain project classes (`.label { letter-spacing: var(--tracking-label) }` in globals.css): report-only, never edit global CSS
    if (!o.projectCss) return;
    // evidence the element shows Arabic: Arabic text/literals inside it, an Arabic translation value, or an Arabic
    // module const (an email, a year or `{exp.duration}` of unknown script in an Arabic component isn't enough)
    const el = ownerEl ?? owner;
    const showsArabic = !!el && (o.assumeArabic || hasArabic(el.getText()) || i18nAr(el).length > 0 ||
      el.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => arabicConsts.has(id.getText())));
    if (!showsArabic) return;
    const twSet = new Set(toks.map(twProp).filter(Boolean));
    // only properties that actually break Arabic (text-transform doesn't change Arabic glyphs; reporting every
    // `uppercase` label class was noise on real projects)
    for (const prop of ["letter-spacing", "word-break", "text-align"] as ArabicProp[]) {
      if (twSet.has(prop)) continue;
      const pv = projectValue(o.projectCss, toks, tag, prop);
      if (!pv.base || arabicSafe(prop, pv.base.value)) continue;
      const r = rtlValue(prop);
      if (r && !(r.root && !o.rtlContext) && arabicSafe(prop, r.value)) continue; // the author already handles RTL
      const cls = pv.base.classes.map((c) => "." + c).join("");
      const fixTo = prop === "letter-spacing" ? "0" : prop === "text-align" ? "start" : prop === "word-break" ? "normal" : "none";
      const tail = !r ? ` Add an Arabic override in ${pv.base.file}: :lang(ar) ${cls}, [dir="rtl"] ${cls} { ${prop}: ${fixTo}; }.`
        : r.root && !o.rtlContext ? ` The project's ${r.from} sets ${r.value}, but only once <html> is RTL, and nothing in this app makes it so.`
        : ` The project's own RTL value is ${r.value} (${r.from}): softer, but still not ${fixTo}. Set it to ${fixTo} there.`;
      // one report per project rule per file (a `.label` used 12 times is one problem in globals.css)
      const key = `${prop}|${pv.base.selector}|${pv.base.file}|${r?.from ?? ""}`;
      const g = classUses.get(key);
      if (g) { g.lines.push(line(n)); continue; }
      classUses.set(key, { node: n, code: PROP_CODE[prop], lines: [line(n)],
        en: `${cls} in ${pv.base.file} sets ${prop}: ${short(pv.base.value, 20)} on Arabic text.${tail}`,
        ar: `الصنف ${cls} يضبط ${prop}: ${short(pv.base.value, 20)} على نص عربي${r ? ` (قيمة المشروع للعربية ${r.value})` : ""}. اضبطه على ${fixTo} للعربية.` });
    }
  });
  for (const g of classUses.values()) {
    const where = g.lines.length > 1 ? ` (${g.lines.length} elements in this file, lines ${g.lines.slice(0, 8).join(", ")}${g.lines.length > 8 ? "…" : ""})` : "";
    report(g.node, g.code, g.en.replace(/ on Arabic text\./, ` on Arabic text${where}.`), g.ar);
  }

  // ---- 5. CSS modules (handled by caller on disk)
  sf.getImportDeclarations().forEach((imp) => { const m = imp.getModuleSpecifierValue(); if (/\.module\.(css|scss)$/.test(m)) cssModules.push(m); });

  // ---- 6. direction + lang where Arabic text has no RTL context
  // A text site (Arabic JSX text, or a child expression carrying Arabic) is covered when an ancestor element in the
  // component sets `dir`, or when it sits inside a custom component that owns its text direction (its root has dir,
  // or, in project mode, it receives this text as children and is fixed in its own file). Uncovered sites get
  // dir="rtl" on the outermost DOM element (intrinsic or <AbsoluteFill>) above them, never on a custom component
  // whose props may not accept `dir`.
  if (!o.rtlContext) {
    const DOM_PASS = /^(Sequence|Series\.Sequence|TransitionSeries\.Sequence|Loop|Freeze|Fragment|React\.Fragment)$/;
    const DIR_OK = /^(AbsoluteFill)$/;
    const tagText = (el: Node) => (Node.isJsxElement(el) ? el.getOpeningElement() : (el as import("ts-morph").JsxSelfClosingElement)).getTagNameNode().getText();
    const openOf = (el: Node) => (Node.isJsxElement(el) ? el.getOpeningElement() : el) as import("ts-morph").JsxOpeningElement;
    const attrNames = (el: Node) => openOf(el).getAttributes().map((a) => (Node.isJsxAttribute(a) ? a.getNameNode().getText() : "..."));
    const domLike = (t: string) => /^[a-z]/.test(t) || /^(motion|animated|m)\.[a-z]/.test(t) || DIR_OK.test(t);
    // components defined in this file whose every root sets dir
    const rootsOf = (c: Node): Node[] => {
      const out: Node[] = [];
      const body = (c as any).getBody?.() as Node | undefined;
      if (!body) return out;
      const b = unwrap(body);
      if (isJsx(b)) out.push(b!);
      else body.forEachDescendant((d, t) => {
        if (Node.isArrowFunction(d) || Node.isFunctionDeclaration(d) || Node.isFunctionExpression(d)) { t.skip(); return; }
        if (Node.isReturnStatement(d)) { const e = unwrap(d.getExpression()); if (isJsx(e)) out.push(e!); }
      });
      return out.flatMap((r) => (Node.isJsxFragment(r) ? r.getJsxChildren().filter((x) => Node.isJsxElement(x) || Node.isJsxSelfClosingElement(x)) : [r]));
    };
    const ownsDir = new Map<string, boolean>();
    for (const c of components) { const nm = compName(c); const rs = rootsOf(c); if (nm) ownsDir.set(nm, rs.length > 0 && rs.every((r) => attrNames(r).includes("dir"))); }
    const coversChildren = (t: string) => {
      if (domLike(t) || DOM_PASS.test(t)) return false;
      const local = t.split(".")[0];
      if (ownsDir.has(t)) return ownsDir.get(t)! || (o.project && fed.has(t)) || arabicComps.some((c) => compName(c) === t);
      // imported component: in project mode it is analyzed (and fixed) in its own file
      return o.project && !!sf.getImportDeclarations().find((i) => i.getNamedImports().some((ni) => (ni.getAliasNode()?.getText() ?? ni.getName()) === local) || i.getDefaultImport()?.getText() === local);
    };
    const containsJsx = (e: Node) => isJsx(e) || e.getDescendants().some((d) => isJsx(d));
    // `{body}` where body = (<Center>…</Center>): an element, not text
    // {l1} where const l1 = typed("$ git clone …", t): built from string literals, none of them Arabic
    const latinValued = (e: Node) => {
      const u = unwrap(e)!;
      if (!Node.isIdentifier(u)) return false;
      const d = u.getSymbol()?.getDeclarations()?.find((x) => Node.isVariableDeclaration(x));
      const init = d && Node.isVariableDeclaration(d) ? d.getInitializer() : undefined;
      if (!init || hasArabicLetter(init.getText())) return false;
      const lits = [init, ...init.getDescendants()].filter((x) => Node.isStringLiteral(x) || Node.isNoSubstitutionTemplateLiteral(x) || Node.isTemplateExpression(x));
      const ids = init.getDescendantsOfKind(SyntaxKind.Identifier).map((x) => x.getText());
      return lits.length > 0 && !ids.some((k) => arabicConsts.has(k) || fed.has(k));
    };
    const returnsJsx = (fn: Node | undefined): boolean => {
      if (!fn || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn))) return false;
      const body = fn.getBody() as Node | undefined;
      if (!body) return false;
      if (!Node.isBlock(body)) return containsJsx(body);
      const rets = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).map((r) => r.getExpression()).filter((x): x is NonNullable<typeof x> => !!x);
      return rets.length > 0 && rets.every((r) => containsJsx(r) || /^null$/.test(r.getText()));
    };
    const jsxValued = (e: Node, c: Node) => {
      const u = unwrap(e)!;
      // {it.show(ok)} / {renderTitle()}: every same-file definition of that function returns JSX
      if (Node.isCallExpression(u)) {
        const callee = u.getExpression();
        const nm = Node.isPropertyAccessExpression(callee) ? callee.getName() : Node.isIdentifier(callee) ? callee.getText() : "";
        if (!nm) return false;
        const defs: Node[] = [
          ...sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment).filter((p) => propName(p) === nm).map((p) => unwrap(p.getInitializer())!),
          ...sf.getDescendantsOfKind(SyntaxKind.MethodDeclaration).filter((m) => m.getName() === nm),
          ...sf.getVariableDeclarations().filter((d) => d.getName() === nm).map((d) => unwrap(d.getInitializer())!),
          ...sf.getFunctions().filter((f) => f.getName() === nm),
        ].filter(Boolean);
        return defs.length > 0 && defs.every(returnsJsx);
      }
      const names = Node.isIdentifier(u) ? [u.getText()] : Node.isConditionalExpression(u) ? [u.getWhenTrue(), u.getWhenFalse()].filter((x) => Node.isIdentifier(x)).map((x) => x.getText()) : [];
      if (!names.length) return false;
      return names.every((nm) => {
        const decl = (Node.isIdentifier(u) ? u : null)?.getSymbol()?.getDeclarations()?.find((d) => Node.isVariableDeclaration(d));
        if (decl && Node.isVariableDeclaration(decl) && decl.getInitializer() && containsJsx(decl.getInitializer()!)) return true;
        return new RegExp(`\\b${nm}\\s*=\\s*\\(?\\s*<`).test(c.getText());
      });
    };
    for (const c of arabicComps) {
      const isFed = fed.has(compName(c) ?? "");
      const others = components.filter((x) => x !== c && x.getStart() >= c.getStart() && x.getEnd() <= c.getEnd());
      const sites: Node[] = [];
      c.forEachDescendant((d, t) => {
        if (others.includes(d)) { t.skip(); return; }
        if (Node.isJsxText(d) && hasArabicLetter(d.getText())) sites.push(d);
        else if (Node.isJsxExpression(d) && Node.isJsxElement(d.getParent()!)) {
          const e = d.getExpression();
          if (!e || containsJsx(e)) return;
          if (hasI18n && i18nAr(e).length) sites.push(d);
          else if (hasArabicLetter(e.getText()) || [...arabicConsts].some((k) => new RegExp(`\\b${k}\\b`).test(e.getText()))) { if (hasArabicLetter(e.getText()) || !jsxValued(e, c)) sites.push(d); }
          else if ((isFed || o.assumeArabic || ARABIC_RE.test(ownText(c))) && !notStringTyped(e) && /[A-Za-z_$]/.test(e.getText()) && !jsxValued(e, c) && !latinValued(e)) sites.push(d);
        }
      });
      const targets = new Map<Node, string>();
      const unreachable: Node[] = [];
      for (const site of sites) {
        const chain: Node[] = []; // inner → outer JSX elements up to the component
        let covered = false;
        for (let a = site.getParent(); a && a !== c; a = a.getParent()) {
          if (!(Node.isJsxElement(a) || Node.isJsxSelfClosingElement(a))) continue;
          if (attrNames(a).includes("dir")) { covered = true; break; }
          if (coversChildren(tagText(a))) { covered = true; break; }
          chain.push(a);
        }
        if (covered) continue;
        const target = [...chain].reverse().find((el) => domLike(tagText(el)));
        const txt = Node.isJsxText(site) ? site.getText() : [site.getText(), ...(hasI18n ? i18nAr(site) : [])].join(" ");
        if (target) targets.set(target, (targets.get(target) ?? "") + " " + txt);
        else unreachable.push(site);
      }
      for (const [t, txt] of targets) {
        const opening = openOf(t);
        const attrs = attrNames(t);
        if (attrs.includes("...")) { report(opening, "HZ03", "Element spreads props; add dir=\"rtl\" lang=\"ar\" manually.", "أضف dir=\"rtl\" يدوياً."); continue; }
        const lang = scriptLang(hasArabicLetter(txt) ? txt : ownText(c));
        const tagEnd = opening.getTagNameNode().getEnd();
        edit({ start: tagEnd, end: tagEnd }, ` dir="rtl"${attrs.includes("lang") ? "" : ` lang="${lang}"`} /* harakah: ${lang === "fa" ? "Persian" : lang === "ur" ? "Urdu" : "Arabic"} is RTL */`, "HZ03",
          `<${opening.getTagNameNode().getText()}>: added dir="rtl"${attrs.includes("lang") ? "" : ` lang="${lang}"`} (flex rows and punctuation now flow right-to-left).`,
          `أُضيف dir="rtl" وlang="${lang}" إلى العنصر.`);
      }
      if (unreachable.length && !targets.size) {
        const el = unreachable[0].getFirstAncestor((a) => Node.isJsxElement(a));
        if (el) report(el, "HZ03", `Arabic text inside <${tagText(el)}> has no RTL context and <${tagText(el)}> may not accept a dir prop: wrap the text in an element with dir="rtl", or set dir inside ${tagText(el)}.`, `النص العربي بلا اتجاه RTL؛ ضعه داخل عنصر عليه dir="rtl".`);
      }
    }
  }

  // ---- 7. fonts: @remotion/google-fonts Latin-only families
  const pick = (mod: string): "IBMPlexSansArabic" | "Alexandria" => (o.font === "plex" ? "IBMPlexSansArabic" : o.font === "alexandria" ? "Alexandria" : DISPLAY.has(mod.toLowerCase()) ? "Alexandria" : "IBMPlexSansArabic");
  let swappedToPlex = false;
  let arabicLoaderPresent = sf.getImportDeclarations().some((i) => /@remotion\/google-fonts\/(\w+)/.test(i.getModuleSpecifierValue()) && ARABIC_MODULES.has(i.getModuleSpecifierValue().split("/").pop()!.toLowerCase()));
  for (const imp of sf.getImportDeclarations()) {
    const m = imp.getModuleSpecifierValue().match(/^@remotion\/google-fonts\/(\w+)$/);
    if (!m || !LATIN_MODULES.has(m[1].toLowerCase())) continue;
    if (!hasArabic(src) && !o.assumeArabic && !fed.size) continue;
    const target = pick(m[1]);
    if (target === "IBMPlexSansArabic") swappedToPlex = true;
    const spec = imp.getModuleSpecifier();
    edits.push({ start: imp.getEnd(), end: imp.getEnd(), text: ` // harakah: was ${m[1]} (no Arabic glyphs)` });
    edit(spec, `"@remotion/google-fonts/${target}"`, "HZ09",
      `Font ${m[1]} has no Arabic glyphs → ${target === "Alexandria" ? "Alexandria (display)" : "IBM Plex Sans Arabic (text)"} via @remotion/google-fonts.`,
      `الخط ${m[1]} بلا حروف عربية ← ${target === "Alexandria" ? "Alexandria للعناوين" : "IBM Plex Sans Arabic للنصوص"}.`);
    arabicLoaderPresent = true;
    const locals = imp.getNamedImports().filter((ni) => ni.getName() === "loadFont").map((ni) => ni.getAliasNode()?.getText() ?? "loadFont");
    sf.forEachDescendant((n) => {
      if (!Node.isCallExpression(n) || !locals.includes(n.getExpression().getText())) return;
      const args = n.getArguments();
      if (args[0] && Node.isStringLiteral(args[0]) && args[0].getLiteralValue() === "italic") edit(args[0], `"normal"`, "HZ20", "loadFont italic → normal (no Arabic italic).", "لا يوجد خط مائل عربي.");
      const obj = args[1];
      const defWeights = target === "Alexandria" ? `["400", "500", "600", "700", "800"]` : `["300", "400", "500", "600", "700"]`;
      if (!args.length) {
        const close = n.getEnd() - 1; // the ")"
        edits.push({ start: close, end: close, text: `"normal", { weights: ${defWeights}, subsets: ["arabic", "latin"] }`, change: { code: "HZ09", line: line(n), en: `loadFont() with no options → explicit weights + arabic subset (avoids ~36 font requests).`, ar: `تحديد الأوزان وsubset العربي في loadFont().` } });
      } else if (!obj && args.length === 1) {
        edits.push({ start: args[0].getEnd(), end: args[0].getEnd(), text: `, { weights: ${defWeights}, subsets: ["arabic", "latin"] }`, change: { code: "HZ09", line: line(n), en: `loadFont options → explicit weights + arabic subset.`, ar: `تحديد الأوزان وsubset العربي.` } });
      } else if (obj && Node.isObjectLiteralExpression(obj) && !obj.getProperties().some((p) => propName(p) === "subsets")) {
        const props = obj.getProperties();
        const at = props.length ? props[props.length - 1].getEnd() : obj.getStart() + 1;
        edits.push({ start: at, end: at, text: `${props.length ? ", " : " "}subsets: ["arabic", "latin"]${props.length ? "" : " "}`, change: { code: "HZ09", line: line(n), en: `loadFont: added subsets ["arabic", "latin"].`, ar: `إضافة subset العربي.` } });
      }
      if (obj && Node.isObjectLiteralExpression(obj)) {
        for (const p of obj.getProperties()) {
          const nm = propName(p);
          const init = Node.isPropertyAssignment(p) ? p.getInitializer() : undefined;
          if (!init || !Node.isArrayLiteralExpression(init)) continue;
          if (nm === "subsets") {
            const vals = init.getElements().map((e) => e.getText().replace(/['"`]/g, ""));
            if (!vals.includes("arabic")) edit(init, `["arabic", "latin"]`, "HZ09", `loadFont subsets → ["arabic", "latin"].`, `إضافة subset العربي.`);
          }
          if (nm === "weights" && target === "IBMPlexSansArabic") {
            const vals = init.getElements().map((e) => e.getText().replace(/['"`]/g, ""));
            const mapped = [...new Set(vals.map((w) => (PLEX_WEIGHTS.includes(w) ? w : Number(w) > 700 ? "700" : "400")))];
            if (mapped.join() !== vals.join()) edit(init, JSON.stringify(mapped).replace(/,/g, ", "), "HZ09", `weights ${vals.join("/")} → ${mapped.join("/")} (IBM Plex Sans Arabic max 700).`, `تعديل الأوزان المتاحة.`);
          }
        }
      }
    });
  }

  // ---- 8. string fontFamily stacks without Arabic
  const webOnly = o.remotion === false;
  let needLoader = false;
  const wantLoaders = new Set<string>();
  sf.forEachDescendant((n) => {
    if (!Node.isPropertyAssignment(n) || propName(n) !== "fontFamily" || !(inArabic(n) || declMode(n) === "safe")) return;
    const init = n.getInitializer();
    if (!init || !(Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) return;
    const v = (init as any).getLiteralValue() as string;
    // CSS-wide keywords and custom properties take the family from elsewhere (the parent, a next/font variable)
    if (/^\s*(?:inherit|initial|unset|revert(?:-layer)?|var\(.*\))\s*$/i.test(v)) return;
    const fams = parseStack(v);
    const fcOf = (f: string) => o.fontCoverage?.[f.replace(/["'`]/g, "").replace(/\s+/g, "").toLowerCase()];
    const classes = fams.map((f) => verifiedClass(classify(f), fcOf(f)));
    const checked = fams.filter((_, i) => classes[i] === "no-arabic").map((f) => describeCoverage(fcOf(f)!.cov));
    const why = checked.length ? ` (checked the font file: ${checked.join("; ")})` : "";
    if (classes.some(arabicCapable)) {
      // Arabic OFL family referenced by name only: make sure it is actually loaded
      const fam = fams.find((f) => classify(f) === "arabic-ofl");
      if (fam) {
        const mod = GF_ARABIC.find((m) => m.toLowerCase() === fam.replace(/\s+/g, ""));
        const key = fam.replace(/\s+/g, "").toLowerCase();
        const loaded = sf.getImportDeclarations().some((i) => i.getModuleSpecifierValue().toLowerCase().endsWith("/" + key)) || fontsLoadedIn(src).includes(key) || (o.loadedFonts ?? []).includes(key);
        if (!loaded && webOnly) report(n, "HZ11", `"${fam}" is referenced by name but not loaded; load it (Google Fonts <link>, @fontsource, or @font-face).`, `الخط "${fam}" غير محمّل: حمّله عبر Google Fonts أو @fontsource أو @font-face.`);
        else if (!loaded && mod && !wantLoaders.has(mod) && !ignoredAt(line(n), "HZ11")) {
          wantLoaders.add(mod);
          const nl = n; edits.push({ prio: 3, start: -1, end: -1, text: mod, change: { code: "HZ11", line: line(nl), en: `"${fam}" was referenced by name but never loaded → added loadFont from @remotion/google-fonts/${mod}.`, ar: `الخط "${fam}" لم يكن محمّلاً ← أُضيف loadFont.` } });
        } else if (!loaded && !mod) report(n, "HZ11", `"${fam}" is referenced by name but not loaded; load it with @font-face/staticFile().`, `الخط "${fam}" غير محمّل.`);
      }
      return;
    }
    // a custom family the project loads itself (@font-face 'Saudi', FontFace("Brand")): its glyph coverage is unknown, don't guess
    const loadedHere = (f: string) => { const k = f.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase(); return fontsLoadedIn(src).includes(k) || (o.loadedFonts ?? []).includes(k); };
    if (fams.some((f, i) => classes[i] === "unknown" && loadedHere(f))) return;
    if (webOnly) {
      report(n, "HZ09", `fontFamily "${short(v, 30)}" has no Arabic font${why}. Load one (e.g. IBM Plex Sans Arabic via Google Fonts or @fontsource/ibm-plex-sans-arabic) and add it to this stack.`, `لا يوجد خط عربي في fontFamily: حمّل خطاً عربياً (مثل IBM Plex Sans Arabic) وأضفه.`);
      return;
    }
    const raw = v.split(",").map((x) => x.trim()).filter(Boolean);
    const gi = raw.findIndex((f) => classify(f) === "generic");
    const ins = `"IBM Plex Sans Arabic"`;
    if (gi >= 0) raw.splice(gi, 0, ins); else raw.push(ins, "sans-serif");
    const q = init.getText()[0] === "'" ? "'" : '"';
    const val = raw.map((f) => f.replace(/"/g, q === '"' ? "'" : '"')).join(", ");
    edit(init, `${q}${val.replace(new RegExp(q, "g"), q === '"' ? "'" : '"')}${q} /* harakah: Arabic fallback */`, "HZ09",
      `fontFamily "${short(v, 30)}" has no Arabic font${why} → added IBM Plex Sans Arabic fallback (loaded via @remotion/google-fonts).`, `إضافة IBM Plex Sans Arabic كخط بديل.`);
    needLoader = true;
  });

  // ---- 9. digits
  if (o.digits !== "keep") {
    const to = o.digits;
    const want = to === "eastern" ? /[0-9]|[\u0660-\u0669][.,][\u0660-\u0669]/ : /[\u0660-\u0669]/;
    sf.forEachDescendant((n) => {
      if (Node.isJsxText(n)) {
        const raw = n.getText();
        if (!hasArabicLetter(raw) || !want.test(raw)) return;
        const out = outside(raw, ENTITY, (s) => normDigitsText(s, to, scriptLang(raw)));
        if (out !== raw) edit(n, out, "HZ12", `JSX text digits → ${to === "eastern" ? "١٢٣" : "123"}: "${short(raw.trim(), 30)}".`, `توحيد الأرقام في النص.`);
      } else if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n) || Node.isTemplateHead(n) || Node.isTemplateMiddle(n) || Node.isTemplateTail(n)) {
        if (n.getFirstAncestor((a) => Node.isImportDeclaration(a) || Node.isExportDeclaration(a) || Node.isTypeNode(a))) return;
        if (Node.isPropertyAssignment(n.getParent()!) && (n.getParent() as any).getNameNode?.() === n) return;
        const whole = Node.isTemplateHead(n) || Node.isTemplateMiddle(n) || Node.isTemplateTail(n) ? n.getFirstAncestorByKind(SyntaxKind.TemplateExpression)!.getText() : n.getText();
        if (!hasArabicLetter(whole)) return;
        const raw = n.getText();
        if (!want.test(raw)) return;
        const out = outside(raw, ESCAPE, (s) => normDigitsText(s, to, scriptLang(whole)));
        if (out !== raw) edit(n, out, "HZ12", `String digits → ${to === "eastern" ? "١٢٣" : "123"}: ${short(raw, 30)}.`, `توحيد الأرقام في النصوص.`);
      }
    });
    // number-typed values rendered inside Arabic components
    const wrapNum = (expr: Node, how: string) => {
      if (edit(expr, `formatDigits(${expr.getText()}${to === "western" ? `, "western"` : ""})`, "HZ12", `${how} → formatDigits() (${to === "eastern" ? "١٢٣" : "123"}).`, `تنسيق الرقم بالأرقام ${to === "eastern" ? "المشرقية" : "الغربية"}.`)) needHelper.add("formatDigits");
    };
    sf.forEachDescendant((n) => {
      if (Node.isCallExpression(n)) {
        const ex = n.getExpression();
        if (!Node.isPropertyAccessExpression(ex) || ex.getName() !== "toLocaleString" || !inArabic(n)) return;
        const a = n.getArguments()[0];
        const loc = a && Node.isStringLiteral(a) ? a.getLiteralValue() : undefined;
        if (loc && /^ar/i.test(loc)) {
          if (!/-u-nu-/.test(loc)) edit(a!, JSON.stringify(`${loc}-u-nu-${to === "eastern" ? "arab" : "latn"}`), "HZ12", `toLocaleString("${loc}") → explicit numbering system.`, `تحديد نظام الأرقام.`);
          return;
        }
        if (to === "eastern" && n.getArguments().length <= 1) {
          if (edit(n, `formatDigits(${ex.getExpression().getText()})`, "HZ12", `${short(n.getText(), 30)} → formatDigits() (Eastern Arabic ١٢٣ with ٬ grouping).`, `تنسيق الرقم بالأرقام المشرقية.`)) needHelper.add("formatDigits");
        }
      } else if (Node.isJsxExpression(n) && to === "eastern") {
        const e = n.getExpression();
        if (!e || !inArabic(n) || Node.isCallExpression(e) && /formatDigits/.test(e.getExpression().getText())) return;
        if (!Node.isJsxElement(n.getParent()!)) return; // children only, not attributes
        try { const t = e.getType(); if (t.isNumber() || t.isNumberLiteral()) wrapNum(e, `{${short(e.getText(), 20)}}`); } catch {}
      } else if (Node.isTemplateSpan(n) && to === "eastern") {
        const tpl = n.getFirstAncestorByKind(SyntaxKind.TemplateExpression);
        if (!tpl || !hasArabicLetter(tpl.getText())) return;
        const e = n.getExpression();
        if (Node.isCallExpression(e) && /formatDigits/.test(e.getExpression().getText())) return;
        try { const t = e.getType(); if (t.isNumber() || t.isNumberLiteral()) wrapNum(e, "${…} in Arabic template"); } catch {}
      }
    });
  }

  // ---- 10. bidi isolation
  if (o.bidi) {
    sf.forEachDescendant((n) => {
      if (Node.isJsxText(n)) {
        const raw = n.getText();
        if (!hasArabicLetter(raw) || !new RegExp(LATIN_RUN.source).test(raw)) return;
        const parent = n.getParent();
        const ptag = Node.isJsxElement(parent) ? parent.getOpeningElement().getTagNameNode().getText() : "";
        if (ptag === "bdi" || ptag === "bdo") return;
        const out = outside(raw, ENTITY, (s) => s.replace(new RegExp(LATIN_RUN.source, "g"), (m) => `<bdi>${m}</bdi>`));
        if (out !== raw) edit(n, out, "HZ13", `Latin runs in JSX text wrapped in <bdi>: "${short(raw.trim(), 30)}".`, `عزل الكلمات اللاتينية بـ <bdi>.`);
      } else if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n) || Node.isTemplateHead(n) || Node.isTemplateMiddle(n) || Node.isTemplateTail(n)) {
        const host = Node.isTemplateHead(n) || Node.isTemplateMiddle(n) || Node.isTemplateTail(n) ? n.getFirstAncestorByKind(SyntaxKind.TemplateExpression)! : n;
        const container = host.getParent();
        if (!container || !Node.isJsxExpression(container)) return;
        if (!hasArabicLetter(host.getText())) return;
        const raw = n.getText();
        if (/\\u2068|\u2068|\\u\{2068\}/.test(host.getText())) return; // already isolated
        if (!new RegExp(LATIN_RUN.source).test(raw.replace(ESCAPE, " "))) return;
        const out = outside(raw, ESCAPE, (s) => isolateRuns(s, "\\u2068", "\\u2069", /\\u2068$/));
        // don't touch the quote/backtick delimiters
        if (out !== raw && /^["'`}]/.test(out)) edit(n, out, "HZ13", `Latin runs isolated with FSI/PDI (\\u2068…\\u2069) in ${short(raw, 30)}.`, `عزل الكلمات اللاتينية داخل النص.`);
      }
    });
  }

  // ---- report-only patterns
  sf.forEachDescendant((n) => {
    if (Node.isCallExpression(n) && /\.reverse$/.test(n.getExpression().getText())) {
      const p = n.getParent();
      if (p && Node.isPropertyAccessExpression(p) && p.getName() === "join") report(n, "HZ15", "String reversal (…reverse().join()) scrambles Arabic; remove it.", "عكس النص يفسد العربية؛ احذفه.");
    }
    if (Node.isPropertyAccessExpression(n) && /^(fillText|strokeText|measureText)$/.test(n.getName())) report(n, "HZ19", `Canvas ${n.getName()}: set ctx.direction = "rtl" and avoid per-letter drawing.`, "Canvas: اضبط ctx.direction = \"rtl\".");
    if (Node.isJsxOpeningElement(n) && n.getTagNameNode().getText() === "tspan" && inArabic(n)) report(n, "HZ01", "SVG <tspan> per letter breaks Arabic joins; animate whole words.", "tspan لكل حرف يفكك العربية.");
  });

  // ---- 9b. Alexandria draws ٬ ٫ ٪ with the Latin comma glyph → route just those through IBM Plex Sans Arabic
  if (o.digits === "eastern" && (needHelper.has("formatDigits") || /\bformatDigits\s*\(|[\u066A-\u066C]/.test(src))) {
    for (const imp of sf.getImportDeclarations()) {
      if (!/^@remotion\/google-fonts\/Alexandria$/.test(imp.getModuleSpecifierValue())) continue;
      const locals = imp.getNamedImports().filter((ni) => ni.getName() === "loadFont").map((ni) => ni.getAliasNode()?.getText() ?? "loadFont");
      sf.forEachDescendant((n) => {
        if (!Node.isCallExpression(n) || !locals.includes(n.getExpression().getText())) return;
        const parent = n.getParent();
        if (parent && Node.isCallExpression(parent) && parent.getExpression().getText() === "withArabicSeparators") return;
        if (!parent || Node.isExpressionStatement(parent)) return; // return value unused → nothing to wrap
        // Only when this font actually styles text that shows grouped/decimal digits.
        let names: string[] | null = null;
        const declName = Node.isVariableDeclaration(parent) ? parent.getNameNode() : undefined;
        if (Node.isVariableDeclaration(parent)) {
          const nn = parent.getNameNode();
          if (Node.isIdentifier(nn)) names = [nn.getText()];
          else if (Node.isObjectBindingPattern(nn)) names = nn.getElements().filter((e) => (e.getPropertyNameNode()?.getText() ?? e.getName()) === "fontFamily").map((e) => e.getName());
        }
        if (names) {
          if (!names.length) return;
          const showsSeparators = (t: string) => /\bformatDigits\s*\(|toLocaleString\s*\(|[\u066A-\u066C]|\d[.,]\d/.test(t);
          const used = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter((id) => names!.includes(id.getText()) && id !== declName && !id.getFirstAncestorByKind(SyntaxKind.ObjectBindingPattern));
          if (!used.some((id) => { const el = id.getFirstAncestor((a) => Node.isJsxElement(a) || Node.isJsxSelfClosingElement(a)); return !el || showsSeparators(el.getText()); })) return;
        }
        needHelper.add("withArabicSeparators");
        edits.push({ start: n.getStart(), end: n.getStart(), text: "withArabicSeparators(", prio: 5 });
        edits.push({ start: n.getEnd(), end: n.getEnd(), text: ")", prio: 5, change: { code: "HZ12", line: line(n), en: "Alexandria draws ٬ ٫ as Latin commas → withArabicSeparators() puts IBM Plex Sans Arabic first for U+066A–U+066C only.", ar: "خط Alexandria يرسم ٬ ٫ كفاصلة لاتينية؛ نرسم هذه الرموز فقط من IBM Plex Sans Arabic." } });
      });
    }
  }

  // helper + loader imports go at the end of the line of the last import
  const afterImports = () => {
    const imps = sf.getImportDeclarations();
    if (!imps.length) return 0;
    const e = imps[imps.length - 1].getEnd();
    const nl = src.indexOf("\n", e);
    return nl < 0 ? src.length : nl;
  };
  if (needHelper.size) {
    usesHelper = true;
    const existing = sf.getImportDeclarations().find((i) => i.getModuleSpecifierValue() === o.helperImport);
    if (existing) {
      const have = existing.getNamedImports().map((x) => x.getName());
      const missing = [...needHelper].filter((x) => !have.includes(x));
      if (missing.length) {
        const ni = existing.getNamedImports();
        const pos = ni.length ? ni[ni.length - 1].getEnd() : existing.getStart();
        edits.push({ start: pos, end: pos, text: `, ${missing.join(", ")}` });
      }
    } else {
      const pos = afterImports();
      edits.push({ prio: 1, start: pos, end: pos, text: `${pos ? "\n" : ""}import { ${[...needHelper].sort().join(", ")} } from "${o.helperImport}"; // harakah: joining-aware Arabic helpers${pos ? "" : "\n"}` });
    }
  }
  // a fallback after the Latin family: load the Arabic subset only, so Latin text keeps the face it had before
  // (with "latin" too, English text on a machine without the Latin font would switch to Plex's Latin glyphs)
  const plexLoaded = sf.getImportDeclarations().some((i) => /\/IBMPlexSansArabic$/.test(i.getModuleSpecifierValue()));
  if (needLoader && !plexLoaded && !swappedToPlex) {
    const pos = afterImports();
    edits.push({ prio: 2, start: pos, end: pos, text: `${pos ? "\n" : ""}import { loadFont as loadArabicFont } from "@remotion/google-fonts/IBMPlexSansArabic"; // harakah: Arabic fallback font\nloadArabicFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["arabic"] });${pos ? "" : "\n"}` });
  }
  for (const e of edits) if (e.start === -1) {
    const pos = afterImports();
    e.start = e.end = pos;
    const mod = e.text;
    e.text = `${pos ? "\n" : ""}import { loadFont as load${mod} } from "@remotion/google-fonts/${mod}"; // harakah: font was referenced but never loaded\nload${mod}("normal", { subsets: ["arabic"] });${pos ? "" : "\n"}`;
  }
  return { edits, reports, usesHelper, cssModules };
}

/** Fix CSS text (CSS-in-JS template or CSS module). */
export function fixCssText(css: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const END = "(;|(?=\\s*\\}))"; // declaration ends with ; or the closing brace
  let t = css.replace(new RegExp(`letter-spacing[ \\t]*:[ \\t]*([^\\s;{}\`][^;{}\`]*?)\\s*${END}`, "g"), (m, v: string) => {
    if (/^(0(px|em|rem)?|normal)\s*(!important)?$/.test(v.trim())) return m;
    notes.push(`letter-spacing ${v.trim()} → 0`);
    return `letter-spacing: 0; /* harakah: was ${v.trim().replace(/\*\//g, "")} */`;
  });
  const rep = (prop: string, vals: string, to: string, note: (v: string) => string) => {
    t = t.replace(new RegExp(`${prop}\\s*:\\s*(${vals})\\s*${END}`, "g"), (_m, v) => { notes.push(note(v)); return `${prop}: ${to}; /* harakah */`; });
  };
  rep("text-transform", "uppercase|capitalize|lowercase", "none", (v) => `text-transform ${v} → none`);
  rep("text-align", "left", "start", () => "text-align left → start");
  rep("word-break", "break-all", "normal", () => "word-break break-all → normal");
  rep("font-variant", "(?:all-)?small-caps", "normal", () => "small-caps → normal");
  return { text: t, notes };
}

const nl = (s: string) => (s.match(/\n/g) ?? []).length;
/** Map a line of a pass's output back to the pass's input, given the edits it applied. */
function lineMapper(input: string, applied: { start: number; end: number; text: string }[]): (outLine: number) => number {
  const shifts = applied.map((e) => ({ at: nl(input.slice(0, e.start)) + 1, d: nl(e.text) - nl(input.slice(e.start, e.end)) })).filter((x) => x.d !== 0).sort((a, b) => a.at - b.at);
  return (L) => {
    let cum = 0;
    for (const x of shifts) {
      const outAt = x.at + cum;
      if (L <= outAt) break;
      if (x.d > 0 && L <= outAt + x.d) return x.at; // a line the edit inserted
      cum += x.d;
    }
    return L - cum;
  };
}

/** Class-name helpers whose arguments are class strings. */
const CLASS_FNS = /^(cn|clsx|classnames|classNames|cx|twMerge|twJoin|tw|ctl|cls|classList)$/;
interface ClassSeg { text: string; base: number; node?: Node; ident?: Node; partialStart?: boolean; partialEnd?: boolean; escaped?: boolean }
/**
 * The literal pieces of a className value, with source offsets: string literals, template-literal text (tokens glued to
 * `${}` are marked partial), and inside cn()/clsx()/classnames()/cx()/twMerge(): `cond && "…"`, ternaries, arrays, `+`
 * concatenation, and object keys (`{ "tracking-wide": on, uppercase: big }`). Anything else (variables, cva()) is skipped.
 */
export function classSegments(init: Node): ClassSeg[] {
  const out: ClassSeg[] = [];
  const lit = (n: Node) => {
    const raw = n.getText();
    const inner = raw.slice(1, -1);
    out.push({ text: inner, base: n.getStart() + 1, node: n, escaped: inner.includes("\\") });
  };
  const visit = (n: Node | undefined, inFn: boolean): void => {
    if (!n) return;
    if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) return lit(n);
    if (Node.isTemplateExpression(n)) {
      const head = n.getHead(), ht = head.getText().slice(1, -2);
      out.push({ text: ht, base: head.getStart() + 1, partialEnd: !/\s$/.test(ht) });
      for (const sp of n.getTemplateSpans()) {
        visit(sp.getExpression(), inFn);
        const lt = sp.getLiteral(), tail = Node.isTemplateTail(lt);
        const inner = lt.getText().slice(1, tail ? -1 : -2);
        out.push({ text: inner, base: lt.getStart() + 1, partialStart: !/^\s/.test(inner), partialEnd: !tail && !/\s$/.test(inner) });
      }
      return;
    }
    if (Node.isJsxExpression(n) || Node.isParenthesizedExpression(n) || Node.isAsExpression(n)) return visit(n.getExpression(), inFn);
    if (Node.isConditionalExpression(n)) { visit(n.getWhenTrue(), inFn); visit(n.getWhenFalse(), inFn); return; }
    if (Node.isBinaryExpression(n)) {
      const op = n.getOperatorToken().getText();
      if (op === "&&") visit(n.getRight(), inFn);
      else if (op === "||" || op === "??" || op === "+") { visit(n.getLeft(), inFn); visit(n.getRight(), inFn); }
      return;
    }
    if (Node.isCallExpression(n)) {
      const callee = n.getExpression().getText();
      if (CLASS_FNS.test(callee)) for (const a of n.getArguments()) visit(a, true);
      else if (/\.join$/.test(callee) && Node.isPropertyAccessExpression(n.getExpression())) visit((n.getExpression() as any).getExpression(), true); // ["a", b && "c"].join(" ")
      return;
    }
    if (inFn && Node.isArrayLiteralExpression(n)) { for (const e of n.getElements()) visit(e, true); return; }
    if (inFn && Node.isObjectLiteralExpression(n)) {
      for (const p of n.getProperties()) {
        if (!Node.isPropertyAssignment(p) && !Node.isShorthandPropertyAssignment(p)) continue;
        const nm = p.getNameNode();
        if (Node.isStringLiteral(nm)) lit(nm);
        else if (Node.isIdentifier(nm) && Node.isPropertyAssignment(p)) out.push({ text: nm.getText(), base: nm.getStart(), ident: nm });
      }
    }
  };
  visit(init, false);
  return out;
}

/** Transform a TSX/JSX source to a fixpoint. */
export function transformSource(src: string, options: CodemodOptions = {}): CodemodResult {
  const o = { ...CODEMOD_DEFAULTS, ...options } as Required<CodemodOptions>;
  // props-aware: follow Arabic through props within this file (projects pass a cross-file result)
  if (!options.arabicComponents && hasArabic(src) && !o.assumeArabic) {
    try { o.arabicComponents = (analyzeArabicProps([{ file: o.fileName, src }]).values().next().value ?? []).map((x) => x.component); } catch { o.arabicComponents = []; }
  }
  let code = src;
  const changes: Change[] = [];
  let reports: Change[] = [];
  let usesHelper = false;
  let cssModules: string[] = [];
  const mappers: ((outLine: number) => number)[] = [];
  for (let i = 0; i < 4; i++) {
    const r = pass(code, o);
    if (i === 0) { reports = r.reports; cssModules = r.cssModules; }
    usesHelper = usesHelper || r.usesHelper;
    if (!r.edits.length) break;
    // keep outermost non-overlapping edits; nested ones are picked up by the next pass
    const sorted = r.edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const chosen: Edit[] = [];
    let lastEnd = -1;
    for (const e of sorted) {
      if (e.start < lastEnd || (e.start === e.end && chosen.some((c) => c.start === e.start && c.end === e.end && c.text === e.text))) continue;
      chosen.push(e);
      lastEnd = Math.max(lastEnd, e.end);
    }
    const input = code;
    for (const e of [...chosen].sort((a, b) => b.start - a.start || b.end - a.end || (b.prio ?? 0) - (a.prio ?? 0))) code = code.slice(0, e.start) + e.text + code.slice(e.end);
    // report lines in the ORIGINAL file: map this pass's lines back through earlier passes' line shifts
    for (const e of chosen) if (e.change) changes.push({ ...e.change, line: mappers.reduceRight((l, m) => m(l), e.change.line) });
    mappers.push(lineMapper(input, chosen));
  }
  return { code, changed: code !== src, changes, reports, usesHelper, cssModules, video: o.remotion !== false };
}

/** Convert codemod output to harakah Issues (for check / reports). */
export function toIssues(r: CodemodResult, fixedNow: boolean): Issue[] {
  const mk = (c: Change, fixable: boolean): Issue => {
    const meta = RULES[c.code];
    let severity: Issue["severity"] = c.severity ?? (fixable ? meta.severity : meta.severity === "error" ? "warning" : meta.severity);
    let message = { en: c.en, ar: c.ar };
    // Chromium 137+ (Remotion's renderer) ignores letter-spacing between Arabic letters: joins hold in the video
    if (c.code === "HZ07" && r.video !== false) { severity = "info"; message = { en: `${c.en} ${VIDEO_TRACKING.en}`, ar: `${c.ar} ${VIDEO_TRACKING.ar}` }; }
    return { code: c.code, name: meta.name, severity, title: meta.title, why: meta.why,
      message, line: c.line, fixMode: fixable ? "auto" : "none", fixable, fixed: fixable && fixedNow };
  };
  return [...r.changes.map((c) => mk(c, true)), ...r.reports.map((c) => mk(c, false))].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
