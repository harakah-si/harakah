// A minimal, valid TrueType file whose cmap maps exactly the given code points (all to one empty glyph).
// No outlines, no GSUB: enough for cmap/feature inspection, written by this repo (no third-party font data).
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const cat = (...b: Buffer[]) => Buffer.concat(b);

function cmap4(cps: number[]): Buffer {
  const sorted = [...new Set(cps)].filter((c) => c <= 0xfffe).sort((a, b) => a - b);
  const segs: [number, number][] = [];
  for (const c of sorted) { const l = segs[segs.length - 1]; if (l && l[1] === c - 1) l[1] = c; else segs.push([c, c]); }
  segs.push([0xffff, 0xffff]);
  const n = segs.length;
  // every mapped code point → glyph 1 via idRangeOffset = 0 and idDelta chosen per segment only works for single
  // code points, so use glyphIdArray: each segment points into one shared array of 1s
  const glyphIds: number[] = [];
  const offsets: number[] = [];
  segs.forEach(([s, e], i) => {
    if (s === 0xffff) { offsets.push(0); return; }
    offsets.push((n - i + glyphIds.length) * 2);
    for (let c = s; c <= e; c++) glyphIds.push(1);
  });
  const sub = cat(u16(4), u16(0), u16(0), u16(n * 2), u16(0), u16(0), u16(0),
    ...segs.map((s) => u16(s[1])), u16(0), ...segs.map((s) => u16(s[0])),
    ...segs.map((s) => u16(s[0] === 0xffff ? 1 : 0)), ...offsets.map(u16), ...glyphIds.map(u16));
  sub.writeUInt16BE(sub.length, 2);
  return cat(u16(0), u16(1), u16(3), u16(1), u32(12), sub);
}

function nameTable(family: string): Buffer {
  const str = Buffer.from(family, "utf16le").swap16();
  const rec = (id: number) => cat(u16(3), u16(1), u16(0x409), u16(id), u16(str.length), u16(0));
  return cat(u16(0), u16(2), u16(6 + 12 * 2), rec(1), rec(4), str);
}

export function miniFont(family: string, codepoints: number[]): Buffer {
  const head = cat(u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0), u16(1000), Buffer.alloc(16),
    i16(0), i16(0), i16(0), i16(0), u16(0), u16(8), i16(2), i16(0), i16(0));
  const hhea = cat(u32(0x00010000), i16(800), i16(-200), i16(0), u16(500), i16(0), i16(0), i16(0), i16(1), i16(0), i16(0), Buffer.alloc(8), i16(0), u16(2));
  const maxp = cat(u32(0x00005000), u16(2));
  const hmtx = cat(u16(500), i16(0), u16(500), i16(0));
  const post = cat(u32(0x00030000), Buffer.alloc(28));
  const tables: [string, Buffer][] = ([["cmap", cmap4(codepoints)], ["head", head], ["hhea", hhea], ["hmtx", hmtx], ["maxp", maxp], ["name", nameTable(family)], ["post", post]] as [string, Buffer][]);
  const pad = (b: Buffer) => cat(b, Buffer.alloc((4 - (b.length % 4)) % 4));
  let off = 12 + 16 * tables.length;
  const dir: Buffer[] = [], data: Buffer[] = [];
  for (const [tag, b] of tables) {
    dir.push(cat(Buffer.from(tag, "latin1"), u32(0), u32(off), u32(b.length)));
    const p = pad(b); data.push(p); off += p.length;
  }
  const n = tables.length, es = Math.floor(Math.log2(n));
  return cat(u32(0x00010000), u16(n), u16(16 * 2 ** es), u16(es), u16(16 * n - 16 * 2 ** es), ...dir, ...data);
}

export const LATIN = Array.from({ length: 95 }, (_, i) => 0x20 + i);
export const ARABIC_LETTERS = [...new Set([..."ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي"].map((c) => c.codePointAt(0)!))];
