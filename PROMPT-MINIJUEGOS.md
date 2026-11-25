# Prompt para Claude: minijuegos de las misiones de Viruscity

Copia todo lo que está debajo de la línea. Pide **4 minijuegos por conversación** (por ejemplo: muestras, lámpara UV, panel de conexiones y dosificador) para que cada uno salga con buena calidad. Luego me pasas los archivos y yo los integro, pruebo y ajusto.

---

Eres un desarrollador de juegos web con mucho ojo para la animación. Necesito **minijuegos cortos y animados** para un juego multijugador de navegador llamado **Viruscity**: una ciudad en cuarentena donde los jugadores sanos fabrican la cura completando misiones y un infectado oculto contagia a los demás. Cada misión abre un minijuego en una ventana modal. El jugador lo resuelve en 8–15 segundos y vuelve al mapa.

Quiero mecánicas del estilo de las tareas de los juegos de deducción social (arrastrar, conectar, verter, escanear, limpiar, memorizar), pero con **diseños 100 % originales**: no copies nombres, dibujos, colores característicos ni tareas concretas de ningún juego existente.

## Minijuegos de esta conversación

[Pega aquí las 4 filas que quieras de la tabla de abajo]

| id | Misión | Mecánica | Animaciones clave |
|---|---|---|---|
| `samples` | Recolectar muestras de pacientes | Arrastrar 4 tubos de ensayo de una bandeja a una gradilla, cada uno al hueco del color de su tapa | tubo que se balancea al arrastrar, líquido que se asienta, ✓ por hueco |
| `uvlamp` | Esterilizar el quirófano | Pasar una lámpara UV (sigue al puntero) sobre una mesa de operaciones hasta borrar todas las colonias de germen | halo violeta, germen que se encoge y chispea, porcentaje limpio |
| `microscope` | Analizar la muestra del paciente cero | Girar una perilla de enfoque hasta que la imagen deje de estar borrosa; después tocar la única célula infectada (late en verde) | desenfoque que baja, células que flotan, latido verde |
| `helix` | Secuenciar el genoma del virus | Completar 6 huecos de una cadena de ADN con la base complementaria (A–T, C–G) | hélice que gira lento, base que encaja con destello |
| `dosing` | Preparar el suero base | Mantener pulsado para verter de un matraz a un vaso y soltar con el nivel dentro de una franja; si te pasas, se vacía y vuelves a intentar | chorro con gotas, nivel que ondula, franja que brilla al acertar |
| `labeling` | Etiquetar las dosis | Una cinta trae 5 viales de colores; tocar la etiqueta del color correcto cuando cada vial pasa por la marca | cinta que avanza, vial que se sacude al fallar, etiqueta que se pega |
| `patchpanel` | Restaurar el registro de contagios | Arrastrar 4 cables desde la izquierda hasta el enchufe con su mismo símbolo a la derecha | cable con curva colgante, chispa al conectar, LED que se enciende |
| `transfer` | Descargar el historial clínico | Pulsar "Iniciar"; la descarga avanza y a veces la antena parpadea en rojo: pulsar "Reconectar" antes de 1,5 s o la barra retrocede | carpetas que viajan entre dos equipos, barra, ondas de la antena |
| `valves` | Sintetizar el compuesto | Girar 3 válvulas (arrastre circular, o teclado) hasta que las 3 agujas queden a la vez en la zona verde de sus manómetros | agujas con inercia, burbujas, vapor al estabilizar |
| `reactor` | Purificar el reactor | El reactor enciende una secuencia de luces; repetirla en 3 rondas (3, 4 y 5 luces) | pulso de cada luz, núcleo que se aclara en cada ronda |
| `loading` | Cargar el suero en los camiones | Arrastrar 5 cajas a las casillas libres de la caja de un camión hasta llenarla | caja que cae con rebote, suspensión del camión, puerta que se cierra |
| `scanner` | Inventariar el cargamento | Deslizar un lector sobre el código de barras de 3 cajas a la velocidad justa | haz rojo, destello al leer, aviso "Muy rápido / Muy lento / Leído" |

## Contrato técnico (obligatorio)

Cada minijuego es **un módulo ES (`<id>.js`) sin dependencias** que exporta:

```js
// container: <div> vacío dentro del modal (ancho entre 300 y 560 px)
// onSolved(): llamarlo UNA sola vez cuando se resuelve, DESPUÉS de la animación de éxito (~600 ms)
// rng(): números en [0,1) para todo lo aleatorio (debe ser determinista si rng lo es)
// reduceMotion: true si el usuario pidió menos movimiento
// sfx(nombre): opcional; llama sfx("ok"), sfx("error"), sfx("tick"), sfx("done") en los momentos clave
export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} }) {
    // ...
    return {
        close() {},          // detiene requestAnimationFrame, timers y listeners; no deja nada vivo
        focusTarget,         // elemento que recibe el foco al abrir (opcional)
        onKeyDown(event) {}, // opcional: el modal le reenvía las teclas (Esc ya lo maneja el modal)
        onKeyUp(event) {},   // opcional
    };
}
```

Exporta además **funciones puras** con la lógica (sin DOM ni canvas), para probarlas con `node:test`. Por ejemplo: `isSolved(estado)`, `isComplementary(a, b)`, `scanSpeedOk(px, ms)`, `levelInBand(nivel, banda)`. Incluye un archivo `<id>.test.mjs` con pruebas de esas funciones usando `node:test` y `node:assert/strict`.

## Reglas visuales y de código

- **Dibujo en `<canvas>`** con animación por `requestAnimationFrame`, nítido en pantallas de alta densidad (`devicePixelRatio`) y redimensionado al ancho del contenedor. Sin imágenes, fuentes ni librerías externas: todo dibujado con código.
- **Colores solo de estas variables CSS** (léelas con `getComputedStyle(document.documentElement)`, con estos valores de respaldo):
  - `--bg #0b1020`, `--panel #121a33`, `--panel-2 #18223f`, `--border #2a3560`;
  - `--text #e6e9f5`, `--muted #8f9bc4`;
  - `--accent #4dd2ff` (cian: acciones, lo sano);
  - `--infected #7cff6b` (verde: virus);
  - `--cure #ffd166` (dorado: progreso y éxito);
  - `--danger #ff4d6d` (rojo: error).

  Estética: ciudad de noche con neón biológico, bordes de 1 px, esquinas redondeadas y un brillo cian suave solo en lo importante. Para objetos propios (vidrio, metal, líquidos) puedes derivar tonos de esos colores.
- **Texto visible en español.** Texto dinámico con `textContent` o `fillText`, **nunca `innerHTML`**.
- **Entrada:** Pointer Events (ratón y táctil, objetivos de al menos 44 px) **y** teclado completo: flechas, Enter o Espacio, Tab. Cada minijuego debe poder resolverse sin ratón.
- **Accesibilidad:**
  - un `<p aria-live="polite">` con el estado ("2 de 4 tubos colocados", "Muy rápido, inténtalo de nuevo");
  - `:focus-visible` con anillo cian de 2 px;
  - el canvas con `role="img"` y un `aria-label` que describa el estado.
- **prefers-reduced-motion:** sin partículas ni movimiento continuo; las transiciones pasan a cambios de opacidad. El juego debe seguir siendo resoluble.
- **Dificultad:** 8–15 s para alguien que ya lo conoce. Los errores se corrigen sin castigo duro: el jugador reintenta en el acto.
- **Rendimiento:** nada de trabajo cuando la pestaña no se ve; `close()` lo deja todo limpio.

## Entregables

1. Un archivo por minijuego: `<id>.js` con su lógica pura exportada.
2. Un archivo de pruebas por minijuego: `<id>.test.mjs`.
3. Una página de demostración **`demo.html`** (un solo archivo) que:
   - cargue los 4 minijuegos con un selector;
   - simule el modal (título de la misión, botón "Cancelar (Esc)");
   - tenga un interruptor de "movimiento reducido";
   - muestre "¡Resuelto!" cuando se llama `onSolved`.

   Quiero verla como artifact para probarlos.
4. Una nota corta por minijuego: cómo se juega con ratón, con dedo y con teclado, y cuánto tarda.
