// CONTRATO NATIVO del APK: dos pestañas con los archivos EXTRAÍDOS del APK (ruta /assets/game.html, igual que el WebView)
// y un window.AndroidBridge SIMULADO que se comporta como android/.../BtLink.java (avisos hosting/device/scanDone/
// connected/line/closed, asíncronos como runOnUiThread, mismo formato). No es Bluetooth real: prueba que el juego use el
// transporte "bt" y que la sala + lockstep funcionen con esa interfaz. Cada lado lo controla la IA (nivel 3) a través
// de la red. Verifica: conexión, sala, que los dos simulen EXACTAMENTE lo mismo (huella cada 60 cuadros + estado final),
// esperas por entrada tardía, y aviso al desconectarse. Uso: node net_browser.cjs http://127.0.0.1:8000 <prefijo_capturas> [frames]
const { chromium, devices } = require('playwright');
(async () => {
  const [base, out, maxF = '5400'] = process.argv.slice(2);
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['Pixel 7 landscape'] });
  const A = await ctx.newPage(), B = await ctx.newPage(), logs = [];
  for (const [n, p] of [['A', A], ['B', B]]) { p.on('pageerror', e => logs.push(`${n} pageerror ${e.message}`)); p.on('console', m => { const t = m.text(); if (/desincron|PGNet|Error/i.test(t)) logs.push(`${n} ${t}`); }); }
  await ctx.addInitScript(() => {
    const ch = new BroadcastChannel('apk-bt'), me = Math.random().toString(36).slice(2, 7); let role = null, peer = null; window.__haptic = 0;
    const emit = (t, d) => setTimeout(() => window.PGNet && window.PGNet._native(t, typeof d === 'string' ? d : JSON.stringify(d)), 0);
    ch.onmessage = e => { const m = e.data; if (m.to && m.to !== me) return;
      if (m.k === 'q' && role === 'host') ch.postMessage({ k: 'adv', from: me, name: 'Telefono-' + me });
      else if (m.k === 'adv' && role === 'scan') emit('device', { name: m.name, address: m.from, bonded: false });
      else if (m.k === 'conn' && role === 'host' && !peer){ peer = m.from; ch.postMessage({ k: 'ok', from: me, to: m.from, name: 'Telefono-' + me }); emit('connected', { name: m.name, host: true }); }
      else if (m.k === 'ok' && role === 'join'){ peer = m.from; emit('connected', { name: m.name, host: false }); }
      else if (m.k === 'line' && m.from === peer) emit('line', m.line);
      else if (m.k === 'close' && m.from === peer){ peer = null; emit('closed', {}); } };
    window.AndroidBridge = { playHaptic: () => { window.__haptic++; }, btAvailable: () => true,
      btHost: () => { role = 'host'; peer = null; emit('hosting', { name: 'Telefono-' + me }); },
      btScan: () => { role = 'scan'; ch.postMessage({ k: 'q', from: me }); setTimeout(() => emit('scanDone', {}), 600); },
      btConnect: a => { role = 'join'; ch.postMessage({ k: 'conn', from: me, to: a, name: 'Telefono-' + me }); },
      btSend: l => { if (peer) ch.postMessage({ k: 'line', from: me, to: peer, line: l }); },
      btClose: () => { if (peer){ ch.postMessage({ k: 'close', from: me, to: peer }); emit('closed', {}); } peer = null; role = null; } };
  });
  for (const p of [A, B]) { await p.goto(base + '/assets/game.html'); await p.waitForFunction(() => window.__READY); await p.evaluate(() => { const G = window.__PGGAME; G.fe._started = true; G.fe.netMenu(); }); }
  const res = {};
  res.transporte = await Promise.all([A, B].map(p => p.evaluate(() => PGNet.kind())));
  await A.click('#n-host'); await A.waitForTimeout(200);
  await B.click('#n-scan'); await B.waitForSelector('.pg-netdev button', { timeout: 5000 }); await B.screenshot({ path: out + '_buscar.png' });
  await B.click('.pg-netdev button');
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
  res.vibraciones = await Promise.all([A, B].map(p => p.evaluate(() => window.__haptic)));
  // botón ATRÁS de Android = Esc en document (MainActivity.onKeyDown): en plena pelea abre la pausa del reto (no la congela)
  await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })));
  res.atrasEnPelea = await A.evaluate(() => window.__PGGAME.fe._scene);
  // desconexión: B abandona el reto (PGNet.close manda "bye" y cierra); A debe cortar la pelea y avisar
  await B.evaluate(() => PGNet.close()); await A.waitForTimeout(800);
  res.avisoDesconexion = await A.evaluate(() => (document.querySelector('.pg-netnotice') || {}).textContent || window.__PGGAME.fe._scene);
  console.log(JSON.stringify(res, null, 1)); console.log(logs.join('\n') || '(sin errores de página)'); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
