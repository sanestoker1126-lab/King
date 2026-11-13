/* pg_game.js — ORQUESTADOR del juego completo. Posee el app PIXI y conecta el
   front-end (título/selección/pausa/resultados) con el ciclo de vida de la partida.
   Bucle de PASO FIJO 1/60 (acumulador + clamp). Enruta inputs: P1 teclado+mando,
   P2 teclado+mando (versus) o IA (arcade/entrenamiento). NO modifica la simulación
   determinista (pg_sim.js), solo la alimenta y la dibuja. Modular. */
(function (global) {
  "use strict";
  var STEP_MS = 1000/60, MAX_STEPS = 5;

  var G = {
    app:null, cfgBase:null, roster:null, fe:null,
    match:null, render:null, defs:null, pre:null, stats:null,
    mode:"arcade", difficulty:2, dummy:0, infMeter:false, trainDizzy:false, train:null, tournament:null, arcadeCampaign:null,
    running:false, paused:false, stage:0,
    p1ctl:null, p2ctl:null, acc:0, last:0, rafId:0, resultShown:false
  };

  // teclado + mando del mismo jugador. Objeto REUTILIZADO por lado (antes uno nuevo por frame = basura); el simulador lo copia.
  var MERGED = [{}, {}];
  function mergeInputs(a, b, side){
    if (!a) return b; if (!b) return a;
    var o = MERGED[side|0];
    o.x = a.x || b.x || 0;
    o.down = !!(a.down||b.down); o.block = !!(a.block||b.block); o.up = !!(a.up||b.up);
    o.upPress = !!(a.upPress||b.upPress);
    o.punchPress = !!(a.punchPress||b.punchPress); o.kickPress = !!(a.kickPress||b.kickPress);
    o.specialPress = !!(a.specialPress||b.specialPress); o.superPress = !!(a.superPress||b.superPress);
    return o;
  }
  var BLANK = { x:0,down:false,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false };

  async function init(){
    var app = new PIXI.Application();
    await app.init({ background:"#0f0b16", resizeTo:window, antialias:false, roundPixels:true });
    document.getElementById("game").appendChild(app.canvas);
    G.app = app;

    G.cfgBase = await (await fetch("data/config.json",{cache:"no-store"})).json();
    G.roster = await (await fetch("data/roster.json",{cache:"no-store"})).json();
    G.stages = await (await fetch("data/stages.json",{cache:"no-store"})).json();   // escenarios (§4.6): motor e interfaz leen lo mismo
    G.campaigns = await (await fetch("data/campaigns.json",{cache:"no-store"})).json();   // Arcade 1v1 y 3v3 (datos, no código)
    // historia entre combates (data/story.json). Opcional: si falta o está mal, el Arcade sigue igual, sin capítulos.
    try { G.story = await (await fetch("data/story.json",{cache:"no-store"})).json(); } catch (e){ G.story = null; console.warn("Historia no disponible: " + e.message); }

    // audio: sincronizar con opciones guardadas
    if (global.PGAudio){ PGAudio.init(G.cfgBase.audio); PGAudio.setVolume(PGStore.get("volume")); PGAudio.setMusicVolume(PGStore.get("musicVolume")); PGAudio.setMuted(PGStore.get("muted")); }

    // fuentes de la interfaz/HUD antes de crear textos PIXI (si fallan se usa la fuente del sistema y se avisa)
    if (document.fonts && document.fonts.load){
      await Promise.all(['700 32px "Heros Cn"','400 16px "Inter PG"','600 16px "Inter PG"','800 16px "Inter PG"'].map(function(f){ return document.fonts.load(f); }))
        .catch(function(e){ console.warn("Fuentes del juego no disponibles, se usa la del sistema: " + e.message); });
    }
    app.ticker.stop();          // en menús no se dibuja el escenario (ahorro de batería en Android)
    G.fe = new PGFrontend(document.getElementById("ui"), { roster:G.roster, stages:G.stages.stages, campaigns:G.campaigns, store:window.PGStore, audio:global.PGAudio, emit:onFE, preload:preloadMatch });
    wireGlobalKeys();
    // reanudar audio con el primer gesto (política de autoplay)
    var resume = function(){ if (global.PGAudio) PGAudio.resume(); window.removeEventListener("pointerdown",resume); window.removeEventListener("keydown",resume); };
    window.addEventListener("pointerdown", resume); window.addEventListener("keydown", resume);

    G.fe.title();
    window.__PGGAME = G; window.__READY = true;
  }

  // ---- acciones emitidas por el front-end ----
  function onFE(action, payload){
    if (action==="start") startMatch(payload);
    else if (action==="resume") resumeMatch();
    else if (action==="rematch") rematch();
    else if (action==="stop"){ G.tournament=null; G.arcadeCampaign=null; stopMatch(); }
    else if (action==="optionsChanged") { /* se aplican en el próximo combate */ }
    else if (action==="tournamentStart") tournamentStart(payload);
    else if (action==="tournamentNext") tournamentNextMatch();
    else if (action==="tournamentRetry") tournamentNextMatch();
    else if (action==="arcadeStart") arcadeStart(payload);
    else if (action==="arcadeNext") arcadeNextMatch();
    else if (action==="arcadeRetry") arcadeRetry();
    else if (action==="arcadeEnding") arcadeEnding();
  }

  // ---- ARCADE (campañas en data/campaigns.json: 1v1 y 3v3, con sub-jefa y jefe final) ----
  // Rivales que entran SOLOS (reemplazos, torneo): jugables que no son provisionales ni ocultos.
  function autoPool(){ return G.roster.characters.filter(function(c){ return c.status==="playable" && !c.provisional && !c.hidden; }).map(function(c){ return c.id; }); }
  function copyBattle(b, extra){ var o = { difficulty:b.difficulty, stage:b.stage, boss:!!b.boss, midBoss:!!b.midBoss, tag:b.tag||null,
      mods:b.mods ? { hp:b.mods.hp||1, damage:b.mods.damage||1 } : null, unlocks:b.unlocks||null, memberMods:null };
    // memberMods (Equipos): modificador de UN integrante del equipo rival, por id (el jefe final: solo Garravas con más vida/daño)
    // capítulo de historia de esta batalla: su posición ORIGINAL en data/campaigns.json (no cambia aunque se salten combates)
    var CA = G.campaigns.arcade, n = CA.solo.indexOf(b), kind = "solo"; if (n < 0){ n = CA.teams.indexOf(b); kind = "teams"; }
    o.storyKey = n >= 0 ? kind + "." + n : null;
    if (b.memberMods){ o.memberMods = {}; Object.keys(b.memberMods).forEach(function(id){ var x = b.memberMods[id] || {};
      o.memberMods[resolveAlias(id)] = { hp:x.hp||1, damage:x.damage||1 }; }); }
    return Object.assign(o, extra); }
  function arcadeStart(p){
    var C = G.campaigns.arcade;
    if (p && (p.team || p.team1)){
      var yourTeam = (p.team1||[]).map(resolveAlias);
      var available = autoPool().filter(function(id){ return yourTeam.indexOf(id) < 0; });
      var battles = [];
      C.teams.forEach(function(b){
        var opp = b.opponentTeam.map(resolveAlias);
        // sub-jefe: si está en tu equipo, esa batalla no se juega (no se reemplaza a una sub-jefa por otro con doble vida)
        if (b.midBoss && opp.some(function(id){ return yourTeam.indexOf(id) >= 0; })) return;
        // el JEFE (integrante con memberMods) nunca se reemplaza: si también está en tu equipo se pelea el espejo
        var keep = b.memberMods ? Object.keys(b.memberMods).map(resolveAlias) : [];
        for (var i=0; i<opp.length; i++){
          if (yourTeam.indexOf(opp[i]) >= 0 && keep.indexOf(opp[i]) < 0){
            var repl = available.find(function(a){ return opp.indexOf(a) < 0; });
            if (repl) opp[i] = repl;
          }
        }
        battles.push(copyBattle(b, { opponentTeam:opp }));
      });
      G.arcadeCampaign = { isTeam:true, yourTeam:yourTeam, yourId:yourTeam[0], battles:battles, idx:0, length:battles.length, status:"active" };
      arcadeNextMatch();
      return;
    }
    var you = resolveAlias(p && p.yourId);
    // se salta la batalla cuyo rival eres tú (p. ej. la sub-jefa si ya la juegas), SALVO el jefe final: el Arcade nunca termina
    // sin su jefe; si elegiste a Garravas, el jefe final es el espejo (antes esa batalla desaparecía y el Arcade acababa en Nadia)
    var battles = C.solo.filter(function(b){ return b.boss || resolveAlias(b.opponent) !== you; }).map(function(b){ return copyBattle(b, { opponent:resolveAlias(b.opponent) }); });
    G.arcadeCampaign = { isTeam:false, yourId:you, battles:battles, idx:0, length:battles.length, status:"active" };
    arcadeNextMatch();
  }
  // Capítulo de historia que va ANTES de la batalla b (data/story.json), o null. Los de relleno (placeholder) solo se
  // muestran en modo borrador (showPlaceholders o game.html?story=draft). Una vez por combate: no se repite al reintentar.
  function storyBeat(A, b){
    var S = G.story; if (!S || S.enabled === false || !b.storyKey || A.beatShown === A.idx) return null;
    var k = b.storyKey.split("."), T = S.arcade || {}, tbl = T[k[0]]; if (typeof tbl === "string") tbl = T[tbl];
    var beat = tbl && tbl[k[1]]; if (!beat) return null;
    var draft = !!S.showPlaceholders || (global.location && /[?&]story=draft\b/.test(global.location.search || ""));
    if (beat.placeholder && !draft) return null;
    return beat;
  }
  function arcadeNextMatch(){
    var A=G.arcadeCampaign; if(!A || A.idx>=A.length) return;
    var b=A.battles[A.idx], s=G.fe.sel;
    if (A.isTeam){
      s.mode="team"; s.team1=A.yourTeam; s.team2=b.opponentTeam; s.teamVs=false;
    } else {
      s.mode="arcade"; s.p1=A.yourId; s.p2=b.opponent;
    }
    s.difficulty=b.difficulty; s.stage=b.stage % G.stages.stages.length;
    s.tag="Combate "+(A.idx+1)+" de "+A.length+(b.boss ? " · JEFE FINAL" : b.tag ? " · " + b.tag : "");
    s.track=(b.boss || b.midBoss) ? "boss" : null;
    s.mods=null;   // el rival (lado 1) con la vida/daño de la batalla; en Equipos, además, el de cada integrante (memberMods)
    if (b.mods || (A.isTeam && b.memberMods)){
      var side = { hp:b.mods ? b.mods.hp : 1, damage:b.mods ? b.mods.damage : 1 };
      if (A.isTeam && b.memberMods) side.members = b.opponentTeam.map(function(id){ return b.memberMods[id] || null; });
      s.mods = [ { hp:1, damage:1 }, side ];
    }
    var beat = storyBeat(A, b);
    if (beat && G.fe.storyBeat){ A.beatShown = A.idx; G.fe.storyBeat(beat, function(){ G.fe.vs(); }); }
    else G.fe.vs();
  }
  function arcadeEnding(){
    var A=G.arcadeCampaign; if(!A || A.status!=="won") return;
    if (global.PGAudio){ PGAudio.sfx("boss"); PGAudio.music("menu"); }
    G.fe.campaignEnding({ yourId:A.yourId, yourTeam:A.yourTeam, isTeam:!!A.isTeam, length:A.length });
  }
  function arcadeRetry(){
    var A=G.arcadeCampaign; if(!A) return;
    if (A.status==="won") A.idx=A.length-1;
    A.status="active"; arcadeNextMatch();
  }

  // ---- TORNEO (escalera arcade) ----
  function resolveAlias(id){ var a=G.roster.aliases||{}; return a[id]||id; }
  function tournamentStart(p){
    var playable = autoPool();   // los rivales del torneo salen solos: nunca provisionales ni ocultos
    if (p && (p.team || p.team1)){
      var yourTeam = (p.team1||[]).map(resolveAlias);
      var pool = playable.filter(function(id){return yourTeam.indexOf(id)<0;});
      var n = Math.min(p.length||5, 7);
      var opponentTeams = [];
      for (var k=0; k<n; k++){
        for (var i=pool.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=pool[i];pool[i]=pool[j];pool[j]=t; }
        opponentTeams.push(pool.slice(0, 3));
      }
      var difficulties = opponentTeams.map(function(_,i){ return Math.min(3, 1 + Math.floor(i*3/n)); });
      G.tournament = { isTeam:true, yourTeam:yourTeam, yourId:yourTeam[0], opponentTeams:opponentTeams, difficulties:difficulties, idx:0, length:n };
      G.fe.tournamentLadder(G.tournament);
      return;
    }
    var you = resolveAlias(p.yourId);
    var pool = playable.filter(function(id){return id!==you;});
    // barajar determinista-suficiente (es presentación, no simulación)
    for (var i=pool.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=pool[i];pool[i]=pool[j];pool[j]=t; }
    var n = Math.min(p.length, Math.max(1, pool.length));
    var opponents = pool.slice(0,n);
    var difficulties = opponents.map(function(_,i){ return Math.min(3, 1 + Math.floor(i*3/n)); });
    G.tournament = { isTeam:false, yourId:you, opponents:opponents, difficulties:difficulties, idx:0, length:n };
    G.fe.tournamentLadder(G.tournament);
  }
  // cada combate del torneo pasa por la pantalla VS (precarga con progreso real, igual que versus/arcade)
  function tournamentNextMatch(){
    var T=G.tournament; if(!T) return;
    var s=G.fe.sel;
    if (T.isTeam){
      s.mode="team"; s.team1=T.yourTeam; s.team2=T.opponentTeams[T.idx]; s.teamVs=false;
    } else {
      s.mode="arcade"; s.p1=T.yourId; s.p2=T.opponents[T.idx];
    }
    s.difficulty=T.difficulties[T.idx]; s.stage=(T.idx % G.stages.stages.length); s.tag="Combate "+(T.idx+1)+" de "+T.length;
    s.track=null; s.mods=null;
    G.fe.vs();
  }

  function buildConfig(){
    var c = JSON.parse(JSON.stringify(G.cfgBase));
    c.timing.roundsToWin = PGStore.get("roundsToWin");
    c.timing.roundTime  = PGStore.get("roundTime");
    return c;
  }
  // reglas del MODO sobre la configuración. Antes solo las aplicaba startMatch: "Reiniciar" (o R) en Entrenamiento
  // creaba la partida sin ellas y el maniquí volvía a tener reloj de 99 s y podía caer K.O.
  // opciones del MatchState: equipos (si los hay) y modificadores de la batalla (G.mods, si los hay)
  function matchOpts(teams){ var o = {}; if (teams) o.teams = teams; if (G.mods) o.mods = G.mods; return (o.teams || o.mods) ? o : null; }
  function matchConfig(){
    var cfg = buildConfig();
    if (G.mode==="training" && cfg.training){ cfg.timing.roundTime = cfg.training.roundTime; cfg.fighters.minHp = cfg.training.minHp;
      if (cfg.stun) cfg.stun.enabled = !!G.trainDizzy; }   // reloj ∞, sin K.O., mareo solo si se activa en la pausa
    return cfg;
  }

  // Carga TODO lo del combate (datos, atlas, FX) mientras la pantalla VS se presenta. Informa progreso real.
  function stageOf(i){ var L = G.stages.stages; return L[((i|0) % L.length + L.length) % L.length]; }
  // luchadores de una selección: por rondas [p1, p2]; por EQUIPOS los 3 + 3 (en su orden de entrada)
  function teamsOf(sel){ return sel.mode==="team" ? [sel.team1.map(resolveAlias), sel.team2.map(resolveAlias)] : null; }
  function idsOf(sel){ var T = teamsOf(sel); return T ? T[0].concat(T[1]) : [resolveAlias(sel.p1), resolveAlias(sel.p2)]; }
  function preloadKey(sel){ return [idsOf(sel).join(","), sel.mode==="team" ? "team" : "duo", PGStore.get("fxQuality"), stageOf(sel.stage).id].join("|"); }
  async function preloadMatch(sel, onProgress){
    var key = preloadKey(sel);
    if (G.pre && G.pre.key === key) { if (onProgress) onProgress(1); return G.pre; }
    var byId = {}; G.roster.characters.forEach(function(c){ byId[c.id]=c; });
    var ids = idsOf(sel), uniq = ids.filter(function(id, i){ return ids.indexOf(id) === i; });
    uniq.forEach(function(id){ if (!byId[id]) throw new Error("luchador desconocido: " + id); });
    var done = 0, total = uniq.length*2 + 2; var tick = function(){ done++; if (onProgress) onProgress(done/total); };
    var getDef = function(c){ return fetch(c.dir+c.char,{cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error(c.dir+c.char+" ("+r.status+")"); return r.json(); }); };
    PGLoader.beginUse();      // lo que este combate pida se queda en memoria; lo de combates anteriores se libera al final
    var defs = await Promise.all(uniq.map(function(id){ return getDef(byId[id]).then(function(d){ tick(); return d; }); }));
    var hiddenParticleFx = await PGLoader.loadHiddenParticleFx('data/hidden_particle_fx.json');
    defs.forEach(function(d){
      var own = hiddenParticleFx && hiddenParticleFx.characters ? hiddenParticleFx.characters[d.id] : null;
      d.hiddenParticles = own ? Object.assign({}, hiddenParticleFx.defaults || {}, own) : null;
    });
    var loaded = await Promise.all(uniq.map(function(id, i){ return PGLoader.loadGridCharacter(defs[i], byId[id].dir).then(function(x){ tick(); return x; }); }));
    var chars = {}; uniq.forEach(function(id, i){ chars[id] = loaded[i]; });   // (los datos no se modifican en juego: un mismo luchador en los dos lados comparte objeto)
    var fx = PGStore.get("fxQuality") === "simple" ? null : await PGLoader.loadFxLibrary("data/fx_library.json", loaded.map(function(x){ return x.def; }));
    tick();
    var stageDef = stageOf(sel.stage), stageTex = await PGLoader.loadStageArt(stageDef);
    tick();
    var freed = PGLoader.releaseUnused();
    if (freed) console.info("Memoria: " + freed + " imágenes de combates anteriores liberadas.");
    var T = teamsOf(sel), a0 = T ? T[0][0] : ids[0], b0 = T ? T[1][0] : ids[1];
    G.pre = { key:key, ids:ids, teams:T, byId:byId, chars:chars, c1:byId[a0], c2:byId[b0], p0:chars[a0], p1:chars[b0],
              fx:fx, stageDef:stageDef, stageTex:stageTex };
    return G.pre;
  }

  async function startMatch(sel){
    stopMatch();
    G.mode = sel.mode; G.difficulty = sel.difficulty || PGStore.get("difficulty"); G.stage = sel.stage||0;
    G.track = sel.track || ((sel.tag && sel.tag.indexOf("JEFE FINAL") >= 0) ? "boss" : "fight");
    G.mods = sel.mods || null;   // modificadores de la batalla (sub-jefa: doble vida y daño); los conserva el reinicio
    G.teamVs = !!(sel.mode==="team" && sel.teamVs);     // equipos: rival CPU (por defecto) o jugador 2
    var pre = await preloadMatch(sel);           // instantáneo si la VS ya lo cargó
    var p0 = pre.p0, p1 = pre.p1;
    G.defs = [p0.def, p1.def];
    G.names = [pre.c1.name, pre.c2.name]; G.ids = [pre.c1.id, pre.c2.id];
    // EQUIPOS: luchadores ya cargados de cada lado, en orden; el integrante activo lo dice el MatchState (teams[s].cur)
    G.teams = pre.teams ? pre.teams.map(function(ids){ return ids.map(function(id){ return { id:id, name:pre.byId[id].name, ch:pre.chars[id] }; }); }) : null;
    G.teamCur = [0, 0];

    var cfg = matchConfig();
    G.match = PGSim.createMatch((Math.random()*1e9)>>>0, cfg, matchOpts(pre.teams));
    // FX de sprite: solo las páginas que usan estos dos luchadores + hitsparks genéricos (memoria acotada en Android)
    G.render = new PGRender(G.app, [p0, p1], { targetFrameH: (cfg.render&&cfg.render.targetFrameH)||180, stageDef: pre.stageDef, stageTex: pre.stageTex, fx: pre.fx,
      names: G.names, cpu: G.mode==="arcade" || G.mode==="training" || (G.mode==="team" && !G.teamVs), touch: padWanted(), fxK: shakeFactor(),
      teams: G.teams });
    G.render.debug = !!PGStore.get("showBoxes");
    // Entrenamiento: medición de ventaja al frame (pg_training.js solo LEE el MatchState)
    G.train = (G.mode==="training" && global.PGTraining) ? PGTraining.create() : null;
    if (G.train) PGTraining.reset(G.train, G.match);
    G.render.training = G.train; G._trainIdle = 0;
    G.app.ticker.start();
    if (global.PGAudio) PGAudio.music(G.track || "fight");
    resetStats();

    // controles (desengancha los anteriores para no acumular listeners)
    if (G.p1ctl && G.p1ctl.detach) G.p1ctl.detach();
    if (G.p2ctl && G.p2ctl.detach) G.p2ctl.detach();
    G.p1ctl = new PGInput.Controller(G.fe._keymap(1)); G.p1ctl.attachKeyboard(window);     // teclas reasignables (Opciones › Teclas)
    if (global.PGTouch) PGTouch.mount(document.getElementById("pad"), G.p1ctl);
    if (G.mode==="versus" || G.teamVs){ G.p2ctl = new PGInput.Controller(G.fe._keymap(2)); G.p2ctl.attachKeyboard(window); }
    else G.p2ctl = null;

    G.resultShown = false; G.paused = false;
    document.getElementById("topbar").classList.remove("hidden");
    showPad(true);
    startLoop();
  }
  // sacudida de cámara y destellos de pantalla (accesibilidad): preferencia, o "reducir movimiento" del sistema
  function shakeFactor(){
    var v = PGStore.get("shake");
    if (v == null) v = (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) ? "soft" : "full";
    return v === "off" ? 0 : v === "soft" ? 0.45 : 1;
  }
  // controles táctiles: Automático (solo pantallas táctiles) / Siempre / Ocultos
  // ¿se muestran los controles táctiles? (preferencia "auto" = solo con puntero grueso, p.ej. teléfonos)
  function padWanted(){
    var pref = PGStore.get("touchPad");
    var coarse = !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);
    return pref === "on" || (pref !== "off" && coarse);
  }
  function showPad(on){ document.getElementById("pad").classList.toggle("hidden", !(on && padWanted())); }
  // ---- estadísticas REALES del combate (para la pantalla de resultados) ----
  function resetStats(){ G.stats = [ {damage:0,maxCombo:0,specials:0,throws:0}, {damage:0,maxCombo:0,specials:0,throws:0} ]; G._prevHp=null; G._prevSt=["",""]; }
  function trackStats(m){
    var S = G.stats; if (!S) return;
    var h0 = m.fighters[0].hp, h1 = m.fighters[1].hp, P = G._prevHp;     // (sin arreglo nuevo por paso)
    if (P){
      if (P[1] - h1 > 0) S[0].damage += P[1] - h1;      // daño que cada uno le hizo al rival
      if (P[0] - h0 > 0) S[1].damage += P[0] - h0;
      // vibración al recibir golpes (jugador 1)
      var got = P[0] - h0;
      // en el APK vibra el puente nativo por evento (PGAudio); aquí solo el navegador, para no vibrar dos veces
      if (got > 0 && PGStore.get("vibrate") && navigator.vibrate && !global.AndroidBridge) navigator.vibrate(Math.min(60, 12 + got*2));
      P[0] = h0; P[1] = h1;
    } else G._prevHp = [h0, h1];
    for (var j=0;j<2;j++){ var f = m.fighters[j];
      if (f.comboCount > S[j].maxCombo) S[j].maxCombo = f.comboCount;
      if ((f.state==="SPECIAL"||f.state==="SUPER") && G._prevSt[j]!==f.state) S[j].specials++;
      if (f.state==="THROW" && G._prevSt[j]!=="THROW") S[j].throws++;
      G._prevSt[j] = f.state; }
  }

  function startLoop(){
    if (G.running) return;
    G.running = true; G.acc = 0; G.last = performance.now();
    var loop = function(now){
      if (!G.running){ return; }
      G.rafId = requestAnimationFrame(loop);
      if (!G.paused){
        G.acc += now - G.last;
        var steps = 0;
        while (G.acc >= STEP_MS && steps < MAX_STEPS){ simStep(); G.acc -= STEP_MS; steps++; }
        if (steps === MAX_STEPS) G.acc = 0;
      } else { G.last = now; }
      G.last = now;
      if (G.render) G.render.render(G.match);
      checkOver();
    };
    G.rafId = requestAnimationFrame(loop);
  }

  function simStep(){
    var m = G.match; if (!m) return;
    // P1
    var in0 = mergeInputs(G.p1ctl.snapshot(), global.PGGamepad?PGGamepad.snapshot(0):null, 0);
    // P2
    var in1;
    if (G.mode==="versus" || G.teamVs) in1 = mergeInputs(G.p2ctl?G.p2ctl.snapshot():null, global.PGGamepad?PGGamepad.snapshot(1):null, 1);
    else if (G.mode==="training") in1 = dummyInput(m);
    else in1 = PGAI.decide(m, m.fighters[1], m.fighters[0], G.difficulty, G.defs[1]);
    PGSim.step(m, G.defs, [in0, in1]);
    if (m.teams) syncTeams(m);
    if (G.train) trainingStep(m);
    trackStats(m);
    if (m.events.length){ if (global.PGAudio) PGAudio.events(m.events); m.events.length = 0; }
  }

  // EQUIPOS: cuando la simulación hace entrar al siguiente integrante (al terminar el K.O.), el orquestador cambia los
  // datos que le pasa al simulador y el luchador que dibuja el render. El simulador no conoce atlas: solo ids y orden.
  function syncTeams(m){
    for (var s = 0; s < 2; s++){ var cur = m.teams[s].cur; if (cur === G.teamCur[s]) continue;
      var mem = G.teams[s][cur]; G.teamCur[s] = cur; G.defs[s] = mem.ch.def; G.names[s] = mem.name; G.ids[s] = mem.id;
      if (G.render) G.render.setFighter(s, mem.ch, mem.name); }
  }
  function checkOver(){
    var m = G.match; if (!m || !m.over || G.resultShown) return;
    // esperar a que termine el congelamiento del K.O. final antes de mostrar resultados
    if (m.phase==="ko" && m.phaseT>0) return;
    G.resultShown = true;
    var w = m.winner;
    // CAMPAÑA ARCADE: el jugador es el lado 0; conserva el estado entre combates
    if (G.arcadeCampaign){
      var A=G.arcadeCampaign, battle=A.battles[A.idx], campaignData={ index:A.idx, total:A.length, boss:!!(battle&&battle.boss), opponent:battle&&(battle.opponent || (battle.opponentTeam&&battle.opponentTeam[0])), complete:false };
      if (w===0){
        // DESBLOQUEO: ganarle a una batalla con `unlocks` (datos) deja a ese personaje seleccionable en este dispositivo
        if (battle && battle.unlocks && !PGStore.isUnlocked(battle.unlocks)){
          PGStore.unlock(battle.unlocks);
          var uc = G.roster.characters.find(function(c){ return c.id===battle.unlocks; });
          campaignData.unlocked = { id:battle.unlocks, name:uc ? uc.name : battle.unlocks };
        }
        A.idx++;
        if (A.idx>=A.length){ A.status="won"; campaignData.complete=true; campaignData.status="won"; }
        else { campaignData.status="next"; campaignData.nextOpponent=A.isTeam ? A.battles[A.idx].opponentTeam[0] : A.battles[A.idx].opponent; campaignData.nextBoss=!!A.battles[A.idx].boss; }
      } else { campaignData.status="retry"; }
      var arcadeNames=[nameOf(G.defs[0]),nameOf(G.defs[1])], arcadeStats=G.stats;
      var teams = m.teams ? m.teams.map(function(T){ return { ids:T.ids.slice(), status:T.status.slice() }; }) : null;
      stopMatch();
      G.fe.results({ winner:w, winnerName:(w<0?null:arcadeNames[w]), wins:m.wins, names:arcadeNames, ids:G.ids, stats:arcadeStats,
        teams:teams, teamVs:false, modeName:A.isTeam ? "Arcade (Equipos)" : "Arcade", campaign:campaignData, yourId:A.yourId, yourTeam:A.yourTeam });
      return;
    }
    // TORNEO: el jugador es el lado 0; avanzar o eliminar
    if (G.tournament){
      var T=G.tournament;
      var teams = m.teams ? m.teams.map(function(X){ return { ids:X.ids.slice(), status:X.status.slice() }; }) : null;
      if (w===0){ // ganó el combate
        T.idx++;
        if (T.idx>=T.length){ stopMatch(); G.fe.tournamentChampion({ yourId:T.yourId, yourTeam:T.yourTeam, isTeam:!!T.isTeam, length:T.length, teams:teams }); G.tournament=null; }
        else { stopMatch(); G.fe.tournamentLadder(T); }
      } else { // perdió o empate = eliminado
        var byId=T.isTeam ? (T.opponentTeams[T.idx] && T.opponentTeams[T.idx][0]) : T.opponents[T.idx];
        var oppTeam = T.isTeam ? T.opponentTeams[T.idx] : null;
        var idx=T.idx; var len=T.length; stopMatch();
        G.fe.tournamentGameOver({ byId:byId, oppTeam:oppTeam, isTeam:!!T.isTeam, idx:idx, length:len });
      }
      return;
    }
    var names = [ nameOf(G.defs[0]), nameOf(G.defs[1]) ];
    var stats = G.stats, teams = m.teams ? m.teams.map(function(T){ return { ids:T.ids.slice(), status:T.status.slice() }; }) : null;
    var lastSel = m.teams ? { mode:"team", team1:m.teams[0].ids.slice(), team2:m.teams[1].ids.slice(), teamVs:G.teamVs, difficulty:G.difficulty, stage:G.stage }
                          : { mode:G.mode, p1:G.ids[0], p2:G.ids[1], difficulty:G.difficulty, stage:G.stage };
    stopMatch();
    G.fe.results({ winner: w, winnerName: (w<0?null:names[w]), wins: m.wins, names: names, ids: G.ids, stats: stats, teams: teams, teamVs: G.teamVs,
                   modeName: { arcade:"Arcade", versus:"Versus", training:"Entrenamiento", team:"Equipos" }[G.mode] || "" });
    G.lastSel = lastSel;
  }
  function nameOf(def){ var c = G.roster.characters.find(function(x){ return x.id===def.id; }); return c?c.name:(def.displayName||def.id); }

  function resumeMatch(){ if (!G.match) return; G.paused=false; if (global.PGAudio) PGAudio.music(G.track || "fight"); document.getElementById("topbar").classList.remove("hidden"); showPad(true);
    if (G.render) G.render.debug = G.render.debug; }
  function pauseMatch(){ if (!G.running || G.resultShown) return; G.paused=true; showPad(false); G.fe.pause(); }
  function rematch(){
    if (!G.match){ if (G.lastSel) return startMatch(G.lastSel); return; }   // desde Resultados el combate ya se cerró
    var T = G.match.teams;   // equipos: la revancha empieza otra vez con los primeros de cada equipo
    G.match = PGSim.createMatch((Math.random()*1e9)>>>0, matchConfig(), matchOpts(T ? T.map(function(x){ return x.ids; }) : null));
    if (T) syncTeamsReset();
    G.resultShown=false; G.paused=false; resetStats(); G._trainIdle = 0;
    document.getElementById("topbar").classList.remove("hidden"); showPad(true);
    if (!G.running) startLoop();
  }
  function syncTeamsReset(){
    for (var s = 0; s < 2; s++){ var mem = G.teams[s][0]; G.teamCur[s] = 0; G.defs[s] = mem.ch.def; G.names[s] = mem.name; G.ids[s] = mem.id;
      if (G.render) G.render.setFighter(s, mem.ch, mem.name); }
  }
  function stopMatch(){
    G.running=false; G.paused=false; if (G.rafId) cancelAnimationFrame(G.rafId);
    if (G.render){ G.render.destroy(); G.render=null; }
    if (G.p1ctl && G.p1ctl.detach) G.p1ctl.detach();
    if (G.p2ctl && G.p2ctl.detach) G.p2ctl.detach();
    G.p1ctl=null; G.p2ctl=null;
    G.match=null;
    if (G.app) G.app.ticker.stop();
    document.getElementById("topbar").classList.add("hidden");
    showPad(false);
  }


  function wireGlobalKeys(){
    document.addEventListener("keydown", function(e){
      if (G.fe && G.fe.isCapturing && G.fe.isCapturing()) return;   // Opciones › Teclas está esperando una tecla
      var k = e.key.toLowerCase();
      // Mute: siempre disponible
      if (k==="m"){ var mu=!PGStore.get("muted"); PGStore.set("muted",mu); if (global.PGAudio) PGAudio.setMuted(mu); return; }
      // --- navegación de MENÚ cuando el overlay está visible ---
      if (G.fe && G.fe.isVisible()){
        if (k==="arrowup"){ G.fe.navFocus("up"); e.preventDefault(); }
        else if (k==="arrowdown"){ G.fe.navFocus("down"); e.preventDefault(); }
        else if (k==="arrowleft"){ G.fe.navFocus("left"); e.preventDefault(); }
        else if (k==="arrowright"){ G.fe.navFocus("right"); e.preventDefault(); }
        else if (k==="enter"||k===" "){ G.fe.actFocus(); e.preventDefault(); }
        else if (k==="escape"||k==="backspace"){ G.fe.back(); e.preventDefault(); }
        return;
      }
      // --- hotkeys de COMBATE ---
      if (k==="escape"){ if (G.running && !G.paused && !G.resultShown) pauseMatch(); return; }
      if (!G.running) return;
      if (k==="f" && G.render){ G.render.debug = !G.render.debug; showToast(G.render.debug ? "Cajas de golpe visibles" : "Cajas de golpe ocultas"); }
      if (G.mode==="training"){
        if (k==="b"){ G.infMeter = !G.infMeter; showToast(G.infMeter ? "Barra infinita" : "Barra normal"); }
        if (k==="g"){ G.setDummy(G.dummy+1); showToast("Maniquí: "+DUMMY_LABEL[G.dummy]); }
        if (k==="r") rematch();
      }
    }, true);

    // poller de MENÚ por mando (siempre activo)
    function menuPoll(){
      requestAnimationFrame(menuPoll);
      if (!global.PGGamepad) return;
      // START del mando abre la pausa durante el combate (mismo bucle rAF; antes era un setInterval aparte)
      if (G.running && !G.resultShown && G.fe && !G.fe.isVisible()){ if (PGGamepad.anyStart()) pauseMatch(); return; }
      if (!G.fe || !G.fe.isVisible()) return;
      var s = PGGamepad.menuSnapshot(0); if (!s) return;
      if (s.up) G.fe.navFocus("up"); else if (s.down) G.fe.navFocus("down");
      else if (s.left) G.fe.navFocus("left"); else if (s.right) G.fe.navFocus("right");
      if (s.confirm) G.fe.actFocus(); if (s.back) G.fe.back();
    }
    requestAnimationFrame(menuPoll);

    var db=document.getElementById("btn-debug"); if(db) db.onclick=function(){ if(G.render) G.render.debug=!G.render.debug; };
    var pb=document.getElementById("btn-pause"); if(pb) pb.onclick=function(){ pauseMatch(); };
  }

  // ---- Entrenamiento: medición + recargas (reglas del MODO, fuera de la simulación de combate) ----
  // Tras config.training.refillIdle frames sin intercambio (nadie aturdido), la vida de ambos se rellena; con "barra
  // infinita" (tecla B) la barra de P1 se mantiene llena. Banco de pruebas: no corre en Arcade/Versus/Torneo.
  function trainingStep(m){
    PGTraining.observe(G.train, m);
    var F = m.fighters, free = PGTraining.FREE, idle = (m.cfg.training && m.cfg.training.refillIdle) || 45;
    if (!G.train.on && free[F[0].state] && free[F[1].state]){ if (++G._trainIdle >= idle){ F[0].hp = F[0].maxHp; F[1].hp = F[1].maxHp; } }
    else G._trainIdle = 0;
    if (G.infMeter) F[0].meter = F[0].maxMeter;
  }
  // ---- maniquí de entrenamiento + aviso efímero ----
  var DUMMY_MODES = ["stand","block","crouch","cpu"];
  var DUMMY_LABEL = ["Parado","Bloquea","Agachado","IA"];
  // entradas fijas REUTILIZADAS (antes un objeto nuevo por frame)
  var D_BLOCK = { x:0,down:false,block:true,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false };
  var D_CROUCH = { x:0,down:true,block:false,upPress:false,punchPress:false,kickPress:false,specialPress:false,superPress:false };
  // "Bloquea": se cubre agachado ante golpes y arrojadizos BAJOS y de pie ante el resto (antes solo de pie: los bajos
  // le pegaban y no se podía medir su ventaja en guardia). Es el maniquí del modo práctica: puede mirar el ataque del rival.
  function incomingLow(m){
    var a = m.fighters[0], mv = a.move && G.defs[0].moves[a.move];
    if (mv && mv.guardType === "low") return true;
    var P = m.projectiles; for (var i = 0; i < P.length; i++) if (P[i].owner === 0 && P[i].guardType === "low") return true;
    return false;
  }
  function dummyInput(m){
    switch(DUMMY_MODES[G.dummy]){
      case "block":  D_BLOCK.down = incomingLow(m); return D_BLOCK;
      case "crouch": return D_CROUCH;
      case "cpu":    return PGAI.decide(m, m.fighters[1], m.fighters[0], G.difficulty, G.defs[1]);
      default:       return BLANK;
    }
  }
  // ajustes del entrenamiento (los usa la pausa: así también se cambian en el teléfono, sin teclas G/B)
  G.dummyLabels = DUMMY_LABEL;
  G.setDummy = function(i){ G.dummy = ((i|0) % DUMMY_MODES.length + DUMMY_MODES.length) % DUMMY_MODES.length; };
  G.setTrainDizzy = function(on){ G.trainDizzy = !!on; if (G.match && G.mode==="training" && G.match.cfg.stun) G.match.cfg.stun.enabled = G.trainDizzy; };
  // aviso efímero: la vida del aviso la lleva una animación CSS (sin setTimeout); reiniciarla = quitar clase + reflow
  function showToast(txt){
    var t=document.getElementById("pg-toast");
    if(!t){ t=document.createElement("div"); t.id="pg-toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
    t.textContent=txt; t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  }

  window.addEventListener("error", function(e){ window.__PGC_ERR = String(e.message||e.error); });
  init().catch(function(e){ window.__PGC_ERR = String(e&&e.stack||e); window.__READY = true; });
})(window);
