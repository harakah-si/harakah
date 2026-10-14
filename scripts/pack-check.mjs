#!/usr/bin/env node
// Publish dry run: `npm pack`, inspect the tarball, install it into a fresh temp project and smoke-test every
// entry point there (CLI, library, harakah-fixer/remotion, MCP server, Claude Code hook, web server).
// Never publishes anything. Usage: npm run pack:check   (add --keep to leave the temp project for inspection)
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const keep = process.argv.includes("--keep");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-pack-"));
const results = [];
const ok = (name, cond, extra = "") => { results.push([cond ? "✓" : "✗", name, extra]); if (!cond) process.exitCode = 1; };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const npx = (args, opts = {}) => run(path.join(proj, "node_modules", ".bin", args[0]), args.slice(1), { cwd: proj, ...opts });

// 1. pack
const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: ROOT }))[0];
const files = packed.files.map((f) => f.path);
const tgz = path.join(tmp, packed.filename);
ok(`npm pack → ${packed.filename}`, fs.existsSync(tgz), `${(packed.size / 1e6).toFixed(1)} MB packed, ${(packed.unpackedSize / 1e6).toFixed(1)} MB unpacked, ${files.length} files`);
ok("tarball under 15 MB", packed.size < 15e6);
for (const f of ["dist/cli.js", "dist/mcp.js", "dist/claude-hook.js", "dist/index.d.ts", "integrations/remotion/index.cjs", "integrations/remotion/index.d.ts", "integrations/remotion/studio-overlay.cjs",
  "integrations/claude-code/plugin/.claude-plugin/plugin.json", "packages/remotion-arabic/src/index.tsx", "assets/fonts/OFL-ibmplexsansarabic.txt", "web/index.html", "LICENSE", "README.md"])
  ok(`includes ${f}`, files.includes(f));
const bad = files.filter((f) => /^(test|design|scripts|docs|\.github|\.tmp)\/|node_modules\/|\.env|harakah-compare\//.test(f));
ok("no tests/design/node_modules/secrets in the tarball", !bad.length, bad.slice(0, 5).join(", "));
const fonts = files.filter((f) => /^assets\/fonts\/.*\.ttf$/.test(f));
const ofl = new Set(files.filter((f) => /OFL-.*\.txt$/.test(f)).map((f) => path.basename(f).replace(/^OFL-|\.txt$/g, "").toLowerCase()));
ok("every bundled font family ships its OFL text", fonts.every((f) => ofl.has(path.basename(f).replace(/(-\w+)?\.ttf$/, "").toLowerCase())), [...ofl].join(", "));
ok("no Thmanyah font bundled", !files.some((f) => /\.(ttf|otf|woff2?)$/i.test(f) && /thmanyah/i.test(f)));

// 2. install into a fresh project
const proj = path.join(tmp, "app");
fs.mkdirSync(proj);
fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "harakah-pack-smoke", private: true, version: "1.0.0" }, null, 2));
const t0 = Date.now();
run("npm", ["install", tgz, "--no-audit", "--no-fund", "--loglevel=error"], { cwd: proj });
ok("npm install <tarball> in a fresh project", fs.existsSync(path.join(proj, "node_modules", "harakah-fixer", "dist", "cli.js")), `${((Date.now() - t0) / 1000).toFixed(0)} s`);

// 3. smoke tests from the installed package
const home = path.join(proj, "node_modules", "harakah-fixer");
ok("harakah-fix --version", npx(["harakah-fix", "--version"]).trim() === pkg.version, pkg.version);
const broken = path.join(home, "fixtures", "01-split-inline-block.html");
let rep;
try { npx(["harakah-fix", "check", broken, "--json"]); } catch (e) { rep = JSON.parse(e.stdout); }
ok("check (HTML) finds the split-letter error, exit 1", rep && rep.summary.errors > 0 && rep.issues.some((i) => i.code === "HZ01"));
npx(["harakah-fix", "fix", broken, "-o", "out/fixed.html"]);
ok("fix (HTML) writes the fixed file (ZWJ-padded letters)", fs.readFileSync(path.join(proj, "out/fixed.html"), "utf8").includes("\u200d"));
npx(["harakah-fix", "fix", path.join(home, "fixtures", "10-latin-font.html"), "-o", "out/font.html"]);
const fontDir = path.join(proj, "out/fonts");
ok("fix (HTML, Latin-only font) copies the OFL font + its license", fs.existsSync(fontDir) && fs.readdirSync(fontDir).some((f) => /\.ttf$/.test(f)) && fs.readdirSync(fontDir).some((f) => /OFL/.test(f)), fs.existsSync(fontDir) ? fs.readdirSync(fontDir).join(", ") : "");
fs.mkdirSync(path.join(proj, "src"), { recursive: true });
fs.writeFileSync(path.join(proj, "src", "Title.tsx"), `export const Title = () => <h1 style={{ letterSpacing: 4 }}>{"مرحبا بكم".split("").map((c, i) => <span key={i} style={{ display: "inline-block" }}>{c}</span>)}</h1>;\n`);
npx(["harakah-fix", "fix", "src/Title.tsx", "--write"]);
const tsx = fs.readFileSync(path.join(proj, "src", "Title.tsx"), "utf8");
ok("fix (Remotion .tsx) codemod + vendored helper", /splitArabic\(/.test(tsx) && /dir="rtl"/.test(tsx) && fs.existsSync(path.join(proj, "src", "harakah-arabic.tsx")));
const lib = run(process.execPath, ["--input-type=module", "-e", `import * as m from "harakah-fixer"; console.log(JSON.stringify({ analyze: typeof m.analyze, fixRemotion: typeof m.fixRemotion, gate: typeof m.gate, version: m.VERSION }))`], { cwd: proj });
const l = JSON.parse(lib);
ok("library import (ESM)", l.analyze === "function" && l.fixRemotion === "function" && l.gate === "function" && l.version === pkg.version);
const cjs = run(process.execPath, ["-e", `const r = require("harakah-fixer/remotion"); console.log(typeof r.withHarakah, require("fs").existsSync(r.OVERLAY))`], { cwd: proj }).trim();
ok("require('harakah-fixer/remotion') (CJS, remotion.config.ts)", cjs === "function true");
const hook = run(path.join(proj, "node_modules", ".bin", "harakah-hook"), ["pre-render"], { cwd: proj, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }), stdio: ["pipe", "pipe", "pipe"] });
ok("harakah-hook pre-render (non-render command → allow)", hook.trim() === "");

// MCP: initialize + tools/list over stdio
const tools = await new Promise((resolve) => {
  const p = spawn(path.join(proj, "node_modules", ".bin", "harakah-mcp"), [], { cwd: proj, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  const done = (v) => { clearTimeout(timer); p.kill(); resolve(v); };
  const timer = setTimeout(() => done(null), 20000);
  p.stdout.on("data", (d) => {
    buf += d;
    for (const line of buf.split("\n")) {
      try { const m = JSON.parse(line); if (m.id === 1) p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n" + JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n"); if (m.id === 2) done(m.result.tools.map((t) => t.name)); } catch { /* partial */ }
    }
  });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pack-check", version: "1" } } }) + "\n");
});
ok("harakah-mcp: initialize + tools/list", Array.isArray(tools) && tools.length === 4, (tools || []).join(", "));

// web tool
const port = 4800 + Math.floor(Math.random() * 100);
const srv = spawn(path.join(proj, "node_modules", ".bin", "harakah-fix"), ["serve", "--port", String(port)], { cwd: proj, stdio: "ignore" });
let page = 0, meta = null;
for (let i = 0; i < 60 && !meta; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { page = (await fetch(`http://127.0.0.1:${port}/`)).status; meta = await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json(); } catch { /* starting */ }
}
srv.kill();
ok("harakah-fix serve: page + examples", page === 200 && meta && meta.version === pkg.version && meta.examples.length > 5 && meta.remotionExamples.length > 3, meta ? `${meta.examples.length} HTML + ${meta.remotionExamples.length} Remotion examples` : "");

for (const [s, n, x] of results) console.log(`${s} ${n}${x ? `  (${x})` : ""}`);
console.log(process.exitCode ? "\npack check FAILED" : `\npack check passed: ${packed.filename} installs and runs cleanly (nothing was published)`);
if (keep) console.log(`temp project kept at ${proj}`); else fs.rmSync(tmp, { recursive: true, force: true });
