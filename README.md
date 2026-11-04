# Puente Grande · Arcade Club

Prototipo de juego de peleas para navegador, creado con los tres paquetes de recursos adjuntos de Puente Grande. Incluye seis luchadores, cinco escenarios, rival CPU en tres dificultades, partidas al mejor de tres rondas, efectos de sonido y controles de teclado y táctiles.

## Jugar en GitHub Pages

Dirección del juego después de activar la publicación:

**https://sanestoker1126-lab.github.io/The-King-the-presos-/**

En el repositorio, abre **Settings → Pages → Build and deployment → Source** y selecciona **GitHub Actions**. Luego, en **Actions → Publicar Puente Grande → Run workflow**, ejecuta el flujo sobre `main`. El enlace queda disponible cuando termina la publicación. Los siguientes cambios en `main` se publican automáticamente.

El flujo verifica los 71 recursos, ejecuta las pruebas del motor y compila con la ruta del repositorio. No necesita secretos adicionales ni copiar manualmente archivos compilados al repositorio. Para generar esa misma versión localmente:

```bash
npm run build:pages
```

## Desarrollo

Requisitos: Node.js 22.12 o superior (validado con Node.js 24.19), npm y Chromium para las pruebas de navegador.

```bash
cd /workspace/The-King-the-presos-
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm run dev -- --port 5173 --strictPort
```

El servidor de desarrollo usa el puerto 5173. No requiere claves API, base de datos ni servicios externos. El sonido se activa manualmente; las victorias se guardan localmente en el navegador cuando el almacenamiento está disponible.

## Controles

| Acción | Teclas |
| --- | --- |
| Moverse | A / D o ← / → |
| Saltar | W o ↑ |
| Bloquear | S o ↓ |
| Golpe | J |
| Patada | K |
| Especial | L |
| Pausar | Esc |

En móvil, los botones aparecen bajo la arena al iniciar una partida. El especial consume energía y tiene enfriamiento. Los golpes y saltos se activan al pulsar; mantenerlos presionados no los repite. Acércate para golpear al rival. Cada round dura 45 segundos y el resultado compara la salud al agotarse el tiempo; una partida termina con dos victorias o al completar tres rounds.

## Cancelaciones por personaje

Conecta un impacto limpio y pulsa el siguiente botón de la cadena para cancelar la recuperación. El panel bajo la arena muestra cuándo enlazar. Una pulsación adelantada se conserva brevemente; mantener una tecla no repite el ataque. Cada enlace cuesta 5 de energía adicionales y respeta el coste y enfriamiento del especial. No se puede cancelar sobre un fallo o una guardia.

| Mateo | Tobi | Nadia | Semillas | Oscuro | Callejero |
| --- | --- | --- | --- | --- | --- |
| J → K → L | J → J → L | K → J → L | K → K → J | K → L | J → L → K |

Las ventanas, límites, decisiones de diseño y pruebas están en [docs/cancelaciones.md](docs/cancelaciones.md).

## Validación y compilación

```bash
npm run verify:assets
npm test
npm run test:e2e
npm run build
```

Las pruebas de navegador usan `/usr/bin/chromium` por defecto. En otra máquina se puede indicar su ruta con `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. La compilación estática se genera en `dist/`; puede servirse con `npm run preview -- --port 4173 --strictPort`.

## Recursos y alcance

Los 71 recursos originales permanecen en `public/assets`: 41 atlas de personajes, ocho atlas de efectos, cinco fondos y 17 audios. Los tres manifiestos conservan sus rutas, tamaños y SHA256 originales. `scripts/verify-assets.mjs` comprueba todos los hashes; `catalog.json` reúne dimensiones, fotogramas y formatos.

Los paquetes nombran el archivo `Puente-Grande-CORE-040-PIXI.html`, pero no lo contienen. El motor de combate y la interfaz son nuevos. Las animaciones se infirieron al inspeccionar visualmente los atlas y se marcan como `inferred` en el catálogo. Los seis luchadores comparten estadísticas base de ataque, pero tienen rutas y ventanas de cancelación distintas. Los mapas artísticos y pivotes siguen pendientes de las correcciones documentadas en la auditoría. Los recursos restantes se conservan para futuras ampliaciones.

Algunos audios tienen extensión `.wav` pero contienen Ogg. La aplicación usa el MIME real del catálogo al reproducirlos, sin alterar los originales. Ningún texto adjunto se ejecuta como instrucciones.

## Auditoría de personajes

La auditoría de combate y atlas se documenta en [docs/auditoria-personajes.md](docs/auditoria-personajes.md). Para regenerar la evidencia desde este checkout:

```bash
node scripts/audit-combat.mjs
python3 scripts/audit-characters.py
npm run dev -- --port 5173 --strictPort
```

El analizador de imágenes requiere Python 3 con Pillow. El visor de desarrollo está en la ruta `/tools/fighter-audit.html` del servidor Vite y permite inspeccionar todos los atlas, cuadros, transparencia y el pivote actual. Los informes generados quedan en `audit-output/`, fuera del control de versiones. Las rejillas desconocidas y las acciones inferidas se señalan como tales; estos informes no certifican que los movimientos sean únicos ni que los pivotes sean anatómicamente correctos.

`node scripts/audit-combat.mjs --strict` devuelve un estado de error si falla la unicidad, las cancelaciones o la cobertura de animaciones. Las rutas nuevas pasan sus comprobaciones; los mapas visuales incompletos siguen haciendo fallar el modo estricto. Generar un informe correctamente no significa aprobar toda la auditoría.

`node scripts/audit-late-contact.mjs` repite el barrido adicional y el caso histórico de J→J emergente con intervalos variables. En el motor actual ese caso concreto termina con el segundo golpe bloqueado; la cadena nueva de Tobi se prueba por separado como cancelación confirmada.

## Entorno en la nube

Cada tarea ya tiene su propio entorno aislado. Usa este checkout existente; no hace falta crear un worktree. Las dependencias y `dist/` pueden conservarse en una instantánea; el servidor debe arrancarse de nuevo en cada instancia. Los comandos de instalación e inicio se guardan también en la configuración del entorno para revisión y publicación por el usuario.
