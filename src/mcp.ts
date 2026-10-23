#!/usr/bin/env node
/**
 * harakah-mcp: a stdio MCP server exposing Harakah to coding agents (Claude Code, Cursor, …).
 * Tools: harakah_check, harakah_fix, harakah_compare, harakah_gate.
 * خادم MCP يتيح لوكلاء البرمجة فحص النص العربي في مشاهد الموشن وإصلاحه ومقارنته قبل الرندر.
 */
import { loadInputProps } from "./remotion/input-props.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyze, fix } from "./engine.js";
import { transformSource, toIssues } from "./remotion/codemod.js";
import { fixRemotion } from "./remotion/project.js";
import { compareRemotion } from "./remotion/compare.js";
import { compareHtml, writeFixed } from "./pipeline.js";
import { gate, checkTarget, isHtml, isJsx } from "./gate.js";
import { summarize, VERSION } from "./report.js";

const server = new McpServer({ name: "harakah", version: VERSION }, {
  instructions: "Harakah checks and fixes Arabic text in motion-graphics code (HTML/GSAP/HyperFrames and Remotion .tsx/.jsx). " +
    "After writing or editing a composition that contains Arabic, call harakah_check (or harakah_fix to repair). " +
    "Before rendering (remotion render, hyperframes render), call harakah_gate and do NOT render if it returns ok=false; fix first. " +
    "Use harakah_compare to prove the fix with a real before/after render.",
});

const digits = z.enum(["eastern", "western", "keep"]).optional().describe("Digit policy: eastern ١٢٣ (default), western 123, keep");
const split = z.enum(["zwj", "word"]).optional().describe("Per-letter split repair: zwj keeps letter boxes (default), word animates whole words");
const text = (s: string) => ({ type: "text" as const, text: s });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
const brief = (issues: any[]) => issues.map((i) => ({ code: i.code, severity: i.severity, line: i.line, title: i.title?.en, message: i.message?.en, fixable: !!i.fixable }));
const kindOf = (code: string, hint?: string) => (hint === "html" || hint === "remotion" ? hint : /<!doctype|<html[\s>]/i.test(code) || !/(^|\n)\s*(import|export)\s/.test(code) ? "html" : "remotion");

server.registerTool("harakah_check", {
  title: "Check Arabic in a motion composition",
  description: "Report Arabic text problems (split letters, direction, digits, fonts, bidi, tracking) in an HTML/HyperFrames/GSAP file, a Remotion .tsx/.jsx file, an .astro/.vue/.svelte template, a project folder, or inline code. Read-only.",
  inputSchema: { path: z.string().optional().describe("File or folder to check (absolute or relative to the server's cwd)"), code: z.string().optional().describe("Inline source instead of a path"), kind: z.enum(["html", "remotion"]).optional(), digits, assumeArabic: z.boolean().optional(), props: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("Remotion render-time input props (object, inline JSON, or a JSON file path, as in `remotion render --props`). Arabic in them is followed like defaultProps"), composition: z.string().optional().describe("Remotion composition id the props apply to (default: all)") },
}, async ({ path: p, code, kind, digits: d, assumeArabic, props, composition }) => {
  if (code) {
    const k = kindOf(code, kind);
    const issues = k === "html" ? analyze(code, { digits: d ?? "eastern" } as any).issues : (() => { return toIssues(transformSource(code, { digits: d, assumeArabic }), false); })(); // severities from RULES, same as the CLI
    return { content: [json({ kind: k, summary: summarize(issues as any), issues: brief(issues) })] };
  }
  if (!p) throw new Error("Pass path or code.");
  const files = await checkTarget(p, { digits: d, assumeArabic, inputProps: loadInputProps(props as any), composition });
  const all = files.flatMap((f) => f.issues);
  return { content: [json({ target: p, summary: summarize(all), files: files.map((f) => ({ file: f.file, kind: f.kind, issues: brief(f.issues) })) })] };
});

server.registerTool("harakah_fix", {
  title: "Fix Arabic in a motion composition",
  description: "Repair Arabic text problems. With code: returns the fixed source and a diff. With path: Remotion files/projects are rewritten in place when write=true (otherwise dry-run diff); HTML files are written to `out` (or in place when write=true). .astro/.vue/.svelte templates (or a folder of them) return a reviewable unified patch of position edits, applied only when write=true. Adds harakah: comments at every change; unsafe cases are reported, not changed.",
  inputSchema: { path: z.string().optional(), code: z.string().optional(), kind: z.enum(["html", "remotion"]).optional(), write: z.boolean().optional().describe("Apply changes to disk (default false = preview)"), out: z.string().optional().describe("HTML: output file (default: in place when write=true)"), digits, split, assumeArabic: z.boolean().optional(), wrapWords: z.boolean().optional().describe("Remotion: keep words together (nowrap word boxes) so wrapped lines never break mid-word"), props: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("Remotion render-time input props (object, inline JSON, or a JSON file path, as in `remotion render --props`). Arabic in them is followed like defaultProps"), composition: z.string().optional().describe("Remotion composition id the props apply to (default: all)") },
}, async ({ path: p, code, kind, write, out, digits: d, split: s, assumeArabic, wrapWords, props, composition }) => {
  if (code) {
    const k = kindOf(code, kind);
    if (k === "html") { const r = fix(code, { digits: d ?? "eastern", split: s ?? "zwj", fontSrc: "google" } as any); return { content: [json({ kind: k, applied: r.applied.map((i: any) => i.code), remaining: brief(r.remaining) }), text(r.html)] }; }
    const r = transformSource(code, { digits: d, split: s, assumeArabic, wrapWords, helperImport: "./harakah-arabic" });
    return { content: [json({ kind: k, changed: r.code !== code, changes: r.changes.map((c) => `${c.code} L${c.line}: ${c.en}`), reportOnly: r.reports.map((c) => `${c.code} L${c.line}: ${c.en}`), helper: r.usesHelper ? "imports ./harakah-arabic (get it from `harakah-fix fix --write` or @harakah/remotion-arabic)" : undefined }), text(r.code)] };
  }
  if (!p) throw new Error("Pass path or code.");
  if (/\.(astro|vue|svelte)$/i.test(p) || (fs.statSync(p).isDirectory() && !(await import("./gate.js")).isRemotionProject(path.resolve(p)) && (await import("./templates.js")).templateFiles(path.resolve(p)).length > 0)) {
    // templates: a reviewable unified patch of position edits (written only with write=true)
    const { templatePatches } = await import("./template-patch.js");
    const rs = templatePatches(p, { digits: d ?? "eastern" } as any);
    if (write) for (const x of rs) if (x.patch) fs.writeFileSync(x.file, x.fixed);
    const patch = rs.map((x) => x.patch).join("");
    return { content: [json({ kind: "template", written: write ? rs.filter((x) => x.patch).map((x) => x.file) : [], before: rs.reduce((n, x) => n + x.before.length, 0), after: rs.reduce((n, x) => n + x.after.length, 0), skipped: rs.flatMap((x) => x.skipped.map((k) => `${path.basename(x.file)}:${k.line} ${k.why}`)), remaining: brief(rs.flatMap((x) => x.after)) }), ...(patch ? [text(patch)] : [])] };
  }
  if (isHtml(p)) {
    const src = fs.readFileSync(p, "utf8");
    const r = fix(src, { digits: d ?? "eastern", split: s ?? "zwj", fontSrc: "file", baseDir: path.dirname(path.resolve(p)) } as any);
    const dest = out ?? (write ? p : undefined);
    if (dest) writeFixed(r, dest);
    return { content: [json({ kind: "html", written: dest ?? null, applied: [...new Set(r.applied.map((i: any) => i.code))], remaining: brief(r.remaining), fonts: r.assets.map((a: any) => a.rel) }), ...(dest ? [] : [text(r.html)])] };
  }
  const r = await fixRemotion(p, { dryRun: !write, digits: d, split: s, assumeArabic, wrapWords, inputProps: loadInputProps(props as any), composition });
  const changed = r.files.filter((f) => f.after !== f.before);
  return { content: [json({ kind: "remotion", written: !!write, changedFiles: changed.map((f) => f.file), helper: r.helper, arabicViaProps: r.props.map((x) => ({ component: x.component, file: x.file, reasons: x.reasons })), reportOnly: r.files.flatMap((f) => f.issues.filter((i) => !i.fixable).map((i) => `${path.basename(f.file)}:${(i as any).line ?? ""} ${i.code} ${i.title.en}`)) }), text([...changed.map((f) => f.diff), ...r.css.filter((c) => c.after !== c.before).map((c) => c.diff)].join("\n") || "(no changes)")] };
});

server.registerTool("harakah_gate", {
  title: "Gate: is the Arabic safe to render?",
  description: "Call before any render (remotion render/still, hyperframes render). Returns ok=false with the blocking problems and the fix command when Arabic would render broken, or with `inconclusive` reasons when a requested check couldn't run. Do not render when ok=false.",
  inputSchema: { path: z.string().describe("File or project folder about to be rendered"), strict: z.boolean().optional().describe("Also block on warnings"), digits, assumeArabic: z.boolean().optional(), props: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("Remotion render-time input props (object, inline JSON, or a JSON file path, as in `remotion render --props`). Arabic in them is followed like defaultProps"), composition: z.string().optional().describe("Remotion composition id the props apply to (default: all)"), layout: z.boolean().optional().describe("Also audit Arabic visual order at sampled frames (HTML in headless Chrome, Remotion compositions through the bundle): letters/words/rows right-to-left, no flips or overlaps. Slower") },
}, async ({ path: p, strict, digits: d, assumeArabic, props, composition, layout }) => {
  const g = await gate(p, { strict, digits: d, assumeArabic, inputProps: loadInputProps(props as any), propsArg: typeof props === "string" ? props : undefined, composition, layout });
  return { content: [text(g.message), json({ ok: g.ok, blocking: g.blocking, inconclusive: g.inconclusive, summary: g.summary, fixCommand: g.fixCommand })] };
});

server.registerTool("harakah_compare", {
  title: "Prove it: render before/after",
  description: "Render the composition before and after the fix (Remotion via @remotion/renderer, HTML via headless Chrome) and verify that Arabic letters are joined (ink-piece count vs a running-text reference). Returns the side-by-side PNG and the verdict. Slow (15–60 s).",
  inputSchema: { path: z.string(), outDir: z.string().optional(), composition: z.string().optional().describe("Remotion composition id(s), comma-separated"), frame: z.number().int().optional(), video: z.boolean().optional(), layout: z.boolean().optional().describe("Runtime layout audit of before/after at sampled frames (default true)") },
}, async ({ path: p, outDir, composition, frame, video, layout }) => {
  const dir = outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "harakah-mcp-"));
  if (isJsx(p) || fs.statSync(p).isDirectory()) {
    const r = await compareRemotion(p, { outDir: dir, compositions: composition?.split(","), frame, video, layout });
    const lay = (f: any) => ({ code: f.code, problem: f.problem, where: f.key, detail: f.detail });
    const verdict = r.renders.map((x) => ({ id: x.id, frame: x.frame, joinedAfter: x.joinedAfter, joinedBefore: x.joinedBefore, diffAfter: +x.diffAfter.toFixed(3), inkAfter: x.after.components, inkReference: x.reference.components, png: x.comparePng, mp4: x.mp4,
      layout: x.layout ? { frames: x.layout.frames, before: x.layout.before.map(lay), after: x.layout.after.map(lay) } : undefined }));
    const png = verdict.find((v) => v.png)?.png;
    return { content: [json({ ok: r.renders.every((x) => x.joinedAfter), outDir: dir, verdict }), ...(png && fs.existsSync(png) ? [{ type: "image" as const, data: fs.readFileSync(png).toString("base64"), mimeType: "image/png" }] : [])] };
  }
  const src = fs.readFileSync(p, "utf8");
  const r = await compareHtml(src, dir, { digits: "eastern" } as any, { video: !!video, layout }, path.dirname(path.resolve(p)));
  const png = r.comparePng;
  const lay = (f: any) => ({ code: f.code, problem: f.problem, where: f.key, detail: f.detail });
  return { content: [json({ ok: (r.joins ?? []).every((j: any) => j.joinedAfter), outDir: dir, joins: r.joins, engine: r.engine, network: r.network, layout: r.layout ? { frames: r.layout.frames, before: r.layout.before.map(lay), after: r.layout.after.map(lay) } : undefined }), ...(fs.existsSync(png) ? [{ type: "image" as const, data: fs.readFileSync(png).toString("base64"), mimeType: "image/png" }] : [])] };
});

await server.connect(new StdioServerTransport());
