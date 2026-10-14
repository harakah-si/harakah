// Things that drift when one part of the product changes and the rest doesn't: the palette (harakah.si, the web tool,
// /tool/, theme colors, icons and share images), the commands the pages and docs show, and default languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";
// @ts-ignore plain JS module shared with the landing build
import { P } from "../site-src/palettes.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = P.mosaic as Record<"dark" | "light", Record<string, string>>;
const tokens = (css: string) => Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2].toLowerCase()]));
const block = (src: string, sel: string) => src.slice(src.indexOf(sel), src.indexOf("}", src.indexOf(sel)));
// the landing deepens the gold for text on the light theme (site-src/build.mjs); everything else follows it
const LIGHT_ACC_T = read("site-src/build.mjs").match(/\[data-theme=light\]\{--acc-t:(#\w+)\}/)![1];

test("consistency: the web tool uses the Mosaic palette of harakah.si", () => {
  const html = read("web/index.html");
  for (const th of ["dark", "light"] as const) {
    const t = tokens(block(html, `[data-theme="${th}"]{`)), m = M[th];
    const want = { bg: m.bg, surface: m.bg2, surface2: m.card, border: m.line, text: m.ink, muted: m.mute, accent: m.acc, "accent-ink": m.onAcc, ok: m.ok, err: m.err, "accent-t": th === "light" ? LIGHT_ACC_T : m.acc };
    for (const [k, v] of Object.entries(want)) assert.equal(t[k], v.toLowerCase(), `web/index.html ${th} --${k}`);
  }
  assert.match(html, new RegExp(`<meta name="theme-color" content="${M.dark.bg}" media="\\(prefers-color-scheme: dark\\)">`));
  assert.match(html, new RegExp(`<meta name="theme-color" content="${M.light.bg}" media="\\(prefers-color-scheme: light\\)">`));
  const man = JSON.parse(read("web/site.webmanifest"));
  assert.equal(man.background_color, M.dark.bg); assert.equal(man.theme_color, M.dark.bg);
});

test("consistency: the /tool/ page uses the same palette", () => {
  const html = read("site-src/tool.html");
  for (const th of ["dark", "light"] as const) {
    const t = tokens(block(html, `:root[data-theme=${th}]{`)), m = M[th];
    for (const [k, v] of Object.entries({ bg: m.bg, bg2: m.bg2, card: m.card, line: m.line, ink: m.ink, mute: m.mute, acc: m.acc, ok: m.ok })) assert.equal(t[k], v.toLowerCase(), `tool.html ${th} --${k}`);
  }
});

// share images and icons: mostly palette background, some palette gold, none of the retired orange (#ff5a36)
const rgb = (h: string) => h.slice(1).match(/../g)!.map((x) => parseInt(x, 16));
const near = (px: Buffer, i: number, c: number[], d: number) => Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]) <= d;
test("consistency: icons and share images are drawn in the palette (site-src/brand.mjs)", () => {
  const bg = rgb(M.dark.bg), gold = rgb(M.dark.acc), orange = rgb("#ff5a36");
  for (const f of ["og-ar.png", "og-en.png", "icon-512.png", "icon-192.png", "apple-touch-icon.png", "favicon-32.png"]) {
    const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, "web/assets", f)));
    let n = 0, onBg = 0, onGold = 0, onOrange = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] < 250) continue; n++;
      if (near(png.data, i, bg, 24)) onBg++; else if (near(png.data, i, gold, 40)) onGold++; else if (near(png.data, i, orange, 60)) onOrange++;
    }
    assert.ok(onGold / n > 0.004, `${f}: palette gold present (${((onGold / n) * 100).toFixed(2)}%)`);
    assert.ok(onOrange / n < 0.0005, `${f}: no retired orange (${((onOrange / n) * 100).toFixed(3)}%)`);
    assert.ok(onBg / n > (f.startsWith("og") ? 0.25 : 0.4), `${f}: palette background (${((onBg / n) * 100).toFixed(1)}%)`);
  }
});

// every harakah-fix command a page or doc shows exists, and `npx harakah-fix` only appears where the package is
// installed first (with nothing installed, npx looks for a package called harakah-fix, which isn't ours)
const COMMANDS = new Set([...read("src/cli.ts").matchAll(/\.command\("([a-z-]+)/g)].map((m) => m[1]));
const SHOWN = ["README.md", "docs/REFERENCE.md", "web/landing.html", "web/index.html", "site-src/tool.html", "site-src/term.js",
  ...["integrations/claude-code/skills/harakah/SKILL.md", "integrations/claude-code/plugin/skills/harakah/SKILL.md", "integrations/agent-skill/skills/harakah/SKILL.md", "integrations/agent-skill/README.md", ".claude/skills/harakah/SKILL.md"]];
test("consistency: commands shown on the site and in the docs exist and run", () => {
  assert.ok(COMMANDS.has("check") && COMMANDS.has("serve"), [...COMMANDS].join(","));
  for (const f of SHOWN) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const s = read(f);
    for (const m of s.matchAll(/(?:\$ |npx [^<\n`]*?|class="cmd">|<code>|`)harakah-fix ([a-z][\w-]*)(?=[\s<"'`.,)]|$)/gm)) assert.ok(COMMANDS.has(m[1]), `${f}: "harakah-fix ${m[1]}" is not a command (${[...COMMANDS].join(", ")})`);
    const install = s.search(/npm (?:install|i) (?:-D |--save-dev )?harakah-fixer/);
    for (const m of s.matchAll(/npx (?:-y )?harakah-fix\b/g)) assert.ok(install >= 0 && install < m.index!, `${f}: "${m[0]}" without installing harakah-fixer first; use npx -y -p harakah-fixer harakah-fix`);
    if (/^(web|design)\//.test(f)) assert.doesNotMatch(s, /npm run (?:build|serve)\b/, `${f}: repo-only steps on a public page`);
  }
});

test("consistency: default languages (harakah.si Arabic, /en/ English, the tool and /tool/ English)", () => {
  assert.match(read("web/landing.html"), /<html lang="ar" dir="rtl"/);
  assert.match(read("web/index.html"), /<html lang="en" dir="ltr" data-lang="en">/);
  assert.match(read("web/index.html"), /getItem\("hz-lang"\) === "ar" \? "ar" : "en"/);
  assert.match(read("site-src/tool.html"), /<html lang="en" dir="ltr" data-lang="en"/);
});

test("consistency: what harakah.si states about the product comes from the product (rule count, version), nothing hard-coded drifts", async () => {
  const { RULES } = await import("../src/rules.ts");
  const version = JSON.parse(read("package.json")).version;
  const landing = read("web/landing.html");
  // web/landing.html is what site-src/build.mjs produces (needs dist/: the rule count comes from the built rules)
  assert.doesNotThrow(() => execFileSync(process.execPath, ["site-src/build.mjs", "--check"], { cwd: ROOT, stdio: "pipe" }), "web/landing.html is stale: node site-src/build.mjs");
  assert.match(landing, new RegExp(`<b data-n="${Object.keys(RULES).length}">${Object.keys(RULES).length}</b><span lang="ar">قاعدة فحص`), "stats: the rule count is RULES' (rebuild the page)");
  assert.match(landing, new RegExp(`harakah-fix v${version.replace(/\./g, "\\.")}<`), "footer: the package version (rebuild the page)");
  assert.doesNotMatch(landing, /\{\{(RULES|VERSION)\}\}/, "unfilled placeholder");
  // stats show without JavaScript too (app.js only reformats them)
  const stats = landing.slice(landing.indexOf('<div class="stats"'), landing.indexOf("</div>\n", landing.indexOf('<div class="stats"') + 600));
  for (const m of stats.matchAll(/<b data-n="(\d+)">([^<]*)<\/b>/g)) assert.equal(m[2], m[1], "a stat is empty until JavaScript runs");
  // counts that can't be generated stay out of the copy: no rule count in words, no test count
  for (const f of ["web/landing.html", "README.md", "site-src/tool.html"]) {
    const t = read(f);
    assert.doesNotMatch(t, /\b(twenty|thirty)[- ]\w+ rules\b|أربع وعشرون قاعدة/i, `${f}: a rule count in words`);
    assert.doesNotMatch(t, /\b\d{3} tests\b|data-n="\d{3}"><\/b><span lang="ar">اختبار/, `${f}: a test count (it changes with every PR)`);
  }
});

test("consistency: the four skill copies are generated from skill-src/ (edit skill-src/, then npm run build:skills)", async () => {
  const { render, outputs, TARGETS } = await import("../scripts/build-skills.mjs");
  for (const [rel, content] of outputs()) assert.equal(fs.readFileSync(path.join(ROOT, rel), "utf8"), content, `${rel} is stale: npm run build:skills`);
  assert.deepEqual([...new Set(Object.values(TARGETS))].sort(), ["agent", "cli", "scripts"]);
  // the variants differ where they should: bundled scripts, the CLI with MCP tools, npx only
  const src = fs.readFileSync(path.join(ROOT, "skill-src/SKILL.md"), "utf8");
  assert.match(render(src, "scripts"), /scripts\/gate\.sh/);
  assert.match(render(src, "cli"), /harakah_gate \{ path/);
  assert.doesNotMatch(render(src, "agent"), /harakah_gate \{|scripts\/gate\.sh|<!--/);
  assert.throws(() => render("<!-- if cli -->\nx\n", "cli"), /unclosed/);
});
