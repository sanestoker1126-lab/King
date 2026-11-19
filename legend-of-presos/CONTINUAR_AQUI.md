# CONTINUAR AQUÍ — Legend of Presos (estado al 2026-11-15)

Léelo primero en un chat nuevo. Detalle completo en `docs/CHANGELOG.md` y `docs/PROJECT_STATUS.md`.

## Dónde está
- Repo `sanestoker1126-lab/King`, carpeta `legend-of-presos/`.
- Ramas: `claude/legend-presos-characters-backgrounds-p7c99g` (PR #1 y #2 ya fusionados a `main`; sus 3 últimos commits, del 13 y 14-11, todavía no). Lo del 2026-11-15 está en `ccr-f312e5dd-m4ve03`, que parte de esa rama.
- Entrada real del juego: `game.html`. Necesita servidor http; en PC están `JUGAR_Windows.bat`, `JUGAR_Mac.command` y `jugar_Linux.sh`.
- Manifiesto: `MANIFEST_SHA256.txt`. Para verificarlo: `sha256sum -c --quiet MANIFEST_SHA256.txt`.

## Lo último hecho
1. **Jefes.**
   - El jefe final (Garravas) nunca se salta en Arcade: si lo eliges, es espejo.
   - En Equipos solo Garravas lleva ×2.5 vida y ×1.7 daño (`memberMods` en `data/campaigns.json`; motor: `mods[lado].members` en `engine/pg_sim.js`).
   - La sub-jefa Sofi (combate 4) tiene ×1.5 vida y ×1.3 daño (desde 2026-11-19; antes ×2/×2). Sofi ya es seleccionable desde el inicio.
2. **Sofi, Modo Vestía.**
   - Se transforma con ↓↘→↓↘→ + Patada y la barra llena, una vez por ronda (desde 2026-11-19; antes, sola a media vida).
   - Moveset con el arte real del usuario: atlas `sofi_vestia_real.png`, desde el ZIP mal llamado `POCHECHE_ATLAS_MASTER_GAME_READY.zip`.
   - Chispas de impacto propias (`vestia_*`).
   - Todo lo genera `python3 -I tools/build_sofi_vestia_real.py` (comprobación: `--check`). No editar a mano los clips `*_vestia` ni las entradas `vestia_*`.

3. **Frames de la otra versión (2026-11-13).** Del prototipo de la raíz (`public/assets/characters/`) se rescataron las hojas de reacciones de Nadia, Regente y Tobi: caída, levantada, K.O., y mareo de Tobi. Las genera `python3 -I tools/build_reacciones_prototipo.py` (`--check`).
   - Pendiente del usuario: de quién es la bestia-rata de `public/assets/characters/garravas/atlas_02.webp` (no es el Garravas ni el Don Garras del juego).
   - Pendiente del usuario: si entran al roster Callejero, Oscuro, Don Gorrón, El Killer de la Fez 104 y El Moco.
   - Pendiente del usuario: dónde están las versiones de Manus y GPT, si no son el prototipo de la raíz.
   - Pendiente técnico: cortar a mano Semillas y las filas 6 a 9 de Tobi.

4. **Conectar y recibir (2026-11-13).** El golpeado vibra durante la pausa de impacto (`render.hitShake` en `data/config.json`, solo dibujo). Auditoría de poses de los 32 en `qa/entrega_20261106/auditoria_golpes_y_reacciones.txt`.
   - Pendiente del usuario: quién es el personaje del ZIP `sources/entregas_2026-11-13/ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO.zip` y quién el del overol naranja (falta su atlas).
   - Pendiente del usuario: la historia de la Toxi Familia (integrantes y trama). No hay nada en el repo y no se debe inventar.

5. **Personaje nuevo provisional e historia (2026-11-13).**
   - `personaje_complementario` ("El Gordo Tacos", nombre del usuario 2026-11-19): generado por `python3 -I tools/build_personaje_complementario.py` (`--check`). Pendiente del usuario: ficha y si entra a la campaña. Para renombrarlo: `NAME` en el script (y, si cambia el id, `CID`).
   - Historia entre combates: `data/story.json` (6 capítulos de relleno, ocultos en el juego normal; se ven con `game.html?story=draft`). Pendiente del usuario: los textos de la Toxi Familia.
   - Personaje del overol naranja: confirmado como nuevo; falta su atlas en ZIP y su nombre.

6. **Transformación de Sofi rehecha (2026-11-14).** `python3 -I tools/build_vestia_sofi.py` (`--check`). El recorte anterior dejaba la cuadrícula a la vista sobre fondos claros. **Regla aprendida: todo atlas recortado se revisa sobre fondo claro, oscuro y de color**, no solo oscuro.

7. **Sensación de combate + "frames trabajadas" (2026-11-15).**
   - Tiempos de especiales/súpers/ocultos: `data/frame_data.json` → `python3 -I tools/build_frame_data.py` (`--check`, `--revert`). Los move con `_clipTiming` los escribe ese script: no editarlos a mano.
   - Entrega del ZIP: `python3 -I tools/integrar_frames_20261115.py` y luego `build_frame_data.py`. Pendiente del usuario: corregir el tamaño que cambia entre cuadros en Diego (mareo y victoria) y Tobi (mareo y victoria, cuadros 4 y 7).
   - Medir: `node tools/qa_20261106/feel_audit.cjs . all` (ventaja en golpe/guardia, multi-golpes, cadenas en MAX).

8. **Controles táctiles v2, IA y menús (2026-11-15).** Joystick flotante + botones en arco + arena despejada (Opciones › Controles). La CPU hace comandos reales, combos, MAX y ocultos. Menú con "Pelea rápida" y selección con fichas ya llenas. Detalle en el CHANGELOG. Pendiente: probarlo en el Android del usuario.

9. **Selector con fichas de ingreso (2026-11-16).** Hoja de bustos `assets/ui/fichas.webp`: `python3 -I tools/build_fichas.py` (`--check`). Si cambias un `portrait.body` o agregas un personaje, vuelve a correrlo y luego `python3 -I tools/integrar_entregas_20261106.py` (lista offline).

10. **APK de Android y Reto Bluetooth (2026-11-16).** Proyecto `android/` (nuevo; NO es el `ANDROID/` del usuario). Compilar: `ANDROID_HOME=… tools/build_android.sh` → `android/app/build/outputs/apk/release/app-release.apk`. Bluetooth en `engine/pg_net.js` + `android/.../BtLink.java`. **Pendiente: probarlo en dos teléfonos reales** (permisos, latencia; el retardo de entrada es `DELAY` en `pg_net.js`).

11. **Cachorro = personaje_08 (2026-11-16).** Nombre "Cachorro" (el id no cambia). Hojas limpias: `python3 -I tools/limpiar_atlas_cachorro.py` (`--check`). Líneas sueltas del roster: `python3 -I tools/limpiar_lineas_atlas.py` (`--check`). Originales en `sources/atlas_originales_2026-11-16/`. Pendiente: las rayas de piso del personaje nuevo se corrigen en su propio generador.

12. **Equilibrio y dificultad (2026-11-19).** `data/config.json › balance` (poder por personaje, tope de súpers) y `ai.levels` (CPU más suave); jefes ×1.5/×1.3 y ×1.8/×1.3. Sofi seleccionable. Modo Vestía = súper con carga (`tools/sofi_vestia_carga.py`). Para recalibrar tras cambiar golpes: `node tools/qa_20261106/calibrar_balance.cjs . 3 > r.json` y copiar `chars` a `config.json`.

13. **Nombres (2026-11-19).** luchador_v2 = Omar Harfuch · gordo = El Fanta · personaje_complementario = El Gordo Tacos · tatuado = Toker · cartel = El Brayan. Solo cambia `name`/`displayName`; los ids no. Alias de URL en `data/roster.json › aliases`.

## Cómo probar (herramientas de este repo)
```bash
cd legend-of-presos
python3 -m http.server 8000 --bind 127.0.0.1          # http://127.0.0.1:8000/game.html
python3 -I tools/build_sofi_vestia_real.py --check     # Vestía al día
python3 -I tools/integrar_entregas_20261106.py --check # generados al día
node tools/qa_20261106/arcade_bosses.cjs .             # campaña: jefe/sub-jefa
python3 -I tools/build_frame_data.py --check           # tiempos de especiales al día
python3 -I tools/integrar_frames_20261115.py --check   # entrega 2026-11-15 al día
node tools/qa_20261106/feel_audit.cjs . all            # ventaja, multi-golpes, cadenas en MAX
node tools/qa_20261106/combo_audit.cjs . all           # cadenas cancelInto (540/546)
node tools/qa_20261106/frames1115_browser.cjs http://127.0.0.1:8000 <prefijo_capturas>
node tools/qa_20261106/touch_browser.cjs http://127.0.0.1:8000 <prefijo>       # controles táctiles con toques reales
node tools/qa_20261106/menu_flow_browser.cjs http://127.0.0.1:8000 <prefijo>   # menú -> pelea en teléfono y PC
node tools/qa_20261106/net_browser.cjs http://127.0.0.1:8000 <prefijo> 5400       # reto en red entre dos pestañas (lockstep)
node tools/qa_20261106/apk_bridge_browser.cjs <url_assets_del_apk> <prefijo> 3600 # contrato con BtLink.java (puente simulado)
python3 -I tools/limpiar_atlas_cachorro.py --check     # hojas de Cachorro sin sombra ni cuadrícula
python3 -I tools/limpiar_lineas_atlas.py --check        # líneas sueltas del roster
python3 -I tools/qa_20261106/auditar_atlas.py --solo-usadas   # auditoría de hojas
node tools/qa_20261106/balance_roster.cjs . 3          # % de victorias por personaje (todos contra todos)
node tools/qa_20261106/dificultad.cjs . 60             # qué tan difícil es cada nivel de CPU
node tools/qa_20261106/vestia_carga.cjs .              # Modo Vestía con carga
python3 -I tools/sofi_vestia_carga.py --check
python3 -I tools/build_fichas.py --check                # hoja de fichas y fondo del selector al día
node tools/qa_20261106/selector_perf.cjs http://127.0.0.1:8000   # MB al abrir la selección y fluidez del carrusel
node tools/qa_20261106/ai_stats.cjs . 3 24                                     # qué hace la CPU (especiales, combos, súpers)
node tools/qa_20261106/bosses_check.cjs <copia_anterior> .   # determinismo + mods por integrante
node tools/qa_20261106/determinism.cjs <copia_anterior> . sofi tobi 777 9000
node tools/qa_20261106/vestia_real.cjs http://127.0.0.1:8000 <prefijo_capturas>
```
`tools/test_sim.js`, `tools/validate_data.py` y `tools/run_regression.sh` (la regresión oficial) **no están en este repo**: no se corrieron.

## Pendiente: decisiones del usuario
- Qué pose del atlas Vestía va en cada golpe y qué chispa usa cada uno. Las tablas están en `MAP` y `HIT_VESTIA` dentro de `tools/build_sofi_vestia_real.py`.
- Si los valores del jefe (×2.5 vida, ×1.7 daño) se quedan. Son de diseño, ajustar jugando.
- La petición de "niveles al doble de ancho y alto, fondos en parallax, submarino y espacio con menos gravedad" **era de otro chat**. Aquí no se tocó nada de eso.
- Lo de siempre: carpeta `ANDROID/` (ya hay un proyecto propio en `android/`; si quieres el tuyo, pásalo para conservar tu applicationId y tu firma), los 22 WAV de audio, la lista de nombres y trama, y `sw.js` (falta; da un 404 en consola).

## Pendiente: técnico
- La pose de derribada Vestía está recostada (71 px de alto; la base, acostada, mide 37).
- La CPU casi no usa los especiales: en las pruebas no salieron el barrido ni el estallido del súper.
- No se ha probado en Android ni compilado APK.
