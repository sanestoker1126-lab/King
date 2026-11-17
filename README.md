# Legend of Presos — Edición Google AI Studio

Fuente: `sanestoker1126-lab/King`, rama `ccr-f312e5dd-m4ve03`, commit `eb6dda094e6853ddfd9141bc0ad829ec088c9840` (16-11-2026).

Esta es una **copia de importación web**. Se conservaron íntegros los directorios de ejecución `assets/`, `data/`, `engine/`, `styles/` y las dos entradas `index.html` y `game.html`.

Se eliminaron de esta copia (no del proyecto fuente) los respaldos, fuentes de regeneración, pruebas, capturas QA, herramientas, documentación y proyecto de compilación APK. No se han modificado los atlas ni la simulación.

## Google AI Studio

En Build, seleccionar **+ → Upload ZIP file** e importar el ZIP de esta rama. Si se ofrece **Import from GitHub**, seleccionar este repositorio y esta rama cuando la interfaz lo permita.

Proyecto web **Node.js sin dependencias externas**. Scripts:
- `npm run dev`: servidor y vista previa en `0.0.0.0:3000` (o `PORT`).
- `npm start`: igual.
- `npm run build`: copia los archivos de ejecución a `dist/` para publicación estática.

Abrir `/` o `/game.html`. **No** abrir los HTML con `file://`.
El juego ya usa `PixiJS` local (`engine/pixi.min.js`). No es necesario sustituirlo por React para ejecutarlo.

El proyecto APK/Bluetooth nativo no está incluido. Para construir APK usar el repositorio original. La vista previa web no prueba Bluetooth nativo.

## Verificación recomendada

1. Comprobar que aparecen el menú, fichas, escenarios y controles táctiles.
2. Iniciar una pelea y revisar carga de JSON, imágenes, sonidos y `engine/pixi.min.js` (sin HTTP 404).
3. Probar teclado en PC y controles en modo horizontal de Android.
4. No reescribir identificadores de luchadores, pivotes, atlas, hitboxes, timings ni IA durante la importación.
5. Conservar una copia del ZIP original de la rama fuente.

Las pruebas de navegador en Google AI Studio **no se han ejecutado aquí**. 
