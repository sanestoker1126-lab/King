/* pg_audio.js — motor de audio híbrido sin dependencias (WebAudio).
   - Capa dual: busca archivos en assets/audio/ (WAV/OGG/MP3) con pool nativo y cero latencia;
     si no existen, cae automáticamente al sintetizador procedural en tiempo real.
   - Consume match.events para SFX sincronizados por evento de combate.
   - Música: reproduce archivo en loop si existe o corre el secuenciador procedural en La menor.
   - Volumen maestro, música, mute, reanudación en primer gesto (política de autoplay).
   No toca la simulación ni el RNG; es puramente presentación. Modular. */
(function (global) {
  "use strict";

  var ctx = null, master = null, musicBus = null, sfxBus = null;
  var state = { ready:false, muted:false, vol:0.8, musicVol:0.5, track:null, raf:0, step:0, nextT:0, stepDur:0.125 };
  var NOISE = null;   // 1 s de ruido blanco, creado UNA vez
  var LOOKAHEAD = 0.15;   // s de música agendada por adelantado en el reloj de audio

  // --- Capa de archivos reales con fallback ---
  var bufferCache = {};         // key -> AudioBuffer | false | undefined
  var loadPromises = {};        // key -> Promise
  var audioIndexPromise = null;
  var musicSource = null;       // AudioBufferSourceNode activo para música en loop (si hay archivo real)
  var audioConfig = null, sfxVoices = []; // canales GainNode reutilizables; AudioBufferSourceNode es one-shot en WebAudio

  var SFX_KEYS = [
    "light", "heavy", "head", "block", "energy", "super", "boss", "ko",
    "round", "time", "perfect", "dizzy", "counter", "crush", "down", "tech",
    "ui", "confirm", "cancel"
  ];
  var MUSIC_KEYS = ["menu", "fight", "boss"];

  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = state.muted?0:state.vol; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = state.musicVol; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(master);
    configureSfxVoices();
    var n = ctx.sampleRate; NOISE = ctx.createBuffer(1, n, n); var d = NOISE.getChannelData(0);
    var seed = 0x2545F491; for (var i=0;i<n;i++){ seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; d[i] = ((seed >>> 0) / 4294967296) * 2 - 1; }
    state.ready = true;
    probeAudioFiles();
    return ctx;
  }
  function now(){ return ctx ? ctx.currentTime : 0; }

  function configureSfxVoices(){
    var count = Number(audioConfig && audioConfig.sfxVoiceCount);
    if (!Number.isFinite(count) || count < 0) count = 0;
    count = Math.floor(count);
    while (sfxVoices.length < count){
      var gain = ctx.createGain(); gain.connect(sfxBus);
      sfxVoices.push({ gain:gain, source:null, busy:false });
    }
  }

  // Carga asíncrona de un archivo de audio; devuelve AudioBuffer o null si no existe
  function loadAudioIndex(){
    if (!audioIndexPromise) audioIndexPromise = fetch("assets/audio/audio-index.json", { cache: "no-store" }).then(function(resp){
      if (!resp.ok) throw new Error("No se pudo leer assets/audio/audio-index.json");
      return resp.json();
    }).then(function(index){
      var files = {}; (index.files || []).forEach(function(path){ files[path] = true; }); return files;
    }).catch(function(e){ state.lastError = "audio-index: " + String(e); console.warn("Sin índice de audio (" + e.message + "): se usa el sintetizador de respaldo."); return {}; });
    return audioIndexPromise;
  }
  async function loadAudioFile(key, urlCandidates) {
    if (bufferCache[key] !== undefined) return bufferCache[key];
    if (loadPromises[key]) return loadPromises[key];
    if (!ctx) return null;

    loadPromises[key] = (async function() {
      var available = await loadAudioIndex();
      for (var i = 0; i < urlCandidates.length; i++) {
        var url = urlCandidates[i];
        var relativePath = url.replace(/^assets\/audio\//, "");
        if (!available[relativePath]) continue;
        try {
          var resp = await fetch(url);
          if (resp.ok) {
            var ab = await resp.arrayBuffer();
            var audioBuf = await ctx.decodeAudioData(ab);
            bufferCache[key] = audioBuf;
            return audioBuf;
          }
        } catch (e) {
          // archivo no disponible o ruta inexistente; probar siguiente candidato
        }
      }
      bufferCache[key] = false; // marcar como no existente para usar sintetizador inmediatamente
      return null;
    })();

    return loadPromises[key];
  }

  function probeAudioFiles() {
    if (!ctx) return;
    SFX_KEYS.forEach(function(k) {
      loadAudioFile(k, ["assets/audio/" + k + ".wav", "assets/audio/" + k + ".ogg", "assets/audio/" + k + ".mp3"]);
    });
    MUSIC_KEYS.forEach(function(k) {
      loadAudioFile("music_" + k, ["assets/audio/music_" + k + ".wav", "assets/audio/music_" + k + ".ogg", "assets/audio/music_" + k + ".mp3"]);
    });
  }

  function playBuffer(buf, bus, loop) {
    if (!ctx || !buf) return null;
    var target = bus || sfxBus;
    if (target === sfxBus && !loop && sfxVoices.length){
      var voice = null;
      for (var i=0;i<sfxVoices.length;i++){ if (!sfxVoices[i].busy){ voice=sfxVoices[i]; break; } }
      if (voice){
        var pooled = ctx.createBufferSource(); pooled.buffer=buf; pooled.loop=false; pooled.connect(voice.gain);
        voice.source=pooled; voice.busy=true;
        pooled.onended=function(){ if (voice.source===pooled){ voice.source=null; voice.busy=false; } };
        pooled.start(now());
        return pooled;
      }
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!loop;
    src.connect(target);
    src.start(now());
    return src;
  }

  // --- un "golpe" tonal: oscilador con envolvente. `at` = instante en el reloj de audio ---
  function tone(freq, dur, type, gain, bus, slideTo, at) {
    if (!ctx) return;
    var t0 = at || now();
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo), t0+dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain||0.3, t0+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    o.connect(g); g.connect(bus||sfxBus); o.start(t0); o.stop(t0+dur+0.02);
  }

  // --- ruido filtrado (impactos): lee un tramo del buffer compartido, decae con envolvente ---
  function noise(dur, lp, gain, bus, at) {
    if (!ctx) return;
    var t0 = at || now();
    var s = ctx.createBufferSource(); s.buffer = NOISE;
    var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp||1200;
    var g = ctx.createGain(); g.gain.setValueAtTime(gain||0.4, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    s.connect(f); f.connect(g); g.connect(bus||sfxBus);
    var off = ((t0 * 7.31) % 1) * Math.max(0, 1 - dur);
    s.start(t0, off, dur); s.stop(t0+dur+0.02);
  }

  // --- Sintetizador procedural para SFX cuando no hay archivo de audio ---
  function synthSfx(type) {
    switch (type) {
      case "light":  noise(0.07, 2600, 0.28); tone(420,0.05,"square",0.08); break;
      case "heavy":  noise(0.16, 900, 0.5); tone(150,0.18,"sawtooth",0.22,null,70); break;
      case "head":   noise(0.12, 1800, 0.42); tone(640,0.09,"square",0.14,null,300); break;
      case "block":  noise(0.06, 3200, 0.22); tone(1200,0.04,"sine",0.06); break;
      case "energy": tone(660,0.22,"sawtooth",0.16,null,180); tone(990,0.18,"sine",0.08); break;
      case "super":  // acorde ascendente + ruido grave
        var t = now(); [330,415,495,660].forEach(function(fr,i){ tone(fr,0.4,"sawtooth",0.14,null,0,t+i*0.045); });
        noise(0.5, 600, 0.3); break;
      case "boss":   // golpe ceremonial del jefe / entrada al cierre
        var bt = now(); [98,147,196,294].forEach(function(fr,i){ tone(fr,0.55,"sawtooth",0.16,null,fr*0.72,bt+i*0.055); });
        noise(0.65, 360, 0.38); break;
      case "ko":     noise(0.5, 500, 0.45); tone(110,0.6,"sawtooth",0.25,null,50); tone(220,0.5,"square",0.1,null,60); break;
      case "round":  tone(523,0.18,"triangle",0.18); tone(659,0.18,"triangle",0.18,null,0,now()+0.12); break;
      case "time":   tone(196,0.32,"square",0.14); tone(185,0.42,"square",0.14,null,0,now()+0.34); break;
      case "perfect":tone(784,0.12,"triangle",0.14,null,0,now()+0.35); tone(988,0.12,"triangle",0.14,null,0,now()+0.47); tone(1175,0.28,"triangle",0.16,null,0,now()+0.59); break;
      case "dizzy":  tone(1480,0.09,"sine",0.07,null,1180); tone(1320,0.09,"sine",0.07,null,1040,now()+0.1); tone(1180,0.12,"sine",0.07,null,900,now()+0.2); break;
      case "counter":tone(1320,0.08,"square",0.12); tone(1760,0.12,"square",0.08,null,0,now()+0.05); break;
      case "crush":  noise(0.3, 1400, 0.5); tone(240,0.35,"sawtooth",0.2,null,90); tone(960,0.2,"square",0.08,null,0,now()+0.04); break;
      case "down":   noise(0.18, 420, 0.42); tone(70,0.2,"sine",0.25,null,45); break;
      case "tech":   noise(0.08, 3000, 0.18); tone(520,0.07,"triangle",0.12,null,780); break;
      case "ui":     tone(880,0.05,"square",0.08); break;
      case "confirm":tone(660,0.07,"square",0.1); tone(990,0.1,"square",0.1,null,0,now()+0.07); break;
      case "cancel": tone(300,0.09,"square",0.09,null,180); break;
      default:       noise(0.06, 2000, 0.2);
    }
  }

  // --- SFX por tipo de evento del combate ---
  // vibración nativa por evento (APK: MainActivity expone AndroidBridge.playHaptic con los mismos tipos que los SFX).
  // Respeta la opción "Vibración" del jugador. Si el puente falla se avisa UNA vez (no se silencia) y se sigue sin vibrar.
  function haptic(type) {
    var B = global.AndroidBridge; if (!B || typeof B.playHaptic !== "function") return;
    if (global.PGStore && global.PGStore.get("vibrate") === false) return;
    try { B.playHaptic(type); }
    catch (e) { if (!haptic.warned) { haptic.warned = true; state.lastError = "haptic: " + String(e); console.warn("Vibración nativa no disponible (" + e.message + "): se sigue sin vibración."); } }
  }
  function sfx(type) {
    haptic(type);
    if (!ensure() || state.muted) return;
    if (ctx.state === "suspended") ctx.resume();

    // 1. Probar archivo precargado en bufferCache (cero latencia)
    var buf = bufferCache[type];
    if (buf) {
      playBuffer(buf, sfxBus, false);
      return;
    }
    // 2. Si todavía no se ha intentado cargar, disparar carga en segundo plano
    if (buf === undefined) {
      loadAudioFile(type, ["assets/audio/" + type + ".wav", "assets/audio/" + type + ".ogg", "assets/audio/" + type + ".mp3"]);
    }
    // 3. Fallback inmediato al sintetizador
    synthSfx(type);
  }

  // --- MÚSICA procedural: patrón en La menor, bajo + arpegio ---
  var SCALE = { menu:[220,261.63,293.66,329.63,392,329.63,293.66,261.63],
                fight:[220,277.18,329.63,440,329.63,277.18,246.94,220],
                boss:[146.83,174.61,196,233.08,146.83,130.81,116.54,98] };
  var BASS  = { menu:[110,110,146.83,98], fight:[110,98,110,146.83], boss:[73.42,65.41,58.27,49] };

  function playStep(track, step, t) {
    var sc = SCALE[track]||SCALE.menu, ba = BASS[track]||BASS.menu;
    var mi = step % sc.length;
    tone(sc[mi], 0.22, "triangle", 0.12, musicBus, 0, t);
    if (mi % 2 === 0) tone(sc[mi]*2, 0.12, "sine", 0.05, musicBus, 0, t);
    if (step % 2 === 0) tone(ba[(step/2) % ba.length], 0.3, "sawtooth", 0.10, musicBus, 0, t);
    if ((track==="fight" || track==="boss") && step % 2 === 1) noise(0.03, 7000, track==="boss" ? 0.035 : 0.05, musicBus, t);
  }

  function pump() {
    state.raf = requestAnimationFrame(pump);
    if (!state.track || musicSource) return;
    var t = now();
    if (state.muted || ctx.state !== "running") { state.nextT = t; return; }
    if (state.nextT < t - 0.05) state.nextT = t;
    while (state.nextT < t + LOOKAHEAD) { playStep(state.track, state.step, state.nextT); state.step++; state.nextT += state.stepDur; }
  }

  function startMusic(track) {
    if (!ensure()) return;
    stopMusic();
    state.track = track;

    // Si existe archivo de música para este track, reproducirlo en loop nativo
    var mKey = "music_" + track;
    var mBuf = bufferCache[mKey];
    if (mBuf) {
      musicSource = playBuffer(mBuf, musicBus, true);
      return;
    }
    if (mBuf === undefined) {
      loadAudioFile(mKey, ["assets/audio/music_" + track + ".wav", "assets/audio/music_" + track + ".ogg", "assets/audio/music_" + track + ".mp3"]).then(function(loaded) {
        if (loaded && state.track === track && !musicSource) {
          if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
          musicSource = playBuffer(loaded, musicBus, true);
        }
      });
    }

    // Fallback: sintetizador procedural
    state.step = 0;
    state.stepDur = (track==="fight" ? 125 : track==="boss" ? 180 : 95) / 1000;
    state.nextT = now();
    state.raf = requestAnimationFrame(pump);
  }

  function stopMusic() {
    if (musicSource) {
      try { musicSource.stop(); } catch(e){ state.lastError = "stopMusic: " + String(e); }
      musicSource = null;
    }
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    state.track = null;
  }

  var PGAudio = {
    init: function(config){ audioConfig = config || audioConfig; if (ctx) configureSfxVoices(); return ensure(); },
    resume: function(){ if (ensure() && ctx.state === "suspended") return ctx.resume(); },
    sfx: sfx,
    haptic: haptic,
    events: function(list){ if (!list) return; for (var i=0;i<list.length;i++) sfx(list[i].t); },
    music: startMusic,
    stopMusic: stopMusic,
    loadAudioFile: loadAudioFile,
    getBuffer: function(key){ return bufferCache[key]; },
    getVoicePoolStats: function(){ return { configured: Number(audioConfig && audioConfig.sfxVoiceCount) || 0, channels: sfxVoices.length, active: sfxVoices.filter(function(v){ return v.busy; }).length }; },
    setMuted: function(m){ state.muted = !!m; if (master) master.gain.value = state.muted?0:state.vol; },
    isMuted: function(){ return state.muted; },
    setVolume: function(v){ state.vol = Math.max(0,Math.min(1,v)); if (master && !state.muted) master.gain.value = state.vol; },
    setMusicVolume: function(v){ state.musicVol = Math.max(0,Math.min(1,v)); if (musicBus) musicBus.gain.value = state.musicVol; },
    getVolume: function(){ return state.vol; },
    getMusicVolume: function(){ return state.musicVol; }
  };
  global.PGAudio = PGAudio;
})(window);
