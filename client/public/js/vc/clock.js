// Reloj de la partida (Viruscity): traduce las horas del servidor (countdownEndsAt, endsAt,
// resultsEndsAt, infectReadyAt) a la hora local del navegador. Lógica pura: la hora local se pasa
// siempre como parámetro (Date.now() en el navegador, un número cualquiera en las pruebas).
//
// createClock() → { sync(serverTime, localNow), now(localNow), remaining(targetServerMs, localNow), synced() }
// formatMMSS(ms) → "m:ss" (minutos sin ceros a la izquierda: "15:00", "1:00", "0:05")

// Cuántas muestras recientes se guardan. Cada mensaje game llega con algo de retraso de red, así que
// serverTime − localNow siempre se queda corto: la muestra mayor es la de menor retraso.
const SAMPLES = 20;

export function createClock() {
    const samples = [];
    let offset = null; // hora del servidor ≈ hora local + offset

    return {
        // Registra una muestra (serverTime del mensaje game y la hora local al recibirlo)
        sync(serverTime, localNow) {
            if (!Number.isFinite(serverTime) || !Number.isFinite(localNow)) return;
            samples.push(serverTime - localNow);
            if (samples.length > SAMPLES) samples.shift();
            offset = Math.max(...samples);
        },
        synced: () => offset !== null,
        // Hora estimada del servidor (sin sincronizar, la local)
        now: (localNow) => localNow + (offset ?? 0),
        // Milisegundos que faltan para una hora del servidor (nunca negativo; 0 si el dato no sirve)
        remaining(targetServerMs, localNow) {
            if (!Number.isFinite(targetServerMs) || !Number.isFinite(localNow)) return 0;
            return Math.max(0, targetServerMs - (localNow + (offset ?? 0)));
        },
    };
}

// Redondea hacia arriba al segundo: con 0,4 s restantes se ve "0:01" hasta que de verdad llega a 0
export function formatMMSS(ms) {
    const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Segundos enteros que faltan (redondeo hacia arriba), para "La partida empieza en N s"
export function secondsLeft(ms) {
    return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
}
