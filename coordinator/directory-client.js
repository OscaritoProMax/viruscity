// Cliente HTTP del directorio de coordinadores del auth-service (Taller 6, decisiones 8 y 9).
// Nada de esto lanza: si el auth no responde, el coordinador sigue funcionando.
//
// sendHeartbeat({ authUrl, secret, info, fetchImpl, timeoutMs }) → true | false
// fetchPeers({ authUrl, selfId, fetchImpl, timeoutMs })          → [{ coordinatorId, peerUrl }] | null
// startHeartbeatLoop({ authUrl, secret, info, intervalMs, onChange, fetchImpl, timeoutMs }) → stop()
//   info puede ser un objeto o una función que lo devuelve (para mandar los jugadores actuales).
//   onChange(up) se llama SOLO cuando cambia el resultado (primero alcanzable/no alcanzable y luego
//   en cada transición), nunca en cada latido.
//
// Nunca se registra el secreto ni los cuerpos.

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const DEFAULT_TIMEOUT_MS = 1500;

async function sendHeartbeat({ authUrl, secret, info, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    try {
        const { coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime } = info;
        const res = await fetchImpl(`${authUrl}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-cluster-secret": secret },
            body: JSON.stringify({ coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status !== 200) return false;
        const json = await res.json();
        return json?.ok === true;
    } catch {
        return false; // red caída, timeout, JSON inválido…
    }
}

// URL ws:// o wss:// válida
function isWsUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 200) return false;
    try {
        const url = new URL(value);
        return url.protocol === "ws:" || url.protocol === "wss:";
    } catch {
        return false;
    }
}

async function fetchPeers({ authUrl, selfId, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    try {
        const res = await fetchImpl(`${authUrl}/peers`, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.status !== 200) return null;
        const json = await res.json();
        if (!Array.isArray(json?.peers)) return null;
        return json.peers
            .filter((p) => p && typeof p.coordinatorId === "string" && ID_REGEX.test(p.coordinatorId) && p.coordinatorId !== selfId && isWsUrl(p.peerUrl))
            .map((p) => ({ coordinatorId: p.coordinatorId, peerUrl: p.peerUrl.replace(/\/+$/, "") }));
    } catch {
        return null;
    }
}

function startHeartbeatLoop({ authUrl, secret, info, intervalMs, onChange, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    let stopped = false;
    let inFlight = false;
    let last = null; // null = todavía sin resultado

    async function beat() {
        if (stopped || inFlight) return; // si el auth tarda, no se acumulan latidos
        inFlight = true;
        const current = typeof info === "function" ? info() : info;
        const up = await sendHeartbeat({ authUrl, secret, info: current, fetchImpl, timeoutMs });
        inFlight = false;
        if (stopped) return;
        if (up !== last) {
            last = up;
            onChange?.(up);
        }
    }

    beat();
    const timer = setInterval(beat, intervalMs);
    timer.unref?.(); // el heartbeat no mantiene vivo el proceso

    return function stop() {
        stopped = true;
        clearInterval(timer);
    };
}

module.exports = { sendHeartbeat, fetchPeers, startHeartbeatLoop, isWsUrl };
