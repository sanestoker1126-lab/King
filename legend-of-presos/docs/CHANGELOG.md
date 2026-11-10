# CHANGELOG

> Los ZIP recibidos el 2026-11-06 no traían `docs/`, así que **el historial anterior no está aquí**. Si tienes el `docs/CHANGELOG.md` completo, pega esta entrada al principio del tuyo.

## 2026-11-10 — Chispas de impacto del Modo Vestía (FX del usuario)

- Se usan los **43 FX morado/carmesí** del mismo ZIP (`POCHECHE_FX_PURPURA_CARMESI`). Son efectos sueltos de una sola hoja; `tools/build_sofi_vestia_real.py` toma 24 y arma 6 chispas: `vestia_impacto`, `vestia_zarpazo`, `vestia_garras`, `vestia_cruz`, `vestia_barrido` y `vestia_estallido`.
  - Página `assets/fx/sofi_vestia_fx.webp` (WebP sin pérdida, 1024x1294, 1.06 MB). Solo se carga si Sofi pelea.
  - Entradas `sofi_vestia_fx` y `vestia_*` en `data/fx_library.json`.
  - Tamaño relativo restaurado deshaciendo `content.scale`, como en los frames del personaje.
- **Cuándo salen**: cada golpe de Sofi declara `hitAnimVestia` en su char.json. La simulación la usa **solo si quien pega está transformada** (`engine/pg_sim.js`, chispa del golpe). La propia transformación (`modo_vestia`) usa `vestia_garras` como `hitAnim`.
  - Asignación: puño, Estrella y Giro → zarpazo · golpe fuerte y Empuje → garras · patada → impacto · patada media → cruz · Embestida (baja) → barrido · súper → estallido. **TODO: VERIFICAR** con el usuario.
- `engine/pg_loader.js` (`fxRefsOf`) carga también `hitAnimVestia`.
- Solo cambia el dibujo del FX: la jugabilidad sale idéntica cuadro a cuadro (Sofi contra Tobi, Garravas y Nadia, y Tobi contra Garravas, `determinism.cjs`). Sin transformación, el FX es el mismo objeto que antes.
- **Navegador** (`tools/qa_20261106/vestia_real.cjs`):
  - Se cargan las 6 chispas Vestía.
  - En una pelea de CPU contra CPU salieron cruz, zarpazo, impacto y garras.
  - Barrido y estallido existen, pero la CPU no hizo esos golpes en la muestra.
  - Consola limpia salvo el 404 de `sw.js`.
- Evidencia: `qa/entrega_20261106/sofi_vestia_chispas_escala.jpg` (cada chispa a escala del juego junto a Sofi transformada) y `qa/entrega_20261106/sofi_vestia_chispa_en_juego.jpg`.

## 2026-11-08 (2) — Jefes consolidados · Modo Vestía con arte real

### Jefe final: nunca se salta y también es jefe en Equipos
- **Bug (1 vs 1)**: si elegías a **Garravas**, la batalla del jefe final se filtraba ("el rival eres tú") y el Arcade terminaba en Nadia **sin jefe final**. Ahora el jefe final **nunca se salta**: se pelea el espejo Garravas vs Garravas, con sus mods. La sub-jefa sí se sigue saltando si juegas con Sofi (regla que ya existía).
- **Equipos**: el combate 6 (Mateo, Cochi Bombis, Garravas) no tenía nada de jefe. Nuevo campo `memberMods` en `data/campaigns.json`: **solo Garravas** recibe ×2.5 vida (750) y ×1.7 daño; Mateo y Cochi pelean normales. Esto corrige lo que se dejó en la entrada anterior ("no se tocó porque el mod afectaría a los 3"): ahora el motor admite modificadores **por integrante**.
- **Garravas en tu equipo**: antes se reemplazaba por otro luchador y el combate seguía diciendo "JEFE FINAL" sin jefe. Ahora el jefe se queda (espejo) y solo se reemplaza a los demás que coincidan.
- Motor (`engine/pg_sim.js`): `mods[lado].members[i]` (`modsOf`, `modFor`, `dmgMul`, `resetRound`; en Equipos el que entra nace con la vida de SU modificador). Sin `members` el objeto y el resultado quedan **idénticos** a antes. `engine/pg_game.js`: `copyBattle`/`arcadeStart`/`arcadeNextMatch`.
- Verificación:
  - `tools/qa_20261106/bosses_check.cjs`: TODO OK. 1 vs 1 y Equipos (sin mods, con mods de lado, sub-jefa) son idénticos cuadro a cuadro contra el motor anterior; `members` produce lo mismo que los mods de lado; en Equipos la vida máxima es Mateo 300, Cochi 300 y Garravas 750.
  - `tools/qa_20261106/arcade_bosses.cjs` corre las funciones reales de `pg_game.js`: TODO OK. Contra el código anterior falla el caso "eliges a Garravas", así que el bug existía de verdad.

### Modo Vestía de Sofi con arte REAL (atlas del usuario)
- **Fuente**: `POCHECHE_ATLAS_MASTER_GAME_READY.zip`. El nombre dice Pocheche, pero el usuario aclaró que es Sofi en Modo Vestía (se ve: cuernos, traje negro con rojo, garras). Trae 103 frames y 43 FX. Está archivado intacto en `sources/entregas_2026-11-08/` con SHA-256.
- **Reemplaza el recoloreado morado provisional**. Los 19 clips `*_vestia` (idle, caminar con 8 frames, correr, salto, guardia, golpe recibido, caída, derribado, levantarse, victoria, golpes, patadas, 4 especiales y súper) usan el atlas nuevo `assets/combat/sofi/sofi_vestia_real.png` (54 frames, celda 176). Se borraron `sofi_vestia_moveset.png` y `tools/build_sofi_vestia_moveset.py`.
- Lo genera **`tools/build_sofi_vestia_real.py`** (idempotente, `--check`). El script corrige problemas medidos en la fuente:
  1. **Escala por frame**: cada frame venía estirado a 220 px de alto, así que una pose agachada medía lo mismo que una de pie. Se deshace con su `content.scale` y una referencia de pie por secuencia. Resultado: de pie 112 px (igual que la base) y guardia agachada 88 px (la base mide 87).
  2. **Fondo blanco atrapado** entre las piernas y entre mechones en `hurt` y `kick` (7 791 y 2 853 píxeles casi blancos). Se borró.
  3. **Cuerpo nunca 100 % opaco** (alfa mediano entre 247 y 252 en varias hojas). Se subió a 255 con un factor de 1.01 a 1.03.
  4. **Ancla en las botas** y no en el centro de la caja, para que el pie de apoyo no patine en las patadas.
- **Sincronía con la simulación**: cada clip `*_vestia` conserva el número de frames y los fps de su clip base. Solo caminar y golpe recibido cambian, y esos no marcan golpes. Así el frame activo dibujado cae en el mismo tick que el golpe. Determinismo: Sofi contra Tobi, Garravas y Nadia sale idéntico cuadro a cuadro contra la versión anterior.
- **Legibilidad**: el único golpe bajo de Sofi (Embestida de cuernos, `guardType: low`) usa el barrido deslizante, para que se vea bajo. Los altos usan poses de pie.
- La asignación pose → golpe es decisión de integración (**TODO: VERIFICAR** con el usuario). La tabla está en `MAP` del script, con el nombre de cada frame fuente en `_src` del clip.
- **Navegador** (`tools/qa_20261106/vestia_real.cjs`, Sofi CPU vs Tobi CPU en OXXO):
  - Sofi se transforma y en la pelea se dibujaron 10 clips `*_vestia` distintos.
  - Las 20 texturas del atlas son válidas.
  - Consola limpia, salvo el 404 de `sw.js` (el archivo no existe en el repo).
  - Evidencia: `qa/entrega_20261106/sofi_vestia_real_en_juego.jpg` y `qa/entrega_20261106/sofi_vestia_real_vs_base.jpg`.
- **No usado**:
  - Los 43 FX de garras morado/carmesí. *(Se integraron el 2026-11-10 como chispas de impacto; ver arriba.)*
  - Las imágenes transparentes de la transformación de 36 frames que llegaron por el chat. Medido: en los frames 4 a 34 cerca de la mitad del cuerpo tiene alfa menor a 230, y el traje negro entre 60 y 97 %, así que se vería el fondo a través de Sofi. Se mantiene el recorte de la hoja de alta resolución. Detalle en `sources/entregas_2026-11-08/ORIGEN_SHA256.txt`.

## 2026-11-08 — Sofi: Modo Vestía pulido + persistente · jefe final

### Modo Vestía de Sofi — arreglos
- **Damero**: el recorte (`tools/build_vestia_sofi.py`) ahora hace una pasada final que quita el fondo de cuadros gris que se asomaba en los bordes. Frames limpios.
- **Escala**: el Modo Vestía se dibuja **~1.15× más grande** que la forma normal (antes medía igual y se veía chico). Para no romper la sincronía vista/simulación, la **hurtbox** también crece 1.15× en Modo Vestía (`engine/pg_sim.js`, `hurtboxOf`), así el sprite agrandado y la caja coinciden.
- **Duración**: la transformación pasa de ~2.4 s a **~3.3 s** (clip a 12 fps).

### Modo Vestía ahora es PERSISTENTE (pelea transformada)
- Antes era un ataque único que terminaba volviendo a su traje normal. Ahora, al terminar la secuencia (F01–F32, se quitaron los 4 frames de "volver a normal"), **Sofi queda transformada** (`f.transformed`) hasta el fin de la ronda.
- **Moveset morado**: `tools/build_sofi_vestia_moveset.py` recolorea el atlas base a morado/oscuro (`sofi_vestia_moveset.png`). El `char.json` gana los clips `*_vestia` y el render (`engine/pg_render.js`) los usa cuando `f.transformed`. Así **todas** sus animaciones (idle, caminar, golpes, especiales) se ven en Modo Vestía sin arte nuevo frame a frame — es un recoloreado determinista del arte existente.
- **Buff**: transformada pega **+20 %** de daño (`CFG.vestiaDamageMul`, DISEÑO). La hurtbox más grande la hace también más fácil de golpear (contrapeso).
- Aislado y determinista: `tools/qa_20261106/determinism.cjs` confirma que las peleas **sin Sofi** siguen idénticas cuadro a cuadro (el `transformed`/buff/hurtbox solo afecta a quien está transformado).
- `resetRound` recrea los luchadores → Sofi empieza cada ronda en su forma normal.
- Evidencia: `qa/entrega_20261106/sofi_modo_vestia_persistente.jpg`.

### Jefe final (garravas)
- La batalla del jefe final del Arcade (`data/campaigns.json`, `solo[5]`) gana `tag: "JEFE FINAL"` y `mods {hp: 2.5, damage: 1.7}`: ahora el jefe tiene **750 de vida (×2.5)** y pega más, por encima de la sub-jefa Sofi (×2/×2). Antes peleaba con vida/daño normal. Su kit ya estaba completo (17/17 cadenas de combo, juggle en MAX). En el modo equipos no se tocó (el mod afectaría a los 3 del equipo; 3v3 ya es el reto).

## 2026-11-07 (2) — Sofi: Modo Vestía (transformación automática a media vida)

### Modo Vestía (especial oculto que se auto-activa)
- Arte: 36 frames de la hoja del usuario (`sources/entregas_2026-11-07/sofi_modo_vestia_36f.png`, con SHA-256). Venían sobre un damero gris horneado; `tools/build_vestia_sofi.py` lo recorta (conservando el aura morada del personaje) y normaliza a la escala de Sofi (×0.61, figura cara-pies ≈ idle base). Resultado: `assets/combat/sofi/sofi_vestia.png` (atlas 6×6, celda 160, anclado a los pies).
- `char.json`: atlas `vestia` + clip `modo_vestia` (36 frames, 15 fps) + move `modo_vestia` (súper oculto: invulnerable durante activación+transformación idx0-15, golpea en el ataque de garras idx18-22 y el remate idx25-28, multi-golpe que lanza).
- **Activación automática a media vida**: flag `autoTransform` en el char.json (`{move:"modo_vestia", hpBelow:0.5}`). Nueva lógica en `engine/pg_sim.js` (buscar `autoTransform` / `ragePending`): cuando Sofi cae al 50% de vida o menos, ejecuta el Modo Vestía **una vez por ronda**, en el primer frame en que puede actuar (si está en hitstun/aire, espera). `resetRound` recrea los luchadores, así que se rearma cada ronda.
- **Aislado**: el cambio de motor solo actúa sobre luchadores con `autoTransform` (solo Sofi). Verificado con `tools/qa_20261106/determinism.cjs`: 3 peleas sin Sofi (tobi/mateo, el_paisa/p08, cadena/calavera) salen **idénticas cuadro a cuadro** entre el motor anterior y el nuevo.
- Verificado en navegador (escenario OXXO): Sofi se transforma sola a media vida, es invulnerable en la transformación, las garras + explosión conectan (combo de 2-3, lanza al rival) y vuelve a su traje normal al terminar. Consola limpia (salvo el aviso de `sw.js`). Evidencia: `qa/entrega_20261106/sofi_modo_vestia_secuencia.jpg`.
- Frame-data, caja y daños del move = **DISEÑO**, TODO: VERIFICAR jugando.

### Sofi es un personaje GENERADO
- `sofi.char.json` lo genera `tools/build_sofi.py` (no está en este repo). El Modo Vestía se añadió **a mano** sobre el char.json generado (marca `_vestia_added`). Si regeneras Sofi con tu `build_sofi.py`, reincorpora el bloque del Modo Vestía (atlas `vestia`, clip/move `modo_vestia`, `autoTransform`) a `tools/specs/sofi_spec.json`.

### Auditoría de los 2 ZIP (especiales.zip, especiales_2.zip): NO aportan
- `especiales.zip` (61 archivos): 48 son imágenes de QA/revisión (`*_review.png`, `e2e_*.png`, `*_hitboxes.png`, `*_secuencia_juego.png`, `*_superposicion_idle.png`) — reportes, no assets de juego. El resto son hojas fuente crudas (chroma key) de personajes **ya integrados** (Wasirris y su FX azul, jefes) + FX que el juego **ya tiene**.
- `especiales_2.zip` (14 archivos): hojas fuente de jefes/luchadores + FX. 0 coincidencias byte a byte con el juego (son las fuentes sin recortar).
- **Ningún ZIP contiene frames de Sofi ni assets nuevos que falten.** Según el criterio del usuario ("si no aportan mejoras, no"), no se integra nada de los ZIP.

### Frames normales de Sofi (hojas 16+12): no consolidados
- Las hojas normales SÍ se pueden recortar (fondo blanco + outline cerrado), pero son **poses sueltas de pelea sin etiquetar**. Sofi ya tiene todos sus clips; solo una pose (brazo al aire) es claramente de victoria y no alcanza para una animación. Mapear el resto a movimientos sería **inventar**, así que no se tocaron (el usuario pidió "sin inventar"). El Modo Vestía es la consolidación real de Sofi en esta entrega.

## 2026-11-07 — sistema de juggle (combos aéreos estilo KOF 2002)

El motor **ya tenía** el sistema de juggle: un move con `launcher` manda al rival al estado `LAUNCHED` (lo lanza al aire con `pushY`); seguir golpeándolo en el aire suma `juggle++` y el daño decae (`combo.juggleDecay`); al tocar el suelo se resetea. En modo MAX, el launcher se cancela a súper (regla KOF 2002, `hit.superCancel="max"`) y el súper (muchos multi-golpe) remata al rival en el aire.

Auditoría con `tools/qa_20261106/juggle_roster.cjs` (simulación real, cuenta golpes que conectan con el rival sin tocar el suelo):
- **Antes:** 25/28 personajes con launcher lograban juggle; 4 no tenían launcher.
- **Ahora:** 28/30 con launcher logran juggle. Varios hacen combos aéreos largos: el_aedillo 5, gordo y pocheche_tijeras 4, El Paisa / mateo / morado / carmesi 3.

**Habilitado el juggle en 3 personajes editables** (marcando su gancho ascendente como launcher; verificado que NO rompe sus combos — combo_audit 22/22, 7/7, 10/10):
- `semillas`: `uppercut` (Germinación) → launcher (pushY −11). Además su `seismic` (Barrida Sísmica) estaba marcada launcher con `pushY=0` (no lanzaba): corregida a `knockdown` (una barrida derriba, no lanza).
- `wasirris`: `pulso_analitico` → launcher (pushY −10), remata con su súper Sentencia Firme.
- `valentina_niebla`: `paso_fantasma` → launcher (pushY −10), remata con Manto de Niebla.

**El Paisa Sistem** ya tenía buen juggle (uppercut → súper multi-golpe = **3 impactos en el aire**); no necesitó cambios. Evidencia visual: `qa/entrega_20261106/el_paisa_juggle_aereo.jpg`.

**Pendientes (NO tocados — son personajes generados por scripts `build_*.py` que no están en este repo; editarlos a mano se perdería al regenerar):**
- `don_garras` (jefe provisional): tiene `uppercut` launcher pero sin súper rematador → su juggle necesitaría un seguimiento (salto+aéreo con buen timing, o un súper).
- `sofi` (secreta): su único launcher es el súper `super_festiva`; para juggle necesitaría un launcher no-súper (p.ej. marcar `embestida_cuernos`, que ya es knockdown). Validado en memoria que funciona; aplicarlo requiere su `tools/build_sofi.py`.
- `warriza_wasa`, `wasita` (jefes provisionales): kit reducido, sin gancho ascendente ni súper; no tienen launcher. Necesitarían un move nuevo o marcar uno existente vía su script.
- Reporte completo por personaje: `qa/entrega_20261106/juggle_REPORTE.txt`.

**Cómo se hace un juggle** (para la ficha de comandos / el jugador): activar MAX (Puño+Especial con barra), lanzar con el gancho ascendente (↓↘→+P / →↓↘+P según el personaje) y, en el aire, rematar con el súper (↓↘→↓↘→+P). Fuera de MAX el launcher derriba pero no encadena (fiel a KOF 2002).

Herramientas nuevas en `tools/qa_20261106/`: `juggle_roster.cjs`, `juggle_test.cjs`, `juggle_trace.cjs`, `compose_juggle.py`.

## 2026-11-06 (2) — auditoría de combos/cancelaciones y pulido de El Paisa

Auditoría OBJETIVA de combos, cancelaciones y especiales ocultos de TODO el roster con la simulación real (`engine/pg_sim.js` en Node, determinista). Herramientas nuevas en `tools/qa_20261106/`:
- `combo_audit.cjs`: por cada cadena declarada en `cancelInto`, mide si el 2º golpe conecta (daño real), probando varios timings y distancias.
- `hidden_solo.cjs`: ejecuta cada especial oculto con MAX y confirma que sale y pega.
- `paisa_gaps.cjs`: calidad de los combos de El Paisa (gap entre golpes, si conecta EN hitstun = combo real).
- `combo_trace.cjs` + `compose_combo.py`: generan la tira visual del combo.

**Resultado de la auditoría (el sistema ya estaba sano):**
- Combos/cancelaciones: **505/532 cadenas completan combo; 0 referencias rotas** en todo el roster. Las 27 restantes son por diseño: EX que exigen modo MAX (`_ex`, `contragolpe`, `tiempo_extra_ex`...) o cancelaciones tras un derribo (`tackle ⇒`, `barrida ⇒ super`).
- Especiales ocultos: **12/12 salen y pegan en MAX**, con 3–9 cuadros de animación, cinemática (congelamiento + zoom) e invulnerabilidad.
- Reporte por personaje: `qa/entrega_20261106/combos_cancelaciones_REPORTE.txt`.

**No se tocó el frame data de los 31 personajes existentes**: están validados y funcionan; ajustar su balance a ciegas (sin jugar en Android) sería inventar y arriesgar romperlo.

**Pulido de El Paisa Sistem** (único con frame data de diseño propio de esta entrega):
- `talon_giro`: `startup` 12→10 y `cancelFrames` [13,18]→[11,16], para que el jab (`punch`) lo enlace en combo. Antes `punch ⇒ talon_giro` no conectaba (el rival salía del hitstun antes de la patada); ahora es combo real. Medido con `combo_audit.cjs` y `paisa_gaps.cjs`.
- Tras el ajuste: **23 cadenas de El Paisa son combos reales (0 fallidas)**; las 4 `especial ⇒ súper` restantes requieren MAX (regla KOF 2002, igual para todo el roster).
- Cambio acotado: el diff toca SOLO `el_paisa_sistem.char.json` (vía su spec); ningún otro personaje ni `config.json` cambió.
- Evidencia visual: `qa/entrega_20261106/el_paisa_combo_jab_talon.jpg` (jab → cancela a talón → impacto, golpe a golpe); verificado también en el navegador real.
- El sistema de impacto ya existente (no modificado): hitstop por tipo (súper 14, cabeza 10, fuerte 7, ligero 5), temblor, destello, chispas, contragolpe y multi-golpe.

## 2026-11-06 — frames faltantes, El Paisa Sistem y 2 fondos

Generado por `tools/integrar_entregas_20261106.py` (idempotente; `--check` lo verifica). El arte fuente queda intacto en `sources/entregas_2026-11-06/`, con los SHA-256 de cada ZIP en `ORIGEN_SHA256.txt`.

### Wasirris
- Clips nuevos: `ko_fall` (8 cuadros, 10 fps, se queda tendido), `dizzy` (8, 8 fps, en bucle) y `victory_pose` (8, 8 fps).
- La victoria anterior (2 cuadros del atlas base, 79-80) se guarda en `clips.victory_pose._prev` para poder revertirla.
- Atlas extra `wasirris_poses_extra.png`: 8×3 celdas de 313 px. La entrega (celdas de 640) se reescaló ×0.48906 = idle del atlas base (254 px) / base de la entrega (520 px). Pie medido en y=601/640, ancla 0.939063.
- `portrait.clipBox.victory_pose` recalculado para la vista previa de victoria.

### Personaje 08
- Clips nuevos: `ko_fall` (8, 10 fps) y `victory_pose` (8, 8 fps). Antes no tenía victoria propia y el motor usaba `idle`.
- Atlas extra `personaje_08_poses_extra.png`: 8×2 celdas de 112 px, escala ×0.175 (idle 91 px / 520 px).
- **`dizzy` sigue faltando**: no venía en la entrega. El motor usa su respaldo (`hurt`, y si no, `idle`).
- `down`, el derribo sin K.O., **no se tocó**: sigue siendo el cuadro más bajo de `damage_fall`. Se podría usar el último cuadro de `ko_fall`, pero mezcla dos estilos de dibujo; queda como decisión del usuario.

### El Paisa Sistem (nuevo, `el_paisa_sistem`)
- Atlas `el_paisa_sistem_atlas.png` de 18×12 celdas de 120 px. Es una copia exacta de los 216 cuadros, sin reescalar. `_frameIndex` en el `char.json` dice qué cuadros son de cada animación.
- Anclas por cuadro (`el_paisa_sistem_atlas_anchors.json`): suelo en y=111/120 (según el LEEME). En los 27 cuadros aéreos el ancla va al pie dibujado, para no sumar dos veces la altura del salto.
- `renderScale` 1.6484 = 150 / alto del idle (91 px), la misma norma que el resto del roster (~150 px lógicos).
- Clips que pide el motor: idle, walk, run, crouch_guard, jump_mobility, hurt, damage_fall, down, recovery_pose, ko_fall (cae de frente), victory_pose y front_grab. De las 39 animaciones, 25 entran en clips del motor; las otras 14, que el motor no usa (agachado, rodadas, burla, entrada, etc.), se conservan como clips `extra_*`.
- **Sin `dizzy` propio**: el paquete no lo trae, así que usa el respaldo del motor.
- Golpes (frame data de **DISEÑO**, TODO: VERIFICAR jugando):
  - Normales con los tiempos de `data/normals.json`: Puño Ligero (P), Patada Ligera (K), Puño Fuerte (→+P), Patada Fuerte (→+K), Puño Aéreo y Patada Aérea.
  - Especiales: Embestida de Hombro (↓↘→+P), Uppercut (→↓↘+P, invulnerable y lanzador), Patada de Talón con Giro (↓↘→+K) y Barrida (↓↙←+K, baja, derriba).
  - Súper Combinado (↓↘→↓↘→+P): 4 golpes de 14.
  - Agarre (Guardia+P).
- Nombres de los golpes tomados del LEEME del paquete. Las cajas de golpe se **miden del sprite** en el cuadro de impacto (la extremidad que golpea, + 4 px). Revisión visual en `qa/entrega_20261106/el_paisa_cajas_de_golpe.jpg`.
- Entrada en `data/roster.json` como `playable` (no provisional).

### Escenarios
- "Oxxo — Guadalajara 2" (`oxxo_guadalajara_2`, índice 8) y "Pemex — Guadalajara 2" (`pemex_guadalajara_2`, índice 9).
  - Una sola imagen de 1260×540, copiada byte a byte de la que se adjuntó en el chat.
  - Tema, lluvia y piso mojado copiados de los Oxxo y Pemex que ya existían.
  - Sin halos de luz: no hubo medición.
- Se agregaron **al final** porque las campañas eligen escenario por índice: ningún combate de campaña cambia de escenario.
- Los escenarios Oxxo y Pemex anteriores (con capas y público) **no se tocaron**.

### Datos
- `data/offline_assets.json` regenerado con la misma regla de antes (todo `assets/` menos `icons/` y `.txt`): 302 → 309 entradas. Se verificó primero que esa regla reproducía exactamente la lista original.

### Pruebas ejecutadas (salida real en la entrega)
- **Jugabilidad intacta**: `tools/qa_20261106/determinism.cjs` compara el proyecto original contra el nuevo, CPU nivel 3 contra CPU nivel 3, en 5 peleas completas (wasirris/p08/tobi/calavera/mateo). Vida, posición, estado, golpe, barra, mareo, fase y ronda salieron **idénticos cuadro a cuadro**; solo cambia el clip dibujado (ahora sí se usan `dizzy`, `ko_fall` y `victory_pose`).
- **Golpes de El Paisa**: `test_moves.cjs` → los 12 movimientos salen con su comando y conectan en la simulación real. El súper mete 4 golpes (54 de daño con el decaimiento de combo) a 70–110 px.
- **Robustez**: `cpu_bouts.cjs` → 24 peleas de El Paisa contra 6 rivales, CPU contra CPU; todas terminan, sin errores.
- **Navegador** (Chromium sin pantalla, `run_match.cjs`/`ui_shots.cjs`):
  - K.O. con `ko_fall`, victoria con `victory_pose`, mareo de Wasirris, escenarios 8 y 9, ficha y pantalla de comandos de El Paisa.
  - Consola: solo el aviso de `sw.js` 404 (el archivo no venía en el ZIP). Capturas en `qa/entrega_20261106/`.
- Referencias cruzadas (atlas, clips, golpes y comandos de los 32 jugables; archivos de los 10 escenarios): sin referencias rotas.
- **NO ejecutadas**: `tools/test_sim.js`, `tools/validate_data.py` y `tools/run_regression.sh`, porque no venían en los ZIP. Tampoco se probó en Android.
