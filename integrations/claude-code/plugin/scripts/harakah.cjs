#!/usr/bin/env node
// Launcher used by the plugin's MCP server, hooks and bin/harakah-fix. It finds the Harakah engine
// (harakah-fixer's dist/) and runs the requested entry point:
//   harakah.cjs cli <args…> | mcp | hook <post-edit|pre-render>
// Lookup order: $HARAKAH_HOME → the project's node_modules/harakah-fixer → this checkout (plugin loaded in
// place via a local marketplace or --plugin-dir) → a global `harakah-fix` on PATH.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ENTRY = { cli: "cli.js", mcp: "mcp.js", hook: "claude-hook.js" };
const hasDist = (d) => d && fs.existsSync(path.join(d, "dist", "cli.js")) ? d : undefined;

function fromPath() {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const bin = path.join(dir, "harakah-fix");
    if (!fs.existsSync(bin)) continue;
    try {
      const real = fs.realpathSync(bin); // …/harakah-fixer/dist/cli.js
      const home = path.resolve(path.dirname(real), "..");
      if (hasDist(home)) return home;
    } catch {}
  }
  return undefined;
}

function findHome() {
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const checkout = path.resolve(__dirname, "..", "..", "..", "..");
  const isCheckout = (() => { try { return JSON.parse(fs.readFileSync(path.join(checkout, "package.json"), "utf8")).name === "harakah-fixer"; } catch { return false; } })();
  return hasDist(process.env.HARAKAH_HOME)
    || hasDist(path.join(project, "node_modules", "harakah-fixer"))
    || (isCheckout ? hasDist(checkout) : undefined)
    || fromPath();
}

const [mode, ...args] = process.argv.slice(2);
if (!ENTRY[mode]) { console.error("usage: harakah.cjs cli|mcp|hook …"); process.exit(2); }
const home = findHome();
if (!home) {
  const msg = "Harakah engine not found: add harakah-fixer to the project (npm i -D harakah-fixer), install it globally, or set HARAKAH_HOME to a built checkout.";
  if (mode === "hook") { process.stderr.write(`harakah: ${msg}\n`); process.exit(0); } // never block a session
  console.error(msg); process.exit(2);
}
if (process.env.HARAKAH_WHICH) { console.log(home); process.exit(0); }
const child = spawn(process.execPath, [path.join(home, "dist", ENTRY[mode]), ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
