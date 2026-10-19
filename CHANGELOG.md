# Changelog

Released to npm as [`harakah-fixer`](https://www.npmjs.com/package/harakah-fixer). Full options and behaviour: [docs/REFERENCE.md](docs/REFERENCE.md).

## Unreleased

- **`gate --layout` no longer skips short captions in long compositions.** It sampled 2 frames a second, capped at 60, so a 5-minute composition was checked every 5 s and a 3 s caption could fall between samples and pass. The layout check (gate and `audit --layout`) now also seeks the middle of every timed window it finds in the props (`startMs`/`endMs`, `start`/`end`, `startFrame`/`endFrame`, `from` + `durationInFrames`, …), e.g. each caption word.
- **One-line per-letter maps in JSX are flagged and fixed.** `text.split("").map((ch) => <span>{ch}</span>)` (also `split('')`, `[...text]`, `Array.from(text)`) went unflagged when the spans had no transform, because plain inline spans still join in Chrome's render. They are now rewritten to `splitArabic()` as a warning: other browsers' previews can shape each span alone, and the first transform, inline-block or padding breaks the word in Chrome too.

## v0.4.2 · 2026-10-15

- **Claude Code render gate checks the right folder** when the `cd` path is single-quoted, or when options come before the HyperFrames folder (`hyperframes render --out ./dist ./scenes`). Before, it could check the wrong folder and let a broken render through.
- **Fixing a lone `.tsx` file no longer crashes** with EACCES next to an unreadable folder; unreadable and hidden folders are skipped while scanning.
- `--only` / `--disable` and `--composition` lists accept spaces after commas (`--only "HZ01, HZ07"`), and "files scanned" counts clean templates too.

## v0.4.1 · 2026-10-13

- **Renders say what they reach on the internet.** `compare` and `audit` list the hosts a scene loaded from (CDN scripts, web fonts). `--offline` refuses them before they leave the machine and names them; a scene that needed them is inconclusive (exit 2), not passed.
- **`gate --github`** for GitHub Actions: each problem is annotated on its line in the pull request, and a job summary lists what blocks the merge with the fix command. `integrations/github-actions/harakah.yml` is a workflow to copy.
- **`audit --all-frames`** checks every frame of a short clip (up to 1800 frames). REFERENCE has a table of what each sampling rate misses.
- The local web tool states how many frames the layout audit sampled and that the compare verdict is one frame.
- A command that fails to run exits 2 ("couldn't check"), never 1 ("broken Arabic").

## v0.4.0 · 2026-10-12

- **Security: rendered scenes can't read your other files.** A scene rendered by `compare`, `audit`, `gate --layout`, the MCP server or the web tool may read its own folder, its project and installed packages, nothing else on disk. A pasted Remotion component can't import local files. 0.3.1 and earlier are affected.
- **A gate that couldn't check doesn't pass** (exit 2, with the reason). `HARAKAH_GATE=lenient` lets it pass and lists what wasn't checked. The layout audit no longer hangs when Chrome can't start.
- **Remotion renders work with Chrome/Chromium 132+** (the right headless mode is picked per binary).
- **New checks:** HZ25–27 for Arabic drawn on a canvas or as three.js text, and Motion+ `splitText`.
- **`harakah-fix doctor`** checks a machine in one command: Node, fonts, temp folder, Chrome (it renders Arabic and checks it joins), ffmpeg and the Remotion packages.
- `audit` states its coverage (sampled frames and the gap between them). Chrome is found on Windows. Skill for any agent (Agent Skills format) and motion typography guidance in the skill.

## v0.3.1 · 2026-10-09

- `compare` no longer reports false failures on scaled titles, RTL pages that overflow, or hidden elements, and it finds Chrome in cloud sessions without `HARAKAH_CHROME`.

## v0.3.0 · 2026-10-08

First release on npm.
- Whole Remotion projects: Arabic followed through props, `defaultProps`, `<Composition>` props, zod schemas, `--props`, locale files and shared theme modules.
- Astro, Vue and Svelte templates: report, and a reviewable patch.
- Runtime layout audit (HZ24): Arabic visual order checked in rendered frames, for HTML and Remotion, with verified fix suggestions.
- Real glyph coverage from font files; the project's own RTL overrides respected.
- Remotion Studio panel and `withHarakah()` render gate; Claude Code plugin (skill, hooks, MCP server); VS Code extension (local build).

## v0.2.0 · 2026-10-08

- Remotion AST codemod: per-letter splits to `splitArabic()`, `dir`/`lang`, letter-spacing, Arabic fonts, digits, bidi isolation, in JSX, CSS-in-JS, Tailwind and CSS modules.

## v0.1.0 · 2026-10-08

- HTML engine (rules HZ01–HZ20), runtime ZWJ shim, CLI `check`/`fix`/`compare`, bilingual local web tool, OFL Arabic fonts.
