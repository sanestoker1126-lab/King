/* PGAI — IA por niveles. Produce un snapshot de input (misma interfaz que el
   jugador). Lee SOLO estado observable (posiciones, si el rival está atacando o en
   el aire, si está tendido) — no "hace trampa" leyendo buffers internos. Determinista: PRNG propio con semilla en me._ai.
   level 1=fácil, 2=normal, 3=difícil. Memoria por luchador en me._ai (se recrea por
   ronda, igual que el luchador). Especiales, súpers y ocultos se hacen con su COMANDO real (ejecutor de comandos:
   un cuadro por paso), con confirmación de golpe -> cancelación, MAX y juggle según el nivel. */
(function (global) {
  "use strict";

  // un snapshot REUTILIZADO por lado (sin objeto nuevo por frame). Quien llama no debe guardarlo: el simulador lo copia.
  var SNAP = [{}, {}];
  function blank(side){ var s = SNAP[side & 1]; s.x = 0; s.down = s.block = s.upPress = false;
    s.punchPress = s.kickPress = s.specialPress = s.superPress = false; return s; }

  // Parámetros: data/config.json -> "ai" (levels / range / cool). DEF_AI es el respaldo SOLO si la config no los trae.
  var DEF_AI = {
    levels: { 1: { react:0.22, aggro:0.03, special:0.01, jump:0.004, spaceBack:0.02, minGap:52, mash:0.08, combo:0.08, maxUse:0, punish:0 },
              2: { react:0.4, aggro:0.05, special:0.022, jump:0.01, spaceBack:0.05, minGap:58, mash:0.13, combo:0.4, maxUse:0, punish:0.3 },
              3: { react:0.62, aggro:0.08, special:0.04, jump:0.02, spaceBack:0.1, minGap:62, mash:0.25, combo:0.7, maxUse:0.03, punish:0.7 } },
    range: { inRange:92, close:130, airKick:120, airApproach:40, projectileReact:170, projectileJump:110, antiAir:96, zoning:220, downApproach:110, ukemiHeight:40 },
    cool: { zoning:40, special:22, punch:10, kick:12, crushPunish:6 }
  };

  // ---------- EJECUTOR DE COMANDOS ----------
  // La CPU hace los movimientos REALES del personaje (↓↘→, →↓↘, medias lunas, ↓↘→↓↘→), un cuadro por paso, como un
  // jugador: el simulador los lee con el mismo lector de comandos. Antes solo pulsaba el botón de atajo "especial", que
  // siempre lanzaba el PRIMER especial de la lista (la CPU casi solo usaba la Embestida y nunca un súper por comando).
  // Pasos: [x, abajo, botón] con x = 1 adelante (hacia el rival), -1 atrás, 0 nada.
  var MOTION = {
    qcf:  [[0,1],[1,1],[1,0]],
    qcb:  [[0,1],[-1,1],[-1,0]],
    dp:   [[1,0],[0,1],[1,1]],
    hcf:  [[-1,0],[-1,1],[0,1],[1,1],[1,0]],
    hcb:  [[1,0],[1,1],[0,1],[-1,1],[-1,0]],
    qcf2: [[0,1],[1,1],[1,0],[0,1],[1,1],[1,0]]
  };
  var BTN = { punch:"punchPress", kick:"kickPress", special:"specialPress", "super":"superPress" };
  // entradas para arrancar el move `name` de ESTE personaje (de sus datos inputs.*); null si no tiene comando
  function planFor(defs, name){
    var In = defs && defs.inputs; if (!In || !name) return null;
    var g = In.grounded || {}, fw = In.forward || {}, k;
    for (k in g) if (g[k] === name) return [[0,0,k]];
    for (k in fw) if (fw[k] === name) return [[1,0],[1,0,k]];
    var groups = ["specials", "supers", "hidden"];
    for (var gi = 0; gi < groups.length; gi++){ var L = In[groups[gi]] || [];
      for (var i = 0; i < L.length; i++){ if (L[i].move !== name) continue;
        var M = MOTION[L[i].motion]; if (!M) return [[0,0,L[i].button]];
        var out = M.map(function(st){ return [st[0], st[1]]; }); out[out.length-1] = [out[out.length-1][0], out[out.length-1][1], L[i].button];
        return out; } }
    return null;
  }
  function startPlan(mem, plan, why){ if (!plan) return false; mem.plan = plan; mem.pi = 0; mem.why = why || ""; return true; }   // why: qué regla lo decidió (solo diagnóstico, tools/qa_20261106/ai_stats.cjs)
  // emite el paso siguiente del plan en curso (true si emitió). Un plan se corta si a la CPU la golpean o la agarran.
  function runPlan(mem, snap, me, towards){
    if (!mem.plan) return false;
    if (me.state === "HITSTUN" || me.state === "LAUNCHED" || me.state === "THROWN" || me.state === "KO" || me.state === "DIZZY"){ mem.plan = null; return false; }
    var st = mem.plan[mem.pi++];
    if (st[0]) snap.x = st[0] * towards;
    snap.down = !!st[1];
    if (st[2]){ snap[BTN[st[2]]] = true; if (st[3]) snap[BTN[st[3]]] = true; }
    if (mem.pi >= mem.plan.length) mem.plan = null;
    return true;
  }
  function affordable(me, mv){ return (!mv.meterCost || me.meter >= mv.meterCost) && !(mv.transformsInto && me.transformed); }   // (Modo Vestía: una vez)
  function isHidden(defs, name){ var H = (defs.inputs && defs.inputs.hidden) || []; for (var i = 0; i < H.length; i++) if (H[i].move === name) return true; return false; }
  // ¿qué cancelar tras un golpe que CONECTÓ? Según el nivel: súper (si hay barra) > oculto (en MAX) > especial.
  // Respeta las reglas del juego: especial -> súper solo en MAX (config hit.superCancel), ocultos solo en MAX.
  function comboFollow(match, me, defs, level, r){
    var cur = defs.moves[me.move]; if (!cur || !cur.cancelInto || !cur.cancelInto.length) return null;
    var scMode = (match.cfg.hit && match.cfg.hit.superCancel) || "max";
    var sup = [], hid = [], sp = [];
    for (var i = 0; i < cur.cancelInto.length; i++){ var n = cur.cancelInto[i], mv = defs.moves[n]; if (!mv || !affordable(me, mv) || !planFor(defs, n)) continue;
      if (mv.type === "throw" || mv.type === "command_grab") continue;
      if (isHidden(defs, n)){ if (me.maxMode) hid.push(n); continue; }
      if (mv.super){ if (!cur.special || scMode === "always" || (scMode === "max" && me.maxMode)) sup.push(n); continue; }
      if (mv.special) sp.push(n); else if (level >= 3) sp.push(n);   // difícil también encadena normales (puño -> adelante+puño)
    }
    if (level >= 3 && hid.length) return hid[Math.floor(r * hid.length) % hid.length];
    if (level >= 3 && sup.length) return sup[0];
    if (level >= 2 && sp.length){
      // preferir el que DERRIBA o lanza (cierra el combo) y, si no, uno al azar
      var kd = sp.filter(function(n){ var m = defs.moves[n]; return m.launcher || m.knockdown || m.hardKnockdown; });
      var L = (kd.length && r < 0.6) ? kd : sp; return L[Math.floor(r * 997) % L.length]; }
    if (level >= 2 && sup.length && r < 0.5) return sup[0];
    return null;
  }
  // especiales del personaje por "papel" (leído de SUS datos, no del estado rival)
  function roles(defs){
    if (defs._aiRoles) return defs._aiRoles;
    var R = { proj:[], anti:[], rush:[], low:[], grab:[], supers:[], hidden:[] }, In = defs.inputs || {};
    (In.specials || []).forEach(function(s){ var m = defs.moves[s.move]; if (!m) return;
      if (m.type === "command_grab") R.grab.push(s.move);
      else if (m.spawns) R.proj.push(s.move);
      else if (m.launcher || m.invuln) R.anti.push(s.move);
      else if (m.guardType === "low") R.low.push(s.move);
      else R.rush.push(s.move); });
    (In.supers || []).forEach(function(s){ if (defs.moves[s.move]) R.supers.push(s.move); });
    (In.hidden || []).forEach(function(s){ if (defs.moves[s.move]) R.hidden.push(s.move); });
    try { Object.defineProperty(defs, "_aiRoles", { value: R, enumerable: false }); } catch (e) { /* datos congelados: se recalcula */ }
    return R;
  }
  function pick(list, r){ return list.length ? list[Math.floor(r * 7919) % list.length] : null; }

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
    if (runPlan(mem, snap, me, towards)) return snap;      // comando en curso (también durante la pausa de impacto)
    var R = roles(defs), oppStun = opp.state === "HITSTUN" || opp.state === "LAUNCHED";
    var comboP = T.combo != null ? T.combo : (level >= 3 ? 0.85 : level >= 2 ? 0.5 : 0.08);
    var oppAttacking = (opp.state==="ATTACK"||opp.state==="SPECIAL"||opp.state==="SUPER"||opp.state==="AIR_ATTACK");
    var inRange = dist < RG.inRange;
    var closeIsh = dist < RG.close;

    // --- su golpe CONECTÓ (o lo bloquearon): CONFIRMAR y cancelar. Una decisión por golpe (mem.conf = id del golpe).
    // En golpe: especial / súper / oculto según nivel. En guardia: a veces un especial seguro para presionar.
    if (me.state !== "ATTACK" && me.state !== "SPECIAL") mem.conf = null;
    if ((me.state === "ATTACK" || me.state === "SPECIAL") && me.contact && mem.conf !== me.move){
      mem.conf = me.move;
      if (oppStun && r < comboP){ var nx = comboFollow(match, me, defs, level, PGRng.next(mem)); if (nx && startPlan(mem, planFor(defs, nx), "combo")){ runPlan(mem, snap, me, towards); return snap; } }
      else if (opp.state === "BLOCKSTUN" && me.state === "ATTACK" && level >= 2 && r < comboP * 0.3){ var nb = comboFollow(match, me, defs, 2, PGRng.next(mem));
        if (nb && !defs.moves[nb].launcher && startPlan(mem, planFor(defs, nb), "presion")){ runPlan(mem, snap, me, towards); return snap; } }
    }
    // --- JUGGLE: rival lanzado por MI golpe y yo libre en MAX -> rematar con súper/oculto en el aire (difícil) ---
    if (level >= 3 && opp.state === "LAUNCHED" && me.maxMode && me.grounded && (me.state === "IDLE" || me.state === "WALK_F" || me.state === "WALK_B") && dist < RG.close && r < comboP){
      var jf = pick(R.hidden.filter(function(n){ return affordable(me, defs.moves[n]); }).concat(R.supers.filter(function(n){ return affordable(me, defs.moves[n]); })), PGRng.next(mem));
      if (jf && startPlan(mem, planFor(defs, jf), "juggle")){ runPlan(mem, snap, me, towards); return snap; }
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
        var sk = pick(R.supers.filter(function(n){ return affordable(me, defs.moves[n]); }), r);
        if (level >= 2 && sk && startPlan(mem, planFor(defs, sk), "mareado")){ runPlan(mem, snap, me, towards); mem.cool = CL.special; }
        else if (fwd && fwd.punch){ snap.x = towards; snap.punchPress = true; mem.cool = CL.punch; }
        else { snap.punchPress = true; mem.cool = CL.punch; }
      }
      return snap;
    }
    // --- guardia rota del rival: castigar ---
    if (opp.state === "GUARD_CRUSH" && inRange && r < T.react){ if (mem.cool === 0){ snap.punchPress = true; mem.cool = CL.crushPunish; } return snap; }
    // --- CASTIGO: el rival falló y está en su recuperación (su golpe ya pasó: hitId vuelve a 0 sin contacto) ->
    // súper si hay barra, si no su especial más fuerte (normal y difícil). Lee solo lo visible: el rival "abierto".
    // (mem.oAct = el golpe rival YA tuvo su fase activa; sin eso, el arranque también tiene hitId 0 y se "castigaba" antes de tiempo)
    var oAtk = opp.state === "ATTACK" || opp.state === "SPECIAL" || opp.state === "SUPER";
    if (!oAtk) mem.oAct = null; else if (opp.hitId) mem.oAct = opp.move;
    var whiff = oAtk && mem.oAct === opp.move && !opp.contact && !opp.hitId;
    if (whiff && level >= 2 && dist < RG.close && mem.cool === 0 && r < T.react * (T.punish != null ? T.punish : (level >= 3 ? 0.9 : 0.5))){   // punish: data/config.json ai.levels
      var sups = R.supers.filter(function(n){ return affordable(me, defs.moves[n]); }).concat(me.maxMode ? R.hidden.filter(function(n){ return affordable(me, defs.moves[n]); }) : []);
      var pun = pick(sups, r) || pick(R.anti.concat(R.rush), r); mem.cool = CL.special;
      if (pun && startPlan(mem, planFor(defs, pun), "castigo")){ runPlan(mem, snap, me, towards); return snap; }
    }
    // --- defensa reactiva: el rival ataca cerca -> bloquear ---
    if (closeIsh && oppAttacking){
      if (r < T.react){ snap.block = true; return snap; }
      // a veces castigar con backdash defensivo (difícil)
      if (r < T.react + T.spaceBack){ snap.x = away; return snap; }
    }

    // --- anti-aéreo: rival en el aire y encima -> especial/golpe hacia arriba ---
    // solo contra un SALTO de verdad (antes cualquier rival "en el aire": el que yo mismo lancé o un paso atrás)
    if ((opp.state === "JUMP" || opp.state === "AIR_ATTACK") && opp.vy > -4 && dist < RG.antiAir && level >= 2 && r < T.react && mem.cool === 0){
      var aa = pick(R.anti, r); mem.cool = CL.special;
      if (aa && startPlan(mem, planFor(defs, aa), "antiaereo")){ runPlan(mem, snap, me, towards); return snap; }
      snap.punchPress = true; return snap;
    }

    // --- acercarse si está lejos ---
    if (!inRange){
      // mantener presión; salto ocasional para entrar
      if (closeIsh && r < T.jump){ snap.upPress = true; snap.x = towards; return snap; }
      // zonificación: a media/larga distancia lanza su arrojadizo (si su especial principal lo es)
      if (dist > RG.zoning && mem.cool === 0 && R.proj.length && r < T.special*0.6 && startPlan(mem, planFor(defs, pick(R.proj, r)), "zona")){ runPlan(mem, snap, me, towards); mem.cool = CL.zoning; return snap; }
      // entrada con especial que avanza (embestida) a media distancia, de vez en cuando
      // (probabilidad POR CUADRO: tiene que ser baja; antes se lanzaba desde lejos y fallaba casi siempre)
      if (level >= 2 && dist < RG.close + 10 && mem.cool === 0 && R.rush.length && r < T.special*0.12 && startPlan(mem, planFor(defs, pick(R.rush, r)), "entrada")){ runPlan(mem, snap, me, towards); mem.cool = CL.special; return snap; }
      snap.x = towards;
      return snap;
    }

    // --- en rango: ofensa con "enfriamiento" para no spamear ---
    if (mem.cool === 0){
      // MAX (Puño+Especial a la vez) con media barra: abre los cancelados especial->súper y los ocultos (difícil)
      var maxCost = (match.cfg.meter && match.cfg.meter.maxCost) || 50;
      if (level >= 3 && !me.maxMode && me.meter >= maxCost && r < (T.maxUse != null ? T.maxUse : 0.04)){ snap.punchPress = true; snap.specialPress = true; mem.cool = CL.special; return snap; }
      if (r < T.special*0.45){
        var all = R.rush.concat(R.low, R.grab, R.anti.length && level >= 2 && r < T.special*0.3 ? R.anti : []);
        var sp1 = pick(all, PGRng.next(mem)); mem.cool = CL.special;
        if (sp1 && startPlan(mem, planFor(defs, sp1), "neutral")){ runPlan(mem, snap, me, towards); return snap; }
        snap.specialPress = true; return snap; }
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
