// Rendimiento del selector en un teléfono emulado (Pixel 7, CPU ×4 más lenta): bytes descargados al abrir la selección
// (Versus) y costo de estilo/maquetación al deslizar el carrusel 2 s. Uso: node selector_perf.cjs <url_base> [<url_base_2> ...]
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const base of process.argv.slice(2)) {
    const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] }), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable'); await cdp.send('Performance.enable');
    await p.goto(base + '/game.html'); await p.waitForFunction(() => window.__READY);
    await p.evaluate(() => { const G = window.__PGGAME; G.fe._started = true; G.fe._menu ? G.fe._menu() : G.fe.title(); });
    await p.waitForTimeout(800);
    let bytes = 0; const big = []; const on = e => { bytes += e.encodedDataLength; };
    cdp.on('Network.loadingFinished', on);
    const t0 = Date.now();
    await p.evaluate(() => { const G = window.__PGGAME; G.fe.sel.mode = 'versus'; G.fe.select(); });
    await p.waitForFunction(() => { const f = [...document.querySelectorAll('.pg-card-face')]; return f.length && f.every(x => x.style.backgroundImage); }, null, { timeout: 60000 }).catch(() => {});
    const loadMs = Date.now() - t0; await p.waitForTimeout(300); cdp.off('Network.loadingFinished', on);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const frames = await p.evaluate(() => new Promise(res => { const r = document.querySelector('.pg-cells'); let n = 0, t0 = performance.now(), last = t0, worst = 0;
      function f(t) { worst = Math.max(worst, t - last); last = t; n++; r.scrollLeft = (Math.sin((t - t0) / 300) * 0.5 + 0.5) * (r.scrollWidth - r.clientWidth);
        if (t - t0 < 2000) requestAnimationFrame(f); else res({ fps: Math.round(n / ((t - t0) / 1000)), peorCuadroMs: Math.round(worst) }); } requestAnimationFrame(f); }));
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const d = k => Math.round((m1[k] - m0[k]) * 1000);
    console.log(`${base}: abrir selección ${(bytes / 1048576).toFixed(1)} MB en ${loadMs} ms · deslizar 2 s (CPU x4): ${frames.fps} fps, peor cuadro ${frames.peorCuadroMs} ms, estilo ${d('RecalcStyleDuration')} ms, maquetación ${d('LayoutDuration')} ms`);
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
