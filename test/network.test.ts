// What a rendered scene reaches on the internet: compare and audit list the hosts (CDN scripts, web fonts); offline
// (--offline, HARAKAH_OFFLINE=1) refuses them, says which, and an audit that saw an incomplete scene is inconclusive.
// Remotion renders partly run in Remotion's own browser, so offline they refuse to start instead of claiming offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { launch, openPage, network, networkReport } from "../src/render.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "dist/cli.js");
// interception happens before DNS: .invalid hosts are recorded (and refused) without any real network
const scene = (extra = "") => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.example.invalid/css2?family=Cairo">
<script src="https://cdn.example.invalid/gsap.min.js"></script></head>
<body><h1>سلام عليكم</h1><img src="http://127.0.0.1:9/loopback.png">${extra}</body></html>`;

function dir(html: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hz-net-"));
  fs.writeFileSync(path.join(d, "scene.html"), html);
  return { d, file: path.join(d, "scene.html") };
}
const cli = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
/** This machine's own non-loopback address: not "localhost" to the guard, but no internet needed to reach it. */
const lanIp = () => Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;

test("network: the hosts a scene loads from are recorded; loopback is not", { timeout: 60_000 }, async () => {
  const { d, file } = dir(scene());
  const browser = await launch();
  try {
    const net = network(false);
    await openPage(browser, file, { width: 640, height: 360 }, undefined, net);
    assert.deepEqual(networkReport(net), { offline: false, hosts: ["cdn.example.invalid", "fonts.example.invalid"], blocked: [] });
  } finally { await browser.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test("network: offline, the request never leaves; online, it does", { timeout: 60_000 }, async (t) => {
  const ip = lanIp();
  if (!ip) return t.skip("no non-loopback IPv4 address on this machine");
  const hits: string[] = [];
  const srv = http.createServer((req, res) => { hits.push(req.url!); res.end("window.HIT=1"); });
  await new Promise<void>((r) => srv.listen(0, "0.0.0.0", r));
  const host = `${ip}:${(srv.address() as any).port}`;
  const { d, file } = dir(`<!doctype html><html><body><h1>سلام</h1><script src="http://${host}/probe.js"></script></body></html>`);
  const browser = await launch();
  try {
    const off = network(true);
    const page = await openPage(browser, file, { width: 640, height: 360 }, undefined, off);
    assert.deepEqual(hits, [], "offline: the server was never contacted");
    assert.deepEqual(networkReport(off).blocked, [host]);
    assert.equal(await page.evaluate("window.HIT"), undefined);
    const on = network(false);
    await openPage(browser, file, { width: 640, height: 360 }, undefined, on);
    assert.deepEqual(hits, ["/probe.js"]);
    assert.deepEqual(networkReport(on).hosts, [host]);
  } finally { await browser.close(); srv.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test("network: audit and compare report the hosts; --offline names what it refused and is inconclusive (exit 2)", { timeout: 180_000 }, () => {
  const { d, file } = dir(scene());
  try {
    const on = cli(["audit", file, "--json"]);
    assert.equal(on.code, 0, on.err);
    assert.deepEqual(JSON.parse(on.out).network.hosts, ["cdn.example.invalid", "fonts.example.invalid"]);

    const off = cli(["audit", file, "--json", "--offline"]);
    assert.equal(off.code, 2, "an audit of a scene missing its CDN files can't vouch for it");
    assert.deepEqual(JSON.parse(off.out).network, { offline: true, hosts: [], blocked: ["cdn.example.invalid", "fonts.example.invalid"] });
    assert.match(off.err, /offline: refused/);

    const cmp = cli(["compare", file, "-o", path.join(d, "out"), "--offline", "--no-layout"]);
    assert.equal(cmp.code, 2);
    assert.match(cmp.out, /offline: blocked cdn\.example\.invalid, fonts\.example\.invalid/);
    const cmpOn = cli(["compare", file, "-o", path.join(d, "out2"), "--no-layout"]);
    assert.equal(cmpOn.code, 0, cmpOn.err);
    assert.match(cmpOn.out, /internet: the scene loaded from cdn\.example\.invalid, fonts\.example\.invalid/);

    const gate = cli(["gate", file, "--layout", "--json"], { HARAKAH_OFFLINE: "1" });
    const g = JSON.parse(gate.out);
    assert.equal(gate.code, 2);
    assert.match(g.inconclusive[0].reason, /offline: the scene loads cdn\.example\.invalid, fonts\.example\.invalid/);

    const self = dir(`<!doctype html><html lang="ar" dir="rtl"><body><h1>سلام عليكم</h1></body></html>`);
    const quiet = cli(["audit", self.file, "--offline"]);
    fs.rmSync(self.d, { recursive: true, force: true });
    assert.equal(quiet.code, 0, "a self-contained scene audits offline as usual");
    assert.match(quiet.out, /internet: none \(offline\)/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("network: offline, a Remotion render refuses to start (its own browser isn't guarded) with exit 2, not 1", { timeout: 60_000 }, () => {
  const r = cli(["audit", path.join(ROOT, "fixtures/remotion"), "--offline"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /offline: Remotion renders run in Remotion's own browser/);
  assert.doesNotMatch(r.err, /\n\s+at /, "a message, not a stack trace");
});
