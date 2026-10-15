# Accuracy benchmark · معيار الدقة

How Harakah's accuracy is measured on scenes we didn't write, labelled by Arabic readers who don't see Harakah's output. The tests in `test/` prove that known cases stay fixed; they can't say how often Harakah is right on work it has never seen. This protocol does. Until it has run, harakah.si and the README state no accuracy numbers.

## What it measures

| Question | Metric |
|---|---|
| When Harakah flags a problem, is it real? | **Precision** per rule family: confirmed findings ÷ all findings |
| Of the real problems, how many does it find? | **Recall** per rule family: found ÷ all labelled problems |
| Does it bother correct Arabic? | **False positives per clean scene** |
| Does `fix` repair without breaking the work? | **Safe-fix rate**: fixed scenes judged correct *and* with the animation and design intact ÷ scenes `fix` changed |
| Does `fix` make anything worse? | **Regressions**: problems present after `fix` that weren't before |
| Does the sampled layout audit see the problem's frames? | **Frame recall**: labelled frame ranges with at least one flagged sample ÷ all labelled ranges |
| Is the `compare` join verdict right? | **Join verdict accuracy** against the reviewers' judgement of the same frame |
| Can every change be undone? | `git apply -R` of the patch restores the original bytes (yes/no per scene) |
| What does it cost? | Wall time of `check`, `audit`, `compare` per scene |

Rule families: splits (HZ01–02, HZ23), direction and layout (HZ03–05, HZ21–22, HZ24), typography (HZ06–08, HZ16–18, HZ20), fonts and licences (HZ09–11), digits and bidi (HZ12–15), canvas and 3D (HZ19, HZ25–27).

## The corpus

At least **30 scenes**, none written by us or generated for the benchmark:

- **≥ 10 Remotion**, **≥ 10 GSAP/HTML**, **≥ 5 HyperFrames**, the rest anything Harakah reads (templates, canvas, three.js);
- **≥ 10 written by an AI coding agent** (the beachhead's main source of broken Arabic), recorded as such;
- **≥ 8 clean scenes**, correct Arabic that should produce no findings, to measure false positives;
- coverage of: per-letter animation, lam-alef, tashkeel, mixed Arabic/Latin brand names, digits and counters, RTL rows and lists, font fallbacks, and at least two canvas or three.js scenes.

**Sources and consent:**
- public repositories under an OSI licence, with the licence and commit recorded; or
- scenes submitted by their owners with written consent to use them in the benchmark, and say whether they may be shown publicly.

Client footage, client copy that isn't public, and anything a submitter marks private never enter the repository: they stay in the submitter's hands or in private storage outside git, referenced by an id. Minimal reproductions are preferred over whole projects.

**Storage:** `bench/` in this repository, which is public: only scenes that may be shown publicly go there, the others are referenced by an id. Never in the npm package (`files` in `package.json` doesn't include it). One folder per scene: the source, `source.json` (origin, licence or consent, author type, stack), and `labels.csv`.

## Labelling

1. **Two Arabic-fluent reviewers label each scene independently**, at least one with typography or motion-design experience. They see the rendered scene (video or frames) and the source, **not Harakah's output**.
2. One row per problem, in `bench/<scene>/labels.csv` (template: [`bench/labels.template.csv`](../bench/labels.template.csv)):
   - where it is (file and line, or element), and the frame range (first and last frame where it's visible);
   - the rule family it belongs to (or `other` if no rule covers it);
   - **severity**: `visible` (a viewer notices), `subtle` (a typographer notices), `none` (technically off, invisible);
   - **safe to fix automatically?** `yes`, `no` (the fix would change design intent) or `unsure`.
3. A third reviewer settles disagreements. Agreement before settling is reported per family (Cohen's kappa), so weak labels show.
4. Clean scenes get one row: `clean`.

## Running Harakah

With one pinned version (`npx -y -p harakah-fixer@<version>`), on a copy of each scene committed to a throwaway git repository, so every change is a diff:

```bash
cd copy && git init -q && git add -A && git commit -qm original
harakah-fix check . --json > ../out/check.json              # or the scene file
harakah-fix audit <file-or-project> --json > ../out/audit.json   # includes coverage (sampled frames, gap)
harakah-fix gate  . --layout --json > ../out/gate.json
harakah-fix compare <file-or-project> -o ../out/compare     # before/after renders and join verdict
harakah-fix fix <file> -o <file>                            # HTML: in place
harakah-fix fix . --write                                   # Remotion project / .tsx
harakah-fix fix . --patch ../out/templates.patch && git apply ../out/templates.patch   # .astro/.vue/.svelte
git add -A && git diff --cached --binary > ../out/fix.patch   # the whole change, new files (fonts) included
git apply -R --index ../out/fix.patch && git status --porcelain   # empty: the change undoes cleanly
```

The reviewers then judge the **fixed render** of every scene `fix` changed: are the Arabic problems gone, did anything get worse, and are the animation and design still what the author made?

A finding matches a label when it names the same element (or line) and family. For the layout audit, it also needs at least one flagged sample inside the labelled frame range.

## Reporting

Each run produces `bench/results/<version>.md`, which gives the pinned version, the number of scenes and labels, and every metric above per family with its count (for example "precision 0.92, 46/50"). Numbers are only published, on harakah.si or elsewhere, with:
- the version they were measured on;
- the number of scenes behind them;
- the date, and a link to this protocol.

A family with too few labelled problems to measure (fewer than 10) is reported as "not enough data", not as a percentage.

## What the results change

These are targets for deciding, not claims:
- **No silent destructive fix:** a single safe-fix failure where the design was changed without a report is a release blocker for that fix.
- A family whose auto-fix is judged unsafe in more than 1 in 10 changed scenes becomes report-only until fixed.
- A family whose precision is below 0.8 gets its false positives turned into regression tests before any new rule is added.
- Frame recall below 0.9 on short glitches raises the default sampling rate or the `--all-frames` threshold.
- The join verdict's tolerances are recalibrated from the reviewers' judgements (`src/remotion/compare.ts`, `src/render.ts`).
