// Shipped manifests that track the package version must match package.json (bumped by scripts/sync-versions.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
const version = read("package.json").version;

test("Claude Code plugin version matches package.json", () => {
  assert.equal(read("integrations/claude-code/plugin/.claude-plugin/plugin.json").version, version);
});

test("npm version hook keeps tracked manifests in sync", () => {
  const scripts = read("package.json").scripts;
  assert.match(scripts.version ?? "", /sync-versions\.mjs/);
});
