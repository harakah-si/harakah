// Pro waitlist endpoint (functions/api/waitlist.js, a Cloudflare Pages Function) with an in-memory KV, plus the
// landing form in a real Chrome against a stub of the endpoint: inline success, typo hint, and the mailto fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore plain JS: Cloudflare compiles it, not tsc
import { onRequestPost } from "../functions/api/waitlist.js";
import { launch } from "../src/render.ts";

const ORIGIN = "https://harakah.si";
function kv() {
  const m = new Map<string, { value: string; metadata: unknown }>();
  return { m, get: async (k: string) => m.get(k)?.value ?? null, put: async (k: string, value: string, o?: { metadata?: unknown }) => void m.set(k, { value, metadata: o?.metadata }) };
}
const post = (body: string, { type = "application/json", origin = ORIGIN, env = { WAITLIST: kv() } as any } = {}) =>
  onRequestPost({ env, request: new Request(`${ORIGIN}/api/waitlist`, { method: "POST", body, headers: { "content-type": type, ...(origin ? { origin } : {}) } }) }) as Promise<Response>;

test("waitlist: saves the lowercased email once, with only the time and language", async () => {
  const store = kv(), env = { WAITLIST: store };
  const r = await post(JSON.stringify({ email: "  Studio@Example.COM ", lang: "en" }), { env });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual([...store.m.keys()], ["studio@example.com"]);
  const first = JSON.parse(store.m.get("studio@example.com")!.value);
  assert.deepEqual(Object.keys(first).sort(), ["at", "lang"]);
  assert.equal(first.lang, "en");
  // a second signup gets the same answer and keeps the first record
  const again = await post(JSON.stringify({ email: "studio@example.com", lang: "ar" }), { env });
  assert.deepEqual(await again.json(), { ok: true });
  assert.equal(JSON.parse(store.m.get("studio@example.com")!.value).lang, "en");
});

test("waitlist: refuses bad emails, other origins and big bodies; the honeypot saves nothing", async () => {
  for (const email of ["", "nope", "a@b", "a b@c.com", "<x>@y.com", `${"a".repeat(250)}@b.com`]) {
    assert.equal((await post(JSON.stringify({ email }))).status, 400, email);
  }
  assert.equal((await post(JSON.stringify({ email: "a@b.com" }), { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(JSON.stringify({ email: "a@b.com" }), { origin: "" })).status, 403);
  assert.equal((await post(JSON.stringify({ email: "a@b.com", pad: "x".repeat(4000) }))).status, 413);
  assert.equal((await post("{not json")).status, 400);
  const store = kv();
  const bot = await post(JSON.stringify({ email: "bot@spam.com", website: "http://spam" }), { env: { WAITLIST: store } });
  assert.equal(bot.status, 200);
  assert.equal(store.m.size, 0);
});

test("waitlist: no KV binding answers 503; a plain form post gets a bilingual page", async () => {
  assert.equal((await post(JSON.stringify({ email: "a@b.com" }), { env: {} })).status, 503);
  const store = kv();
  const r = await post("email=form%40example.com&lang=en&website=", { type: "application/x-www-form-urlencoded", env: { WAITLIST: store } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type")!, /text\/html/);
  const html = await r.text();
  assert.match(html, /You're on the list/);
  assert.match(html, /أنت في القائمة/);
  assert.ok(store.m.has("form@example.com"));
});

test("waitlist form: inline success, typo hint, and the mailto fallback when there's no endpoint", { timeout: 60000 }, async () => {
  const landing = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "landing.html"), "utf8");
  let mode: "ok" | "missing" = "ok";
  const got: any[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/waitlist") {
      let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
        got.push(JSON.parse(b));
        if (mode === "missing") { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
      });
      return;
    }
    if (req.url!.startsWith("/?") || req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(landing); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/?lang=en&shot=1`, { waitUntil: "load" }); await page.evaluate(() => document.fonts.ready);
    // press buttons through the DOM: a click by coordinates lands beside the button if the layout moves under it
    const press = (sel: string) => page.$eval(sel, (b) => (b as HTMLElement).click());
    const status = () => page.$eval("#wl-msg", (e) => ({ cls: e.className, text: (e as HTMLElement).innerText.trim() }));
    // invalid: inline error, nothing sent
    await page.type("#wl-email", "nope");
    await press("#waitlist button[type=submit]");
    assert.match((await status()).text, /valid email/);
    assert.equal(await page.$eval("#wl-email", (e) => e.getAttribute("aria-invalid")), "true");
    assert.equal(got.length, 0);
    // typo: one hint, clicking it fixes the field
    await page.$eval("#wl-email", (e) => ((e as HTMLInputElement).value = ""));
    await page.type("#wl-email", "me@gmial.com");
    await press("#waitlist button[type=submit]");
    assert.match((await status()).text, /Did you mean me@gmail\.com/);
    await press("#wl-msg [lang=en] button");
    assert.equal(await page.$eval("#wl-email", (e) => (e as HTMLInputElement).value), "me@gmail.com");
    // success: posted as JSON with the page language, the field row goes away
    await press("#waitlist button[type=submit]");
    await page.waitForFunction(() => document.querySelector("#waitlist")!.classList.contains("done"));
    assert.deepEqual(got[0], { email: "me@gmail.com", lang: "en", website: "" });
    assert.match((await status()).text, /on the list/);
    // no endpoint (local serve, other static hosts): says so and links the email
    mode = "missing";
    await page.goto(`${base}/?lang=ar&shot=1`, { waitUntil: "load" }); await page.evaluate(() => document.fonts.ready);
    await page.type("#wl-email", "studio@example.com");
    await press("#waitlist button[type=submit]");
    await page.waitForFunction(() => document.querySelector("#wl-msg")!.classList.contains("err"));
    assert.match((await status()).text, /لم نتمكن من حفظ بريدك/);
    assert.match(await page.$eval("#wl-msg a", (a) => a.getAttribute("href")!), /^mailto:hello@harakah\.si/);
    assert.equal(got.at(-1).lang, "ar");
  } finally { await browser.close(); server.close(); }
});
