# @harakah/remotion-arabic

Joining-aware Arabic text animation for Remotion. Private, not published.
تحريك النص العربي في Remotion حرفاً حرفاً أو كلمة كلمة مع بقاء الحروف متصلة.

- `splitArabic(text, "letter" | "word")`: drop-in for `text.split("")` / `[...text]` / `Array.from(text)`. It returns ZWJ-padded grapheme tokens with لا kept as one token, tashkeel attached, and spaces as `" "`.
- `mapArabicWords(splitArabic(text), (ch, i) => <span key={i}>…</span>)`: keeps words together when you animate per letter. Each word goes in a nowrap box, so wrapped lines never break mid-word. Your callback runs unchanged with the original global index, so the stagger is kept. `harakah-fix fix --wrap-words` writes this for you.
- `<ArabicText text="…" preset="rise" />`: renders with RTL and `lang="ar"`, staggered per letter or per word. Words sit in nowrap boxes so lines never break mid-word.
  - Safari / WebKit (the Player on iPhone, iPad, Mac Safari): with a font that has no U+200D (Alexandria, IBM Plex Sans Arabic, Cairo, Tajawal…), WebKit draws a letter + ZWJ in a fallback font. After mount there, `<ArabicText>` switches each Arabic word to the clip method: every letter box shows the whole word, aria-hidden and clipped to that letter's slice, plus one visually hidden copy for screen readers. It re-measures when fonts load and on resize. Renders (Chromium) and server output keep the ZWJ boxes, byte-for-byte unchanged. `joinMode="zwj" | "clip"` forces one method.
  - في Safari ومع خط لا يحتوي U+200D، يرسم المكوّن الكلمة كاملة في كل صندوق ويقصّها على حدود الحرف، فتبقى متصلة.
- `formatDigits(n | string, "eastern" | "western" | "keep")` gives `١٬٢٥٠٬٠٠٠`, and leaves Latin runs such as `iPhone 17` untouched.
  - Eastern output always uses ٬ (U+066C) and ٫ (U+066B), whatever the renderer's ICU data.
  - Eastern digits typed with Latin separators (`١,٢٥٠`) are corrected too.
- `withArabicSeparators(loadFont(...))` fixes fonts like Alexandria, which draw ٬ and ٫ with their Latin comma glyph.
  - The returned `fontFamily` puts a unicode-range face first. It covers U+066A–U+066C only and comes from IBM Plex Sans Arabic (OFL).
  - Every other glyph still comes from your font, and font load order doesn't matter.
  - يرسم خط Alexandria الفاصلة ٬ بشكل الفاصلة اللاتينية، وهذه الدالة تصلح ذلك.
- `isolateLatin(text)` adds FSI/PDI around Latin runs.

`splitArabic()` returns strings, so it cannot do the clip method: in Safari, its ZWJ tokens join only with fonts that map U+200D (Noto Naskh Arabic does; `harakah-fix doctor` warns about local fonts that don't). For the Player in Safari, prefer `<ArabicText>`, or animate per word there.

It is a single self-contained file (`src/index.tsx`), so `harakah-fix fix` can vendor it into a project as `src/harakah-arabic.tsx`.
Set `REMOTION_HARAKAH_REFERENCE=1` (render-time env) to make `splitArabic` return running text. `harakah-fix compare` uses this for its join verdict.
