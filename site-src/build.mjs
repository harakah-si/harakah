// Assemble web/landing.html, the harakah.si landing (single file, production paths: /fonts/, /demo/, /assets/).
// node site-src/build.mjs   (scripts/build-static.mjs then turns it into the deployed site/)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { css } from "./palettes.mjs";
const here = dirname(fileURLToPath(import.meta.url)), rd = (f) => readFileSync(join(here, f), "utf8");
// What the page states about the product comes from the product: the rule count from the built rules, the version
// from package.json. test/consistency.test.ts fails when the committed page disagrees with them.
const ROOT = join(here, "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
let RULES;
try { const m = await import(pathToFileURL(join(ROOT, "dist", "rules.js")).href); RULES = Object.keys(m.RULES).length; }
catch { throw new Error("Run `npm run build` first: the rule count comes from dist/rules.js."); }
const facts = (s) => s.replace(/\{\{RULES\}\}/g, String(RULES)).replace(/\{\{VERSION\}\}/g, VERSION);
const pal = ["mosaic", "blue", "inkpetra"].map(css).join("\n") +
  "\n:root[data-palette=mosaic][data-theme=light]{--acc-t:#755310}"; // gold accent as *text* on marble needs to be a shade deeper for AA on cards
let styles = rd("base.css").replace("/*PALETTES*/", pal) + "\n" + rd("v3.css");
const head = rd("head-meta.html")
  .replace('<meta name="theme-color" content="#0b0b0d" media="(prefers-color-scheme: dark)">', '<meta name="theme-color" content="#0a1411" media="(prefers-color-scheme: dark)">')
  .replace('<meta name="theme-color" content="#f3efe7" media="(prefers-color-scheme: light)">', '<meta name="theme-color" content="#f3efe6" media="(prefers-color-scheme: light)">');
const html = `${head}
<link rel="preload" href="/fonts/Alexandria.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/fonts/IBMPlexSansArabic-Regular.ttf" as="font" type="font/ttf" crossorigin>
<script>
${rd("init.js").trim()}
</script>
<style>
${styles.trim()}
</style>
</head>
${facts(rd("body.html")).trim()}

<script>
${rd("harakah-split.js").trim()}
${rd("term.js").trim()}
${rd("app.js").trim()}
</script>
</body>
</html>
`;
// served by `harakah-fix serve` in a checkout, and built into harakah.si. --check: exit 1 if the committed page is stale
if (process.argv.includes("--check")) {
  if (readFileSync(join(ROOT, "web", "landing.html"), "utf8") !== html) { console.error("web/landing.html is stale: run node site-src/build.mjs"); process.exit(1); }
  process.exit(0);
}
writeFileSync(join(ROOT, "web", "landing.html"), html);
console.log("web/landing.html", (html.length / 1024).toFixed(1) + " KB", `(${RULES} rules, v${VERSION})`);
