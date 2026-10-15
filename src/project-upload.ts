/**
 * Whole-project mode for the web tool: a Remotion project arrives as a .zip or as a list of files (folder drop),
 * is written to a temp dir, fixed with the full project pipeline (props-following across files, CSS modules,
 * vendored helper, prettier), and the result is kept for download as a fixed .zip or a unified patch.
 * وضع المشروع الكامل: ارفع مجلد Remotion أو ملف zip، واحصل على مشروع مُصلح أو ملف patch.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { createTwoFilesPatch } from "diff";
import { fixRemotion, cssIssues, type FixRemotionOptions } from "./remotion/project.js";
import { toIssues } from "./remotion/codemod.js";
import { summarize } from "./report.js";
import { ARABIC_LETTER_RE } from "./arabic.js";

export const LIMITS = { files: 3000, fileBytes: 8 << 20, totalBytes: 60 << 20 };
const SKIP = /(^|\/)(node_modules|\.git|out|dist|build|\.next|\.cache|\.remotion|\.turbo|\.DS_Store|__MACOSX)(\/|$)/;
const TEXT = /\.(tsx?|jsx?|mjs|cjs|css|scss|json|md|mdx|html?|svg|txt|yml|yaml|gitignore|npmrc|prettierrc)$/i;

export interface InFile { path: string; data: Uint8Array }

/** Normalize an uploaded path; null if unsafe (absolute, .., drive letters) or skipped. */
export function safeRel(p: string): string | null {
  const s = p.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!s || s.startsWith("/") || /^[a-z]:/i.test(s) || s.split("/").some((x) => x === ".." || x === "")) return null;
  if (SKIP.test(s)) return null;
  return s;
}

/** Drop a single shared top-level folder ("my-project/…") so the project root is the folder itself. */
export function stripCommonRoot(files: InFile[]): { files: InFile[]; root: string } {
  const tops = new Set(files.map((f) => f.path.split("/")[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes("/"))) {
    const root = [...tops][0];
    return { root, files: files.map((f) => ({ ...f, path: f.path.slice(root.length + 1) })) };
  }
  return { root: "", files };
}

export function filesFromZip(buf: Uint8Array): InFile[] {
  let total = 0, count = 0;
  const out = unzipSync(buf, {
    filter: (f) => {
      if (f.name.endsWith("/") || !safeRel(f.name)) return false;
      if (f.originalSize > LIMITS.fileBytes) return false;
      total += f.originalSize; count++;
      if (count > LIMITS.files || total > LIMITS.totalBytes) throw new Error("project too large (max 3000 files / 60 MB, node_modules excluded)");
      return true;
    },
  });
  return Object.entries(out).map(([p, data]) => ({ path: safeRel(p)!, data }));
}

export function filesFromList(list: { path: string; text?: string; base64?: string }[]): InFile[] {
  if (!Array.isArray(list)) throw new Error("files: expected an array");
  if (list.length > LIMITS.files) throw new Error("too many files");
  const out: InFile[] = [];
  for (const f of list) {
    const p = safeRel(String(f.path || ""));
    if (!p) continue;
    const data = f.base64 != null ? new Uint8Array(Buffer.from(String(f.base64), "base64")) : strToU8(String(f.text ?? ""));
    if (data.length <= LIMITS.fileBytes) out.push({ path: p, data });
  }
  return out;
}

interface Stored { id: string; name: string; outDir: string; inDir: string; patch: string; created: number }
const store = new Map<string, Stored>();
function gc() {
  const now = Date.now();
  for (const [id, s] of store) if (now - s.created > 30 * 60_000 || store.size > 12) { fs.rmSync(path.dirname(s.inDir), { recursive: true, force: true }); store.delete(id); }
}

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out); else out.push(path.relative(base, p).replace(/\\/g, "/"));
  }
  return out.sort();
}

/** Render-time props for a project run (same contract as `remotion render --props`): inline JSON/object, or a JSON file inside the upload. */
export interface ProjectRun { props?: unknown; propsFile?: string; composition?: string | string[] }
const NOT_PROPS = /(^|\/)(package(-lock)?|tsconfig[\w.-]*|jsconfig|vercel|netlify|manifest|\.?eslintrc|\.?prettierrc|\.?babelrc|turbo|lerna|nx|components|remotion|deno|bun|renovate|biome)\.json$/i;
const hasArabicDeep = (v: unknown): boolean => typeof v === "string" ? ARABIC_LETTER_RE.test(v) : Array.isArray(v) ? v.some(hasArabicDeep) : !!v && typeof v === "object" && Object.values(v).some(hasArabicDeep);
const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** JSON files in the upload that could be `--props` files (a top-level object), Arabic ones first. */
export function propsCandidates(files: InFile[]): { path: string; arabic: boolean; keys: string[] }[] {
  const out: { path: string; arabic: boolean; keys: string[] }[] = [];
  for (const f of files) {
    if (!/\.json$/i.test(f.path) || NOT_PROPS.test(f.path) || f.data.length > 1 << 20) continue;
    try {
      const j = JSON.parse(Buffer.from(f.data).toString("utf8"));
      if (plainObject(j) && Object.keys(j).length) out.push({ path: f.path, arabic: hasArabicDeep(j), keys: Object.keys(j).slice(0, 12) });
    } catch {}
  }
  return out.sort((a, b) => Number(b.arabic) - Number(a.arabic) || Number(/props/i.test(b.path)) - Number(/props/i.test(a.path)) || a.path.localeCompare(b.path)).slice(0, 50);
}

function resolveRun(run: ProjectRun, files: InFile[], candidates: { path: string }[]) {
  let inputProps: Record<string, unknown> | undefined;
  let source: string | undefined;
  if (run.props != null && run.props !== "") {
    let v = run.props;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { throw new Error(`props: invalid JSON (${(e as Error).message})`); } }
    if (!plainObject(v)) throw new Error("props: expected a JSON object");
    inputProps = v; source = "inline";
  } else if (run.propsFile) {
    // only a file that is part of this upload (never a server path)
    const f = candidates.some((c) => c.path === run.propsFile) ? files.find((x) => x.path === run.propsFile) : undefined;
    if (!f) throw new Error(`props file not found in the project: ${run.propsFile}`);
    inputProps = JSON.parse(Buffer.from(f.data).toString("utf8")); source = run.propsFile;
  }
  const composition = [run.composition ?? []].flat().map(String).filter((id) => /^[\w.-]{1,80}$/.test(id)).slice(0, 20);
  return { inputProps, source, composition };
}

export async function analyzeProject(input: InFile[], name: string, o: FixRemotionOptions = {}, run: ProjectRun = {}, strip = true) {
  gc();
  const { files, root } = strip ? stripCommonRoot(input) : { files: input, root: "" };
  const candidates = propsCandidates(files);
  const rp = resolveRun(run, files, candidates);
  o = { ...o, inputProps: rp.inputProps, composition: rp.composition.length ? rp.composition : undefined };
  if (!files.some((f) => /\.(t|j)sx$/i.test(f.path))) throw new Error("no .tsx/.jsx files found in the project");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-proj-"));
  const inDir = path.join(work, "in"), outDir = path.join(work, "out");
  for (const f of files) { const p = path.join(inDir, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
  // an upload is someone else's project: analysed and rewritten, never executed (no JS prettier configs or plugins)
  const r = await fixRemotion(inDir, { ...o, out: outDir, dryRun: false, untrusted: true });
  // unified patch over every changed or added text file (fixed sources, CSS modules, vendored helper)
  const before = new Set(listFiles(inDir));
  const patches: string[] = [];
  const changed: string[] = [], added: string[] = [];
  for (const rel of listFiles(outDir)) {
    if (!TEXT.test(rel)) continue;
    const b = before.has(rel) ? fs.readFileSync(path.join(inDir, rel), "utf8") : "";
    const a = fs.readFileSync(path.join(outDir, rel), "utf8");
    if (a === b) continue;
    (before.has(rel) ? changed : added).push(rel);
    patches.push(createTwoFilesPatch(before.has(rel) ? `a/${rel}` : "/dev/null", `b/${rel}`, b, a, "", "", { context: 3 }).replace(/^(Index:.*\n)?=+\n/, ""));
  }
  const id = crypto.randomBytes(9).toString("base64url");
  const base = (name || root || "project").replace(/\.zip$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || "project";
  store.set(id, { id, name: base, inDir, outDir, patch: patches.join("\n"), created: Date.now() });
  const rel = (f: string) => path.relative(inDir, f).replace(/\\/g, "/");
  const perFile = [
    ...r.files.map((f) => ({ file: rel(f.file), issues: toIssues(f.result, true), changed: f.after !== f.before })),
    ...r.css.map((c) => ({ file: rel(c.file), issues: cssIssues(c, true), changed: c.after !== c.before })),
  ].filter((x) => x.issues.length || x.changed);
  const all = perFile.flatMap((x) => x.issues);
  return {
    id, name: base, files: files.length, sources: r.files.length,
    summary: summarize(all), results: perFile,
    props: r.props.map((p) => ({ file: rel(p.file), component: p.component, props: p.props, reasons: p.reasons })),
    styles: r.styles.map((st) => ({ file: rel(st.file), name: st.name, exclusive: st.exclusive, latinUsers: st.latinUsers, arabicUsers: st.arabicUsers })),
    helper: r.helper ? { mode: r.helper.mode, path: r.helper.path ? path.relative(outDir, r.helper.path).replace(/\\/g, "/") : undefined } : null,
    changed, added, patch: patches.join("\n"),
    compositions: r.compositions, propsFiles: candidates, i18n: r.i18n,
    run: { props: rp.source ?? null, composition: rp.composition, arabicKeys: rp.inputProps ? Object.keys(rp.inputProps).filter((k) => hasArabicDeep(rp.inputProps![k])) : [] },
    download: { zip: `/api/project/${id}/${base}-harakah.zip`, patch: `/api/project/${id}/${base}-harakah.patch` },
  };
}

/** Re-run a stored upload with other render props / composition (no re-upload). */
export async function rerunProject(id: string, o: FixRemotionOptions, run: ProjectRun) {
  const s = store.get(id);
  if (!s) return null;
  const files = listFiles(s.inDir).map((rel) => ({ path: rel, data: new Uint8Array(fs.readFileSync(path.join(s.inDir, rel))) }));
  return analyzeProject(files, s.name, o, run, false);
}

export function projectZip(id: string): { name: string; data: Uint8Array } | null {
  const s = store.get(id);
  if (!s) return null;
  const tree: Record<string, Uint8Array> = {};
  for (const rel of listFiles(s.outDir)) tree[`${s.name}/${rel}`] = new Uint8Array(fs.readFileSync(path.join(s.outDir, rel)));
  return { name: `${s.name}-harakah.zip`, data: zipSync(tree, { level: 6 }) };
}
export function projectPatch(id: string): { name: string; text: string } | null {
  const s = store.get(id);
  return s ? { name: `${s.name}-harakah.patch`, text: s.patch } : null;
}
