// Ejecuta cada especial OCULTO solo, con MAX activo, y mide si sale y pega. Uso: node hidden_solo.cjs <raiz>
const fs=require('fs'),path=require('path'),vm=require('vm');const root=process.argv[2];
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const roster=JSON.parse(fs.readFileSync(path.join(root,'data/roster.json'),'utf8')).characters.filter(c=>c.status==='playable');
const N=()=>({x:0,down:false,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
function motionSeq(motion,b){const B=b==='punch'?'punchPress':b==='kick'?'kickPress':b==='special'?'specialPress':'superPress';
  const M={qcf:[{down:1},{down:1,x:1},{x:1,[B]:1}],qcb:[{down:1},{down:1,x:-1},{x:-1,[B]:1}],
    dp:[{x:1},{},{down:1},{down:1,x:1,[B]:1}],hcf:[{x:-1},{down:1,x:-1},{down:1},{down:1,x:1},{x:1,[B]:1}],
    qcf2:[{down:1},{down:1,x:1},{x:1},{down:1},{down:1,x:1},{x:1,[B]:1}]}[motion]||[{[B]:1}];
  return M.map(I);}
let ok=0,tot=0,fail=[];
for(const c of roster){const d=def(c.id),dR=def('personaje_08');
  for(const h of (d.inputs.hidden||[])){tot++;
    let best=0;
    for(const gap of[50,70,90]) for(let pre=0;pre<=4;pre++){
      const m=Sim.createMatch(123,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[d,dR],[N(),N()]);
      const[f,o]=m.fighters;f.x=400;o.x=400+gap;f.meter=f.maxMeter;f.maxMode=true;f.maxT=360;const hp0=o.hp;
      const seq=motionSeq(h.motion,h.button);let got=false;
      for(let t=0;t<120;t++){let inp=N();const k=t-pre;if(k>=0&&k<seq.length)inp=seq[k];Sim.step(m,[d,dR],[inp,N()]);if(f.move===h.move)got=true;}
      best=Math.max(best,(got?1000:0)+(hp0-o.hp));
    }
    const salio=best>=1000,dmg=best%1000;
    if(salio&&dmg>0)ok++;else fail.push(`${c.id}/${h.move} (salió:${salio} dmg:${dmg})`);
  }}
console.log(`OCULTOS que salen y pegan en MAX: ${ok}/${tot}`);
if(fail.length)console.log('revisar:\n  '+fail.join('\n  '));
