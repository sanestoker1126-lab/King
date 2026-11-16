# CHANGELOG

> Los ZIP recibidos el 2026-11-06 no traían `docs/`, así que **el historial anterior no está aquí**. Si tienes el `docs/CHANGELOG.md` completo, pega esta entrada al principio del tuyo.

## 2026-11-16 (2) — APK de Android compilado y RETO BLUETOOTH (dos teléfonos)

Pedido del usuario: el juego con todas las mejoras, listo para Android, y la opción de retar por Bluetooth.

### APK (compilado aquí, verificado; NO probado en un teléfono)
- Proyecto nuevo `android/` (Gradle, AGP 8.7.3, compileSdk/targetSdk 35, minSdk 24 = Android 7). **No es el proyecto `ANDROID/` del usuario** (no está en el repo): `applicationId` nuevo `mx.legendofpresos.juego` y firma propia, así que se instala APARTE de cualquier versión anterior y no la actualiza.
- `MainActivity.java`: WebView a pantalla completa, horizontal, pantalla siempre encendida, modo inmersivo. Sirve el juego desde los assets del APK con origen `https://appassets.androidplatform.net/assets/` (equivalente a WebViewAssetLoader, sin dependencias externas: Maven Central respondía 429). Botón Atrás = Esc del juego. `AndroidBridge.playHaptic` = vibración nativa por tipo de golpe.
- `BtLink.java`: Bluetooth clásico RFCOMM. Anfitrión visible 120 s con socket inseguro (sin vinculación) y seguro a la vez; invitado: vinculados + búsqueda; conexión con reintento seguro; una línea JSON por mensaje; escritura en un hilo aparte. Permisos de "dispositivos cercanos" (Android 12+) o ubicación (Android 7–11), pedidos al usarlos.
- El juego NO se copia al repo: la tarea `copyGame` lo toma de la carpeta del proyecto en cada compilación (fuera: sources/ qa/ tools/ docs/ android/). Compilar: `ANDROID_HOME=… tools/build_android.sh`.
- Firma de PRUEBA guardada en `android/firma-prueba.keystore` (la llave debug estándar de Android, contraseña "android"): cualquier APK compilado después actualiza a este sin desinstalar. **No es secreta y no sirve para Play Store.**
- Verificado: `apksigner verify` OK; `aapt2 dump badging` (paquete, SDK y permisos); los **368 archivos del juego dentro del APK son idénticos** (SHA-256) a los del proyecto. Tamaño: 71.5 MB.
- **No se pudo ejecutar** en un emulador (este equipo no tiene virtualización `/dev/kvm`) ni en un teléfono.

### Reto Bluetooth (`engine/pg_net.js`, `engine/pg_game.js`, `engine/pg_frontend.js`)
- Menú › **Reto Bluetooth**: "Crear sala" (1P) o "Buscar rival" (2P) → **sala** con la estética del selector: cada quien elige su luchador, el anfitrión el escenario; "¡Listo!" en los dos → arrancan juntos con la semilla y las reglas del anfitrión.
- **Lockstep**: la simulación es determinista, así que cada teléfono simula la pelea completa y solo se mandan los botones de cada cuadro (un entero). Retardo de entrada: 3 cuadros (50 ms). Si la entrada del rival no ha llegado, se espera (no se adivina). Cada 60 cuadros se compara una huella del estado; si difiere, se corta la pelea y se avisa (no se oculta).
- En red la pausa NO congela (el otro seguiría esperando): ofrece seguir o abandonar. Desconexión o abandono: se corta y se avisa ("Tu rival abandonó el reto.", "Se perdió la conexión…"). Al terminar, resultado y de vuelta a la sala para la revancha.
- En el navegador (sin APK) el modo explica que necesita la app de Android: un navegador no puede conectar dos teléfonos por Bluetooth.
- Arreglado de paso: el menú ahora tiene 7 tarjetas; los títulos largos se achican solos hasta caber (medido en 6 tamaños de pantalla).

### Pruebas (salida real)
- `tools/qa_20261106/net_browser.cjs`: dos pestañas con el transporte de prueba (`game.html?net=test`), cada lado jugado por la IA a través de la red. Pelea COMPLETA: **1960 cuadros comparados, 0 distintos**; resultados coherentes (una vio "Perdiste 0–2" y la otra "¡Ganaste! 0–2"); aviso al desconectarse.
- `tools/qa_20261106/apk_bridge_browser.cjs`: los archivos EXTRAÍDOS del APK servidos en `/assets/game.html` (la misma ruta del WebView) + un `AndroidBridge` simulado que se comporta como `BtLink.java`. El juego usa el transporte "bt"; **3495 cuadros comparados, 0 distintos**; vibración llamada; Atrás en pelea abre la pausa del reto; abandono avisado.
- Regresión: menú→pelea (teléfono y PC), controles táctiles, entrega 2026-11-15, ocultos 12/12, combos 540/546, jefes OK, IA sin errores, generadores al día.

### Límites (honestos)
- **Bluetooth real sin probar**: falta probarlo con dos teléfonos. Puntos de riesgo: permisos según la marca, la búsqueda que algunos teléfonos limitan, la latencia real (si se siente "pesado" se sube el retardo de 3 cuadros) y teléfonos con versiones de WebView muy distintas (la huella avisaría de una desincronización).
- El reto es 1 contra 1 por rondas (no Equipos).
- En el transporte de prueba hubo esperas frecuentes porque las dos pestañas compartían la CPU de este equipo; no es una medición del Bluetooth.

## 2026-11-16 — Selector: fichas de ingreso, carrusel ligero y estética de Puente Grande / Guadalajara

Pedido del usuario: cartas y selector más profesionales, optimizados, fluidos, con estética de calle peligrosa y oscura, Jalisco, el penal de Puente Grande y el crimen organizado de la región.

### Lo que estaba mal (medido)
- **Cada carta descargaba el atlas completo de su personaje** para recortar una cara de ~38 px escalada a 112 (borrosa): **20.3 MB** al abrir la selección.
- **El carrusel reescribía 4 variables de estilo en las 33 cartas en cada cuadro** de desplazamiento (más perspectiva 3D, cartas solapadas con margen negativo y `filter` en cada cara).
- **La carta mostraba "ENERGÍA 1050 / 300"** con el campo `vida` del char.json, pero **el simulador no lo usa**: todos pelean con `fighters.hp` = 300. Era un dato falso.

### Cambios
- **`tools/build_fichas.py`** (nuevo, `--check`): una sola hoja `assets/ui/fichas.webp` (33 bustos 3:4, 257 KB) + `assets/ui/fichas.json`. El busto es la mitad superior de `portrait.body` (la silueta del idle ya medida), sin salirse de ella (nunca entra el cuadro vecino del atlas). Escalado nítido para pixel art (vecino más cercano a múltiplo entero, luego Lanczos). También genera `assets/ui/selector_fondo.webp` (13 KB): la calle del OXXO de Guadalajara, desenfocada y oscurecida de antemano (sin filtros CSS en el teléfono).
- **Carta = ficha de ingreso del CEFERESO**: regla de estatura de foto de filiación de fondo, busto, franja roja "CEFERESO · N.º de reo", placa negra con nombre y alias, sello solo si el roster dice PROVISIONAL o SECRETO, e **iconos de rasgos reales** leídos de sus datos (arrojadizo, antiaéreo, llave de comando, golpe bajo, oculto en MAX). Se quitó la "energía" falsa.
- **Carrusel** (`enableRosterRail`): desplazamiento nativo con imán al centro; solo cambian dos clases (`pg-center` / `pg-near`) en la carta del centro y sus vecinas. El expediente grande se actualiza cuando el carrusel se detiene (110 ms), no por cada carta que pasa. Las vistas previas ya no miden su lienzo en cada cuadro (`ResizeObserver`). Corregido: en Equipos/Torneo la carta del centro no se marcaba (se pintaba antes de que existieran las cartas).
- `setMug` (caras de Equipos, Torneo, VS, HUD de equipos) usa la misma hoja, encajando la celda sin deformarla.
- **Estética del selector**: fondo de calle de Guadalajara de noche con luz de sodio y líneas de monitor; cabecera "CEFERESO N.º 2 · PUENTE GRANDE, JALISCO"; expedientes 1P/2P con pestaña de color y cinta de peligro amarilla y negra; VS inclinado; barra inferior de asfalto con cinta de peligro.
- **No se usó ninguna insignia, logo ni nombre de una organización criminal real**: la ambientación es el penal, la calle y la región (Guadalajara, Jalisco), como en el resto del juego.

### Medido (`tools/qa_20261106/selector_perf.cjs`, Pixel 7 emulado; deslizar 2 s con CPU ×4 más lenta; varía entre corridas)
- Descarga al abrir la selección: **20.3 MB → 1.7–2.8 MB**. Hasta ver todas las caras: ~700 ms → ~90 ms.
- Deslizar: **50–52 fps → 58 fps**; recálculo de estilos **455–481 ms → 89–123 ms**. El peor cuadro sigue variando entre 33 y 67 ms en las dos versiones (es una medición ruidosa); no lo doy por resuelto.
- `menu_flow_browser.cjs` (teléfono y PC), `touch_browser.cjs` y las capturas de Selección, Equipos y Torneo: sin errores. Evidencia: `qa/entrega_20261106/selector_fichas_antes_despues.jpg`.

### Límites
- Los bustos salen del idle de cada personaje: los de pose muy abierta (Personaje 08, Mecánico) quedan más chicos en su ficha.
- Las cartas de Personaje 08 y otros sin perfil muestran "S/N" (sin número de reo): no se inventaron números.
- No probado en un Android físico.

## 2026-11-15 (2) — Controles táctiles v2, IA con comandos reales, menú y selección rehechos

Pedido del usuario: mejores controles para Android sin que los botones estorben, ajuste de escala, IA que haga combos y especiales, y un menú/selector más compacto, estético y fácil para empezar a pelear.

### Diagnóstico (capturas reales en un Pixel 7 emulado, horizontal 863×360)
- La arena ocupaba todo el ancho: el joystick y 7 botones en cuadrícula quedaban ENCIMA de los luchadores (un luchador contra la pared derecha quedaba bajo los botones). "Cajas" (depuración) visible para el jugador.
- Selección: arrancaba con 1P "Personaje 08" y 2P vacío; "Pelear" bloqueado hasta elegir los dos; la fila de 10 escenarios no cabía.
- Menú: descripciones cortadas ("Campaña · 6 co…").
- **Bug del lector de comandos** (motor): ↘ contaba como el primer → del DP. Un ↓↘↘↘→ (mantener ↘ un par de cuadros, lo normal con el pulgar o con palanca) salía como gancho en vez del especial de cuarto de círculo. Medido: antes ↓↘↘↘→+P = `uppercut`; ahora = `fireball`; →↓↘+P sigue siendo `uppercut`.
- **IA**: solo pulsaba el botón de atajo "especial", que siempre lanza el PRIMER especial de la lista (por eso la CPU casi solo hacía la Embestida); nunca hacía un súper por comando ni un oculto.

### Controles táctiles v2 (`engine/pg_touch.js`, `styles/game.css`)
- Joystick **flotante** (aparece donde apoyas el pulgar en la mitad izquierda; si el pulgar se pasa del borde, la base lo sigue) o fijo. 8 direcciones por sectores de 45° con **histéresis de 10°**: los ↓↘→ y →↓↘ salen limpios aunque el pulgar tiemble. Flechas que se iluminan con la dirección activa.
- Botones en **arco estilo arcade**: Puño, Patada, Especial y Súper grandes; Guardia junto al pulgar; MAX (Puño+Especial) y ROD (Puño+Patada) pequeños arriba. Etiquetas P/K/ESP/SÚP o A/B/C/D.
- **Deslizar**: un dedo que pasa de un botón a otro suelta el primero y pulsa el siguiente (encadenar sin levantar el pulgar). Multitáctil real (cada dedo, un botón).
- **Arena despejada** (por defecto): el render (`setSafe` en `engine/pg_render.js`) coloca y escala la arena ENTRE el joystick y los botones, apoyada abajo; el fondo del escenario se amplía alrededor del suelo para cubrir la pantalla (`artBounds`/`zoomBack` en `engine/pg_stage.js`). Opción "Inmersiva" = pantalla completa como antes. Solo dibujo: la simulación no cambia. En la pausa la arena ya no salta de tamaño.
- En táctil: Pausa como icono en la esquina; "Cajas" solo con teclado (F) o Entrenamiento.
- **Opciones › Controles** (pestaña nueva): Controles táctiles, Arena, Tamaño (70–140 %), Opacidad (30–100 %), Joystick flotante/fijo, Diestro/Zurdo, Etiquetas, Zona muerta, Restablecer; con **miniatura a escala** de tu pantalla que se actualiza al cambiar cada opción. Valores nuevos en `engine/pg_store.js`.

### Motor
- `engine/pg_sim.js`: el DP exige un → **puro** al inicio (arreglo del bug de arriba). Cambia la jugabilidad a propósito: ↘↓↘ ya no es atajo de DP.

### IA (`engine/pg_ai.js`, `data/config.json` ai.levels.combo/maxUse)
- **Ejecutor de comandos**: la CPU hace los movimientos reales del personaje (↓↘→, →↓↘, medias lunas, ↓↘→↓↘→) cuadro a cuadro, leídos de SUS datos (`inputs.*`).
- **Confirmación de golpe**: si su golpe conectó, cancela a especial (prefiere uno que derribe), y en difícil a súper o, en MAX, a oculto, respetando las reglas del juego (especial → súper solo en MAX). En guardia, a veces presiona con un especial.
- **MAX** con media barra (difícil), **juggle** (súper/oculto sobre el rival lanzado, en MAX), **antiaéreo** con su gancho real solo contra saltos de verdad, **castigo** de golpes fallados (solo después de que la fase activa del rival pasó sin conectar), zonificación con su arrojadizo real y entradas con su embestida.
- Medido con `tools/qa_20261106/ai_stats.cjs` (24 peleas CPU contra CPU, difícil). Antes → ahora:
  - especiales distintos usados: 7 → 31; por pelea: 1.9 → 6.4;
  - % de especiales que conectan (golpe o guardia): 44 % → 46 %;
  - súpers: 2 → 10; ocultos: 0 → 8; combos de 2+ golpes por minuto: 5.7 → 9.1.
  - El fácil casi no hace especiales (10.7/min, sin combos dirigidos).
  - Errores en dos iteraciones, corregidos antes de entregar: antiaéreo contra rivales que la propia CPU lanzó, "entrada" evaluada cada cuadro desde lejos, y castigo durante el ARRANQUE rival (dos CPU se castigaban en bucle).

### Menú principal y selección (`engine/pg_frontend.js`, capa final de `styles/game.css`)
- Menú v3: marca + **Pelea rápida** (tu último duelo; la primera vez Tobi contra un rival al azar; nunca deshabilitada) + 6 tarjetas de modo con icono SVG. Sin textos cortados en teléfono ni en PC. Medido: del menú a pelear en **3.3 s con un toque** (incluye la pantalla VS).
- Selección: las dos fichas empiezan llenas (Tobi + rival al azar) y **Pelear** queda listo y enfocado; tocar una carta cambia la ficha activa. Escenario en un selector compacto ‹ nombre ›. Botón "Al azar". En teléfono horizontal se ocultan la cabecera y las ayudas de teclado para dar espacio.

### Pruebas (salida real)
- `touch_browser.cjs` (toques reales por CDP en Pixel 7): arena despejada (paredes en x=157 y 616; joystick hasta 136; botones desde 643), ↓↘→+P con joystick = `fireball`, deslizar Puño→Patada OK.
- `menu_flow_browser.cjs` (teléfono y 1280×720): Pelea rápida → combate en 3.3 s; Versus → Pelear sin elegir nada → combate; escenario cambia; salir por Pausa → menú. Consola: solo el 404 de `sw.js`.
- `frames1115_browser.cjs`, `hidden_solo` 12/12, `combo_audit` 540/546 (sin cambios), `arcade_bosses` OK, `cpu_bouts` sin errores.
- Evidencia: `qa/entrega_20261106/controles_menu_antes_despues.jpg`, `opciones_controles.jpg`.

### No hecho / límites
- Probado en Chromium emulando un Pixel 7, **no en un Android físico**. Sin APK.
- En arena despejada los luchadores se ven más chicos (la arena mide ~490 de 863 px de ancho en ese teléfono); la opción Inmersiva lo revierte.
- El "Al azar" y el escenario de Pelea rápida usan `Math.random` en el menú (fuera de la simulación determinista).
- Las demás pantallas (Equipos, Torneo, Resultados) conservan su estilo anterior.

## 2026-11-15 — Sensación de combate: tiempos coherentes en especiales, multi-golpes, guardia y entrega "frames trabajadas"

Pedido del usuario: pulir combos, cancelaciones y que los cuadros del personaje y de los golpes concuerden, que cada impacto tenga reacción, incluyendo los especiales ocultos. Durante el trabajo llegó además el ZIP `frames_trabajadas_legend_of_presos.zip` (3 partes).

### Lo que se midió primero (herramienta nueva `tools/qa_20261106/feel_audit.cjs`, simulación real)
Por golpe de suelo: ventaja en golpe y en guardia, cuántos impactos conectan, y las cadenas que solo existen en MAX. Problemas reales encontrados:
- **157 golpes de 25 personajes** (casi todos los especiales, súpers y ocultos) seguían el reloj del clip: un especial de 3 poses a 15 fps duraba 12 frames en total. Resultado: **148 de 267 golpes quedaban a favor (≥0) en guardia**, incluidos **21 ganchos invulnerables "seguros"** (+4 en guardia). Visualmente: preparación y recuperación de 1 frame por pose.
- Golpes con varios impactos dibujados que pegaban una sola vez (p.ej. el puño de Personaje 08 dibuja 3 puños en las poses 2, 4 y 6).
- **Bug de guardia**: en un golpe BAJO de varios impactos, el 2º impacto bloqueado borraba el "agachado" del defensor y el 3º entraba aunque siguiera cubriéndose abajo.
- **Proyectil → súper en MAX no salía nunca**: el "contacto" que habilita la cancelación solo lo marcaba el cuerpo a cuerpo.

### Cambios
- **`data/frame_data.json` + `tools/build_frame_data.py`** (idempotente; `--check`; `--revert` deja los char.json byte a byte como estaban): pasa esos 157 golpes a tiempos explícitos (`frames` + `activeIdx`, el mismo sistema de los normales de `data/normals.json`). Clases de DISEÑO (TODO: VERIFICAR jugando): especial (8/3/16, −5 en guardia), especial lanzador o invulnerable (4/4/22, −14), especial bajo (7/3/18, −8), proyectil (10/2/16), súper (5/4/26, −14), oculto (5/4/30, −16). El arranque nunca baja de 2 frames por pose de preparación dibujada. hitstun/blockstun se calculan para la ventaja objetivo; derribos y lanzadores conservan su hitstun. Cada move guarda su definición anterior en `_clipTiming`. No cambian cajas, daño total, clips ni arte. Se saltan `sofi.modo_vestia` y `el_paisa_sistem.super` (los escriben sus propios generadores).
- Impactos no seguidos (`[2,4,6]`) → **multiHit**, uno por grupo, con el daño repartido (el total no sube): Personaje 08 puño y patada, patada de Wasirris.
- **Motor (`engine/pg_sim.js`)**:
  - en tiempos explícitos, `hitFrames` limita qué cuadros de la fase activa pegan (`[]` = solo lanza proyectil);
  - el proyectil se marca con `_spawned` (antes `moveFrame=-99`, que rompía los moves con tiempos explícitos);
  - la guardia agachada se conserva durante el bloqueo y, manteniendo Guardia, se puede cambiar alta/baja (como KOF);
  - si el proyectil conecta mientras su dueño sigue en el especial que lo lanzó, cuenta como contacto (cancelación a súper en MAX). Ventana: activo + 10 frames (`projectileCancelExtra`).
  - La caja de depuración (F) respeta `hitFrames`.
- `tools/qa_20261106/combo_audit.cjs`: especial ⇒ súper y X ⇒ oculto ahora se miden en MAX (es la regla del juego, `hit.superCancel="max"`). Antes se medían sin MAX y contaban como combos falsos: el gancho duraba tan poco que el súper salía DESPUÉS y alcanzaba al rival cayendo.

### Entrega "frames trabajadas" (2026-11-15)
- ZIP reconstruido de las partes 001+002+003 (la 003 llegó dos veces, idéntica). SHA-256 en `sources/entregas_2026-11-15/ORIGEN_SHA256.txt`. Se archivó **solo lo nuevo**: lo de Personaje 08 y la base/mareo/K.O./victoria de Wasirris es idéntico byte a byte a `sources/entregas_2026-11-06/`.
- `tools/integrar_frames_20261115.py` (idempotente, `--check`; después correr `build_frame_data.py`):
  - **Tobi y Diego Cancha**: `dizzy`, `ko_fall` y `victory_pose` de 8 cuadros (atlas `<id>_poses_extra.png`). Escala = alto del idle del atlas base / 520 px (lo que declara la entrega). Diego no tenía ni mareo ni K.O. propios. Lo anterior queda en `_prev`. `build_reacciones_prototipo.py` ya no pisa clips marcados `_entrega`.
  - **Wasirris, Sentencia Firme**: 16 cuadros, cuerpo + capa FX compuesta (atlas `wasirris_sentencia.png`, misma escala que sus poses del 06-11). Impacto en los cuadros 8-9 (el manifest marca el 8). Caja **medida** de la palma + destello del cuadro 8 (antes 150 px de ancho: pegaba a 220 px sin moverse; ahora avanza 78 px durante el dash dibujado en el sitio y conecta hasta 160). Se quitaron los FX sueltos del clip viejo de 6 cuadros (ahora vienen dibujados). Lo anterior en `_prev`.
- **Defecto de la fuente, no corregido**: en varias hojas el personaje cambia de tamaño entre cuadros. Diego `dizzy` 0-3 y `victory_pose` 0-3 son ~15 % más chicos que 4-7; en Tobi, `dizzy`/`victory_pose` 4 y 7 son más grandes. En bucle se nota como un "latido". Medidas en `python3 -I tools/integrar_frames_20261115.py --report`. Se arregla en el arte, no aquí.

### Resultado (salida real)
- `feel_audit.cjs`: golpes a favor en guardia **148 → 37 de 267** (los que quedan son casi todos jabs, +1 por diseño); ganchos seguros **21 → 0**; multi-golpe **18/18** conectan todos sus impactos; cadenas en MAX que combean **82/95 → 91/95**. Las 4 que faltan: barrida/embestida ⇒ súper (el rival queda tendido e intocable, como en KOF) y Mateo `tajo_descendente ⇒ ultimo_turno_ex` (lo genera un script que no está en el repo). Reporte completo en `qa/entrega_20261106/sensacion_combate_REPORTE.txt`.
- `combo_audit.cjs` con la regla real: **540/546, exactamente las mismas cadenas que antes** (sin regresiones; 0 referencias rotas).
- `hidden_solo.cjs`: **12/12** ocultos salen y pegan en MAX. `juggle_roster.cjs`: 28/31 (igual). `test_moves` El Paisa, `complementario_moves`, `arcade_bosses`: OK. `cpu_bouts` (Tobi, Wasirris, Diego, Nadia, Personaje 08 contra 3 rivales): todas terminan sin errores.
- Navegador (`tools/qa_20261106/frames1115_browser.cjs`): Sentencia Firme con comando real (↓↘→↓↘→+P), 92 de daño; mareo, K.O. y victoria nuevos de Tobi y Diego. Consola: solo el 404 conocido de `sw.js`. Evidencia: `qa/entrega_20261106/wasirris_sentencia_firme_en_juego.jpg`, `tobi_diego_mareo_ko_victoria_en_juego.jpg`.
- **La jugabilidad CAMBIA a propósito** (`determinism.cjs` ya no da idéntico): los especiales duran más y son castigables. El cambio de motor por sí solo (sin los datos nuevos) se verificó idéntico cuadro a cuadro en 6 peleas.
- Generadores al día: `build_frame_data`, `integrar_frames_20261115`, `integrar_entregas_20261106`, `build_reacciones_prototipo`, `build_sofi_vestia_real`, `build_personaje_complementario`, `build_vestia_sofi`.

## 2026-11-14 — Transformación de Sofi (Modo Vestía): recorte rehecho, sin cuadrícula

**El usuario reportó por segunda vez que al transformarse "se ve el grill". Tenía razón y la entrega anterior estaba mal.** Yo había revisado el atlas solo sobre fondo oscuro. Sobre fondo claro `sofi_vestia.png` mostraba: las líneas grises del borde de cada celda, restos del número de la esquina, agujeros en el traje y las botas, el aura como mancha sólida con hoyos, y los cuernos del frame de abajo (ver `qa/entrega_20261106/sofi_transformacion_ANTES_fondo_claro.jpg`).

**Causas, medidas en la hoja fuente:**
- Las celdas no forman una rejilla uniforme: las líneas verticales van cada ~206 px, y las horizontales están en 8, 213, 422, 609, 803, 1004 y 1235 (filas de 186 a 230 px). El script anterior cortaba cada 209 px desde 0.
- Borrar "los grises" por color no puede separar un brillo translúcido pintado sobre una cuadrícula, y además abría agujeros en el cuerpo.

**`tools/build_vestia_sofi.py` reescrito** (idempotente, `--check`; solo usa `sources/entregas_2026-11-07/sofi_modo_vestia_36f.png`):
- Detecta las líneas reales de celda y corta por dentro.
- **Cuerpo opaco** con su color original: lo más oscuro que el fondo, lo brillante que no es morado/magenta, y lo que eso encierra.
- **Huecos de fondo** (entre las piernas): solo si coinciden casi exacto con el tono del fondo y forman una zona de 60 px o más. Así las botas grises no se confunden con fondo.
- **Aura translúcida**: su alfa es cuánto se aleja del gris del fondo, con el color despremultiplicado.
- **Sombra y humo oscuro**: negro translúcido calculado sobre la luminancia suavizada al tamaño del cuadro, para que el patrón no pase.
- Borra el número de la esquina y los trozos sueltos que tocan el borde (vecinos).
- Mismo formato de salida (6x6, celda 180): el `char.json` y la simulación no cambian.

**Intento descartado:** un mate por dos fondos con la hoja transparente del usuario (`sofi_vestia_36f_transparente.png`). No sirve: esa hoja no es el arte sobre negro (sus colores son los de la hoja con cuadros y su alfa depende del brillo), y la falda y el traje salían semitransparentes.

**Verificación:** atlas completo sobre fondo claro y sobre rojo (`sofi_transformacion_fondo_claro.jpg`, `sofi_transformacion_fondo_rojo.jpg`) y secuencia dentro del juego frente al OXXO (`sofi_transformacion_en_juego.jpg`, `tools/qa_20261106/vestia_seq.cjs`): sin cuadrícula, líneas ni números; cuerpo sólido. Consola limpia salvo el 404 de `sw.js`.

**Límites que quedan:** la sombra del piso sale punteada porque así está dibujada en la fuente; el humo de los frames 26 a 31 queda como nube gris suave; en los frames 9 a 11 las medias muestran zonas claras que no pude confirmar si son rasgaduras del arte.

## 2026-11-13 (3) — Personaje nuevo (provisional) + estructura de historia entre combates

Respuestas del usuario: el ZIP es un personaje nuevo, el del overol naranja también, y de la historia "primero la estructura".

### Personaje nuevo del ZIP `ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO` (33 jugables)
- Entra como **provisional** (id `personaje_complementario`, nombre de relleno "Nuevo (sin nombre)"): se puede elegir, pero no sale como rival automático. **Falta su nombre**, su ficha y su lugar en la historia.
- Lo genera `tools/build_personaje_complementario.py` (idempotente, `--check`): atlas de 90 cuadros (celdas 192, sin reescalar), `char.json` y alta en `data/roster.json`.
- **Tiene:** espera, caminar, correr, salto, guardia agachada, golpe recibido (3 poses), caída (5), derribado, levantarse (5), K.O. (7), festejo; puño, patada, patada alta, rodilla aérea, Embestida (↓↘→ + puño), Barrida baja que derriba (↓↙← + patada) y súper Descarga (↓↘→↓↘→ + puño, estallido en el sitio).
- **No tiene** (la fuente no trae esos cuadros, así que quedan desactivados o con el respaldo del motor): puño fuerte, puño aéreo, agarre y mareo.
- Cajas de golpe medidas del sprite con el método de El Paisa. Tres avisos: la rodilla aérea y la embestida no sobresalen de su pose previa, y su caja es la franja frontal del cuadro. Tiempos y daños de diseño: **TODO: VERIFICAR** jugando.
- La propia fuente avisa que 155 de sus 165 cuadros son generados y que el aura morada viene pegada al cuerpo. Aquí el aura solo se usa en el súper.
- Verificación:
  - `tools/qa_20261106/complementario_moves.cjs`: TODO OK. Cada golpe de comando conecta a su distancia y no pega fuera de alcance (el súper llega a 90 px).
  - `test_moves.cjs`: puño, patada, patada alta, barrida y rodilla aérea conectan. Su caso "super" falla porque coloca al rival a 120 px, fuera del alcance de este súper.
  - `cpu_bouts.cjs`: 12 peleas terminan sin errores; ganó 3 de 12 (entra flojo).
  - Navegador (`complementario_browser.cjs`): aparece en la selección, 94 texturas válidas, consola limpia.
  - Evidencia: `qa/entrega_20261106/personaje_nuevo_en_juego.jpg` y `personaje_nuevo_animaciones_fuente.jpg`.

### Historia entre combates: estructura lista, sin textos
- `data/story.json`: un capítulo por combate del Arcade (6), con `tag`, `title`, `sub` y `bg`. Hoy los 6 son **relleno marcado** (`placeholder: true`).
- Los de relleno **no se muestran** en el juego normal. Para verlos mientras se escriben: `game.html?story=draft`. Para publicar uno: escribir sus textos y borrar la línea `placeholder`.
- Pantalla de capítulo: `storyBeat` en `engine/pg_frontend.js`, con la estética de la intro; se avanza con Continuar, Enter o Esc. Enganche en `engine/pg_game.js` (`storyBeat`, `arcadeNextMatch`): sale antes del VS, una vez por combate (no se repite al reintentar), y si el combate se salta, su capítulo también. Equipos usa los mismos capítulos.
- Si `story.json` falta o está mal, el Arcade sigue igual.
- **No se escribió nada de la Toxi Familia:** no hay canon en el proyecto. La intro y el final siguen como estaban.
- Verificación (`tools/qa_20261106/story_browser.cjs`): en modo normal el Arcade va directo al VS; en borrador sale el capítulo 1 y Continuar lleva al VS. Consola limpia. `arcade_bosses.cjs` sigue en TODO OK. Evidencia: `qa/entrega_20261106/historia_capitulo_borrador.jpg`.

### Sin integrar
- **Personaje del overol naranja:** el usuario confirmó que es nuevo, pero solo hay una imagen de su hoja de golpes. Falta su atlas en ZIP y su nombre.

## 2026-11-13 (2) — Conectar y recibir golpes: auditoría + vibración del golpeado

**Qué ya hacía bien el motor.** La pose de impacto se dibuja exactamente durante los cuadros activos del golpe (`framePhase` en `engine/pg_sim.js`: preparación, impacto y recuperación se reparten sobre `startup/active/recovery`, sin depender de los fps del clip). No había desfase que corregir.

**Auditoría de poses** (`tools/qa_20261106/audit_poses.py`, resultado en `qa/entrega_20261106/auditoria_golpes_y_reacciones.txt`). De 32 jugables:
- 30 no tienen mareo propio y 22 no tienen caída de K.O. propia.
- 13 reciben el golpe con una sola pose (o con el respaldo del motor).
- 6 tienen menos de 3 poses distintas por golpe: Nadia, Garravas, Regente, Don Garras, Wasita y Warriza Wasa. En ellos el golpe es "pose neutra, impacto, pose neutra".
- Esto solo se arregla con arte por personaje. La hoja de referencia del usuario (overol naranja) pide 5 o 6 poses por golpe.

**Mejora para todos, sin arte nuevo: el golpeado vibra en la pausa de impacto.**
- `engine/pg_render.js` (`_spriteFor`): durante el `hitstop`, el sprite del que recibió el golpe se desplaza de lado a lado en frames alternos; el que pega queda quieto en la pose de impacto.
- Valores en `data/config.json`, `render.hitShake`: 3 px si recibió el golpe, 1.5 px si lo bloqueó, y se apaga en los últimos 4 frames. Respeta la calidad de efectos. Son de diseño: **TODO: VERIFICAR** jugando.
- Solo dibujo: la posición de la simulación no cambia. Jugabilidad idéntica cuadro a cuadro (`determinism.cjs`, Tobi contra Nadia y Sofi contra Garravas).
- Navegador (`tools/qa_20261106/hitshake_browser.cjs`): en 43 muestras con pausa de impacto el golpeado vibró en las 43 (máximo 3 px) y el atacante en ninguna; fuera de la pausa, nadie. No salió ningún bloqueo en la muestra, así que la variante de 1.5 px no se vio.

**Recibido y sin integrar** (`sources/entregas_2026-11-13/`, con SHA-256):
- `ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO.zip`: 165 frames de un personaje robusto de chamarra negra y pantalón caqui. No coincide con nadie del roster y nada dice quién es.
- Hoja de golpes del personaje de overol naranja: su atlas no está en el repo y tampoco coincide con nadie.
- **Historia de la Toxi Familia:** no hay nada escrito en el repo. No se inventó; falta que el usuario la cuente.

## 2026-11-13 — Frames rescatados de la otra versión del repo (prototipo de la raíz)

**Qué se revisó.** El usuario pidió revisar los frames de las versiones de Manus y GPT. En el repo solo hay otra versión: el prototipo de la raíz ("Puente Grande · Arcade Club", `public/assets/characters/`, 20 personajes, 41 hojas). La rama `copilot/kin-of-presos2` es `main` sin `legend-of-presos/` y no trae nada propio. Ningún archivo dice de qué herramienta salió cada versión.

**Resultado de la comparación (41 hojas):**
- 7 hojas son idénticas píxel a píxel a los atlas del juego (Nadia, Regente, Semillas y Tobi; diferencia media menor a 2).
- Las hojas base de Bigotes, Cadena, Calavera, Cartel, Cochi, Gordo, Mecánico, Morado y Pocheche son el mismo paquete que el juego ya reempaquetó. Cadena, Calavera y Morado ya tienen sus hojas de especiales y K.O. Esto se revisó a ojo, no celda por celda.
- **Lo que sí faltaba:** hojas de reacciones (1448x1086) que el juego nunca integró.

**Integrado** con `tools/build_reacciones_prototipo.py` (idempotente, `--check`; corte por componentes en `tools/_seg_reacciones.py`):

| Personaje | Antes | Ahora (atlas `reacciones`) |
|---|---|---|
| Nadia | golpe 1 pose, caída 2 poses repetidas, levantada 3, sin K.O. propio | golpe 2, caída 4, derribada, levantada 6, K.O. 6 |
| Regente | caída 2 poses repetidas, levantada 3, sin K.O. propio | caída 3 poses distintas, derribado, levantada 6, K.O. 4 |
| Tobi | levantada 3, sin mareo ni K.O. propio | levantada 6, **mareo con estrellas** (4), K.O. 3 |

- Cada figura se llevó a la escala del atlas base del personaje (figura de pie de la hoja = alto del idle base).
- `recovery_pose` y `damage_fall` conservan su duración exacta (más poses, más fps), porque el motor mide la levantada con ese clip. Jugabilidad idéntica cuadro a cuadro en 5 peleas (`determinism.cjs`).
- Navegador (`tools/qa_20261106/reacciones_browser.cjs`): texturas válidas, consola limpia; se vieron en pelea el golpe y el K.O. de Nadia, y la levantada y el mareo de Tobi.
- Evidencia: `qa/entrega_20261106/reacciones_prototipo_clips.jpg` y `reacciones_prototipo_<id>.jpg` (hojas con cada figura numerada).

**No integrado, y por qué:**
- **Hoja "garravas/atlas_02" (bestia-rata):** el Garravas del juego es un hombre de gabardina y Don Garras va de traje. Ese arte no corresponde a ningún personaje del roster. Falta que el usuario diga de quién es.
- **Semillas:** sus figuras se tocan en vertical y el corte automático no es fiable; además ya tiene caída de 9 poses y levantada de 5.
- **Mateo:** la hoja es de su arte anterior (hoy usa el de El Sable).
- **Callejero, Oscuro, Don Gorrón, El Killer de la Fez 104 y El Moco:** no están en el roster. Meterlos es agregar personajes nuevos (golpes, cajas, nombres), no rescatar frames.
- **Tobi, filas 6 a 9** (aura de poder, barrida, puños con estela): varias figuras se tocan y habría que cortarlas a mano.
- La elección de poses es decisión de integración: **TODO: VERIFICAR** con el usuario (tabla `SPEC` del script).

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
