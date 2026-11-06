/* pg_store.js — opciones persistentes (localStorage) con defaults y try/catch.
   No es estado de simulación; son preferencias del jugador. */
(function (global) {
  "use strict";
  var KEY = "pg_combate_opts_v1";
  var DEF = {
    difficulty: 2,       // 1 fácil, 2 normal, 3 difícil
    roundsToWin: 2,      // best-of-(2*n-1)
    roundTime: 99,
    volume: 0.8,
    musicVolume: 0.5,
    muted: false,
    stage: 0,
    lastP1: null,
    lastP2: null,
    lastMode: null,
    fxQuality: "full",   // "full" | "simple" (sin sprites de FX: equipos modestos)
    vibrate: true,       // vibración al recibir golpes (solo si navigator.vibrate existe)
    touchPad: "auto",    // "auto" | "on" | "off"
    touchDeadZone: 0.30, // 0.20 pequeña | 0.30 normal | 0.40 amplia
    touchLayout: "classic", // "classic" | "arcade"
    showBoxes: false,    // modo debug de cajas al iniciar un combate
    shake: null,         // "full" | "soft" | "off"; null = según el sistema ("reducir movimiento" -> suave)
    keysP1: null,        // reasignación de teclas {accion:[tecla]} (null = por defecto)
    keysP2: null,
    unlocked: []         // personajes ocultos desbloqueados (ids del roster); "Restablecer opciones" NO los borra
  };
  // Si el navegador bloquea el almacenamiento (modo privado, política), las opciones siguen en memoria
  // durante la sesión y el motivo queda en PGStore.persistError (la pantalla de opciones lo muestra).
  var persistError = null;
  function read(){
    try { var s = localStorage.getItem(KEY); if (!s) return Object.assign({}, DEF);
      return Object.assign({}, DEF, JSON.parse(s)); }
    catch(e){ persistError = "No se pudieron leer las opciones guardadas (" + e.message + "); se usan las de fábrica."; return Object.assign({}, DEF); }
  }
  function write(o){
    try { localStorage.setItem(KEY, JSON.stringify(o)); persistError = null; }
    catch(e){ persistError = "Este navegador no permite guardar opciones (" + e.message + "); valen solo en esta sesión."; }
  }
  var cache = read();
  global.PGStore = {
    all: function(){ return cache; },
    get: function(k){ return cache[k]; },
    set: function(k, v){ cache[k] = v; write(cache); return v; },
    merge: function(obj){ Object.assign(cache, obj); write(cache); return cache; },
    // restablecer opciones = preferencias de fábrica; lo desbloqueado jugando se conserva
    reset: function(){ var keep = (cache.unlocked || []).slice(); cache = Object.assign({}, DEF, { unlocked: keep }); write(cache); return cache; },
    isUnlocked: function(id){ return (cache.unlocked || []).indexOf(id) >= 0; },
    unlock: function(id){ var u = (cache.unlocked || []).slice(); if (u.indexOf(id) < 0) u.push(id); cache.unlocked = u; write(cache); return u; },
    DEFAULTS: DEF,
    get persistError(){ return persistError; }
  };
})(window);
