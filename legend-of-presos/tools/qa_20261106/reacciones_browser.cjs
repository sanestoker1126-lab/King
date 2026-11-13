// QA navegador: carga peleas con los personajes que ganaron atlas `reacciones`, valida sus texturas y la consola.
// Uso: node reacciones_browser.cjs <url_base> <prefijo_capturas>
const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const browser = await chromium.launch(); const logs = [];
  for (const [p1, p2] of [['tobi', 'nadia'], ['regente', 'tobi']]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|\(404\) was received/.test(t)) logs.push(`[${m.type()}] ${t}`); });
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    await page.goto(base + '/game.html'); await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await page.evaluate(([a, b]) => { const G = window.__PGGAME, s = G.fe.sel; s.mode = 'versus'; s.p1 = a; s.p2 = b; s.stage = 5; s.difficulty = 3; G.fe._startMatch(); }, [p1, p2]);
    await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.render && G.match.phase === 'fight'; }, { timeout: 30000 });
    await page.evaluate(() => { const G = window.__PGGAME; G.p1ctl.snapshot = () => PGAI.decide(G.match, G.match.fighters[0], G.match.fighters[1], 3, G.defs[0]);
      window.__seen = [{}, {}]; const t = () => { const m = G.match; if (m) m.fighters.forEach((f, i) => { window.__seen[i][f.clip] = 1; }); requestAnimationFrame(t); }; requestAnimationFrame(t); });
    // forzar derribo de P2 para ver caída + levantada, y mareo de P1
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const m = window.__PGGAME.match; m.fighters[0].stun = 99; });
    await page.waitForTimeout(9000); await page.screenshot({ path: `${out}_${p1}_${p2}.png` });
    const r = await page.evaluate(() => { const G = window.__PGGAME, bad = [], n = [0, 0];
      G.render.chars.forEach((ch, i) => { for (const k of Object.keys(ch.clips)) { if ((ch.def.clips[k] || {}).atlas !== 'reacciones') continue; n[i]++;
        ch.clips[k].forEach((t, j) => { const f = t && t.frame; if (!f || f.x + f.width > t.source.width || f.y + f.height > t.source.height) bad.push(i + ':' + k + '#' + j); }); } });
      return { clipsReacciones: n, bad, vistos: window.__seen.map(s => Object.keys(s).filter(k => /hurt|damage_fall|down|recovery_pose|ko_fall|dizzy/.test(k))) }; });
    console.log(p1, 'vs', p2, JSON.stringify(r)); await page.close();
  }
  console.log(logs.join('\n') || '(consola limpia)'); await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
