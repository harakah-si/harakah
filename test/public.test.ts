// Public-instance guards (HARAKAH_PUBLIC=1): rate limits (429), body/upload caps (413), temp cleanup, env
// lock-down, /healthz. The real server is spawned with small limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { publicConfig, publicRefusal, RateLimiter, cleanupTemp, lockDownEnv, clientIp, DEFAULT_EGRESS } from "../src/public.ts";

test("public: config defaults (local unlimited, public capped)", () => {
  const local = publicConfig({});
  assert.equal(local.public, false);
  assert.equal(local.maxRequests, Infinity);
  assert.equal(local.uploadBytes, 60 << 20);
  const pub = publicConfig({ HARAKAH_PUBLIC: "1", HARAKAH_RATE_RENDERS: "5" });
  assert.equal(pub.public, true);
  assert.equal(pub.maxRequests, 120);
  assert.equal(pub.maxRenders, 5);
  assert.equal(pub.bodyBytes, 512_000);
  assert.equal(pub.uploadBytes, 8 << 20);
  assert.deepEqual(pub.egressHosts, DEFAULT_EGRESS);
});

test("public: rate limiter window + retry-after; client IP only trusts proxies when told", () => {
  const l = new RateLimiter(60_000);
  assert.ok(l.hit("a", 2, 0).ok && l.hit("a", 2, 1).ok);
  const third = l.hit("a", 2, 30_000);
  assert.equal(third.ok, false);
  assert.equal(third.retryAfter, 30);
  assert.ok(l.hit("b", 2, 30_000).ok, "per key");
  assert.ok(l.hit("a", 2, 60_001).ok, "new window");
  const req = { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, socket: { remoteAddress: "10.0.0.2" } } as never;
  assert.equal(clientIp(req, false), "10.0.0.2");
  assert.equal(clientIp(req, true), "9.9.9.9");
});

test("public: temp cleanup removes only old harakah-* entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-clean-"));
  const old = Date.now() / 1000 - 7200;
  for (const n of ["harakah-ui-old", "harakah-proj-new", "other-old"]) fs.mkdirSync(path.join(dir, n));
  fs.mkdirSync(path.join(dir, "harakah-ui-videos"));
  fs.writeFileSync(path.join(dir, "harakah-ui-videos", "a.mp4"), "x");
  fs.writeFileSync(path.join(dir, "harakah-ui-videos", "b.mp4"), "x");
  fs.utimesSync(path.join(dir, "harakah-ui-old"), old, old);
  fs.utimesSync(path.join(dir, "other-old"), old, old);
  fs.utimesSync(path.join(dir, "harakah-ui-videos", "a.mp4"), old, old);
  const removed = cleanupTemp(3600_000, dir).map((p) => path.relative(dir, p)).sort();
  assert.deepEqual(removed, ["harakah-ui-old", path.join("harakah-ui-videos", "a.mp4")]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["harakah-proj-new", "harakah-ui-videos", "other-old"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("public: env lock-down drops secrets, keeps runtime vars, blocks Chrome egress", () => {
  const env: NodeJS.ProcessEnv = { PATH: "/bin", HOME: "/home/x", PORT: "8080", HARAKAH_PUBLIC: "1", DATABASE_URL: "postgres://secret", FLY_API_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "k" };
  const dropped = lockDownEnv(publicConfig(env), env).sort();
  assert.deepEqual(dropped, ["AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "FLY_API_TOKEN"]);
  assert.equal(env.PATH, "/bin");
  assert.match(env.all_proxy!, /127\.0\.0\.1:9/);
  assert.match(env.no_proxy!, /^localhost,127\.0\.0\.1,::1,cdn\.jsdelivr\.net/);
});

test("public: refuses to start without HARAKAH_PUBLIC_UNISOLATED=1 (no per-job isolation yet); local mode is unaffected", { timeout: 30_000 }, async () => {
  assert.equal(publicRefusal({}), null, "local");
  assert.match(publicRefusal({ HARAKAH_PUBLIC: "1" }) ?? "", /HARAKAH_PUBLIC_UNISOLATED=1/);
  assert.equal(publicRefusal({ HARAKAH_PUBLIC: "1", HARAKAH_PUBLIC_UNISOLATED: "1" }), null, "the operator accepted it");
  const child = spawn(process.execPath, ["dist/server.js"], { env: { ...process.env, PORT: "0", HOST: "127.0.0.1", HARAKAH_PUBLIC: "1", HARAKAH_PUBLIC_UNISOLATED: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise<number | null>((r) => child.on("exit", r));
  assert.equal(code, 1);
  assert.match(err, /not ready for hosting/);
});

test("public: real server → /healthz, 413 over the body cap, 429 over the rate limit", { timeout: 60_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hz-pubsrv-"));
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", HARAKAH_PUBLIC: "1", HARAKAH_PUBLIC_UNISOLATED: "1", HARAKAH_RATE_MAX: "4", HARAKAH_MAX_BODY_KB: "2", HARAKAH_MAX_UPLOAD_MB: "1", TMPDIR: tmp, SECRET_FOR_TEST: "x" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (d) => { out += d; const m = /127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
      child.on("exit", (c) => reject(new Error("server exited " + c + out)));
    });
    const base = `http://127.0.0.1:${port}`;
    const h = await (await fetch(base + "/healthz")).json();
    assert.deepEqual([h.ok, h.public], [true, true]);
    const tool = await (await fetch(base + "/")).text();
    assert.match(tool, /نسخة عامة: ما تلصقه يُعالج على هذا الخادم/, "public instance says so");
    assert.doesNotMatch(tool, /Nothing leaves this machine/);
    const post = (bodyText: string) => fetch(base + "/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: bodyText });
    const ok = await post(JSON.stringify({ html: "<p>مرحبا</p>", kind: "html" }));
    assert.equal(ok.status, 200);
    const big = await post(JSON.stringify({ html: "<p>" + "س".repeat(3000) + "</p>" }));
    assert.equal(big.status, 413);
    assert.match((await big.json()).error, /too large/);
    const zip = await fetch(base + "/api/project?name=x.zip", { method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(1.5 * (1 << 20)) });
    assert.equal(zip.status, 413, "upload cap");
    // far over the cap: the server drains instead of resetting, so the client reads the 413 (no EPIPE)
    const huge = await fetch(base + "/api/project?name=x.zip", { method: "POST", headers: { "content-type": "application/zip" }, body: new Uint8Array(40 << 20) });
    assert.equal(huge.status, 413, "40 MB upload → 413, not a reset");
    const r4 = await fetch(base + "/api/meta");
    assert.equal(r4.status, 429, "5th /api request in the window (max 4)");
    assert.ok(Number(r4.headers.get("retry-after")) > 0);
    assert.equal((await fetch(base + "/healthz")).status, 200, "health is not rate limited");
  } finally { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
