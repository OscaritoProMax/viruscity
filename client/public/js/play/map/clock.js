// Reloj del día y luz ambiental (funciones puras).
//
// La hora del juego se calcula con el `t` que manda el servidor en cada state (Date.now() del
// coordinator), no con el reloj de cada navegador: así todos los jugadores ven la misma hora y la
// misma luz, aunque sus relojes locales no coincidan. Un día de juego dura 15 minutos reales.

export const DAY_MS = 15 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

// Minutos del día (0 ≤ m < 1440) para un instante del servidor
export function gameMinutes(serverT) {
    if (!Number.isFinite(serverT)) return 12 * 60;
    const phase = ((serverT % DAY_MS) + DAY_MS) % DAY_MS;
    return (phase / DAY_MS) * MINUTES_PER_DAY;
}

// "08:30"
export function formatClock(minutes) {
    const m = Math.floor(minutes) % MINUTES_PER_DAY;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Oscuridad (a: 0 = pleno día) y color de la luz según la hora (tabla de la referencia)
const AMB = [
    [0, 0.52, [10, 16, 50]],
    [5, 0.5, [12, 18, 55]],
    [6.5, 0.22, [255, 150, 90]],
    [8, 0, [255, 220, 180]],
    [17.5, 0, [255, 160, 70]],
    [19, 0.25, [255, 110, 70]],
    [20.5, 0.5, [12, 18, 55]],
    [24, 0.52, [10, 16, 50]],
];

export function ambientAt(minutes) {
    const h = (((minutes / 60) % 24) + 24) % 24;
    for (let i = 0; i < AMB.length - 1; i++) {
        const a = AMB[i];
        const b = AMB[i + 1];
        if (h >= a[0] && h <= b[0]) {
            const k = (h - a[0]) / (b[0] - a[0]);
            return { a: a[1] + (b[1] - a[1]) * k, c: a[2].map((v, j) => Math.round(v + (b[2][j] - v) * k)) };
        }
    }
    return { a: 0, c: [0, 0, 0] };
}

// ¿Es de noche? (para el icono del reloj)
export const isNight = (minutes) => ambientAt(minutes).a > 0.3;
