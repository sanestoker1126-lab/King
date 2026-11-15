// Qué hace la CPU en peleas CPU contra CPU (simulación real + pg_ai.js): variedad de especiales, súpers y ocultos por
// comando, combos (golpes seguidos sin que el rival se recupere), MAX y juggles. Uso:
//   node ai_stats.cjs <raiz> [nivel=3] [peleas=24] [frames=6000]
const fs = require('fs'), path = require('path'), vm = require('vm');
const [root, lvA = '3', nA = '24', frA = '6000'] = process.argv.slice(2);
const level = +lvA, N = +nA, FR = +frA;
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_cinematics.js', 'engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const Sim = ctx.PGSim, AI = ctx.PGAI, cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(path.join(root, 'data/roster.json'), 'utf8')).characters.filter(c => c.status === 'playable').map(c => c.id);
const T = { why: {}, spHit: 0, specials: {}, supers: 0, hidden: 0, maxAct: 0, combos2: 0, combos3: 0, comboMax: 0, juggles: 0, distinctPerFight: [], errors: 0, frames: 0 };
for (let k = 0; k < N; k++) {
  const a = ids[(k * 7) % ids.length], b = ids[(k * 11 + 5) % ids.length], D = [def(a), def(b)];
  const hidden = D.map(d => new Set((d.inputs.hidden || []).map(h => h.move)));
  const m = Sim.createMatch(1000 + k, JSON.parse(JSON.stringify(cfg)), null);
  const prev = ['', ''], prevMax = [false, false], seen = [new Set(), new Set()], prevCombo = [0, 0];
  try {
    for (let t = 0; t < FR && !m.over; t++) {
      const i0 = AI.decide(m, m.fighters[0], m.fighters[1], level, D[0]), i1 = AI.decide(m, m.fighters[1], m.fighters[0], level, D[1]);
      Sim.step(m, D, [Object.assign({}, i0), Object.assign({}, i1)]); T.frames++;
      for (let s = 0; s < 2; s++) { const f = m.fighters[s], o = m.fighters[1 - s], mv = f.move && D[s].moves[f.move];
        const key = f.state + ':' + f.move;
        if (key !== prev[s] && mv) {
          if (hidden[s].has(f.move)) T.hidden++; else if (mv.super) T.supers++;
          else if (mv.special) { T.specials[f.move] = (T.specials[f.move] || 0) + 1; seen[s].add(f.move); f.__sp = 1; const w = (f._ai && f._ai.why) || 'boton'; T.why[w] = (T.why[w] || 0) + 1; }
          if (mv.super && o.state === 'LAUNCHED') T.juggles++;
        }
        if (f.__sp && f.state === 'SPECIAL' && (o.state === 'HITSTUN' || o.state === 'LAUNCHED' || o.state === 'BLOCKSTUN') && o.taken !== f.__t) { T.spHit++; f.__sp = 0; }
        if (f.state !== 'SPECIAL') f.__sp = 0;
        prev[s] = key; if (f.maxMode && !prevMax[s]) T.maxAct++; prevMax[s] = !!f.maxMode;
        if (f.comboCount === 2 && prevCombo[s] < 2) T.combos2++; if (f.comboCount === 3 && prevCombo[s] < 3) T.combos3++;
        T.comboMax = Math.max(T.comboMax, f.comboCount); prevCombo[s] = f.comboCount; }
    }
  } catch (e) { T.errors++; console.log('ERROR', a, b, e.message); }
  T.distinctPerFight.push(seen[0].size + seen[1].size);
}
const mins = T.frames / 3600, spTot = Object.values(T.specials).reduce((x, y) => x + y, 0);
const top = Object.entries(T.specials).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`nivel ${level} · ${N} peleas · ${mins.toFixed(1)} min de pelea`);
console.log(`especiales/min ${(spTot / mins).toFixed(1)} · nombres distintos ${Object.keys(T.specials).length} · por pelea (media) ${(T.distinctPerFight.reduce((x, y) => x + y, 0) / N).toFixed(1)} · conectan (golpe o guardia) ${(100 * T.spHit / Math.max(1, spTot)).toFixed(0)} % · más usados: ${top}`);
console.log('origen de los especiales: ' + JSON.stringify(T.why));
console.log(`súpers ${T.supers} · ocultos ${T.hidden} · MAX activados ${T.maxAct} · juggles (súper sobre rival lanzado) ${T.juggles}`);
console.log(`combos de 2+ golpes ${T.combos2} (${(T.combos2 / mins).toFixed(1)}/min) · de 3+ ${T.combos3} · combo más largo ${T.comboMax} · errores ${T.errors}`);
