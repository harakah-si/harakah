/**
 * Timed windows found in a composition's props (captions, word timings, scene lists), in seconds.
 * The layout audit samples evenly, so text shorter than the gap between samples (a 3 s caption in a
 * 5 min composition sampled every 5 s) can be missed. Seeking the middle of each window closes that gap.
 * مقاطع زمنية من خصائص المقطع (كلمات الترجمة ومشاهدها) ليُفحص منتصف كلٍّ منها.
 */
type Unit = "ms" | "s" | "frames";
const PAIRS: [string, string, Unit][] = [
  ["startMs", "endMs", "ms"], ["start_ms", "end_ms", "ms"], ["fromMs", "toMs", "ms"],
  ["start", "end", "s"], ["startTime", "endTime", "s"], ["start_time", "end_time", "s"],
  ["in_seconds", "out_seconds", "s"], ["inSeconds", "outSeconds", "s"],
  ["start_seconds", "end_seconds", "s"], ["startSeconds", "endSeconds", "s"],
  ["startFrame", "endFrame", "frames"], ["start_frame", "end_frame", "frames"],
];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function propTimeWindows(props: unknown, fps: number, max = 5000): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (out.length >= max || depth > 12 || !v || typeof v !== "object" || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    for (const [a, b, unit] of PAIRS) {
      if (!num(o[a]) || !num(o[b]) || (o[b] as number) <= (o[a] as number)) continue;
      const k = unit === "ms" ? 1 / 1000 : unit === "frames" ? 1 / fps : 1;
      out.push([(o[a] as number) * k, (o[b] as number) * k]);
      break;
    }
    if (num(o.from) && num(o.durationInFrames) && o.durationInFrames > 0) out.push([o.from / fps, (o.from + o.durationInFrames) / fps]);
    for (const x of Object.values(o)) visit(x, depth + 1);
  };
  visit(props, 0);
  return out;
}

/** One seek time per window (its middle), inside [0, duration], at most `max` of them, evenly picked when there are more. */
export function windowSampleTimes(windows: [number, number][], duration: number, fps: number, max: number): number[] {
  const frames = new Set<number>();
  for (const [a, b] of windows) {
    const mid = (Math.max(0, a) + Math.min(duration, b)) / 2;
    if (mid >= 0 && mid <= duration && b > 0 && a < duration) frames.add(Math.round(mid * fps));
  }
  let list = [...frames].sort((x, y) => x - y);
  if (list.length > max) list = Array.from({ length: max }, (_, i) => list[Math.round(i * (list.length - 1) / Math.max(1, max - 1))]);
  return [...new Set(list)].map((f) => +(f / fps).toFixed(3));
}
