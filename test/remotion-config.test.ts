// Remotion's own bundler refuses to bundle (and therefore render) broken Arabic when remotion.config.ts
// uses withHarakah(): real @remotion/bundler runs on the broken fixture project and on a clean project.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const FIX = path.resolve("fixtures/remotion");
const req = createRequire(path.join(FIX, "package.json"));
const { bundle } = req("@remotion/bundler");
const { withHarakah, HarakahWebpackPlugin } = createRequire(import.meta.url)("../integrations/remotion/index.cjs");
// tsx by absolute URL: the bundler runs the gate from the project folder, where a bare "tsx" may not resolve
const gateOpts = { cli: path.resolve("src/cli.ts"), nodeArgs: ["--import", import.meta.resolve("tsx")] };

test("remotion config: withHarakah composes with an existing override and adds the plugin", async () => {
  const c = await withHarakah((x: any) => ({ ...x, marker: 1 }), gateOpts)({ plugins: [] });
  assert.equal(c.marker, 1);
  assert.ok(c.plugins[0] instanceof HarakahWebpackPlugin);
  const d = await withHarakah(gateOpts)({});
  assert.equal(d.plugins.length, 1);
});

test("remotion config: bundle() fails on the broken fixture project and succeeds on a clean one", { timeout: 300_000 }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-cfg-"));
  await assert.rejects(
    bundle({ entryPoint: path.join(FIX, "src/index.ts"), outDir: path.join(out, "broken"), webpackOverride: withHarakah({ ...gateOpts, root: FIX }) }),
    (e: Error) => /Harakah: \d+ Arabic problem/.test(e.message) && /CharSplitTitle\.tsx/.test(e.message) && /HZ02/.test(e.message),
  );
  // clean project: only the clean compositions, sharing the fixture's node_modules
  const clean = path.join(out, "clean");
  fs.mkdirSync(path.join(clean, "src"), { recursive: true });
  for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(FIX, f), path.join(clean, f));
  fs.symlinkSync(path.join(FIX, "node_modules"), path.join(clean, "node_modules"), "dir");
  for (const f of ["clean/CleanTitle.tsx", "clean/ArabicTextDemo.tsx", "harakah-arabic.tsx", "global.d.ts"]) { fs.mkdirSync(path.dirname(path.join(clean, "src", f)), { recursive: true }); fs.copyFileSync(path.join(FIX, "src", f), path.join(clean, "src", f)); }
  fs.writeFileSync(path.join(clean, "src/Root.tsx"), `import React from "react";\nimport { Composition } from "remotion";\nimport { CleanTitle } from "./clean/CleanTitle";\nexport const RemotionRoot: React.FC = () => <Composition id="CleanTitle" component={CleanTitle} durationInFrames={30} width={640} height={360} fps={30} />;\n`);
  fs.writeFileSync(path.join(clean, "src/index.ts"), `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root";\nregisterRoot(RemotionRoot);\n`);
  const served = await bundle({ entryPoint: path.join(clean, "src/index.ts"), outDir: path.join(out, "clean-out"), webpackOverride: withHarakah({ ...gateOpts, root: clean }) });
  assert.ok(fs.existsSync(path.join(served, "index.html")));
  // render bundles never contain the Studio panel
  const js = fs.readdirSync(served).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(served, f), "utf8")).join("\n");
  assert.ok(js.length > 1000 && !js.includes("harakah-studio"), "no Studio overlay in production bundles");
  fs.rmSync(out, { recursive: true, force: true });
});
