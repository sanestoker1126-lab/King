// Juggle en MAX para todo el roster: cada personaje, su launcher -> su súper (con MAX), ¿atrapa en el aire? Uso: node juggle_roster.cjs <raiz>
const fs=require('fs'),path=require('path'),vm=require('vm');const root=process.argv[2];
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const roster=JSON.parse(fs.readFileSync(path.join(root,'data/roster.json'),'utf8')).characters.filter(c=>c.status==='playable');
const N=()=>({x:0,down:false,block:false,up:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const B=b=>b==='kick'?'kickPress':b==='special'?'specialPress':b==='super'?'superPress':'punchPress';
function seq(motion,btn){const b=B(btn);
  return ({dp:[{x:1},{},{down:1},{down:1,x:1,[b]:1}],qcf:[{down:1},{down:1,x:1},{x:1,[b]:1}],qcb:[{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    qcf2:[{down:1},{down:1,x:1},{x:1},{down:1},{down:1,x:1},{x:1,[b]:1}],hcf:[{x:-1},{down:1,x:-1},{down:1},{down:1,x:1},{x:1,[b]:1}]}[motion]||[{[b]:1}]).map(I);}
function findInput(d,move){for(const g of['specials','supers','hidden']){const s=(d.inputs[g]||[]).find(x=>x.move===move);if(s)return s;}
  if(d.inputs.forward){for(const k of['punch','kick'])if(d.inputs.forward[k]===move)return{motion:null,button:k,fwd:true};}return null;}
function fwdSeq(btn){return [I({x:1}),I({x:1,[B(btn)]:1})];}
function jumpAir(btn){return [I({upPress:1,x:1}),...Array(5).fill(0).map(()=>I({x:1})),I({x:1,[B(btn)]:1})];}
function tryJ(d,dR,lMove,follow){let best={air:0,dmg:0};
  const lin=findInput(d,lMove);if(!lin)return best;const ls=lin.fwd?fwdSeq(lin.button):seq(lin.motion,lin.button);
  for(const gap of[32,40,48,56])for(let s2=2;s2<=18;s2++){
    const m=Sim.createMatch(99,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[d,dR],[N(),N()]);
    const[f,o]=m.fighters;f.x=400;o.x=400+gap;f.meter=f.maxMeter;f.maxMode=true;f.maxT=360;let hp0=o.hp,air=0;
    for(let t=0;t<130;t++){let inp=N();if(t<ls.length)inp=ls[t];const k=t-s2;if(k>=0&&k<follow.length)inp=follow[k];
      const pg=o.grounded,ps=o.state,ph=o.hp;Sim.step(m,[d,dR],[inp,N()]);if(o.hp<ph&&!pg)air++;}
    const dmg=hp0-o.hp;if(air>best.air||(air===best.air&&dmg>best.dmg))best={air,dmg};}
  return best;}
const dR=def('personaje_08');let ok=0,tot=0;
for(const c of roster){let d;try{d=def(c.id);}catch(e){continue;}
  const launchers=Object.entries(d.moves).filter(([n,m])=>m.launcher).map(([n])=>n);
  if(!launchers.length){console.log(`${c.id.padEnd(18)} — sin launcher —`);continue;}tot++;
  let best={air:0,how:'-'};
  for(const L of launchers){
    for(const s of (d.inputs.supers||[])){const r=tryJ(d,dR,L,seq(s.motion,s.button));if(r.air>best.air)best={...r,how:L+'→súper '+s.move};}
    if(d.inputs.air&&d.inputs.air.kick){const r=tryJ(d,dR,L,jumpAir('kick'));if(r.air>best.air)best={...r,how:L+'→salto+j_kick'};}
  }
  if(best.air>0)ok++;
  console.log(`${c.id.padEnd(18)} juggle en MAX: ${best.air>0?'SÍ '+best.air+' golpe(s) aéreo ('+best.how+', dmg '+best.dmg+')':'NO'}`);
}
console.log(`\n== ${ok}/${tot} personajes con launcher logran juggle en MAX ==`);
