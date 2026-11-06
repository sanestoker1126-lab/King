/* PRNG determinista con semilla (mulberry32). La semilla vive en MatchState,
   así misma semilla + mismos inputs = mismo resultado (spec 4.1). */
(function (global) {
  "use strict";
  function mulberry32(seed){
    let a = seed >>> 0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Variante SERIALIZABLE: el estado del generador vive en un campo numérico del objeto dueño
  // (holder.rngState), no en un closure. Así guardar/restaurar MatchState (JSON) conserva la posición
  // de la secuencia (requisito de rollback / repeticiones). Misma secuencia que mulberry32(seed).
  function next(holder){
    let a = (holder.rngState | 0); a = (a + 0x6D2B79F5) | 0; holder.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  global.PGRng = { mulberry32, next };
})(window);
