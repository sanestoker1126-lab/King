# PROJECT_STATUS — Legend of Presos

> Estado al **2026-11-06**, verificado sobre esta carpeta. Los ZIP recibidos no traían `docs/` ni `CONTINUAR_AQUI.md`; si tienes las versiones completas, este archivo **solo describe lo que se pudo comprobar aquí**.

## Qué funciona (comprobado hoy)
- `game.html` carga en Chromium y se puede pelear. Consola limpia salvo el aviso de PWA por `sw.js` 404 (el archivo no venía en el ZIP).
- 32 personajes jugables (31 de antes + El Paisa Sistem) y 10 escenarios (8 de antes + Oxxo 2 y Pemex 2). No hay referencias rotas en atlas, clips, golpes ni comandos.
- Wasirris: K.O., mareo y victoria con arte nuevo. Personaje 08: K.O. y victoria con arte nuevo.
- Jugabilidad intacta: las peleas CPU contra CPU con semilla fija dan el mismo resultado cuadro a cuadro que antes de esta entrega (`tools/qa_20261106/determinism.cjs`).

## Qué NO se pudo verificar
- `tools/test_sim.js` (la "huella" de 197 pruebas), `tools/validate_data.py` y `tools/run_regression.sh` no venían en los ZIP y no se corrieron.
- Android: no hay carpeta `ANDROID/` y no se compiló ningún APK.
- El "feel": daños, tiempos y cajas de El Paisa son **DISEÑO**, hay que ajustarlos jugando.
- Fidelidad del arte: los manifests de Wasirris y Personaje 08 dicen que sus poses nuevas son generativas, hechas desde JPEG de baja resolución, con "revisión artística pendiente".

## Pendientes
1. **Personaje 08: falta `dizzy`** (8 cuadros, según su manifest). Hoy usa el respaldo del motor.
2. **El Paisa Sistem: falta `dizzy`**. Además, el motor no usa 14 de sus animaciones (agachado, rodadas, burla, entrada, golpe recibido por altura); necesitarían soporte del motor.
3. Jugar en Android y ajustar a El Paisa:
   - el súper usa una sola caja para sus 4 golpes (medida en el recto);
   - la CPU casi solo usa su primer especial, la Embestida (igual que con todos los personajes).
4. Decidir:
   - si "Oxxo — Guadalajara 2" y "Pemex — Guadalajara 2" se quedan como escenarios aparte o reemplazan a otros;
   - sus nombres;
   - si El Paisa entra a campañas (hoy no está en `data/campaigns.json`).
5. Lo que ya estaba pendiente en el proyecto completo (ver tu `CONTINUAR_AQUI.md`): sincronizar `ANDROID/`, los 22 WAV de audio y la lista de nombres y trama.
6. Reponer en este repo `sw.js`, `tools/`, `docs/` y `qa/` del proyecto completo, para poder correr la regresión oficial.

## Cómo seguir
```bash
cd legend-of-presos
python3 -m http.server 8000 --bind 127.0.0.1           # http://127.0.0.1:8000/game.html
python3 -I tools/integrar_entregas_20261106.py --check   # ¿generados al día?
node tools/qa_20261106/test_moves.cjs . el_paisa_sistem personaje_08
node tools/qa_20261106/cpu_bouts.cjs . el_paisa_sistem tobi,wasirris,personaje_08
node tools/qa_20261106/determinism.cjs <copia_original> . wasirris personaje_08 777 20000
```
