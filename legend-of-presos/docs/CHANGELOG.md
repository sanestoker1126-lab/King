# CHANGELOG

> Los ZIP recibidos el 2026-11-06 no traían `docs/`, así que **el historial anterior no está aquí**. Si tienes el `docs/CHANGELOG.md` completo, pega esta entrada al principio del tuyo.

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
