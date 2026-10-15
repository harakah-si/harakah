import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderTarget } from "../src/claude-hook.ts";
import { fixRemotion } from "../src/remotion/project.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("hook: renderTarget handles single-quoted cd and flags before the hyperframes dir", () => {
  assert.equal(renderTarget("cd '/my proj' && npx remotion render", "/w"), "/my proj");
  assert.equal(renderTarget("hyperframes render --out ./dist ./scenes", "/w"), "/w/scenes");
  assert.equal(renderTarget("hyperframes render --out=./dist ./scenes", "/w"), "/w/scenes");
  assert.equal(renderTarget("hyperframes render ./scenes --out x", "/w"), "/w/scenes");
  assert.equal(renderTarget("cd \"/a b\" && hyperframes render", "/w"), "/a b");
});

test("remotion: a lone .tsx next to an unreadable folder is fixed, not an EACCES crash", { skip: process.getuid?.() === 0 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-eacces-"));
  fs.mkdirSync(path.join(d, "locked")); fs.chmodSync(path.join(d, "locked"), 0o000);
  const f = path.join(d, "T.tsx");
  fs.writeFileSync(f, `export const T = () => <h1 style={{ letterSpacing: 4 }}>مرحبا</h1>;\n`);
  try { const r = await fixRemotion(f, { dryRun: true }); assert.ok(r.files.length >= 1); }
  finally { fs.chmodSync(path.join(d, "locked"), 0o755); }
});

test("cli: --only tolerates spaces after commas (\"HZ01, HZ07\")", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-only-"));
  const f = path.join(d, "r.tsx");
  fs.writeFileSync(f, `export const T = () => <h1 dir="rtl" style={{ letterSpacing: 4 }}>مرحبا</h1>;\n`);
  const run = (only: string) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "check", f, "--lang", "en", "--json", "--only", only], { cwd: ROOT, encoding: "utf8" }).stdout;
  const codes = (s: string) => JSON.parse(s).results.flatMap((x: any) => x.issues.map((i: any) => i.code)).sort();
  assert.deepEqual(codes(run("HZ01, HZ07")), codes(run("HZ01,HZ07")));
  assert.ok(codes(run("HZ01, HZ07")).includes("HZ07"));
});
