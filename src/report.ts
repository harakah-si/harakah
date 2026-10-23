import fs from "node:fs";
import type { Issue, Analysis, FixResult } from "./engine.js";

export interface Report {
  tool: "harakah-fix";
  version: string;
  file?: string;
  summary: { errors: number; warnings: number; info: number; autoFixable: number };
  stats?: Analysis["stats"];
  issues: Issue[];
  fixed?: { applied: Issue[]; remaining: Issue[]; shimInjected: boolean };
}
// single source of truth: package.json (dist/report.js → ../package.json)
export const VERSION: string = (() => { const g = (globalThis as any).__HARAKAH_VERSION__; if (typeof g === "string") return g; try { return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch { return "0.0.0"; } })();

export function summarize(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
    autoFixable: issues.filter((i) => i.fixable).length,
  };
}

export function toReport(a: Analysis, file?: string, f?: FixResult): Report {
  return {
    tool: "harakah-fix", version: VERSION, file, summary: summarize(a.issues), stats: a.stats, issues: a.issues,
    fixed: f ? { applied: f.applied, remaining: f.remaining, shimInjected: f.shimInjected } : undefined,
  };
}

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const sevTag = (s: string, lang: "en" | "ar") => {
  const m: Record<string, [string, string, string]> = { error: ["31;1", "ERROR", "خطأ"], warning: ["33;1", "WARN ", "تنبيه"], info: ["36", "INFO ", "ملاحظة"] };
  const [col, en, ar] = m[s];
  return c(col, lang === "en" ? en : ar);
};

export function formatText(issues: Issue[], opts: { lang?: "en" | "ar" | "both"; file?: string; title?: string } = {}): string {
  const lang = opts.lang ?? "both";
  const out: string[] = [];
  const s = summarize(issues);
  if (opts.title) out.push(c("1", opts.title));
  if (lang !== "ar") out.push(`${opts.file ? opts.file + ": " : ""}${s.errors} error(s), ${s.warnings} warning(s), ${s.info} info — ${s.autoFixable} auto-fixable`);
  if (lang !== "en") out.push(`${s.errors} خطأ، ${s.warnings} تنبيه، ${s.info} ملاحظة — ${s.autoFixable} قابلة للإصلاح التلقائي`);
  out.push("");
  for (const i of issues) {
    const loc = [i.line ? `L${i.line}` : "", i.where || ""].filter(Boolean).join(" ");
    const fix = i.fixable ? c("32", " [auto-fix]") : i.fixMode === "option" ? c("35", " [fix via option]") : c("90", " [detect-only]");
    if (lang !== "ar") {
      out.push(`${sevTag(i.severity, "en")} ${c("1", i.code)} ${i.title.en}${fix}${loc ? c("90", "  " + loc) : ""}`);
      out.push(`      ${i.message.en}`);
    }
    if (lang !== "en") {
      out.push(`${lang === "both" ? "      " : sevTag(i.severity, "ar") + " " + c("1", i.code) + " "}${c("1", i.title.ar)}`);
      out.push(`      ${i.message.ar}`);
    }
    out.push("");
  }
  if (!issues.length) out.push(lang === "ar" ? "لا توجد مشاكل في النص العربي ✓" : lang === "en" ? "No Arabic issues found ✓" : "No Arabic issues found ✓ · لا توجد مشاكل ✓");
  return out.join("\n");
}
