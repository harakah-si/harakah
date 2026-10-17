// Code points a TrueType/OpenType font maps (cmap formats 4 and 12, Unicode subtables). Used by the site checks:
// every font that draws ZWJ-padded letter boxes must map U+200D and U+200C itself, or Safari draws those boxes in a
// fallback font (WebKit picks one font for a letter and its joiner).
export function cmapCodepoints(buf) {
  buf = Buffer.from(buf);
  const u16 = (o) => buf.readUInt16BE(o), u32 = (o) => buf.readUInt32BE(o);
  let cmap = -1;
  for (let i = 0; i < u16(4); i++) { const r = 12 + i * 16; if (buf.toString("latin1", r, r + 4) === "cmap") cmap = u32(r + 8); }
  const out = new Set();
  if (cmap < 0) return out;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const pid = u16(cmap + 4 + i * 8), eid = u16(cmap + 6 + i * 8), b = cmap + u32(cmap + 8 + i * 8);
    if (!(pid === 0 || (pid === 3 && (eid === 1 || eid === 10)))) continue;
    if (u16(b) === 4) {
      const n = u16(b + 6) / 2, E = b + 14, S = E + n * 2 + 2, D = S + n * 2, R = D + n * 2;
      for (let k = 0; k < n; k++) for (let c = u16(S + k * 2); c <= u16(E + k * 2) && c !== 0xffff; c++) {
        const ro = u16(R + k * 2), gi = ro ? u16(R + k * 2 + ro + (c - u16(S + k * 2)) * 2) : c;
        if (gi && ((ro ? gi + u16(D + k * 2) : c + u16(D + k * 2)) & 0xffff)) out.add(c);
      }
    } else if (u16(b) === 12) {
      for (let k = 0; k < u32(b + 12); k++) { const o = b + 16 + k * 12; for (let c = u32(o); c <= u32(o + 4); c++) out.add(c); }
    }
  }
  return out;
}
export const mapsJoiners = (buf) => { const s = cmapCodepoints(buf); return s.has(0x200d) && s.has(0x200c); };
