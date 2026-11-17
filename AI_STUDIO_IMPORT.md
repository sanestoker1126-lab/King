# Instrucción para Google AI Studio (Build)

Importa esta carpeta como proyecto web existente, NO como un juego nuevo. Ejecuta `npm run dev` en el puerto configurado por `PORT`. La entrada del juego es `index.html` (idéntica a `game.html`).

Requisitos:
- Preservar JS de `engine/`, PixiJS 8 local, JSON de `data/`, CSS de `styles/` y TODOS los recursos de `assets/`.
- Respetar rutas relativas (`assets/`, `data/`, `engine/`, `styles/`) y el árbol de archivos. No anteponer rutas absolutas.
- No rehacer el motor en React ni sustituir personajes por imágenes generadas.
- Mantener la física, 60 Hz, sincronización, hitboxes, combos, especiales, controles móviles y lógica de IA.
- Primero verificar que se puede abrir el menú y comenzar un combate con todos los recursos.
- Si la vista previa falla, corregir exclusivamente el servidor, los MIME, las rutas o la configuración de ejecución; no alterar el gameplay sin demostrar la causa.
- El servidor ya se incluye como `server.mjs`; `npm run build` crea una copia publicable en `dist/`.
- Esta edición no contiene el código del empaquetado Android nativo ni la conectividad Bluetooth específica del APK.

Tras importar, ejecutar una comprobación de recursos faltantes (404), consola y controles táctiles.
