/* PGLoader — carga de atlas a PixiJS v8.
   Soporta:
   - cuerpo V248 multi-pack (mi formato *.sheetN.json con anchor por frame)
   - atlas nativo PixiJS (borrador PIXI base y atlas de especiales)
   No modifica píxeles; respeta separación cuerpo/especiales. */
(function (global) {
  "use strict";
  const DBG = { lastError: null };

  function dirOf(url){ return url.slice(0, url.lastIndexOf('/') + 1); }
  function median(arr, def){ if(!arr.length) return def; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }

  const _imgCache = {};
  let _inUse = null;        // URLs pedidas durante la precarga en curso (beginUse … releaseUnused)
  async function image(url){
    if (_inUse) _inUse.add(url);
    if (!_imgCache[url]) _imgCache[url] = await PIXI.Assets.load(url);
    return _imgCache[url];
  }

  async function loadBodyMultipack(entryUrl){
    const dir = dirOf(entryUrl);
    const entry = await (await fetch(entryUrl, {cache:'no-store'})).json();
    const packs = [entry];
    for (const p of (entry.meta.related_multi_packs || [])) {
      packs.push(await (await fetch(dir + p, {cache:'no-store'})).json());
    }
    const textures = {}, anchors = {};
    for (const data of packs) {
      const base = await image(dir + data.meta.image);
      for (const [name, fr] of Object.entries(data.frames)) {
        const f = fr.frame;
        textures[name] = new PIXI.Texture({
          source: base.source,
          frame: new PIXI.Rectangle(f.x, f.y, f.w, f.h)
        });
        anchors[name] = fr.anchor || {x:0.5, y:0.94};
      }
    }
    const animations = {};
    for (const [an, names] of Object.entries(entry.animations || {})) {
      animations[an] = names.map(n => textures[n]).filter(Boolean);
    }
    const sample = (entry.animations.idle_tentativo || entry.animations.all || []).slice(0, 8);
    return {
      textures, animations, anchors,
      cell: entry.meta.cell || [160,144],
      anchor: { x: median(sample.map(n=>anchors[n]?.x ?? 0.5), 0.5),
                y: median(sample.map(n=>anchors[n]?.y ?? 0.94), 0.94) }
    };
  }

  async function loadNative(jsonUrl){
    const raw = await (await fetch(jsonUrl, {cache:'no-store'})).json();
    const sheet = await PIXI.Assets.load(jsonUrl);
    const first = Object.keys(raw.frames)[0];
    const a = (raw.frames[first] || {}).anchor || {x:0.5, y:0.94};
    const w = raw.frames[first]?.sourceSize?.w || 120, h = raw.frames[first]?.sourceSize?.h || 120;
    return { textures: sheet.textures, animations: sheet.animations, anchor:a, cell:[w,h], sheet };
  }

  const PGLoader = {
    DBG,
    // MEMORIA (Android): antes ningún atlas se liberaba nunca; cada luchador elegido en la sesión se quedaba en la memoria
    // de video (≈11 MB cada uno, hasta 26 MB). Uso: beginUse() → cargar TODO lo del combate → releaseUnused() libera lo que
    // el combate nuevo no pidió. Solo debe llamarse sin un combate dibujándose (el orquestador lo hace antes de crearlo).
    beginUse(){ _inUse = new Set(); },
    releaseUnused(){
      const keep = _inUse; _inUse = null; if (!keep) return 0; let n = 0;
      for (const url of Object.keys(_imgCache)){
        if (keep.has(url)) continue;
        delete _imgCache[url]; n++;
        PIXI.Assets.unload(url).catch(function(e){ console.warn('PGLoader: no se pudo liberar ' + url + ' (' + e.message + ')'); });
      }
      return n;
    },
    cachedCount(){ return Object.keys(_imgCache).length; },
    async loadBody(entry, tipo){
      try {
        return (tipo === 'v248') ? await loadBodyMultipack(entry) : await loadNative(entry);
      } catch (e){ DBG.lastError = String(e); throw e; }
    },
    async loadSpecials(jsonUrl){
      if (!jsonUrl) return null;
      try { return await loadNative(jsonUrl); }
      catch (e){ DBG.lastError = 'specials:' + e; return null; }
    },
    // Carga un personaje de REJILLA (atlas PNG 9xN sin JSON de frames),
    // cortando texturas por índice de frame según char.clips. Devuelve clips->[Texture].
    async loadGridCharacter(charDef, baseDir){
      const atlasTex = {};
      const atlasRects = {}; // atlasKey -> {frameIdx: {x,y,w,h}} cuando hay coordsFile (corte EXACTO)
      const atlasAnchors = {}; // atlasKey -> {frameIdx: {x,y}} para fijar baseline por frame
      for (const [k, a] of Object.entries(charDef.atlases)){
        atlasTex[k] = await image(baseDir + a.file);
        if (a.coordsFile){
          // Atlas con coordenadas por frame (rects exactos del pipeline). Sin drift de rejilla.
          const cj = await (await fetch(baseDir + a.coordsFile, {cache:'no-store'})).json();
          const map = {};
          for (const f of (cj.frames || [])){
            const x = f.x, y = f.y;
            const w = (f.width  != null) ? f.width  : (f.x2 - f.x);
            const h = (f.height != null) ? f.height : (f.y2 - f.y);
            map[f.frame] = { x, y, w, h };
          }
          atlasRects[k] = map;
        }
        if (a.anchorsFile){
          try {
            const aj = await (await fetch(baseDir + a.anchorsFile, {cache:'no-store'})).json();
            const map = {};
            for (let i=0;i<(aj.anchors||[]).length;i++){
              const an=aj.anchors[i]; if(an && !an.blank) map[i]={x:an.x, y:an.y};
            }
            atlasAnchors[k] = map;
          } catch(e){ DBG.lastError = 'anchors:' + e; }
        }
      }
      const fw = charDef.frameSize.w, fh = charDef.frameSize.h;
      const baseAnchor = charDef.anchor || { x:0.5, y:1.0 };
      const cut = (atlasKey, frame) => {
        const a = charDef.atlases[atlasKey];
        const rects = atlasRects[atlasKey];
        // un atlas EXTRA puede declarar su propia celda y pivote (frames de otra hoja, mismo personaje)
        const cw = (a.cell && a.cell.w) || fw, chh = (a.cell && a.cell.h) || fh;
        let rx, ry, rw, rh;
        if (rects && rects[frame]){
          ({x:rx, y:ry, w:rw, h:rh} = rects[frame]);
        } else {
          const col = frame % a.columns, row = Math.floor(frame / a.columns);
          rx = col*cw; ry = row*chh; rw = cw; rh = chh;
        }
        const t = new PIXI.Texture({ source: atlasTex[atlasKey].source,
          frame: new PIXI.Rectangle(rx, ry, rw, rh) });
        t.pgAnchor = (atlasAnchors[atlasKey] && atlasAnchors[atlasKey][frame]) || a.anchor || baseAnchor;
        return t;
      };
      const clips = {};
      for (const [name, c] of Object.entries(charDef.clips)){
        clips[name] = c.frames.map(fr => cut(c.atlas, fr));
      }
      const anchor = baseAnchor;
      // retrato de filiación para el HUD: rect en pixeles del atlas, precalculado en datos (tools/build_portraits.py)
      let portrait = null; const P = charDef.portrait;
      if (P && P.head && atlasTex[P.atlas]){
        const [x, y, w, h] = P.head;
        portrait = new PIXI.Texture({ source: atlasTex[P.atlas].source, frame: new PIXI.Rectangle(x, y, w, h) });
      }
      return { clips, anchor, frameSize: charDef.frameSize, def: charDef, portrait };
    },

    // ---- LIBRERÍA DE FX (data/fx_library.json) ----
    // Anims referenciadas por un char.json (proyectiles, impactos, FX por frame de move).
    fxRefsOf(def){
      const out = [];
      const add = id => { if (id && out.indexOf(id) < 0) out.push(id); };
      for (const mv of Object.values(def.moves || {})){
        add(mv.hitAnim); add(mv.hitAnimVestia);   // hitAnimVestia: chispa del move cuando el luchador está transformado (Sofi)
        if (mv.spawns){ add(mv.spawns.anim); add(mv.spawns.hitAnim); }
        for (const e of (mv.fx || [])) add(e.anim);
      }
      return out;
    },
    // Carga SOLO las páginas que usan los luchadores del combate + los hitsparks genéricos.
    // Devuelve { anims:{id:{tex[],scales[],anchors[],fps,loop,h}}, hitsparks } o null si no hay librería.
    // ARTE de escenario (data/stages.json -> art.file). Si la imagen no carga, el escenario se dibuja procedural y se avisa.
    async loadStageArt(stageDef){
      if (!stageDef || !stageDef.art) return null;
      try {
        const art = stageDef.art;
        if (Array.isArray(art.layers) && art.layers.length){
          const layers = {};
          for (const L of art.layers) layers[L.id] = await image(L.file);
          return { layers };
        }
        return await image(art.file);
      }
      catch (e){ DBG.lastError = 'stage:' + e; console.warn('Arte del escenario "' + stageDef.id + '" no disponible: se dibuja el tema procedural.'); return null; }
    },
    async loadFxLibrary(url, defs){
      let lib;
      try { lib = await (await fetch(url, {cache:'no-store'})).json(); }
      catch (e){ DBG.lastError = 'fx_library:' + e; return null; }
      const want = [];
      for (const d of defs) for (const id of PGLoader.fxRefsOf(d)) if (want.indexOf(id) < 0) want.push(id);
      for (const k of Object.keys(lib.hitsparks || {})){ const h = lib.hitsparks[k]; if (h && h.anim && want.indexOf(h.anim) < 0) want.push(h.anim); }
      const pages = {}, anims = {};
      for (const id of want){
        const A = lib.anims[id];
        if (!A){ DBG.lastError = 'fx_library: anim inexistente ' + id; continue; }   // tools/validate_data.py lo impide en build
        const L = lib.libs[A.lib];
        if (!L || L.runtime === false) continue;
        if (!pages[A.lib]) pages[A.lib] = await image(L.image);
        const src = pages[A.lib].source;
        anims[id] = { fps:A.fps, loop:A.loop, h:A.h, scales:A.scales, anchors:A.anchors, use:A.use,
          tex: A.frames.map(fn => { const r = L.frames[fn];
            return new PIXI.Texture({ source: src, frame: new PIXI.Rectangle(r[0], r[1], r[2], r[3]) }); }) };
      }
      return { anims, hitsparks: lib.hitsparks || {} };
    },
    // Catálogo pequeño y procedural: no descarga texturas ni altera los atlas de personajes.
    async loadHiddenParticleFx(url='data/hidden_particle_fx.json'){
      try { return await (await fetch(url, {cache:'no-store'})).json(); }
      catch (e){ DBG.lastError = 'hidden_particle_fx:' + e; console.warn('Partículas ocultas no disponibles:', e); return null; }
    }
  };
  global.PGLoader = PGLoader;
})(window);
