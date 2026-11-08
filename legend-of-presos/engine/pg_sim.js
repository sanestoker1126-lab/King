/* PGSim v2 — simulación de combate determinista (spec §4), data-driven.
   Añade: saltos (corto/normal/alto), dash/backdash, rodada con invuln, agacharse,
   estado AÉREO + ataques aéreos, PROYECTILES (a distancia), especiales por COMANDO
   (QCF/QCB/DP con buffer de direcciones), cadenas de cancelación normal→especial→súper,
   súpers con invuln y meter, y sistema de RONDAS.
   Paso fijo 1/60. Render nunca toca este estado. Todo tunable viene de config.json. */
(function (global) {
  "use strict";

  let CFG = null; // se fija en createMatch
  let STEP_DEFS = null; // datos de personaje del paso en curso (solo lectura; se fija al inicio de step)
  let STEP_MATCH = null; // partida del paso en curso (la usa el aterrizaje en physics para eventos/letreros)
  // Impactos cuerpo a cuerpo detectados DURANTE el paso; se aplican al final, con ambos luchadores ya procesados.
  // Transitorio (vacío al terminar cada paso, no forma parte del MatchState). Ver "impactos del frame" en step().
  const PENDING = [ { on:false, mv:null, ix:0, iy:0, hitId:0, name:null }, { on:false, mv:null, ix:0, iy:0, hitId:0, name:null } ];

  const S = Object.freeze({
    IDLE:"IDLE", WALK_F:"WALK_F", WALK_B:"WALK_B", CROUCH:"CROUCH", PREJUMP:"PREJUMP", JUMP:"JUMP",
    DASH:"DASH", BACKDASH:"BACKDASH", ROLL:"ROLL",
    ATTACK:"ATTACK", AIR_ATTACK:"AIR_ATTACK", SPECIAL:"SPECIAL", SUPER:"SUPER",
    BLOCK:"BLOCK", BLOCKSTUN:"BLOCKSTUN", HITSTUN:"HITSTUN", LAUNCHED:"LAUNCHED", KO:"KO",
    KNOCKDOWN:"KNOCKDOWN", WAKEUP:"WAKEUP", GUARD_CRUSH:"GUARD_CRUSH", WIN:"WIN", DIZZY:"DIZZY",
    THROW:"THROW", THROWN:"THROWN", TECH:"TECH", MAXACT:"MAXACT"
  });
  const STATE_CLIP = {
    IDLE:"idle", WALK_F:"walk", WALK_B:"walk", CROUCH:"crouch_guard", PREJUMP:"jump_mobility", JUMP:"jump_mobility",
    DASH:"run", BACKDASH:"jump_mobility", ROLL:"jump_mobility",
    BLOCK:"crouch_guard", BLOCKSTUN:"crouch_guard", HITSTUN:"damage_fall",
    LAUNCHED:"damage_fall", KO:"damage_fall",
    KNOCKDOWN:"down", WAKEUP:"recovery_pose", GUARD_CRUSH:"hurt", WIN:"victory_pose", DIZZY:"dizzy",
    THROW:"front_grab", THROWN:"damage_fall", TECH:"jump_mobility", MAXACT:"recovery_pose"
  };
  // estados del RIVAL en los que un golpe nuevo sigue contando como el mismo combo
  const COMBO_STUN = { HITSTUN:1, LAUNCHED:1, THROWN:1, KO:1, GUARD_CRUSH:1 };
  // si el personaje no trae un clip derivado (tools/build_*_clips.py), se usa este
  // (lista = el primero que el personaje sí tenga). `dizzy` no existe en ninguna hoja todavía: de pie dolido y, si no, idle
  // (nunca damage_fall: su último cuadro es caído y el mareado está de pie)
  const CLIP_FALLBACK = { down:"damage_fall", hurt:"damage_fall", recovery_pose:"idle", victory_pose:"idle", dizzy:["hurt","idle"] };
  function clipOf(f, name){ const dd=STEP_DEFS&&STEP_DEFS[f.side]; if(!dd || dd.clips[name]) return name;
    const fb=CLIP_FALLBACK[name]; if(!fb) return name; if(typeof fb==="string") return fb;
    for(let i=0;i<fb.length;i++) if(dd.clips[fb[i]]) return fb[i]; return fb[fb.length-1]; }

  // hpMul: multiplicador de vida de ESA batalla (match.mods[side].hp; p.ej. un sub-jefe con el doble de vida). 1 por defecto.
  function createFighter(side, x, hpMul){
    const hp = Math.round(CFG.fighters.hp * (hpMul || 1));
    return {
      side, x, y:CFG.arena.ground, vx:0, vy:0, facing: side===0?1:-1, grounded:true,
      hp:hp, maxHp:hp, meter:0, maxMeter:CFG.meter.max,
      guard:CFG.guard.max, maxGuard:CFG.guard.max, guardT:0, maxMode:0,
      state:S.IDLE, stateFrame:0, clip:"idle", clipTime:0,
      move:null, moveFrame:0, hitId:0, airAtkUsed:false,
      hitstun:0, blockstun:0, invuln:0, juggle:0, maxT:0, grabbedBy:-1, techWin:0,
      comboCount:0, comboTimer:0, comboDamage:0,
      taken:0,               // contactos recibidos (golpe, guardia o agarre): lo lee el modo Entrenamiento (pg_training.js)
      downT:0, wakeDur:0, crushT:0, ukemiT:0, hardKd:false,   // derribo/levantada/guardia rota/recuperación
      stun:0, stunT:0, stunLock:0, dizzyPend:false, dizzyT:0, mashCd:0,   // MAREO: aturdimiento acumulado, frames sin recibir, bloqueo tras marearse, mareo pendiente, frames de mareo
      ragedUsed:false, ragePending:false, transformed:false,   // AUTO-TRANSFORMACIÓN (autoTransform): Sofi a media vida; `transformed` = ya en Modo Vestía (moveset morado + buff)
      contact:false,           // el move en curso ya conectó (golpe o guardia): habilita la cancelación (hit.cancelOnContact)
      agP:99, agK:99, agS:99,  // frames desde la última pulsación de Puño/Patada/Especial (ventana de dos botones §4.4)
      bufP:0, bufK:0, bufS:0, bufU:0,   // BUFFER de botones: frames que le quedan a una pulsación guardada (Puño/Patada/Especial/Súper)
      bufX:0,                  // dirección horizontal que se tenía al pulsar (para que un adelante+botón guardado siga siendo 'adelante')
      jumpKind:0, jumpDir:0,   // pre-salto: 0 normal · 1 corto (hop) · 2 alto (abajo→arriba); dirección -1/0/1
      struck:{}, dirHist:[], tapHist:[]
    };
  }

  // opts.teams = [[id,id,id],[id,id,id]] -> modo EQUIPOS (KOF): el orden es el de entrada; los equipos pueden ser de
  // distinto tamaño (un sub-jefe pelea SOLO contra los tres). Sin opts: pelea por rondas.
  // opts.mods = [{hp, damage}, {hp, damage}] -> modificadores de ESA batalla por lado (datos de la campaña: un sub-jefe con
  // el doble de vida y de daño). Viven en el MatchState (serializable, deterministas); por defecto 1.
  // mods[s].members = [{hp, damage} | null, ...] (opcional, alineado con el orden de opts.teams[s]): modificador de UN integrante
  // del equipo (el jefe final en Equipos: solo Garravas con más vida/daño, no sus compañeros). null = usa el del lado.
  // Sin `members` el objeto queda exactamente igual que antes (misma forma, mismo resultado).
  function modOne(x){ x=x||{}; return { hp:(typeof x.hp==="number"&&x.hp>0)?x.hp:1, damage:(typeof x.damage==="number"&&x.damage>0)?x.damage:1 }; }
  function modsOf(o){ const m=(o&&o.mods)||[]; return [0,1].map(function(s){ const x=m[s]||{}, r=modOne(x);
    if(Array.isArray(x.members)) r.members=x.members.map(function(e){ return e ? modOne(e) : null; });
    return r; }); }
  // modificador vigente del lado s (el del integrante `cur` si lo declara; si no, el del lado)
  function modFor(M, s, cur){ const x=M[s]; return (x.members && cur!=null && x.members[cur]) || x; }
  function createMatch(seed, config, opts){
    CFG = config || CFG || DEFAULTS;
    const teams = (opts && opts.teams) ? opts.teams.map(function(ids){
      // status por integrante: "active" (peleando) · "ready" (esperando) · "out" (eliminado). Un solo campo, sin banderas sueltas.
      return { ids: ids.slice(), cur: 0, status: ids.map(function(_, i){ return i===0 ? "active" : "ready"; }) }; }) : null;
    const mods = modsOf(opts);
    const m = {
      frame:0, seed:(seed>>>0)||12345, rngState:(seed>>>0)||12345,
      fighters:[createFighter(0, CFG.fighters.startX[0], modFor(mods,0,teams?0:null).hp), createFighter(1, CFG.fighters.startX[1], modFor(mods,1,teams?0:null).hp)],
      mods: mods,
      projectiles:[], nextHitId:1,
      hitstop:0, shake:0, hitFlash:0, flashColor:"255,255,255", fx:[],
      superFreeze:0, cinematic:null,
      camera:{ x:CFG.arena.W/2, y:CFG.arena.H/2, zoom:1, dim:0, flash:0, f:{ x:CFG.arena.W/2, y:CFG.arena.H/2, zoom:1 } },
      timer:CFG.timing.roundTime*60, round:1, wins:[0,0],
      phase:"intro", phaseT:CFG.timing.roundIntro, over:false, winner:null, roundWinner:null,
      // fin de ronda: roundEnd "ko" | "time" | "double" (doble K.O.) | "draw" (tiempo con vida igual) · koFrame = frame del final
      roundEnd:"", koFrame:-1, perfect:false,
      // tick: pasos totales (avanza también en presentación, K.O. y congelamientos; `frame` solo en pelea). Para el fondo animado.
      tick:0,
      teams: teams, koTimer:0,   // equipos (null = por rondas) · koTimer = reloj que quedaba al terminar la ronda (recuperación del ganador)
      events:[], notice:{ kind:"", side:-1, frame:-999 }, cfg:CFG
    };
    return m;
  }

  // ---------- clips ----------
  function clipIndex(clip, t){ const step=60/(clip.fps||10); let i=Math.floor(t/step);
    const n=clip.frames.length; return clip.loop ? ((i%n)+n)%n : Math.min(i,n-1); }
  function clipDone(clip, t){ if(clip.loop) return false; return t >= (60/(clip.fps||10))*clip.frames.length; }
  function setState(f, st){ if(f.state!==st){ f.state=st; f.stateFrame=0; const c=STATE_CLIP[st]; if(c){ f.clip=clipOf(f,c); f.clipTime=0; } } }
  function setNotice(match, kind, side){ const n=match.notice; n.kind=kind; n.side=side; n.frame=match.frame; }   // letrero del HUD (sin basura)

  // ---------- cajas ----------
  function aabb(a,b){ return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y; }
  function hurtboxOf(f){
    const hb=CFG.hurtbox;
    // agachado = CROUCH, o bloqueando abajo (BLOCK/BLOCKSTUN con crouch) -> caja baja. Si el personaje NO trae arte de
    // agachado (clip crouch_guard), el sprite se dibuja de pie y la caja también se queda de pie: lo que se ve = lo que se
    // simula (pilar Justicia al frame). Sigue pudiendo bloquear abajo.
    const dd=STEP_DEFS&&STEP_DEFS[f.side], canDuck=!dd || !!dd.clips.crouch_guard;
    let h = (canDuck && (f.state===S.CROUCH || ((f.state===S.BLOCKSTUN||f.state===S.BLOCK)&&f.crouch))) ? hb.crouchH : (!f.grounded? hb.airH : hb.h);
    const sc = f.transformed ? 1.15 : 1;   // Modo Vestía: cuerpo ~1.15x (coincide con el sprite agrandado en pg_render)
    return { x:f.x-hb.w*sc/2, y:f.y-h*sc, w:hb.w*sc, h:h*sc };
  }
  function hitboxOf(f, mv){ const hb=mv.hitbox;
    return { x: f.x + (f.facing>0?hb.x:-hb.x-hb.w), y: f.y+hb.y, w:hb.w, h:hb.h }; }

  // ---------- moves con tiempos EXPLÍCITOS (§4.3: startup / active / recovery en frames) ----------
  // mv.frames = {startup, active, recovery}; mv.activeIdx = [i0, i1] índices del clip que muestran el impacto (medidos del
  // sprite, tools/build_normals.py). La animación se reparte sobre esos tiempos: los frames de golpe son EXACTAMENTE los
  // declarados, sin depender de fps ni de cuántos frames tenga el clip. Devuelve el índice de clip a mostrar (-1 = pose neutra:
  // el clip no trae preparación) y deja en PH_OUT si está activo / terminó.
  const PH_OUT = { active:false, done:false };
  function framePhase(mv, clip, mf){
    const Fm=mv.frames, S0=Fm.startup, A0=Fm.active, R0=Fm.recovery, n=clip.frames.length;
    const a0=mv.activeIdx?mv.activeIdx[0]:0, a1=mv.activeIdx?mv.activeIdx[1]:a0;
    let idx;
    if(mf<=S0) idx = a0>0 ? Math.min(a0-1, Math.floor((mf-1)*a0/S0)) : -1;
    else if(mf<=S0+A0) idx = a0 + Math.min(a1-a0, Math.floor((mf-S0-1)*(a1-a0+1)/A0));
    else { const rest=n-1-a1; idx = rest>0 ? a1+1+Math.min(rest-1, Math.floor((mf-S0-A0-1)*rest/Math.max(1,R0))) : a1; }
    PH_OUT.active = mf>S0 && mf<=S0+A0; PH_OUT.done = mf>=S0+A0+R0;
    return idx;
  }
  // ¿el move del luchador está en arranque o activo? (contragolpe)
  function inStartupOrActive(f, dd){
    const dm=dd.moves[f.move]; if(!dm) return false;
    if(dm.frames) return f.moveFrame <= dm.frames.startup + dm.frames.active;
    const dc=dd.clips[dm.clip]; if(!dc || !dm.hitFrames || !dm.hitFrames.length) return false;
    return clipIndex(dc,f.clipTime) <= dm.hitFrames[dm.hitFrames.length-1];
  }

  // ---------- comandos (buffer de direcciones) ----------
  // Misma semántica que antes (entradas con fr 1..win, máx. win), pero SIN basura por frame:
  // se compacta en sitio y se recicla el objeto más viejo que sale de la ventana (DoD §8).
  function pushDir(f, inp){
    const win=CFG.timing.motionWindow, dh=f.dirHist;
    for(let i=0;i<dh.length;i++) dh[i].fr++;
    let rec=null;
    while(dh.length && (dh[0].fr>win || dh.length>=win)) rec=dh.shift();
    if(rec){ rec.x=inp.x||0; rec.down=!!inp.down; rec.fr=1; dh.push(rec); }
    else dh.push({ x:inp.x||0, down:!!inp.down, fr:1 });
  }
  // token relativo al facing
  function tok(d, facing){
    const f = d.x!==0 ? ((d.x>0)===(facing>0)?"F":"B") : "";
    return (d.down?"D":"") + f; // "", "F","B","D","DF","DB"
  }
  function hasSeq(f, pattern){ // pattern: array de predicados sobre token
    const toks = f.dirHist.map(d=>tok(d,f.facing));
    let pi=0;
    for(let i=0;i<toks.length && pi<pattern.length;i++){ if(pattern[pi](toks[i])) pi++; }
    return pi===pattern.length;
  }
  const isDown = t=>t.indexOf("D")>=0, isFwd=t=>t.indexOf("F")>=0, isBack=t=>t.indexOf("B")>=0;
  function matchMotion(f, name){
    if(name==="qcf") return hasSeq(f,[isDown, isFwd]);
    if(name==="qcb") return hasSeq(f,[isDown, isBack]);
    if(name==="dp")  return hasSeq(f,[isFwd, isDown, isFwd]);
    if(name==="hcf") return hasSeq(f,[isBack, isDown, isFwd]);   // media luna (agarre de comando)
    if(name==="hcb") return hasSeq(f,[isFwd, isDown, isBack]);
    if(name==="qcf2")return hasSeq(f,[isDown,isFwd,isDown,isFwd]);
    return false;
  }
  function doubleTap(f, dir){ // dir "F"|"B": dos toques del mismo lado
    const w=CFG.timing.doubleTapWindow; let taps=f.tapHist.filter(t=>t.dir===dir && t.fr<=w);
    return taps.length>=2;
  }
  function recordTap(f, inp){
    const th=f.tapHist, w=CFG.timing.doubleTapWindow; let n=0;
    for(let i=0;i<th.length;i++){ th[i].fr++; if(th[i].fr<=w) th[n++]=th[i]; }
    th.length=n;                              // compactación en sitio (sin array nuevo por frame)
    if(inp.down){ th.length=0; return; } // una dirección hacia abajo rompe el doble-toque (deja limpias QCF/DP)
    const d = inp.x>0 ? ((f.facing>0)?"F":"B") : inp.x<0 ? ((f.facing>0)?"B":"F") : null;
    if(d && inp._xEdge) f.tapHist.push({dir:d, fr:0});
  }

  // ---------- selección de acción ----------
  function actionable(f){ return [S.IDLE,S.WALK_F,S.WALK_B,S.CROUCH].indexOf(f.state)>=0; }
  function inCancelWindow(f, defs){
    if(f.state!==S.ATTACK && f.state!==S.AIR_ATTACK && f.state!==S.SPECIAL) return false;
    const mv=defs.moves[f.move]; if(!mv) return false;
    if(CFG.hit.cancelOnContact && !f.contact) return false;          // KOF: solo se cancela lo que conectó
    if(mv.cancelFrames) return f.moveFrame>=mv.cancelFrames[0] && f.moveFrame<=mv.cancelFrames[1];
    if(!mv.cancelWindow) return false;
    const idx=clipIndex(defs.clips[mv.clip], f.clipTime);
    return idx>=mv.cancelWindow[0] && idx<=mv.cancelWindow[1];
  }
  // PRIORIDAD de comandos ante ambigüedad (§4.4: el más complejo gana). Una media luna (hcf) CONTIENE un cuarto de
  // círculo (qcf): antes solo se priorizaba el DP y la llave de comando (hcf+K) nunca salía si el personaje tenía
  // un especial qcf+K (le pasaba a casi todo el roster). Orden: medias lunas > DP > cuartos de círculo > el resto.
  const MOTION_RANK = { hcf:0, hcb:0, dp:1, qcf:2, qcb:2 };
  function pickSpecial(f, defs, button){
    const specs = defs.inputs.specials||[];
    let best=null, bestRank=99;
    for(let i=0;i<specs.length;i++){ const sp=specs[i];
      if(sp.button!==button) continue;
      const rk = MOTION_RANK[sp.motion]!=null ? MOTION_RANK[sp.motion] : 3;
      if(rk>=bestRank || !matchMotion(f,sp.motion) || !affordable(f,defs.moves[sp.move])) continue;
      best=sp.move; bestRank=rk; }
    return best;
  }
  function pickSuper(f, defs){
    const sup=(defs.inputs.supers||[]).find(s=>affordable(f,defs.moves[s.move]) && (!s.motion||matchMotion(f,s.motion)));
    return sup?sup.move:null;
  }
  function affordable(f, mv){ return !mv.meterCost || f.meter>=mv.meterCost; }
  // Estilo de pelea por personaje: override de física por `defs.style` (si no, config global)
  function PH(defs, key){ return (defs && defs.style && defs.style[key]!=null) ? defs.style[key] : CFG.physics[key]; }
  function pickSuperByButton(f, defs, inp){
    var list=(defs.inputs&&defs.inputs.supers)||[];
    for(var i=0;i<list.length;i++){ var s=list[i];
      var pressed = s.button==='punch'?inp.punchPress : s.button==='kick'?inp.kickPress : s.button==='special'?inp.specialPress : false;
      if(pressed && (!s.motion||matchMotion(f,s.motion)) && affordable(f,defs.moves[s.move])) return s.move;
    }
    return null;
  }
  // CANCELACIÓN A SÚPER (KOF): el súper tiene que estar en cancelInto del move actual (la ventana la revisa tryStartMove).
  // normal -> súper siempre; especial -> súper según config.hit.superCancel: "max" = solo dentro del MAX (regla de KOF 2002),
  // "always", "never"; súper -> súper nunca. En MAX también los ocultos (inputs.hidden) si están en cancelInto.
  // Entrada: el comando del súper con el botón de este frame o el guardado en el buffer, o el botón de súper.
  function superCancelOf(f, defs, mv, nb, inp){
    if(!mv.cancelInto || mv.super) return null;
    if(mv.special){ const m=(CFG.hit&&CFG.hit.superCancel)||"max"; if(m==="never" || (m==="max" && !f.maxMode)) return null; }
    const groups = f.maxMode ? [defs.inputs.hidden, defs.inputs.supers] : [defs.inputs.supers];
    const btnSup = inp.superPress || f.bufU>0;
    for(let g=0; g<groups.length; g++){ const list=groups[g]||[];
      for(let i=0;i<list.length;i++){ const s=list[i];
        if(mv.cancelInto.indexOf(s.move)<0 || !defs.moves[s.move] || !affordable(f,defs.moves[s.move])) continue;
        const pressed = (nb && s.button===nb) || (btnSup && g===groups.length-1);
        if(pressed && (!s.motion || matchMotion(f,s.motion))) return s.move;
      } }
    return null;
  }
  function pickHidden(f, defs, inp){
    var list=(defs.inputs&&defs.inputs.hidden)||[];
    for(var i=0;i<list.length;i++){ var h=list[i];
      var pressed = h.button==='punch'?inp.punchPress : h.button==='kick'?inp.kickPress : h.button==='special'?inp.specialPress : inp.superPress;
      if(pressed && (!h.motion||matchMotion(f,h.motion))) return h.move;
    }
    return null;
  }

  // ---------- FX (datos puros en match.fx; el render los dibuja, nunca los crea) ----------
  // kind: light|heavy|head|launch|super|block|grab|clash|fizzle|energy|max  ·  anim: id de data/fx_library.json
  // owner>=0 => anclado al luchador (ox/oy relativos a su pie y a su facing).
  function pushFx(match, o){ if(o.life0==null) o.life0=o.life; match.fx.push(o); return o; }

  // ---------- MAX mode ----------
  function maxActivate(f, match){
    if(f.maxMode || f.meter < CFG.meter.maxCost) return false;
    f.meter -= CFG.meter.maxCost; f.maxMode=true; f.maxT=CFG.timing.maxDur; clearBuffer(f);
    setState(f,S.MAXACT); f.invuln=Math.max(f.invuln,CFG.max.activateInvuln); f.vx=0;
    match.hitFlash=1; match.flashColor='255,210,120'; match.shake=Math.max(match.shake,5);
    pushFx(match,{t:'spark',x:f.x,y:f.y-CFG.hurtbox.h*0.5,kind:'max',facing:f.facing,life:14,owner:-1});
    match.events.push({t:'super'});
    return true;
  }

  // ---------- agarres / llaves ----------
  function tryGrab(f, opp, match, mv){
    var command = mv && mv.type==='command_grab';
    var range = (mv&&mv.range) || CFG.grab.range;
    if(!opp || Math.abs(opp.x-f.x) > range) return false;
    if(opp.state===S.KO || opp.state===S.KNOCKDOWN || opp.state===S.WAKEUP || opp.invuln>0) return false;
    var noGrab=[S.HITSTUN,S.LAUNCHED,S.THROWN,S.THROW,S.BLOCKSTUN];
    if(!command && noGrab.indexOf(opp.state)>=0) return false;          // normal: no agarra en stun/bloqueo
    if(command && [S.THROWN,S.THROW].indexOf(opp.state)>=0) return false;
    f.state=S.THROW; f.stateFrame=0; f.clip=(mv&&mv.clip)||'front_grab'; f.clipTime=0; f.move=null; clearBuffer(f);
    f._throw={ def: mv||{}, tossed:false, minT: command?0:CFG.grab.techWindow };
    opp.state=S.THROWN; opp.stateFrame=0; opp.clip='damage_fall'; opp.clipTime=0;
    opp.grabbedBy=f.side; opp.hitstun=9999; opp.vx=0; opp.vy=0; opp.grounded=true; opp.taken++;
    opp.techWin = command ? 0 : CFG.grab.techWindow;   // los agarres de comando no se escapan
    match.events.push({t:'heavy'});
    if(command && mv && mv.cinematic && global.PGCinematics) PGCinematics.trigger(match,f,typeof mv.cinematic==='object'?mv.cinematic:{kind:'grab'});
    return true;
  }
  function advThrowState(f, opp, defs, match){
    var clip=defs.clips[f.clip]||defs.clips.front_grab||defs.clips.idle; f.clipTime++;
    var idx=clipIndex(clip,f.clipTime), d=(f._throw&&f._throw.def)||{};
    var tossFrame = d.tossFrame!=null?d.tossFrame:4;
    if(opp.state===S.THROWN){ opp.x=f.x+f.facing*((d.hold!=null?d.hold:42)); opp.y=CFG.arena.ground; opp.facing=-f.facing; }
    // nunca se lanza antes de que termine la ventana de escape (antes: con clips de 1 frame el lanzamiento era instantáneo)
    if(f._throw && !f._throw.tossed && idx>=tossFrame && f.stateFrame>(f._throw.minT||0)){
      f._throw.tossed=true;
      var dmg=d.damage!=null?d.damage:CFG.grab.damage;
      if(f.maxMode) dmg=Math.round(dmg*CFG.max.throwDamageMul);
      dmg=Math.round(dmg*dmgMul(match,f.side));
      opp.hp=Math.max(CFG.fighters.minHp||0, opp.hp-dmg); addStun(opp, dmg*CFG.stun.throwMul/CFG.stun.mul);
      opp.state=S.LAUNCHED; opp.stateFrame=0; opp.clip='damage_fall'; opp.clipTime=0;
      opp.grounded=false; opp.vy=d.tossY!=null?d.tossY:CFG.grab.tossY; opp.vx=f.facing*(d.tossX!=null?d.tossX:CFG.grab.tossX);
      opp.juggle++; opp.hitstun=CFG.grab.tossHitstun; opp.grabbedBy=-1; opp.hardKd=!!CFG.knockdown.hardOnThrow;
      match.hitstop=Math.max(match.hitstop, d.hitstop||CFG.grab.hitstop); match.shake=Math.max(match.shake,CFG.grab.shake);
      pushFx(match,{t:'hit',x:opp.x,y:opp.y-CFG.hurtbox.h*0.5,kind:'grab',anim:d.hitAnim||null,facing:f.facing,life:d.hitLife||CFG.grab.sparkLife,owner:-1});
      match.events.push({t:'heavy'});
      f.meter=Math.min(f.maxMeter,f.meter+CFG.grab.meterGain);
      if(opp.hp<=0){ opp.state=S.KO; opp.hitstun=9999; onKO(match,f.side,true); }
    }
    physics(f);
    if(clipDone(clip,f.clipTime) && (!f._throw || f._throw.tossed)){ setState(f,S.IDLE); f._throw=null; }
  }

  function isCommandNormal(defs, name){
    const fw=defs.inputs&&defs.inputs.forward; if(!fw) return false;
    for(const k in fw) if(fw[k]===name) return true;
    return false;
  }
  function tryStartMove(f, name, defs, match){
    const mv=defs.moves[name]; if(!mv) return false;
    if(mv.type==='throw'||mv.type==='command_grab'){ return tryGrab(f, match.fighters[1-f.side], match, mv); }
    const air = !f.grounded;
    if(air){ if(!mv.air) return false; if(f.airAtkUsed) return false; }
    const canAct = actionable(f) || (air && f.state===S.JUMP);
    if(!canAct && !inCancelWindow(f,defs)){
      // permitir cancel solo si el nuevo move está en cancelInto del actual
      const cur=defs.moves[f.move];
      if(!(cur && cur.cancelInto && cur.cancelInto.indexOf(name)>=0 && inCancelWindow(f,defs))) return false;
    }
    if(mv.meterCost){ if(f.meter<mv.meterCost) return false; f.meter-=mv.meterCost; }
    f.move=name; f.moveFrame=0; f.clip=mv.clip; f.clipTime=0; f.contact=false; clearBuffer(f);
    // GOLPE DE COMANDO (adelante + botón, inputs.forward): ese "adelante" ya se usó. Se vacía el historial de direcciones
    // para que no cuente como el primer → de un DP: "→+P cancelado a ↓↘→+P" salía el DP (→ ↓ ↘) en vez del cuarto de
    // círculo (lo encontró tools/combo_check.js con Mateo). Solo golpes de comando: los especiales conservan su historial.
    if(!air && isCommandNormal(defs,name)) f.dirHist.length=0;
    f.state = mv.super?S.SUPER : mv.special?S.SPECIAL : air?S.AIR_ATTACK : S.ATTACK;
    f.stateFrame=0; f.hitId=0; f.struck={}; // nuevo golpe limpia su propio registro de impactos del defensor se maneja por hitId
    f._fxIdx=-1; f._hitIdx=-1;                // FX por frame del clip (mv.fx[].at) se emiten al ENTRAR a cada índice
    if(air) f.airAtkUsed=true;
    if(mv.invuln) f.invuln=Math.max(f.invuln, mv.invulnFrames||0);
    if(mv.spawnOnStart) spawnProjectile(f, mv, defs, match);
    // CINEMÁTICA: súper/DM o move marcado -> acercamiento de cámara + luces + congelamiento
    if((mv.super || mv.cinematic) && global.PGCinematics) PGCinematics.trigger(match, f, (typeof mv.cinematic==='object'?mv.cinematic:{kind:mv.super?'super':'special'}));
    return true;
  }

  // ---------- proyectiles ----------
  function spawnProjectile(f, mv, defs, match){
    if(!mv.spawns) return;
    if(match.projectiles.length>=CFG.projectile.max) return;
    const p=mv.spawns;
    // KOF: un proyectil propio en pantalla (config projectile.maxPerOwner; el move puede declarar maxActive)
    const maxOwn = p.maxActive!=null ? p.maxActive : (CFG.projectile.maxPerOwner!=null ? CFG.projectile.maxPerOwner : 99);
    let own=0; for(let i=0;i<match.projectiles.length;i++) if(match.projectiles[i].owner===f.side) own++;
    if(own>=maxOwn) return;
    const life=p.life||CFG.projectile.defaultLife;
    match.projectiles.push({
      owner:f.side, x:f.x + f.facing*(p.offsetX||40), y:(p.ground? CFG.arena.ground : f.y)+(p.offsetY!=null?p.offsetY:-80),
      vx:f.facing*(p.speed||CFG.projectile.defaultSpeed), life, life0:life,
      w:p.hitbox.w, h:p.hitbox.h, damage:p.damage||18, hitstun:p.hitstun||12, blockstun:p.blockstun||10,
      hitstop:p.hitstop||6, pushHit:p.pushHit||4, pushBlock:p.pushBlock||3, guardType:p.guardType||"high",
      chipDamage:p.chipDamage||0, launcher:!!p.launcher, pushY:p.pushY||0,
      kind:p.kind||"energy", anim:p.anim||null, hitAnim:p.hitAnim||null, hitLife:p.hitLife||16, h0:p.animH||0,
      hits:p.hits||1, hitEvery:p.hitEvery||8, hitSlow:(p.hitSlow!=null?p.hitSlow:1), cool:0, strength:p.strength||1, ground:!!p.ground,
      hitId:match.nextHitId++
    });
    match.events.push({t:"energy"});
  }

  // ---------- impacto ----------
  function applyHit(att, def, mv, match, isProj, ix, iy){
    if(def.invuln>0 || def.state===S.KO || def.state===S.KNOCKDOWN || def.state===S.WAKEUP) return false;   // tendido / levantándose: intocable
    if(att.hitId && def.struck[att.hitId]) return false;
    const blocking = (def.state===S.BLOCK||def.state===S.BLOCKSTUN) && blockOk(def, mv);
    if(att.hitId) def.struck[att.hitId]=true;
    def.taken++;
    if(ix==null){ ix=def.x; iy=def.y-CFG.hurtbox.h*0.5; }
    const fdir=dirTo(att,def);

    const H=CFG.hit, D=H.defaults, G=CFG.guard;
    const wl=CFG.arena.wall, W=CFG.arena.W;
    const wallDist = (fdir>0) ? (W - wl - def.x) : (def.x - wl);
    const cornerPress = (!isProj && att && att.vx!=null && CFG.corner && CFG.corner.enabled && wallDist<=(CFG.corner.threshold!=null?CFG.corner.threshold:16));
    const cornerPushMul = (CFG.corner && CFG.corner.pushMul!=null) ? CFG.corner.pushMul : 1.0;
    const base = mv.damage||D.damage, heavy = base>=H.heavyDamage;
    if(blocking){
      def.guard=Math.max(0, def.guard-(mv.guardDamage!=null ? mv.guardDamage : Math.max(G.damageMin, Math.round(base*G.damageMul)))); def.guardT=0;
      if(mv.chipDamage) def.hp=Math.max(1, def.hp-Math.round(mv.chipDamage*dmgMul(match,att.side)));   // chip: nunca mata (regla KOF por defecto)
      const pb = mv.pushBlock||D.pushBlock;
      if(def.guard<=0){   // GUARDIA ROTA: queda vulnerable crushStun frames y la barra se rellena
        def.guard=def.maxGuard; setState(def,S.GUARD_CRUSH); def.crushT=G.crushStun; def.vx=fdir*pb;
        if(cornerPress) att.vx = -fdir*pb*cornerPushMul;
        match.hitstop=Math.max(match.hitstop,G.crushHitstop); match.shake=Math.max(match.shake,G.crushShake);
        pushFx(match,{t:'hit',x:ix,y:iy,kind:'heavy',facing:fdir,life:H.sparkLife.super,owner:-1});
        match.events.push({t:"crush"}); setNotice(match,'crush',att.side);
        if(!isProj) att.meter=Math.min(att.maxMeter, att.meter+CFG.meter.gainBlock);
        return true;
      }
      def.blockstun=mv.blockstun||D.blockstun; def.crouch=(def.state===S.BLOCK&&def.wantCrouch); setState(def,S.BLOCKSTUN);
      def.vx=fdir*pb;
      if(cornerPress) att.vx = -fdir*pb*cornerPushMul;
      match.hitstop=Math.max(match.hitstop, Math.round((mv.hitstop||D.hitstop)*H.block.hitstopMul));
      match.shake=Math.max(match.shake,H.block.shake); match.events.push({t:"block"});
      pushFx(match,{t:'hit',x:ix,y:iy,kind:'block',facing:fdir,life:H.sparkLife.block,owner:-1});
      if(!isProj) att.meter=Math.min(att.maxMeter, att.meter+CFG.meter.gainBlock);
      return true;
    }
    const region = mv.hitbox && mv.hitbox.y<H.region.headY?"head":mv.hitbox&&mv.hitbox.y<H.region.chestY?"chest":"legs";
    const mult = H.regionDamage.enabled ? H.regionDamage[region] : 1;
    // CONTRAGOLPE: el defensor estaba en el arranque o en los frames activos de SU ataque
    let counter=false;
    { const dd=STEP_DEFS&&STEP_DEFS[def.side];
      if(dd && (def.state===S.ATTACK||def.state===S.AIR_ATTACK||def.state===S.SPECIAL||def.state===S.SUPER)) counter = inStartupOrActive(def, dd); }
    const C=CFG.counter;
    let dmg=Math.round(base*mult*(counter?C.damageMul:1)*dmgMul(match,att.side)*(att.transformed?(CFG.vestiaDamageMul||1.2):1));   // × modificador de batalla; ×1.2 en Modo Vestía (DISEÑO)
    const atk = att.comboRef||att;
    if(atk.comboCount>0) dmg=Math.round(dmg*Math.max(CFG.combo.minScale,1-atk.comboCount*CFG.combo.decay));
    if(!def.grounded) dmg=Math.round(dmg*Math.max(0.1,1-def.juggle*CFG.combo.juggleDecay));
    def.hp=Math.max(CFG.fighters.minHp||0, def.hp-dmg);   // minHp=1 en Entrenamiento: el maniquí no cae K.O.
    atk.comboCount++; atk.comboDamage+=dmg; atk.comboTimer=CFG.timing.comboReset;
    addStun(def, mv.stun!=null ? mv.stun : base*(mv.super ? CFG.stun.superMul : 1)*(counter ? CFG.stun.counterMul : 1));

    // golpe DE PIE (en suelo y sin lanzador) -> clip `hurt` si el personaje lo trae en datos; si no, damage_fall
    const dd = STEP_DEFS && STEP_DEFS[def.side];
    const standHit = def.grounded && !mv.launcher && dd && dd.clips && dd.clips.hurt;
    def.state=S.HITSTUN; def.stateFrame=0; def.clip= standHit ? "hurt" : "damage_fall"; def.clipTime=0;
    const ph = mv.pushHit||D.pushHit;
    def.hitstun=(mv.hitstun||D.hitstun)+(counter?C.hitstunAdd:0); def.vx=dirTo(att,def)*ph;
    if(cornerPress) att.vx = -fdir*ph*cornerPushMul;
    // DERRIBO: lanzador / move con knockdown / seguir golpeando a alguien que ya caía derribado -> LAUNCHED (cae y queda tendido).
    // Golpe en el aire SIN derribo -> HITSTUN en el aire y cae de pie (como KOF). El súper lanzador derriba "duro".
    const knock = mv.launcher || mv.knockdown || mv.hardKnockdown || (!def.grounded && def.state===S.LAUNCHED);
    const wasAir = !def.grounded;
    if(knock){ def.grounded=false; def.vy=mv.pushY||D.pushY; def.juggle++; def.state=S.LAUNCHED; def.clip="damage_fall";
      def.hardKd = !!(mv.hardKnockdown || (mv.super && mv.launcher && CFG.knockdown.hardOnLauncherSuper)); }
    else if(wasAir){ def.vy=mv.pushY||D.pushY; def.juggle++; def.clip="damage_fall"; }

    if(!isProj) att.meter=Math.min(att.maxMeter, att.meter+Math.round(base*CFG.meter.gainHitMul));
    // tipo de golpe (legibilidad): decide hitstop/temblor/destello/chispa/sonido
    const tk = mv.super?"super" : region==="head"?"head" : heavy?"heavy":"light";
    const hs = ((H.useMoveHitstop && mv.hitstop!=null) ? mv.hitstop : H.hitstop[tk]) + (counter?C.hitstopAdd:0);
    match.hitstop=Math.max(match.hitstop, hs);
    if(counter){ setNotice(match,'counter',att.side); match.events.push({t:"counter"}); }
    match.shake=Math.max(match.shake, H.shake[tk]);
    match.hitFlash=Math.min(1,(match.hitFlash||0)+H.flashAdd);
    match.flashColor=H.flashColor[tk==="super"?(region==="head"?"head":heavy?"heavy":"light"):tk];
    // chispa por TIPO de golpe (pilar Legibilidad): el move puede forzar su anim (hitAnim) y alto (hitH)
    const hk = mv.super?"super" : (mv.launcher||def.state===S.LAUNCHED)?"launch" : tk;
    pushFx(match,{t:'hit',x:ix,y:iy,kind:hk,anim:mv.hitAnim||null,h:mv.hitH||0,facing:fdir,life:mv.hitLife||(mv.super?H.sparkLife.super:H.sparkLife.normal),owner:-1});
    match.events.push({t:tk});
    if(def.hp<=0){ def.state=S.KO; def.hitstun=9999; def.clip=koClip(def); def.clipTime=0; onKO(match, att.side, true); }   // el K.O. siempre cae (nunca se queda en `hurt`)
    return true;
  }
  // FX declarados por el move: mv.fx = [{at:idxClip, anim, x, y, life, attach, scale}]
  function emitMoveFx(f, mv, idx, match){
    for(let i=0;i<mv.fx.length;i++){ const e=mv.fx[i]; if(e.at!==idx) continue;
      const ox=e.x||0, oy=e.y||0;
      pushFx(match,{t:'anim',anim:e.anim,x:f.x+f.facing*ox,y:(e.ground?CFG.arena.ground:f.y)+oy,ox,oy,
        facing:f.facing,life:e.life||20,owner:e.attach?f.side:-1,scale:e.scale||1,back:!!e.back}); }
  }
  // Partículas de energía del especial oculto. El catálogo vive fuera del char.json y cada
  // perfil puede cambiar forma, paleta, semilla y emisión por índice de frame.
  function emitHiddenParticleFx(f, defs, idx, match){
    const C=defs.hiddenParticles; if(!C) return;
    const S=C.frames && C.frames[String(idx)] ? C.frames[String(idx)] : null;
    if(!S) return;
    const ox=S.x||0, oy=S.y!=null?S.y:-76;
    pushFx(match,{t:'particles',kind:'hidden_particle',x:f.x+f.facing*ox,y:f.y+oy,ox,oy,
      facing:f.facing,owner:f.side,life:S.life||C.life||16,life0:S.life||C.life||16,
      style:C.shape||'burst',palette:C.palette||[0xffffff],seed:(C.seed||1)+idx*97,
      count:S.count||C.count||8,radius:S.radius||22,angle:S.angle||0,spread:S.spread||0.9,
      speed:S.speed||C.speed||2.4,size:S.size||C.size||2.4,gravity:S.gravity!=null?S.gravity:(C.gravity||0.02),
      drag:S.drag||C.drag||0.96,glow:S.glow!=null?S.glow:(C.glow||0.45),orbit:S.orbit||0,back:!!S.back});
  }
  function dirTo(att,def){ return def.x>=att.x?1:-1; }
  function blockOk(def, mv){ // bloqueo alto/bajo simplificado: si está agachado bloquea bajo/medio
    if(mv.guardType==="overhead") return !def.crouch;
    if(mv.guardType==="low") return def.crouch;
    return true;
  }

  // ---------- rondas ----------
  function maxRounds(){ return CFG.timing.roundsToWin*2 - 1 + (CFG.timing.extraRounds||0); }
  // ronda empatada (tiempo con vida igual, o DOBLE K.O. en un intercambio): nadie suma; si ya no quedan rondas, decide el marcador
  function roundDraw(match, why){
    match.phase="ko"; match.phaseT=CFG.timing.koFreeze; match.roundWinner=-1; match.roundEnd=why; match.koFrame=match.frame; match.koTimer=match.timer;
    if(why==="draw") match.events.push({t:"time"});
    decideOver(match);
  }
  // ¿terminó la pelea? Por rondas: alguien llegó a roundsToWin o se acabaron las rondas posibles (decide el marcador).
  // Por EQUIPOS: el perdedor de la ronda queda eliminado (en empate, los dos) y termina cuando un equipo no tiene a nadie.
  function decideOver(match){
    const rw=match.roundWinner;
    if(match.teams){
      let left0=0, left1=0;
      for(let s=0;s<2;s++){ const T=match.teams[s]; if(rw!==s) T.status[T.cur]="out";
        for(let i=0;i<T.status.length;i++) if(T.status[i]!=="out"){ if(s===0) left0++; else left1++; } }
      if(left0===0 || left1===0){ match.over=true; match.winner = (left0===0 && left1===0) ? -1 : (left0>0 ? 0 : 1); }
      else { match.over=false; match.winner=null; }
      return;
    }
    if(rw>=0 && match.wins[rw]>=CFG.timing.roundsToWin){ match.over=true; match.winner=rw; }
    else if(match.round >= maxRounds()){ match.over=true; match.winner = match.wins[0]>match.wins[1]?0 : match.wins[1]>match.wins[0]?1 : -1; }
    else { match.over=false; match.winner=null; }
  }
  function onKO(match, winnerSide, byHit){
    if(match.phase==="ko" && byHit && match.koFrame===match.frame && match.roundWinner>=0 && match.roundWinner!==winnerSide){
      // DOBLE K.O.: los dos golpes del intercambio fueron mortales en el mismo frame -> se deshace la victoria y es empate
      match.wins[match.roundWinner]--; match.over=false; match.winner=null; roundDraw(match,"double"); return; }
    if(match.phase!=="fight") return;
    match.roundWinner=winnerSide; match.phase="ko"; match.phaseT=CFG.timing.koFreeze; match.koFrame=match.frame; match.koTimer=match.timer;
    match.roundEnd = byHit ? "ko" : "time"; match.wins[winnerSide]++; match.events.push({t: byHit ? "ko" : "time"});
    if(byHit){
      // golpe final: congelamiento largo + destello + sacudida (el impacto que gana la ronda se siente).
      // El "Perfecto" NO se decide aquí: en un intercambio el golpe del rival todavía se aplica en este mismo frame.
      match.hitstop=Math.max(match.hitstop, CFG.hit.koHitstop||0); match.hitFlash=1; match.shake=Math.max(match.shake, CFG.hit.shake.super);
      match.camera.flash=Math.max(match.camera.flash, CFG.hit.koFlash||0);   // destello de pantalla (el render lo dibuja con el de la cinemática)
    }
    decideOver(match);
  }
  function dmgMul(match, side){ const M=match.mods; if(!(M && M[side])) return 1;
    return modFor(M, side, match.teams ? match.teams[side].cur : null).damage; }
  function resetRound(match){
    const M=match.mods||modsOf(null), xs=CFG.fighters.startX, old=match.fighters, TS=match.teams, wasOut=[false,false];
    // EQUIPOS: primero entra el siguiente del que cayó (así el luchador nuevo nace con la vida de SU modificador: el jefe final
    // en Equipos tiene el suyo aunque sus compañeros no).
    if(TS) for(let s=0;s<2;s++){ const T=TS[s];
      if(T.status[T.cur]==="out"){ wasOut[s]=true; let n=T.cur+1; while(n<T.status.length && T.status[n]!=="ready") n++;
        if(n<T.status.length){ T.cur=n; T.status[n]="active"; } } }
    const nf=[createFighter(0,xs[0],modFor(M,0,TS?TS[0].cur:null).hp), createFighter(1,xs[1],modFor(M,1,TS?TS[1].cur:null).hp)];
    if(TS){
      // el que siguió en pie conserva su vida + recuperación por el tiempo que sobró.
      // La barra es del equipo (team.carryMeter). Todo lo demás (posición, guardia, mareo, MAX) empieza de nuevo.
      const TM=CFG.team, frac=Math.max(0, Math.min(1, match.koTimer/(CFG.timing.roundTime*60)));
      for(let s=0;s<2;s++){
        if(!wasOut[s]) nf[s].hp=Math.min(nf[s].maxHp, old[s].hp + Math.round(nf[s].maxHp*TM.recoverMax*frac));
        if(TM.carryMeter) nf[s].meter=old[s].meter;
      }
    }
    match.fighters=nf;
    match.projectiles=[]; match.timer=CFG.timing.roundTime*60; match.round++;
    match.phase="intro"; match.phaseT=CFG.timing.roundIntro; match.roundWinner=null;
    match.roundEnd=""; match.koFrame=-1; match.perfect=false;
    match.notice.kind=""; match.notice.side=-1;     // antes un letrero del golpe final seguía visible en la ronda siguiente
    match.hitstop=0; match.superFreeze=0; match.shake=0; match.hitFlash=0;
    if(global.PGCinematics) PGCinematics.reset(match);
  }

  // ---------- física ----------
  function physics(f){
    if(!f.grounded){ f.vy+=CFG.physics.gravity; f.vx*=CFG.physics.airFriction; }
    else f.vx*=CFG.physics.friction;
    f.x+=f.vx; f.y+=f.vy;
    if(f.y>=CFG.arena.ground){ f.y=CFG.arena.ground; f.vy=0;
      if(!f.grounded){ f.grounded=true; f.juggle=0; f.airAtkUsed=false;
        if(f.state===S.JUMP||f.state===S.AIR_ATTACK) setState(f,S.IDLE);
        else if(f.state===S.LAUNCHED) land(f);
        else if(f.state===S.HITSTUN){ if(f.hitstun<=0) recover(f); else { f.clip=clipOf(f,"hurt"); f.clipTime=0; } }   // cayó de pie
        else if(f.state===S.KO){ f.clip=clipOf(f,"down"); f.clipTime=0; } } }
    const wl=CFG.arena.wall, W=CFG.arena.W;
    if(f.x<wl){ f.x=wl; f.vx=0; } if(f.x>W-wl){ f.x=W-wl; f.vx=0; }
  }
  // ---------- MAREO (config.stun) ----------
  // amount = aturdimiento en "daño base" (se multiplica por stun.mul). Llenarse deja el mareo PENDIENTE: empieza cuando se recupera.
  function addStun(f, amount){
    const ST=CFG.stun; if(!ST || !ST.enabled || f.stunLock>0 || f.hp<=0) return;
    f.stun=Math.min(ST.max, f.stun + amount*ST.mul); f.stunT=0;
    if(f.stun>=ST.max) f.dizzyPend=true;
  }
  function startDizzy(f){
    const ST=CFG.stun; f.dizzyPend=false; f.stun=0; f.stunT=0; f.stunLock=ST.dizzyFrames+ST.lockFrames;
    setState(f,S.DIZZY); f.dizzyT=ST.dizzyFrames; f.mashCd=0; f.vx=0;
    if(STEP_MATCH){ setNotice(STEP_MATCH,'dizzy',f.side); STEP_MATCH.events.push({t:"dizzy"}); }
  }
  // fin de un aturdimiento (de pie, al aterrizar, al levantarse, tras la recuperación): neutral, o mareado si se llenó
  function recover(f){ if(f.dizzyPend) startDizzy(f); else setState(f,S.IDLE); }

  // escape de agarre: los dos se separan y quedan neutros (mismo tiempo de recuperación para ambos)
  function throwTech(g, f, match){
    const T=CFG.grab;
    g._throw=null; f.grabbedBy=-1; f.techWin=0;
    setState(g,S.TECH); setState(f,S.TECH);
    g.vx=-g.facing*CFG.knockdown.techSpeed*0.6; f.vx=-f.facing*CFG.knockdown.techSpeed*0.6;
    g.invuln=Math.max(g.invuln,T.techInvuln); f.invuln=Math.max(f.invuln,T.techInvuln);
    pushFx(match,{t:'hit',x:(g.x+f.x)/2,y:f.y-CFG.hurtbox.h*0.6,kind:'block',facing:g.facing,life:CFG.hit.sparkLife.block,owner:-1});
    match.events.push({t:"block"}); setNotice(match,'escape',f.side);
  }
  // aterrizaje de un derribado: recuperación (ukemi) si pulsó Puño+Patada justo antes y el derribo no es duro; si no, tendido
  function land(f){
    const K=CFG.knockdown, m=STEP_MATCH;
    if(f.ukemiT>0 && !f.hardKd){ setState(f,S.TECH); f.invuln=Math.max(f.invuln,K.techInvuln); f.vx=-f.facing*K.techSpeed;
      if(m){ setNotice(m,'tech',f.side); m.events.push({t:"tech"}); } }
    else { setState(f,S.KNOCKDOWN); f.downT=K.downFrames; f.vx*=0.3; if(m){ m.events.push({t:"down"}); m.shake=Math.max(m.shake,K.landShake); } }
    f.ukemiT=0; f.hardKd=false; f.hitstun=0;
  }
  // tendido -> levantada: dura lo que el clip recovery_pose del personaje (datos); intocable mientras dura
  function wake(f, defs){
    setState(f,S.WAKEUP); const c=defs.clips[f.clip];
    f.wakeDur = (f.clip==="recovery_pose" && c) ? Math.ceil(60/(c.fps||10)*c.frames.length) : CFG.knockdown.wakeupFallback;
  }
  // K.O. EN EL PISO: si el personaje trae `ko_fall` (hoja de derrota propia, tools/build_ko_hojas.py) se usa esa caída,
  // que termina tendida y se queda en su último cuadro (clip.hold). En el aire (lo lanzaron) sigue damage_fall -> down.
  function koClip(f){ const dd=STEP_DEFS&&STEP_DEFS[f.side]; return (f.grounded && dd && dd.clips.ko_fall) ? "ko_fall" : "damage_fall"; }
  // K.O.: la caída se reproduce UNA vez (antes se repetía en bucle) y termina tendido
  function koAnim(f){ f.clipTime++; if(f.grounded && f.clip==="damage_fall"){ const dd=STEP_DEFS&&STEP_DEFS[f.side], c=dd&&dd.clips.damage_fall;
    if(c && clipDone(c,f.clipTime)){ f.clip=clipOf(f,"down"); f.clipTime=0; } } }
  function pushApart(a,b){ const min=CFG.hurtbox.w*0.8, d=b.x-a.x;
    if(Math.abs(d)<min && a.grounded && b.grounded){ const ov=(min-Math.abs(d)), s=d>=0?1:-1;
      const wl=CFG.arena.wall, W=CFG.arena.W;
      if(CFG.corner && CFG.corner.enabled){
        if(b.x>=W-wl-2 && s>0){ a.x-=ov; return; }
        if(a.x<=wl+2 && s>0){ b.x+=ov; return; }
        if(a.x>=W-wl-2 && s<0){ b.x-=ov; return; }
        if(b.x<=wl+2 && s<0){ a.x+=ov; return; }
      }
      a.x-=(ov/2)*s; b.x+=(ov/2)*s; } }

  // ---------- paso ----------
  function step(match, defsList, inputs){
    CFG = match.cfg || CFG;
    STEP_DEFS = defsList; STEP_MATCH = match;
    match.tick++;

    // fases de ronda
    if(match.phase==="intro"){ if(--match.phaseT<=0){ match.phase="fight"; match.events.push({t:"round"}); } decayFx(match); return; }
    if(match.phase==="ko"){
      // golpe final: todo congelado unos frames (las entradas no importan aquí)
      if(match.hitstop>0){ match.hitstop--; if(global.PGCinematics) PGCinematics.update(match); decayFx(match); return; }
      // durante el K.O. el derribado sigue cayendo (antes quedaba flotando) y nadie se queda en el aire;
      // tras winPoseDelay frames el ganador hace su pose de victoria (estado WIN, clip victory_pose)
      const since = CFG.timing.koFreeze - match.phaseT + 1, rw = match.roundWinner;   // frames de K.O. contando este (= lo que lee el render)
      for(let i=0;i<2;i++){ const f=match.fighters[i];
        if(f.state===S.KO){ koAnim(f); physics(f); continue; }
        if(i===rw && f.state!==S.WIN && f.grounded && since>=(CFG.timing.winPoseDelay||0)){ setState(f,S.WIN); f.vx=0; }
        if(f.state===S.WIN){ f.clipTime++; physics(f); continue; }          // la pose se reproduce una vez y se queda
        advClip(f,defsList[i]); if(!f.grounded) physics(f); }
      if(global.PGCinematics) PGCinematics.update(match);     // el acercamiento de un súper que dio el K.O. termina de alejarse
      if(--match.phaseT<=0){ if(match.over) return; resetRound(match); } decayFx(match); return; }
    if(match.over){ decayFx(match); return; }
    // Congelamiento cinemático de SÚPER/DM: ambos quietos, la cámara/cine avanza (KOF)
    // Durante el congelamiento (súper / hitstop) NO se pierden entradas: botones al buffer y direcciones al historial.
    // Antes se descartaban: confirmar un golpe y cancelarlo (lo que se pulsa justo en el impacto) era imposible.
    if(match.superFreeze>0){ match.superFreeze--; freezeInput(match.fighters[0],inputs[0]); freezeInput(match.fighters[1],inputs[1]); if(global.PGCinematics) PGCinematics.update(match); decayFx(match); return; }
    if(match.hitstop>0){ match.hitstop--; freezeInput(match.fighters[0],inputs[0]); freezeInput(match.fighters[1],inputs[1]); if(global.PGCinematics) PGCinematics.update(match); decayFx(match); return; }

    match.frame++; if(match.timer>0) match.timer--;
    const [f0,f1]=match.fighters;
    f0.facing = f0.x<=f1.x?1:-1; f1.facing = f1.x<f0.x?1:-1;

    for(let i=0;i<2;i++){
      const f=match.fighters[i], opp=match.fighters[1-i], defs=defsList[i], inp=normInput(inputs[i], f);
      // (antes: f.comboRef=f -> referencia circular que impedía serializar MatchState; applyHit ya usa att si no hay comboRef)
      if(f.invuln>0) f.invuln--;
      f.stateFrame++;
      pushDir(f, inp); recordTap(f, inp);
      // AUTO-TRANSFORMACIÓN (data: defs.autoTransform): al caer al umbral de vida, marca el disparo (una sola vez).
      // El move sale en el primer frame en que el luchador puede actuar (justo antes de "estados con control").
      if(defs.autoTransform && !f.ragedUsed && f.hp>0 && f.hp <= f.maxHp*(defs.autoTransform.hpBelow||0.5)) f.ragePending=true;

      if(f.state===S.KO){ koAnim(f); physics(f); continue; }
      if(f.state===S.HITSTUN||f.state===S.LAUNCHED){ f.hitstun--;
        // recuperación (ukemi): Puño+Patada dentro de la ventana antes de tocar el piso
        if(f.state===S.LAUNCHED){ if(simul(f,inp,"P","K")) f.ukemiT=CFG.knockdown.ukemiWindow; else if(f.ukemiT>0) f.ukemiT--; }
        // la animación de daño AVANZA y se queda en su último frame (antes: frame 0 todo el vuelo, de pie en el aire)
        if(f.clip!=="damage_fall" || !f.grounded) f.clipTime++;
        physics(f);
        if(f.state===S.HITSTUN && f.hitstun<=0 && f.grounded) recover(f); continue; }
      if(f.state===S.PREJUMP){
        if(f.jumpKind===0 && !inp.up) f.jumpKind=1;            // soltó ARRIBA durante el pre-salto -> salto corto
        if(inp.x!==0) f.jumpDir = inp.x>0?1:-1;
        physics(f); advClip(f,defs);
        if(f.stateFrame>=(CFG.timing.prejump||0)) launchJump(f,defs);
        continue; }
      if(f.state===S.KNOCKDOWN){ f.clipTime++; physics(f); if(--f.downT<=0) wake(f,defs); continue; }
      if(f.state===S.WAKEUP){ f.clipTime++; physics(f); if(f.stateFrame>=f.wakeDur) recover(f); continue; }
      // MAREADO: no actúa; machacar botones o cambiar de dirección lo acorta (máx. una vez cada mashGap frames)
      if(f.state===S.DIZZY){ f.clipTime++; physics(f); const ST=CFG.stun;
        if(f.mashCd>0) f.mashCd--;
        else if(inp.punchPress||inp.kickPress||inp.specialPress||inp.superPress||inp._xEdge){ f.dizzyT-=ST.mash; f.mashCd=ST.mashGap; }
        if(--f.dizzyT<=0){ setState(f,S.IDLE); f.dizzyT=0; } continue; }
      if(f.state===S.GUARD_CRUSH){ f.clipTime++; physics(f); if(--f.crushT<=0) setState(f,S.IDLE); continue; }
      if(f.state===S.BLOCKSTUN){
        // RODADA DE CANCELACIÓN DE GUARDIA: Puño+Patada bloqueando, en el suelo, con barra
        const GC=CFG.guardCancel;
        if(GC && GC.enabled && f.grounded && f.meter>=GC.cost && simul(f,inp,"P","K")){ f.meter-=GC.cost; startRoll(f); setNotice(match,'gc',f.side); match.events.push({t:"tech"}); continue; }
        f.blockstun--; physics(f); if(f.blockstun<=0) setState(f,S.IDLE); continue; }
      // AGARRES / LLAVES
      if(f.state===S.THROWN){
        if(f.grabbedBy<0 || match.fighters[f.grabbedBy].state!==S.THROW){ setState(f,S.IDLE); f.grabbedBy=-1; continue; }
        // ESCAPE de agarre: Guardia+Puño dentro de la ventana (solo agarres normales; también resuelve agarre contra agarre)
        if(f.techWin>0){ f.techWin--; if(inp.block && inp.punchPress){ throwTech(match.fighters[f.grabbedBy], f, match); } }
        continue; }
      if(f.state===S.THROW){ advThrowState(f, opp, defs, match); continue; }
      if(f.state===S.TECH){ if(f.stateFrame>=CFG.knockdown.techFrames) recover(f); f.vx*=0.9; advClip(f,defs); physics(f); continue; }
      if(f.state===S.MAXACT){ if(f.stateFrame>=CFG.max.activateFrames) setState(f,S.IDLE); f.vx*=0.85; physics(f); continue; }
      if(f.state===S.ROLL){ rollStep(f); physics(f); continue; }
      if(f.state===S.BACKDASH){ f.stateFrame>=CFG.timing.backdashDur && setState(f,S.IDLE); physics(f); continue; }
      if(f.state===S.DASH){ if(f.stateFrame>=CFG.timing.dashDur || inp.x===0) setState(f,S.IDLE); else f.vx=f.facing*PH(defs,"run"); physics(f);
        // cancel dash con ataque/salto
        if(!tryAttacks(f,opp,defs,match,inp) && inp.upPress) jump(f,inp,defs); continue; }

      // ataque/especial/súper en curso
      if(f.state===S.ATTACK||f.state===S.AIR_ATTACK||f.state===S.SPECIAL||f.state===S.SUPER){
        const mv=defs.moves[f.move], clip=defs.clips[mv.clip];
        // el primer botón arrancó un golpe NORMAL y el segundo llegó dentro de la ventana -> acción de dos botones
        if(f.state===S.ATTACK && f.grounded && f.stateFrame<=(CFG.timing.simulWindow||0) && !mv.special && !mv.super && twoButton(f, match, inp)){ f.move=null; continue; }
        let idx, hitNow, finished;
        if(mv.frames){   // tiempos explícitos: la pose sale de la fase (startup/active/recovery), no del reloj del clip
          idx = framePhase(mv, clip, ++f.moveFrame); hitNow = PH_OUT.active; finished = PH_OUT.done;
          if(idx<0){ f.clip=clipOf(f,"idle"); f.clipTime=0; idx=0; }
          else { f.clip=mv.clip; f.clipTime=Math.floor((idx+0.5)*60/(clip.fps||10)); }
        } else {
          f.clipTime++; idx=clipIndex(clip,f.clipTime);
          hitNow = !!(mv.hitFrames && mv.hitFrames.indexOf(idx)>=0); finished = clipDone(clip,f.clipTime);
        }
        if(idx!==f._fxIdx){ f._fxIdx=idx; if(mv.fx) emitMoveFx(f,mv,idx,match); if(mv.hidden || (defs.hiddenParticles && defs.hiddenParticles.move===f.move)) emitHiddenParticleFx(f,defs,idx,match); }
        if(mv.advance){ const af=mv.advanceFrames||[0, mv.hitFrames&&mv.hitFrames.length?mv.hitFrames[mv.hitFrames.length-1]:clip.frames.length-1];
          if(idx>=af[0] && idx<=af[1]) f.vx=f.facing*mv.advance; }
        if(mv.spawnFrame!=null && idx===mv.spawnFrame && f.moveFrame!==-99){ spawnProjectile(f,mv,defs,match); f.moveFrame=-99; }
        if(hitNow){
          // multiHit: cada índice de hitFrames es un golpe distinto (hitId nuevo); si no, un solo golpe por move
          if(!f.hitId || (mv.multiHit && f._hitIdx!==idx)){ f.hitId=match.nextHitId++; f._hitIdx=idx; }
          const hb=hitboxOf(f,mv), hu=hurtboxOf(opp);
          if(aabb(hb, hu)){ // punto de impacto = centro de la intersección de cajas (la chispa sale donde pega)
            const P=PENDING[i]; P.on=true; P.mv=mv; P.hitId=f.hitId; P.name=f.move;   // el hitId del golpe que lo detectó (una cancelación posterior lo cambia)
            P.ix=(Math.max(hb.x,hu.x)+Math.min(hb.x+hb.w,hu.x+hu.w))/2; P.iy=(Math.max(hb.y,hu.y)+Math.min(hb.y+hb.h,hu.y+hu.h))/2; }
        } else if(mv.frames ? f.moveFrame>mv.frames.startup+mv.frames.active : (mv.hitFrames && idx>mv.hitFrames[mv.hitFrames.length-1])) f.hitId=0;
        // cancelaciones
        const pressedNow=attackButton(inp), nb=pressedNow || (f.bufP>0?"punch":f.bufK>0?"kick":null);   // la cancelación también usa el buffer
        // a SÚPER primero (comando completo gana sobre el especial que contiene: qcf2+P antes que qcf+P). Antes no existía:
        // la rama de cancelación solo resolvía especiales y normales y ningún súper salía cancelando (tools/combo_check.js)
        const sc = superCancelOf(f,defs,mv,nb,inp);
        if(sc) tryStartMove(f,sc,defs,match);
        else if(nb){ const ix=inp.x; if(!pressedNow && inp.x===0) inp.x=f.bufX;
          const nxt=resolveButton(f,defs,nb,inp); inp.x=ix;
          if(nxt && mv.cancelInto && mv.cancelInto.indexOf(nxt)>=0) tryStartMove(f,nxt,defs,match); }
        physics(f);
        if(finished){ if(mv.transformsInto) f.transformed=true; setState(f, f.grounded?S.IDLE:S.JUMP); f.move=null; }
        continue;
      }

      // ---- estados con control ----
      // AUTO-TRANSFORMACIÓN: Sofi ejecuta su Modo Vestía sola al llegar a media vida (data autoTransform). Solo en el
      // suelo y cuando puede actuar; si estaba en hitstun/aire espera a recuperarse. Una sola vez por combate.
      if(defs.autoTransform && f.ragePending && f.grounded){
        if(tryStartMove(f, defs.autoTransform.move, defs, match)){ f.ragePending=false; f.ragedUsed=true; match.events.push({t:"super"}); continue; }
      }
      applyBuffer(f, inp);
      // AGARRE normal: Guardia+Puño en corto. Solo si el personaje trae su move de agarre en datos (moves.throw): sin arte
      // de agarre no se finge con otro clip; Guardia+Puño queda como guardia.
      if(f.grounded && inp.block && inp.punchPress && defs.moves && defs.moves.throw){ if(tryGrab(f,opp,match,defs.moves.throw)) continue; }
      // MAX (Puño+Especial con barra) y rodada (Puño+Patada), con ventana de simultaneidad
      if(f.grounded && twoButton(f, match, inp)) continue;
      // bloqueo
      if(f.grounded && inp.block){ f.wantCrouch=inp.down; f.crouch=inp.down; setState(f,S.BLOCK); f.vx*=CFG.physics.friction; physics(f); advClip(f,defs); continue; }
      f.crouch=false;
      // dashes (solo si NO se presionó ataque/especial/súper este frame — evita comerse DP/medialuna)
      if(f.grounded && inp._xEdge && inp.x!==0 && !attackButton(inp) && !inp.specialPress && !inp.superPress && !inp.block){
        if(doubleTap(f,"F")){ setState(f,S.DASH); }
        else if(doubleTap(f,"B")){ startBackdash(f); continue; }
      }
      // salto (entra en PRE-SALTO; despega a los CFG.timing.prejump frames)
      if(f.grounded && inp.upPress){ jump(f,inp,defs); physics(f); advClip(f,defs); continue; }
      // ataques (incluye aéreos y especiales por comando)
      if(tryAttacks(f,opp,defs,match,inp)) { continue; }
      // movimiento
      if(f.grounded){
        // si este frame entró en DASH por doble toque no se pisa con andar/agachar (la rama DASH manda desde el siguiente)
        if(f.state!==S.DASH){
          if(inp.x<0){ f.vx=-PH(defs,'walk'); setState(f, f.facing<0?S.WALK_F:S.WALK_B); }
          else if(inp.x>0){ f.vx=PH(defs,'walk'); setState(f, f.facing>0?S.WALK_F:S.WALK_B); }
          else if(inp.down){ setState(f,S.CROUCH); f.vx*=CFG.physics.friction; }
          else { setState(f,S.IDLE); f.vx*=CFG.physics.friction; }
        }
      } else {
        if(inp.x<0) f.vx=-PH(defs,'airMove'); else if(inp.x>0) f.vx=PH(defs,'airMove');
        if(f.state!==S.JUMP) setState(f,S.JUMP);
      }
      physics(f); advClip(f,defs);
    }

    // ---- impactos del frame ----
    // Se aplican DESPUÉS de procesar a los dos: antes P1 golpeaba en medio del paso y el defensor P2 descontaba su
    // hitstun/blockstun ese mismo paso -> el mismo golpe daba 1 frame MENOS de ventaja si lo daba P1 (medido).
    // Si ambos conectan en el mismo frame es un intercambio (trade): los dos reciben. Agarre > golpe: quien fue
    // agarrado este frame pierde su golpe pendiente.
    { const p0=PENDING[0], p1=PENDING[1];
      if(p0.on && f0.state===S.THROWN) p0.on=false;
      if(p1.on && f1.state===S.THROWN) p1.on=false;
      // se aplica con el hitId con que se detectó: si en ese mismo frame el golpe se canceló, el hitId nuevo (0) no debe
      // saltarse el "ya te pegué con este golpe" (antes el puño volvía a pegar al cancelarse en un frame activo)
      if(p0.on){ const h=f0.hitId; f0.hitId=p0.hitId; if(applyHit(f0,f1,p0.mv,match,false,p0.ix,p0.iy) && f0.move===p0.name) f0.contact=true; f0.hitId=h; }
      if(p1.on){ const h=f1.hitId; f1.hitId=p1.hitId; if(applyHit(f1,f0,p1.mv,match,false,p1.ix,p1.iy) && f1.move===p1.name) f1.contact=true; f1.hitId=h; }
      p0.on=p1.on=false; p0.mv=p1.mv=null; p0.name=p1.name=null; }
    // proyectiles
    stepProjectiles(match);
    pushApart(match.fighters[0], match.fighters[1]);
    if(match.shake>0.5) match.shake*=0.85; else match.shake=0;
    if(match.hitFlash>0){ match.hitFlash*=0.9; if(match.hitFlash<0.02) match.hitFlash=0; }
    for(let i=0;i<2;i++){ const f=match.fighters[i], o=match.fighters[1-i];   // (índice, no for..of: sin iterador por frame)
      if(f.comboTimer>0 && --f.comboTimer<=0){ f.comboCount=0; f.comboDamage=0; }
      // COMBO VERDADERO: termina en cuanto el rival deja de estar aturdido (antes duraba 90 frames aunque el rival ya se
      // hubiera recuperado: contaba golpes sueltos como combo y les aplicaba el escalado de daño)
      if(f.comboCount>0 && !COMBO_STUN[o.state]){ f.comboCount=0; f.comboDamage=0; f.comboTimer=0; }
      if(f.maxMode){ f.maxT--; if(f.maxT<=0) f.maxMode=false; }
      // guardia: se regenera tras un rato sin bloquear
      if(f.state===S.BLOCK||f.state===S.BLOCKSTUN) f.guardT=0;
      else if(f.guard<f.maxGuard && ++f.guardT>CFG.guard.regenDelay) f.guard=Math.min(f.maxGuard, f.guard+CFG.guard.regenPerFrame);
      // mareo: el aturdimiento baja si pasa un rato sin recibir golpes; el bloqueo post-mareo se consume
      if(f.stunLock>0) f.stunLock--;
      if(f.stun>0 && !f.dizzyPend && ++f.stunT>CFG.stun.recoverDelay) f.stun=Math.max(0, f.stun-CFG.stun.recoverPerFrame);
    }
    if(global.PGCinematics) PGCinematics.update(match);
    decayFx(match);
    if(match.timer<=0 && match.phase==="fight"){ const w=f0.hp===f1.hp?-1:(f0.hp>f1.hp?0:1);
      if(w>=0) onKO(match,w,false); else roundDraw(match,"draw"); }   // antes un empate por tiempo terminaba TODA la pelea, aunque fuera la ronda 1
    // ¿PERFECTO? se decide al final del paso del K.O. (ya aplicados los dos golpes de un intercambio): el ganador sin daño
    if(match.phase==="ko" && match.koFrame===match.frame && match.roundEnd==="ko"){ const w=match.fighters[match.roundWinner];
      match.perfect = w.hp>=w.maxHp; if(match.perfect) match.events.push({t:"perfect"}); }    // el render lo anuncia (letrero "Perfecto")
  }

  function tryAttacks(f,opp,defs,match,inp){
    // especiales OCULTOS: solo en MAX, por comando (no aparecen en la lista de movimientos)
    if(f.maxMode){ const h=pickHidden(f,defs,inp); if(h && tryStartMove(f,h,defs,match)) return true; }
    // súper por COMANDO (botón+motion, p.ej. qcf2+Puño) — se revisa antes que los especiales simples
    { const sc=pickSuperByButton(f,defs,inp); if(sc && tryStartMove(f,sc,defs,match)) return true; }
    // súper por botón dedicado
    if(inp.superPress){ const s=pickSuper(f,defs); if(s && tryStartMove(f,s,defs,match)) return true; }
    // especial por botón dedicado (fallback móvil) o por comando
    if(inp.specialPress){ const sp=(defs.inputs.specials||[]).find(x=>affordable(f,defs.moves[x.move])); if(sp && tryStartMove(f,sp.move,defs,match)) return true; }
    const b=attackButton(inp); if(!b) return false;
    const name=resolveButton(f,defs,b,inp);
    return name? tryStartMove(f,name,defs,match) : false;
  }
  function resolveButton(f, defs, button, inp){
    if(!f.grounded){ return (defs.inputs.air&&defs.inputs.air[button]) || null; }
    const sp=pickSpecial(f,defs,button); if(sp) return sp;
    // normal de dirección (KOF: golpe de comando): ADELANTE + botón, si el personaje lo trae en datos (inputs.forward)
    const fw=defs.inputs.forward;
    if(fw && fw[button] && inp && inp.x!==0 && (inp.x>0)===(f.facing>0) && !inp.down) return fw[button];
    return (defs.inputs.grounded&&defs.inputs.grounded[button]) || null;
  }
  function attackButton(inp){ return inp.punchPress?"punch":inp.kickPress?"kick":null; }

  // SALTO en dos tiempos (KOF): pre-salto en el suelo y despegue. Durante el pre-salto: soltar ARRIBA = salto corto.
  function jump(f, inp, defs){
    setState(f,S.PREJUMP); clearBuffer(f);
    f.jumpKind = (inp.down || recentDown(f)) ? 2 : 0;   // abajo→arriba = salto alto
    f.jumpDir = inp.x>0?1:inp.x<0?-1:0;
    if((CFG.timing.prejump||0)<=0) launchJump(f,defs);   // prejump 0 = despegue inmediato (como antes de BUILD-14, sin salto corto)
  }
  function launchJump(f, defs){
    const v = f.jumpKind===2 ? PH(defs,'jumpHigh') : f.jumpKind===1 ? PH(defs,'jumpShort') : PH(defs,'jumpNormal');
    f.vy=v; f.grounded=false; f.airAtkUsed=false; setState(f,S.JUMP);
    if(f.jumpDir!==0) f.vx=f.jumpDir*PH(defs,'walk')*1.3;
  }
  function recentDown(f){ const dh=f.dirHist; for(let i=Math.max(0,dh.length-4);i<dh.length;i++) if(dh[i].down) return true; return false; }
  function startRoll(f){ clearBuffer(f); setState(f,S.ROLL); f.invuln=CFG.timing.rollInvulnEnd; f.vx=f.facing*CFG.physics.rollSpeed; }
  function rollStep(f){ if(f.stateFrame>=CFG.timing.rollDur) setState(f,S.IDLE); if(f.stateFrame>CFG.timing.rollInvulnEnd) f.vx*=0.9; }
  function startBackdash(f){ setState(f,S.BACKDASH); f.invuln=CFG.timing.backdashInvuln; f.vx=-f.facing*Math.abs(CFG.physics.backdashVX); f.vy=CFG.physics.backdashVY; f.grounded=false; }

  function pbox(p){ return {x:p.x-p.w/2,y:p.y-p.h/2,w:p.w,h:p.h}; }
  function stepProjectiles(match){
    const P=match.projectiles;
    // CHOQUE entre proyectiles de dueños distintos (KOF): se restan fuerzas; el que llega a 0 desaparece.
    for(let i=0;i<P.length;i++) for(let j=i+1;j<P.length;j++){ const a=P[i], b=P[j];
      if(a.owner===b.owner || a.strength<=0 || b.strength<=0) continue;
      if(!aabb(pbox(a),pbox(b))) continue;
      const sa=a.strength, sb=b.strength; a.strength-=sb; b.strength-=sa;
      pushFx(match,{t:'hit',x:(a.x+b.x)/2,y:(a.y+b.y)/2,kind:'clash',facing:1,life:12,owner:-1});
      match.hitstop=Math.max(match.hitstop,4); match.events.push({t:"block"}); }
    let n=0;
    for(let i=0;i<P.length;i++){ const p=P[i];
      let dead = p.strength<=0;
      if(!dead){
        p.x+=p.vx; p.life--; if(p.cool>0) p.cool--;
        const opp=match.fighters[1-p.owner];
        if(p.cool===0 && opp && opp.state!==S.KO && opp.invuln<=0){
          const pb=pbox(p), hu=hurtboxOf(opp);
          if(aabb(pb,hu)){
            const ix=(Math.max(pb.x,hu.x)+Math.min(pb.x+pb.w,hu.x+hu.w))/2, iy=(Math.max(pb.y,hu.y)+Math.min(pb.y+pb.h,hu.y+hu.h))/2;
            const landed=applyHit({side:p.owner,x:p.x,facing:p.vx>0?1:-1,hitId:p.hitId,comboRef:match.fighters[p.owner],meter:0,maxMeter:0,struck:{}},
              opp,{damage:p.damage,hitstun:p.hitstun,blockstun:p.blockstun,hitstop:p.hitstop,pushHit:p.pushHit,pushBlock:p.pushBlock,
                   guardType:p.guardType,chipDamage:p.chipDamage,launcher:p.launcher,pushY:p.pushY||undefined,
                   hitbox:{y:-80},hitAnim:p.hitAnim,hitLife:p.hitLife,hitH:p.h0?p.h0*1.6:0},match,true,ix,iy);
            // multi-golpe: el proyectil puede FRENAR al conectar (hitSlow, KOF: la bola "muerde" al rival) para dar todos sus golpes
            if(landed){ p.hits--; if(p.hits>0){ p.hitId=match.nextHitId++; p.cool=p.hitEvery; p.vx*=p.hitSlow; } else dead=true; }
          }
        }
        if(p.x<CFG.arena.wall||p.x>CFG.arena.W-CFG.arena.wall||p.life<=0){ dead=true;
          pushFx(match,{t:'hit',x:p.x,y:p.y,kind:'fizzle',anim:null,facing:p.vx>0?1:-1,life:8,owner:-1}); }
      }
      if(!dead) P[n++]=p;
    }
    P.length=n;   // compactación en sitio (sin array nuevo por frame)
  }

  // clip.hold (datos): al terminar se queda en el último frame en vez de reiniciar (p.ej. `hurt` durante hitstun largo)
  function advClip(f, defs){ const clip=defs.clips[f.clip]||defs.clips.idle; f.clipTime++; if(clipDone(clip,f.clipTime)&&!clip.loop&&!clip.hold) f.clipTime=0; }
  function advanceClipsOnly(match, defs){ for(let i=0;i<2;i++){ const f=match.fighters[i]; advClip(f,defs[i]); } }
  function decayFx(match){ const F=match.fx; let n=0; for(let i=0;i<F.length;i++){ F[i].life--; if(F[i].life>0) F[n++]=F[i]; } F.length=n; }

  // un objeto de entrada REUTILIZADO por lado (antes: uno nuevo por luchador y por frame)
  const INP = [{}, {}];
  function normInput(raw, f){
    const i = raw || {}, out = INP[f.side];
    const prev = f._prevX||0; const x=i.x||0;
    out.x=x; out.down=!!i.down; out.block=!!i.block; out.upPress=!!i.upPress;
    out.up = i.up===undefined ? true : !!i.up;   // ARRIBA mantenido (decide hop vs salto); fuentes sin ese dato (IA) = mantenido
    out.punchPress=!!i.punchPress; out.kickPress=!!i.kickPress; out.specialPress=!!i.specialPress; out.superPress=!!i.superPress;
    out._xEdge = x!==0 && x!==prev;
    f._prevX=x;
    f.agP = out.punchPress ? 0 : Math.min(99, f.agP+1); f.agK = out.kickPress ? 0 : Math.min(99, f.agK+1); f.agS = out.specialPress ? 0 : Math.min(99, f.agS+1);
    const N=CFG.timing.inputBufferFrames||0;
    f.bufP = out.punchPress ? N : Math.max(0,f.bufP-1); f.bufK = out.kickPress ? N : Math.max(0,f.bufK-1);
    f.bufS = out.specialPress ? N : Math.max(0,f.bufS-1); f.bufU = out.superPress ? N : Math.max(0,f.bufU-1);
    if(out.punchPress || out.kickPress) f.bufX = x;
    return out;
  }
  // entrada durante un congelamiento: guarda pulsaciones (sin que el buffer caduque mientras dura) y cambios de dirección
  function freezeInput(f, raw){
    const i=raw||{}, N=CFG.timing.inputBufferFrames||0;
    if(i.punchPress){ f.bufP=N; f.agP=0; } if(i.kickPress){ f.bufK=N; f.agK=0; }
    if(i.specialPress){ f.bufS=N; f.agS=0; } if(i.superPress) f.bufU=N;
    if(i.punchPress || i.kickPress) f.bufX = i.x||0;
    const x=i.x||0, dn=!!i.down, dh=f.dirHist, last=dh[dh.length-1];
    if(!last || last.x!==x || last.down!==dn){
      if(dh.length>=CFG.timing.motionWindow){ const r=dh.shift(); r.x=x; r.down=dn; r.fr=1; dh.push(r); } else dh.push({ x, down:dn, fr:1 }); }
  }
  // una pulsación guardada en el buffer cuenta como pulsada en este frame (el primer frame en que puede actuar)
  function applyBuffer(f, inp){
    const fromBuf = (f.bufP>0 && !inp.punchPress) || (f.bufK>0 && !inp.kickPress);
    if(f.bufP>0) inp.punchPress=true; if(f.bufK>0) inp.kickPress=true; if(f.bufS>0) inp.specialPress=true; if(f.bufU>0) inp.superPress=true;
    if(fromBuf && inp.x===0) inp.x = f.bufX;   // adelante+botón guardado sigue siendo adelante aunque ya soltó la dirección
  }
  function clearBuffer(f){ f.bufP=f.bufK=f.bufS=f.bufU=0; }
  // dos botones "a la vez" con tolerancia (CFG.timing.simulWindow): se dispara en el frame en que llega el segundo
  function simul(f, inp, a, b){ const W=CFG.timing.simulWindow||0;
    const pa = a==="P"?inp.punchPress : a==="K"?inp.kickPress : inp.specialPress, pb = b==="P"?inp.punchPress : b==="K"?inp.kickPress : inp.specialPress;
    const ga = a==="P"?f.agP : a==="K"?f.agK : f.agS, gb = b==="P"?f.agP : b==="K"?f.agK : f.agS;
    return (pa||pb) && ga<=W && gb<=W; }
  // acciones de dos botones (prioridad KOF: MAX > rodada). Devuelve true si hizo algo.
  function twoButton(f, match, inp){
    if(!f.maxMode && simul(f,inp,"P","S") && maxActivate(f,match)) return true;
    if(simul(f,inp,"P","K")){ startRoll(f); return true; }
    return false;
  }

  // respaldo SOLO si no llega data/config.json (fuente de verdad: el archivo de datos). GENERADO por tools/sync_defaults.py
  const DEFAULTS = {
    "arena":{"W":960,"H":540,"ground":480,"wall":40},
    "corner":{"enabled":true,"pushMul":1.0,"threshold":16},
    "audio":{"sfxVoiceCount":8},
    "physics":{"gravity":0.9,"friction":0.8,"airFriction":0.985,"walk":2.6,"run":4.6,"airMove":1.9,"jumpShort":-11.5,"jumpNormal":-15,"jumpHigh":-18.5,"backdashVX":-7.5,"backdashVY":-6,"rollSpeed":7.2},
    "timing":{"roundTime":99,"roundsToWin":2,"roundIntro":75,"koFreeze":150,"comboReset":90,"rollDur":26,"rollInvulnStart":2,"rollInvulnEnd":16,"dashDur":18,"backdashDur":22,"backdashInvuln":6,"inputBufferFrames":8,"motionWindow":14,"doubleTapWindow":12,"maxDur":360,"simulWindow":3,"prejump":4,"winPoseDelay":40,"extraRounds":1,"perfectFrames":34},
    "meter":{"max":100,"gainHitMul":0.3,"gainBlock":3,"gainWhiff":0.5,"maxModeDrain":0.4,"maxCost":50},
    "combo":{"decay":0.03,"juggleDecay":0.06,"minScale":0.15},
    "hurtbox":{"w":46,"h":140,"crouchH":96,"airH":112},
    "fighters":{"startX":[320,640],"hp":300,"minHp":0},
    "projectile":{"defaultSpeed":7.5,"defaultLife":70,"max":6,"maxPerOwner":1},
    "grab":{"range":70,"damage":30,"tossX":8,"tossY":-10,"hold":42,"meterGain":16,"tossHitstun":22,"hitstop":10,"shake":7,"sparkLife":14,"techWindow":7,"techInvuln":6},
    "cinematic":{"freeze":46,"dur":74,"zoom":1.85,"dim":0.58,"inFrames":12,"outFrames":18,"focusAbove":150,"ease":0.15,"dimDecay":0.8,"flashDecay":0.82},
    "camera":{"follow":true,"maxZoom":1.18,"near":150,"far":430,"ease":0.1},
    "render":{"targetFrameH":180,"roundFade":18},
    "hit":{"region":{"headY":-78,"chestY":-45},"regionDamage":{"enabled":false,"head":1.3,"chest":1.0,"legs":0.9},"useMoveHitstop":true,"hitstop":{"super":14,"head":10,"heavy":7,"light":5},"shake":{"super":12,"head":8,"heavy":6,"light":3},"heavyDamage":20,"flashAdd":0.3,"flashColor":{"head":"255,60,60","heavy":"255,140,0","light":"255,255,255"},"sparkLife":{"super":18,"normal":12,"block":10},"block":{"hitstopMul":0.5,"shake":2},"defaults":{"damage":12,"hitstun":14,"blockstun":10,"pushHit":4,"pushBlock":3,"pushY":-9,"guardDamage":8,"hitstop":5},"cancelOnContact":true,"superCancel":"max","koHitstop":28,"koFlash":0.7},
    "max":{"activateInvuln":12,"activateFrames":18,"throwDamageMul":1.2},
    "knockdown":{"downFrames":34,"wakeupFallback":24,"ukemiWindow":8,"techFrames":20,"techInvuln":16,"techSpeed":5.5,"hardOnThrow":true,"hardOnLauncherSuper":true,"landShake":4},
    "guard":{"max":100,"damageMul":0.5,"damageMin":4,"regenDelay":60,"regenPerFrame":0.35,"crushStun":48,"crushHitstop":12,"crushShake":8},
    "counter":{"damageMul":1.2,"hitstunAdd":4,"hitstopAdd":3},
    "training":{"roundTime":999,"minHp":1,"refillIdle":45},
    "ai":{"levels":{"1":{"react":0.22,"aggro":0.03,"special":0.01,"jump":0.004,"spaceBack":0.02,"minGap":52,"mash":0.08},"2":{"react":0.48,"aggro":0.06,"special":0.025,"jump":0.01,"spaceBack":0.05,"minGap":58,"mash":0.15},"3":{"react":0.8,"aggro":0.1,"special":0.05,"jump":0.02,"spaceBack":0.1,"minGap":62,"mash":0.25}},"range":{"inRange":92,"close":130,"airKick":120,"airApproach":40,"projectileReact":170,"projectileJump":110,"antiAir":96,"zoning":220,"downApproach":110,"ukemiHeight":40},"cool":{"zoning":40,"special":22,"punch":10,"kick":12,"crushPunish":6}},
    "guardCancel":{"enabled":true,"cost":50},
    "stun":{"enabled":true,"max":100,"mul":0.7,"superMul":0.25,"counterMul":1.5,"throwMul":0.7,"recoverDelay":70,"recoverPerFrame":0.6,"dizzyFrames":150,"mash":6,"mashGap":3,"lockFrames":240},
    "team":{"size":3,"recoverMax":0.25,"carryMeter":true}
  };

  global.PGSim = { States:S, STATE_CLIP, DEFAULTS, createMatch, createFighter, step,
    clipFrameIndex:clipIndex, hurtboxOf, hitboxOf,
    get ARENA(){ const c=CFG||DEFAULTS; return {W:c.arena.W,H:c.arena.H,GROUND:c.arena.ground,WALL:c.arena.wall}; },
    hitboxActive:(f,defs)=>{ if([S.ATTACK,S.AIR_ATTACK,S.SPECIAL,S.SUPER].indexOf(f.state)<0) return null;
      const mv=defs.moves[f.move]; if(!mv) return null;
      if(mv.frames) return (f.moveFrame>mv.frames.startup && f.moveFrame<=mv.frames.startup+mv.frames.active) ? hitboxOf(f,mv) : null;
      const clip=defs.clips[mv.clip];
      const idx=clipIndex(clip,f.clipTime); return (mv.hitFrames&&mv.hitFrames.indexOf(idx)>=0)?hitboxOf(f,mv):null; },
    _setCfg:(c)=>{CFG=c;} };
})(window);
