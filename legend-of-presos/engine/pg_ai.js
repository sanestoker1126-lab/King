/* PGAI — IA por niveles. Produce un snapshot de input (misma interfaz que el
   jugador). Lee SOLO estado observable (posiciones, si el rival está atacando o en
   el aire, si está tendido) — no "hace trampa" leyendo buffers internos. Determinista: PRNG propio con semilla en me._ai.
   level 1=fácil, 2=normal, 3=difícil. Memoria por luchador en me._ai (se recrea por
   ronda, igual que el luchador). Los especiales se lanzan con specialPress (fallback
   del sim, como el botón táctil), ya que la IA emite un frame a la vez. */
(function (global) {
  "use strict";

  // un snapshot REUTILIZADO por lado (sin objeto nuevo por frame). Quien llama no debe guardarlo: el simulador lo copia.
  var SNAP = [{}, {}];
  function blank(side){ var s = SNAP[side & 1]; s.x = 0; s.down = s.block = s.upPress = false;
    s.punchPress = s.kickPress = s.specialPress = s.superPress = false; return s; }

  // Parámetros: data/config.json -> "ai" (levels / range / cool). DEF_AI es el respaldo SOLO si la config no los trae.
  var DEF_AI = {
    levels: { 1: { react:0.22, aggro:0.030, special:0.010, jump:0.004, spaceBack:0.02, minGap:52, mash:0.08 },
              2: { react:0.48, aggro:0.060, special:0.025, jump:0.010, spaceBack:0.05, minGap:58, mash:0.15 },
              3: { react:0.80, aggro:0.100, special:0.050, jump:0.020, spaceBack:0.10, minGap:62, mash:0.25 } },
    range: { inRange:92, close:130, airKick:120, airApproach:40, projectileReact:170, projectileJump:110, antiAir:96, zoning:220, downApproach:110, ukemiHeight:40 },
    cool: { zoning:40, special:22, punch:10, kick:12, crushPunish:6 }
  };

  // ¿el primer especial (el que dispara specialPress) es un arrojadizo? (lee SUS propios datos, no el estado rival)
  function firstSpecialIsProjectile(defs){
    var sp = defs && defs.inputs && defs.inputs.specials && defs.inputs.specials[0];
    var mv = sp && defs.moves[sp.move]; return !!(mv && mv.spawns);
  }
  function decide(match, me, opp, level, defs){
    var snap = blank(me.side);
    if (!match || match.phase !== "fight") return snap;   // quieto en intro/ko
    level = level || 2; var AI = (match.cfg && match.cfg.ai) || DEF_AI, T = AI.levels[level] || AI.levels[2], RG = AI.range, CL = AI.cool;
    // flujo PRNG PROPIO de la IA (derivado de la semilla de la partida + lado): no consume el RNG de la
    // simulación y vive como número en me._ai (serializable con el MatchState). Nada de Math.random.
    // la ronda entra en la semilla: antes cada ronda repetía EXACTAMENTE las mismas decisiones (la IA se volvía predecible
    // y dos IA repetían la misma ronda hasta empatar la pelea)
    var mem = me._ai || (me._ai = { cool:0, commit:0, rngState:((match.seed ^ 0x9E3779B9) + me.side * 7919 + (match.round|0) * 104729) | 0 });
    var r = PGRng.next(mem);
    if (mem.cool > 0) mem.cool--;

    var dist = Math.abs(opp.x - me.x);
    var towards = opp.x > me.x ? 1 : -1;
    var away = -towards;
    var oppAttacking = (opp.state==="ATTACK"||opp.state==="SPECIAL"||opp.state==="SUPER"||opp.state==="AIR_ATTACK");
    var inRange = dist < RG.inRange;
    var closeIsh = dist < RG.close;

    // --- su golpe CONECTÓ: confirmar con cadena (Puño -> adelante+Puño) o cancelar a especial (normal y difícil) ---
    if (me.state === "ATTACK" && me.contact && level >= 2 && r < T.react){
      var fw = defs && defs.inputs && defs.inputs.forward;
      if (me.move === "punch" && fw && fw.punch){ snap.x = towards; snap.punchPress = true; return snap; }
      if (me.move === "kick" && fw && fw.kick){ snap.x = towards; snap.kickPress = true; return snap; }
      if (level >= 3 && r < T.react*0.5){ snap.specialPress = true; return snap; }
    }
    // --- mareado: machacar botones para despertar antes (más rápido cuanto más difícil) ---
    if (me.state === "DIZZY"){ if (r < (T.mash || 0)) snap.punchPress = true; return snap; }
    // --- agarrado: intentar escapar (Guardia+Puño) — normal y difícil ---
    if (me.state === "THROWN"){ if (level >= 2 && me.techWin > 0 && r < T.react*0.6){ snap.block = true; snap.punchPress = true; } return snap; }
    // --- bloqueando con barra: rodada de cancelación de guardia (solo difícil, de vez en cuando) ---
    var GC = match.cfg && match.cfg.guardCancel;
    if (me.state === "BLOCKSTUN" && level >= 3 && GC && GC.enabled && me.meter >= GC.cost && r < 0.04){ snap.block = true; snap.punchPress = true; snap.kickPress = true; return snap; }
    // --- derribado en el aire: recuperación (Puño+Patada) justo antes de tocar el piso (normal y difícil) ---
    if (me.state === "LAUNCHED"){
      if (level >= 2 && me.vy > 0 && match.cfg.arena.ground - me.y < RG.ukemiHeight && r < T.react){ snap.punchPress = true; snap.kickPress = true; }
      return snap;
    }
    // --- continuar salto iniciado: patada aérea al acercarse ---
    if (!me.grounded){
      snap.x = (dist > RG.airApproach) ? towards : 0;
      if (!me.airAtkUsed && dist < RG.airKick && r < 0.4) snap.kickPress = true;
      return snap;
    }

    // --- reacción a PROYECTIL visible que viene hacia mí: bloquear (o saltarlo en difícil, si está lejos) ---
    var P = match.projectiles || [];
    for (var i = 0; i < P.length; i++){ var p = P[i];
      if (p.owner === me.side) continue;
      var dx = me.x - p.x, coming = (dx > 0 && p.vx > 0) || (dx < 0 && p.vx < 0);
      if (coming && Math.abs(dx) < RG.projectileReact && r < T.react){
        if (level >= 3 && Math.abs(dx) > RG.projectileJump && r < T.react*0.35){ snap.upPress = true; snap.x = towards; return snap; }
        snap.block = true; snap.down = (p.guardType === "low"); return snap;
      }
    }

    // --- rival tendido o levantándose: es intocable; acercarse y esperar en guardia (no gastar golpes) ---
    if (opp.state === "KNOCKDOWN" || opp.state === "WAKEUP"){
      if (dist > RG.downApproach) snap.x = towards; else if (r < 0.5 + (level-1)*0.2) snap.block = true;
      return snap;
    }
    // --- rival MAREADO: acercarse y castigar con lo más fuerte que tenga (súper con barra llena, si no golpe fuerte) ---
    if (opp.state === "DIZZY"){
      if (dist > RG.inRange){ snap.x = towards; return snap; }
      if (mem.cool === 0 && r < T.react){
        var fwd = defs && defs.inputs && defs.inputs.forward;
        if (level >= 2 && me.meter >= me.maxMeter){ snap.superPress = true; mem.cool = CL.special; }
        else if (fwd && fwd.punch){ snap.x = towards; snap.punchPress = true; mem.cool = CL.punch; }
        else { snap.punchPress = true; mem.cool = CL.punch; }
      }
      return snap;
    }
    // --- guardia rota del rival: castigar ---
    if (opp.state === "GUARD_CRUSH" && inRange && r < T.react){ if (mem.cool === 0){ snap.punchPress = true; mem.cool = CL.crushPunish; } return snap; }
    // --- defensa reactiva: el rival ataca cerca -> bloquear ---
    if (closeIsh && oppAttacking){
      if (r < T.react){ snap.block = true; return snap; }
      // a veces castigar con backdash defensivo (difícil)
      if (r < T.react + T.spaceBack){ snap.x = away; return snap; }
    }

    // --- anti-aéreo: rival en el aire y encima -> especial/golpe hacia arriba ---
    if (!opp.grounded && dist < RG.antiAir && level >= 2 && r < T.react){
      if (me.meter >= 0) snap.specialPress = true; else snap.punchPress = true;
      return snap;
    }

    // --- acercarse si está lejos ---
    if (!inRange){
      // mantener presión; salto ocasional para entrar
      if (closeIsh && r < T.jump){ snap.upPress = true; snap.x = towards; return snap; }
      // zonificación: a media/larga distancia lanza su arrojadizo (si su especial principal lo es)
      if (dist > RG.zoning && mem.cool === 0 && firstSpecialIsProjectile(defs) && r < T.special*1.6){ snap.specialPress = true; mem.cool = CL.zoning; return snap; }
      snap.x = towards;
      // súper por botón si hay barra llena y a media distancia (difícil, oportunista)
      if (level >= 3 && me.meter >= me.maxMeter && r < 0.01) snap.superPress = true;
      return snap;
    }

    // --- en rango: ofensa con "enfriamiento" para no spamear ---
    if (mem.cool === 0){
      if (r < T.special && me.meter >= 10){ snap.specialPress = true; mem.cool = CL.special; return snap; }
      if (r < T.special + T.aggro){ snap.punchPress = true; mem.cool = CL.punch; return snap; }
      if (r < T.special + T.aggro*2){ snap.kickPress = true; mem.cool = CL.kick; return snap; }
      // golpe fuerte (adelante+Puño) si el personaje lo trae en sus datos
      if (r < T.special + T.aggro*2.5 && defs && defs.inputs && defs.inputs.forward && defs.inputs.forward.punch){ snap.x = towards; snap.punchPress = true; mem.cool = CL.kick; return snap; }
    }

    // --- microespaciamiento: no quedarse pegado ---
    if (dist < T.minGap && r < 0.20 + T.spaceBack){ snap.x = away; return snap; }
    if (r < 0.25){ snap.x = (r < 0.125 ? towards : away); }        // bailar un poco
    // bloquear por defecto de vez en cuando (difícil es más sólido)
    else if (r < 0.25 + (level-1)*0.08){ snap.block = true; }
    return snap;
  }

  global.PGAI = { decide, DEF_AI };
})(window);
