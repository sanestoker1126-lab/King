// Controles táctiles v2 en un teléfono emulado (Pixel 7 horizontal) con toques REALES por CDP (multitáctil):
//  - la arena queda ENTRE el joystick y los botones (modo despejado) y ningún control tapa a los luchadores;
//  - ↓↘→ con el joystick + Puño (ESP en clásico = qcf+P de Tobi = fireball) saca el especial;
//  - deslizar el dedo de Puño a Patada pulsa los dos; captura de combate y de Opciones › Controles.
// Uso: node touch_browser.cjs http://127.0.0.1:8000 <prefijo_capturas>
const { chromium, devices } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage(); const logs = [];
  page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|sw\.js|404 was|Memoria:/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/game.html'); await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__PGGAME, S = G.fe.sel; S.mode = 'versus'; S.p1 = 'tobi'; S.p2 = 'calavera'; S.stage = 0; G.fe._startMatch(); });
  await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.match.phase === 'fight'; }, { timeout: 30000 });
  await page.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const geo = await page.evaluate(() => {
    const r = q => { const e = document.querySelector(q); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const G = window.__PGGAME, R = G.render, s = R._scale, wx = R.world.x;
    const fx = G.match.fighters.map(f => wx + f.x * s);   // x en pantalla (sin zoom de cámara)
    return { vw: innerWidth, vh: innerHeight, p: r('.b-p'), k: r('.b-k'), btns: r('.pg-btns'), zone: r('.pg-stickzone'), base: r('.pg-stick-base'),
             safe: R.safe, arena: [R._cx - 960 * s / 2, R._cx + 960 * s / 2], fx, insets: window.PGTouch.insets() };
  });
  // la arena (paredes a 40 px del borde) no se mete bajo los controles
  const wallL = geo.arena[0] + 40 * (geo.arena[1] - geo.arena[0]) / 960, wallR = geo.arena[1] - 40 * (geo.arena[1] - geo.arena[0]) / 960;
  const res = { insets: geo.insets, paredIzq: Math.round(wallL), paredDer: Math.round(wallR), bordeBotones: Math.round(geo.btns.l), joystickDer: Math.round(geo.insets.l),
    despejada: wallR <= geo.btns.l + 1 && wallL >= geo.insets.l - 1 };
  // ↓ ↘ → + Puño con el pulgar izquierdo (joystick flotante: se apoya en un punto libre de la zona)
  const sx = geo.zone.l + 80, sy = geo.zone.b - 90, d = 40;
  await T('touchStart', [[sx, sy, 1]]);
  await page.waitForTimeout(30);
  for (const [dx, dy] of [[0, d], [d * 0.75, d * 0.75], [d, 0]]) { await T('touchMove', [[sx + dx, sy + dy, 1]]); await page.waitForTimeout(34); }
  await T('touchStart', [[sx + d, sy, 1], [geo.p.x, geo.p.y, 2]]);
  let special = false;
  for (let i = 0; i < 30 && !special; i++) { await page.waitForTimeout(16); special = await page.evaluate(() => { const f = window.__PGGAME.match.fighters[0]; return f.state === 'SPECIAL' ? f.move : false; }); }
  res.especialConJoystick = special;
  await T('touchEnd', []);
  await page.waitForTimeout(700);
  // deslizar: Puño -> Patada sin levantar el dedo
  await T('touchStart', [[geo.p.x, geo.p.y, 3]]); await page.waitForTimeout(40);
  const onP = await page.evaluate(() => document.querySelector('.b-p').classList.contains('on'));
  await T('touchMove', [[(geo.p.x + geo.k.x) / 2, (geo.p.y + geo.k.y) / 2, 3]]); await T('touchMove', [[geo.k.x, geo.k.y, 3]]); await page.waitForTimeout(40);
  const onK = await page.evaluate(() => [document.querySelector('.b-k').classList.contains('on'), document.querySelector('.b-p').classList.contains('on')]);
  await T('touchEnd', []);
  res.deslizar = { puñoPulsado: onP, patadaPulsada: onK[0], puñoSoltado: !onK[1] };
  await page.waitForTimeout(300); await page.screenshot({ path: out + '_combate.png' });
  await page.evaluate(() => { window.__PGGAME.fe.options(() => window.__PGGAME.fe._menu(), 'controls'); }); await page.waitForTimeout(600);
  await page.screenshot({ path: out + '_opciones_controles.png' });
  console.log(JSON.stringify(res)); console.log(logs.join('\n') || '(consola limpia salvo sw.js)'); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
