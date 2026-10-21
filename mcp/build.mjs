// Bundle the hosted MCP worker (run from repo root: node mcp/build.mjs)
import { build } from "esbuild";
await build({
  entryPoints: ["mcp/src/worker.ts"], bundle: true, format: "esm", platform: "node", target: "es2022", minify: true,
  external: ["node:*"], outfile: "mcp/dist/worker.js", logLevel: "error", define: { "import.meta.url": "\"file:///bundle/worker.js\"" },
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr("/"); var __filename = "/bundle/worker.js", __dirname = "/bundle";' },
});
