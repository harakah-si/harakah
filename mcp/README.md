# Hosted Harakah MCP server (mcp.harakah.si)

Remote MCP server for the ChatGPT / Codex plugin. Stateless Streamable HTTP (JSON responses, no SSE, no sessions),
no auth, no storage, Workers logs/observability off. Wraps harakah-fixer's engine (`src/engine.ts`) and Remotion
codemod (`src/remotion/codemod.ts`) on inline code only; it never touches a filesystem.

Tools (both `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`):
- `check_arabic { code, kind?, digits? }` → `{ kind, ok, summary, issues[] }`
- `fix_arabic { code, kind?, digits?, split? }` → `{ kind, changed, changes[], remaining[], helper?, fixedCode }`

Limits: `code` ≤ 200,000 chars, request body ≤ ~816 KB, ≤ 10 messages per batch. Unknown arguments are rejected.

```sh
node mcp/build.mjs                                   # bundle → mcp/dist/worker.js (~9.6 MB, ~2.4 MB gzip)
node --import tsx --test mcp/test/worker.test.ts     # unit tests
cd mcp && npx wrangler@4 dev                         # local: http://localhost:8787/mcp
cd mcp && npx wrangler@4 deploy                      # deploys to mcp.harakah.si (custom domain)
npx @modelcontextprotocol/inspector --cli https://mcp.harakah.si/mcp --transport http --method tools/list
```
