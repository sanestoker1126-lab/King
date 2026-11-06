// Uso: node run_match.cjs <url_base> <p1> <p2> <stageIndex> <outPrefix> [escenario: none|ko1|ko0|dizzy1]
const { chromium } = require('playwright');
(async () => {
  const [base, p1, p2, stage, out, scen='none'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', r => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 30000 });
  const err0 = await page.evaluate(() => window.__PGC_ERR || null);
  if (err0) logs.push('[__PGC_ERR] ' + err0);
  await page.evaluate(({p1, p2, stage}) => {
    const G = window.__PGGAME; const s = G.fe.sel;
    s.mode = 'arcade'; s.p1 = p1; s.p2 = p2; s.stage = +stage; s.difficulty = 1;
    G.fe._startMatch();
  }, { p1, p2, stage });
  await page.waitForFunction(() => { const G = window.__PGGAME; return G.match && G.render && G.match.phase === 'fight'; }, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '_fight.png' });
  if (scen === 'ko0' || scen === 'ko1') {
    const side = scen === 'ko0' ? 0 : 1;
    // deja al lado `side` con 1 de vida: el siguiente golpe del otro lado es K.O.
    await page.evaluate((side) => { const m = window.__PGGAME.match; m.fighters[side].hp = 1; }, side);
    if (side === 1) {
      // el jugador 1 (humano) tiene que golpear: se acerca y presiona golpe
      await page.evaluate(() => { const m = window.__PGGAME.match; m.fighters[0].x = m.fighters[1].x - 70; });
      for (let i = 0; i < 12; i++) { await page.keyboard.press('j'); await page.waitForTimeout(120); const ph = await page.evaluate(() => window.__PGGAME.match.phase); if (ph !== 'fight') break; }
    }
    await page.waitForFunction(() => { const m = window.__PGGAME.match; return m.phase !== 'fight'; }, null, { timeout: 30000 }).catch(() => logs.push('[harness] no hubo K.O. en 30 s'));
    const snaps = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${out}_ko_${i}.png` });
      snaps.push(await page.evaluate(() => window.__PGGAME.match.fighters.map(f => ({ st: f.state, clip: f.clip, t: f.clipTime, hp: f.hp }))));
    }
    logs.push('[harness] estados: ' + JSON.stringify(snaps));
  }
  if (scen === 'dizzy1') {
    await page.evaluate(() => { const m = window.__PGGAME.match; const f = m.fighters[1]; f.dizzyPend = true; m.fighters[0].x = f.x - 70; });
    for (let i = 0; i < 10; i++) { await page.keyboard.press('j'); await page.waitForTimeout(150); const st = await page.evaluate(() => window.__PGGAME.match.fighters[1].clip); if (st === 'dizzy') break; }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}_dizzy.png` });
    logs.push('[harness] p2: ' + JSON.stringify(await page.evaluate(() => { const f = window.__PGGAME.match.fighters[1]; return { st: f.state, clip: f.clip, t: f.clipTime }; })));
  }
  if (scen === 'dizzyforce1') {
    // fuerza el estado de mareo del lado 2 (el clip lo elige el motor con clipOf -> 'dizzy' si el personaje lo trae)
    await page.evaluate(() => { const m = window.__PGGAME.match; const f = m.fighters[1]; f.state = 'DIZZY'; f.dizzyT = 400; f.stateFrame = 0; f.clip = 'dizzy'; f.clipTime = 0; f.vx = 0; });
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}_dizzy_${i}.png` });
      logs.push('[harness] p2: ' + JSON.stringify(await page.evaluate(() => { const f = window.__PGGAME.match.fighters[1]; return { st: f.state, clip: f.clip, t: f.clipTime }; })));
    }
  }
  console.log(logs.join('\n') || '(consola limpia)');
  await browser.close();
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
