# Harakah for Claude Code · حركة في Claude Code

Claude Code checks Arabic motion compositions right after it writes them, and **refuses to render broken Arabic**.

There are three pieces. Use any or all of them:

| Piece | What it does |
|---|---|
| **Skill** `.claude/skills/harakah/SKILL.md` | Teaches Claude the workflow (check → fix → gate → compare) and the Arabic rules for new compositions. Includes `scripts/check.sh`, `fix.sh` and `gate.sh`. |
| **MCP server** `harakah-mcp` (stdio) | Tools: `harakah_check`, `harakah_fix`, `harakah_gate`, `harakah_compare` (returns the before/after PNG). |
| **Hooks** `harakah-hook` | `PostToolUse` (Write/Edit/MultiEdit): checks every edited `.tsx`, `.jsx` or `.html` that contains Arabic and sends problems back to Claude. `PreToolUse` (Bash): **denies** `remotion render/still`, `hyperframes render` and `npm run render` while the gate fails. |

## Install

### From npm (recommended)

In your project:

```bash
npm install -D harakah-fixer
node node_modules/harakah-fixer/integrations/claude-code/install.mjs . --npx   # skill + hooks + .mcp.json
```

`--npx` makes the hooks and the MCP server run `npx --no-install harakah-*` from the project, so nothing points at an absolute path. The installer is idempotent: it merges into existing `.claude/settings.json` and `.mcp.json` and replaces only its own entries. Flags: `--no-skill`, `--no-hooks`, `--no-mcp`.

### As a Claude Code plugin

The plugin bundles the skill, both hooks and the MCP server, and puts `harakah-fix` on Claude's PATH. It is in `plugin/`, and the repo root holds its marketplace (`.claude-plugin/marketplace.json`, not in the npm package).

From GitHub, in a Claude Code session (keep `npm install -D harakah-fixer` in the project: the plugin runs that engine):

```
/plugin marketplace add harakah-si/harakah
/plugin install harakah@harakah
```

From a checkout (for contributors):

```bash
npm install && npm run build                                   # in a checkout of this repo
claude plugin marketplace add /path/to/harakah                 # or, in a session: /plugin marketplace add …
claude plugin install harakah@harakah
# one-off, without installing:  claude --plugin-dir /path/to/harakah/integrations/claude-code/plugin
```

The plugin's launcher (`plugin/scripts/harakah.cjs`) looks for the engine in this order: `$HARAKAH_HOME`, then the project's `node_modules/harakah-fixer`, then this checkout (a local marketplace loads the plugin in place), then a global `harakah-fix`.
Both manifests pass `claude plugin validate`. `claude plugin details harakah` shows 1 skill, 2 hooks (PostToolUse and PreToolUse) and 1 MCP server.

Manual alternative:

```bash
claude mcp add harakah -- node /abs/path/harakah-fixer/dist/mcp.js       # MCP server
cp -r integrations/claude-code/skills/harakah your-project/.claude/skills/ # skill
# hooks: merge integrations/claude-code/settings.json into your-project/.claude/settings.json
```

Restart Claude Code, or run `/mcp` and `/hooks` to confirm.

## Behaviour

- **After an edit:** if the file has Arabic problems, the hook returns `decision: "block"` with the list and the fix command. Claude sees it and fixes the file. Clean files produce no output.
  - `HARAKAH_AUTOFIX=1` applies the safe fixes automatically instead, and just tells Claude what changed.
- **Before a render:** the command's target is gated. That's the HyperFrames positional dir, or the shell cwd (including `cd dir && …`). On errors the command is denied with the reason.
  - `HARAKAH_GATE=strict` also blocks on warnings.
  - `HARAKAH_GATE=off` disables the gate. That's for the user, not for Claude.
  - `harakah_gate` (MCP) with `layout: true` returns `ok: false` and `inconclusive` reasons when the layout audit can't run; `HARAKAH_GATE=lenient` lets it pass. The hooks themselves stay silent on their own internal errors, so they can't wedge a session.
- Non-render Bash commands return in about 50 ms (heavy modules load lazily). Internal errors never block a session: the hook exits 0 silently.

## Verify

```bash
npm test -- --test-name-pattern=mcp     # end-to-end: spawns the MCP server over stdio and calls every tool, plus the hooks
echo '{"tool_input":{"command":"npx remotion render"},"cwd":"fixtures/remotion"}' | node dist/claude-hook.js pre-render
```
