#!/usr/bin/env python3
"""Site font for harakah.si: Alexandria with U+200D (ZWJ) and U+200C (ZWNJ) mapped to its own empty, zero-advance
glyph (uni200B, the one U+200B already uses).

Why: the per-letter demo pads each letter box with ZWJ. Safari (WebKit) picks one font for a letter + its ZWJ, and when
the font has no cmap entry for U+200D it draws that letter box in a fallback font: the joined word comes out in two
fonts. Chrome shapes ZWJ either way. Only the cmap (and the version string) changes; every other table is copied as is.

  python3 scripts/font-zwj.py assets/fonts/Alexandria.ttf site-src/fonts
"""
import hashlib, os, sys
from fontTools.ttLib import TTFont

src, outdir = sys.argv[1], sys.argv[2]
f = TTFont(src)
zw = f.getBestCmap().get(0x200B)
assert zw and f["glyf"][zw].numberOfContours == 0 and f["hmtx"][zw][0] == 0, "needs an empty zero-width glyph on U+200B"
for t in f["cmap"].tables:
    if t.isUnicode():
        t.cmap[0x200C] = zw
        t.cmap[0x200D] = zw
for rec in f["name"].names:
    if rec.nameID == 5:
        rec.string = rec.toUnicode() + "; Harakah: U+200C/U+200D mapped"
tmp = os.path.join(outdir, ".tmp.ttf")
f.save(tmp)
h = hashlib.sha256(open(tmp, "rb").read()).hexdigest()[:8]
base = os.path.splitext(os.path.basename(src))[0]
for old in os.listdir(outdir):
    if old.startswith(base + "-zwj.") and old.endswith(".ttf"):
        os.remove(os.path.join(outdir, old))
dst = os.path.join(outdir, f"{base}-zwj.{h}.ttf")
os.replace(tmp, dst)
print(dst)
