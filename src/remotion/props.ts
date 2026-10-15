/**
 * Props-aware Arabic detection for Remotion/React projects.
 * A component whose own source has no Arabic still renders Arabic when Arabic reaches it through:
 *   - `<Composition component={X} defaultProps={{ title: "…" }} />` (or `<Still>`), incl. a referenced object / zod schema `.default("…")`
 *   - `X.defaultProps = { … }`
 *   - JSX usage anywhere in the project: `<X title="…" />`, `<X title={arabicConst} />`, `<X>…</X>`, `<X {...arabicObj} />`
 *   - render-time input props (`remotion render --props …`): top-level keys carrying Arabic feed the rendered
 *     composition's component (or every composition when the id is unknown), and `getInputProps()` callers
 *   - pass-through from another fed component: `<Kicker label={kicker} />`, `<X {...props} />` (fixpoint, across files)
 * Returns, per file, the component names that receive Arabic and why.
 * تتبّع النص العربي عبر الخصائص (props) إلى المكوّنات التي تعرضه.
 */
import { Project, Node, ts, type SourceFile } from "ts-morph";
import path from "node:path";
import { hasArabicLetter } from "../arabic.js";
import { deepArabic, type InputProps } from "./input-props.js";
import { i18nTexts, type I18nKeys } from "./i18n.js";

export interface PropsAnalysisOptions {
  /** Render-time input props (`--props`). */
  inputProps?: InputProps;
  /** Composition id(s) being rendered; candidates that match no <Composition id> are ignored. Empty = all compositions. */
  composition?: string | string[];
  /** Arabic texts behind translation keys (see i18n.ts): `title={t("hero.title")}` carries Arabic. */
  i18n?: I18nKeys | null;
}

export interface PropsFeed { file: string; component: string; props: string[]; reasons: string[]; /** every Arabic prop arrives through translation keys (the component also renders other locales) */ i18nOnly?: boolean }
/** Arabic-safe values for style props that break Arabic (null = value is fine). Shared with the codemod. */
export const STYLE_FIX: Record<string, { code: string; fix: (v: string) => string | null }> = {
  letterSpacing: { code: "HZ07", fix: (v) => (/^(0|["'`](0(px|em|rem)?|normal)["'`])$/.test(v) ? null : "0") },
  textTransform: { code: "HZ08", fix: (v) => (/^["'`]none["'`]$/.test(v) ? null : `"none"`) },
  fontVariant: { code: "HZ08", fix: (v) => (/small-caps/.test(v) ? `"normal"` : null) },
  textAlign: { code: "HZ06", fix: (v) => (/^["'`]left["'`]$/.test(v) ? `"start"` : null) },
  wordBreak: { code: "HZ18", fix: (v) => (/^["'`]break-all["'`]$/.test(v) ? `"normal"` : null) },
  direction: { code: "HZ03", fix: (v) => (/^["'`]ltr["'`]$/.test(v) ? `"rtl"` : null) },
};
/**
 * A module-level style declaration in another file (theme.ts, styles.ts, an exported const) used by components.
 * exclusive: only Arabic components use it → fix it where it is declared.
 * shared: Latin components use it too → keep it, override at the Arabic usage sites (`localNames`).
 */
export interface StyleUse {
  file: string; name: string;
  arabicUsers: string[]; latinUsers: string[];
  exclusive: boolean;
  /** object path ("" = root, "title", "text.heading") → [prop, Arabic-safe value, original value] */
  overrides: Record<string, [string, string, string][]>;
  hasFontFamily: boolean;
  hasSplit: boolean;
  /** user file → local identifiers that refer to this declaration (Arabic users only) */
  localNames: Record<string, string[]>;
}
export interface ProjectAnalysis { feeds: Map<string, PropsFeed[]>; styles: StyleUse[]; /** <Composition>/<Still> ids registered in the project */ compositions: string[] }
interface Comp { literal?: boolean; key: string; file: string; name: string; fn: Node; localToProp: Map<string, string>; propsIdent?: string; restIdent?: string; props: Set<string>; reasons: Set<string> }

const isFn = (n: Node) => Node.isArrowFunction(n) || Node.isFunctionExpression(n) || Node.isFunctionDeclaration(n);
const unwrapExpr = (n: Node | undefined): Node | undefined => {
  while (n && (Node.isParenthesizedExpression(n) || Node.isAsExpression(n) || Node.isSatisfiesExpression(n) || Node.isTypeAssertion(n) || Node.isNonNullExpression(n))) n = n.getExpression();
  return n;
};

export function analyzeArabicProps(files: { file: string; src: string }[], opts: PropsAnalysisOptions = {}): Map<string, PropsFeed[]> {
  return analyzeArabicProject(files, opts).feeds;
}

const modPath = (f: string) => path.resolve(f).replace(/\.(jsx|js|mjs|cjs)$/, (m) => (m === ".jsx" ? ".tsx" : ".ts"));

export function analyzeArabicProject(files: { file: string; src: string }[], opts: PropsAnalysisOptions = {}): ProjectAnalysis {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true, strict: false, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true } });
  const sfs: SourceFile[] = [];
  for (const f of files) {
    // .js modules may contain JSX (Remotion allows it), so parse .js as .tsx unless it has no "<"
    const p = /\.js$/.test(f.file) && /<[A-Za-z]/.test(f.src) ? path.resolve(f.file).replace(/\.js$/, ".tsx") : modPath(f.file);
    sfs.push(project.createSourceFile(p, f.src, { overwrite: true }));
  }
  const origName = new Map(sfs.map((sf, i) => [sf.getFilePath() as string, path.resolve(files[i].file)]));

  // ---- components
  const comps = new Map<Node, Comp>();
  const addComp = (sf: SourceFile, name: string, decl: Node, fn: Node) => {
    if (!/^[A-Z]/.test(name)) return;
    const c: Comp = { key: `${sf.getFilePath()}#${name}`, file: sf.getFilePath(), name, fn, localToProp: new Map(), props: new Set(), reasons: new Set() };
    const p0 = (fn as any).getParameters?.()[0];
    const nameNode = p0?.getNameNode();
    if (nameNode && Node.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        if (el.getDotDotDotToken()) { c.restIdent = el.getName(); continue; }
        const local = el.getNameNode();
        if (!Node.isIdentifier(local)) continue;
        c.localToProp.set(local.getText(), el.getPropertyNameNode()?.getText() ?? local.getText());
      }
    } else if (nameNode && Node.isIdentifier(nameNode)) c.propsIdent = nameNode.getText();
    comps.set(decl, c);
  };
  for (const sf of sfs) {
    sf.forEachDescendant((n) => {
      if (Node.isFunctionDeclaration(n) && n.getName()) addComp(sf, n.getName()!, n, n);
      else if (Node.isVariableDeclaration(n)) {
        let init = unwrapExpr(n.getInitializer());
        // React.memo(…) / forwardRef(…) / memo(forwardRef(…))
        for (let i = 0; i < 3 && init && Node.isCallExpression(init) && /(^|\.)(memo|forwardRef)$/.test(init.getExpression().getText()); i++) init = unwrapExpr(init.getArguments()[0]);
        if (init && isFn(init)) addComp(sf, n.getName(), n, init);
      }
    });
  }
  const resolveDecls = (id: Node): Node[] => {
    try {
      const sym = id.getSymbol();
      if (!sym) return [];
      const target = sym.isAlias() ? sym.getAliasedSymbol() ?? sym : sym;
      return target.getDeclarations();
    } catch { return []; }
  };
  const compOf = (tag: Node): Comp | undefined => {
    for (const d of resolveDecls(tag)) {
      const c = comps.get(d) ?? (Node.isExportAssignment(d) ? (() => { const e = d.getExpression(); return Node.isIdentifier(e) ? compOf(e) : undefined; })() : undefined);
      if (c) return c;
    }
    return undefined;
  };
  const enclosingComp = (n: Node): Comp | undefined => {
    for (let a: Node | undefined = n.getParent(); a; a = a.getParent()) if (isFn(a)) { for (const c of comps.values()) if (c.fn === a) return c; }
    return undefined;
  };

  // ---- does an expression carry Arabic? (literals, consts, imported consts, object/array members)
  // where the last positive carries()/carriesText() found its Arabic: a literal (or const) vs a translation key
  let carryKind: "literal" | "i18n" = "literal";
  const carries = (e: Node | undefined, depth = 0): boolean => {
    if (depth === 0) carryKind = "literal";
    e = unwrapExpr(e);
    if (!e || depth > 4) return false;
    if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e) || Node.isJsxText(e)) return hasArabicLetter(e.getLiteralText?.() ?? e.getText());
    if (Node.isJsxExpression(e)) return carries(e.getExpression(), depth);
    if (hasArabicLetter(e.getText())) return true;
    if (opts.i18n?.size && i18nTexts(e, opts.i18n).length) { carryKind = "i18n"; return true; }
    // identifiers used as values (skip `.name` parts of property accesses and object keys)
    const ids: Node[] = Node.isIdentifier(e) ? [e] : e.getDescendantsOfKind(ts.SyntaxKind.Identifier).filter((d) => {
      const p = d.getParent();
      return !(p && (Node.isPropertyAccessExpression(p) && p.getNameNode() === d || Node.isPropertyAssignment(p) && p.getNameNode() === d));
    });
    for (const id of ids.slice(0, 12)) for (const d of resolveDecls(id)) {
      if (Node.isVariableDeclaration(d) && d.getInitializer() && carries(d.getInitializer(), depth + 1)) return true;
    }
    return false;
  };
  // children text the component itself renders: JSX text, string expressions, and text inside plain DOM children
  // (<Wrapper><h1>عنوان</h1></Wrapper>). Text inside a nested custom component (<Wrapper><Fa>…</Fa></Wrapper>) or an
  // element with its own dir belongs to that element, so it doesn't make <Wrapper> an Arabic component.
  const DOM_PASS = /^(AbsoluteFill|Sequence|Series\.Sequence|TransitionSeries\.Sequence|Loop|Freeze|Fragment|React\.Fragment)$/;
  const passTag = (t: string) => /^[a-z]/.test(t) || /^(motion|animated|m)\.[a-z]/.test(t) || DOM_PASS.test(t);
  const isJsxNode = (n: Node) => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n) || Node.isJsxFragment(n);
  const carriesText = (ch: Node, depth = 0): boolean => {
    if (depth === 0) carryKind = "literal";
    if (depth > 8) return false;
    if (Node.isJsxText(ch)) return hasArabicLetter(ch.getText());
    if (Node.isJsxExpression(ch)) {
      const e = ch.getExpression();
      if (!e) return false;
      if (isJsxNode(e)) return carriesText(e, depth + 1);
      const jsx = e.getDescendants().filter(isJsxNode);
      if (!jsx.length) return exprText(e, depth + 1);
      const outer = jsx.filter((j) => !j.getAncestors().some((a) => (jsx as Node[]).includes(a)));
      let t = e.getText();
      const base = e.getStart();
      for (const j of [...outer].sort((a, b) => b.getStart() - a.getStart())) t = t.slice(0, j.getStart() - base) + t.slice(j.getEnd() - base);
      return hasArabicLetter(t) || outer.some((j) => carriesText(j, depth + 1));
    }
    if (Node.isJsxElement(ch)) {
      const op = ch.getOpeningElement();
      if (!passTag(op.getTagNameNode().getText())) return false;
      if (op.getAttributes().some((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === "dir")) return false;
      return ch.getJsxChildren().some((k) => carriesText(k, depth + 1));
    }
    if (Node.isJsxFragment(ch)) return ch.getJsxChildren().some((k) => carriesText(k, depth + 1));
    return false;
  };
  // what an expression can evaluate to, when it is built from literals in this project: x, x.p, x[k], items[k].p
  const valuesOf = (e: Node | undefined, depth = 0): Node[] | undefined => {
    e = unwrapExpr(e);
    if (!e || depth > 5) return undefined;
    if (Node.isObjectLiteralExpression(e) || Node.isArrayLiteralExpression(e) || Node.isArrowFunction(e) || Node.isFunctionExpression(e) || Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e) || isJsxNode(e)) return [e];
    if (Node.isIdentifier(e)) {
      for (const d of resolveDecls(e)) if (Node.isVariableDeclaration(d) && d.getInitializer()) return valuesOf(d.getInitializer(), depth + 1) ?? [d.getInitializer()!];
      return undefined;
    }
    if (Node.isElementAccessExpression(e)) {
      const base = valuesOf(e.getExpression(), depth + 1);
      return base?.flatMap((b) => (Node.isArrayLiteralExpression(b) ? b.getElements().flatMap((x) => valuesOf(x, depth + 1) ?? [x]) : []));
    }
    if (Node.isPropertyAccessExpression(e)) {
      const base = valuesOf(e.getExpression(), depth + 1);
      if (!base) return undefined;
      const out: Node[] = [];
      for (const b of base) {
        if (!Node.isObjectLiteralExpression(b)) return undefined;
        const pr = b.getProperty(e.getName());
        if (pr && Node.isPropertyAssignment(pr) && pr.getInitializer()) out.push(...(valuesOf(pr.getInitializer(), depth + 1) ?? [pr.getInitializer()!]));
        else if (pr && Node.isMethodDeclaration(pr)) out.push(pr);
        else if (!pr) continue;
        else return undefined;
      }
      return out;
    }
    return undefined;
  };
  const returnedExprs = (fn: Node): Node[] => {
    const body = (fn as any).getBody?.() as Node | undefined;
    if (!body) return [];
    if (!Node.isBlock(body)) return [body];
    return body.getDescendantsOfKind(ts.SyntaxKind.ReturnStatement).filter((r) => r.getFirstAncestor(isFn) === fn).map((r) => (r as import("ts-morph").ReturnStatement).getExpression() as Node | undefined).filter((x): x is Node => !!x);
  };
  // does a child expression render Arabic text itself (not inside a nested custom component)?
  const exprText = (e: Node, depth = 0): boolean => {
    const u = unwrapExpr(e);
    if (!u || depth > 8) return false;
    if (Node.isStringLiteral(u) || Node.isNoSubstitutionTemplateLiteral(u)) return hasArabicLetter(u.getLiteralValue());
    if (opts.i18n?.size && Node.isCallExpression(u) && i18nTexts(u, opts.i18n).length) { carryKind = "i18n"; return true; }
    if (Node.isTemplateExpression(u)) return hasArabicLetter(u.getText()) || u.getTemplateSpans().some((sp) => exprText(sp.getExpression(), depth + 1));
    if (isJsxNode(u)) return carriesText(u, depth + 1);
    if (Node.isConditionalExpression(u)) return exprText(u.getWhenTrue(), depth + 1) || exprText(u.getWhenFalse(), depth + 1);
    if (Node.isBinaryExpression(u)) return exprText(u.getLeft(), depth + 1) || exprText(u.getRight(), depth + 1);
    if (Node.isIdentifier(u) || Node.isPropertyAccessExpression(u) || Node.isElementAccessExpression(u)) {
      const vals = valuesOf(u);
      if (vals) return vals.some((v) => !Node.isObjectLiteralExpression(v) && !Node.isArrayLiteralExpression(v) && !isFn(v) && exprText(v, depth + 1));
      return carries(u);
    }
    if (Node.isCallExpression(u)) {
      const fns = valuesOf(u.getExpression());
      if (fns && fns.length && fns.every((f) => isFn(f) || Node.isMethodDeclaration(f))) return fns.some((f) => returnedExprs(f).some((r) => exprText(r, depth + 1)));
      return carries(u);
    }
    return carries(u);
  };
  const objectLiteralOf = (e: Node | undefined, depth = 0): Node | undefined => {
    e = unwrapExpr(e);
    if (!e || depth > 3) return undefined;
    if (Node.isObjectLiteralExpression(e)) return e;
    if (Node.isIdentifier(e)) for (const d of resolveDecls(e)) if (Node.isVariableDeclaration(d)) return objectLiteralOf(d.getInitializer(), depth + 1);
    return undefined;
  };
  const relFile = (f: string) => path.basename(origName.get(f) ?? f);
  const feed = (c: Comp, prop: string, why: string, kind: "literal" | "i18n" = "literal") => {
    const had = c.props.has(prop); c.props.add(prop); c.reasons.add(`${prop} ← ${why}${kind === "i18n" ? " (translation)" : ""}`);
    const flip = kind === "literal" && !c.literal; if (kind === "literal") c.literal = true;
    return !had || flip;
  };
  const feedFromObject = (c: Comp, obj: Node | undefined, why: string) => {
    if (!obj || !Node.isObjectLiteralExpression(obj)) return;
    for (const p of obj.getProperties()) {
      if (Node.isPropertyAssignment(p) && carries(p.getInitializer())) feed(c, p.getName().replace(/^["']|["']$/g, ""), why, carryKind);
      else if (Node.isShorthandPropertyAssignment(p) && carries(p.getNameNode())) feed(c, p.getName(), why, carryKind);
      else if (Node.isSpreadAssignment(p)) feedFromObject(c, objectLiteralOf(p.getExpression()), why);
    }
  };

  // ---- seeds
  const jsxEls: { sf: SourceFile; el: Node; tag: Node; attrs: Node[]; children: Node[] }[] = [];
  for (const sf of sfs) sf.forEachDescendant((n) => {
    if (Node.isJsxSelfClosingElement(n) || Node.isJsxOpeningElement(n)) {
      const parent = n.getParent();
      jsxEls.push({ sf, el: n, tag: n.getTagNameNode(), attrs: n.getAttributes(), children: Node.isJsxOpeningElement(n) && parent && Node.isJsxElement(parent) ? parent.getJsxChildren() : [] });
    }
    // X.defaultProps = { … }
    if (Node.isBinaryExpression(n) && n.getOperatorToken().getKind() === ts.SyntaxKind.EqualsToken) {
      const l = n.getLeft();
      if (Node.isPropertyAccessExpression(l) && l.getName() === "defaultProps") { const c = compOf(l.getExpression()); if (c) feedFromObject(c, objectLiteralOf(n.getRight()), `${l.getExpression().getText()}.defaultProps (${relFile(sf.getFilePath())})`); }
    }
  });
  const attr = (attrs: Node[], name: string) => attrs.find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name) as any;
  // render-time input props: which top-level keys carry Arabic, and which composition ids they apply to
  const inputKeys = opts.inputProps ? Object.keys(opts.inputProps).filter((k) => deepArabic(opts.inputProps![k], hasArabicLetter)) : [];
  const regId = (attrs: Node[], tagName: string) => attr(attrs, "id")?.getInitializer?.()?.getText?.()?.replace(/^\{?["'`]|["'`]\}?$/g, "") ?? tagName;
  const allIds = new Set(jsxEls.filter((x) => /^(Composition|Still)$|\.(Composition|Still)$/.test(x.tag.getText())).map((x) => regId(x.attrs, x.tag.getText())));
  const wanted = [opts.composition ?? []].flat().filter((id) => allIds.has(id));
  const inputApplies = (id: string) => inputKeys.length > 0 && (!wanted.length || wanted.includes(id));
  if (inputKeys.length) for (const c of comps.values()) {
    // getInputProps() reads the render-time props directly, wherever the component is registered
    if (c.fn.getDescendantsOfKind(ts.SyntaxKind.CallExpression).some((call) => /(^|\.)getInputProps$/.test(call.getExpression().getText())))
      feed(c, "getInputProps()", `getInputProps() with Arabic --props (${inputKeys.join(", ")})`);
  }
  for (const { sf, tag, attrs, children } of jsxEls) {
    const tagName = tag.getText();
    if (/^(Composition|Still)$|\.(Composition|Still)$/.test(tagName)) {
      const compAttr = attr(attrs, "component");
      const target = compAttr?.getInitializer?.()?.getExpression?.();
      const c = target && Node.isIdentifier(unwrapExpr(target)!) ? compOf(unwrapExpr(target)!) : undefined;
      if (!c) continue;
      const id = regId(attrs, tagName);
      if (inputApplies(id)) for (const k of inputKeys) feed(c, k, `--props (render-time) for <${tagName} id="${id}">`);
      feedFromObject(c, objectLiteralOf(attr(attrs, "defaultProps")?.getInitializer?.()?.getExpression?.()), `<${tagName} id="${id}"> defaultProps (${relFile(sf.getFilePath())})`);
      // zod schema: z.object({ title: z.string().default("…") })
      const schemaObj = (() => { const s = unwrapExpr(attr(attrs, "schema")?.getInitializer?.()?.getExpression?.()); if (!s) return undefined; for (const d of Node.isIdentifier(s) ? resolveDecls(s) : []) if (Node.isVariableDeclaration(d)) return d.getInitializer(); return s; })();
      schemaObj?.forEachDescendant((d: Node) => { if (Node.isPropertyAssignment(d) && hasArabicLetter(d.getInitializer()?.getText() ?? "")) feed(c, d.getName(), `<${tagName} id="${id}"> schema default (${relFile(sf.getFilePath())})`); });
      continue;
    }
    if (!/^[A-Z]/.test(tagName.split(".").pop()!)) continue;
    const c = compOf(Node.isPropertyAccessExpression(tag) ? tag.getNameNode() : tag);
    if (!c) continue;
    const where = `<${tagName}> in ${relFile(sf.getFilePath())}`;
    for (const a of attrs) {
      if (Node.isJsxAttribute(a)) { const init = a.getInitializer(); if (init && carries(init)) feed(c, a.getNameNode().getText(), where, carryKind); }
      else if (Node.isJsxSpreadAttribute(a)) feedFromObject(c, objectLiteralOf(a.getExpression()), where);
    }
    if (children.some((ch) => carriesText(ch))) feed(c, "children", where, carryKind);
  }

  // ---- pass-through fixpoint: fed props of C flowing into child components rendered by C
  const refsFed = (e: Node, c: Comp): boolean => {
    const ids = Node.isIdentifier(e) ? [e] : e.getDescendantsOfKind(ts.SyntaxKind.Identifier);
    return ids.some((id) => {
      const t = id.getText();
      const p = c.localToProp.get(t);
      if (p && c.props.has(p)) return true;
      if (c.restIdent === t || c.propsIdent === t) {
        const parent = id.getParent();
        if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === id) return c.props.has(parent.getName());
        return c.props.size > 0;
      }
      return false;
    });
  };
  for (let round = 0, changed = true; changed && round < 12; round++) {
    changed = false;
    for (const { tag, attrs, children, el } of jsxEls) {
      const tagName = tag.getText();
      if (!/^[A-Z]/.test(tagName.split(".").pop()!)) continue;
      const parent = enclosingComp(el);
      if (!parent || !parent.props.size) continue;
      const child = compOf(Node.isPropertyAccessExpression(tag) ? tag.getNameNode() : tag);
      if (!child || child === parent) continue;
      const why = `${parent.name} (${[...parent.props].join(", ")}) → <${tagName}>`;
      for (const a of attrs) {
        if (Node.isJsxAttribute(a)) { const e = (a.getInitializer() as any)?.getExpression?.(); if (e && refsFed(e, parent) && feed(child, a.getNameNode().getText(), why, parent.literal ? "literal" : "i18n")) changed = true; }
        else if (Node.isJsxSpreadAttribute(a)) {
          const e = a.getExpression();
          if (Node.isIdentifier(e) && (e.getText() === parent.propsIdent || e.getText() === parent.restIdent)) for (const p of parent.props) if (!parent.localToProp.has(p) || e.getText() === parent.propsIdent) { if (feed(child, p, why, parent.literal ? "literal" : "i18n")) changed = true; }
        }
      }
      if (children.some((ch) => Node.isJsxExpression(ch) && ch.getExpression() && refsFed(ch.getExpression()!, parent)) && feed(child, "children", why, parent.literal ? "literal" : "i18n")) changed = true;
    }
  }

  const out = new Map<string, PropsFeed[]>();
  for (const c of comps.values()) {
    if (!c.props.size) continue;
    const f = origName.get(c.file) ?? c.file;
    const list = out.get(f) ?? [];
    list.push({ file: f, component: c.name, props: [...c.props], reasons: [...c.reasons], ...(c.literal ? {} : { i18nOnly: true }) });
    out.set(f, list);
  }

  // ---- style declarations imported from other files (theme.ts / styles.ts / exported consts)
  const REG = /^(Composition|Still|Folder)$/;
  const ownText = (fn: Node) => {
    let t = fn.getText(); const base = fn.getStart();
    const regs = fn.getDescendants().filter((d) => (Node.isJsxSelfClosingElement(d) || Node.isJsxOpeningElement(d)) && REG.test(d.getTagNameNode().getText().split(".").pop()!));
    for (const r of regs.sort((x, y) => y.getStart() - x.getStart())) t = t.slice(0, r.getStart() - base) + t.slice(r.getEnd() - base);
    return t;
  };
  const isTopVar = (d: Node): boolean => Node.isVariableDeclaration(d) && !!d.getVariableStatement() && Node.isSourceFile(d.getVariableStatement()!.getParent()) ||
    Node.isFunctionDeclaration(d) && !!d.getName() && Node.isSourceFile(d.getParent());
  const declInit = (d: Node): Node | undefined => (Node.isVariableDeclaration(d) ? d.getInitializer() : d);
  const declName = (d: Node) => (d as any).getName() as string;
  const compDecls = new Set(comps.keys());
  const valueIds = (n: Node) => n.getDescendantsOfKind(ts.SyntaxKind.Identifier).filter((d) => {
    const p = d.getParent();
    return !(p && (Node.isPropertyAccessExpression(p) && p.getNameNode() === d || Node.isPropertyAssignment(p) && p.getNameNode() === d || Node.isJsxAttribute(p) || Node.isImportSpecifier(p) || Node.isBindingElement(p) && p.getPropertyNameNode() === d));
  });
  const arabicComp = (c: Comp) => c.props.size > 0 || hasArabicLetter(ownText(c.fn)) || (!!opts.i18n?.size && i18nTexts(c.fn, opts.i18n).length > 0) ||
    valueIds(c.fn).slice(0, 200).some((id) => resolveDecls(id).some((d) => isTopVar(d) && !compDecls.has(d) && Node.isVariableDeclaration(d) && hasArabicLetter(d.getInitializer()?.getText() ?? "")));
  const collectOverrides = (e: Node | undefined, at: string, acc: Record<string, [string, string, string][]>, depth = 0) => {
    e = unwrapExpr(e);
    if (!e || depth > 5) return;
    if (Node.isCallExpression(e) && e.getArguments().length === 1) return collectOverrides(e.getArguments()[0], at, acc, depth + 1); // StyleSheet.create({…}), makeStyles({…})
    if (!Node.isObjectLiteralExpression(e)) return;
    for (const p of e.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue;
      const nm = p.getName().replace(/^["'`]|["'`]$/g, "");
      const init = unwrapExpr(p.getInitializer());
      if (!init) continue;
      if (Node.isObjectLiteralExpression(init) || Node.isCallExpression(init) && init.getArguments().length === 1 && Node.isObjectLiteralExpression(unwrapExpr(init.getArguments()[0]))) collectOverrides(init, at ? `${at}.${nm}` : nm, acc, depth + 1);
      else if (STYLE_FIX[nm]) { const v = STYLE_FIX[nm].fix(init.getText()); if (v) (acc[at] ??= []).push([nm, v, init.getText()]); }
    }
  };
  const uses = new Map<Node, { arabic: Set<string>; latin: Set<string>; local: Map<string, Set<string>> }>();
  for (const c of comps.values()) {
    const ar = arabicComp(c);
    const label = `${c.name} (${relFile(c.file)})`;
    // identifiers used by the component, plus those in same-file module-level helpers it uses (`const s = {...theme.title}`)
    const seen = new Set<Node>();
    const visit = (n: Node, depth: number) => {
      for (const id of valueIds(n)) for (const d of resolveDecls(id)) {
        if (!isTopVar(d) || compDecls.has(d) || seen.has(d)) continue;
        seen.add(d);
        const df = d.getSourceFile().getFilePath();
        if (df === id.getSourceFile().getFilePath() && df === c.file) { if (depth < 2) visit(d, depth + 1); continue; }
        const u = uses.get(d) ?? { arabic: new Set(), latin: new Set(), local: new Map() };
        (ar ? u.arabic : u.latin).add(label);
        if (ar) { const fl = origName.get(c.file) ?? c.file; const set = u.local.get(fl) ?? new Set(); set.add(id.getText()); u.local.set(fl, set); }
        uses.set(d, u);
      }
    };
    visit(c.fn, 0);
  }
  const styles: StyleUse[] = [];
  for (const [d, u] of uses) {
    if (!u.arabic.size || !isTopVar(d)) continue;
    const overrides: Record<string, [string, string, string][]> = {};
    if (Node.isVariableDeclaration(d)) collectOverrides(declInit(d), "", overrides);
    const hasFontFamily = /\bfontFamily\s*:/.test(d.getText());
    // per-letter split helpers (`export const letters = (s) => s.split("")`): splitArabic is identical for Latin text
    const hasSplit = /\.split\(\s*(""|''|``)\s*\)|Array\.from\(|\[\s*\.\.\.[\w$.]+\s*\]/.test(d.getText());
    if (!Object.keys(overrides).length && !hasFontFamily && !hasSplit) continue;
    styles.push({
      file: origName.get(d.getSourceFile().getFilePath()) ?? d.getSourceFile().getFilePath(), name: declName(d),
      arabicUsers: [...u.arabic], latinUsers: [...u.latin], exclusive: !u.latin.size, overrides, hasFontFamily, hasSplit,
      localNames: Object.fromEntries([...u.local].map(([f, set]) => [f, [...set]])),
    });
  }
  return { feeds: out, styles, compositions: [...allIds] };
}
