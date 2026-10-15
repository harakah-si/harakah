#!/usr/bin/env node
// The Harakah skill ships in four places; all are generated from skill-src/ (SKILL.md + references/).
// In skill-src/SKILL.md, lines between `<!-- if <variant> [variant…] -->` and `<!-- endif -->` appear only in those
// variants: `scripts` (the skill folder installed into a project, with its scripts/*.sh), `cli` (the Claude Code
// plugin and this repo's own skill: MCP tools + harakah-fix), `agent` (Agent Skills for any agent: npx only).
//   node scripts/build-skills.mjs          write the copies
//   node scripts/build-skills.mjs --check  exit 1 and list the copies that differ (test/consistency.test.ts runs it)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "skill-src");
export const TARGETS = {
  "integrations/claude-code/skills/harakah": "scripts",
  "integrations/claude-code/plugin/skills/harakah": "cli",
  ".claude/skills/harakah": "cli",
  "integrations/agent-skill/skills/harakah": "agent",
};

/** The SKILL.md of one variant: blocks for other variants dropped, markers removed. */
export function render(src, variant) {
  const out = [];
  let keep = true, open = false;
  for (const line of src.split("\n")) {
    const m = /^<!-- if ([\w ]+) -->$/.exec(line);
    if (m) { if (open) throw new Error("skill-src: nested <!-- if -->"); open = true; keep = m[1].split(" ").includes(variant); continue; }
    if (line === "<!-- endif -->") { if (!open) throw new Error("skill-src: <!-- endif --> without <!-- if -->"); open = false; keep = true; continue; }
    if (keep) out.push(line);
  }
  if (open) throw new Error("skill-src: unclosed <!-- if -->");
  return out.join("\n");
}

/** Every generated file: [path relative to ROOT, content]. */
export function outputs() {
  const skill = fs.readFileSync(path.join(SRC, "SKILL.md"), "utf8");
  const refs = fs.readdirSync(path.join(SRC, "references"));
  return Object.entries(TARGETS).flatMap(([dir, variant]) => [
    [path.join(dir, "SKILL.md"), render(skill, variant)],
    ...refs.map((f) => [path.join(dir, "references", f), fs.readFileSync(path.join(SRC, "references", f), "utf8")]),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale = [];
  for (const [rel, content] of outputs()) {
    const file = path.join(ROOT, rel);
    const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (now === content) continue;
    if (check) { stale.push(rel); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`wrote ${rel}`);
  }
  if (check && stale.length) {
    console.error(`Skill copies differ from skill-src/ (edit skill-src/, then run npm run build:skills):\n${stale.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
}
