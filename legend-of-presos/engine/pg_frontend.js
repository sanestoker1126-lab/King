/* pg_frontend.js — interfaz completa (DOM sobre el canvas PIXI), estética "terminal de seguridad del penal".
   Escenas: inicio (pulsa para empezar) → menú → selección (fichas de filiación con vista previa animada)
   → VS (precarga real del combate) → pausa → resultados (estadísticas reales) → opciones (pestañas,
   reasignación de teclas) → comandos → torneo (preparación, escalera, campeón, eliminado).
   NO toca la simulación: emite acciones al orquestador (pg_game.js) por opts.emit / opts.preload.
   Animación: un único bucle requestAnimationFrame mientras la interfaz está visible (nada de setInterval).
   API pública conservada: title, select, vs, pause, results, options, commands, tournamentSetup,
   tournamentLadder, tournamentChampion, tournamentGameOver, navFocus, actFocus, back, isVisible, hide. */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------- datos de presentación
  var DIFF = ["Fácil", "Normal", "Difícil"];
  // escenarios: data/stages.json (los mismos que dibuja engine/pg_stage.js). Se fijan al construir PGFrontend.
  var STAGES = [];
  // arte del fondo de los menús = el primer escenario con imagen (el Reclusorio). Se carga una vez y se comparte.
  var MENU_ART = { img: null, def: null };
  var MOTION = { qcf: "↓↘→", qcb: "↓↙←", dp: "→↓↘", hcf: "←↙↓↘→", hcb: "→↘↓↙←", qcf2: "↓↘→↓↘→" };
  var BTN = { punch: "P", kick: "K", special: "SP", super: "SÚ" };
  var ACTIONS = [["left", "Izquierda"], ["right", "Derecha"], ["up", "Saltar"], ["down", "Agacharse"],
                 ["punch", "Puño"], ["kick", "Patada"], ["special", "Especial"], ["super", "Súper"], ["block", "Guardia"]];
  var MODES = {
    arcade:   { t: "Arcade", m: "Campaña", d: "", facts: [["Jugadores", "1 contra la CPU"], ["Ruta", ""]] },   // textos con el número de combates: arcadeText()
    team:     { t: "Equipos", m: "3 contra 3", d: "Arma un equipo de tres. Cuando uno cae entra el siguiente y el que gana conserva su vida. Gana quien deje al otro sin luchadores.", facts: [["Equipo", "3 luchadores"], ["Rival", "CPU o jugador 2"]] },
    torneo:   { t: "Torneo", m: "3, 5 o 7 rivales", d: "Encadena combates contra rivales al azar que se vuelven más difíciles. Si pierdes uno, puedes reintentarlo.", facts: [["Jugadores", "1 contra la CPU"], ["Rivales", "3, 5 o 7"]] },
    versus:   { t: "Versus", m: "2 jugadores", d: "Dos jugadores en el mismo dispositivo, con teclado o con dos mandos.", facts: [["Jugadores", "2 locales"], ["Teclas", "P1 WASD · P2 flechas"]] },
    training: { t: "Entrenamiento", m: "ventaja al frame", d: "Practica contra un maniquí que no cae K.O.; arriba ves la ventaja al frame de cada intercambio. El maniquí se ajusta en la pausa.", facts: [["Jugadores", "1 contra maniquí"], ["Tiempo", "sin límite"], ["Medición", "ventaja al frame"]] },
    bt:       { t: "Reto Bluetooth", m: "2 teléfonos", d: "Pelea contra un amigo, cada quien en su teléfono, conectados por Bluetooth. Uno crea la sala y el otro la busca.", facts: [] },
    options:  { t: "Opciones", m: "audio · partida · teclas", d: "Audio, reglas de la partida, pantalla y teclas.", facts: [["Se guarda", "en este dispositivo"]] }
  };

  function el(tag, cls, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function key(label){ return '<span class="pg-key">' + esc(label) + '</span>'; }
  var REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var TOUCH = !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);

  // ---------------------------------------------------------------- caché de datos e imágenes
  var defCache = {}, imgCache = {}, mugCache = {};
  function loadDef(ch){ return defCache[ch.id] || (defCache[ch.id] = fetch(ch.dir + ch.char, { cache: "no-store" }).then(function(r){
    if (!r.ok) throw new Error("No se encontró " + ch.dir + ch.char + " (" + r.status + ")"); return r.json(); })); }
  function loadImg(url){ return imgCache[url] || (imgCache[url] = new Promise(function(res, rej){
    var im = new Image(); im.onload = function(){ res(im); }; im.onerror = function(){ rej(new Error("No se pudo cargar " + url)); }; im.src = url; })); }
  // recorte de filiación (cabeza-hombros) precalculado en datos por tools/build_portraits.py
  function mugURL(ch){
    return mugCache[ch.id] || (mugCache[ch.id] = loadDef(ch).then(function(def){
      var pr = def.portrait; if (!pr) throw new Error(ch.id + ": falta portrait en su char.json (correr tools/build_portraits.py)");
      return loadImg(ch.dir + def.atlases[pr.atlas].file).then(function(img){
        var S = 112, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
        var g = cv.getContext("2d"); g.imageSmoothingQuality = "high";
        var r = pr.head; g.drawImage(img, r[0], r[1], r[2], r[3], 0, 0, S, S);
        return cv.toDataURL("image/png");
      });
    }));
  }
  // HOJA DE FICHAS (assets/ui/fichas.webp, tools/build_fichas.py): un solo archivo pequeño con el busto de cada luchador.
  // Antes cada carta descargaba el atlas COMPLETO de su personaje (21.6 MB entre los 33) para recortar la cara.
  var FICHAS = null;
  function fichas(){ return FICHAS || (FICHAS = fetch("assets/ui/fichas.json").then(function(r){ if (!r.ok) throw new Error("fichas.json " + r.status); return r.json(); })
    .catch(function(e){ console.warn("Hoja de fichas no disponible (" + e.message + "): se recorta del atlas."); return null; })); }
  // encaja la celda del busto en el elemento SIN deformarla (como background-size: cover de una sola celda), sea la
  // carta 3:4 o un círculo pequeño; se recalcula si el elemento cambia de tamaño
  function fitFicha(node){
    var f = node._ficha; if (!f) return; var F = f.F, W = node.clientWidth, H = node.clientHeight; if (!W || !H) return;
    var k = Math.max(W / F.cell[0], H / F.cell[1]), cw = F.cell[0] * k, chh = F.cell[1] * k;
    node.style.backgroundSize = Math.round(F.cols * cw) + "px " + Math.round(F.rows * chh) + "px";
    node.style.backgroundPosition = Math.round(-f.c * cw + (W - cw) / 2) + "px " + Math.round(-f.r * chh) + "px";   // centrado y desde ARRIBA: la cabeza siempre se ve
  }
  var RO = null;
  function fichaRO(){ return RO || (RO = global.ResizeObserver ? new global.ResizeObserver(function(es){ es.forEach(function(e){ fitFicha(e.target); }); }) : { observe: function(){} }); }
  function setMug(node, ch){
    fichas().then(function(F){
      var i = F && F.index ? F.index[ch.id] : undefined;
      if (i != null){ node._ficha = { F: F, c: i % F.cols, r: Math.floor(i / F.cols) };
        node.style.backgroundImage = "url(" + F.file + ")"; node.classList.add("pg-ficha"); fitFicha(node); fichaRO().observe(node); return; }
      return mugURL(ch).then(function(u){ node.style.backgroundImage = "url(" + u + ")"; });
    }).catch(function(e){ node.classList.add("pg-err"); node.title = e.message; console.error(e.message); });
  }
  // CARRUSEL: desplazamiento nativo con imán (scroll-snap) y solo dos clases que cambian (pg-center / pg-near) en la
  // carta del centro y sus vecinas. Antes se reescribían 4 variables de estilo en las 33 cartas en CADA cuadro de
  // desplazamiento (recalcular estilos de toda la fila), lo que en teléfonos se sentía trabado.
  function enableRosterRail(cells, onCenter){
    var raf = 0, observer = null, lastCenter = null, cur = -1, settle = 0;
    var header = cells.previousElementSibling, hint = header && header.querySelector("small");
    if (hint) hint.textContent = "DESLIZA · TOCA PARA ELEGIR";
    function paint(){
      raf = 0;
      var cards = cells.querySelectorAll(".pg-card"); if (!cards.length) return;
      var c0 = cards[0], stride = cards.length > 1 ? (cards[1].offsetLeft - c0.offsetLeft) : c0.offsetWidth; stride = Math.max(1, stride);
      var mid = cells.scrollLeft + cells.clientWidth / 2;
      var k = Math.max(0, Math.min(cards.length - 1, Math.round((mid - c0.offsetLeft - c0.offsetWidth / 2) / stride)));
      if (k !== cur || !cards[k].classList.contains("pg-center")){   // (también si las cartas se rehicieron y perdieron la marca)
        var old = cells.querySelectorAll(".pg-center,.pg-near");
        for (var o = 0; o < old.length; o++){ old[o].classList.remove("pg-center"); old[o].classList.remove("pg-near"); }
        cards[k].classList.add("pg-center");
        if (cards[k - 1]) cards[k - 1].classList.add("pg-near"); if (cards[k + 1]) cards[k + 1].classList.add("pg-near");
        cur = k;
      }
      // el expediente grande se actualiza cuando el carrusel SE DETIENE (110 ms sin cambiar de carta), no por cada carta que
      // pasa bajo el dedo: rehacerlo (vista previa + lista de golpes) en pleno deslizamiento era lo que trababa los cuadros
      var nearest = cards[k];
      if (onCenter && nearest && nearest.dataset.id !== "?" && nearest.dataset.id !== lastCenter){
        if (settle) clearTimeout(settle);
        settle = setTimeout(function(){ settle = 0; var id = nearest.dataset.id; if (id !== lastCenter){ lastCenter = id; onCenter(id); } }, lastCenter === null ? 0 : 110); }
    }
    function schedule(){ if (!raf) raf = global.requestAnimationFrame(paint); }
    cells.addEventListener("wheel", function(e){
      if (cells.scrollWidth <= cells.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault(); cells.scrollLeft += e.deltaY;
    }, { passive: false });
    cells.addEventListener("scroll", schedule, { passive: true });
    if (global.ResizeObserver){ observer = new global.ResizeObserver(schedule); observer.observe(cells); }
    else global.addEventListener("resize", schedule);
    cells._pgRailPaint = schedule;   // centerRosterCard lo llama: si el desplazamiento no cambia no hay evento "scroll" y no se pintaba el centro
    cells._pgRailCleanup = function(){
      if (observer) observer.disconnect(); else global.removeEventListener("resize", schedule);
      if (raf) global.cancelAnimationFrame(raf); raf = 0; if (settle) clearTimeout(settle); settle = 0;
    };
    schedule();
  }
  function centerRosterCard(cells, id, smooth){
    var cards = cells.querySelectorAll(".pg-card"), card = null;
    for (var i = 0; i < cards.length; i++){ if (!id || cards[i].dataset.id === id){ card = cards[i]; break; } }
    if (!card) return;
    var left = card.offsetLeft - (cells.clientWidth - card.offsetWidth) / 2;
    left = Math.max(0, Math.min(left, cells.scrollWidth - cells.clientWidth));
    if (smooth && !REDUCED) cells.scrollTo({ left: left, behavior: "smooth" }); else cells.scrollLeft = left;
    if (cells._pgRailPaint) cells._pgRailPaint();
  }
  function disposeRosterRails(root){
    var rails = root.querySelectorAll(".pg-cells");
    for (var i = 0; i < rails.length; i++){ if (rails[i]._pgRailCleanup) rails[i]._pgRailCleanup(); }
  }
  // microfundido de la ficha al cambiar de luchador: la vista previa y el expediente entran con un fundido corto en vez
  // de un corte seco (se siente más fluido al deslizar el carrusel). Se reinicia la animación re-agregando la clase.
  function pgFileSwap(fileEl){ if (!fileEl || REDUCED) return; fileEl.classList.remove("pg-swap"); void fileEl.offsetWidth; fileEl.classList.add("pg-swap"); }
  // etiqueta de la cinta de la carta: la del roster (badge), PROVISIONAL (datos sin verificar jugando), SECRETO (oculto
  // desbloqueado) o la cinta decorativa de siempre
  function cardBadge(ch){ return ch.badge || (ch.provisional ? "PROVISIONAL" : ch.hidden ? "SECRETO" : null); }
  // rasgos REALES del personaje (de sus datos de combate), para la carta y el expediente
  function traitsOf(def){
    var mv = Object.keys(def.moves).map(function(k){ return def.moves[k]; }), t = [];
    if (mv.some(function(m){ return m.spawns; })) t.push(["proj", "Arrojadizo"]);
    if (mv.some(function(m){ return m.invuln && m.launcher && !m.super; })) t.push(["anti", "Antiaéreo"]);
    if (mv.some(function(m){ return m.type === "command_grab"; })) t.push(["grab", "Llave de comando"]);
    if (mv.some(function(m){ return m.special && m.guardType === "low"; })) t.push(["low", "Golpe bajo"]);
    if ((def.inputs.hidden || []).length) t.push(["hid", "Súper oculto en MAX"]);
    return t;
  }
  var TRAIT_ICON = {
    proj: '<circle cx="15" cy="12" r="5"/><path d="M3 9h6M2 12h7M3 15h6"/>',
    anti: '<path d="M12 21V7M7 11l5-5 5 5M5 21h14"/>',
    grab: '<path d="M7 11V6a2 2 0 0 1 4 0v5M11 10V5a2 2 0 0 1 4 0v6M15 10a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-2a2 2 0 0 1 4 0"/>',
    low:  '<path d="M3 20h18M6 16l5-5 3 3 5-5"/>',
    hid:  '<path d="M12 2l2.6 6.4L21 9l-5 4.3L17.5 20 12 16.6 6.5 20 8 13.3 3 9l6.4-.6z"/>'
  };
  function traitIcon(k){ return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (TRAIT_ICON[k] || "") + '</svg>'; }
  // CARTA = FICHA DE INGRESO del penal: regla de estatura de fondo (como una foto de filiación), busto del luchador,
  // cabecera del CEFERESO y placa negra con nombre, alias y número de reo. Sello solo si el roster lo marca
  // (provisional / secreto). Abajo, iconos de rasgos reales leídos de sus datos.
  function makeFighterCard(node, ch){
    var pf = ch.perfil || {}, badge = cardBadge(ch);
    node.classList.add("pg-card");
    node.setAttribute("aria-label", ch.name + (pf.alias ? ", " + pf.alias : "") + (pf.reo ? ", reo " + pf.reo : "") + (badge ? ", " + badge.toLowerCase() : ""));
    node.innerHTML = '<span class="pg-card-ruler" aria-hidden="true"></span><span class="pg-card-face" aria-hidden="true"></span>' +
      '<span class="pg-card-top" aria-hidden="true"><i>CEFERESO</i><em>' + (pf.reo ? "N.º " + esc(pf.reo) : "S/N") + '</em></span>' +
      (badge ? '<span class="pg-card-stamp ' + (ch.provisional ? "pg-prov" : "pg-secret") + '">' + esc(badge) + '</span>' : '') +
      '<span class="pg-card-plate"><b class="pg-card-name">' + esc(ch.name) + '</b>' +
      '<small class="pg-card-alias">' + esc(pf.alias || "sin alias") + '</small>' +
      '<span class="pg-card-traits" aria-hidden="true"></span></span>';
    setMug(node.querySelector(".pg-card-face"), ch);
    loadDef(ch).then(function(def){
      var tr = node.querySelector(".pg-card-traits"); if (!tr) return;
      tr.innerHTML = traitsOf(def).map(function(t){ return '<i title="' + t[1] + '">' + traitIcon(t[0]) + '</i>'; }).join("");
    }).catch(function(e){ console.error("Datos de carta " + ch.id + ": " + e.message); });
  }
  // rects de los frames de un clip (rejilla con celda propia por atlas o coordsFile)
  // Nombre visible de un movimiento. Si el char.json no trae `name` (8 personajes hoy: ver README, TODO VERIFICAR),
  // NO se inventa un nombre: ids genéricos del motor -> etiqueta de TIPO; ids en español -> el id legible.
  var GENERIC_MOVE = { fireball: "Proyectil", super: "Súper", tackle: "Embestida", dm_oculto: "Súper oculto" };
  function moveLabel(id, mv){
    if (mv && mv.name) return mv.name;
    var ex = /_ex$/.test(id), base = ex ? id.slice(0, -3) : id;
    var t = GENERIC_MOVE[base] || base.replace(/_/g, " ").replace(/^./, function(c){ return c.toUpperCase(); });
    return ex ? t + " EX" : t;
  }
  function clipFrames(ch, def, clipName){
    var clip = def.clips[clipName] || def.clips.idle, a = def.atlases[clip.atlas];
    var cw = (a.cell && a.cell.w) || def.frameSize.w, chh = (a.cell && a.cell.h) || def.frameSize.h;
    var anchor = a.anchor || def.anchor || { x: 0.5, y: 1 };
    var rectsP = a.coordsFile ? fetch(ch.dir + a.coordsFile, { cache: "no-store" }).then(function(r){ return r.json(); }).then(function(cj){
      var m = {}; (cj.frames || []).forEach(function(f){ m[f.frame] = [f.x, f.y, f.width != null ? f.width : f.x2 - f.x, f.height != null ? f.height : f.y2 - f.y]; }); return m; }) : Promise.resolve(null);
    return Promise.all([loadImg(ch.dir + a.file), rectsP]).then(function(res){
      var img = res[0], rects = res[1];
      return { img: img, fps: clip.fps || 8, loop: clip.loop !== false, anchor: anchor,
        rects: clip.frames.map(function(fr){ return (rects && rects[fr]) || [(fr % a.columns) * cw, Math.floor(fr / a.columns) * chh, cw, chh]; }) };
    });
  }

  // ---------------------------------------------------------------- bucle único de animación de la interfaz
  var Loop = { fns: [], id: 0,
    add: function(fn){ this.fns.push(fn); if (!this.id) this.id = requestAnimationFrame(Loop.tick); },
    clear: function(){ this.fns.length = 0; if (this.id){ cancelAnimationFrame(this.id); this.id = 0; } },
    // se re-agenda ANTES de llamar a las escenas: si una lanza un error (que sí sale en consola), el bucle de la
    // interfaz no muere con ella (antes un fallo de vista previa congelaba la pantalla VS y nunca empezaba el combate)
    tick: function(t){ Loop.id = Loop.fns.length ? requestAnimationFrame(Loop.tick) : 0; for (var i = 0; i < Loop.fns.length; i++) Loop.fns[i](t); } };
  // tamaño del lienzo: lo informa un ResizeObserver (antes getBoundingClientRect en CADA cuadro forzaba recalcular la
  // maquetación de la página entera mientras se deslizaba el carrusel)
  var CVRO = global.ResizeObserver ? new global.ResizeObserver(function(es){ es.forEach(function(e){ var r = e.contentRect; e.target._sz = { width: r.width, height: r.height }; }); }) : null;
  function fitCanvas(cv, maxDpr){
    if (CVRO && !cv._szObs){ cv._szObs = true; CVRO.observe(cv); }
    var r = (CVRO && cv._sz) || cv.getBoundingClientRect(), d = Math.min(global.devicePixelRatio || 1, maxDpr || 1.5);
    var w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; return true; } return false;
  }

  // ---------------------------------------------------------------- vista previa animada (idle real del atlas)
  function Preview(cv, opts){ this.cv = cv; this.g = cv.getContext("2d"); this.data = null; this.t0 = 0; this.token = 0; this.opts = opts || {}; this.flip = !!this.opts.flip; }
  Preview.prototype.set = function(ch){
    var self = this, tk = ++this.token;
    if (!ch){ this.data = null; return; }
    loadDef(ch).then(function(def){
      return clipFrames(ch, def, self.opts.clip || "idle").then(function(fr){
        if (tk !== self.token) return;
        fr.bodyH = (def.portrait && def.portrait.body && def.portrait.body[3]) || fr.rects[0][3];
        // caja de encuadre del clip REAL mostrado (datos: tools/build_preview_boxes.py); sin ella, solo el alto
        var cn = def.clips[self.opts.clip || "idle"] ? (self.opts.clip || "idle") : "idle";
        fr.box = (def.portrait && def.portrait.clipBox && def.portrait.clipBox[cn]) || null;
        self.data = fr; self.t0 = performance.now();
      });
    }).catch(function(e){ console.error(e.message); });
  };
  Preview.prototype.draw = function(t){
    var cv = this.cv, g = this.g; fitCanvas(cv, 1.5);
    g.clearRect(0, 0, cv.width, cv.height);
    var D = this.data; if (!D) return;
    // t (sello del rAF = inicio del cuadro) puede ser ANTERIOR a t0 (fijado en una promesa de ese mismo cuadro): sin
    // el max(0) el índice salía -1 -> rects[-1] undefined -> excepción en cada cuadro
    var n = D.rects.length, idx = REDUCED ? 0 : Math.max(0, Math.floor((t - this.t0) / 1000 * D.fps));
    idx = D.loop ? idx % n : Math.min(idx, n - 1);
    var r = D.rects[idx], B = D.box, s = (cv.height * (this.opts.fill || 0.84)) / (B ? B.t : D.bodyH);
    if (B) s = Math.min(s, (cv.width * 0.48) / Math.max(1, B.l, B.r));   // que quepa a lo ancho: nada recortado
    var w = r[2] * s, h = r[3] * s, fx = cv.width * 0.5, fy = cv.height * (this.opts.foot || 0.97);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.save(); g.translate(fx, fy); if (this.flip) g.scale(-1, 1);
    g.drawImage(D.img, r[0], r[1], r[2], r[3], -w * D.anchor.x, -h * D.anchor.y, w, h);
    g.restore();
  };

  // ---------------------------------------------------------------- fondo del inicio: muro del penal + reflector
  function Wall(cv){ this.cv = cv; this.g = cv.getContext("2d"); this.base = null; this.bw = 0; this.bh = 0; this.art = false; this.t0 = performance.now(); }
  // fondo con el ARTE del Reclusorio: cubre la pantalla alineado a la derecha (se ve la torre), se oscurece a la
  // izquierda (ahí va el menú) y el reflector sale de la luz MEDIDA de la torre (data/stages.json -> tower)
  Wall.prototype._paintArt = function(W, H){
    var img = MENU_ART.img, d = MENU_ART.def, iw = d.art.w, ih = d.art.h;
    var b = document.createElement("canvas"); b.width = W; b.height = H; var g = b.getContext("2d");
    var sc = Math.max(W / iw, H / ih), dw = iw * sc, dh = ih * sc, ox = Math.min(0, W - dw), oy = (H - dh) / 2;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(img, ox, oy, dw, dh);
    g.fillStyle = "rgba(6,9,14,.30)"; g.fillRect(0, 0, W, H);
    var lg = g.createLinearGradient(0, 0, W * 0.62, 0); lg.addColorStop(0, "rgba(6,9,14,.78)"); lg.addColorStop(1, "rgba(6,9,14,0)");
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    var vg = g.createRadialGradient(W * 0.6, H * 0.5, H * 0.25, W * 0.6, H * 0.5, W * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.5)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    var tw = d.tower || { x: iw * 0.92, y: ih * 0.13 };
    this.lamp = { x: ox + tw.x * sc, y: oy + tw.y * sc };
    this.base = b; this.bw = W; this.bh = H; this.art = true;
  };
  Wall.prototype._paintBase = function(W, H){
    if (MENU_ART.img) return this._paintArt(W, H);
    var b = document.createElement("canvas"); b.width = W; b.height = H; var g = b.getContext("2d");
    var horizon = H * 0.30, ground = H * 0.80;
    var sky = g.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, "#070b10"); sky.addColorStop(1, "#111a24");
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon);
    // muro de bloques de concreto (ruido determinista: misma imagen siempre)
    var seed = 20261015; function rnd(){ seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    var wall = g.createLinearGradient(0, horizon, 0, ground); wall.addColorStop(0, "#1b242e"); wall.addColorStop(1, "#151d26");
    g.fillStyle = wall; g.fillRect(0, horizon, W, ground - horizon);
    var bh = Math.max(18, Math.round(H * 0.045)), bw = bh * 2.6;
    for (var y = horizon, row = 0; y < ground; y += bh, row++){
      for (var x = (row % 2 ? -bw / 2 : 0); x < W; x += bw){
        var v = 22 + Math.floor(rnd() * 9); g.fillStyle = "rgb(" + v + "," + (v + 9) + "," + (v + 18) + ")"; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    g.fillStyle = "#0e141b"; g.fillRect(0, horizon - 6, W, 8);                         // remate del muro
    // alambre de púas en espiral
    g.strokeStyle = "rgba(150,158,168,.30)"; g.lineWidth = 1;
    for (var k = 0; k < W; k += 12){ g.beginPath(); g.ellipse(k, horizon - 14, 7, 6, 0, 0, Math.PI * 2); g.stroke(); }
    // torre de vigilancia
    var tx = W * 0.82, tt = horizon - H * 0.20;
    g.fillStyle = "#0b1016"; g.fillRect(tx - 4, tt, 8, horizon - tt); g.fillRect(tx - 26, tt - 22, 52, 22);
    g.beginPath(); g.moveTo(tx - 30, tt - 22); g.lineTo(tx, tt - 38); g.lineTo(tx + 30, tt - 22); g.fill();
    this.lamp = { x: tx, y: tt - 12 };
    // lámparas de sodio sobre el muro (halo pintado una vez; la luz no parpadea)
    for (var lx = W * 0.12; lx < W * 0.75; lx += W * 0.21){
      var ly = horizon + H * 0.07;
      var glow = g.createRadialGradient(lx, ly, 2, lx, ly + H * 0.12, H * 0.34);
      glow.addColorStop(0, "rgba(240,168,58,.30)"); glow.addColorStop(1, "rgba(240,168,58,0)");
      g.fillStyle = glow; g.fillRect(lx - H * 0.4, ly - H * 0.05, H * 0.8, H * 0.6);
      g.fillStyle = "#2a2f36"; g.fillRect(lx - 9, ly - 3, 18, 4); g.fillStyle = "#f0a83a"; g.fillRect(lx - 7, ly + 1, 14, 2);
    }
    // piso del patio
    var fl = g.createLinearGradient(0, ground, 0, H); fl.addColorStop(0, "#1a1f25"); fl.addColorStop(1, "#0c1015");
    g.fillStyle = fl; g.fillRect(0, ground, W, H - ground);
    g.fillStyle = "rgba(240,168,58,.10)"; g.fillRect(0, ground, W, 2);
    // viñeta
    var vg = g.createRadialGradient(W * 0.5, H * 0.55, H * 0.2, W * 0.5, H * 0.55, W * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    this.base = b; this.bw = W; this.bh = H;
  };
  Wall.prototype.draw = function(t){
    var cv = this.cv, g = this.g; fitCanvas(cv, 1.25);
    var W = cv.width, H = cv.height;
    if (this.bw !== W || this.bh !== H || (!this.art && MENU_ART.img)) this._paintBase(W, H);   // repinta al llegar el arte
    g.drawImage(this.base, 0, 0);
    // reflector de la torre: barrido lento (lo único que se mueve, como en la referencia)
    var period = 16000, ph = REDUCED ? 0.18 : ((Math.max(0, t - this.t0) % period) / period);
    var ang = Math.PI * (0.62 + 0.28 * Math.sin(ph * Math.PI * 2));
    var L = this.lamp, len = Math.hypot(W, H), spread = 0.085;
    g.save(); g.globalCompositeOperation = "lighter";
    var grd = g.createRadialGradient(L.x, L.y, 4, L.x, L.y, len * 0.9);
    grd.addColorStop(0, "rgba(255,236,190,.22)"); grd.addColorStop(0.5, "rgba(255,220,160,.07)"); grd.addColorStop(1, "rgba(255,220,160,0)");
    g.fillStyle = grd; g.beginPath(); g.moveTo(L.x, L.y);
    g.lineTo(L.x + Math.cos(ang - spread) * len, L.y + Math.sin(ang - spread) * len);
    g.lineTo(L.x + Math.cos(ang + spread) * len, L.y + Math.sin(ang + spread) * len); g.closePath(); g.fill();
    g.restore();
  };

  // ---------------------------------------------------------------- PGFrontend
  // número de combates del Arcade = data/campaigns.json (antes el texto decía "5" fijo y la campaña ya tenía 6)
  function arcadeText(campaigns){
    var c = campaigns && campaigns.arcade, n = c && c.solo && c.solo.length;
    if (!n){ console.warn("data/campaigns.json sin arcade.solo: el menú no sabe cuántos combates tiene el Arcade"); return; }
    MODES.arcade.m = "Campaña · " + n + " combates";
    MODES.arcade.d = "Avanza por una escalera de " + n + " combates, supera rivales cada vez más difíciles y enfrenta a Garravas como jefe final.";
    MODES.arcade.facts[1][1] = n + " combates";
  }
  function PGFrontend(root, opts){
    this.root = root; this.roster = opts.roster; this.store = opts.store;
    arcadeText(opts.campaigns);
    STAGES = (opts.stages || []).map(function(s){ return { n: s.name, c: s.swatch, id: s.id }; });
    var artDef = (opts.stages || []).find(function(s){ return s.art && s.art.file; });
    if (artDef && !MENU_ART.def){
      MENU_ART.def = artDef; var im = new Image();
      im.onload = function(){ MENU_ART.img = im; };
      im.onerror = function(){ console.warn("Fondo del menú no disponible (" + artDef.art.file + "): se usa el muro dibujado."); };
      im.src = artDef.art.file;
    }
    this.audio = opts.audio; this.emit = opts.emit || function(){}; this.preload = opts.preload || null;
    this.sel = { mode: "arcade", p1: null, p2: null, slot: 0, stage: this.store.get("stage") || 0, difficulty: this.store.get("difficulty") || 2 };
    if (!(this.sel.stage >= 0 && this.sel.stage < STAGES.length)) this.sel.stage = 0;   // índice guardado de una versión con otros escenarios
    this._started = false; this._capture = null; this._cineRAF = 0; this._narration = null;
    root.classList.add("pg-ui"); if (TOUCH) root.classList.add("pg-touch");
  }
  var P = PGFrontend.prototype;
  var FOCUS_SEL = ".pgb,.pg-mode,.pg-cell,.pg-tm,.pg-seg>button,.pg-tab,.pg-switch,.pg-kbtn,.pg-file,input[type=range]";

  P.show = function(over){ this.root.style.display = "block"; this.root.style.pointerEvents = "auto"; this.root.classList.toggle("pg-over", !!over); this._visible = true; };
  P.hide = function(){ Loop.clear(); disposeRosterRails(this.root); if (this._cineRAF) cancelAnimationFrame(this._cineRAF); this._cineRAF = 0; if (this._narration){ this._narration.pause(); this._narration.currentTime = 0; this._narration = null; } this.root.style.display = "none"; this.root.style.pointerEvents = "none"; this.root.innerHTML = ""; this._visible = false; this._foci = []; this._capture = null; };
  P.isVisible = function(){ return !!this._visible; };
  P.isCapturing = function(){ return !!this._capture; };
  P._sfx = function(n){ if (this.audio) this.audio.sfx(n); };
  // seleccionables: jugables que no estén ocultos (o que ya se desbloquearon en este dispositivo: PGStore.unlocked)
  P._playable = function(){ var st = this.store; return this.roster.characters.filter(function(c){
    return c.status === "playable" && (!c.hidden || (st && st.isUnlocked && st.isUnlocked(c.id))); }); };
  P._char = function(id){ return this.roster.characters.find(function(c){ return c.id === id; }) || null; };
  P._scene = null;
  // monta una escena: limpia, fondo opcional, cabecera, cuerpo y barra de ayudas
  P._mount = function(name, o){
    Loop.clear(); disposeRosterRails(this.root); this.root.innerHTML = ""; this.show(!!o.over); this._scene = name; this._onFocus = null;
    if (o.wall){ var cv = el("canvas", "pg-bg"); this.root.appendChild(cv); var w = new Wall(cv); Loop.add(function(t){ w.draw(t); }); }
    var scr = el("div", "pg-scene enter " + (o.cls || ""));
    if (o.title) scr.appendChild(el("header", "pg-head", '<h1 class="pg-h">' + esc(o.title) + '</h1><div class="pg-head-ctx">' + (o.ctx || "") + '</div>'));
    this.root.appendChild(scr); return scr;
  };
  P._hints = function(scr, items){
    var gp = global.PGGamepad && PGGamepad.connected && PGGamepad.connected() > 0;
    var map = gp ? { nav: "Cruceta", ok: "A", back: "B" } : { nav: "↑↓←→", ok: "Enter", back: "Esc" };
    var h = el("footer", "pg-hints");
    h.innerHTML = (items || ["nav", "ok", "back"]).map(function(it){
      if (it === "nav") return '<span class="pg-hint">' + key(map.nav) + ' Mover</span>';
      if (it === "ok") return '<span class="pg-hint">' + key(map.ok) + ' Elegir</span>';
      if (it === "back") return '<span class="pg-hint">' + key(map.back) + ' Volver</span>';
      return '<span class="pg-hint">' + it + '</span>';
    }).join("");
    scr.appendChild(h);
  };

  // ---- foco (teclado / mando / ratón) ----
  P._armFocus = function(preferSel){
    var self = this;
    this._foci = Array.prototype.slice.call(this.root.querySelectorAll(FOCUS_SEL)).filter(function(e){ return !e.disabled && e.offsetParent !== null; });
    this._fi = 0;
    if (preferSel){ var want = this.root.querySelector(preferSel); var k = this._foci.indexOf(want); if (k >= 0) this._fi = k; }
    this._foci.forEach(function(e, i){ e.addEventListener("mouseenter", function(){ if (self._fi !== i){ self._fi = i; self._paintFocus(true); } }); });
    this._paintFocus(false);
  };
  P._paintFocus = function(byMouse){
    if (!this._foci) return;
    for (var i = 0; i < this._foci.length; i++) this._foci[i].classList.remove("pg-focus");
    var e = this._foci[this._fi];
    if (e){ e.classList.add("pg-focus"); if (!byMouse && e.scrollIntoView) e.scrollIntoView({ block: "nearest", inline: "nearest" }); if (this._onFocus) this._onFocus(e); }
  };
  P.navFocus = function(dir){
    if (!this._foci || !this._foci.length) return;
    var cur = this._foci[this._fi]; if (!cur){ this._fi = 0; this._paintFocus(); return; }
    if (cur.tagName === "INPUT" && cur.type === "range" && (dir === "left" || dir === "right")){
      var step = (+cur.max - +cur.min) / 20 || 1; cur.value = +cur.value + (dir === "right" ? step : -step); cur.dispatchEvent(new Event("input")); return;
    }
    var cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, best = -1, bestD = 1e9;
    for (var i = 0; i < this._foci.length; i++){ if (i === this._fi) continue;
      var r = this._foci[i].getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
      var ok = dir === "right" ? dx > 8 : dir === "left" ? dx < -8 : dir === "down" ? dy > 8 : dy < -8; if (!ok) continue;
      var along = (dir === "left" || dir === "right") ? Math.abs(dx) : Math.abs(dy), perp = (dir === "left" || dir === "right") ? Math.abs(dy) : Math.abs(dx);
      var dd = along + perp * 2.2; if (dd < bestD){ bestD = dd; best = i; }
    }
    if (best >= 0){ this._fi = best; this._paintFocus(); this._sfx("ui"); }
  };
  P.actFocus = function(){ if (!this._foci) return; var e = this._foci[this._fi]; if (e && !(e.tagName === "INPUT" && e.type === "range")) e.click(); };
  P.back = function(){
    switch (this._scene){
      case "splash": break;
      case "cinematic": this._finishCinematic(true); break;
      case "story": if (this._storyGo) this._storyGo(); break;
      case "menu": this._splash(); break;
      case "select": case "teamSelect": case "tourSetup": this._sfx("cancel"); this.title(); break;
      case "commands": this._sfx("cancel"); (this._cmdBack || this.title.bind(this))(); break;
      case "options": this._sfx("cancel"); this.emit("optionsChanged"); (this._optBack || this.title.bind(this))(); break;
      case "pause": this._sfx("cancel"); this.hide(); this.emit("resume"); break;
      case "netpause": this._sfx("cancel"); this.hide(); break;
      case "netmenu": this._sfx("cancel"); if (global.PGNet) PGNet.close(); this.title(); break;
      case "netlobby": break;   // salir de la sala solo con el botón (corta la conexión)
      case "trainOpts": this._sfx("cancel"); this.pause(); break;
      case "results": case "tourChampion": case "campaignEnding": this._sfx("cancel"); this.title(); break;
      default: break;
    }
  };
  P._click = function(scope, sel, fn){ var e = scope.querySelector(sel); if (e) e.addEventListener("click", fn); return e; };

  // ======================================================== INICIO (pulsa para empezar)
  P._splash = function(){
    var self = this, scr = this._mount("splash", { wall: true, cls: "pg-title" });
    if (this.audio) this.audio.music("menu");
    scr.innerHTML += '<div class="pg-logo"><p class="pg-logo-a">LEGEND OF PRESOS · CAPÍTULO III</p><h1 class="pg-logo-b"><span>El escape de</span><span>Puente Grande</span></h1>' +
      '<div class="pg-press">' + (TOUCH ? 'Toca la pantalla para empezar' : key("Enter") + ' Pulsa para empezar') + '</div></div>' +
      '<div class="pg-version">' + this._playable().length + ' luchadores jugables</div>';
    var go = function(){ if (self._scene !== "splash") return; if (self.audio){ self.audio.resume(); } self._sfx("confirm"); self._started = true; setTimeout(function(){ if (self._scene === "splash") self._cinematic(); }, 0); };
    var btn = el("button", "pgb ghost", ""); btn.style.cssText = "position:absolute;inset:0;opacity:0;width:100%;height:100%;min-height:0"; btn.setAttribute("aria-label", "Empezar");
    btn.addEventListener("click", go); this.root.appendChild(btn);
    this._foci = [btn]; this._fi = 0;
  };

  // ======================================================== CINEMÁTICA DE APERTURA — tercera entrega
  P._cinematic = function(){
    var self = this;
    var scenes = [
      { bg:"assets/stages/puente_grande_exterior.webp", tag:"PUENTE GRANDE // TERCERA ENTREGA", title:"La fuga no terminó la historia.", sub:"Después del penal, Tobi —el Sobrino— desapareció." },
      { bg:"assets/stages/guadalajara_pemex_background.png", tag:"GUADALAJARA // TIEMPO DESPUÉS", title:"La calma fue un lujo.", sub:"Tickets completos. Dinero fácil. Una vida que parecía intocable." },
      { bg:"assets/stages/guadalajara_oxxo_background.png", tag:"ARCHIVO DE TRAICIÓN // LA CHATA", title:"Pero alguien vendió su rastro.", sub:"Don Garra y la Warriza volvieron a encontrarlo." },
      { bg:"assets/stages/puente_grande_penal_background.png", tag:"REGRESO // CUENTA PENDIENTE", title:"Esta vez no vuelve a esconderse.", sub:"Tobi, el Sobrino, regresa más macizo. Y viene por todos." }
    ];
    var scr = this._mount("cinematic", { cls:"pg-cinematic" });
    scr.innerHTML = '<div class="pg-cine-frame"><div class="pg-cine-shot"></div><div class="pg-cine-vignette"></div><div class="pg-cine-noise"></div><div class="pg-cine-letterbox top"></div><div class="pg-cine-letterbox bottom"></div><div class="pg-cine-copy"><span class="pg-cine-tag"></span><h1 class="pg-cine-title"></h1><p class="pg-cine-sub"></p></div><div class="pg-cine-meta"><span>ESCAPE DE PUENTE GRANDE III</span><span class="pg-cine-time">00:00</span></div><div class="pg-cine-progress"><i></i></div><button class="pgb ghost pg-cine-skip" type="button">Omitir cinemática <b>Esc</b></button></div>';
    var shot = scr.querySelector(".pg-cine-shot"), tag = scr.querySelector(".pg-cine-tag"), title = scr.querySelector(".pg-cine-title"), sub = scr.querySelector(".pg-cine-sub"), time = scr.querySelector(".pg-cine-time"), prog = scr.querySelector(".pg-cine-progress i");
    var skip = scr.querySelector(".pg-cine-skip"), audio = new Audio("assets/audio/intro_narration_es_mx.wav");
    audio.preload = "auto"; audio.volume = this.store.get("muted") ? 0 : Math.max(0, Math.min(1, Number(this.store.get("volume") == null ? 0.85 : this.store.get("volume"))));
    this._narration = audio;
    var total = 56000, start = performance.now(), done = false, lastScene = -1;
    var draw = function(now){
      if (done || self._scene !== "cinematic") return;
      var elapsed = Math.max(0, audio.duration && isFinite(audio.duration) ? audio.currentTime * 1000 : now - start);
      var ratio = Math.min(1, elapsed / total), idx = Math.min(scenes.length - 1, Math.floor(ratio * scenes.length));
      if (idx !== lastScene){ lastScene = idx; var s = scenes[idx]; shot.style.backgroundImage = "url('" + s.bg + "')"; tag.textContent = s.tag; title.textContent = s.title; sub.textContent = s.sub; scr.classList.remove("pg-cine-cut"); void scr.offsetWidth; scr.classList.add("pg-cine-cut"); }
      prog.style.width = (ratio * 100).toFixed(2) + "%"; time.textContent = "00:" + String(Math.min(59, Math.floor(elapsed / 1000))).padStart(2,"0");
      if ((audio.ended || ratio >= 1) && elapsed > 2500) return self._finishCinematic(false);
      self._cineRAF = requestAnimationFrame(draw);
    };
    audio.addEventListener("loadedmetadata", function(){ if (audio.duration && isFinite(audio.duration)) total = audio.duration * 1000; });
    skip.addEventListener("click", function(){ self._finishCinematic(true); });
    var key = function(e){ if (self._scene !== "cinematic") return; if (e.key === "Escape" || e.key === "Enter" || e.key === " "){ e.preventDefault(); e.stopImmediatePropagation(); self._finishCinematic(true); } };
    this._cineKey = key; window.addEventListener("keydown", key, true);
    audio.play().catch(function(){ /* algunos navegadores requieren gesto; el botón de splash ya lo intentó */ });
    this._cineRAF = requestAnimationFrame(draw);
  };
  // ======================================================== CAPÍTULO DE HISTORIA (entre combates del Arcade; data/story.json)
  // beat = { tag, title, sub, bg }. Misma estética que la apertura, sin narración ni reloj: se avanza con Continuar/Enter/Esc.
  P.storyBeat = function(beat, done){
    var self = this, scr = this._mount("story", { cls:"pg-cinematic pg-story pg-cine-cut" });
    scr.innerHTML = '<div class="pg-cine-frame"><div class="pg-cine-shot"></div><div class="pg-cine-vignette"></div><div class="pg-cine-noise"></div><div class="pg-cine-letterbox top"></div><div class="pg-cine-letterbox bottom"></div><div class="pg-cine-copy"><span class="pg-cine-tag"></span><h1 class="pg-cine-title"></h1><p class="pg-cine-sub"></p></div><button class="pgb prim pg-cine-skip" id="st-go" type="button">Continuar <b>Enter</b></button></div>';
    if (beat.bg) scr.querySelector(".pg-cine-shot").style.backgroundImage = "url('" + String(beat.bg).replace(/['"\\)]/g, "") + "')";
    scr.querySelector(".pg-cine-tag").textContent = beat.tag || ""; scr.querySelector(".pg-cine-title").textContent = beat.title || ""; scr.querySelector(".pg-cine-sub").textContent = beat.sub || "";
    var fin = false, go = function(){ if (fin || self._scene !== "story") return; fin = true; self._storyGo = null; self._sfx("confirm"); done(); };
    this._storyGo = go; this._click(scr, "#st-go", go); this._armFocus("#st-go");
  };
  P._finishCinematic = function(skipped){
    if (this._scene !== "cinematic") return;
    if (this._cineRAF) cancelAnimationFrame(this._cineRAF); this._cineRAF = 0;
    if (this._cineKey) window.removeEventListener("keydown", this._cineKey, true); this._cineKey = null;
    if (this._narration){ this._narration.pause(); this._narration.currentTime = 0; this._narration = null; }
    if (skipped) this._sfx("confirm");
    this._menu();
  };

  // ======================================================== MENÚ PRINCIPAL
  P.title = function(){ if (!this._started) return this._splash(); this._menu(); };
  // Iconos de los modos (SVG en línea, trazo = currentColor): se ven nítidos en cualquier densidad de pantalla
  var ICON = {
    quick:    '<path d="M7 4l12 8-12 8z"/>',
    arcade:   '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M5 5H3v2a3 3 0 0 0 4 3M19 5h2v2a3 3 0 0 1-4 3M12 13v4M8 21h8M9 17h6"/>',
    team:     '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="9" r="2.4"/><circle cx="19" cy="9" r="2.4"/><path d="M6 20a6 6 0 0 1 12 0M1.5 19a4 4 0 0 1 5-3.6M22.5 19a4 4 0 0 0-5-3.6"/>',
    torneo:   '<path d="M3 5h5v4h4M3 15h5v-4M12 9v6h4M3 19h5v-4M21 12h-5"/>',
    versus:   '<path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M6 18l3-3M18 18l-3-3M4 20l3-3M20 20l-3-3"/>',
    training: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    bt:       '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
    options:  '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  function icon(n){ return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICON[n] || "") + '</svg>'; }
  // MENÚ PRINCIPAL v3: marca + PELEA RÁPIDA (un toque y estás peleando) + tarjetas de modo con icono.
  // Pelea rápida = tu último duelo; la primera vez, Tobi (el protagonista) contra un rival al azar. Nunca está deshabilitada.
  P._menu = function(){
    var self = this, scr = this._mount("menu", { wall: true, cls: "pg-menu pg-menu3" });
    if (this.audio) this.audio.music("menu");
    var pl = this._playable(), lp1 = this._char(this.store.get("lastP1")), lp2 = this._char(this.store.get("lastP2"));
    var q1 = lp1 || this._char("tobi") || pl[0], q2 = lp2;
    if (!q2 || q2.id === q1.id){ var pool = pl.filter(function(c){ return c.id !== q1.id && c.id !== "garravas"; }); q2 = pool[Math.floor(Math.random() * pool.length)] || pl[1]; }
    var diff = DIFF[(this.store.get("difficulty") || 2) - 1];
    var wrap = el("div", "pg-m3");
    wrap.innerHTML =
      '<div class="pg-m3-brand"><p class="pg-m3-kicker">LEGEND OF PRESOS</p><h1 class="pg-m3-logo">El escape de<br><span>Puente Grande</span></h1></div>' +
      '<button class="pg-mode pg-m3-quick" data-m="quick">' + icon("quick") + '<span class="pg-m3-qt"><b>Pelea rápida</b><small>' + esc(q1.name) + ' vs ' + esc(q2.name) + ' · CPU ' + esc(diff) + '</small></span><i class="pg-m3-go">¡A pelear!</i></button>' +
      '<nav class="pg-m3-grid" aria-label="Modos de juego"></nav><p class="pg-m3-desc"></p>';
    scr.appendChild(wrap);
    var grid = wrap.querySelector(".pg-m3-grid"), desc = wrap.querySelector(".pg-m3-desc");
    var rows = ["arcade", "team", "torneo", "versus", "bt", "training", "options"].map(function(m){ return { m: m, t: MODES[m].t, meta: MODES[m].m, d: MODES[m].d }; });
    var byM = { quick: { d: "Un toque y a pelear: " + q1.name + " contra " + q2.name + " (CPU " + diff + "). Cambia de luchadores en Arcade o Versus." } };
    rows.forEach(function(r){ byM[r.m] = r;
      var b = el("button", "pg-mode pg-m3-tile", icon(r.m) + "<b>" + esc(r.t) + "</b><small>" + esc(r.meta) + "</small>"); b.dataset.m = r.m;
      grid.appendChild(b); });
    var rounds = this.store.get("roundsToWin") || 2;
    function go(m){
      self._sfx("confirm"); if (self.audio) self.audio.resume();
      if (m !== "quick") self.store.set("lastMode", m);
      if (m === "options") return self.options("title");
      if (m === "torneo") return self.tournamentSetup();
      if (m === "bt") return self.netMenu();
      if (m === "team"){ self.sel.mode = "team"; return self.teamSelect(); }
      if (m === "quick"){ self.sel.mode = "arcade"; self.sel.p1 = q1.id; self.sel.p2 = q2.id; self.sel.slot = 1; self.store.merge({ lastP1: q1.id, lastP2: q2.id }); return self.vs(); }
      self.sel.mode = m; self.sel.p1 = null; self.sel.p2 = null; self.sel.slot = 0; self.select();
    }
    wrap.querySelectorAll(".pg-mode").forEach(function(b){ b.addEventListener("click", function(){ go(b.dataset.m); }); });
    // títulos de las tarjetas: si una palabra larga ("Entrenamiento") no cabe en su tarjeta, se achica hasta que quepa
    function fitTitles(){ grid.querySelectorAll(".pg-m3-tile b").forEach(function(t){ t.style.fontSize = "";
      var fs = parseFloat(getComputedStyle(t).fontSize) || 16; while (t.scrollWidth > t.clientWidth + 1 && fs > 10){ fs -= 0.5; t.style.fontSize = fs + "px"; } }); }
    fitTitles(); if (global.ResizeObserver) new global.ResizeObserver(fitTitles).observe(grid);
    this._hints(scr, ["nav", "ok", "back"]);
    this._onFocus = function(e){ var r = byM[e.dataset.m]; if (r) desc.textContent = r.m === "arcade" ? r.d + " Al mejor de " + (rounds * 2 - 1) + "." : r.d; };
    this._armFocus('.pg-m3-quick');
  };

  // ======================================================== SELECCIÓN — fichas de filiación
  P._fileHTML = function(side, tag){
    return '<section class="pg-file p' + (side + 1) + '" data-slot="' + side + '"><span class="pg-tagp">' + tag + '</span>' +
      '<div class="pg-booth"><canvas></canvas></div><div class="pg-dossier"></div></section>';
  };
  // La ficha muestra solo renglones COMPLETOS: lo que no cabe se oculta entero, primero las etiquetas de rasgo y luego los
  // golpes de abajo hacia arriba. Antes la lista se cortaba a media línea y las etiquetas quedaban fuera de vista en
  // pantallas de hasta 1366x768 (medido con Playwright, 2026-11-05). La lista completa sigue en Comandos.
  function fitDossier(box){
    var items = [].slice.call(box.querySelectorAll(".pg-moves li, .pg-trait"));
    if (!items.length) return;
    items.forEach(function(e){ e.style.display = ""; });
    var lim = box.getBoundingClientRect().bottom + 0.5;
    function over(){ return items.some(function(e){ return e.style.display !== "none" && e.getClientRects().length && e.getBoundingClientRect().bottom > lim; }); }
    for (var i = items.length - 1; i >= 0 && over(); i--) items[i].style.display = "none";
  }
  P._fillDossier = function(box, ch){
    if (!ch){ box.innerHTML = '<p class="pg-empty">Elige un luchador de la lista.</p>'; return; }
    var pf = ch.perfil || {};
    var state = ch.provisional ? '<dt>Estado</dt><dd class="pg-prov">Provisional</dd>' : ch.hidden ? '<dt>Estado</dt><dd class="pg-secret">Secreto desbloqueado</dd>' : '';
    var facts = pf.reo ? ('<dl class="pg-facts"><dt>Reo</dt><dd>' + esc(pf.reo) + '</dd><dt>Celda</dt><dd>' + esc(pf.celda) + '</dd>' + state + '</dl>')
                       : '<dl class="pg-facts"><dt>Expediente</dt><dd>sin datos</dd>' + state + '</dl>';
    box.innerHTML = '<h2 class="pg-name">' + esc(ch.name) + '</h2><div class="pg-alias">' + esc(pf.alias || "") + '</div>' + facts +
      '<ul class="pg-moves"></ul><div class="pg-traits"></div>';
    loadDef(ch).then(function(def){
      var ul = box.querySelector(".pg-moves"), tr = box.querySelector(".pg-traits"); if (!ul) return;
      var rows = (def.inputs.specials || []).slice(0, 3).map(function(s){ return [def.moves[s.move], s]; })
        .concat((def.inputs.supers || []).slice(0, 1).map(function(s){ return [def.moves[s.move], s, "★ "]; }));
      ul.innerHTML = rows.filter(function(r){ return r[0]; }).map(function(r){
        return '<li><b>' + (r[2] || "") + esc(moveLabel(r[1].move, r[0])) + '</b><span class="pg-in">' + (MOTION[r[1].motion] || "") + " " + (BTN[r[1].button] || "") + '</span></li>'; }).join("");
      tr.innerHTML = traitsOf(def).map(function(t){ return '<span class="pg-trait">' + traitIcon(t[0]) + t[1] + '</span>'; }).join("");
      fitDossier(box);
      if (global.ResizeObserver && !box._pgFit){ box._pgFit = new global.ResizeObserver(function(){ fitDossier(box); }); box._pgFit.observe(box); }
    }).catch(function(e){ box.insertAdjacentHTML("beforeend", '<p class="pg-empty">' + esc(e.message) + '</p>'); });
  };
  // ======================================================== RETO BLUETOOTH (pg_net.js)
  // Pantalla 1: crear sala o buscar rival. Pantalla 2 (sala): cada quien elige luchador; el anfitrión elige escenario y
  // reglas; cuando los dos están listos, el anfitrión manda la semilla y arrancan juntos (lockstep).
  P._netListen = function(){
    var self = this; if (this._netOff) return; var offs = [];
    offs.push(PGNet.on("state", function(d){
      if (d.state === "connected" && (self._scene === "netmenu")) { self._sfx("confirm"); return self.netLobby(); }
      // desde la SALA se vuelve a la pantalla de conexión con el aviso; en la pantalla de conexión solo cambia el estado
      if ((d.state === "closed" || d.state === "error") && self._scene === "netlobby")
        return self.netMenu({ notice: d.state === "error" ? (d.message || "Error de Bluetooth.") : (d.bye ? "Tu rival salió de la sala." : "Se cerró la conexión.") });
      if (self._scene === "netmenu" && self._netPaint) self._netPaint(d);
    }));
    offs.push(PGNet.on("device", function(d){ if (self._scene === "netmenu" && self._netDev) self._netDev(d); }));
    offs.push(PGNet.on("scanDone", function(){ if (self._scene === "netmenu" && self._netPaint) self._netPaint({ state: "scanDone" }); }));
    offs.push(PGNet.on("permission", function(d){ if (self._scene === "netmenu" && self._netPaint) self._netPaint({ state: "error", message: d.message || "Hace falta el permiso de Bluetooth." }); }));
    offs.push(PGNet.on("version", function(d){ global.alert && console.warn("Versiones distintas del juego: " + d.mine + " / " + d.theirs); }));
    offs.push(PGNet.on("msg", function(m){ if (self._netMsg) self._netMsg(m); }));
    this._netOff = function(){ offs.forEach(function(f){ f(); }); };
  };
  P.netMenu = function(opts){
    opts = opts || {}; var self = this;
    var scr = this._mount("netmenu", { title: "Reto Bluetooth", ctx: "Dos teléfonos · uno contra otro", cls: "pg-sel pg-net" });
    var main = el("div", "pg-main pg-netmain"); scr.appendChild(main);
    if (!global.PGNet || !PGNet.available()){
      main.innerHTML = '<div class="pg-netbox"><h2>Solo en la app de Android</h2><p>El reto por Bluetooth necesita el APK del juego: un navegador no puede conectar dos teléfonos por Bluetooth.</p>' +
        '<p>Instala el APK en los dos teléfonos, abre <b>Reto Bluetooth</b> en ambos: uno toca <b>Crear sala</b> y el otro <b>Buscar rival</b>.</p></div>' +
        '<div class="pg-bar"><div class="pg-bar-actions"><button class="pgb prim" id="n-back">Volver</button></div></div>';
      this._click(main, "#n-back", function(){ self._sfx("cancel"); self.title(); }); this._armFocus("#n-back"); return;
    }
    this._netListen();
    main.innerHTML = '<div class="pg-netbox">' + (opts.notice ? '<p class="pg-netnotice">' + esc(opts.notice) + '</p>' : '') +
      '<div class="pg-netgrid"><section><h2>Crear sala</h2><p>Tu teléfono queda visible por Bluetooth y espera al rival. Serás <b>1P</b>.</p><button class="pgb prim" id="n-host">Crear sala</button></section>' +
      '<section><h2>Buscar rival</h2><p>Busca la sala que creó tu amigo y toca su teléfono. Serás <b>2P</b>.</p><button class="pgb" id="n-scan">Buscar rival</button><ul class="pg-netdev" aria-label="Teléfonos encontrados"></ul></section></div>' +
      '<p class="pg-netstate" aria-live="polite">Activa el Bluetooth en los dos teléfonos.</p></div>' +
      '<div class="pg-bar"><div class="pg-bar-actions"><button class="pgb ghost" id="n-back">Volver</button></div></div>';
    var stEl = main.querySelector(".pg-netstate"), list = main.querySelector(".pg-netdev"), seen = {};
    this._netPaint = function(d){
      var t = { starting: "Preparando la sala…", hosting: "Sala abierta" + (d.name ? " como «" + d.name + "»" : "") + ". Esperando a tu rival…", scanning: "Buscando teléfonos cerca…",
        scanDone: Object.keys(seen).length ? "Toca el teléfono de tu rival." : "No apareció ninguna sala. Pide a tu amigo que toque «Crear sala» y vuelve a buscar.",
        connecting: "Conectando…", error: "Error: " + (d.message || "Bluetooth no disponible."), idle: "Activa el Bluetooth en los dos teléfonos.", closed: "Conexión cerrada." }[d.state];
      if (t) stEl.textContent = t; stEl.classList.toggle("err", d.state === "error"); };
    this._netDev = function(d){ if (!d.address || seen[d.address]) return; seen[d.address] = 1;
      var li = el("li"), b = el("button", "pgb ghost", '<b>' + esc(d.name || "Teléfono sin nombre") + '</b><small>' + esc(d.address) + (d.bonded ? " · vinculado" : "") + '</small>'); b.type = "button";
      b.addEventListener("click", function(){ self._sfx("confirm"); PGNet.connect(d.address); }); li.appendChild(b); list.appendChild(li); self._armFocus(); };
    this._click(main, "#n-host", function(){ self._sfx("confirm"); PGNet.host(); });
    this._click(main, "#n-scan", function(){ self._sfx("ui"); seen = {}; list.innerHTML = ""; PGNet.scan(); });
    this._click(main, "#n-back", function(){ self._sfx("cancel"); PGNet.close(); self.title(); });
    this._netPaint({ state: PGNet.session.state });
    this._armFocus("#n-host");
  };
  // SALA: misma estética que la selección. lado propio: anfitrión = 1P (0), invitado = 2P (1)
  P.netLobby = function(opts){
    opts = opts || {}; var self = this;
    if (!global.PGNet || PGNet.session.state !== "connected") return this.netMenu(opts);
    this._netListen();
    var me = PGNet.session.host ? 0 : 1, them = 1 - me, L = this._netL = this._netL || { pick: [null, null], ready: [false, false], stage: this.sel.stage || 0 };
    L.ready = [false, false];
    var scr = this._mount("netlobby", { title: "Sala Bluetooth", ctx: "Contra " + esc(PGNet.session.peerName || "tu rival"), cls: "pg-sel" });
    var main = el("div", "pg-main");
    var res = opts.result, banner = "";
    if (res){ var won = res.winner === res.you, draw = res.winner < 0;
      banner = '<div class="pg-netres ' + (draw ? "" : won ? "win" : "lose") + '">' + (draw ? "Empate" : won ? "¡Ganaste!" : "Perdiste") + ' <small>' + res.wins.join(" – ") +
        (res.desync >= 0 ? " · se perdió la sincronía" : "") + '</small></div>'; }
    main.innerHTML = banner + '<div class="pg-duel">' + this._fileHTML(0, me === 0 ? "1P · TÚ" : "1P") + '<div class="pg-vsmark">VS</div>' + this._fileHTML(1, me === 1 ? "2P · TÚ" : "2P") + '</div>' +
      '<div class="pg-roster-head"><b>ELIGE TU LUCHADOR</b><small>DESLIZA · TOCA PARA ELEGIR</small></div><div class="pg-cells"></div>' +
      '<div class="pg-bar"><div class="pg-field pg-stagecyc">Escenario <div class="pg-cyc" id="s-stage">' + (me === 0 ? '<button class="pgb ghost pg-cyc-b" data-d="-1" aria-label="Escenario anterior">‹</button>' : '') +
      '<span class="pg-cyc-v"></span>' + (me === 0 ? '<button class="pgb ghost pg-cyc-b" data-d="1" aria-label="Escenario siguiente">›</button>' : '') + '</div></div>' +
      '<div class="pg-bar-actions"><span class="pg-netwait"></span><button class="pgb ghost" id="n-leave">Salir</button><button class="pgb prim" id="s-go">¡Listo!</button></div></div>';
    scr.appendChild(main);
    var files = main.querySelectorAll(".pg-file"), prev = [new Preview(files[0].querySelector("canvas")), new Preview(files[1].querySelector("canvas"), { flip: true })];
    Loop.add(function(t){ prev[0].draw(t); prev[1].draw(t); });
    var playable = this._playable(), cells = main.querySelector(".pg-cells"), wait = main.querySelector(".pg-netwait"), go = main.querySelector("#s-go");
    if (!L.pick[me]) L.pick[me] = (playable.find(function(c){ return c.id === self.store.get("lastP1"); }) || playable[0]).id;
    enableRosterRail(cells, null);
    playable.forEach(function(c){ var b = el("button", "pg-cell", ""); b.dataset.id = c.id; makeFighterCard(b, c);
      b.addEventListener("click", function(){ if (L.ready[me]) return; self._sfx("ui"); L.pick[me] = c.id; centerRosterCard(cells, c.id, true); PGNet.send({ t: "pick", id: c.id }); paint(); }); cells.appendChild(b); });
    var shown = [undefined, undefined];
    function paint(){
      [0, 1].forEach(function(s){ var id = L.pick[s]; if (shown[s] !== id){ shown[s] = id; var ch = id ? self._char(id) : null; prev[s].set(ch); self._fillDossier(files[s].querySelector(".pg-dossier"), ch); }
        files[s].classList.toggle("active", s === me); });
      cells.querySelectorAll(".pg-cell").forEach(function(c){ c.classList.toggle(me === 0 ? "pick1" : "pick2", c.dataset.id === L.pick[me]); });
      var st = STAGES[L.stage] || STAGES[0]; main.querySelector("#s-stage .pg-cyc-v").innerHTML = '<i class="pg-swatch" style="background:' + st.c + '"></i>' + esc(st.n);
      go.textContent = L.ready[me] ? "Cancelar" : "¡Listo!"; go.classList.toggle("prim", !L.ready[me]);
      wait.textContent = !L.pick[them] ? "Tu rival está eligiendo…" : L.ready[them] ? "Tu rival está listo" : L.ready[me] ? "Esperando a tu rival…" : "";
    }
    main.querySelectorAll("#s-stage .pg-cyc-b").forEach(function(b){ b.addEventListener("click", function(){ L.stage = (L.stage + (+b.dataset.d) + STAGES.length) % STAGES.length; PGNet.send({ t: "stage", i: L.stage }); self._sfx("ui"); paint(); }); });
    this._click(main, "#n-leave", function(){ self._sfx("cancel"); PGNet.close(); self._netL = null; self.title(); });
    go.addEventListener("click", function(){ self._sfx("confirm"); L.ready[me] = !L.ready[me]; PGNet.send({ t: "ready", on: L.ready[me], id: L.pick[me] }); paint(); maybeStart(); });
    function maybeStart(){
      if (me !== 0 || !L.ready[0] || !L.ready[1] || !L.pick[0] || !L.pick[1]) return;
      var start = { t: "start", seed: (Math.random() * 4294967296) >>> 0, p1: L.pick[0], p2: L.pick[1], stage: L.stage,
        cfg: { roundsToWin: self.store.get("roundsToWin") || 2, roundTime: self.store.get("roundTime") || 99 } };
      PGNet.send(start); launch(start);
    }
    function launch(m){
      self.store.set("lastP1", L.pick[me]); L.ready = [false, false];
      self.sel.mode = "net"; self.sel.p1 = m.p1; self.sel.p2 = m.p2; self.sel.stage = m.stage; self.sel.seed = m.seed; self.sel.netCfg = m.cfg; self.sel.side = me;
      self._netMsg = null; self.vs();
    }
    this._netMsg = function(m){
      if (m.t === "pick"){ L.pick[them] = m.id; paint(); }
      else if (m.t === "ready"){ L.ready[them] = !!m.on; if (m.id) L.pick[them] = m.id; paint(); maybeStart(); }
      else if (m.t === "stage" && me === 1){ L.stage = m.i; paint(); }
      else if (m.t === "start" && me === 1) launch(m);
      else if (m.t === "hi"){ PGNet.send({ t: "pick", id: L.pick[me] }); if (me === 0) PGNet.send({ t: "stage", i: L.stage }); }
    };
    PGNet.send({ t: "pick", id: L.pick[me] }); if (me === 0) PGNet.send({ t: "stage", i: L.stage }); PGNet.send({ t: "hi" });
    paint(); centerRosterCard(cells, L.pick[me], false);
    this._armFocus("#s-go");
  };
  // pausa en red: la pelea NO se congela (el otro teléfono esperaría); se puede seguir o abandonar
  P.netPause = function(){
    var self = this, scr = this._mount("netpause", { title: "Reto Bluetooth", ctx: "La pelea sigue corriendo", over: true, cls: "pg-pause" });
    var main = el("div", "pg-main"); main.style.flexDirection = "column";
    main.innerHTML = '<p class="pg-empty">En el reto la pelea no se pausa: tu rival sigue jugando.</p><div class="pg-row"><button class="pgb prim" id="np-go">Seguir peleando</button><button class="pgb ghost" id="np-quit">Abandonar reto</button></div>';
    scr.appendChild(main);
    this._click(main, "#np-go", function(){ self._sfx("ui"); self.hide(); });
    this._click(main, "#np-quit", function(){ self._sfx("cancel"); PGNet.close(); self.emit("netLeave"); self._netL = null; self.title(); });
    this._armFocus("#np-go");
  };

  P.select = function(){
    var self = this, mode = this.sel.mode, arcade = mode === "arcade", cpu = arcade || mode === "training";
    var ctx = { arcade: "Arcade", versus: "Versus", training: "Entrenamiento" }[mode];
    var scr = this._mount("select", { title: "Selección de luchador", ctx: ctx, cls: "pg-sel" });
    var main = el("div", "pg-main");
    main.innerHTML = '<div class="pg-duel">' + this._fileHTML(0, "1P") + '<div class="pg-vsmark">VS</div>' + this._fileHTML(1, cpu ? (mode === "training" ? "MANIQUÍ" : "CPU") : "2P") + '</div>' +
      '<div class="pg-roster-head"><b>ARCHIVO DE COMBATE</b><small>DESLIZA PARA EXPLORAR</small></div><div class="pg-cells" aria-label="Cartas de peleadores"></div>' +
      '<div class="pg-bar">' +
      (arcade ? '<div class="pg-field">Formato <div class="pg-seg" id="s-arcfmt"></div></div>' : '') +
      (cpu ? '<div class="pg-field">CPU <div class="pg-seg" id="s-diff"></div></div>' : '') +
      '<div class="pg-field pg-stagecyc">Escenario <div class="pg-cyc" id="s-stage"><button class="pgb ghost pg-cyc-b" data-d="-1" aria-label="Escenario anterior">‹</button><span class="pg-cyc-v"></span><button class="pgb ghost pg-cyc-b" data-d="1" aria-label="Escenario siguiente">›</button></div></div>' +
      '<div class="pg-bar-actions"><button class="pgb ghost" id="s-back">Volver</button><button class="pgb ghost" id="s-rnd" title="Luchador al azar para la ficha activa">Al azar</button><button class="pgb" id="s-cmds">Comandos</button><button class="pgb prim" id="s-go" disabled>Pelear</button></div></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok", "back"]);
    var files = main.querySelectorAll(".pg-file");
    var prev = [new Preview(files[0].querySelector("canvas")), new Preview(files[1].querySelector("canvas"), { flip: true })];
    Loop.add(function(t){ prev[0].draw(t); prev[1].draw(t); });
    var cells = main.querySelector(".pg-cells"), playable = this._playable().filter(function(c){ return !arcade || c.id !== "garravas"; }); enableRosterRail(cells, function(id){ show(self.sel.slot, id); });
    playable.forEach(function(c){
      // celda = solo la cara (como la rejilla de KOF); el nombre va en la ficha grande y en aria-label/title
      var b = el("button", "pg-cell", "");
      b.dataset.id = c.id; b.title = c.name; b.setAttribute("aria-label", c.name); makeFighterCard(b, c);
      b.addEventListener("click", function(){ self._sfx("ui"); pick(c.id); });
      cells.appendChild(b);
    });
    if (mode !== "versus" && !arcade){
      var rnd = el("button", "pg-cell rnd", "?"); rnd.dataset.id = "?"; rnd.title = "Rival al azar"; rnd.setAttribute("aria-label", "Rival al azar");
      rnd.addEventListener("click", function(){ self._sfx("ui"); var c = playable[Math.floor(Math.random() * playable.length)]; self.sel.p2 = c.id; self.sel.slot = 1; refresh(); });
      cells.appendChild(rnd);
    }
    function pick(id){ if (arcade){ self.sel.p1 = id; self.sel.p2 = null; self.sel.slot = 0; } else if (self.sel.slot === 0){ self.sel.p1 = id; self.sel.slot = 1; } else { self.sel.p2 = id; } hoverId = null; centerRosterCard(cells, id, true); refresh(); }
    files.forEach(function(f){ f.addEventListener("click", function(){ self.sel.slot = +f.dataset.slot; refresh(); }); });
    if (arcade){
      this._seg(main.querySelector("#s-arcfmt"), ["1 vs 1", "Equipos (3v3)"], 0, function(i){
        if (i === 1) self.arcadeTeamSelect();
      });
    }
    if (cpu){ this._seg(main.querySelector("#s-diff"), DIFF, this.sel.difficulty - 1, function(i){ self.sel.difficulty = i + 1; self.store.set("difficulty", i + 1); }); }
    // escenario: selector compacto ‹ nombre › (antes una fila de 10 botones que no cabía en el teléfono)
    var cycV = main.querySelector("#s-stage .pg-cyc-v");
    function paintStage(){ var st = STAGES[self.sel.stage]; cycV.innerHTML = '<i class="pg-swatch" style="background:' + st.c + '"></i>' + esc(st.n) + '<small>' + (self.sel.stage + 1) + '/' + STAGES.length + '</small>'; }
    main.querySelectorAll("#s-stage .pg-cyc-b").forEach(function(b){ b.addEventListener("click", function(){
      self.sel.stage = (self.sel.stage + (+b.dataset.d) + STAGES.length) % STAGES.length; self.store.set("stage", self.sel.stage); self._sfx("ui"); paintStage(); }); });
    paintStage();
    this._click(main, "#s-rnd", function(){ self._sfx("ui");
      var other = self.sel.slot === 0 ? self.sel.p2 : self.sel.p1, pool = playable.filter(function(c){ return c.id !== other; });
      var c = pool[Math.floor(Math.random() * pool.length)]; if (!c) return;
      if (arcade || self.sel.slot === 0) self.sel.p1 = c.id; else self.sel.p2 = c.id;
      hoverId = null; centerRosterCard(cells, c.id, true); refresh(); });
    this._click(main, "#s-back", function(){ self._sfx("cancel"); self.title(); });
    this._click(main, "#s-cmds", function(){ self._sfx("ui"); var id = self.sel.p1 || playable[0].id; self.commands(id, function(){ self.select(); }); });
    this._click(main, "#s-go", function(){
      if (arcade){ if (!self.sel.p1) return; self._sfx("confirm"); self.store.set("lastP1", self.sel.p1); return self.emit("arcadeStart", { yourId:self.sel.p1 }); }
      if (!self.sel.p1 || !self.sel.p2) return; self._sfx("confirm"); self.store.merge({ lastP1: self.sel.p1, lastP2: self.sel.p2 }); self.vs();
    });
    // al pasar el cursor por una celda, la ficha activa muestra a ese luchador (sin elegirlo todavía)
    var hoverId = null;
    this._onFocus = function(e){ if (e.classList.contains("pg-cell") && e.classList.contains("pg-center") && e.dataset.id !== "?"){ hoverId = e.dataset.id; show(self.sel.slot, hoverId); } };
    var shown = [undefined, undefined];   // undefined (no null): la primera vez también pinta el estado vacío
    function show(slot, id){
      if (shown[slot] === id) return; shown[slot] = id; var ch = id ? self._char(id) : null;
      prev[slot].set(ch); self._fillDossier(files[slot].querySelector(".pg-dossier"), ch); pgFileSwap(files[slot]);
    }
    function refresh(){
      [0, 1].forEach(function(i){ files[i].classList.toggle("active", self.sel.slot === i); });
      show(0, self.sel.slot === 0 && hoverId ? hoverId : self.sel.p1);
      show(1, self.sel.slot === 1 && hoverId && !self.sel.p2 ? hoverId : self.sel.p2);
      cells.querySelectorAll(".pg-cell").forEach(function(c){
        var a = c.dataset.id === self.sel.p1, b = c.dataset.id === self.sel.p2;
        c.classList.toggle("pick1", a); c.classList.toggle("pick2", b);
        var mk = c.querySelectorAll(".pg-mk"); for (var k = 0; k < mk.length; k++) mk[k].remove();
        if (a) c.insertAdjacentHTML("beforeend", '<span class="pg-mk a">1P</span>');
        if (b) c.insertAdjacentHTML("beforeend", '<span class="pg-mk b">' + (cpu ? "CPU" : "2P") + '</span>');
      });
      main.querySelector("#s-go").disabled = arcade ? !self.sel.p1 : !(self.sel.p1 && self.sel.p2);
    }
    this.sel.p1 = this.sel.p1 || this.store.get("lastP1"); this.sel.p2 = arcade ? null : (this.sel.p2 || this.store.get("lastP2"));
    if (this.sel.p1 && !this._char(this.sel.p1)) this.sel.p1 = null; if (this.sel.p2 && !this._char(this.sel.p2)) this.sel.p2 = null;
    // nunca empezar con fichas vacías: 1P = Tobi (el protagonista) y el rival al azar. "Pelear" queda listo desde el inicio;
    // tocar una carta cambia la ficha activa. Antes había que elegir los dos y el botón seguía bloqueado hasta entonces.
    var inList = function(id){ return playable.some(function(c){ return c.id === id; }); };
    if (!this.sel.p1 || !inList(this.sel.p1)) this.sel.p1 = (inList("tobi") ? "tobi" : playable[0].id);
    if (!arcade && (!this.sel.p2 || !inList(this.sel.p2))){ var pool2 = playable.filter(function(c){ return c.id !== self.sel.p1; }); this.sel.p2 = (pool2[Math.floor(Math.random() * pool2.length)] || playable[0]).id; }
    this.sel.slot = 0;   // la ficha activa empieza en 1P (con las dos ya llenas, "Pelear" funciona de inmediato)
    refresh();
    centerRosterCard(cells, self.sel.slot === 0 ? (self.sel.p1 || self.sel.p2) : (self.sel.p2 || self.sel.p1), false);
    this._armFocus(arcade ? (this.sel.p1 ? "#s-go" : ".pg-cell") : (this.sel.p1 && this.sel.p2 ? "#s-go" : ".pg-cell"));
  };
  // control segmentado reutilizable
  // ======================================================== EQUIPOS: selección de 3 + 3 (orden = orden de entrada)
  function teamSize(){ var G = global.__PGGAME, c = G && G.cfgBase && G.cfgBase.team; return (c && c.size) || 3; }

  P.arcadeTeamSelect = function(){
    var self = this, S = this.sel, N = teamSize(), playable = this._playable().filter(function(c){ return c.id !== "garravas"; });
    var valid = function(a){ return (a || []).filter(function(id){ return !!self._char(id); }).slice(0, N); };
    S.mode = "arcadeTeam";
    S.team1 = valid(S.team1 || this.store.get("lastTeam1"));
    if (S.team1.length < N) {
      playable.forEach(function(c){ if (S.team1.length < N && S.team1.indexOf(c.id) < 0) S.team1.push(c.id); });
    }
    S.slot = 0;
    var scr = this._mount("arcadeTeamSelect", { title: "Campaña Arcade por Equipos", ctx: "Elige tu trío de 3 contra las bandas de Puente Grande", cls: "pg-sel pg-tsel" });
    var main = el("div", "pg-main");
    main.innerHTML = '<div class="pg-duel">' + this._fileHTML(0, "Tu Equipo") + '<div class="pg-vsmark">VS</div>' + this._fileHTML(1, "Bandas CPU") + '</div>' +
      '<div class="pg-roster-head"><b>ARCHIVO DE COMBATE</b><small>DESLIZA PARA EXPLORAR</small></div><div class="pg-cells" aria-label="Cartas de peleadores"></div>' +
      '<div class="pg-bar">' +
      '<div class="pg-field">Formato <div class="pg-seg" id="at-fmt"></div></div>' +
      '<div class="pg-field">Dificultad <div class="pg-seg" id="at-diff"></div></div>' +
      '<button class="pgb" id="at-rnd">Trío al azar</button>' +
      '<div class="pg-bar-actions"><button class="pgb ghost" id="at-back">Volver</button><button class="pgb prim" id="at-go">Empezar Arcade</button></div></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok", "back"]);
    var files = main.querySelectorAll(".pg-file");
    var prev = [new Preview(files[0].querySelector("canvas")), new Preview(files[1].querySelector("canvas"), { flip: true })];
    Loop.add(function(t){ prev[0].draw(t); prev[1].draw(t); });
    files[0].querySelector(".pg-booth").insertAdjacentHTML("beforeend", '<div class="pg-team" aria-label="Tu equipo"></div>');
    var st = files[0].querySelector(".pg-team");
    for (var k = 0; k < N; k++){
      var b = el("button", "pg-tm", '<i>' + (k + 1) + '</i>');
      b.type = "button"; b.dataset.k = k;
      b.addEventListener("click", function(ev){ ev.stopPropagation(); S.slot = +this.dataset.k; refresh(); });
      st.appendChild(b);
    }
    var cells = main.querySelector(".pg-cells"); enableRosterRail(cells, function(id){ show(S.slot, id); });
    playable.forEach(function(c){
      var b = el("button", "pg-cell", ""); b.dataset.id = c.id; b.title = c.name; b.setAttribute("aria-label", c.name); makeFighterCard(b, c);
      b.addEventListener("click", function(){ self._sfx("ui"); pick(c.id); });
      cells.appendChild(b);
    });
    function pick(id){
      var idx = S.team1.indexOf(id);
      if (idx >= 0){ S.team1.splice(idx, 1); }
      else {
        if (S.team1.length < N) S.team1.push(id);
        else S.team1[S.slot] = id;
      }
      centerRosterCard(cells, id, true); refresh();
    }
    this._click(main, "#at-rnd", function(){
      self._sfx("ui");
      var pool = playable.slice();
      for (var i = pool.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      S.team1 = pool.slice(0, N).map(function(c){ return c.id; });
      refresh();
    });
    this._seg(main.querySelector("#at-fmt"), ["1 vs 1", "Equipos (3v3)"], 1, function(i){
      if (i === 0){ self.sel.mode = "arcade"; self.select(); }
    });
    this._seg(main.querySelector("#at-diff"), DIFF, (self.sel.difficulty || 2) - 1, function(i){
      self.sel.difficulty = i + 1; self.store.set("difficulty", i + 1);
    });
    this._click(main, "#at-back", function(){ self._sfx("cancel"); self.title(); });
    this._click(main, "#at-go", function(){
      if (S.team1.length < N) return;
      self._sfx("confirm");
      self.store.set("lastTeam1", S.team1.slice());
      self.emit("arcadeStart", { team: true, team1: S.team1.slice(), difficulty: self.sel.difficulty });
    });
    var shown = [undefined, undefined];
    function show(slot, id){
      if (shown[slot] === id) return; shown[slot] = id; var ch = id ? self._char(id) : null;
      prev[slot].set(ch); self._fillDossier(files[slot].querySelector(".pg-dossier"), ch);
    }
    var bossChar = self._char("garravas") || playable[0];
    show(1, bossChar ? bossChar.id : playable[0].id);
    function refresh(){
      files[0].classList.add("active");
      var activeId = S.team1[S.slot] || S.team1[0] || playable[0].id;
      show(0, activeId);
      var tms = st.querySelectorAll(".pg-tm");
      tms.forEach(function(tm, k){
        var id = S.team1[k], ch = id ? self._char(id) : null;
        tm.classList.toggle("on", !!id);
        tm.classList.toggle("first", k === S.slot);
        if (ch) setMug(tm, ch);
      });
      cells.querySelectorAll(".pg-cell").forEach(function(c){
        var idx = S.team1.indexOf(c.dataset.id);
        c.classList.toggle("pick1", idx >= 0);
        var mk = c.querySelectorAll(".pg-mk"); for (var k = 0; k < mk.length; k++) mk[k].remove();
        if (idx >= 0) c.insertAdjacentHTML("beforeend", '<span class="pg-mk a">' + (idx + 1) + '</span>');
      });
      main.querySelector("#at-go").disabled = (S.team1.length < N);
    }
    refresh(); centerRosterCard(cells, S.team1[S.slot] || S.team1[0], false);
    this._armFocus("#at-go");
  };

  P.teamSelect = function(){
    var self = this, S = this.sel, N = teamSize(), playable = this._playable();
    var valid = function(a){ return (a || []).filter(function(id){ return !!self._char(id); }).slice(0, N); };
    S.team1 = valid(S.team1 || this.store.get("lastTeam1")); S.team2 = valid(S.team2 || this.store.get("lastTeam2"));
    S.teamVs = !!S.teamVs; S.slot = S.team1.length < N ? 0 : (S.team2.length < N ? 1 : 0);
    var scr = this._mount("teamSelect", { title: "Arma tu equipo", ctx: "Equipos 3 contra 3", cls: "pg-sel pg-tsel" });
    var main = el("div", "pg-main");
    main.innerHTML = '<div class="pg-duel">' + this._fileHTML(0, "Equipo 1P") + '<div class="pg-vsmark">VS</div>' + this._fileHTML(1, "Equipo rival") + '</div>' +
      '<div class="pg-roster-head"><b>ARCHIVO DE COMBATE</b><small>DESLIZA PARA EXPLORAR</small></div><div class="pg-cells" aria-label="Cartas de peleadores"></div>' +
      '<div class="pg-bar"><div class="pg-field">Rival <div class="pg-seg" id="t-vs"></div></div><div class="pg-field" id="t-difff">CPU <div class="pg-seg" id="t-diff"></div></div>' +
      '<div class="pg-field">Escenario <div class="pg-seg" id="t-stage"></div></div>' +
      '<div class="pg-bar-actions"><button class="pgb ghost" id="t-back">Volver</button><button class="pgb ghost" id="t-order" aria-pressed="false">Orden</button><button class="pgb" id="t-cmds">Comandos</button><button class="pgb prim" id="t-go" disabled>Pelear</button></div></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok", "back"]);
    var files = main.querySelectorAll(".pg-file");
    // en cada ficha: los 3 lugares del equipo en orden de entrada. Normal: tocar un lugar lo quita.
    // Modo "Orden": tocar dos lugares del mismo equipo los intercambia (cambia quién entra antes).
    var reorder = false, swapFrom = null;   // swapFrom = { side, k } del primer lugar tocado
    var strips = [];
    files.forEach(function(f, side){
      var st = el("div", "pg-team"); st.setAttribute("aria-label", side === 0 ? "Tu equipo" : "Equipo rival");
      for (var k = 0; k < N; k++){ var b = el("button", "pg-tm", '<i>' + (k + 1) + '</i>'); b.type = "button"; b.dataset.side = side; b.dataset.k = k;
        b.addEventListener("click", function(ev){ ev.stopPropagation(); var sd = +this.dataset.side, kk = +this.dataset.k, T = sd === 0 ? S.team1 : S.team2;
          S.slot = sd;
          if (reorder){ onReorderTap(sd, kk, T); refresh(); return; }
          if (kk < T.length){ T.splice(kk, 1); self._sfx("cancel"); }
          swapFrom = null; refresh(); });
        st.appendChild(b); }
      f.querySelector(".pg-booth").appendChild(st); strips.push(st);
    });
    function onReorderTap(sd, kk, T){
      if (kk >= T.length){ self._sfx("cancel"); return; }             // solo lugares ocupados
      if (!swapFrom || swapFrom.side !== sd){ swapFrom = { side: sd, k: kk }; self._sfx("ui"); return; }
      if (swapFrom.k !== kk){ var t = T[swapFrom.k]; T[swapFrom.k] = T[kk]; T[kk] = t; self._sfx("ui"); }
      swapFrom = null;
    }
    main.querySelector("#t-order").addEventListener("click", function(){
      reorder = !reorder; swapFrom = null; self._sfx("ui"); refresh(); });
    var prev = [new Preview(files[0].querySelector("canvas")), new Preview(files[1].querySelector("canvas"), { flip: true })];
    Loop.add(function(t){ prev[0].draw(t); prev[1].draw(t); });
    var cells = main.querySelector(".pg-cells"); enableRosterRail(cells, function(id){ show(S.slot, id); });
    playable.forEach(function(c){
      var b = el("button", "pg-cell", ""); b.dataset.id = c.id; b.title = c.name; b.setAttribute("aria-label", c.name); makeFighterCard(b, c);
      b.addEventListener("click", function(){ pick(c.id); }); cells.appendChild(b);
    });
    var rnd = el("button", "pg-cell rnd", "?"); rnd.dataset.id = "?"; rnd.title = "Completar al azar"; rnd.setAttribute("aria-label", "Completar el equipo al azar");
    rnd.addEventListener("click", function(){ var T = S.slot === 0 ? S.team1 : S.team2, pool = playable.filter(function(c){ return T.indexOf(c.id) < 0; });
      while (T.length < N && pool.length){ T.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id); }
      self._sfx("ui"); advance(); refresh(); });
    cells.appendChild(rnd);
    function advance(){ if (S.slot === 0 && S.team1.length >= N && S.team2.length < N) S.slot = 1; }
    function pick(id){ var T = S.slot === 0 ? S.team1 : S.team2; swapFrom = null;
      if (T.indexOf(id) >= 0){ self._sfx("cancel"); return; }          // un luchador no se repite dentro del mismo equipo
      if (T.length >= N){ self._sfx("cancel"); return; }
      T.push(id); hoverId = null; self._sfx("ui"); advance(); centerRosterCard(cells, id, true); refresh(); }
    files.forEach(function(f){ f.addEventListener("click", function(){ S.slot = +f.dataset.slot; refresh(); }); });
    this._seg(main.querySelector("#t-vs"), ["CPU", "Jugador 2"], S.teamVs ? 1 : 0, function(i){ S.teamVs = i === 1; refresh(); });
    this._seg(main.querySelector("#t-diff"), DIFF, S.difficulty - 1, function(i){ S.difficulty = i + 1; self.store.set("difficulty", i + 1); });
    this._seg(main.querySelector("#t-stage"), STAGES.map(function(s){ return '<i class="pg-swatch" style="background:' + s.c + '"></i>' + s.n; }), S.stage,
      function(i){ S.stage = i; self.store.set("stage", i); });
    this._click(main, "#t-back", function(){ self._sfx("cancel"); self.title(); });
    this._click(main, "#t-cmds", function(){ self._sfx("ui"); var T = S.slot === 0 ? S.team1 : S.team2; self.commands(T[T.length - 1] || playable[0].id, function(){ self.teamSelect(); }); });
    this._click(main, "#t-go", function(){ if (S.team1.length < N || S.team2.length < N) return; self._sfx("confirm");
      self.store.merge({ lastTeam1: S.team1.slice(), lastTeam2: S.team2.slice() }); self.vs(); });
    var hoverId = null, shown = [undefined, undefined];
    this._onFocus = function(e){ if (e.classList.contains("pg-cell") && e.classList.contains("pg-center") && e.dataset.id !== "?"){ hoverId = e.dataset.id; show(S.slot, hoverId); } };
    function show(slot, id){ if (shown[slot] === id) return; shown[slot] = id; var ch = id ? self._char(id) : null; prev[slot].set(ch); self._fillDossier(files[slot].querySelector(".pg-dossier"), ch); pgFileSwap(files[slot]); }
    function refresh(){
      files[1].querySelector(".pg-tagp").textContent = S.teamVs ? "Equipo 2P" : "Equipo CPU";
      main.querySelector("#t-difff").style.display = S.teamVs ? "none" : "";
      var ordBtn = main.querySelector("#t-order"); ordBtn.classList.toggle("on", reorder); ordBtn.setAttribute("aria-pressed", reorder ? "true" : "false");
      [0, 1].forEach(function(i){ var T = i === 0 ? S.team1 : S.team2; files[i].classList.toggle("active", S.slot === i);
        strips[i].classList.toggle("reorder", reorder);
        strips[i].querySelectorAll(".pg-tm").forEach(function(b, k){ var id = T[k], ch = id ? self._char(id) : null;
          b.classList.toggle("sw", !!swapFrom && swapFrom.side === i && swapFrom.k === k);
          b.classList.toggle("on", !!ch); b.title = ch ? ch.name + (reorder ? " (tocar otro lugar para intercambiar)" : " (tocar para quitar)") : "Lugar " + (k + 1);
          b.setAttribute("aria-label", ch ? (k + 1) + ": " + ch.name + (reorder ? ", intercambiar" : ", quitar") : "Lugar " + (k + 1) + " vacío");
          if (ch){ if (b.dataset.id !== id){ b.dataset.id = id; b.style.backgroundImage = ""; setMug(b, ch); } }
          else { b.dataset.id = ""; b.style.backgroundImage = ""; } });
        show(i, S.slot === i && hoverId && T.length < N ? hoverId : (T[T.length - 1] || null)); });
      cells.querySelectorAll(".pg-cell").forEach(function(c){
        var a = S.team1.indexOf(c.dataset.id), b = S.team2.indexOf(c.dataset.id);
        c.classList.toggle("pick1", a >= 0); c.classList.toggle("pick2", b >= 0);
        var mk = c.querySelectorAll(".pg-mk"); for (var k = 0; k < mk.length; k++) mk[k].remove();
        if (a >= 0) c.insertAdjacentHTML("beforeend", '<span class="pg-mk a">' + (a + 1) + '</span>');
        if (b >= 0) c.insertAdjacentHTML("beforeend", '<span class="pg-mk b">' + (b + 1) + '</span>');
      });
      main.querySelector("#t-go").disabled = !(S.team1.length >= N && S.team2.length >= N);
    }
    refresh(); centerRosterCard(cells, (S.slot === 0 ? S.team1 : S.team2).slice(-1)[0], false);
    this._armFocus(S.team1.length >= N && S.team2.length >= N ? "#t-go" : ".pg-cell");
  };

  P._seg = function(host, labels, active, cb){
    var self = this; if (!host) return;
    labels.forEach(function(lb, i){
      var b = el("button", i === active ? "on" : "", lb); b.type = "button";
      b.addEventListener("click", function(){ host.querySelectorAll("button").forEach(function(x){ x.classList.remove("on"); }); b.classList.add("on"); self._sfx("ui"); cb(i); });
      host.appendChild(b);
    });
  };

  // ======================================================== VS (precarga real mientras se presenta)
  P.vs = function(){
    var self = this, team = this.sel.mode === "team", c1 = this._char(team ? this.sel.team1[0] : this.sel.p1), c2 = this._char(team ? this.sel.team2[0] : this.sel.p2);
    var scr = this._mount("vs", { cls: "pg-vs" });
    scr.innerHTML = '<div class="pg-vs-half l"><canvas></canvas><h2 class="pg-vs-nm">' + esc(c1.name) + '</h2><div class="pg-vs-al">' + esc((c1.perfil && c1.perfil.alias) || "") + '</div></div>' +
      '<div class="pg-vs-half r"><canvas></canvas><h2 class="pg-vs-nm">' + esc(c2.name) + '</h2><div class="pg-vs-al">' + esc((c2.perfil && c2.perfil.alias) || "") + '</div></div>' +
      '<div class="pg-vs-x">VS</div>' + (this.sel.tag ? '<div class="pg-vs-tag">' + esc(this.sel.tag) + '</div>' : '') + '<div class="pg-vs-foot"><div class="pg-load"><i></i></div><div class="pg-vs-msg">Cargando el combate en ' + esc(STAGES[this.sel.stage].n) + '</div></div>';
    if (team){   // EQUIPOS: los 3 de cada lado en orden de entrada, bajo el nombre del primero
      [[".pg-vs-half.l", this.sel.team1], [".pg-vs-half.r", this.sel.team2]].forEach(function(x){
        var row = el("div", "pg-vs-team"); x[1].forEach(function(id, k){ var ch = self._char(id), m = el("span", "pg-tm on" + (k === 0 ? " first" : ""), '<i>' + (k + 1) + '</i>');
          m.title = ch ? ch.name : id; if (ch) setMug(m, ch); row.appendChild(m); });
        scr.querySelector(x[0]).appendChild(row); });
    }
    var cvs = scr.querySelectorAll("canvas");
    var a = new Preview(cvs[0], { fill: 0.92, foot: 0.99 }), b = new Preview(cvs[1], { flip: true, fill: 0.92, foot: 0.99 });
    a.set(c1); b.set(c2);
    this._sfx("round");
    var bar = scr.querySelector(".pg-load i"), msg = scr.querySelector(".pg-vs-msg");
    var t0 = performance.now(), MIN = REDUCED ? 600 : 1800, ready = !this.preload, failed = null;
    if (this.preload){
      this.preload({ mode: this.sel.mode, p1: this.sel.p1, p2: this.sel.p2, team1: this.sel.team1, team2: this.sel.team2, stage: this.sel.stage }, function(f){ bar.style.width = Math.round(f * 100) + "%"; })
        .then(function(){ ready = true; bar.style.width = "100%"; })
        .catch(function(e){ failed = e; msg.textContent = "No se pudo cargar el combate: " + e.message; console.error(e); });
    }
    this._foci = []; var done = false;
    Loop.add(function(t){
      a.draw(t); b.draw(t);
      if (done || failed) return;
      if (ready && t - t0 >= MIN){ done = true; self._startMatch(); }
      else if (ready) msg.textContent = "¡A pelear!";
    });
  };
  P._startMatch = function(){
    // la etiqueta, la música y los modificadores de campaña valen solo para este VS (un Versus después no los hereda)
    var tag = this.sel.tag, track = this.sel.track || null, mods = this.sel.mods || null;
    this.sel.tag = null; this.sel.track = null; this.sel.mods = null;
    this.hide(); if (this.audio) this.audio.music(track || "fight");
    this.emit("start", { mode: this.sel.mode, p1: this.sel.p1, p2: this.sel.p2, team1: this.sel.team1, team2: this.sel.team2, teamVs: this.sel.teamVs,
      difficulty: this.sel.difficulty, stage: this.sel.stage, preloaded: !!this.preload, tag: tag, track: track, mods: mods,
      seed: this.sel.seed, cfg: this.sel.netCfg, side: this.sel.side });   // (seed/cfg/side: solo el reto Bluetooth)
  };

  // ======================================================== PAUSA
  P.pause = function(){
    var self = this, G = global.__PGGAME, cmdId = (G && G.defs && G.defs[0]) ? G.defs[0].id : null, train = !!(G && G.mode === "training");
    var scr = this._mount("pause", { over: true, cls: "pg-pause" });
    // (en Entrenamiento no hay rondas ni marcador que mostrar; su lugar lo toman los ajustes del maniquí)
    var m = G && G.match, left = function(T){ return T.status.filter(function(x){ return x !== "out"; }).length; };
    var info = (m && !train) ? ('<div class="pg-stat"><span class="h">Ronda</span><span class="v">' + m.round + '</span><span></span>' +
      (m.teams ? '<span class="h">En pie</span><span class="v">' + left(m.teams[0]) + ' – ' + left(m.teams[1]) + '</span><span></span>'
               : '<span class="h">Marcador</span><span class="v">' + m.wins[0] + ' – ' + m.wins[1] + '</span><span></span>') + '</div>') : "";
    scr.innerHTML = '<div class="pg-panel pg-side"><h1 class="pg-h">Pausa</h1>' + info + '<div class="pg-list">' +
      '<button class="pgb prim" id="p-resume">Continuar</button>' +
      (train ? '<button class="pgb" id="p-train">Ajustes del entrenamiento</button>' : '') +
      '<button class="pgb" id="p-rematch">' + (train ? 'Reiniciar posiciones' : 'Reiniciar combate') + '</button>' +
      (cmdId ? '<button class="pgb" id="p-cmds">Comandos</button>' : '') + '<button class="pgb" id="p-opts">Opciones</button>' +
      '<button class="pgb ghost" id="p-sel">Elegir otros luchadores</button><button class="pgb ghost" id="p-title">Salir al menú</button></div></div>';
    this._hints(scr.querySelector(".pg-panel"), ["nav", "ok", "back"]);
    this._click(scr, "#p-resume", function(){ self._sfx("cancel"); self.hide(); self.emit("resume"); });
    this._click(scr, "#p-rematch", function(){ self._sfx("confirm"); self.hide(); self.emit("rematch"); });
    this._click(scr, "#p-train", function(){ self._sfx("ui"); self.trainingOptions(); });
    this._click(scr, "#p-cmds", function(){ self._sfx("ui"); self.commands(cmdId, function(){ self.pause(); }, true); });
    this._click(scr, "#p-opts", function(){ self._sfx("ui"); self.options("pause"); });
    this._click(scr, "#p-sel", function(){ self.emit("stop"); self.select(); });
    this._click(scr, "#p-title", function(){ self.emit("stop"); self.title(); });
    this._armFocus("#p-resume");
  };

  // ======================================================== AJUSTES DEL ENTRENAMIENTO (desde la pausa; también en el teléfono)
  P.trainingOptions = function(){
    var self = this, G = global.__PGGAME; if (!G || G.mode !== "training") return this.pause();
    var scr = this._mount("trainOpts", { over: true, cls: "pg-pause" });
    scr.innerHTML = '<div class="pg-panel pg-side pg-side-wide"><h1 class="pg-h">Entrenamiento</h1><div class="pg-opts pg-opts-stack"></div>' +
      '<div class="pg-list"><button class="pgb prim" id="t-done">Volver a la pausa</button></div></div>';
    var box = scr.querySelector(".pg-opts");
    function row(label, help, labels, active, cb){ var r = el("div", "pg-opt pg-opt-tr"); r.innerHTML = '<label>' + label + (help ? '<small>' + help + '</small>' : '') + '</label>';
      var h = el("div", "pg-seg"); self._seg(h, labels, active, cb); r.appendChild(h); box.appendChild(r); }
    row("Maniquí", "Bloquea: de pie o agachado según el golpe (tecla G)", G.dummyLabels, G.dummy, function(i){ G.setDummy(i); });
    row("Barra de poder", "Infinita: tu barra siempre llena (tecla B)", ["Normal", "Infinita"], G.infMeter ? 1 : 0, function(i){ G.infMeter = (i === 1); });
    row("Mareo", "Activo: el maniquí se marea si recibe muchos golpes seguidos", ["Apagado", "Activo"], G.trainDizzy ? 1 : 0, function(i){ G.setTrainDizzy(i === 1); });
    this._hints(scr.querySelector(".pg-panel"), ["nav", "ok", "back"]);
    this._click(scr, "#t-done", function(){ self._sfx("cancel"); self.pause(); });
    this._armFocus(".pg-seg>button.on");
  };

  // ======================================================== RESULTADOS (estadísticas reales del combate)
  P.results = function(data){
    var self = this, scr = this._mount("results", { title: "Resultado", ctx: data.modeName || "", cls: "pg-res" });
    if (this.audio) this.audio.music("menu");
    var win = data.winner, wc = win >= 0 && data.ids ? this._char(data.ids[win]) : null;
    var campaign = data.campaign, campaignTitle = campaign ? (campaign.complete ? "Campaña completada" : "Combate " + (campaign.index + 1) + " de " + campaign.total) : "";
    var main = el("div", "pg-main"), TM = data.teams;
    // por equipos las estadísticas son del EQUIPO entero (no del último que quedó en pie)
    var st = data.stats || [{}, {}], names = TM ? ["Equipo J1", data.teamVs ? "Equipo J2" : "Equipo CPU"] : (data.names || ["P1", "P2"]);
    function row(label, k, fmt){ var a = st[0][k] || 0, b = st[1][k] || 0;
      return '<span>' + label + '</span><span class="v' + (a > b ? " w" : "") + '">' + (fmt ? fmt(a) : a) + '</span><span class="v' + (b > a ? " w" : "") + '">' + (fmt ? fmt(b) : b) + '</span>'; }
    main.innerHTML = '<div class="pg-res-hero pg-booth"><canvas></canvas></div><div class="pg-res-body">' +
      (TM ? '<h2 class="pg-res-win">' + (win < 0 ? "Empate" : win === 0 ? "Gana el equipo de J1" : (data.teamVs ? "Gana el equipo de J2" : "Gana el equipo de la CPU")) + '</h2>' +
            '<div class="pg-res-teams"></div><div class="pg-res-sub">' + (wc ? "Último en pie: " + esc(wc.name) : "Los dos equipos se quedaron sin luchadores") + '</div>'
          : '<h2 class="pg-res-win">' + (campaign && campaign.complete ? "¡Garravas ha caído!" : (wc ? esc(wc.name) + (data.ids && data.ids[0] === data.ids[1] ? (win === 0 ? " (J1)" : (data.modeName === "Versus" ? " (J2)" : " (CPU)")) : "") + " gana" : "Empate")) + '</h2><div class="pg-res-sub">' + (campaign ? esc(campaignTitle) + ' · Rondas ' + data.wins[0] + ' – ' + data.wins[1] : 'Rondas ' + data.wins[0] + ' – ' + data.wins[1]) + '</div>') +
      (campaign && campaign.unlocked ? '<div class="pg-res-unlock" role="status">¡Desbloqueaste a <b>' + esc(campaign.unlocked.name) + '</b>! Ya puedes elegirla en la selección de personajes.</div>' : '') +
      '<div class="pg-stat"><span class="h"></span><span class="h v">' + esc(names[0]) + '</span><span class="h v">' + esc(names[1]) + '</span>' +
      row("Daño causado", "damage") + row("Combo más largo", "maxCombo", function(v){ return v >= 2 ? v + " golpes" : "—"; })   /* 1 golpe suelto no es combo */ +
      row("Especiales y súpers", "specials") + row("Agarres conectados", "throws") + '</div>' +
      '<div class="pg-row"><button class="pgb prim" id="r-again">' + (campaign && campaign.status === "retry" ? "Reintentar combate" : "Revancha") + '</button>' + (campaign && campaign.status === "next" ? '<button class="pgb prim" id="r-next">Siguiente combate</button>' : '') + (campaign && campaign.complete ? '<button class="pgb prim" id="r-ending">Ver final</button>' : '') + '<button class="pgb" id="r-sel">Elegir otros luchadores</button><button class="pgb ghost" id="r-title">Salir al menú</button></div></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok"]);
    if (TM){ var box = main.querySelector(".pg-res-teams");   // los dos equipos con quién quedó en pie (tachado = eliminado)
      TM.forEach(function(T, sd){ var row = el("div", "pg-res-team p" + (sd + 1));
        T.ids.forEach(function(id, k){ var ch = self._char(id), m = el("span", "pg-tm on" + (T.status[k] === "out" ? " out" : ""), '<i>' + (k + 1) + '</i>');
          m.title = (ch ? ch.name : id) + (T.status[k] === "out" ? " (eliminado)" : " (en pie)"); if (ch) setMug(m, ch); row.appendChild(m); });
        box.appendChild(row); }); }
    if (wc){ var pv = new Preview(main.querySelector("canvas"), { clip: "victory_pose", fill: 0.82 }); pv.set(wc); Loop.add(function(t){ pv.draw(t); }); }
    this._click(main, "#r-again", function(){ self._sfx("confirm"); self.hide(); self.emit(campaign ? "arcadeRetry" : "rematch"); });
    this._click(main, "#r-next", function(){ self._sfx("confirm"); self.hide(); self.emit("arcadeNext"); });
    this._click(main, "#r-ending", function(){ self._sfx("confirm"); self.hide(); self.emit("arcadeEnding"); });
    this._click(main, "#r-sel", function(){ self._sfx("ui"); if (TM){ self.sel.mode = "team"; self.teamSelect(); } else self.select(); });
    this._click(main, "#r-title", function(){ self._sfx("cancel"); self.title(); });
    this._armFocus("#r-again");
  };
  P.campaignEnding = function(data){
    var self=this, you=this._char(data.yourId), scr=this._mount("campaignEnding", { title:"La cuenta pendiente", ctx:"ESCAPE DE PUENTE GRANDE III · ARCHIVO CERRADO", wall:true, cls:"pg-ending" });
    if (this.audio){ this.audio.music("menu"); this.audio.sfx("boss"); }
    var main=el("div", "pg-main pg-ending-main");
    main.innerHTML='<div class="pg-ending-copy"><span class="pg-cine-tag">GUADALAJARA // DESPUÉS DEL ÚLTIMO ASALTO</span><h2>Garravas cayó.</h2>'+
      '<p>El penal volvió a quedar en silencio. Afuera, las luces de Guadalajara siguieron encendidas como si nada hubiera pasado.</p>'+ 
      '<p>Tobi, el Sobrino, no recuperó la vida que le robaron. Recuperó algo más peligroso: la decisión de no volver a pertenecerle a nadie.</p>'+
      '<p class="pg-ending-quote">La fuga terminó. La leyenda apenas comienza.</p></div>'+ 
      '<div class="pg-ending-credit"><b>LEGEND OF PRESOS</b><span>El escape de Puente Grande</span><small>Campaña completada · '+esc(data.length || 5)+' combates</small><small>Una producción independiente de Puente Grande</small></div>'+ 
      '<div class="pg-row"><button class="pgb prim" id="e-credits">Ver créditos</button><button class="pgb ghost" id="e-title">Volver al menú</button></div>';
    scr.appendChild(main); this._hints(scr,["nav","ok"]);
    this._click(main,"#e-credits",function(){ self._sfx("confirm"); self._credits(data); });
    this._click(main,"#e-title",function(){ self._sfx("cancel"); self.title(); });
    this._armFocus("#e-credits");
  };
  P._credits = function(data){
    var self=this, scr=this._mount("campaignEnding", { title:"Créditos", ctx:"GRACIAS POR JUGAR", wall:true, cls:"pg-ending pg-credits" });
    if (this.audio){ this.audio.music("menu"); this.audio.sfx("round"); }
    var main=el("div","pg-main pg-ending-main");
    main.innerHTML='<div class="pg-ending-copy"><span class="pg-cine-tag">ARCHIVO DE PRODUCCIÓN</span><h2>El escape continúa.</h2><p>Gracias por recorrer la campaña de Legend of Presos.</p></div>'+
      '<div class="pg-credit-list"><span>DISEÑO Y DIRECCIÓN</span><b>Equipo Legend of Presos</b><span>ENGINE</span><b>Simulación determinista · PixiJS</b><span>ARTE Y ANIMACIÓN</span><b>Atlas de personajes · escenarios parallax · FX separados</b><span>HISTORIA</span><b>Tobi «el Sobrino» · Guadalajara · Puente Grande</b></div>'+
      '<div class="pg-row"><button class="pgb prim" id="c-title">Volver al menú</button></div>';
    scr.appendChild(main); this._hints(scr,["nav","ok"]);
    this._click(main,"#c-title",function(){ self._sfx("cancel"); self.title(); }); this._armFocus("#c-title");
  };

  // ======================================================== OPCIONES (pestañas)
  P.options = function(back, tab){
    var self = this; this._optBackMode = back; this._optBack = function(){ if (back === "pause") self.pause(); else self.title(); };
    var scr = this._mount("options", { title: "Opciones", ctx: "Se guardan en este dispositivo", over: back === "pause", wall: back !== "pause", cls: "pg-optscene" });
    var tabs = [["audio", "Audio"], ["match", "Partida"], ["controls", "Controles"], ["screen", "Pantalla"], ["keys", "Teclas"]]; tab = tab || this._optTab || "audio"; this._optTab = tab;
    var main = el("div", "pg-main"); main.style.flexDirection = "column";
    main.innerHTML = '<div class="pg-tabs">' + tabs.map(function(t){ return '<button class="pg-tab' + (t[0] === tab ? " on" : "") + '" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join("") + '</div><div class="pg-opts"></div>' +
      '<div class="pg-row"><button class="pgb" id="o-back">Listo</button></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok", "back"]);
    if (this.store.persistError) main.insertAdjacentHTML("afterbegin", '<p class="pg-empty">' + esc(this.store.persistError) + '</p>');
    main.querySelectorAll(".pg-tab").forEach(function(b){ b.addEventListener("click", function(){ self._sfx("ui"); self.options(back, b.dataset.t); }); });
    this._click(main, "#o-back", function(){ self._sfx("cancel"); self.emit("optionsChanged"); self._optBack(); });
    var box = main.querySelector(".pg-opts"), S = this.store;
    function opt(label, help, control){ var r = el("div", "pg-opt"); r.innerHTML = '<label>' + label + (help ? '<small>' + help + '</small>' : '') + '</label>'; r.appendChild(control); box.appendChild(r); return r; }
    function range(k, apply){ var w = el("div", "pg-range"), inp = el("input"), out = el("output"); inp.type = "range"; inp.min = 0; inp.max = 100; inp.value = Math.round(S.get(k) * 100);
      out.textContent = inp.value; inp.setAttribute("aria-label", k); inp.addEventListener("input", function(){ var v = inp.value / 100; S.set(k, v); out.textContent = inp.value; apply(v); });
      w.appendChild(inp); w.appendChild(out); return w; }
    function sw(k, apply, disabled){ var b = el("button", "pg-switch" + (S.get(k) ? " on" : "")); b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", !!S.get(k));
      if (disabled) b.disabled = true;
      b.addEventListener("click", function(){ var v = !S.get(k); S.set(k, v); b.classList.toggle("on", v); b.setAttribute("aria-checked", v); self._sfx("ui"); if (apply) apply(v); }); return b; }
    function seg(labels, active, cb){ var h = el("div", "pg-seg"); self._seg(h, labels, active, cb); return h; }
    if (tab === "audio"){
      opt("Volumen general", null, range("volume", function(v){ if (self.audio) self.audio.setVolume(v); }));
      opt("Música", null, range("musicVolume", function(v){ if (self.audio) self.audio.setMusicVolume(v); }));
      opt("Silenciar todo", "También con la tecla M", sw("muted", function(v){ if (self.audio) self.audio.setMuted(v); }));
    } else if (tab === "match"){
      opt("Dificultad de la CPU", "Arcade y entrenamiento", seg(DIFF, S.get("difficulty") - 1, function(i){ S.set("difficulty", i + 1); self.sel.difficulty = i + 1; }));
      opt("Rondas para ganar", null, seg(["1", "2", "3"], S.get("roundsToWin") - 1, function(i){ S.set("roundsToWin", i + 1); }));
      var rt = S.get("roundTime"); opt("Tiempo por ronda", null, seg(["60 s", "99 s", "Sin límite"], rt === 60 ? 0 : rt === 99 ? 1 : 2, function(i){ S.set("roundTime", [60, 99, 5940][i]); }));
    } else if (tab === "controls"){
      // vista previa EN VIVO de los controles táctiles (los mismos de combate, montados sobre un controlador de prueba)
      // pantalla EN MINIATURA: un "teléfono" del tamaño real de esta pantalla, reducido con scale (así la proporción
      // botones/arena es la que verás en combate)
      var prevBox = el("div", "pg-touchprev"); prevBox.innerHTML = '<div class="pg-touchprev-scr"><div class="pg-touchprev-arena"><span>Arena</span></div><div class="pg-touchprev-pad"></div></div>';
      function preview(){ if (!global.PGTouch || !global.PGInput) return;
        var scrn = prevBox.querySelector(".pg-touchprev-scr"), host = prevBox.querySelector(".pg-touchprev-pad"), W = window.innerWidth, H = window.innerHeight;
        var k = Math.min(1, (prevBox.clientWidth || 600) / W); scrn.style.width = W + "px"; scrn.style.height = H + "px"; scrn.style.transform = "scale(" + k + ")";
        prevBox.style.height = Math.round(H * k) + "px";
        var ins = PGTouch.mount(host, new PGInput.Controller({}), { preview: true }).insets(), ar = prevBox.querySelector(".pg-touchprev-arena");
        var imm = S.get("touchArena") === "immersive"; ar.style.left = (imm ? 0 : ins.l / k) + "px"; ar.style.right = (imm ? 0 : ins.r / k) + "px"; }
      function pct(k, min, max, def, apply){ var w = el("div", "pg-range"), inp = el("input"), out = el("output"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = 5;
        inp.value = Math.round((S.get(k) == null ? def : S.get(k)) * 100); out.textContent = inp.value + " %"; inp.setAttribute("aria-label", k);
        inp.addEventListener("input", function(){ S.set(k, inp.value / 100); out.textContent = inp.value + " %"; if (apply) apply(); });
        w.appendChild(inp); w.appendChild(out); return w; }
      var tp = S.get("touchPad"); opt("Controles táctiles", "Automático = solo en pantallas táctiles", seg(["Automático", "Siempre", "Ocultos"], tp === "on" ? 1 : tp === "off" ? 2 : 0, function(i){ S.set("touchPad", ["auto", "on", "off"][i]); }));
      opt("Arena", "Despejada = los luchadores quedan entre los controles, nunca debajo. Inmersiva = pantalla completa", seg(["Despejada", "Inmersiva"], S.get("touchArena") === "immersive" ? 1 : 0, function(i){ S.set("touchArena", i ? "immersive" : "clear"); preview(); }));
      opt("Tamaño de botones", null, pct("touchScale", 70, 140, 1, preview));
      opt("Opacidad", null, pct("touchOpacity", 30, 100, 0.85, preview));
      opt("Joystick", "Flotante = aparece donde apoyes el pulgar (recomendado)", seg(["Flotante", "Fijo"], S.get("touchStick") === "fixed" ? 1 : 0, function(i){ S.set("touchStick", i ? "fixed" : "float"); preview(); }));
      opt("Mano", "Zurdo = botones a la izquierda", seg(["Diestro", "Zurdo"], S.get("touchLefty") ? 1 : 0, function(i){ S.set("touchLefty", !!i); preview(); }));
      var tl = S.get("touchLayout") || "classic"; opt("Etiquetas", null, seg(["P · K · ESP · SÚP", "A · B · C · D"], tl === "arcade" ? 1 : 0, function(i){ S.set("touchLayout", i === 1 ? "arcade" : "classic"); preview(); }));
      var dz = S.get("touchDeadZone") || 0.30; opt("Zona muerta del joystick", "Pequeña = responde antes", seg(["Pequeña", "Normal", "Amplia"], dz <= 0.22 ? 0 : dz >= 0.38 ? 2 : 1, function(i){ S.set("touchDeadZone", [0.20, 0.30, 0.40][i]); preview(); }));
      var rr = el("div", "pg-opt"); rr.appendChild(prevBox); box.appendChild(rr); preview();
      var rsT = el("button", "pgb ghost", "Restablecer controles"); rsT.type = "button";
      rsT.addEventListener("click", function(){ ["touchScale", "touchOpacity", "touchStick", "touchLefty", "touchArena", "touchLayout", "touchDeadZone", "touchPad"].forEach(function(k){ S.set(k, S.DEFAULTS[k]); }); self._sfx("ui"); self.options(back, "controls"); });
      var r3 = el("div", "pg-row"); r3.appendChild(rsT); box.appendChild(r3);
    } else if (tab === "screen"){
      opt("Efectos de golpe", "Simples = sin sprites de efectos (más rápido en equipos modestos)", seg(["Completos", "Simples"], S.get("fxQuality") === "simple" ? 1 : 0, function(i){ S.set("fxQuality", i ? "simple" : "full"); }));
      // APK: vibración nativa por evento (AndroidBridge.playHaptic). Navegador: navigator.vibrate solo al recibir golpes.
      var nativeVib = !!(global.AndroidBridge && typeof global.AndroidBridge.playHaptic === "function"), canVib = nativeVib || !!(navigator.vibrate);
      opt(nativeVib ? "Vibración" : "Vibrar al recibir golpes",
          nativeVib ? "Golpes, guardias, K.O. y botones táctiles" : canVib ? "Solo en teléfonos" : "Este dispositivo no permite vibración",
          sw("vibrate", null, !canVib));
      var sk = S.get("shake"), reduced = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (sk == null) sk = reduced ? "soft" : "full";
      opt("Sacudida y destellos", "Suaves o apagados si los movimientos bruscos de la cámara te molestan", seg(["Normales", "Suaves", "Apagados"], sk === "off" ? 2 : sk === "soft" ? 1 : 0, function(i){ S.set("shake", ["full", "soft", "off"][i]); }));
      opt("Cajas de golpe al iniciar", "En combate se alternan con F", sw("showBoxes"));
    } else {
      var grid = el("div", "pg-keys"); grid.innerHTML = '<span class="h">Acción</span><span class="h">Jugador 1</span><span class="h">Jugador 2</span>';
      var maps = [self._keymap(1), self._keymap(2)];
      ACTIONS.forEach(function(a){
        grid.insertAdjacentHTML("beforeend", "<span>" + a[1] + "</span>");
        [0, 1].forEach(function(p){ var b = el("button", "pg-kbtn", esc(keyName(maps[p][a[0]][0]))); b.type = "button";
          b.addEventListener("click", function(){ self._listenKey(b, p + 1, a[0]); }); grid.appendChild(b); });
      });
      var r = el("div", "pg-opt"); r.appendChild(grid); box.appendChild(r);
      var rs = el("button", "pgb ghost", "Restablecer teclas"); rs.type = "button";
      rs.addEventListener("click", function(){ S.set("keysP1", null); S.set("keysP2", null); self._sfx("ui"); self.options(back, "keys"); });
      var r2 = el("div", "pg-row"); r2.appendChild(rs); r2.insertAdjacentHTML("beforeend", '<span class="pg-empty">Mando: cruceta o stick mueve · A puño · B patada · X especial · Y súper · gatillos guardia · Start pausa</span>');
      box.appendChild(r2);
    }
    this._armFocus(".pg-tab.on");
  };
  function keyName(k){ return k === " " ? "Espacio" : k === "arrowleft" ? "←" : k === "arrowright" ? "→" : k === "arrowup" ? "↑" : k === "arrowdown" ? "↓" : k === "shift" ? "Shift" : (k || "—").toUpperCase(); }
  P._keymap = function(p){
    var base = p === 1 ? PGInput.P1_KEYS : PGInput.P2_KEYS, over = this.store.get(p === 1 ? "keysP1" : "keysP2"), out = {};
    Object.keys(base).forEach(function(a){ out[a] = (over && over[a]) ? over[a].slice() : base[a].slice(); }); return out;
  };
  // captura la siguiente tecla para una acción; si ya la usaba otra acción del mismo jugador, se intercambian
  P._listenKey = function(btn, p, action){
    var self = this; if (this._capture) return;
    btn.classList.add("wait"); btn.textContent = "Pulsa una tecla";
    this._capture = function(e){
      e.preventDefault(); e.stopPropagation();
      var k = e.key.toLowerCase(); self._capture = null; document.removeEventListener("keydown", self._capKey, true);
      if (k === "escape"){ self.options(self._optBackMode, "keys"); return; }   // cancelar sin cambios
      var map = self._keymap(p), old = map[action][0];
      Object.keys(map).forEach(function(a){ if (a !== action && map[a].indexOf(k) >= 0) map[a] = [old]; });
      map[action] = [k]; self.store.set(p === 1 ? "keysP1" : "keysP2", map); self._sfx("confirm");
      self.options(self._optBackMode, "keys");
    };
    this._capKey = function(e){ if (self._capture) self._capture(e); };
    document.addEventListener("keydown", this._capKey, true);
  };

  // ======================================================== COMANDOS
  P.commands = function(charId, backFn, over){
    var self = this, playable = this._playable(), ch = this._char(charId) || playable[0];
    this._cmdBack = backFn || this.title.bind(this);
    var scr = this._mount("commands", { title: "Comandos", ctx: "", over: !!over, cls: "pg-cmd" });
    var main = el("div", "pg-main");
    var km = this._keymap(1);
    // costo de la cancelación de guardia leído de la config real (no escrito a mano)
    var GG = global.__PGGAME, CF = GG && GG.cfgBase, gcTxt = (CF && CF.guardCancel && CF.guardCancel.enabled) ? ("<span>Cancelar guardia: P+K bloqueando (" + Math.round(CF.guardCancel.cost / CF.meter.max * 100) + "% de barra)</span>") : "";
    main.innerHTML = '<div class="pg-cmd-who"><button class="pgb" id="c-prev" aria-label="Luchador anterior">◄</button><span class="pg-mug"></span>' +
      '<div><h2 class="pg-name" style="font-size:var(--t-xl)">' + esc(ch.name) + '</h2><div class="pg-alias" style="color:var(--sodio)">' + esc((ch.perfil && ch.perfil.alias) || "") + '</div></div>' +
      '<button class="pgb" id="c-next" aria-label="Luchador siguiente">►</button></div>' +
      '<div class="pg-sys">' + [["Mover", keyName(km.left[0]) + keyName(km.right[0])], ["Saltar", keyName(km.up[0])], ["Agacharse", keyName(km.down[0])], ["Puño", keyName(km.punch[0])],
        ["Patada", keyName(km.kick[0])], ["Especial", keyName(km.special[0])], ["Súper", keyName(km.super[0])], ["Guardia", keyName(km.block[0])]].map(function(x){ return "<span>" + key(x[1]) + " " + x[0] + "</span>"; }).join("") +
      '<span>Dash: adelante ×2</span><span>Retroceso: atrás ×2</span><span>Súper salto: abajo → arriba</span><span>Salto corto: toca arriba</span><span>Rodada: P+K</span><span>Recuperación al caer: P+K</span><span>Agarre / escape: Guardia+P</span>' + gcTxt + '<span>Modo MAX: P+SP</span><span>Mareado: machaca botones</span></div>' +
      '<div class="pg-cmd-table" id="c-list"><p class="pg-empty">Cargando movimientos…</p></div><div class="pg-row"><button class="pgb" id="c-back">Volver</button></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok", "back"]);
    setMug(main.querySelector(".pg-mug"), ch);
    var i = playable.indexOf(ch);
    this._click(main, "#c-prev", function(){ self._sfx("ui"); self.commands(playable[(i - 1 + playable.length) % playable.length].id, backFn, over); self._armFocus("#c-prev"); });
    this._click(main, "#c-next", function(){ self._sfx("ui"); self.commands(playable[(i + 1) % playable.length].id, backFn, over); self._armFocus("#c-next"); });
    this._click(main, "#c-back", function(){ self._sfx("cancel"); self._cmdBack(); });
    loadDef(ch).then(function(def){
      var rows = ['<div class="pg-cmd-row head"><span>Movimiento</span><span>Comando</span><span>Daño</span></div>'];
      function tag(mv){ var t = mv.spawns ? "proyectil" : mv.type === "command_grab" ? "agarre" : mv.guardType === "overhead" ? "elevado" : mv.guardType === "low" ? "bajo" :
        mv.advance ? "avance" : (mv.invuln && mv.launcher && !mv.super) ? "antiaéreo" : (mv.multiHit ? "multigolpe" : ""); return t ? '<i class="pg-cmd-tag">' + t + '</i>' : ""; }
      // daño REAL (el de la pelea): con el equilibrio de config.balance (multiplicador del personaje y tope de súpers/ocultos)
      var BAL = (global.__PGGAME && global.__PGGAME.cfgBase && global.__PGGAME.cfgBase.balance) || null, hidSet = {};
      (def.inputs.hidden || []).forEach(function(h){ hidSet[h.move] = 1; });
      function dmg(mv, name){
        var raw = mv.spawns ? (mv.spawns.damage || 0) * (mv.spawns.hits || 1) : mv.multiHit && mv.hitFrames ? (mv.damage || 0) * mv.hitFrames.length : (mv.damage || 0);
        if (!raw) return "";
        if (BAL && BAL.enabled){
          if (mv.super && !mv.spawns){ var cap = (mv.hidden || hidSet[name]) ? BAL.hiddenMax : BAL.superMax; if (cap && raw > cap) raw = cap; }
          var k = BAL.chars && BAL.chars[def.id]; if (typeof k === "number" && k > 0) raw = raw * Math.sqrt(k);   // contra un rival de poder neutro (pg_sim: ×√m)
        }
        return Math.round(raw);
      }
      function inp(s){ return '<span class="pg-cmd-in">' + (MOTION[s.motion] ? '<span>' + MOTION[s.motion] + '</span> +' : '') + key(BTN[s.button] || s.button) + '</span>'; }
      function grp(t){ rows.push('<div class="pg-cmd-row grp"><span>' + t + '</span></div>'); }
      function line(s){ var mv = def.moves[s.move] || {}; rows.push('<div class="pg-cmd-row"><span class="pg-cmd-nm">' + esc(moveLabel(s.move, mv)) + tag(mv) + '</span>' + inp(s) + '<span class="pg-cmd-dm">' + dmg(mv, s.move) + '</span></div>'); }
      // NORMALES con su frame data real (arranque y ventaja en guardia salen de mv.frames / blockstun: no se escriben a mano)
      function fd(mv){ if (!mv.frames) return ""; var F = mv.frames, adv = (mv.blockstun != null && !mv.air) ? mv.blockstun - (F.active - 1 + F.recovery) : null;   // en el aire la ventaja depende del aterrizaje: no se muestra
        return '<i class="pg-cmd-fd">arranque ' + F.startup + 'f' + (adv != null ? ' · en guardia ' + (adv > 0 ? "+" : "") + adv : '') + '</i>'; }
      function nline(label, keys, mvName){ var mv = def.moves[mvName]; if (!mv) return;
        var chain = mvName.indexOf("heavy_") === 0 && ((def.moves[mvName === "heavy_punch" ? "punch" : "kick"] || {}).cancelInto || []).indexOf(mvName) >= 0;
        rows.push('<div class="pg-cmd-row"><span class="pg-cmd-nm">' + esc(label || moveLabel(mvName, mv)) + tag(mv) + (chain ? '<i class="pg-cmd-tag">cadena</i>' : '') + fd(mv) + '</span><span class="pg-cmd-in">' + keys + '</span><span class="pg-cmd-dm">' + dmg(mv, mvName) + '</span></div>'); }
      var fw = def.inputs.forward || {};
      grp("Normales");
      nline("Puño", key(BTN.punch), "punch"); nline("Patada", key(BTN.kick), "kick");
      if (fw.punch) nline(null, '<span>→</span> +' + key(BTN.punch), fw.punch);
      if (fw.kick) nline(null, '<span>→</span> +' + key(BTN.kick), fw.kick);
      nline("Puño en el aire", '<span>↑</span> ' + key(BTN.punch), "j_punch"); nline("Patada en el aire", '<span>↑</span> ' + key(BTN.kick), "j_kick");
      grp("Especiales"); (def.inputs.specials || []).forEach(line);
      if ((def.inputs.supers || []).length){ grp("Súpers (barra llena)"); def.inputs.supers.forEach(line); }
      if ((def.inputs.hidden || []).length){ grp("Ocultos (solo en modo MAX)"); def.inputs.hidden.forEach(line); }
      grp("Agarres"); if (def.moves.throw) rows.push('<div class="pg-cmd-row"><span class="pg-cmd-nm">Agarre</span><span class="pg-cmd-in">' + key("Guardia") + "+" + key("P") + '</span><span class="pg-cmd-dm">' + def.moves.throw.damage + '</span></div>');
      var host = main.querySelector("#c-list"); if (host) host.innerHTML = rows.join("");
    }).catch(function(e){ var h = main.querySelector("#c-list"); if (h) h.innerHTML = '<p class="pg-empty">' + esc(e.message) + '</p>'; });
    this._armFocus("#c-back");
  };

  // ======================================================== TORNEO
  P.tournamentSetup = function(){
    var self = this, playable = this._playable();
    this._tourPick = this._tourPick || this.store.get("lastP1") || playable[0].id; if (!this._char(this._tourPick)) this._tourPick = playable[0].id;
    this._tourLen = this._tourLen || 5;
    this._tourFmt = this._tourFmt || 0; // 0 = 1v1, 1 = Equipos (3v3)
    this._tourTeam = this._tourTeam || (this.store.get("lastTeam1") || [playable[0].id, playable[1].id, playable[2].id]);
    this._tourTeam = this._tourTeam.slice(0, 3);
    while (this._tourTeam.length < 3) this._tourTeam.push(playable[this._tourTeam.length].id);
    this._tourTeamSlot = 0;

    var scr = this._mount("tourSetup", { title: "Torneo", ctx: "Elige formato, luchadores y número de rivales", cls: "pg-sel" });
    var main = el("div", "pg-main");
    main.innerHTML = '<div class="pg-duel" style="grid-template-columns:minmax(0,1fr)">' + this._fileHTML(0, "1P") + '</div>' +
      '<div id="t-team-bar" style="display:' + (this._tourFmt === 1 ? 'flex' : 'none') + ';gap:12px;align-items:center;margin:6px 0;flex-wrap:wrap;">' +
        '<span style="font-weight:700;color:var(--sodio);">Tu equipo (3):</span>' +
        '<div class="pg-tour-slots" style="display:flex;gap:8px;"></div>' +
        '<button class="pgb" id="t-rnd-team" style="min-height:30px;padding:0 10px;font-size:12px;">Al azar</button>' +
      '</div>' +
      '<div class="pg-roster-head"><b>ARCHIVO DE COMBATE</b><small>DESLIZA PARA EXPLORAR</small></div><div class="pg-cells" aria-label="Cartas de peleadores"></div>' +
      '<div class="pg-bar">' +
      '<div class="pg-field">Formato <div class="pg-seg" id="t-fmt"></div></div>' +
      '<div class="pg-field">Rivales <div class="pg-seg" id="t-len"></div></div>' +
      '<div class="pg-bar-actions"><button class="pgb ghost" id="t-back">Volver</button><button class="pgb prim" id="t-go">Empezar torneo</button></div></div>';
    scr.appendChild(main); this._hints(scr, ["nav", "ok", "back"]);
    var file = main.querySelector(".pg-file"); file.classList.add("active");
    var pv = new Preview(file.querySelector("canvas")); Loop.add(function(t){ pv.draw(t); });
    var cells = main.querySelector(".pg-cells"); enableRosterRail(cells, function(id){ show(id); });
    playable.forEach(function(c){ var b = el("button", "pg-cell", "");
      b.dataset.id = c.id; b.title = c.name; makeFighterCard(b, c);
      b.addEventListener("click", function(){ self._sfx("ui"); pick(c.id); }); cells.appendChild(b); });

    var slotsCont = main.querySelector(".pg-tour-slots");
    for (var k = 0; k < 3; k++){
      var sBtn = el("button", "pg-tm", '<i>' + (k + 1) + '</i>');
      sBtn.dataset.k = k;
      sBtn.addEventListener("click", function(){ self._tourTeamSlot = +this.dataset.k; refresh(); });
      slotsCont.appendChild(sBtn);
    }

    function pick(id){
      if (self._tourFmt === 1){
        var idx = self._tourTeam.indexOf(id);
        if (idx >= 0 && idx !== self._tourTeamSlot){
          var t = self._tourTeam[self._tourTeamSlot];
          self._tourTeam[self._tourTeamSlot] = id;
          self._tourTeam[idx] = t;
        } else {
          self._tourTeam[self._tourTeamSlot] = id;
        }
        self._tourTeamSlot = (self._tourTeamSlot + 1) % 3;
      } else {
        self._tourPick = id;
      }
      centerRosterCard(cells, id, true); refresh();
    }

    this._click(main, "#t-rnd-team", function(){
      self._sfx("ui");
      var pool = playable.slice();
      for (var i = pool.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      self._tourTeam = pool.slice(0, 3).map(function(c){ return c.id; });
      refresh();
    });

    this._seg(main.querySelector("#t-fmt"), ["1 contra 1", "Equipos (3v3)"], self._tourFmt, function(i){
      self._tourFmt = i;
      main.querySelector("#t-team-bar").style.display = (i === 1 ? "flex" : "none");
      refresh();
    });
    this._seg(main.querySelector("#t-len"), ["3", "5", "7"], [3, 5, 7].indexOf(this._tourLen), function(i){ self._tourLen = [3, 5, 7][i]; });
    this._click(main, "#t-back", function(){ self._sfx("cancel"); self.title(); });
    this._click(main, "#t-go", function(){
      self._sfx("confirm");
      if (self._tourFmt === 1){
        self.store.set("lastTeam1", self._tourTeam.slice());
        self.emit("tournamentStart", { team: true, team1: self._tourTeam.slice(), length: self._tourLen });
      } else {
        self.store.set("lastP1", self._tourPick);
        self.emit("tournamentStart", { team: false, yourId: self._tourPick, length: self._tourLen });
      }
    });

    var shown = null;
    this._onFocus = function(e){ if (e.classList.contains("pg-cell") && e.classList.contains("pg-center")) show(e.dataset.id); };
    function show(id){ if (shown === id) return; shown = id; var ch = self._char(id); pv.set(ch); self._fillDossier(file.querySelector(".pg-dossier"), ch); pgFileSwap(file); }
    function refresh(){
      var activeId = self._tourFmt === 1 ? (self._tourTeam[self._tourTeamSlot] || self._tourTeam[0]) : self._tourPick;
      show(activeId);
      if (self._tourFmt === 1){
        var btns = slotsCont.querySelectorAll(".pg-tm");
        btns.forEach(function(b, k){
          var id = self._tourTeam[k], ch = id ? self._char(id) : null;
          b.classList.toggle("on", !!id);
          b.classList.toggle("first", k === self._tourTeamSlot);
          if (ch) setMug(b, ch);
        });
        cells.querySelectorAll(".pg-cell").forEach(function(c){
          var idx = self._tourTeam.indexOf(c.dataset.id);
          c.classList.toggle("pick1", idx >= 0);
          var mk = c.querySelectorAll(".pg-mk"); for (var k = 0; k < mk.length; k++) mk[k].remove();
          if (idx >= 0) c.insertAdjacentHTML("beforeend", '<span class="pg-mk a">' + (idx + 1) + '</span>');
        });
      } else {
        cells.querySelectorAll(".pg-cell").forEach(function(c){
          c.classList.toggle("pick1", c.dataset.id === self._tourPick);
          var mk = c.querySelectorAll(".pg-mk"); for (var k = 0; k < mk.length; k++) mk[k].remove();
          if (c.dataset.id === self._tourPick) c.insertAdjacentHTML("beforeend", '<span class="pg-mk a">1P</span>');
        });
      }
    }
    refresh(); centerRosterCard(cells, self._tourFmt === 1 ? self._tourTeam[self._tourTeamSlot] : self._tourPick, false);
    this._armFocus(self._tourFmt === 1 ? '#t-go' : ('.pg-cell[data-id="' + this._tourPick + '"]'));
  };

  P.tournamentLadder = function(data){
    var self = this, you = this._char(data.yourId);
    var isTeam = !!data.isTeam;
    var teamNames = isTeam && data.yourTeam ? data.yourTeam.map(function(id){ var c=self._char(id); return c?c.name:id; }).join(", ") : "";
    var count = isTeam ? data.opponentTeams.length : data.opponents.length;
    var scr = this._mount("tourLadder", { title: isTeam ? "Torneo por equipos" : "Torneo", ctx: (isTeam ? "Tu equipo: " + teamNames : esc(you ? you.name : data.yourId)) + " · victorias " + data.idx + " de " + count, wall: true });
    if (this.audio) this.audio.music("menu");
    var main = el("div", "pg-main"); main.style.flexDirection = "column";
    var lad = el("div", "pg-ladder");
    for (var i = 0; i < count; i++){
      var cls = i < data.idx ? "done" : i === data.idx ? "now" : "todo";
      var d = el("div", "pg-door " + cls);
      if (isTeam){
        var oppT = data.opponentTeams[i];
        var mugsHtml = '<div style="display:flex;gap:4px;">';
        oppT.forEach(function(oid){ mugsHtml += '<span class="pg-mug" data-oid="' + oid + '"></span>'; });
        mugsHtml += '</div>';
        var oppNames = oppT.map(function(oid){ var c = self._char(oid); return c ? c.name : oid; }).join(" · ");
        d.innerHTML = mugsHtml + '<div><b>' + esc(oppNames) + '</b><div class="st">' +
          (i < data.idx ? "Vencido" : i === data.idx ? "Siguiente equipo · CPU " + DIFF[(data.difficulties[i] || 2) - 1] : "Bloqueado") + '</div></div><span class="st">' + (i + 1) + ' de ' + count + '</span>';
        d.querySelectorAll(".pg-mug").forEach(function(m){ var c = self._char(m.dataset.oid); if (c) setMug(m, c); });
      } else {
        var oid = data.opponents[i], oc = self._char(oid);
        d.innerHTML = '<span class="pg-mug"></span><div><b>' + esc(oc ? oc.name : oid) + '</b><div class="st">' +
          (i < data.idx ? "Vencido" : i === data.idx ? "Siguiente rival · CPU " + DIFF[(data.difficulties[i] || 2) - 1] : "Bloqueado") + '</div></div><span class="st">' + (i + 1) + ' de ' + count + '</span>';
        if (oc) setMug(d.querySelector(".pg-mug"), oc);
      }
      lad.appendChild(d);
    }
    main.appendChild(lad);
    main.insertAdjacentHTML("beforeend", '<div class="pg-row"><button class="pgb prim" id="l-go">Pelear</button><button class="pgb ghost" id="l-quit">Abandonar torneo</button></div>');
    scr.appendChild(main); this._hints(scr, ["nav", "ok"]);
    this._click(main, "#l-go", function(){ self._sfx("confirm"); self.emit("tournamentNext"); });
    this._click(main, "#l-quit", function(){ self._sfx("cancel"); self.emit("stop"); self.title(); });
    var now = lad.querySelector(".now"); if (now && now.scrollIntoView) now.scrollIntoView({ block: "center" });
    this._armFocus("#l-go");
  };

  P.tournamentChampion = function(data){
    var self = this, you = this._char(data.yourId);
    var isTeam = !!data.isTeam;
    var scr = this._mount("tourChampion", { title: "Torneo terminado", ctx: data.length + " de " + data.length + " " + (isTeam ? "equipos vencidos" : "rivales vencidos"), cls: "pg-res", wall: true });
    if (this.audio){ this.audio.music("menu"); this.audio.sfx("round"); }
    var main = el("div", "pg-main");
    var teamSub = isTeam && data.yourTeam ? "El equipo (" + data.yourTeam.map(function(id){ var c=self._char(id); return c?c.name:id; }).join(", ") + ") venció a todos los equipos del torneo."
      : (esc(you ? you.name : data.yourId) + ' venció a todos los rivales del torneo.');
    main.innerHTML = '<div class="pg-res-hero pg-booth"><canvas></canvas></div><div class="pg-res-body"><h2 class="pg-res-win">' + (isTeam ? '¡Equipo Campeón de Puente Grande!' : 'Campeón de Puente Grande') + '</h2>' +
      '<div class="pg-res-sub">' + teamSub + '</div>' +
      '<div class="pg-row"><button class="pgb prim" id="ch-again">Otro torneo</button><button class="pgb ghost" id="ch-title">Salir al menú</button></div></div>';
    scr.appendChild(main);
    if (you){ var pv = new Preview(main.querySelector("canvas"), { clip: "victory_pose", fill: 0.82 }); pv.set(you); Loop.add(function(t){ pv.draw(t); }); }
    this._click(main, "#ch-again", function(){ self._sfx("confirm"); self.tournamentSetup(); });
    this._click(main, "#ch-title", function(){ self.emit("stop"); self.title(); });
    this._armFocus("#ch-again");
  };

  P.tournamentGameOver = function(data){
    var self = this, isTeam = !!data.isTeam, oc = this._char(data.byId);
    var oppName = isTeam && data.oppTeam ? data.oppTeam.map(function(id){ var c=self._char(id); return c?c.name:id; }).join(", ") : (oc ? oc.name : data.byId);
    var scr = this._mount("tourGameOver", { title: "Eliminado", ctx: "Combate " + (data.idx + 1) + " de " + data.length, cls: "pg-res", wall: true });
    if (this.audio){ this.audio.music("menu"); this.audio.sfx("ko"); }
    var main = el("div", "pg-main");
    main.innerHTML = '<div class="pg-res-hero pg-booth"><canvas></canvas></div><div class="pg-res-body"><h2 class="pg-res-win">Te venció ' + (isTeam ? 'el equipo rival' : esc(oppName)) + '</h2>' +
      '<div class="pg-res-sub">' + (isTeam ? 'Rival: ' + esc(oppName) + '. ' : '') + 'Puedes repetir este combate sin perder tu avance.</div>' +
      '<div class="pg-row"><button class="pgb prim" id="go-retry">Repetir combate</button><button class="pgb" id="go-new">Nuevo torneo</button><button class="pgb ghost" id="go-title">Salir al menú</button></div></div>';
    scr.appendChild(main);
    if (oc){ var pv = new Preview(main.querySelector("canvas"), { clip: "victory_pose", fill: 0.82 }); pv.set(oc); Loop.add(function(t){ pv.draw(t); }); }
    this._click(main, "#go-retry", function(){ self._sfx("confirm"); self.emit("tournamentRetry"); });
    this._click(main, "#go-new", function(){ self._sfx("ui"); self.tournamentSetup(); });
    this._click(main, "#go-title", function(){ self.emit("stop"); self.title(); });
    this._armFocus("#go-retry");
  };

  PGFrontend.loadDef = loadDef; PGFrontend.mugURL = mugURL; PGFrontend.keyName = keyName;
  global.PGFrontend = PGFrontend;
})(window);
