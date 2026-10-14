/**
 * Optional fast MP4 path: render before/after with HyperFrames' own renderer (npx hyperframes render),
 * ~10–15 s per clip instead of minutes of frame-by-frame screenshots. Used only for HyperFrames
 * compositions (data-composition-id); falls back to the Chrome path on any failure.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HF_VERSION = process.env.HARAKAH_HYPERFRAMES_VERSION || "0.8.140";
export const isHyperFrames = (html: string) => /data-composition-id=/.test(html);

/** Copy every local asset (src/href/url()) into <dir>/assets and write <dir>/index.html. */
export function hfProject(html: string, baseDir: string, dir: string): string {
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  const seen = new Map<string, string>();
  let n = 0;
  const local = (ref: string): string | null => {
    if (/^(https?:|data:|blob:|#|\/\/|mailto:|javascript:)/i.test(ref) || !ref.trim()) return null;
    const clean = ref.split(/[?#]/)[0];
    let p: string;
    try { p = clean.startsWith("file:") ? fileURLToPath(clean) : path.resolve(baseDir, decodeURIComponent(clean)); } catch { return null; }
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    if (!seen.has(p)) {
      const rel = `assets/${n++}-${path.basename(p)}`;
      fs.copyFileSync(p, path.join(dir, rel));
      seen.set(p, rel);
    }
    return seen.get(p)!;
  };
  let out = html.replace(/<base\s[^>]*>/gi, "");
  out = out.replace(/\b(src|href)=(["'])([^"']+)\2/gi, (m, a, q, ref) => { const r = local(ref); return r ? `${a}=${q}${r}${q}` : m; });
  out = out.replace(/url\((["']?)([^)"']+)\1\)/gi, (m, q, ref) => { const r = local(ref); return r ? `url(${q}${r}${q})` : m; });
  fs.writeFileSync(path.join(dir, "index.html"), out);
  return path.join(dir, "index.html");
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", DO_NOT_TRACK: "1" }, maxBuffer: 32 * 1024 * 1024 }, (err, _so, se) =>
      err ? reject(new Error(`${cmd} ${args.join(" ")} failed: ${String(se).slice(-600)}`)) : resolve());
  });
}

/** Render before/after HTML with HyperFrames in parallel. Returns the two MP4 paths. */
export async function hfRenderPair(beforeHtml: string, afterHtml: string, baseDir: string, fps = 30): Promise<{ before: string; after: string; work: string }> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-hf-"));
  const jobs = ([["before", beforeHtml], ["after", afterHtml]] as const).map(async ([name, html]) => {
    const dir = path.join(work, name);
    hfProject(html, baseDir, dir);
    const out = path.join(work, `${name}.mp4`);
    await run("npx", ["-y", `hyperframes@${HF_VERSION}`, "render", dir, "-o", out, "-q", "draft", "--fps", String(fps), "--quiet"], work, 240_000);
    if (!fs.existsSync(out)) throw new Error(`hyperframes produced no ${name}.mp4`);
    return out;
  });
  const [before, after] = await Promise.all(jobs);
  return { before, after, work };
}
