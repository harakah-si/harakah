import { test } from "node:test";
import assert from "node:assert/strict";
import { transformSource, toIssues } from "../src/remotion/codemod.js";
import { checkArabic } from "../mcp/src/tools.js";

const canvas = (dir: string) => `import React from "react";
export const C = () => { const t = "مرحبا"; const ctx = document.createElement("canvas").getContext("2d")!;
${dir}
ctx.font = "40px Alexandria"; const m = ctx.measureText(t); ctx.fillText(t, 0, 0); return <div dir="rtl">{t}</div>; };`;
const hz19 = (src: string) => transformSource(src, {} as any).reports.filter((r) => r.code === "HZ19");

test("HZ19 passes when ctx.direction = 'rtl' is set", () => assert.equal(hz19(canvas(`ctx.direction = 'rtl';`)).length, 0));
test("HZ19 still fires without direction", () => assert.ok(hz19(canvas("")).length > 0));
test("HZ19 still fires when direction is ltr", () => assert.ok(hz19(canvas(`ctx.direction = "ltr";`)).length > 0));
test("HZ19 fires for a different context without direction", () =>
  assert.ok(hz19(canvas(`ctx.direction = 'rtl'; const o = ctx; o.fillText("x", 0, 0);`)).some((r) => r.en.includes("fillText"))));

const noRtl = `import React from "react";\nexport const A = () => <div style={{ fontFamily: "Alexandria" }}>مرحبا بكم</div>;\n`;
test("HZ03 severity is the same in CLI issues and MCP check_arabic", () => {
  const cli = toIssues(transformSource(noRtl, {} as any), false).filter((i) => i.code === "HZ03").map((i) => i.severity);
  const mcp = checkArabic({ code: noRtl, kind: "remotion" }).issues.filter((i: any) => i.code === "HZ03").map((i: any) => i.severity);
  assert.ok(cli.length > 0); assert.deepEqual(mcp, cli); assert.ok(mcp.every((s: string) => s === "warning"));
});
test("HZ19: rtl on one component's ctx does not silence another component's ctx", () => {
  const src = `import React from "react";
const t = "مرحبا";
export const A = () => { const ctx = document.createElement("canvas").getContext("2d")!; ctx.direction = "rtl"; ctx.fillText(t, 0, 0); return null; };
export const B = () => { const ctx = document.createElement("canvas").getContext("2d")!; ctx.fillText(t, 0, 0); return null; };`;
  const r = hz19(src); assert.equal(r.length, 1); assert.equal(r[0].line, 4);
});
test("HZ19: direction set in an outer function covers a nested callback", () =>
  assert.equal(hz19(`import React from "react";\nexport const A = () => { const ctx = document.createElement("canvas").getContext("2d")!; ctx.direction = "rtl"; ["مرحبا"].forEach((w) => ctx.fillText(w, 0, 0)); return null; };`).length, 0));
