// QA de la campaña Arcade con el CÓDIGO REAL de engine/pg_game.js (se extraen sus funciones de Arcade y se ejecutan con un G mínimo).
// Verifica: jefe final nunca se salta (espejo si eliges a Garravas), sub-jefa se salta si la juegas, en Equipos el jefe no se
// reemplaza y solo él lleva memberMods.  Uso: node arcade_bosses.cjs <raiz>
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.argv[2] || '.';
const src = fs.readFileSync(path.join(root, 'engine/pg_game.js'), 'utf8');
function fn(name) { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('no está ' + name);
  let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const code = ['resolveAlias', 'autoPool', 'copyBattle', 'arcadeStart', 'arcadeNextMatch'].map(fn).join('\n');
const J = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
function make() {
  const ctx = { console, JSON, Object, Array, global: {}, window: {} };
  ctx.G = { roster: J('data/roster.json'), campaigns: J('data/campaigns.json'), stages: J('data/stages.json'), fe: { sel: {}, vs() { ctx.shots.push(JSON.parse(JSON.stringify(this.sel))); } } };
  ctx.shots = []; vm.createContext(ctx); vm.runInContext(code + '\nthis.arcadeStart=arcadeStart; this.arcadeNextMatch=arcadeNextMatch;', ctx); return ctx;
}
let fails = 0; const ok = (c, msg) => { console.log((c ? 'OK    ' : 'FALLA ') + msg); if (!c) fails++; };
function solo(you) { const c = make(); c.arcadeStart({ yourId: you }); return c.G.arcadeCampaign; }
function team(t) { const c = make(); c.arcadeStart({ team: true, team1: t }); return c; }
let A = solo('tobi'); ok(A.length === 6 && A.battles[5].opponent === 'garravas' && A.battles[5].mods.hp === 2.5, `1v1 Tobi: 6 combates, jefe final Garravas con mods ${JSON.stringify(A.battles[5].mods)}`);
A = solo('garravas'); ok(A.length === 6 && A.battles[5].opponent === 'garravas' && A.battles[5].boss, '1v1 Garravas: el jefe final NO se salta (espejo Garravas vs Garravas)');
A = solo('sofi'); ok(A.length === 5 && !A.battles.some(b => b.midBoss) && A.battles[4].opponent === 'garravas', '1v1 Sofi: se salta su batalla de sub-jefa (5 combates) y sí está el jefe final');
A = solo('regente'); ok(A.length === 5 && A.battles[0].opponent === 'cadena', '1v1 Regente: se salta la batalla contra sí mismo (como antes)');
let c = team(['tobi', 'calavera', 'regente']); A = c.G.arcadeCampaign; let b = A.battles[A.length - 1];
ok(b.boss && JSON.stringify(b.opponentTeam) === '["mateo","cochibomba","garravas"]' && b.memberMods.garravas.hp === 2.5, 'Equipos normal: jefe final mateo/cochibomba/garravas con memberMods solo para garravas');
// simular el paso al último combate para ver los mods que recibe el MatchState
A.idx = A.length - 1; c.arcadeNextMatch(); let sel = c.shots[c.shots.length - 1];
ok(JSON.stringify(sel.mods) === JSON.stringify([{ hp: 1, damage: 1 }, { hp: 1, damage: 1, members: [null, null, { hp: 2.5, damage: 1.7 }] }]) && /JEFE FINAL/.test(sel.tag) && sel.track === 'boss', `Equipos: mods al MatchState ${JSON.stringify(sel.mods)} · ${sel.tag}`);
c = team(['garravas', 'mateo', 'nadia']); A = c.G.arcadeCampaign; b = A.battles[A.length - 1];
ok(b.opponentTeam[2] === 'garravas' && b.opponentTeam[0] !== 'mateo' && b.memberMods.garravas, `Equipos con Garravas y Mateo en tu equipo: jefe se queda (espejo), Mateo reemplazado → ${b.opponentTeam.join(', ')}`);
A.idx = A.length - 1; c.arcadeNextMatch(); sel = c.shots[c.shots.length - 1];
ok(sel.mods[1].members[2] && sel.mods[1].members[2].hp === 2.5 && sel.mods[1].members[0] === null, 'Equipos espejo: el integrante 3 (Garravas) conserva su modificador; los demás null');
c = team(['sofi', 'tobi', 'nadia']); A = c.G.arcadeCampaign; ok(!A.battles.some(x => x.midBoss), 'Equipos con Sofi: se salta la batalla de sub-jefa (como antes)');
c = team(['tobi', 'calavera', 'regente']); A = c.G.arcadeCampaign; A.idx = 3; c.arcadeNextMatch(); sel = c.shots[c.shots.length - 1];
ok(JSON.stringify(sel.mods) === JSON.stringify([{ hp: 1, damage: 1 }, { hp: 2, damage: 2 }]) && /SUB-JEFA/.test(sel.tag), `Equipos sub-jefa sin cambios: ${JSON.stringify(sel.mods)} · ${sel.tag}`);
console.log(fails ? fails + ' FALLA(S)' : 'TODO OK'); process.exit(fails ? 1 : 0);
