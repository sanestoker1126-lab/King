// Prueba funcional de movimientos con la simulación REAL (engine/pg_sim.js) en Node, sin navegador.
// Uso: node test_moves.cjs <raiz_proyecto> <id_atacante> [id_rival]
const fs = require('fs'), path = require('path'), vm = require('vm');
const [root, A, B = 'personaje_08'] = process.argv.slice(2);
const win = {}; const ctx = vm.createContext({ window: win, console, Math, JSON, Object, Array });
vm.runInContext(fs.readFileSync(path.join(root, 'engine/pg_sim.js'), 'utf8'), ctx, { filename: 'pg_sim.js' });
const Sim = win.PGSim;
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const dA = def(A), dB = def(B);
const N = () => ({ x: 0, down: false, block: false, upPress: false, punchPress: false, kickPress: false, specialPress: false, superPress: false });
const I = o => Object.assign(N(), o);
const seqs = {
  punch: [I({ punchPress: true })],
  kick: [I({ kickPress: true })],
  heavy_punch: [I({ x: 1 }), I({ x: 1, punchPress: true })],
  heavy_kick: [I({ x: 1 }), I({ x: 1, kickPress: true })],
  embestida_hombro: [I({ down: true }), I({ down: true, x: 1 }), I({ x: 1, punchPress: true })],
  uppercut: [I({ x: 1 }), N(), I({ down: true }), I({ down: true, x: 1, punchPress: true })],
  talon_giro: [I({ down: true }), I({ down: true, x: 1 }), I({ x: 1, kickPress: true })],
  barrida: [I({ down: true }), I({ down: true, x: -1 }), I({ x: -1, kickPress: true })],
  super: [I({ down: true }), I({ down: true, x: 1 }), I({ x: 1 }), I({ down: true }), I({ down: true, x: 1 }), I({ x: 1, punchPress: true })],
  throw: [I({ block: true, punchPress: true })],
  j_punch: [I({ upPress: true, x: 1 }), ...Array(23).fill(0).map(() => I({ x: 1 })), I({ x: 1, punchPress: true })],
  j_kick: [I({ upPress: true, x: 1 }), ...Array(21).fill(0).map(() => I({ x: 1 })), I({ x: 1, kickPress: true })],
};
let fails = 0;
function run(name, seq, gap) {
  const m = Sim.createMatch(12345, JSON.parse(JSON.stringify(cfg)), null);
  let guard = 0; while (m.phase !== 'fight' && guard++ < 1000) Sim.step(m, [dA, dB], [N(), N()]);
  const [f, o] = m.fighters; f.x = 400; o.x = 400 + gap;
  if (name === 'super') f.meter = f.maxMeter;
  const hp0 = o.hp, seen = new Set(), clips = new Set(); let hitFrame = -1, errs = null;
  try { for (let t = 0; t < 140; t++) { Sim.step(m, [dA, dB], [t < seq.length ? seq[t] : N(), N()]);
      if (f.move) seen.add(f.move); clips.add(f.clip); if (hitFrame < 0 && o.hp < hp0) hitFrame = t; } } catch (e) { errs = e.message; }
  return { m, f, o, hp0, seen, clips, hitFrame, errs };
}
const gaps = {};
for (const nm of ['j_punch', 'j_kick']) {   // aéreos: salto hacia delante y golpe al BAJAR; se barre distancia y momento
  if (!dA.moves[nm]) continue; const btn = nm === 'j_punch' ? 'punchPress' : 'kickPress'; let best = null;
  for (let gap = 100; gap <= 170 && !best; gap += 10) for (let pt = 14; pt <= 28 && !best; pt++) {
    const seq = [I({ upPress: true, x: 1 }), ...Array(pt - 1).fill(0).map(() => I({ x: 1 })), I({ x: 1, [btn]: true })];
    const r = run(nm, seq, gap); if (r.o.hp < r.hp0) best = { gap, pt };
  }
  seqs[nm] = best ? [I({ upPress: true, x: 1 }), ...Array(best.pt - 1).fill(0).map(() => I({ x: 1 })), I({ x: 1, [btn]: true })] : seqs[nm];
  if (best) gaps[nm] = best.gap;
  if (best) console.log(`${nm}: conecta con salto adelante a ${best.gap} px, botón en t=${best.pt}`);
}
for (const [name, seq] of Object.entries(seqs)) {
  if (!dA.moves[name]) { console.log(`${name.padEnd(17)} (no existe en ${A})`); continue; }
  const m = Sim.createMatch(12345, JSON.parse(JSON.stringify(cfg)), null);
  let guard = 0; while (m.phase !== 'fight' && guard++ < 1000) Sim.step(m, [dA, dB], [N(), N()]);
  const [f, o] = m.fighters;
  const gap = gaps[name] != null ? gaps[name] : name === 'throw' ? 50 : (name.startsWith('j_') ? 150 : name === 'super' || name === 'embestida_hombro' ? 120 : 75);
  f.x = 400; o.x = 400 + gap;
  if (name === 'super') f.meter = f.maxMeter;
  const hp0 = o.hp, seen = new Set(), clips = new Set(); let hitFrame = -1, errs = null;
  try {
    for (let t = 0; t < 140; t++) {
      const inp = t < seq.length ? seq[t] : N();
      Sim.step(m, [dA, dB], [inp, N()]);
      if (f.move) seen.add(f.move); clips.add(f.clip);
      if (hitFrame < 0 && o.hp < hp0) hitFrame = t;
    }
  } catch (e) { errs = e.message; }
  const ok = !errs && (name === 'throw' ? clips.has(dA.moves.throw.clip) : seen.has(name)) && o.hp < hp0;
  if (!ok) fails++;
  console.log(`${name.padEnd(17)} ${ok ? 'OK ' : 'FALLA'} movimientos=${[...seen].join(',') || '-'} daño=${hp0 - o.hp} primer_impacto_t=${hitFrame} rival=${o.state} clips=${[...clips].join(',')}${errs ? ' ERROR ' + errs : ''}`);
}
console.log(fails ? `FALLAS: ${fails}` : 'TODOS OK');
process.exit(fails ? 1 : 0);
