/** Font knowledge base: Arabic coverage + licensing. Names are compared lowercase, quotes stripped. */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ASSET_FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

export interface BundledFont {
  family: string;
  key: string;
  faces: { file: string; weight: string; style?: string }[];
  license: "OFL-1.1";
}
/** Only SIL OFL fonts are bundled. Thmanyah is never bundled (redistribution prohibited). */
export const BUNDLED: Record<string, BundledFont> = {
  // Default text face: humanist-grotesque, editorial, pairs natively with IBM Plex Sans Latin.
  plex: {
    family: "IBM Plex Sans Arabic", key: "plex",
    faces: [
      { file: "IBMPlexSansArabic-Light.ttf", weight: "300" }, { file: "IBMPlexSansArabic-Regular.ttf", weight: "400" },
      { file: "IBMPlexSansArabic-Medium.ttf", weight: "500" }, { file: "IBMPlexSansArabic-SemiBold.ttf", weight: "600" },
      { file: "IBMPlexSansArabic-Bold.ttf", weight: "700" },
    ],
    license: "OFL-1.1",
  },
  // Default display face: contemporary geometric, heavy weights hold up in motion titles.
  alexandria: { family: "Alexandria", key: "alexandria", faces: [{ file: "Alexandria.ttf", weight: "100 900" }], license: "OFL-1.1" },
  readex: { family: "Readex Pro", key: "readex", faces: [{ file: "ReadexPro.ttf", weight: "160 700" }], license: "OFL-1.1" },
  cairo: { family: "Cairo", key: "cairo", faces: [{ file: "Cairo.ttf", weight: "200 1000" }], license: "OFL-1.1" },
  tajawal: {
    family: "Tajawal", key: "tajawal",
    faces: [{ file: "Tajawal-Regular.ttf", weight: "400" }, { file: "Tajawal-Bold.ttf", weight: "700" }],
    license: "OFL-1.1",
  },
  naskh: { family: "Noto Naskh Arabic", key: "naskh", faces: [{ file: "NotoNaskhArabic.ttf", weight: "400 700" }], license: "OFL-1.1" },
};
export type FontKey = "plex" | "alexandria" | "readex" | "cairo" | "tajawal" | "naskh";
export const bundledByFamily = (fam: string) =>
  Object.values(BUNDLED).find((b) => b.family.toLowerCase() === norm(fam));

/** Families known to include Arabic glyphs (OFL / Google Fonts unless noted). */
export const ARABIC_OFL = new Set([
  "cairo", "tajawal", "ibm plex sans arabic", "noto sans arabic", "noto naskh arabic", "noto kufi arabic",
  "noto nastaliq urdu", "amiri", "amiri quran", "almarai", "changa", "el messiri", "harmattan", "lalezar",
  "lateef", "markazi text", "mada", "reem kufi", "reem kufi fun", "reem kufi ink", "scheherazade new",
  "readex pro", "baloo bhaijaan 2", "alexandria", "vazirmatn", "lemonada", "aref ruqaa", "aref ruqaa ink",
  "kufam", "marhey", "gulzar", "blaka", "blaka hollow", "blaka ink", "rakkas", "mirza", "katibeh", "jomhuria",
  "vibes", "qahiri", "zain", "playpen sans arabic", "ruwudu", "beiruti",
  "handjet", "badeen display", "estedad", "sahel",
  // aliases and close relatives people actually type
  "ibm plex arabic", "plex arabic", "ibm plex sans arabic text", "readex", "cairo play", "alexandria variable",
  "readex pro variable", "cairo variable", "tajawal variable", "noto sans arabic ui", "noto naskh arabic ui",
  "noto sans arabic variable", "scheherazade", "alkalami", "vazir", "vazirmatn variable", "shabnam",
  "samim", "tanha", "parastoo", "lalezar variable", "almarai variable", "el messiri variable",
  "changa variable", "markazi text variable", "reem kufi variable", "noto kufi arabic variable", "kufam variable",
]);
/** Name patterns that always mean Arabic coverage (every Noto family with "Arabic" in its name ships it). */
export const ARABIC_PATTERNS: RegExp[] = [
  /^noto\b.*\barabic\b/,          // Noto Sans Arabic, Noto Naskh Arabic UI, Noto Kufi Arabic …
  /^ibm plex\b.*\barabic\b/,      // IBM Plex Sans Arabic, IBM Plex Arabic …
  /^(?:alexandria|readex pro|cairo|tajawal|almarai|vazirmatn)(?:\s+(?:variable|vf|\d{3}|light|regular|medium|semibold|bold|black|extrabold|extralight|thin))+$/,
];

/** Arabic-capable but not OFL: licensing must be checked by the user. */
export const ARABIC_PROPRIETARY: Record<string, string> = {
  "thmanyah sans": "thmanyah", "thmanyah serif display": "thmanyah", "thmanyah serif text": "thmanyah",
  "thmanyah": "thmanyah", "thmanyahsans": "thmanyah", "thmanyah serif": "thmanyah",
  "29lt bukra": "commercial", "29lt zarid": "commercial", "29lt azer": "commercial", "bukra": "commercial",
  "din next lt arabic": "commercial", "din next arabic": "commercial", "ge ss two": "commercial", "ge ss": "commercial",
  "ge ss text": "commercial", "ge dinar one": "commercial", "helvetica neue arabic": "commercial", "neue haas arabic": "commercial",
  "frutiger arabic": "commercial", "sst arabic": "commercial", "effra arabic": "commercial", "avenir arabic": "commercial",
  "univers next arabic": "commercial", "myriad arabic": "commercial", "adobe arabic": "commercial", "lyon arabic": "commercial",
  "dubai": "custom-free", "sakkal majalla": "system", "traditional arabic": "system", "simplified arabic": "system",
  "arial": "system", "tahoma": "system", "segoe ui": "system", "times new roman": "system", "geeza pro": "system",
  "sf arabic": "system", "al nile": "system", "baghdad": "system", "damascus": "system", "kufistandardgk": "system",
};

/** Popular display/UI families with NO Arabic glyphs: Arabic will fall back to whatever the render box has. */
export const LATIN_ONLY = new Set([
  "inter", "inter tight", "montserrat", "poppins", "roboto", "roboto condensed", "roboto mono", "open sans", "lato",
  "oswald", "raleway", "playfair display", "bebas neue", "anton", "helvetica", "helvetica neue", "futura", "gotham",
  "sf pro", "sf pro display", "sf pro text", "dm sans", "dm serif display", "space grotesk", "manrope", "archivo",
  "archivo black", "work sans", "nunito", "nunito sans", "outfit", "plus jakarta sans", "sora", "syne", "unbounded",
  "geist", "geist mono", "jetbrains mono", "fira code", "fira sans", "space mono", "ibm plex sans", "ibm plex mono",
  "ibm plex serif", "barlow", "barlow condensed", "merriweather", "lora", "pt sans", "pt serif", "source sans pro",
  "source sans 3", "source code pro", "league spartan", "josefin sans", "quicksand", "karla", "mulish", "urbanist",
  "lexend", "figtree", "satoshi", "general sans", "clash display", "cabinet grotesk", "neue montreal", "instrument sans",
  "instrument serif", "fraunces", "bricolage grotesque", "onest", "red hat display", "red hat text", "epilogue",
  "chivo", "rethink sans", "hanken grotesk", "be vietnam pro", "albert sans", "public sans", "familjen grotesk",
  "monument extended", "druk", "druk wide", "akira expanded", "eurostile", "proxima nova", "avenir", "avenir next",
  "gilroy", "circular", "aeonik", "graphik", "courier new", "consolas", "menlo", "monaco",
]);
export const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
  "ui-serif", "ui-monospace", "ui-rounded", "-apple-system", "blinkmacsystemfont", "emoji", "math", "fangsong", "inherit", "initial", "unset"]);

export function norm(f: string): string {
  return f.trim().replace(/^['"]|['"]$/g, "").trim().toLowerCase();
}
// a `font` shorthand prefix leaking into a family name: `120px/1.3 "Alexandria"`, `700 calc(…)/1 Cairo`
const SHORTHAND_PREFIX = /^(?:(?:normal|italic|oblique|small-caps|bold|bolder|lighter|\d{3})\s+)*(?:[\d.]+(?:px|em|rem|pt|%|vw|vh)|(?:calc|clamp|min|max)\(.*\))(?:\s*\/\s*\S+)?\s+(?=\S)/i;
export function parseStack(v: string): string[] {
  const parts = v.split(",");
  if (parts.length) parts[0] = parts[0].trim().replace(SHORTHAND_PREFIX, "");
  return parts.map(norm).filter(Boolean);
}
export type FontClass = "arabic-ofl" | "thmanyah" | "commercial" | "custom-free" | "system" | "latin-only" | "generic" | "unknown"
  /** from the font file itself (cmap + GSUB, see glyphs.ts) */
  | "verified-arabic" | "no-arabic";
export function classify(fam: string): FontClass {
  const f = norm(fam);
  if (GENERIC.has(f)) return "generic";
  if (ARABIC_OFL.has(f) || ARABIC_PATTERNS.some((r) => r.test(f))) return "arabic-ofl";
  if (f.startsWith("thmanyah")) return "thmanyah";
  const p = ARABIC_PROPRIETARY[f];
  if (p) return p as FontClass;
  if (LATIN_ONLY.has(f)) return "latin-only";
  return "unknown";
}
export const arabicCapable = (c: FontClass) => c === "verified-arabic" || c === "arabic-ofl" || c === "thmanyah" || c === "commercial" || c === "custom-free" || c === "system";
