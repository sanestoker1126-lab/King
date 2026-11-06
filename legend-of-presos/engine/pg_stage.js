/* pg_stage.js — ESCENARIO de combate (solo dibujo; nunca toca la simulación).
   Lee una entrada de data/stages.json (spec §4.6): arte (imagen) colocado en la arena, tema procedural para lo que la
   imagen no cubre (o para todo el escenario si no hay arte), halos de luz sobre las lámparas MEDIDAS de la imagen
   (tools/build_stage_lights.py), lluvia, relámpagos y piso mojado.
   - Todo lo animado es función del frame de la partida (misma pelea = misma imagen) con un hash entero, sin Math.random.
   - Objetos creados una vez y reutilizados: por frame solo cambian posición/alfa (cero basura).
   - Con "reducir movimiento" del sistema no hay lluvia ni relámpagos.
   Capas: `back` (detrás de los luchadores) y `front` (delante: lluvia y destello). */
(function (global) {
  "use strict";
  const A = () => PGSim.ARENA;
  const REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function mix(a, b, k){ k = Math.max(0, Math.min(1, k));
    const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255, br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
    return (Math.round(ar+(br-ar)*k)<<16) | (Math.round(ag+(bg-ag)*k)<<8) | Math.round(ab+(bb-ab)*k); }
  // hash entero determinista (0..1) — para que la lluvia y los relámpagos no dependan de Math.random
  function h01(n){ n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
  // textura de halo radial (una sola para todas las luces de todos los escenarios)
  let GLOW = null;
  function glowTexture(){
    if (GLOW) return GLOW;
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.18, "rgba(255,255,255,.55)"); gr.addColorStop(0.5, "rgba(255,255,255,.14)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    GLOW = PIXI.Texture.from(c); return GLOW;
  }
  const LIGHT = { farola: { tint: 0xffc98a, a: 0.55 }, muro: { tint: 0xffd6a0, a: 0.42 }, torre: { tint: 0xfff1d8, a: 0.5 }, ventana: { tint: 0xffe0b0, a: 0.32 } };

  class PGStage {
    constructor(def, tex){
      this.def = def || { theme: null }; this.tex = tex || null;
      this.back = new PIXI.Container(); this.front = new PIXI.Container();
      this.g = new PIXI.Graphics(); this.back.addChild(this.g);
      this._drawProcedural();
      const art = this.def.art;
      this.lights = [];
      this._layerSprites = [];
      if (tex && art && tex.layers && Array.isArray(art.layers)){
        for (const L of art.layers){
          const texture = tex.layers[L.id]; if (!texture) continue;
          const sp = new PIXI.Sprite(texture);
          sp.x = L.x != null ? L.x : (art.x || 0); sp.y = L.y != null ? L.y : (art.y || 0);
          sp.scale.set(L.scale != null ? L.scale : (art.scale || 1));
          sp._baseX = sp.x; sp._baseY = sp.y; sp._depth = L.depth != null ? L.depth : 1;
          sp._phase = h01((L.id || '').length * 7919 + 13); sp._animate = L.animate || '';
          (L.target === 'front' ? this.front : this.back).addChild(sp);
          this._layerSprites.push(sp);
        }
      } else if (tex && art){
        const s = art.scale || 1;
        this.art = new PIXI.Sprite(tex); this.art.x = art.x; this.art.y = art.y; this.art.scale.set(s); this.back.addChild(this.art);
        const lt = this.def.lights || [];
        for (let i = 0; i < lt.length; i++){
          const L = lt[i], K = LIGHT[L.kind] || LIGHT.muro, sp = new PIXI.Sprite(glowTexture());
          sp.anchor.set(0.5); sp.x = art.x + L.x * s; sp.y = art.y + L.y * s; sp.scale.set((L.r * 2 * s) / 128);
          sp.tint = K.tint; sp.blendMode = "add"; sp.alpha = K.a; sp._a = K.a; sp._ph = h01(i * 7919 + 13) * 6.283; sp._kind = L.kind;
          this.back.addChild(sp); this.lights.push(sp);
        }
      }
      // lluvia (delante): trazos finos reciclados
      const R = this.def.rain; this.rain = [];
      if (R && !REDUCED){
        const ang = Math.atan2(R.drift, R.speed);
        for (let i = 0; i < R.count; i++){
          const sp = new PIXI.Sprite(PIXI.Texture.WHITE); sp.width = 1.3; sp.height = R.len * (0.7 + 0.6 * h01(i * 31 + 7));
          sp.rotation = -ang; sp.alpha = R.alpha * (0.55 + 0.45 * h01(i * 17 + 3)); sp.tint = 0xc9d4e0;
          sp._x0 = h01(i * 101 + 11); sp._y0 = h01(i * 211 + 5); sp._v = 0.8 + 0.4 * h01(i * 53 + 1);
          this.front.addChild(sp); this.rain.push(sp);
        }
      }
      // relámpago: un destello que cubre todo el escenario dibujado
      const LG = this.def.lightning;
      if (LG && !REDUCED){
        const { W, H } = A(), M = Math.ceil(W * 0.35), MY = Math.ceil(H * 0.3);
        this.flash = new PIXI.Sprite(PIXI.Texture.WHITE); this.flash.x = -M; this.flash.y = -MY; this.flash.width = W + 2 * M; this.flash.height = H + 2 * MY;
        this.flash.tint = 0xdfe8ff; this.flash.blendMode = "add"; this.flash.visible = false; this.front.addChild(this.flash);
      }
    }
    // piso mojado: alfa del reflejo de los luchadores (0 = sin reflejo)
    get wetAlpha(){ return (this.def.wetFloor && this.def.wetFloor.alpha) || 0; }

    // Tema procedural. El escenario se dibuja MÁS ANCHO que la arena jugable (M a cada lado) y más alto (MY): en
    // pantallas 20:9 / 4:3 no se ve el borde (§4.5). Con arte, la imagen tapa el centro y esto rellena lo que sobra.
    _drawProcedural(){
      const { W, H, GROUND } = A(), g = this.g; g.clear();
      const t = this.def.theme || { sky:0x1a1327, back:0x241a33, pillar:0x33264d, floor:0x120d1b, line:0x5a4780, glow:0x2a1d3f };
      const M = Math.ceil(W * 0.35), X0 = -M, X1 = W + M, MY = Math.ceil(H * 0.3);
      const from = (step, off) => off - Math.ceil((M + off) / step) * step;   // primer x de una rejilla que conserva las posiciones de dentro
      g.rect(X0, -MY, X1 - X0, MY).fill(t.sky);
      for (let y = 0; y < GROUND; y += 12){ g.rect(X0, y, X1 - X0, 12).fill(mix(t.sky, t.back, y / GROUND)); }
      g.rect(X0, GROUND, X1 - X0, H - GROUND + MY).fill(t.floor);
      if (this.def.art) return;                       // con arte no se dibujan columnas ni barandal procedurales
      g.ellipse(W / 2, GROUND * 0.55, W * 0.45, GROUND * 0.5).fill({ color: t.glow, alpha: 0.5 });
      for (let x = from(120, 0); x < X1; x += 120) g.rect(x + 4, 120, 112, GROUND - 150).fill({ color: t.pillar, alpha: .42 });
      for (let x = from(46, 20); x < X1; x += 46) g.rect(x, GROUND - 70, 6, 70).fill({ color: t.pillar, alpha: .6 });
      g.rect(X0, GROUND - 74, X1 - X0, 6).fill({ color: t.pillar, alpha: .7 });
      g.rect(X0, GROUND, X1 - X0, 5).fill(t.line);
      for (let x = from(48, 0); x < X1; x += 48) g.rect(x, GROUND + 10, 24, 3).fill({ color: t.line, alpha: .3 });
    }

    // por frame (solo cambia posición/alfa de objetos existentes)
    update(frame, camera){
      // Parallax: las capas lejanas compensan más el paneo de cámara; el primer plano sigue la arena.
      if (this._layerSprites.length){
        const { W } = A(), cx = camera && camera.x != null ? camera.x : W / 2;
        for (const sp of this._layerSprites){
          const pan = (cx - W / 2) * (1 - sp._depth);
          sp.x = sp._baseX + pan;
          sp.y = sp._baseY + (sp._animate === 'crowd' ? Math.sin(frame * 0.11 + sp._phase * 6.283) * 1.5 : 0);
          if (sp._animate === 'crowd') sp.alpha = 0.88 + 0.08 * Math.sin(frame * 0.07 + sp._phase * 5.1);
        }
      }
      // halos: respiración lenta + una lámpara de muro que falla de vez en cuando (sodio viejo)
      for (let i = 0; i < this.lights.length; i++){
        const sp = this.lights[i];
        let k = 0.88 + 0.12 * Math.sin(frame * 0.045 + sp._ph);
        if (sp._kind === "muro" && h01(((frame / 7) | 0) * 131 + i * 977) < 0.025) k *= 0.35;
        sp.alpha = sp._a * k;
      }
      const R = this.def.rain;
      if (this.rain.length){
        const { W, H } = A(), M = Math.ceil(W * 0.35), span = W + 2 * M, top = -40, fall = H + 80;
        for (let i = 0; i < this.rain.length; i++){
          const sp = this.rain[i], y = (sp._y0 * fall + frame * R.speed * sp._v) % fall;
          sp.y = top + y; sp.x = -M + ((sp._x0 * span + (top + y) * (R.drift / R.speed)) % span + span) % span;
        }
      }
      if (this.flash){
        const LG = this.def.lightning, cyc = (frame / LG.every) | 0, start = (h01(cyc * 389 + 71) * LG.jitter) | 0, d = (frame % LG.every) - start;
        // doble destello corto (como un relámpago real): frames 0-1 fuerte, 3-4 más débil
        const k = this.flashK != null ? this.flashK : 1, on = k > 0 && d >= 0 && d < LG.frames && d !== 2;
        this.flash.visible = on; if (on) this.flash.alpha = LG.alpha * (d < 2 ? 1 : 0.55) * k;
      }
    }
    // (no tiene destroy propio: sus capas cuelgan del mundo del render y se destruyen con él; las texturas del arte y del
    //  halo NO se destruyen porque son caché compartida entre peleas)
  }
  global.PGStage = PGStage;
})(window);
