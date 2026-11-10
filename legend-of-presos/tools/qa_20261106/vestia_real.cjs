// QA en navegador (juego real, game.html): Sofi CPU vs CPU, se fuerza media vida -> Modo Vestía; luego se registra qué clips
// *_vestia se DIBUJAN (misma regla que pg_render._spriteFor), se valida cada textura del atlas vestia_real y se toman capturas.
// Uso: node vestia_real.cjs <url_base> <prefijo_capturas>
const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const logs = []; page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|sw\.js|404 was received/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__PGGAME, s = G.fe.sel; s.mode = 'versus'; s.p1 = 'sofi'; s.p2 = 'tobi'; s.stage = 6; s.difficulty = 3; G.fe._startMatch(); });
  await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.render && G.match.phase === 'fight'; }, { timeout: 30000 });
  // CPU también para Sofi + vida sostenida (que no termine la pelea) + muestreo de clips dibujados
  await page.evaluate(() => {
    const G = window.__PGGAME; G.p1ctl.snapshot = () => PGAI.decide(G.match, G.match.fighters[0], G.match.fighters[1], 3, G.defs[0]);
    G.match.fighters[0].hp = Math.floor(G.match.fighters[0].maxHp * 0.49);
    window.__seen = {}; window.__fx = {}; window.__fxSet = new WeakSet(); window.__tex = null;
    const tick = () => { const m = G.match; if (m && G.render) { const f = m.fighters[0], ch = G.render.chars[0];
        let c = ch.clips[f.clip] ? f.clip : 'idle'; if (f.transformed && ch.clips[c + '_vestia']) c = c + '_vestia';
        window.__seen[c] = (window.__seen[c] || 0) + 1;
        for (const x of (m.fx || [])) if (x.t === 'hit' && !window.__fxSet.has(x)) { window.__fxSet.add(x); const k = x.anim || ('tipo:' + x.kind); window.__fx[k] = (window.__fx[k] || 0) + 1; }
        for (const g of m.fighters) { if (g.hp < g.maxHp * 0.3) g.hp = Math.floor(g.maxHp * 0.45); }
        m.timer = Math.max(m.timer, 60 * 60); }
      requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.waitForFunction(() => window.__PGGAME.match.fighters[0].transformed === true, { timeout: 20000 }).catch(() => logs.push('[harness] NO se transformó'));
  // captura en el instante en que aparece una chispa Vestía (hitAnimVestia)
  for (const s of ['fx1', 'fx2', 'fx3']) {
    await page.waitForFunction(() => (window.__PGGAME.match.fx || []).some(x => x.t === 'hit' && /^vestia_/.test(x.anim || '') && x.life0 - x.life >= 2), { timeout: 20000, polling: 'raf' })
      .then(() => page.screenshot({ path: `${out}_${s}.png` })).catch(() => logs.push('[harness] no apareció chispa Vestía (' + s + ')'));
    await page.waitForTimeout(900);
  }
  const shots = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const s of shots) { await page.waitForTimeout(2500); await page.screenshot({ path: `${out}_${s}.png` }); }
  const res = await page.evaluate(() => {
    const G = window.__PGGAME, ch = G.render.chars[0], bad = [];
    const vest = Object.keys(ch.clips).filter(k => k.endsWith('_vestia'));
    for (const k of vest) ch.clips[k].forEach((t, i) => { const fr = t && t.frame, src = t && t.source;
      if (!t || !fr || fr.width < 1 || fr.x + fr.width > src.width || fr.y + fr.height > src.height) bad.push(k + '#' + i); });
    const def = G.defs[0], atl = Object.keys(def.atlases);
    const lib = G.render.fxLib, va = lib ? Object.keys(lib.anims).filter(k => /^vestia_/.test(k)) : [];
    return { vest: vest.length, bad, atlases: atl, seen: window.__seen, fxSeen: window.__fx, vestiaAnimsLoaded: va, transformed: G.match.fighters[0].transformed };
  });
  console.log(JSON.stringify(res));
  console.log(logs.join('\n') || '(consola limpia)');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
