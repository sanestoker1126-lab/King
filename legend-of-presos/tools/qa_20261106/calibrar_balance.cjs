// Calibra config.balance.chars (multiplicador de daño por personaje) con torneos todos contra todos de la simulación real
// (CPU nivel 3 en los dos lados). Cada vuelta acerca el % de victorias de cada uno al 50 %: m *= (0.5/p)^0.6 (paso
// acotado a ×0.8..×1.25, total 0.6..2.2) y se normaliza para que la media geométrica sea 1 (el ritmo general no cambia).
// Uso: node calibrar_balance.cjs <raiz> [vueltas=4] > resultado.json   (no escribe en el proyecto: imprime el JSON)
const fs = require('fs'), path = require('path'), vm = require('vm');
const [root, vueltasA = '4'] = process.argv.slice(2), vueltas = +vueltasA;
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_cinematics.js', 'engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const Sim = ctx.PGSim, AI = ctx.PGAI, base = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(path.join(root, 'data/roster.json'), 'utf8')).characters.filter(c => c.status === 'playable').map(c => c.id);
const D = Object.fromEntries(ids.map(id => [id, def(id)]));
const mul = Object.fromEntries(ids.map(id => [id, (base.balance && base.balance.chars && base.balance.chars[id]) || 1]));
function tourney(){
  const cfg = JSON.parse(JSON.stringify(base)); cfg.balance = Object.assign({}, cfg.balance, { enabled: true, chars: Object.assign({}, mul) });
  const W = Object.fromEntries(ids.map(id => [id, { w: 0, n: 0 }])); let k = 0;
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++){ if (i === j) continue;
    const m = Sim.createMatch(1000 + (k++) * 7, JSON.parse(JSON.stringify(cfg)), null), defs = [D[ids[i]], D[ids[j]]];
    for (let t = 0; t < 14000 && !m.over; t++){ const a = AI.decide(m, m.fighters[0], m.fighters[1], 3, defs[0]), b = AI.decide(m, m.fighters[1], m.fighters[0], 3, defs[1]); Sim.step(m, defs, [Object.assign({}, a), Object.assign({}, b)]); }
    W[ids[i]].n++; W[ids[j]].n++; if (m.winner === 0) W[ids[i]].w++; else if (m.winner === 1) W[ids[j]].w++; else { W[ids[i]].w += .5; W[ids[j]].w += .5; } }
  return Object.fromEntries(ids.map(id => [id, W[id].w / W[id].n]));
}
const hist = []; let best = null;   // se entrega la MEJOR vuelta medida (menor dispersión), no la última (puede oscilar)
for (let v = 0; v <= vueltas; v++){
  const p = tourney(), vals = Object.values(p), mean = vals.reduce((a, b) => a + b, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  hist.push({ vuelta: v, sd: +(sd * 100).toFixed(1), min: +(Math.min(...vals) * 100).toFixed(0), max: +(Math.max(...vals) * 100).toFixed(0) });
  console.error(`vuelta ${v}: dispersión ${(sd * 100).toFixed(1)} puntos · peor ${(Math.min(...vals) * 100).toFixed(0)} % · mejor ${(Math.max(...vals) * 100).toFixed(0)} %`);
  if (!best || sd < best.sd) best = { sd, vuelta: v, chars: Object.fromEntries(ids.map(id => [id, +mul[id].toFixed(3)])), winrate: Object.fromEntries(ids.map(id => [id, +(p[id] * 100).toFixed(0)])) };
  if (v === vueltas) { console.log(JSON.stringify({ chars: best.chars, winrate: best.winrate, mejorVuelta: best.vuelta, hist }, null, 1)); break; }
  for (const id of ids){ const f = Math.pow(0.5 / Math.max(0.03, Math.min(0.97, p[id])), 0.6); mul[id] = Math.max(0.6, Math.min(2.2, mul[id] * Math.max(0.8, Math.min(1.25, f)))); }
  const g = Math.exp(ids.reduce((a, id) => a + Math.log(mul[id]), 0) / ids.length); for (const id of ids) mul[id] /= g;
}
