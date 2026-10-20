/**
 * Real glyph coverage: read a font file's cmap (and GSUB) instead of guessing from its name.
 * Used for custom / unknown families (`@font-face { font-family: "Brand"; src: url(./brand.woff2) }`,
 * Remotion `new FontFace("Saudi", url(staticFile(...)))`): a file that covers the Arabic letters counts
 * as an Arabic font whatever it's called; a file without them is reported even if its name sounds Arabic.
 */
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";

/** The 36 letters every Arabic-script font needs (hamza forms, ta marbuta, alef maqsura included). */
export const CORE_ARABIC = "ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي";
const PRES_FORMS = [0xfe8e, 0xfe91, 0xfe92, 0xfedf, 0xfee0, 0xfeea]; // alef final, beh initial/medial, lam initial/medial, heh final
const FONT_EXT = /\.(?:ttf|otf|woff2?|ttc)$/i;
const MAX_BYTES = 30_000_000;

export interface Coverage {
  family: string;
  /** file path, or "data:" for an embedded font */
  file: string;
  letters: number;
  total: number;
  /** covers (nearly) every core Arabic letter */
  arabic: boolean;
  /** how the letters join: OpenType init/medi/fina for the arab script, legacy presentation forms, or not at all */
  joins: "gsub" | "presentation-forms" | "none";
  missing: string[];
  /** has cmap entries for U+200D ZWJ and U+200C ZWNJ (Safari draws a letter + joiner in a fallback font otherwise) */
  joiners: boolean;
}

const cache = new Map<string, Coverage | null>();

function featuresForArab(font: any): string[] {
  try {
    const gsub = font.GSUB;
    if (!gsub) return [];
    const arab = gsub.scriptList.find((s: any) => s.tag === "arab");
    if (!arab) return [];
    const idx = new Set<number>();
    const add = (ls: any) => ls?.featureIndexes?.forEach((i: number) => idx.add(i));
    add(arab.script.defaultLangSys);
    for (const r of arab.script.langSysRecords ?? []) add(r.langSys);
    return [...idx].map((i) => gsub.featureList[i]?.tag).filter(Boolean);
  } catch { return []; }
}

function measure(font: any, file: string): Coverage {
  const f = font.fonts ? font.fonts[0] : font; // collections: first face
  const missing = [...CORE_ARABIC].filter((ch) => !f.hasGlyphForCodePoint(ch.codePointAt(0)!));
  const letters = CORE_ARABIC.length - missing.length;
  const feats = featuresForArab(f);
  const joins = ["init", "medi", "fina"].every((t) => feats.includes(t)) ? "gsub"
    : PRES_FORMS.filter((c) => f.hasGlyphForCodePoint(c)).length >= 4 ? "presentation-forms" : "none";
  let family = "";
  try { family = String(f.familyName ?? ""); } catch {}
  const joiners = f.hasGlyphForCodePoint(0x200d) && f.hasGlyphForCodePoint(0x200c);
  return { family, file, letters, total: CORE_ARABIC.length, arabic: letters >= CORE_ARABIC.length - 2, joins: letters ? joins : "none", missing, joiners };
}

/** Coverage of a font file on disk (cached by path, size and mtime). null when it isn't a readable font. */
export function fileCoverage(file: string): Coverage | null {
  try {
    if (!FONT_EXT.test(file)) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const key = `${file}:${st.size}:${st.mtimeMs}`;
    if (cache.has(key)) return cache.get(key)!;
    let cov: Coverage | null = null;
    try { cov = measure(fontkit.create(fs.readFileSync(file)), file); } catch { cov = null; }
    cache.set(key, cov);
    return cov;
  } catch { return null; }
}

/** Coverage of a `data:font/...;base64,` URI. */
export function dataUriCoverage(uri: string): Coverage | null {
  const m = uri.match(/^data:[^;,]*(?:;[^;,]*)*;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m || m[1].length > MAX_BYTES * 1.4) return null;
  const key = `data:${m[1].length}:${m[1].slice(0, 64)}:${m[1].slice(-64)}`;
  if (cache.has(key)) return cache.get(key)!;
  let cov: Coverage | null = null;
  try { cov = measure(fontkit.create(Buffer.from(m[1], "base64")), "data:"); } catch { cov = null; }
  cache.set(key, cov);
  return cov;
}

/**
 * The font files an @font-face `src` points at, resolved against `base` (the stylesheet's folder).
 * Remote URLs are never fetched. Root-relative `/fonts/x.woff2` is tried against `base`, `base/public`
 * and the parents of `base` (a site served from a folder above the page).
 */
export function srcCoverage(src: string, base?: string): Coverage[] {
  const out: Coverage[] = [];
  for (const m of src.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const u = m[2].trim();
    if (/^data:/i.test(u)) { const c = dataUriCoverage(u); if (c) out.push(c); continue; }
    if (!base || /^([a-z][\w+.-]*:|\/\/)/i.test(u)) continue; // remote: never fetched
    let p: string;
    try { p = decodeURIComponent(u.split(/[?#]/)[0]); } catch { continue; }
    const cands = p.startsWith("/")
      ? [p, ...[base, path.join(base, "public"), path.dirname(base), path.join(path.dirname(base), "public")].map((b) => path.join(b, p))]
      : [path.resolve(base, p)];
    for (const c of cands) { const cov = fileCoverage(c); if (cov) { out.push(cov); break; } }
  }
  return out;
}

/** Combine the faces of one family (unicode-range subsets, weights): the family covers what any face covers. */
export function mergeCoverage(list: Coverage[]): Coverage | null {
  if (!list.length) return null;
  const best = [...list].sort((a, b) => b.letters - a.letters || (a.joins === "gsub" ? -1 : 1))[0];
  const missing = [...CORE_ARABIC].filter((ch) => list.every((c) => c.missing.includes(ch)));
  const letters = CORE_ARABIC.length - missing.length;
  const joins = list.some((c) => c.joins === "gsub") ? "gsub" : list.some((c) => c.joins === "presentation-forms") ? "presentation-forms" : "none";
  return { ...best, letters, missing, arabic: letters >= CORE_ARABIC.length - 2, joins: letters ? joins : "none" };
}

/** One-line human summary for messages. */
export function describe(c: Coverage, text?: string): string {
  const where = c.file === "data:" ? "the embedded font" : path.basename(c.file);
  if (!c.letters) return `${where} has no Arabic glyphs (0/${c.total} letters in its cmap)`;
  const used = text !== undefined ? missingIn(c, text) : [];
  if (used.length) return `${where} lacks ${used.slice(0, 8).join(" ")} used in this text (${c.letters}/${c.total} Arabic letters)`;
  if (!c.arabic && text === undefined) return `${where} covers only ${c.letters}/${c.total} Arabic letters (missing ${c.missing.slice(0, 8).join(" ")})`;
  if (c.joins === "none") return `${where} has the Arabic letters but no joining forms (no init/medi/fina, no presentation forms): letters will render isolated`;
  return `${where} covers Arabic (${c.letters}/${c.total} letters, joins via ${c.joins === "gsub" ? "OpenType init/medi/fina" : "presentation forms"})`;
}

export interface FamilyCoverage {
  cov: Coverage;
  /** every face of the family was read (no remote or missing files): a negative verdict is trustworthy */
  complete: boolean;
}
/** The faces of one family → merged coverage. `faces` are { src, base } pairs from @font-face rules. */
export function familyCoverage(faces: { src: string; base?: string }[]): FamilyCoverage | null {
  if (!faces.length) return null;
  let complete = true;
  const all: Coverage[] = [];
  for (const f of faces) {
    // a face counts as read when one of its url()s resolved (browsers use the first that loads);
    // remote files and local() names depend on the network / the machine
    const got = srcCoverage(f.src, f.base);
    if (!got.length) complete = false;
    all.push(...got);
  }
  const cov = mergeCoverage(all);
  return cov ? { cov, complete } : null;
}

/** Core letters the text uses that the font lacks. */
export function missingIn(c: Coverage, text: string): string[] {
  return c.missing.filter((ch) => text.includes(ch));
}

/**
 * The file beats the name: verified Arabic (with joining) is Arabic-capable; a complete negative verdict is not.
 * `text` (when known) is what the font has to draw: a font subset to the page's own letters is fine.
 */
export function verifiedClass<C extends string>(byName: C, fc: FamilyCoverage | null | undefined, text?: string): C | "verified-arabic" | "no-arabic" {
  if (!fc || byName === "generic" || byName === "system") return byName;
  const enough = fc.cov.arabic || (text !== undefined && fc.cov.letters > 0 && missingIn(fc.cov, text).length === 0);
  if (enough && fc.cov.joins !== "none") return "verified-arabic";
  if (fc.complete || fc.cov.letters > 0) return "no-arabic"; // partial / non-joining coverage is a real problem even if another face is remote
  return byName;
}
