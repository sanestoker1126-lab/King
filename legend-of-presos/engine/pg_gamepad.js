/* pg_gamepad.js — soporte de mando (Gamepad API estándar).
   Produce un SNAPSHOT con la misma forma que PGInput (x,down,block,upPress,
   punchPress,kickPress,specialPress,superPress), con detección de flanco propia.
   Se fusiona por OR con el teclado en el bucle del juego, así cada jugador puede
   usar teclado y/o mando indistintamente. No altera la simulación. Modular. */
(function (global) {
  "use strict";

  var DEAD = 0.45;
  var prev = {};      // padIndex -> estado previo (snapshot de juego)
  var prevMenu = {};  // padIndex -> estado previo (navegación de menús, independiente)
  var prevStart = {}; // padIndex -> estado previo del botón START (toggle de pausa)

  function pads() {
    return (navigator.getGamepads ? navigator.getGamepads() : []) || [];
  }
  function connected() {
    var p = pads(), n = 0;
    for (var i=0;i<p.length;i++) if (p[i]) n++;
    return n;
  }

  // Mapeo estándar: A=0 puño, B=1 patada, X=2 especial, Y=3 súper, LB/RB/LT/RT=guardia.
  function readPad(gp) {
    var ax = gp.axes || [], bt = gp.buttons || [];
    var b = function (i){ return bt[i] && (bt[i].pressed || bt[i].value > 0.5); };
    var axX = ax[0]||0, axY = ax[1]||0;
    var left  = b(14) || axX < -DEAD;
    var right = b(15) || axX >  DEAD;
    var up    = b(12) || axY < -DEAD;
    var down  = b(13) || axY >  DEAD;
    return {
      left:left, right:right, up:up, down:down,
      block:  b(4)||b(5)||b(6)||b(7),
      punch:  b(0), kick: b(1), special: b(2), super: b(3),
      start:  b(9), back: b(8)
    };
  }

  var PGGamepad = {
    connected: connected,
    // snapshot de entrada para el jugador en el índice de mando dado (o null si no hay mando)
    snapshot: function (padIndex) {
      var ps = pads(), gp = ps[padIndex||0];
      if (!gp) return null;
      var cur = readPad(gp);
      var pv = prev[padIndex] || {};
      var edge = function (k){ return cur[k] && !pv[k]; };
      var snap = {
        x: (cur.left?-1:0) + (cur.right?1:0),
        down: !!cur.down, block: !!cur.block, up: !!cur.up,
        upPress: edge("up"),
        punchPress: edge("punch"), kickPress: edge("kick"),
        specialPress: edge("special"), superPress: edge("super"),
        startPress: edge("start"), backPress: edge("back")
      };
      prev[padIndex] = cur;
      return snap;
    },
    // navegación de menús por flanco (independiente del snapshot de juego)
    menuSnapshot: function (padIndex) {
      padIndex = padIndex||0;
      var ps = pads(), gp = ps[padIndex];
      if (!gp) return null;
      var cur = readPad(gp);
      var pv = prevMenu[padIndex] || {};
      var edge = function (k){ return cur[k] && !pv[k]; };
      var snap = { up:edge("up"), down:edge("down"), left:edge("left"), right:edge("right"),
        confirm:edge("punch")||edge("start"), back:edge("kick")||edge("back") };
      prevMenu[padIndex] = cur;
      return snap;
    },
    // ¿se presionó START en algún mando? (rastreo propio, no toca el snapshot de juego)
    anyStart: function () {
      var ps = pads(), hit=false;
      for (var i=0;i<ps.length;i++){ if (!ps[i]) continue;
        var bt = ps[i].buttons||[]; var start = !!(bt[9] && (bt[9].pressed||bt[9].value>0.5));
        if (start && !prevStart[i]) hit=true; prevStart[i]=start; }
      return hit;
    }
  };
  global.PGGamepad = PGGamepad;
})(window);
