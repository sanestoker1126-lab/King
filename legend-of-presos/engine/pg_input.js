/* PGInput — teclado + botones táctiles, con detección de flanco (press) y
   buffer de direcciones (para parser de movimientos en fase posterior). */
(function (global) {
  "use strict";
  const DEFAULT_KEYS = {
    left:["a","arrowleft"], right:["d","arrowright"], up:["w","arrowup"], down:["s","arrowdown"],
    block:["shift"," "], punch:["j"], kick:["k"], special:["l"], super:[";"]
  };
  // Mapas separados para 2 jugadores locales (sin colisión de teclas).
  const P1_KEYS = {
    left:["a"], right:["d"], up:["w"], down:["s"],
    block:["shift"], punch:["j"], kick:["k"], special:["l"], super:["u"]
  };
  const P2_KEYS = {
    left:["arrowleft"], right:["arrowright"], up:["arrowup"], down:["arrowdown"],
    block:["/"], punch:["1"], kick:["2"], special:["3"], super:["0"]
  };
  class Controller {
    constructor(keys){
      this.keys = keys || DEFAULT_KEYS;
      this.held = {}; this._pressed = {};
      this.dirBuffer = []; // {dir:'f'|'b'|'u'|'d'|'n', frame} para QCF/DP (fase 3)
      this._map = {};
      for (const [act, arr] of Object.entries(this.keys)) for (const k of arr) this._map[k]=act;
    }
    attachKeyboard(target){
      target = target || window;
      this._kbTarget = target;
      this._onDown = e=>{
        const act=this._map[e.key.toLowerCase()]; if(!act) return;
        if(!this.held[act]) this._pressed[act]=true;
        this.held[act]=true; e.preventDefault();
      };
      this._onUp = e=>{
        const act=this._map[e.key.toLowerCase()]; if(!act) return;
        this.held[act]=false; e.preventDefault();
      };
      target.addEventListener("keydown", this._onDown);
      target.addEventListener("keyup", this._onUp);
    }
    // quita los listeners de teclado (evita fugas al recrear el combate)
    detach(){
      if(this._kbTarget && this._onDown){
        this._kbTarget.removeEventListener("keydown", this._onDown);
        this._kbTarget.removeEventListener("keyup", this._onUp);
      }
      this._onDown=this._onUp=this._kbTarget=null; this.held={}; this._pressed={};
    }
    // botones táctiles: elementos con data-act
    attachTouch(root){
      root.querySelectorAll("[data-act]").forEach(el=>{
        const act=el.dataset.act;
        const dn=ev=>{ ev.preventDefault(); if(!this.held[act]) this._pressed[act]=true; this.held[act]=true; el.classList.add("on"); };
        const up=ev=>{ ev.preventDefault(); this.held[act]=false; el.classList.remove("on"); };
        el.addEventListener("touchstart",dn,{passive:false}); el.addEventListener("touchend",up,{passive:false});
        el.addEventListener("mousedown",dn); el.addEventListener("mouseup",up); el.addEventListener("mouseleave",up);
      });
    }
    snapshot(){
      const h=this.held, p=this._pressed;
      const snap={
        x:(h.left?-1:0)+(h.right?1:0),
        down:!!h.down, block:!!h.block, up:!!h.up,     // up = ARRIBA mantenido (salto corto si se suelta en el pre-salto)
        upPress:!!p.up, punchPress:!!p.punch, kickPress:!!p.kick,
        specialPress:!!p.special, superPress:!!p.super
      };
      this._pressed={};
      return snap;
    }
  }
  global.PGInput = { Controller, DEFAULT_KEYS, P1_KEYS, P2_KEYS };
})(window);
