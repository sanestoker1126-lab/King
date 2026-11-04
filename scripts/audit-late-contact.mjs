import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ARENA, ATTACKS, createMatch, stepMatch } from '../src/engine.js';
const root=fileURLToPath(new URL('../',import.meta.url));
let output=path.join(root,'audit-output/late-contact.json');
for(let i=2;i<process.argv.length;i++){
 if(process.argv[i]==='--output'&&process.argv[i+1])output=path.resolve(process.argv[++i]);
 else if(process.argv[i]==='--help'){console.log('node scripts/audit-late-contact.mjs [--output path.json]');process.exit(0);}
 else throw new Error('Unknown or incomplete argument: '+process.argv[i]);
}
const report={generatedAt:new Date().toISOString(),historicalBaseline:'Before authored cancel routes/native fixed ticks, this specific synthetic replay produced J-to-J at192.00001ms. The current result below is measured anew; historical behavior is not assumed.',engineSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'src/engine.js'))).digest('hex'),representativeId:'tobi',limitation:'Optional sampled late-contact audit for Tobi only. Current fighters have distinct cancel routes; this natural-link sample must not be generalized to the roster or all timings.',method:'Grounded defender at right corner, grounded attacker at distance80 initially. Attacker first jumps with an actual input, waits a scanned number of input steps, then attacks in air. Contact can be delayed until the falling attacker enters vertical hit range. Defender stays grounded, holds guard from the step after the first clean hit. Follow-up starts at earliest legal step. No attack elapsed, hitstun, health or phase is injected.',results:[]};
const round=v=>Math.round(v*1e6)/1e6;
function probe(hz,waitFrames,first,second){
 const dt=1/hz;
 const m=createMatch({playerId:'tobi',opponentId:'mateo',ai:false});
 m.fighters.player.x=ARENA.maxX-80;m.fighters.opponent.x=ARENA.maxX;
 stepMatch(m,dt,{jump:true});
 for(let k=0;k<waitFrames;k++)stepMatch(m,dt,{});
 let firstHit=null,followupStart=null,followupHit=null,defenderFree=null;
 const startY=m.fighters.player.y;
 for(let f=0;f<hz*3;f++){
  const a=m.fighters.player;
  const ready=Math.max(0,a.actionTime-dt)===0 && Math.min(100,a.energy+dt*9)>=ATTACKS[second].energy && (second!=='special'||Math.max(0,a.specialCooldown-dt)===0);
  const tryNext=f>0&&firstHit!==null&&followupStart===null&&ready;
  const input=f===0?{[first]:true}:tryNext?{[second]:true}:{};
  input.opponent={block:firstHit!==null};
  stepMatch(m,dt,input);
  if(tryNext&&m.events.some(e=>e.type===second&&e.side==='player'))followupStart=f;
  if(firstHit!==null&&m.fighters.opponent.actionTime===0)defenderFree??=f;
  const hit=m.events.find(e=>e.type==='hit'&&e.side==='player');
  if(hit){
   if(firstHit===null){firstHit={frame:f,elapsed:m.fighters.player._attack.elapsed,attackerY:m.fighters.player.y,blocked:hit.blocked};assert(!hit.blocked);}
   else if(followupStart!==null){followupHit={frame:f,blocked:hit.blocked,defenderAction:m.fighters.opponent.action};break;}
  }
 }
 if(firstHit===null)return null;
 return {hz,waitFrames,first,second,startY:round(startY),firstHit:{...firstHit,elapsed:round(firstHit.elapsed),attackerY:round(firstHit.attackerY)},followupStart,followupHit,defenderFree,trueLink:followupHit!==null&&!followupHit.blocked&&(defenderFree===null||followupHit.frame<defenderFree)};
}
for(const hz of [20,30,60,120])for(const first of Object.keys(ATTACKS))for(const second of Object.keys(ATTACKS)){
 const cases=[];
 for(let waitFrames=0;waitFrames<=hz;waitFrames++){const c=probe(hz,waitFrames,first,second);if(c)cases.push(c);}
 const maximumElapsed=cases.length?Math.max(...cases.map(c=>c.firstHit.elapsed)):null;
 const late=cases.filter(c=>c.firstHit.elapsed===maximumElapsed);
 report.results.push({hz,first,second,status:cases.length?'SAMPLED':'NO_INITIAL_HITS_IN_SAMPLE',cases:cases.length,cleanLinks:cases.filter(c=>c.trueLink).length,latestContactSeconds:maximumElapsed,latestExamples:late.slice(0,2),allContactPhases:[...new Set(cases.map(c=>c.firstHit.elapsed))].sort((a,b)=>a-b)});
}

// A fixed, reproducible mixed-dt sequence discovered during the audit. It does
// not inject attack elapsed, stun or phase. It exercises real jump/attack inputs
// with dt always <= the engine's existing 50ms cap.
function mixedDeltaProbe(){
 const m=createMatch({playerId:'tobi',opponentId:'mateo',ai:false});
 m.fighters.player.x=ARENA.maxX-80;m.fighters.opponent.x=ARENA.maxX;
 stepMatch(m,.001,{jump:true});
 for(let i=0;i<446;i++)stepMatch(m,.001,{});
 let first=null,secondInput=null,secondStart=null,secondHit=null,free=null,t=0,f=0,attackStarts=0;
 const trace=[];
 const call=(dt,input)=>{
  stepMatch(m,dt,input);t+=Math.min(dt,.05);
  const events=structuredClone(m.events);
  trace.push({frame:f,dt,input,timeSeconds:t,playerY:m.fighters.player.y,playerAction:m.fighters.player.action,playerRecovery:m.fighters.player.actionTime,defenderAction:m.fighters.opponent.action,defenderRecovery:m.fighters.opponent.actionTime,events});
  for(const e of events)if(e.side==='player'&&e.type==='punch'){
   attackStarts++;if(attackStarts===2)secondStart={frame:f,timeSeconds:t};
  }
  const hit=events.find(e=>e.type==='hit'&&e.side==='player');
  if(hit){if(!first)first={frame:f,timeSeconds:t,elapsed:m.fighters.player._attack?.elapsed,blocked:hit.blocked};else secondHit={frame:f,timeSeconds:t,blocked:hit.blocked};}
  if(first&&m.fighters.opponent.actionTime===0)free??={frame:f,timeSeconds:t};f++;
 };
 call(.001,{punch:true});
 for(let i=0;i<16&&!first;i++)call(.01,{});
 if(!first)call(.008999999,{});
 if(!first)return {result:'HISTORICAL_INITIAL_HIT_NOT_REPRODUCED',trueLink:false,first:null,secondStart:null,secondHit:null,defenderFirstFree:null,trace,
  interpretation:'The historical synthetic inputs no longer connect their first attack. This is not a global proof about every mixed-dt sequence.'};
 let iterations=0;
 while(m.fighters.player.actionTime>.05&&iterations++<1000)call(.001,{opponent:{block:true}});
 assert(iterations<1000,'Mixed-dt probe recovery did not complete');
 const dt=Math.max(.000000001,m.fighters.player.actionTime);
 secondInput={frame:f,timeSeconds:t+dt,dt};
 call(dt,{punch:true,opponent:{block:true}});
 call(Math.max(.000000001,.07-dt+.00000001),{opponent:{block:true}});
 // Native fixed ticks can move the actual follow-up beyond the two old calls.
 // Continue with guard held so absence of an immediate hit is not called a fix.
 for(let i=0;i<60&&!secondHit;i++)call(1/60,{opponent:{block:true}});
 const trueLink=!!secondHit&&!secondHit.blocked&&(!free||secondHit.timeSeconds<free.timeSeconds);
 return {result:trueLink?'EMERGENT_TRUE_LINK':'HISTORICAL_LINK_NOT_REPRODUCED',trueLink,first,secondInput,secondStart,secondHit,defenderFirstFree:free,firstToSecondImpactMs:secondHit?(secondHit.timeSeconds-first.timeSeconds)*1000:null,
  interpretation:'Replays the historical mixed-dt input sequence against the current engine, then observes up to 60 further guarded ticks. Not a search over all mixed intervals.',
  setup:'Actual jump at1ms; wait446 calls1ms; punch input with1ms call;16 calls10ms then8.999999ms to late contact. After hit,1ms calls until recovery<=50ms; request next punch with remaining recovery asdt, finish the historical startup interval, then keep guard for up to60 native ticks. No phase/stun injected.',trace};
}
report.mixedDeltaProbe=mixedDeltaProbe();
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const total=report.results.reduce((n,r)=>n+r.cases,0);
const links=report.results.reduce((n,r)=>n+r.cleanLinks,0);
console.log(`Optional late-contact sweep: ${links}/${total} true links at uniform20/30/60/120Hz.`);
console.log(`Mixed-dt probe: ${report.mixedDeltaProbe.result}. Evidence: ${output}`);
