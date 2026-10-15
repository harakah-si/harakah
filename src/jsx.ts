/**
 * Experimental, detect-only scan for Remotion / React (TSX/JSX) compositions.
 * Regex-based: no AST, so it reports likely problems with line numbers and never rewrites code.
 */
import { hasArabic, reversedScore } from "./arabic.js";
import { RULES } from "./rules.js";
import { classify, arabicCapable, parseStack } from "./fonts.js";
import type { Issue } from "./engine.js";
import { letterDraws, usesTextGeometry, troikaWithoutFont, MESSAGES } from "./canvas.js";

export function analyzeJsx(src: string): Issue[] {
  const lines = src.split("\n");
  const issues: Issue[] = [];
  const arabicFile = hasArabic(src);
  if (!arabicFile) return issues;
  const push = (code: string, line: number, en: string, ar: string, severity?: Issue["severity"]) => {
    const m = RULES[code];
    issues.push({ code, name: m.name, severity: severity ?? m.severity, title: m.title, why: m.why, message: { en, ar }, line: line + 1,
      snippet: lines[line].trim().slice(0, 140), fixMode: "none", fixable: false });
  };
  lines.forEach((l, i) => {
    if (/\.split\(\s*(['"`])\1\s*\)|\[\s*\.\.\.\s*[\w$.]+\s*\]\s*\.map|Array\.from\(\s*[\w$.]+\s*\)\s*\.map/.test(l))
      push("HZ02", i, "Character split (split('') / [...str].map) — on Arabic, render words, or pad letters with \\u200D (see harakah runtime shim).", "تقسيم النص إلى حروف — مع العربية قسّم إلى كلمات أو أضف الواصل الصفري \\u200D.");
    else if (/\b(?:SplitText|splitText)\b/.test(l) && /\bchars\b/.test(l))
      push("HZ02", i, "Letter split with SplitText / Motion splitText (chars): on Arabic, split by words, or pad letters with \\u200D (see harakah runtime shim).", "تقسيم النص إلى حروف عبر SplitText أو splitText — مع العربية قسّم إلى كلمات أو أضف الواصل الصفري \\u200D.");
    const ls = l.match(/letterSpacing\s*:\s*([^,}\n]+)/);
    if (ls && !/^\s*(0|['"]0(px|em)?['"]|['"]normal['"])\s*$/.test(ls[1])) push("HZ07", i, `letterSpacing: ${ls[1].trim()} — remove for Arabic text.`, "أزل letterSpacing عن النص العربي.");
    if (/textTransform\s*:\s*['"](uppercase|capitalize)/.test(l)) push("HZ08", i, "textTransform on Arabic has no effect; remove.", "textTransform لا معنى له مع العربية.");
    if (/direction\s*:\s*['"]ltr['"]|dir=["']ltr["']/.test(l)) push("HZ03", i, "Explicit LTR direction in an Arabic composition.", "اتجاه LTR صريح في مشهد عربي.");
    if (/\.reverse\(\)\s*\.join\(/.test(l)) push("HZ15", i, "String reversal — a naive RTL 'fix' that scrambles Arabic.", "عكس النص يفسد العربية.");
    const ff = l.match(/fontFamily\s*:\s*(['"`])([^'"`]+)\1/);
    if (ff) {
      const fams = parseStack(ff[2]);
      if (fams.some((f) => classify(f) === "thmanyah")) push("HZ10", i, "Thmanyah font: local renders only; do not ship it in Remotion Lambda/cloud bundles (redistribution prohibited).", "خط ثمانية: للرندر المحلي فقط ولا يُرفع مع حزمة الرندر السحابي.");
      if (!fams.map(classify).some(arabicCapable)) push("HZ09", i, `fontFamily "${ff[2]}" has no Arabic font; add an OFL Arabic fallback (e.g. IBM Plex Sans Arabic via @remotion/google-fonts).`, `الخط "${ff[2]}" بلا عربي؛ أضف خطاً عربياً بديلاً.`, "info");
    }
    const strs = l.match(/(['"`])([^'"`]*[\u0600-\u06FF][^'"`]*)\1/g) || [];
    for (const s of strs) { const r = reversedScore(s); if (r.suspicious >= 1 && r.score >= 0.25) push("HZ15", i, `String ${s.slice(0, 30)} looks reversed.`, "النص يبدو معكوساً."); }
  });
  // Arabic drawn outside the DOM: canvas letter loops, troika meshes per letter, TextGeometry / drei <Text3D>, troika without a font
  const lineOf = (re: RegExp) => Math.max(0, lines.findIndex((l) => re.test(l)));
  for (const d of letterDraws(src)) push("HZ25", lineOf(d === "canvas" ? /\.(?:fillText|strokeText)\(/ : /\.text\s*=|\btext=\{/), MESSAGES[d].en, MESSAGES[d].ar);
  if (usesTextGeometry(src)) push("HZ26", lineOf(/\bText(?:Buffer)?Geometry\b|\.generateShapes\s*\(|<Text3D\b/), MESSAGES.geometry.en, MESSAGES.geometry.ar);
  if (troikaWithoutFont(src)) push("HZ27", lineOf(/\bnew\s+Text\s*\(|<Text[\s>]/), MESSAGES.troikaFont.en, MESSAGES.troikaFont.ar);
  if (!/direction\s*:\s*['"]rtl['"]|dir=["']rtl["']/.test(src)) push("HZ03", 0, "No direction:'rtl' / dir=\"rtl\" found in a file with Arabic strings.", "لا يوجد direction:'rtl' في ملف يحتوي نصاً عربياً.", "warning");
  return issues;
}
