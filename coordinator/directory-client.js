// Cliente HTTP del directorio de coordinadores del auth-service (Taller 6, decisiones 8 y 9; Taller 7, decisión 15).
// Nada de esto lanza: si el auth no responde, el coordinador sigue funcionando.
//
// sendHeartbeat({ authUrl, secret, info, fetchImpl, timeoutMs })             → true | false   (un nodo)
// sendHeartbeatAll({ authUrls, secret, info, fetchImpl, timeoutMs })         → { ok, total }  (todos, en paralelo)
// fetchPeers({ authUrl, selfId, fetchImpl, timeoutMs })                      → [{ coordinatorId, peerUrl }] | null
// fetchCoordinatorPeers({ authUrls, selfId, fetchImpl, timeoutMs })          → la de el primer nodo que responda | null
//   (Taller 7: GET {authUrl}/coordinator-peers; en el Taller 6 era /peers, que ahora lista los nodos de auth)
// startHeartbeatLoop({ authUrls, secret, info, intervalMs, onChange, fetchImpl, timeoutMs }) → stop()
//   info puede ser un objeto o una función que lo devuelve (para mandar los jugadores actuales).
//   onChange(up, { ok, total }) se llama SOLO cuando cambia cuántos nodos responden (la primera vez y luego en
//   cada cambio), nunca en cada latido. up = al menos un nodo respondió 200.
//
// Taller 7: el directorio es estado blando en CADA auth (no pasa por la replicación), así que el heartbeat va a
// TODOS los nodos de AUTH_URLS y cualquiera responde /coordinator, /coordinator-peers y /directory, aun sin líder.
// Nunca se registra el secreto ni los cuerpos.

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const DEFAULT_TIMEOUT_MS = 1500;

// AUTH_URLS o una sola AUTH_URL (compatibilidad)
const listOf = (authUrls, authUrl) => (Array.isArray(authUrls) && authUrls.length > 0 ? authUrls : authUrl ? [authUrl] : []);

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

// El mismo latido a todos los nodos a la vez; cada uno con su timeout (uno lento no frena a los demás)
async function sendHeartbeatAll({ authUrls, authUrl, secret, info, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const urls = listOf(authUrls, authUrl);
    const results = await Promise.all(urls.map((url) => sendHeartbeat({ authUrl: url, secret, info, fetchImpl, timeoutMs })));
    return { ok: results.filter(Boolean).length, total: urls.length };
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
        const res = await fetchImpl(`${authUrl}/coordinator-peers`, { signal: AbortSignal.timeout(timeoutMs) });
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

// Prueba los nodos en orden hasta que uno responde (todos tienen el mismo directorio blando)
async function fetchCoordinatorPeers({ authUrls, authUrl, selfId, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    for (const url of listOf(authUrls, authUrl)) {
        const list = await fetchPeers({ authUrl: url, selfId, fetchImpl, timeoutMs });
        if (list !== null) return list;
    }
    return null;
}

function startHeartbeatLoop({ authUrls, authUrl, secret, info, intervalMs, onChange, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const urls = listOf(authUrls, authUrl);
    let stopped = false;
    let inFlight = false;
    let lastOk = null; // null = todavía sin resultado

    async function beat() {
        if (stopped || inFlight) return; // si el auth tarda, no se acumulan latidos
        inFlight = true;
        const current = typeof info === "function" ? info() : info;
        const result = await sendHeartbeatAll({ authUrls: urls, secret, info: current, fetchImpl, timeoutMs });
        inFlight = false;
        if (stopped) return;
        if (result.ok !== lastOk) {
            lastOk = result.ok;
            onChange?.(result.ok > 0, result);
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

module.exports = { sendHeartbeat, sendHeartbeatAll, fetchPeers, fetchCoordinatorPeers, startHeartbeatLoop, isWsUrl };
