/**
 * Runtime layout audit: render in headless Chrome, read the boxes of Arabic letters, words and row items at
 * sampled frames, and check that logical order maps right to left. Flags frames where the visual order is LTR,
 * flips between frames, or where letters of one word collide; and Arabic rows (flex/grid) laid out LTR.
 * تدقيق ترتيب العرض أثناء التشغيل: يقرأ مواضع الحروف والكلمات وعناصر الصفوف في إطارات مختارة ويتحقق أن الترتيب من اليمين لليسار.
 */
import type { Page } from "puppeteer-core";
import fs from "node:fs";
import { RULES } from "./rules.js";
import type { Issue } from "./engine.js";
import { launch, openPage, seek, detectStage, pageDuration, fileRoots, network, networkReport, type Stage, type NetworkReport } from "./render.js";

/** One frame's observations, computed in the page. */
export interface FrameSeq { key: string; kind: "letters" | "words" | "row" | "items"; text: string; n: number; inv: number[]; pairs: number; coll: number[]; order: string; dir: string; first: string; perm: string; rects?: number[][]; sel?: string; flow?: boolean; slots?: number[] }
export interface FrameRun { key: string; kind: "run" | "list"; text: string; inv: string[]; dir: string; rects?: number[][] }
export interface FrameCross { a: string; b: string; text: string; pairs: string[]; rects?: number[][] }
export interface FrameObs { t: number; seqs: FrameSeq[]; runs: FrameRun[]; cross: FrameCross[] }

/**
 * In-page probe (serialised into the page; keep it self-contained ES2020).
 * - letters/words: a parent with ≥3 visible children that each hold one short Arabic piece (≤3 letters: letters;
 *   one word: words). Adjacent pieces on the same line must step right → left.
 * - row: a flex/grid row (or inline row of chips) whose first visible item starts with Arabic, in an RTL context.
 * - runs: consecutive Arabic words inside one text node must step right → left (catches LTR containers reordering).
 * `data-harakah-ignore` on an element (or an ancestor) skips it.
 */
export const LAYOUT_PROBE = String.raw`(() => {
  const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const ARL = /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF]/;
  const out = { seqs: [], runs: [] };
  const ignored = (el) => !!el.closest("[data-harakah-ignore]");
  const shown = (el) => { if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false; let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o > 0.15; };
  const path = (el) => { const p = []; for (let e = el; e && e.nodeType === 1 && p.length < 5; e = e.parentElement) { p.unshift(e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.classList[0] ? "." + e.classList[0] : "")); if (e.id) break; } return p.join(" > "); };
  const rtlCtx = (el) => { const d = getComputedStyle(el).direction; if (d === "rtl") return true; const l = (el.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang || "").toLowerCase(); return /^(ar|fa|ur|ps|ckb|sd|ug)\b/.test(l) || document.documentElement.dir === "rtl"; };
  const sameLine = (a, b) => { const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return ov > 0.5 * Math.min(a.height, b.height); };
  const R4 = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  // a CSS selector for a fix suggestion (escaped, nth-of-type where siblings share the tag)
  const sel = (el) => { const p = []; for (let e = el; e && e.nodeType === 1 && e !== document.body && p.length < 6; e = e.parentElement) { if (e.id) { p.unshift("#" + CSS.escape(e.id)); return p.join(" > "); } let s = e.tagName.toLowerCase(); if (e.classList[0]) s += "." + CSS.escape(e.classList[0]); const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : []; if (sib.length > 1) s += ":nth-of-type(" + (sib.indexOf(e) + 1) + ")"; p.unshift(s); } return (p.length < 6 ? "body > " : "") + p.join(" > "); };
  const graphemes = (s) => [...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(s)].length;
  const seen = new Set();
  const letterSeqs = [];
  for (const P of document.body.querySelectorAll("*")) {
    if (ignored(P) || !P.children.length) continue;
    const kids = [...P.children].filter((c) => c.textContent.trim() && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName));
    if (kids.length < 2) continue;
    const cs = getComputedStyle(P);
    const texts = kids.map((c) => c.textContent.replace(/[\u200c\u200d\s]/g, ""));
    const arKids = texts.filter((t) => ARL.test(t)).length;
    let kind = null;
    if (kids.length >= 3 && arKids >= Math.max(3, kids.length * 0.6) && kids.every((c) => c.children.length === 0)) {
      kind = texts.every((t) => graphemes(t) <= 3) ? "letters" : kids.every((c) => !/\S\s+\S/.test(c.textContent.trim())) ? "words" : null;
    }
    const isRow = /flex|grid/.test(cs.display) && !/column/.test(cs.flexDirection) && !(cs.display.includes("grid") && cs.gridTemplateColumns.split(" ").length < 2);
    if (!kind && isRow && ARL.test((texts.find(Boolean) || "").slice(0, 3)) && rtlCtx(P.parentElement || P)) kind = "row";
    // any other row holding Arabic: only its stability is checked (items must not swap between frames)
    if (!kind && isRow && arKids) kind = "items";
    if (!kind) continue;
    const vis = kids.filter(shown);
    if (vis.length < 2) continue;
    const rs = vis.map((c) => c.getBoundingClientRect());
    const inv = [], coll = []; let pairs = 0;
    // visual order (right → left) of the item texts, keyed by the set of texts: a rebuilt row keeps no element identity
    const vt = vis.map((c, i) => [rs[i].left + rs[i].width / 2, texts[kids.indexOf(c)]]);
    const perm = vt.map((x) => x[1]).sort().join("\u241f") + "\u241e" + vt.sort((a, b) => b[0] - a[0]).map((x) => x[1]).join("\u241f");
    for (let i = 0; i + 1 < vis.length; i++) {
      const a = rs[i], b = rs[i + 1];
      if (!sameLine(a, b) || a.width < 1 || b.width < 1) continue;
      pairs++;
      const ca = a.left + a.width / 2, cb = b.left + b.width / 2, tol = 0.15 * Math.min(a.width, b.width);
      if (cb > ca + tol) inv.push(i);
      if (kind === "letters") { const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left); if (ov > 0.6 * Math.min(a.width, b.width)) coll.push(i); }
    }
    if (!pairs) continue;
    const order = kind === "items" ? "rtl" : inv.length === 0 ? "rtl" : inv.length === pairs ? "ltr" : "mixed";
    const flow = vis.every((c) => !/absolute|fixed/.test(getComputedStyle(c).position));
    // logical index of the item in each visual slot, right → left (for a reorder suggestion)
    const slots = vis.map((c, i) => [rs[i].left + rs[i].width / 2, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    out.seqs.push({ sel: sel(P), flow, slots, key: path(P), kind, text: (kind === "letters" ? P.textContent.replace(/\s+/g, " ").trim() : texts.filter(Boolean).join(" · ")).slice(0, 60), n: vis.length, inv: kind === "items" ? [] : inv, pairs, coll, order, dir: cs.direction, first: texts[0].slice(0, 24), perm, rects: rs.map(R4) });
    if (kind === "letters") letterSeqs.push({ P, vis, rs, text: P.textContent.replace(/[\u200c\u200d\s]/g, "") });
    seen.add(P);
  }
  // runs of Arabic words inside one text node
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const el = n.parentElement;
    if (!el || !AR.test(n.data) || ignored(el) || !shown(el) || seen.has(el.parentElement)) continue;
    const toks = [...n.data.matchAll(/[^\s]+/g)];
    if (toks.length < 2) continue;
    // a word broken over two lines (word-break: break-all, HZ18) has several line boxes: its union box says nothing about order
    const boxes = toks.map((m) => { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const lines = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))); return { s: m[0], r: r.getBoundingClientRect(), ar: ARL.test(m[0]) && !/[A-Za-z]/.test(m[0]) && lines.size <= 1 }; });
    const inv = [], irs = [];
    for (let i = 0; i + 1 < boxes.length; i++) {
      const a = boxes[i], b = boxes[i + 1];
      if (!a.ar || !b.ar || !sameLine(a.r, b.r)) continue;
      if (b.r.left + b.r.width / 2 > a.r.left + a.r.width / 2 + 2) { inv.push(a.s + " " + b.s); irs.push(R4(a.r), R4(b.r)); }
    }
    if (inv.length) out.runs.push({ key: path(el), kind: "run", text: n.data.trim().slice(0, 60), inv, dir: getComputedStyle(el).direction, rects: irs });
    // a list of Latin items (· • | / ، ,) inside RTL text: the items group into one LTR run, so the first item lands on the left
    if (rtlCtx(el)) {
      const items = n.data.split(/\s+[·•|\/،,]\s+|،\s*|\s*·\s*/).map((x) => x.trim()).filter(Boolean);
      const lat = []; let off = 0;
      for (const it of items) { const i = n.data.indexOf(it, off); off = i + it.length; if (/^[A-Za-z][\w.+#-]*(?:\s[A-Za-z][\w.+#-]*)?$/.test(it)) lat.push([i, it]); }
      const linv = [], lrs = [];
      for (let i = 0; i + 1 < lat.length; i++) {
        const between = n.data.slice(lat[i][0] + lat[i][1].length, lat[i + 1][0]);
        if (!/[·•|\/،,]/.test(between) || ARL.test(between)) continue;
        const box = (k) => { const r = document.createRange(); r.setStart(n, lat[k][0]); r.setEnd(n, lat[k][0] + lat[k][1].length); return r.getBoundingClientRect(); };
        const a = box(i), b = box(i + 1);
        if (sameLine(a, b) && b.left > a.left) { linv.push(lat[i][1] + " · " + lat[i + 1][1]); lrs.push(R4(a), R4(b)); }
      }
      if (linv.length && items.some((x) => ARL.test(x))) out.runs.push({ key: path(el), kind: "list", text: n.data.trim().slice(0, 60), inv: linv, dir: getComputedStyle(el).direction, rects: lrs });
    }
  }
  // two stacked layers of the same per-letter word (a "before" and an "after" copy): a letter of one must not sit on a different letter of the other
  out.cross = [];
  for (let x = 0; x < letterSeqs.length; x++) for (let y = x + 1; y < letterSeqs.length; y++) {
    const A = letterSeqs[x], B = letterSeqs[y];
    if (A.text !== B.text) continue;
    const hit = [], hrs = [];
    A.vis.forEach((ea, i) => B.vis.forEach((eb, j) => {
      const ia = A.P.children.length ? [...A.P.children].indexOf(ea) : i, jb = [...B.P.children].indexOf(eb);
      const ta = ea.textContent.replace(/[\u200c\u200d]/g, ""), tb = eb.textContent.replace(/[\u200c\u200d]/g, "");
      if (ia === jb || ta === tb) return;
      const a = A.rs[i], b = B.rs[j];
      const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left), oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ov > 0.4 * Math.min(a.width, b.width) && oh > 0.4 * Math.min(a.height, b.height)) { hit.push(ta + "/" + tb); hrs.push(R4(a), R4(b)); }
    }));
    if (hit.length) out.cross.push({ a: path(A.P), b: path(B.P), text: A.P.textContent.replace(/[\u200c\u200d]/g, "").replace(/\s+/g, " ").trim().slice(0, 40), pairs: [...new Set(hit)].slice(0, 6), rects: hrs.slice(0, 24) });
  }
  return out;
})()`;

export async function probeFrame(page: Page, t: number): Promise<FrameObs> {
  const r = (await page.evaluate(LAYOUT_PROBE)) as { seqs: FrameSeq[]; runs: FrameRun[]; cross: FrameCross[] };
  return { t, ...r };
}

export interface LayoutFinding {
  code: "HZ24" | "HZ22";
  key: string;
  kind: "letters" | "words" | "row" | "items" | "run" | "list" | "layers";
  text: string;
  /** what went wrong: LTR the whole time, flipped between frames, mixed order, letters on top of each other, items swapping places */
  problem: "ltr" | "flip" | "mixed" | "collide" | "swap";
  frames: number[];
  /** frames where the order was right (for flips) */
  okFrames: number[];
  detail: string;
  /** a fix suggestion: `dir` (direction: rtl on the container, verified by re-probing the flagged frames with the CSS applied) or `reorder` (absolutely placed items: logical index → mirrored slot) */
  suggest?: LayoutSuggestion;
}
export type LayoutSuggestion =
  | { kind: "dir"; selector: string; css: string; verified: boolean }
  | { kind: "reorder"; slots: number[]; detail: string };

const fmt = (ts: number[]) => ts.slice(0, 6).map((t) => t.toFixed(2) + "s").join(", ") + (ts.length > 6 ? ` … (+${ts.length - 6})` : "");

/** Fold per-frame observations into findings: one per element, with the frames where it went wrong. */
export function foldFrames(frames: FrameObs[]): LayoutFinding[] {
  type Acc = { kind: FrameSeq["kind"]; text: string; bad: number[]; ok: number[]; ltr: number[]; coll: number[]; dir: string; first: string; worst?: FrameSeq; perms: Map<string, number[]>; badDir?: string };
  const by = new Map<string, Acc>();
  for (const f of frames) for (const s of f.seqs) {
    const k = s.kind + "|" + s.key;
    const e: Acc = by.get(k) ?? { kind: s.kind, text: s.text, bad: [], ok: [], ltr: [], coll: [], dir: s.dir, first: s.first, perms: new Map() };
    if (s.kind === "row" || s.kind === "items") { const pk = s.perm; e.perms.set(pk, [...(e.perms.get(pk) ?? []), f.t]); }
    if (s.order === "rtl") e.ok.push(f.t); else { e.bad.push(f.t); e.badDir ??= s.dir; if (s.order === "ltr") e.ltr.push(f.t); if (!e.worst || s.inv.length > e.worst.inv.length) e.worst = s; }
    if (s.coll.length) e.coll.push(f.t);
    by.set(k, e);
  }
  const out: LayoutFinding[] = [];
  for (const [k, e] of by) {
    const key = k.slice(k.indexOf("|") + 1);
    if (e.bad.length) {
      const problem = e.ok.length ? "flip" : e.ltr.length === e.bad.length ? "ltr" : "mixed";
      const what = e.kind === "row" ? `row starting "${e.first}"` : e.kind === "letters" ? `per-letter "${e.text}"` : `words "${e.text}"`;
      const detail = problem === "flip"
        ? `${what} is laid out right-to-left at some frames and out of order at ${fmt(e.bad)}: the visual order flips mid-animation`
        : problem === "ltr" ? `${what} is laid out left-to-right (first item on the left, direction: ${e.dir}) at ${fmt(e.bad)}`
        : `${what} is out of order (pieces ${e.worst!.inv.map((i) => `${i + 1}→${i + 2}`).slice(0, 5).join(", ")} step left-to-right) at ${fmt(e.bad)}`;
      const w = e.worst!;
      // suggestion: items in normal flow inside an LTR box → direction: rtl on the box; absolutely placed items → mirror the slots
      const suggest: LayoutSuggestion | undefined = e.kind === "items" ? undefined
        : w.flow && e.badDir === "ltr" && w.sel ? { kind: "dir", selector: w.sel, css: `${w.sel} { direction: rtl !important; }`, verified: false }
        : !w.flow && w.slots && (e.kind === "letters" || e.kind === "words") ? { kind: "reorder", slots: w.slots, detail: `items are placed by position from the left (visual order right→left is ${w.slots.map((i) => i + 1).join(", ")}); place item i at the mirrored slot: x = (n − 1 − i) × w, or anchor from the right (right: i × w / inset-inline-start)` }
        : undefined;
      out.push({ code: e.kind === "row" ? "HZ22" : "HZ24", key, kind: e.kind, text: e.text, problem, frames: e.bad, okFrames: e.ok, detail, ...(suggest ? { suggest } : {}) });
    }
    if (e.coll.length && e.kind === "letters") out.push({ code: "HZ24", key, kind: e.kind, text: e.text, problem: "collide", frames: e.coll, okFrames: [], detail: `letters of "${e.text}" sit on top of each other at ${fmt(e.coll)}` });
    // the same set of items in a different visual order at different frames: labels swapped places mid-animation
    if (!e.bad.length) {
      const byN = new Map<string, [string, number[]][]>();
      for (const [pk, ts] of e.perms) { const set = pk.slice(0, pk.indexOf("\u241e")); byN.set(set, [...(byN.get(set) ?? []), [pk, ts]]); }
      for (const list of byN.values()) if (list.length > 1) {
        list.sort((a, b) => b[1].length - a[1].length);
        const odd = list.slice(1).flatMap((x) => x[1]).sort((a, b) => a - b);
        out.push({ code: "HZ24", key, kind: e.kind, text: e.text, problem: "swap", frames: odd, okFrames: list[0][1], detail: `items of the row "${e.text}" swap places between frames (${list.length} different orders; unusual order at ${fmt(odd)}): rebuild-per-frame or width changes reorder the labels` });
        break;
      }
    }
  }
  const cross = new Map<string, { text: string; t: number[]; pairs: Set<string> }>();
  for (const f of frames) for (const c of f.cross ?? []) { const k = c.a + " ⟷ " + c.b; const e = cross.get(k) ?? { text: c.text, t: [], pairs: new Set() }; e.t.push(f.t); c.pairs.forEach((p) => e.pairs.add(p)); cross.set(k, e); }
  for (const [key, e] of cross) out.push({ code: "HZ24", key, kind: "layers", text: e.text, problem: "collide", frames: e.t, okFrames: [], detail: `two stacked copies of "${e.text}" overlap different letters (${[...e.pairs].slice(0, 4).join(", ")}) at ${fmt(e.t)}` });
  const runs = new Map<string, { kind: FrameRun["kind"]; text: string; t: number[]; inv: string[]; dir: string }>();
  for (const f of frames) for (const r of f.runs) { const k = r.kind + "|" + r.key; const e = runs.get(k) ?? { kind: r.kind, text: r.text, t: [], inv: r.inv, dir: r.dir }; e.t.push(f.t); runs.set(k, e); }
  for (const [k, e] of runs) {
    const key = k.slice(k.indexOf("|") + 1);
    out.push(e.kind === "run"
      ? { code: "HZ24", key, kind: "run", text: e.text, problem: "ltr", frames: e.t, okFrames: [], detail: `Arabic words in "${e.text}" read left-to-right ("${e.inv[0]}") in a ${e.dir} container at ${fmt(e.t)}` }
      : { code: "HZ24", key, kind: "list", text: e.text, problem: "ltr", frames: e.t, okFrames: [], detail: `the Latin items of the list "${e.text}" run left-to-right inside right-to-left text ("${e.inv[0]}": the first item is on the left) at ${fmt(e.t)}` });
  }
  return out;
}

/** Sample times: evenly spaced over [0, duration], at most `max` frames (always includes the last frame). */
export function sampleTimes(duration: number, fps = 10, max = 300): number[] {
  const n = Math.max(2, Math.min(max, Math.round(duration * fps) + 1));
  return Array.from({ length: n }, (_, i) => +(duration * i / (n - 1)).toFixed(3));
}

/**
 * What a sampled audit covers: samples are evenly spaced (sampleTimes), so a problem that lasts less than the gap
 * between two samples can fall between them. `fps` (Remotion) also gives the gap in composition frames.
 */
export interface Coverage { sampled: number; gapSeconds: number; total?: number; gapFrames?: number }
export function coverage(sampled: number, duration: number, fps?: number): Coverage {
  const gapSeconds = sampled > 1 ? +(duration / (sampled - 1)).toFixed(3) : +duration.toFixed(3);
  if (!fps) return { sampled, gapSeconds };
  const total = Math.round(duration * fps) + 1;
  return { sampled, gapSeconds, total, gapFrames: sampled > 1 ? Math.max(1, Math.ceil((total - 1) / (sampled - 1))) : total };
}
/** One line for reports: what was sampled and what can slip between samples. */
export function coverageText(c: Coverage): string {
  if (c.total != null && c.sampled >= c.total) return `every frame checked (${c.total})`;
  const gap = c.gapFrames != null ? `${c.gapFrames} frame(s)` : `${c.gapSeconds}s`;
  return `${c.sampled} sampled frame(s)${c.total != null ? ` of ${c.total}` : ""}, one every ${gap}: a problem shorter than that can be missed (raise --fps, or --all-frames for a short clip)`;
}

/** `--all-frames` checks each frame, so it is for short clips: a minute at 30 fps. Longer: sample with --fps. */
export const ALL_FRAMES_MAX = 1800;
/** Frames in a clip of `duration` seconds at `fps` (both ends included); throws above ALL_FRAMES_MAX. */
export function allFramesCount(duration: number, fps: number): number {
  const total = Math.round(duration * fps) + 1;
  if (total > ALL_FRAMES_MAX) throw new Error(`--all-frames: ${total} frames (${duration}s at ${fps} fps) is more than ${ALL_FRAMES_MAX}. Audit a shorter clip, or sample with --fps.`);
  return total;
}

/** One sampled frame for a scrubber: a JPEG of the page and the boxes of the findings that are wrong at this frame. */
export interface TimelineFrame { t: number; img?: string; boxes: { finding: number; code: string; problem: string; rects: number[][] }[] }
export interface CaptureOptions { /** JPEG width in px (the page is scaled to it) */ width?: number; quality?: number }

/** Boxes of the findings that are wrong at each frame (matched by element key and frame time). */
export function frameBoxes(frames: FrameObs[], findings: LayoutFinding[]): TimelineFrame[] {
  return frames.map((f) => {
    const boxes: TimelineFrame["boxes"] = [];
    findings.forEach((fd, i) => {
      if (!fd.frames.includes(f.t)) return;
      const add = (rects?: number[][]) => { if (rects?.length) boxes.push({ finding: i, code: fd.code, problem: fd.problem, rects }); };
      if (fd.kind === "layers") { for (const c of f.cross ?? []) if (c.a + " ⟷ " + c.b === fd.key) add(c.rects); }
      else if (fd.kind === "run" || fd.kind === "list") { for (const r of f.runs) if (r.kind === fd.kind && r.key === fd.key) add(r.rects); }
      else for (const sq of f.seqs) if (sq.kind === fd.kind && sq.key === fd.key) add(sq.rects);
    });
    return { t: f.t, boxes };
  });
}

/** Probe a page at sampled frames and fold the observations. `seekTo` defaults to the shared seek (timelines, GSAP, CSS, window.seek, rAF clock).
 *  With `capture`, every sampled frame is also screenshotted (JPEG) for a scrubber, with the flagged boxes per frame. */
export async function auditLayoutPage(page: Page, duration: number, o: { fps?: number; maxFrames?: number; seekTo?: (t: number) => Promise<void>; capture?: CaptureOptions; verify?: boolean } = {}): Promise<{ findings: LayoutFinding[]; frames: number; timeline?: TimelineFrame[]; viewport?: { width: number; height: number } }> {
  const times = duration > 0 ? sampleTimes(duration, o.fps ?? 10, o.maxFrames ?? 300) : [0];
  const frames: FrameObs[] = [];
  const imgs: string[] = [];
  const vp = page.viewport() ?? { width: 1280, height: 720 };
  for (const t of times) {
    await (o.seekTo ? o.seekTo(t) : seek(page, t));
    frames.push(await probeFrame(page, t));
    if (o.capture) {
      const scale = Math.min(1, (o.capture.width ?? 640) / vp.width);
      const buf = await page.screenshot({ type: "jpeg", quality: o.capture.quality ?? 60, clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale } });
      imgs.push("data:image/jpeg;base64," + Buffer.from(buf).toString("base64"));
    }
  }
  const findings = foldFrames(frames);
  if (o.verify !== false) await verifySuggestions(page, findings, o.seekTo ?? ((t) => seek(page, t)));
  if (!o.capture) return { findings, frames: times.length };
  const timeline = frameBoxes(frames, findings).map((f, i) => ({ ...f, img: imgs[i] }));
  return { findings, frames: times.length, timeline, viewport: { width: vp.width, height: vp.height } };
}

/**
 * Check `dir` suggestions in the page: inject `direction: rtl !important` on every candidate box, re-probe the frames where
 * they were wrong (≤ 24), and mark a suggestion verified when its finding is gone and no new finding appeared.
 */
export async function verifySuggestions(page: Page, findings: LayoutFinding[], seekTo: (t: number) => Promise<void>): Promise<void> {
  const cand = findings.filter((f) => f.suggest?.kind === "dir");
  if (!cand.length) return;
  const css = [...new Set(cand.map((f) => (f.suggest as any).css as string))].join("\n");
  const ts = [...new Set(cand.flatMap((f) => f.frames))].sort((a, b) => a - b);
  const pick = ts.length > 24 ? ts.filter((_, i) => i % Math.ceil(ts.length / 24) === 0) : ts;
  try {
    await page.evaluate((c: string) => { const st = document.createElement("style"); st.setAttribute("data-harakah-verify", ""); st.textContent = c; document.head.appendChild(st); }, css);
    const again: FrameObs[] = [];
    for (const t of pick) { await seekTo(t); again.push(await probeFrame(page, t)); }
    const after = foldFrames(again);
    const before = new Set(findings.map((f) => f.kind + "|" + f.key + "|" + f.problem));
    const fresh = after.filter((f) => !before.has(f.kind + "|" + f.key + "|" + f.problem) && f.problem !== "swap");
    for (const f of cand) {
      const still = after.some((x) => x.kind === f.kind && x.key === f.key && x.problem !== "swap");
      (f.suggest as any).verified = !still && !fresh.length;
    }
  } catch { /* the page went away: leave the suggestions unverified */ }
  finally { await page.evaluate(() => document.querySelectorAll("style[data-harakah-verify]").forEach((s) => s.remove())).catch(() => {}); }
}

/** Verified `dir` suggestions as one stylesheet (for `audit --fix` and the web tool's after-fix check). */
export function layoutCss(findings: LayoutFinding[]): string {
  const rules = [...new Set(findings.flatMap((f) => (f.suggest?.kind === "dir" && f.suggest.verified ? [f.suggest.css] : [])))];
  return rules.length ? `/* harakah: verified layout-order fixes (HZ24) */\n${rules.join("\n")}` : "";
}
/** Add the verified layout CSS to an HTML document (before </head>, or at the top). */
export function applyLayoutCss(html: string, css: string): string {
  if (!css) return html;
  const tag = `<style data-harakah="layout">\n${css}\n</style>\n`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, tag + "</head>") : tag + html;
}

export interface LayoutAuditResult { file: string; stage: Stage; duration: number; frames: number; findings: LayoutFinding[]; issues: Issue[]; timeline?: TimelineFrame[]; viewport?: { width: number; height: number };
  /** internet hosts the scene loaded from (or that offline mode refused: then the audit saw an incomplete scene) */
  network: NetworkReport }
/** Render an HTML file in headless Chrome and audit its Arabic layout order over time. */
export async function auditLayoutFile(file: string, o: { stage?: Stage; duration?: number; fps?: number; maxFrames?: number; capture?: CaptureOptions; fileRoots?: string[]; offline?: boolean;
  /** every frame at `fps` (default 30) instead of a sample; refused above ALL_FRAMES_MAX */ allFrames?: boolean } = {}): Promise<LayoutAuditResult> {
  const stage = o.stage ?? detectStage(fs.readFileSync(file, "utf8"));
  const net = network(o.offline);
  const browser = await launch();
  try {
    const page = await openPage(browser, file, stage, o.fileRoots && fileRoots(o.fileRoots), net);
    const duration = o.duration ?? stage.duration ?? (await pageDuration(page)) ?? 0;
    const fps = o.allFrames ? o.fps ?? 30 : o.fps;
    const maxFrames = o.allFrames ? allFramesCount(duration, fps!) : o.maxFrames;
    const { findings, frames, timeline, viewport } = await auditLayoutPage(page, duration, { ...o, fps, maxFrames });
    return { file, stage, duration, frames, findings, issues: layoutIssues(findings), ...(timeline ? { timeline, viewport } : {}), network: networkReport(net) };
  } finally { await browser.close(); }
}

const AR_PROBLEM: Record<LayoutFinding["problem"], string> = {
  ltr: "يُعرض من اليسار لليمين (العنصر الأول على اليسار)",
  flip: "يتبدّل ترتيبه أثناء الحركة (صحيح في إطارات ومعكوس في أخرى)",
  mixed: "بعض أجزائه معكوسة الترتيب",
  collide: "حروفه تتراكب فوق بعضها",
  swap: "عناصره تتبادل أماكنها بين الإطارات",
};
const FIX: Record<string, { en: string; ar: string }> = {
  letters: { en: "Give the letter container dir=\"rtl\" (direction:rtl) from its first frame, and position letters from the right (right/inset-inline-start, or x = -i × w), never by left = i × w.", ar: "أعطِ حاوية الحروف dir=\"rtl\" من أول إطار، وضع الحروف من اليمين لا بـ left = i × العرض." },
  words: { en: "Give the word container dir=\"rtl\".", ar: "أعطِ حاوية الكلمات dir=\"rtl\"." },
  row: { en: "Let the row follow dir (remove direction:ltr / row-reverse on it, or set dir=\"rtl\" in Arabic).", ar: "اترك الصف يتبع dir (احذف direction:ltr أو row-reverse، أو ضع dir=\"rtl\" في العربية)." },
  items: { en: "Build the row once and update only its text, with fixed-width items, so labels never move.", ar: "ابنِ الصف مرة واحدة وحدّث النص فقط بعرض ثابت للعناصر، فلا تتحرك العناوين." },
  run: { en: "Isolate the Arabic run: <bdi dir=\"rtl\">…</bdi> (or unicode-bidi:isolate + direction:rtl).", ar: "اعزل النص العربي: <bdi dir=\"rtl\">…</bdi>." },
  list: { en: "Put each item in its own isolated element (<bdi> or one flex item each) so the list follows the RTL order.", ar: "ضع كل عنصر في عنصر معزول مستقل (<bdi> أو عنصر flex لكل واحد) ليتبع القائمة ترتيب اليمين لليسار." },
  layers: { en: "Keep each letter of one layer over the same letter of the other (claim the slot before the next letter arrives), or fade one out before they cross.", ar: "اجعل كل حرف في طبقة فوق نظيره في الطبقة الأخرى، أو أخفِ أحدهما قبل أن يتقاطعا." },
};
const tagOf = (sel: string) => (/(?:^|>\s*)([a-z][\w-]*)[^>]*$/.exec(sel)?.[1] ?? "element");
const sugEn = (f: LayoutFinding, jsx = false) => !f.suggest ? "" : f.suggest.kind === "dir"
  ? ` Suggested fix${f.suggest.verified ? " (verified in Chrome at the flagged frames)" : " (not verified: it did not clear the finding on its own)"}: ${jsx ? `in the component, add dir="rtl" (or style={{ direction: "rtl" }}) to the <${tagOf(f.suggest.selector)}> that holds «${f.text}»` : `\`${f.suggest.css}\`${f.suggest.verified ? "; `harakah-fix audit <file> --fix` adds it" : ""}`}.`
  : ` Suggested fix: ${f.suggest.detail}.`;
const sugAr = (f: LayoutFinding) => !f.suggest ? "" : f.suggest.kind === "dir"
  ? ` إصلاح مقترح${f.suggest.verified ? " (تم التحقق منه في كروم)" : " (غير مؤكد)"}: \`${f.suggest.css}\`.`
  : " إصلاح مقترح: ضع العنصر رقم i في الموضع المعكوس (x = (n − 1 − i) × w) أو ثبّت الحروف من اليمين.";
/** Findings → engine issues (same shape as the static checker's). */
export function layoutIssues(findings: LayoutFinding[], o: { jsx?: boolean } = {}): Issue[] {
  return findings.map((f) => {
    const rule = RULES[f.code];
    const severity = f.code === "HZ22" || f.problem === "collide" || f.problem === "swap" || f.kind === "list" ? "warning" : "error";
    const fix = f.problem === "collide" && f.kind === "letters" ? { en: "Keep neighbouring letters apart while they move (smaller scatter, or push the waiting letters), or mark a deliberate scatter with data-harakah-ignore.", ar: "أبعد الحروف المتجاورة عن بعضها أثناء الحركة، أو علّم التبعثر المقصود بـ data-harakah-ignore." } : FIX[f.kind];
    return {
      code: f.code, name: rule.name, severity, title: rule.title, why: rule.why,
      message: { en: `${f.detail}. Fix: ${fix.en}${sugEn(f, o.jsx)}`, ar: `«${f.text}» ${AR_PROBLEM[f.problem]}. الإصلاح: ${fix.ar}${sugAr(f)}` },
      where: f.key, snippet: f.text, count: f.frames.length, fixMode: f.suggest?.kind === "dir" && f.suggest.verified ? "auto" : "none", fixable: false,
      ...(f.suggest ? { suggest: f.suggest } : {}),
    } as Issue;
  });
}
