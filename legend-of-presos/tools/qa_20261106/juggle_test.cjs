// ¿Se puede atrapar al rival en un juggle (golpearlo en el aire tras lanzarlo)? Simulación real.
// Prueba: launcher -> (a) súper, (b) salto+aéreo. Reporta si el seguimiento conecta con el rival LAUNCHED.
// Uso: node juggle_test.cjs <raiz> [id]
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.argv[2], who=process.argv[3]||'all';
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const roster=JSON.parse(fs.readFileSync(path.join(root,'data/roster.json'),'utf8')).characters.filter(c=>c.status==='playable');
const N=()=>({x:0,down:false,block:false,up:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const BTN={punch:'punchPress',kick:'kickPress'};
function motionSeq(motion,button){const b=BTN[button]||'punchPress';
  const M={qcf:[{down:1},{down:1,x:1},{x:1,[b]:1}],qcb:[{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    dp:[{x:1},{},{down:1},{down:1,x:1,[b]:1}],qcf2:[{down:1},{down:1,x:1},{x:1},{down:1},{down:1,x:1},{x:1,[b]:1}]}[motion]||[{[b]:1}];
  return M.map(I);}
function launcherSeq(d,name){ // secuencia para arrancar el move 'name'
  const In=d.inputs;
  for(const g of['specials','supers','hidden'])for(const s of(In[g]||[]))if(s.move===name)return motionSeq(s.motion,s.button);
  if(In.forward&&In.forward.punch===name)return[I({x:1}),I({x:1,punchPress:1})];
  return null;}
function fresh(d,dR,gap){const m=Sim.createMatch(12345,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[d,dR],[N(),N()]);
  const[f,o]=m.fighters;f.x=400;o.x=400+gap;f.meter=f.maxMeter;return{m,f,o};}
// lanza con 'launcher', luego ejecuta 'follow' (secuencia) desde start2; registra si algún golpe conecta con o.state==LAUNCHED
function tryJuggle(d,dR,launcher,followSeq,gap,start2){
  const {m,f,o}=fresh(d,dR,gap);const ls=launcherSeq(d,launcher);if(!ls)return null;
  let launched=false,airHit=false,jMax=0,hp0=o.hp,hitsAir=0;
  for(let t=0;t<200;t++){let inp=N();if(t<ls.length)inp=ls[t];const k=t-start2;if(k>=0&&k<followSeq.length)inp=followSeq[k];
    const preState=o.state,preHp=o.hp,preGround=o.grounded;Sim.step(m,[d,dR],[inp,N()]);
    if(o.state==='LAUNCHED'&&!o.grounded)launched=true;
    if(o.hp<preHp && !preGround && preState==='LAUNCHED'){airHit=true;hitsAir++;jMax=Math.max(jMax,o.juggle);}
  }
  return {launched,airHit,hitsAir,jMax,dmg:hp0-o.hp};
}
function jumpAirSeq(d,btn){ // salta hacia adelante y golpea en el aire
  return [I({upPress:1,x:1}),...Array(6).fill(0).map(()=>I({x:1})),I({x:1,[BTN[btn]]:1})];}
const list=who==='all'?roster.map(c=>c.id):[who];
let ok=0,tot=0;
for(const id of list){let d;try{d=def(id);}catch(e){continue;}const dR=def('personaje_08');
  const launchers=Object.entries(d.moves).filter(([n,m])=>m.launcher).map(([n])=>n);
  if(!launchers.length){console.log(`${id.padEnd(18)} sin launcher`);continue;}
  const L=launchers[0];tot++;
  // seguimientos a probar: súper (si existe), aéreo con salto, j_kick/j_punch
  const supers=(d.inputs.supers||[]).map(s=>s.move);
  let best={airHit:false,hitsAir:0,how:'-'};
  const follows=[];
  for(const sm of supers){const sq=launcherSeq(d,sm);if(sq)follows.push(['súper '+sm,sq]);}
  if(d.inputs.air&&d.inputs.air.kick)follows.push(['salto+j_kick',jumpAirSeq(d,'kick')]);
  if(d.inputs.air&&d.inputs.air.punch)follows.push(['salto+j_punch',jumpAirSeq(d,'punch')]);
  for(const[how,sq]of follows)for(const gap of[36,46,56])for(let s2=4;s2<=22;s2++){
    const r=tryJuggle(d,dR,L,sq,gap,s2);if(r&&r.airHit&&(r.hitsAir>best.hitsAir)){best={...r,how};}}
  if(best.airHit)ok++;
  console.log(`${id.padEnd(18)} launcher=${L.padEnd(16)} juggle: ${best.airHit?'SÍ ('+best.hitsAir+' golpe(s) aéreo, vía '+best.how+')':'NO atrapa en el aire'}`);
}
console.log(`\n== ${ok}/${tot} personajes con launcher logran un juggle (golpe conecta con el rival en el aire) ==`);
