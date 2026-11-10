# CONTINUAR AQUÍ — Legend of Presos (estado al 2026-11-10)

Léelo primero en un chat nuevo. Detalle completo en `docs/CHANGELOG.md` y `docs/PROJECT_STATUS.md`.

## Dónde está
- Repo `sanestoker1126-lab/King`, carpeta `legend-of-presos/`.
- Rama de trabajo: `claude/legend-presos-characters-backgrounds-p7c99g`.
- PR #1 a `main`, abierto. Lo nuevo va en la misma rama.
- Entrada real del juego: `game.html`. Necesita servidor http; en PC están `JUGAR_Windows.bat`, `JUGAR_Mac.command` y `jugar_Linux.sh`.
- Manifiesto: `MANIFEST_SHA256.txt`. Para verificarlo: `sha256sum -c --quiet MANIFEST_SHA256.txt`.

## Lo último hecho
1. **Jefes.**
   - El jefe final (Garravas) nunca se salta en Arcade: si lo eliges, es espejo.
   - En Equipos solo Garravas lleva ×2.5 vida y ×1.7 daño (`memberMods` en `data/campaigns.json`; motor: `mods[lado].members` en `engine/pg_sim.js`).
   - La sub-jefa Sofi (combate 4) tiene ×2 vida y ×2 daño, y se desbloquea al ganarle.
2. **Sofi, Modo Vestía.**
   - Se transforma sola a media vida, una vez por ronda, y pelea transformada.
   - Moveset con el arte real del usuario: atlas `sofi_vestia_real.png`, desde el ZIP mal llamado `POCHECHE_ATLAS_MASTER_GAME_READY.zip`.
   - Chispas de impacto propias (`vestia_*`).
   - Todo lo genera `python3 -I tools/build_sofi_vestia_real.py` (comprobación: `--check`). No editar a mano los clips `*_vestia` ni las entradas `vestia_*`.

## Cómo probar (herramientas de este repo)
```bash
cd legend-of-presos
python3 -m http.server 8000 --bind 127.0.0.1          # http://127.0.0.1:8000/game.html
python3 -I tools/build_sofi_vestia_real.py --check     # Vestía al día
python3 -I tools/integrar_entregas_20261106.py --check # generados al día
node tools/qa_20261106/arcade_bosses.cjs .             # campaña: jefe/sub-jefa
node tools/qa_20261106/bosses_check.cjs <copia_anterior> .   # determinismo + mods por integrante
node tools/qa_20261106/determinism.cjs <copia_anterior> . sofi tobi 777 9000
node tools/qa_20261106/vestia_real.cjs http://127.0.0.1:8000 <prefijo_capturas>
```
`tools/test_sim.js`, `tools/validate_data.py` y `tools/run_regression.sh` (la regresión oficial) **no están en este repo**: no se corrieron.

## Pendiente: decisiones del usuario
- Qué pose del atlas Vestía va en cada golpe y qué chispa usa cada uno. Las tablas están en `MAP` y `HIT_VESTIA` dentro de `tools/build_sofi_vestia_real.py`.
- Si los valores del jefe (×2.5 vida, ×1.7 daño) se quedan. Son de diseño, ajustar jugando.
- La petición de "niveles al doble de ancho y alto, fondos en parallax, submarino y espacio con menos gravedad" **era de otro chat**. Aquí no se tocó nada de eso.
- Lo de siempre: carpeta `ANDROID/`, los 22 WAV de audio, la lista de nombres y trama, y `sw.js` (falta; da un 404 en consola).

## Pendiente: técnico
- La pose de derribada Vestía está recostada (71 px de alto; la base, acostada, mide 37).
- La CPU casi no usa los especiales: en las pruebas no salieron el barrido ni el estallido del súper.
- No se ha probado en Android ni compilado APK.
