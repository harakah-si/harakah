/**
 * Arabic script helpers: detection, Unicode joining types, grapheme clusters,
 * ZWJ padding for per-letter splits, digit classes, reversed-text heuristics.
 */

export const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const ARABIC_LETTER_RE = /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08C9]/;
export const TASHKEEL_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/;
export const WESTERN_DIGIT_RE = /[0-9]/;
export const EASTERN_DIGIT_RE = /[\u0660-\u0669]/; // ٠-٩ (Arabic-Indic, used in Egypt/Gulf)
export const PERSIAN_DIGIT_RE = /[\u06F0-\u06F9]/; // ۰-۹ (Extended Arabic-Indic)
export const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/g;
export const LATIN_RE = /[A-Za-z]/;
export const ZWJ = "\u200D";
export const NBSP = "\u00A0";

export const hasArabic = (s: string | undefined | null) => !!s && ARABIC_RE.test(s);
export const hasArabicLetter = (s: string | undefined | null) => !!s && ARABIC_LETTER_RE.test(s);
export const hasTashkeel = (s: string) => TASHKEEL_RE.test(s);
/**
 * How vocalized a text is. "dense" = fully/mostly vocalized (Quran, poetry, teaching material: ≥ 3 marks on ≥ 15% of
 * letters), where stacked marks need a tall line box. "sparse" = an occasional shadda/tanween/damma for disambiguation,
 * which fits any normal multi-line leading (≥ 1.3) and can't collide with anything on a single line.
 */
export function tashkeelLevel(s: string): "none" | "sparse" | "dense" {
  const marks = (s.match(new RegExp(TASHKEEL_RE.source, "g")) || []).length;
  if (!marks) return "none";
  const letters = (s.match(new RegExp(ARABIC_LETTER_RE.source, "g")) || []).length || 1;
  return marks >= 3 && marks / letters >= 0.15 ? "dense" : "sparse";
}

/**
 * Which Arabic-script language a text is most likely in. Persian uses ی ک (U+06CC/06A9), پ چ ژ گ and ۰-۹;
 * Urdu adds ٹ ڈ ڑ ں ھ ہ ے; Arabic uses ي ك ة ى and ٠-٩. Majority wins, ties go to Arabic.
 */
export function scriptLang(s: string): "ar" | "fa" | "ur" {
  const n = (re: RegExp) => (s.match(re) || []).length;
  const ur = n(/[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2\u06D3]/g);
  const fa = n(/[\u067E\u0686\u0698\u06AF\u06A9\u06CC\u06F0-\u06F9]/g);
  const ar = n(/[\u0629\u0643\u0649\u064A\u0660-\u0669]/g);
  if (ur > 0 && ur + fa > ar) return "ur";
  if (fa > ar) return "fa";
  return "ar";
}
/** lang attribute values for Arabic-script languages (a valid lang="fa" must not be "fixed" to "ar"). */
export const ARABIC_SCRIPT_LANG_RE = /^(ar|fa|ur|ps|ckb|ku|sd|ug|prs|bal|ks|pa-Arab|az-Arab|ms-Arab)\b/i;

/** Unicode Arabic joining types (ArabicShaping.txt, main block subset). */
export type JoinType = "U" | "R" | "D" | "C" | "T";

const R_SET = new Set<number>([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648,
  0x0671, 0x0672, 0x0673, 0x0675, 0x0676, 0x0677, 0x06c0, 0x06c3, 0x06c4, 0x06c5, 0x06c6,
  0x06c7, 0x06c8, 0x06c9, 0x06ca, 0x06cb, 0x06cd, 0x06cf, 0x06d2, 0x06d3, 0x06ee, 0x06ef,
]);
for (let c = 0x0688; c <= 0x0699; c++) R_SET.add(c);
const U_SET = new Set<number>([0x0621, 0x0674, 0x06d5]);

export function joiningType(ch: string): JoinType {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x200d || cp === 0x0640) return "C";
  if (TASHKEEL_RE.test(ch)) return "T";
  if (R_SET.has(cp)) return "R";
  if (U_SET.has(cp)) return "U";
  if ((cp >= 0x0620 && cp <= 0x064a) || (cp >= 0x066e && cp <= 0x06d3) || (cp >= 0x06fa && cp <= 0x06ff) ||
      (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0x08a0 && cp <= 0x08c9)) return "D";
  return "U";
}

/** First / last non-transparent char's joining type in a chunk. */
function edgeType(chunk: string, side: "first" | "last"): JoinType {
  const chars = [...chunk];
  if (side === "last") chars.reverse();
  for (const c of chars) {
    const t = joiningType(c);
    if (t !== "T") return t;
  }
  return "U";
}
const joinsForward = (t: JoinType) => t === "D" || t === "C"; // can connect to the following letter
const joinsBackward = (t: JoinType) => t === "D" || t === "R" || t === "C"; // can connect to the preceding letter

/** Split into grapheme clusters (base + diacritics stay together). */
export function graphemes(s: string): string[] {
  const seg = new Intl.Segmenter("ar", { granularity: "grapheme" });
  return [...seg.segment(s)].map((x) => x.segment);
}

const ALEFS = new Set(["\u0622", "\u0623", "\u0625", "\u0627", "\u0671"]);
const stripZwj = (s: string) => s.replace(/\u200D/g, "");

/** true if part ends with lam and next begins with an alef (mandatory لا ligature). */
export function isLamAlefBoundary(a: string, b: string): boolean {
  const ac = [...stripZwj(a)].filter((c) => joiningType(c) !== "T");
  const bc = [...stripZwj(b)].filter((c) => joiningType(c) !== "T");
  return ac.length > 0 && bc.length > 0 && ac[ac.length - 1] === "\u0644" && ALEFS.has(bc[0]);
}

/**
 * Pad a sequence of rendered chunks (each will become its own box, e.g. an
 * inline-block span) with ZERO WIDTH JOINER so each chunk is shaped in the
 * contextual form it would have in running text.
 */
export function zwjPad(parts: string[]): string[] {
  const clean = parts.map(stripZwj);
  return clean.map((p, i) => {
    if (!hasArabicLetter(p) && !p.includes("\u0640")) return p;
    let out = p;
    const prev = i > 0 ? clean[i - 1] : "";
    const next = i < clean.length - 1 ? clean[i + 1] : "";
    if (prev && joinsForward(edgeType(prev, "last")) && joinsBackward(edgeType(p, "first"))) out = ZWJ + out;
    if (next && joinsForward(edgeType(p, "last")) && joinsBackward(edgeType(next, "first"))) out = out + ZWJ;
    return out;
  });
}

/** Indices i such that parts[i] + parts[i+1] form lam-alef and should be merged. */
export function lamAlefMerges(parts: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < parts.length - 1; i++) if (isLamAlefBoundary(parts[i], parts[i + 1])) out.push(i);
  return out;
}

/** Group single-char parts into words (whitespace/NBSP-only parts separate words). */
export function groupIntoWords(parts: string[]): { start: number; end: number; text: string }[] {
  const words: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; text: string } | null = null;
  parts.forEach((p, i) => {
    const isSpace = /^[\s\u00A0]*$/.test(p);
    if (isSpace) {
      if (cur) { words.push(cur); cur = null; }
      return;
    }
    if (!cur) cur = { start: i, end: i, text: p };
    else { cur.end = i; cur.text += p; }
  });
  if (cur) words.push(cur);
  return words;
}

export type DigitScript = "western" | "eastern" | "persian";
export function digitScripts(s: string): Set<DigitScript> {
  const out = new Set<DigitScript>();
  if (WESTERN_DIGIT_RE.test(s)) out.add("western");
  if (EASTERN_DIGIT_RE.test(s)) out.add("eastern");
  if (PERSIAN_DIGIT_RE.test(s)) out.add("persian");
  return out;
}
/**
 * Normalize digits. `eastern` means the digits native to the text's language: Arabic-Indic ٠-٩ for Arabic,
 * Extended (Persian/Urdu) ۰-۹ for Persian and Urdu text (pass `lang` when `s` is a fragment of a longer text).
 */
export function normalizeDigits(s: string, to: "western" | "eastern", lang: "ar" | "fa" | "ur" = scriptLang(s)): string {
  if (to === "western") {
    return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
            .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
            .replace(/(\d)\u066B(?=\d)/g, "$1.").replace(/(\d)\u066C(?=\d)/g, "$1,").replace(/(\d)\u066A/g, "$1%");
  }
  if (lang !== "ar") {
    return s
      .replace(/(\d)\.(?=\d)/g, "$1\u066B").replace(/(\d),(?=\d{3}\b)/g, "$1\u066C").replace(/(\d)%/g, "$1\u066A")
      .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)))
      .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(0x06f0 + d.charCodeAt(0) - 0x0660))
      .replace(/([\u06F0-\u06F9]),(?=[\u06F0-\u06F9]{3}(?![\u06F0-\u06F9]))/g, "$1\u066C").replace(/([\u06F0-\u06F9])\.(?=[\u06F0-\u06F9])/g, "$1\u066B");
  }
  return s
    // Arabic decimal/thousands separators and percent sign, only between/after digits
    .replace(/(\d)\.(?=\d)/g, "$1\u066B").replace(/(\d),(?=\d{3}\b)/g, "$1\u066C").replace(/(\d)%/g, "$1\u066A")
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String.fromCharCode(0x0660 + d.charCodeAt(0) - 0x06f0))
    // Eastern digits typed with Latin separators ("١,٢٥٠") get the Arabic ones too.
    .replace(/([\u0660-\u0669]),(?=[\u0660-\u0669]{3}(?![\u0660-\u0669]))/g, "$1\u066C").replace(/([\u0660-\u0669])\.(?=[\u0660-\u0669])/g, "$1\u066B");
}

/**
 * Heuristic for Arabic text that was naively reversed (e.g. str.split('').reverse()).
 * Teh marbuta (ة) and alef maksura (ى) never start a word; reversed text starts many words with them.
 * Reversed definite article "ال" shows up as words ending in "لا".
 */
export function reversedScore(text: string): { suspicious: number; words: number; score: number } {
  const words = text.split(/[\s\u00A0.,،؛!?؟:"'()\[\]]+/).filter((w) => hasArabicLetter(w));
  let suspicious = 0;
  for (const w of words) {
    const base = [...w].filter((c) => joiningType(c) !== "T" && c !== ZWJ);
    if (base.length === 0) continue;
    if (base[0] === "\u0629" || base[0] === "\u0649") suspicious += 1;
    else if (base.length >= 5 && base[base.length - 1] === "\u0627" && base[base.length - 2] === "\u0644") suspicious += 0.5;
  }
  return { suspicious, words: words.length, score: words.length ? suspicious / words.length : 0 };
}

/** Latin runs inside Arabic text that benefit from <bdi> isolation. */
export const LATIN_RUN_RE = /[A-Za-z][A-Za-z0-9]*(?:[ .\-\u2010-\u2015_'’+&#@/:]+[A-Za-z0-9]+)*/g;
