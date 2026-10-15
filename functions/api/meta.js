// GET /api/meta on harakah.si (Cloudflare Pages Function). The landing reads `version` from it to label the
// install chip; the local server (src/server.ts) answers the same route. Version comes from package.json at build.
import pkg from "../../package.json";

export function onRequestGet() {
  return new Response(JSON.stringify({ name: pkg.name, version: pkg.version }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
