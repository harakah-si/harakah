// Claude Code integration, end to end: spawns the stdio MCP server with the official SDK client and
// calls every tool on real fixtures; runs the hook handler with Claude Code's stdin JSON; runs the gate CLI.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(".");
const FX = path.join(ROOT, "fixtures");
const REM = path.join(FX, "remotion");
let client: Client;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-mcp-test-"));

before(async () => {
  client = new Client({ name: "harakah-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp.ts"], cwd: ROOT, stderr: "pipe" }));
});
after(async () => { await client?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name} errored: ${r.content?.[0]?.text}`);
  return r.content as { type: string; text?: string; data?: string; mimeType?: string }[];
};
const jsonOf = (c: { text?: string }[], i = 0) => JSON.parse(c[i].text!);

test("mcp: lists the four tools with schemas", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["harakah_check", "harakah_compare", "harakah_fix", "harakah_gate"]);
  for (const t of tools) assert.equal(t.inputSchema.type, "object");
});

test("mcp: harakah_check follows render-time props (object or JSON file path)", async () => {
  const lt = path.join(REM, "src/props/LowerThird.tsx");
  const plain = jsonOf(await call("harakah_check", { path: lt }));
  assert.equal(plain.files.length, 0, "English defaultProps: nothing to fix");
  const obj = jsonOf(await call("harakah_check", { path: lt, props: { name: "ريم الحسن" }, composition: "LowerThird" }));
  assert.ok(obj.files[0].issues.some((i: any) => i.code === "HZ02"));
  const file = jsonOf(await call("harakah_check", { path: lt, props: path.join(REM, "props.ar.json") }));
  assert.ok(file.files[0].issues.some((i: any) => i.code === "HZ08"), "uppercase role via props");
});

test("mcp: harakah_check finds split letters in HTML and in a Remotion file; clean file is clean", async () => {
  const html = jsonOf(await call("harakah_check", { path: path.join(FX, "01-split-inline-block.html") }));
  assert.ok(html.files[0].issues.some((i: any) => i.code === "HZ01" && i.severity === "error"));
  const tsx = jsonOf(await call("harakah_check", { path: path.join(REM, "src/broken/CharSplitTitle.tsx") }));
  assert.ok(tsx.files[0].issues.some((i: any) => i.code === "HZ02"));
  const clean = jsonOf(await call("harakah_check", { path: path.join(FX, "22-clean.html") }));
  assert.equal(clean.summary.errors, 0);
});

test("mcp: harakah_check / harakah_fix on inline Remotion code", async () => {
  const code = fs.readFileSync(path.join(REM, "src/broken/CharSplitTitle.tsx"), "utf8");
  const chk = jsonOf(await call("harakah_check", { code }));
  assert.equal(chk.kind, "remotion");
  assert.ok(chk.issues.length > 0);
  const fx = await call("harakah_fix", { code });
  const meta = jsonOf(fx);
  assert.equal(meta.changed, true);
  assert.match(fx[1].text!, /splitArabic\(/);
  assert.doesNotMatch(fx[1].text!.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /\.split\(""\)/);
  assert.match(fx[1].text!, /harakah:/);
});

test("mcp: harakah_fix writes a fixed HTML file that then passes the gate", async () => {
  const out = path.join(tmp, "fixed.html");
  const meta = jsonOf(await call("harakah_fix", { path: path.join(FX, "01-split-inline-block.html"), out }));
  assert.equal(meta.written, out);
  assert.ok(meta.applied.includes("HZ01"));
  assert.ok(fs.existsSync(out));
  const g = await call("harakah_gate", { path: out });
  assert.equal(jsonOf(g, 1).ok, true, g[0].text);
});

test("mcp: harakah_fix on a Remotion project is a dry run unless write=true", async () => {
  const before = fs.readFileSync(path.join(REM, "src/broken/CharSplitTitle.tsx"), "utf8");
  const fx = await call("harakah_fix", { path: path.join(REM, "src/broken/CharSplitTitle.tsx") });
  assert.equal(jsonOf(fx).written, false);
  assert.match(fx[1].text!, /splitArabic/);
  assert.equal(fs.readFileSync(path.join(REM, "src/broken/CharSplitTitle.tsx"), "utf8"), before);
});

test("mcp: harakah_gate blocks the broken Remotion project and passes the clean composition", async () => {
  const bad = await call("harakah_gate", { path: REM });
  const b = jsonOf(bad, 1);
  assert.equal(b.ok, false);
  assert.match(bad[0].text!, /blocked the render/);
  assert.ok(b.blocking.some((x: any) => x.code === "HZ02" && /CharSplitTitle/.test(x.file)));
  assert.match(b.fixCommand, /--write/);
  const good = await call("harakah_gate", { path: path.join(REM, "src/clean/CleanTitle.tsx") });
  assert.equal(jsonOf(good, 1).ok, true, good[0].text);
});

test("mcp: harakah_compare renders before/after and proves the letters join", { timeout: 120_000 }, async () => {
  const c = await call("harakah_compare", { path: path.join(FX, "01-split-inline-block.html"), outDir: path.join(tmp, "cmp") });
  const v = jsonOf(c);
  assert.equal(v.ok, true);
  assert.ok(v.joins.length > 0 && v.joins.every((j: any) => j.joinedAfter && !j.joinedBefore));
  const img = c.find((x) => x.type === "image");
  assert.ok(img && img.mimeType === "image/png" && Buffer.from(img.data!, "base64").subarray(1, 4).toString() === "PNG");
});

// ---- hooks (Claude Code stdin JSON → stdout JSON) ----
const hook = (mode: string, input: object, env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/claude-hook.ts", mode], { input: JSON.stringify(input), cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};

test("hook pre-render: denies remotion/hyperframes renders of broken Arabic, allows clean and non-render commands", () => {
  const deny = hook("pre-render", { tool_name: "Bash", tool_input: { command: "npx remotion render src/index.ts YearInReview out/y.mp4" }, cwd: REM });
  assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /HZ02/);
  const hf = fs.mkdtempSync(path.join(tmp, "hf-"));
  fs.copyFileSync(path.join(FX, "02-split-runtime.html"), path.join(hf, "index.html"));
  const deny2 = hook("pre-render", { tool_input: { command: `npx hyperframes render ${hf} -o out.mp4` }, cwd: ROOT });
  assert.equal(deny2.hookSpecificOutput.permissionDecision, "deny");
  fs.copyFileSync(path.join(FX, "22-clean.html"), path.join(hf, "index.html"));
  assert.equal(hook("pre-render", { tool_input: { command: `cd ${hf} && npm run render` }, cwd: ROOT }), null);
  assert.equal(hook("pre-render", { tool_input: { command: "ls -la && git status" }, cwd: REM }), null);
  assert.equal(hook("pre-render", { tool_input: { command: "npx remotion render" }, cwd: REM }, { HARAKAH_GATE: "off" }), null);
});

test("hook post-edit: feeds problems back for Arabic compositions, silent for clean/non-Arabic files", () => {
  const r = hook("post-edit", { tool_name: "Write", tool_input: { file_path: path.join(REM, "src/broken/CharSplitTitle.tsx") } });
  assert.equal(r.decision, "block");
  assert.match(r.reason, /HZ02/);
  assert.match(r.reason, /before rendering/);
  assert.equal(r.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(hook("post-edit", { tool_input: { file_path: path.join(FX, "22-clean.html") } }), null);
  assert.equal(hook("post-edit", { tool_input: { file_path: path.join(ROOT, "package.json") } }), null);
});

test("hook post-edit HARAKAH_AUTOFIX=1 repairs the file in place", () => {
  const f = path.join(tmp, "auto.html");
  fs.copyFileSync(path.join(FX, "01-split-inline-block.html"), f);
  const r = hook("post-edit", { tool_input: { file_path: f } }, { HARAKAH_AUTOFIX: "1" });
  assert.match(r.hookSpecificOutput.additionalContext, /auto-fixed/);
  const g = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "gate", f], { cwd: ROOT, encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
});

test("cli gate: exit 1 + JSON on broken, exit 0 on clean", () => {
  const bad = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "gate", path.join(FX, "02-split-runtime.html"), "--json"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
  const ok = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "gate", path.join(FX, "22-clean.html")], { cwd: ROOT, encoding: "utf8" });
  assert.equal(ok.status, 0);
});

test("claude-code installer merges idempotently into an existing project", () => {
  const p = fs.mkdtempSync(path.join(tmp, "proj-"));
  fs.mkdirSync(path.join(p, ".claude"));
  fs.writeFileSync(path.join(p, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] } }));
  for (let i = 0; i < 2; i++) assert.equal(spawnSync(process.execPath, ["integrations/claude-code/install.mjs", p, "--npx"], { cwd: ROOT }).status, 0);
  const s = JSON.parse(fs.readFileSync(path.join(p, ".claude/settings.json"), "utf8"));
  assert.deepEqual(s.permissions, { allow: ["Bash(ls)"] });
  const pre = s.hooks.PreToolUse.flatMap((g: any) => g.hooks.map((h: any) => h.command));
  assert.deepEqual(pre, ["echo mine", "npx --no-install harakah-hook pre-render"]);
  assert.equal(s.hooks.PostToolUse.length, 1);
  assert.ok(fs.existsSync(path.join(p, ".claude/skills/harakah/SKILL.md")));
  assert.ok(fs.existsSync(path.join(p, ".claude/skills/harakah/references/arabic-motion.md")), "the motion guidance the skill links to is installed with it");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p, ".mcp.json"), "utf8")).mcpServers.harakah.args, ["--no-install", "harakah-mcp"]);
});

test("claude-code plugin: manifests are consistent and the launcher runs the MCP server, hooks and CLI from this checkout", async () => {
  const P = path.join(ROOT, "integrations/claude-code/plugin");
  const manifest = JSON.parse(fs.readFileSync(path.join(P, ".claude-plugin/plugin.json"), "utf8"));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(manifest.name, "harakah");
  assert.equal(market.plugins[0].name, manifest.name, "entry name = manifest name");
  assert.ok(fs.existsSync(path.join(ROOT, market.plugins[0].source, ".claude-plugin/plugin.json")));
  assert.match(fs.readFileSync(path.join(P, "skills/harakah/SKILL.md"), "utf8"), /^---\nname: harakah\n/);
  // every skill copy links to the motion guidance, and the guidance it links to is the same file everywhere
  const guide = fs.readFileSync(path.join(P, "skills/harakah/references/arabic-motion.md"), "utf8");
  for (const d of ["integrations/claude-code/plugin/skills/harakah", "integrations/claude-code/skills/harakah", ".claude/skills/harakah", "integrations/agent-skill/skills/harakah"]) {
    assert.match(fs.readFileSync(path.join(ROOT, d, "SKILL.md"), "utf8"), /\(references\/arabic-motion\.md\)/, d);
    assert.equal(fs.readFileSync(path.join(ROOT, d, "references/arabic-motion.md"), "utf8"), guide, d);
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(P, "hooks/hooks.json"), "utf8")).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "PreToolUse"]);
  const launcher = path.join(P, "scripts/harakah.cjs");
  // CLI through bin/ (what Claude's Bash tool sees on PATH)
  const g = spawnSync(path.join(P, "bin/harakah-fix"), ["gate", path.join(FX, "02-split-runtime.html")], { encoding: "utf8" });
  assert.equal(g.status, 1, g.stderr);
  // hook through the launcher, exactly as hooks.json invokes it
  const h = spawnSync(process.execPath, [launcher, "hook", "pre-render"], { input: JSON.stringify({ tool_input: { command: "npx remotion render" }, cwd: REM }), encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: P } });
  assert.equal(JSON.parse(h.stdout).hookSpecificOutput.permissionDecision, "deny");
  // MCP server through the launcher, as .mcp.json starts it
  const c = new Client({ name: "plugin-test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [launcher, "mcp"], cwd: ROOT, stderr: "pipe" }));
  assert.equal((await c.listTools()).tools.length, 4);
  const r: any = await c.callTool({ name: "harakah_gate", arguments: { path: path.join(FX, "22-clean.html") } });
  assert.equal(JSON.parse(r.content[1].text).ok, true);
  await c.close();
});

test("agent skill (npx skills add): Agent Skills frontmatter, and every command runs through npx", () => {
  const dir = path.join(ROOT, "integrations/agent-skill/skills/harakah");
  const md = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)![1];
  const field = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(fm)?.[1] ?? "";
  // agentskills.io: name = parent folder, lowercase/digits/hyphens, ≤ 64; description ≤ 1024; compatibility ≤ 500
  assert.equal(field("name"), path.basename(dir));
  assert.match(field("name"), /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/);
  assert.ok(field("description").length > 0 && field("description").length <= 1024);
  assert.ok(field("compatibility").length <= 500);
  // no plugin, no MCP outside Claude Code: the CLI comes from npm, and no step depends on an MCP tool
  assert.match(md, /npx -y -p harakah-fixer harakah-fix/);
  assert.doesNotMatch(md, /scripts\/\w+\.sh|MCP: `harakah_/);
  for (const sub of ["check", "fix", "gate", "compare", "audit"]) assert.match(md, new RegExp("`harakah-fix " + sub + "\\b"), sub);
});
