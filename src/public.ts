/**
 * Public-instance guards for the web tool (HARAKAH_PUBLIC=1). Off by default: the local tool stays unlimited.
 * - per-IP rate limits (fixed window; renders cost more than static checks)
 * - request body / upload caps → 413
 * - startup + periodic cleanup of harakah-* temp dirs
 * - env scrub + Chrome egress allowlist: pasted scenes run in headless Chrome, so the browser must not see
 *   secrets (env, /proc/self/environ) or reach arbitrary hosts (exfiltration). CDNs scenes load from stay open.
 * حماية النسخة العامة: حدود للطلبات والحجم، وتنظيف الملفات المؤقتة، وعزل المتصفح عن الأسرار والشبكة.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";

const num = (v: string | undefined, d: number) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export interface PublicConfig {
  public: boolean;
  /** trust X-Forwarded-For / Fly-Client-IP / CF-Connecting-IP (only behind a proxy you control) */
  trustProxy: boolean;
  /** JSON body cap (paste / options) */
  bodyBytes: number;
  /** project upload cap (zip or file list) */
  uploadBytes: number;
  /** requests per IP per window: static (analyze/meta/examples) and render (compare/layout/project) */
  windowMs: number; maxRequests: number; maxRenders: number;
  /** temp dirs older than this are removed */
  tmpTtlMs: number; cleanupEveryMs: number;
  /** hosts headless Chrome may reach besides localhost (CDNs pasted scenes load scripts/fonts from) */
  egressHosts: string[];
}

export const DEFAULT_EGRESS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "esm.sh", "fonts.googleapis.com", "fonts.gstatic.com", "cdn.tailwindcss.com"];

export function publicConfig(env: NodeJS.ProcessEnv = process.env): PublicConfig {
  const pub = env.HARAKAH_PUBLIC === "1" || env.HARAKAH_PUBLIC === "true";
  return {
    public: pub,
    trustProxy: env.HARAKAH_TRUST_PROXY === "1" || env.HARAKAH_TRUST_PROXY === "true",
    bodyBytes: num(env.HARAKAH_MAX_BODY_KB, pub ? 512 : 5_000) * 1000,
    uploadBytes: num(env.HARAKAH_MAX_UPLOAD_MB, pub ? 8 : 60) * (1 << 20),
    windowMs: num(env.HARAKAH_RATE_WINDOW_S, 600) * 1000,
    maxRequests: num(env.HARAKAH_RATE_MAX, pub ? 120 : Infinity),
    maxRenders: num(env.HARAKAH_RATE_RENDERS, pub ? 12 : Infinity),
    tmpTtlMs: num(env.HARAKAH_TMP_TTL_MIN, 60) * 60_000,
    cleanupEveryMs: num(env.HARAKAH_CLEANUP_EVERY_MIN, 10) * 60_000,
    egressHosts: env.HARAKAH_EGRESS_HOSTS != null ? env.HARAKAH_EGRESS_HOSTS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_EGRESS,
  };
}

/**
 * Public mode runs strangers' pastes in Chrome (no sandbox) and Remotion bundles in one shared container. The guards
 * above narrow what a paste can reach, but there is no per-job isolation and no outside security review yet, so the
 * server refuses to start in public mode until the operator says they accept that: HARAKAH_PUBLIC_UNISOLATED=1.
 */
export function publicRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!publicConfig(env).public || env.HARAKAH_PUBLIC_UNISOLATED === "1") return null;
  return [
    "harakah-fix serve: public mode (HARAKAH_PUBLIC=1) is not ready for hosting strangers' code.",
    "Pastes run in one shared container with no per-job isolation, and no outside security review has been done.",
    "To run it anyway (a private test, behind your own login), also set HARAKAH_PUBLIC_UNISOLATED=1. See SECURITY.md.",
    "الوضع العام غير جاهز لاستضافة كود الآخرين: لا عزل لكل مهمة ولم تُجرَ مراجعة أمنية خارجية. للتشغيل رغم ذلك اضبط HARAKAH_PUBLIC_UNISOLATED=1.",
  ].join("\n");
}

export class TooLarge extends Error {
  constructor(public limit: number) { super(`request too large (max ${Math.round(limit / 1000)} KB)`); }
}

/** Fixed-window counter per key and bucket. */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(private windowMs: number) {}
  hit(key: string, max: number, now = Date.now()): { ok: boolean; retryAfter: number; remaining: number } {
    if (!Number.isFinite(max)) return { ok: true, retryAfter: 0, remaining: Infinity };
    let h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) { h = { start: now, n: 0 }; this.hits.set(key, h); }
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
    if (h.n >= max) return { ok: false, retryAfter: Math.ceil((h.start + this.windowMs - now) / 1000), remaining: 0 };
    h.n++;
    return { ok: true, retryAfter: 0, remaining: max - h.n };
  }
}

const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;
/** HOST the server binds to is this machine only (the default 127.0.0.1), not 0.0.0.0 / a LAN address. */
export const isLoopbackBind = (host: string) => /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i.test(host);
/** Body types a web page can't send cross-origin without a CORS preflight (text/plain and form posts are refused). */
const BODY_TYPES = new Set(["application/json", "application/zip", "application/x-zip-compressed", "application/octet-stream"]);

/**
 * Cross-site and DNS-rebinding guard for the tool's API. Any page the user visits can send a "simple" request (a
 * text/plain POST, no preflight) to http://127.0.0.1:4747, and a hostname rebound to 127.0.0.1 makes that page
 * same-origin. Pastes are rendered in Chrome with file access, and uploads go through the codemod, so both must
 * come from the tool's own page:
 * - bound to loopback: the Host header must be a loopback name (a rebound evil.example:4747 is refused);
 * - POST: a browser's Origin / Sec-Fetch-Site must be this origin, and the body type must need a preflight.
 * Non-browser clients (curl, tests, agents) send neither header and pass with a JSON or zip body.
 * حماية من الطلبات القادمة من مواقع أخرى ومن إعادة ربط النطاق (DNS rebinding).
 */
export function requestGuard(req: http.IncomingMessage, o: { loopback: boolean }): { status: number; error: string } | null {
  const host = String(req.headers.host || "").toLowerCase();
  if (o.loopback && !LOOPBACK_HOST.test(host)) return { status: 403, error: `host not allowed: ${host || "(none)"}; open the tool at http://127.0.0.1` };
  if (req.method !== "POST") return null;
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return { status: 403, error: `cross-site request refused (${site})` };
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    let same = false;
    try { same = origin !== "null" && new URL(origin).host.toLowerCase() === host; } catch { same = false; }
    if (!same) return { status: 403, error: `cross-origin request refused (${origin})` };
  }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!BODY_TYPES.has(type)) return { status: 415, error: `unsupported content-type: ${type || "(none)"}; send application/json` };
  return null;
}

export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const h = req.headers;
    const direct = h["fly-client-ip"] || h["cf-connecting-ip"] || h["true-client-ip"];
    if (typeof direct === "string" && direct) return direct.trim();
    const xff = h["x-forwarded-for"];
    if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/** Remove harakah-* temp entries older than ttl (render dirs, uploaded projects, compare videos). */
export function cleanupTemp(ttlMs: number, dir = os.tmpdir(), now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return removed; }
  for (const n of names) {
    if (!/^harakah-/.test(n)) continue;
    const p = path.join(dir, n);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory() && n === "harakah-ui-videos") { // long-lived folder: expire the files inside
        for (const f of fs.readdirSync(p)) { const fp = path.join(p, f); if (now - fs.statSync(fp).mtimeMs > ttlMs) { fs.rmSync(fp, { force: true }); removed.push(fp); } }
        continue;
      }
      if (now - st.mtimeMs > ttlMs) { fs.rmSync(p, { recursive: true, force: true }); removed.push(p); }
    } catch { /* raced with another cleanup */ }
  }
  return removed;
}

const ENV_KEEP = /^(PATH|HOME|LANG|LC_\w+|TZ|TMPDIR|PORT|HOST|NODE_ENV|NODE_OPTIONS|HARAKAH_\w+|PUPPETEER_\w+|FONTCONFIG_\w+|XDG_\w+|CHROME_PATH)$/;

/**
 * Public mode: drop every env var not on the allowlist (platform tokens, DB URLs, …) so neither the server nor
 * the Chrome it spawns can leak them, then point our Chrome at a dead proxy except localhost
 * and the CDN allowlist. Chromium on Linux honours all_proxy/no_proxy; Node's fetch does not (unaffected), and
 * neither does Remotion's Chrome, which @remotion/renderer starts with --no-proxy-server.
 */
export function lockDownEnv(cfg: PublicConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const dropped: string[] = [];
  for (const k of Object.keys(env)) if (!ENV_KEEP.test(k)) { dropped.push(k); delete env[k]; }
  env.all_proxy = env.ALL_PROXY = "socks5://127.0.0.1:9";
  env.no_proxy = env.NO_PROXY = ["localhost", "127.0.0.1", "::1", ...cfg.egressHosts].join(",");
  return dropped;
}
