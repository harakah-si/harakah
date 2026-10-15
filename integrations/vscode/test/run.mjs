// Real-editor test: downloads a pinned VS Code (cached in .vscode-test/), opens a temp workspace with an HTML page
// and an Astro template, and runs test/suite.cjs inside it with this extension loaded. `npm run test:vscode`
// (Linux CI: under xvfb-run). The extension talks to this repo's built CLI (dist/cli.js).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, "..");
const repo = path.resolve(ext, "../..");
const cli = path.join(repo, "dist/cli.js");
if (!fs.existsSync(cli)) { console.error("dist/cli.js missing: run `npm run build` first"); process.exit(2); }
const VERSION = process.env.HARAKAH_VSCODE_VERSION || "1.141.0"; // pinned for reproducible runs; Dependabot can't bump this, update by hand

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "harakah-vscode-"));
const put = (rel, s) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), s); };
put("package.json", '{"name":"vscode-e2e","private":true}\n');
put(".vscode/settings.json", JSON.stringify({ "harakah.command": `"${process.execPath}" "${cli}"`, "harakah.language": "en" }, null, 2));
put("page.html", `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body>\n<h1 style="letter-spacing: .3em">مرحبا بالعالم</h1>\n</body></html>\n`);
put("src/Title.tsx", fs.readFileSync(path.join(repo, "fixtures/24-remotion.tsx"), "utf8"));
put("src/Card.astro", `---\nconst { model } = Astro.props;\n---\n<section lang="ar" dir="rtl">\n  <h2>عرض خاص على iPhone 17 بسعر 999 دولار</h2>\n  <p>السعر {model} دينار</p>\n</section>\n`);

try {
  await runTests({
    version: VERSION,
    extensionDevelopmentPath: ext,
    extensionTestsPath: path.join(here, "suite.cjs"),
    launchArgs: [ws, "--disable-extensions", "--disable-gpu", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
    extensionTestsEnv: { HARAKAH_E2E_WS: ws },
  });
  console.log("vscode e2e: passed");
} catch (e) {
  console.error("vscode e2e: failed", e?.message ?? e);
  process.exitCode = 1;
} finally {
  fs.rmSync(ws, { recursive: true, force: true });
}
