# Changelog

Released to npm as [`harakah-fixer`](https://www.npmjs.com/package/harakah-fixer). Full options and behaviour: [docs/REFERENCE.md](docs/REFERENCE.md).

## Unreleased

- Releases publish through npm Trusted Publishing (OIDC): the Release workflow needs no npm token, and npm signs provenance on every publish. `npm deprecate` in the npm maintenance workflow still uses a token.
- The Claude Code plugin, the VS Code extension and `@harakah/remotion-arabic` link to the source repository, and the harakah.si footer links to GitHub.

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
