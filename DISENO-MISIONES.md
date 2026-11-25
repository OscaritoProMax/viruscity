# Diseño: misiones jugables de Viruscity

## 1. Qué cambia y por qué

**Hoy:** una misión se hace parándose sobre un anillo dorado en la acera y pulsando E. Se abre un minijuego sencillo de botones (secuencia, código, cables, calibración o mantener). Se siente como "pararse y listo".

**Objetivo:** que cada misión sea un momento de juego:

1. **Entrar al edificio.** Las estaciones están **dentro** de cada lugar, en salas cerradas. Entrar tiene riesgo: el infectado puede seguirte y la sala es pequeña.
2. **Una consola visible.** Cada estación es un mueble con su propio dibujo (microscopio, panel de cables, reactor…) que se ilumina cuando la misión está disponible.
3. **Un minijuego propio por misión.** Son 12 minijuegos animados en canvas, con mecánicas cortas del género de tareas de deducción social: arrastrar, conectar, verter, escanear, limpiar, memorizar. Son diseños **originales**: no copian nombres, dibujos ni tareas concretas de ningún juego existente.

Las reglas de la partida no cambian:
- el servidor sigue validando rango, rol y tiempo (`MISSION_MIN_MS`/`MISSION_MAX_MS`);
- el jugador sigue quieto mientras resuelve;
- el protocolo no cambia (las estaciones solo cambian de coordenadas).

## 2. Los 6 interiores

Van en la zona de interiores del mundo (debajo de la ciudad), en el bloque libre de las columnas 44–79. Son 6 salas de **12 × 9 casillas** (576 × 432 px), en 2 filas de 3:

| Sala | Casillas | Se entra por | Ambiente |
|---|---|---|---|
| Hospital Virus Care | c44–55, r61–69 | puerta del Hospital (Calle Sur) | baldosa blanca y celeste, camillas, cortinas, luz fría |
| Laboratorio Vega | c56–67, r61–69 | puerta del Laboratorio (Calle Norte) | piso técnico gris, mesas con frascos, luz turquesa, cinta "SELLADO" |
| Farmacia | c68–79, r61–69 | puerta de la Farmacia (Avenida Central) | estanterías de frascos, mostrador, cruz verde de neón |
| Central de datos | c44–55, r70–78 | puerta de la Central (callejón) | racks de servidores con LEDs parpadeantes, piso oscuro, luz azul |
| Planta de síntesis | c56–67, r70–78 | puerta de la Planta (Camino Verde) | tanques, tuberías, rejillas, luz verde de advertencia |
| Almacén | c68–79, r70–78 | puerta del Almacén (patio de la granja) | cajas apiladas, montacargas, persiana metálica, luz cálida |

- **Puerta = portal.** Se usa el mismo mecanismo del Burger Neón y el Supermercado: al pisar la puerta, el servidor te lleva adentro, y la salida te devuelve a la acera.
- **Cada sala tiene sus 2 estaciones**, separadas al menos 4 casillas para que dos sanos puedan trabajar a la vez, y algún objeto que tape la vista para que haya tensión.
- **Las zonas del mapa no cambian** (el edificio de afuera); a cada zona se le agrega su sala interior. La alerta "contagio cerca de <zona>" usa la sala si la víctima está adentro.
- Los edificios siguen marcados por fuera (zona sombreada), pero **los anillos dorados se dibujan dentro**, sobre la consola.

## 3. Las 12 misiones y sus minijuegos

Cada minijuego dura **8–15 s** para alguien que sabe jugarlo; en partida el mínimo es `MISSION_MIN_MS` (8 s).

Todos cumplen lo mismo:
- se juegan con **ratón o dedo** y también con **teclado** (accesibilidad);
- tienen una animación de entrada y una de éxito (~0,6 s), y avisos con `aria-live`;
- con *prefers-reduced-motion* las animaciones se reducen a cambios de opacidad.

| Misión | Minijuego | Mecánica | Animaciones clave |
|---|---|---|---|
| **hospital-1** Recolectar muestras de pacientes | *Gradilla de muestras* | Arrastrar 4 tubos de ensayo de la bandeja a la gradilla, cada uno al hueco de su color de tapa | tubo que se balancea al arrastrar, líquido que se asienta, ✓ por hueco |
| **hospital-2** Esterilizar el quirófano | *Lámpara UV* | Pasar la lámpara (cursor) por la mesa hasta borrar todas las colonias de germen | halo violeta de la lámpara, germen que se encoge y chispea, % limpio |
| **laboratorio-1** Analizar la muestra del paciente cero | *Microscopio* | Girar la perilla de enfoque hasta que la imagen se aclare y luego tocar la célula infectada (la que late en verde) | desenfoque que baja, células que flotan, latido verde |
| **laboratorio-2** Secuenciar el genoma del virus | *Doble hélice* | Completar 6 huecos de la cadena con la base que corresponde (A–T, C–G) | hélice que gira lento, base que encaja con destello, cadena que se cierra |
| **farmacia-1** Preparar el suero base | *Dosificador* | Mantener pulsado para verter del matraz al vaso y soltar cuando el nivel quede dentro de la franja | chorro con gotas, nivel que ondula, franja que brilla al acertar |
| **farmacia-2** Etiquetar las dosis | *Línea de etiquetado* | Una cinta trae 5 viales; tocar la etiqueta del color correcto cuando cada vial pasa por la marca | cinta que avanza, vial que se sacude si fallas, etiqueta que se pega |
| **central-1** Restaurar el registro de contagios | *Panel de conexiones* | Arrastrar 4 cables desde la izquierda hasta su enchufe del mismo símbolo a la derecha | cable con curva colgante, chispa al conectar, LED que se enciende |
| **central-2** Descargar el historial clínico | *Transferencia* | Pulsar "Iniciar" y mantener la señal: cuando la antena parpadea en rojo, pulsar "Reconectar" a tiempo | carpetas que viajan entre dos equipos, barra de progreso, antena con ondas |
| **planta-1** Sintetizar el compuesto | *Válvulas* | Girar 3 válvulas (arrastre circular o flechas) hasta que las 3 agujas queden en la zona verde a la vez | agujas con inercia, burbujas en el tanque, vapor al estabilizar |
| **planta-2** Purificar el reactor | *Secuencia del reactor* | El reactor enciende una serie de luces; repetirla (3 rondas que crecen: 3, 4 y 5 luces) | pulso de cada luz con tono, núcleo que se aclara ronda a ronda |
| **almacen-1** Cargar el suero en los camiones | *Carga* | Arrastrar 5 cajas a las casillas libres de la caja del camión hasta llenarla | caja que cae con rebote, camión que se hunde un poco, puerta que se cierra |
| **almacen-2** Inventariar el cargamento | *Escáner* | Deslizar el lector sobre el código de barras de 3 cajas a la velocidad justa (ni muy rápido ni muy lento) | haz rojo, "beep" visual, mensaje "Muy rápido / Muy lento / Leído" |

**Variedad:** cada partida elige 6–12 de estas 12, así que cada sala tiene dos minijuegos distintos.

## 4. Arquitectura (cómo se integra)

- **Cliente:** `client/public/js/vc/minigames/`, un módulo por minijuego con el mismo contrato de hoy: `mount(container, { onSolved, rng })` → `{ close(), focusTarget?, onKeyDown?, onKeyUp? }`. Se agregan `reduceMotion` y `sfx`. La lógica pura (¿está resuelto?, ¿encaja la base?, ¿la velocidad del escáner está en rango?) se exporta para probarla con `node:test`.
- **Motor común:** un pequeño `canvas-kit.js` con el lienzo que se adapta al ancho (360–560 px, nítido en pantallas de alta densidad), el bucle de animación que se detiene al cerrar, la entrada unificada (puntero y teclado), y utilidades de dibujo y de easing.
- **Servidor:** `coordinator/missions.js` cambia el `kind` de cada misión por el id de su minijuego (`samples`, `uvlamp`, `microscope`, `helix`, `dosing`, `labeling`, `patchpanel`, `transfer`, `valves`, `reactor`, `loading`, `scanner`). Es la decisión 13 de la metodología, actualizada. Nada más cambia en las reglas.
- **Mapa:** `interiors.js` y `interior-art.js` para las 6 salas (muebles y consolas con sprites propios); `layout.js` les pone `enter` a los 6 edificios; `match-places.js` mueve las estaciones adentro y define la sala de cada zona; `npm run map` lo exporta todo y las pruebas existentes lo verifican.
- **NPCs de prueba:** aprenden a entrar por la puerta (portal) y a caminar dentro de la sala.

## 5. Plan por fases (cada una con pruebas, commits y DETENTE)

| Fase | Contenido | Se prueba |
|---|---|---|
| **M1 · Interiores** | 6 salas con muebles, luces y consolas; puertas-portal; estaciones adentro; zona interior en la alerta; anillos dentro | pruebas del mapa (estaciones libres y alcanzables entrando por la puerta), capturas de cada sala, partida de NPCs que entran |
| **M2 · Motor y 4 minijuegos** | `canvas-kit` + muestras, lámpara UV, panel de conexiones y dosificador | lógica pura con `node:test`, capturas en Edge, teclado y movimiento reducido |
| **M3 · 4 minijuegos** | microscopio, doble hélice, etiquetado y transferencia | ídem |
| **M4 · 4 minijuegos + integración** | válvulas, reactor, carga y escáner; los `kind` nuevos en el servidor; CLAUDE.md decisión 13 | ídem, más smokes de toda la partida |
| **M5 · Pulido y prueba final** | sonidos (Web Audio, sin archivos), ajuste de dificultad, README, partida tuya contra 5 NPCs | partida completa y verificación de todo |

## 6. Riesgos y decisiones

- **Tiempo de las misiones:** al tener que entrar y jugar, cada misión cuesta 15–30 s reales. Esto **corrige el desbalance** que vimos (los sanos ganaban antes de que el infectado actuara).
- **Pantallas pequeñas:** todos los minijuegos caben en 360 px de ancho; en móvil se juegan con el dedo.
- **NPCs:** no "juegan" el minijuego (el servidor no lo ve): entran, esperan el tiempo mínimo y completan. Sirven para probar entrar, salir y la persecución dentro de las salas.
