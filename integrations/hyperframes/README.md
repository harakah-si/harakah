# Pre-render gate for HyperFrames (and any npm render script)

`harakah-fix gate <dir>` exits **1** when Arabic in the compositions would render broken, and prints what to fix. It exits 0 when the Arabic is clean.

## npm `prerender` (runs automatically before `npm run render`)

```jsonc
// package.json of your HyperFrames project
{
  "scripts": {
    "prerender": "harakah-fix gate .",
    "render": "npx hyperframes render . -o out/video.mp4",
    "fix:arabic": "harakah-fix fix index.html -o index.html"
  }
}
```

npm runs `prerender` first and stops if it fails. `--strict` also blocks on warnings, and `--json` gives machine-readable output.
The same works for Remotion: `"prerender": "harakah-fix gate ."` next to `"render": "remotion render …"`.

## One-liner / CI

```bash
harakah-fix gate . && npx hyperframes render . -o out/video.mp4
```

## Git pre-commit

```bash
cp integrations/hyperframes/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

It gates only the staged `.html`, `.tsx` and `.jsx` files that contain Arabic.

Coding agents: see `../claude-code/`. The `PreToolUse` hook there denies `hyperframes render` while this gate fails.
