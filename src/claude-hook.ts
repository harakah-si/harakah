#!/usr/bin/env node
/**
 * harakah-hook: Claude Code hook handler (reads the hook JSON on stdin).
 *   harakah-hook post-edit   → PostToolUse on Write|Edit|MultiEdit: checks the edited .html/.tsx/.jsx when it contains Arabic
 *                              and feeds the problems back to Claude (decision "block" = "please address this").
 *                              HARAKAH_AUTOFIX=1 applies the safe fixes automatically instead.
 *   harakah-hook pre-render  → PreToolUse on Bash: denies `remotion render|still`, `hyperframes render` and `npm run render`
 *                              style commands while the Arabic would render broken.
 * Never throws: on internal errors it stays silent (exit 0) so it can't wedge a session.
 * خطاف Claude Code: يفحص المشاهد العربية بعد كتابتها، ويمنع الرندر إذا كان النص العربي سيظهر مكسوراً.
 */
import fs from "node:fs";
import path from "node:path";
// heavy modules (ts-morph, renderer) load lazily so non-render Bash calls stay ~50 ms
const lazyGate = () => import("./gate.js").then((m) => m.gate);
const isHtml = (f: string) => /\.html?$/i.test(f);
const isJsx = (f: string) => /\.(t|j)sx$/i.test(f);

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
// render commands Harakah guards (npx/bunx/pnpm dlx prefixes allowed)
export const RENDER_RE = /(?:^|[\s;&|(])(?:(?:npx|bunx|pnpx)\s+(?:-y\s+)?|pnpm\s+(?:dlx\s+|exec\s+)?|yarn\s+)?(?:@?remotion(?:\/cli)?(?:@[\w.-]+)?\s+(?:render|still|lambda\s+render)|hyperframes(?:@[\w.-]+)?\s+render|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?render\b)/;

async function readStdin(): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

/** Where a render command will read from: hyperframes' positional dir, else the shell cwd. */
export function renderTarget(command: string, cwd: string): string {
  const m = command.match(/hyperframes(?:@[\w.-]+)?\s+render\s+((?:"[^"]+")|(?:'[^']+')|[^\s-][^\s]*)/);
  let dirArg = m?.[1]?.replace(/^["']|["']$/g, "");
  if (!dirArg) {
    // flags before the dir (`render --out ./dist ./scenes`): skip each flag and its value, take the first positional left
    const rest = command.match(/hyperframes(?:@[\w.-]+)?\s+render\s+([^;&|]*)/)?.[1] ?? "";
    const toks = rest.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].startsWith("-")) { if (!toks[i].includes("=")) i++; continue; }
      dirArg = toks[i].replace(/^["']|["']$/g, ""); break;
    }
  }
  const cd = command.match(/(?:^|&&|;)\s*cd\s+((?:"[^"]+")|(?:'[^']+')|[^\s;&]+)/);
  const base = cd ? path.resolve(cwd, cd[1].replace(/^["']|["']$/g, "")) : cwd;
  return dirArg ? path.resolve(base, dirArg) : base;
}

export async function postEdit(input: any): Promise<object | null> {
  const file = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!file || !(isHtml(file) || isJsx(file)) || !fs.existsSync(file)) return null;
  if (!ARABIC.test(fs.readFileSync(file, "utf8"))) return null;
  const gate = await lazyGate();
  if (process.env.HARAKAH_AUTOFIX === "1") {
    let note = "";
    const { fixRemotion } = await import("./remotion/project.js");
    const { fix } = await import("./engine.js");
    const { writeFixed } = await import("./pipeline.js");
    if (isJsx(file)) { const r = await fixRemotion(file, {}); const n = r.files.filter((f) => f.after !== f.before).length; if (n) note = `Harakah auto-fixed Arabic in ${path.basename(file)} (see harakah: comments)${r.helper?.path ? `; helper at ${r.helper.path}` : ""}.`; }
    else { const r = fix(fs.readFileSync(file, "utf8"), { fontSrc: "file" } as any); if (r.applied.length) { writeFixed(r, file); note = `Harakah auto-fixed Arabic in ${path.basename(file)}: ${[...new Set(r.applied.map((i: any) => i.code))].join(", ")}.`; } }
    const g = await gate(file, { purpose: "edit" });
    const ctx = [note, g.ok ? "" : g.message].filter(Boolean).join("\n");
    return ctx ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx } } : null;
  }
  const g = await gate(file, { purpose: "edit" });
  const fixable = g.files.flatMap((f) => f.issues).filter((i) => i.fixable && i.severity !== "info");
  if (g.ok && !fixable.length) return null;
  const reason = g.ok
    ? `Harakah: ${fixable.length} fixable Arabic issue(s) in ${path.basename(file)} (${[...new Set(fixable.map((i) => i.code))].join(", ")}). Run harakah_fix (MCP) or \`harakah-fix fix ${file} ${isJsx(file) ? "--write" : `-o ${file}`}\`.`
    : g.message;
  return { decision: "block", reason, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: reason } };
}

export async function preRender(input: any): Promise<object | null> {
  const command: string = input?.tool_input?.command || "";
  if (!RENDER_RE.test(command) || process.env.HARAKAH_GATE === "off") return null;
  const target = renderTarget(command, input?.cwd || process.cwd());
  if (!fs.existsSync(target)) return null;
  const gate = await lazyGate();
  // follow `--props` (inline JSON or file) and the composition id of `remotion render|still`
  const { parseRenderArgs, shellSplit, loadInputProps } = await import("./remotion/input-props.js");
  const ra = parseRenderArgs(shellSplit(command));
  let inputProps;
  try { inputProps = loadInputProps(ra.props, target); } catch { inputProps = undefined; }
  const g = await gate(target, { strict: process.env.HARAKAH_GATE === "strict", inputProps, propsArg: ra.props, composition: ra.compositions });
  if (g.ok) return null;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: g.message } };
}

const isMain = process.argv[1] && /claude-hook\.(js|ts)$/.test(process.argv[1]) || process.argv[1]?.endsWith("harakah-hook");
if (isMain) {
  const mode = process.argv[2];
  try {
    const input = await readStdin();
    const out = mode === "post-edit" ? await postEdit(input) : mode === "pre-render" ? await preRender(input) : null;
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stderr.write(`harakah-hook: ${(e as Error).message}\n`);
  }
  process.exit(0);
}
