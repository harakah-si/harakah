# Arabic motion typography · حركة الحروف العربية

How to write Arabic motion graphics that are right the first time. Harakah's gate catches mistakes; this file is
what to do so there are none. Rules marked **(HZxx)** are enforced by `harakah-fix check`. Numbers marked
*(practice)* are starting values from motion and subtitling practice: check them on a real render.

## 1. Split text so letters stay joined

Arabic letters change shape by position (isolated, initial, medial, final). A letter alone in its own box, call or
mesh is shaped alone and shows its isolated form.

| You want | Do | Never |
|---|---|---|
| Per-word motion | Split by words (`SplitText` `type: "words"`, one span per word) | — |
| Per-letter motion, HTML / Remotion | `splitArabic(text)` (each letter padded with U+200D, لا kept as one unit), or `<ArabicText by="letter">` in Remotion | `text.split("")`, `[...text]`, `Array.from(text)`, SplitText / Motion `splitText` `chars` (HZ01, HZ02) |
| Per-letter motion, GSAP SplitText | GSAP's `splitArabicText` helper, or `harakah-fix fix` (adds the runtime shim) | `SplitText.create(el, { type: "chars" })` on Arabic (HZ02) |
| Text on a canvas | One `fillText` per word with `ctx.direction = "rtl"`. Per letter: iterate `splitArabic(text)` and place right to left, `x -= ctx.measureText(letter).width` (verified in Chrome) | `fillText` per raw letter (HZ25) |
| Text in three.js | troika-three-text / drei `<Text>` with an Arabic `.ttf`/`.otf` set as `font` (troika can't read `.woff2`) | `TextGeometry` / drei `<Text3D>` (HZ26: no shaping at all), troika without `font` (HZ27) |
| Per-letter motion in three.js | Animate whole words; or draw letters on a canvas texture (U+200D padding works there); or give each mesh the whole word clipped to one letter (`clipRect` from `textRenderInfo.glyphBounds`; dots near a cut can be clipped) | One troika mesh per raw or U+200D-padded letter: troika ignores the padding (HZ25, verified in Chrome) |

## 2. Direction and order

- `dir="rtl"` and `lang="ar"` on every Arabic container **(HZ03, HZ04)**. In HyperFrames put `dir` on the composition root, not on `<html>` **(HZ05)**.
- Letter and word boxes line up in their parent's direction. Never place them with `left = i × w` or `x = i × w` **(HZ23)**; position from the right, or let `dir="rtl"` lay them out.
- **Motion follows reading order: right to left.** The first letter is the rightmost one: staggers start on the right, wipes and reveals run right to left, entrances come from the right, progress bars and timelines fill right to left.
- Mixed Arabic and Latin on one line: wrap each Latin run in `<bdi>` **(HZ13)**. Lists of Latin items inside Arabic text: one isolated element per item **(HZ22)**. Never reverse strings to "fix" RTL **(HZ15)**.

## 3. Letters in motion

- Joins only meet when neighbouring letters sit on the same baseline. Let letters move apart during an entrance, then **settle together** before the word has to be read.
- Keep each letter in its own column while it moves (spin within about ±10°, little sideways drift). Letters that slide over their neighbours are flagged by the runtime audit **(HZ24 collide)**.
- Two layers of the same word (a ghost and the real letters, a broken and a fixed state): keep each letter over the same letter of the other layer, or fade one out before they cross **(HZ24 layers)**.
- Don't animate `letter-spacing` **(HZ07)**: tracking breaks joins, and Chromium 137+ ignores it between Arabic letters anyway. Animate scale, position or opacity instead.
- No `text-transform`, small caps or italics on Arabic **(HZ08, HZ20)**; most Arabic fonts have no italic and the browser fakes a slant.

## 4. Size, weight and time *(practice)*

At 1080 px (a square or 1080p frame), for feeds watched on phones at a half to a third of that size:
- Main word: glyph body at least **70–90 px**; the alef of a full line at least **90 px**. Arabic needs about **10–20 % more size than Latin** at the same point size.
- Thinnest stroke at least **3–4 px**, i'jam dots at least **10–12 px** across. Prefer Bold/Black or low-contrast display faces; hairline Naskh disappears when compressed.
- Keep bloom and outline blur low enough that dots stay separate from the letter body.
- Line width under about **85 %** of the frame (920 px at 1080).
- Contrast: aim for **7:1** between the letters and the local background; video compression lowers effective contrast.
- Reading time: about **0.3 s per word + 0.5–1 s**. Hold each word **1–1.5 s** while moving less than about 2–5 % of the frame width per second.
- troika: `sdfGlyphSize: 128` for text above about 150 px, so dots and thin strokes keep clean edges.

## 5. Line height and marks

- Line height **1.6–1.8** for Arabic, **1.8** for fully vocalized text, and never tight inside `overflow: hidden` masks: tashkeel and ascenders get clipped **(HZ17)**.
- No `text-align: justify` **(HZ16)** (Chrome doesn't stretch with kashida) and no `word-break: break-all` **(HZ18)**.
- troika's mark placement (harakat) can differ from a browser: compare a frame against a browser render when the text is vocalized.

## 6. Digits

- Eastern digits by default, with ٬ (thousands) and ٫ (decimal): `formatDigits(1250000)` gives `١٬٢٥٠٬٠٠٠`. Never mix ١٢٣ and 123 on one line **(HZ12)**.

## 7. Fonts

- Use fonts that contain Arabic **(HZ09)** and load them with `@font-face` / `loadFont` **(HZ11)**. Harakah ships these OFL fonts in `assets/fonts/`:
  - **Alexandria**: display, titles.
  - **IBM Plex Sans Arabic** (300–700): text, labels, UI; the default fallback.
  - **Readex Pro**, **Cairo**, **Tajawal**: alternatives for display and text.
  - **Noto Naskh Arabic**: editorial and long text; its thin strokes need size.
- **Thmanyah** is never allowed in hosted or cloud renders: its licence forbids redistribution **(HZ10)**. Local renders only, through `local()`.
- WebGL text can't use colour fonts (COLR): use the plain version of a family.

## 8. Before you render

1. `harakah-fix check` after writing the composition; `harakah-fix fix` for what it reports.
2. `harakah-fix gate --layout` before rendering: static rules plus the runtime audit at sampled frames.
3. `harakah-fix audit <file>` when the motion is complex: it renders sampled frames and reports where Arabic letters, words or rows land out of order, with the frames.
4. `harakah-fix compare` when you changed animation code: before and after renders, with a join audit of the title.
