// Flujo de menús en teléfono (Pixel 7 horizontal) y en escritorio (1280x720), con toques/clics reales:
//  menú -> "Pelea rápida" -> combate (2 toques); menú -> Versus -> Pelear sin elegir nada (fichas ya llenas) -> combate.
// Uso: node menu_flow_browser.cjs http://127.0.0.1:8000 <prefijo_capturas>
const { chromium, devices } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const b = await chromium.launch(); const res = {}; const logs = [];
  for (const [tag, opt] of [['tel', devices['Pixel 7 landscape']], ['pc', { viewport: { width: 1280, height: 720 } }]]) {
    const ctx = await b.newContext(opt), page = await ctx.newPage();
    page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|sw\.js|404 was|Memoria:/.test(t)) logs.push(`[${tag}] ${t}`); });
    page.on('pageerror', e => logs.push(`[${tag}] pageerror ${e.message}`));
    await page.goto(base + '/game.html'); await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await page.evaluate(() => { const G = window.__PGGAME; G.fe._started = true; G.fe._menu(); }); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}_${tag}_menu.png` });
    const tap = sel => tag === 'tel' ? page.tap(sel) : page.click(sel);
    let t0 = Date.now(); await tap('.pg-m3-quick');
    res[tag + '_rapida'] = await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.match.phase === 'fight' && !G.fe.isVisible(); }, null, { timeout: 30000 }).then(() => ((Date.now() - t0) / 1000).toFixed(1) + ' s').catch(() => 'NO');
    await page.screenshot({ path: `${out}_${tag}_combate.png` });
    // salir por el camino normal: icono de Pausa -> "Menú principal"
    await tap('#btn-pause'); await page.waitForTimeout(400); await page.screenshot({ path: `${out}_${tag}_pausa.png` });
    await tap('#p-title'); await page.waitForTimeout(500);
    await tap('.pg-m3-tile[data-m="versus"]'); await page.waitForTimeout(700);
    res[tag + '_versus_pelear_habilitado'] = await page.evaluate(() => !document.querySelector('#s-go').disabled);
    await page.screenshot({ path: `${out}_${tag}_seleccion.png` });
    await tap('#s-stage .pg-cyc-b[data-d="1"]'); res[tag + '_escenario'] = await page.evaluate(() => window.__PGGAME.fe.sel.stage);
    await tap('#s-go');
    res[tag + '_versus_combate'] = await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.match.phase === 'fight' && !G.fe.isVisible(); }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    await ctx.close();
  }
  console.log(JSON.stringify(res)); console.log(logs.join('\n') || '(consola limpia salvo sw.js)'); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
