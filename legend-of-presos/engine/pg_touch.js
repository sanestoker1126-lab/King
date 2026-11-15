/* pg_touch.js — control táctil v2 para Android/teléfonos.
   - Joystick FLOTANTE (aparece donde apoyas el pulgar en la mitad izquierda) o FIJO. 8 direcciones por sectores de 45°
     con histéresis: un ↓↘→ o →↓↘ sale limpio aunque el pulgar tiemble en el borde entre dos sectores.
   - Botones en ARCO estilo arcade: Puño (A), Patada (B), Especial (C), Súper (D) + Guardia grande junto al pulgar,
     y atajos MAX (Puño+Especial) y ROD (rodada = Puño+Patada) arriba.
   - DESLIZAR: un dedo que pasa de un botón a otro pulsa el nuevo (encadenar golpes sin levantar el pulgar).
   - Ajustes (data en PGStore): tamaño, opacidad, joystick flotante/fijo, zurdo, etiquetas P/K o A/B/C/D, zona muerta.
   - Avisa el espacio que ocupan (evento "pgtouch:insets") para que el render deje la arena ENTRE los controles.
   Alimenta un PGInput.Controller (held/_pressed): el lector de comandos del simulador funciona igual que con teclado. */
(function (global) {
  "use strict";

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function pref(k, d) { var S = global.PGStore; var v = S && typeof S.get === "function" ? S.get(k) : undefined; return v == null ? d : v; }

  // acción -> acciones del controlador que pulsa (un botón puede pulsar dos a la vez: llegan en el mismo cuadro, dentro
  // de la ventana de simultaneidad del simulador, config.timing.simulWindow)
  var COMBO = { roll: ["punch", "kick"], max: ["punch", "special"] };
  var LABELS = {
    classic: { punch: "P", kick: "K", special: "ESP", super: "SÚP", block: "GUARD", max: "MAX", roll: "ROD" },
    arcade:  { punch: "A", kick: "B", special: "C",   super: "D",   block: "GUARD", max: "MAX", roll: "ROD" }
  };
  var SUB = { punch: "puño", kick: "patada", special: "especial", super: "súper", max: "A+C", roll: "A+B" };

  var PGTouch = {
    mount: function (root, controller, opts) {
      opts = opts || {};
      var preview = !!opts.preview;                         // vista previa de Opciones: no toca el estado global del pad real
      if (!preview && PGTouch._winOff) PGTouch._winOff();
      root.classList.add("pgtouch");
      root.innerHTML = "";
      controller._touchN = {};
      if (!preview) ["punch", "kick", "special", "super", "block", "left", "right", "up", "down"].forEach(function (a) { controller.held[a] = false; });   // al re-montar no queda nada "pegado"
      var scale = Math.max(0.7, Math.min(1.4, +pref("touchScale", 1) || 1));
      var alpha = Math.max(0.3, Math.min(1, +pref("touchOpacity", 0.85) || 0.85));
      var floating = pref("touchStick", "float") !== "fixed";
      var lefty = !!pref("touchLefty", false);
      var lab = LABELS[pref("touchLayout", "classic") === "arcade" ? "arcade" : "classic"];
      root.style.setProperty("--tk", scale);
      root.style.setProperty("--ta", alpha);
      root.classList.toggle("lefty", lefty);

      // ---------- JOYSTICK ----------
      var zone = el("div", "pg-stickzone");                 // zona sensible (mitad del lado del joystick)
      var base = el("div", "pg-stick-base");
      var knob = el("div", "pg-stick-knob");
      var arrows = el("div", "pg-stick-arrows", "<i></i><i></i><i></i><i></i>");
      base.appendChild(arrows); base.appendChild(knob); zone.appendChild(base); root.appendChild(zone);

      // ---------- BOTONES ----------
      var pad = el("div", "pg-btns");
      var defs = opts.buttons || [
        { act: "block",   cls: "b-gd" },
        { act: "punch",   cls: "b-p" },
        { act: "kick",    cls: "b-k" },
        { act: "special", cls: "b-sp" },
        { act: "super",   cls: "b-su" },
        { act: "max",     cls: "b-max mini" },
        { act: "roll",    cls: "b-roll mini" }
      ];
      var btns = [];
      defs.forEach(function (d) {
        var b = el("div", "pg-btn " + d.cls, '<b>' + (d.label || lab[d.act]) + '</b>' + (SUB[d.act] && !d.label ? '<small>' + SUB[d.act] + '</small>' : ''));
        b.dataset.act = d.act; b.setAttribute("role", "button"); b.setAttribute("aria-label", SUB[d.act] || d.act);
        pad.appendChild(b); btns.push(b);
      });
      root.appendChild(pad);

      // ---------- joystick: lógica ----------
      var DEAD = +pref("touchDeadZone", 0.30) || 0.30;
      var HYST = 10 * Math.PI / 180;                          // histéresis entre sectores (10°)
      var sid = null, cx = 0, cy = 0, R = 60, sector = -1;
      function radius() { var r = base.getBoundingClientRect(); return (r.width / 2) || 60; }
      function home() {                                       // posición de reposo de la base (centro, px de pantalla)
        var z = zone.getBoundingClientRect(), r = R;
        return { x: lefty ? z.right - r - 18 : z.left + r + 18, y: z.bottom - r - 18 };
      }
      function place(x, y) { var z = zone.getBoundingClientRect(); base.style.left = (x - z.left) + "px"; base.style.top = (y - z.top) + "px"; cx = x; cy = y; }
      function rest() { R = radius(); var h = home(); place(h.x, h.y); knob.style.transform = "translate(-50%,-50%)"; base.classList.remove("live"); sector = -1; setDir(controller, -1); paintArrows(-1); }
      function paintArrows(s) { base.dataset.s = s; }
      function move(px, py) {
        var dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy), mag = len / R;
        // FLOTANTE: si el pulgar se va más allá del borde, la base lo sigue (no hay que volver al centro)
        if (floating && mag > 1.25) { var k = (len - R * 1.25) / len; place(cx + dx * k, cy + dy * k); dx = px - cx; dy = py - cy; len = Math.hypot(dx, dy); mag = len / R; }
        var kx = dx, ky = dy; if (mag > 1) { kx = dx / mag; ky = dy / mag; }
        knob.style.transform = "translate(calc(-50% + " + kx + "px), calc(-50% + " + ky + "px))";
        var s = -1;
        if (mag >= DEAD) {
          var ang = Math.atan2(-dy, dx);                      // 0 = derecha, + hacia arriba
          var raw = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
          if (sector >= 0 && raw !== sector) {                // seguir en el sector actual mientras no salga con margen
            var c = sector * Math.PI / 4, d = Math.atan2(Math.sin(ang - c), Math.cos(ang - c));
            s = Math.abs(d) < Math.PI / 8 + HYST ? sector : raw;
          } else s = raw;
        }
        if (s !== sector) { sector = s; setDir(controller, s); paintArrows(s); }
      }
      function start(t) {
        sid = t.identifier; R = radius();
        if (floating) place(t.clientX, t.clientY); else { var h = home(); place(h.x, h.y); }
        base.classList.add("live"); move(t.clientX, t.clientY);
      }
      zone.addEventListener("touchstart", function (e) { e.preventDefault(); if (sid === null) start(e.changedTouches[0]); }, { passive: false });
      zone.addEventListener("touchmove", function (e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; if (t.identifier === sid) move(t.clientX, t.clientY); } }, { passive: false });
      var endStick = function (e) { for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === sid) { sid = null; rest(); } };
      zone.addEventListener("touchend", endStick); zone.addEventListener("touchcancel", endStick);
      // ratón (pruebas en escritorio)
      zone.addEventListener("mousedown", function (e) {
        start({ identifier: "m", clientX: e.clientX, clientY: e.clientY });
        var mm = function (ev) { if (sid === "m") move(ev.clientX, ev.clientY); };
        var mu = function () { sid = null; rest(); window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
        window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
      });

      // ---------- botones: un dedo = un botón a la vez; al deslizar cambia de botón ----------
      var fingers = {};                                       // id del toque -> botón que tiene pulsado
      function at(x, y) {
        var hit = document.elementFromPoint(x, y);
        while (hit && hit !== pad) { if (hit.classList && hit.classList.contains("pg-btn")) return hit; hit = hit.parentNode; }
        return null;
      }
      function track(id, b) {
        var prev = fingers[id] || null; if (prev === b) return;
        if (prev) release(prev, controller);
        if (b) press(b, controller); fingers[id] = b;
        if (!b) delete fingers[id];
      }
      pad.addEventListener("touchstart", function (e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; track(t.identifier, at(t.clientX, t.clientY)); } }, { passive: false });
      pad.addEventListener("touchmove", function (e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; track(t.identifier, at(t.clientX, t.clientY)); } }, { passive: false });
      var endBtn = function (e) { for (var i = 0; i < e.changedTouches.length; i++) track(e.changedTouches[i].identifier, null); };
      pad.addEventListener("touchend", endBtn, { passive: false }); pad.addEventListener("touchcancel", endBtn);
      btns.forEach(function (b) {
        b.addEventListener("mousedown", function (e) { e.preventDefault(); track("m" + b.dataset.act, b); });
        var up = function () { track("m" + b.dataset.act, null); };
        b.addEventListener("mouseup", up); b.addEventListener("mouseleave", up);
      });

      // ---------- espacio ocupado (para despejar la arena) ----------
      // ancho que ocupan joystick (en reposo) y botones, medido dentro del contenedor (pantalla, o la vista previa)
      function insets() {
        var rr = root.getBoundingClientRect(), pr = pad.getBoundingClientRect();
        var stickW = (R * 2) + 18 + 10, btnW = lefty ? pr.right - rr.left + 6 : rr.right - pr.left + 6;
        var out = { l: Math.round(lefty ? btnW : stickW), r: Math.round(lefty ? stickW : btnW) };
        if (!preview) { PGTouch.last = out; window.dispatchEvent(new CustomEvent("pgtouch:insets", { detail: out })); }
        return out;
      }
      R = radius(); rest();
      if (!preview) {
        var relayout = function () { requestAnimationFrame(function () { requestAnimationFrame(function () { if (sid === null) rest(); insets(); }); }); };
        window.addEventListener("resize", relayout); window.addEventListener("orientationchange", relayout);
        PGTouch._winOff = function () { window.removeEventListener("resize", relayout); window.removeEventListener("orientationchange", relayout); };
        relayout();
      }
      return { insets: insets };
    },
    insets: function () { return PGTouch.last || { l: 0, r: 0 }; }
  };

  // sector 0..7 (0 = derecha, 2 = arriba, 4 = izquierda, 6 = abajo) -> teclas mantenidas
  function setDir(controller, s) {
    var h = controller.held;
    var r = s === 7 || s === 0 || s === 1, u = s === 1 || s === 2 || s === 3, l = s === 3 || s === 4 || s === 5, d = s === 5 || s === 6 || s === 7;
    if (s < 0) r = u = l = d = false;
    if (u && !h.up) controller._pressed.up = true;           // flanco para el salto
    h.left = l; h.right = r; h.up = u; h.down = d;
  }
  function actsOf(b) { var a = b.dataset.act; return COMBO[a] || [a]; }
  function press(b, controller) {
    if (global.PGAudio && global.PGAudio.haptic) global.PGAudio.haptic("button");
    var n = controller._touchN || (controller._touchN = {}), acts = actsOf(b);
    for (var i = 0; i < acts.length; i++) { var a = acts[i]; controller._pressed[a] = true; controller.held[a] = true; n[a] = (n[a] || 0) + 1; }
    b.classList.add("on");
  }
  // la acción queda mantenida mientras CUALQUIER botón que la incluye siga pulsado (soltar ROD no suelta P si P sigue abajo)
  function release(b, controller) {
    var n = controller._touchN || {}, acts = actsOf(b);
    for (var i = 0; i < acts.length; i++) { var a = acts[i]; n[a] = Math.max(0, (n[a] || 0) - 1); if (!n[a]) controller.held[a] = false; }
    b.classList.remove("on");
  }

  global.PGTouch = PGTouch;
})(window);
