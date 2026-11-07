const fs=require('fs'),path=require('path'),vm=require('vm');const root=process.argv[2];
const ctx=vm.createContext({console,Math,JSON,Object,Array});ctx.window=ctx;
for(const f of ['engine/pg_rng.js','engine/pg_sim.js','engine/pg_ai.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const Sim=ctx.PGSim,cfg=JSON.parse(fs.readFileSync(path.join(root,'data/config.json'),'utf8'));
const def=id=>JSON.parse(fs.readFileSync(path.join(root,'assets/combat',id,id+'.char.json'),'utf8'));
const dSofi=def('sofi'),dR=def('personaje_08');
const N=()=>({x:0,down:false,block:false,up:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false});
for(const gap of [60,80,100]){
  const m=Sim.createMatch(123,JSON.parse(JSON.stringify(cfg)),null);while(m.phase!=='fight')Sim.step(m,[dSofi,dR],[N(),N()]);
  const [f,o]=m.fighters; f.x=400;o.x=400+gap; f.hp=Math.floor(f.maxHp*0.49); const hp0=o.hp;
  let hits=[],oAir=0;
  for(let t=0;t<180;t++){const ph=o.hp,pg=o.grounded;Sim.step(m,[dSofi,dR],[N(),N()]); if(o.hp<ph){hits.push(o.hp-ph<0?ph-o.hp:0); if(!pg||!o.grounded)oAir++;}}
  console.log(`rival a ${gap}px: golpes de garras/remate=${hits.length}, daño total=${hp0-o.hp}, golpes con rival en aire=${oAir}`);
}
