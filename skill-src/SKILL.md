---
name: harakah
<!-- if scripts cli -->
description: Check, fix and verify Arabic text in motion-graphics code (Remotion .tsx/.jsx, HyperFrames/GSAP/HTML). Use whenever you create or edit a composition that contains Arabic, and ALWAYS before running `remotion render|still` or `hyperframes render`. Refuses to render broken Arabic (split letters, wrong direction, Latin fonts, mixed digits, broken bidi).
<!-- endif -->
<!-- if agent -->
description: Check, fix and verify Arabic text in motion-graphics code (Remotion .tsx/.jsx, HyperFrames/GSAP/HTML, canvas, three.js). Use whenever you create or edit a composition or animation that contains Arabic, and ALWAYS before rendering it. Catches broken Arabic before it renders (split letters, wrong direction, Latin fonts, mixed digits, broken bidi, canvas and 3D text that can't join).
license: MIT
compatibility: Needs Node.js 22.12+ (runs harakah-fixer through npx). Chrome or Chromium only for the audit, compare and contact-sheet steps.
metadata:
  homepage: https://harakah.si
  package: harakah-fixer
<!-- endif -->
---

# Harakah: Arabic motion fixer · حركة

Arabic letters join. Animation code that splits text into per-letter boxes (`text.split("")`,
`Array.from(text)`, SplitText `chars`, `inline-block` spans), forgets `dir="rtl"`, uses Latin
<!-- if scripts cli -->
fonts, tracks letters apart or mixes digit styles **renders as disconnected, backwards Arabic**.
Harakah finds these and fixes them safely, and keeps the per-letter animation.
<!-- endif -->
<!-- if agent -->
fonts, tracks letters apart, mixes digit styles or draws letters one by one on a canvas
**renders as disconnected, backwards Arabic**. Harakah finds these and fixes them safely, and
keeps the per-letter animation.

All commands run the published CLI through npx, so nothing needs installing:
`npx -y -p harakah-fixer harakah-fix <command>`. Below, `harakah-fix` means exactly that.
<!-- endif -->

## The rule

<!-- if scripts cli -->
**Never render, or call a composition done, while the Harakah gate fails.**
<!-- endif -->
<!-- if agent -->
**Never render, or call a composition done, while `harakah-fix gate` fails.**
<!-- endif -->

## Workflow

1. **After writing or editing** any `.tsx`, `.jsx` or `.html` composition containing Arabic, check it:
<!-- if scripts cli -->
   - MCP: `harakah_check { path }`
<!-- endif -->
<!-- if scripts -->
   - Shell: `scripts/check.sh <file-or-project>`
<!-- endif -->
<!-- if cli -->
   - Shell: `harakah-fix check <file-or-project>`
<!-- endif -->
<!-- if agent -->
   `harakah-fix check <file-or-project>` (exit 1 on errors; `--json` for machine-readable output).
<!-- endif -->
2. **Fix** what it reports:
<!-- if scripts cli -->
   - MCP: `harakah_fix { path, write: true }`
<!-- endif -->
<!-- if scripts -->
   - Shell: `scripts/fix.sh <target>`
<!-- endif -->
<!-- if cli -->
   - Shell: `harakah-fix fix <target> --write` (Remotion), or `harakah-fix fix <file.html> -o <file.html>`
<!-- endif -->
<!-- if agent -->
   - Remotion project: `harakah-fix fix <project> --write` (`--dry-run` first to see the diff).
   - HTML: `harakah-fix fix <file.html> -o <file.html>`.
<!-- endif -->
   The codemod adds `// harakah:` comments at every change. Keep them, since they explain the change to humans.
   It may vendor `src/harakah-arabic.tsx`, a small helper with `splitArabic`, `formatDigits` and `ArabicText`.
   Issues marked *manual* (reported, not changed) need you to edit the code yourself. Follow the message.
<!-- if scripts cli -->
3. **Gate before rendering.**
   - MCP: `harakah_gate { path: <project or file> }`
<!-- endif -->
<!-- if scripts -->
   - Shell: `scripts/gate.sh <project>`
<!-- endif -->
<!-- if cli -->
   - Shell: `harakah-fix gate <project>`
<!-- endif -->
<!-- if scripts cli -->
   This exits 1 if the render would be broken. Fix first, then gate again.
4. **Prove it** when the user cares about the result, or when you changed animation code:
   - MCP: `harakah_compare { path, composition, frame }`
   This renders before and after, checks that the letters are actually joined, and returns a side-by-side PNG.
<!-- endif -->
<!-- if agent -->
3. **Gate before rendering:** `harakah-fix gate <project-or-file>` (add `--layout` to also render sampled
   frames and check the visual order). It exits 1 if the render would be broken. Fix first, then gate again.
4. **Prove it** when the user cares about the result, or when you changed animation code:
   - `harakah-fix compare <target> -o out/cmp` renders before and after and checks that the letters actually join.
   - `harakah-fix audit <target>` renders sampled frames and reports where Arabic lands out of order, with the frames.
<!-- endif -->

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

<!-- if scripts cli -->
## Hooks (if installed)

- A **PostToolUse** hook checks every Arabic composition you write. If it reports problems, fix them before moving on.
- A **PreToolUse** hook denies render commands while the gate fails. Don't try to get around it (no renaming commands, no `HARAKAH_GATE=off`). Fix the Arabic instead. Only the user may turn the gate off.
<!-- endif -->
<!-- if agent -->
## Gate before every render

Run the gate yourself before any render command (`remotion render|still`, `hyperframes render`, `npm run render`,
a frame-by-frame capture script). Don't render while it fails, and don't work around it. Only the user may decide
to render anyway.

In Claude Code, the Harakah plugin adds hooks that enforce this and an MCP server
(`harakah_check`, `harakah_fix`, `harakah_gate`, `harakah_compare`); see https://harakah.si.
<!-- endif -->
