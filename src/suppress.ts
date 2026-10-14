/**
 * Suppression comments shared by the HTML engine and the TSX/JSX codemod.
 *   harakah-ignore [HZ07 HZ17]            TSX: this line · HTML: the next element and everything inside it
 *   harakah-ignore-next-line [HZ07,…]     TSX: the next line · HTML: same as harakah-ignore
 *   harakah-disable-file [HZ12 …]         the whole file (only those rules when codes are listed)
 * Without codes a directive covers every rule.
 */
export type Scope = "all" | Set<string>;
const DIRECTIVE = /harakah-(disable-file|ignore-next-line|ignore)\b((?:[\s,]+HZ\d{2})*)/gi;

export function parseDirective(text: string): { kind: "disable-file" | "ignore-next-line" | "ignore"; scope: Scope }[] {
  const out: { kind: "disable-file" | "ignore-next-line" | "ignore"; scope: Scope }[] = [];
  for (const m of text.matchAll(DIRECTIVE)) {
    const codes = (m[2].match(/HZ\d{2}/gi) || []).map((c) => c.toUpperCase());
    out.push({ kind: m[1].toLowerCase() as any, scope: codes.length ? new Set(codes) : "all" });
  }
  return out;
}
export const covers = (s: Scope | undefined, code: string) => !!s && (s === "all" || s.has(code));
export function merge(a: Scope | undefined, b: Scope): Scope {
  if (a === "all" || b === "all") return "all";
  return new Set([...(a ?? []), ...b]);
}

/** Line-based suppressions for source code (TSX/JSX/TS). */
export function lineSuppressions(src: string): { file?: Scope; lines: Map<number, Scope> } {
  const lines = new Map<number, Scope>();
  let file: Scope | undefined;
  src.split("\n").forEach((l, i) => {
    for (const d of parseDirective(l)) {
      if (d.kind === "disable-file") file = merge(file, d.scope);
      else { const ln = d.kind === "ignore-next-line" ? i + 2 : i + 1; lines.set(ln, merge(lines.get(ln), d.scope)); }
    }
  });
  return { file, lines };
}
