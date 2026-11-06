/* pg_touch.js — control táctil PRO: joystick analógico (8 direcciones) + botones
   organizados + escalado responsivo. Alimenta un PGInput.Controller (held/_pressed),
   así el parser de comandos (QCF/DP/HCF) funciona igual con el pulgar. Modular. */
(function (global) {
  "use strict";

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  var PGTouch = {
    mount: function (root, controller, opts) {
      opts = opts || {};
      root.classList.add("pgtouch");
      root.innerHTML = "";
      controller._touchN = {};   // conteo de botones táctiles mantenidos por acción (ver bindButton)

      var S = global.PGStore;

      // ---- JOYSTICK ----
      var stick = el("div", "pg-stick");
      var base = el("div", "pg-stick-base");
      var knob = el("div", "pg-stick-knob");
      base.appendChild(knob); stick.appendChild(base); root.appendChild(stick);

      // ---- BOTONES (cluster ergonómico) ----
      var pad = el("div", "pg-btns");
      var layoutType = (S && typeof S.get === "function") ? S.get("touchLayout") : "classic";
      var defs;
      if (opts.buttons) {
        defs = opts.buttons;
      } else if (layoutType === "arcade") {
        // MAX (Puño+Especial) y ROD (rodada = Puño+Patada): acciones de dos botones en un solo toque (proyecto Android)
        defs = [
          { act: "punch",   label: "A",   cls: "b-p" },
          { act: "special", label: "C",   cls: "b-sp" },
          { act: "max",     label: "MAX", cls: "b-max" },
          { act: "kick",    label: "B",   cls: "b-k" },
          { act: "super",   label: "D",   cls: "b-su" },
          { act: "roll",    label: "ROD", cls: "b-roll" },
          { act: "block",   label: "GRD", cls: "b-gd" }
        ];
      } else {
        defs = [
          { act: "punch",   label: "P",   cls: "b-p" },
          { act: "special", label: "SP",  cls: "b-sp" },
          { act: "max",     label: "MAX", cls: "b-max" },
          { act: "kick",    label: "K",   cls: "b-k" },
          { act: "super",   label: "SÚP", cls: "b-su" },
          { act: "roll",    label: "ROD", cls: "b-roll" },
          { act: "block",   label: "GRD", cls: "b-gd" }
        ];
      }
      defs.forEach(function (d) {
        var b = el("button", "pg-btn " + d.cls, d.label); b.dataset.act = d.act;
        bindButton(b, d.act, controller); pad.appendChild(b);
      });
      root.appendChild(pad);

      // ---- lógica del joystick (analógico -> 8 direcciones) ----
      var active = false, pid = null, cx = 0, cy = 0, R = 60;
      var deadSetting = (S && typeof S.get === "function") ? S.get("touchDeadZone") : 0.30;
      var DEAD = (typeof deadSetting === "number") ? deadSetting : 0.30;
      var TH = 0.38;
      function geom() { var r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2; }
      function reset() { knob.style.transform = "translate(-50%,-50%)"; setDir(controller, { l:false, r:false, u:false, d:false }); }
      function move(px, py) {
        var dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy), mag = len / R;
        var kx = dx, ky = dy; if (mag > 1) { kx = dx / mag; ky = dy / mag; }
        knob.style.transform = "translate(calc(-50% + " + kx + "px), calc(-50% + " + ky + "px))";
        var dir = { l:false, r:false, u:false, d:false };
        if (mag >= DEAD) {
          var ang = Math.atan2(-dy, dx); // y hacia arriba positivo
          dir.r = Math.cos(ang) >  TH; dir.l = Math.cos(ang) < -TH;
          dir.u = Math.sin(ang) >  TH; dir.d = Math.sin(ang) < -TH;
        }
        setDir(controller, dir);
      }
      stick.addEventListener("touchstart", function (e) { e.preventDefault(); geom(); active = true; pid = e.changedTouches[0].identifier; var t = e.changedTouches[0]; move(t.clientX, t.clientY); }, { passive:false });
      stick.addEventListener("touchmove", function (e) { if (!active) return; e.preventDefault(); for (var i=0;i<e.changedTouches.length;i++){ var t=e.changedTouches[i]; if(t.identifier===pid){ move(t.clientX,t.clientY); } } }, { passive:false });
      var end = function (e) { for (var i=0;i<e.changedTouches.length;i++){ if(e.changedTouches[i].identifier===pid){ active=false; pid=null; reset(); } } };
      stick.addEventListener("touchend", end); stick.addEventListener("touchcancel", end);
      // soporte ratón (pruebas en escritorio)
      stick.addEventListener("mousedown", function (e){ geom(); active=true; move(e.clientX,e.clientY);
        var mm=function(ev){ if(active) move(ev.clientX,ev.clientY); };
        var mu=function(){ active=false; reset(); window.removeEventListener("mousemove",mm); window.removeEventListener("mouseup",mu); };
        window.addEventListener("mousemove",mm); window.addEventListener("mouseup",mu); });

      // un solo par de oyentes de ventana: cada combate vuelve a montar el pad (antes se acumulaban uno más por combate)
      if (PGTouch._winOff) PGTouch._winOff();
      var onRot = function(){ requestAnimationFrame(function(){ requestAnimationFrame(geom); }); };   // tras girar, el layout se asienta en el cuadro siguiente
      window.addEventListener("resize", geom);
      window.addEventListener("orientationchange", onRot);
      PGTouch._winOff = function(){ window.removeEventListener("resize", geom); window.removeEventListener("orientationchange", onRot); };
      geom(); reset();
      return this;
    }
  };

  function setDir(controller, dir) {
    var h = controller.held;
    if (dir.u && !h.up) controller._pressed.up = true;     // flanco para salto
    h.left = dir.l; h.right = dir.r; h.up = dir.u; h.down = dir.d;
  }
  function bindButton(b, act, controller) {
    // un botón puede pulsar varias acciones a la vez (MAX = Puño+Especial, ROD = Puño+Patada): llegan en el mismo cuadro,
    // dentro de la ventana de simultaneidad del simulador (config.timing.simulWindow)
    var acts = act === "roll" ? ["punch", "kick"] : act === "max" ? ["punch", "special"] : [act];
    var isDown = false;
    var down = function (ev) {
      ev.preventDefault();
      // vibración nativa del APK (PGAudio.haptic respeta la opción "Vibración"; en el navegador no hace nada)
      if (global.PGAudio && global.PGAudio.haptic) global.PGAudio.haptic("button");
      var n = controller._touchN || (controller._touchN = {});
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        controller._pressed[a] = true;   // cada toque es una pulsación nueva (el táctil no se auto-repite como el teclado)
        controller.held[a] = true;
        if (!isDown) n[a] = (n[a] || 0) + 1;
      }
      isDown = true; b.classList.add("on");
    };
    // la acción queda "mantenida" mientras CUALQUIER botón que la incluye siga pulsado: soltar ROD no suelta P si P sigue abajo
    var up = function (ev) {
      if (ev) ev.preventDefault();
      if (!isDown) return;               // mouseleave sin haber pulsado
      isDown = false;
      var n = controller._touchN || {};
      for (var i = 0; i < acts.length; i++) { var a = acts[i]; n[a] = Math.max(0, (n[a] || 0) - 1); if (!n[a]) controller.held[a] = false; }
      b.classList.remove("on");
    };
    b.addEventListener("touchstart", down, { passive:false });
    b.addEventListener("touchend", up, { passive:false }); b.addEventListener("touchcancel", up);
    b.addEventListener("mousedown", down); b.addEventListener("mouseup", up); b.addEventListener("mouseleave", up);
  }

  global.PGTouch = PGTouch;
})(window);
