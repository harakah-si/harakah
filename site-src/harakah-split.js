// Browser port of src/arabic.ts splitArabic(): grapheme clusters, لا kept together, ZWJ padding
// so every chunk keeps the contextual form it has in running text. Never yields isolated forms
// unless you ask for them (isolated() is only used to *show the bug*).
(function (g) {
  const ZWJ = "\u200D";
  const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/;
  const R = new Set([0x622, 0x623, 0x624, 0x625, 0x627, 0x629, 0x62f, 0x630, 0x631, 0x632, 0x648, 0x671]);
  const U = new Set([0x621]);
  const jt = (ch) => { const c = ch.codePointAt(0); if (c === 0x200d || c === 0x640) return "C"; if (TASHKEEL.test(ch)) return "T"; if (R.has(c)) return "R"; if (U.has(c)) return "U"; if (c >= 0x620 && c <= 0x64a) return "D"; return "U"; };
  const edge = (s, last) => { const a = [...s]; if (last) a.reverse(); for (const c of a) { const t = jt(c); if (t !== "T") return t; } return "U"; };
  const fwd = (t) => t === "D" || t === "C", back = (t) => t === "D" || t === "R" || t === "C";
  const seg = new Intl.Segmenter("ar", { granularity: "grapheme" });
  const ALEF = new Set(["\u0622", "\u0623", "\u0625", "\u0627"]);
  function graphemes(s) {
    const out = [...seg.segment(s)].map((x) => x.segment);
    for (let i = 0; i < out.length - 1; i++) { // keep لا as one unit (mandatory ligature)
      const a = [...out[i]].filter((c) => jt(c) !== "T"), b = [...out[i + 1]].filter((c) => jt(c) !== "T");
      if (a.at(-1) === "\u0644" && ALEF.has(b[0])) { out.splice(i, 2, out[i] + out[i + 1]); }
    }
    return out;
  }
  function splitArabic(s) {
    const p = graphemes(s);
    return p.map((x, i) => {
      if (!/[\u0620-\u064A]/.test(x)) return x;
      let o = x;
      if (i > 0 && fwd(edge(p[i - 1], true)) && back(edge(x, false))) o = ZWJ + o;
      if (i < p.length - 1 && fwd(edge(x, true)) && back(edge(p[i + 1], false))) o = o + ZWJ;
      return o;
    });
  }
  g.HZ = { ZWJ, graphemes, splitArabic, isolated: graphemes };
})(window);
