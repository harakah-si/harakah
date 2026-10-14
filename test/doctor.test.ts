// `harakah-fix doctor`: on this machine everything a render needs is checked for real (Chrome joins Arabic with a
// bundled font); a missing or broken Chrome is a failure with a fix, missing ffmpeg or Remotion packages are warnings.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "dist/cli.js");
function doctor(env: Record<string, string> = {}, cwd = ROOT) {
  let code = 0, out = "";
  try { out = execFileSync(process.execPath, [CLI, "doctor", "--json"], { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" }); }
  catch (e: any) { code = e.status; out = String(e.stdout); }
  const j = JSON.parse(out);
  return { code, j, by: (id: string) => j.checks.find((c: any) => c.id === id) };
}

test("doctor: this machine is ready, and Chrome really joins Arabic (fewer ink pieces than split letters)", { timeout: 60_000 }, () => {
  const r = doctor();
  assert.equal(r.code, 0, JSON.stringify(r.j.checks, null, 2));
  assert.equal(r.j.ok, true);
  for (const id of ["node", "fonts", "tmp", "chrome", "remotion-mode", "ffmpeg"]) assert.ok(r.by(id), id);
  const m = /(\d+) ink pieces joined vs (\d+) split/.exec(r.by("chrome").en)!;
  assert.ok(Number(m[1]) < Number(m[2]), r.by("chrome").en);
  assert.match(r.by("chrome").ar, /[٠-٩]/, "Arabic copy uses Eastern digits");
});

test("doctor: missing or broken Chrome fails with a fix; missing ffmpeg is only a warning", { timeout: 60_000 }, () => {
  const missing = doctor({ HARAKAH_CHROME: "/nonexistent/chrome" });
  assert.equal(missing.code, 1);
  assert.equal(missing.by("chrome").ok, false);
  assert.match(missing.by("chrome").fix, /HARAKAH_CHROME/);
  const broken = doctor({ HARAKAH_CHROME: "/bin/false" });
  assert.equal(broken.code, 1);
  assert.match(broken.by("chrome").en, /failed to start/);
  const noFfmpeg = doctor({ HARAKAH_FFMPEG: "/nonexistent/ffmpeg" });
  assert.equal(noFfmpeg.code, 0, "ffmpeg is needed only for compare");
  assert.equal(noFfmpeg.by("ffmpeg").ok, false);
  assert.equal(noFfmpeg.by("ffmpeg").required, false);
});

test("doctor: a Remotion project without the bundler and renderer gets a warning with the install command", { timeout: 60_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-doctor-proj-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", dependencies: { remotion: "4.0.0" } }));
    const r = doctor({}, dir);
    assert.equal(r.code, 0);
    assert.equal(r.by("remotion").ok, false);
    assert.match(r.by("remotion").fix, /npm install -D remotion @remotion\/bundler @remotion\/renderer/);
    assert.equal(doctor({}, os.tmpdir()).by("remotion"), undefined, "no Remotion project: no Remotion line");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
