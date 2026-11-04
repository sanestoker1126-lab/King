# Auditoría de personajes, combos, cancelaciones y cuadros

> **Registro histórico del estado previo a las cancelaciones.** Después de esta auditoría se implementaron seis rutas y ventanas propias, entradas reservadas, simulación a 60 Hz y reloj local de animación. El estado actual y sus límites se documentan en [cancelaciones.md](cancelaciones.md). Los hallazgos originales se conservan como evidencia de la revisión; las propuestas de este documento no equivalen a una lista de funciones ya implementadas. Los mapas y pivotes continúan pendientes.

**Resultado: la unicidad mecánica no se cumple y el mapeo visual no puede aprobarse todavía.** Los seis jugables comparten el mismo combate; los otros catorce personajes solo tienen recursos. Hay errores visibles en varias secuencias y no existen pivotes anatómicos definidos. Este trabajo entrega diagnóstico, herramientas y propuestas; por petición del usuario, no modifica las mecánicas ni sustituye los mapas actuales.

La revisión se hizo sobre `16aa254ac20a1e4df6c13a8a9c829557b981ac8f`. Los informes generados incluyen hashes de los archivos analizados para detectar evidencia obsoleta después de cambios. No se cambió la configuración publicada del entorno ni se publicó nada.

## Cobertura y límites

| Comprobación | Cobertura y resultado |
| --- | --- |
| Inventario de personajes | 20 carpetas, 41 atlas WebP; todos inspeccionados en dimensiones, transparencia global y SHA256 |
| Personajes jugables | Mateo, Tobi, Nadia, Semillas, Oscuro, Callejero |
| Rejillas declaradas | 6 atlas; 486 celdas medidas individualmente |
| Celdas usadas por animaciones | 183; todas dentro del atlas y con alfa visible |
| Celdas vacías | 62, ninguna usada por el mapa actual |
| Bordes tocados por alfa | 0 en las 486 celdas, con umbrales >0, >16 y >32 |
| Duplicados de píxeles exactos | 0 entre las celdas no vacías de las 6 rejillas, normalizando RGB invisible |
| Otros atlas | 35 sin rectángulos de cuadros, secuencias ni pivotes declarados; no segmentados automáticamente |
| Inspección visual | Las secuencias mapeadas de los seis jugables, con hojas de contacto y revisión de poses |
| Integridad de recursos | Los 71 recursos originales conservan sus hashes; los 41 atlas coinciden con sus manifiestos |

Una celda poblada y sin contacto con sus bordes puede contener la pose equivocada, varias figuras o parte de una figura. Tampoco la ausencia de duplicados exactos prueba originalidad artística: el análisis no compara poses similares ni segmenta las 35 hojas desconocidas. Las rejillas del catálogo son declaraciones actuales, no metadatos originales recuperados.

## Fallos comprobados y prioridad

| Prioridad | Hallazgo | Evidencia y consecuencia |
| --- | --- | --- |
| Alta | Los seis personajes son idénticos en combate | `ATTACKS` es global; el ID no selecciona movimientos, movilidad ni estadísticas. Simulaciones deterministas producen el mismo estado y los mismos eventos salvo el ID. |
| Alta | No existe sistema de cancelaciones | El motor acepta ataques solo cuando termina `actionTime`; no define ventanas, condiciones, rutas ni confirmación por personaje. |
| Alta | No hay combos definidos por personaje; sí hay un enlace emergente dependiente de `dt` | Los 54 seguimientos con contacto temprano a 60 pasos/s no enlazan, pero una secuencia controlada de intervalos variables permite J→J durante el aturdimiento. No es una ruta propia de un personaje. `hits` cuenta impactos de la ronda, no un combo. |
| Alta | El cuadro visual no representa la fase del ataque | `renderFighter` usa el reloj global, no el inicio de la acción. El rival además tiene un desfase de 0,2 s, equivalente a 3 cuadros a 15 fps. |
| Alta | Hay mapas que mezclan técnicas | Callejero `punch` muestra guardia/rodilla; otros clips mezclan varios golpes, marcha/carrera o daño/caída/recuperación. |
| Media | No hay especial animado propio | Los seis usan `special → punch` con un efecto superpuesto. No basta para una técnica propia. |
| Media | Pivote implícito y bases distintas | Se usa el centro de celda y un desplazamiento fijo. Semillas cambia 3,84 px de base alfa entre idle y walk; no hay anclas de pies/cuerpo. |
| Media | Pulsaciones perdidas durante recuperación | Se actualiza `_previousInput` aunque el personaje no pueda atacar; mantener una tecla pulsada durante recuperación no la ejecuta después. |
| Media | Simulación dependiente del intervalo de render | Los tiempos se cuantizan con `dt`; los excesos sobre 0,05 s se descartan. Diez pasos de 0,1 s avanzan 0,5 s de combate. |
| Media | Falta blockstun y cajas por cuadro | Bloquear no asigna aturdimiento. Colisión usa alcance, desnivel y dirección; no hitboxes/hurtboxes vinculadas a los sprites. |

Las referencias y fórmulas del render, los mapas completos por acción y las observaciones visuales detalladas están en [auditoria-render.md](auditoria-render.md).

## Combate actual: datos compartidos

Los valores son segundos y unidades de arena. **No constituyen un sistema de ticks fijos.** La recuperación nominal se calcula como duración menos inicio menos ventana activa.

| Movimiento | Daño | Inicio | Activo | Recuperación | Duración total | Alcance | Hitstun | Energía |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| J · puño | 9 | 70 ms | 100 ms | 170 ms | 340 ms | 108 | 210 ms | 0 |
| K · patada | 14 | 130 ms | 120 ms | 240 ms | 490 ms | 146 | 210 ms | 0 |
| L · especial | 24 | 190 ms | 160 ms | 370 ms | 720 ms | 272 | 320 ms | 35 |

Blockstun no está definido. El especial tiene enfriamiento de 1,3 s; la energía se regenera a 9 por segundo. Los golpes limpios añaden 3 de energía. Estos valores también son compartidos.

A 60 pasos/s, el primer impacto se observa en f4/f7/f11 y la disponibilidad en f21/f30/f44 para puño/patada/especial, contando como f0 el paso que emite el inicio. El primer paso ya suma `dt` al ataque; por eso no debe interpretarse f4 como una definición authored de «startup de cuatro frames». El JSON registra medidas a distintas frecuencias, los pasos y el convenio temporal.

Para probar un combo verdadero, el segundo golpe debe conectar antes de que el defensor recupere la capacidad de defenderse o actuar. Repetir J, K, L contra un rival inmóvil no lo demuestra. Una cota nominal favorable al atacante es:

```text
gap = duración(A) + inicio(B) − inicio(A) − activo(A) − hitstun(A)
```

Incluso tomando el último instante activo del primer ataque, puño → puño deja un hueco nominal de 30 ms. Los otros pares dejan huecos mayores; separación y enfriamiento pueden empeorarlos. Los experimentos de cancelación, entradas durante recuperación y seguimiento están en `audit-output/combat.json`.

Esta cota usa duraciones nominales; la cuantización y el orden de actualización del motor actual alteran los enlaces con contactos tardíos. El barrido adicional de 1.542 casos a pasos uniformes de 20/30/60/120 Hz no encontró enlaces en sus escenarios. **Sin embargo, una secuencia sintética de intervalos variables sí reproduce J→J:** el segundo impacto ocurre 192,00001 ms después del primero, antes de que expire el hitstun de 210 ms, con el defensor manteniendo guardia e incapaz todavía de actuar. Se usan entradas de salto y ataque sin inyectar fases ni aturdimiento, con todos los `dt` dentro del límite de 50 ms del motor.

La reproducción usa Tobi como representante del combate compartido; no demuestra una ruta propia ni una reproducción habitual con los intervalos de un navegador. La secuencia y sus estados quedan en `audit-output/late-contact.json`. La conclusión es que el motor carece de combos definidos por personaje, **no** que sea imposible encadenar cualquier golpe. La prueba de 54 enlaces tempranos se registra como observación limitada, no como certificado global de inexistencia de combos.

## Revisión por personaje

Todas las coordenadas son fila/columna desde cero. Los nombres de técnicas inferidos no se convierten aquí en movimientos confirmados.

| Personaje | Atlas / celdas medidas / usadas | Problema visual principal | Base alfa idle respecto al suelo del render |
| --- | --- | --- | ---: |
| Mateo | 3 atlas; principal 81 / 26 | Walk mezcla marcha y carrera; punch agrupa gestos de golpes distintos; kick corta antes del retorno completo | +1,68 px |
| Tobi | 3 atlas; override principal 81 / 63 | Punch incluye dos arcos de golpe; hurt mezcla guardia, daño, caída y levantarse; salto añade elevación dentro del sprite a la física | −3,36 px |
| Nadia | 3 atlas; principal 90 / 25 | Punch arranca con el brazo extendido; kick carece de retorno completo; el cambio de acción altera la base | +1,68 px |
| Semillas | 2 atlas; principal 81 / 30 | Punch agrupa varios golpes y kick varias extensiones; algunas celdas no usadas muestran figuras parciales/múltiples | +0,48 px |
| Oscuro | 1 atlas; 81 / 18 | Punch de dos cuadros repite guardia/jab; su retorno continúa fuera del mapa; kick contiene varias poses de giro | −1,76 px |
| Callejero | 1 atlas; 72 / 21 | Punch r3c0–1 no muestra puñetazo; kick r4c0–5 mezcla rodilla, brazo y salto; walk termina en carrera | −1,76 px |

El signo positivo significa que el borde alfa exclusivo cae por debajo del suelo del render; el negativo, por encima. Son mediciones de silueta, **no pivotes anatómicos propuestos**. El suelo del render es y=355, mientras `ARENA.groundY` es 350. El rango idle entre personajes es 5,04 px. En Semillas la base cambia de +0,48 a −3,36 px al caminar. Recentrar cada cuadro automáticamente por su silueta movería al personaje cuando extienda una extremidad; no es una solución adecuada.

Los otros catorce personajes no tienen movimientos, combos, cancelaciones ni pivotes ejecutados por el juego. Su estado es **sin implementar**, no «verificado»:

| Personaje | Atlas | Estado del mapeo |
| --- | ---: | --- |
| Bigotes | 2 | Sin metadatos de cuadros |
| Cadena | 3 | Sin metadatos de cuadros |
| Calavera | 3 | Sin metadatos de cuadros |
| Cartel | 2 | Sin metadatos de cuadros |
| Cochi Bombis | 1 | Sin metadatos de cuadros; no asumir rejilla uniforme |
| Don Gorrón | 1 | Sin metadatos de cuadros; no asumir rejilla uniforme |
| El Killer de la Fez 104 | 1 | Sin metadatos de cuadros; no asumir rejilla uniforme |
| El Moco | 2 | Sin metadatos de cuadros |
| Garravas | 3 | Sin metadatos de cuadros |
| Gordo | 1 | Sin metadatos de cuadros; no asumir rejilla uniforme |
| Mecánico | 2 | Sin metadatos de cuadros |
| Morado | 3 | Sin metadatos de cuadros |
| Pocheche | 1 | Sin metadatos de cuadros |
| Regente | 3 | Sin metadatos de cuadros |

Las dimensiones de las hojas no bastan para deducir cómo se empaquetaron cuadros, efectos y figuras. Para estos atlas hace falta construir y revisar rectángulos explícitos antes de asignar técnicas.

## Propuesta de identidad: diseño nuevo, pendiente de implementación

Estas rutas son propuestas para discutir después de la auditoría. **No existen actualmente ni se presentan como reconstrucción del juego original.** J/K/L conservan sus controles; J1/J2 distinguen movimientos encadenados que todavía habría que crear. El objetivo es diferenciar decisiones y reglas, no solo cambiar el daño o el nombre del especial.

| Personaje | Identidad propuesta | Ruta distintiva propuesta | Restricción que la diferencia |
| --- | --- | --- | --- |
| Tobi | Presión mediante cadena corta | J1 → J2 → K | Segundo puño exige una pulsación nueva y contacto confirmado; finisher cierra la cadena |
| Mateo | Castigo deliberado y contraataque | K → L | Cancelación al especial solo en contraimpacto; fallar deja recuperación completa |
| Nadia | Transición de aire a suelo | K aéreo → aterrizaje → J → L | Enlace condicionado al aterrizaje y altura válida; requiere definir lanzamiento/juggle y sus límites |
| Semillas | Amenaza de agarre a corta distancia | J → L de agarre | Solo tras impacto, dentro de alcance corto y contra objetivo en suelo; sin agarre confirmado en bloqueo |
| Oscuro | Preparación y consumo de una marca | L de preparación → J de detonación | La segunda técnica consume un estado temporal; no puede repetirse sin volver a prepararlo |
| Callejero | Presión iniciada por patada | K → J1 → J2 | Ruta iniciada por patada, con final fijo y límite de empuje para evitar bucles en esquina |

Cada ruta necesitaría secuencias propias verificadas, cajas por cuadro, coste/ganancia, startup/activo/recuperación, hitstun/blockstun, reglas en aire/suelo y ventanas de cancelación. No se asignan aquí cifras de balance como si provinieran de las imágenes.

## Orden propuesto para corregir

1. **Normalizar el tiempo:** simulación a ticks fijos de 60 Hz, acumulador que conserve tiempo, reloj local por acción y definición clara de f0. El render podrá interpolar sin cambiar el combate.
2. **Rehacer los mapas explícitos de los seis jugables:** listas de rectángulos que puedan cruzar filas/atlas; separar guardia, jab, cross, patada, daño, caída y levantarse. Un clip de ataque no se repite por módulo. Marcar cada decisión visual como inferida hasta su validación.
3. **Definir pivotes y desplazamiento de raíz:** ancla estable por personaje/acción; compensación explícita para salto y caída. Revisar ambos sentidos, cambio de acción y contacto con el suelo. No derivarlos ciegamente del centro/bounding box alfa.
4. **Implantar perfiles y cancelaciones propios:** ventanas en ticks, condiciones on-hit/on-block/on-whiff, buffer limitado, consumo de entradas, reglas de aire y reinicio de cadena. Definir primero qué rutas acepta cada personaje y cuáles rechaza.
5. **Probar contra defensa real:** defensor intentando bloquear, saltar o atacar en su primer tick libre; comprobar combos verdaderos, huecos, esquinas, espejo, recursos y prevención de infinitos. Comparar perfiles para detectar clones de reglas.
6. **Ampliar los catorce restantes:** primero rectángulos, secuencias y pivotes por atlas; después perfiles jugables. No contarlos como terminados por el mero inventario de archivos.

## Herramientas y reproducción

Desde la raíz del repositorio:

```bash
node scripts/audit-combat.mjs
python3 scripts/audit-characters.py
node scripts/audit-combat.mjs --strict
```

El ensayo adicional de contacto tardío y el caso con intervalos variables se regeneran con `node scripts/audit-late-contact.mjs`.

El modo normal genera evidencia; el modo `--strict` debe salir con error mientras fallen los requisitos de unicidad y cancelaciones. Es un resultado negativo de auditoría, no un error de instalación. El analizador de imágenes requiere Python 3 y Pillow; falla ante referencias inválidas o discrepancias de integridad y distingue esos errores de metadatos desconocidos.

Para revisar los cuadros, arranca Vite con `npm run dev -- --port 5173 --strictPort` y abre la ruta interna `/tools/fighter-audit.html`. El visor permite elegir los 20 personajes y 41 atlas, recorrer celdas y secuencias, ver alfa y suelo, invertir facing y ensayar rejillas manuales. Estas últimas se marcan como hipótesis locales y no cambian el catálogo. El visor es una herramienta de desarrollo; no se añade a la compilación pública del juego.

`audit-output/characters.json`, `audit-output/combat.json` y `audit-output/late-contact.json` contienen la evidencia regenerable. Los archivos generados se ignoran en Git. [scripts/audit-characters.py](../scripts/audit-characters.py), [scripts/audit-combat.mjs](../scripts/audit-combat.mjs), [scripts/audit-late-contact.mjs](../scripts/audit-late-contact.mjs) y el [visor](../tools/fighter-audit.html) quedan como herramientas versionables.

## Validación del estado base

- `npm run verify:assets`: 71 recursos originales correctos.
- `npm test`: 11 pruebas existentes aprobadas.
- `npm run build`: compilación correcta.
- `npm run test:e2e`: 9 pruebas aprobadas y 5 omisiones intencionales según plataforma.
- Visor en Chromium: comprobados los 20 personajes y 41 atlas, selección de secuencias/celdas, mapa clicable, teclado, espejo, reproducción y anchuras de 1440, 760 y 390 px; sin errores de navegador ni desbordamiento horizontal.
- Las pruebas existentes no cubren unicidad por ID, cancelaciones, combos verdaderos, pivotes ni correspondencia entre cuadro y ventana de impacto. Que pasen no aprueba estos requisitos nuevos.

El analizador de combate genera un informe con resultado **FAIL**. Su ejecución normal termina con código 0 porque el análisis se completó; `--strict` termina con código 1 por los requisitos incumplidos. Ninguna de las comprobaciones del estado base oculta ese resultado negativo.
