// The harakah.si palettes (mosaic, mosaicblue, inkpetra) + text-safe --faint.
export const P = {
  mosaic: {
    name: { ar: "فسيفساء", en: "Mosaic" },
    dark: { bg: "#0a1411", bg2: "#0d1915", card: "#10201b", line: "#1f342c", ink: "#f2ecde", mute: "#9daa9f", acc: "#e3b24c", onAcc: "#0a1411", acc2: "#3fb6a7", acc3: "#1f5e57", ok: "#5acb9b", err: "#ff7563" },
    light: { bg: "#f3efe6", bg2: "#ece6da", card: "#e8e1d3", line: "#d8d0bf", ink: "#0e1d18", mute: "#53615a", acc: "#8a6312", onAcc: "#ffffff", acc2: "#1d7a6c", acc3: "#c9962e", ok: "#0f6b3f", err: "#a6311f" },
  },
  blue: {
    name: { ar: "قيشاني", en: "Blue" },
    dark: { bg: "#070d1a", bg2: "#0a1222", card: "#0d1629", line: "#1b2944", ink: "#eef3f8", mute: "#97a6bd", acc: "#5fd6cf", onAcc: "#04121a", acc2: "#3b6ef0", acc3: "#e9e1cc", ok: "#5fd39d", err: "#ff7a7a" },
    light: { bg: "#eef2f6", bg2: "#e5ebf2", card: "#dfe6ee", line: "#ccd6e2", ink: "#0a1630", mute: "#4a5b75", acc: "#0b6670", onAcc: "#ffffff", acc2: "#1f45b5", acc3: "#a77a22", ok: "#0f6b3f", err: "#b42a36" },
  },
  inkpetra: {
    name: { ar: "حبر وبتراء", en: "Ink + Petra" },
    dark: { bg: "#0b0b0d", bg2: "#0f0f12", card: "#121214", line: "#24211f", ink: "#f3efe7", mute: "#958c82", acc: "#ff5a36", onAcc: "#0b0b0d", acc2: "#d9a066", acc3: "#8e6a7a", ok: "#3ccf8e", err: "#ff6157" },
    light: { bg: "#f3efe7", bg2: "#ece6dc", card: "#ebe4d8", line: "#dcd3c5", ink: "#141310", mute: "#5f5850", acc: "#b83616", onAcc: "#ffffff", acc2: "#b0703f", acc3: "#7d5a6b", ok: "#0f6b3f", err: "#a6311f" },
  },
};
const lum = (hex) => { const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hx = (a) => "#" + a.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const rgb = (h) => h.slice(1).match(/../g).map((x) => parseInt(x, 16));
// faint: mute pulled toward bg as far as possible while staying ≥4.6:1 on bg, bg2 and card (it colours code comments)
export function faint(t) {
  const m = rgb(t.mute), b = rgb(t.bg);
  let best = t.mute;
  for (let k = 0; k <= 0.6; k += 0.02) { const c = hx(m.map((v, i) => v + (b[i] - v) * k)); if (["bg", "bg2", "card"].every((s) => ratio(c, t[s]) >= 4.6)) best = c; else break; }
  return best;
}
export function css(id) {
  const out = [];
  for (const th of ["dark", "light"]) {
    const t = { ...P[id][th] }; t.faint = faint(t);
    const v = Object.entries(t).map(([k, x]) => `--${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${x}`).join(";");
    out.push(`:root[data-palette=${id}][data-theme=${th}]{${v};--acc-t:${t.acc}}`);
  }
  return out.join("\n");
}
if (process.argv[1] && process.argv[1].endsWith("palettes.mjs")) {
  for (const id of Object.keys(P)) for (const th of ["dark", "light"]) {
    const t = { ...P[id][th] }; t.faint = faint(t);
    const r = (a, b) => ratio(t[a], t[b]).toFixed(2);
    console.log(id, th, "faint", t.faint, "ink/bg", r("ink", "bg"), "mute/bg2", r("mute", "bg2"), "mute/card", r("mute", "card"), "acc/bg", r("acc", "bg"), "acc/card", r("acc", "card"), "acc/bg2", r("acc", "bg2"), "onAcc/acc", r("onAcc", "acc"), "ok/card", r("ok", "card"), "err/card", r("err", "card"), "faint/card", r("faint", "card"));
  }
  for (const id of Object.keys(P)) console.log(css(id));
}
