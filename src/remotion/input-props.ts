/**
 * Render-time input props (`remotion render … --props props.json` / `--props '{"title":"…"}'`).
 * Arabic that only arrives at render time is followed like defaultProps.
 * خصائص وقت الرندر: النص العربي الذي يصل عبر --props يُتتبَّع مثل defaultProps.
 */
import fs from "node:fs";
import path from "node:path";

export type InputProps = Record<string, unknown>;

/** Same contract as Remotion's `--props`: an inline JSON object or a path to a JSON file. */
export function loadInputProps(v: string | InputProps | undefined | null, cwd = process.cwd()): InputProps | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "object") return v;
  const s = String(v).trim();
  let text = s;
  if (!s.startsWith("{")) {
    const f = path.resolve(cwd, s);
    if (!fs.existsSync(f)) throw new Error(`--props: file not found: ${s}`);
    text = fs.readFileSync(f, "utf8");
  }
  let j: unknown;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`--props: invalid JSON (${(e as Error).message})`); }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("--props: expected a JSON object");
  return j as InputProps;
}

/** Minimal POSIX-ish word splitting (quotes and backslashes) for commands seen by the Claude Code hook. */
export function shellSplit(cmd: string): string[] {
  const out: string[] = []; let cur = "", q: string | null = null, has = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { if (ch === q) q = null; else if (ch === "\\" && q === '"' && i + 1 < cmd.length) cur += cmd[++i]; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; has = true; continue; }
    if (ch === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; has = true; continue; }
    if (/\s/.test(ch) || ch === ";" || ch === "&" || ch === "|") { if (cur || has) out.push(cur); cur = ""; has = false; if (!/\s/.test(ch)) out.push(ch); continue; }
    cur += ch; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

/**
 * From `remotion render|still [entry] <id> [out] --props … ` argv, extract the --props value and the
 * composition-id candidates (positional words after the subcommand). Candidates are only used when they
 * match a real <Composition id> in the project, so flags with values never cause a wrong match.
 */
export function parseRenderArgs(argv: string[]): { props?: string; compositions: string[] } {
  // the render/still subcommand: prefer one that follows a `remotion` token (`npx remotion render`, `@remotion/cli@4 still`)
  const sub = (k: number) => /^(render|still)$/.test(argv[k]);
  let i = argv.findIndex((_, k) => sub(k) && argv.slice(0, k).some((t) => /remotion/.test(t)));
  if (i < 0) i = argv.findIndex((_, k) => sub(k));
  let props: string | undefined;
  const compositions: string[] = [];
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === ";" || a === "&" || a === "|") { if (k > i && i >= 0) break; continue; }
    if (a.startsWith("--props=")) props = a.slice(8);
    else if (a === "--props" && k + 1 < argv.length) props = argv[++k];
    else if (i >= 0 && k > i && !a.startsWith("-") && /^[\w\u0600-\u06FF-]+$/.test(a)) compositions.push(a);
  }
  return { props, compositions };
}

/** Does a JSON value contain Arabic letters anywhere? */
export function deepArabic(v: unknown, test: (s: string) => boolean, depth = 0): boolean {
  if (depth > 8 || v == null) return false;
  if (typeof v === "string") return test(v);
  if (Array.isArray(v)) return v.some((x) => deepArabic(x, test, depth + 1));
  if (typeof v === "object") return Object.values(v as object).some((x) => deepArabic(x, test, depth + 1));
  return false;
}
