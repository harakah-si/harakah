// Render-time props (`remotion render … --props props.json`): Arabic that only arrives at render time is
// followed like defaultProps in check/fix/gate, the Claude Code pre-render hook, withHarakah() and compare.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { analyzeArabicProps } from "../src/remotion/props.ts";
import { loadInputProps, parseRenderArgs, shellSplit } from "../src/remotion/input-props.ts";
import { compareRemotion } from "../src/remotion/compare.ts";

const ROOT = path.resolve(".");
const FIX = path.resolve("fixtures/remotion");
const TSX = import.meta.resolve("tsx"); // absolute: the temp project's node_modules has no tsx
const AR = { name: "ريم الحسن", role: "مخرجة الفيلم" };
let proj: string;

const srcFiles = () => {
  const out: { file: string; src: string }[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) out.push({ file: p, src: fs.readFileSync(p, "utf8") }); } };
  walk(path.join(FIX, "src"));
  return out;
};
const feedOf = (m: Map<string, any[]>, comp: string) => [...m.values()].flat().find((f) => f.component === comp);

before(() => {
  // a small Remotion project whose only composition has English defaultProps (clean until --props brings Arabic)
  proj = fs.mkdtempSync(path.join(os.tmpdir(), "hz-props-"));
  fs.mkdirSync(path.join(proj, "src/props"), { recursive: true });
  for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(FIX, f), path.join(proj, f));
  fs.symlinkSync(path.join(FIX, "node_modules"), path.join(proj, "node_modules"), "dir");
  fs.copyFileSync(path.join(FIX, "src/props/LowerThird.tsx"), path.join(proj, "src/props/LowerThird.tsx"));
  fs.writeFileSync(path.join(proj, "src/Root.tsx"), `import React from "react";\nimport { Composition } from "remotion";\nimport { LowerThird } from "./props/LowerThird";\nexport const RemotionRoot: React.FC = () => <Composition id="LowerThird" component={LowerThird} durationInFrames={30} width={1280} height={720} fps={30} defaultProps={{ name: "Guest name", role: "Producer" }} />;\n`);
  fs.writeFileSync(path.join(proj, "src/index.ts"), `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root";\nregisterRoot(RemotionRoot);\n`);
  fs.writeFileSync(path.join(proj, "props.ar.json"), JSON.stringify(AR));
});
after(() => fs.rmSync(proj, { recursive: true, force: true }));

test("input props: parsing helpers (JSON or file, shell words, remotion argv)", () => {
  assert.deepEqual(loadInputProps('{"a":"ب"}'), { a: "ب" });
  assert.deepEqual(loadInputProps("props.ar.json", proj), AR);
  assert.equal(loadInputProps(undefined), undefined);
  assert.throws(() => loadInputProps("nope.json", proj), /file not found/);
  assert.throws(() => loadInputProps("[1]"), /file not found|JSON object/);
  assert.throws(() => loadInputProps("{bad"), /invalid JSON/);
  assert.deepEqual(shellSplit(`cd "my dir" && npx remotion render LowerThird out.mp4 --props='{"name":"ريم"}'`),
    ["cd", "my dir", "&", "&", "npx", "remotion", "render", "LowerThird", "out.mp4", `--props={"name":"ريم"}`]);
  assert.deepEqual(parseRenderArgs(shellSplit("npx remotion render src/index.ts LowerThird out/v.mp4 --props props.ar.json --codec h264")),
    { props: "props.ar.json", compositions: ["LowerThird", "h264"] });
  assert.deepEqual(parseRenderArgs(["npx", "remotion", "still", "Intro", "--props=p.json"]), { props: "p.json", compositions: ["Intro"] });
});

test("input props: Arabic --props feed the rendered composition only; unknown ids mean all; getInputProps() callers", () => {
  const files = srcFiles();
  assert.equal(feedOf(analyzeArabicProps(files), "LowerThird"), undefined, "English defaultProps: not Arabic");
  const fed = feedOf(analyzeArabicProps(files, { inputProps: AR, composition: ["LowerThird"] }), "LowerThird");
  assert.deepEqual(fed.props.sort(), ["name", "role"]);
  assert.match(fed.reasons.join(), /--props \(render-time\) for <Composition id="LowerThird">/);
  // props for another composition do not leak into LowerThird; non-Arabic keys are ignored
  assert.equal(feedOf(analyzeArabicProps(files, { inputProps: { title: "عنوان", n: 3 }, composition: "PropsTitle" }), "LowerThird"), undefined);
  // candidates that are not composition ids (flag values like h264) are ignored → falls back to the matching one / all
  assert.ok(feedOf(analyzeArabicProps(files, { inputProps: AR, composition: ["h264", "LowerThird"] }), "LowerThird"));
  assert.ok(feedOf(analyzeArabicProps(files, { inputProps: AR, composition: ["h264"] }), "LowerThird"));
  assert.equal(feedOf(analyzeArabicProps(files, { inputProps: { name: "Rim" } }), "LowerThird"), undefined, "Latin props stay Latin");
  // nested Arabic counts for the top-level key
  assert.deepEqual(feedOf(analyzeArabicProps(files, { inputProps: { name: { first: "ريم" } }, composition: "LowerThird" }), "LowerThird").props, ["name"]);
  // getInputProps(): the component reads render-time props directly
  const gi = [{ file: "/v/src/Ticker.tsx", src: `import { getInputProps } from "remotion";\nexport const Ticker = () => { const { line } = getInputProps(); return <div style={{ letterSpacing: 4 }}>{line}</div>; };` }];
  assert.deepEqual(feedOf(analyzeArabicProps(gi, { inputProps: { line: "عاجل" } }), "Ticker").props, ["getInputProps()"]);
  assert.equal(feedOf(analyzeArabicProps(gi, { inputProps: { line: "Breaking" } }), "Ticker"), undefined);
});

const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", TSX, path.join(ROOT, "src/cli.ts"), ...args], { cwd: proj, encoding: "utf8" });

test("input props: CLI check/gate/fix follow --props (file or inline JSON) and the fix command keeps it", () => {
  assert.equal(cli("gate", ".").status, 0, "clean without --props");
  const g = cli("gate", ".", "--json", "--props", "props.ar.json");
  assert.equal(g.status, 1, g.stderr);
  const j = JSON.parse(g.stdout);
  assert.ok(j.blocking.some((b: any) => b.code === "HZ02" && /LowerThird/.test(b.file)));
  assert.match(j.fixCommand, /--write --props props\.ar\.json$/);
  const inline = cli("gate", ".", "--json", "--props", JSON.stringify(AR), "--composition", "LowerThird");
  assert.equal(inline.status, 1);
  assert.match(JSON.parse(inline.stdout).fixCommand, /--props '\{"name":"ريم الحسن"/);
  assert.equal(cli("gate", ".", "--props", JSON.stringify(AR), "--composition", "Other").status, 1, "unknown id → all compositions");
  const c = JSON.parse(cli("check", ".", "--json", "--props", "props.ar.json").stdout);
  assert.deepEqual(c.props.map((p: any) => p.component), ["LowerThird"]);
  assert.equal(cli("gate", ".", "--props", "missing.json").status, 2);
  // fix with --props, then the gate passes with the same props
  assert.equal(cli("fix", ".", "--write", "--props", "props.ar.json").status, 0);
  assert.match(fs.readFileSync(path.join(proj, "src/props/LowerThird.tsx"), "utf8"), /splitArabic\(name\)/);
  assert.equal(cli("gate", ".", "--props", "props.ar.json").status, 0);
  fs.copyFileSync(path.join(FIX, "src/props/LowerThird.tsx"), path.join(proj, "src/props/LowerThird.tsx"));
  fs.rmSync(path.join(proj, "src/harakah-arabic.tsx"), { force: true });
});

test("input props: Claude Code pre-render hook reads --props and the composition id from the render command", () => {
  const hook = (command: string) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/claude-hook.ts", "pre-render"], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: proj }), cwd: ROOT, encoding: "utf8" });
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  assert.equal(hook("npx remotion render LowerThird out/v.mp4"), null);
  const d = hook("npx remotion render LowerThird out/v.mp4 --props=props.ar.json");
  assert.equal(d.hookSpecificOutput.permissionDecision, "deny");
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /--props props\.ar\.json/);
  assert.equal(hook(`npx remotion render LowerThird --props '${JSON.stringify(AR)}'`).hookSpecificOutput.permissionDecision, "deny");
});

test("input props: withHarakah() follows --props from the Remotion CLI argv (real @remotion/bundler)", { timeout: 300_000 }, async () => {
  const { bundle } = createRequire(path.join(FIX, "package.json"))("@remotion/bundler");
  const { withHarakah } = createRequire(import.meta.url)("../integrations/remotion/index.cjs");
  const base = { cli: path.join(ROOT, "src/cli.ts"), nodeArgs: ["--import", TSX], root: proj };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-bp-"));
  const cwd = process.cwd();
  process.chdir(proj); // `--props props.ar.json` is relative to where remotion runs
  try {
    await assert.rejects(
      bundle({ entryPoint: path.join(proj, "src/index.ts"), outDir: path.join(out, "a"), webpackOverride: withHarakah({ ...base, argv: ["node", "remotion", "render", "LowerThird", "out.mp4", "--props", "props.ar.json"] }) }),
      (e: Error) => /Harakah: \d+ Arabic problem/.test(e.message) && /LowerThird\.tsx/.test(e.message));
    await assert.rejects(bundle({ entryPoint: path.join(proj, "src/index.ts"), outDir: path.join(out, "b"), webpackOverride: withHarakah({ ...base, argv: false, inputProps: AR }) }), /Harakah/);
    const ok = await bundle({ entryPoint: path.join(proj, "src/index.ts"), outDir: path.join(out, "c"), webpackOverride: withHarakah({ ...base, argv: ["node", "remotion", "render", "LowerThird"] }) });
    assert.ok(fs.existsSync(path.join(ok, "index.html")));
  } finally { process.chdir(cwd); fs.rmSync(out, { recursive: true, force: true }); }
});

test("input props: real render with --props: before is broken, after matches running text", { timeout: 300_000 }, async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-lt-"));
  const r = await compareRemotion(FIX, { outDir, compositions: ["LowerThird"], inputProps: AR, composition: ["LowerThird"] });
  const x = r.renders[0];
  assert.ok(r.fix.files.some((f) => /LowerThird/.test(f.file) && /splitArabic\(name\)/.test(f.after)));
  assert.equal(x.joinedBefore, false);
  assert.equal(x.joinedAfter, true, `after ${x.after.components}/${x.after.width} ref ${x.reference.components}/${x.reference.width} diff ${x.diffAfter}`);
  assert.ok(x.before.components > x.reference.components);
  fs.rmSync(outDir, { recursive: true, force: true });
});
