// QA navegador del personaje nuevo: aparece en la selección, carga, pelea (CPU vs CPU) y consola limpia.
// Uso: node complementario_browser.cjs <url_base> <prefijo_capturas>
const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 960, height: 540 } }); const logs = [];
  page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|\(404\) was received/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '/game.html'); await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  const enSel = await page.evaluate(() => { const G = window.__PGGAME; return { enRoster: !!G.roster.characters.find(c => c.id === 'personaje_complementario'), seleccionable: !!G.fe._playable().find(c => c.id === "personaje_complementario") }; }).catch(e => ({ error: String(e) }));
  await page.evaluate(() => { const G = window.__PGGAME, s = G.fe.sel; s.mode = 'versus'; s.p1 = 'personaje_complementario'; s.p2 = 'tobi'; s.stage = 6; s.difficulty = 2; G.fe._startMatch(); });
  await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.render && G.match.phase === 'fight'; }, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__PGGAME; G.p1ctl.snapshot = () => PGAI.decide(G.match, G.match.fighters[0], G.match.fighters[1], 3, G.defs[0]);
    window.__seen = {}; const t = () => { const m = G.match; if (m) { window.__seen[m.fighters[0].clip] = 1; for (const g of m.fighters) if (g.hp < g.maxHp * 0.25) g.hp = Math.floor(g.maxHp * 0.5); m.timer = Math.max(m.timer, 3600); } requestAnimationFrame(t); }; requestAnimationFrame(t); });
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f']) { await page.waitForTimeout(2600); await page.screenshot({ path: `${out}_${s}.png` }); }
  const r = await page.evaluate(() => { const G = window.__PGGAME, ch = G.render.chars[0], bad = []; let n = 0;
    for (const k of Object.keys(ch.clips)) ch.clips[k].forEach((t, j) => { n++; const f = t && t.frame; if (!f || f.x + f.width > t.source.width || f.y + f.height > t.source.height) bad.push(k + '#' + j); });
    return { texturas: n, bad, clipsVistos: Object.keys(window.__seen).sort() }; });
  console.log(JSON.stringify(enSel), JSON.stringify(r)); console.log(logs.join('\n') || '(consola limpia)'); await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
