/**
 * Runtime layout audit (HZ24) for Remotion compositions: bundle the project with @remotion/bundler, serve the bundle,
 * open it in headless Chrome the way @remotion/renderer does (input props, bundle mode, remotion_setFrame + renderReady),
 * then read the DOM boxes of Arabic letters/words/rows at sampled frames with the same probe as the HTML audit.
 * تدقيق ترتيب العرض لمقاطع Remotion: نفس الفحص على إطارات مختارة من الحزمة.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import type { Browser, Page } from "puppeteer-core";
import { launch, assertRemotionOnline } from "../render.js";
import { auditLayoutPage, layoutIssues, allFramesCount, type LayoutFinding, type CaptureOptions, type TimelineFrame } from "../layout-audit.js";
import type { Issue } from "../engine.js";
import { entryPoint, loadRemotion, scaffold, compositionsFor, confineImports, FALLBACK_MODULES } from "./compare.js";
import { findRemotionRoot } from "./project.js";

export interface RemotionLayoutOptions {
  /** Composition ids (default: all, or those using the file for a single-file target). */
  compositions?: string[];
  inputProps?: Record<string, unknown>;
  /** Samples per second of composition time (default 4). */
  fps?: number;
  /** Max sampled frames per composition (default 120). */
  maxFrames?: number;
  capture?: CaptureOptions;
  log?: (s: string) => void;
  /** someone else's code (a paste in the web tool): its imports stay inside the scaffold and Remotion's modules */
  untrusted?: boolean;
  /** every frame of each composition instead of a sample (fps and maxFrames are ignored); refused above ALL_FRAMES_MAX */
  allFrames?: boolean;
}
export interface RemotionLayoutComp {
  id: string; width: number; height: number; fps: number; durationInFrames: number;
  frames: number; findings: LayoutFinding[]; issues: Issue[];
  timeline?: TimelineFrame[];
}
export interface RemotionLayoutResult { root: string; compositions: RemotionLayoutComp[] }

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "video/webm" };

/** Static server for a bundle folder on 127.0.0.1 (random port). */
export async function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(dir);
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    // inside the bundle folder only: a bare startsWith(root) would also match a sibling like bundle-other/
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as any).port;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => srv.close(() => r())) };
}

/** Serialise props the way Remotion does (special types: Date, Map, staticFile); plain JSON otherwise. */
function serializeProps(root: string, props: unknown): string {
  try {
    const req = createRequire(path.join(root, "package.json"));
    const nr = req(req.resolve("remotion/no-react"));
    const s = nr.NoReactInternals?.serializeJSONWithSpecialTypes?.({ data: props ?? {}, indent: undefined, staticBase: null });
    if (s?.serializedString) return s.serializedString;
  } catch {}
  return JSON.stringify(props ?? {});
}

async function waitReady(page: Page, timeout = 30000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(`window.remotion_cancelledError ? "err:" + window.remotion_cancelledError : window.remotion_renderReady === true`);
    if (v === true) return;
    if (typeof v === "string") throw new Error(`Remotion render error: ${v.slice(4, 400)}`);
    if (Date.now() - t0 > timeout) throw new Error("Remotion page did not become ready (delayRender timeout?)");
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Open one composition of a served bundle at frame 0, as @remotion/renderer's makePage + setPropsAndEnv do. */
export async function openComposition(browser: Browser, url: string, comp: any, serializedInputProps: string, serializedResolvedProps: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: comp.width, height: comp.height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(`(() => {
    window.remotion_puppeteerTimeout = 30000; window.remotion_isMainTab = true; window.remotion_mediaCacheSizeInBytes = 100000000;
    window.remotion_initialMemoryAvailable = 2000000000; window.remotion_sampleRate = 48000;
    window.process = window.process || {}; window.process.env = window.process.env || {}; window.process.env.NODE_ENV = "production";
    window.remotion_envVariables = "{}"; window.remotion_inputProps = ${JSON.stringify(serializedInputProps)};
    window.remotion_initialFrame = 0; window.remotion_attempt = 1; window.remotion_proxyPort = 0;
    window.remotion_audioEnabled = false; window.remotion_videoEnabled = true; window.remotion_logLevel = "error";
    window.alert = () => {}; window.confirm = () => false;
  })()`);
  await page.goto(url + "index.html", { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("typeof window.getStaticCompositions === 'function'", { timeout: 30000 });
  await page.evaluate((c: any, props: string) => {
    (window as any).remotion_setBundleMode({
      type: "composition", compositionName: c.id, serializedResolvedPropsWithSchema: props,
      compositionDurationInFrames: c.durationInFrames, compositionFps: c.fps, compositionHeight: c.height, compositionWidth: c.width,
      compositionDefaultCodec: c.defaultCodec ?? null, compositionDefaultOutName: c.defaultOutName ?? null, compositionDefaultVideoImageFormat: c.defaultVideoImageFormat ?? null,
      compositionDefaultPixelFormat: c.defaultPixelFormat ?? null, compositionDefaultProResProfile: c.defaultProResProfile ?? null, compositionDefaultSampleRate: c.defaultSampleRate ?? null,
    });
  }, comp, serializedResolvedProps);
  await waitReady(page);
  return page;
}

export async function seekComposition(page: Page, id: string, frame: number): Promise<void> {
  await waitReady(page);
  await page.evaluate((f: number, c: string) => { (window as any).remotion_setFrame(f, c, 1); }, frame, id);
  await waitReady(page);
  await page.evaluate("document.fonts.ready.then(() => true)");
}

/** Audit compositions of an already-built bundle folder. */
export async function auditRemotionBundle(root: string, bundleDir: string, o: RemotionLayoutOptions = {}): Promise<RemotionLayoutComp[]> {
  assertRemotionOnline();
  const log = o.log ?? (() => {});
  const { renderer } = await loadRemotion(root);
  const inputProps = o.inputProps ?? {};
  const srv = await serveDir(bundleDir);
  let browser: Browser | undefined;
  const out: RemotionLayoutComp[] = [];
  try {
    // inside try: when Chrome can't start, the bundle server must still close, or the process never exits
    browser = await launch();
    const { CHROME, remotionChromeMode } = await import("../render.js");
    const all = await renderer.getCompositions(bundleDir, { inputProps, browserExecutable: CHROME, chromeMode: remotionChromeMode(CHROME), logLevel: "error" });
    const list = (o.compositions?.length ? all.filter((c: any) => o.compositions!.includes(c.id)) : all) as any[];
    if (!list.length) throw new Error(`No matching compositions. Available: ${all.map((c: any) => c.id).join(", ")}`);
    for (const comp of list) {
      log(`${comp.id}: layout audit (${comp.durationInFrames} frames @ ${comp.fps} fps)`);
      const page = await openComposition(browser, srv.url, comp, serializeProps(root, inputProps), serializeProps(root, comp.props));
      const duration = (comp.durationInFrames - 1) / comp.fps;
      const r = await auditLayoutPage(page, duration, {
        ...(o.allFrames ? { fps: comp.fps, maxFrames: allFramesCount((comp.durationInFrames - 1) / comp.fps, comp.fps) } : { fps: o.fps ?? 4, maxFrames: o.maxFrames ?? 120 }), capture: o.capture,
        seekTo: (t) => seekComposition(page, comp.id, Math.min(comp.durationInFrames - 1, Math.round(t * comp.fps))),
      });
      await page.close();
      out.push({ id: comp.id, width: comp.width, height: comp.height, fps: comp.fps, durationInFrames: comp.durationInFrames, frames: r.frames, findings: r.findings, issues: layoutIssues(r.findings, { jsx: true }).map((i, k) => ({ ...i, where: `${comp.id}: ${i.where}`, frames: r.findings[k].frames.map((t) => Math.round(t * comp.fps)) })), timeline: r.timeline });
    }
  } finally {
    await browser?.close();
    await srv.close();
  }
  return out;
}

/** Bundle a Remotion project (or a lone .tsx/.jsx in a scaffold) and audit its compositions. */
export async function auditRemotion(target: string, o: RemotionLayoutOptions = {}): Promise<RemotionLayoutResult> {
  assertRemotionOnline();
  const abs = path.resolve(target);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-layout-"));
  try {
    let root: string, ids = o.compositions;
    if (fs.statSync(abs).isDirectory()) root = abs;
    else {
      const r = findRemotionRoot(abs);
      if (r && fs.existsSync(path.join(r, "node_modules", "remotion"))) { root = r; ids ??= compositionsFor(r, abs); }
      else { if (!fs.existsSync(path.join(FALLBACK_MODULES, "remotion"))) throw new Error("Remotion is not installed."); const s = scaffold(abs, path.join(work, "proj"), { outDir: work } as any); root = s.root; ids ??= s.ids; }
    }
    const { bundle } = await loadRemotion(root);
    o.log?.("bundling…");
    const dir = await bundle({ entryPoint: entryPoint(root), publicDir: fs.existsSync(path.join(root, "public")) ? path.join(root, "public") : undefined, enableCaching: false, outDir: path.join(work, "bundle"),
      ...(o.untrusted ? { webpackOverride: confineImports([root, FALLBACK_MODULES]) } : {}) });
    const compositions = await auditRemotionBundle(root, dir, { ...o, compositions: ids });
    return { root, compositions };
  } finally {
    if (!process.env.HARAKAH_KEEP_WORK) fs.rmSync(work, { recursive: true, force: true });
  }
}
