// QA navegador: durante la pausa de impacto el sprite del GOLPEADO vibra (x dibujada != x de la simulación) y el del que pega no.
// Uso: node hitshake_browser.cjs <url_base>
const { chromium } = require('playwright');
(async () => {
  const [base] = process.argv.slice(2);
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 960, height: 540 } }); const logs = [];
  page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|\(404\) was received/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/game.html'); await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__PGGAME, s = G.fe.sel; s.mode = 'versus'; s.p1 = 'tobi'; s.p2 = 'nadia'; s.stage = 5; s.difficulty = 3; G.fe._startMatch(); });
  await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.render && G.match.phase === 'fight'; }, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__PGGAME; G.p1ctl.snapshot = () => PGAI.decide(G.match, G.match.fighters[0], G.match.fighters[1], 3, G.defs[0]);
    window.__hs = { golpeado: [], bloqueo: [], atacante: [], sinPausa: [] };
    const t = () => { const m = G.match, R = G.render; if (m && R) m.fighters.forEach((f, i) => { const d = Math.abs(R.sprites[i].x - f.x);
        for (const g of m.fighters) if (g.hp < g.maxHp * 0.3) g.hp = Math.floor(g.maxHp * 0.6);
        if (!(m.hitstop > 0)) { window.__hs.sinPausa.push(d); return; }
        if (/HITSTUN|LAUNCHED|KO|GUARD_CRUSH/.test(f.state)) window.__hs.golpeado.push(d); else if (f.state === 'BLOCKSTUN') window.__hs.bloqueo.push(d); else window.__hs.atacante.push(d); });
      requestAnimationFrame(t); }; requestAnimationFrame(t); });
  await page.waitForTimeout(15000);
  const r = await page.evaluate(() => { const o = {}; for (const k in window.__hs) { const a = window.__hs[k]; o[k] = { muestras: a.length, max: a.length ? Math.max(...a) : 0, conVibracion: a.filter(x => x > 0.01).length }; } return o; });
  console.log(JSON.stringify(r)); console.log(logs.join('\n') || '(consola limpia)'); await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
