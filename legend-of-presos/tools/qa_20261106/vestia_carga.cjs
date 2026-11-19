// Modo Vestía de Sofi como SÚPER CON CARGA (simulación real): sin barra no sale; con barra llena y ↓↘→↓↘→+Patada sí;
// no se repite en la misma ronda; ya no se activa solo a media vida. Uso: node vestia_carga.cjs <raiz>
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.argv[2];
const ctx = vm.createContext({ console, Math, JSON, Object, Array }); ctx.window = ctx;
for (const f of ['engine/pg_rng.js', 'engine/pg_sim.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const Sim = ctx.PGSim, cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const def = id => JSON.parse(fs.readFileSync(path.join(root, 'assets/combat', id, id + '.char.json'), 'utf8'));
const D = [def('sofi'), def('tobi')];
const N = () => ({ x: 0 }); const seq = [{ down: 1 }, { down: 1, x: 1 }, { x: 1 }, { down: 1 }, { down: 1, x: 1 }, { x: 1, kickPress: 1 }];
function setup(meter, hpFrac){ const m = Sim.createMatch(7, JSON.parse(JSON.stringify(cfg)), null); while (m.phase !== 'fight') Sim.step(m, D, [N(), N()]);
  const [f, o] = m.fighters; f.x = 400; o.x = 470; f.meter = meter; if (hpFrac != null) f.hp = Math.round(f.maxHp * hpFrac); return m; }
function run(m, s, n = 200){ let saw = false; const f = m.fighters[0];
  for (let t = 0; t < n; t++){ Sim.step(m, D, [s[t] || N(), N()]); if (f.move === 'modo_vestia') saw = true; } return saw; }
let fails = 0; const ok = (c, msg) => { console.log((c ? 'OK    ' : 'FALLA ') + msg); if (!c) fails++; };
let m = setup(0); ok(!run(m, seq), 'sin barra: el comando NO transforma');
m = setup(100); const saw = run(m, seq); ok(saw && m.fighters[0].transformed && m.fighters[0].meter < 40, `barra llena + ↓↘→↓↘→+Patada: se transforma y gasta la barra (queda ${m.fighters[0].meter}: lo que recargan sus propios golpes)`);
m.fighters[0].meter = 100; ok(!run(m, seq) && m.fighters[0].meter === 100, 'ya transformada: no se repite en la ronda (la barra no se gasta)');
m = setup(0, 0.3); run(m, [], 300); ok(!m.fighters[0].transformed, 'a media vida (30 %) sin pedirlo: ya NO se transforma sola');
const sup = (D[0].inputs.supers || []).map(s => s.move + ':' + s.motion + '+' + s.button).join(', ');
ok(/modo_vestia:qcf2\+kick/.test(sup) && !D[0].autoTransform, 'datos: súpers = ' + sup + ' · sin autoTransform');
console.log(fails ? 'FALLAS: ' + fails : 'TODO OK'); process.exit(fails ? 1 : 0);
