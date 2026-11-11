// Núcleo PURO del mesh de coordinadores (Taller 6, decisiones 9-18): sin sockets, sin red, sin tiempo real.
// index.js (y la capa de sockets de la fase siguiente) lo usan para decidir qué hacer con cada conexión
// y cada mensaje; aquí solo hay validación, reglas de propiedad y armado de mensajes.
//
//   shouldInitiate(selfId, peerId)                      → ¿abro yo la conexión? (solo hacia ids mayores)
//   resolveLink(selfId, peerId, { direction, existing }) → 'accept' | 'reject' | 'replace'
//   validatePeerMessage(msg, cfg)                        → { ok: true, msg } | { ok: false, reason }
//   resolveJoin(existing, incoming, selfId)              → 'create' | 'ignore' | 'yield-local' | 'replace-remote'
//   applyPeerMessage(players, selfId, peerId, msg, cfg?) → { membershipChanged, actions }
//   dropPeerPlayers(players, peerId)                     → ids eliminados
//   buildResync(players, selfId)                         → mensajes para un peer recién conectado
//   buildPositionsSync(players, selfId)                  → positions_sync de los locales, o null
//   buildJoined / buildLeft / buildIntent / buildExtras  → mensajes de un jugador local
//
// Regla de oro: cada jugador tiene un DUEÑO (ownerId, el coordinador donde está su cliente). Solo el
// dueño puede mandar intent, extras, posiciones y salida de ese jugador; lo demás se ignora.

const { sanitizeIntent, sanitizeExtras, isLocal } = require("./game.js");

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const PROVIDERS = new Set(["local", "google"]);
const USER_ID_MAX = 64;
const POSITIONS_MAX = 1000;
const TYPES = new Set(["hello", "player_joined", "player_left", "intent_replicate", "extras_replicate", "positions_sync"]);

// ---------- Conexiones ----------

// Solo el de id menor abre la conexión (comparación de strings de JS: "coord-10" < "coord-2")
const shouldInitiate = (selfId, peerId) => selfId < peerId;

// Una sola conexión por par (decisión 10). existing: ¿ya hay una conexión activa con ese peer?
// Entrante de un id MAYOR: si ya hay una, se rechaza la nueva; si no, se acepta.
// Entrante de un id MENOR (el que debe iniciar): reemplaza a cualquier conexión previa.
function resolveLink(selfId, peerId, { direction = "in", existing = false } = {}) {
    if (direction !== "in") return existing ? "reject" : "accept";
    if (peerId > selfId) return existing ? "reject" : "accept";
    return existing ? "replace" : "accept";
}

// ---------- Validación ----------

const fail = (reason) => ({ ok: false, reason });
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// userId siempre string (si llega número se convierte con String())
function normUserId(value) {
    if (typeof value === "number" && Number.isFinite(value)) value = String(value);
    if (typeof value !== "string" || value.length === 0 || value.length > USER_ID_MAX) return null;
    return value;
}

// x/y finitos y dentro del mundo (se limitan a los bordes, dejando el radio libre)
function normPos(x, y, cfg) {
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = cfg.PLAYER_RADIUS ?? 0;
    return { x: clamp(x, r, cfg.WORLD_WIDTH - r), y: clamp(y, r, cfg.WORLD_HEIGHT - r) };
}

function validatePeerMessage(msg, cfg) {
    if (!isObject(msg)) return fail("el mensaje debe ser un objeto");
    if (!TYPES.has(msg.type)) return fail("tipo desconocido");

    if (msg.type === "hello") {
        if (typeof msg.coordinatorId !== "string" || !ID_REGEX.test(msg.coordinatorId)) return fail("hello con coordinatorId inválido");
        return { ok: true, msg: { type: "hello", coordinatorId: msg.coordinatorId } };
    }

    if (typeof msg.origin !== "string" || !ID_REGEX.test(msg.origin)) return fail("origin inválido");
    const origin = msg.origin;

    if (msg.type === "positions_sync") {
        if (!Array.isArray(msg.players) || msg.players.length > POSITIONS_MAX) return fail(`players debe ser una lista de hasta ${POSITIONS_MAX}`);
        const list = [];
        for (const entry of msg.players) {
            if (!isObject(entry)) return fail("entrada de positions_sync inválida");
            const userId = normUserId(entry.userId);
            const pos = normPos(entry.x, entry.y, cfg);
            if (!userId || !pos) return fail("entrada de positions_sync inválida");
            list.push({ userId, x: pos.x, y: pos.y });
        }
        return { ok: true, msg: { type: "positions_sync", origin, players: list } };
    }

    const userId = normUserId(msg.userId);
    if (!userId) return fail("userId inválido");

    switch (msg.type) {
        case "player_joined": {
            if (typeof msg.username !== "string" || !USERNAME_REGEX.test(msg.username)) return fail("username inválido");
            if (!PROVIDERS.has(msg.provider)) return fail("provider inválido");
            const pos = normPos(msg.x, msg.y, cfg);
            if (!pos) return fail("posición inválida");
            if (typeof msg.connectedAtMs !== "number" || !Number.isFinite(msg.connectedAtMs) || msg.connectedAtMs < 0) return fail("connectedAtMs inválido");
            return {
                ok: true,
                msg: { type: "player_joined", origin, userId, username: msg.username, provider: msg.provider, x: pos.x, y: pos.y, connectedAtMs: msg.connectedAtMs },
            };
        }
        case "player_left":
            return { ok: true, msg: { type: "player_left", origin, userId } };
        case "intent_replicate": {
            const dir = sanitizeIntent({ intent: msg.intent });
            if (!dir) return fail("intent inválido");
            return { ok: true, msg: { type: "intent_replicate", origin, userId, intent: { dir } } };
        }
        case "extras_replicate": {
            const extras = sanitizeExtras({ extras: msg.extras }, cfg);
            if (!extras) return fail("extras inválidos");
            return { ok: true, msg: { type: "extras_replicate", origin, userId, extras } };
        }
        default:
            return fail("tipo desconocido");
    }
}

// ---------- Conflicto de sesión (decisión 16) ----------

// ¿La sesión a es más nueva que b? Mayor connectedAtMs; empate → mayor coordinatorId
const isNewer = (a, b) => a.connectedAtMs > b.connectedAtMs || (a.connectedAtMs === b.connectedAtMs && a.coordinatorId > b.coordinatorId);

// existing: el jugador que ya hay aquí (o undefined); incoming: { connectedAtMs, origin }
function resolveJoin(existing, incoming, selfId) {
    if (!existing) return "create";
    const theirs = { connectedAtMs: incoming.connectedAtMs, coordinatorId: incoming.origin };
    if (isLocal(existing) || existing.ownerId === selfId) {
        const mine = { connectedAtMs: existing.connectedAtMs ?? 0, coordinatorId: selfId };
        return isNewer(theirs, mine) ? "yield-local" : "ignore";
    }
    const current = { connectedAtMs: existing.connectedAtMs ?? 0, coordinatorId: existing.ownerId };
    return isNewer(theirs, current) ? "replace-remote" : "ignore";
}

// Jugador remoto (su cliente está en otro coordinador): sin socket y sin intención hasta que el dueño la mande
function remotePlayer(msg) {
    return {
        username: msg.username,
        provider: msg.provider,
        ownerId: msg.origin,
        connectedAtMs: msg.connectedAtMs,
        socket: null,
        connectedAt: new Date(msg.connectedAtMs).toISOString(),
        x: msg.x,
        y: msg.y,
        intent: { x: 0, y: 0 },
        extras: {},
    };
}

// ---------- Aplicar mensajes de un peer ----------

const NOTHING = () => ({ membershipChanged: false, actions: [] });

// Muta el Map con un mensaje YA validado (validatePeerMessage) que llegó por la conexión con peerId.
// Devuelve si cambió la lista de jugadores (para enviar players_update) y las acciones pendientes
// (close-local: cerrar el socket local de quien inició sesión en otro coordinador; lleva el socket).
function applyPeerMessage(players, selfId, peerId, msg, cfg = null) {
    // Anti-bucles: lo propio se descarta; y cada conexión solo puede hablar por su propio peer
    if (!msg || msg.origin === selfId || msg.origin !== peerId) return NOTHING();

    const owned = (p) => p && !isLocal(p) && p.ownerId === peerId;

    switch (msg.type) {
        case "player_joined": {
            const existing = players.get(msg.userId);
            const decision = resolveJoin(existing, msg, selfId);
            if (decision === "ignore") return NOTHING();
            if (decision === "yield-local") {
                // La sesión nueva está en el otro coordinador: el local se cierra y pasa a remoto (SIN player_left)
                players.set(msg.userId, remotePlayer(msg));
                return {
                    membershipChanged: true,
                    actions: [{ type: "close-local", userId: msg.userId, code: 4002, reason: "replaced by new session", socket: existing.socket }],
                };
            }
            players.set(msg.userId, remotePlayer(msg)); // create o replace-remote
            return { membershipChanged: true, actions: [] };
        }
        case "player_left": {
            const p = players.get(msg.userId);
            if (!owned(p)) return NOTHING();
            players.delete(msg.userId);
            return { membershipChanged: true, actions: [] };
        }
        case "intent_replicate": {
            const p = players.get(msg.userId);
            if (owned(p)) p.intent = { x: msg.intent.dir.x, y: msg.intent.dir.y };
            return NOTHING();
        }
        case "extras_replicate": {
            const p = players.get(msg.userId);
            if (owned(p)) p.extras = msg.extras;
            return NOTHING();
        }
        case "positions_sync": {
            for (const entry of msg.players) {
                const p = players.get(entry.userId);
                if (!owned(p)) continue; // solo jugadores de ese peer; desconocidos y ajenos se ignoran
                const pos = cfg ? normPos(entry.x, entry.y, cfg) : entry;
                if (!pos) continue;
                p.x = pos.x;
                p.y = pos.y;
            }
            return NOTHING();
        }
        default:
            return NOTHING(); // hello se maneja en la conexión
    }
}

// Peer caído: se eliminan sus jugadores remotos
function dropPeerPlayers(players, peerId) {
    const removed = [];
    for (const [userId, p] of players) {
        if (!isLocal(p) && p.ownerId === peerId) {
            players.delete(userId);
            removed.push(userId);
        }
    }
    return removed;
}

// ---------- Mensajes salientes ----------

const buildJoined = (userId, p, selfId) => ({
    type: "player_joined",
    origin: selfId,
    userId,
    username: p.username,
    provider: p.provider,
    x: p.x,
    y: p.y,
    connectedAtMs: p.connectedAtMs,
});
const buildLeft = (userId, selfId) => ({ type: "player_left", origin: selfId, userId });
const buildIntent = (userId, intent, selfId) => ({ type: "intent_replicate", origin: selfId, userId, intent: { dir: { x: intent.x, y: intent.y } } });
const buildExtras = (userId, extras, selfId) => ({ type: "extras_replicate", origin: selfId, userId, extras });

const localEntries = (players, selfId) => [...players].filter(([, p]) => isLocal(p) && p.ownerId === selfId);

// Resync para un peer recién conectado (decisión 17): primero todos los player_joined (con su
// connectedAtMs original), luego los intents distintos de (0,0) y los extras no vacíos
function buildResync(players, selfId) {
    const locals = localEntries(players, selfId);
    const messages = locals.map(([userId, p]) => buildJoined(userId, p, selfId));
    for (const [userId, p] of locals) {
        if (p.intent && (p.intent.x !== 0 || p.intent.y !== 0)) messages.push(buildIntent(userId, p.intent, selfId));
    }
    for (const [userId, p] of locals) {
        if (p.extras && Object.keys(p.extras).length > 0) messages.push(buildExtras(userId, p.extras, selfId));
    }
    return messages;
}

// Posiciones de los locales (corrige la deriva de la simulación en los demás coordinadores)
function buildPositionsSync(players, selfId) {
    const locals = localEntries(players, selfId);
    if (locals.length === 0) return null;
    return { type: "positions_sync", origin: selfId, players: locals.map(([userId, p]) => ({ userId, x: p.x, y: p.y })) };
}

module.exports = {
    ID_REGEX,
    shouldInitiate,
    resolveLink,
    validatePeerMessage,
    resolveJoin,
    applyPeerMessage,
    dropPeerPlayers,
    buildResync,
    buildPositionsSync,
    buildJoined,
    buildLeft,
    buildIntent,
    buildExtras,
};
