# Añade el Modo Vestía al char.json de Sofi (atlas + clip + move + flag autoTransform). Idempotente.
import json, hashlib, sys
root=sys.argv[1]
p=f'{root}/assets/combat/sofi/sofi.char.json'
d=json.load(open(p,encoding='utf-8'))
sha=hashlib.sha256(open(f'{root}/assets/combat/sofi/sofi_vestia.png','rb').read()).hexdigest()
# 1) atlas extra "vestia": 6x6, celda 160, anchor pies y=0.95
d['atlases']['vestia']={
  "file":"sofi_vestia.png","columns":6,"rows":6,"cell":{"w":160,"h":160},
  "anchor":{"x":0.5,"y":0.95},"sha256":sha,
  "source":"36 frames del Modo Vestía (hoja del usuario 2026-11-07, fondo damero recortado por tools/build_vestia_sofi.py) normalizados x0.61 a la escala de Sofi (figura cara-pies 108px ≈ base 111px)."
}
# 2) clip modo_vestia: 36 frames (0..35), se queda en el último (hold); ~15 fps
d['clips']['modo_vestia']={
  "atlas":"vestia","fps":15,"loop":False,"frames":list(range(36)),
  "_doc":"Especial Oculto Modo Vestía (secuencia única): activación F01-08 (idx0-7), transformación F09-16 (idx8-15), ataque de garras F17-24 (idx16-23), remate/explosión F25-32 (idx24-31), recuperación F33-36 (idx32-35)."
}
# 3) move modo_vestia: súper oculto, invulnerable durante la transformación, golpea en garras+remate
d['moves']['modo_vestia']={
  "clip":"modo_vestia","super":True,"hidden":True,"meterCost":0,
  "invuln":True,"invulnFrames":66,
  "hitFrames":[18,20,22,25,28],"multiHit":True,
  "hitbox":{"x":14,"y":-156,"w":96,"h":150},
  "guardType":"high","damage":16,"hitstun":22,"blockstun":14,"hitstop":10,
  "pushHit":4,"pushBlock":3,"pushY":-8,"launcher":True,
  "cinematic":{"kind":"super","zoom":1.7,"freeze":40,"dur":60},
  "name":"Modo Vestía","nameSrc":"paquete:ESPECIAL OCULTO MODO VESTÍA",
  "_doc":"Se activa SOLO (ver autoTransform): no tiene comando. invulnFrames 66 ≈ cubre activación+transformación (idx0-15 a 15fps). hitFrames en el ataque de garras (18,20,22) y el remate (25,28). Frame-data y caja = DISEÑO, TODO: VERIFICAR jugando."
}
# 4) flag de auto-activación a media vida (lo lee engine/pg_sim.js)
d['autoTransform']={"move":"modo_vestia","hpBelow":0.5,
  "_doc":"2026-11-07: al caer al 50% de vida (o menos), Sofi ejecuta modo_vestia AUTOMÁTICAMENTE una vez. Implementado en engine/pg_sim.js (busca 'autoTransform')."}
# marca de añadido post-generación
d['_vestia_added']="2026-11-07: Modo Vestía añadido a mano (atlas vestia + clip/move modo_vestia + autoTransform) sobre el char.json generado por build_sofi.py. Si regeneras Sofi, reincorpora esto en tools/specs/sofi_spec.json + build_sofi.py."
txt=json.dumps(d,indent=2,ensure_ascii=False)+'\n'
if open(p,encoding='utf-8').read()!=txt: open(p,'w',encoding='utf-8').write(txt); print('char.json actualizado')
else: print('sin cambios')
