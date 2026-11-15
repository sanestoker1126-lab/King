// Navegador real (Chromium + game.html): entrega 2026-11-15 y tiempos explícitos.
//  - Wasirris hace Sentencia Firme con COMANDO real (↓↘→↓↘→+P) y se captura preparación, dash, impacto y recuperación.
//  - Tobi y Diego: mareo, K.O. (ko_fall) y victoria (victory_pose) con el arte nuevo.
// Uso: node frames1115_browser.cjs http://127.0.0.1:8000 <prefijo_capturas>
const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|sw\.js|404 was received/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  async function start(p1, p2, stage) {
    await page.evaluate(([a, b, s]) => { const G = window.__PGGAME, S = G.fe.sel; S.mode = 'versus'; S.p1 = a; S.p2 = b; S.stage = s; S.difficulty = 1; G.fe._startMatch(); }, [p1, p2, stage]);
    await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.render && G.match.phase === 'fight'; }, { timeout: 30000 });
    // entrada guionada del jugador 1: una entrada por paso de simulación (cola); vacía = neutro
    await page.evaluate(() => { const G = window.__PGGAME; G.__q = []; const orig = G.p1ctl.snapshot.bind(G.p1ctl);
      G.p1ctl.snapshot = function () { const s = orig(); const n = G.__q.shift(); return n ? Object.assign(s, n) : s; };
      // congelar la simulación justo al llegar a un cuadro (la captura tarda más que el golpe)
      if (!window.__wrapped) { window.__wrapped = true; const st = window.PGSim.step;
        window.PGSim.step = function (m, d, i) { const G2 = window.__PGGAME; if (G2.__hold) return; st(m, d, i);
          if (G2.__stopAt && G2.__stopAt(m, d)) { G2.__hold = true; G2.__stopAt = null; } }; } });
  }
  const q = seq => page.evaluate(s => { window.__PGGAME.__q.push(...s); }, seq);
  const wait = (fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const shot = name => page.screenshot({ path: `${out}_${name}.png` });
  const res = {};

  // ---- 1. Sentencia Firme
  await start('wasirris', 'diego_cancha', 8);
  await page.evaluate(() => { const [f, o] = window.__PGGAME.match.fighters; f.x = 360; o.x = 500; f.meter = f.maxMeter; });
  await q([{ down: true }, { down: true, x: 1 }, { x: 1 }, { down: true }, { down: true, x: 1 }, { x: 1, punchPress: true }]);
  res.superSale = await wait(() => window.__PGGAME.match.fighters[0].move === 'sentencia_firme');
  for (const [idx, nm] of [[2, 'a_prep'], [5, 'b_dash'], [8, 'c_impacto'], [12, 'd_recup']]) {
    await page.evaluate(t => { const G = window.__PGGAME; G.__stopAt = (m, d) => { const f = m.fighters[0];
      return f.clip === 'sentencia_firme' && window.PGSim.clipFrameIndex(d[0].clips[f.clip], f.clipTime) >= t; }; G.__hold = false; }, idx);
    const ok = await wait(() => window.__PGGAME.__hold === true, null, 6000);
    res['sentencia_idx' + idx] = ok; await page.waitForTimeout(150); await shot('sentencia_' + nm);
    res['sentencia_idx' + idx + '_x'] = await page.evaluate(() => { const [f, o] = window.__PGGAME.match.fighters; return [Math.round(f.x), Math.round(o.x), o.state]; });
  }
  await page.evaluate(() => { window.__PGGAME.__hold = false; });
  await wait(() => window.__PGGAME.match.fighters[0].state === 'IDLE', null, 6000);
  res.sentenciaDanio = await page.evaluate(() => { const o = window.__PGGAME.match.fighters[1]; return o.maxHp - o.hp; });

  // ---- 2. Diego mareado, K.O. de Diego y victoria de Tobi
  await start('tobi', 'diego_cancha', 9);
  await page.evaluate(() => { const [f, o] = window.__PGGAME.match.fighters; f.x = 420; o.x = 470; o.stun = 99.9; });
  await q([{ punchPress: true }]);
  res.diegoDizzy = await wait(() => { const o = window.__PGGAME.match.fighters[1]; return o.state === 'DIZZY' && o.clip === 'dizzy'; });
  await page.waitForTimeout(500); await shot('diego_mareo');
  await page.evaluate(() => { const [f, o] = window.__PGGAME.match.fighters; o.hp = 1; f.x = o.x - 50; });
  await q([{}, {}, { punchPress: true }]);
  res.diegoKO = await wait(() => { const o = window.__PGGAME.match.fighters[1]; return o.state === 'KO' && o.clip === 'ko_fall'; });
  await wait(() => window.__PGGAME.match.fighters[0].state === 'WIN', null, 8000);
  await page.waitForTimeout(700); await shot('diego_ko_tobi_victoria');
  res.tobiWin = await page.evaluate(() => window.__PGGAME.match.fighters[0].clip);

  // ---- 3. Tobi mareado, K.O. de Tobi y victoria de Diego
  await start('diego_cancha', 'tobi', 8);
  await page.evaluate(() => { const [f, o] = window.__PGGAME.match.fighters; f.x = 420; o.x = 470; o.stun = 99.9; });
  await q([{ punchPress: true }]);
  res.tobiDizzy = await wait(() => { const o = window.__PGGAME.match.fighters[1]; return o.state === 'DIZZY' && o.clip === 'dizzy'; });
  await page.waitForTimeout(500); await shot('tobi_mareo');
  await page.evaluate(() => { const [f, o] = window.__PGGAME.match.fighters; o.hp = 1; f.x = o.x - 50; });
  await q([{}, {}, { punchPress: true }]);
  res.tobiKO = await wait(() => { const o = window.__PGGAME.match.fighters[1]; return o.state === 'KO' && o.clip === 'ko_fall'; });
  await wait(() => window.__PGGAME.match.fighters[0].state === 'WIN', null, 8000);
  await page.waitForTimeout(700); await shot('tobi_ko_diego_victoria');
  res.diegoWin = await page.evaluate(() => window.__PGGAME.match.fighters[0].clip);
  res.texturas = await page.evaluate(() => { const G = window.__PGGAME; const r = G.render; return r && r.tex ? Object.keys(r.tex).length : 'n/d'; });

  console.log(JSON.stringify(res));
  console.log(logs.join('\n') || '(consola limpia)');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
