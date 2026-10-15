/**
 * Headless Chrome rendering (puppeteer-core): deterministic stills, frame sequences,
 * side-by-side PNG/MP4 via ffmpeg, and an Arabic "join audit" that counts ink components
 * of per-letter-split titles vs. a plain-text reference render.
 */
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { PNG } from "pngjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ASSET_FONT_DIR } from "./fonts.js";

export const CHROME = process.env.HARAKAH_CHROME || process.env.PUPPETEER_EXECUTABLE_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
   // Windows: per-machine and per-user installs
   ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter((d): d is string => !!d).map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe")),
   // Playwright's bundled Chromium (cloud sessions, CI images)
   path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers", "chromium")].find((p) => fs.existsSync(p)) || "google-chrome";
export const FFMPEG = process.env.HARAKAH_FFMPEG || "ffmpeg";

/**
 * How Remotion should start Chrome. Its default ("headless-shell") passes --headless=old, which Chrome and Chromium
 * removed in v132; only the chrome-headless-shell binary still has it. Any other binary gets the new headless mode.
 */
export function remotionChromeMode(exe: string = CHROME): "headless-shell" | "chrome-for-testing" {
  let real = exe;
  try { real = fs.realpathSync(exe); } catch { /* a bare command name */ }
  return [exe, real].some((p) => /headless[_-]shell/i.test(path.basename(p))) ? "headless-shell" : "chrome-for-testing";
}

export async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: CHROME, headless: true,
    // --allow-file-access-from-files lets a scene fetch() its own data files; openPage() limits which files (guardFiles)
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none", "--allow-file-access-from-files", "--hide-scrollbars", "--force-color-profile=srgb"],
  });
}

/* ---------------- local file access of rendered scenes ---------------- */

const realpath = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const inside = (root: string, p: string) => { const r = path.relative(root, p); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
// pnpm keeps packages under node_modules/.pnpm; every other dot folder (.env, .git, .ssh, .npmrc, …) stays closed
const hidden = (rel: string) => rel.split(path.sep).some((s) => s.startsWith(".") && s !== "." && s !== ".." && s !== ".pnpm");

/**
 * The project a scene belongs to: the nearest folder above it with package.json or .git, so a scene in src/scenes/
 * can still load ../../node_modules/gsap. Never the home folder or the filesystem root: without a project, the
 * scene's own folder.
 */
export function projectRoot(dir: string): string {
  const stop = new Set([path.parse(path.resolve(dir)).root, os.homedir()]);
  for (let d = path.resolve(dir); !stop.has(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "package.json")) || fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) break;
  }
  return path.resolve(dir);
}

/** Folders a scene may read: the given ones, the bundled fonts, and HARAKAH_ALLOW_DIRS (path-list). */
export function fileRoots(roots: (string | undefined)[]): string[] {
  const extra = (process.env.HARAKAH_ALLOW_DIRS || "").split(path.delimiter).filter(Boolean);
  // each root as written and with symlinks resolved (macOS: /tmp → /private/tmp)
  return [...new Set([...roots.filter((r): r is string => !!r), ASSET_FONT_DIR, ...extra].flatMap((r) => [path.resolve(r), realpath(r)]))];
}

/**
 * May a scene load this file? Only regular files inside one of the roots (symlinks resolved), with no hidden folder or
 * file on the way, and never a directory (Chrome lists directories, which would show other folders' names).
 */
export function fileAllowed(file: string, roots: string[]): boolean {
  const abs = path.resolve(file);
  const real = realpath(abs);
  try { if (fs.statSync(real).isDirectory()) return false; } catch { /* missing: nothing to read */ }
  const ok = (p: string) => roots.some((root) => inside(root, p) && !hidden(path.relative(root, p)));
  return (ok(abs) && ok(real)) || inPackages(abs, roots);
}

/**
 * Installed packages: a file under a node_modules folder that Node would resolve from one of the roots, its own or an
 * ancestor's (a monorepo hoists them to the workspace root: packages/app/scenes → ../../node_modules/gsap). Packages
 * can be symlinked from anywhere (npm link, workspaces), so only the path as requested is checked; hidden folders other
 * than .pnpm stay closed.
 */
function inPackages(abs: string, roots: string[]): boolean {
  const parts = abs.split(path.sep);
  const i = parts.indexOf("node_modules");
  if (i < 0) return false;
  const owner = parts.slice(0, i).join(path.sep) || path.sep;
  const rest = parts.slice(i + 1).join(path.sep);
  return !!rest && !hidden(rest) && roots.some((root) => inside(owner, root));
}

/** What a render reached on the internet. `offline`: those requests were refused (HARAKAH_OFFLINE=1, `--offline`). */
export interface Network { offline: boolean; hosts: Set<string>; blocked: Set<string> }
export interface NetworkReport { offline: boolean; hosts: string[]; blocked: string[] }
export const offlineDefault = () => /^(1|true|yes)$/i.test(process.env.HARAKAH_OFFLINE || "");
export function network(offline = offlineDefault()): Network { return { offline, hosts: new Set(), blocked: new Set() }; }
export function networkReport(n: Network): NetworkReport { return { offline: n.offline, hosts: [...n.hosts].sort(), blocked: [...n.blocked].sort() }; }
/** One line for the CLI: what the scene loaded from the internet, or what offline mode refused. */
export function networkText(n: NetworkReport): string {
  if (n.blocked.length) return `offline: blocked ${n.blocked.join(", ")}. The scene needs the internet for these, so this render may differ from what viewers see.`;
  if (n.hosts.length) return `internet: the scene loaded from ${n.hosts.join(", ")} (--offline refuses this)`;
  return `internet: none${n.offline ? " (offline)" : ""}`;
}
/** Remotion renders run partly in Remotion's own browser, whose requests harakah can't see: offline, they refuse to start. */
export function assertRemotionOnline(): void {
  if (offlineDefault()) throw new Error("offline: Remotion renders run in Remotion's own browser, which harakah can't keep off the internet yet. Run without --offline (HARAKAH_OFFLINE) to render Remotion, or check it statically.");
}
const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i;

/**
 * Scenes are opened from file:// and their scripts run: a scene must not read the user's other files (keys, .env,
 * other projects, other uploads in the temp folder) through fetch, an iframe or an <img>. Every file:// request outside
 * the roots is aborted; data: and blob: requests are untouched. Requests to the internet are recorded in `net` (the
 * report lists the hosts) and, offline, refused.
 */
export async function guardFiles(page: Page, roots: string[], net: Network = network()): Promise<void> {
  let warned = false, warnedNet = false;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.isInterceptResolutionHandled()) return;
    const url = req.url();
    if (/^(https?|wss?):/i.test(url)) {
      let u: URL | undefined;
      try { u = new URL(url); } catch { /* malformed: Chrome fails it anyway */ }
      if (!u || LOOPBACK.test(u.hostname)) return void req.continue();
      const host = u.host;
      if (!net.offline) { net.hosts.add(host); return void req.continue(); }
      net.blocked.add(host);
      if (!warnedNet) console.error(`harakah: offline: refused ${host} (the scene loads it from the internet).`);
      warnedNet = true;
      return void req.abort("internetdisconnected");
    }
    if (!url.startsWith("file:")) return void req.continue();
    let file = "";
    try { file = fileURLToPath(url); } catch { /* malformed: refuse */ }
    if (file && fileAllowed(file, roots)) return void req.continue();
    if (!warned) console.error(`harakah: refused a local file the scene asked for (outside its project, hidden, or a folder): ${file || url}. To allow another folder, set HARAKAH_ALLOW_DIRS.`);
    warned = true;
    return void req.abort("accessdenied");
  });
}

/** Controllable clock: rAF / performance.now / Date.now advance only when we say so. */
const CLOCK_SHIM = `(()=>{window.__name=window.__name||(f=>f);window.__timelines=window.__timelines||{};const T={t:0};window.__hzTime=T;
const base=1767225600000;const pn=()=>T.t*1000;try{performance.now=pn}catch(e){}
Date.now=()=>base+T.t*1000;
let id=0;const cbs=new Map();window.requestAnimationFrame=cb=>{id++;cbs.set(id,cb);return id};window.cancelAnimationFrame=i=>cbs.delete(i);
window.__hzAdvance=t=>{T.t=t;for(let k=0;k<2;k++){const l=[...cbs.entries()];cbs.clear();for(const [,cb] of l){try{cb(t*1000)}catch(e){}}}};})();`;

export interface Stage { width: number; height: number; duration?: number }

export function detectStage(html: string, fallback: Stage = { width: 1280, height: 720 }): Stage {
  const root = html.match(/<[^>]*data-composition-id[^>]*>/i)?.[0] || "";
  const num = (re: RegExp, s: string) => { const m = s.match(re); return m ? parseFloat(m[1]) : undefined; };
  const w = num(/data-width=["']?(\d+)/i, root) ?? num(/<meta[^>]+viewport[^>]+width=(\d+)/i, html);
  const h = num(/data-height=["']?(\d+)/i, root) ?? num(/<meta[^>]+viewport[^>]+height=(\d+)/i, html);
  const d = num(/data-duration=["']?([\d.]+)/i, root);
  return { width: w ?? fallback.width, height: h ?? fallback.height, duration: d ?? fallback.duration };
}

/**
 * Open a scene file. `roots`: folders it may read (see fileRoots); by default its own folder and its project. The
 * caller passes them explicitly for scenes it wrote elsewhere (a paste in a temp folder, a copy in out/). `net` collects
 * the internet hosts it contacts (and decides whether it may: see network()).
 */
export async function openPage(browser: Browser, file: string, stage: Stage, roots?: string[], net?: Network): Promise<Page> {
  const page = await browser.newPage();
  await guardFiles(page, roots ?? fileRoots([path.dirname(path.resolve(file)), projectRoot(path.dirname(path.resolve(file)))]), net);
  await page.setViewport({ width: Math.round(stage.width), height: Math.round(stage.height), deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(CLOCK_SHIM);
  await page.goto("file://" + path.resolve(file), { waitUntil: "load", timeout: 30000 }).catch(() => {});
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
  // deterministic compositions often expose window.ready (a promise: fonts loaded, layout measured) next to window.seek(t)
  await page.evaluate(() => Promise.race([(window as any).ready, new Promise((r) => setTimeout(r, 10000))])).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  return page;
}

/** Duration in seconds as reported by the page (HyperFrames timelines, GSAP, CSS animations). */
export async function pageDuration(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const w = window as any; let d = 0;
    for (const k in w.__timelines || {}) { try { d = Math.max(d, w.__timelines[k].duration()); } catch {} }
    if (!d && w.gsap) { try { for (const c of w.gsap.globalTimeline.getChildren(false, true, true)) d = Math.max(d, c.startTime() + c.totalDuration()); } catch {} }
    for (const a of (document as any).getAnimations?.() || []) { try { const t = a.effect.getComputedTiming(); if (isFinite(t.endTime)) d = Math.max(d, t.endTime / 1000); } catch {} }
    // a hand-written deterministic composition: window.seek(t) + window.DUR / window.duration (seconds)
    if (!d && typeof w.seek === "function") for (const k of ["DUR", "duration", "DURATION"]) if (typeof w[k] === "number" && w[k] > 0) { d = w[k]; break; }
    return d || undefined;
  });
}

export async function seek(page: Page, t: number) {
  await page.evaluate((t) => {
    const w = window as any; let any = false;
    for (const k in w.__timelines || {}) { try { w.__timelines[k].pause(); w.__timelines[k].seek(t, false); any = true; } catch {} }
    if (!any && typeof w.seek === "function") { try { w.seek(t); any = true; } catch {} }
    if (!any) w.__hzAdvance?.(t);
    for (const a of (document as any).getAnimations?.() || []) { try { a.pause(); a.currentTime = t * 1000; } catch {} }
  }, t);
}

export async function still(page: Page, t: number): Promise<Buffer> {
  await page.bringToFront();
  await seek(page, t);
  return Buffer.from(await page.screenshot({ type: "png" }));
}

/** Render a label bar (bilingual) as PNG using Chrome so Arabic is shaped properly. */
export async function labelPng(browser: Browser, width: number, html: string, accent: string, fontCss = ""): Promise<Buffer> {
  const page = await browser.newPage();
  await page.bringToFront();
  const h = Math.max(64, Math.round(width / 16));
  await page.setViewport({ width, height: h });
  await page.setContent(`<html><head><style>${fontCss}html,body{margin:0;width:${width}px;height:${h}px;background:#0e0f12;color:#e9e7e2;display:flex;align-items:center;justify-content:center;font:600 ${Math.round(h * 0.34)}px 'IBM Plex Sans Arabic','Noto Sans Arabic',sans-serif}
  .dot{width:${Math.round(h * 0.18)}px;height:${Math.round(h * 0.18)}px;border-radius:50%;background:${accent};margin-inline:14px}
  .wrap{display:flex;align-items:center;gap:6px}.en{opacity:.6;font-weight:500;letter-spacing:.08em;text-transform:uppercase;font-size:.72em}</style></head><body><div class="wrap">${html.replace("{dot}", '<span class="dot"></span>')}</div></body></html>`, { waitUntil: "load" });
  await page.evaluate(() => (document as any).fonts?.ready);
  const b = Buffer.from(await page.screenshot({ type: "png" }));
  await page.close();
  return b;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface CompareOptions {
  time?: number; video?: boolean; fps?: number; duration?: number; maxPanelWidth?: number; stage?: Stage; fontCss?: string; tail?: number;
  /** cap the rendered length (the web tool keeps compare videos short) */
  maxDuration?: number;
  /** runtime layout audit: false to skip; fps of the sampled frames (default 4, at most 120 frames) */
  layout?: boolean; layoutFps?: number;
  /** Pre-rendered clips (e.g. from HyperFrames): skip frame-by-frame capture and just compose them. */
  clips?: { before: string; after: string };
  /** folders the two scenes may read (see fileRoots); default: their own folders and the before scene's project */
  fileRoots?: string[];
  /** refuse requests to the internet (default: HARAKAH_OFFLINE) */
  offline?: boolean;
}
/**
 * Capture one panel as an H.264 clip: its own browser, JPEG screenshots piped straight into ffmpeg (no PNG files on disk).
 * Run two of these in parallel for before/after. Frames past `duration` hold the last frame (`tail`).
 */
export async function captureClip(file: string, stage: Stage, duration: number, fps: number, total: number, out: string, roots?: string[], net?: Network): Promise<string> {
  const browser = await launch();
  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-",
    // JPEG frames decode as full-range yuvj420p: convert to TV range so the final MP4 is plain yuv420p everywhere
    "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-color_range", "tv",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", out], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => (err += d));
  const done = new Promise<void>((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}: ${err.slice(0, 300)}`)))));
  try {
    const page = await openPage(browser, file, stage, roots, net);
    const n = Math.max(1, Math.round(total * fps));
    for (let i = 0; i < n; i++) {
      await seek(page, Math.min(i / fps, duration));
      const jpg = await page.screenshot({ type: "jpeg", quality: 92, optimizeForSpeed: true });
      if (!ff.stdin.write(Buffer.from(jpg))) await new Promise((r) => ff.stdin.once("drain", r));
    }
  } finally {
    ff.stdin.end();
    await browser.close();
  }
  await done;
  return out;
}

export interface CompareResult { beforePng: string; afterPng: string; comparePng: string; mp4?: string; stage: Stage; duration: number; joins: JoinAudit[];
  /** runtime layout audit (Arabic visual order at sampled frames) of both panels */
  layout?: { before: import("./layout-audit.js").LayoutFinding[]; after: import("./layout-audit.js").LayoutFinding[]; frames: number };
  /** internet hosts the two scenes loaded from (or that offline mode refused) */
  network: NetworkReport }

export const LABEL_BEFORE = `<span lang="ar">قبل</span>{dot}<span class="en">Before</span>`;
export const LABEL_AFTER = `<span lang="ar">بعد الإصلاح</span>{dot}<span class="en">After · harakah-fix</span>`;

/** Render before/after HTML files into outDir: before.png, after.png, compare.png, compare.mp4. */
export async function compareFiles(beforeFile: string, afterFile: string, outDir: string, o: CompareOptions = {}): Promise<CompareResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const stage = o.stage ?? detectStage(fs.readFileSync(beforeFile, "utf8"));
  const dirs = [beforeFile, afterFile].map((f) => path.dirname(path.resolve(f)));
  const roots = fileRoots(o.fileRoots ?? [...dirs, projectRoot(dirs[0])]);
  const net = network(o.offline);
  // one browser per panel: a second tab in the same browser can hand back a stale (background) frame on screenshot
  const [browser, browserA] = await Promise.all([launch(), launch()]);
  try {
    const [pb, pa] = await Promise.all([openPage(browser, beforeFile, stage, roots, net), openPage(browserA, afterFile, stage, roots, net)]);
    const duration = Math.min(o.duration ?? stage.duration ?? (await pageDuration(pb)) ?? 3, o.maxDuration ?? Infinity);
    const t = o.time ?? duration;
    const bp = path.join(outDir, "before.png"), ap = path.join(outDir, "after.png");
    fs.writeFileSync(bp, await still(pb, t));
    fs.writeFileSync(ap, await still(pa, t));
    const joins = await joinAudit(pb, pa);
    let layout: CompareResult["layout"];
    if (o.layout !== false) {
      const { auditLayoutPage } = await import("./layout-audit.js");
      const lo = { fps: o.layoutFps ?? 4, maxFrames: 120 };
      const [lb0, la0] = await Promise.all([auditLayoutPage(pb, duration, lo), auditLayoutPage(pa, duration, lo)]);
      layout = { before: lb0.findings, after: la0.findings, frames: la0.frames };
    }
    const pw = Math.min(stage.width, o.maxPanelWidth ?? 1280);
    const scale = pw / stage.width;
    const W = even(stage.width * scale), H = even(stage.height * scale);
    const lb = path.join(outDir, ".label-before.png"), la = path.join(outDir, ".label-after.png");
    fs.writeFileSync(lb, await labelPng(browser, W, LABEL_BEFORE, "#f04438", o.fontCss));
    fs.writeFileSync(la, await labelPng(browser, W, LABEL_AFTER, "#12b76a", o.fontCss));
    const cp = path.join(outDir, "compare.png");
    // panels are placed RTL-style? No: keep reading order of a comparison (before on the right for Arabic readers).
    const filt = `[0]scale=${W}:${H}[b];[1]scale=${W}:${H}[a];[2][b]vstack[l];[3][a]vstack[r];[r][l]hstack=inputs=2`;
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", bp, "-i", ap, "-i", lb, "-i", la, "-filter_complex", filt, "-frames:v", "1", cp]);
    let mp4: string | undefined;
    let clips = o.clips;
    let tmpClips: string | undefined;
    if (o.video && !clips) {
      // fast path: both panels captured in parallel (two browsers), JPEG frames piped into ffmpeg, then composed below
      const fps = o.fps ?? 30;
      tmpClips = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-clips-"));
      const [b, a] = await Promise.all([
        captureClip(beforeFile, stage, duration, fps, duration, path.join(tmpClips, "before.mp4"), roots, net),
        captureClip(afterFile, stage, duration, fps, duration, path.join(tmpClips, "after.mp4"), roots, net),
      ]);
      clips = { before: b, after: a };
    }
    if (o.video && clips) {
      mp4 = path.join(outDir, "compare.mp4");
      const fps = o.fps ?? 30;
      const total = duration + (o.tail ?? 0);
      execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", clips.before, "-i", clips.after, "-loop", "1", "-i", lb, "-loop", "1", "-i", la,
        "-filter_complex", `[0]tpad=stop_mode=clone:stop_duration=${o.tail ?? 0}[b0];[1]tpad=stop_mode=clone:stop_duration=${o.tail ?? 0}[a0];` + filt.replace("[0]scale", "[b0]scale").replace("[1]scale", "[a0]scale") + ",format=yuv420p[v]",
        "-map", "[v]", "-t", String(total), "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-color_range", "tv", "-movflags", "+faststart", mp4]);
    }
    if (tmpClips) fs.rmSync(tmpClips, { recursive: true, force: true });
    fs.rmSync(lb, { force: true }); fs.rmSync(la, { force: true });
    return { beforePng: bp, afterPng: ap, comparePng: cp, mp4, stage, duration, joins, layout, network: networkReport(net) };
  } finally {
    await Promise.all([browser.close(), browserA.close()]);
  }
}

/* ---------------- join audit ---------------- */

export interface JoinAudit { path: string; text: string; before: number; after?: number; reference: number; widthBefore: number; widthAfter?: number; widthReference: number; joinedBefore: boolean; joinedAfter?: boolean }

/** Find per-letter split parents in the live DOM (after scripts ran). */
async function splitParents(page: Page): Promise<{ path: string; text: string }[]> {
  return page.evaluate(() => {
    const AL = /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F]/;
    const seg = new (Intl as any).Segmenter("ar", { granularity: "grapheme" });
    const pathOf = (el: Element): string => {
      const parts: string[] = [];
      let c: Element | null = el;
      while (c && c !== document.body) {
        const tag = c.tagName.toLowerCase();
        const same = Array.from(c.parentElement?.children || []).filter((x) => x.tagName === c!.tagName);
        parts.unshift(`${tag}:nth-of-type(${same.indexOf(c) + 1})`);
        c = c.parentElement;
      }
      return "body > " + parts.join(" > ");
    };
    const out: { path: string; text: string }[] = [];
    document.body.querySelectorAll("*").forEach((p) => {
      const kids = Array.from(p.children).filter((k) => !["SCRIPT", "STYLE", "BR"].includes(k.tagName));
      if (kids.length < 3 || kids.some((k) => k.children.length)) return;
      let single = 0, ar = 0;
      for (const k of kids) { const t = (k.textContent || "").replace(/\u200d/g, ""); if ([...seg.segment(t)].length <= 2) single++; if (AL.test(t)) ar++; }
      if (ar >= 2 && single / kids.length >= 0.6) out.push({ path: pathOf(p), text: (p.textContent || "").replace(/\u200d/g, "").replace(/\u00a0/g, " ") });
    });
    return out;
  });
}

/**
 * Crop of an element's box (+4px), clamped to the viewport. Undefined when the element is missing or not
 * rendered (zero area, visibility:hidden, opacity:0 on it or an ancestor): there is nothing to audit.
 */
async function shotOf(page: Page, sel: string): Promise<Buffer | undefined> {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width * b.height < 1) return null;
    if ((el as any).checkVisibility && !(el as any).checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    const vw = document.documentElement.clientWidth || innerWidth, vh = document.documentElement.clientHeight || innerHeight;
    const x = Math.max(0, Math.floor(b.left - 4)), y = Math.max(0, Math.floor(b.top - 4));
    return { x, y, width: Math.min(vw, Math.ceil(b.right + 4)) - x, height: Math.min(vh, Math.ceil(b.bottom + 4)) - y };
  }, sel);
  if (!r || r.width < 2 || r.height < 2) return undefined;
  await page.bringToFront();
  // Crop a viewport screenshot here instead of passing `clip`: CDP clips are document coordinates whose origin is the
  // leftmost overflow, so on an RTL page that overflows (scroll origin on the right) a viewport rect lands off-target.
  return cropPng(Buffer.from(await page.screenshot({ type: "png", captureBeyondViewport: false })), r);
}

function cropPng(png: Buffer, r: { x: number; y: number; width: number; height: number }): Buffer {
  const src = PNG.sync.read(png);
  const w = Math.min(r.width, src.width - r.x), h = Math.min(r.height, src.height - r.y);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) src.data.copy(out.data, y * w * 4, ((r.y + y) * src.width + r.x) * 4, ((r.y + y) * src.width + r.x + w) * 4);
  return PNG.sync.write(out);
}

/**
 * Render the same text as plain running text with identical font settings, on an overlay. The span gets the
 * split parent's accumulated transform (scale/rotation of the element and its ancestors), so a title grown with
 * transform: scale() is compared at the size it is actually painted.
 */
async function referenceShot(page: Page, sel: string, text: string): Promise<Buffer | undefined> {
  const id = await page.evaluate((sel, text) => {
    const el = document.querySelector(sel) as HTMLElement | null; if (!el) return null;
    const leaf = (el.querySelector("*") as HTMLElement) || el;
    const cs = getComputedStyle(leaf);
    // linear part of the transforms from el up to <body> (translate is irrelevant: the overlay re-centres the text;
    // body/html transforms already apply to the overlay, which lives in <body>)
    let m = new DOMMatrix();
    for (let c: Element | null = el; c && c !== document.body; c = c.parentElement) {
      const s = getComputedStyle(c);
      let own = new DOMMatrix();
      if (s.rotate && s.rotate !== "none") { try { own = own.multiply(new DOMMatrix(`rotate(${s.rotate.split(" ").pop()})`)); } catch {} }
      if (s.scale && s.scale !== "none") { const [sx, sy = sx] = s.scale.split(" ").map(Number); if (sx && sy) own = own.scale(sx, sy); }
      if (s.transform && s.transform !== "none") { try { own = own.multiply(new DOMMatrix(s.transform)); } catch {} }
      m = own.multiply(m);
    }
    const lin = `matrix(${m.a},${m.b},${m.c},${m.d},0,0)`;
    const ov = document.createElement("div");
    ov.id = "__hz_ref";
    ov.setAttribute("style", "position:fixed;inset:0;background:#fff;z-index:2147483647;display:flex;align-items:center;justify-content:center;overflow:hidden");
    const sp = document.createElement("span");
    sp.setAttribute("dir", "rtl");
    sp.setAttribute("style", `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};color:#000;white-space:nowrap;letter-spacing:normal;flex:none;display:inline-block;transform:${lin}`);
    sp.textContent = text.trim();
    ov.appendChild(sp); document.body.appendChild(ov);
    return "#__hz_ref > span";
  }, sel, text);
  if (!id) return undefined;
  const b = await shotOf(page, id);
  await page.evaluate(() => document.getElementById("__hz_ref")?.remove());
  return b;
}

/** Count connected ink components (8-connectivity) relative to the corner background colour. */
export function inkComponents(png: Buffer, minSize = 6): number { return inkStats(png, minSize).components; }

/** Ink components + ink bounding-box width (px). */
export function inkStats(png: Buffer, minSize = 6): { components: number; width: number } {
  const img = PNG.sync.read(png);
  const { width: w, height: h, data } = img;
  const px = (x: number, y: number) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const bg = [0, 1, 2].map((c) => corners.map((k) => k[c]).sort((a, b) => a - b)[1]);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = px(x, y);
    if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 150) ink[y * w + x] = 1;
  }
  let comps = 0, minX = w, maxX = -1;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (ink[i] !== 1) continue;
    let size = 0; ink[i] = 2; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!; size++;
      const x = j % w, y = (j / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (ink[k] === 1) { ink[k] = 2; stack.push(k); }
      }
    }
    if (size >= minSize) comps++;
  }
  return { components: comps, width: maxX >= minX ? maxX - minX + 1 : 0 };
}

/** Compare per-letter split titles before/after against a plain-text reference (call after seeking to the end). */
export async function joinAudit(before: Page, after?: Page): Promise<JoinAudit[]> {
  const parents = await splitParents(before);
  const out: JoinAudit[] = [];
  for (const p of parents.slice(0, 8)) {
    const bs = await shotOf(before, p.path);
    const rs = await referenceShot(before, p.path, p.text);
    if (!bs || !rs) continue;
    const b = inkStats(bs), r = inkStats(rs);
    const tol = Math.max(1, Math.round(r.components * 0.1));
    // joined = same number of ink pieces as running text AND same overall ink width (isolated forms are wider)
    const ok = (x: { components: number; width: number }) => Math.abs(x.components - r.components) <= tol && Math.abs(x.width / r.width - 1) <= 0.04;
    const rec: JoinAudit = { path: p.path, text: p.text.trim(), before: b.components, reference: r.components, widthBefore: b.width, widthReference: r.width, joinedBefore: ok(b) };
    if (after) {
      const as = await shotOf(after, p.path);
      if (as) { const a = inkStats(as); rec.after = a.components; rec.widthAfter = a.width; rec.joinedAfter = ok(a); }
    }
    out.push(rec);
  }
  return out;
}
