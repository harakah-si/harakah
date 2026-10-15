// HZ24 in the Remotion Studio panel: `gate --layout --json` carries the runtime layout findings per composition
// (frames, verified suggestion); toResults() shapes them for the overlay, which shows a "Layout over time"
// section with the current composition first. Real CLI + the real overlay script in Chrome (Studio stubbed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
import { CHROME } from "../src/render.ts";

const { toResults } = createRequire(import.meta.url)("../integrations/remotion/index.cjs");
const OVERLAY_SRC = fs.readFileSync("integrations/remotion/studio-overlay.cjs", "utf8");

function gate(args: string[]) {
  try { return JSON.parse(execFileSync(process.execPath, ["dist/cli.js", "gate", "fixtures/remotion", "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (e) { return JSON.parse((e as { stdout: string }).stdout); }
}

async function overlay(results: unknown, pathname: string) {
  const page = `<!doctype html><html><body><script>window.remotion_isStudio = true;
    (function (require, module) { ${OVERLAY_SRC} })(function () { return ${JSON.stringify(results)}; }, {});</script></body></html>`;
  const srv = http.createServer((_q, s) => { s.setHeader("content-type", "text/html; charset=utf-8"); s.end(page); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  try {
    const p = await browser.newPage();
    await p.goto(`http://127.0.0.1:${(srv.address() as { port: number }).port}${pathname}`);
    await p.waitForFunction(() => document.querySelector("harakah-studio")?.shadowRoot?.querySelector(".pill"));
    return await p.evaluate(() => {
      const root = document.querySelector("harakah-studio")!.shadowRoot!;
      const lay = root.querySelector(".lay");
      return {
        pill: root.querySelector(".pill")!.textContent,
        list: [...root.querySelectorAll("li .code")].map((e) => e.textContent),
        layout: lay?.textContent ?? null,
        comps: [...root.querySelectorAll(".comp")].map((c) => ({ id: c.getAttribute("data-comp"), cur: c.classList.contains("cur"), frames: [...c.querySelectorAll(".fr span")].map((s) => s.textContent), sg: c.querySelector(".sg")?.textContent ?? "" })),
      };
    });
  } finally { await browser.close(); srv.close(); }
}

test("studio overlay: HZ24 per composition with frames + verified dir suggestion", { timeout: 240_000 }, async () => {
  const g = gate(["--layout", "--composition", "CharSplitTitle,CleanTitle"]);
  assert.ok(Array.isArray(g.layout), "gate --layout --json has a layout section");
  const r = toResults(g, "block", true);
  assert.equal(r.status, "blocked");
  const comp = r.layout.compositions.find((c: { id: string }) => c.id === "CharSplitTitle");
  assert.ok(comp, JSON.stringify(r.layout));
  assert.ok(!r.layout.compositions.some((c: { id: string }) => c.id === "CleanTitle"), "clean composition not listed");
  const it = comp.issues.find((i: { code: string }) => i.code === "HZ24");
  assert.ok(it.frames.length && it.frames.every((f: number) => Number.isInteger(f)), "frame numbers");
  assert.deepEqual(it.suggest, { kind: "dir", verified: true, tag: "div" });

  // a second composition with an issue, so "current first" is observable
  r.layout.compositions.push({ id: "Other", issues: [{ ...it, suggest: { kind: "reorder" }, frames: [3] }] });
  const ui = await overlay(r, "/Other");
  assert.match(ui.layout!, /Layout over time \(HZ24\)/);
  assert.deepEqual(ui.comps.map((c) => [c.id, c.cur]), [["Other", true], ["CharSplitTitle", false]]);
  const cs = ui.comps[1];
  assert.deepEqual(cs.frames, it.frames.slice(0, 16).map(String));
  assert.match(cs.sg, /dir="rtl"/);
  assert.match(cs.sg, /verified/);
  assert.match(ui.comps[0].sg, /mirrored slot/);
  assert.ok(!ui.list.includes("HZ24") || r.blocking.some((b: { code: string; file: string }) => b.code === "HZ24" && !/#/.test(b.file)), "runtime HZ24 not duplicated in the generic list");
});

test("studio overlay: layout off → hint; layout on + clean → ok line", { timeout: 60_000 }, async () => {
  const base = { ok: false, blocking: [{ file: "src/T.tsx", line: 3, code: "HZ02", title: "letters split" }], summary: { errors: 1, warnings: 0 }, fixCommand: "harakah-fix fix src" };
  const off = await overlay(toResults(base, "block", false), "/T");
  assert.match(off.layout!, /HZ24\) is off/);
  assert.deepEqual(off.list, ["HZ02"]);
  const on = await overlay(toResults({ ...base, layout: [] }, "block", true), "/T");
  assert.match(on.layout!, /right-to-left in every sampled frame/);
});
