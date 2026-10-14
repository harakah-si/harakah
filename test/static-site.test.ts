// Static-only landing (Cloudflare Pages or any static host): scripts/build-static.mjs → placeholders filled, Arabic at /,
// English at /en/, tool links rewritten, only OFL fonts (+ licenses), host config files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

function build(env: Record<string, string>) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-site-"));
  execFileSync(process.execPath, ["scripts/build-static.mjs"], { env: { PATH: process.env.PATH!, HARAKAH_SITE_OUT: out, ...env }, encoding: "utf8" });
  return out;
}

test("static site: landing ar + en, absolute OG with SITE_ORIGIN, /tool/ page, OFL fonts only", () => {
  const out = build({ SITE_ORIGIN: "https://harakah.example/" });
  const ar = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const en = fs.readFileSync(path.join(out, "en/index.html"), "utf8");
  assert.doesNotMatch(ar + en, /\{\{\w+\}\}/);
  assert.match(ar, /<meta property="og:image" content="https:\/\/harakah\.example\/assets\/og-ar\.png">/);
  assert.match(en, /<link rel="canonical" href="https:\/\/harakah\.example\/en\/">/);
  assert.match(en, /\.get\("lang"\) \|\| "en"/);
  assert.match(ar, /class="btn p" href="\/tool\/"/);
  assert.doesNotMatch(ar, /href="\/landing"|href="\/"[^>]*>[^<]*<span lang="ar">افتح الأداة/);
  // no hosted tool: the buttons say "Run the tool" and /tool/ is the run-it-locally page, English unless Arabic was picked
  assert.match(ar, /<span lang="ar">شغّل الأداة<\/span><span lang="en">Run the tool<\/span>/);
  assert.doesNotMatch(ar, /Open the tool/);
  const tool = fs.readFileSync(path.join(out, "tool/index.html"), "utf8");
  assert.match(tool, /<html lang="en" dir="ltr" data-lang="en"/);
  assert.match(tool, /getItem\("hz-lang"\) === "ar" \? "ar" : "en"/);
  assert.match(tool, /<code>npx -y -p harakah-fixer harakah-fix serve<\/code>/);
  assert.doesNotMatch(tool, /npm run (build|serve)/, "repo-only steps don't work for visitors");
  assert.match(tool, /<button type="button" data-v="ar"/);
  for (const f of tool.match(/\/fonts\/[\w.-]+/g)!) assert.ok(fs.existsSync(path.join(out, f)), f);
  for (const f of ["favicon.ico", "site.webmanifest", "assets/og-en.png", "demo/harakah-demo.mp4", "demo/remotion/before.png", "demo/remotion/after.png", "tool/index.html", "_headers", "_redirects", "robots.txt"]) assert.ok(fs.existsSync(path.join(out, f)), f);
  // every image the npm README links at https://harakah.si/media/… is published
  for (const m of fs.readFileSync("README.md", "utf8").matchAll(/https:\/\/harakah\.si\/(media\/[\w.-]+)/g)) assert.ok(fs.existsSync(path.join(out, m[1])), m[1]);
  const fonts = fs.readdirSync(path.join(out, "fonts"));
  assert.ok(fonts.includes("OFL-ibmplexsansarabic.txt") && fonts.includes("OFL-alexandria.txt"));
  assert.ok(fonts.every((f) => /^(IBMPlexSansArabic|Alexandria|OFL-)/.test(f)), fonts.join(","));
  assert.ok(!fonts.some((f) => /thmanyah/i.test(f)));
  assert.match(fs.readFileSync(path.join(out, "_headers"), "utf8"), /X-Content-Type-Options: nosniff/);
  fs.rmSync(out, { recursive: true, force: true });
});

test("static site: HARAKAH_TOOL_URL points the buttons + /tool/ at a deployed tool", () => {
  const out = build({ HARAKAH_TOOL_URL: "https://tool.example/" });
  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /class="btn p" href="https:\/\/tool\.example\/"/);
  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /<span lang="en">Open the tool<\/span>/);
  assert.match(fs.readFileSync(path.join(out, "_redirects"), "utf8"), /^\/tool https:\/\/tool\.example\/ 302$/m);
  assert.match(fs.readFileSync(path.join(out, "tool/index.html"), "utf8"), /http-equiv="refresh" content="0;url=https:\/\/tool\.example\/"/);
  fs.rmSync(out, { recursive: true, force: true });
});

test("static site: the logo links home and the canonical is the page itself, with or without SITE_ORIGIN", () => {
  for (const origin of ["", "https://harakah.example"]) {
    const out = build(origin ? { SITE_ORIGIN: origin } : {});
    const ar = fs.readFileSync(path.join(out, "index.html"), "utf8");
    const en = fs.readFileSync(path.join(out, "en/index.html"), "utf8");
    // the tool's landing uses href="/" for "open the tool"; the site's own home links must not be rewritten with them
    assert.match(ar, /class="logo" href="\/"/, `logo on / (${origin || "no origin"})`);
    assert.match(en, /class="logo" href="\/en\/"/);
    assert.match(ar, new RegExp(`<link rel="canonical" href="${origin}/">`));
    assert.match(ar, new RegExp(`<link rel="alternate" hreflang="ar" href="${origin}/">`));
    assert.match(ar, /class="btn p" href="\/tool\/"/);
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("static site: a real 404 page, and a CSP that allows exactly the pages' inline scripts", () => {
  const out = build({ SITE_ORIGIN: "https://harakah.example" });
  const nf = fs.readFileSync(path.join(out, "404.html"), "utf8");
  assert.match(nf, /<html lang="ar" dir="rtl">/);
  assert.match(nf, /هذه الصفحة غير موجودة/);
  assert.match(nf, /This page doesn't exist/);
  assert.match(nf, /<meta name="robots" content="noindex">/);
  assert.match(nf, /:root\{color-scheme:light;--bg:#[0-9a-f]{6}/, "the palette is read from the /tool/ page");
  assert.match(nf, /@media \(prefers-color-scheme:dark\)\{:root\{color-scheme:dark;--bg:#[0-9a-f]{6}/);
  const csp = /Content-Security-Policy: (.*)/.exec(fs.readFileSync(path.join(out, "_headers"), "utf8"))![1];
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name + " "))!;
  assert.doesNotMatch(directive("script-src"), /unsafe-inline|unsafe-eval|https?:/);
  for (const d of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) assert.ok(csp.includes(d), d);
  const pages = ["index.html", "en/index.html", "tool/index.html", "404.html"];
  for (const f of pages) for (const m of fs.readFileSync(path.join(out, f), "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const h = `'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`;
    assert.ok(directive("script-src").includes(h), `${f}: inline script not in the CSP`);
  }
  fs.rmSync(out, { recursive: true, force: true });
});
