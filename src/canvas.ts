/**
 * Arabic drawn outside the DOM: canvas 2D and three.js text. Regex-based, shared by the HTML scan (engine.ts) and the
 * TSX scan (jsx.ts). Verified in Chrome: canvas fillText and troika-three-text shape a whole Arabic string correctly;
 * three.js TextGeometry never does; per-letter drawing breaks both forms and order (canvas fixes it with U+200D padding,
 * troika ignores the padding).
 */

export type LetterDraw = "canvas" | "troika";

// no capture groups: it is spliced into larger patterns
const SPLIT_CALL = String.raw`(?:\.split\(\s*(?:''|""|\x60\x60)\s*\)|\[\s*\.\.\.[^\]]+\]|Array\.from\([^)]*\)|\bsplitText\([^)]*\)\.chars)`;

/** variables holding a string (`const t = "…"`, `el.textContent`) and arrays of single letters (`const cs = t.split("")`) */
function textVars(src: string) {
  const strings = new Set<string>(), letters = new Set<string>();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*([^;\n]+)/g)) {
    const rhs = m[2].trim();
    if (/^(['"\x60])/.test(rhs) || /\.(?:textContent|innerText|dataset\.\w+)\s*$/.test(rhs)) strings.add(m[1]);
    if (new RegExp(`^[\\w$.]*${SPLIT_CALL}`).test(rhs)) letters.add(m[1]);
  }
  return { strings, letters };
}

/** names bound to one letter at a time: `for (const ch of word)`, `[...word].forEach((ch) =>`, `letters.map((ch, i) =>` */
function letterNames(src: string) {
  const { strings, letters } = textVars(src);
  const names = new Set<string>();
  const iterOverLetters = (e: string) => {
    e = e.trim();
    return /^(['"\x60])/.test(e) || strings.has(e) || letters.has(e) || new RegExp(`^[\\w$.]*${SPLIT_CALL}$`).test(e);
  };
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([\w$]+)\s+of\s+([^)]+?)\s*\)/g)) if (iterOverLetters(m[2])) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(`([\\w$.]*${SPLIT_CALL}|\\b[\\w$]+)\\s*\\.(?:forEach|map)\\(\\s*(?:function\\s*)?\\(?\\s*([\\w$]+)`, "g"))) {
    if (new RegExp(SPLIT_CALL).test(m[1]) || letters.has(m[1])) names.add(m[2]);
  }
  // `t[i]`, `t.charAt(i)`, `t.at(i)` on a string variable, or `letters[i]` on a letter array
  const indexed = [...strings, ...letters].map((v) => v.replace(/\$/g, "\\$"));
  return { names, indexed };
}

/** Where Arabic is drawn one letter per call: canvas fillText/strokeText, or one troika Text mesh per letter. */
export function letterDraws(src: string): LetterDraw[] {
  const { names, indexed } = letterNames(src);
  const alts = [...[...names].map((n) => n.replace(/\$/g, "\\$") + "\\b"), String.raw`[\w$.]+\.(?:charAt|at)\(`];
  if (indexed.length) alts.push(String.raw`(?:${indexed.join("|")})\[\s*[\w$]+\s*\]`);
  const letter = `(?:${alts.join("|")})`;
  const out: LetterDraw[] = [];
  if (new RegExp(String.raw`\.(?:fillText|strokeText)\(\s*${letter}`).test(src)) out.push("canvas");
  if (usesTroika(src) && new RegExp(String.raw`\.text\s*=\s*${letter}|\btext=\{\s*${letter}`).test(src)) out.push("troika");
  return out;
}

/** the script also builds DOM letter boxes (so the HTML runtime shim still has work to do) */
export const buildsDom = (src: string) => /createElement\(|\.innerHTML\s*[+]?=|insertAdjacentHTML|\.append(?:Child)?\(|\.textContent\s*=/.test(src);

export const usesTroika = (src: string) => /troika-three-text|@react-three\/drei/.test(src);

/** three.js TextGeometry / font.generateShapes / drei <Text3D>: one glyph per code point, no shaping, no bidi */
export const usesTextGeometry = (src: string) => /\bText(?:Buffer)?Geometry\b|\.generateShapes\s*\(|<Text3D\b/.test(src);

/** troika Text (or drei <Text>) with no font file: troika fetches fallback fonts from cdn.jsdelivr.net while rendering */
export const troikaWithoutFont = (src: string) =>
  usesTroika(src) && /\bnew\s+Text\s*\(|<Text[\s>]/.test(src) && !/\.font\s*=|\bfont=|\bfont\s*:/.test(src);

export const MESSAGES = {
  canvas: {
    en: "Arabic is drawn on the canvas one letter at a time. Each fillText call shapes its letter alone, so every letter shows its isolated form, and placing them left to right reverses the word. Fix: draw whole words with one fillText and ctx.direction = 'rtl'; to animate letters, iterate splitArabic(text) (each letter padded with U+200D) and place them right to left (x -= ctx.measureText(letter).width).",
    ar: "النص العربي يُرسم على Canvas حرفاً حرفاً. كل استدعاء fillText يشكّل حرفه وحده، فيظهر كل حرف منفصلاً، ورصّها من اليسار يعكس الكلمة. الإصلاح: ارسم الكلمة كاملة باستدعاء واحد مع ctx.direction = 'rtl'؛ ولتحريك الحروف استخدم splitArabic(text) (حروف مع واصل صفري U+200D) وضعها من اليمين لليسار (x -= ctx.measureText(letter).width).",
  },
  troika: {
    en: "Arabic letters are rendered as separate troika Text meshes. troika shapes each mesh on its own and ignores U+200D padding, so every letter shows its isolated form. Fix: animate whole words (one Text per word); draw the letters on a canvas texture instead (U+200D padding works there); or give every mesh the whole word and clip it to one letter with clipRect from textRenderInfo.glyphBounds (dots near a cut can be clipped).",
    ar: "حروف النص العربي تُعرض كعناصر troika Text منفصلة. troika يشكّل كل عنصر وحده ويتجاهل الواصل الصفري U+200D، فيظهر كل حرف منفصلاً. الإصلاح: حرّك كلمات كاملة (عنصر Text لكل كلمة)، أو ارسم الحروف على Canvas واستخدمه كخامة (الواصل الصفري يعمل هناك)، أو أعطِ كل عنصر الكلمة كاملة واقصصه على حرف واحد بـ clipRect من textRenderInfo.glyphBounds (قد تُقص النقاط القريبة من الحد).",
  },
  geometry: {
    en: "three.js TextGeometry (drei <Text3D>) draws one glyph per code point with no Arabic shaping and no bidi: the letters render isolated and the word comes out reversed. Nothing in the string can fix that. Fix: use troika-three-text (drei <Text>) with an Arabic font file, or draw the text on a canvas texture with fillText and ctx.direction = 'rtl'.",
    ar: "TextGeometry في three.js (و<Text3D> في drei) يرسم كل حرف برمز منفصل بلا تشكيل عربي ولا اتجاه: تظهر الحروف منفصلة والكلمة معكوسة، ولا يصلحها أي تعديل على النص. الإصلاح: استخدم troika-three-text (<Text> في drei) مع ملف خط عربي، أو ارسم النص على Canvas بـ fillText مع ctx.direction = 'rtl' واستخدمه كخامة.",
  },
  troikaFont: {
    en: "troika-three-text (drei <Text>) renders Arabic with no font file set. troika then downloads fallback fonts from cdn.jsdelivr.net while it renders, so offline or sandboxed renders fail and the font can change between renders. Fix: set font to an Arabic font file you ship, e.g. assets/fonts/IBMPlexSansArabic-Bold.ttf (OFL).",
    ar: "troika-three-text (<Text> في drei) يعرض نصاً عربياً بلا ملف خط محدد، فيحمّل خطوطاً بديلة من cdn.jsdelivr.net أثناء الرندر: يفشل الرندر دون إنترنت وقد يتغير الخط بين رندر وآخر. الإصلاح: حدّد font بملف خط عربي ضمن المشروع، مثل assets/fonts/IBMPlexSansArabic-Bold.ttf (رخصة OFL).",
  },
};
