/* pg_cinematics.js — cámara + cinemática de SÚPER/DM (acercamiento, luces, flash).
   Determinista: solo deriva match.camera {x,y,zoom,dim,flash} desde el estado; el
   render lo aplica. No toca hitboxes ni el resultado del combate. Modular (archivo aparte). */
(function (global) {
  "use strict";
  var PGCinematics = {
    // Dispara el acercamiento cinemático sobre el ejecutante (súper/DM/agarre de comando)
    trigger: function (match, actor, cine) {
      cine = cine || {};
      var C = (match.cfg && match.cfg.cinematic) || {};
      match.superFreeze = (cine.freeze != null ? cine.freeze : (C.freeze != null ? C.freeze : 46));
      match.cinematic = {
        kind: cine.kind || "super", actor: actor.side, t: 0,
        dur: (cine.dur != null ? cine.dur : (C.dur != null ? C.dur : 74)),
        zoom: (cine.zoom != null ? cine.zoom : (C.zoom != null ? C.zoom : 1.85)),
        dim: (cine.dim != null ? cine.dim : (C.dim != null ? C.dim : 0.58))      // antes 0.58 fijo en el código: config.cinematic.dim no se usaba
      };
      match.camera.flash = 1;
    },
    // CÁMARA DE SEGUIMIENTO: encuadre "base" que sigue el punto medio de los dos luchadores y se acerca cuando están cerca.
    // Todo sale de config.camera (valores de DISEÑO); sin esa sección el encuadre base es el fijo de siempre.
    // El piso queda anclado abajo del cuadro y el centro se limita para que la vista NUNCA salga de la arena.
    follow: function (match) {
      var cam = match.camera, A = match.cfg.arena, K = match.cfg.camera, f = cam.f;
      if (!f) f = cam.f = { x: cam.x, y: cam.y, zoom: cam.zoom };       // estados guardados antes de esta sección
      var bz = 1, bx = A.W / 2;
      if (K && K.follow) {
        var a = match.fighters[0], b = match.fighters[1], t = (K.far - Math.abs(a.x - b.x)) / (K.far - K.near);
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        bz = 1 + (K.maxZoom - 1) * t; bx = (a.x + b.x) / 2;
      }
      var e = (K && K.follow && K.ease) || 0.15;
      f.zoom += (bz - f.zoom) * e; f.x += (bx - f.x) * e;
      var half = A.W / (2 * f.zoom);                                     // la mitad del ancho visible, en px de arena
      f.x = f.x < half ? half : (f.x > A.W - half ? A.W - half : f.x);
      f.y = A.H - A.H / (2 * f.zoom);                                    // borde inferior del cuadro = borde inferior de la arena
      return f;
    },
    // Avanza cada paso (también durante el congelamiento). Suaviza la cámara.
    update: function (match) {
      var cam = match.camera, A = match.cfg.arena, C = match.cfg.cinematic || {};
      // ritmo de la cámara (config.cinematic; los respaldos son los valores que antes estaban fijos en el código)
      var inT = C.inFrames || 12, outT = C.outFrames || 18, focus = C.focusAbove != null ? C.focusAbove : 150,
          dimDecay = C.dimDecay || 0.8, flashDecay = C.flashDecay || 0.82;
      var c = match.cinematic, base = this.follow(match);
      cam.flash *= flashDecay; if (cam.flash < 0.02) cam.flash = 0;
      if (c) {
        c.t++;
        var act = match.fighters[c.actor];
        var tx = act.x, ty = A.ground - focus;
        var outStart = c.dur - outT, k;
        if (c.t < inT) k = c.t / inT;
        else if (c.t > outStart) k = Math.max(0, (c.dur - c.t) / outT);
        else k = 1;
        cam.zoom = base.zoom + (c.zoom - base.zoom) * k;
        cam.x = base.x + (tx - base.x) * k;
        cam.y = base.y + (ty - base.y) * k;
        cam.dim = (c.dim != null ? c.dim : 0.58) * k;
        if (c.t >= c.dur) match.cinematic = null;
      } else {
        cam.zoom = base.zoom; cam.x = base.x; cam.y = base.y;
        cam.dim *= dimDecay; if (cam.dim < 0.02) cam.dim = 0;
      }
    },
    // ronda nueva: cámara al encuadre normal (antes un súper que daba el K.O. dejaba el acercamiento/oscurecido congelado)
    reset: function (match) {
      var cam = match.camera, A = match.cfg.arena;
      match.cinematic = null; cam.x = A.W / 2; cam.y = A.H / 2; cam.zoom = 1; cam.dim = 0; cam.flash = 0; cam.f = { x: A.W / 2, y: A.H / 2, zoom: 1 };
    }
  };
  global.PGCinematics = PGCinematics;
})(window);
