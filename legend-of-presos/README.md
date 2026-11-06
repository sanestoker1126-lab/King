# Legend of Presos — El Escape de Puente Grande

Juego de pelea 2D estilo KOF (JavaScript sin compilar + PixiJS v8, simulación determinista a 60 Hz, PWA).
**Entrada real: `game.html`** (`index.html` es una copia idéntica).

## Cómo correrlo

```bash
cd legend-of-presos
python3 -m http.server 8000 --bind 127.0.0.1
# abrir http://127.0.0.1:8000/game.html
```

Abrir `game.html` con doble clic no funciona: tiene que servirse por http(s).

## De dónde salió esta carpeta

Se armó el 2026-11-06 con los 4 ZIP que entregó el usuario (código + `assets.zip` + `combat.zip` + `combat_2.zip`), más las entregas de arte de ese día. Los SHA-256 de todo lo recibido están en `sources/entregas_2026-11-06/ORIGEN_SHA256.txt`.

**Esos ZIP NO traían** `sw.js`, `tools/` (`test_sim.js`, `validate_data.py`, `run_regression.sh`, `build_*.py`), `docs/`, `qa/`, `CONTINUAR_AQUI.md`, `MANIFEST_SHA256.txt`, `combate.html` ni `ANDROID/`. Por eso:
- la consola muestra un aviso de PWA (`sw.js` 404). El juego funciona igual, pero sin modo offline;
- las pruebas oficiales del proyecto (`test_sim`, `validate_data`, regresión) **no se pudieron correr**;
- `data/runtime_manifest.json` nombra 28 archivos de `assets/characters/` y `assets/specials/` que no vinieron. El motor no lee ese archivo.

## Qué se agregó el 2026-11-06

| Qué | Dónde |
| --- | --- |
| Wasirris: `ko_fall`, `dizzy` y `victory_pose` nuevos (8 cuadros c/u) | `assets/combat/wasirris/wasirris_poses_extra.png` |
| Personaje 08: `ko_fall` y `victory_pose` nuevos (8 c/u). **Sin `dizzy`**: no se entregó | `assets/combat/personaje_08/personaje_08_poses_extra.png` |
| **El Paisa Sistem**, personaje nuevo (216 cuadros, 39 animaciones) | `assets/combat/el_paisa_sistem/`, `data/roster.json` |
| Escenarios nuevos "Oxxo — Guadalajara 2" y "Pemex — Guadalajara 2" (índices 8 y 9) | `assets/stages/guadalajara_*_2.png`, `data/stages.json` |

Todo lo genera `tools/integrar_entregas_20261106.py` a partir del arte archivado en `sources/entregas_2026-11-06/` y de `tools/specs/el_paisa_sistem_spec.json`. **No edites a mano** esos `char.json`: cambia la especificación y vuelve a correr el script.

```bash
python3 -I tools/integrar_entregas_20261106.py           # regenera (idempotente)
python3 -I tools/integrar_entregas_20261106.py --check   # solo verifica que todo esté al día
```

Detalles, pruebas y pendientes: `docs/CHANGELOG.md` y `docs/PROJECT_STATUS.md`.

## Verificar la integridad

```bash
cd legend-of-presos && sha256sum -c MANIFEST_SHA256.txt --quiet && echo OK
```
