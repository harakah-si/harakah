// Vendored copy of packages/remotion-arabic/src/index.tsx (kept in sync by test/remotion.test.ts).
/**
 * @harakah/remotion-arabic: joining-aware Arabic text animation for Remotion.
 * حركة للنص العربي في Remotion: تحريك حرفاً حرفاً أو كلمة كلمة مع بقاء الحروف متصلة.
 *
 * Why: `text.split('')` + `display: inline-block` puts every Arabic letter in its own box, so
 * Chrome draws the isolated form of every letter and the word falls apart. `splitArabic()` returns
 * grapheme tokens padded with U+200D ZERO WIDTH JOINER (and keeps لا as one token), so each box
 * shows the contextual form it would have in running text.
 *
 * لماذا: تقسيم النص بـ split('') مع inline-block يضع كل حرف في صندوق مستقل فيظهر بشكله المنفصل.
 * الدالة splitArabic() تعيد الحروف مع واصل صفري (ZWJ) وتُبقي «لا» حرفاً واحداً، فتبقى الكلمة متصلة.
 *
 * Safari / WebKit (the Remotion Player on iPhone, iPad and Mac Safari) draws a letter + ZWJ in a fallback font when
 * the font has no cmap entry for U+200D (Alexandria, IBM Plex Sans Arabic, Cairo, Tajawal…). There, after mount,
 * <ArabicText> switches each Arabic word to the clip method: every letter box shows the whole word, clipped to that
 * letter's slice, so the word is shaped once by the font. Renders (Chromium) keep the ZWJ boxes, unchanged.
 *
 * Self-contained (no dependency on harakah-fix) so it can be vendored as a single file.
 */
import React from "react";
import { continueRender, delayRender, Easing, getRemotionEnvironment, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const ZWJ = "\u200D";
const TRANSPARENT = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/;
const ARABIC_LETTER = /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08C9]/;
const RIGHT_JOINING = new Set([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648, 0x0671, 0x0672, 0x0673,
  0x0675, 0x0676, 0x0677, 0x0688, 0x0689, 0x068a, 0x068b, 0x068c, 0x068d, 0x068e, 0x068f, 0x0690, 0x0691, 0x0692,
  0x0693, 0x0694, 0x0695, 0x0696, 0x0697, 0x0698, 0x0699, 0x06c0, 0x06c3, 0x06c4, 0x06c5, 0x06c6, 0x06c7, 0x06c8,
  0x06c9, 0x06ca, 0x06cb, 0x06cd, 0x06cf, 0x06d2, 0x06d3, 0x06ee, 0x06ef,
]);
const NON_JOINING = new Set([0x0621, 0x0674, 0x06d5]);
const ALEFS = new Set(["\u0622", "\u0623", "\u0625", "\u0627", "\u0671"]);

type Join = "U" | "R" | "D" | "C" | "T";
function joinType(ch: string): Join {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x200d || cp === 0x0640) return "C";
  if (TRANSPARENT.test(ch)) return "T";
  if (RIGHT_JOINING.has(cp)) return "R";
  if (NON_JOINING.has(cp)) return "U";
  return ARABIC_LETTER.test(ch) ? "D" : "U";
}
function edge(s: string, last: boolean): Join {
  const a = Array.from(s.replace(/\u200D/g, ""));
  if (last) a.reverse();
  for (const c of a) { const t = joinType(c); if (t !== "T") return t; }
  return "U";
}
const joinsNext = (t: Join) => t === "D" || t === "C";
const joinsPrev = (t: Join) => t === "D" || t === "R" || t === "C";
const isSpace = (s: string) => /^[\s\u00A0]+$/.test(s);
const bases = (s: string) => Array.from(s.replace(/\u200D/g, "")).filter((c) => joinType(c) !== "T");

declare const process: { env: Record<string, string | undefined> };
let REFERENCE = false;
try {
  // Set REMOTION_HARAKAH_REFERENCE=1 to render running text instead of boxes (used by harakah-fix compare).
  REFERENCE = process.env.REMOTION_HARAKAH_REFERENCE === "1";
} catch {
  REFERENCE = false;
}

function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg("ar", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  // Fallback: attach combining marks to the previous character.
  const out: string[] = [];
  for (const ch of Array.from(text)) {
    if (out.length && (TRANSPARENT.test(ch) || ch === ZWJ)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

export type SplitBy = "letter" | "word";
export interface SplitOptions {
  /** "letter" (default): one token per grapheme, ZWJ-padded. "word": words and space tokens. */
  by?: SplitBy;
}

/**
 * Split text for per-letter / per-word animation without breaking Arabic joins.
 * Drop-in replacement for `text.split('')`, `Array.from(text)`, `[...text]`: spaces stay as " " tokens,
 * diacritics stay attached, لا stays one token, Latin text is returned unchanged (grapheme by grapheme).
 *
 * تقسيم النص للتحريك دون تفكيك الحروف العربية. بديل مباشر لـ split(''): المسافات تبقى عناصر مستقلة،
 * والحركات (التشكيل) ملتصقة بحروفها، و«لا» عنصر واحد، والنص اللاتيني لا يتغير.
 */
export function splitArabic(text: string, options: SplitOptions | SplitBy = {}): string[] {
  const by = typeof options === "string" ? options : options.by ?? "letter";
  const src = String(text ?? "").replace(/\u200D/g, "");
  if (REFERENCE) return [src];
  if (by === "word") return src.split(/([\s\u00A0]+)/).filter((t) => t.length > 0);
  const g = graphemes(src);
  // keep lam + alef together (mandatory ligature)
  const tokens: string[] = [];
  for (const t of g) {
    const prev = tokens[tokens.length - 1];
    if (prev && !isSpace(prev) && !isSpace(t)) {
      const pb = bases(prev), tb = bases(t);
      if (pb.length === 1 && pb[0] === "\u0644" && tb.length === 1 && ALEFS.has(tb[0])) { tokens[tokens.length - 1] = prev + t; continue; }
    }
    tokens.push(t);
  }
  return tokens.map((t, i) => {
    if (isSpace(t) || !(ARABIC_LETTER.test(t) || t.includes("\u0640"))) return t;
    const prev = i > 0 ? tokens[i - 1] : "";
    const next = i < tokens.length - 1 ? tokens[i + 1] : "";
    let out = t;
    if (prev && !isSpace(prev) && joinsNext(edge(prev, true)) && joinsPrev(edge(t, false))) out = ZWJ + out;
    if (next && !isSpace(next) && joinsNext(edge(t, true)) && joinsPrev(edge(next, false))) out = out + ZWJ;
    return out;
  });
}

export type DigitStyle = "eastern" | "western" | "keep";
const LATIN_RUN = /[A-Za-z][A-Za-z0-9]*(?:[ .\-_'’+&#@/:]+[A-Za-z0-9]+)*/g;

/**
 * Format a number or normalize digits in a string. eastern → ١٢٣ (with ٫ ٬ ٪), western → 123.
 * Latin runs such as "iPhone 17" are left untouched.
 *
 * تنسيق الأرقام: مشرقية ١٢٣ (افتراضياً) أو غربية 123، مع ترك الكلمات اللاتينية مثل iPhone 17 كما هي.
 */
export function formatDigits(value: number | string, digits: DigitStyle = "eastern", options: Intl.NumberFormatOptions = {}): string {
  // Numbers are formatted with Latin digits first and then mapped, so the result never depends on the
  // renderer's ICU/CLDR data: eastern always uses ٬ (U+066C) for grouping and ٫ (U+066B) for decimals.
  // نُنسّق بالأرقام اللاتينية ثم نحوّلها، فتكون الفاصلة دائماً ٬ والفاصلة العشرية ٫ مهما كانت بيانات المتصفح.
  if (typeof value === "number") {
    const latin = new Intl.NumberFormat("en-US", options).format(value);
    if (digits === "keep" || digits === "western") return latin;
    return toEastern(latin);
  }
  if (digits === "keep") return value;
  const conv = (s: string) => (digits === "eastern" ? toEastern(s, true) : toWestern(s));
  let out = "", last = 0;
  for (const m of value.matchAll(LATIN_RUN)) { out += conv(value.slice(last, m.index)) + m[0]; last = (m.index ?? 0) + m[0].length; }
  return out + conv(value.slice(last));
}

function toEastern(s: string, loose = false): string {
  // In free text only "1,234" style groups count as thousands; in formatted numbers every comma does.
  const group = loose ? /(\d),(?=\d{3}(?!\d))/g : /(\d),(?=\d)/g;
  return s
    .replace(/(\d)\.(?=\d)/g, "$1\u066B")
    .replace(group, "$1\u066C")
    .replace(/(\d)\s?%/g, "$1\u066A")
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)))
    // Eastern digits typed with Latin separators ("١,٢٥٠") get the Arabic ones too.
    .replace(/([\u0660-\u0669]),(?=[\u0660-\u0669]{3}(?![\u0660-\u0669]))/g, "$1\u066C").replace(/([\u0660-\u0669])\.(?=[\u0660-\u0669])/g, "$1\u066B");
}

function toWestern(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".").replace(/\u066C/g, ",").replace(/\u066A/g, "%");
}

const PLEX_ARABIC: Record<number, string> = {
  400: "https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3CZRtWPQCuHme67tEYUIx3Kh0PHR9N6Ys43PWrfQ.woff2",
  600: "https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YPi-OCRXMR5Kw.woff2",
  700: "https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YOG-eCRXMR5Kw.woff2",
};
/** Font family that only covers ٪ ٫ ٬ (U+066A–U+066C). اسم الخط الذي يغطي ٪ ٫ ٬ فقط. */
export const ARABIC_SEPARATORS_FAMILY = "Harakah Arabic Separators";
let separatorsRegistered = false;

/**
 * Some display faces (notably Alexandria) draw the Arabic separators ٬ ٫ with the Latin comma glyph,
 * so "١٬٢٥٠٬٠٠٠" looks like "١,٢٥٠,٠٠٠". Wrap the loader: the returned fontFamily puts a tiny
 * unicode-range face (IBM Plex Sans Arabic, OFL) first, so only U+066A–U+066C change; every other
 * glyph still comes from the original font. Works regardless of font load order.
 *
 * بعض خطوط العناوين (مثل Alexandria) ترسم الفواصل العربية ٬ ٫ بشكل الفاصلة اللاتينية. غلّف
 * loadFont() بهذه الدالة فتُرسم هذه الرموز فقط من IBM Plex Sans Arabic ويبقى باقي النص بالخط الأصلي.
 *
 * @example const { fontFamily } = withArabicSeparators(loadFont("normal", { weights: ["800"], subsets: ["arabic"] }));
 */
export function withArabicSeparators<T extends { fontFamily: string }>(loaded: T, opts: { src?: (weight: 400 | 600 | 700) => string } = {}): T {
  registerArabicSeparators(opts.src);
  return { ...loaded, fontFamily: `"${ARABIC_SEPARATORS_FAMILY}", ${loaded.fontFamily}` };
}

/** Register the separator-only face (idempotent). تسجيل خط الفواصل مرة واحدة. */
export function registerArabicSeparators(src: (weight: 400 | 600 | 700) => string = (w) => PLEX_ARABIC[w]): void {
  if (separatorsRegistered || typeof document === "undefined" || typeof FontFace === "undefined") return;
  separatorsRegistered = true;
  const handle = delayRender("harakah: Arabic separators (IBM Plex Sans Arabic)");
  const ranges: [400 | 600 | 700, string][] = [[400, "1 450"], [600, "451 650"], [700, "651 1000"]];
  const faces = ranges.map(([w, weight]) => new FontFace(ARABIC_SEPARATORS_FAMILY, `url(${src(w)}) format("woff2")`, { weight, unicodeRange: "U+066A-066C" }));
  faces.forEach((f) => (document.fonts as unknown as { add(face: FontFace): void }).add(f));
  Promise.all(faces.map((f) => f.load())).then(() => continueRender(handle), () => continueRender(handle));
}

/**
 * Wrap Latin/number runs inside Arabic text in Unicode isolates (FSI … PDI) so punctuation stays put.
 * عزل الكلمات اللاتينية داخل النص العربي حتى لا تنتقل علامات الترقيم إلى الجهة الخاطئة.
 */
export function isolateLatin(text: string): string {
  return text.replace(/\u2068|\u2069/g, "").replace(LATIN_RUN, (m) => `\u2068${m}\u2069`);
}

/**
 * Keep words together when animating per letter: groups `splitArabic()` tokens into words and wraps each
 * word in a nowrap inline-block box, so lines break only between words, never mid-word. Your render
 * callback is called unchanged with the original token and its global index (stagger timing is kept);
 * space tokens are rendered between the word boxes.
 *   {mapArabicWords(splitArabic(title), (ch, i) => <span key={i} style={…}>{ch}</span>)}
 * أبقِ حروف الكلمة معاً: يلتف السطر بين الكلمات فقط، مع الحفاظ على ترتيب الحروف وتوقيتها.
 */
export function mapArabicWords(tokens: readonly string[], render: (token: string, index: number) => React.ReactNode, wordStyle?: React.CSSProperties): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let word: React.ReactNode[] = [];
  let start = 0;
  const flush = () => {
    if (!word.length) return;
    out.push(<span key={`harakah-w${start}`} style={{ display: "inline-block", whiteSpace: "nowrap", ...wordStyle }}>{word}</span>);
    word = [];
  };
  tokens.forEach((t, i) => {
    if (/^[\s\u00A0]+$/.test(t)) { flush(); out.push(<React.Fragment key={`harakah-s${i}`}>{render(t, i)}</React.Fragment>); return; }
    if (!word.length) start = i;
    word.push(<React.Fragment key={`harakah-t${i}`}>{render(t, i)}</React.Fragment>);
  });
  flush();
  return out;
}

export type Preset = "rise" | "fade" | "blur" | "scale";
export interface ArabicTextProps {
  /** The text. النص. */
  text: string;
  /** Animate per letter (default) or per word. حرفاً حرفاً أو كلمة كلمة. */
  by?: SplitBy;
  /** Frames before the first token starts. التأخير قبل أول عنصر (بالإطارات). */
  delay?: number;
  /** Frames between tokens. الفاصل بين العناصر (بالإطارات). */
  stagger?: number;
  /** Frames each token takes to arrive. مدة دخول كل عنصر. */
  duration?: number;
  /** Built-in motion preset. نمط الحركة الجاهز. */
  preset?: Preset;
  /** Custom per-token style from progress 0→1. نمط مخصص حسب التقدم من ٠ إلى ١. */
  animate?: (progress: number, index: number, token: string) => React.CSSProperties;
  /** Use a spring instead of an eased curve. استخدام spring بدلاً من منحنى. */
  springy?: boolean;
  /** Digit policy applied to the text (default eastern). نظام الأرقام (افتراضياً مشرقية). */
  digits?: DigitStyle;
  style?: React.CSSProperties;
  tokenStyle?: React.CSSProperties;
  className?: string;
  as?: "div" | "h1" | "h2" | "h3" | "p" | "span";
  /**
   * How letter boxes keep their joins. "auto" (default): ZWJ padding, and in Safari/WebKit outside a render the
   * clip method (the whole word in every box, clipped to the letter's slice), which works with fonts that have no
   * U+200D. "zwj" / "clip" force one. طريقة وصل الحروف: تلقائي (الافتراضي)، أو zwj، أو clip.
   */
  joinMode?: JoinMode;
}
export type JoinMode = "auto" | "zwj" | "clip";

/** Safari / WebKit, where a letter + ZWJ is drawn in a fallback font if the font has no U+200D. */
export function needsClipJoin(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent || ""): boolean {
  return /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|Edg|OPR|Android)\//.test(ua);
}

type Slice = { s: number; e: number; W: number; pl: number; pt: number };
const PURE_ARABIC = /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08C9\u0640]+$/;
const FONT_PROPS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariationSettings", "fontFeatureSettings", "fontKerning", "fontVariantLigatures", "fontVariantNumeric", "fontSynthesis", "fontOpticalSizing", "letterSpacing", "wordSpacing", "textRendering"] as const;
const SR_ONLY: React.CSSProperties = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap", border: 0 };

// Measure each token's slice of the plain word (Range on a hidden copy with the token box's computed font), tiled at
// the midpoints between neighbouring glyph runs so the slices recompose the word exactly.
function measureWord(first: HTMLElement, toks: string[]): Slice[] | null {
  const word = toks.join("");
  const m = document.createElement("span");
  m.setAttribute("aria-hidden", "true");
  m.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;z-index:-1;white-space:pre;direction:rtl;unicode-bidi:isolate;pointer-events:none;padding:0;border:0;margin:0;transform:none";
  const cs = getComputedStyle(first);
  for (const k of FONT_PROPS) try { (m.style as unknown as Record<string, string>)[k] = (cs as unknown as Record<string, string>)[k]; } catch { /* unsupported */ }
  m.lang = "ar";
  m.textContent = word;
  document.body.appendChild(m);
  try {
    const t = m.firstChild as Text, mr = m.getBoundingClientRect(), W = mr.width, r = document.createRange();
    if (!(W > 0)) return null;
    let o = 0;
    const sl: { i: number; l: number; r: number }[] = [];
    for (let i = 0; i < toks.length; i++) {
      r.setStart(t, o); r.setEnd(t, o + toks[i].length); o += toks[i].length;
      const b = r.getBoundingClientRect();
      if (!(b.width > 0)) return null;
      sl.push({ i, l: b.left - mr.left, r: b.right - mr.left });
    }
    const byX = [...sl].sort((a, b) => a.l - b.l), out: Slice[] = new Array(toks.length);
    const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
    byX.forEach((q, n) => {
      const s = n ? (byX[n - 1].r + q.l) / 2 : 0, e = n < byX.length - 1 ? (q.r + byX[n + 1].l) / 2 : W;
      out[q.i] = { s, e, W, pl, pt };
    });
    return out;
  } finally { m.remove(); }
}

const PRESETS: Record<Preset, (p: number) => React.CSSProperties> = {
  rise: (p) => ({ opacity: p, transform: `translateY(${((1 - p) * 0.45).toFixed(4)}em)` }),
  fade: (p) => ({ opacity: p }),
  blur: (p) => ({ opacity: p, filter: `blur(${((1 - p) * 10).toFixed(2)}px)` }),
  scale: (p) => ({ opacity: p, transform: `scale(${(0.85 + 0.15 * p).toFixed(4)})` }),
};

/**
 * Drop-in animated Arabic text: RTL, lang="ar", joined letters, staggered motion.
 * مكوّن نص عربي متحرك: اتجاه من اليمين، lang="ar"، حروف متصلة، وحركة متتابعة.
 *
 * @example <ArabicText text="صناعة المحتوى العربي" preset="rise" stagger={2} />
 */
export const ArabicText: React.FC<ArabicTextProps> = ({
  text, by = "letter", delay = 0, stagger, duration = 18, preset = "rise", animate, springy = false,
  digits = "eastern", style, tokenStyle, className, as = "div", joinMode = "auto",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tokens = splitArabic(digits === "keep" ? text : formatDigits(text, digits), by);
  const gap = stagger ?? (by === "letter" ? 2 : 5);
  const Tag = as as React.ElementType;
  // Group letter tokens into words: each word is a nowrap box, so lines only break at spaces
  // (per-letter inline-blocks would otherwise allow a break between any two letters).
  const words: { tokens: string[]; start: number }[] = [];
  const parts: (string | number)[] = []; // " " for spaces, index into words otherwise
  tokens.forEach((t, i) => {
    if (/^[\s\u00A0]+$/.test(t)) { parts.push(" "); return; }
    const last = parts[parts.length - 1];
    if (typeof last === "number") words[last].tokens.push(t);
    else { words.push({ tokens: [t], start: i }); parts.push(words.length - 1); }
  });
  let n = 0;
  const single = tokens.length === 1;
  // Clip method (Safari/WebKit): decided after mount, so server output, the first paint and renders stay ZWJ boxes.
  const root = React.useRef<HTMLElement | null>(null);
  const [clip, setClip] = React.useState(false);
  const [slices, setSlices] = React.useState<Record<number, Slice[]>>({});
  const [epoch, setEpoch] = React.useState(0);
  const clipWords = by === "letter" && !single ? words.map((w, wi) => (w.tokens.length >= 2 && PURE_ARABIC.test(w.tokens.join("").replace(/\u200D/g, "")) ? wi : -1)).filter((wi) => wi >= 0) : [];
  const fontKey = [style, tokenStyle].map((x) => (x ? [x.fontFamily, x.fontSize, x.fontWeight, x.fontStyle, x.letterSpacing, x.fontVariationSettings, x.fontFeatureSettings].join("|") : "")).join("/");
  const textKey = words.map((w) => w.tokens.join("")).join(" ");
  React.useLayoutEffect(() => {
    const on = joinMode === "clip" || (joinMode === "auto" && needsClipJoin() && !getRemotionEnvironment().isRendering);
    setClip(on);
    if (!on) return;
    const bump = () => setEpoch((e) => e + 1);
    const fonts = typeof document !== "undefined" ? (document.fonts as unknown as EventTarget & { ready?: Promise<unknown> }) : null;
    fonts?.addEventListener?.("loadingdone", bump);
    fonts?.ready?.then(bump, () => {});
    window.addEventListener("resize", bump);
    return () => { fonts?.removeEventListener?.("loadingdone", bump); window.removeEventListener("resize", bump); };
  }, [joinMode]);
  React.useLayoutEffect(() => {
    if (!clip || !root.current || !clipWords.length) { if (Object.keys(slices).length) setSlices({}); return; }
    const next: Record<number, Slice[]> = {};
    for (const wi of clipWords) {
      const first = root.current.querySelector(`[data-hz-word="${wi}"] > [data-hz-tok]`) as HTMLElement | null;
      const sl = first && measureWord(first, words[wi].tokens.map((t) => t.replace(/\u200D/g, "")));
      if (sl) next[wi] = sl;
    }
    if (JSON.stringify(next) !== JSON.stringify(slices)) setSlices(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, textKey, fontKey, epoch]);
  return (
    <Tag ref={root} dir="rtl" lang="ar" className={className} style={{ direction: "rtl", ...style }}>
      {parts.map((part, pi) => {
        if (part === " ") return <React.Fragment key={`s${pi}`}>{" "}</React.Fragment>;
        const wi = part as number, w = words[wi], sl = clip ? slices[wi] : undefined;
        const word = sl ? w.tokens.join("").replace(/\u200D/g, "") : "";
        const inner = w.tokens.map((t, k) => {
          const local = frame - delay - n++ * gap;
          const p = springy
            ? spring({ frame: local, fps, durationInFrames: duration, config: { damping: 200 } })
            : interpolate(local, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
          const motion = animate ? animate(p, w.start + k, t) : PRESETS[preset](p);
          if (sl) {
            // the box keeps the letter's slice width; a hidden strut holds the line height and baseline, and the
            // whole word (aria-hidden) is offset and clipped to the slice; the first box carries the readable copy
            const q = sl[k], plain = t.replace(/\u200D/g, ""), pad = "-0.8em", last = q.e >= q.W - 0.01, firstX = q.s <= 0.01;
            const inset = `inset(${pad} ${last ? pad : `${q.W - q.e}px`} ${pad} ${firstX ? pad : `${q.s}px`})`;
            return (
              <span key={k} data-hz-tok="" style={{ display: "inline-block", whiteSpace: "pre", ...tokenStyle, ...motion, position: "relative", boxSizing: "content-box", width: q.e - q.s }}>
                <span aria-hidden="true" style={{ display: "inline", visibility: "hidden" }}>{plain}</span>
                <span aria-hidden="true" style={{ display: "inline", position: "absolute", left: q.pl - q.s, top: q.pt, width: q.W, whiteSpace: "pre", direction: "rtl", unicodeBidi: "isolate", pointerEvents: "none", userSelect: "none", WebkitUserSelect: "none", margin: 0, padding: 0, border: 0, clipPath: inset, WebkitClipPath: inset }}>{word}</span>
                {k === 0 ? <span style={SR_ONLY}>{word}</span> : null}
              </span>
            );
          }
          return (
            <span key={k} data-hz-tok="" style={{ display: "inline-block", whiteSpace: single ? "normal" : "pre", ...tokenStyle, ...motion }}>
              {t}
            </span>
          );
        });
        return single || w.tokens.length === 1 ? <React.Fragment key={`w${pi}`}>{inner}</React.Fragment> : <span key={`w${pi}`} data-hz-word={wi} style={{ display: "inline-block", whiteSpace: "nowrap" }}>{inner}</span>;
      })}
    </Tag>
  );
};
