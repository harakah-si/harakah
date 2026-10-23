// Bundle the hosted MCP worker (run from repo root: node mcp/build.mjs)
import { build } from "esbuild";
import { readFileSync } from "node:fs";
const PKG_VERSION = JSON.parse(readFileSync("package.json", "utf8")).version;
await build({
  entryPoints: ["mcp/src/worker.ts"], bundle: true, format: "esm", platform: "node", target: "es2022", minify: true,
  external: ["node:*"], outfile: "mcp/dist/worker.js", logLevel: "error", define: { "import.meta.url": "\"file:///bundle/worker.js\"" },
  banner: { js: `globalThis.__HARAKAH_VERSION__ = ${JSON.stringify(PKG_VERSION)}; ` + 'import { createRequire as __cr } from "node:module"; const require = __cr("/"); var __filename = "/bundle/worker.js", __dirname = "/bundle";' },
});
