const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const SHOT = root.classList.contains("shot");
const still = () => reduce.matches || SHOT; // finished states, no loops
const mobile = () => matchMedia("(max-width:640px)").matches;
// Arabic inside code samples: each Arabic run (words and the spaces between them, never across a line or a tag) becomes
// its own RTL island, so the code around it keeps its left-to-right order. (Matching quoted strings instead ran from one
// quote to the next across lines and flipped whole lines of the HyperFrames sample.)
const AR_RUN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[ \u00A0]+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;
const isoAr = (html) => html.replace(AR_RUN, '<bdi dir="rtl">$&</bdi>');

/* ---------- digits: Eastern ١٢٣ with Arabic separators (٬ ٫) by default in Arabic ---------- */
const nf = (opts = {}) => {
  const loc = root.dataset.lang === "ar" ? (root.dataset.digits === "western" ? "ar-u-nu-latn" : "ar-EG") : "en-US";
  return new Intl.NumberFormat(loc, opts);
};
const fmt = (n, pad) => nf(pad ? { minimumIntegerDigits: pad, useGrouping: false } : {}).format(n);
function paintNumbers() { $$("[data-n]").forEach((el) => (el.textContent = fmt(+el.dataset.n, +el.dataset.pad || 0))); }

/* ---------- kinetic hero word (from the live page) ---------- */
const word = "متصلة";
const kin = $("#kin");
$(".broken", kin).innerHTML = [...word].map((c, i, a) => `<span style="--i:${a.length - 1 - i}">${c}</span>`).join("");
const replay = () => { kin.classList.remove("play"); void kin.offsetWidth; kin.classList.add("play"); };
kin.addEventListener("mouseenter", () => { if (!still()) replay(); });
if (!still()) { replay(); setInterval(() => { if (!still() && !document.hidden) replay(); }, 7000); }

/* ---------- segmented controls ---------- */
const segSync = (sel, v) => $$(`${sel} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
function seg(sel, value, set) {
  $$(`${sel} button`).forEach((b) => b.addEventListener("click", () => { set(b.dataset.v); segSync(sel, b.dataset.v); }));
  segSync(sel, value);
}
const mq = matchMedia("(prefers-color-scheme: dark)");
const listeners = { theme: [], lang: [], palette: [] };
const emit = (k) => listeners[k].forEach((f) => f());
const applyTheme = (p) => { root.dataset.theme = p === "system" ? (mq.matches ? "dark" : "light") : p; root.dataset.themePref = p; emit("theme"); };
seg("#theme", root.dataset.themePref || "system", (v) => { v === "system" ? localStorage.removeItem("hz-theme") : localStorage.setItem("hz-theme", v); applyTheme(v); });
mq.addEventListener("change", () => { if (!localStorage.getItem("hz-theme")) applyTheme("system"); });
// links to the run-it-locally page (/tool/) open it in the language the visitor is reading
function toolLang() { $$('a[href^="/tool/"]').forEach((a) => a.setAttribute("href", `/tool/?lang=${root.dataset.lang}`)); }
toolLang();
seg("#lang", root.dataset.lang, (v) => {
  localStorage.setItem("hz-lang", v); root.dataset.lang = v; root.lang = v; root.dir = v === "en" ? "ltr" : "rtl";
  document.title = v === "en" ? "Harakah · Arabic motion with joined letters" : "حركة · الموشن العربي بحروف متصلة";
  paintNumbers(); toolLang(); emit("lang");
});
seg("#digits", root.dataset.digits, (v) => { localStorage.setItem("hz-digits", v); root.dataset.digits = v; paintNumbers(); emit("lang"); });
const setPalette = (v) => { localStorage.setItem("hz-palette", v); root.dataset.palette = v; segSync("[data-pal]", v); emit("palette"); };
$$("[data-pal] button").forEach((b) => b.addEventListener("click", () => setPalette(b.dataset.v)));
segSync("[data-pal]", root.dataset.palette);
paintNumbers();

/* ---------- demo reel (from the live page) ---------- */
const vids = { html: ["/demo/harakah-demo.mp4", "/demo/harakah-demo.png"], remotion: ["/demo/remotion-demo.mp4", "/demo/remotion-demo.png"] };
const vid = $("#vid"), pp = $("#pp");
let userPaused = still();
const syncPP = () => pp.setAttribute("aria-pressed", String(vid.paused));
const playIfAllowed = () => { if (!userPaused && vidVisible) vid.play().catch(() => {}); syncPP(); };
pp.onclick = () => { userPaused = !vid.paused; userPaused ? vid.pause() : vid.play().catch(() => {}); syncPP(); };
vid.addEventListener("play", syncPP); vid.addEventListener("pause", syncPP);
let vidVisible = false;
new IntersectionObserver(([e]) => { vidVisible = e.isIntersecting; vidVisible ? playIfAllowed() : vid.pause(); }).observe(vid);
seg("#reel", "html", (v) => { vid.poster = vids[v][1]; vid.src = vids[v][0]; playIfAllowed(); });
let panTouched = false;
const pan = (v) => vid.style.setProperty("--pan", v === "before" ? "100%" : "0%");
seg("#pan", "after", (v) => { panTouched = true; pan(v); });
if (!still()) setInterval(() => {
  if (panTouched || !mobile() || document.hidden || !vidVisible) return;
  const next = vid.style.getPropertyValue("--pan") === "100%" ? "after" : "before";
  pan(next); segSync("#pan", next);
}, 3500);

/* ---------- reveal on scroll ---------- */
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
$$("[data-reveal]").forEach((el) => (SHOT ? el.classList.add("in") : io.observe(el)));

/* ---------- one rAF-throttled scroll bus ---------- */
const onScrollFns = [];
let ticking = false;
const runScroll = () => { ticking = false; for (const f of onScrollFns) f(); };
addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(runScroll); } }, { passive: true });
addEventListener("resize", () => requestAnimationFrame(runScroll));

/* ---------- hero A: tesserae panel (mosaic = gold, blue = qishani) ---------- */
(() => {
  const art = $(".art"), cv = $("canvas", art), ctx = cv.getContext("2d");
  const SETS = {
    mosaic: {
      dark: { field: ["#0f2a22", "#12332a", "#0c231d", "#163a31", "#1b4a3f", "#0f3434", "#1f5e57", "#123f4a", "#0e2c2a", "#17463d"], word: ["#e3b24c", "#c9962e", "#f0c766", "#b88a2a", "#d9a640", "#f5d27a"], glint: "255,236,190", bg: "#08110e" },
      light: { field: ["#1d4a3e", "#245647", "#1a4236", "#2a5f50", "#2f6e5d", "#1f5653", "#2e7a70", "#22505c", "#285a4b", "#356f62"], word: ["#e3b24c", "#c9962e", "#f0c766", "#b88a2a", "#d9a640", "#f5d27a"], glint: "255,240,200", bg: "#163a31" },
    },
    blue: {
      dark: { field: ["#0a1630", "#0d1d3d", "#0b1a36", "#112552", "#16306a", "#0e2348", "#1a3a7a", "#132b5c", "#0c1f44", "#1d4590"], word: ["#43d3cb", "#5fe0d6", "#2fb8b4", "#8fe8e0", "#e9f4f2", "#3ac0c9"], glint: "225,250,255", bg: "#060f22" },
      light: { field: ["#1a3a7a", "#1f4590", "#173470", "#24509f", "#2a5bb0", "#1c3f84", "#2f66c0", "#20488f", "#183a78", "#2a58a8"], word: ["#43d3cb", "#5fe0d6", "#2fb8b4", "#8fe8e0", "#f2f8f6", "#3ac0c9"], glint: "235,252,255", bg: "#132b5c" },
    },
  };
  let tiles = [], W = 0, H = 0, dpr = 1, start = 0, raf = 0, onScreen = false, base = null, settleAt = 0, C = null, key = "";
  let light = { x: 0.7, y: 0.2 }, pointer = null;
  const active = () => root.dataset.palette === "mosaic" || root.dataset.palette === "blue";
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  async function build() {
    if (!active()) return false;
    await document.fonts.load('800 100px "Alexandria"');
    W = art.clientWidth; H = art.clientHeight; if (!W || !H) return false;
    dpr = Math.min(mobile() ? 1.5 : 2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const s = mobile() ? Math.max(10, Math.round(W / 30)) : Math.max(8, Math.round(W / 50)); // phones: fewer, bigger tiles
    const o = document.createElement("canvas"); o.width = W; o.height = H;
    const x = o.getContext("2d"); x.fillStyle = "#fff"; x.direction = "rtl"; x.textAlign = "center"; x.textBaseline = "middle";
    let fs = H * 0.46; x.font = `800 ${fs}px Alexandria`;
    const mw = x.measureText(word).width; if (mw > W * 0.84) fs *= (W * 0.84) / mw;
    x.font = `800 ${fs}px Alexandria`; x.fillText(word, W / 2, H * 0.47);
    const px = x.getImageData(0, 0, W, H).data;
    const a = (X, Y) => { X = Math.min(W - 1, Math.max(0, X | 0)); Y = Math.min(H - 1, Math.max(0, Y | 0)); return px[(Y * W + X) * 4 + 3] / 255; };
    C = SETS[root.dataset.palette][root.dataset.theme === "light" ? "light" : "dark"];
    let seed = 1337; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    tiles = [];
    const cols = Math.ceil(W / s) + 1, rows = Math.ceil(H / s) + 1;
    let maxDelay = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cx = c * s + s / 2 + (rnd() - 0.5) * 1.2, cy = r * s + s / 2 + (rnd() - 0.5) * 1.2, q = s * 0.3;
      const cov = (a(cx, cy) * 2 + a(cx - q, cy - q) + a(cx + q, cy - q) + a(cx - q, cy + q) + a(cx + q, cy + q)) / 6;
      const w = cov > 0.42, pal = w ? C.word : C.field;
      // field settles first (sweeping right→left), then the word tiles "write" right→left
      const delay = w ? 900 + ((W - cx) / W) * 900 + rnd() * 160 : ((W - cx) / W) * 650 + rnd() * 600;
      maxDelay = Math.max(maxDelay, delay);
      tiles.push({ x: cx, y: cy, sz: s - 1.8 - rnd() * 1.4, rot: (rnd() - 0.5) * (w ? 0.22 : 0.1), tilt: rnd(), w, col: pal[(rnd() * pal.length) | 0], delay });
    }
    settleAt = maxDelay + 760; base = null; key = root.dataset.palette + root.dataset.theme + W;
    start = performance.now();
    return true;
  }
  function paintTiles(g, t, settled) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    for (const tl of tiles) {
      const k = settled ? 1 : Math.min(1, Math.max(0, (t - start - tl.delay) / 720)); if (k <= 0) continue;
      const e = easeOut(k);
      g.save(); g.translate(tl.x, tl.y - (1 - e) * 10); g.rotate(tl.rot + (1 - e) * 0.9); g.globalAlpha = Math.min(1, k * 1.6);
      const z = tl.sz * (0.6 + 0.4 * e);
      g.fillStyle = tl.col; g.fillRect(-z / 2, -z / 2, z, z);
      if (!tl.w) { g.fillStyle = "rgba(255,255,255,0.025)"; g.fillRect(-z / 2, -z / 2, z, z * 0.45); }
      g.restore();
    }
  }
  function glint() { // only the word tiles, on top of the cached settled panel
    const L = pointer || light, lx = L.x * W, ly = L.y * H, reach = Math.max(W, H) * 0.75;
    for (const tl of tiles) {
      if (!tl.w) continue;
      const d = Math.hypot(tl.x - lx, tl.y - ly) / reach, g = Math.max(0, 1 - d) ** 2.2 * (0.35 + 0.65 * tl.tilt);
      if (g < 0.02) continue;
      ctx.save(); ctx.translate(tl.x, tl.y); ctx.rotate(tl.rot); ctx.fillStyle = `rgba(${C.glint},${(g * 0.75).toFixed(3)})`; ctx.fillRect(-tl.sz / 2, -tl.sz / 2, tl.sz, tl.sz); ctx.restore();
    }
  }
  function frame(t) {
    raf = 0;
    if (!active() || !onScreen || document.hidden) return; // paused: offscreen, hidden tab, or other palette
    if (t - start < settleAt) { paintTiles(ctx, t, false); raf = requestAnimationFrame(frame); return; }
    if (!base) { base = document.createElement("canvas"); base.width = cv.width; base.height = cv.height; paintTiles(base.getContext("2d"), t, true); }
    if (mobile() || still()) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); glint(); return; } // phones: settle, then stop
    light.x = 0.55 + 0.38 * Math.sin(t / 3400); light.y = 0.32 + 0.22 * Math.cos(t / 4300);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); glint();
    raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && active() && onScreen && !document.hidden) raf = requestAnimationFrame(frame); };
  async function init() {
    cancelAnimationFrame(raf); raf = 0;
    if (!(await build())) return;
    if (still()) { start = -1e9; light = { x: 0.78, y: 0.28 }; }
    kick();
  }
  art.addEventListener("pointermove", (e) => { const b = art.getBoundingClientRect(); pointer = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; if (still() || mobile()) kick(); });
  art.addEventListener("pointerleave", () => (pointer = null));
  const halt = () => { cancelAnimationFrame(raf); raf = 0; };
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? kick() : halt(); }).observe(art);
  document.addEventListener("visibilitychange", () => (document.hidden ? halt() : kick()));
  listeners.palette.push(init); listeners.theme.push(init);
  let rt, lastW = 0; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (art.clientWidth !== lastW) { lastW = art.clientWidth; init(); } }, 200); });
  lastW = art.clientWidth; init();
  window.__hzTiles = { running: () => !!raf, tiles: () => tiles.length };
})();

/* ---------- hero B: Petra strata (inkpetra) + Siq headline ---------- */
(() => {
  const el = $(".strata"), h1 = $("#h1");
  const BANDS = {
    light: ["#efe2d0", "#e8c9a2", "#dcaa76", "#cf8563", "#c8745a", "#9c7484", "#b0583a", "#8a4a35", "#6b3a2e", "#4a2820"],
    dark: ["#2a1b16", "#3d261d", "#5a3426", "#7e4632", "#a85d45", "#6e5262", "#924a33", "#6a3727", "#4a281e", "#2c1813"],
  };
  let bands = [], built = "", visible = false;
  const active = () => root.dataset.palette === "inkpetra";
  function build() {
    if (!active()) { el.innerHTML = ""; built = ""; return; }
    const theme = root.dataset.theme === "light" ? "light" : "dark"; if (built === theme) return;
    const cols = BANDS[theme], W = 2400, H = 300, n = cols.length;
    let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let html = "";
    cols.forEach((c, i) => {
      const base = 26 + i * ((H - 30) / n), a1 = 6 + r() * 12, f1 = (1 + r() * 2.2) * Math.PI * 2 / W * 3, p1 = r() * 6, a2 = 2 + r() * 5, f2 = f1 * (2.3 + r()), p2 = r() * 6, tilt = (r() - 0.5) * 30;
      const y = (x) => base + a1 * Math.sin(x * f1 + p1) + a2 * Math.sin(x * f2 + p2) + tilt * (x / W);
      let d = `M0 ${H + 40}`; for (let x = 0; x <= W; x += 24) d += `L${x} ${y(x).toFixed(1)}`; d += `L${W} ${H + 40}Z`;
      let lines = ""; for (let k = 1; k <= 3; k++) { let l = ""; for (let x = 0; x <= W; x += 48) l += `${x ? "L" : "M"}${x} ${(y(x) + k * 7 + 3 * Math.sin(x * f2 * 1.7 + k)).toFixed(1)}`; lines += `<path d="${l}" fill="none" stroke="${theme === "light" ? "#000" : "#fff"}" stroke-opacity="${0.035 + 0.02 * (k % 2)}" stroke-width="1"/>`; }
      // each band is its own HTML layer: drift + parallax are compositor transforms, no SVG repaint per frame
      html += `<div class="band" data-f="${(0.02 + i * 0.022).toFixed(3)}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="--t:${(70 + i * 17) | 0}s;animation-direction:${i % 2 ? "alternate-reverse" : "alternate"}"><path d="${d}" fill="${c}"/>${lines}</svg></div>`;
    });
    el.innerHTML = html; bands = $$(".band", el); built = theme; parallax();
  }
  function parallax() {
    if (!active() || still() || !visible) return;
    const y = Math.min(600, scrollY);
    bands.forEach((g) => (g.style.transform = `translate3d(0,${(-y * +g.dataset.f).toFixed(1)}px,0)`));
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; el.classList.toggle("paused", !visible || document.hidden); }).observe(el);
  document.addEventListener("visibilitychange", () => el.classList.toggle("paused", !visible || document.hidden));
  onScrollFns.push(parallax);
  const siq = () => { h1.classList.remove("siq-in"); if (active() && !still()) { void h1.offsetWidth; h1.classList.add("siq-in"); } };
  listeners.palette.push(() => { build(); siq(); }); listeners.theme.push(build);
  build(); siq();
})();

/* ---------- Siq reel: the demo opens from a narrow cleft as it scrolls into view ---------- */
(() => {
  const wrap = $("#siq"), fr = $(".frame", wrap);
  const ease = (t) => t * t * (3 - 2 * t);
  let last = -1;
  function update() {
    if (still()) { if (last !== 1) { wrap.style.setProperty("--o", 1); fr.style.setProperty("--o", 1); last = 1; } return; }
    const r = wrap.getBoundingClientRect();
    if (r.top > innerHeight * 1.2 || r.bottom < -200) return;
    const o = +ease(Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.8)))).toFixed(3);
    if (o !== last) { wrap.style.setProperty("--o", o); fr.style.setProperty("--o", o); last = o; }
  }
  onScrollFns.push(update); update();
})();

/* ---------- rejoin scroll moment: «الحكايات» flies home letter by letter ---------- */
(() => {
  const sec = $("#rejoin"), HZ = window.HZ, WORD = "الحكايات";
  const iso = HZ.graphemes(WORD), ctxF = HZ.splitArabic(WORD), n = iso.length;
  const box = $("#rj-box"), pcsEl = $(".rj-pcs", sec), fin = $(".rj-final", sec), num = $("#rj-n"), code = $("#rj-code"), bar = $(".rj-bar i", sec);
  $(".rj-mb", sec).innerHTML = iso.map((c) => `<span>${c}</span>`).join("");
  $(".rj-mj", sec).innerHTML = ctxF.map((c) => `<span>${c}</span>`).join("");
  $(".rj-static .b", sec).innerHTML = iso.map((c) => `<span>${c}</span>`).join("");
  pcsEl.innerHTML = iso.map((c, i) => `<div class="rj-pc"><i class="iso">${c}</i><i class="ctx">${ctxF[i]}</i></div>`).join("");
  const pcs = [...pcsEl.children];
  const BAD = '<span class="d">title.split("")</span>.map((ch) =&gt; &lt;span&gt;{ch}&lt;/span&gt;)', GOOD = '<span class="a">splitArabic(title)</span>.map((ch) =&gt; &lt;span&gt;{ch}&lt;/span&gt;)';
  let A = [], B = [], lastCode = "", lastN = -1, lastP = -1;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function measure() {
    const b = box.getBoundingClientRect();
    const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - b.left + r.width / 2, y: r.top - b.top }; };
    A = [...$(".rj-mb", sec).children].map(rel); B = [...$(".rj-mj", sec).children].map(rel);
  }
  function render(p) {
    let swapped = 0;
    pcs.forEach((el, i) => {
      const s = (i / n) * 0.45, k = ease(Math.min(1, Math.max(0, (p - s) / 0.5)));
      const x = A[i].x + (B[i].x - A[i].x) * k, y = A[i].y + (B[i].y - A[i].y) * k - Math.sin(k * Math.PI) * 36;
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      const sw = Math.min(1, Math.max(0, (k - 0.55) / 0.3)); el.children[0].style.opacity = 1 - sw; el.children[1].style.opacity = sw;
      if (sw > 0.5) swapped++;
    });
    const done = p > 0.985;
    pcsEl.classList.toggle("off", done); fin.classList.toggle("on", done);
    const v = done ? 0 : n - swapped; if (v !== lastN) { num.textContent = fmt(v); lastN = v; }
    bar.style.width = (p * 100).toFixed(1) + "%";
    const c = p < 0.5 ? BAD : GOOD; if (c !== lastCode) { code.innerHTML = c; lastCode = c; }
  }
  function onScroll() {
    if (still()) return;
    const r = sec.getBoundingClientRect(); if (r.bottom < -100 || r.top > innerHeight + 100) return;
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, sec.offsetHeight - innerHeight)));
    if (Math.abs(p - lastP) < 0.0005) return; lastP = p; render(p);
  }
  document.fonts.ready.then(() => {
    if (still()) { num.textContent = fmt(0); code.innerHTML = GOOD; return; }
    measure(); lastP = -1; onScroll(); if (lastP < 0) render(0);
    onScrollFns.push(onScroll);
    addEventListener("resize", () => { measure(); lastP = -1; onScroll(); });
    listeners.lang.push(() => requestAnimationFrame(() => { measure(); lastN = -1; lastP = -1; onScroll(); }));
  });
  listeners.lang.push(() => { if (still()) num.textContent = fmt(0); });
})();

/* ---------- how it works: sticky terminal streams the real harakah-fix output ---------- */
(() => {
  const out = $("#term"), pw = $("#pv-word"), after = $("#pv-after"), afterW = $("#pv-after-w");
  const PHRASE = "السلام عليكم";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const T = window.HZ_TERM; // [[class, text], …] per step, verbatim from data/*.txt
  const typing = () => !still() && !SHOT;
  let cur = -1, token = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const line = ([c, t]) => (c ? `<span class="${c}">${isoAr(esc(t))}</span>` : isoAr(esc(t)));
  function preview(fixed) {
    if (fixed) { pw.className = "pv-word keep fixed"; pw.innerHTML = PHRASE.split(" ").map((w) => HZ.splitArabic(w).map((c, i) => `<span style="--i:${i}">${c}</span>`).join("")).join(" "); }
    else { pw.className = "pv-word keep broken"; pw.innerHTML = HZ.graphemes(PHRASE).map((c) => `<span>${c === " " ? "&nbsp;" : c}</span>`).join(""); }
  }
  function meter(done) {
    if (done) after.dataset.n = "6"; else delete after.dataset.n; after.textContent = done ? fmt(6) : "–";
    afterW.innerHTML = done ? `<span data-n="542">${fmt(542)}</span>px` : "&nbsp;";
  }
  // each step clears the screen and shows that command's real output (like running it fresh)
  async function show(i) {
    if (i === cur) return; cur = i; const my = ++token;
    if (pw.classList.contains("fixed") !== i >= 1) preview(i >= 1);
    if (i < 2) meter(false);
    const done = [], paint = (extra = "", caret = true) => { out.innerHTML = done.join("\n") + extra + (caret ? '<span class="caret"></span>' : ""); };
    if (!typing()) { out.innerHTML = T[i].map(line).join("\n"); if (i === 2) meter(true); return; }
    for (const l of T[i]) {
      if (my !== token) return;
      if (l[0] === "p") {
        let s = "";
        for (const ch of l[1].slice(2)) { if (my !== token) return; s += ch; paint((done.length ? "\n" : "") + `<span class="p">$ ${esc(s)}</span>`); await sleep(16); }
        done.push(line(l)); paint(); await sleep(220);
      } else { done.push(line(l)); paint(); await sleep(90); }
    }
    if (my === token) { paint("", false); if (i === 2) meter(true); }
  }
  preview(false); meter(false);
  const steps = $$(".hstep");
  if (SHOT) { steps.forEach((s) => s.classList.add("on")); show(2); return; }
  show(0);
  const sio = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    steps.forEach((s) => s.classList.toggle("on", s === e.target)); show(+e.target.dataset.step);
  }), { rootMargin: matchMedia("(max-width:960px)").matches ? "-70% 0px -22% 0px" : "-45% 0px -45% 0px" });
  steps.forEach((s) => sio.observe(s));
})();

/* ---------- remotion: view-transition tabs ---------- */
(() => {
  const WORD = "الحكايات", REMOTION_TITLE = "سنة من الحكايات"; // the Remotion tab shows real renders of fixtures/remotion YearInReview
  const SHIM = '\n\n<span class="c">// + harakah-fix fix --write injects its runtime shim:</span>\n<span class="a">&lt;script&gt;/* ZWJ-pads each letter box, keeps لا */&lt;/script&gt;</span>\n<span class="c">// same elements, same timeline</span>';
  const TOOLS = {
    HTML: { bad: '<span class="c">// before</span>\n<span class="k">const</span> text = "الحكايات";\nel.innerHTML = [...text]\n  .map((ch) =&gt; `&lt;span class="ch"&gt;${ch}&lt;/span&gt;`)\n  .join("")', good: '<span class="c">// after: your code is unchanged</span>\n<span class="k">const</span> text = "الحكايات";\nel.innerHTML = [...text]\n  .map((ch) =&gt; `&lt;span class="ch"&gt;${ch}&lt;/span&gt;`)\n  .join("")' + SHIM },
    GSAP: { bad: '<span class="c">// before\n// page: &lt;h1 id="title"&gt;الحكايات&lt;/h1&gt;</span>\n<span class="k">const</span> split = <span class="d">SplitText.create</span>("#title",\n  { type: "words,chars" });\ngsap.from(split.chars, { y: 80, stagger: 0.04 });', good: '<span class="c">// after: your code is unchanged\n// page: &lt;h1 id="title"&gt;الحكايات&lt;/h1&gt;</span>\n<span class="k">const</span> split = SplitText.create("#title",\n  { type: "words,chars" });\ngsap.from(split.chars, { y: 80, stagger: 0.04 });' + SHIM + '\n\n<span class="c">// compare: "الحكايات" ink pieces 11 → 8 (reference 8) ✓</span>' },
    HyperFrames: { bad: '<span class="c">&lt;!-- before --&gt;</span>\n&lt;div id="root" dir="rtl" data-composition-id="main"&gt;\n  &lt;h1 id="title"&gt;الحكايات&lt;/h1&gt;\n&lt;/div&gt;\n&lt;script&gt;\n  tl.from(<span class="d">split.chars</span>, …);\n  window.__timelines["main"] = tl;\n&lt;/script&gt;', good: '<span class="c">&lt;!-- after: same composition --&gt;</span>\n&lt;div id="root" dir="rtl" data-composition-id="main"&gt;\n  &lt;h1 id="title"&gt;الحكايات&lt;/h1&gt;\n&lt;/div&gt;\n&lt;script&gt;\n  tl.from(split.chars, …);\n  window.__timelines["main"] = tl;\n&lt;/script&gt;' + SHIM },
    Remotion: { bad: '<span class="c">// before · YearInReview.tsx</span>\n<span class="k">const</span> title = "سنة من الحكايات";\n{title.<span class="d">split("")</span>.map((ch, i) =&gt; {\n  <span class="k">const</span> s = spring({ frame: frame - 24 - i * 2, fps });', good: '<span class="c">// after · harakah-fix codemod (real diff)</span>\n<span class="k">import</span> { formatDigits, splitArabic, withArabicSeparators } <span class="k">from</span> "../harakah-arabic";\n<span class="k">const</span> title = "سنة من الحكايات";\n{<span class="c">/* harakah: was title.split("") */</span> <span class="a">splitArabic(title)</span>.map((ch, i) =&gt; {\n  <span class="k">const</span> s = spring({ frame: frame - 24 - i * 2, fps });\n\n<span class="c">// or the component:</span>\n&lt;ArabicText text="سنة من الحكايات" preset="rise" stagger={2} /&gt;' },
  };
  const names = Object.keys(TOOLS);
  let tool = "Remotion", fixed = false;
  const tabs = $("#vt-tabs"), code = $("#vt-code"), view = $("#vt-view"), state = $("#vt-state"), flip = $("#vt-flip"), panel = $("#vt-panel");
  tabs.innerHTML = names.map((t) => `<button role="tab" id="vt-tab-${t}" aria-controls="vt-panel" data-t="${t}">${t}</button>`).join("");
  function render() {
    $$("button", tabs).forEach((b) => { const on = b.dataset.t === tool; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    panel.setAttribute("aria-labelledby", `vt-tab-${tool}`);
    code.innerHTML = isoAr(TOOLS[tool][fixed ? "good" : "bad"]);
    // data-word: the Arabic the stage shows, which must also be the Arabic in the code under it (scripts/qa-visual.mjs)
    if (tool === "Remotion") {
      view.dataset.word = REMOTION_TITLE;
      view.innerHTML = `<img class="vt-img" src="/demo/remotion/${fixed ? "after" : "before"}.png" alt="${fixed ? `Remotion render after Harakah: «${REMOTION_TITLE}» joined · بعد الإصلاح` : `Remotion render before: «${REMOTION_TITLE}» in broken letters · قبل الإصلاح`}" width="1280" height="720" decoding="async">`;
    } else {
      view.dataset.word = WORD;
      const parts = fixed ? HZ.splitArabic(WORD) : HZ.graphemes(WORD);
      view.innerHTML = `<div class="vt-word keep ${fixed ? "fixed" : "broken"}" lang="ar" dir="rtl" role="img" aria-label="${fixed ? `${WORD} · joined` : `${WORD} · split into isolated letters`}">${parts.map((c) => `<span aria-hidden="true">${c}</span>`).join("")}</div>`;
    }
    state.className = "vt-state " + (fixed ? "ok" : "bad"); state.textContent = fixed ? "joined ✓" : "split ✗";
    flip.setAttribute("aria-pressed", String(fixed));
    $("[lang=ar]", flip).textContent = fixed ? "اعرض الخطأ" : "أصلح الكلمة";
    $("[lang=en]", flip).textContent = fixed ? "Show the bug" : "Fix the word";
  }
  const go = (fn) => (document.startViewTransition && !still() ? document.startViewTransition(() => { fn(); render(); }) : (fn(), render()));
  tabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.t !== tool) go(() => { tool = b.dataset.t; fixed = false; }); });
  tabs.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
    e.preventDefault(); const i = (names.indexOf(tool) + d + names.length) % names.length;
    go(() => { tool = names[i]; fixed = false; }); requestAnimationFrame(() => $(`#vt-tab-${tool}`).focus());
  });
  flip.addEventListener("click", () => go(() => (fixed = !fixed)));
  if (SHOT) fixed = true;
  render();
})();

/* ---------- section rail ---------- */
(() => {
  const links = $$(".rail a");
  const map = new Map(links.map((a) => [a.dataset.band, a]));
  const rio = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    links.forEach((a) => a.removeAttribute("aria-current")); map.get(e.target.id)?.setAttribute("aria-current", "true");
  }), { rootMargin: "-40% 0px -55% 0px" });
  ["top", "demo", "problem", "fixes", "how", "remotion"].forEach((id) => { const el = document.getElementById(id); if (el) rio.observe(el); });
})();

runScroll();

/* ---------- version from the running server (falls back to the baked-in string) ---------- */
fetch("/api/meta").then((r) => (r.ok ? r.json() : null)).then((m) => { if (m && m.version) $("#ver").textContent = `harakah-fix v${m.version}`; }).catch(() => {});

// Pro waitlist: posts the email to /api/waitlist (Cloudflare Pages Function) and answers inline.
// Where there's no endpoint (local serve, a static host), it says so and offers the mailto link.
(() => {
  const form = $("#waitlist"); if (!form) return;
  const input = $("#wl-email", form), btn = $("button[type=submit]", form), msg = $("#wl-msg");
  const MAIL = "mailto:hello@harakah.si?subject=Harakah%20Pro%20waitlist";
  const note = msg.innerHTML;
  const say = (cls, ar, en) => { msg.className = `wl-msg ${cls}`; msg.innerHTML = `<span lang="ar">${ar}</span><span lang="en">${en}</span>`; };
  const valid = (v) => v.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(v);
  // "gmial.com" → "gmail.com", "hotmail.con" → "hotmail.com". Only .com typos of big providers, so yahoo.ca or
  // mail.com are never "corrected".
  const NAMES = ["gmail", "hotmail", "outlook", "yahoo", "icloud", "protonmail", "aol"], REAL = ["mail", "email", "ymail", "gmx", "live", "me"];
  const COM = ["con", "cmo", "co", "om", "comm", "cm", "vom", "xom", "ocm", "cpm"];
  const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const suggest = (v) => {
    const at = v.lastIndexOf("@"), dom = v.slice(at + 1), dot = dom.lastIndexOf("."), name = dom.slice(0, dot), tld = dom.slice(dot + 1);
    if (tld !== "com" && !COM.includes(tld)) return "";
    const hit = NAMES.includes(name) ? (tld === "com" ? "" : name) : REAL.includes(name) ? "" : NAMES.find((n) => { const d = dist(name, n); return d > 0 && d <= (n.length > 4 ? 2 : 1); });
    return hit ? `${v.slice(0, at)}@${hit}.com` : "";
  };
  const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  let checked = "";
  input.addEventListener("input", () => { if (input.getAttribute("aria-invalid")) { input.removeAttribute("aria-invalid"); msg.className = "wl-msg"; msg.innerHTML = note; } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (btn.getAttribute("aria-disabled") === "true") return;
    const email = input.value.trim().toLowerCase();
    if (!valid(email)) { input.setAttribute("aria-invalid", "true"); say("err", "اكتب بريداً إلكترونياً صحيحاً، مثل you@studio.com", "Enter a valid email, like you@studio.com"); input.focus(); return; }
    const fix = suggest(email);
    if (fix && checked !== email) {
      checked = email; // asked once: a second submit sends it as typed
      say("", `هل تقصد <button type="button">${esc(fix)}</button>؟ أو اضغط الزر مرة أخرى لإرسال ما كتبت.`, `Did you mean <button type="button">${esc(fix)}</button>? Or press the button again to send it as typed.`);
      $$("button", msg).forEach((b) => b.addEventListener("click", () => { input.value = fix; checked = fix; msg.className = "wl-msg"; msg.innerHTML = note; input.focus(); }));
      return;
    }
    btn.setAttribute("aria-disabled", "true"); say("", "جارٍ الحفظ…", "Saving…");
    let ok = false, status = 0;
    try {
      const r = await fetch(form.action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, lang: root.dataset.lang, website: $("#wl-website").value }) });
      status = r.status; ok = r.ok;
    } catch {}
    btn.removeAttribute("aria-disabled");
    if (ok) { form.classList.add("done"); say("ok", "✓ أنت في القائمة. سنراسلك مرة واحدة عند إطلاق حركة برو.", "✓ You're on the list. We'll email you once, when Harakah Pro opens."); return; }
    if (status === 400) { input.setAttribute("aria-invalid", "true"); say("err", "اكتب بريداً إلكترونياً صحيحاً، مثل you@studio.com", "Enter a valid email, like you@studio.com"); input.focus(); return; }
    say("err", `لم نتمكن من حفظ بريدك. <a href="${MAIL}">راسلنا مباشرة</a>.`, `Couldn't save it right now. <a href="${MAIL}">Email us instead</a>.`);
  });
})();

// copy buttons next to the commands (hero, final CTA)
$$("[data-copy]").forEach((b) => b.addEventListener("click", () => {
  const text = b.parentNode.querySelector("code").textContent, keep = b.innerHTML;
  const done = () => {
    b.classList.add("done"); b.innerHTML = '<span lang="ar">نُسخ</span><span lang="en">Copied</span>';
    setTimeout(() => { b.classList.remove("done"); b.innerHTML = keep; }, 1600);
  };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
}));
