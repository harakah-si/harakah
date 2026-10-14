(function () {
  var d = document.documentElement, q = new URLSearchParams(location.search);
  var qt = q.get("theme"); if (qt === "light" || qt === "dark") localStorage.setItem("hz-theme", qt);
  var t = localStorage.getItem("hz-theme");
  d.dataset.theme = t === "light" || t === "dark" ? t : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  d.dataset.themePref = t || "system";
  var ql = q.get("lang");
  if (ql === "en" || ql === "ar") localStorage.setItem("hz-lang", ql);
  var l = localStorage.getItem("hz-lang") === "en" ? "en" : "ar";
  d.dataset.lang = l; d.lang = l; d.dir = l === "en" ? "ltr" : "rtl";
  // palette: Mosaic (chosen); ?palette=blue|inkpetra previews the alternates
  var P = ["mosaic", "blue", "inkpetra"], qp = q.get("palette");
  d.dataset.palette = P.indexOf(qp) >= 0 ? qp : "mosaic"; // Mosaic is the chosen design; ?palette= previews the others (not remembered)
  // digits in Arabic: eastern ١٢٣ (default) or western 123
  var qd = q.get("digits"); if (qd === "eastern" || qd === "western") localStorage.setItem("hz-digits", qd);
  d.dataset.digits = localStorage.getItem("hz-digits") === "western" ? "western" : "eastern";
  if (q.has("shot")) d.classList.add("shot");
})();
