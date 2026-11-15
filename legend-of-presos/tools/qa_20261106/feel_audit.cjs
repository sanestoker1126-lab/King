// Auditoría de "sensación" de combate con la simulación REAL (engine/pg_sim.js + pg_cinematics.js), en Node.
// Mide, por personaje jugable y por golpe de suelo (normales, especiales, súpers, ocultos):
//   - VENTAJA en golpe y en guardia: frames libres del atacante menos frames libres del defensor (+ = ventaja).
//   - MULTI-GOLPE: cuántos de los golpes declarados (hitFrames con multiHit) conectan de verdad.
//   - CADENAS EN MAX: especial ⇒ súper y X ⇒ oculto (las que combo_audit.cjs no mide porque corre sin MAX).
// No cambia nada; solo mide. Uso: node feel_audit.cjs <raiz> [id|all] [--json salida.json]
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.argv[2], who=process.argv[3]||'all';
const jsonOut = process.argv.indexOf('--json')>0 ? process.argv[process.argv.indexOf('--json')+1] : null;
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_cinematics.js']) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim, cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const roster=JSON.parse(fs.readFileSync(path.join(root,'data/roster.json'),'utf8')).characters.filter(c=>c.status==='playable');
const N=()=>({x:0,down:false,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const BTN={punch:'punchPress',kick:'kickPress',special:'specialPress',super:'superPress'};
function motionSeq(motion,button){ const b=BTN[button]||'punchPress';
  const M={ qcf:[{down:1},{down:1,x:1},{x:1,[b]:1}], qcb:[{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    dp:[{x:1},{},{down:1},{down:1,x:1,[b]:1}], hcf:[{x:-1},{down:1,x:-1},{down:1},{down:1,x:1},{x:1,[b]:1}],
    hcb:[{x:1},{down:1,x:1},{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    qcf2:[{down:1},{down:1,x:1},{x:1},{down:1},{down:1,x:1},{x:1,[b]:1}] }[motion];
  return (M||[{[b]:1}]).map(I); }
function moveSeq(d,name){ const In=d.inputs;
  if(In.grounded&&In.grounded.punch===name) return [I({punchPress:1})];
  if(In.grounded&&In.grounded.kick===name) return [I({kickPress:1})];
  if(In.forward){ if(In.forward.punch===name) return [I({x:1}),I({x:1,punchPress:1})]; if(In.forward.kick===name) return [I({x:1}),I({x:1,kickPress:1})]; }
  for(const g of ['specials','supers','hidden']) for(const s of (In[g]||[])) if(s.move===name) return motionSeq(s.motion,s.button);
  return null; }
const FREE={IDLE:1,WALK_F:1,WALK_B:1,CROUCH:1,BLOCK:1};
function fresh(d,dR,gap,max){ const m=Sim.createMatch(12345,JSON.parse(JSON.stringify(cfg)),null);
  let g=0; while(m.phase!=='fight'&&g++<1000) Sim.step(m,[d,dR],[N(),N()]);
  const [f,o]=m.fighters; f.x=400; o.x=400+gap; f.meter=f.maxMeter; if(max){ f.maxMode=true; f.maxT=900; } return {m,f,o}; }
// un golpe solo: ventaja (hit/guardia) y cuántos golpes conectan
function single(d,dR,name,gap,block,max){
  const {m,f,o}=fresh(d,dR,gap,max), seq=moveSeq(d,name); if(!seq) return null;
  const mv=d.moves[name], low=mv.guardType==='low';
  const dIn=block ? I({block:1,down:low?1:0}) : N();
  let hits=0, first=-1, attFree=-1, defFree=-1, prevTaken=o.taken, started=false, endState='';
  for(let t=0;t<260;t++){
    Sim.step(m,[d,dR],[t<seq.length?seq[t]:N(), dIn]);
    if(f.move===name) started=true;
    if(o.taken>prevTaken){ hits+=o.taken-prevTaken; prevTaken=o.taken; if(first<0) first=m.frame; }
    if(first>=0){
      if(attFree<0 && FREE[f.state] && f.grounded) attFree=m.frame;
      if(defFree<0 && (FREE[o.state]) && o.grounded) defFree=m.frame;
      if(!endState && (o.state==='KNOCKDOWN'||o.state==='LAUNCHED')) endState='derriba';
    }
    if(first>=0 && attFree>=0 && defFree>=0) break;
  }
  return {started, hits, adv: (first>=0&&attFree>=0&&defFree>=0) ? (defFree-attFree) : null, endState, hpLost: 300-o.hp};
}
function bestGap(d,dR,name,max){ // distancia más cómoda a la que el golpe conecta al primer intento
  for(const gap of [46,56,66,78,92,110,130,160]){ const r=single(d,dR,name,gap,false,max); if(r && r.hits>0) return gap; }
  return null; }
// cadena en MAX: base ⇒ next, probando el momento de la 2ª entrada
function chainMax(d,dR,base,next,gap){
  let best={combo:0,used2:false};
  for(let s2=3;s2<=40;s2++){ const {m,f}=fresh(d,dR,gap,true), bs=moveSeq(d,base), ns=moveSeq(d,next); if(!bs||!ns) return null;
    let mc=0, used=false;
    for(let t=0;t<200;t++){ let inp=N(); if(t<bs.length) inp=bs[t]; const k=t-s2; if(k>=0&&k<ns.length) inp=ns[k];
      Sim.step(m,[d,dR],[inp,N()]); if(f.move===next) used=true; mc=Math.max(mc,f.comboCount); }
    if(mc>best.combo || (used && !best.used2)) best={combo:mc,used2:used};
    if(best.combo>=2 && best.used2) break; }
  return best; }
const dR=def('personaje_08');
const ids = who==='all' ? roster.map(c=>c.id) : [who];
const report={};
let nMulti=0, nMultiOk=0, nMax=0, nMaxOk=0;
for(const id of ids){ let d; try{ d=def(id); }catch(e){ continue; }
  const rows=[], warn=[], R=report[id]={moves:{},maxChains:{}};
  const hidden=new Set((d.inputs.hidden||[]).map(h=>h.move));
  for(const [name,mv] of Object.entries(d.moves)){
    if(mv.air || mv.type==='throw' || mv.type==='command_grab' || !moveSeq(d,name)) continue;
    const max=hidden.has(name), gap=bestGap(d,dR,name,max);
    if(gap==null){ warn.push(`${name}: no conecta a ninguna distancia probada`); R.moves[name]={connects:false}; continue; }
    const h=single(d,dR,name,gap,false,max), b=single(d,dR,name,gap,true,max);
    const decl = mv.multiHit ? Math.max(1,(mv.hitFrames||[]).length) : 1;
    R.moves[name]={gap, hits:h.hits, declared:decl, advHit:h.adv, advBlock:b.adv, knock:h.endState};
    rows.push(`  ${name.padEnd(22)} gap ${String(gap).padStart(3)}  golpes ${h.hits}/${decl}  ventaja golpe ${h.endState?'derriba':String(h.adv).padStart(4)}  guardia ${String(b.adv).padStart(4)}`);
    if(decl>1){ nMulti++; if(h.hits>=decl) nMultiOk++; else warn.push(`${name}: multi-golpe conecta ${h.hits} de ${decl}`); }
    if(b.adv!=null && b.adv<=-20 && !mv.super && !hidden.has(name)) warn.push(`${name}: muy castigable en guardia (${b.adv})`);
    if(b.adv!=null && b.adv>=3 && !mv.super) warn.push(`${name}: ventaja en guardia ${b.adv} (presión infinita posible)`);
  }
  // cadenas que solo existen en MAX
  for(const [name,mv] of Object.entries(d.moves)){ if(!mv.cancelInto || mv.air) continue;
    for(const tgt of mv.cancelInto){ const tm=d.moves[tgt]; if(!tm) continue;
      const needsMax = hidden.has(tgt) || (mv.special && tm.super);
      if(!needsMax) continue; nMax++;
      const gap=(R.moves[name]&&R.moves[name].gap)||56, r=chainMax(d,dR,name,tgt,gap);
      const ok=r && r.used2 && r.combo>=2; if(ok) nMaxOk++;
      R.maxChains[name+'>'+tgt]=ok;
      if(!ok) warn.push(`MAX ${name} ⇒ ${tgt}: ${!r?'no medible':!r.used2?'no sale':'sale pero no combea'}`);
    } }
  console.log(`\n### ${id}`); console.log(rows.join('\n'));
  if(warn.length) console.log('  ⚠ '+warn.join('\n  ⚠ '));
}
console.log(`\n== MULTI-GOLPE completos: ${nMultiOk}/${nMulti} · CADENAS EN MAX que combean: ${nMaxOk}/${nMax} ==`);
if(jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report,null,1));
