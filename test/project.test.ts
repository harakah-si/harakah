// Whole-project mode in the web tool: upload a Remotion project as a .zip or a file list, follow props across files,
// download the fixed project (.zip) and a unified patch. Also the browser flow (zip picker → tree, downloads).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { zipSync, unzipSync, strFromU8 } from "fflate";
import puppeteer, { type Browser } from "puppeteer-core";
import { CHROME } from "../src/render.ts";
import { safeRel, stripCommonRoot, filesFromZip } from "../src/project-upload.ts";

const PORT = 4793;
const BASE = `http://127.0.0.1:${PORT}`;
const FIX = path.resolve("fixtures/remotion");
let server: ChildProcess, browser: Browser;

function tree(dir: string, prefix: string, out: Record<string, Uint8Array> = {}, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "out"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tree(p, prefix, out, base); else out[prefix + path.relative(base, p).replace(/\\/g, "/")] = new Uint8Array(fs.readFileSync(p));
  }
  return out;
}
// the fixture without its already-vendored helper, so the upload has to add it
const fixtureTree = (prefix = "my-film/") => { const t = tree(FIX, prefix); delete t[prefix + "src/harakah-arabic.tsx"]; return t; };

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/meta")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.kill(); });

test("project: path sanitizing rejects traversal, absolute paths and skipped dirs", () => {
  assert.equal(safeRel("../etc/passwd"), null);
  assert.equal(safeRel("a/../../x.ts"), null);
  assert.equal(safeRel("/abs/x.tsx"), null);
  assert.equal(safeRel("C:/x.tsx"), null);
  assert.equal(safeRel("proj/node_modules/react/index.js"), null);
  assert.equal(safeRel("proj/.git/config"), null);
  assert.equal(safeRel("./proj/src\\Root.tsx"), "proj/src/Root.tsx");
  assert.deepEqual(stripCommonRoot([{ path: "p/a.ts", data: new Uint8Array() }, { path: "p/src/b.tsx", data: new Uint8Array() }]).files.map((f) => f.path), ["a.ts", "src/b.tsx"]);
  const evil = zipSync({ "../../evil.tsx": new Uint8Array([1]), "ok/src/A.tsx": new Uint8Array([2]), "ok/node_modules/x/i.js": new Uint8Array([3]) });
  assert.deepEqual(filesFromZip(evil).map((f) => f.path), ["ok/src/A.tsx"]);
});

test("project: zip upload follows props across files, vendors the helper, serves fixed zip + patch", async () => {
  const zip = zipSync(fixtureTree());
  const res = await fetch(`${BASE}/api/project?name=my-film.zip&options=${encodeURIComponent(JSON.stringify({ digits: "eastern" }))}`, { method: "POST", headers: { "content-type": "application/zip" }, body: zip });
  const r: any = await res.json();
  assert.equal(res.status, 200, r.error);
  assert.equal(r.name, "my-film");
  // props-following across files: Root.tsx defaultProps → PropsTitle → Kicker (separate file)
  const feeds = Object.fromEntries(r.props.map((p: any) => [p.component, p.props]));
  assert.deepEqual(feeds.PropsTitle, ["title", "kicker"]);
  assert.deepEqual(feeds.Kicker, ["label"]);
  assert.ok(r.changed.includes("src/props/PropsTitle.tsx") && r.changed.includes("src/props/Kicker.tsx"), r.changed.join());
  assert.ok(r.changed.includes("src/broken/Title.module.css"), "CSS module fixed too");
  assert.deepEqual(r.added, ["src/harakah-arabic.tsx"]);
  assert.ok(!r.changed.some((f: string) => /Root\.tsx|clean\//.test(f)), "registration + clean files untouched");
  assert.ok(r.summary.errors > 0 && r.results.some((x: any) => x.file === "src/props/PropsTitle.tsx" && x.issues.length));
  // patch: git-style, applies cleanly with git apply on a pristine copy
  const patch = await (await fetch(BASE + r.download.patch)).text();
  assert.match(patch, /^--- a\/src\/broken\/ArrayFromKicker\.tsx/m);
  assert.match(patch, /^\+\+\+ b\/src\/harakah-arabic\.tsx/m);
  assert.match(patch, /splitArabic/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hz-patch-"));
  for (const [p, d] of Object.entries(fixtureTree(""))) { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), d); }
  fs.writeFileSync(path.join(tmp, "h.patch"), patch);
  execFileSync("git", ["apply", "--check", "h.patch"], { cwd: tmp });
  execFileSync("git", ["apply", "h.patch"], { cwd: tmp });
  assert.match(fs.readFileSync(path.join(tmp, "src/props/Kicker.tsx"), "utf8"), /dir="rtl"[\s\S]*letterSpacing: 0/);
  assert.ok(fs.existsSync(path.join(tmp, "src/harakah-arabic.tsx")));
  fs.rmSync(tmp, { recursive: true, force: true });
  // fixed zip: same project layout, fixed sources, helper, no node_modules
  const zr = await fetch(BASE + r.download.zip);
  assert.equal(zr.headers.get("content-type"), "application/zip");
  const files = unzipSync(new Uint8Array(await zr.arrayBuffer()));
  const names = Object.keys(files);
  assert.ok(names.every((n) => n.startsWith("my-film/") && !n.includes("node_modules")));
  assert.match(strFromU8(files["my-film/src/props/PropsTitle.tsx"]), /splitArabic/);
  assert.ok(files["my-film/src/harakah-arabic.tsx"]);
  assert.ok(files["my-film/package.json"], "non-source files preserved");
  // unknown ids 404
  assert.equal((await fetch(`${BASE}/api/project/AAAAAAAAAAAA/x.zip`)).status, 404);
});

test("project: JSON folder upload (source files only) works and rejects projects without components", async () => {
  const t = fixtureTree("film/");
  const files = Object.entries(t).filter(([p]) => /\.(tsx?|css|json)$/.test(p)).map(([p, d]) => ({ path: p, text: strFromU8(d) }));
  const r: any = await (await fetch(BASE + "/api/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "film", files: [...files, { path: "../../x.tsx", text: "x" }] }) })).json();
  assert.ok(r.changed.includes("src/props/Kicker.tsx"));
  const bad = await fetch(BASE + "/api/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: [{ path: "a.md", text: "# hi" }] }) });
  assert.equal(bad.status, 500);
  assert.match((await bad.json() as any).error, /no \.tsx\/\.jsx/);
});

test("project: tool page opens a .zip, shows the file tree, grouped issues, props chain and download links", async () => {
  const zp = path.join(os.tmpdir(), "my-film.zip");
  fs.writeFileSync(zp, zipSync(fixtureTree()));
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluateOnNewDocument(() => { localStorage.setItem("hz-lang", "ar"); });
  await p.goto(BASE + "/", { waitUntil: "networkidle0" });
  const input = await p.$("#zip");
  await (input as any).uploadFile(zp);
  await p.waitForFunction('document.querySelector("#projTree li") && document.querySelector("#projZip").getAttribute("href")', { timeout: 60000 });
  const s: any = await p.evaluate(`({
    proj: !document.querySelector("#proj").hidden, drop: document.querySelector("#drop").hidden, cmp: document.querySelector("#cmp").hidden,
    tree: [...document.querySelectorAll("#projTree li")].map((l) => l.textContent),
    groups: [...document.querySelectorAll("#issues .fileh")].map((x) => x.textContent),
    assets: document.querySelector("#assets").textContent, diff: !document.querySelector("#diffCard").hidden,
    zip: document.querySelector("#projZip").getAttribute("href"), out: document.querySelector("#out").value.slice(0, 200),
    overflow: document.documentElement.scrollWidth > innerWidth })`);
  assert.ok(s.proj && s.drop && s.cmp && s.diff);
  assert.ok(s.tree.some((t: string) => t.includes("src/props/Kicker.tsx") && t.includes("أُصلح")), s.tree.join("|"));
  assert.ok(s.tree.some((t: string) => t.startsWith("+src/harakah-arabic.tsx")));
  assert.ok(s.groups.includes("src/props/PropsTitle.tsx"));
  assert.match(s.assets, /PropsTitle[\s\S]*title, kicker/);
  assert.match(s.zip, /^\/api\/project\/[\w-]+\/my-film-harakah\.zip$/);
  assert.match(s.out, /^--- a\//);
  assert.equal(s.overflow, false);
  // switching an option re-runs the project; closing returns to single-file mode
  await p.click("#projClose");
  assert.equal(await p.evaluate('document.querySelector("#proj").hidden && !document.querySelector("#drop").hidden'), true);
  await p.close();
});

test("project: render props + composition picker (rerun on the stored upload, no re-upload)", async () => {
  const zp = path.join(os.tmpdir(), "props-film.zip");
  fs.writeFileSync(zp, zipSync(fixtureTree("props-film/")));
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluateOnNewDocument(() => { localStorage.setItem("hz-lang", "en"); });
  await p.goto(BASE + "/", { waitUntil: "networkidle0" });
  await ((await p.$("#zip")) as any).uploadFile(zp);
  await p.waitForFunction('!document.querySelector("#projRun").hidden && document.querySelector("#projProps").options.length > 2', { timeout: 60000 });
  const before: any = await p.evaluate(`({
    comps: [...document.querySelector("#projComp").options].map((o) => o.value),
    props: [...document.querySelector("#projProps").options].map((o) => o.value + "=" + o.textContent),
    hint: document.querySelector("#projRunHint").textContent,
    lt: [...document.querySelectorAll("#issues .fileh")].map((x) => x.textContent).filter((t) => /LowerThird/.test(t)) })`);
  assert.ok(before.comps.includes("LowerThird") && before.comps[0] === "", before.comps.join(","));
  assert.ok(before.props.some((o: string) => o.startsWith("props.ar.json=") && /has Arabic/.test(o)), before.props.join("|"));
  assert.match(before.hint, /props\.ar\.json contains Arabic/);
  assert.deepEqual(before.lt, [], "English defaultProps: LowerThird looks clean");
  await p.select("#projProps", "props.ar.json");
  await p.select("#projComp", "LowerThird");
  const firstId = await p.evaluate("document.querySelector('#projZip').getAttribute('href')");
  await p.click("#projApply");
  await p.waitForFunction('/Keys with Arabic: name, role/.test(document.querySelector("#projRunHint").textContent)', { timeout: 60000 });
  const after: any = await p.evaluate(`({ lt: [...document.querySelectorAll("#issues .fileh")].map((x) => x.textContent).filter((t) => /LowerThird/.test(t)),
    zip: document.querySelector("#projZip").getAttribute("href"), assets: document.querySelector("#assets").textContent,
    overflow: document.documentElement.scrollWidth > innerWidth })`);
  assert.ok(after.lt.length, "with Arabic render props, LowerThird is flagged");
  assert.match(after.assets, /--props \(render-time\)/);
  assert.notEqual(after.zip, firstId, "the rerun has its own fixed zip");
  assert.equal(after.overflow, false);
  // inline JSON: invalid input is caught in the page, valid Latin props come back clean
  await p.select("#projProps", "@inline");
  assert.equal(await p.evaluate('document.querySelector("#projPropsJson").hidden'), false);
  await p.type("#projPropsJson", '{"name": "Reem", "role": "Director"}');
  await p.click("#projApply");
  await p.waitForFunction('/Checked with inline JSON/.test(document.querySelector("#projRunHint").textContent)', { timeout: 60000 });
  assert.deepEqual(await p.evaluate('[...document.querySelectorAll("#issues .fileh")].map((x) => x.textContent).filter((t) => /LowerThird/.test(t))'), []);
  await p.close();
  // server: props only from the upload or inline JSON, never a server path
  const id = after.zip.split("/")[3];
  for (const bad of [{ propsFile: "../../../etc/passwd" }, { propsFile: "package.json" }, { props: "[1]" }]) {
    const r = await fetch(`${BASE}/api/project/${id}/rerun`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ options: bad }) });
    assert.ok(!r.ok, JSON.stringify(bad));
  }
  assert.equal((await fetch(`${BASE}/api/project/AAAAAAAAAAAA/rerun`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
});
