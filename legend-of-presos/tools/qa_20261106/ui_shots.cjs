// Capturas de la interfaz: selección (con El Paisa elegido) y su pantalla de comandos. Uso: node ui_shots.cjs <url> <outPrefix>
const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__PGGAME; G.fe.sel.mode = 'versus'; G.fe.sel.p1 = 'el_paisa_sistem'; G.fe.sel.p2 = 'wasirris'; G.fe.sel.stage = 8; G.fe.select(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '_select.png' });
  // carta de El Paisa en la rejilla
  const card = await page.evaluate(() => { const c = [...document.querySelectorAll('.pg-cells *')].find(e => /Paisa/.test(e.textContent || '') && e.children.length < 6); if (!c) return null; c.scrollIntoView({ block: 'center' }); return c.className; });
  logs.push('[harness] carta en la rejilla: ' + card);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '_select2.png' });
  await page.evaluate(() => { const G = window.__PGGAME; G.fe.commands('el_paisa_sistem'); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '_cmds.png', fullPage: true });
  const txt = await page.evaluate(() => document.querySelector('.pg-cmd') ? document.querySelector('.pg-cmd').innerText : '(sin pantalla de comandos)');
  logs.push('[harness] comandos:\n' + txt.slice(0, 1500));
  console.log(logs.join('\n'));
  await browser.close();
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
