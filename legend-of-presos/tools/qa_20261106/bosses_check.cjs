// QA de jefes (2026-11-08). Compara el motor ORIGINAL (raíz A) con el NUEVO (raíz B):
//  1) sin modificadores por integrante, todas las peleas deben ser IDÉNTICAS cuadro a cuadro (1v1, mods de lado, Equipos);
//  2) mods por integrante (members) = mods de lado cuando ese integrante pelea (vida y daño);
//  3) Equipos jefe final: solo Garravas nace con 2.5x vida; Mateo y Cochi con la normal.
// Uso: node bosses_check.cjs <raiz_A> <raiz_B>
const fs = require('fs'), path = require('path'), vm = require('vm');
const [rA, rB] = process.argv.slice(2);
function load(root) {
  const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
  for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js', 'engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  const cache = {}; const def = id => cache[id] || (cache[id] = JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8')));
  return { Sim: ctx.PGSim, AI: ctx.PGAI, cfg: JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8')), def };
}
function run(E, seed, opts, ids, frames = 9000) {
  const m = E.Sim.createMatch(seed, JSON.parse(JSON.stringify(E.cfg)), opts ? JSON.parse(JSON.stringify(opts)) : null);
  const trace = [], hpLog = [];
  const cur = s => opts && opts.teams ? m.teams[s].ids[m.teams[s].cur] : ids[s];
  for (let t = 0; t < frames && !m.over; t++) {
    const defs = [E.def(cur(0)), E.def(cur(1))];
    const i0 = E.AI.decide(m, m.fighters[0], m.fighters[1], 3, defs[0]);
    const i1 = E.AI.decide(m, m.fighters[1], m.fighters[0], 3, defs[1]);
    E.Sim.step(m, defs, [i0, i1]);
    trace.push(m.fighters.map(f => [f.hp, f.maxHp, Math.round(f.x * 100), Math.round(f.y * 100), f.state, f.move || '', f.meter].join(':')).join('|') + `|${m.phase}|${m.round}|${m.wins}`);
    const k = cur(1) + ':' + m.fighters[1].maxHp; if (hpLog[hpLog.length - 1] !== k) hpLog.push(k);
  }
  return { trace, over: m.over, winner: m.winner, frames: trace.length, hpLog };
}
const A = load(rA), B = load(rB); let fails = 0;
function same(name, a, b) {
  let d = -1; for (let i = 0; i < Math.max(a.trace.length, b.trace.length); i++) if (a.trace[i] !== b.trace[i]) { d = i; break; }
  console.log((d < 0 ? 'OK   ' : 'FALLA') + ` ${name}: frames ${a.frames}/${b.frames} ganador ${a.winner}/${b.winner}` + (d < 0 ? '' : ` (difiere desde el frame ${d})`));
  if (d >= 0) fails++;
}
// 1) sin members: original == nuevo
for (const [p1, p2, s] of [['tobi', 'garravas', 777], ['sofi', 'calavera', 31], ['mateo', 'nadia', 4242]]) {
  same(`1v1 ${p1} vs ${p2}`, run(A, s, null, [p1, p2]), run(B, s, null, [p1, p2]));
  const o = { mods: [{}, { hp: 2, damage: 2 }] };
  same(`1v1 ${p1} vs ${p2} con mods de lado {2,2}`, run(A, s, o, [p1, p2]), run(B, s, o, [p1, p2]));
}
const T = { teams: [['tobi', 'calavera', 'regente'], ['mateo', 'cochibomba', 'garravas']] };
same('Equipos sin mods', run(A, 99, T), run(B, 99, T));
const T2 = Object.assign({ mods: [{}, { hp: 2, damage: 2 }] }, { teams: [['tobi', 'calavera', 'regente'], ['sofi']] });
same('Equipos sub-jefa (mods de lado)', run(A, 5, T2), run(B, 5, T2));
// 2) members == mods de lado cuando ese integrante pelea (motor nuevo)
const side = { teams: [['tobi', 'nadia', 'regente'], ['garravas']], mods: [{}, { hp: 2.5, damage: 1.7 }] };
const memb = { teams: [['tobi', 'nadia', 'regente'], ['garravas']], mods: [{}, { members: [{ hp: 2.5, damage: 1.7 }] }] };
same('members[garravas] == mods de lado (vida y daño)', run(B, 1234, side), run(B, 1234, memb));
const nul = { teams: [['tobi', 'nadia', 'regente'], ['garravas']], mods: [{}, { members: [null] }] };
same('members [null] == sin mods', run(B, 1234, { teams: nul.teams }), run(B, 1234, nul));
// 3) jefe final en Equipos: solo Garravas con 2.5x
const boss = { teams: [['tobi', 'calavera', 'regente'], ['mateo', 'cochibomba', 'garravas']], mods: [{}, { hp: 1, damage: 1, members: [null, null, { hp: 2.5, damage: 1.7 }] }] };
let ok3 = false;
for (const s of [7, 11, 23, 57, 91, 123, 300, 777]) {   // hace falta una pelea en la que entren los tres
  const r = run(B, s, boss, null, 30000);
  if (r.hpLog.some(x => x.startsWith('garravas'))) {
    const bad = r.hpLog.filter(x => (x.startsWith('garravas') ? x !== 'garravas:750' : !x.endsWith(':300')));
    console.log((bad.length ? 'FALLA' : 'OK   ') + ` Equipos jefe final (semilla ${s}): vida máxima por integrante ${r.hpLog.join(' → ')}`);
    if (bad.length) fails++; ok3 = true; break;
  }
}
if (!ok3) { console.log('FALLA no hubo semilla en la que entrara Garravas'); fails++; }
console.log(fails ? `${fails} FALLA(S)` : 'TODO OK');
process.exit(fails ? 1 : 0);
