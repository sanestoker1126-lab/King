// QA del personaje nuevo: cada golpe de comando conecta a su distancia (motor real). Uso: node complementario_moves.cjs <raiz>
const fs = require('fs'), path = require('path'), vm = require('vm'); const root = process.argv[2] || '.';
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const Sim = ctx.PGSim, cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const defs = [def('personaje_complementario'), def('tobi')];
const N = o => Object.assign({ x: 0, down: false, block: false, upPress: false, punchPress: false, kickPress: false, specialPress: false, superPress: false }, o || {});
const SEQ = { embestida: [N({ down: true }), N({ down: true, x: 1 }), N({ x: 1, punchPress: true })],
  barrida: [N({ down: true }), N({ down: true, x: -1 }), N({ x: -1, kickPress: true })],
  super: [N({ down: true }), N({ down: true, x: 1 }), N({ x: 1 }), N({ down: true }), N({ down: true, x: 1 }), N({ x: 1, punchPress: true })] };
let fails = 0;
for (const [name, gaps] of [['embestida', [70, 120, 170]], ['barrida', [60, 80]], ['super', [50, 70, 90, 120]]]) for (const gap of gaps) {
  const m = Sim.createMatch(7, JSON.parse(JSON.stringify(cfg)), null);
  for (let i = 0; i < 200 && m.phase !== 'fight'; i++) Sim.step(m, defs, [N(), N()]);
  const [f, o] = m.fighters; f.x = 400; o.x = 400 + gap; f.meter = f.maxMeter; const hp0 = o.hp; let used = '', t0 = -1;
  for (let t = 0; t < 140; t++) { Sim.step(m, defs, [SEQ[name][t] || N(), N()]); if (f.move) used = f.move; if (t0 < 0 && o.hp < hp0) t0 = t; }
  const dmg = hp0 - o.hp, esperado = name === 'super' ? gap <= 90 : name === 'embestida' ? gap <= 120 : true, ok = used === name && ((dmg > 0) === esperado);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name} a ${gap}px: ejecutó=${used || '-'} daño=${dmg} impacto_t=${t0} rival=${o.state}${esperado ? '' : ' (fuera de alcance: no debe pegar)'}`); if (!ok) fails++;
}
console.log(fails ? fails + ' FALLA(S)' : 'TODO OK'); process.exit(fails ? 1 : 0);
