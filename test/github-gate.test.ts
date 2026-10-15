// `gate --github`: annotations GitHub shows on the pull request's lines, and a job summary of what blocks the merge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { githubAnnotations, githubSummary, type GateResult } from "../src/gate.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "dist/cli.js");
function gate(args: string[], env: Record<string, string> = {}) {
  const summary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hz-gh-")), "summary.md");
  const r = spawnSync(process.execPath, [CLI, "gate", ...args, "--github"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summary, ...env }, timeout: 120_000 });
  const lines = r.stdout.split("\n").filter((l) => l.startsWith("::"));
  return { code: r.status, lines, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
}

test("gate --github: every blocking problem is an ::error on its file and line, errors first; the summary lists them with the fix", { timeout: 120_000 }, () => {
  const r = gate(["fixtures/remotion"]);
  assert.equal(r.code, 1);
  const errors = r.lines.filter((l) => l.startsWith("::error "));
  const firstWarning = r.lines.findIndex((l) => l.startsWith("::warning "));
  assert.ok(errors.length >= 5 && firstWarning === errors.length, "errors come before warnings");
  for (const e of errors) assert.match(e, /^::error file=fixtures\/remotion\/src\/[\w/]+\.tsx,line=\d+,title=HZ\d\d [^:]+::/);
  assert.ok(errors.some((e) => /CharSplitTitle\.tsx,line=\d+,title=HZ02/.test(e)));
  assert.ok(r.lines.every((l) => !l.includes("\n")), "one physical line per annotation");
  assert.match(r.summary, /^### ❌ Harakah: \d+ Arabic problem\(s\) would render broken/);
  const rows = r.summary.split("\n").filter((l) => l.startsWith("| `"));
  assert.equal(rows.length, errors.length);
  assert.match(r.summary, /```\nharakah-fix fix fixtures\/remotion --write\n```/);
});

test("gate --github: a clean file passes with no error annotation and a passing summary", { timeout: 60_000 }, () => {
  const r = gate(["fixtures/22-clean.html"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines.filter((l) => l.startsWith("::error")), []);
  assert.match(r.summary, /^### ✅ Harakah: Arabic is safe to render/);
});

test("gate --github: workflow-command escaping, and a check that couldn't run is an error", { timeout: 60_000 }, () => {
  const issue = { code: "HZ01", name: "x", severity: "error", title: { en: "Split, broken: letters", ar: "" }, why: { en: "", ar: "" }, message: { en: "100% split\nnext line", ar: "عربي" }, fixMode: "auto", fixable: true, line: 3 } as any;
  const file = path.join(ROOT, "fixtures", "01-split-inline-block.html");
  const g = { ok: false, target: ".", files: [{ file, kind: "html", issues: [issue] }], blocking: [], summary: { errors: 1, warnings: 0, info: 0, autoFixable: 1 }, inconclusive: [{ file: "a,b.html", reason: "Chrome: missing" }], message: "" } as GateResult;
  const [a, b] = githubAnnotations(g, { cwd: ROOT });
  assert.equal(a, "::error file=fixtures/01-split-inline-block.html,line=3,title=HZ01 Split%2C broken%3A letters::100%25 split%0Anext line (auto-fixable: harakah-fix fix)%0Aعربي");
  assert.equal(b, "::error file=a%2Cb.html,title=Harakah could not check this::Chrome: missing%0ASet HARAKAH_GATE=lenient to pass without this check.");
  assert.match(githubSummary(g), /couldn't finish checking[\s\S]*Not checked:\n- `a,b\.html`: Chrome: missing/);

  const r = gate(["fixtures/22-clean.html", "--layout"], { HARAKAH_CHROME: "/nonexistent/chrome" });
  assert.equal(r.code, 2);
  assert.ok(r.lines.some((l) => l.startsWith("::error file=fixtures/22-clean.html,title=Harakah could not check this::")), r.lines.join("\n"));
});

test("the shipped workflow runs gate --github on pull requests", () => {
  const yml = fs.readFileSync(path.join(ROOT, "integrations/github-actions/harakah.yml"), "utf8");
  assert.match(yml, /on:\n  pull_request:/);
  assert.match(yml, /run: npx -y -p harakah-fixer@0\.\d+ harakah-fix gate \. --github\n/);
  assert.match(yml, /permissions:\n  contents: read/);
  const minor = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version.split(".").slice(0, 2).join(".");
  assert.ok(yml.includes(`harakah-fixer@${minor} `), `the workflow pins the current minor version (${minor})`);
});
