// Vuelca frame a frame un combo de El Paisa (clip/idx/pos de ambos) para componer una tira. Uso: node combo_trace.cjs <raiz> <out.json>
const fs=require('fs'),path=require('path'),vm=require('vm');const[root,outj]=process.argv.slice(2);
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const d=def('el_paisa_sistem'),dR=def('personaje_08');
const N=()=>({x:0,down:false,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const m=Sim.createMatch(12345,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[d,dR],[N(),N()]);
const[f,o]=m.fighters;f.x=410;o.x=462;f.meter=f.maxMeter;
const sc={0:I({punchPress:1}),3:I({down:1}),4:I({down:1,x:1}),5:I({x:1,kickPress:1}),
  20:I({down:1}),21:I({down:1,x:1}),22:I({x:1}),23:I({down:1}),24:I({down:1,x:1}),25:I({x:1,punchPress:1})};
const frames=[];let lastHp=o.hp;
for(let t=0;t<60;t++){Sim.step(m,[d,dR],[sc[t]||N(),N()]);
  const fc=d.clips[f.clip]||d.clips.idle, oc=dR.clips[o.clip]||dR.clips.idle;
  frames.push({t,impact:o.hp<lastHp,combo:f.comboCount,
    a:{clip:f.clip,idx:Sim.clipFrameIndex(fc,f.clipTime),x:Math.round(f.x),y:Math.round(f.y),face:f.facing,st:f.state,move:f.move},
    o:{clip:o.clip,idx:Sim.clipFrameIndex(oc,o.clipTime),x:Math.round(o.x),y:Math.round(o.y),face:o.facing,st:o.state}});
  lastHp=o.hp;}
fs.writeFileSync(outj,JSON.stringify(frames));
console.log('impactos en t=',frames.filter(x=>x.impact).map(x=>x.t+'('+x.a.move+',combo'+x.combo+')').join(' '));
