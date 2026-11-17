/* Diagnóstico en pantalla para el TELÉFONO (sin consola a la mano).
   - Siempre junta: errores de JS, promesas rechazadas sin atender y recursos que no cargaron (script, css, imagen).
   - Si ocurre alguno, aparece un panel rojo pequeño abajo a la izquierda con el detalle.
   - Con ?diag=1 en la dirección el panel se ve siempre, con datos del navegador: tamaño de pantalla, WebGL (renderer y
     textura máxima), service worker que controla la página y cachés guardadas.
   - Botón "Borrar caché y recargar": da de baja el service worker, borra sus cachés y recarga (arregla archivos viejos).
   No escribe en la consola (las pruebas exigen consola limpia) y no toca la simulación. */
(function (global) {
  "use strict";
  var errs = [], panel = null, body = null;
  var forced = /[?&]diag=1\b/.test(global.location.search || "");

  function short(u) { u = String(u || ""); var i = u.indexOf("/", 8); return i > 0 ? u.slice(i) : u; }
  function add(kind, msg) {
    errs.push(kind + ": " + msg);
    if (errs.length > 30) errs.shift();
    show();
  }

  global.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t !== global && (t.src || t.href)) add("no cargó", (t.tagName || "").toLowerCase() + " " + short(t.src || t.href));
    else add("error JS", (e.message || "?") + (e.filename ? " (" + short(e.filename) + ":" + e.lineno + ")" : ""));
  }, true);
  global.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason; add("promesa", (r && (r.message || r)) || "?");
  });

  function glInfo() {
    try {
      var c = document.createElement("canvas"), g = c.getContext("webgl2") || c.getContext("webgl");
      if (!g) return "WebGL: NO disponible";
      var ext = g.getExtension("WEBGL_debug_renderer_info");
      var r = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
      return "WebGL" + (g instanceof (global.WebGL2RenderingContext || Object) ? "2" : "1") + ": " + r + " · textura máx " + g.getParameter(g.MAX_TEXTURE_SIZE);
    } catch (x) { return "WebGL: error " + x.message; }
  }

  function info(cb) {
    var L = ["pantalla " + global.innerWidth + "x" + global.innerHeight + " @" + (global.devicePixelRatio || 1),
             glInfo(), "agente " + navigator.userAgent];
    var sw = navigator.serviceWorker;
    L.push("service worker: " + (sw && sw.controller ? "controla la página" : "no controla"));
    if (global.caches && caches.keys) caches.keys().then(function (k) { L.push("cachés: " + (k.join(", ") || "ninguna")); cb(L); }, function () { cb(L); });
    else cb(L);
  }

  function clearAndReload() {
    var jobs = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    if (global.caches && caches.keys)
      jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    Promise.all(jobs).then(function () { global.location.reload(); }, function () { global.location.reload(); });
  }

  function build() {
    if (panel || !document.body) return;
    panel = document.createElement("div");
    panel.id = "pg-diag";
    panel.setAttribute("style", "position:fixed;left:6px;bottom:6px;z-index:2147483647;max-width:min(92vw,560px);max-height:46vh;" +
      "overflow:auto;background:rgba(120,10,20,.94);color:#fff;font:12px/1.35 monospace;padding:8px 10px;border-radius:6px;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.6);white-space:pre-wrap;word-break:break-word;pointer-events:auto");
    var bar = document.createElement("div");
    bar.setAttribute("style", "display:flex;gap:6px;margin-bottom:6px");
    function btn(txt, fn) { var b = document.createElement("button"); b.textContent = txt;
      b.setAttribute("style", "font:12px sans-serif;padding:4px 8px;border-radius:4px;border:0;background:#fff;color:#600");
      b.addEventListener("click", function (e) { e.stopPropagation(); fn(); }); bar.appendChild(b); }
    btn("Borrar caché y recargar", clearAndReload);
    btn("Cerrar", function () { panel.style.display = "none"; });
    body = document.createElement("div");
    panel.appendChild(bar); panel.appendChild(body);
    document.body.appendChild(panel);
  }

  function show() {
    if (!document.body) { document.addEventListener("DOMContentLoaded", show); return; }
    build();
    panel.style.display = "";
    var head = errs.length ? "PROBLEMAS (" + errs.length + "):\n" + errs.join("\n") : "Sin errores detectados.";
    body.textContent = head;
    if (forced) info(function (L) { body.textContent = head + "\n\n" + L.join("\n"); });
  }

  global.PGDiag = { errors: function () { return errs.slice(); }, show: show, clearAndReload: clearAndReload };
  if (forced) global.addEventListener("load", show);
})(window);
