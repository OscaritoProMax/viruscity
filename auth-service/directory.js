// Directorio de coordinadores (Taller 6): lógica PURA, sin Express ni red, con el reloj inyectable.
//
// createDirectory({ ttlMs, reservationTtlMs, maxCoordinators = 50, now = Date.now }) → {
//   validateHeartbeat(body) → { ok: true, value } | { ok: false, error }
//   heartbeat(value)        → { ok: true } | { ok: false, status: 503, error: "directory_full" }
//   sweep()                 elimina los coordinadores expirados (y sus reservas)
//   alive()                 entradas vivas en orden de registro
//   pick()                  el vivo con menor carga efectiva (o null) y le registra una reserva
//   peers()                 [{ coordinatorId, peerUrl }] de los vivos
//   list()                  [{ coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime, ageMs }] de los vivos
// }
//
// Un coordinador está vivo si now() - lastSeen <= ttlMs. El Map conserva el orden de registro: un
// heartbeat de uno que sigue vivo lo actualiza en su lugar; uno que expiró (y se purgó) vuelve al final.
// Reservas: cada pick() suma 1 a la carga del elegido durante reservationTtlMs, para que varios clientes
// que piden coordinador casi a la vez no caigan todos en el mismo antes de su próximo heartbeat.

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const URL_MAX = 200;
const URL_PROTOCOLS = new Set(["ws:", "wss:"]);

// URL ws:// o wss:// válida de hasta URL_MAX caracteres; devuelve el texto sin barras finales o null
function cleanWsUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > URL_MAX) return null;
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (!URL_PROTOCOLS.has(url.protocol)) return null;
    return value.replace(/\/+$/, "");
}

function validateHeartbeat(body) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
    }
    const { coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime } = body;
    if (typeof coordinatorId !== "string" || !ID_REGEX.test(coordinatorId)) {
        return { ok: false, error: "coordinatorId debe tener de 1 a 32 caracteres: letras, números, guion o guion bajo" };
    }
    const pub = cleanWsUrl(publicUrl);
    if (!pub) return { ok: false, error: `publicUrl debe ser una URL ws:// o wss:// de hasta ${URL_MAX} caracteres` };
    const peer = cleanWsUrl(peerUrl);
    if (!peer) return { ok: false, error: `peerUrl debe ser una URL ws:// o wss:// de hasta ${URL_MAX} caracteres` };
    if (typeof connectedPlayers !== "number" || !Number.isInteger(connectedPlayers) || connectedPlayers < 0) {
        return { ok: false, error: "connectedPlayers debe ser un entero mayor o igual a 0" };
    }
    if (typeof uptime !== "number" || !Number.isFinite(uptime) || uptime < 0) {
        return { ok: false, error: "uptime debe ser un número mayor o igual a 0" };
    }
    return { ok: true, value: { coordinatorId, publicUrl: pub, peerUrl: peer, connectedPlayers, uptime: Math.round(uptime) } };
}

function createDirectory({ ttlMs, reservationTtlMs, maxCoordinators = 50, now = Date.now } = {}) {
    const entries = new Map(); // coordinatorId → { coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime, lastSeen }
    const reservations = new Map(); // coordinatorId → [instantes de cada reserva]

    const isAlive = (entry, t) => t - entry.lastSeen <= ttlMs;

    // Reservas que siguen activas (las de los últimos reservationTtlMs ms); limpia las vencidas
    function activeReservations(id, t) {
        const list = (reservations.get(id) ?? []).filter((at) => t - at < reservationTtlMs);
        if (list.length) reservations.set(id, list);
        else reservations.delete(id);
        return list.length;
    }

    function sweep() {
        const t = now();
        for (const [id, entry] of entries) {
            if (!isAlive(entry, t)) {
                entries.delete(id);
                reservations.delete(id);
            }
        }
    }

    function heartbeat(value) {
        sweep(); // un expirado se purga antes: si vuelve a latir, entra al final del orden
        const t = now();
        const existing = entries.get(value.coordinatorId);
        if (!existing && entries.size >= maxCoordinators) return { ok: false, status: 503, error: "directory_full" };
        const entry = {
            coordinatorId: value.coordinatorId,
            publicUrl: value.publicUrl,
            peerUrl: value.peerUrl,
            connectedPlayers: value.connectedPlayers,
            uptime: value.uptime,
            lastSeen: t,
        };
        if (existing) Object.assign(existing, entry); // mismo lugar en el Map
        else entries.set(value.coordinatorId, entry);
        return { ok: true };
    }

    function alive() {
        sweep();
        return [...entries.values()];
    }

    function pick() {
        const list = alive();
        if (list.length === 0) return null;
        const t = now();
        let best = null;
        let bestLoad = Infinity;
        for (const entry of list) {
            const load = entry.connectedPlayers + (reservationTtlMs > 0 ? activeReservations(entry.coordinatorId, t) : 0);
            if (load < bestLoad) {
                // estrictamente menor: en un empate se queda el primero en orden de registro
                best = entry;
                bestLoad = load;
            }
        }
        if (reservationTtlMs > 0) reservations.set(best.coordinatorId, [...(reservations.get(best.coordinatorId) ?? []), t]);
        return best;
    }

    const peers = () => alive().map(({ coordinatorId, peerUrl }) => ({ coordinatorId, peerUrl }));

    function list() {
        const t = now();
        return alive().map(({ coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime, lastSeen }) => ({
            coordinatorId,
            publicUrl,
            peerUrl,
            connectedPlayers,
            uptime,
            ageMs: t - lastSeen,
        }));
    }

    return { validateHeartbeat, heartbeat, sweep, alive, pick, peers, list, ttlMs, reservationTtlMs };
}

module.exports = { createDirectory, validateHeartbeat };
