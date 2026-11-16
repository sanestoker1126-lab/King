/* pg_net.js — RETO POR BLUETOOTH (dos teléfonos, uno contra otro).
   Transporte:
     - "bt": Bluetooth clásico (RFCOMM) del APK. El código nativo (android/.../BtLink.java) lo expone como
       window.AndroidBridge.bt*(...) y avisa con window.PGNet._native(tipo, datosJSON).
     - "test": BroadcastChannel entre dos pestañas del mismo navegador (game.html?net=test). SOLO para probar el protocolo
       en una computadora: no es Bluetooth.
   Juego en red = LOCKSTEP: la simulación es determinista (pg_sim.js), así que cada teléfono simula TODA la pelea y solo
   se mandan los botones de cada cuadro. La entrada local se aplica DELAY cuadros después (tiempo para que llegue al
   otro); si la del rival no ha llegado, la simulación espera. Cada HASH_EVERY cuadros se compara una huella del estado:
   si difiere, la pelea se desincronizó y se avisa (no se oculta).
   Mensajes (una línea JSON cada uno): hello · pick · ready · start · i (entrada) · h (huella) · bye. */
(function (global) {
  "use strict";
  var VERSION = 1;
  var DELAY = 3, HASH_EVERY = 60;
  var listeners = {};
  function emit(ev, d){ (listeners[ev] || []).forEach(function(fn){ try { fn(d); } catch (e) { console.error("PGNet " + ev + ": " + e.message); } }); }

  // ---------------------------------------------------------------- transportes
  var T = null;
  var BT = {
    name: "bt",
    ok: function(){ var B = global.AndroidBridge; return !!(B && typeof B.btSend === "function"); },
    host: function(){ global.AndroidBridge.btHost(); },
    scan: function(){ global.AndroidBridge.btScan(); },
    connect: function(addr){ global.AndroidBridge.btConnect(String(addr)); },
    send: function(line){ global.AndroidBridge.btSend(line); },
    close: function(){ global.AndroidBridge.btClose(); }
  };
  // prueba local: dos pestañas. La primera que "crea sala" es el anfitrión; la otra la ve como dispositivo y se conecta.
  var TEST = {
    name: "test", ch: null, id: Math.random().toString(36).slice(2, 8), peer: null, role: null,
    ok: function(){ return typeof BroadcastChannel === "function" && /[?&]net=test\b/.test(global.location.search); },
    _open: function(){ var self = this; if (this.ch) return; this.ch = new BroadcastChannel("pg-net-test");
      this.ch.onmessage = function(e){ var m = e.data || {}; if (m.to && m.to !== self.id) return;
        if (m.k === "adv" && self.role === "scan") PGNet._native("device", JSON.stringify({ name: "Pestaña " + m.from, address: m.from }));
        else if (m.k === "scanq" && self.role === "host") self.ch.postMessage({ k: "adv", from: self.id });
        else if (m.k === "conn" && self.role === "host" && !self.peer){ self.peer = m.from; self.ch.postMessage({ k: "acc", from: self.id, to: m.from }); PGNet._native("connected", JSON.stringify({ name: "Pestaña " + m.from, host: true })); }
        else if (m.k === "acc" && self.role === "join"){ self.peer = m.from; PGNet._native("connected", JSON.stringify({ name: "Pestaña " + m.from, host: false })); }
        else if (m.k === "line" && m.from === self.peer) PGNet._native("line", m.line);
        else if (m.k === "close" && m.from === self.peer){ self.peer = null; PGNet._native("closed", "{}"); } }; },
    host: function(){ this._open(); this.role = "host"; this.peer = null; PGNet._native("hosting", JSON.stringify({ name: "Pestaña " + this.id })); },
    scan: function(){ this._open(); this.role = "scan"; this.ch.postMessage({ k: "scanq", from: this.id }); var self = this; setTimeout(function(){ if (self.role === "scan") PGNet._native("scanDone", "{}"); }, 800); },
    connect: function(addr){ this._open(); this.role = "join"; this.ch.postMessage({ k: "conn", from: this.id, to: addr }); },
    send: function(line){ if (this.ch && this.peer) this.ch.postMessage({ k: "line", from: this.id, to: this.peer, line: line }); },
    close: function(){ if (this.ch && this.peer) this.ch.postMessage({ k: "close", from: this.id, to: this.peer }); this.peer = null; this.role = null; PGNet._native("closed", "{}"); }
  };
  function transport(){ return T || (T = BT.ok() ? BT : TEST.ok() ? TEST : null); }

  // ---------------------------------------------------------------- entrada empaquetada (un entero por cuadro)
  var BITS = ["down", "block", "up", "upPress", "punchPress", "kickPress", "specialPress", "superPress"];
  function pack(i){ var v = (i.x > 0 ? 1 : i.x < 0 ? 2 : 0); for (var k = 0; k < BITS.length; k++) if (i[BITS[k]]) v |= 1 << (k + 2); return v; }
  function unpack(v){ var o = { x: (v & 3) === 1 ? 1 : (v & 3) === 2 ? -1 : 0 }; for (var k = 0; k < BITS.length; k++) o[BITS[k]] = !!(v & (1 << (k + 2))); return o; }
  // huella del estado (lo que decide la pelea): vida, posición, estado, golpe, barra, mareo, fase, ronda, reloj
  function hash(m){
    var h = 2166136261 >>> 0;
    function mix(s){ s = String(s); for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } }
    m.fighters.forEach(function(f){ mix([f.hp, Math.round(f.x * 100), Math.round(f.y * 100), f.state, f.move || "", f.meter, f.stun | 0, f.hitstun | 0].join(":")); });
    mix([m.phase, m.round, m.wins.join(","), m.timer, m.frame].join("|"));
    return h;
  }

  // ---------------------------------------------------------------- sesión
  var S = { state: "idle", host: false, peerName: "", local: null, remote: null };
  function setState(st, extra){ S.state = st; emit("state", Object.assign({ state: st }, extra || {})); }
  function sendObj(o){ var t = transport(); if (t && S.state === "connected") t.send(JSON.stringify(o)); }

  var L = null;   // lockstep en curso
  var PGNet = {
    DELAY: DELAY,
    available: function(){ return !!transport(); },
    kind: function(){ var t = transport(); return t ? t.name : null; },
    session: S,
    on: function(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); return function(){ listeners[ev] = (listeners[ev] || []).filter(function(f){ return f !== fn; }); }; },
    off: function(ev){ delete listeners[ev]; },
    host: function(){ var t = transport(); if (!t) return; S.host = true; setState("starting"); t.host(); },   // (desde "closed" se puede volver a abrir sala)
    scan: function(){ var t = transport(); if (!t) return; S.host = false; setState("scanning"); t.scan(); },
    connect: function(addr){ var t = transport(); if (!t) return; S.host = false; setState("connecting"); t.connect(addr); },
    close: function(){ var t = transport(); if (S.state === "connected") sendObj({ t: "bye" }); if (t) t.close(); L = null; setState("idle"); },
    send: sendObj,

    // ---- llamado por el código nativo (o por el transporte de prueba) ----
    _native: function(type, data){
      var d = {}; try { d = data ? (typeof data === "string" ? JSON.parse(data) : data) : {}; } catch (e) { d = { raw: data }; }
      if (type === "line"){ var m; try { m = JSON.parse(typeof data === "string" ? data : JSON.stringify(data)); } catch (e) { return; } onLine(m); return; }
      if (type === "hosting") setState("hosting", d);
      else if (type === "device") emit("device", d);
      else if (type === "scanDone") emit("scanDone", d);
      else if (type === "connected"){ S.peerName = d.name || "rival"; S.host = !!d.host; setState("connected", d); sendObj({ t: "hello", v: VERSION }); }
      else if (type === "closed"){ if (S.state !== "idle" && S.state !== "closed"){ L = null; setState("closed", d); } }   // un solo aviso (el "bye" llega antes que el cierre del socket)
      else if (type === "error"){ setState("error", d); }
      else if (type === "permission") emit("permission", d);
    },

    // ---- lockstep (lo usa pg_game.js) ----
    // side = 0 si este teléfono es 1P (anfitrión), 1 si es 2P
    begin: function(side){ L = { side: side, f: 0, local: {}, remote: {}, hashes: {}, desync: -1, stalls: 0, maxStall: 0, waitT: 0 };
      for (var k = 0; k < DELAY; k++){ L.local[k] = 0; L.remote[k] = 0; } },
    end: function(){ L = null; },
    active: function(){ return !!L; },
    stats: function(){ return L ? { frame: L.f, stalls: L.stalls, desync: L.desync } : null; },
    // intenta avanzar UN cuadro: sample() da la entrada local (snapshot) y step(i0, i1) simula. Devuelve false si espera al rival.
    tick: function(sample, step, match){
      if (!L) return false;
      var target = L.f + DELAY;
      if (L.local[target] == null){ var v = pack(sample()); L.local[target] = v; sendObj({ t: "i", f: target, v: v }); }
      if (L.remote[L.f] == null){ L.stalls++; return false; }
      var me = unpack(L.local[L.f]), them = unpack(L.remote[L.f]);
      step(L.side === 0 ? me : them, L.side === 0 ? them : me);
      delete L.local[L.f]; delete L.remote[L.f];
      L.f++;
      if (match && L.f % HASH_EVERY === 0){ var h = hash(match); L.hashes[L.f] = h; sendObj({ t: "h", f: L.f, h: h }); checkHash(L.f); }
      return true;
    },
    _hash: hash, _pack: pack, _unpack: unpack
  };
  function checkHash(f){ if (!L || L.desync >= 0) return; var a = L.hashes[f], b = L.hashes["r" + f];
    if (a == null || b == null) return; if (a !== b){ L.desync = f; emit("desync", { frame: f }); console.warn("PGNet: desincronización en el cuadro " + f); }
    delete L.hashes[f]; delete L.hashes["r" + f]; }
  function onLine(m){
    if (!m || !m.t) return;
    if (m.t === "i"){ if (L) L.remote[m.f] = m.v; return; }
    if (m.t === "h"){ if (L){ L.hashes["r" + m.f] = m.h; checkHash(m.f); } return; }
    if (m.t === "hello"){ if (m.v !== VERSION) emit("version", { mine: VERSION, theirs: m.v }); return; }
    if (m.t === "bye"){ if (S.state === "closed") return; L = null; setState("closed", { bye: true }); return; }
    emit("msg", m);
  }
  global.PGNet = PGNet;
})(window);
