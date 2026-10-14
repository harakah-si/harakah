/**
 * Real Remotion before/after renders: bundles the original project and a codemod-fixed copy with
 * @remotion/bundler, renders stills (and optionally MP4s) with @remotion/renderer, then builds a
 * labelled side-by-side PNG/MP4 and a pixel-based join verdict against a "running text" reference
 * render (REMOTION_HARAKAH_REFERENCE=1 makes splitArabic() return the whole string as one token).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";
import { CHROME, FFMPEG, launch, labelPng, inkStats, remotionChromeMode, assertRemotionOnline, LABEL_BEFORE, LABEL_AFTER } from "../render.js";
import { fixRemotion, findRemotionRoot, type FixRemotionOptions, type FixRemotionResult } from "./project.js";
import type { LayoutFinding } from "../layout-audit.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** node_modules with remotion used when a lone .tsx/.jsx is not inside a Remotion project. */
export const FALLBACK_MODULES = process.env.HARAKAH_REMOTION_MODULES || path.resolve(HERE, "..", "..", "fixtures", "remotion", "node_modules");

export interface RemotionCompareOptions extends FixRemotionOptions {
  outDir: string;
  /** Composition ids to render (default: those using the fixed file, or all). */
  compositions?: string[];
  /** Frame for stills (default: 75% of the composition). */
  frame?: number;
  video?: boolean;
  /** Max width of each panel in the side-by-side output. */
  panelWidth?: number;
  /** Lone-file mode: component export to register (default: every exported component). */
  component?: string;
  width?: number; height?: number; fps?: number; durationInFrames?: number;
  /** Runtime layout audit (HZ24) of both bundles at sampled frames (default true). */
  layout?: boolean;
  layoutFps?: number;
  log?: (s: string) => void;
}
export interface InkVerdict { components: number; width: number }
export interface CompRender {
  id: string;
  frame: number;
  durationInFrames: number;
  beforePng: string; afterPng: string; referencePng: string; comparePng: string; mp4?: string;
  before: InkVerdict; after: InkVerdict; reference: InkVerdict;
  /** share of reference ink pixels that differ (0 = identical to running text). */
  diffAfter: number; diffBefore: number;
  joinedAfter: boolean; joinedBefore: boolean;
  usesSplit: boolean;
  /** Runtime layout audit of the before/after bundles (Arabic visual order at sampled frames). */
  layout?: { before: LayoutFinding[]; after: LayoutFinding[]; frames: number };
}
export interface RemotionCompareResult { fix: FixRemotionResult; renders: CompRender[]; workDir: string }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function entryPoint(root: string): string {
  for (const c of ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx", "index.ts", "index.tsx", "remotion/index.ts", "src/remotion/index.ts"]) {
    if (fs.existsSync(path.join(root, c))) return path.join(root, c);
  }
  throw new Error(`No Remotion entry point (src/index.ts) found in ${root}`);
}

function copyTree(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "out") continue;
    fs.cpSync(path.join(src, e.name), path.join(dst, e.name), { recursive: true });
  }
  const nm = path.join(src, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(dst, "node_modules"), "dir");
}

/**
 * webpack override for a bundle of untrusted code (a paste in the web tool): imports may resolve only inside `dirs`,
 * so `import x from "/home/me/app/config.json"` can't pull a local file into the render (webpack 5
 * resolve.restrictions; one RegExp, because every listed restriction must hold).
 */
export function confineImports(dirs: string[]): (config: any) => any {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const all = [...new Set(dirs.flatMap((d) => { const r = path.resolve(d); try { return [r, fs.realpathSync.native(r)]; } catch { return [r]; } }))];
  const re = new RegExp(`^(?:${all.map(esc).join("|")})(?:[\\\\/]|$)`);
  return (config) => ({ ...config, resolve: { ...config.resolve, restrictions: [...(config.resolve?.restrictions ?? []), re] } });
}

/** Wrap a lone component file in a throwaway Remotion project. */
export function scaffold(file: string, dir: string, o: RemotionCompareOptions): { root: string; file: string; ids: string[] } {
  if (!fs.existsSync(path.join(FALLBACK_MODULES, "remotion"))) throw new Error(`Remotion is not installed. Put the file inside a Remotion project, or set HARAKAH_REMOTION_MODULES to a node_modules folder that has remotion + @remotion/bundler + @remotion/renderer.`);
  const src = path.join(dir, "src");
  const compDir = path.join(src, "comp");
  fs.mkdirSync(compDir, { recursive: true });
  for (const e of fs.readdirSync(path.dirname(file), { withFileTypes: true })) {
    if (e.isFile() && /\.(tsx|jsx|ts|js|css|scss|json)$/.test(e.name)) fs.copyFileSync(path.join(path.dirname(file), e.name), path.join(compDir, e.name));
  }
  fs.symlinkSync(FALLBACK_MODULES, path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "harakah-scaffold", private: true, type: "module", dependencies: { remotion: "*" } }, null, 2));
  fs.writeFileSync(path.join(src, "global.d.ts"), `declare module "*.module.css" { const c: Record<string, string>; export default c; }\ndeclare module "*.css";\n`);
  const code = fs.readFileSync(file, "utf8");
  const names = new Set<string>();
  for (const m of code.matchAll(/export\s+(?:const|function)\s+([A-Z]\w*)/g)) names.add(m[1]);
  const hasDefault = /export\s+default\s+/.test(code);
  let picks = o.component ? [o.component] : [...names];
  if (!picks.length && hasDefault) picks = ["default"];
  if (!picks.length) throw new Error(`No exported React component found in ${file} (use --component).`);
  const mod = "./comp/" + path.basename(file).replace(/\.(tsx|jsx)$/, "");
  const imp = picks.map((p) => (p === "default" ? `import HarakahDefault from "${mod}";` : `import { ${p} } from "${mod}";`)).join("\n");
  const w = o.width ?? 1280, h = o.height ?? 720, fps = o.fps ?? 30, d = o.durationInFrames ?? 150;
  const comps = picks.map((p) => `<Composition id="${p === "default" ? "Main" : p}" component={${p === "default" ? "HarakahDefault" : p}} width={${w}} height={${h}} fps={${fps}} durationInFrames={${d}} />`).join("\n      ");
  fs.writeFileSync(path.join(src, "Root.tsx"), `import React from "react";\nimport { Composition } from "remotion";\n${imp}\n\nexport const RemotionRoot: React.FC = () => (\n  <>\n      ${comps}\n  </>\n);\n`);
  fs.writeFileSync(path.join(src, "index.ts"), `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root";\nregisterRoot(RemotionRoot);\n`);
  return { root: dir, file: path.join(compDir, path.basename(file)), ids: picks.map((p) => (p === "default" ? "Main" : p)) };
}

/** Composition ids that render components exported from `file` (best effort, by scanning sources). */
export function compositionsFor(root: string, file: string): string[] {
  const code = fs.readFileSync(file, "utf8");
  const names = [...code.matchAll(/export\s+(?:const|function)\s+([A-Z]\w*)/g)].map((m) => m[1]);
  const ids: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!["node_modules", ".git", "out"].includes(e.name)) walk(path.join(d, e.name)); continue; }
      if (!/\.(tsx|jsx)$/.test(e.name)) continue;
      const t = fs.readFileSync(path.join(d, e.name), "utf8");
      for (const m of t.matchAll(/<Composition\b[^>]*>/g)) {
        const id = m[0].match(/\bid=["']([^"']+)["']/)?.[1];
        const comp = m[0].match(/\bcomponent=\{\s*(\w+)\s*\}/)?.[1];
        if (id && comp && names.includes(comp)) ids.push(id);
      }
    }
  };
  walk(path.join(root, "src"));
  return ids;
}

function pngDiff(a: string, b: string, ref: string): number {
  const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b)), R = PNG.sync.read(fs.readFileSync(ref));
  if (A.width !== B.width || A.height !== B.height) return 1;
  // ink mask of the reference vs its corner background
  const d = R.data, w = R.width, h = R.height;
  const corner = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const bg = [0, 1, 2].map((c) => corner.map((i) => d[i + c]).sort((x, y) => x - y)[1]);
  let ink = 0, diff = 0;
  for (let i = 0; i < d.length; i += 4) {
    const isInk = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 150;
    if (isInk) ink++;
    const dd = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (dd > 120) diff++;
  }
  return ink ? Math.min(1, diff / ink) : 0;
}

/**
 * Width-aligned diff: per horizontal text band of the reference, map the candidate's ink extent onto the
 * reference's extent (linear in x) before comparing. Per-letter boxes lose a little kerning, so a correctly
 * joined render can be a few px narrower and a raw pixel diff then reports ~90%. Reversed or disconnected
 * letters still mismatch after alignment.
 */
export function alignedDiff(a: string, ref: string): number {
  const A = PNG.sync.read(fs.readFileSync(a)), R = PNG.sync.read(fs.readFileSync(ref));
  if (A.width !== R.width || A.height !== R.height) return 1;
  const w = R.width, h = R.height, d = R.data;
  const corner = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const bg = [0, 1, 2].map((c) => corner.map((i) => d[i + c]).sort((x, y) => x - y)[1]);
  const inkAt = (P: PNG, x: number, y: number) => { const i = (y * w + x) * 4; return Math.abs(P.data[i] - bg[0]) + Math.abs(P.data[i + 1] - bg[1]) + Math.abs(P.data[i + 2] - bg[2]) > 150; };
  const rowInk = (P: PNG, y: number) => { let lo = -1, hi = -1; for (let x = 0; x < w; x++) if (inkAt(P, x, y)) { if (lo < 0) lo = x; hi = x; } return [lo, hi]; };
  // bands = runs of rows with ink in either image (gap ≤ 3 rows merges)
  const bands: [number, number][] = [];
  for (let y = 0, start = -1, gap = 0; y <= h; y++) {
    const any = y < h && (rowInk(R, y)[0] >= 0 || rowInk(A, y)[0] >= 0);
    if (any) { if (start < 0) start = y; gap = 0; } else if (start >= 0 && ++gap > 3 || y === h && start >= 0) { bands.push([start, y - gap]); start = -1; gap = 0; }
  }
  let ink = 0, diff = 0;
  for (const [y0, y1] of bands) {
    let r0 = w, r1 = -1, a0 = w, a1 = -1;
    for (let y = y0; y <= y1; y++) { const [rl, rh] = rowInk(R, y), [al, ah] = rowInk(A, y); if (rl >= 0) { r0 = Math.min(r0, rl); r1 = Math.max(r1, rh); } if (al >= 0) { a0 = Math.min(a0, al); a1 = Math.max(a1, ah); } }
    if (r1 < 0 || a1 < 0) { for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) { const ri = inkAt(R, x, y), ai = inkAt(A, x, y); if (ri) ink++; if (ri !== ai) diff++; } continue; }
    // word clusters: runs of ink columns split by gaps; aligned pairwise when both images have the same count
    const G = Math.max(6, Math.round((y1 - y0) * 0.12));
    const clusters = (P: PNG, lo: number, hi: number) => {
      const out: [number, number][] = []; let st = -1, gap = 0;
      for (let x = lo; x <= hi + G + 1; x++) {
        let col = false; if (x <= hi) for (let y = y0; y <= y1 && !col; y++) col = inkAt(P, x, y);
        if (col) { if (st < 0) st = x; gap = 0; } else if (st >= 0 && ++gap >= G) { out.push([st, x - gap]); st = -1; gap = 0; }
      }
      return out;
    };
    const cr = clusters(R, r0, r1), ca = clusters(A, a0, a1);
    const pairs: [[number, number], [number, number]][] = cr.length === ca.length && cr.length > 1 ? cr.map((c, i) => [c, ca[i]]) : [[[r0, r1], [a0, a1]]];
    const T = 2; // ±2px tolerance after alignment (antialiasing, sub-pixel kerning)
    const near = (P: PNG, x: number, y: number) => { for (let dy = -T; dy <= T; dy++) for (let dx = -T; dx <= T; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && inkAt(P, xx, yy)) return true; } return false; };
    for (const [[p0, p1], [q0, q1]] of pairs) {
      const k = p1 > p0 ? (q1 - q0) / (p1 - p0) : 1;
      for (let y = y0; y <= y1; y++) for (let x = p0; x <= p1; x++) {
        const xa = Math.min(w - 1, Math.max(0, Math.round(q0 + (x - p0) * k)));
        const ri = inkAt(R, x, y), ai = inkAt(A, xa, y);
        if (ri) ink++;
        if (ri && !ai && !near(A, xa, y)) diff++;
        else if (ai && !ri && !near(R, x, y)) diff++;
      }
    }
  }
  return ink ? Math.min(1, diff / ink) : 0;
}

export async function loadRemotion(root: string) {
  const req = createRequire(path.join(root, "package.json"));
  const bundler = await import(req.resolve("@remotion/bundler"));
  const renderer = await import(req.resolve("@remotion/renderer"));
  return { bundle: (bundler.bundle ?? bundler.default?.bundle) as any, renderer: (renderer.renderStill ? renderer : renderer.default) as any };
}

export async function compareRemotion(target: string, o: RemotionCompareOptions): Promise<RemotionCompareResult> {
  assertRemotionOnline();
  const log = o.log ?? (() => {});
  const abs = path.resolve(target);
  const isDir = fs.statSync(abs).isDirectory();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-remotion-"));
  fs.mkdirSync(o.outDir, { recursive: true });

  // 1. before project
  let beforeRoot: string, fileInProject: string | undefined, ids: string[] | undefined = o.compositions;
  if (isDir) beforeRoot = abs;
  else {
    const r = findRemotionRoot(abs);
    if (r && fs.existsSync(path.join(r, "node_modules", "remotion"))) { beforeRoot = r; fileInProject = abs; ids ??= compositionsFor(r, abs); }
    else { const s = scaffold(abs, path.join(work, "before"), o); beforeRoot = s.root; fileInProject = s.file; ids ??= s.ids; }
  }
  // 2. after project = copy + codemod
  const afterRoot = path.join(work, "after");
  copyTree(beforeRoot, afterRoot);
  const fixTarget = fileInProject ? path.join(afterRoot, path.relative(beforeRoot, fileInProject)) : afterRoot;
  log(`codemod → ${fixTarget}`);
  const fix = await fixRemotion(fixTarget, { ...o, out: undefined, dryRun: false });

  // 3. bundle (after twice: normal + reference)
  const { bundle, renderer } = await loadRemotion(beforeRoot);
  const mk = (root: string, name: string) =>
    bundle({ entryPoint: entryPoint(root), publicDir: fs.existsSync(path.join(root, "public")) ? path.join(root, "public") : undefined, enableCaching: false, outDir: path.join(work, `bundle-${name}`),
      ...(o.untrusted ? { webpackOverride: confineImports([root, FALLBACK_MODULES]) } : {}) });
  log("bundling before / after…");
  const bBefore = await mk(beforeRoot, "before");
  const bAfter = await mk(afterRoot, "after");
  // reference = the fixed bundle with splitArabic() returning running text (env read at render time)
  const REF_ENV = { REMOTION_HARAKAH_REFERENCE: "1" };

  const browserExecutable = CHROME;
  const chromeMode = remotionChromeMode(browserExecutable);
  const puppeteerInstance = await renderer.openBrowser("chrome", { browserExecutable, chromiumOptions: {}, chromeMode });
  const labels = await launch();
  const renders: CompRender[] = [];
  try {
    const inputProps = o.inputProps ?? {};
    const all = await renderer.getCompositions(bBefore, { puppeteerInstance, browserExecutable, chromeMode, inputProps });
    const list = (ids && ids.length ? all.filter((c: any) => ids!.includes(c.id)) : all) as any[];
    if (!list.length) throw new Error(`No matching compositions. Available: ${all.map((c: any) => c.id).join(", ")}`);
    for (const comp of list) {
      const dir = list.length > 1 ? path.join(o.outDir, comp.id) : o.outDir;
      fs.mkdirSync(dir, { recursive: true });
      const frame = Math.min(comp.durationInFrames - 1, o.frame ?? Math.round(comp.durationInFrames * 0.75));
      const out = { before: path.join(dir, "before.png"), after: path.join(dir, "after.png"), reference: path.join(dir, ".reference.png") };
      log(`${comp.id}: stills @ frame ${frame}`);
      for (const [k, serve, envVariables] of [["before", bBefore, {}], ["after", bAfter, {}], ["reference", bAfter, REF_ENV]] as const) {
        const c = await renderer.selectComposition({ serveUrl: serve, id: comp.id, puppeteerInstance, browserExecutable, chromeMode, envVariables, inputProps });
        await renderer.renderStill({ composition: c, serveUrl: serve, output: (out as any)[k], frame, puppeteerInstance, browserExecutable, chromeMode, envVariables, inputProps, imageFormat: "png", overwrite: true });
      }
      const ink = (f: string) => inkStats(fs.readFileSync(f));
      const before = ink(out.before), after = ink(out.after), reference = ink(out.reference);
      // raw pixel diff, or the width-aligned one when letters are just a few px narrower (lost kerning)
      const diffAfter = Math.min(pngDiff(out.after, out.reference, out.reference), alignedDiff(out.after, out.reference));
      const diffBefore = Math.min(pngDiff(out.before, out.reference, out.reference), alignedDiff(out.before, out.reference));
      const close = (x: InkVerdict) => Math.abs(x.components - reference.components) <= Math.max(2, reference.components * 0.06) && Math.abs(x.width - reference.width) <= Math.max(8, reference.width * 0.04);
      const usesSplit = fix.files.some((f) => /splitArabic\(/.test(f.after));
      // label panels + side by side (after on the left, before on the right: Arabic reading order)
      const pw = Math.min(comp.width, o.panelWidth ?? 1280);
      const W = even(pw), H = even(comp.height * (pw / comp.width));
      const lb = path.join(work, "lb.png"), la = path.join(work, "la.png");
      fs.writeFileSync(lb, await labelPng(labels, W, LABEL_BEFORE, "#f04438"));
      fs.writeFileSync(la, await labelPng(labels, W, LABEL_AFTER, "#12b76a"));
      const filt = `[0]scale=${W}:${H}[b];[1]scale=${W}:${H}[a];[2][b]vstack[l];[3][a]vstack[r];[r][l]hstack=inputs=2`;
      const cp = path.join(dir, "compare.png");
      execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", out.before, "-i", out.after, "-i", lb, "-i", la, "-filter_complex", filt, "-frames:v", "1", cp]);
      let mp4: string | undefined;
      if (o.video) {
        log(`${comp.id}: rendering MP4s (${comp.durationInFrames} frames)…`);
        const vb = path.join(work, `${comp.id}-before.mp4`), va = path.join(work, `${comp.id}-after.mp4`);
        for (const [serve, f] of [[bBefore, vb], [bAfter, va]] as const) {
          const c = await renderer.selectComposition({ serveUrl: serve, id: comp.id, puppeteerInstance, browserExecutable, chromeMode, inputProps });
          await renderer.renderMedia({ composition: c, serveUrl: serve, codec: "h264", outputLocation: f, puppeteerInstance, browserExecutable, chromeMode, inputProps, overwrite: true, crf: 16 });
        }
        mp4 = path.join(dir, "compare.mp4");
        execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", vb, "-i", va, "-loop", "1", "-i", lb, "-loop", "1", "-i", la,
          "-filter_complex", filt + ",format=yuv420p[v]", "-map", "[v]", "-t", String(comp.durationInFrames / comp.fps), "-r", String(comp.fps),
          "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", mp4]);
      }
      renders.push({ id: comp.id, frame, durationInFrames: comp.durationInFrames, beforePng: out.before, afterPng: out.after, referencePng: out.reference, comparePng: cp, mp4,
        before, after, reference, diffAfter, diffBefore, joinedAfter: close(after) && diffAfter < 0.2, joinedBefore: close(before) && diffBefore < 0.2, usesSplit });
    }
  } finally {
    await labels.close();
    await puppeteerInstance.close({ silent: true }).catch(() => {});
  }
  if (o.layout !== false && renders.length) {
    log("layout audit (before / after)…");
    const { auditRemotionBundle } = await import("./layout.js");
    const ids2 = renders.map((r) => r.id);
    const opts = { compositions: ids2, inputProps: o.inputProps, fps: o.layoutFps ?? 2, maxFrames: 60 };
    const lb2 = await auditRemotionBundle(beforeRoot, bBefore, opts).catch((e) => { log(`layout audit skipped: ${e.message}`); return null; });
    const la2 = lb2 && await auditRemotionBundle(beforeRoot, bAfter, opts).catch((e) => { log(`layout audit skipped: ${e.message}`); return null; });
    if (lb2 && la2) for (const r of renders) {
      const b = lb2.find((c) => c.id === r.id), a = la2.find((c) => c.id === r.id);
      if (b && a) r.layout = { before: b.findings, after: a.findings, frames: a.frames };
    }
  }
  if (!process.env.HARAKAH_KEEP_WORK) fs.rmSync(work, { recursive: true, force: true });
  return { fix, renders, workDir: work };
}
