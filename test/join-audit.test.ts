import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { Browser } from "puppeteer-core";
import { launch, openPage, joinAudit } from "../src/render.ts";

const FX = path.resolve(import.meta.dirname, "fixtures");
const stage = { width: 1080, height: 1080 };
let browser: Browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test("join audit: a joined title grown with transform: scale() on an overflowing RTL page matches its reference", { timeout: 60000 }, async () => {
  const page = await openPage(browser, path.join(FX, "join-audit-scaled.html"), stage);
  const joins = await joinAudit(page);
  assert.equal(joins.length, 2, JSON.stringify(joins));
  const [joined, broken] = joins;
  // the reference is painted at the element's accumulated scale and cropped at the right place (whole word, not «صلة»)
  assert.equal(joined.joinedBefore, true, JSON.stringify(joined));
  assert.equal(joined.before, joined.reference);
  assert.ok(Math.abs(joined.widthBefore / joined.widthReference - 1) <= 0.04, JSON.stringify(joined));
  // the per-letter (unjoined) title at the same scale is still caught
  assert.equal(broken.joinedBefore, false, JSON.stringify(broken));
  assert.equal(broken.reference, joined.reference);
  assert.ok(broken.widthBefore > broken.widthReference * 1.04, JSON.stringify(broken));
});

test("join audit: un-rendered split parents (display:none, visibility:hidden, opacity:0) are skipped, not reported broken", { timeout: 60000 }, async () => {
  const page = await openPage(browser, path.join(FX, "join-audit-hidden.html"), stage);
  const joins = await joinAudit(page);
  assert.deepEqual(joins.map((j) => j.text), ["متصلة"], JSON.stringify(joins));
  assert.equal(joins[0].joinedBefore, true, JSON.stringify(joins[0]));
});
