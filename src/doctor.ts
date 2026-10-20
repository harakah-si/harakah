/**
 * `harakah-fix doctor`: is this machine ready? Node, Chrome (found, starts, and really joins Arabic letters with a
 * bundled font), the Chrome mode Remotion will get, ffmpeg, the temp folder, the bundled fonts, and Remotion in the
 * project, and the project's own Arabic font files (do they map U+200D for Safari?). Every problem comes with the one
 * thing to do about it.
 * فحص الجهاز: نود وكروم (ويربط الحروف العربية فعلاً) وffmpeg والخطوط وRemotion، مع الحل لكل مشكلة.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { CHROME, FFMPEG, launch, openPage, inkComponents, remotionChromeMode } from "./render.js";
import { ASSET_FONT_DIR } from "./fonts.js";
import { normalizeDigits } from "./arabic.js";
import { fileCoverage, type Coverage } from "./glyphs.js";

/** Counts in Arabic copy: Eastern digits, after a colon so no number–noun agreement is needed. */
const ar = (n: number) => normalizeDigits(String(n), "eastern", "ar");

export interface DoctorCheck {
  id: string;
  /** false: Harakah can't do its core job (check, fix, gate, renders) until this is fixed */
  ok: boolean;
  /** a failed required check makes `doctor` exit 1; the others are warnings (one feature unavailable) */
  required: boolean;
  en: string;
  ar: string;
  fix?: string;
}

const NODE_MIN = [22, 12, 0];
const atLeast = (v: string, min: number[]) => {
  const p = v.split(".").map(Number);
  for (let i = 0; i < min.length; i++) if ((p[i] ?? 0) !== min[i]) return (p[i] ?? 0) > min[i];
  return true;
};

/** Render «سلام عليكم» as running text and split into per-letter boxes; joined text must have fewer ink pieces. */
async function shapingCheck(): Promise<{ version: string; joined: number; split: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-doctor-"));
  const font = pathToFileURL(path.join(ASSET_FONT_DIR, "IBMPlexSansArabic-Regular.ttf")).href;
  const word = "سلام عليكم";
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:HZ;src:url("${font}")} body{margin:0;background:#fff;color:#000;font:72px/1.6 HZ}
p{margin:0;padding:12px 24px;display:inline-block} #s span{display:inline-block}</style></head><body>
<p id="j">${word}</p><br><p id="s">${[...word].map((c) => `<span>${c === " " ? "&nbsp;" : c}</span>`).join("")}</p></body></html>`;
  const file = path.join(dir, "doctor.html");
  fs.writeFileSync(file, html);
  const browser = await launch();
  try {
    const page = await openPage(browser, file, { width: 900, height: 400 });
    const shot = async (sel: string) => Buffer.from(await (await page.$(sel))!.screenshot({ type: "png" }));
    return { version: await browser.version(), joined: inkComponents(await shot("#j")), split: inkComponents(await shot("#s")) };
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".cache", ".turbo", ".vercel", "out", "coverage"]);
/** The project's own font files (not node_modules), breadth-first, depth ≤ 6, at most 4000 entries and 60 fonts. */
export function projectFonts(root: string): string[] {
  const fonts: string[] = [], queue: [string, number][] = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < 4000 && fonts.length < 60) {
    const [dir, depth] = queue.shift()!;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (++seen > 4000) break;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 6 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) queue.push([p, depth + 1]); }
      else if (e.isFile() && /\.(?:ttf|otf|woff2?)$/i.test(e.name)) fonts.push(p);
    }
  }
  return fonts;
}

/** Arabic fonts in the project with no cmap entry for U+200D / U+200C, the case where Safari breaks ZWJ-padded letters. */
export function joinerCheck(root: string): DoctorCheck | null {
  const arabic = projectFonts(root).map((f) => fileCoverage(f)).filter((c): c is Coverage => !!c && c.arabic);
  if (!arabic.length) return null;
  const bad = arabic.filter((c) => !c.joiners), rel = (c: Coverage) => path.relative(root, c.file) || c.file;
  if (!bad.length) return { id: "font-joiners", ok: true, required: false, en: `${arabic.length} Arabic font file(s) in this project map U+200D/U+200C (ZWJ-padded letters stay in the font in Safari)`, ar: `ملفات الخطوط العربية في المشروع تحتوي الواصل الصفري U+200D: ${ar(arabic.length)}` };
  const list = bad.slice(0, 5).map(rel).join(", ") + (bad.length > 5 ? ` (+${bad.length - 5} more)` : "");
  return {
    id: "font-joiners", ok: false, required: false,
    en: `${bad.length} Arabic font file(s) have no U+200D/U+200C: ${list}. In Safari/iOS, a letter padded with ZWJ is drawn in a fallback font (mixed fonts, broken joins). Harakah's runtime shim and <ArabicText> switch to the clip method there; splitArabic() strings, older shims and your own ZWJ code don't`,
    ar: `ملفات خطوط عربية بلا الواصل الصفري U+200D: ${ar(bad.length)}. في Safari يُرسم الحرف المقسوم مع الواصل بخط بديل فتنكسر الكلمة`,
    fix: "Use <ArabicText> or the harakah-fix runtime shim (0.5+) for per-letter motion, or animate per word in Safari; or add the joiners to the font's cmap (OFL allows it; rename the family if the license reserves its name), e.g. fontTools: map U+200D and U+200C to an empty zero-width glyph.",
  };
}

export async function doctor(o: { cwd?: string } = {}): Promise<DoctorCheck[]> {
  const cwd = path.resolve(o.cwd ?? process.cwd());
  const out: DoctorCheck[] = [];

  const node = process.versions.node;
  out.push(atLeast(node, NODE_MIN)
    ? { id: "node", ok: true, required: true, en: `Node ${node}`, ar: `نود ${node}` }
    : { id: "node", ok: false, required: true, en: `Node ${node} is too old (22.12 or newer is needed)`, ar: `نسخة نود ${node} قديمة (المطلوب 22.12 أو أحدث)`, fix: "Install Node 22.12+ from https://nodejs.org (or `nvm install 22`)." });

  const fonts = fs.existsSync(ASSET_FONT_DIR) ? fs.readdirSync(ASSET_FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)) : [];
  out.push(fonts.length
    ? { id: "fonts", ok: true, required: true, en: `${fonts.length} bundled OFL Arabic fonts`, ar: `الخطوط العربية المرفقة برخصة OFL: ${ar(fonts.length)}` }
    : { id: "fonts", ok: false, required: true, en: `Bundled fonts missing (${ASSET_FONT_DIR})`, ar: "الخطوط المرفقة غير موجودة", fix: "Reinstall: npm install -D harakah-fixer" });

  try {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-doctor-w-"));
    fs.rmSync(t, { recursive: true, force: true });
    out.push({ id: "tmp", ok: true, required: true, en: `Temp folder writable (${os.tmpdir()})`, ar: "المجلد المؤقت قابل للكتابة" });
  } catch (e: any) {
    out.push({ id: "tmp", ok: false, required: true, en: `Can't write to the temp folder ${os.tmpdir()}: ${e?.message ?? e}`, ar: "تعذّرت الكتابة في المجلد المؤقت", fix: "Free disk space, or point TMPDIR at a writable folder." });
  }

  const source = process.env.HARAKAH_CHROME ? "HARAKAH_CHROME" : process.env.PUPPETEER_EXECUTABLE_PATH ? "PUPPETEER_EXECUTABLE_PATH" : "auto-detected";
  const chromeFix = "Install Google Chrome or Chromium, or set HARAKAH_CHROME=/path/to/chrome.";
  if (!fs.existsSync(CHROME)) {
    out.push({ id: "chrome", ok: false, required: true, en: `Chrome not found (${source}: ${CHROME}). check and fix still work; compare, audit and gate --layout don't.`, ar: "لم يُعثر على كروم. الفحص والإصلاح يعملان، أما المقارنة والتدقيق فلا.", fix: chromeFix });
  } else {
    try {
      const s = await shapingCheck();
      const joins = s.joined < s.split;
      out.push(joins
        ? { id: "chrome", ok: true, required: true, en: `Chrome starts and joins Arabic (${s.version}; «سلام عليكم»: ${s.joined} ink pieces joined vs ${s.split} split) · ${CHROME}`, ar: `كروم يعمل ويربط الحروف العربية (قطع الحبر في «سلام عليكم»: ${ar(s.joined)} متصلة مقابل ${ar(s.split)} منفصلة)` }
        : { id: "chrome", ok: false, required: true, en: `Chrome starts but doesn't join Arabic letters (${s.joined} pieces joined vs ${s.split} split): renders would be wrong · ${CHROME}`, ar: `كروم يعمل، ولا يربط الحروف العربية (قطع الحبر: ${ar(s.joined)} متصلة مقابل ${ar(s.split)} منفصلة)، فسيظهر الرندر مكسوراً`, fix: "Use a current Google Chrome or Chromium build (HARAKAH_CHROME=…); a stripped build without HarfBuzz shaping can't render Arabic." });
    } catch (e: any) {
      out.push({ id: "chrome", ok: false, required: true, en: `Chrome found but failed to start (${source}: ${CHROME}): ${String(e?.message ?? e).split("\n")[0]}`, ar: "كروم موجود، وفشل تشغيله", fix: `${chromeFix} On Linux servers, install Chrome's system libraries (e.g. \`npx puppeteer browsers install chrome --install-deps\`).` });
    }
  }
  const mode = remotionChromeMode(CHROME);
  out.push({ id: "remotion-mode", ok: true, required: false, en: `Remotion renders will start this Chrome in ${mode === "headless-shell" ? "old headless (chrome-headless-shell)" : "new headless"} mode`, ar: mode === "headless-shell" ? "سيعمل كروم في رندر Remotion بالوضع القديم (chrome-headless-shell)" : "سيعمل كروم في رندر Remotion بوضع headless الجديد" });

  try {
    const v = execFileSync(FFMPEG, ["-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0];
    out.push({ id: "ffmpeg", ok: true, required: false, en: v.replace(/ Copyright.*$/, ""), ar: "ffmpeg موجود" });
  } catch {
    out.push({ id: "ffmpeg", ok: false, required: false, en: `ffmpeg not found (${FFMPEG}): compare can't build its side-by-side image or MP4`, ar: "لم يُعثر على ffmpeg: المقارنة لن تبني الصورة أو الفيديو", fix: "Install ffmpeg (brew install ffmpeg / apt install ffmpeg / winget install ffmpeg), or set HARAKAH_FFMPEG." });
  }

  const pkg = path.join(cwd, "package.json");
  let usesRemotion = false;
  try { const j = JSON.parse(fs.readFileSync(pkg, "utf8")); usesRemotion = !!({ ...j.dependencies, ...j.devDependencies }.remotion); } catch { /* no project here */ }
  const joiners = joinerCheck(cwd);
  if (joiners) out.push(joiners);
  if (usesRemotion) {
    const req = createRequire(pkg);
    const missing = ["remotion", "@remotion/bundler", "@remotion/renderer"].filter((m) => { try { req.resolve(m); return false; } catch { return true; } });
    let version = "";
    try { version = JSON.parse(fs.readFileSync(req.resolve("remotion/package.json"), "utf8")).version; } catch { /* not installed */ }
    out.push(!missing.length
      ? { id: "remotion", ok: true, required: false, en: `Remotion ${version} in this project (bundler and renderer installed)`, ar: `Remotion ${version} مثبت في المشروع` }
      : { id: "remotion", ok: false, required: false, en: `Remotion project, but ${missing.join(", ")} not installed: compare and audit can't bundle it`, ar: "مشروع Remotion ينقصه بعض الحزم", fix: `npm install -D ${missing.join(" ")}` });
  }
  return out;
}

export function formatDoctor(checks: DoctorCheck[]): string {
  const lines = checks.map((c) => `${c.ok ? "✓" : c.required ? "✗" : "!"} ${c.en}\n    ${c.ar}${c.fix ? `\n    → ${c.fix}` : ""}`);
  const bad = checks.filter((c) => !c.ok && c.required).length, warn = checks.filter((c) => !c.ok && !c.required).length;
  lines.push(bad ? `\n${bad} problem(s) to fix before Harakah can render · مشكلات يجب إصلاحها: ${ar(bad)}` : `\nReady${warn ? `, with ${warn} warning(s)` : ""} · جاهز${warn ? ` (تنبيهات: ${ar(warn)})` : ""}`);
  return lines.join("\n");
}
