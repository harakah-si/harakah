# Harakah for VS Code · حركة

Diagnostics for Arabic in motion and RTL code (split letters, direction, digits, fonts, letter order) from
`harakah-fix check --json`, shown on open and save, with a quick fix. Templates get a preview first: a diff of the
patch, applied as one undoable edit. Everything runs locally; nothing is uploaded.

تنبيهات النص العربي في كود الموشن (حروف متقطعة، اتجاه، أرقام، خطوط) من `harakah-fix`، مع إصلاح سريع.

| File | Diagnostics | Quick fix runs |
|---|---|---|
| `.html` | `check <file> --json` | `fix <file> -o <file>` (fonts copied to `fonts/` next to it) |
| `.tsx` / `.jsx` (Remotion) | same | **Preview fix** (preferred): `fix <file> --dry-run --json` lists every file the codemod would write (component, vendored `harakah-arabic.tsx`, CSS), shown in the multi-file diff editor (a new helper against an empty file); **Apply** makes them one workspace edit (Ctrl+Z undoes it in each file, you save). **Fix this file** applies without the preview. |
| `.astro` / `.vue` / `.svelte` | same | **Preview fix (diff)** (preferred): `fix <file> -o <tmp> --json`, shown as original ↔ fixed with the findings count; **Apply** puts it in the editor as one edit (Ctrl+Z undoes it, you save). **Fix this file** applies the same patch without the preview. |

Templates work in a stock VS Code: without an Astro/Vue/Svelte extension those files open as plaintext, so the
extension activates on `workspaceContains` and plaintext, and its quick fixes match by file pattern, not language id.
HTML fixes rewrite the file on disk, because they copy fonts next to it: review them with `git diff`. Unsaved
edits are saved before a fix. What the template patch leaves for you (dynamic attributes, components, text from
expressions) is listed in Output › Harakah.

## Tested in a real VS Code

`npm run test:vscode` (from the repo root; Linux needs a display, e.g. `xvfb-run -a npm run test:vscode`) downloads
a pinned VS Code into `.vscode-test/`, opens a temp workspace with this extension and the repo's built CLI, and
checks: HTML diagnostics and quick fix, template diagnostics with the file opened as plaintext, the preview diff, apply,
undo/redo, findings cleared after save, and the `.tsx` multi-file preview (component + created helper, nothing
written before Apply, findings 5 → 0 after). CI runs it as the `vscode (real editor)` job.

## Settings

- `harakah.command`: how to run the CLI. Empty uses `node_modules/.bin/harakah-fix` from the workspace, then
  `harakah-fix` on PATH. From a clone: `node /path/to/harakah-fixer/dist/cli.js`.
- `harakah.language`: `en` (default), `ar` or `both`.
- `harakah.enable`: turn checking off.

## Build a local .vsix (not published)

```sh
cd integrations/vscode
npx @vscode/vsce package --allow-missing-repository -o ../../out/harakah-vscode-0.2.0.vsix
code --install-extension ../../out/harakah-vscode-0.2.0.vsix
```

The `publisher` (`harakah-local`) is a placeholder; publishing to the Marketplace or Open VSX needs a
Marketplace publisher account.
