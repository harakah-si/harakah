# Contributing · المساهمة

<div dir="rtl" lang="ar">

شكرًا لاهتمامك بحركة. أكثر ما يفيدنا: **مثال صغير يعيد المشكلة**، سواء نبّهت الأداة على عربي سليم أو فاتها نص مكسور. افتح بلاغًا باستخدام قالب «نتيجة خاطئة». يمكنك الكتابة بالعربية أو الإنجليزية.

</div>

Thanks for helping. The most valuable contribution is a **minimal repro**: a composition where Harakah flags correct Arabic, misses broken Arabic, or produces a fix that breaks the render. Use the "Wrong result" issue template. Arabic or English are both fine.

## Setup

```bash
git clone https://github.com/harakah-si/harakah.git && cd harakah
npm install
npm install --prefix fixtures/remotion   # the real Remotion project used by the render tests
npm run build                            # → dist/
npm test                                 # builds first; real Chrome + Remotion renders, ~2 min
```

You need Node ≥ 22.12 and Chrome or Chromium (`HARAKAH_CHROME=/path` if it isn't auto-detected). `ffmpeg` is needed for the side-by-side compare tests.

Other useful commands:

- `npm run serve`: runs the web tool on http://127.0.0.1:4747.
- `npm run smoke`: the cross-platform smoke test that CI runs on macOS and Windows (check, fix, gate, the codemod, `doctor`, one real layout render). Run `npm run build` first.
- `npm run pack:check`: `npm pack`, then installs the tarball in a temp project and smoke-tests every bin. It publishes nothing. Run it before touching `package.json` `files`/`exports`/`bin`.
- `UPDATE_SNAPSHOTS=1 npm test`: refreshes the codemod snapshots in `test/__snapshots__/remotion/`. Review the diff.

## Where things live

| | |
|---|---|
| `src/engine.ts`, `src/css.ts` | HTML rules HZ01–HZ23 and the mini-cascade (HZ24 is the runtime audit in `src/layout-audit.ts`) |
| `src/arabic.ts` | joining types, graphemes, ZWJ padding, digits |
| `src/remotion/codemod.ts` | the ts-morph codemod (fixpoint, idempotent, `harakah:` comments) |
| `src/remotion/props.ts` | following Arabic across files: props, `--props`, shared style modules |
| `src/remotion/compare.ts`, `src/render.ts` | real renders and the join audit |
| `integrations/` | Remotion `withHarakah` and Studio panel, Claude Code plugin and hooks, HyperFrames hooks |
| `web/` | the web tool and landing page (Arabic first, bilingual, dark and light) |

Full map: [docs/REFERENCE.md](docs/REFERENCE.md#project-layout).

## Ground rules for changes

1. **Every fix must be verified by a render, not just by the diff.** A rule change gets a fixture in `fixtures/` (one broken composition per rule) and a test that shows the problem is detected, the problem is gone after `fix`, and running `fix` again changes nothing (idempotence). Letter-joining changes also need a join-audit render test (`test/render.test.ts` or `test/remotion-render.test.ts`).
2. **No false positives on correct Arabic or on Latin-only code.** `fixtures/22-clean.html`, `CleanTitle.tsx` and the Latin fixtures must stay byte-for-byte untouched.
3. **Don't edit shared styles in place.** A CSS rule or a `theme.ts` object used by Latin text gets an override at the Arabic usage site, not an in-place change.
4. **Leave a trail.** Every codemod edit carries a short `harakah:` comment saying what was there before.
5. **Fonts:** only SIL OFL fonts may be bundled, each with its license text in `assets/fonts/`. Never add Thmanyah or other commercial fonts, not even in fixtures.
6. **Copy:** user-facing strings are bilingual. Arabic should read like natural Arabic, not a literal translation. Digits are Eastern (١٢٣) by default.
7. Add a CHANGELOG entry under "Unreleased". If you made a design choice, add a line under "Decisions" saying what you chose and why.

## Reporting security issues

Please don't open a public issue for a security problem. Email **security@harakah.si** instead; [SECURITY.md](SECURITY.md) has what to include and what's in scope.
