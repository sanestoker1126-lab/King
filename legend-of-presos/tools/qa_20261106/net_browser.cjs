// RETO EN RED con el protocolo real (pg_net.js) entre DOS pestañas (transporte de prueba BroadcastChannel, game.html?net=test).
// No es Bluetooth: prueba la sala, el arranque sincronizado y el LOCKSTEP. Cada lado lo controla la IA (nivel 3) a través
// de la red. Verifica: conexión, sala, que los dos simulen EXACTAMENTE lo mismo (huella cada 60 cuadros + estado final),
// esperas por entrada tardía, y aviso al desconectarse. Uso: node net_browser.cjs http://127.0.0.1:8000 <prefijo_capturas> [frames]
const { chromium, devices } = require('playwright');
(async () => {
  const [base, out, maxF = '5400'] = process.argv.slice(2);
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['Pixel 7 landscape'] });
  const A = await ctx.newPage(), B = await ctx.newPage(), logs = [];
  for (const [n, p] of [['A', A], ['B', B]]) { p.on('pageerror', e => logs.push(`${n} pageerror ${e.message}`)); p.on('console', m => { const t = m.text(); if (/desincron|PGNet|Error/i.test(t)) logs.push(`${n} ${t}`); }); }
  for (const p of [A, B]) { await p.goto(base + '/game.html?net=test'); await p.waitForFunction(() => window.__READY); await p.evaluate(() => { const G = window.__PGGAME; G.fe._started = true; G.fe.netMenu(); }); }
  await A.click('#n-host'); await A.waitForTimeout(200);
  await B.click('#n-scan'); await B.waitForSelector('.pg-netdev button', { timeout: 5000 }); await B.screenshot({ path: out + '_buscar.png' });
  await B.click('.pg-netdev button');
  const res = {};
  res.sala = await Promise.all([A, B].map(p => p.waitForFunction(() => window.__PGGAME.fe._scene === 'netlobby', null, { timeout: 8000 }).then(() => true).catch(() => false)));
  await B.click('.pg-cell[data-id="calavera"]'); await A.click('.pg-cell[data-id="tobi"]'); await A.waitForTimeout(400);
  await A.screenshot({ path: out + '_sala.png' });
  // IA como "jugador" de cada lado (entra por la red como cualquier botón)
  for (const p of [A, B]) await p.evaluate(() => { const G = window.__PGGAME; window.__aiOn = true;
    const orig = PGInput.Controller.prototype.snapshot; PGInput.Controller.prototype.snapshot = function () { const s = orig.call(this);
      if (window.__aiOn && G.match && G.mode === 'net' && this === G.p1ctl){ const me = G.netSide, m = G.match; const d = PGAI.decide(m, m.fighters[me], m.fighters[1 - me], 3, G.defs[me]); return Object.assign({}, d); } return s; }; });
  await B.click('#s-go'); await A.click('#s-go');
  res.combate = await Promise.all([A, B].map(p => p.waitForFunction(() => { const G = window.__PGGAME; return G.mode === 'net' && G.match && G.match.phase === 'fight'; }, null, { timeout: 30000 }).then(() => true).catch(() => false)));
  await A.waitForTimeout(1500); await A.screenshot({ path: out + '_pelea_A.png' }); await B.screenshot({ path: out + '_pelea_B.png' });
  // registro de huellas por cuadro en los dos lados
  for (const p of [A, B]) await p.evaluate(() => { window.__h = {}; const tick = PGNet.tick; PGNet.tick = function (s, st, m) { const r = tick.call(PGNet, s, st, m); if (r && m) window.__h[m.frame] = PGNet._hash(m); return r; }; });
  const t0 = Date.now();
  await Promise.all([A, B].map(p => p.waitForFunction(n => { const G = window.__PGGAME; return G.fe._scene === 'netlobby' || (G.match && G.match.frame >= n); }, +maxF, { timeout: 240000, polling: 500 }).catch(() => {})));
  res.segundos = ((Date.now() - t0) / 1000).toFixed(1);
  const hA = await A.evaluate(() => window.__h), hB = await B.evaluate(() => window.__h);
  const common = Object.keys(hA).filter(k => k in hB); const diff = common.filter(k => hA[k] !== hB[k]);
  res.cuadrosComparados = common.length; res.cuadrosDistintos = diff.length; res.primerDistinto = diff.length ? Math.min(...diff.map(Number)) : null;
  res.fin = await Promise.all([A, B].map(p => p.evaluate(() => { const G = window.__PGGAME; return G.fe._scene === 'netlobby' ? (document.querySelector('.pg-netres') || {}).textContent : 'pelea en curso, cuadro ' + (G.match && G.match.frame); })));
  res.esperas = await Promise.all([A, B].map(p => p.evaluate(() => (PGNet.stats() || {}).stalls)));
  await A.screenshot({ path: out + '_fin_A.png' });
  // desconexión: B cierra la pestaña; A debe avisar
  await B.close(); await A.waitForTimeout(400);
  await A.evaluate(() => PGNet._native('closed', '{}'));   // (BroadcastChannel no avisa al cerrar una pestaña: se simula el aviso nativo)
  res.avisoDesconexion = await A.evaluate(() => (document.querySelector('.pg-netnotice') || {}).textContent || window.__PGGAME.fe._scene);
  console.log(JSON.stringify(res, null, 1)); console.log(logs.join('\n') || '(sin errores de página)'); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
