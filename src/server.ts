/** Tiny server for the web UI. Binds to 127.0.0.1 unless HOST is set; HARAKAH_PUBLIC=1 adds the public-instance guards (src/public.ts). */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyze, fix, type Options } from "./engine.js";
import { summarize, VERSION } from "./report.js";
import { compareHtml, renderable } from "./pipeline.js";
import { ASSET_FONT_DIR } from "./fonts.js";
import { RULES } from "./rules.js";
import { transformSource, toIssues } from "./remotion/codemod.js";
import { analyzeProject, filesFromZip, filesFromList, projectZip, projectPatch, rerunProject, LIMITS } from "./project-upload.js";
import { HELPER_SRC, HELPER_FILE } from "./remotion/project.js";
import { compareRemotion } from "./remotion/compare.js";
import { createTwoFilesPatch } from "diff";
import { randomBytes } from "node:crypto";
import { publicConfig, publicRefusal, lockDownEnv, cleanupTemp, RateLimiter, clientIp, TooLarge, requestGuard, isLoopbackBind } from "./public.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const FIX = path.join(ROOT, "fixtures");
const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || "127.0.0.1";
const refusal = publicRefusal();
if (refusal) { console.error(refusal); process.exit(1); }
const CFG = publicConfig();
if (CFG.public) {
  const dropped = lockDownEnv(CFG);
  console.log(`public mode: ${dropped.length} env vars dropped; Chrome egress → localhost + ${CFG.egressHosts.join(", ")}`);
  const sweep = () => { const r = cleanupTemp(CFG.tmpTtlMs); if (r.length) console.log(`temp cleanup: removed ${r.length}`); };
  sweep();
  setInterval(sweep, CFG.cleanupEveryMs).unref();
}
const limiter = new RateLimiter(CFG.windowMs);
const RENDER_ROUTES = /^\/api\/(compare|layout|project)(\/[\w-]+\/rerun)?$/;

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".mp4": "video/mp4", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function send(res: http.ServerResponse, code: number, body: string | Buffer, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}
const json = (res: http.ServerResponse, obj: unknown, code = 200) => send(res, code, JSON.stringify(obj));

/** MP4/PNG with HTTP Range support (Safari and seeking need 206 responses) */
function sendMedia(req: http.IncomingMessage, res: http.ServerResponse, f: string) {
  const buf = fs.readFileSync(f);
  const type = MIME[path.extname(f)] || "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range || ""));
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${buf.length}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": buf.length });
  return res.end(buf);
}

/** Compare MP4s rendered for the web tool: random id → file, kept 30 min (local only, never uploaded anywhere). */
const VIDEO_DIR = path.join(os.tmpdir(), "harakah-ui-videos");
const VIDEO_TTL = 30 * 60_000;
const VIDEO_MAX_SECONDS = 12;
const videos = new Map<string, { file: string; at: number }>();
function keepVideo(src: string): string {
  const now = Date.now();
  for (const [id, v] of videos) if (now - v.at > VIDEO_TTL) { fs.rmSync(v.file, { force: true }); videos.delete(id); }
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const id = randomBytes(9).toString("hex");
  const file = path.join(VIDEO_DIR, `${id}.mp4`);
  fs.copyFileSync(src, file);
  videos.set(id, { file, at: now });
  return `/api/video/${id}`;
}
/**
 * Over the cap: answer 413 but keep reading (and discarding) the rest, so the client finishes its upload and sees
 * the 413 instead of a reset socket (EPIPE). A sender that goes on past DRAIN_MAX is cut off.
 */
const DRAIN_MAX = 64 << 20;
function discard(req: http.IncomingMessage, already: number) {
  let n = already;
  req.removeAllListeners("data");
  req.on("data", (c: Buffer) => { n += c.length; if (n > DRAIN_MAX) req.destroy(); });
  req.resume();
}
function body(req: http.IncomingMessage, limit = CFG.bodyBytes): Promise<any> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > limit) { discard(req, 0); return reject(new TooLarge(limit)); }
    let size = 0; const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > limit) { chunks.length = 0; discard(req, size); reject(new TooLarge(limit)); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
  });
}
function rawBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > limit) { discard(req, 0); return reject(new TooLarge(limit)); }
    let size = 0; const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > limit) { chunks.length = 0; discard(req, size); reject(new TooLarge(limit)); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
function opts(o: any = {}): Options {
  return {
    split: o.split === "word" ? "word" : "zwj",
    digits: ["eastern", "western", "keep"].includes(o.digits) ? o.digits : "eastern",
    font: ["plex", "alexandria", "readex", "cairo", "tajawal", "naskh"].includes(o.font) ? o.font : "plex",
    fontSrc: ["file", "data", "google", "none"].includes(o.fontSrc) ? o.fontSrc : "file",
    bidi: o.bidi !== false, replaceProprietary: !!o.replaceProprietary,
  };
}
const REM = path.join(FIX, "remotion", "src");
const remotionExamples = () => ["broken", "clean"].flatMap((d) => fs.readdirSync(path.join(REM, d)).filter((f) => f.endsWith(".tsx")).map((f) => `remotion/${d}/${f}`));
const safeExample = (name: string) => {
  if (/^[\w.-]+\.html$/.test(name) && fs.existsSync(path.join(FIX, name))) return path.join(FIX, name);
  if (remotionExamples().includes(name)) return path.join(REM, name.slice("remotion/".length));
  return null;
};
/** durationInFrames per composition id, read from the fixtures Root.tsx. */
const remotionDurations = (): Record<string, number> => {
  const t = fs.readFileSync(path.join(REM, "Root.tsx"), "utf8");
  return Object.fromEntries([...t.matchAll(/id="(\w+)"[^>]*durationInFrames=\{(\d+)\}/g)].map((m) => [m[1], Number(m[2])]));
};
const looksLikeJsx = (t: string) => !/<!doctype|<html[\s>]/i.test(t) && (/^\s*import\s.+from\s+["']/m.test(t) || /export\s+(default|const|function)\s/.test(t) || /React\.FC|useCurrentFrame/.test(t));
function remotionOpts(o: any = {}) {
  return { split: o.split === "word" ? "word" : "zwj", digits: ["eastern", "western", "keep"].includes(o.digits) ? o.digits : "eastern",
    font: o.font === "plex" || o.font === "alexandria" ? o.font : "auto", bidi: o.bidi !== false, assumeArabic: !!o.assumeArabic, wrapWords: !!o.wrapWords } as const;
}
const projectRun = (o: any = {}) => ({ props: o.props, propsFile: typeof o.propsFile === "string" ? o.propsFile : undefined, composition: o.composition });
const fileFrom = (dir: string, rel: string) => { const p = path.resolve(dir, "." + path.posix.normalize("/" + rel)); return p.startsWith(dir) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null; };

/** Social/meta copy per page and language (web/meta.json, shared with scripts/build-static.mjs); the server fills {{…}} placeholders so OG URLs are absolute. */
const META: Record<string, Record<"ar" | "en", { title: string; desc: string }>> = JSON.parse(fs.readFileSync(path.join(WEB, "meta.json"), "utf8"));
const escAttr = (x: string) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function page(file: string, url: URL, req: http.IncomingMessage): string {
  // the tool page opens in English, the landing in Arabic; ?lang= picks the other one
  const q = url.searchParams.get("lang"), def = file === "index.html" ? "en" : "ar";
  const lang = q === "en" || q === "ar" ? q : def;
  const proto = CFG.trustProxy && req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const origin = `${proto}://${req.headers.host || `${HOST}:${PORT}`}`;
  const m = META[file][lang];
  const vars: Record<string, string> = {
    ORIGIN: origin, URL: origin + url.pathname + (lang === def ? "" : `?lang=${lang}`), LANG: lang,
    OG_TITLE: escAttr(m.title), OG_DESC: escAttr(m.desc), OG_IMAGE: `${origin}/assets/og-${lang}.png`,
    OG_LOCALE: lang === "en" ? "en_US" : "ar_AR", OG_LOCALE_ALT: lang === "en" ? "ar_AR" : "en_US",
    OG_ALT: lang === "en" ? "Harakah: Animate Arabic titles. Keep the letters joined." : "حركة: حرّك العنوان، والحروف تبقى متصلة.",
  };
  let t = fs.readFileSync(path.join(WEB, file), "utf8").replace(/\{\{(\w+)\}\}/g, (all, k) => vars[k] ?? all);
  // a public instance processes pastes on this server: say so instead of "runs locally"
  if (CFG.public) for (const [from, to] of PUBLIC_COPY) t = t.split(from).join(to);
  return t;
}

const ttlMin = Math.round(CFG.tmpTtlMs / 60_000);
const PUBLIC_COPY: [string, string][] = [
  ['<span lang="ar">الأداة · تعمل محلياً</span><span lang="en">The tool · runs locally</span>', '<span lang="ar">الأداة · نسخة عامة</span><span lang="en">The tool · public instance</span>'],
  ['<span lang="ar">يعمل محلياً بالكامل، لا يُرفع شيء إلى أي خادم.</span><span lang="en">Runs locally. Nothing leaves this machine.</span>',
   `<span lang="ar">نسخة عامة: ما تلصقه يُعالج على هذا الخادم ويُحذف خلال ${ttlMin} دقيقة، ولا يُحفظ. للخصوصية الكاملة شغّل الأداة على جهازك.</span><span lang="en">Public instance: what you paste is processed on this server and deleted within ${ttlMin} minutes; nothing is kept. For full privacy, run the tool locally.</span>`],
];
let busy = false;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const p = url.pathname;
    // only the tool's own page may drive the API (no drive-by posts from other sites, no DNS rebinding)
    const refused = requestGuard(req, { loopback: isLoopbackBind(HOST) });
    if (refused) {
      if (req.method === "POST") discard(req, 0);
      return json(res, { error: refused.error, ar: "طلب مرفوض: استخدم صفحة الأداة نفسها" }, refused.status);
    }
    if (p === "/healthz") return json(res, { ok: true, version: VERSION, public: CFG.public });
    if (p.startsWith("/api/")) {
      const ip = clientIp(req, CFG.trustProxy);
      const heavy = req.method === "POST" && RENDER_ROUTES.test(p);
      const r = limiter.hit(`${ip}:req`, CFG.maxRequests);
      const r2 = r.ok && heavy ? limiter.hit(`${ip}:render`, CFG.maxRenders) : r;
      if (!r.ok || !r2.ok) {
        res.writeHead(429, { "content-type": "application/json; charset=utf-8", "retry-after": String(Math.max(r.retryAfter, r2.retryAfter)), "cache-control": "no-store" });
        return res.end(JSON.stringify({ error: `rate limit: try again in ${Math.max(r.retryAfter, r2.retryAfter)} s`, ar: "تجاوزت حد الطلبات، حاول بعد قليل" }));
      }
    }
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, page("index.html", url, req), MIME[".html"]);
    if (req.method === "GET" && (p === "/landing" || p === "/landing.html")) {
      // the npm package ships only the tool page; the site lives at harakah.si (a checkout or the Docker image still has it)
      if (!fs.existsSync(path.join(WEB, "landing.html"))) { res.writeHead(302, { location: "https://harakah.si" }); return res.end(); }
      return send(res, 200, page("landing.html", url, req), MIME[".html"]);
    }
    if (req.method === "GET" && p === "/favicon.ico") return send(res, 200, fs.readFileSync(path.join(WEB, "assets", "favicon.ico")), MIME[".ico"]);
    if (req.method === "GET" && p === "/site.webmanifest") return send(res, 200, fs.readFileSync(path.join(WEB, "site.webmanifest")), MIME[".webmanifest"]);
    if (req.method === "GET" && p.startsWith("/assets/")) {
      const f = fileFrom(path.join(WEB, "assets"), p.slice(8));
      return f && /\.(png|ico|svg)$/.test(f) ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)]) : send(res, 404, "not found", "text/plain");
    }
    if (req.method === "GET" && p.startsWith("/demo/")) {
      const f = fileFrom(path.join(ROOT, "demo"), p.slice(6));
      if (!f || !/\.(mp4|png)$/.test(f)) return send(res, 404, "not found", "text/plain");
      return sendMedia(req, res, f);
    }
    if (req.method === "GET" && p.startsWith("/api/video/")) {
      const v = videos.get(p.slice(11));
      if (!v || !fs.existsSync(v.file) || Date.now() - v.at > VIDEO_TTL) return send(res, 404, "expired", "text/plain");
      return sendMedia(req, res, v.file);
    }
    if (req.method === "GET" && p.startsWith("/fonts/")) {
      const f = fileFrom(ASSET_FONT_DIR, p.slice(7));
      return f ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || "application/octet-stream") : send(res, 404, "not found", "text/plain");
    }
    if (req.method === "GET" && p.startsWith("/static/")) {
      const f = fileFrom(WEB, p.slice(8));
      return f ? send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || "application/octet-stream") : send(res, 404, "not found", "text/plain");
    }
    if (req.method === "GET" && p === "/api/meta") {
      return json(res, { version: VERSION, rules: RULES, examples: fs.readdirSync(FIX).filter((f) => f.endsWith(".html")).sort(), remotionExamples: remotionExamples() });
    }
    if (req.method === "GET" && p.startsWith("/api/example/")) {
      const f = safeExample(decodeURIComponent(p.slice(13)));
      return f ? json(res, { name: decodeURIComponent(p.slice(13)), html: fs.readFileSync(f, "utf8") }) : json(res, { error: "unknown example" }, 404);
    }
    if (req.method === "GET" && p === "/api/helper") return send(res, 200, fs.readFileSync(HELPER_SRC), "text/plain; charset=utf-8");
    if (req.method === "POST" && p === "/api/analyze") {
      const b = await body(req);
      const html = String(b.html || "");
      if (b.kind === "remotion" || (b.kind !== "html" && looksLikeJsx(html))) {
        const name = String(b.name || "Composition.tsx").split("/").pop()!.replace(/[^\w.-]/g, "") || "Composition.tsx";
        const r = transformSource(html, { ...remotionOpts(b.options), fileName: name, helperImport: "./harakah-arabic" });
        const issues = toIssues(r, true);
        const diff = r.changed ? createTwoFilesPatch(`a/${name}`, `b/${name}`, html, r.code, "", "", { context: 3 }) : "";
        return json(res, { kind: "remotion", summary: summarize(issues), issues, applied: issues.filter((i) => i.fixable), remaining: issues.filter((i) => !i.fixable), fixedHtml: r.code, diff,
          helper: r.usesHelper && /harakah-arabic/.test(r.code) ? HELPER_FILE : null, cssModules: r.cssModules, assets: [] });
      }
      const o = opts(b.options);
      const a = analyze(html, o);
      const r = fix(html, o);
      return json(res, { summary: summarize(a.issues), stats: a.stats, issues: a.issues, fixedHtml: r.html, applied: r.applied, remaining: r.remaining, shimInjected: r.shimInjected, assets: [...new Set(r.assets.map((x) => x.rel))] });
    }
    // whole Remotion project: raw .zip body (?name=&options=) or JSON { files: [{ path, text|base64 }], name, options }
    if (req.method === "POST" && p === "/api/project") {
      const ct = String(req.headers["content-type"] || "");
      let files, name = "", o: any = {};
      if (/zip|octet-stream/.test(ct)) {
        const buf = await rawBody(req, Math.min(LIMITS.totalBytes, CFG.uploadBytes));
        name = String(url.searchParams.get("name") || "project.zip");
        try { o = JSON.parse(String(url.searchParams.get("options") || "{}")); } catch {}
        files = filesFromZip(new Uint8Array(buf));
      } else {
        const b = await body(req, Math.min(LIMITS.totalBytes, CFG.uploadBytes));
        name = String(b.name || ""); o = b.options || {};
        files = filesFromList(b.files);
      }
      return json(res, await analyzeProject(files, name, remotionOpts(o), projectRun(o)));
    }
    let m: RegExpMatchArray | null;
    if (req.method === "POST" && (m = p.match(/^\/api\/project\/([\w-]{8,20})\/rerun$/))) {
      const b = await body(req);
      const r = await rerunProject(m[1], remotionOpts(b.options || {}), projectRun(b.options || {}));
      return r ? json(res, r) : json(res, { error: "expired: drop the project again" }, 404);
    }
    if (req.method === "GET" && (m = p.match(/^\/api\/project\/([\w-]{8,20})\/[\w.-]+\.(zip|patch)$/))) {
      if (m[2] === "zip") { const z = projectZip(m[1]); if (!z) return send(res, 404, "expired", "text/plain"); res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${z.name}"`, "cache-control": "no-store" }); return res.end(Buffer.from(z.data)); }
      const t = projectPatch(m[1]); if (!t) return send(res, 404, "expired", "text/plain");
      res.writeHead(200, { "content-type": "text/x-diff; charset=utf-8", "content-disposition": `attachment; filename="${t.name}"`, "cache-control": "no-store" }); return res.end(t.text);
    }
    // runtime layout audit (HZ24) with a frame scrubber: sampled JPEG frames + the flagged boxes per frame
    if (req.method === "POST" && p === "/api/layout") {
      if (busy) return json(res, { error: "busy — a render is already running" }, 429);
      busy = true;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-ui-layout-"));
      try {
        const b = await body(req);
        const html = String(b.html || "");
        const ex = b.example ? safeExample(String(b.example)) : null;
        const maxFrames = Math.max(4, Math.min(90, Number(b.maxFrames) || 48));
        const capture = { width: Math.max(240, Math.min(960, Number(b.width) || 640)), quality: 62 };
        const slim = (fs: { code: string; problem: string; kind: string; key: string; text: string; frames: number[]; detail?: string; suggest?: unknown }[]) => fs.map((f) => ({ code: f.code, problem: f.problem, kind: f.kind, where: f.key, text: f.text, frames: f.frames, detail: f.detail, suggest: f.suggest }));
        if (b.kind === "remotion" || (b.kind !== "html" && looksLikeJsx(html))) {
          const src = path.join(dir, "src");
          fs.mkdirSync(src);
          if (ex && ex.endsWith(".tsx")) for (const f of fs.readdirSync(path.dirname(ex))) if (/\.(css|ts)$/.test(f)) fs.copyFileSync(path.join(path.dirname(ex), f), path.join(src, f));
          const name = ex ? path.basename(ex) : "Composition.tsx";
          fs.writeFileSync(path.join(src, name), html);
          const { auditRemotion } = await import("./remotion/layout.js");
          const r = await auditRemotion(path.join(src, name), { fps: 2, maxFrames, capture, untrusted: true });
          const c = r.compositions[0];
          if (!c) return json(res, { error: "no composition found in the paste" }, 422);
          const { coverage } = await import("./layout-audit.js");
          return json(res, { kind: "remotion", id: c.id, fps: c.fps, frames: c.frames, coverage: coverage(c.frames, (c.durationInFrames - 1) / c.fps, c.fps), viewport: { width: c.width, height: c.height }, findings: slim(c.findings), issues: c.issues, timeline: c.timeline ?? [] });
        }
        const { auditLayoutFile, layoutCss, applyLayoutCss, coverage } = await import("./layout-audit.js");
        const { detectStage, projectRoot } = await import("./render.js");
        const base = ex ? path.dirname(ex) : undefined;
        const fileRoots = [dir, ...(base ? [projectRoot(base)] : [])];
        const bf = path.join(dir, "before.html"), af = path.join(dir, "after.html");
        fs.writeFileSync(bf, renderable(html, base));
        const fixed = fix(html, { ...opts(b.options), fontSrc: "file", fontBase: pathToFileURL(ASSET_FONT_DIR).href + "/" });
        const stage = detectStage(html);
        const r = await auditLayoutFile(bf, { stage, fps: 6, maxFrames, capture, fileRoots });
        // after = the static auto-fix plus the layout fixes verified in Chrome
        const css = layoutCss(r.findings);
        fs.writeFileSync(af, renderable(applyLayoutCss(fixed.html, css), base));
        const after = await auditLayoutFile(af, { stage, fps: 6, maxFrames, fileRoots });
        return json(res, { kind: "html", duration: r.duration, frames: r.frames, coverage: coverage(r.frames, r.duration), viewport: r.viewport, findings: slim(r.findings), issues: r.issues, timeline: r.timeline ?? [], after: { frames: after.frames, findings: slim(after.findings), css } });
      } finally { busy = false; fs.rmSync(dir, { recursive: true, force: true }); }
    }
    if (req.method === "POST" && p === "/api/compare") {
      if (busy) return json(res, { error: "busy — a render is already running" }, 429);
      busy = true;
      try {
        const b = await body(req);
        const html = String(b.html || "");
        const ex = b.example ? safeExample(String(b.example)) : null;
        if (b.kind === "remotion" || (b.kind !== "html" && looksLikeJsx(html))) {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-ui-rem-"));
          try {
            const src = path.join(dir, "src");
            fs.mkdirSync(src);
            // siblings (CSS modules, shared helpers) when the paste came from an example
            if (ex && ex.endsWith(".tsx")) for (const f of fs.readdirSync(path.dirname(ex))) if (/\.(css|ts)$/.test(f)) fs.copyFileSync(path.join(path.dirname(ex), f), path.join(src, f));
            const name = ex ? path.basename(ex) : "Composition.tsx";
            fs.writeFileSync(path.join(src, name), html);
            const id = name.replace(/\.tsx$/, "");
            const dur = remotionDurations()[id] ?? 150;
            const r = await compareRemotion(path.join(src, name), { ...remotionOpts(b.options), outDir: path.join(dir, "out"), durationInFrames: Math.min(dur, VIDEO_MAX_SECONDS * 30), frame: id === "YearInReview" ? 300 : undefined, video: !!b.video, untrusted: true });
            const x = r.renders[0];
            const out = {
              kind: "remotion",
              video: x.mp4 && fs.existsSync(x.mp4) ? keepVideo(x.mp4) : undefined, engine: "remotion",
              before: "data:image/png;base64," + fs.readFileSync(x.beforePng).toString("base64"),
              after: "data:image/png;base64," + fs.readFileSync(x.afterPng).toString("base64"),
              remotion: { id: x.id, frame: x.frame, durationInFrames: x.durationInFrames, before: x.before, after: x.after, reference: x.reference, diffAfter: x.diffAfter, diffBefore: x.diffBefore, joinedAfter: x.joinedAfter, joinedBefore: x.joinedBefore, usesSplit: x.usesSplit },
              joins: [],
            };
            return json(res, out);
          } finally { fs.rmSync(dir, { recursive: true, force: true }); }
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-ui-"));
        try {
          const r = await compareHtml(html, dir, opts(b.options), b.video ? { video: true, fps: 30, maxDuration: VIDEO_MAX_SECONDS } : {}, ex ? path.dirname(ex) : undefined, CFG.public || !ex ? "chrome" : "auto"); // a paste renders only in our guarded Chrome (HyperFrames' own Chrome can read the disk); public: no `npx hyperframes` downloads
          const out = {
            before: "data:image/png;base64," + fs.readFileSync(r.beforePng).toString("base64"),
            after: "data:image/png;base64," + fs.readFileSync(r.afterPng).toString("base64"),
            joins: r.joins, stage: r.stage, network: r.network, layout: r.layout ? { frames: r.layout.frames, after: r.layout.after.map((f) => ({ code: f.code, problem: f.problem, where: f.key, detail: f.detail })) } : undefined,
            video: r.mp4 && fs.existsSync(r.mp4) ? keepVideo(r.mp4) : undefined, engine: r.engine, engineNote: r.engineNote, duration: r.duration,
          };
          return json(res, out);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      } finally { busy = false; }
    }
    send(res, 404, "not found", "text/plain");
  } catch (e: any) {
    if (e instanceof TooLarge) return json(res, { error: e.message, ar: "الملف أو النص أكبر من الحد المسموح" }, 413);
    const msg = String(e?.message || e);
    json(res, { error: CFG.public ? msg.split(os.tmpdir()).join("…").split(ROOT).join("…") : msg }, 500);
  }
});
server.listen(PORT, HOST, () => console.log(`harakah-fix UI → http://${HOST}:${(server.address() as { port: number }).port}${CFG.public ? " (public mode)" : ""}`));
