#!/usr/bin/env node
// Install Harakah into a project for Claude Code: skill, hooks, and MCP server. Idempotent, and touches
// only the project's files: .claude/skills/harakah/, .claude/settings.json (merged), .mcp.json (merged).
//   node integrations/claude-code/install.mjs [project-dir] [--no-skill] [--no-hooks] [--no-mcp] [--npx]
// --npx writes `npx --no-install harakah-*` commands (project has harakah-fixer as a devDependency);
// the default points at this checkout's dist/ with absolute paths (works without publishing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const project = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const useNpx = flag("--npx");
const q = (p) => (/[\s"']/.test(p) ? JSON.stringify(p) : p);
const cmd = (bin, sub) => useNpx ? `npx --no-install harakah-${bin}${sub ? " " + sub : ""}` : `node ${q(path.join(home, "dist", bin === "hook" ? "claude-hook.js" : "mcp.js"))}${sub ? " " + sub : ""}`;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
const writeJson = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n"); };
if (!useNpx && !fs.existsSync(path.join(home, "dist", "mcp.js"))) { console.error(`Build first: (cd ${home} && npm run build)`); process.exit(2); }
const done = [];

if (!flag("--no-skill")) {
  const dest = path.join(project, ".claude", "skills", "harakah");
  fs.cpSync(path.join(here, "skills", "harakah"), dest, { recursive: true });
  if (!useNpx) fs.writeFileSync(path.join(dest, "scripts", "_env.sh"), `export HARAKAH_HOME=${q(home)}\n`);
  const bin = path.join(dest, "scripts", "_bin.sh");
  const src = fs.readFileSync(bin, "utf8");
  if (!src.includes("_env.sh")) fs.writeFileSync(bin, src.replace("\n", `\n[ -f "$(dirname "\${BASH_SOURCE[0]}")/_env.sh" ] && source "$(dirname "\${BASH_SOURCE[0]}")/_env.sh"\n`));
  done.push(`skill    → ${path.relative(project, dest)}/SKILL.md`);
}
if (!flag("--no-hooks")) {
  const f = path.join(project, ".claude", "settings.json");
  const s = readJson(f);
  s.hooks ??= {};
  const add = (event, matcher, command, timeout) => {
    const list = (s.hooks[event] ??= []);
    for (const g of list) g.hooks = (g.hooks ?? []).filter((h) => !/harakah-hook|claude-hook\.js/.test(h.command ?? ""));
    s.hooks[event] = list.filter((g) => g.hooks.length);
    s.hooks[event].push({ matcher, hooks: [{ type: "command", command, timeout }] });
  };
  add("PostToolUse", "Write|Edit|MultiEdit", cmd("hook", "post-edit"), 60);
  add("PreToolUse", "Bash", cmd("hook", "pre-render"), 90);
  writeJson(f, s);
  done.push(`hooks    → ${path.relative(project, f)} (PostToolUse check, PreToolUse render gate)`);
}
if (!flag("--no-mcp")) {
  const f = path.join(project, ".mcp.json");
  const m = readJson(f);
  m.mcpServers ??= {};
  m.mcpServers.harakah = useNpx ? { command: "npx", args: ["--no-install", "harakah-mcp"] } : { command: "node", args: [path.join(home, "dist", "mcp.js")] };
  writeJson(f, m);
  done.push(`mcp      → ${path.relative(project, f)} (server "harakah": check / fix / gate / compare)`);
}
console.log(`Harakah installed for Claude Code in ${project}\n  ${done.join("\n  ")}\nRestart Claude Code (or /hooks, /mcp) to pick it up. · أعد تشغيل Claude Code لتفعيل حركة.`);
