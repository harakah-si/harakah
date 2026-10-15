#!/usr/bin/env node
// Cross-platform smoke test of the built CLI (macOS and Windows CI; Linux runs the full suite). Exercises what a user
// does first: check, fix, gate (exit codes), the Remotion codemod in dry-run, doctor (Chrome found, starts and joins
// Arabic), and one real layout-audit render. Usage: npm run build && node scripts/smoke.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-smoke-"));
const fx = (...p) => path.join(ROOT, "fixtures", ...p);
const results = [];
const ok = (name, cond, extra = "") => { results.push([cond ? "✓" : "✗", name, extra]); if (!cond) process.exitCode = 1; };
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const json = (r) => { try { return JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1)); } catch { return null; } };

try {
  const v = cli("--version");
  ok(`--version is ${pkg.version}`, v.code === 0 && v.out.trim() === pkg.version, v.out.trim());

  const broken = cli("check", fx("01-split-inline-block.html"), "--json");
  ok("check: split Arabic → exit 1 with HZ01", broken.code === 1 && /"HZ01"/.test(broken.out), `exit ${broken.code}`);
  const clean = cli("check", fx("22-clean.html"));
  ok("check: clean Arabic → exit 0", clean.code === 0, `exit ${clean.code}`);

  const out = path.join(tmp, "fixed.html");
  const fix = cli("fix", fx("01-split-inline-block.html"), "-o", out);
  const after = cli("check", out);
  ok("fix → the fixed copy checks clean", fix.code === 0 && fs.existsSync(out) && after.code === 0, `fix ${fix.code}, check ${after.code}: ${after.out.split("\n")[0]}`);

  const gate = cli("gate", fx("remotion"), "--json");
  const g = json(gate);
  ok("gate: broken Remotion project → exit 1, blocking HZ02", gate.code === 1 && g?.ok === false && g.blocking.some((b) => b.code === "HZ02"), `exit ${gate.code}`);
  ok("gate: clean HTML → exit 0", cli("gate", fx("22-clean.html")).code === 0);

  const dry = cli("fix", fx("remotion", "src", "broken", "CharSplitTitle.tsx"), "--dry-run");
  ok("Remotion codemod --dry-run prints a diff", dry.code === 0 && /splitArabic/.test(dry.out), `exit ${dry.code}`);

  const doc = cli("doctor", "--json");
  const d = json(doc);
  const chrome = d?.checks?.find((c) => c.id === "chrome");
  ok("doctor: ready (Chrome found, starts and joins Arabic)", doc.code === 0 && d?.ok === true, chrome ? chrome.en : doc.out.slice(0, 300));

  const audit = cli("audit", fx("02-split-runtime.html"), "--json");
  const a = json(audit);
  ok("audit: a real layout render in Chrome", audit.code !== null && a?.frames > 0 && a?.coverage?.sampled === a.frames, `exit ${audit.code}, ${a?.frames} frames`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const [mark, name, extra] of results) console.log(`${mark} ${name}${extra ? `  (${extra})` : ""}`);
console.log(process.exitCode ? "\nsmoke test FAILED" : `\nsmoke test passed on ${process.platform} (${os.release()})`);
