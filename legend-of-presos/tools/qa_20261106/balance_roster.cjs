// EQUILIBRIO del roster con la simulación real: todos contra todos (CPU del mismo nivel en los dos lados, cada pareja en
// los dos lados de la pantalla) y % de victorias por personaje. Es una APROXIMACIÓN: mide cuánto rinde el kit en manos de
// la IA, no de un humano. Uso: node balance_roster.cjs <raiz> [nivel=3] [semillas=1] [--json salida]
const fs = require('fs'), path = require('path'), vm = require('vm');
const args = process.argv.slice(2), root = args[0], level = +(args[1] || 3), seeds = +(args[2] || 1);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_cinematics.js', 'engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const Sim = ctx.PGSim, AI = ctx.PGAI, cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(path.join(root, 'data/roster.json'), 'utf8')).characters.filter(c => c.status === 'playable').map(c => c.id);
const D = Object.fromEntries(ids.map(id => [id, def(id)]));
const W = Object.fromEntries(ids.map(id => [id, { w: 0, n: 0, dmg: 0, frames: 0 }]));
function fight(a, b, seed){
  const m = Sim.createMatch(seed, JSON.parse(JSON.stringify(cfg)), null), defs = [D[a], D[b]];
  for (let t = 0; t < 14000 && !m.over; t++){
    const i0 = AI.decide(m, m.fighters[0], m.fighters[1], level, defs[0]), i1 = AI.decide(m, m.fighters[1], m.fighters[0], level, defs[1]);
    Sim.step(m, defs, [Object.assign({}, i0), Object.assign({}, i1)]);
  }
  return m;
}
let k = 0;
for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++){ if (i === j) continue;
  for (let s = 0; s < seeds; s++){ const m = fight(ids[i], ids[j], 1000 + (k++) * 7);
    const w = m.winner; W[ids[i]].n++; W[ids[j]].n++;
    if (w === 0) W[ids[i]].w++; else if (w === 1) W[ids[j]].w++; else { W[ids[i]].w += .5; W[ids[j]].w += .5; } } }
const rows = ids.map(id => [id, W[id].w / W[id].n]).sort((x, y) => y[1] - x[1]);
const pct = rows.map(r => r[1]); const mean = pct.reduce((a, b) => a + b, 0) / pct.length, sd = Math.sqrt(pct.reduce((a, b) => a + (b - mean) ** 2, 0) / pct.length);
rows.forEach(([id, p]) => console.log(id.padEnd(26), (p * 100).toFixed(0).padStart(3) + ' %', '█'.repeat(Math.round(p * 40))));
console.log(`== nivel ${level} · ${k} peleas · dispersión (desv. estándar) ${(sd * 100).toFixed(1)} puntos · mejor ${(pct[0] * 100).toFixed(0)} % · peor ${(pct[pct.length - 1] * 100).toFixed(0)} % ==`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(Object.fromEntries(rows), null, 1));
