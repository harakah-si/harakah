/**
 * Shared "is this safe to render?" logic for the CLI `gate` command, the MCP server and the
 * Claude Code hooks. A target is an HTML file, a .tsx/.jsx file, or a project folder (Remotion
 * project and/or HyperFrames/GSAP HTML files).
 * فحص «هل المشهد جاهز للرندر؟» المشترك بين سطر الأوامر وخادم MCP وخطافات Claude Code.
 */
import fs from "node:fs";
import path from "node:path";
import { isTemplate, analyzeTemplate, checkTemplates } from "./templates.js";
import { analyze, type Issue, type Options } from "./engine.js";
import { fixRemotion, cssIssues, type FixRemotionOptions } from "./remotion/project.js";
import { summarize } from "./report.js";
import type { InputProps } from "./remotion/input-props.js";

export interface GateOptions {
  /** Block on warnings too (default: errors only). */
  strict?: boolean;
  digits?: "eastern" | "western" | "keep";
  split?: "zwj" | "word";
  assumeArabic?: boolean;
  /** Render-time input props (`remotion render --props`) and the composition id(s) they apply to. */
  inputProps?: InputProps;
  composition?: string | string[];
  /** How the props were given (file path or JSON), echoed in the fix command. */
  propsArg?: string;
  /** Wording of the message: before a render (default) or right after an edit. */
  purpose?: "render" | "edit";
  /** Also render HTML files in headless Chrome and audit Arabic visual order at sampled frames (HZ24/HZ22). Slower. */
  layout?: boolean;
  layoutFps?: number;
  /** Pass even when a check couldn't run (the layout audit: no Chrome, a bundle error). Default: HARAKAH_GATE=lenient. */
  lenient?: boolean;
}
export interface GateFile { file: string; kind: "html" | "remotion" | "css" | "template"; issues: Issue[]; inconclusive?: string }
export interface GateResult {
  ok: boolean;
  target: string;
  files: GateFile[];
  blocking: { file: string; code: string; severity: string; title: string; fixable: boolean; line?: number }[];
  summary: ReturnType<typeof summarize>;
  /** Checks that couldn't run (e.g. the layout audit without Chrome). A gate that couldn't check doesn't pass, unless lenient. */
  inconclusive: { file: string; reason: string }[];
  /** Human-readable verdict (English + Arabic), suitable for an agent or a hook message. */
  message: string;
  fixCommand?: string;
}

const SKIP = new Set(["node_modules", ".git", "out", "dist", "build", ".next", ".cache", "renders", "harakah-compare"]);
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
export const isHtml = (f: string) => /\.html?$/i.test(f);
export const isJsx = (f: string) => /\.(t|j)sx$/i.test(f);
export const isRemotionProject = (dir: string) => {
  const pkg = path.join(dir, "package.json");
  if (fs.existsSync(pkg)) { try { const j = JSON.parse(fs.readFileSync(pkg, "utf8")); if ({ ...j.dependencies, ...j.devDependencies }.remotion) return true; } catch {} }
  return fs.existsSync(path.join(dir, "src", "Root.tsx")) || fs.existsSync(path.join(dir, "remotion.config.ts"));
};
/** HTML files under a folder (depth ≤ 4, skipping node_modules/.git/out/dist/…). */
export function htmlFiles(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 4) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, depth + 1, out); else if (isHtml(e.name)) out.push(p);
  }
  return out;
}

export async function checkTarget(target: string, o: GateOptions = {}): Promise<GateFile[]> {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${target}`);
  const files: GateFile[] = [];
  const htmlOpts: Options = { digits: o.digits ?? "eastern", split: o.split ?? "zwj" } as Options;
  const remOpts: FixRemotionOptions = { dryRun: true, digits: o.digits ?? "eastern", split: o.split ?? "zwj", assumeArabic: !!o.assumeArabic, inputProps: o.inputProps, composition: o.composition };
  const htmlTodo: string[] = [];
  const doHtml = (f: string) => { const src = fs.readFileSync(f, "utf8"); if (ARABIC.test(src)) { files.push({ file: f, kind: "html", issues: analyze(src, { ...htmlOpts, baseDir: path.dirname(f) }).issues }); htmlTodo.push(f); } };
  const doRemotion = async (t: string) => {
    const r = await fixRemotion(t, remOpts);
    for (const f of r.files) if (f.issues.length) files.push({ file: f.file, kind: "remotion", issues: f.issues });
    for (const c of r.css) if (c.notes.length) files.push({ file: c.file, kind: "css", issues: cssIssues(c, false) });
  };
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (isHtml(abs)) doHtml(abs);
    else if (isJsx(abs)) await doRemotion(abs);
    else if (isTemplate(abs)) { const issues = analyzeTemplate(abs, htmlOpts); if (issues.length) files.push({ file: abs, kind: "template", issues }); }
    else throw new Error(`Unsupported file type: ${target} (expected .html, .tsx, .jsx, .astro, .vue or .svelte)`);
  } else {
    if (isRemotionProject(abs)) await doRemotion(abs);
    for (const f of htmlFiles(abs)) doHtml(f);
    for (const t of checkTemplates(abs, htmlOpts)) files.push({ file: t.file, kind: "template", issues: t.issues });
  }
  if (o.layout && (st.isDirectory() ? isRemotionProject(abs) : isJsx(abs))) {
    // Remotion compositions: bundle, seek sampled frames, read the DOM boxes (HZ24)
    const { auditRemotion } = await import("./remotion/layout.js");
    try {
      const r = await auditRemotion(abs, { inputProps: o.inputProps, compositions: o.composition ? String(o.composition).split(",") : undefined, fps: o.layoutFps ?? 2, maxFrames: 60 });
      for (const c of r.compositions) if (c.issues.length) files.push({ file: path.join(r.root, `#${c.id}`), kind: "remotion", issues: c.issues });
    } catch (e: any) {
      files.push({ file: abs, kind: "remotion", inconclusive: `Remotion layout audit did not run: ${String(e?.message ?? e).split("\n")[0]}`, issues: [{ code: "HZ24", name: "visual-order", severity: "info", title: { en: "Layout audit did not run", ar: "لم يعمل تدقيق الترتيب" }, why: { en: "", ar: "" }, message: { en: `Remotion layout audit skipped: ${String(e?.message ?? e).split("\n")[0]}`, ar: "تعذّر تدقيق ترتيب العرض لـ Remotion." }, fixMode: "none", fixable: false } as Issue] });
    }
  }
  if (o.layout && htmlTodo.length) {
    const { auditLayoutFile } = await import("./layout-audit.js");
    for (const f of htmlTodo.slice(0, 20)) {
      const entry = files.find((x) => x.file === f && x.kind === "html");
      try {
        const r = await auditLayoutFile(f, { fps: o.layoutFps ?? 6 });
        if (entry) entry.issues.push(...r.issues);
        // offline and the scene needs the internet (a CDN script or font): what was audited isn't the real scene
        if (entry && r.network.blocked.length) entry.inconclusive = `offline: the scene loads ${r.network.blocked.join(", ")} from the internet, so its layout couldn't be checked`;
      } catch (e: any) {
        if (entry) entry.inconclusive = `layout audit did not run: ${String(e?.message ?? e).split("\n")[0]}`;
      }
    }
  }
  return files;
}

const shq = (s: string) => /^[\w./@:-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
export async function gate(target: string, o: GateOptions = {}): Promise<GateResult> {
  const files = await checkTarget(target, o);
  const isBlocking = (i: Issue) => i.severity === "error" || (!!o.strict && i.severity === "warning");
  const rel = (f: string) => path.relative(process.cwd(), f) || f;
  const blocking = files.flatMap((f) => f.issues.filter(isBlocking).map((i) => ({ file: rel(f.file), code: i.code, severity: i.severity, title: i.title.en, fixable: !!i.fixable, line: (i as any).line })));
  const all = files.flatMap((f) => f.issues);
  const summary = summarize(all);
  const inconclusive = files.filter((f) => f.inconclusive).map((f) => ({ file: rel(f.file), reason: f.inconclusive! }));
  const lenient = o.lenient ?? process.env.HARAKAH_GATE === "lenient";
  const ok = blocking.length === 0 && (lenient || inconclusive.length === 0);
  const remotionish = files.some((f) => (f.kind === "remotion" || f.kind === "css") && f.issues.some(isBlocking));
  const htmlBlocking = files.some((f) => f.kind === "html" && f.issues.some(isBlocking));
  const fixCommand = ok || !blocking.length ? undefined : !remotionish && !htmlBlocking ? `harakah-fix fix ${target} --patch harakah-templates.patch (review it, then git apply; dynamic attributes stay manual)` : remotionish ? `harakah-fix fix ${target} --write${o.inputProps ? ` --props ${shq(o.propsArg ?? JSON.stringify(o.inputProps))}` : ""}` : files.filter((f) => f.kind === "html" && f.issues.some(isBlocking)).map((f) => `harakah-fix fix ${rel(f.file)} -o ${rel(f.file)}`).join(" && ");
  const lines = blocking.slice(0, 12).map((b) => `  - ${b.file}${b.line ? `:${b.line}` : ""} ${b.code} ${b.title}${b.fixable ? " (auto-fixable)" : " (manual)"}`);
  const unchecked = inconclusive.map((x) => `  - ${x.file}: ${x.reason}`);
  const message = ok
    ? [`Harakah: Arabic text is safe to render (${files.length ? `${summary.warnings} warning(s), ${summary.info} note(s) in ${files.length} file(s)` : "no Arabic problems found"}). · النص العربي جاهز للرندر.`,
       ...(unchecked.length ? ["Not checked (HARAKAH_GATE=lenient):", ...unchecked] : [])].join("\n")
    : !blocking.length
    ? [`Harakah could not finish checking the Arabic, so the render is blocked until it can. · تعذّر إكمال فحص النص العربي، فأُوقف الرندر حتى يكتمل.`,
       ...unchecked,
       `Fix the cause (Chrome missing or failing to start, a bundle error), or set HARAKAH_GATE=lenient to render without this check.`].join("\n")
    : [o.purpose === "edit"
        ? `Harakah found ${blocking.length} Arabic problem(s) that will render as broken letters/direction. Fix them before rendering. · وجدت حركة مشاكل ستُظهر النص العربي مكسوراً؛ أصلحها قبل الرندر.`
        : `Harakah blocked the render: ${blocking.length} Arabic problem(s) would ship broken letters/direction. · أوقفت حركة الرندر: النص العربي سيظهر مكسوراً.`,
       ...lines, blocking.length > 12 ? `  … ${blocking.length - 12} more` : "",
       `Fix: ${fixCommand}  (then re-run the check; "harakah-fix compare" renders before/after to verify)`].filter(Boolean).join("\n");
  return { ok, target, files, blocking, summary, inconclusive, message, fixCommand };
}

/* ---------------- GitHub Actions output (gate --github) ---------------- */

// workflow command escaping (actions/toolkit): data escapes % CR LF; properties also : and ,
const ghData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const ghProp = (s: string) => ghData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const posix = (f: string) => f.split(path.sep).join("/");

/**
 * One `::error` / `::warning` workflow command per problem, so GitHub shows it on the line in the pull request: errors
 * (and warnings with --strict) block, other warnings annotate, notes are left out. A check that couldn't run is an error
 * too, as the gate doesn't pass. Paths are relative to the working directory (GITHUB_WORKSPACE in a workflow). Errors
 * come first: GitHub shows only the first few annotations of each level per step (the job summary lists every blocker).
 */
export function githubAnnotations(g: GateResult, o: { strict?: boolean; cwd?: string } = {}): string[] {
  const cwd = o.cwd ?? process.cwd();
  const out: string[] = [];
  for (const f of g.files) {
    // Remotion layout findings are per composition (root/#Id): annotate the project, not a file that doesn't exist
    const exists = fs.existsSync(f.file);
    const file = posix(path.relative(cwd, exists ? f.file : path.dirname(f.file)) || ".");
    for (const i of f.issues) {
      if (i.severity === "info") continue;
      const level = i.severity === "error" || o.strict ? "error" : "warning";
      const props = [`file=${ghProp(file)}`, ...(exists && i.line ? [`line=${i.line}`] : []), `title=${ghProp(`${i.code} ${i.title.en}`)}`];
      const where = i.where && !exists ? `${i.where}: ` : "";
      out.push(`::${level} ${props.join(",")}::${ghData(`${where}${i.message.en}${i.fixable ? " (auto-fixable: harakah-fix fix)" : ""}\n${i.message.ar}`)}`);
    }
  }
  for (const x of g.inconclusive) out.push(`::error file=${ghProp(posix(x.file))},title=${ghProp("Harakah could not check this")}::${ghData(`${x.reason}\nSet HARAKAH_GATE=lenient to pass without this check.`)}`);
  // GitHub shows only the first few annotations of each level per step: errors first
  return [...out.filter((a) => a.startsWith("::error")), ...out.filter((a) => !a.startsWith("::error"))];
}

/** Markdown for the job summary (GITHUB_STEP_SUMMARY): the verdict, a table of the blocking problems, and the fix command. */
export function githubSummary(g: GateResult): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const head = g.ok ? "### ✅ Harakah: Arabic is safe to render" : g.blocking.length ? `### ❌ Harakah: ${g.blocking.length} Arabic problem(s) would render broken` : "### ⚠️ Harakah couldn't finish checking the Arabic";
  const rows = g.blocking.slice(0, 50).map((b) => `| \`${cell(posix(b.file))}${b.line ? `:${b.line}` : ""}\` | ${b.code} | ${cell(b.title)} | ${b.fixable ? "auto" : "manual"} |`);
  return [head, "",
    `${g.summary.errors} error(s), ${g.summary.warnings} warning(s), ${g.summary.info} note(s) in ${g.files.length} file(s) with Arabic.`, "",
    ...(rows.length ? ["| Where | Rule | Problem | Fix |", "|---|---|---|---|", ...rows, ...(g.blocking.length > 50 ? [`| … | | ${g.blocking.length - 50} more | |`] : []), ""] : []),
    ...(g.inconclusive.length ? ["Not checked:", ...g.inconclusive.map((x) => `- \`${cell(posix(x.file))}\`: ${cell(x.reason)}`), ""] : []),
    ...(g.fixCommand ? ["Fix:", "```", g.fixCommand, "```", ""] : []),
  ].join("\n");
}
