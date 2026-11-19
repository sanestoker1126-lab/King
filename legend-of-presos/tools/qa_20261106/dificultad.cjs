// DIFICULTAD de la CPU con dos "jugadores" de referencia (aproximaciones, no humanos):
//  - novato     = la IA nivel 1;
//  - intermedio = la IA con los valores que tenía la CPU NORMAL antes del 2026-11-19 (react .48, aggro .06, combos .5...).
// Cada uno pelea contra la CPU fácil, normal y difícil en N parejas al azar (semilla fija); da el % de peleas que gana.
// Uso: node dificultad.cjs <raiz> [parejas=80]
const fs = require('fs'), path = require('path'), vm = require('vm');
const [root, nA = '80'] = process.argv.slice(2), N = +nA;
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_cinematics.js', 'engine/pg_ai.js']) if (fs.existsSync(path.join(root, f))) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const Sim = ctx.PGSim, AI = ctx.PGAI, cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(path.join(root, 'data/roster.json'), 'utf8')).characters.filter(c => c.status === 'playable').map(c => c.id);
let s = 12345; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const pairs = Array.from({ length: N }, () => [ids[Math.floor(rnd() * ids.length)], ids[Math.floor(rnd() * ids.length)]]);
cfg.ai = cfg.ai || {}; cfg.ai.levels = cfg.ai.levels || {};
cfg.ai.levels['2.5'] = { react: 0.48, aggro: 0.06, special: 0.025, jump: 0.01, spaceBack: 0.05, minGap: 58, mash: 0.15, combo: 0.5, maxUse: 0, punish: 0.5 };   // intermedio
for (const [pname, P] of [['novato', 1], ['intermedio', 2.5]]){
  const out = [];
  for (const L of [1, 2, 3]){ let w = 0;
    pairs.forEach(([a, b], k) => { const m = Sim.createMatch(500 + k, JSON.parse(JSON.stringify(cfg)), null), D = [def(a), def(b)];
      for (let t = 0; t < 14000 && !m.over; t++){ const i0 = AI.decide(m, m.fighters[0], m.fighters[1], P, D[0]), i1 = AI.decide(m, m.fighters[1], m.fighters[0], L, D[1]); Sim.step(m, D, [Object.assign({}, i0), Object.assign({}, i1)]); }
      if (m.winner === 0) w++; else if (m.winner < 0) w += .5; });
    out.push(`${['', 'fácil', 'normal', 'difícil'][L]} ${(100 * w / N).toFixed(0)} %`); }
  console.log(`${pname.padEnd(10)} gana contra CPU: ` + out.join(' · '));
}
