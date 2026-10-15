// Harakah Pro waitlist: a Cloudflare Pages Function (POST /api/waitlist) that saves one email to Workers KV.
// قائمة انتظار حركة برو: يحفظ البريد فقط في KV على Cloudflare.
//
// Binding: a KV namespace bound as WAITLIST (Pages → Settings → Bindings). Without it the endpoint answers 503 and
// the page offers the mailto link instead. The key is the lowercased email, so a second signup changes nothing.
// The value keeps only what the launch email needs: when, and which language. No IP, no user agent.
//
// The landing posts JSON with fetch. Without JavaScript the form posts urlencoded and gets a small bilingual page.

const MAX_BODY = 2048;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const page = (lang, ok) => {
  const home = lang === "en" ? "/en/#pro" : "/#pro";
  const [ar, en] = ok
    ? ["أنت في القائمة. سنراسلك مرة واحدة عند إطلاق حركة برو.", "You're on the list. We'll email you once, when Harakah Pro opens."]
    : ["تعذّر الحفظ. راسلنا على hello@harakah.si", "Couldn't save that. Email hello@harakah.si instead."];
  return new Response(`<!doctype html><html lang="${lang}" dir="${lang === "en" ? "ltr" : "rtl"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harakah Pro</title>
<body style="font:18px/1.7 system-ui,sans-serif;max-width:36em;margin:15vh auto;padding:0 20px"><p lang="ar" dir="rtl">${ar}</p><p lang="en" dir="ltr">${en}</p><p><a href="${home}">harakah.si</a></p></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json(403, { ok: false, error: "origin" });
  if (+(request.headers.get("content-length") || 0) > MAX_BODY) return json(413, { ok: false, error: "size" });

  const type = request.headers.get("content-type") || "";
  const wantsJson = type.includes("application/json");
  let data = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(413, { ok: false, error: "size" });
    data = wantsJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return json(400, { ok: false, error: "body" });
  }
  const lang = data.lang === "en" ? "en" : "ar";
  const reply = (status, body) => (wantsJson ? json(status, body) : page(lang, status < 300));

  // Honeypot: people never see the field, bots fill it. Answer as if it worked and save nothing.
  if (typeof data.website === "string" && data.website.trim()) return reply(200, { ok: true });

  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return reply(400, { ok: false, error: "email" });

  if (!env.WAITLIST) return reply(503, { ok: false, error: "unavailable" });
  // Same answer whether the email is new or already there, so the endpoint can't be used to look people up.
  if ((await env.WAITLIST.get(email)) === null) {
    const at = new Date().toISOString();
    await env.WAITLIST.put(email, JSON.stringify({ at, lang }), { metadata: { at, lang } });
  }
  return reply(200, { ok: true });
}
