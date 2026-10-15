// Keep shipped manifests that track the harakah-fixer version in step with package.json.
// Runs from the npm "version" lifecycle (npm version patch|minor|major), so a bump updates and stages them.
// `--check` only reports drift (exit 1). The VS Code extension and @harakah/remotion-arabic version on their own.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TRACKED = ["integrations/claude-code/plugin/.claude-plugin/plugin.json"];
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const check = process.argv.includes("--check");
let drift = 0;
for (const rel of TRACKED) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, "utf8");
  const have = JSON.parse(text).version;
  if (have === version) continue;
  if (check) { console.error(`${rel}: ${have} != package.json ${version}`); drift++; continue; }
  fs.writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));
  console.log(`${rel}: ${have} → ${version}`);
}
process.exit(drift ? 1 : 0);
