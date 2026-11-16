// Cachorro (personaje_08) en el juego real: súper, especial de energía y agarre de comando con COMANDO real; captura
// congelando la simulación en cuadros concretos. Sirve para ver que ya no hay sombra azul ni cuadrícula.
// Uso: node cachorro_browser.cjs http://127.0.0.1:8000 <prefijo_capturas>
const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 960, height: 540 } }), logs = [];
  p.on('pageerror', e => logs.push(e.message));
  await p.goto(base + '/game.html'); await p.waitForFunction(() => window.__READY);
  const res = {};
  async function fight(){ await p.evaluate(() => { const G = window.__PGGAME, S = G.fe.sel; S.mode = 'versus'; S.p1 = 'personaje_08'; S.p2 = 'tobi'; S.stage = 8; G.fe._startMatch(); });
    await p.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.match.phase === 'fight'; }, null, { timeout: 30000 });
    await p.evaluate(() => { const G = window.__PGGAME; G.__q = []; const o = G.p1ctl.snapshot.bind(G.p1ctl); G.p1ctl.snapshot = function(){ const s = o(); const n = G.__q.shift(); return n ? Object.assign(s, n) : s; };
      if (!window.__wr){ window.__wr = 1; const st = PGSim.step; PGSim.step = function(m, d, i){ const G2 = window.__PGGAME; if (G2.__hold) return; st(m, d, i); if (G2.__stopAt && G2.__stopAt(m)){ G2.__hold = true; G2.__stopAt = null; } }; } }); }
  async function shoot(name, seq, move, idxs, setup){
    await fight();
    await p.evaluate(s => { const [f, o] = window.__PGGAME.match.fighters; f.x = 400; o.x = 470; f.meter = f.maxMeter; eval(s); }, setup || '');
    await p.evaluate(q => window.__PGGAME.__q.push(...q), seq);
    for (const i of idxs){
      await p.evaluate(([mv, i]) => { const G = window.__PGGAME; G.__stopAt = m => { const f = m.fighters[0]; const c = G.defs[0].clips[f.clip];
        return (f.move === mv || f.state === 'THROW') && c && PGSim.clipFrameIndex(c, f.clipTime) >= i; }; G.__hold = false; }, [move, i]);
      res[`${name}_${i}`] = await p.waitForFunction(() => window.__PGGAME.__hold === true, null, { timeout: 8000 }).then(() => true).catch(() => false);
      await p.waitForTimeout(120); await p.screenshot({ path: `${out}_${name}_${i}.png`, clip: { x: 200, y: 140, width: 560, height: 400 } });
    }
    await p.evaluate(() => { window.__PGGAME.__hold = false; });
  }
  const qcf2 = [{ down: true }, { down: true, x: 1 }, { x: 1 }, { down: true }, { down: true, x: 1 }, { x: 1, punchPress: true }];
  await shoot('super', qcf2, 'super', [3, 5, 7]);
  await shoot('energia', [{ down: true }, { down: true, x: 1 }, { x: 1, punchPress: true }], 'fireball', [2, 4, 6]);
  await shoot('agarre', [{ x: -1 }, { down: true, x: -1 }, { down: true }, { down: true, x: 1 }, { x: 1, kickPress: true }], 'command_grab', [2, 5, 8], 'o.x = 440;');
  console.log(JSON.stringify(res)); console.log(logs.join('\n') || 'sin errores'); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
