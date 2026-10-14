#!/usr/bin/env node
// Static-only landing for Cloudflare Pages or any static host: writes site/ with the landing (Arabic at /,
// English at /en/), icons, the OFL fonts it uses (+ licenses), demo media, a /tool/ page (how to run the tool, or a
// redirect to HARAKAH_TOOL_URL), a 404 page, and host config (_headers with a hash-based CSP, _redirects). Node built-ins only: no install step.
// صفحة الهبوط كملفات ثابتة فقط (بدون خادم): للرفع على Cloudflare Pages أو أي استضافة ثابتة.
//
//   SITE_ORIGIN=https://harakah.example  absolute URLs for canonical / OpenGraph (else the host's env, else relative)
//   HARAKAH_TOOL_URL=https://tool.example  where "Open the tool" goes (a deployed web tool); default /tool/
//   HARAKAH_SITE_OUT=site                  output folder
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const OUT = path.resolve(ROOT, process.env.HARAKAH_SITE_OUT || "site");
const env = process.env;
const ORIGIN = (env.SITE_ORIGIN || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || env.CF_PAGES_URL || "").replace(/\/+$/, "");
const TOOL = env.HARAKAH_TOOL_URL || "";
const META = JSON.parse(fs.readFileSync(path.join(WEB, "meta.json"), "utf8"))["landing.html"];
const escAttr = (x) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const copy = (src, rel) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(src, f); };

const src = fs.readFileSync(path.join(WEB, "landing.html"), "utf8");
const TOOL_PAGE = fs.readFileSync(path.join(ROOT, "site-src", "tool.html"), "utf8");
function landing(lang) {
  const m = META[lang];
  const home = `${ORIGIN}/`, en = `${ORIGIN}/en/`;
  const vars = {
    ORIGIN, URL: lang === "en" ? en : home, LANG: lang, OG_TITLE: escAttr(m.title), OG_DESC: escAttr(m.desc),
    OG_IMAGE: `${ORIGIN}/assets/og-${lang}.png`, OG_LOCALE: lang === "en" ? "en_US" : "ar_AR", OG_LOCALE_ALT: lang === "en" ? "ar_AR" : "en_US",
    OG_ALT: lang === "en" ? "Harakah: Animate Arabic titles. Keep the letters joined." : "حركة: حرّك العنوان، والحروف تبقى متصلة.",
  };
  // "/" in the tool's landing is the tool itself: rewrite those links first, before any link to the site's own home
  // ("/landing", canonical "{{ORIGIN}}/" without an origin) becomes href="/" and would be caught too
  let t = src
    .replace(/href="\/"/g, `href="${TOOL || "/tool/"}"`)
    .replace('href="{{ORIGIN}}/landing?lang=en"', `href="${en}"`)
    .replace('href="{{ORIGIN}}/landing"', `href="${home}"`)
    .replace(/\{\{(\w+)\}\}/g, (all, k) => vars[k] ?? all)
    .replace(/href="\/landing"/g, `href="${lang === "en" ? "/en/" : "/"}"`)
    .replace(/<span lang="ar">افتح الأداة<\/span><span lang="en">Open the tool<\/span>/g, TOOL ? "$&" : '<span lang="ar">شغّل الأداة</span><span lang="en">Run the tool</span>');
  // /en/ opens in English unless the visitor picks Arabic in the page
  if (lang === "en") t = t.replace('.get("lang");', '.get("lang") || "en";');
  const left = t.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`unfilled placeholders: ${[...new Set(left)].join(", ")}`);
  return t;
}
write("index.html", landing("ar"));
write("en/index.html", landing("en"));

// referenced assets only: icons/OG, fonts (+ their OFL license), demo media
for (const f of fs.readdirSync(path.join(WEB, "assets"))) copy(path.join(WEB, "assets", f), `assets/${f}`);
copy(path.join(WEB, "assets", "favicon.ico"), "favicon.ico");
copy(path.join(WEB, "site.webmanifest"), "site.webmanifest");
const FONTS = path.join(ROOT, "assets", "fonts");
const fonts = [...new Set([...(src + TOOL_PAGE).matchAll(/\/fonts\/([\w.-]+\.(?:ttf|woff2?))/g)].map((m) => m[1]))];
const licenses = new Set();
for (const f of fonts) {
  copy(path.join(FONTS, f), `fonts/${f}`);
  const fam = f.toLowerCase().startsWith("ibmplex") ? "ibmplexsansarabic" : f.toLowerCase().split(/[-.]/)[0];
  licenses.add(`OFL-${fam}.txt`);
}
for (const l of licenses) { if (!fs.existsSync(path.join(FONTS, l))) throw new Error(`missing font license ${l}`); copy(path.join(FONTS, l), `fonts/${l}`); }
// the Remotion tab builds its before/after image paths at runtime, so list those two explicitly
const demo = [...new Set([...[...src.matchAll(/\/demo\/([\w./-]+\.(?:mp4|png))/g)].map((m) => m[1]), "remotion/before.png", "remotion/after.png"])];
for (const d of demo) if (fs.existsSync(path.join(ROOT, "demo", d))) copy(path.join(ROOT, "demo", d), `demo/${d}`);
// README images: the README links https://harakah.si/media/…, so they show on npmjs.com and anywhere the README is copied
for (const f of fs.readdirSync(path.join(ROOT, "docs", "media"))) copy(path.join(ROOT, "docs", "media", f), `media/${f}`);

// /tool/: the web tool needs a server (Chrome renders). With HARAKAH_TOOL_URL it forwards there; otherwise it's the
// "run it locally" page (site-src/tool.html: English by default, Arabic one click away).
write("tool/index.html", TOOL ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Harakah tool · أداة حركة</title><link rel="icon" href="/favicon.ico"><meta http-equiv="refresh" content="0;url=${escAttr(TOOL)}"></head>
<body><p><a href="${escAttr(TOOL)}">Open the tool</a> · <a href="${escAttr(TOOL)}" lang="ar" dir="rtl">افتح الأداة</a></p></body></html>
` : TOOL_PAGE);

// a real 404 (Cloudflare Pages serves 404.html with status 404; without it, unknown paths got the home page with 200).
// Colours are /tool/'s palette, read from its source so the brand stays in one place; the theme follows the system.
const theme = (name) => (TOOL_PAGE.match(new RegExp(`:root\\[data-theme=${name}\\]\\{([^}]*)\\}`)) ?? [])[1] ?? "";
write("404.html", `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found · غير موجودة · Harakah</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico">
<style>@font-face{font-family:"IBM Plex Sans Arabic";src:url("/fonts/IBMPlexSansArabic-Regular.ttf");font-display:swap}
:root{${theme("light")}}@media (prefers-color-scheme:dark){:root{${theme("dark")}}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:400 18px/1.8 "IBM Plex Sans Arabic",system-ui,sans-serif}
main{padding:24px;max-width:34rem;text-align:center}h1{font-size:28px;margin:0 0 8px}p{margin:4px 0;color:var(--mute)}a{color:var(--acc)}nav{margin-top:20px;display:flex;gap:18px;justify-content:center;flex-wrap:wrap}</style></head>
<body><main><h1>هذه الصفحة غير موجودة</h1><p lang="en" dir="ltr">This page doesn't exist.</p>
<nav><a href="/">الصفحة الرئيسية</a><a href="/en/" lang="en" dir="ltr">Home (English)</a><a href="/tool/" lang="en" dir="ltr">Run Harakah locally</a></nav></main></body></html>
`);

// Content-Security-Policy: everything is served from this origin. Inline scripts are allowed by their sha256 (computed
// from the pages just written, so it can't drift); inline styles and style="" attributes stay allowed; data: images for the
// landing's CSS noise texture.
const pages = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".html")) pages.push(f); } })(OUT);
const hashes = [...new Set(pages.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`)))].sort();
const CSP = ["default-src 'self'", `script-src 'self' ${hashes.join(" ")}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "media-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");

// Cloudflare Pages / Netlify config
write("_headers", `/*
  Content-Security-Policy: ${CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
/demo/*
  Cache-Control: public, max-age=86400
/assets/*
  Cache-Control: public, max-age=86400
`);
write("_redirects", `/landing / 301
/landing.html / 301
/index.html / 301
${TOOL ? `/tool ${TOOL} 302\n/tool/ ${TOOL} 302\n` : ""}`);

// robots.txt + sitemap.xml (the sitemap needs absolute URLs, so only with an origin)
write("robots.txt", `User-agent: *\nAllow: /\n${ORIGIN ? `Sitemap: ${ORIGIN}/sitemap.xml\n` : ""}`);
if (ORIGIN) write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[`${ORIGIN}/`, `${ORIGIN}/en/`].map((u) => `  <url><loc>${u}</loc><xhtml:link rel="alternate" hreflang="ar" href="${ORIGIN}/"/><xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en/"/></url>`).join("\n")}
</urlset>
`);

const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`site → ${path.relative(ROOT, OUT) || OUT} (${(size(OUT) / 1e6).toFixed(1)} MB; fonts: ${fonts.join(", ")}; origin: ${ORIGIN || "(relative: set SITE_ORIGIN for OpenGraph)"}; tool: ${TOOL || "/tool/ (run locally)"})`);
