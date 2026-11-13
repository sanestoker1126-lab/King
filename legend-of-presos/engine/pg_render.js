/* PGRender — dibuja un MatchState con PixiJS. NO modifica el estado (spec 4.1).
   Mapea el espacio lógico del combate (PGSim.ARENA) a la pantalla y escala. */
(function (global) {
  "use strict";
  const A = () => PGSim.ARENA;
  function _mix(a,b,k){ k=Math.max(0,Math.min(1,k));
    const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255, br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
    const r=Math.round(ar+(br-ar)*k), g=Math.round(ag+(bg-ag)*k), bl=Math.round(ab+(bb-ab)*k);
    return (r<<16)|(g<<8)|bl; }
  // textos fijos del HUD (tablas, no cadenas armadas por frame)
  const NOTICE_TXT = { counter:"Contragolpe", crush:"Guardia rota", tech:"Recuperación", escape:"Escape", gc:"Cancelación de guardia", dizzy:"Mareado" };
  const BANNER_END = { ko:0, time:1, double:2, draw:3 }, BANNER_CAUSE = ["K.O.", "Tiempo", "Doble K.O.", "Tiempo"];

  const ATTACKING = Object.freeze({ ATTACK:1, AIR_ATTACK:1, SPECIAL:1, SUPER:1, THROW:1, MAXACT:1 });
  class PGRender {
    constructor(app, loadedChars, opts){
      opts = opts || {};
      this.app = app; this.chars = loadedChars; // [p0, p1] objetos de loadGridCharacter
      this.debug = false;
      // Normalización de escala: cada atlas tiene tamaño de celda distinto (120, 213, ...).
      // Escalamos cada luchador para que su ALTO en pantalla sea consistente (lectura justa).
      this._targetH = opts.targetFrameH || 180;
      this.rscale = this.chars.map(ch=>this._scaleOf(ch));
      // EQUIPOS: [[{id,name,ch}×3],[…]] (marcadores del HUD); null = pelea por rondas
      this.team = opts.teams || null;
      // escenario (engine/pg_stage.js, datos de data/stages.json): arte + luces + lluvia + relámpagos + piso mojado
      this.stage = new PGStage(opts.stageDef || null, opts.stageTex || null);
      // Opciones › Pantalla › "Sacudida y destellos": 1 normal · 0.45 suave · 0 apagado (solo dibujo; la simulación no cambia)
      this.fxK = (opts.fxK != null) ? opts.fxK : 1; this.stage.flashK = this.fxK;
      this.fxLib = opts.fx || null;          // PGLoader.loadFxLibrary(): anims de sprite (null => solo procedural)
      this.root = new PIXI.Container();
      this.world = new PIXI.Container();
      // reflejo de los luchadores en el piso mojado (solo si el escenario lo declara)
      this.reflLayer = new PIXI.Container();
      this.refl = [ new PIXI.Sprite(), new PIXI.Sprite() ];
      for (const r of this.refl){ r.visible=false; this.reflLayer.addChild(r); }
      this.fxLayer = new PIXI.Container();
      this.fxBack = new PIXI.Container();    // FX detrás de los luchadores (auras de suelo, ondas)
      this.auraLayer = new PIXI.Container();
      this.dbg = new PIXI.Graphics();
      this.sprites = [ new PIXI.Sprite(), new PIXI.Sprite() ];
      for (const s of this.sprites){ s.anchor.set(0.5,1.0); }
      // ORDEN DE DIBUJO (legibilidad, KOF): el que ataca va DELANTE. Estado de VISTA, no de simulación: J2 delante al empezar
      this._front = 1; this._wasAtk = [false, false];
      this.world.addChild(this.stage.back, this.reflLayer, this.auraLayer, this.fxBack, this.sprites[0], this.sprites[1], this.fxLayer, this.stage.front, this.dbg);
      // luces/oscurecimiento/flash (espacio de pantalla): 2 sprites blancos teñidos; solo cambian alfa y tamaño
      this.overlay = new PIXI.Container();
      this.ovDim = new PIXI.Sprite(PIXI.Texture.WHITE); this.ovDim.tint = 0x000000;
      this.ovFlash = new PIXI.Sprite(PIXI.Texture.WHITE);
      this.ovDim.visible = this.ovFlash.visible = false; this.overlay.addChild(this.ovDim, this.ovFlash);
      this.hud = new PIXI.Container();
      this.names = opts.names || ["P1","P2"]; this.cpu = !!opts.cpu;
      // letreros de resultado: en un espejo (mismo luchador) "Gana Tobi" no dice quién ganó -> se marca el lado
      this._bannerNames();
      this.touchHud = !!opts.touch;   // controles táctiles visibles: barras de poder ARRIBA (fuera de la zona de pulgares) y texto mayor
      this._buildHud();
      this.root.addChild(this.world, this.overlay, this.hud);
      app.stage.addChild(this.root);
      this._onResize=()=>this._layout(); this._layout(); window.addEventListener("resize",this._onResize);
      this._fpsT=performance.now(); this._fps=60; this._frames=0;
    }
    _lastUp(T){ for(let k=T.cur+1;k<T.status.length;k++) if(T.status[k]!=="out") return false; return true; }
    _scaleOf(ch){
      if (ch.def && ch.def.renderScale) return ch.def.renderScale;      // override manual de arte
      const fh = (ch.frameSize && ch.frameSize.h) || (ch.def && ch.def.frameSize && ch.def.frameSize.h) || 120;
      return this._targetH / fh;
    }
    // letreros de resultado: en un espejo (mismo luchador) "Gana Tobi" no dice quién ganó -> se marca el lado
    _bannerNames(){ const n=this.names; this.bannerNames = n[0]===n[1] ? [n[0]+" (J1)", n[1]+(this.cpu?" (CPU)":" (J2)")] : [n[0], n[1]]; }
    // EQUIPOS: entra otro integrante en el lado i (lo llama el orquestador al cambiar teams[i].cur). Solo dibujo.
    setFighter(i, ch, name){
      this.chars[i]=ch; this.rscale[i]=this._scaleOf(ch); this.names[i]=name; this._bannerNames(); this._bk=-1;
      const T=this.txt; if(i===0) T.n0.text=name; else T.n1.text=name+(this.cpu?"  ·  CPU":"");
      this._setPortrait(i, ch.portrait);
    }
    _setPortrait(i, tex){
      const L=this.L, {W}=A(); let sp=this.hudPor[i];
      if(!tex){ if(sp) sp.visible=false; return; }
      if(!sp){ sp=new PIXI.Sprite(tex); this.hud.addChildAt(sp, this.hud.getChildIndex(this.hudStatic)+1); this.hudPor[i]=sp; }
      sp.texture=tex; sp.visible=true; sp.scale.set(1); sp.width=L.pw; sp.height=L.pw; sp.x = i===0 ? 16 : W-16; sp.y=12;
      if(i===1) sp.scale.x=-Math.abs(sp.scale.x);
    }
    destroy(){
      // sin try/catch mudo (§9): se quita el listener (antes quedaba vivo y llamaba _layout sobre objetos destruidos)
      window.removeEventListener("resize",this._onResize);
      if(this.root.parent) this.root.parent.removeChild(this.root);
      this.root.destroy({children:true});   // texturas de atlas NO se destruyen (las comparte la caché de precarga)
    }
    _layout(){
      const {W,H}=A(); const vw=this.app.renderer.width, vh=this.app.renderer.height;
      const s=Math.min(vw/W, vh/H); this._scale=s;
      this.world.scale.set(s); this.world.x=(vw-W*s)/2; this.world.y=(vh-H*s)/2;
      this.hud.scale.set(s); this.hud.x=this.world.x; this.hud.y=this.world.y;
    }
    _spriteFor(i, f){
      const ch=this.chars[i]; let clip=ch.clips[f.clip]?f.clip:"idle";
      if(f.transformed && ch.clips[clip+"_vestia"]) clip=clip+"_vestia";   // Modo Vestía persistente: moveset morado
      const def=ch.def.clips[clip]||ch.def.clips.idle;
      const idx=PGSim.clipFrameIndex(def, f.clipTime);
      const tex=(ch.clips[clip]||ch.clips.idle)[idx];
      const spr=this.sprites[i];
      if(tex){ spr.texture=tex; const an=tex.pgAnchor||ch.anchor; if(an) spr.anchor.set(an.x,an.y); } // pie en el suelo (baseline)
      spr.x=f.x; spr.y=f.y;
      // VIBRACIÓN DEL GOLPEADO durante la pausa de impacto (hitstop): el que recibe tiembla en su sitio, el que pega queda
      // congelado en la pose de impacto. Solo dibujo (la x de la simulación no cambia) y determinista (paridad del hitstop).
      const HS=this._hs, HK=this._hitShake;
      if(HS>0 && HK){ const st=f.state;
        const amp = (st==="HITSTUN"||st==="LAUNCHED"||st==="KO"||st==="GUARD_CRUSH") ? (HK.px||0) : st==="BLOCKSTUN" ? (HK.blockPx||0) : 0;
        if(amp) spr.x += ((HS&1)?amp:-amp)*this.fxK*Math.min(1, HS/(HK.fade||4)); }
      const rs=(this.rscale[i]||1)*(f.transformed?1.15:1);   // Modo Vestía: ~1.15x más imponente (la hurtbox también crece en pg_sim)
      spr.scale.x=(f.facing>=0?rs:-rs); spr.scale.y=rs;
      // tinte: MAX dorado · golpe = parpadeo rojo · guardia rota = parpadeo blanco-azulado (se distingue del golpe)
      spr.tint = f.maxMode ? 0xffe0a0 : (f.state==="HITSTUN" && (f.stateFrame%4<2)) ? 0xff8888 : (f.state==="GUARD_CRUSH" && (f.stateFrame%6<3)) ? 0xa8d8ff : 0xffffff;
    }
    render(match){
      const {W,H,GROUND}=A();
      const vw=this.app.renderer.width, vh=this.app.renderer.height;
      // CÁMARA (zoom/pan del cinemático) + shake. Zoom=1 reproduce el encuadre normal.
      const cam=match.camera||{x:W/2,y:H/2,zoom:1,dim:0,flash:0};
      const eff=this._scale*(cam.zoom||1), sh=(match.shake||0)*this.fxK;
      this.world.scale.set(eff);
      // sacudida DETERMINISTA (función del frame, sin Math.random): misma partida => misma imagen
      const fr=(match.frame||0)+(match.hitstop||0)*7;
      const jx=Math.sin(fr*12.9898)*43758.5453, jy=Math.sin(fr*78.233)*43758.5453;
      this.world.x = vw/2 - cam.x*eff + ((jx-Math.floor(jx))-.5)*sh*this._scale;
      this.world.y = vh/2 - cam.y*eff + ((jy-Math.floor(jy))-.5)*sh*this._scale;
      this._hs = match.hitstop||0; this._hitShake = (match.cfg && match.cfg.render && match.cfg.render.hitShake) || null;
      for(let i=0;i<2;i++) this._spriteFor(i, match.fighters[i]);
      // el último que EMPEZÓ un ataque (normal, aéreo, especial, súper, agarre, MAX) queda delante hasta que el otro empiece
      // uno: así el golpe nunca queda tapado por el cuerpo del que lo recibe (antes J2 iba siempre encima de J1)
      for(let i=0;i<2;i++){ const st=match.fighters[i].state, a=ATTACKING[st]===1;
        if(a && !this._wasAtk[i]) this._front=i; this._wasAtk[i]=a; }
      if((this.world.getChildIndex(this.sprites[1])>this.world.getChildIndex(this.sprites[0])) !== (this._front===1))
        this.world.swapChildren(this.sprites[0], this.sprites[1]);
      // MAREADO: vaivén lento desde los pies (el ancla está en el piso) — legible aunque el personaje no tenga clip de mareo
      const tk=match.tick||0;
      for(let i=0;i<2;i++){ const f=match.fighters[i]; this.sprites[i].rotation = f.state==="DIZZY" ? Math.sin(tk*0.11+i*1.7)*0.05 : 0; }
      this.stage.update(match.tick||0, cam);     // tick (no frame): la lluvia, público y luces siguen vivas en presentación, K.O. y congelamientos
      // reflejo en el piso mojado: el mismo cuadro del luchador, volteado bajo sus pies y más tenue cuanto más alto esté
      const wa=this.stage.wetAlpha;
      for(let i=0;i<2;i++){ const r=this.refl[i];
        if(!wa){ r.visible=false; continue; }
        const sp=this.sprites[i], f=match.fighters[i], lift=Math.max(0,GROUND-f.y), k=Math.max(0,1-lift/170);
        r.visible = k>0.02; if(!r.visible) continue;
        r.texture=sp.texture; r.anchor.set(sp.anchor.x, sp.anchor.y); r.x=sp.x; r.y=GROUND+lift;
        r.scale.x=sp.scale.x; r.scale.y=-sp.scale.y*0.92; r.rotation=-sp.rotation; r.tint=sp.tint; r.alpha=wa*k; }
      // --- POOL de Graphics (sin crear basura por frame; DoD §8). Init perezoso. ---
      if(!this._pool){
        // geometría dibujada UNA vez en el origen; por frame solo se mueven/escalan/aclaran (antes: clear()+ellipse()
        // cada frame = re-triangular = ~2-4 KB de basura por frame dentro de PIXI)
        const mk=(rx,ry,col)=>{ const g=new PIXI.Graphics(); g.ellipse(0,0,rx,ry).fill({color:col}); this.auraLayer.addChild(g); return g; };
        this._pool={ shadow:[mk(34,10.2,0x000000),mk(34,10.2,0x000000)], aura:[mk(42,74,0xffcf4d),mk(42,74,0xffcf4d)], fx:[], proj:[] };
        // estrellas del mareo: 3 por luchador, dibujadas una vez; por frame solo se mueven
        const star=()=>{ const g=new PIXI.Graphics(); g.star(0,0,5,6.5,2.8).fill({color:0xffe27a}).stroke({color:0x2a1d05,width:1.2}); g.visible=false; this.fxLayer.addChild(g); return g; };
        this._pool.stars=[[star(),star(),star()],[star(),star(),star()]];
      }
      const P=this._pool;
      // sombras al suelo: se encogen y aclaran con la altura del salto
      for(let i=0;i<2;i++){ const f=match.fighters[i]; const g=P.shadow[i];
        const airLift=Math.max(0,(GROUND-f.y));
        const sw=34-Math.min(16,airLift*0.03), sa=0.42-Math.min(0.3,airLift*0.0007);
        g.x=f.x; g.y=GROUND-4; g.scale.set(Math.max(10,sw)/34, Math.max(4,sw*0.3)/10.2); g.alpha=Math.max(0.08,sa);
      }
      // estrellas girando sobre la cabeza del MAREADO (adelante opacas, atrás tenues: se lee la vuelta)
      { const top=(match.cfg&&match.cfg.hurtbox&&match.cfg.hurtbox.h)||140;
        for(let i=0;i<2;i++){ const f=match.fighters[i], on=f.state==="DIZZY", st=P.stars[i];
          for(let k=0;k<3;k++){ const g=st[k]; g.visible=on; if(!on) continue;
            const a=tk*0.13+k*2.0944; g.x=f.x+Math.cos(a)*24; g.y=f.y-top-12+Math.sin(a)*6; g.alpha=Math.sin(a)>0?1:0.5; g.rotation=a*0.5; } } }
      // aura de MAX: pulso por alfa
      for(let i=0;i<2;i++){ const f=match.fighters[i]; const g=P.aura[i];
        g.visible=!!f.maxMode; if(g.visible){ g.x=f.x; g.y=f.y-54; g.alpha=0.30+0.14*Math.sin((match.frame||0)*0.2); } }
      // ---- FX: sprites de la librería (pool) o procedural (pool de Graphics) ----
      const fxs=match.fx||[]; let ns=0, nb=0, ng=0;
      for(let k=0;k<fxs.length;k++){ const fx=fxs[k];
        const A=this._fxAnim(fx);
        if(A){ const back=!!fx.back; const spr=this._poolSprite(back?'fxb':'fx', back?nb++:ns++, back?this.fxBack:this.fxLayer);
          this._placeFx(spr, A, fx, match); }
        else { const g=this._poolGraphics('fx', ng++, this.fxLayer); this._drawProcFx(g, fx, match); }
      }
      this._hideFrom('fx', ns); this._hideFrom('fxb', nb); this._hideFrom('g_fx', ng);
      // ---- PROYECTILES ----
      const prs=match.projectiles||[]; let np=0, npg=0;
      for(let k=0;k<prs.length;k++){ const p=prs[k];
        const A=p.anim && this.fxLib && this.fxLib.anims[p.anim];
        if(A){ const spr=this._poolSprite('proj', np++, this.fxLayer);
          const age=(p.life0||p.life)-p.life, n=A.tex.length, idx=Math.floor(age*A.fps/60)%n;
          const sc=A.scales[idx]*(p.h0?p.h0/A.h:1), an=A.anchors[idx];
          spr.texture=A.tex[idx]; spr.anchor.set(an[0],an[1]); spr.x=p.x; spr.y=p.ground?GROUND:p.y;   // ondas de suelo: pie en el piso
          spr.scale.set(p.vx<0?-sc:sc, sc); spr.alpha=1; spr.visible=true; }
        else { const g=this._poolGraphics('proj', npg++, this.fxLayer); g.clear(); g.visible=true;
          const col=p.kind==="heavy"?0xffa030:p.kind==="energy"?0x66ddff:0xffffff;
          g.ellipse(p.x,p.y,p.w*0.9,p.h*0.7).fill({color:col,alpha:0.85});
          g.ellipse(p.x-Math.sign(p.vx)*p.w*0.6,p.y,p.w*0.5,p.h*0.4).fill({color:0xffffff,alpha:0.5}); }
      }
      this._hideFrom('proj', np); this._hideFrom('g_proj', npg);
      // debug
      this.dbg.clear();
      if(this.debug){
        for(let i=0;i<2;i++){
          const f=match.fighters[i];
          const hb=PGSim.hurtboxOf(f);
          this.dbg.rect(hb.x,hb.y,hb.w,hb.h).stroke({color:0x33ff66,width:1.5,alpha:.9});
          const hit=PGSim.hitboxActive(f, this.chars[i].def);
          if(hit) this.dbg.rect(hit.x,hit.y,hit.w,hit.h).fill({color:0xff0000,alpha:.28}).stroke({color:0xff2222,width:2});
          this.dbg.circle(f.x,f.y,3).fill(0x00ffff);
        }
        for(const p of (match.projectiles||[])) this.dbg.rect(p.x-p.w/2,p.y-p.h/2,p.w,p.h).stroke({color:0xffee33,width:2});
      }
      // LUCES / cinemática: oscurecimiento del escenario + flash (pantalla completa, bajo el HUD)
      const dim=Math.max(cam.dim||0, this._roundFade(match)), fl=(cam.flash||0)*this.fxK, oD=this.ovDim, oF=this.ovFlash;
      oD.visible = dim>0; if(oD.visible){ oD.width=vw; oD.height=vh; oD.alpha=dim; }
      oF.visible = fl>0;  if(oF.visible){ oF.width=vw; oF.height=vh; oF.alpha=Math.min(1,fl); }
      this._updateHud(match);
    }
    // marcadores de equipo: se redibujan solo cuando cambia algún estado (clave numérica en base 3, sin basura por cuadro)
    _teamHud(match){
      let key=0, mul=1;
      for(let s=0;s<2;s++){ const st=match.teams[s].status; for(let k=0;k<st.length;k++){ key += mul*(st[k]==="active"?1:st[k]==="out"?2:0); mul*=3; } }
      if(key===this._teamKey) return; this._teamKey=key;
      for(let s=0;s<2;s++){ const st=match.teams[s].status, col=s===0?0xf0a83a:0x6fd3b8;
        for(let k=0;k<this.teamMk[s].length;k++){ const M=this.teamMk[s][k], g=M.g, a=st[k]==="active", o=st[k]==="out";
          M.sp.alpha = o ? 0.22 : a ? 1 : 0.7; g.clear();
          g.rect(M.x-1,M.y-1,M.S+2,M.S+2).stroke({color: a?col:0x425469, width: a?2:1});
          if(o){ g.moveTo(M.x+2,M.y+2).lineTo(M.x+M.S-2,M.y+M.S-2).moveTo(M.x+M.S-2,M.y+2).lineTo(M.x+2,M.y+M.S-2).stroke({color:0xe04a3c,width:2}); } } }
    }
    // fundido entre rondas (0..1): a negro al final de la secuencia de K.O. y de regreso al empezar la ronda siguiente.
    // Solo lee el estado. No hay fundido al terminar la pelea (ahí siguen los resultados).
    _roundFade(match){
      const C=match.cfg||{}, n=(C.render&&C.render.roundFade)||0; if(!n) return 0;
      if(match.phase==="ko" && !match.over && match.hitstop<=0 && match.phaseT<n) return 1-match.phaseT/n;
      if(match.phase==="intro" && match.round>1){ const T=(C.timing&&C.timing.roundIntro)||75, t=T-match.phaseT; if(t<n) return 1-t/n; }
      return 0;
    }
    // ---------- pools (crecen bajo demanda; el sobrante se oculta: cero basura por frame) ----------
    _poolSprite(key, i, layer){ const P=this._sp||(this._sp={}); const arr=P[key]||(P[key]=[]);
      let s=arr[i]; if(!s){ s=new PIXI.Sprite(); arr[i]=s; layer.addChild(s); } s.visible=true; return s; }
    _poolGraphics(key, i, layer){ const P=this._sp||(this._sp={}); const arr=P['g_'+key]||(P['g_'+key]=[]);
      let g=arr[i]; if(!g){ g=new PIXI.Graphics(); arr[i]=g; layer.addChild(g); } g.visible=true; return g; }
    _hideFrom(key, n){ const arr=this._sp&&this._sp[key]; if(!arr) return; for(let k=n;k<arr.length;k++) arr[k].visible=false; }
    // anim de un FX: la declarada (fx.anim) o la del hitspark por TIPO (fx_library.hitsparks[kind])
    _fxAnim(fx){ const L=this.fxLib; if(!L) return null;
      if(fx.anim && L.anims[fx.anim]) return L.anims[fx.anim];
      if(fx.t==='hit'){ const hs=L.hitsparks[fx.kind]; if(hs && hs.anim && L.anims[hs.anim]) return L.anims[hs.anim]; }
      return null; }
    _placeFx(spr, A, fx, match){
      const n=A.tex.length, life0=fx.life0||fx.life, age=life0-fx.life;
      const idx = A.loop ? Math.floor(age*A.fps/60)%n : Math.min(n-1, Math.floor((age/Math.max(1,life0))*n));
      let x=fx.x, y=fx.y, face=fx.facing||1;
      if(fx.owner>=0){ const F=match.fighters[fx.owner]; face=F.facing; x=F.x+face*(fx.ox||0); y=F.y+(fx.oy||0); }
      // alto objetivo: el del FX (h), el del hitspark por tipo, o el de la anim
      let H=A.h; if(fx.h) H=fx.h; else if(fx.t==='hit' && !fx.anim){ const hs=this.fxLib.hitsparks[fx.kind]; if(hs&&hs.h) H=hs.h; }
      const sc=A.scales[idx]*(H/A.h)*(fx.scale||1), an=A.anchors[idx];
      spr.texture=A.tex[idx]; spr.anchor.set(an[0],an[1]); spr.x=x; spr.y=y;
      spr.scale.set(face<0?-sc:sc, sc);
      const tail=life0*0.3; spr.alpha = (!A.loop && fx.life<tail) ? Math.max(0,fx.life/tail) : 1;
    }
    // FX procedurales: guardia (escudo, distinto del impacto), choque de proyectiles, MAX, disipación
    _drawProcFx(g, fx, match){
      g.clear(); const life0=fx.life0||12, k=Math.max(0,fx.life/life0), x=fx.x, y=fx.y, d=fx.facing||1;
      if(fx.kind==='hidden_particle'){
        // Partículas deterministas: misma semilla + mismo frame = misma silueta, sin Math.random.
        let px=fx.x, py=fx.y, face=fx.facing||1;
        if(fx.owner>=0){ const F=match.fighters[fx.owner]; face=F.facing; px=F.x+face*(fx.ox||0); py=F.y+(fx.oy||0); }
        const age=life0-fx.life, t=Math.max(0,Math.min(1,age/life0)), n=fx.count||8, pal=fx.palette||[0xffffff];
        const hash=(i)=>{ const z=Math.sin((fx.seed||1)*12.9898+i*78.233)*43758.5453; return z-Math.floor(z); };
        const style=fx.style||'burst', base=fx.angle||0, spread=fx.spread||0.9, orbit=fx.orbit||0;
        for(let i=0;i<n;i++){
          const q=hash(i), q2=hash(i+31), a=base+(i/n-0.5)*spread+Math.sin(age*0.12+i)*0.08+orbit*t;
          const travel=fx.radius*(0.18+0.82*t)+age*fx.speed*(0.55+q*0.7);
          let xx=px+face*Math.cos(a)*travel, yy=py+Math.sin(a)*travel+fx.gravity*age*age;
          const sz=Math.max(0.6,fx.size*(0.55+q2*0.85)*(0.7+0.3*k)), col=pal[i%pal.length];
          const alpha=Math.max(0,k*(0.42+q*0.58));
          if(style==='mist'){
            g.circle(xx,yy,sz*(1.8+0.8*q)).fill({color:col,alpha:alpha*0.22});
            g.circle(xx,yy,sz).fill({color:col,alpha:alpha*0.55});
          } else if(style==='glitch'){
            g.rect(xx-sz,yy-sz*0.45,sz*2.4,sz*0.9).fill({color:col,alpha});
          } else if(style==='chain_arc'||style==='clock_ring'||style==='violet_orbit'){
            g.circle(xx,yy,sz).fill({color:col,alpha});
            if(i%3===0) g.arc(px,py,travel, a-0.18, a+0.18).stroke({color:col,width:Math.max(1,sz*0.55),alpha:alpha*0.65});
          } else if(style==='blade'||style==='slash'||style==='electric'||style==='zigzag'){
            const tail=sz*(2.2+q*2.2), tx=xx-face*Math.cos(a)*tail, ty=yy-Math.sin(a)*tail;
            g.moveTo(tx,ty).lineTo(xx,yy).stroke({color:col,width:Math.max(1,sz*0.75),alpha});
            g.circle(xx,yy,sz*0.55).fill({color:0xffffff,alpha:Math.min(1,alpha+0.2)});
          } else {
            g.circle(xx,yy,sz*(1.7+fx.glow)).fill({color:col,alpha:alpha*0.22});
            g.circle(xx,yy,sz).fill({color:col,alpha});
          }
        }
      } else if(fx.kind==='block'){
        const r=16+18*(1-k), a0=d>0?Math.PI*0.62:-Math.PI*0.38, a1=a0+Math.PI*0.76;   // arco que mira al atacante
        g.arc(x-d*4,y,r,a0,a1).stroke({color:0x9fdcff,width:5,alpha:0.9*k});
        g.arc(x-d*4,y,r*0.62,a0,a1).stroke({color:0xffffff,width:2,alpha:k}); }
      else if(fx.kind==='clash'){ g.star(x,y,8,26*(0.6+0.4*k),9).fill({color:0xfff2b0,alpha:k}); g.circle(x,y,30*(1-k)+6).stroke({color:0xffffff,width:3,alpha:k}); }
      else if(fx.kind==='max'){ g.circle(x,y,20+60*(1-k)).stroke({color:0xffcf4d,width:6,alpha:k}); }
      else if(fx.kind==='fizzle'){ g.circle(x,y,6+10*(1-k)).fill({color:0xffffff,alpha:0.5*k}); }
      else { const col=fx.kind==="energy"?0x66ddff:fx.kind==="heavy"||fx.kind==="super"?0xffa030:fx.kind==="launch"||fx.kind==="head"?0xff5050:0xffffff;
        g.star(x,y,6,14*k+4,6).fill({color:col,alpha:k}); }
    }
    // ===================================================== HUD (estética de la interfaz: concreto, sodio, fósforo)
    // Marco estático dibujado UNA vez; barras = sprites blancos teñidos (solo cambia ancho/tinte: cero basura).
    // stroke: contorno oscuro para los textos que van SOBRE el escenario (letreros, combos, avisos): con el fondo
    // fotográfico de Puente Grande el rojo del K.O. sobre el muro gris se perdía (pilar de legibilidad)
    _txt(size, color, family, weight, stroke){ const st={ fontFamily: family||'"Inter PG", system-ui, sans-serif', fontSize:size, fill:color, fontWeight:weight||"600" };
      if(stroke) st.stroke={ color:0x0a0c10, width:stroke, join:"round" };
      return new PIXI.Text({ text:"", style:st }); }
    _fill(t,c){ if(t._pgFill!==c){ t._pgFill=c; t.style.fill=c; } }   // solo toca el estilo si cambia (evita re-rasterizar el texto)
    _bar(color){ const sp=new PIXI.Sprite(PIXI.Texture.WHITE); sp.tint=color; this.hud.addChild(sp); return sp; }
    _buildHud(){
      const {W,H}=A(); const H_=this.hud, DISP='"Heros Cn","Arial Narrow",sans-serif';
      const C=this.touchHud;
      // geometría del HUD (unidades de arena 960x540). Táctil: poder bajo el nombre; escritorio: poder abajo (estilo KOF)
      const L=this.L={ pw:46, bx:70, by:16, bw:W/2-70-44, bh:18, mw:C?200:220, mh:C?8:9, nameY:38, my:C?62:H-24, fs:C?16:13, ms:C?13:11 };
      const st=new PIXI.Graphics(); H_.addChild(st); this.hudStatic=st;
      // marcos de retrato, barras de vida y de poder (fijos)
      for(let i=0;i<2;i++){
        const sx = i===0 ? 16 : W-16-L.pw;
        st.rect(sx-2,12-2,L.pw+4,L.pw+4).fill({color:0x0b1016,alpha:.85}).stroke({color:i===0?0xf0a83a:0x6fd3b8,width:2});
        const bx = i===0 ? L.bx : W-L.bx-L.bw;
        st.rect(bx-2,L.by-2,L.bw+4,L.bh+4).fill({color:0x0b1016,alpha:.85}).stroke({color:0x425469,width:1});
        const mx = i===0 ? (C?L.bx:16) : W-(C?L.bx:16)-L.mw; this.L['mx'+i]=mx;
        st.rect(mx-2,L.my-2,L.mw+4,L.mh+4).fill({color:0x0b1016,alpha:.8}).stroke({color:0x425469,width:1});
      }
      st.rect(W/2-30,10,60,40).fill({color:0x0b1016,alpha:.88}).stroke({color:0x425469,width:1});
      // retratos de filiación (rect precalculado en datos: char.json.portrait)
      this.hudPor=[null,null];
      for(let i=0;i<2;i++) this._setPortrait(i, this.chars[i].portrait);   // sin rect en datos: marco vacío
      // EQUIPOS: un retrato chico por integrante junto al extremo interior de la barra (el primero, el más cercano al reloj);
      // el que pelea con borde de color, los que esperan atenuados, los eliminados casi apagados y tachados
      this.teamMk=null; this._teamKey=-1;
      if(this.team){ const S=C?22:15, G=3; this.teamMk=[[],[]];   // táctil: más grandes (en un teléfono 15 quedaba en ~10 px)
        for(let s=0;s<2;s++) for(let k=0;k<this.team[s].length;k++){
          const x = s===0 ? (L.bx+L.bw-S-k*(S+G)) : (W-L.bx-L.bw+k*(S+G)), y=L.by+L.bh+5, por=this.team[s][k].ch.portrait;
          const sp=new PIXI.Sprite(por||PIXI.Texture.WHITE); sp.width=S; sp.height=S; sp.x=x; sp.y=y; if(!por) sp.tint=0x243140;
          if(s===1){ sp.scale.x=-Math.abs(sp.scale.x); sp.x=x+S; }
          const g=new PIXI.Graphics(); H_.addChild(sp); H_.addChild(g); this.teamMk[s].push({ sp, g, x, y, S }); } }
      // barras dinámicas
      this.hpRed=[this._bar(0xe04a3c),this._bar(0xe04a3c)]; this.hpFill=[this._bar(0xe8e3d6),this._bar(0xe8e3d6)];
      this.mFill=[this._bar(0xf0a83a),this._bar(0x6fd3b8)]; this.mMax=[this._bar(0xffc76b),this._bar(0xb8fff0)];
      for(let i=0;i<2;i++){ this.hpRed[i].height=this.hpFill[i].height=L.bh; this.hpRed[i].y=this.hpFill[i].y=L.by;
        this.mFill[i].height=L.mh; this.mFill[i].y=L.my; this.mMax[i].height=3; this.mMax[i].y = this.touchHud ? L.my+L.mh+3 : L.my-6; }   // táctil: bajo la barra (no tapa el nombre)
      this._hpShown=[null,null]; this._hpRedV=[null,null]; this._hpHold=[0,0]; this._tickPrev=-1;
      // textos
      const T=this.txt={};
      T.timer=this._txt(30,0xe8e3d6,DISP,"700"); T.timer.anchor.set(0.5,0.5); T.timer.x=W/2; T.timer.y=31;
      T.n0=this._txt(L.fs,0xe8e3d6); T.n0.x=L.bx; T.n0.y=L.by+L.bh+4;
      T.n1=this._txt(L.fs,0xe8e3d6); T.n1.anchor.set(1,0); T.n1.x=W-L.bx; T.n1.y=L.by+L.bh+4;
      T.n0.text=this.names[0]; T.n1.text=this.names[1]+(this.cpu?"  ·  CPU":"");
      // etiqueta de poder: escritorio = encima de la barra; táctil = al lado interior de la barra (misma fila)
      T.m0=this._txt(L.ms,0x9aa7b4); T.m1=this._txt(L.ms,0x9aa7b4);
      if(C){ T.m0.anchor.set(0,0.5); T.m0.x=L.mx0+L.mw+8; T.m0.y=L.my+L.mh/2; T.m1.anchor.set(1,0.5); T.m1.x=L.mx1-8; T.m1.y=L.my+L.mh/2; }
      else { T.m0.x=16; T.m0.y=L.my-20; T.m1.anchor.set(1,0); T.m1.x=W-16; T.m1.y=L.my-20; }
      T.c0=this._txt(34,0xf0a83a,DISP,"700",4); T.c0.x=18; T.c0.y=150;
      T.c1=this._txt(34,0x6fd3b8,DISP,"700",4); T.c1.anchor.set(1,0); T.c1.x=W-18; T.c1.y=150;
      T.cd0=this._txt(13,0xe8e3d6,null,null,3); T.cd0.x=18; T.cd0.y=190; T.cd1=this._txt(13,0xe8e3d6,null,null,3); T.cd1.anchor.set(1,0); T.cd1.x=W-18; T.cd1.y=190;
      T.center=this._txt(72,0xe8e3d6,DISP,"700",7); T.center.anchor.set(0.5,0.5); T.center.x=W/2; T.center.y=H*0.42;
      T.cut=this._txt(40,0xffc76b,DISP,"700",5); T.cut.anchor.set(0.5,0.5); T.cut.x=W/2; T.cut.y=110;
      T.dbg=this._txt(12,0x6fd3b8,'monospace',"600"); T.dbg.x=18; T.dbg.y=232;
      // letreros de sistema (contragolpe, guardia rota, recuperación) del lado de quien lo provocó
      T.nt0=this._txt(C?20:18,0xffc76b,DISP,"700",4); T.nt0.x=18; T.nt0.y=212;
      T.nt1=this._txt(C?20:18,0xffc76b,DISP,"700",4); T.nt1.anchor.set(1,0); T.nt1.x=W-18; T.nt1.y=212;
      // modo Entrenamiento: ventaja al frame del último intercambio (pg_training.js) + ayuda de teclas
      T.adv=this._txt(C?22:20,0xe8e3d6,DISP,"700",4); T.adv.anchor.set(0.5,0); T.adv.x=W/2; T.adv.y=74;
      T.advSub=this._txt(C?13:12,0x9aa7b4,null,null,3); T.advSub.anchor.set(0.5,0); T.advSub.x=W/2; T.advSub.y=98;
      for(const k in T) H_.addChild(T[k]);
      this.pips=new PIXI.Graphics(); H_.addChild(this.pips); this._pipKey="";
      // barra de GUARDIA: tira fina sobre la vida, solo visible cuando no está llena
      this.gdBack=[this._bar(0x0b1016),this._bar(0x0b1016)]; this.gdFill=[this._bar(0x9aa7b4),this._bar(0x9aa7b4)];
      for(let i=0;i<2;i++){ this.gdBack[i].height=4; this.gdBack[i].y=L.by-7; this.gdBack[i].width=L.bw*0.6; this.gdBack[i].x = i===0 ? L.bx : W-L.bx-L.bw*0.6;
        this.gdFill[i].height=2; this.gdFill[i].y=L.by-6; }
      this.training=null; this._advKey=""; this._ntKind=["",""]; this._ntFrame=[-1,-1];
      this._comboShow=[0,0]; this._lastCombo=[0,0]; this._lastComboDmg=[0,0]; this._timerVal=-1; this._bk=-1; this._cutKey="";
    }
    _updateHud(match){
      const {W}=A(), L=this.L, T=this.txt, F=match.fighters;
      // los tiempos del HUD (daño diferido, combo visible) cuentan PASOS de simulación, no cuadros dibujados:
      // antes en una pantalla de 120 Hz todo iba al doble de rápido. dt = pasos desde el último dibujo (0..5).
      const tk=match.tick||0, dt=this._tickPrev<0 ? 1 : Math.max(0, Math.min(5, tk-this._tickPrev)); this._tickPrev=tk;
      for(let i=0;i<2;i++){
        const f=F[i], k=Math.max(0,f.hp/f.maxHp);
        // daño diferido: la parte roja espera a que termine la presión y luego baja
        if(this._hpShown[i]===null){ this._hpShown[i]=k; this._hpRedV[i]=k; }
        if(k<this._hpShown[i]) this._hpHold[i]=40;
        if(k>this._hpShown[i]) this._hpRedV[i]=k;          // nueva ronda: se rellena
        this._hpShown[i]=k;
        for(let s=0;s<dt;s++){ if(this._hpHold[i]>0) this._hpHold[i]--; else if(this._hpRedV[i]>k) this._hpRedV[i]=Math.max(k,this._hpRedV[i]-Math.max(0.004,(this._hpRedV[i]-k)*0.08)); }
        const fw=L.bw*k, rw=L.bw*this._hpRedV[i];
        const fill=this.hpFill[i], red=this.hpRed[i];
        fill.width=fw; red.width=rw;
        if(i===0){ fill.x=L.bx; red.x=L.bx; } else { fill.x=W-L.bx-fw; red.x=W-L.bx-rw; }
        fill.tint = k<0.3 ? 0xf0a83a : 0xe8e3d6;
        // poder (barra inferior) + MAX
        const mk=Math.max(0,f.meter/f.maxMeter), mw=L.mw*mk, mf=this.mFill[i];
        const m0 = i===0 ? L.mx0 : L.mx1;   // borde izquierdo del marco de la barra de poder
        mf.width=mw; mf.x = i===0 ? m0 : m0+L.mw-mw;
        const mm=this.mMax[i]; const maxK = f.maxMode ? Math.max(0,f.maxT/(match.cfg.timing.maxDur||360)) : 0;
        mm.visible=!!f.maxMode; mm.width=L.mw*maxK; mm.x = i===0 ? m0 : m0+L.mw-L.mw*maxK;
        const mt = f.maxMode ? "MAX" : (mk>=1 ? "Súper lista" : "Poder"); const tt=i===0?T.m0:T.m1; if(tt.text!==mt) tt.text=mt;
        this._fill(tt, f.maxMode ? 0xffc76b : (mk>=1 ? (i===0?0xf0a83a:0x6fd3b8) : 0x9aa7b4));
        // combos: se quedan visibles un momento después del último golpe
        const cc=f.comboCount, ct=i===0?T.c0:T.c1, cd=i===0?T.cd0:T.cd1;
        if(cc>1){ this._comboShow[i]=50; this._lastCombo[i]=cc; this._lastComboDmg[i]=f.comboDamage; }
        if(this._comboShow[i]>0){ this._comboShow[i]=Math.max(0,this._comboShow[i]-dt);
          // el texto solo se arma cuando cambia el número (antes: dos cadenas nuevas por cuadro mientras se veía)
          if(ct._pgN!==this._lastCombo[i]){ ct._pgN=this._lastCombo[i]; ct.text=this._lastCombo[i]+" golpes"; }
          if(cd._pgN!==this._lastComboDmg[i]){ cd._pgN=this._lastComboDmg[i]; cd.text=this._lastComboDmg[i]+" de daño"; }
          ct.visible=cd.visible=true; ct.alpha=cd.alpha=Math.min(1,this._comboShow[i]/12); }
        else { ct.visible=cd.visible=false; }
      }
      const tv=Math.ceil(match.timer/60); if(tv!==this._timerVal){ this._timerVal=tv; T.timer.text = tv>99 ? "∞" : String(tv); }
      this._fill(T.timer, (tv<=10 && match.phase==="fight") ? 0xe04a3c : 0xe8e3d6);
      // rondas ganadas (rombos junto al reloj); solo se redibuja si cambian
      const wins=match.wins||[0,0], toWin=(match.cfg&&match.cfg.timing.roundsToWin)||2, pk=wins[0]*10000+wins[1]*100+toWin;   // clave numérica (sin cadena por cuadro)
      if(this.teamMk && match.teams) this._teamHud(match);
      else if(pk!==this._pipKey){ this._pipKey=pk; const g=this.pips; g.clear();
        for(let r=0;r<toWin;r++){ const d=(x,on,col)=>g.poly([x,56,x+5,61,x,66,x-5,61]).fill({color:on?col:0x243140}).stroke({color:0x425469,width:1});
          d(W/2-12-r*13, r<wins[0], 0xf0a83a); d(W/2+12+r*13, r<wins[1], 0x6fd3b8); } }
      // cut-in: el NOMBRE del súper / llave que se está ejecutando (legibilidad)
      let cut="";
      if(match.cinematic){ const a=match.cinematic.actor, f=F[a], def=this.chars[a]&&this.chars[a].def;
        const mv=def&&f&&f.move&&def.moves[f.move]; cut = (mv&&mv.name) ? mv.name : (match.cinematic.kind==='grab' ? "Llave" : "Súper");
        this._fill(T.cut, a===0 ? 0xf0a83a : 0x6fd3b8); }
      if(cut!==this._cutKey){ this._cutKey=cut; T.cut.text=cut; } T.cut.visible=!!cut;
      // letreros de fase. Clave NUMÉRICA: el texto solo se arma cuando cambia (antes "Ronda "+n cada frame = basura).
      // K.O.: primero la CAUSA (K.O. / Tiempo / Doble K.O.), luego "Perfecto" si aplica, luego el RESULTADO mientras posa.
      // (antes la última ronda mostraba "Gana X" desde el frame del golpe, sin K.O., y ganar por tiempo decía "K.O.")
      let bk=0;
      if(match.phase==="intro"){ const TM=match.cfg.timing, need=TM.roundsToWin-1, maxR=TM.roundsToWin*2-1+(TM.extraRounds||0);
        // "Ronda final": por rondas, los dos a una ronda de ganar o ya no quedan rondas; por equipos, los dos en su último integrante
        const fin = match.teams ? (this._lastUp(match.teams[0]) && this._lastUp(match.teams[1]))
                                : ((match.wins[0]===need && match.wins[1]===need) || match.round>=maxR);
        bk = match.phaseT>20 ? (fin ? 99 : 100+match.round) : 1; }
      else if(match.phase==="ko"){ const TM=match.cfg.timing, since=TM.koFreeze-match.phaseT, wp=TM.winPoseDelay||0;
        if(since<wp) bk = 10+(BANNER_END[match.roundEnd]||0);
        else if(match.perfect && since<wp+(TM.perfectFrames||0)) bk=20;
        else if(match.over) bk = match.winner<0 ? 30 : (match.teams ? 51 : 31)+match.winner;
        else bk = match.roundWinner<0 ? 30 : 41+match.roundWinner; }
      if(bk!==this._bk){ this._bk=bk; let s="", col=0xe8e3d6;
        if(bk>=100) s="Ronda "+(bk-100); else if(bk===99) s="Ronda final"; else if(bk===1) s="¡Pelea!";
        else if(bk>=10 && bk<20){ s=BANNER_CAUSE[bk-10]; col=0xe04a3c; }
        else if(bk===20){ s="Perfecto"; col=0xffd36b; }
        else if(bk===30) s="Empate";
        else if(bk===31||bk===32){ const w=bk-31; s="Gana "+this.bannerNames[w]; col=w?0x6fd3b8:0xf0a83a; }
        else if(bk===41||bk===42){ const w=bk-41; s="Ronda para "+this.bannerNames[w]; col=w?0x6fd3b8:0xf0a83a; }
        else if(bk===51||bk===52){ const w=bk-51; s = w===0 ? "Gana el equipo de J1" : (this.cpu ? "Gana el equipo de la CPU" : "Gana el equipo de J2"); col=w?0x6fd3b8:0xf0a83a; }
        const t=T.center; t.text=s; this._fill(t,col); t.visible=!!s;
        // nombres largos: se reduce para que quepa en la arena (solo cuando cambia el letrero)
        t.scale.set(1); if(s){ const mw=W*0.9; if(t.width>mw) t.scale.set(mw/t.width); } }
      // guardia
      for(let i=0;i<2;i++){ const f=F[i], k=f.maxGuard?f.guard/f.maxGuard:1, vis=k<0.999 && match.phase==="fight";
        this.gdBack[i].visible=this.gdFill[i].visible=vis;
        if(vis){ const gw=L.bw*0.6*k, gf=this.gdFill[i]; gf.width=gw; gf.x = i===0 ? L.bx+1 : W-L.bx-gw-1;
          gf.tint = k<0.25 ? ((match.frame%8<4)?0xe04a3c:0xf0a83a) : 0x9aa7b4; } }
      // letreros de sistema: 50 frames desde que el simulador los emitió (match.notice, sin basura)
      // (sin cadenas por frame: se compara tipo + frame del letrero; antes se concatenaban cada frame)
      const N=match.notice;
      for(let i=0;i<2;i++){ const t=i===0?T.nt0:T.nt1, on = !!(N && N.side===i && NOTICE_TXT[N.kind] && match.frame-N.frame<50);
        const kind = on ? N.kind : "", fr = on ? N.frame : -1;
        if(kind!==this._ntKind[i] || fr!==this._ntFrame[i]){ this._ntKind[i]=kind; this._ntFrame[i]=fr; t.text = on ? NOTICE_TXT[kind] : ""; this._fill(t, kind==="crush"?0xa8d8ff:0xffc76b); }
        t.visible=on; if(on) t.alpha=Math.min(1,(50-(match.frame-N.frame))/12); }
      // ventaja al frame (solo Entrenamiento)
      const TR=this.training;
      if(TR && TR.last && TR.last.valid){ const Lt=TR.last, key=Lt.frame+":"+Lt.adv;
        if(key!==this._advKey){ this._advKey=key;
          T.adv.text = "Ventaja " + (Lt.adv>0?"+":"") + Lt.adv;
          this._fill(T.adv, Lt.adv>0 ? 0x6fd3b8 : Lt.adv<0 ? 0xe04a3c : 0xe8e3d6);
          T.advSub.text = ({hit:"al golpe", block:"en guardia", crush:"guardia rota"}[Lt.kind]||Lt.kind) + (Lt.hits>1 ? " · combo de "+Lt.hits : "") + (Lt.side===1 ? " · del maniquí" : ""); }
        T.adv.visible=T.advSub.visible=true; }
      else { T.adv.visible=T.advSub.visible=!!TR; if(TR && this._advKey!=="none"){ this._advKey="none"; T.adv.text="Ventaja —"; this._fill(T.adv,0x9aa7b4); T.advSub.text="golpea al maniquí para medir"; } }
      // fps / lectura de depuración (modo F)
      this._frames++; const now=performance.now();
      if(now-this._fpsT>=500){ this._fps=Math.round(this._frames*1000/(now-this._fpsT)); this._frames=0; this._fpsT=now; }
      if(this.debug){ const f0=F[0], f1=F[1];
        T.dbg.text=`FPS ${this._fps}  frame ${match.frame}  hitstop ${match.hitstop}\nP1 ${f0.state} clip ${f0.clip} t${Math.round(f0.clipTime)} hp ${f0.hp}\nP2 ${f1.state} clip ${f1.clip} t${Math.round(f1.clipTime)} hp ${f1.hp}`;
        T.dbg.visible=true; } else T.dbg.visible=false;
    }
  }
  global.PGRender = PGRender;
})(window);
