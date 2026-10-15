#!/usr/bin/env node
import { Command, Option } from "commander";
import fs from "node:fs";
import path from "node:path";
import { analyze, fix, type Options } from "./engine.js";
import { fixRemotion, cssIssues, type FixRemotionOptions, type FixRemotionResult } from "./remotion/project.js";
import { loadInputProps } from "./remotion/input-props.js";
import { compareRemotion } from "./remotion/compare.js";
import type { Issue } from "./engine.js";
import { toReport, formatText, summarize, VERSION } from "./report.js";
import { compareHtml, writeFixed } from "./pipeline.js";
import { networkText } from "./render.js";
import { htmlFiles } from "./gate.js";
import { isTemplate, analyzeTemplate, checkTemplates, templateFiles } from "./templates.js";
import { hasArabic } from "./arabic.js";

const program = new Command();
program.name("harakah-fix").description("Detect and fix broken Arabic in HTML and Remotion motion graphics · كشف وإصلاح النص العربي في الموشن جرافيك").version(VERSION);

/** --offline: every render in this run (compare, audit, gate --layout) refuses the internet; see render.ts network() */
const offline = (o: { offline?: boolean }) => { if (o.offline) process.env.HARAKAH_OFFLINE = "1"; };

const fixOpts = (cmd: Command) => cmd
  .addOption(new Option("--split <mode>", "per-letter split repair: zwj keeps letter boxes (default), word merges into words").choices(["zwj", "word"]).default("zwj"))
  .addOption(new Option("--digits <mode>", "digit policy: eastern ١٢٣ (default), western 123, keep").choices(["eastern", "western", "keep"]).default("eastern"))
  .addOption(new Option("--font <key>", "OFL Arabic fallback font (HTML default plex; Remotion default auto = Alexandria for display families, IBM Plex Sans Arabic for text)").choices(["auto", "plex", "alexandria", "readex", "cairo", "tajawal", "naskh"]))
  .addOption(new Option("--font-src <mode>", "how injected @font-face references the font").choices(["file", "data", "google", "none"]).default("file"))
  .option("--replace-proprietary", "replace Thmanyah/commercial Arabic fonts with the OFL font", false)
  .option("--no-bidi", "do not wrap Latin runs in <bdi>")
  .addOption(new Option("--shim <mode>", "inject runtime ZWJ shim").choices(["auto", "always", "never"]).default("auto"))
  .option("--only <codes>", "comma-separated rule codes to run (e.g. HZ01,HZ07)")
  .option("--disable <codes>", "comma-separated rule codes to skip")
  .option("--assume-arabic", "Remotion: treat every component as Arabic (normally not needed: Arabic is followed through props, defaultProps and <Composition defaultProps>)", false)
  .option("--props <json|file>", "Remotion: render-time input props (same as `remotion render --props`); Arabic in them is followed like defaultProps")
  .option("--wrap-words", "Remotion: keep words together; group per-letter boxes into nowrap word boxes so lines never break mid-word", false)
  .addOption(new Option("--prettier <mode>", "Remotion: run prettier on changed files (auto = only if the file was already prettier-formatted)").choices(["auto", "always", "never"]).default("auto"))
  .addOption(new Option("--helper <mode>", "Remotion: import splitArabic/formatDigits from @harakah/remotion-arabic (package) or a vendored src/harakah-arabic.tsx (vendor); auto picks package if it is a dependency").choices(["auto", "vendor", "package"]).default("auto"));

function toOptions(o: any): Options {
  return {
    split: o.split, digits: o.digits, font: o.font && o.font !== "auto" ? o.font : "plex", fontSrc: o.fontSrc, replaceProprietary: !!o.replaceProprietary, bidi: o.bidi !== false,
    shim: o.shim, only: o.only ? String(o.only).split(",").map((s: string) => s.trim().toUpperCase()) : undefined,
    disable: o.disable ? String(o.disable).split(",").map((s: string) => s.trim().toUpperCase()) : undefined,
  };
}
const read = (f: string) => { if (!fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(2); } return fs.readFileSync(f, "utf8"); };
const isRemotion = (f: string) => /\.(t|j)sx$/i.test(f) || (fs.existsSync(f) && fs.statSync(f).isDirectory());
function remotionOptions(o: any): FixRemotionOptions {
  const font = o.font === "plex" || o.font === "alexandria" ? o.font : "auto";
  if (o.font && !["auto", "plex", "alexandria"].includes(o.font)) console.error(`note: Remotion font swap supports auto|plex|alexandria; using auto.`);
  let inputProps;
  try { inputProps = loadInputProps(o.props); } catch (e) { console.error((e as Error).message); process.exit(2); }
  return { split: o.split, digits: o.digits, font, bidi: o.bidi !== false, assumeArabic: !!o.assumeArabic, wrapWords: !!o.wrapWords, prettier: o.prettier, helper: o.helper,
    inputProps, composition: o.composition ? String(o.composition).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined };
}
function remotionIssues(r: FixRemotionResult, fixed: boolean): { file: string; issues: Issue[] }[] {
  const out = r.files.filter((f) => f.issues.length).map((f) => ({ file: path.relative(process.cwd(), f.file), issues: f.issues }));
  for (const c of r.css) if (c.notes.length) out.push({ file: path.relative(process.cwd(), c.file), issues: cssIssues(c, fixed) });
  return out;
}
function only(issues: Issue[], o: any): Issue[] {
  const on = o.only ? String(o.only).split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean) : undefined;
  const off = o.disable ? String(o.disable).split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean) : [];
  return issues.filter((i) => (!on || on.includes(i.code)) && !off.includes(i.code));
}

fixOpts(program.command("check <target>").description("report Arabic problems in HTML, .tsx/.jsx, or a Remotion project folder · فحص"))
  .option("--composition <ids>", "Remotion: composition id(s) the --props apply to (default: all)")
  .option("--json", "print JSON report")
  .addOption(new Option("--lang <lang>", "report language").choices(["en", "ar", "both"]).default("both"))
  .option("--report <path>", "also write JSON report to a file")
  .action(async (file: string, o: any) => {
    if (!fs.existsSync(file)) { console.error(`Not found: ${file}`); process.exit(2); }
    if (isRemotion(file)) {
      const r = await fixRemotion(file, { ...remotionOptions(o), dryRun: true });
      const per = remotionIssues(r, false).map((x) => ({ ...x, issues: only(x.issues, o) })).filter((x) => x.issues.length);
      // a folder can also hold HyperFrames/GSAP HTML compositions (same scan as `gate`)
      const htmls = fs.statSync(file).isDirectory() ? htmlFiles(path.resolve(file)).filter((f) => hasArabic(fs.readFileSync(f, "utf8"))) : [];
      const htmlPer = htmls.map((f) => ({ file: path.relative(process.cwd(), f), issues: only(analyze(fs.readFileSync(f, "utf8"), { ...toOptions(o), baseDir: path.dirname(f) }).issues, o) })).filter((x) => x.issues.length);
      per.push(...htmlPer);
      // .astro / .vue / .svelte templates (report-only, original line numbers)
      const tplPer = fs.statSync(file).isDirectory() ? checkTemplates(path.resolve(file), toOptions(o)).map((x) => ({ file: path.relative(process.cwd(), x.file), issues: only(x.issues, o) })).filter((x) => x.issues.length) : [];
      per.push(...tplPer);
      const scanned = r.files.length + htmls.length + (fs.statSync(file).isDirectory() ? templateFiles(path.resolve(file)).length : 0);
      const all = per.flatMap((x) => x.issues);
      const rep = { tool: "harakah-fix", version: VERSION, target: file, kind: "remotion", files: scanned, summary: summarize(all), results: per, props: r.props, styles: r.styles, i18n: r.i18n };
      if (o.report) fs.writeFileSync(o.report, JSON.stringify(rep, null, 2));
      if (o.json) console.log(JSON.stringify(rep, null, 2));
      else {
        printProps(r);
        if (!per.length) console.log(`✔ ${scanned} file(s) scanned: no Arabic problems · لا توجد مشاكل`);
        for (const x of per) console.log(formatText(x.issues, { lang: o.lang, file: x.file }) + "\n");
        const codeIssues = per.filter((x) => !htmlPer.includes(x) && !tplPer.includes(x)).flatMap((x) => x.issues);
        if (codeIssues.some((i) => i.fixable)) console.log(`→ ${codeIssues.filter((i) => i.fixable).length} auto-fixable, ${codeIssues.filter((i) => !i.fixable).length} manual · run \`harakah-fix fix ${file} --write\` (or -o <dir>) · add --diff to preview`);
        for (const x of htmlPer) if (x.issues.some((i) => i.fixable)) console.log(`→ HTML: harakah-fix fix ${x.file} -o ${x.file.replace(/\.html?$/i, "")}.fixed.html`);
        if (tplPer.length) console.log(`→ ${tplPer.length} template(s) (.astro/.vue/.svelte): report-only, apply the suggested fixes at the listed lines`);
      }
      process.exitCode = all.some((i) => i.severity === "error") ? 1 : 0;
      return;
    }
    if (isTemplate(file)) {
      const issues = only(analyzeTemplate(path.resolve(file), toOptions(o)), o);
      const rep = { tool: "harakah-fix", version: VERSION, file, kind: "template", summary: summarize(issues), issues };
      if (o.report) fs.writeFileSync(o.report, JSON.stringify(rep, null, 2));
      console.log(o.json ? JSON.stringify(rep, null, 2) : formatText(issues, { lang: o.lang, file }));
      process.exitCode = issues.some((i) => i.severity === "error") ? 1 : 0;
      return;
    }
    const src = read(file);
    const an = analyze(src, { ...toOptions(o), baseDir: path.dirname(path.resolve(file)) });
    const rep = toReport(an, file);
    if (o.report) fs.writeFileSync(o.report, JSON.stringify(rep, null, 2));
    console.log(o.json ? JSON.stringify(rep, null, 2) : formatText(an.issues, { lang: o.lang, file }));
    process.exitCode = an.issues.some((i) => i.severity === "error") ? 1 : 0;
  });

fixOpts(program.command("fix <target>").description("write a fixed copy (HTML), or rewrite .tsx/.jsx / a Remotion project with the codemod · إصلاح"))
  .option("--composition <ids>", "Remotion: composition id(s) the --props apply to (default: all)")
  .option("-o, --out <path>", "output: HTML file; for Remotion a .tsx/.jsx path or a directory (projects are copied there)")
  .option("--write", "Remotion: rewrite files in place", false)
  .option("--dry-run", "Remotion: print the diff, write nothing", false)
  .option("--diff", "Remotion: also print a unified diff", false)
  .option("--patch <path>", "templates (.astro/.vue/.svelte): write the reviewable unified patch to a file (default: print it)")
  .option("--report <path>", "write JSON report")
  .option("--json", "print JSON report")
  .addOption(new Option("--lang <lang>", "report language").choices(["en", "ar", "both"]).default("both"))
  .action(async (file: string, o: any) => {
    if (!fs.existsSync(file)) { console.error(`Not found: ${file}`); process.exit(2); }
    const tplFolder = fs.statSync(file).isDirectory() && !(await import("./gate.js")).isRemotionProject(path.resolve(file)) && templateFiles(path.resolve(file)).length > 0;
    if (isTemplate(file) || tplFolder) {
      // templates: position edits on the original source, emitted as a unified patch (no serializer round-trip)
      const { templatePatches } = await import("./template-patch.js");
      const rs = templatePatches(file, toOptions(o));
      const patch = rs.map((r) => r.patch).join("");
      const before = rs.reduce((n, r) => n + r.before.length, 0), after = rs.reduce((n, r) => n + r.after.length, 0);
      if (o.write) for (const r of rs) if (r.patch) fs.writeFileSync(r.file, r.fixed);
      if (o.out && !tplFolder) fs.writeFileSync(o.out, rs[0]?.fixed ?? read(file));
      if (o.patch) fs.writeFileSync(o.patch, patch);
      if (o.json) { console.log(JSON.stringify({ tool: "harakah-fix", version: VERSION, target: file, kind: "template", before, after, patch, results: rs.map((r) => ({ file: path.relative(process.cwd(), r.file), edits: r.edits.map(({ line, what }) => ({ line, what })), skipped: r.skipped, remaining: r.after })) }, null, 2)); return; }
      if (!o.write && !o.patch && !o.out) process.stdout.write(patch);
      const changed = rs.filter((r) => r.patch).length;
      const log = !o.write && !o.patch && !o.out ? console.error : console.log;
      for (const r of rs) for (const k of r.skipped) log(`  ${path.relative(process.cwd(), r.file)}:${k.line}  not patched: ${k.why}`);
      log(`${o.write ? "✔ Patched" : "Patch for"} ${changed} template(s): findings ${before} → ${after}${o.patch ? ` · patch → ${o.patch}` : ""}${o.write ? "" : " (review it, then `git apply` or rerun with --write)"} · ${o.write ? "تم التعديل" : "تعديل قابل للمراجعة"}`);
      return;
    }
    if (isRemotion(file)) {
      if (!o.out && !o.write && !o.dryRun) { console.error("Remotion: pass -o <dir|file.tsx> for a fixed copy, --write to edit in place, or --dry-run to preview."); process.exit(2); }
      const r = await fixRemotion(file, { ...remotionOptions(o), out: o.out, dryRun: !!o.dryRun });
      const per = remotionIssues(r, !o.dryRun);
      const changed = r.files.filter((f) => f.after !== f.before);
      const cssChanged = r.css.filter((c) => c.after !== c.before);
      // every file the fix writes, with its full new text (absolute paths): an editor can preview and apply these itself
      const changes = [...changed, ...cssChanged].map((f) => ({ file: path.resolve(f.outFile), text: f.after, create: !fs.existsSync(f.outFile) }));
      if (r.helperWrite) changes.push({ file: path.resolve(r.helperWrite.file), text: r.helperWrite.text, create: !r.helperWrite.exists });
      if (o.json) { console.log(JSON.stringify({ tool: "harakah-fix", version: VERSION, target: file, kind: "remotion", outRoot: r.outRoot, helper: r.helper, props: r.props, styles: r.styles, results: per, diffs: [...changed, ...cssChanged].map((f) => f.diff), changes }, null, 2)); return; }
      if (o.diff || o.dryRun) for (const f of [...changed, ...cssChanged]) process.stdout.write(colorDiff(f.diff));
      printProps(r);
      for (const x of per) console.log(formatText(x.issues, { lang: o.lang, file: x.file }) + "\n");
      const n = per.flatMap((x) => x.issues);
      console.log(`${o.dryRun ? "Would change" : "✔ Changed"} ${changed.length + cssChanged.length} file(s): ${n.filter((i) => i.fixable).length} auto-fix(es), ${n.filter((i) => !i.fixable).length} manual (report-only) · ${o.dryRun ? "معاينة فقط" : "تم الإصلاح"}`);
      if (!o.dryRun) {
        console.log(`→ ${r.outRoot}`);
        if (r.helper?.mode === "vendor") console.log(`  helper ${r.helper.refreshed ? "updated" : "vendored"} at ${r.helper.path}`);
        if (r.helper?.missing?.length) console.log(`  warning: your edited ${path.basename(r.helper.path || "harakah-arabic.tsx")} lacks ${r.helper.missing.join(", ")}; copy them from packages/remotion-arabic`);
        if (r.helper?.mode === "package") console.log(`  helper imported from @harakah/remotion-arabic`);
      }
      return;
    }
    if (!o.out) { console.error("HTML: -o <file> is required."); process.exit(2); }
    const src = read(file);
    const opts = { ...toOptions(o), baseDir: path.dirname(path.resolve(file)) };
    const before = analyze(src, opts);
    const r = fix(src, opts);
    writeFixed(r, o.out);
    const rep = toReport(before, file, r);
    if (o.report) fs.writeFileSync(o.report, JSON.stringify(rep, null, 2));
    if (o.json) { console.log(JSON.stringify(rep, null, 2)); return; }
    console.log(formatText(before.issues, { lang: o.lang, file, title: "Found · المشاكل" }));
    console.log(`\n✔ Applied ${r.applied.length} fix(es) · تم تطبيق ${r.applied.length} إصلاح: ${[...new Set(r.applied.map((i) => i.code))].join(", ") || "-"}${r.shimInjected ? " (+ runtime shim)" : ""}`);
    console.log(`→ ${path.resolve(o.out)}${r.assets.length ? `  (+ fonts/: ${[...new Set(r.assets.map((a) => a.rel))].join(", ")})` : ""}`);
    if (r.remaining.length) console.log("\n" + formatText(r.remaining, { lang: o.lang, title: "Remaining (manual) · متبقٍ (يدوي)" }));
  });

fixOpts(program.command("compare <target>").description("render before/after PNG (+ side-by-side MP4): HTML via headless Chrome, Remotion via @remotion/renderer · مقارنة"))
  .option("-o, --out <dir>", "output directory", "harakah-compare")
  .option("--video", "also render a side-by-side MP4", false)
  .option("--fps <n>", "video fps", (v) => parseInt(v, 10), 30)
  .option("--duration <s>", "override duration (seconds)", parseFloat)
  .option("--time <s>", "time of the still frame (default: end)", parseFloat)
  .option("--tail <s>", "hold the last frame for N extra seconds in the MP4", parseFloat)
  .option("--panel-width <px>", "max width of each panel in the side-by-side output", (v) => parseInt(v, 10), 1280)
  .option("--width <px>", "stage width if not a HyperFrames composition", (v) => parseInt(v, 10))
  .option("--height <px>", "stage height", (v) => parseInt(v, 10))
  .option("--composition <ids>", "Remotion: comma-separated composition ids (default: compositions using the file, or all)")
  .option("--frame <n>", "Remotion: frame for stills (default 75% of the composition)", (v) => parseInt(v, 10))
  .option("--component <name>", "Remotion lone file: exported component to register")
  .addOption(new Option("--engine <e>", "HTML MP4 engine: auto (HyperFrames for HyperFrames compositions, else Chrome), hyperframes, chrome").choices(["auto", "hyperframes", "chrome"]).default("auto"))
  .option("--frames <n>", "Remotion lone file: durationInFrames (default 150)", (v) => parseInt(v, 10))
  .option("--no-layout", "skip the runtime layout audit (Arabic visual order at sampled frames)")
  .option("--offline", "refuse every request the scene makes to the internet (CDN scripts, web fonts) and say which were refused; also HARAKAH_OFFLINE=1")
  .action(async (file: string, o: any) => {
    if (!fs.existsSync(file)) { console.error(`Not found: ${file}`); process.exit(2); }
    offline(o);
    if (isRemotion(file)) {
      const r = await compareRemotion(file, { ...remotionOptions(o), outDir: o.out, video: o.video, frame: o.frame, panelWidth: o.panelWidth, layout: o.layout,
        compositions: o.composition ? String(o.composition).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined, component: o.component, width: o.width, height: o.height, fps: o.fps, durationInFrames: o.frames,
        log: (m) => console.error(`· ${m}`) });
      const n = r.fix.files.flatMap((f) => f.result.changes).length;
      console.log(`codemod: ${n} change(s) in ${r.fix.files.filter((f) => f.after !== f.before).length} file(s)`);
      for (const x of r.renders) {
        console.log(`\n${x.id} @ frame ${x.frame}/${x.durationInFrames}\n  before: ${x.beforePng}\n  after:  ${x.afterPng}\n  side-by-side: ${x.comparePng}${x.mp4 ? `\n  video: ${x.mp4}` : ""}`);
        console.log(`  ink pieces/width: before ${x.before.components}/${x.before.width}px, after ${x.after.components}/${x.after.width}px, running-text reference ${x.reference.components}/${x.reference.width}px; pixel diff vs reference: after ${(x.diffAfter * 100).toFixed(1)}%, before ${(x.diffBefore * 100).toFixed(1)}%`);
        console.log(`  → at frame ${x.frame}: ${x.joinedAfter ? "JOINED ✓ (after matches running text)" : "after differs from running text ✗"}${x.usesSplit ? "" : " (no per-letter split in this project)"}${x.joinedBefore ? " · before already matched" : ""} (one frame; the layout audit below samples the rest)`);
        if (x.layout) {
          console.log(`  layout audit (${x.layout.frames} frames): before ${x.layout.before.length} finding(s), after ${x.layout.after.length}${x.layout.after.length ? "" : " → reading order RTL ✓"}`);
          for (const f of x.layout.after) console.log(`    after ${f.code} ${f.key}: ${f.detail}`);
        }
      }
      return;
    }
    const src = read(file);
    const stage = o.width && o.height ? { width: o.width, height: o.height, duration: o.duration } : undefined;
    const r = await compareHtml(src, o.out, { ...toOptions(o), baseDir: path.dirname(path.resolve(file)) }, { video: o.video, fps: o.fps, duration: o.duration, time: o.time, stage, tail: o.tail, maxPanelWidth: o.panelWidth }, path.dirname(path.resolve(file)), o.engine);
    console.log(`before: ${r.beforePng}\nafter:  ${r.afterPng}\nside-by-side: ${r.comparePng}${r.mp4 ? `\nvideo: ${r.mp4}` : ""}`);
    if (r.mp4) console.log(`video engine: ${r.engine}${r.engineNote ? ` (${r.engineNote})` : ""}`);
    console.log(`stage ${r.stage.width}×${r.stage.height}, ${r.duration}s; fixes: ${[...new Set(r.fixed.applied.map((i) => i.code))].join(", ") || "-"}`);
    if (r.joins.length) console.log(`join audit at t=${o.time ?? r.duration}s (one frame; the layout audit samples the rest):`);
    for (const j of r.joins) console.log(`join audit "${j.text.slice(0, 30)}": ink pieces/width before ${j.before}/${j.widthBefore}px, after ${j.after ?? "?"}/${j.widthAfter ?? "?"}px, plain-text reference ${j.reference}/${j.widthReference}px → ${j.joinedAfter ? "JOINED ✓" : "still broken ✗"}${j.joinedBefore ? " (was already joined)" : ""}`);
    if (r.layout) {
      console.log(`layout audit (${r.layout.frames} frames): before ${r.layout.before.length} finding(s), after ${r.layout.after.length}${r.layout.after.length ? "" : " → reading order RTL ✓"}`);
      for (const f of r.layout.after) console.log(`  after ${f.code} ${f.key}: ${f.detail}`);
    }
    console.log(networkText(r.network));
    if (r.network.blocked.length) process.exitCode = 2;
  });

program.command("audit <target>").description("render in headless Chrome and audit Arabic visual order at sampled frames (letters, words, rows, overlaps): HTML file, Remotion project folder or .tsx/.jsx · تدقيق ترتيب العرض")
  .option("--fps <n>", "sampled frames per second (HTML default 10, Remotion 4)", (v) => parseFloat(v))
  .option("--duration <s>", "HTML: override duration (seconds)", parseFloat)
  .option("--width <px>", "HTML: stage width", (v) => parseInt(v, 10))
  .option("--height <px>", "HTML: stage height", (v) => parseInt(v, 10))
  .option("--composition <ids>", "Remotion: comma-separated composition ids (default: all, or those using the file)")
  .option("--props <json|file>", "Remotion: render-time input props")
  .option("--max-frames <n>", "max sampled frames per composition", (v) => parseInt(v, 10))
  .option("--all-frames", "check every frame instead of a sample (short clips: up to 1800 frames). Remotion: the composition's frames; HTML: at --fps (default 30)")
  .option("--fix", "HTML: add the verified layout fixes (direction: rtl on the boxes, checked in Chrome) as a <style> block; with -o <file> or --write")
  .option("-o, --out <file>", "HTML --fix: output file")
  .option("--write", "HTML --fix: edit the file in place", false)
  .option("--json", "print JSON")
  .option("--offline", "refuse every request the scene makes to the internet (CDN scripts, web fonts) and say which were refused; also HARAKAH_OFFLINE=1")
  .action(async (file: string, o: any) => {
    if (!fs.existsSync(file)) { console.error(`Not found: ${file}`); process.exit(2); }
    offline(o);
    if (o.fix && isRemotion(file)) { console.error("audit --fix writes HTML only. For Remotion the findings carry the suggestion (direction: rtl on the element, or the mirrored slot); apply it in the component."); process.exit(2); }
    if (o.fix && !o.out && !o.write) { console.error("audit --fix: pass -o <file> or --write."); process.exit(2); }
    const show = (label: string, issues: Issue[]) => {
      for (const i of issues) console.log(`${i.severity.toUpperCase().padEnd(5)} ${i.code} ${i.where}\n      ${i.message.en}\n      ${i.message.ar}`);
      console.log(issues.length ? `${label}: ${issues.length} layout finding(s)` : `${label}: Arabic reading order is right-to-left in every sampled frame ✓ · الترتيب صحيح في كل الإطارات المفحوصة`);
    };
    if (isRemotion(file)) {
      const { auditRemotion } = await import("./remotion/layout.js");
      const r = await auditRemotion(file, { fps: o.fps, maxFrames: o.maxFrames, allFrames: !!o.allFrames, inputProps: loadInputProps(o.props), compositions: o.composition ? String(o.composition).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined, log: (m) => console.error(`· ${m}`) });
      const { coverage, coverageText } = await import("./layout-audit.js");
      const cov = (c: { frames: number; durationInFrames: number; fps: number }) => coverage(c.frames, (c.durationInFrames - 1) / c.fps, c.fps);
      if (o.json) console.log(JSON.stringify({ target: file, root: r.root, compositions: r.compositions.map((c) => ({ id: c.id, width: c.width, height: c.height, fps: c.fps, durationInFrames: c.durationInFrames, frames: c.frames, coverage: cov(c), findings: c.findings })) }, null, 2));
      else for (const c of r.compositions) { console.log(`\n${c.id}: ${c.width}×${c.height}, ${coverageText(cov(c))}`); show(c.id, c.issues); }
      process.exitCode = r.compositions.some((c) => c.issues.some((i) => i.severity === "error")) ? 1 : 0;
      return;
    }
    const { auditLayoutFile, coverage, coverageText } = await import("./layout-audit.js");
    const { detectStage } = await import("./render.js");
    const base = detectStage(read(file));
    const stage = { width: o.width ?? base.width, height: o.height ?? base.height, duration: o.duration ?? base.duration };
    const fps = o.fps ?? (o.allFrames ? 30 : 10);
    const r = await auditLayoutFile(file, { stage, duration: o.duration, fps, maxFrames: o.maxFrames, allFrames: !!o.allFrames });
    // with --all-frames the frame rate is known, so coverage counts frames ("every frame checked (N)")
    const cov = coverage(r.frames, r.duration, o.allFrames ? fps : undefined);
    if (o.fix) {
      const { layoutCss, applyLayoutCss } = await import("./layout-audit.js");
      const css = layoutCss(r.findings);
      const dest = o.write ? file : o.out;
      fs.writeFileSync(dest, applyLayoutCss(read(file), css));
      const n = r.findings.filter((f) => f.suggest?.kind === "dir" && f.suggest.verified).length;
      console.error(css ? `✔ ${n} verified layout fix(es) → ${dest}` : `No verified layout fix to apply (${r.findings.length} finding(s) need changes in the animation code) → ${dest}`);
    }
    if (o.json) console.log(JSON.stringify({ file, stage: r.stage, duration: r.duration, frames: r.frames, coverage: cov, network: r.network, findings: r.findings, issues: r.issues.map((i) => ({ code: i.code, severity: i.severity, where: i.where, message: i.message, suggest: i.suggest })) }, null, 2));
    else {
      console.log(`${file}: ${r.stage.width}×${r.stage.height}, ${r.duration}s, ${coverageText(cov)}`);
      show(file, r.issues);
      console.log(networkText(r.network));
    }
    // offline and the scene needed the internet: the audited page isn't the real scene, so the result is inconclusive
    process.exitCode = r.issues.some((i) => i.severity === "error") ? 1 : r.network.blocked.length ? 2 : 0;
  });

function colorDiff(d: string): string {
  if (!process.stdout.isTTY) return d;
  return d.split("\n").map((l) => (l.startsWith("+") && !l.startsWith("+++") ? `\x1b[32m${l}\x1b[0m` : l.startsWith("-") && !l.startsWith("---") ? `\x1b[31m${l}\x1b[0m` : l.startsWith("@@") ? `\x1b[36m${l}\x1b[0m` : l)).join("\n");
}

function printProps(r: { props: { file: string; component: string; reasons: string[] }[]; styles?: FixRemotionResult["styles"]; i18n?: string[] }) {
  if (r.i18n?.length) console.log(`Arabic via translations · نص عربي عبر ملفات الترجمة: ${r.i18n.join(", ")}\n`);
  if (r.props.length) {
    console.log("Arabic via props · نص عربي عبر الخصائص:");
    for (const p of r.props) console.log(`  ${p.component} (${path.basename(p.file)}): ${p.reasons.join("; ")}`);
    console.log("");
  }
  if (r.styles?.length) {
    console.log("Styles from other files used by Arabic components · أنماط من ملفات أخرى:");
    for (const st of r.styles) console.log(`  ${st.name} (${path.relative(process.cwd(), st.file)}): ${st.exclusive ? "Arabic-only → fixed where declared" : `shared with ${st.latinUsers.join(", ")} → kept; Arabic overrides at the usage sites${st.hasFontFamily ? " + Arabic font fallback" : ""}`}`);
    console.log("");
  }
}

program.command("gate <target>").description("exit 1 if Arabic would render broken, 2 if it couldn't be checked (use as a prerender / pre-commit / agent hook) · بوابة ما قبل الرندر")
  .option("--strict", "also block on warnings")
  .option("--json", "machine-readable result")
  .addOption(new Option("--digits <mode>").choices(["eastern", "western", "keep"]).default("eastern"))
  .option("--assume-arabic", "treat every component as Arabic (Arabic via props)")
  .option("--props <json|file>", "Remotion: render-time input props (as in `remotion render --props`)")
  .option("--composition <ids>", "Remotion: composition id(s) being rendered (the --props apply to these; unknown ids are ignored)")
  .option("--layout", "also audit Arabic visual order at sampled frames: HTML files in headless Chrome, Remotion compositions through the bundle (slower)")
  .option("--offline", "--layout: refuse the internet while rendering; a scene that needs it is inconclusive (exit 2); also HARAKAH_OFFLINE=1")
  .option("--github", "GitHub Actions: annotate each problem on its line in the pull request, and write a job summary (GITHUB_STEP_SUMMARY)")
  .action(async (target: string, o: any) => {
    offline(o);
    const { gate, githubAnnotations, githubSummary } = await import("./gate.js");
    try {
      const g = await gate(target, { strict: !!o.strict, digits: o.digits, assumeArabic: !!o.assumeArabic, inputProps: loadInputProps(o.props), propsArg: o.props, layout: !!o.layout,
        composition: o.composition ? String(o.composition).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined });
      // --layout: the runtime layout findings per composition / HTML file (frames, suggestion), e.g. for the Studio panel
      const layout = o.layout ? g.files.filter((f) => f.issues.some((i) => i.code === "HZ24")).map((f) => ({ file: f.file, kind: f.kind, issues: f.issues.filter((i) => i.code === "HZ24" || (i.code === "HZ22" && i.frames)).map((i) => ({ code: i.code, severity: i.severity, snippet: i.snippet, where: i.where, frames: i.frames, suggest: i.suggest, message: i.message })) })) : undefined;
      if (o.json) console.log(JSON.stringify({ ok: g.ok, target: g.target, blocking: g.blocking, inconclusive: g.inconclusive, summary: g.summary, fixCommand: g.fixCommand, ...(layout ? { layout } : {}) }, null, 2));
      else (g.ok ? console.log : console.error)(g.message);
      if (o.github) {
        // workflow commands go to stdout, which --json already uses: with --json only the summary is written
        if (!o.json) for (const a of githubAnnotations(g, { strict: !!o.strict })) console.log(a);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(g) + "\n");
      }
      // 1: Arabic would render broken · 2: it couldn't be checked (or the gate itself failed)
      process.exitCode = g.ok ? 0 : g.blocking.length ? 1 : 2;
    } catch (e) { console.error(`harakah-fix gate: ${(e as Error).message}`); process.exitCode = 2; }
  });

program.command("doctor").description("check this machine: Node, Chrome (and that it joins Arabic), ffmpeg, fonts, Remotion · فحص جاهزية الجهاز")
  .option("--json", "print JSON")
  .action(async (o: any) => {
    const { doctor, formatDoctor } = await import("./doctor.js");
    const checks = await doctor();
    console.log(o.json ? JSON.stringify({ tool: "harakah-fix", version: VERSION, ok: checks.every((c) => c.ok || !c.required), checks }, null, 2) : formatDoctor(checks));
    process.exitCode = checks.some((c) => !c.ok && c.required) ? 1 : 0;
  });

program.command("serve").description("start the local web tool (paste a scene or open a whole Remotion project) · واجهة الويب المحلية")
  .option("-p, --port <n>", "port", "4747")
  .option("--host <host>", "host (default 127.0.0.1: only this machine)", "127.0.0.1")
  .action(async (o: any) => {
    process.env.PORT = String(o.port);
    process.env.HOST = String(o.host);
    await import("./server.js");
  });

// a command that couldn't run (Chrome missing, offline Remotion, a bad project) exits 2, never 1 (= broken Arabic)
program.parseAsync(process.argv).catch((e) => {
  console.error(process.env.HARAKAH_DEBUG ? e : `harakah-fix: ${String(e?.message ?? e)}`);
  process.exit(2);
});
