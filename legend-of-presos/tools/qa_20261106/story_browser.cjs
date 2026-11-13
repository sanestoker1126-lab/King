// QA navegador de la historia entre combates (data/story.json).
//  normal: los capítulos de relleno NO se muestran (Arcade va directo al VS) · ?story=draft: sale el capítulo y Continuar lleva al VS.
// Uso: node story_browser.cjs <url_base> <captura.png>
const { chromium } = require('playwright');
(async () => {
  const [base, shot] = process.argv.slice(2); const browser = await chromium.launch(); const logs = []; let fails = 0;
  for (const [modo, q] of [['normal', ''], ['borrador', '?story=draft']]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|\(404\) was received/.test(t)) logs.push(`[${modo}][${m.type()}] ${t}`); });
    page.on('pageerror', e => logs.push(`[${modo}][pageerror] ` + e.message));
    await page.goto(base + '/game.html' + q); await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await page.evaluate(() => { const G = window.__PGGAME; G.fe.emit('arcadeStart', { yourId: 'tobi' }); });
    await page.waitForTimeout(700);
    const s1 = await page.evaluate(() => { const G = window.__PGGAME, e = document.querySelector('.pg-story'); return { escena: G.fe._scene, cargada: !!G.story, tag: e ? e.querySelector('.pg-cine-tag').textContent : null, title: e ? e.querySelector('.pg-cine-title').textContent : null }; });
    let s2 = null;
    if (s1.escena === 'story') { if (shot) await page.screenshot({ path: shot }); await page.keyboard.press('Enter'); await page.waitForTimeout(600); s2 = await page.evaluate(() => window.__PGGAME.fe._scene); }
    const ok = modo === 'normal' ? (s1.cargada && s1.escena !== 'story') : (s1.escena === 'story' && /PENDIENTE/.test(s1.tag || '') && s2 && s2 !== 'story');
    console.log((ok ? 'OK    ' : 'FALLA ') + modo + ': ' + JSON.stringify(s1) + (s2 ? ' -> tras Continuar: ' + s2 : '')); if (!ok) fails++;
    await page.close();
  }
  console.log(logs.join('\n') || '(consola limpia)'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
