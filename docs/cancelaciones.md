# Cancelaciones de los seis personajes jugables

Esta implementación añade reglas nuevas de juego. No reconstruye las técnicas originales de los paquetes de sprites. Los ataques base y sus recursos visuales siguen compartiendo definiciones; lo que cambia por personaje es la ruta legal de cancelación y su ventana de confirmación.

## Rutas implementadas

J = puño, K = patada, L = especial. Los tiempos de esta tabla son ticks completos de simulación a 60 Hz **después del impacto limpio**. Los dos extremos de la ventana están incluidos.

| Personaje | Ruta | Ventana por enlace | Identidad de la cadena |
| --- | --- | --- | --- |
| Mateo | J → K → L | 3–7 ticks | Puño, patada y remate |
| Tobi | J → J → L | 1–5 ticks | Doble puño de confirmación rápida |
| Nadia | K → J → L | 2–6 ticks | Patada de apertura y cambio a puño |
| Semillas | K → K → J | 4–8 ticks | Doble patada de ritmo pausado |
| Oscuro | K → L | 5–8 ticks | Cadena corta con especial de cierre |
| Callejero | J → L → K | 2–8 ticks | Especial intermedio y patada final |

Son variantes iniciales, deliberadamente más acotadas que las propuestas exploratorias de la auditoría. Todavía no se han implementado agarres, marcas, lanzamientos ni cancelaciones condicionadas a contraimpacto o aterrizaje.

## Cómo usarlas

Acércate y conecta el primer golpe de tu ruta. Suelta y vuelve a pulsar el siguiente botón al confirmar el impacto. El panel bajo la arena muestra la cadena y resalta el botón cuando la ventana está abierta; funciona también con los controles táctiles.

La cancelación no amplía el alcance: **Tobi, Nadia y Semillas necesitan empezar cerca**. Una patada de Nadia puede conectar desde más lejos de lo que alcanza su puño siguiente; de igual forma, el empuje puede separar al rival antes del segundo puño de Tobi o del cierre de Semillas. Las pruebas de cadena completa usan distancias iniciales de 56 y 80 unidades de arena; no garantizan la ruta desde la distancia máxima de cada ataque.

Cada enlace cuesta **5 de energía adicionales**. Un especial cuesta además sus 35 habituales: cancelarlo cuesta 40 en total. El primer golpe de una cadena no paga la tarifa de enlace. El enfriamiento del especial se respeta incluso dentro de una cadena.

Las pulsaciones se conservan como máximo cinco ticks; una entrada poco antes de abrir la ventana puede ejecutarse al abrirla. La reserva no conserva entradas indefinidamente. Mantener un botón apretado no cuenta como pulsarlo de nuevo, incluso en J→J o K→K.

## Reglas de combate

- Solo se cancela un **impacto limpio** del paso anterior de la ruta. Fallar o golpear una guardia no habilita cancelación.
- Solo se admite el siguiente movimiento de la ruta del personaje. Elegir otro ataque no permite saltarse pasos ni usar la cadena de otro luchador.
- Las rutas son finitas: tres impactos como máximo; Oscuro tiene dos. El remate no puede reciclar la cadena. Una cadena nueva necesita terminar la recuperación y obtener otra apertura.
- La reserva de ataques se elimina al recibir un golpe, pausar o reiniciar un round. Las órdenes dadas durante el aturdimiento no se convierten en un contraataque diferido.
- El golpe enlazado tiene cuatro ticks de preparación. Los pasos con continuación empujan ocho unidades al conectar para conservar el alcance del siguiente movimiento; el último conserva el empuje de su ataque base. Sobre guardia se conserva el empuje bloqueado habitual.
- La CPU usa las mismas rutas, ventanas, energía y enfriamiento. Su decisión de continuar depende de la dificultad.

El seguimiento se comprueba contra un defensor que intenta bloquear en su primer tick libre. Una sucesión de ataques contra un rival que nunca se defiende no basta como prueba de combo.

## Tiempo y animación

`stepMatch` captura entradas a la frecuencia del render y acumula fracciones para ejecutar ticks completos de 1/60 s. Las pulsaciones breves sobreviven aunque no hubiera un tick en la llamada que las recibió; los eventos de todos los ticks de una llamada se agregan. Se conserva el límite externo anterior de 50 ms por llamada, por lo que este cambio no pretende recuperar pausas largas o el tiempo descartado con render muy lento.

El inicio y la cancelación reinician `actionElapsed`, incluyendo una cancelación hacia el mismo ataque. Los clips de ataque recorren su duración una vez y se mantienen en su último cuadro; el rival no recibe el antiguo desfase global. El reloj de marcha y guardia se conserva mientras continúa la misma acción.

Esto corrige el reinicio temporal, pero **no certifica los mapas artísticos**: especial sigue usando la animación de puño, hay acciones que caen a idle y permanecen pendientes los pivotes y las poses incorrectas identificadas en la auditoría. No se cambiaron los atlas originales.

## Código y validación

- `src/fighter-profiles.js`: rutas y ventanas inmutables; los IDs desconocidos mantienen el combate base sin rutas de cancelación.
- `src/engine.js`: reloj fijo, confirmación, reserva, costes, progreso y aplicación de cancelaciones. `getCancelState` permite consultar la ventana sin modificar el motor; `getAttackDefinition` devuelve la definición efectiva del ataque.
- `tests/cancels.test.js`: rutas completas, defensa al recuperar, ambos actores y orientaciones, centro y esquinas; rechazo de rutas ajenas, fallo, bloqueo, ventanas caducadas, entradas repetidas, energía, enfriamiento y reinicios.
- `tests/animation.test.js`: reloj local, reinicio de cuadros y reproducción sin bucles de ataque.
- `tests/browser.spec.js`: presentación de las seis rutas y ejecución de Tobi J→J→L con teclado y pantalla táctil, verificando salud, energía y el aviso de ventana.

Ejecuta `npm test`, `npm run test:e2e`, `npm run verify:assets` y `npm run build`. El analizador `node scripts/audit-combat.mjs` distingue el resultado actual de cancelaciones de la cobertura visual todavía pendiente; que el modo estricto siga fallando por animaciones ausentes no significa que las rutas nuevas hayan fallado.

Resultado verificado: **63 pruebas unitarias aprobadas**, **13 pruebas de navegador aprobadas y 5 omisiones intencionales por plataforma**, compilación correcta y los 71 recursos originales verificados por SHA256. La auditoría actual distingue seis firmas de cancelación, completa las 18 rutas probadas en sus escenarios de centro/esquina/espejo y rechaza las 30 rutas ajenas; fallo y guardia no habilitan cancelaciones. El caso histórico de enlace espontáneo con intervalos variables ya no se reproduce en ese ensayo concreto. No se afirma haber agotado todos los intervalos posibles ni haber validado los mapas artísticos pendientes.
