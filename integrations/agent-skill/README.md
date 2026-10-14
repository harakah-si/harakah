# Harakah skill for any coding agent

`skills/harakah/` is Harakah's skill in the [Agent Skills](https://agentskills.io) format, for agents that read
`SKILL.md` folders: Codex, Cursor, Cline, Amp, Copilot, OpenCode, Claude Code and others. It runs the published CLI
through `npx -y -p harakah-fixer harakah-fix …`, so a project needs nothing installed except Node.js 22.12+.

It is the same skill as the Claude Code plugin's, minus what only Claude Code has (the MCP server and the hooks
that block renders). Instead it tells the agent to run the gate itself before rendering. The guidance in
`references/arabic-motion.md` is identical in every copy (`test/mcp.test.ts` checks it).

## Install

From GitHub:

```bash
npx skills add harakah-si/harakah          # detects your agents; project scope
npx skills add harakah-si/harakah -g       # global (~/.agents/skills, ~/.claude/skills, …)
```

From the npm package:

```bash
npm install -D harakah-fixer
npx skills add ./node_modules/harakah-fixer/integrations/agent-skill
```

From a local checkout: `npx skills add ./integrations/agent-skill`.

In Claude Code, prefer the plugin (`integrations/claude-code`): it adds the MCP tools and the hooks that deny
`remotion render` / `hyperframes render` while the gate fails.
