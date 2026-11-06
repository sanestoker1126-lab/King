// Calidad de los combos de El Paisa: para cada cadena, ¿el 2º golpe conecta mientras el rival SIGUE en hitstun del 1º?
// (combo real) y con qué gap (frames entre impacto1 e impacto2). Uso: node paisa_gaps.cjs <raiz>
const fs=require('fs'),path=require('path'),vm=require('vm');const root=process.argv[2];
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const d=def('el_paisa_sistem'),dR=def('personaje_08');
const N=()=>({x:0,down:false,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const BTN={punch:'punchPress',kick:'kickPress'};
function motionSeq(motion,button){const b=BTN[button];
  const M={qcf:[{down:1},{down:1,x:1},{x:1,[b]:1}],qcb:[{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    dp:[{x:1},{},{down:1},{down:1,x:1,[b]:1}],qcf2:[{down:1},{down:1,x:1},{x:1},{down:1},{down:1,x:1},{x:1,[b]:1}]}[motion]||[{[b]:1}];
  return M.map(I);}
function moveSeq(name){const In=d.inputs;
  if(In.grounded.punch===name)return[I({punchPress:1})];if(In.grounded.kick===name)return[I({kickPress:1})];
  if(In.forward.punch===name)return[I({x:1}),I({x:1,punchPress:1})];if(In.forward.kick===name)return[I({x:1}),I({x:1,kickPress:1})];
  for(const g of['specials','supers','hidden'])for(const s of(In[g]||[]))if(s.move===name)return motionSeq(s.motion,s.button);
  return null;}
function fresh(gap){const m=Sim.createMatch(12345,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[d,dR],[N(),N()]);
  const[f,o]=m.fighters;f.x=400;o.x=400+gap;f.meter=f.maxMeter;return{m,f,o};}
// corre base + 2º desde start2; devuelve impactos [{t,comboCount,oState}] y si el 2º pegó EN hitstun
function run(base,next,gap,start2){const{m,f,o}=fresh(gap);const bs=moveSeq(base),ns=moveSeq(next);
  if(!bs||!ns)return null;const imp=[];let lastHp=o.hp;
  for(let t=0;t<170;t++){let inp=N();if(t<bs.length)inp=bs[t];const k=t-start2;if(k>=0&&k<ns.length)inp=ns[k];
    const preState=o.state;Sim.step(m,[d,dR],[inp,N()]);
    if(o.hp<lastHp){imp.push({t,move:f.move,oState:preState,combo:f.comboCount});lastHp=o.hp;}}
  return imp;}
const chains={};
for(const[mn,mv]of Object.entries(d.moves)){if(!mv.cancelInto)continue;for(const tgt of mv.cancelInto)chains[mn+' ⇒ '+tgt]=[mn,tgt];}
console.log('CADENA                                  mejor: 2º conecta EN hitstun? gap(frames)  combo');
for(const[label,[base,next]]of Object.entries(chains)){
  let best=null;
  for(const gap of[36,44,52,60]) for(let s2=3;s2<=30;s2++){const imp=run(base,next,gap,s2);if(!imp||imp.length<2)continue;
    // impacto del 1º (move=base) y primer impacto del 2º (move=next)
    const i1=imp.find(x=>x.move===base);const i2=imp.find(x=>x.move===next);
    if(!i1||!i2)continue;const gapF=i2.t-i1.t;const inStun=/HITSTUN|LAUNCHED|THROWN/.test(i2.oState);
    const score=(inStun?1000:0)-Math.abs(gapF-6); // prioriza combo real con gap cercano a 6
    if(!best||score>best.score)best={inStun,gapF,combo:Math.max(...imp.map(x=>x.combo)),score};}
  if(best)console.log(`${label.padEnd(40)} ${best.inStun?'SÍ (combo real)':'no (2 golpes sueltos)'}       ${String(best.gapF).padStart(3)}        ${best.combo}`);
  else console.log(`${label.padEnd(40)} no enlaza`);
}
