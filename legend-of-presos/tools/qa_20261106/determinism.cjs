// Pelea CPU vs CPU determinista con el motor real. Compara la jugabilidad entre dos raíces de proyecto (original vs nuevo).
// Uso: node determinism.cjs <raiz_A> <raiz_B> <p1> <p2> [semilla] [frames]
const fs = require('fs'), path = require('path'), vm = require('vm');
const [rA, rB, p1, p2, seed = '777', frames = '7200'] = process.argv.slice(2);
function load(root) {
  const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx; const win = ctx;
  for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
  return { Sim: win.PGSim, AI: win.PGAI, cfg: JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8')), defs: [def(p1), def(p2)] };
}
function run(root) {
  const E = load(root), m = E.Sim.createMatch(+seed, JSON.parse(JSON.stringify(E.cfg)), null);
  const trace = [], clipTrace = [];
  for (let t = 0; t < +frames && !m.over; t++) {
    const i0 = E.AI.decide(m, m.fighters[0], m.fighters[1], 3, E.defs[0]);
    const i1 = E.AI.decide(m, m.fighters[1], m.fighters[0], 3, E.defs[1]);
    E.Sim.step(m, E.defs, [i0, i1]);
    trace.push(m.fighters.map(f => [f.hp, Math.round(f.x * 100), Math.round(f.y * 100), f.state, f.move || '', f.meter, f.stun | 0].join(':')).join('|') + `|${m.phase}|${m.round}|${m.wins}`);
    clipTrace.push(m.fighters.map(f => f.clip).join('|'));
  }
  return { trace, clipTrace, over: m.over, winner: m.winner, wins: m.wins.slice(), frames: trace.length, clipsUsed: [...new Set(clipTrace.join('|').split('|'))].sort() };
}
const A = run(rA), B = run(rB);
let firstDiff = -1; for (let i = 0; i < Math.max(A.trace.length, B.trace.length); i++) if (A.trace[i] !== B.trace[i]) { firstDiff = i; break; }
console.log(`${p1} vs ${p2} semilla ${seed}: original frames=${A.frames} ganador=${A.winner} rondas=${A.wins} | nuevo frames=${B.frames} ganador=${B.winner} rondas=${B.wins}`);
console.log(firstDiff < 0 ? 'JUGABILIDAD IDÉNTICA cuadro a cuadro (vida, x, y, estado, golpe, barra, mareo, fase, ronda)' : `DIFERENTE desde el frame ${firstDiff}: ${A.trace[firstDiff]}  vs  ${B.trace[firstDiff]}`);
const nA = new Set(A.clipsUsed), nB = new Set(B.clipsUsed);
console.log('clips nuevos usados:', [...nB].filter(c => !nA.has(c)).join(', ') || '(ninguno)', '| clips que ya no se usan:', [...nA].filter(c => !nB.has(c)).join(', ') || '(ninguno)');
process.exit(firstDiff < 0 ? 0 : 1);
