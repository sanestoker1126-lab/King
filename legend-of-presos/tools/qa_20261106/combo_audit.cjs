// Auditoría OBJETIVA de combos y cancelaciones con la simulación real (engine/pg_sim.js), en Node.
// Para cada personaje mide, cadena por cadena declarada en cancelInto, si el combo COMPLETA (el 2º golpe
// conecta mientras el rival sigue en stun: comboCount>=2) probando varios timings de la 2ª entrada.
// Reporta: cadenas que completan, cancelInto ROTOS (move inexistente), especiales OCULTOS y si su animación
// cabe (hitFrames dentro del clip). NO cambia nada; solo mide. Uso: node combo_audit.cjs <raiz> [id|all] [rival]
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.argv[2], who=process.argv[3]||'all', rivalId=process.argv[4]||'personaje_08';
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js']) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim, cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const roster=JSON.parse(fs.readFileSync(path.join(root,'data/roster.json'),'utf8')).characters.filter(c=>c.status==='playable');
const N=()=>({x:0,down:false,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const BTN={punch:'punchPress',kick:'kickPress'};
// secuencia de motion (relativa al facing +1). Devuelve lista de inputs; el botón va en el último.
function motionSeq(motion,button){
  const b=BTN[button]; const P=x=>I(x);
  const M={
    qcf:[{down:1},{down:1,x:1},{x:1,[b]:1}],
    qcb:[{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    dp:[{x:1},{},{down:1},{down:1,x:1,[b]:1}],
    hcf:[{x:-1},{down:1,x:-1},{down:1},{down:1,x:1},{x:1,[b]:1}],
    hcb:[{x:1},{down:1,x:1},{down:1},{down:1,x:-1},{x:-1,[b]:1}],
    qcf2:[{down:1},{down:1,x:1},{x:1},{down:1},{down:1,x:1},{x:1,[b]:1}],
  }[motion];
  return (M||[{[b]:1}]).map(P);
}
// secuencia para arrancar un move cualquiera del personaje
function moveSeq(d,name){
  const In=d.inputs;
  if(In.grounded&&In.grounded.punch===name) return [I({punchPress:1})];
  if(In.grounded&&In.grounded.kick===name) return [I({kickPress:1})];
  if(In.air) { if(In.air.punch===name) return 'AIRP'; if(In.air.kick===name) return 'AIRK'; }
  if(In.forward){ if(In.forward.punch===name) return [I({x:1}),I({x:1,punchPress:1})]; if(In.forward.kick===name) return [I({x:1}),I({x:1,kickPress:1})]; }
  for(const g of ['specials','supers','hidden']) for(const s of (In[g]||[])) if(s.move===name) return motionSeq(s.motion,s.button);
  return null;
}
function fresh(d,dR,gap){
  const m=Sim.createMatch(12345,JSON.parse(JSON.stringify(cfg)),null);
  let guard=0; while(m.phase!=='fight'&&guard++<1000) Sim.step(m,[d,dR],[N(),N()]);
  const [f,o]=m.fighters; f.x=400;o.x=400+gap; f.meter=f.maxMeter; return {m,f,o};
}
// La 2ª secuencia empieza en el frame absoluto start2 (el motion largo puede PRE-bufferearse antes del contacto,
// como hace un jugador). Devuelve {combo,dmg,used2}.
function tryChain(d,dR,base,next,gap,start2){
  const {m,f,o}=fresh(d,dR,gap);
  const bs=moveSeq(d,base), ns=moveSeq(d,next);
  if(!bs||bs==='AIRP'||bs==='AIRK'||!ns||ns==='AIRP'||ns==='AIRK') return null;
  let maxCombo=0; const hp0=o.hp; let seen2=false;
  for(let t=0;t<170;t++){
    let inp=N();
    if(t<bs.length) inp=bs[t];
    const k=t-start2; if(k>=0 && k<ns.length) inp=ns[k];
    Sim.step(m,[d,dR],[inp,N()]);
    if(f.move===next) seen2=true;
    maxCombo=Math.max(maxCombo,f.comboCount);
  }
  return {combo:maxCombo, dmg:hp0-o.hp, used2:seen2};
}
function baseOnly(d,dR,base,gap){ const {m,f,o}=fresh(d,dR,gap); const bs=moveSeq(d,base);
  if(!bs||bs==='AIRP'||bs==='AIRK') return 0; const hp0=o.hp;
  for(let t=0;t<120;t++){ Sim.step(m,[d,dR],[t<bs.length?bs[t]:N(),N()]); } return hp0-o.hp; }
function best(d,dR,base,next){
  if(!d.moves[next]) return {broken:true};
  let r={combo:0,dmg:0,used2:false};
  for(const gap of [40,55,70]){ const b0=baseOnly(d,dR,base,gap);
    for(let start2=3;start2<=40;start2++){
      const x=tryChain(d,dR,base,next,gap,start2); if(!x) return {skip:true};
      x.added=x.dmg-b0;
      if(x.added>(r.added||-1) || (x.added===r.added&&x.combo>r.combo)) r=x;
    } }
  return r;
}
const dR=def(rivalId);
const list = who==='all'? roster.map(c=>c.id) : [who];
let totalChains=0, okChains=0, brokenRefs=0;
for(const id of list){
  let d; try{ d=def(id); }catch(e){ continue; }
  const lines=[]; const hiddenNote=[];
  // cancelInto de todos los moves con cancelInto
  for(const [mn,mv] of Object.entries(d.moves)){
    if(!mv.cancelInto) continue;
    for(const tgt of mv.cancelInto){
      totalChains++;
      const r=best(d,dR,mn,tgt);
      if(r.broken){ brokenRefs++; lines.push(`  ${mn} ⇒ ${tgt}: ROTO (destino no existe)`); continue; }
      if(r.skip){ lines.push(`  ${mn} ⇒ ${tgt}: (no medible: move aéreo)`); continue; }
      const tnom=(d.moves[tgt].damage)|| (d.moves[tgt].spawns&&d.moves[tgt].spawns.damage)||18;
      const conn = (r.added||0) >= Math.max(8, tnom*0.5);
      const ok = conn && r.used2;
      if(ok) okChains++;
      const tag = ok ? 'COMBO ✓' : (!r.used2 ? 'NO arranca el 2º' : 'arranca pero el 2º NO pega');
      if(!ok) lines.push(`  ${mn} ⇒ ${tgt}: ${tag} (añade ${r.added||0} dáño, combo=${r.combo})`);
    }
  }
  // especiales ocultos: ¿la animación cabe? hitFrames dentro del clip
  for(const s of (d.inputs.hidden||[])){
    const mv=d.moves[s.move]; if(!mv) { hiddenNote.push(`  oculto ${s.move}: ROTO (no existe)`); continue; }
    const clip=d.clips[mv.clip]; const nf=clip?clip.frames.length:0;
    const hf=mv.hitFrames||[]; const last=hf.length?Math.max(...hf):-1;
    hiddenNote.push(`  oculto ${s.move} (clip ${mv.clip}, ${nf} cuadros): hitFrames=${JSON.stringify(hf)} ${last>=nf?'⚠ FUERA del clip':last<0?'(sin hitFrames)':'✓ dentro'}`);
  }
  console.log(`\n### ${id} (${Object.values(d.moves).filter(m=>m.cancelInto).length} moves con cancelInto)`);
  if(lines.length) console.log(lines.join('\n')); else console.log('  (sin cancelInto)');
  if(hiddenNote.length) console.log(hiddenNote.join('\n'));
}
console.log(`\n== TOTAL: ${okChains}/${totalChains} cadenas completan combo; ${brokenRefs} referencias rotas ==`);
