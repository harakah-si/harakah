import { test } from "node:test";
import assert from "node:assert/strict";
import { zwjPad, joiningType, lamAlefMerges, normalizeDigits, reversedScore, graphemes, groupIntoWords } from "../src/arabic.ts";

const Z = "\u200D";

test("joining types", () => {
  assert.equal(joiningType("س"), "D");
  assert.equal(joiningType("ا"), "R");
  assert.equal(joiningType("ى"), "D"); // alef maksura is dual-joining (common bug: treating it as right-joining)
  assert.equal(joiningType("ة"), "R");
  assert.equal(joiningType("ء"), "U");
  assert.equal(joiningType("\u064E"), "T");
  assert.equal(joiningType("ـ"), "C");
});

test("zwjPad: سلام → letters padded by context", () => {
  assert.deepEqual(zwjPad(["س", "ل", "ا", "م"]), ["س" + Z, Z + "ل" + Z, Z + "ا", "م"]);
});

test("zwjPad: right-joining letters do not join forward", () => {
  // د only joins to the previous letter; و after it starts fresh
  assert.deepEqual(zwjPad(["ب", "د", "و"]), ["ب" + Z, Z + "د", "و"]);
});

test("zwjPad: diacritics stay with their letter and are transparent", () => {
  const parts = graphemes("مَعَ");
  assert.equal(parts.length, 2);
  assert.deepEqual(zwjPad(parts), ["مَ" + Z, Z + "عَ"]);
});

test("zwjPad is idempotent", () => {
  const once = zwjPad(["ع", "ل", "ى"]);
  assert.deepEqual(zwjPad(once), once);
});

test("lam-alef boundaries are found (mandatory ligature)", () => {
  assert.deepEqual(lamAlefMerges(["ا", "ل", "ا", "ه"]), [1]);
  assert.deepEqual(lamAlefMerges(["ل", "أ"]), [0]);
});

test("digits normalize both ways", () => {
  assert.equal(normalizeDigits("الحلقة 12", "eastern"), "الحلقة ١٢");
  assert.equal(normalizeDigits("١٥ و ۳", "western"), "15 و 3");
  assert.equal(normalizeDigits("1.2 مليون و 25% و 1,250", "eastern"), "١٫٢ مليون و ٢٥٪ و ١٬٢٥٠");
  assert.equal(normalizeDigits("١٫٢ و ٢٥٪", "western"), "1.2 و 25%");
});

test("reversed Arabic heuristic", () => {
  assert.ok(reversedScore("ماشلاو ةزغ لهأ ىلع مالس").score >= 0.25);
  assert.equal(reversedScore("سلام على أهل غزة والشام").suspicious, 0);
});

test("groupIntoWords", () => {
  assert.deepEqual(groupIntoWords(["ب", "ي", " ", "ت"]).map((w) => w.text), ["بي", "ت"]);
});
