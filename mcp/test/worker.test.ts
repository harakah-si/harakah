import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/worker.ts";

const rpc = async (body: unknown, init: RequestInit = {}) => {
  const r = await handleRequest(new Request("https://mcp.harakah.si/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body), ...init }));
  return { status: r.status, body: r.status === 202 ? null : await r.json() as any };
};
const call = (name: string, args: unknown) => rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
const SPLIT_HTML = "<html><body><h1><span>م</span><span>ر</span><span>ح</span><span>ب</span><span>ا</span></h1></body></html>";
const REMOTION = 'import {AbsoluteFill} from "remotion";\nexport const A=()=> <AbsoluteFill><div style={{letterSpacing: 4, fontFamily: "Inter"}}>{"مرحبا".split("").map((c,i)=><span key={i}>{c}</span>)}</div></AbsoluteFill>;';

test("initialize negotiates protocol and advertises tools", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.ok(body.result.capabilities.tools);
  const u = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(u.body.result.protocolVersion, "2025-11-25");
});

test("notifications return 202 with no body", async () => {
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
});

test("tools/list has two read-only tools with explicit annotations", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = body.result.tools;
  assert.deepEqual(tools.map((t: any) => t.name), ["check_arabic", "fix_arabic"]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, false);
    assert.equal(t.inputSchema.properties.code.maxLength, 200000);
  }
});

test("check_arabic finds split letters in HTML", async () => {
  const { body } = await call("check_arabic", { code: SPLIT_HTML });
  const codes = body.result.structuredContent.issues.map((i: any) => i.code);
  assert.ok(codes.includes("HZ01")); assert.ok(codes.includes("HZ03")); assert.equal(body.result.structuredContent.ok, false);
});

test("fix_arabic repairs Remotion and the fixed code checks clean", async () => {
  const { body } = await call("fix_arabic", { code: REMOTION });
  const out = body.result.structuredContent;
  assert.equal(out.kind, "remotion"); assert.equal(out.changed, true);
  assert.match(out.fixedCode, /splitArabic\("مرحبا"\)/); assert.match(out.fixedCode, /dir="rtl"/);
  assert.equal(body.result.content[1].text, out.fixedCode);
  const again = await call("check_arabic", { code: out.fixedCode });
  assert.equal(again.body.result.structuredContent.ok, true);
});

test("fix_arabic repairs HTML", async () => {
  const { body } = await call("fix_arabic", { code: SPLIT_HTML });
  const out = body.result.structuredContent;
  assert.ok(out.changes.includes("HZ01")); assert.match(out.fixedCode, /dir="rtl"/);
});

test("code without Arabic reports nothing", async () => {
  const { body } = await call("check_arabic", { code: "<html><body><h1>Hello</h1></body></html>" });
  assert.equal(body.result.structuredContent.issues.length, 0);
});

test("input validation returns tool errors, not crashes", async () => {
  for (const args of [{}, { code: "" }, { code: 5 }, { code: "x", kind: "svg" }, { code: "x", split: "zwj" }, { code: "x", path: "/etc/passwd" }, { code: "a".repeat(200001) }]) {
    const { status, body } = await call("check_arabic", args);
    assert.equal(status, 200); assert.equal(body.result.isError, true, JSON.stringify(args).slice(0, 60));
  }
  assert.equal((await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope" } })).body.error.code, -32602);
});

test("transport edges: bad JSON, GET, unknown path, oversized body", async () => {
  assert.equal((await rpc(undefined, { body: "{oops" })).status, 400);
  assert.equal((await handleRequest(new Request("https://mcp.harakah.si/mcp"))).status, 405);
  assert.equal((await handleRequest(new Request("https://mcp.harakah.si/other"))).status, 404);
  assert.equal((await handleRequest(new Request("https://mcp.harakah.si/mcp", { method: "POST", headers: { "content-length": "99999999" }, body: "{}" }))).status, 413);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 4, method: "resources/read" })).body.error.code, -32601);
});

test("a bare JSX snippet with no imports is detected as Remotion, and => is never HTML-escaped", async () => {
  const snippet = 'const A=()=>{const t="مرحبا بكم";return <div>{[...t].map((c,i)=><span key={i}>{c}</span>)}</div>}';
  for (const name of ["check_arabic", "fix_arabic"]) {
    const out = (await call(name, { code: snippet })).body.result.structuredContent;
    assert.equal(out.kind, "remotion", name);
  }
  const fixed = (await call("fix_arabic", { code: snippet })).body.result.structuredContent;
  assert.equal(fixed.changed, true); assert.ok(fixed.changes.length > 0);
  assert.doesNotMatch(fixed.fixedCode, /&gt;|&lt;/);
  // HTML fragments (start with a tag) still go to the HTML engine, even with => inside a script
  const frag = '<div><span>م</span><span>ر</span></div><script>gsap.to("span",{y:()=>10})</script>';
  assert.equal((await call("check_arabic", { code: frag })).body.result.structuredContent.kind, "html");
});

test("tool descriptions say when to use them and stay read-only", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  for (const t of body.result.tools) {
    assert.match(t.description, /Use when/); assert.match(t.description, /Persian/);
    assert.ok(t.description.split(/\s+/).length <= 100, t.name);
    assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.idempotentHint, true);
  }
});
