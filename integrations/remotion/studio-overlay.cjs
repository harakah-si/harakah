// Harakah panel inside Remotion Studio. Added by withHarakah() to development (Studio) builds only, never to
// renders. Shows the latest Harakah check of the project (written by the webpack plugin after each relevant
// rebuild) and updates live through webpack HMR. Plain DOM in a shadow root: no React, no styles leak.
// لوحة حركة داخل Remotion Studio: آخر فحص للنص العربي، يتحدّث مباشرة مع كل حفظ.
"use strict";
/* global window, document, navigator */
var results = require("harakah-studio-results");

var host, root, open = false, autoHide = null, lastKey = "", lastPath = "";

function studioReady() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof window.remotion_puppeteerTimeout !== "undefined" || window.remotion_isPlayer) return false; // rendering / Player
  return !!window.remotion_isStudio;
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
var EA = "٠١٢٣٤٥٦٧٨٩";
function ar(n) { return String(n).replace(/[0-9]/g, function (d) { return EA[d]; }); }

var CSS = [
  ":host{all:initial}",
  ".hz{position:fixed;z-index:2147483000;bottom:14px;left:14px;font:13px/1.5 'IBM Plex Sans Arabic',system-ui,-apple-system,'Segoe UI',sans-serif;color:#f4f1ea;direction:rtl}",
  ".pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#17171c;border:1px solid #2c2c33;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;user-select:none}",
  ".pill:focus-visible{outline:2px solid #ff5a36;outline-offset:2px}",
  ".dot{width:9px;height:9px;border-radius:50%;flex:none}",
  ".ok .dot{background:#12b76a}.blocked .dot{background:#f04438}.warn .dot{background:#f79009}.checking .dot,.error .dot{background:#8a8a94}",
  ".checking .dot{animation:p 1s ease-in-out infinite}@keyframes p{50%{opacity:.3}}",
  "@media (prefers-reduced-motion:reduce){.checking .dot{animation:none}}",
  ".brand{font-weight:700}.en{color:#a9a6a0;direction:ltr;unicode-bidi:isolate}",
  ".panel{margin-bottom:8px;width:min(460px,calc(100vw - 28px));max-height:min(60vh,520px);overflow:auto;background:#17171c;border:1px solid #2c2c33;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45)}",
  ".ph{padding:12px 14px 8px;border-bottom:1px solid #2c2c33}.ph b{display:block;font-size:14px}.ph .en,.pf .en{display:block}",
  "ul{list-style:none;margin:0;padding:6px 8px}li{padding:7px 6px;border-radius:8px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:baseline}",
  "li+li{border-top:1px dashed #26262c}",
  ".code{font:600 11px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#ff7a5c;direction:ltr}",
  ".file{grid-column:2;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#a9a6a0;direction:ltr;text-align:right;unicode-bidi:isolate;word-break:break-all}",
  ".auto{color:#12b76a;font-size:11px}",
  ".pf{padding:10px 14px 14px;border-top:1px solid #2c2c33;display:grid;gap:8px}",
  ".cmd{display:flex;gap:8px;align-items:center}.cmd code{flex:1;min-width:0;overflow:auto;white-space:nowrap;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;background:#0e0e12;border:1px solid #2c2c33;border-radius:8px;padding:6px 8px;direction:ltr;text-align:left}",
  "button{font:inherit;color:inherit;background:#26262c;border:1px solid #34343c;border-radius:8px;padding:5px 10px;cursor:pointer}button:hover{background:#2f2f36}",
  ".muted{color:#a9a6a0;font-size:12px}",
  ".lay{border-top:1px solid #2c2c33;padding:10px 14px 4px}.lay h4{margin:0 0 6px;font-size:13px}.lay h4 .en{display:block;font-weight:400;font-size:12px}",
  ".comp{border:1px solid #26262c;border-radius:10px;padding:8px 10px;margin-bottom:8px}.comp.cur{border-color:#ff5a36;background:#1d1a1a}",
  ".cid{font:600 12px/1.5 ui-monospace,Menlo,Consolas,monospace;direction:ltr;unicode-bidi:isolate}.cur .cid::after{content:' · الحالية / current';font:11px system-ui,sans-serif;color:#ff7a5c}",
  ".li{padding:6px 0}.li+.li{border-top:1px dashed #26262c}.txt{font-size:15px;font-weight:600}",
  ".fr{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;direction:ltr;justify-content:flex-end}.fr em{font:11px system-ui,sans-serif;color:#a9a6a0;font-style:normal;margin-inline-end:4px}.fr span{font:11px/1.6 ui-monospace,Menlo,Consolas,monospace;background:#26262c;border-radius:6px;padding:0 6px}",
  ".sg{margin-top:4px;font-size:12px}.sg code{font:12px ui-monospace,Menlo,Consolas,monospace;background:#0e0e12;border:1px solid #2c2c33;border-radius:6px;padding:1px 6px;direction:ltr;unicode-bidi:isolate}.sg .v{color:#12b76a}.sg .nv{color:#f79009}",
].join("\n");

function currentComp() {
  try { return decodeURIComponent((window.location.pathname || "/").split("/").filter(Boolean)[0] || ""); } catch (e) { return ""; }
}

// Runtime layout audit (HZ24): letter/word order over time, per composition. `r.layout` is absent when the
// layout audit is off (withHarakah({ layout: true }) or HARAKAH_LAYOUT=1 turns it on).
function layoutHtml(r) {
  var L = r.layout;
  if (!L) return '<div class="lay muted">ترتيب العرض عبر الإطارات غير مُفعّل: <bdi dir="ltr">withHarakah({ layout: true })</bdi><span class="en" style="display:block">Layout over time (HZ24) is off: withHarakah({ layout: true }) or HARAKAH_LAYOUT=1.</span></div>';
  var comps = (L.compositions || []).slice();
  var cur = currentComp();
  comps.sort(function (a, b) { return (b.id === cur) - (a.id === cur); });
  var h = '<div class="lay" data-layout><h4>ترتيب العرض عبر الإطارات<span class="en">Layout over time (HZ24)</span></h4>';
  if (L.note) h += '<div class="muted" style="margin-bottom:6px">' + esc(L.note) + '</div>';
  if (!comps.length) return h + '<div class="muted" style="margin-bottom:8px">' + (L.note ? "" : "ترتيب الحروف والكلمات سليم في كل الإطارات المفحوصة ✓<span class=\"en\" style=\"display:block\">Letter and word order is right-to-left in every sampled frame.</span>") + '</div></div>';
  for (var c = 0; c < comps.length; c++) {
    var C = comps[c];
    h += '<div class="comp' + (C.id === cur ? " cur" : "") + '" data-comp="' + esc(C.id) + '"><div class="cid">' + esc(C.id) + '</div>';
    for (var i = 0; i < Math.min(C.issues.length, 12); i++) {
      var it = C.issues[i], fr = it.frames || [];
      h += '<div class="li"><span class="code">' + esc(it.code) + '</span> <span class="txt">«<bdi>' + esc(it.text) + '</bdi>»</span>';
      h += '<div class="muted">' + esc((it.ar || "").split(" الإصلاح:")[0].replace(/^«[^»]*»\s*/, "")) + '</div>';
      if (fr.length) {
        h += '<div class="fr" title="frames · الإطارات"><em>frames · الإطارات (Studio)</em>';
        for (var k = 0; k < Math.min(fr.length, 16); k++) h += '<span>' + esc(fr[k]) + '</span>';
        if (fr.length > 16) h += '<span>+' + (fr.length - 16) + '</span>';
        h += '</div>';
      }
      var sg = it.suggest;
      if (sg && sg.kind === "dir") h += '<div class="sg">الإصلاح المقترح: أضف <code>dir="rtl"</code> إلى <code>&lt;' + esc(sg.tag) + '&gt;</code> الحاوي للنص ' + (sg.verified ? '<span class="v">✓ تحقّقنا منه في كروم</span>' : '<span class="nv">(لم يُتحقّق منه)</span>') + '<span class="en" style="display:block">Suggested: add dir="rtl" to the containing &lt;' + esc(sg.tag) + '&gt;' + (sg.verified ? " (verified at the flagged frames)" : " (not verified)") + '</span></div>';
      else if (sg && sg.kind === "reorder") h += '<div class="sg">الإصلاح المقترح: ضع العنصر رقم i في الموضع المعكوس (x = -i × w، أو من اليمين)<span class="en" style="display:block">Suggested: place item i at the mirrored slot (x = -i × w, or from the right).</span></div>';
      h += '</div>';
    }
    h += '</div>';
  }
  return h + '</div>';
}

function mount() {
  if (host) return;
  host = document.createElement("harakah-studio");
  host.setAttribute("data-harakah", "");
  root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  document.body.appendChild(host);
}

function render(r) {
  if (!studioReady()) return;
  mount();
  r = r || { status: "checking" };
  var status = r.status || "checking";
  var blocking = r.blocking || [];
  // runtime layout findings get their own section (frames, suggestion); the generic list keeps the source findings
  var listed = r.layout ? blocking.filter(function (b) { return !(b.code === "HZ24" && /#[^\/\\]+$/.test(b.file || "")); }) : blocking;
  var warnOnly = r.mode === "warn";
  var cls = status === "blocked" && warnOnly ? "warn" : status;
  var n = blocking.length;
  var pillAr = status === "ok" ? "النص العربي سليم ✓" : status === "blocked" ? (n === 1 ? "مشكلة عربية واحدة" : ar(n) + " مشاكل عربية") : status === "error" ? "تعذّر الفحص" : "جارٍ فحص النص العربي…";
  var pillEn = status === "ok" ? "Arabic OK" : status === "blocked" ? n + " Arabic issue" + (n === 1 ? "" : "s") : status === "error" ? "check failed" : "checking…";
  var key = status + ":" + n + ":" + (r.at || "");
  lastPath = currentComp();
  if (key !== lastKey) { if (status === "blocked") open = true; lastKey = key; }
  var html = '<style>' + CSS + '</style><div class="hz ' + cls + '" part="harakah">';
  if (open && status !== "checking") {
    html += '<div class="panel" role="region" aria-label="Harakah · حركة"><div class="ph">';
    if (status === "ok") html += '<b>النص العربي سيظهر سليماً في الرندر.</b><span class="en">Arabic will render correctly.</span>';
    else if (status === "error") html += '<b>تعذّر تشغيل فحص حركة.</b><span class="en">' + esc(r.note || "Harakah check did not run") + '</span>';
    else html += '<b>' + (warnOnly ? "النص العربي سيظهر مكسوراً في الرندر." : "النص العربي سيظهر مكسوراً، والرندر محجوب حتى الإصلاح.") + '</b><span class="en">' + (warnOnly ? "Arabic would render broken." : "Arabic would render broken; renders are blocked until fixed.") + '</span>';
    html += '</div>';
    var m = listed.length;
    if (m) {
      html += "<ul>";
      for (var i = 0; i < Math.min(m, 40); i++) {
        var b = listed[i];
        html += '<li><span class="code">' + esc(b.code) + '</span><span><bdi>' + esc(b.title) + '</bdi>' + (b.fixable ? ' <span class="auto">(إصلاح تلقائي · auto-fix)</span>' : "") + '</span><span class="file">' + esc(b.file) + (b.line ? ":" + esc(b.line) : "") + '</span></li>';
      }
      if (m > 40) html += '<li class="muted">… ' + ar(m - 40) + ' أخرى · ' + (m - 40) + ' more</li>';
      html += "</ul>";
    }
    if (status !== "error") html += layoutHtml(r);
    var w = (r.summary && r.summary.warnings) || 0;
    if (w && status === "blocked") html += '<div class="muted" style="padding:0 14px 10px">' + (w === 1 ? "وتنبيه واحد آخر" : "و" + ar(w) + " تنبيهات أخرى") + ' تظهر مع <bdi dir="ltr">harakah-fix check</bdi><span class="en" style="display:block">+' + w + ' more warning' + (w === 1 ? "" : "s") + ' (harakah-fix check)</span></div>';
    if (r.fixCommand) html += '<div class="pf"><div class="cmd"><code>' + esc(r.fixCommand) + '</code><button type="button" data-copy>نسخ · Copy</button></div><span class="muted">شغّل الأمر في الطرفية، أو اطلب من مساعدك <bdi>harakah_fix</bdi>. يتحدّث هذا التنبيه مع كل حفظ.<span class="en">Run it in a terminal (or ask your agent to run harakah_fix). This updates on every save.</span></span></div>';
    html += "</div>";
  }
  html += '<div class="pill" role="button" tabindex="0" aria-expanded="' + (open ? "true" : "false") + '" title="Harakah · حركة"><span class="dot"></span><span class="brand">حركة</span><span>' + pillAr + '</span><span class="en">' + esc(pillEn) + "</span></div></div>";
  root.innerHTML = html;
  var pill = root.querySelector(".pill");
  var toggle = function () { open = !open; render(results); };
  pill.addEventListener("click", toggle);
  pill.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  var copy = root.querySelector("[data-copy]");
  if (copy) copy.addEventListener("click", function () { try { navigator.clipboard.writeText(r.fixCommand); copy.textContent = "✓"; } catch (e) { /* ignore */ } });
  clearTimeout(autoHide);
  if (status === "ok" && open) autoHide = setTimeout(function () { open = false; render(results); }, 5000);
}

function start() {
  var tries = 0;
  (function wait() {
    if (studioReady() && document.body) {
      // Studio switches compositions with pushState (no event): re-render when the selected one changes
      setInterval(function () { if (open && results && results.layout && currentComp() !== lastPath) render(results); }, 800);
      return render(results);
    }
    if (++tries < 100) setTimeout(wait, 100);
  })();
}
if (typeof window !== "undefined") {
  window.__harakahStudio = { render: function () { render(results); }, get results() { return results; } };
  start();
}
if (module.hot) {
  module.hot.accept("harakah-studio-results", function () {
    results = require("harakah-studio-results");
    render(results);
  });
}
