/* pg_training.js — medición al frame para el modo Entrenamiento (spec §4.3 "ventaja/desventaja al frame
   calculada y consultable", §7 fase 7). SOLO LEE el MatchState después de cada paso: no cambia la simulación.

   Ventaja = (frame en que el DEFENSOR vuelve a poder actuar) − (frame en que el ATACANTE vuelve a poder actuar).
   +N: el atacante actúa N frames antes · −N: el defensor actúa antes (castigable si N ≥ startup del castigo).
   Los frames de hitstop no cuentan (match.frame no avanza durante el congelamiento, para ninguno de los dos).
   Un contacto nuevo sobre el mismo defensor antes de que se libere = el combo sigue (se mide al final del combo).
   Sin basura por frame: un único objeto de estado que se reutiliza. */
(function (global) {
  "use strict";
  // estados en los que un luchador acepta acciones de nuevo (andar, agacharse, bloquear, atacar, saltar)
  var FREE = { IDLE: 1, WALK_F: 1, WALK_B: 1, CROUCH: 1, BLOCK: 1 };

  function create(){
    return { on: false, def: -1, att: -1, kind: "", hits: 0, move: "", aFree: -1, dFree: -1, seen: [0, 0],
      last: { valid: false, adv: 0, kind: "", hits: 0, move: "", side: -1, frame: -1 } };
  }
  function reset(T, match){
    T.on = false; T.def = T.att = -1; T.last.valid = false;
    T.seen[0] = match ? match.fighters[0].taken : 0; T.seen[1] = match ? match.fighters[1].taken : 0;
  }
  // llamar UNA vez después de cada PGSim.step
  function observe(T, match){
    var F = match.fighters;
    if (F[0].taken < T.seen[0] || F[1].taken < T.seen[1]) reset(T, match);   // ronda nueva: luchadores recreados
    for (var i = 0; i < 2; i++){
      var f = F[i];
      if (f.taken === T.seen[i]) continue;
      T.seen[i] = f.taken;
      var blocked = f.state === "BLOCKSTUN" || f.state === "GUARD_CRUSH";
      if (T.on && T.def === i){ T.hits++; if (!blocked) T.kind = "hit"; T.aFree = -1; T.dFree = -1; }
      else { T.on = true; T.def = i; T.att = 1 - i; T.kind = blocked ? "block" : "hit"; T.hits = 1; T.move = F[1 - i].move || ""; T.aFree = -1; T.dFree = -1; }
      if (f.state === "GUARD_CRUSH") T.kind = "crush";
    }
    if (!T.on) return;
    var a = F[T.att], d = F[T.def];
    if (match.phase !== "fight" || d.state === "KO"){ T.on = false; return; }
    if (T.aFree < 0 && FREE[a.state]) T.aFree = match.frame;
    if (T.dFree < 0 && FREE[d.state]) T.dFree = match.frame;
    if (T.aFree >= 0 && T.dFree >= 0){
      var L = T.last; L.valid = true; L.adv = T.dFree - T.aFree; L.kind = T.kind; L.hits = T.hits; L.move = T.move; L.side = T.att; L.frame = match.frame;
      T.on = false;
    }
  }
  global.PGTraining = { create: create, reset: reset, observe: observe, FREE: FREE };
})(typeof window !== "undefined" ? window : this);
