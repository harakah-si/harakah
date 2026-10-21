/** Pure tool logic for the hosted Harakah MCP server (no I/O, no storage). */
import { analyze, fix } from "../../src/engine.js";
import { transformSource } from "../../src/remotion/codemod.js";
import { summarize, VERSION } from "../../src/report.js";

export const MAX_CODE_CHARS = 200_000;
export { VERSION };

type Kind = "html" | "remotion";
const kindOf = (code: string, hint?: string): Kind =>
  hint === "html" || hint === "remotion" ? hint
  : /<!doctype|<html[\s>]/i.test(code) || !/(^|\n)\s*(import|export)\s/.test(code) ? "html" : "remotion";
const brief = (issues: any[]) => issues.map((i) => ({ code: i.code, severity: i.severity, line: i.line ?? null, title: i.title?.en ?? null, message: i.message?.en ?? null, fixable: !!i.fixable }));

const common = {
  code: { type: "string", minLength: 1, maxLength: MAX_CODE_CHARS, description: `Source code of one file (HTML/GSAP/HyperFrames page or Remotion .tsx/.jsx component), up to ${MAX_CODE_CHARS} characters. Send only the file being worked on.` },
  kind: { type: "string", enum: ["html", "remotion"], description: "File type. Omit to auto-detect (import/export statements mean Remotion)." },
  digits: { type: "string", enum: ["eastern", "western", "keep"], description: "Digit policy: eastern ١٢٣ (default), western 123, or keep as written." },
};
const ann = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const TOOLS = [
  {
    name: "check_arabic",
    title: "Check Arabic in motion code",
    description: "Find Arabic text problems in one motion-graphics source file (HTML/GSAP/HyperFrames, or a Remotion .tsx/.jsx component): letters split into per-letter boxes that break joining, missing right-to-left direction, Latin-only fonts, letter-spacing on Arabic, mixed digit styles, and canvas/3D text drawn letter by letter. Returns ok (true when there are no errors or warnings), a summary and a list of issues with line numbers. Does not change anything and stores nothing.",
    inputSchema: { type: "object", properties: { ...common }, required: ["code"], additionalProperties: false },
    annotations: ann("Check Arabic in motion code"),
  },
  {
    name: "fix_arabic",
    title: "Fix Arabic in motion code",
    description: "Return a repaired copy of one motion-graphics source file with broken Arabic fixed (joined letters kept while preserving per-letter animation, right-to-left direction, an Arabic-capable font, no letter-spacing, consistent digits), plus a list of each change and any issues that could not be fixed safely. Every change is marked with a harakah: comment. Only returns text; it does not write files and stores nothing.",
    inputSchema: { type: "object", properties: { ...common, split: { type: "string", enum: ["zwj", "word"], description: "Per-letter split repair: zwj keeps letter boxes joined (default), word animates whole words." } }, required: ["code"], additionalProperties: false },
    annotations: ann("Fix Arabic in motion code"),
  },
] as const;

export class InputError extends Error {}

function validate(args: any, allowSplit: boolean) {
  if (!args || typeof args !== "object") throw new InputError("Arguments must be an object with a `code` string.");
  const { code, kind, digits, split, ...rest } = args;
  const extra = Object.keys(rest); if (extra.length) throw new InputError(`Unknown argument(s): ${extra.join(", ")}`);
  if (typeof code !== "string" || !code.length) throw new InputError("`code` must be a non-empty string.");
  if (code.length > MAX_CODE_CHARS) throw new InputError(`\`code\` is ${code.length} characters; the limit is ${MAX_CODE_CHARS}. Send one file at a time.`);
  if (kind !== undefined && kind !== "html" && kind !== "remotion") throw new InputError("`kind` must be html or remotion.");
  if (digits !== undefined && !["eastern", "western", "keep"].includes(digits)) throw new InputError("`digits` must be eastern, western or keep.");
  if (split !== undefined && (!allowSplit || !["zwj", "word"].includes(split))) throw new InputError("`split` must be zwj or word (fix_arabic only).");
  return { code, kind, digits, split } as { code: string; kind?: Kind; digits?: "eastern" | "western" | "keep"; split?: "zwj" | "word" };
}

export function checkArabic(args: any) {
  const { code, kind, digits } = validate(args, false);
  const k = kindOf(code, kind);
  const issues: any[] = k === "html" ? analyze(code, { digits: digits ?? "eastern" } as any).issues : (() => {
    const r = transformSource(code, { digits } as any);
    return [...r.changes.map((c: any) => ({ code: c.code, severity: "error", line: c.line, title: { en: c.en }, message: { en: c.en }, fixable: true })),
            ...r.reports.map((c: any) => ({ code: c.code, severity: "warning", line: c.line, title: { en: c.en }, message: { en: c.en }, fixable: false }))];
  })();
  const summary = summarize(issues as any);
  return { kind: k, ok: summary.errors === 0 && summary.warnings === 0, summary, issues: brief(issues) };
}

export function fixArabic(args: any) {
  const { code, kind, digits, split } = validate(args, true);
  const k = kindOf(code, kind);
  if (k === "html") {
    const r: any = fix(code, { digits: digits ?? "eastern", split: split ?? "zwj", fontSrc: "google" } as any);
    return { kind: k, changed: r.html !== code, changes: [...new Set(r.applied.map((i: any) => i.code))], remaining: brief(r.remaining), fixedCode: r.html as string };
  }
  const r: any = transformSource(code, { digits, split, helperImport: "./harakah-arabic" } as any);
  return { kind: k, changed: r.code !== code, changes: r.changes.map((c: any) => `${c.code} L${c.line}: ${c.en}`), remaining: r.reports.map((c: any) => `${c.code} L${c.line}: ${c.en}`),
    helper: r.usesHelper ? "The fixed code imports ./harakah-arabic. Get that helper from the @harakah/remotion-arabic npm package or by running `npx harakah-fixer fix --write` locally." : undefined, fixedCode: r.code as string };
}
