const { chromium } = require('playwright');
(async () => {
  const [base, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const logs=[]; page.on('console',m=>{const t=m.text();if(!/GL Driver|GPU stall|sw.js|404 was received/.test(t))logs.push(`[${m.type()}] ${t}`);});
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  await page.evaluate(() => { const G=window.__PGGAME, s=G.fe.sel; s.mode='versus'; s.p1='sofi'; s.p2='personaje_08'; s.stage=8; s.difficulty=1; G.fe._startMatch(); });
  await page.waitForFunction(() => { const G=window.__PGGAME; return G.match && G.render && G.match.phase==='fight'; }, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const m=window.__PGGAME.match; const [f,o]=m.fighters; f.x=410;o.x=510; f.hp=Math.floor(f.maxHp*0.49); });
  // capturar cuando el clip alcanza idx objetivo
  async function capAt(idx, name){
    await page.waitForFunction((ti)=>{const G=window.__PGGAME;const f=G.match.fighters[0];if(f.move!=='modo_vestia')return false;const cl=G.defs[0].clips.modo_vestia;const ci=G.PGSim?G.PGSim.clipFrameIndex(cl,f.clipTime):-1;return ci>=ti;}, idx, {timeout:6000}).catch(()=>logs.push('no alcanzó idx '+idx));
    await page.screenshot({path:`${out}_${name}.png`});
  }
  // exponer PGSim para clipFrameIndex
  await page.evaluate(()=>{window.__PGGAME.PGSim=window.PGSim;});
  for (const [idx,nm] of [[2,'a_activa'],[11,'b_transf'],[14,'c_vestia'],[19,'d_garra'],[26,'e_remate'],[34,'f_recup']]) await capAt(idx,nm);
  logs.push('[harness] ok');
  console.log(logs.join('\n')||'(limpio)');
  await browser.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
