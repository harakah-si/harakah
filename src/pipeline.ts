import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyze, fix, type Options, type FixResult } from "./engine.js";
import { compareFiles, projectRoot, offlineDefault, type CompareOptions, type CompareResult } from "./render.js";
import { ASSET_FONT_DIR } from "./fonts.js";
import { hfRenderPair, isHyperFrames } from "./hyperframes.js";

/** Make an HTML string renderable from another directory: full document + <base> pointing at the original folder. */
export function renderable(html: string, baseDir?: string): string {
  let doc = /<html[\s>]/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  if (!/<meta[^>]+charset/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">`);
  if (baseDir && !/<base\s/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, `<head$1><base href="${pathToFileURL(baseDir).href}/">`);
  return doc;
}

export function writeFixed(fixed: FixResult, outFile: string) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, fixed.html);
  for (const a of fixed.assets) {
    const dest = path.join(path.dirname(path.resolve(outFile)), "fonts", a.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(a.src, dest);
    const lic = path.join(ASSET_FONT_DIR, licenseFor(a.rel));
    if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(path.dirname(dest), path.basename(lic)));
  }
}
function licenseFor(file: string): string {
  const f = file.toLowerCase();
  if (f.startsWith("ibmplex")) return "OFL-ibmplexsansarabic.txt";
  if (f.startsWith("readex")) return "OFL-readexpro.txt";
  if (f.startsWith("notonaskh")) return "OFL-notonaskharabic.txt";
  return `OFL-${f.split(/[-.]/)[0]}.txt`;
}

export interface CompareRun extends CompareResult { fixed: FixResult; beforeHtml: string; afterHtml: string; engine: "hyperframes" | "chrome"; engineNote?: string }
export type VideoEngine = "auto" | "hyperframes" | "chrome";

/** Fix + render before/after into outDir. */
export async function compareHtml(html: string, outDir: string, opts: Options = {}, co: CompareOptions = {}, baseDir?: string, engineChoice?: VideoEngine): Promise<CompareRun> {
  fs.mkdirSync(outDir, { recursive: true });
  const fixed = fix(html, { ...opts, fontSrc: opts.fontSrc === "data" || opts.fontSrc === "google" ? opts.fontSrc : "file", fontBase: pathToFileURL(ASSET_FONT_DIR).href + "/" });
  const before = renderable(html, baseDir);
  const after = renderable(fixed.html, baseDir);
  const bf = path.join(outDir, "before.html"), af = path.join(outDir, "after.html");
  fs.writeFileSync(bf, before);
  fs.writeFileSync(af, after);
  let engine: CompareRun["engine"] = "chrome";
  let engineNote: string | undefined;
  let clips: { before: string; after: string } | undefined;
  let work: string | undefined;
  const want = engineChoice ?? "auto";
  // HyperFrames renders in its own Chrome (and may download it with npx): offline, the guarded Chrome capture is used
  const hf = co.video && want !== "chrome" && (isHyperFrames(html) || want === "hyperframes");
  if (hf && (co.offline ?? offlineDefault())) engineNote = "offline: Chrome capture instead of HyperFrames, whose own browser harakah can't keep off the internet";
  else if (hf) {
    try {
      const r = await hfRenderPair(html, fixed.html, baseDir ?? process.cwd(), co.fps ?? 30);
      clips = { before: r.before, after: r.after }; work = r.work; engine = "hyperframes";
    } catch (e: any) {
      engineNote = `HyperFrames render failed, used Chrome capture instead: ${String(e?.message || e).slice(0, 300)}`;
    }
  }
  // the panels may read the output folder and, through <base>, the original scene's project; nothing else on disk
  const r = await compareFiles(bf, af, outDir, { ...co, clips, fileRoots: co.fileRoots ?? [outDir, baseDir && projectRoot(baseDir)].filter((d): d is string => !!d) });
  if (work) fs.rmSync(work, { recursive: true, force: true });
  return { ...r, fixed, beforeHtml: before, afterHtml: after, engine, engineNote };
}

export { analyze, fix };
