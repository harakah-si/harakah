/** Hosted Harakah MCP server: stateless Streamable HTTP (JSON responses), no auth, no storage, no logging of inputs. */
import { TOOLS, checkArabic, fixArabic, InputError, VERSION, MAX_CODE_CHARS } from "./tools.js";

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = MAX_CODE_CHARS * 4 + 16_384; // bytes (UTF-8 worst case + JSON overhead)
const INSTRUCTIONS = "Harakah checks and fixes Arabic text in motion-graphics source code (HTML/GSAP/HyperFrames pages and Remotion .tsx/.jsx components). Use check_arabic to list problems in one file and fix_arabic to get a repaired copy. Send one file's code per call. Inputs are processed in memory and not stored.";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization", "access-control-expose-headers": "mcp-protocol-version" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra } });
const rpcErr = (id: any, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function handle(msg: any): any | undefined {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcErr(msg?.id, -32600, "Invalid Request");
  const { id, method, params } = msg;
  if (id === undefined || id === null) return undefined; // notification
  switch (method) {
    case "initialize": {
      const v = PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
      return { jsonrpc: "2.0", id, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "harakah", title: "Harakah Arabic Motion", version: VERSION, websiteUrl: "https://harakah.si", icons: [{ src: "https://harakah.si/assets/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }] }, instructions: INSTRUCTIONS } };
    }
    case "ping": return { jsonrpc: "2.0", id, result: {} };
    case "tools/list": return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const name = params?.name; const fn = name === "check_arabic" ? checkArabic : name === "fix_arabic" ? fixArabic : null;
      if (!fn) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      try {
        const out: any = fn(params?.arguments ?? {});
        const { fixedCode, ...meta } = out;
        const content: any[] = [{ type: "text", text: JSON.stringify(meta) }];
        if (fixedCode !== undefined) content.push({ type: "text", text: fixedCode });
        return { jsonrpc: "2.0", id, result: { content, structuredContent: out, isError: false } };
      } catch (e: any) {
        const msgText = e instanceof InputError ? e.message : "Harakah could not parse this code. Check that it is a complete HTML page or a valid .tsx/.jsx file.";
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: msgText }], isError: true } };
      }
    }
    case "resources/list": return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list": return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default: return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === "/" && req.method === "GET") return new Response(`Harakah MCP server ${VERSION}. Connect an MCP client to ${url.origin}/mcp (Streamable HTTP, no sign-in). Privacy: https://harakah.si/privacy/\n`, { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
  if (url.pathname === "/.well-known/openai-apps-challenge") return new Response("gOMc_yiA5sDM9dLsd-K_DUa6ttb4hqJT-4vTICoGyu8", { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (url.pathname === "/healthz") return json({ ok: true, version: VERSION });
  if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
  if (req.method === "GET") return json(rpcErr(null, -32000, "This server is stateless and does not offer an SSE stream; send JSON-RPC with POST."), 405, { allow: "POST" });
  if (req.method === "DELETE") return new Response(null, { status: 405, headers: { allow: "POST", ...CORS } });
  if (req.method !== "POST") return json(rpcErr(null, -32000, "Method not allowed"), 405, { allow: "POST" });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return json(rpcErr(null, -32600, `Request too large; the limit is ${MAX_CODE_CHARS} characters of code per call.`), 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(rpcErr(null, -32600, `Request too large; the limit is ${MAX_CODE_CHARS} characters of code per call.`), 413);
  let body: any; try { body = JSON.parse(raw); } catch { return json(rpcErr(null, -32700, "Parse error"), 400); }
  const batch = Array.isArray(body); const msgs = batch ? body : [body];
  if (!msgs.length || msgs.length > 10) return json(rpcErr(null, -32600, "Invalid Request"), 400);
  const out = msgs.map(handle).filter((x) => x !== undefined);
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? out : out[0]);
}

export default { fetch: (req: Request) => handleRequest(req) };
