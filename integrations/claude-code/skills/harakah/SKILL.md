---
name: harakah
description: Check, fix and verify Arabic text in motion-graphics code (Remotion .tsx/.jsx, HyperFrames/GSAP/HTML). Use whenever you create or edit a composition that contains Arabic, and ALWAYS before running `remotion render|still` or `hyperframes render`. Refuses to render broken Arabic (split letters, wrong direction, Latin fonts, mixed digits, broken bidi).
---

# Harakah: Arabic motion fixer · حركة

Arabic letters join. Animation code that splits text into per-letter boxes (`text.split("")`,
`Array.from(text)`, SplitText `chars`, `inline-block` spans), forgets `dir="rtl"`, uses Latin
fonts, tracks letters apart or mixes digit styles **renders as disconnected, backwards Arabic**.
Harakah finds these and fixes them safely, and keeps the per-letter animation.

## The rule

**Never render, or call a composition done, while the Harakah gate fails.**

## Workflow

1. **After writing or editing** any `.tsx`, `.jsx` or `.html` composition containing Arabic, check it:
   - MCP: `harakah_check { path }`
   - Shell: `scripts/check.sh <file-or-project>`
2. **Fix** what it reports:
   - MCP: `harakah_fix { path, write: true }`
   - Shell: `scripts/fix.sh <target>`
   The codemod adds `// harakah:` comments at every change. Keep them, since they explain the change to humans.
   It may vendor `src/harakah-arabic.tsx`, a small helper with `splitArabic`, `formatDigits` and `ArabicText`.
   Issues marked *manual* (reported, not changed) need you to edit the code yourself. Follow the message.
3. **Gate before rendering.**
   - MCP: `harakah_gate { path: <project or file> }`
   - Shell: `scripts/gate.sh <project>`
   This exits 1 if the render would be broken. Fix first, then gate again.
4. **Prove it** when the user cares about the result, or when you changed animation code:
   - MCP: `harakah_compare { path, composition, frame }`
   This renders before and after, checks that the letters are actually joined, and returns a side-by-side PNG.

## Writing new Arabic compositions (do this from the start)

Read [references/arabic-motion.md](references/arabic-motion.md) before writing Arabic motion: splitting, direction, letters in motion, sizes and timing, fonts, digits. The essentials:

- Animate per letter with `splitArabic(text)` (keeps joining with ZWJ) or per **word**. Never use `text.split("")` or `Array.from(text)`.
- In Remotion, prefer `<ArabicText text="…" by="letter|word" />` from `harakah-arabic`.
- `dir="rtl"` and `lang="ar"` on the Arabic container. Mixed Arabic+Latin lines: wrap Latin in `<bdi>`.
- Motion follows reading order: staggers start on the right, reveals and entrances run right to left. Let letters settle on one baseline before the word has to be read.
- Canvas: one `fillText` per word with `ctx.direction = "rtl"`. three.js: troika-three-text / drei `<Text>` with an Arabic `.ttf` as `font`, never `TextGeometry` / `<Text3D>`.
- Fonts (OFL): **Alexandria** for display, **IBM Plex Sans Arabic** for text. Don't use Latin-only fonts for Arabic.
- No `letter-spacing`, `text-transform` or italics on Arabic. No `text-align: left`.
- Digits: Eastern by default (`formatDigits(1250000)` gives `١٬٢٥٠٬٠٠٠`, using ٬ and ٫ separators). Don't mix Eastern and Western digits on one line.

## Hooks (if installed)

- A **PostToolUse** hook checks every Arabic composition you write. If it reports problems, fix them before moving on.
- A **PreToolUse** hook denies render commands while the gate fails. Don't try to get around it (no renaming commands, no `HARAKAH_GATE=off`). Fix the Arabic instead. Only the user may turn the gate off.
