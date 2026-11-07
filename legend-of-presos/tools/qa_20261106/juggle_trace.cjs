// Traza el juggle de El Paisa (uppercut->súper en MAX) frame a frame para la tira visual. Uso: node juggle_trace.cjs <raiz> <out.json>
const fs=require('fs'),path=require('path'),vm=require('vm');const[root,outj]=process.argv.slice(2);
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const d=def('el_paisa_sistem'),dR=def('personaje_08');
const N=()=>({x:0,down:false,block:false,up:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
const I=o=>Object.assign(N(),o);
const m=Sim.createMatch(99,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[d,dR],[N(),N()]);
const[f,o]=m.fighters;f.x=400;o.x=430;f.meter=f.maxMeter;f.maxMode=true;f.maxT=360;
// uppercut (dp+P) en t0, luego súper (qcf2+P) con s2 que da 3 aéreos
const up={0:I({x:1}),2:I({down:1}),3:I({down:1,x:1,punchPress:1})};
const su={6:I({down:1}),7:I({down:1,x:1}),8:I({x:1}),9:I({down:1}),10:I({down:1,x:1}),11:I({x:1,punchPress:1})};
const sc=Object.assign({},up,su);
const frames=[];let lastHp=o.hp;
for(let t=0;t<80;t++){Sim.step(m,[d,dR],[sc[t]||N(),N()]);
  const fc=d.clips[f.clip]||d.clips.idle, oc=dR.clips[o.clip]||dR.clips.idle;
  frames.push({t,impact:o.hp<lastHp,juggle:o.juggle,oAir:!o.grounded,
    a:{clip:f.clip,idx:Sim.clipFrameIndex(fc,f.clipTime),x:Math.round(f.x),y:Math.round(f.y),face:f.facing},
    o:{clip:o.clip,idx:Sim.clipFrameIndex(oc,o.clipTime),x:Math.round(o.x),y:Math.round(o.y),face:o.facing}});
  lastHp=o.hp;}
fs.writeFileSync(outj,JSON.stringify(frames));
console.log('impactos:',frames.filter(x=>x.impact).map(x=>`t${x.t}(${x.oAir?'AIRE y='+x.o.y:'suelo'},j${x.juggle})`).join(' '));
