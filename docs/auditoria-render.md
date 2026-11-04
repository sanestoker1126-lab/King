# Auditoría de animación, mapeo y pivotes

> **Estado después de las correcciones de cancelaciones:** este documento conserva la auditoría de la versión inicial como evidencia; las referencias de líneas y tablas de tiempos describen esa base, no todo el estado actual. El renderer ahora usa `src/animation.js` con el reloj local `actionElapsed`, reiniciado por el motor incluso al cancelar hacia el mismo ataque. Los ataques recorren una vez su clip durante la duración efectiva de su instancia y sujetan el último cuadro; las reacciones mapeadas tampoco se repiten. El fallback a idle usa 7 fps y el desplazamiento de fase del rival no se aplica al combate. Las pruebas de animación cubren el recorrido real Tobi J → J → L y la continuidad de marcha/guardia del motor. Estas correcciones no certifican los cuadros de impacto: los mapas de poses, el alias especial → punch y los pivotes originales permanecen como se auditaron. La calibración anatómica, la separación de secuencias y la revisión visual de cada impacto siguen pendientes. El estado actual del combate se documenta en la guía de cancelaciones y la auditoría principal.

## Alcance y método

Se inspeccionaron `src/main.js`, `src/engine.js`, `public/assets/catalog.json` y las pruebas de navegador. La revisión visual cubre las secuencias **actualmente mapeadas de los seis personajes jugables**: Mateo, Tobi, Nadia, Semillas, Oscuro y Callejero. El inventario completo de atlas se documenta por separado; tener un atlas adicional no significa que esté cargado o tenga un mapeo de acciones.

Para cada celda mapeada se decodificó el WebP, se comprobó la existencia de píxeles alfa y se midieron sus límites. Se compusieron hojas con fondo opaco, coordenadas de fila/columna, centro de celda y línea de referencia para evitar confundir los colores RGB de píxeles transparentes con contenido visible. Las seis hojas se inspeccionaron visualmente. La revisión de los originales no aporta metadatos de intención, duración ni pivote anatómico.

Evidencia generada localmente:

- `audit-output/render/{mateo,tobi,nadia,semillas,oscuro,callejero}-mapped.png`: hojas de las secuencias usadas por el juego.
- `audit-output/render/pivots-alpha.json`: límites alfa, centro de la franja inferior y coordenadas de render de cada celda mapeada.

Las coordenadas `rNcM` son **base cero**. Una celda poblada demuestra que existe imagen; no confirma que sea el cuadro correcto para una acción. El catálogo declara `inferred: true` en todos sus mapas.

## Hallazgos principales

1. **El reloj de animación no pertenece a la acción.** `main.js:229–243` toma el tiempo global de la escena y repite cada secuencia mediante módulo. No usa `fighter._attack.elapsed` ni `fighter.actionTime`. Un ataque puede comenzar en su último cuadro, saltarse su anticipación y repetirse visualmente antes de terminar su única ventana de golpe.
2. **Los especiales de los seis personajes usan el puñetazo.** `main.js:229` sustituye `special` por `punch`. El resplandor y arco añadido no son una secuencia especial propia.
3. **Las acciones no mapeadas caen a idle y además lo reproducen a 15 fps.** `main.js:230–231` elige idle como imagen pero calcula la velocidad con el nombre de la acción original. Bloqueo, salto y daño pueden mostrar poses de reposo al doble de su velocidad habitual.
4. **No hay pivotes explícitos ni sincronización entre sprite y colisión.** El tamaño de celda decide la escala; se centra la celda y se aplica un desplazamiento fijo de 12 px. El motor solo usa distancias y alturas; la extensión del sprite no define hitboxes/hurtboxes.
5. **Hay secuencias que mezclan acciones.** Por ejemplo, el `punch` de Callejero incluye una elevación de rodilla; las filas de Tobi agrupan varios golpes y estados de daño/caída. Hace falta separar clips explícitos y conservar su carácter inferido hasta contar con especificación de autor.

## Cobertura real del mapeo

Todas las celdas referenciadas en esta tabla están dentro de la rejilla declarada y contienen píxeles alfa. Esto no valida su significado ni orden temporal.

| Personaje | Celda W×H / rejilla | Idle | Walk | Run | Jump | Punch | Kick | Hurt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mateo | 160×144 / 9×9 | r0c0–8 (9) | r1c0–8 (9) | — | — | r4c0–4 (5) | r4c6–8 (3) | — |
| Tobi | 120×120 / 9×9 | r0c0–8 (9) | r1c0–8 (9) | r2c0–8 (9) | r4c0–8 (9) | r5c0–8 (9) | r6c0–8 (9) | r7c0–8 (9) |
| Nadia | 160×144 / 9×10 | r0c0–8 (9) | r1c0–8 (9) | — | — | r6c0–3 (4) | r6c6–8 (3) | — |
| Semillas | 120×120 / 9×9 | r0c0–3 (4) | r0c4–8 (5) | r1c1–7 (7) | — | r3c0–8 (9) | r4c0–4 (5) | — |
| Oscuro | 160×144 / 9×9 | r0c0–2 (3) | r1c0–7 (8) | — | — | r2c7–8 (2) | r4c0–4 (5) | — |
| Callejero | 160×144 / 9×8 | r0c0–3 (4) | r1c0–8 (9) | — | — | r3c0–1 (2) | r4c0–5 (6) | — |

| Personaje | Bloqueo | Salto | Recibir golpe (`hit` → `hurt`) | Especial | Run alcanzable desde motor |
| --- | --- | --- | --- | --- | --- |
| Mateo | idle a 15 fps + arco | idle a 15 fps + desplazamiento físico | idle a 15 fps | punch + brillo/arco | No definido |
| Tobi | idle a 15 fps + arco | jump a 15 fps | hurt a 15 fps | punch + brillo/arco | No: motor solo emite walk |
| Nadia | idle a 15 fps + arco | idle a 15 fps + desplazamiento físico | idle a 15 fps | punch + brillo/arco | No definido |
| Semillas | idle a 15 fps + arco | idle a 15 fps + desplazamiento físico | idle a 15 fps | punch + brillo/arco | No: motor solo emite walk |
| Oscuro | idle a 15 fps + arco | idle a 15 fps + desplazamiento físico | idle a 15 fps | punch + brillo/arco | No definido |
| Callejero | idle a 15 fps + arco | idle a 15 fps + desplazamiento físico | idle a 15 fps | punch + brillo/arco | No definido |

No hay clips de victoria, derrota, KO, bloqueo o especial propios en el catálogo de ninguno de los seis. El motor tampoco emite una acción KO distinta al terminar un round; `elapsed` sigue avanzando tras `roundOver/finished` y la última acción sigue animándose. Pausar sí congela `elapsed` (`main.js:281–288`).

## Inspección visual por personaje

### Mateo

- Idle r0c0–8 contiene cambios de guardia, giro lateral en r0c4 y gestos del torso; no es una secuencia uniforme de respiración.
- Walk r1 empieza con postura/marcha en c0–2 y pasa a inclinación y zancada de carrera en c3–8. Un bucle entero mezcla velocidades visuales con la misma velocidad física.
- Punch r4c0–4 incluye dos extensiones de brazo, repliegue y elevación del brazo. El recorte no define por sí solo dónde debe ocurrir un único impacto.
- Kick r4c6–8 muestra preparación y extensión creciente de pierna; no incluye una vuelta clara a guardia al final del clip. El módulo vuelve bruscamente a c6.
- Faltan acciones visuales específicas de salto, bloqueo y daño, además del especial.

### Tobi

- Idle y walk son visualmente distintos y poblados. Run r2 tiene zancadas amplias, pero nunca lo solicita el motor.
- Jump r4 contiene preparación, cuerpo elevado, descenso y recuperación. Sus límites alfa ya suben dentro de la celda: hasta 63,36 px de elevación visual adicional con la escala actual. Esa elevación se suma al `fighter.y` físico. Hace falta decidir si el clip usa root fijo y compensación de desplazamiento; no asumir que el límite alfa es el pivote.
- Punch r5c0–8 contiene reposo/guardia, extensiones en c1–2 y c5, otro gesto en c7 y retorno. La fila contiene varios gestos de ataque, pero el motor conecta como máximo una vez.
- Kick r6c0–8 incluye preparación en c0–2, extensión en c3–4 y retorno en c5–8. El golpe visual depende hoy de la fase global en la que se entra.
- Hurt r7c0–8 mezcla guardia/crouch, retroceso, caída, suelo y recuperación. No debe tratarse automáticamente como una reacción corta de 0,21 s.
- `atlas_00_override.webp` es la única textura de Tobi cargada para estas acciones; los atlas adicionales no se consultan durante el render actual.

### Nadia

- Idle r0c0–8 es una secuencia de cambios pequeños de guardia; walk r1c0–8 tiene zancadas reconocibles.
- Punch r6c0–3 muestra brazo extendido en c0–1 y repliegue en c2–3. Al iniciar en c0 no hay anticipación de brazo claramente previa a la extensión.
- Kick r6c6–8 tiene preparación y dos extensiones de pierna; no incluye retorno a guardia completo dentro del mapa.
- Punch tiene base alfa 1,72 px más alta que idle; kick varía entre ambas bases. El cambio puede producir un escalón de altura al cambiar de acción con el anclaje actual.
- No están mapeados salto, bloqueo, daño ni especial propios.

### Semillas

- Idle r0c0–3 y walk r0c4–8 son secuencias diferentes dentro de la misma fila; es una prueba directa de que «fila = acción» no es una regla general.
- Run r1c1–7 contiene carrera y una pose distinta con brazo alzado al final; no lo solicita el motor.
- Punch r3c0–8 agrupa varios golpes de brazo y un gesto alto en c8. No es evidencia de una sola técnica de nueve cuadros.
- Kick r4c0–4 muestra rodilla, extensión, recuperación parcial y otra extensión. La repetición visual puede representar más de un golpe mientras el motor solo permite una conexión.
- La base de idle está 3,84 px más baja que la de walk/punch/kick con el render actual.
- No están mapeados salto, bloqueo, daño ni especial propios.

### Oscuro

- Idle r0c0–2 muestra guardia; walk r1c0–7 muestra marcha.
- Punch r2c7–8 contiene guardia y extensión de brazo. Repetir estos dos cuadros a 15 fps durante 0,34 s produce hasta 2,55 ciclos, aunque el motor procesa un golpe.
- Kick r4c0–4 contiene pierna extendida, giro y varias poses de patada. Podría formar una técnica giratoria o varias; su intención original no se puede certificar sin metadatos. Su inicio actual muestra una pierna ya extendida.
- No están mapeados salto, bloqueo, daño ni especial propios.

### Callejero

- Idle r0c0–3 muestra guardia. Walk r1c0–6 muestra marcha, pero r1c7–8 son poses de carrera inclinada; se repite toda la fila con la misma velocidad física.
- **Punch r3c0–1 no muestra una extensión de puño:** c0 es guardia y c1 eleva la rodilla. Este mapa necesita revisión prioritaria antes de llamarlo puñetazo validado.
- **Kick r4c0–5 mezcla gestos:** c0 eleva la rodilla; otras celdas contienen guardia, brazo extendido y posiciones bajas. No se puede certificar el clip entero como una patada.
- No están mapeados salto, bloqueo, daño ni especial propios.

Estas observaciones son evidencia visual de las poses. No sustituyen una especificación de las técnicas originales ni autorizan a asignar un nombre definitivo a cada celda.

## Reloj global y desajuste con las ventanas de golpe

La selección actual es:

```text
visualAction = hit ? hurt : special ? punch : fighter.action
clip = animations[visualAction] o animations.idle
fps = visualAction == idle ? 7 : 15
frameIndex = floor(globalElapsed * fps) mod clip.frames
sourceColumn = clip.startColumn + frameIndex
```

Para el rival se usa `globalElapsed + 0.2` (`main.js:268–269`). Eso añade **tres cuadros a 15 fps** también durante ataques y daño; no se limita al preview. Su fase visual queda desplazada respecto a la del jugador aunque compartan el mismo tiempo de simulación.

Ejemplo concreto: si Tobi inicia punch con `globalElapsed = 0.4`, se empieza en `floor(0.4 × 15) % 9 = 6`, es decir, r5c6. Al entrar nominalmente en la ventana de impacto a los 0,07 s, se muestra `floor(0.47 × 15) % 9 = 7`, r5c7, en vez de una extensión seleccionada deliberadamente para el impacto. El rival, con el desplazamiento fijo de 0,2 s, usaría índices 0 y 1 en esos mismos instantes. Los pasos reales de simulación pueden cuantizar el instante; la dependencia de la fase global permanece.

Datos comunes del motor (`engine.js:11–14`). Los equivalentes a 60 Hz son descriptivos: actualmente los tiempos son segundos y no una línea temporal entera de cuadros.

| Ataque | Anticipación | Activo | Duración total | Recuperación nominal | Equivalente 60 Hz: anticipación / activo / recuperación |
| --- | --- | --- | --- | --- | --- |
| Punch | 0,07 s | 0,10 s | 0,34 s | 0,17 s | 4,2 / 6 / 10,2 |
| Kick | 0,13 s | 0,12 s | 0,49 s | 0,24 s | 7,8 / 7,2 / 14,4 |
| Special | 0,19 s | 0,16 s | 0,72 s | 0,37 s | 11,4 / 9,6 / 22,2 |

No hay un vínculo entre esas ventanas y cuadros fuente. El número de vueltas visuales durante la duración física es:

| Personaje | Punch: cuadros / período / vueltas | Kick: cuadros / período / vueltas | Special, reutilizando punch: vueltas |
| --- | --- | --- | --- |
| Mateo | 5 / 0,333 s / 1,02 | 3 / 0,200 s / 2,45 | 2,16 |
| Tobi | 9 / 0,600 s / 0,57 | 9 / 0,600 s / 0,82 | 1,20 |
| Nadia | 4 / 0,267 s / 1,28 | 3 / 0,200 s / 2,45 | 2,70 |
| Semillas | 9 / 0,600 s / 0,57 | 5 / 0,333 s / 1,47 | 1,20 |
| Oscuro | 2 / 0,133 s / 2,55 | 5 / 0,333 s / 1,47 | 5,40 |
| Callejero | 2 / 0,133 s / 2,55 | 6 / 0,400 s / 1,22 | 5,40 |

«Vueltas» significa duración física dividida por período del clip; no significa que se vea exactamente ese número de ciclos completos, porque la fase inicial no es cero. Un valor menor que uno puede omitir parte de la secuencia; uno mayor que uno permite repetirla.

## Pivote, suelo, escala y volteo

El motor establece `ARENA.groundY = 350`, con `fighter.y` como altura física sobre ese suelo (`engine.js:3,9`). El renderer suma 5 para definir `ground = 355`, dibuja la sombra en y357 y la celda con un desplazamiento vertical adicional de 12 px (`main.js:233–243`).

Para coordenadas de celda `(u,v)`, tamaño `(W,H)`, escala `s`, orientación `f ∈ {-1,+1}` y raíz física `(x,y)`:

```text
X = x + f × s × (u - W/2)
Y = 355 - y + s × (v - H) + 12
pivote implícito de celda = (W/2, H - 12/s)
```

El volteo ocurre alrededor de la línea `X=x`. Esto mantiene fija la raíz, pero cualquier desplazamiento del cuerpo dentro de la celda cambia de signo. Recentrar automáticamente cada bounding box alfa no solucionaría eso: extender un brazo o una pierna movería la raíz de forma artificial.

| Tamaño de celda | Escala actual | Tamaño dibujado | Pivote implícito en coordenadas de celda |
| --- | --- | --- | --- |
| 120×120 | 1,92 | 230,4×230,4 | (60; 113,75) |
| 160×144 | 1,72 | 275,2×247,68 | (80; 137,0233) |

La siguiente tabla aplica la fórmula al **borde inferior exclusivo del bbox alfa**, con `fighter.y=0`. Es una medición de extensión visible, no una estimación automática del pie de apoyo. Si hay una pose aérea, caída o efectos debajo del cuerpo, no debe ajustarse todo el sprite para llevar ese extremo al suelo.

| Personaje | Idle y-min…y-max | Walk | Run | Jump | Punch | Kick | Hurt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mateo | 356,68…356,68 | 356,68…356,68 | — | — | 356,68…356,68 | 356,68…356,68 | — |
| Tobi | 351,64…351,64 | 351,64…351,64 | 351,64…351,64 | 288,28…351,64 | 351,64…351,64 | 351,64…351,64 | 351,64…351,64 |
| Nadia | 356,68…356,68 | 356,68…356,68 | — | — | 354,96…354,96 | 354,96…356,68 | — |
| Semillas | 355,48…355,48 | 351,64…351,64 | 351,64…351,64 | — | 351,64…351,64 | 351,64…351,64 | — |
| Oscuro | 353,24…353,24 | 353,24…353,24 | — | — | 353,24…353,24 | 353,24…353,24 | — |
| Callejero | 353,24…353,24 | 353,24…353,24 | — | — | 353,24…353,24 | 353,24…353,24 | — |

Hay 5,04 px de diferencia entre las bases idle visibles de Tobi y Mateo/Nadia. Las bases no están calibradas por personaje. En Semillas hay un cambio de 3,84 px entre idle y marcha/ataques; en Nadia de 1,72 px entre idle y punch. Son discontinuidades verificables bajo la fórmula actual; su corrección exacta requiere fijar la raíz/pivote de referencia del personaje, no desplazar cualquier pose hasta su bbox inferior.

La sombra no salta: permanece en el suelo para cualquier `fighter.y`, lo que es coherente para una proyección sobre el suelo. No usa anchura ni desplazamiento propios del personaje.

## Colisiones y relación con el dibujo

`engine.js:157–192` separa las raíces a una distancia mínima de 48 px si su diferencia de altura es menor de 85; un golpe conecta si la distancia horizontal hacia delante está dentro del alcance común y la diferencia vertical es como máximo 88. No consulta los rectángulos de los sprites, ni manos/pies, ni cuadros alfa, ni pivotes.

Por ello, se puede certificar que una imagen carga o cambia con la acción sin demostrar que el puño visible toca una hurtbox durante la ventana activa. Hace falta superponer raíz, plano del suelo, hurtbox y hitbox sobre los cuadros congelados para revisar ese vínculo. Los rangos actuales deben etiquetarse como parámetros del motor, sin presentarlos como hitboxes extraídas del arte.

El retrato (`main.js:65–68`) usa únicamente `portrait.alphaBounds`; no incorpora `portrait.row/column`. Todos los retratos actuales apuntan a r0c0, por lo que no falla hoy. Si se cambia un retrato a otra celda, deberá sumarse su origen al recorte o usar coordenadas explícitamente absolutas.

## Qué prueban las pruebas actuales

`tests/browser.spec.js:74–105` verifica que seis retratos estén poblados y que las selecciones produzcan imágenes distintas del canvas. El reloj global sigue avanzando durante esas capturas: incluso reutilizar un mismo sprite animado puede cambiar el canvas entre selecciones. Esa prueba no demuestra identidad de cada clip, celda exacta, pivote, alineación de pie, fase activa, ciclo completo ni sincronización de cancelaciones.

Las pruebas funcionales de combate y rondas verifican salud/energía/pausa y el resultado de la partida. No inspeccionan las coordenadas fuente de `drawImage` ni comparan el sprite con la ventana de colisión. Su aprobación no certifica un mapeo meticuloso.

## Correcciones y validaciones recomendadas

1. Definir clips como listas explícitas de `{atlas,row,column,duration,pivot}` o referencias a cuadros con esas propiedades. Separar guardia, anticipación, golpe, recuperación, caída y regreso. Mantener `inferred` y la evidencia visual mientras no haya metadatos originales.
2. Mantener un reloj por estado/acción, reiniciado al entrar. Locomoción puede hacer bucle; ataques, daño y KO deben sujetar el último cuadro o transicionar explícitamente. Usar el tiempo del ataque para elegir sus fases; eliminar el +0,2 s del rival durante acciones de combate.
3. Vincular los cuadros de impacto a las ventanas activas. Si se adopta simulación a 60 Hz, definir anticipación/activo/recuperación en cuadros enteros y comprobar límites inclusivos/exclusivos. No convertir de forma silenciosa los valores actuales redondeándolos.
4. Definir por personaje una raíz y un pie/plano de apoyo de referencia, conservados al voltear. Añadir overrides de pivote por cuadro solo cuando el arte los necesite y la revisión los justifique. Evitar usar centro/borde inferior de alfa como pivote automático para ataques o saltos.
5. Usar un único plano de suelo entre motor y renderer o documentar expresamente el desplazamiento de cámara. Revisar tamaño real del personaje y sombras; no decidir la escala únicamente por `frameHeight`.
6. Añadir un visor con selector de personaje/atlas/clip/cuadro, pasos anterior/siguiente, pausa, orientación, velocidad y superposición de rejilla, raíz, pivote, bounding box alfa y hitbox/hurtbox. Distinguir datos medidos, inferidos y pendientes. Permitir comparar dos cuadros con raíz fija y ver el mismo clip volteado.
7. Añadir pruebas que puedan detectar regresiones reales: entrada de ataque con distintos tiempos globales produce siempre el mismo primer cuadro; rival/jugador comparten fase según su propio tiempo de acción; clip no se repite por accidente; golpe visible cae dentro de activo; pivote mundial permanece fijo al voltear; pie de apoyo no salta en transiciones aprobadas; ninguna celda mapeada está vacía/fuera del atlas; todas las acciones del motor tienen clip o fallback declarado y comprobado.

La auditoría no cambia el renderer ni el catálogo. Los mapas de las técnicas, la singularidad del combate y la calibración anatómica siguen pendientes de una implementación con pruebas y revisión visual; no se declaran corregidos por generar estas mediciones.
