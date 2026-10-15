<div dir="rtl" lang="ar">

# حركة · Harakah

**تصلح النص العربي في الموشن جرافيك قبل الرندر.** حروف متقطعة، اتجاه معكوس، أرقام مخلوطة، خطوط بلا عربي، وتراخيص خطوط. تعمل مع **Remotion** و**HyperFrames** و**GSAP** وأي HTML/CSS.

</div>

**Fix broken Arabic in motion graphics before you render.** Disconnected letters, wrong direction, mixed digits, fonts without Arabic, font licensing. Works with **Remotion**, **HyperFrames**, **GSAP** and plain HTML/CSS.

[harakah.si](https://harakah.si) · [npm: harakah-fixer](https://www.npmjs.com/package/harakah-fixer) · hello@harakah.si

![Before / after: a GSAP title, per-letter animation kept, letters joined](https://harakah.si/media/harakah-demo.gif)

<div dir="rtl" lang="ar">

## المشكلة

أنميشن الحروف (`SplitText`، `split("")`، `[...text]`) يضع كل حرف في صندوق مستقل، فيرسمه المتصفح بشكله المنفصل وتتفكك الكلمة. حركة تُبقي الأنميشن كما هو وتضيف واصلًا صفريًا (ZWJ) لكل حرف، فيظهر بشكله الصحيح داخل الكلمة، وتبقى «لا» حرفًا واحدًا. وتصلح معها الاتجاه، والمحاذاة، والتباعد بين الحروف، والخطوط، والأرقام (١٢٣ افتراضيًا مع ٬ و٫).

</div>

## The problem

Per-letter animation (`SplitText`, `split("")`, `[...text]`) puts every letter in its own box, so the browser draws each Arabic letter in its isolated form and the word falls apart. Harakah keeps your animation and pads each letter with a zero-width joiner, so it renders in its connected form (لا stays one ligature). It also fixes direction, alignment, letter-spacing, fonts and digits (Eastern ١٢٣ by default, with ٬ ٫ separators).

Every fix is verified against a real render: the fixed title has to match plain running text, measured in connected ink pieces and ink width.

![Remotion: an AI-written "year in review" composition before and after the codemod](https://harakah.si/media/remotion-demo.gif)

---

## Quick start · البداية السريعة

Requirements: Node ≥ 22.12 and Google Chrome or Chromium (for renders and comparisons; set `HARAKAH_CHROME` to override). `ffmpeg` is needed only for MP4 comparisons. `npx -y -p harakah-fixer harakah-fix doctor` checks all of it, including that your Chrome really joins Arabic letters · `doctor` يفحص جاهزية جهازك.

### 1. CLI · سطر الأوامر

```bash
npm install -D harakah-fixer

npx harakah-fix check  title.html            # bilingual report, exit 1 on errors
npx harakah-fix fix    title.html -o out/title.html
npx harakah-fix check  ./my-remotion-app     # a whole Remotion project (scans src/)
npx harakah-fix fix    ./my-remotion-app --dry-run   # colored diff, writes nothing
npx harakah-fix fix    ./my-remotion-app --write     # codemod in place
npx harakah-fix gate   .                     # exit 1 if Arabic would render broken (CI, prerender, hooks)
npx harakah-fix compare ./my-remotion-app --composition Intro -o out/cmp   # real before/after renders
```

Useful options: `--digits eastern|western|keep`, `--split zwj|word`, `--font plex|alexandria|readex|cairo|tajawal|naskh`, `--props props.json`, `--lang ar|en|both`, `--json`.

### 2. Web tool · الأداة في المتصفح

```bash
npx harakah-fix serve        # → http://127.0.0.1:4747 (local only)
```

<div dir="rtl" lang="ar">

الصق مشهد HTML أو مكوّن Remotion، أو **أسقط مجلد مشروع Remotion كاملًا أو ملف zip**. ستحصل على قائمة المشاكل، والكود المصلَّح، ومعاينة قبل وبعد برندر حقيقي، ونسخة مصلَّحة من المشروع (zip) أو patch. الواجهة عربية أولًا، مع الإنجليزية والوضع الداكن والفاتح.

</div>

Paste an HTML scene or a Remotion component, or **drop a whole Remotion project folder or zip**. You get the issue list, the fixed code, a real before/after render, and a fixed project (`.zip`) or a `.patch`. The UI is Arabic-first, with English and dark/light themes.

| | |
|---|---|
| ![Project mode, Arabic](https://harakah.si/media/tool-project-ar.png) | ![Project mode, English](https://harakah.si/media/tool-project-en.png) |

### 3. Claude Code plugin · إضافة Claude Code

Claude checks Arabic as soon as it writes a composition, fixes it, and **cannot render broken Arabic**: a pre-render hook denies `remotion render`, `hyperframes render` and `npm run render` while the gate fails.

```bash
npm install -D harakah-fixer
node node_modules/harakah-fixer/integrations/claude-code/install.mjs . --npx   # skill + hooks + .mcp.json
```

Or as a plugin from this repository's marketplace, in a Claude Code session (the plugin runs the project's `harakah-fixer`, so keep the `npm install -D` above):

```
/plugin marketplace add harakah-si/harakah
/plugin install harakah@harakah
```

The plugin bundles a skill, two hooks and an MCP server (`harakah_check`, `harakah_fix`, `harakah_gate`, `harakah_compare`). Details: [integrations/claude-code](integrations/claude-code/README.md).

### Other agents (Codex, Cursor, Cline, Copilot…) · وكلاء آخرون

The same skill in the [Agent Skills](https://agentskills.io) format, running the CLI through `npx`, with no MCP or hooks needed:

```bash
npm install -D harakah-fixer
npx skills add ./node_modules/harakah-fixer/integrations/agent-skill
```

Details: [integrations/agent-skill](integrations/agent-skill/README.md).

### 4. Remotion

```ts
// remotion.config.ts
import { Config } from "@remotion/cli/config";
import { withHarakah } from "harakah-fixer/remotion";

Config.overrideWebpackConfig(withHarakah());
```

- `remotion render` / `still` / Lambda bundles **fail** while the Arabic is broken, with a list of problems and the fix command.
- It reads `--props` from the render command, so Arabic that arrives only at render time is checked too.
- **Remotion Studio** gets a live Harakah panel. It updates through hot reload about 2 s after a fix, and it's never included in render bundles. With `withHarakah({ layout: true })` it also lists letter and word order problems per composition, with the frame numbers and a verified fix (`dir="rtl"` on the element).

![Harakah panel inside Remotion Studio](https://harakah.si/media/studio-panel.png)

The codemod follows text across files (Composition `defaultProps`, pass-through props, zod schemas, `--props` JSON) and into shared style modules (`theme.ts`, `styles.ts`). It overrides styles at the Arabic usage site instead of editing styles that Latin text shares:

![Shared theme styles: Arabic title fixed, English title untouched](https://harakah.si/media/remotion-theme-compare.png)

Drop-in component (`@harakah/remotion-arabic`, or the vendored `src/harakah-arabic.tsx` that `fix` writes for you):

```tsx
<ArabicText as="h1" text="قصص تستحق أن تُروى" preset="rise" stagger={2} />
splitArabic("سلام")        // ZWJ-padded letters for your own animation
formatDigits(1250000)      // "١٬٢٥٠٬٠٠٠"
```

More: [integrations/remotion](integrations/remotion/README.md).

### 5. GitHub Actions

```yaml
- run: npx -y -p harakah-fixer@0.4 harakah-fix gate . --github
```

The check fails when Arabic would render broken. Each problem is annotated on its line in the pull request, and the job summary lists what blocks the merge, with the fix command. Copy the workflow from `integrations/github-actions/harakah.yml` (in the package): [integrations/github-actions](integrations/github-actions/README.md).

---

## What it checks · ما الذي تفحصه

| | Rule | Fix |
|---|---|---|
| HZ01–02 | Arabic split into per-letter boxes (markup, SplitText, Motion `splitText`, SplitType, `split("")`, `Array.from`, `[...s]`) | auto (ZWJ, animation kept) |
| HZ03–05 | Missing or wrong `dir`/`lang`, `dir="rtl"` on `<html>` in HyperFrames | auto |
| HZ06–08 | `text-align: left`, `letter-spacing`, `text-transform` / small caps | auto |
| HZ09–11 | Fonts with no Arabic, missing `@font-face`, Thmanyah or commercial fonts in hosted renders | auto (OFL fallback); licensing: report or `--replace-proprietary` |
| HZ12–13 | Mixed 123/١٢٣ digits, unisolated Latin runs (`Spotify`, `iPhone 17`) | auto |
| HZ14–20 | Bidi controls, reversed text, justification, tight line height with tashkeel, `break-all`, canvas, italics | auto or report |
| HZ21–23 | Layout order: Arabic inside LTR/code/terminal boxes, Arabic rows laid out left-to-right, letter boxes placed by `left = i × w` | auto |
| HZ25–27 | Canvas and 3D: Arabic drawn one letter at a time (canvas `fillText`, troika meshes), three.js `TextGeometry` / drei `<Text3D>` (can't shape Arabic), troika / drei `<Text>` with no font file | report, with the verified fix |
| HZ24 | Runtime layout audit: renders sampled frames (HTML or Remotion compositions) and measures where each letter, word and row lands (wrong order, mid-animation flips, swaps, collisions) | report, with a frame scrubber in the web tool |

It reads `.html`, `.tsx`/`.jsx`, whole Remotion/React projects, and `.astro`/`.vue`/`.svelte` templates, following Arabic text through locale files, `t('key')` and component props. For templates, `fix` prints a reviewable unified patch: it edits positions in the original source and never re-serialises it. A VS Code extension is in `integrations/vscode` (diagnostics, quick fixes, a preview diff for template patches and the Remotion codemod), tested in a real VS Code and packaged as a local `.vsix`.

Full list, options and limitations: **[docs/REFERENCE.md](docs/REFERENCE.md)**.

## Fonts · الخطوط

All bundled fonts are SIL OFL 1.1: IBM Plex Sans Arabic (default text fallback), Alexandria (display), Readex Pro, Cairo, Tajawal, Noto Naskh Arabic. Their license texts ship in `assets/fonts/`. **Thmanyah is never bundled**: its license forbids redistribution and web embedding. Harakah flags it in hosted renders and suggests `local()` for local renders.

## Contributing · المساهمة

Bug reports with a minimal composition are the most useful thing you can send, especially false positives and false negatives. See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` runs the full suite: unit tests, real Chrome/Remotion/HyperFrames renders, and real-world regressions; CI also runs a smoke test on macOS and Windows. Changes are in [CHANGELOG.md](CHANGELOG.md).

## License

Code: [MIT](LICENSE). Bundled fonts: SIL OFL 1.1, each with its license text. Remotion and GSAP are dev and fixture dependencies only, used under their own licenses. Using Remotion in your own project may require a Remotion company license.
