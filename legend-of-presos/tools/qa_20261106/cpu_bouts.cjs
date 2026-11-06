// El Paisa contra varios rivales, CPU vs CPU (nivel 3), con el motor real. Uso: node cpu_bouts.cjs <raiz> <id> <rival1,rival2,...>
const fs = require('fs'), path = require('path'), vm = require('vm');
const [root, me, rivals] = process.argv.slice(2);
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const Sim = ctx.PGSim, AI = ctx.PGAI, cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
let bad = 0; const used = {}; let wins = 0, total = 0;
for (const r of rivals.split(',')) for (const [seed, side] of [[11, 0], [22, 1], [33, 0], [44, 1]]) {
  const defs = side === 0 ? [def(me), def(r)] : [def(r), def(me)];
  const m = Sim.createMatch(seed, JSON.parse(JSON.stringify(cfg)), null); let t = 0, err = null;
  try { for (; t < 30000 && !m.over; t++) { Sim.step(m, defs, [AI.decide(m, m.fighters[0], m.fighters[1], 3, defs[0]), AI.decide(m, m.fighters[1], m.fighters[0], 3, defs[1])]);
      const f = m.fighters[side]; if (f.move) used[f.move] = (used[f.move] || 0) + 1; } } catch (e) { err = e.stack.split('\n').slice(0, 2).join(' '); }
  total++; if (m.winner === side) wins++;
  if (err || !m.over) bad++;
  console.log(`${me} (lado ${side}) vs ${r} semilla ${seed}: ${err ? 'ERROR ' + err : m.over ? `terminó en ${t} frames, rondas ${m.wins}, gana ${m.winner === side ? me : r}` : 'NO TERMINÓ'}`);
}
console.log(`ganó ${wins}/${total}. golpes usados por la CPU (frames activos):`, JSON.stringify(used));
console.log(bad ? `PROBLEMAS: ${bad}` : 'SIN ERRORES, todas las peleas terminaron');
process.exit(bad ? 1 : 0);
