// Coordinator (Taller 5): servidor autoritativo del juego en vivo.
// Los jugadores se conectan por WebSocket en /connect?token=XXX con un JWT válido del auth-service.
// Los clientes solo mandan intenciones (dirección) y extras; el servidor mueve a todos en un game loop
// y envía el estado completo en cada tick. HTTP y WebSocket comparten el mismo puerto.
//
// Taller 6: puede haber varias instancias a la vez. Cada una se configura con su propio archivo:
//   node index.js --env .env.coord-a     (npm run start:a, start:b, start:c)
// Sin --env se usa coordinator/.env. Las variables que ya están en el entorno NO se pisan.
// JWT_SECRET y CLUSTER_SECRET deben ser idénticos a los del auth-service.
//
// Basado en coordinator/index.js del código de referencia SSD-CommsWS.

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { loadConfig, envFileArg } = require("./config.js");
const http = require("node:http");
const express = require("express");
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const { resumePosition, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot, isLocal, localPlayers, countLocal } = require("./game.js");
const { startHeartbeatLoop } = require("./directory-client.js");
const { createPeerNetwork } = require("./peers.js");
const { buildJoined, buildLeft, buildIntent, buildExtras } = require("./mesh.js");
const { createMatchState, advance, applyAction, buildClientView, frozenUserIds, isGhost, plazaSpawns, validateMatchState } = require("./match.js");
const { openStateStore, mergeEntry, validateEntry, isFresh } = require("./persist.js");
const { POSITIONS_MAX } = require("./mesh.js");
const { buildCity } = require("./city.js");
const { sanitizeGameAction, selectEventsToDeliver, routeEvents, computeArbiter, shouldAdoptGameState, GAME_ACTIONS_PER_SEC } = require("./arbiter.js");

// ---------- Configuración ----------

// Detiene el proceso con un motivo claro si la configuración no es válida
function fatal(reason) {
    console.error(`Error de configuración: ${reason}`);
    process.exit(1);
}

// Archivo de entorno: --env <ruta> (relativa a la carpeta desde donde se lanza) o coordinator/.env.
// dotenv no pisa las variables que ya existen en el entorno (las pruebas pueden inyectarlas).
const envArg = envFileArg(process.argv);
if (envArg !== null) {
    if (!envArg) fatal("--env necesita la ruta de un archivo (por ejemplo --env .env.coord-a)");
    const envPath = path.resolve(process.cwd(), envArg);
    if (!fs.existsSync(envPath)) fatal(`no existe el archivo de entorno ${envPath}`);
    dotenv.config({ path: envPath, quiet: true }); // quiet: evita que dotenv imprima su propio mensaje
} else {
    dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });
}

// Identidad, puertos, URLs, secretos, tiempos del clúster, mapa y juego (config.js valida todo)
let conf;
try {
    conf = loadConfig(process.env, { baseDir: __dirname });
} catch (err) {
    fatal(err.message);
}
const COORDINATOR_ID = conf.coordinatorId;
const PORT = conf.port;
const JWT_SECRET = conf.jwtSecret;
const HEARTBEAT_INTERVAL_MS = conf.clientHeartbeatMs;
const map = conf.map;
const cfg = conf.game;

const PROVIDERS = new Set(["local", "google"]);
const RATE_WINDOW_MS = 1000;

// ---------- Estado ----------
// userId (string) -> { username, provider, ownerId, connectedAtMs, socket, connectedAt, x, y, intent:{x,y}, extras:{} }
// Taller 6: el Map tiene a TODOS los jugadores del mundo. Los LOCALES (su cliente está conectado aquí)
// tienen socket y ownerId = COORDINATOR_ID; los REMOTOS (de otro coordinador del mesh) tienen socket null
// y ownerId del peer dueño. El game loop simula a todos.
const players = new Map();

// Puntos de extensión para el mesh (Taller 6): index.js los llama en cada evento de un jugador LOCAL.
// Por ahora están vacíos; el mesh los usará para avisar a los demás coordinadores.
const hooks = {
    onLocalJoin(userId, player) {}, // eslint-disable-line no-unused-vars
    onLocalLeave(userId) {}, // eslint-disable-line no-unused-vars
    onLocalIntent(userId, intent) {}, // solo cuando el intent cambió  // eslint-disable-line no-unused-vars
    onLocalExtras(userId, extras) {}, // eslint-disable-line no-unused-vars
};

// Estado del heartbeat al clúster de auth (null = todavía sin respuesta): alcanzable si al menos un nodo
// respondió; authNodesUp cuenta cuántos de AUTH_URLS respondieron en el último latido (Taller 7)
let authReachable = null;
let authNodesUp = { up: 0, total: conf.authUrls.length };

// ---------- Partida de Viruscity ----------
// Toda la lógica está en match.js (reducer puro) y arbiter.js; aquí solo se cablea. La ciudad (zonas y
// estaciones) sale de city.js (o del mapa). Un solo ÁRBITRO decide la partida: el coordinador de menor id entre este y sus
// peers ready (decisión 16). El árbitro ejecuta advance/applyAction y replica game_state a los peers; los
// demás (seguidores) solo adoptan lo que replica el árbitro.
// Con el mapa de Virus City la ciudad (edificios reales, estaciones y plaza) viene en MAP_FILE; sin mapa se escala
let city;
try {
    city = buildCity({ width: cfg.WORLD_WIDTH, height: cfg.WORLD_HEIGHT }, map);
} catch (err) {
    fatal(err.message);
}
let match = createMatchState();
let lastDeliveredEid = 0; // último eid de evento entregado a los clientes locales (decisión 19)
let arbiterId = COORDINATOR_ID; // se recalcula cuando un peer pasa a ready o se cierra
let hasState = false; // true al adoptar un game_state, tras la espera de sincronización o jugando solo
let pendingEvents = []; // eventos generados desde el último game_state (los replica el árbitro)
const isArbiter = () => arbiterId === COORDINATOR_ID;

// Mesh con los otros coordinadores (Taller 6): servidor de peers en PEER_PORT
const net = createPeerNetwork({
    selfId: COORDINATOR_ID,
    peerPort: conf.peerPort,
    clusterSecret: conf.clusterSecret,
    authUrls: conf.authUrls,
    discoveryMs: conf.peerDiscoveryMs,
    pingMs: conf.peerPingMs,
    syncMs: conf.peerSyncMs,
    cfg,
    players,
    // Un peer agregó o quitó jugadores: los clientes locales reciben la lista nueva
    onMembershipChanged: () => broadcastPlayers(),
    // La sesión más nueva del usuario está en otro coordinador: se cierra la local (SIN player_left;
    // el jugador ya quedó como remoto en el Map, así que el 'close' del socket no lo borra)
    onCloseLocal(action) {
        console.log(`Sesión de ${action.userId} reemplazada por una más nueva en otro coordinador`);
        action.socket?.close(action.code, action.reason);
    },
    // Partida (V3): estado replicado por el árbitro y acciones reenviadas por los dueños de los jugadores
    onGameMessage: (peerId, action) => {
        if (action.type === "game_state") onGameState(action);
        else if (action.type === "game_action") onRemoteAction(peerId, action);
        else if (action.type === "world_snapshot") onWorldSnapshot(peerId, action);
    },
    onPeerReady: (peerId) => onPeerReady(peerId),
    onPeerClosed: (peerId) => onPeerClosed(peerId),
});

// Los eventos de los jugadores LOCALES se anuncian a los peers (cada uno solo habla de los suyos)
Object.assign(hooks, {
    onLocalJoin: (userId, p) => net.sendToPeers(buildJoined(userId, p, COORDINATOR_ID)),
    onLocalLeave: (userId) => net.sendToPeers(buildLeft(userId, COORDINATOR_ID)),
    onLocalIntent: (userId, intent) => net.sendToPeers(buildIntent(userId, intent, COORDINATOR_ID)),
    onLocalExtras: (userId, extras) => net.sendToPeers(buildExtras(userId, extras, COORDINATOR_ID)),
});
// userId -> entrada { userId, username, x, y, extras, version, savedAt, ownerId }: lo último que se sabe de cada
// jugador. Al volver (recargar la página, otra pestaña, reconexión) aparece donde estaba: el cliente no puede
// elegir dónde aparecer. Track 2.1: además se guarda en la base del coordinador (STATE_DB_PATH) y se recupera
// al reiniciar, y se intercambia con los peers (world_snapshot) al entrar al mesh.
const lastPositions = new Map();

// ---------- Persistencia (track 2.1 del examen final) ----------
// Cada PERSIST_MS se guarda en la base PROPIA de este coordinador lo que sabe de cada jugador y la partida.
// Al arrancar se recupera lo que tenga menos de PERSIST_MAX_AGE_MS. La reconciliación está en persist.js.
const persistCfg = conf.persist;
let store = null;
let restoredMatch = false; // true si al arrancar se recuperó una partida (se ofrece al árbitro al conectar)
let lastPersistAt = null;
let persistFailed = false;
if (persistCfg.dbPath) {
    try {
        store = openStateStore(persistCfg.dbPath);
    } catch (err) {
        fatal(`no se pudo abrir la base de estado STATE_DB_PATH (${err.message})`);
    }
    const now = Date.now();
    let recovered = 0;
    for (const row of store.loadPlayers()) {
        if (mergeEntry(lastPositions, validateEntry(row, cfg), { now, maxAgeMs: persistCfg.maxAgeMs })) recovered += 1;
    }
    const saved = store.loadMatch();
    let matchText = "sin partida guardada";
    if (saved && isFresh(saved, now, persistCfg.maxAgeMs)) {
        const v = validateMatchState(saved.match);
        if (v.ok) {
            match = v.match;
            restoredMatch = match.matchId > 0;
            matchText = `partida ${match.matchId} en ${match.phase} (rev ${match.rev})`;
        } else {
            matchText = "partida guardada inválida (se ignora)";
        }
    } else if (saved) {
        matchText = "partida guardada demasiado vieja (se ignora)";
    }
    console.log(`Persistencia: ${path.basename(persistCfg.dbPath)} · ${recovered} jugadores recuperados · ${matchText}`);
}

// Entrada persistible de un jugador vivo. Un jugador LOCAL que cambió (posición, extras o nombre) sube de
// versión: la versión la incrementa solo su dueño, así el orden no depende del reloj de cada máquina.
// Las copias REMOTAS conservan la versión que anuncia el dueño en positions_sync (nunca menos de la conocida).
function rememberPlayer(userId, p, now = Date.now()) {
    const prev = lastPositions.get(userId);
    const extras = p.extras ?? {};
    let version = Math.max(p.version ?? 0, prev?.version ?? 0);
    if (isLocal(p)) {
        const changed = !prev || prev.x !== p.x || prev.y !== p.y || prev.username !== p.username || JSON.stringify(prev.extras ?? {}) !== JSON.stringify(extras);
        if (changed) version += 1;
        p.version = version;
    }
    const entry = { userId, username: p.username, x: p.x, y: p.y, extras, version, savedAt: now, ownerId: p.ownerId };
    lastPositions.set(userId, entry);
    return entry;
}

// Guarda en la base: todos los jugadores conocidos (vivos y desconectados recientes) y la partida
function persistNow(now = Date.now()) {
    if (!store) return;
    for (const [userId, p] of players) rememberPlayer(userId, p, now);
    for (const [userId, e] of lastPositions) if (!players.has(userId) && !isFresh(e, now, persistCfg.maxAgeMs)) lastPositions.delete(userId);
    try {
        store.savePlayers([...lastPositions.values()], { pruneBefore: now - persistCfg.maxAgeMs });
        store.saveMatch(match, now);
        lastPersistAt = now;
        if (persistFailed) console.log("Persistencia: se volvió a guardar correctamente");
        persistFailed = false;
    } catch (err) {
        if (!persistFailed) console.error(`Persistencia: no se pudo guardar (${err.message}); se reintenta cada ${persistCfg.everyMs} ms`);
        persistFailed = true;
    }
}
const persistTicker = store ? setInterval(() => persistNow(), persistCfg.everyMs) : null;

// world_snapshot para un peer recién conectado: lo que sé de cada jugador, en trozos que caben en un mensaje
const SNAPSHOT_CHUNK = 200;
function sendWorldSnapshot(peerId) {
    const now = Date.now();
    for (const [userId, p] of players) rememberPlayer(userId, p, now);
    const entries = [...lastPositions.values()].filter((e) => isFresh(e, now, persistCfg.maxAgeMs)).slice(0, POSITIONS_MAX * 5);
    for (let i = 0; i < entries.length; i += SNAPSHOT_CHUNK) {
        net.sendToPeer(peerId, { type: "world_snapshot", origin: COORDINATOR_ID, players: entries.slice(i, i + SNAPSHOT_CHUNK) });
    }
}

// world_snapshot de un peer: por cada jugador gana la versión más alta; los que están vivos aquí no se tocan
function onWorldSnapshot(peerId, { players: entries }) {
    const live = new Set(players.keys());
    const now = Date.now();
    let updated = 0;
    for (const e of entries) if (mergeEntry(lastPositions, e, { live, now, maxAgeMs: persistCfg.maxAgeMs })) updated += 1;
    if (updated > 0) console.log(`Persistencia: ${updated} jugadores actualizados con el snapshot de ${peerId}`);
}

// ---------- HTTP ----------
const app = express();

// Log de cada petición HTTP: solo fecha, método, ruta (sin query) y status.
// Nunca se registra la query: en /connect lleva el token.
app.use((req, res, next) => {
    res.on("finish", () => {
        const route = req.originalUrl.split("?")[0];
        console.log(`${new Date().toISOString()} ${req.method} ${route} ${res.statusCode}`);
    });
    next();
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", coordinatorId: COORDINATOR_ID, players: players.size, tickRate: cfg.TICK_RATE, map: map ? map.id : null });
});

// Estado de esta instancia en el clúster (decisión 21)
app.get("/status", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json({
        coordinatorId: COORDINATOR_ID,
        uptime: Math.floor(process.uptime()),
        localPlayers: countLocal(players),
        totalPlayers: players.size,
        peers: net.readyPeerIds(), // ids de peers con handshake completo
        authReachable: authReachable === true,
        authNodesUp,
        // Track 2.1: ¿persiste?, cada cuánto, último guardado y cuántos jugadores conoce
        persistence: { enabled: store !== null, everyMs: persistCfg.everyMs, lastSavedAt: lastPersistAt, knownPlayers: lastPositions.size },
        // Partida (sin roles): fase, número de partida, versión, cura y tamaño del roster
        match: {
            phase: match.phase,
            matchId: match.matchId,
            rev: match.rev,
            cure: match.cure,
            rosterSize: Object.keys(match.roster).length,
            arbiterId,
        },
    });
});

// Cualquier otra ruta HTTP
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// Errores no previstos: solo el mensaje al log, respuesta JSON genérica
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error(`Error interno: ${err.message}`);
    res.status(500).json({ error: "Error interno del servidor" });
});

const server = http.createServer(app);

// ---------- WebSocket ----------
// noServer: el handshake se acepta a mano en el evento 'upgrade', después de verificar el token.
// maxPayload: los mensajes del cliente (intent, extras_update) son pequeños; más de 2048 bytes cierra el socket.
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

// Devuelve el payload si el token es válido; null si falta, está malformado, vencido,
// firmado con otra clave o le faltan datos. Nunca registra el token.
function verifyToken(token) {
    try {
        const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
        const complete =
            typeof payload.userId === "string" &&
            typeof payload.username === "string" &&
            PROVIDERS.has(payload.provider) && // Taller 5: el JWT trae provider 'local' o 'google'
            typeof payload.exp === "number"; // exp se necesita para programar el cierre por expiración
        if (!complete) {
            console.log("Conexión rechazada: payload del token incompleto");
            return null;
        }
        return payload;
    } catch (err) {
        // Los mensajes de jsonwebtoken ("jwt expired", "invalid signature"...) no incluyen el token
        console.log(`Conexión rechazada: ${err.message}`);
        return null;
    }
}

// El handshake se valida aquí, antes de aceptar la conexión
server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {}); // un reset del cliente durante el handshake no debe tumbar el proceso

    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/connect") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
    }

    const payload = verifyToken(url.searchParams.get("token"));

    if (!payload) {
        // Se completa el handshake y se cierra con 4001 en vez de responder 401 por HTTP:
        // el navegador no puede leer el status de un upgrade rechazado, pero sí el código de cierre.
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.on("error", () => {});
            ws.close(4001, "invalid token");
        });
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, payload);
    });
});

// ---------- Jugadores ----------

// Envía un mensaje JSON solo si el socket sigue abierto (adaptado de send() del código base)
function send(ws, message) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

// Envía la lista de jugadores a los clientes LOCALES (incluido el recién llegado). La lista tiene a
// TODOS los jugadores del mundo (locales y remotos), cada uno con su coordinatorId (dueño).
// A diferencia del broadcast() del base, recorre el Map y no wss.clients: así no se envía
// nada a sockets rechazados con 4001 que aún no terminaron de cerrarse.
function broadcastPlayers() {
    const message = {
        type: "players_update",
        players: [...players].map(([userId, p]) => ({ userId, username: p.username, coordinatorId: p.ownerId })),
    };
    for (const p of players.values()) if (isLocal(p)) send(p.socket, message);
}

wss.on("connection", (ws, payload) => {
    const { userId, username, provider } = payload;

    // Sesión duplicada: se queda la conexión nueva y se cierra la anterior con 4002.
    // La posición NO se elige de nuevo: la sesión nueva sigue donde estaba la anterior (o donde quedó
    // al desconectarse); solo la primera vez se aparece al azar.
    // Si existía como REMOTO (conectado en otro coordinador), el local nuevo lo reemplaza.
    // Viruscity: un miembro del roster que VUELVE durante la partida (no tenía sesión abierta) reaparece en
    // su punto de la plaza; si solo reemplaza una sesión abierta, sigue donde estaba (no es un teletransporte).
    const previous = players.get(userId);
    const plazaSpot = !previous && match.phase === "playing" && Object.hasOwn(match.roster, userId) ? plazaSpawns(match, city)[userId] : null;
    const saved = previous ? { x: previous.x, y: previous.y } : lastPositions.get(userId);
    const { x, y } = plazaSpot ?? resumePosition(saved, cfg, map);
    const player = {
        username,
        provider, // lo pone el servidor desde el JWT (no es un extra del cliente)
        ownerId: COORDINATOR_ID, // dueño: este coordinador (Taller 6)
        connectedAtMs: Date.now(),
        socket: ws,
        connectedAt: new Date().toISOString(),
        x,
        y,
        intent: { x: 0, y: 0 },
        // Track 2.1: recupera también sus extras (color…), saneados otra vez por si vienen de la base o de un peer
        extras: sanitizeExtras({ extras: previous?.extras ?? lastPositions.get(userId)?.extras ?? {} }, cfg) ?? {},
        version: Math.max(previous?.version ?? 0, lastPositions.get(userId)?.version ?? 0), // track 2.1
    };
    players.set(userId, player);
    if (previous && isLocal(previous)) {
        previous.socket.close(4002, "replaced by new session");
        console.log(`Sesión reemplazada: ${username} (${userId})`);
    } else if (previous) {
        console.log(`Jugador conectado: ${username} (${userId}) · reemplaza su sesión en ${previous.ownerId} · jugadores: ${players.size}`);
    } else {
        console.log(`Jugador conectado: ${username} (${userId}) · jugadores: ${players.size}`);
    }
    hooks.onLocalJoin(userId, player);
    if (Object.keys(player.extras).length > 0) hooks.onLocalExtras(userId, player.extras);

    // Bienvenida: quién soy, cómo es el mundo, la ciudad de la partida (zonas, estaciones y plaza) y las
    // reglas que el cliente necesita para dibujar (decisión 20). Luego, de inmediato, su vista 'game'.
    send(ws, {
        type: "welcome",
        coordinatorId: COORDINATOR_ID,
        you: { userId, username, provider },
        world: { width: cfg.WORLD_WIDTH, height: cfg.WORLD_HEIGHT, playerRadius: cfg.PLAYER_RADIUS, tickRate: cfg.TICK_RATE },
        city,
        game: {
            minPlayers: cfg.MIN_PLAYERS_TO_START,
            missionMinMs: cfg.MISSION_MIN_MS,
            missionMaxMs: cfg.MISSION_MAX_MS,
            infectRange: cfg.INFECT_RANGE,
            missionRange: cfg.MISSION_RANGE,
        },
    });
    sendView(userId, player, Date.now());
    broadcastPlayers();

    // Heartbeat: se marca vivo al conectar y cada vez que responde un ping
    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    // Si el token vence con el socket abierto, se cierra con 4001 "token expired".
    // setTimeout acepta como máximo 2^31-1 ms (~24,8 días).
    const msLeft = payload.exp * 1000 - Date.now();
    const expiryTimer = setTimeout(() => ws.close(4001, "token expired"), Math.max(0, Math.min(msLeft, 2147483647)));

    ws.on("close", (code) => {
        clearTimeout(expiryTimer);

        // Solo se elimina si este es el socket vigente: el cierre de una sesión reemplazada
        // no debe borrar a la conexión nueva del mismo usuario.
        if (players.get(userId)?.socket !== ws) return;
        const gone = players.get(userId);
        rememberPlayer(userId, gone);
        players.delete(userId);
        console.log(`Jugador desconectado: ${username} (${userId}) código ${code} · jugadores: ${players.size}`);
        hooks.onLocalLeave(userId);
        broadcastPlayers();
    });

    ws.on("error", (err) => {
        console.error(`Error en el socket de ${username} (${userId}): ${err.message}`);
    });

    // Mensajes del cliente: solo se GUARDAN la intención y los extras; nunca se mueve aquí
    // ni se hace broadcast (eso lo hace el game loop). Lo inválido se ignora sin responder,
    // y nada de lo recibido se registra en logs.
    let windowStart = Date.now();
    let messagesInWindow = 0;
    let actionsInWindow = 0; // game_action: límite propio de GAME_ACTIONS_PER_SEC por segundo

    ws.on("message", (raw) => {
        // Límite de mensajes por segundo y por socket: el exceso se descarta en silencio
        const now = Date.now();
        if (now - windowStart >= RATE_WINDOW_MS) {
            windowStart = now;
            messagesInWindow = 0;
            actionsInWindow = 0;
        }
        messagesInWindow += 1;
        if (messagesInWindow > cfg.MAX_MSGS_PER_SEC) return;

        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return; // JSON roto
        }

        // Solo cuenta si este socket sigue siendo la sesión vigente del usuario
        const p = players.get(userId);
        if (!p || p.socket !== ws) return;

        if (msg?.type === "intent") {
            const intent = sanitizeIntent(msg);
            if (!intent) return;
            const changed = intent.x !== p.intent.x || intent.y !== p.intent.y;
            p.intent = intent;
            if (changed) hooks.onLocalIntent(userId, intent);
        } else if (msg?.type === "extras_update") {
            const extras = sanitizeExtras(msg, cfg);
            if (!extras) return;
            p.extras = extras; // reemplazo completo
            hooks.onLocalExtras(userId, extras);
        } else if (msg?.type === "game_action") {
            // Acción de la partida (decisión 20): validada y con su propio límite por segundo
            const action = sanitizeGameAction(msg);
            if (!action) return;
            actionsInWindow += 1;
            if (actionsInWindow > GAME_ACTIONS_PER_SEC) return;
            handleAction(userId, action);
        }
        // Cualquier otro tipo se ignora
    });
});

// ---------- Heartbeat ----------
// Cada HEARTBEAT_INTERVAL_MS se hace ping; quien no respondió al ping anterior se termina
// (detecta conexiones muertas que nunca enviaron el cierre, p. ej. sin red).
const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) {
            ws.terminate(); // dispara 'close', que lo quita del Map y avisa a los demás
            continue;
        }
        ws.isAlive = false;
        ws.ping();
    }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));

// ---------- Game loop ----------
// A TICK_RATE Hz: aplica las intenciones guardadas (dt real medido con Date.now(), acotado a 0.25 s)
// y envía UN mensaje state por tick a los clientes LOCALES. Es el único lugar donde se mueve a alguien.
// Taller 6: simula a TODOS (locales y remotos) aunque no haya clientes locales.
let lastTick = Date.now();

function tick() {
    const now = Date.now();
    const dt = clampDt(now - lastTick);
    lastTick = now;
    if (players.size === 0) return;

    // Viruscity: quien hace una misión queda inmóvil (el servidor ignora su intención)
    const frozen = frozenUserIds(match);
    for (const [userId, p] of players) p.frozen = frozen.has(userId);
    stepPlayers(players, dt, cfg, map);
    if (countLocal(players) === 0) return; // nadie a quien enviarle el state

    // El JSON se arma una sola vez por tick y se reutiliza para todos los sockets locales.
    // Durante la partida, los que no están en el roster van con ghost:true (nunca se envían roles).
    const ghostOf = match.phase === "playing" ? (userId) => isGhost(match, userId) : null;
    const message = JSON.stringify({ type: "state", t: now, coordinatorId: COORDINATOR_ID, players: snapshot(players, ghostOf) });
    for (const p of players.values()) {
        if (isLocal(p) && p.socket.readyState === p.socket.OPEN) p.socket.send(message);
    }
}

// Programación con hora objetivo en vez de setInterval: en Windows los temporizadores tienen una
// granularidad de ~15,6 ms y setInterval(50) dispara cada ~60 ms (≈16,5 Hz). Apuntando cada tick a
// "objetivo += TICK_MS", los retrasos se compensan y la media queda en TICK_RATE Hz.
let nextTickAt = Date.now() + cfg.TICK_MS;
let gameLoop = null;

function scheduleTick() {
    gameLoop = setTimeout(() => {
        tick();
        nextTickAt += cfg.TICK_MS;
        // Si el proceso se atrasó mucho (p. ej. estuvo pausado), no se recupera con una ráfaga de ticks
        if (nextTickAt < Date.now() - cfg.TICK_MS) nextTickAt = Date.now();
        scheduleTick();
    }, Math.max(0, nextTickAt - Date.now()));
}
scheduleTick();

// ---------- Partida: tick, acciones, eventos y vistas ----------
// El reducer recibe a TODOS los jugadores del mundo (locales y remotos) con su posición actual.
function matchCtx(now = Date.now()) {
    const list = [];
    for (const [userId, p] of players) list.push({ userId, username: p.username, x: p.x, y: p.y });
    return { now, players: list, cfg, city, rng: Math.random };
}

const localIds = () => new Set(localPlayers(players).map(([userId]) => userId));

// Vista personalizada 'game' para un jugador local (sin información oculta)
function sendView(userId, p, now) {
    send(p.socket, buildClientView(match, userId, { now, connected: players.size, cfg }));
}

// Entrega a los clientes locales los eventos nuevos y luego su vista actualizada
function deliverEvents(events) {
    const { deliver, newLast } = selectEventsToDeliver(events, lastDeliveredEid, match.eid);
    lastDeliveredEid = newLast;
    if (deliver.length === 0) return;
    const affected = new Set();
    for (const { userId, msg } of routeEvents(deliver, localIds())) {
        if (userId === null) {
            for (const [id, p] of localPlayers(players)) {
                send(p.socket, msg);
                affected.add(id);
            }
        } else {
            const p = players.get(userId);
            if (p && isLocal(p)) {
                send(p.socket, msg);
                affected.add(userId);
            }
        }
    }
    const now = Date.now();
    for (const userId of affected) {
        const p = players.get(userId);
        if (p && isLocal(p)) sendView(userId, p, now);
    }
}

// Adopta un estado nuevo (del reducer, si soy el árbitro, o replicado por el árbitro): registra los cambios de
// fase (sin roles), coloca a todos en la plaza si empezó una partida y reparte los eventos a los locales.
// Como árbitro, además guarda los eventos para replicarlos y, si cambió la fase, replica enseguida.
// allowPlaza: false cuando el estado llega por handover o es la primera adopción de un coordinador recién
// llegado; ahí la partida NO acaba de empezar (solo nos enteramos), así que nadie se mueve a la plaza.
function commitMatch(result, { fromArbiter = false, allowPlaza = true } = {}) {
    const previous = match;
    match = result.state;
    if (match.phase !== previous.phase) {
        console.log(`Partida ${match.matchId}: ${previous.phase} → ${match.phase} · roster ${Object.keys(match.roster).length}`);
    }
    // Empezó una partida nueva: todo el roster aparece en su punto de la plaza, quieto
    if (allowPlaza && match.matchId > previous.matchId && match.phase === "playing") placeRosterAtPlaza();
    deliverEvents(result.events);
    if (!fromArbiter) {
        pendingEvents.push(...result.events);
        if (match.phase !== previous.phase) scheduleReplicate();
    }
}

function placeRosterAtPlaza() {
    for (const [userId, spot] of Object.entries(plazaSpawns(match, city))) {
        const p = players.get(userId);
        if (!p) continue;
        p.x = spot.x;
        p.y = spot.y;
        const moving = p.intent.x !== 0 || p.intent.y !== 0;
        p.intent = { x: 0, y: 0 };
        if (moving && isLocal(p)) hooks.onLocalIntent(userId, p.intent); // los peers dejan de moverlo
    }
}

const sendViewsToLocals = (now = Date.now()) => {
    for (const [userId, p] of localPlayers(players)) sendView(userId, p, now);
};

// Respuesta local cuando no hay árbitro que procese la acción (decisión 20: 'arbiter_unavailable')
function replyArbiterUnavailable(userId, action) {
    const p = players.get(userId);
    if (!p || !isLocal(p)) return;
    const kind = action.kind === "infect" ? "infect_result" : "mission_result";
    send(p.socket, { type: "event", kind, ok: false, ...(kind === "mission_result" && { missionId: action.missionId ?? null }), reason: "arbiter_unavailable" });
}

// Espera de sincronización (decisión 18): un árbitro recién elegido SIN estado, o que acaba de unirse a una malla
// (pasó de 0 a 1 peers), espera hasta GAME_SYNC_WAIT_MS el handover del árbitro anterior antes de avanzar,
// procesar acciones o replicar; así nunca replica un estado vacío encima de una partida en curso.
let syncUntil = 0;
function startSyncWait(why) {
    syncUntil = Date.now() + cfg.GAME_SYNC_WAIT_MS;
    console.log(`${COORDINATOR_ID} es el árbitro (${why}): espera hasta ${cfg.GAME_SYNC_WAIT_MS} ms un handover`);
}

// ¿El árbitro (yo) puede procesar acciones y avanzar la partida?
function arbiterReady() {
    if (!isArbiter()) return false;
    if (syncUntil === 0) return true;
    if (Date.now() < syncUntil) return false;
    syncUntil = 0;
    hasState = true;
    console.log(`Sin handover: ${COORDINATOR_ID} sigue con su estado (partida ${match.matchId}, ${match.phase})`);
    return true;
}

// Acción de un jugador local (ya validada). Si soy el árbitro la proceso; si no, la reenvío al árbitro por su
// conexión de peer; si no hay conexión ready con él, el cliente recibe 'arbiter_unavailable'.
function handleAction(userId, action) {
    if (isArbiter()) {
        if (!arbiterReady()) return replyArbiterUnavailable(userId, action);
        return processAction(userId, action);
    }
    const msg = { type: "game_action", origin: COORDINATOR_ID, userId, action: { kind: action.kind, ...(action.missionId && { missionId: action.missionId }) } };
    if (!net.sendToPeer(arbiterId, msg)) replyArbiterUnavailable(userId, action);
}

// Acción reenviada por otro coordinador. mesh.js ya comprobó que ese peer es el DUEÑO del jugador (decisión 13).
// Solo el árbitro la procesa; si llega a otro coordinador se ignora (se avisa una sola vez en el log).
let warnedNotArbiter = false;
function onRemoteAction(peerId, { userId, action }) {
    if (!isArbiter()) {
        if (!warnedNotArbiter) {
            console.warn(`Acción de partida recibida de ${peerId} sin ser el árbitro (${arbiterId}): se ignora`);
            warnedNotArbiter = true;
        }
        return;
    }
    if (!arbiterReady()) return; // esperando el handover: el estado todavía no es el bueno
    processAction(userId, action);
}

function processAction(userId, action) {
    const result = applyAction(match, userId, action, matchCtx());
    if (result.changed) commitMatch(result);
    scheduleReplicate(); // de inmediato tras una acción (máximo una réplica cada 50 ms)
}

// Cada GAME_TICK_MS (solo el árbitro): tiempo y conexiones (cuenta regresiva, inicio, gracia, misiones
// vencidas, victoria). Los seguidores no ejecutan advance: adoptan lo que replica el árbitro.
const matchTicker = setInterval(() => {
    if (!arbiterReady()) return;
    if (net.readyPeerIds().length === 0) hasState = true; // árbitro solo: su estado ES la partida
    const result = advance(match, matchCtx());
    if (result.changed) commitMatch(result);
}, cfg.GAME_TICK_MS);

// Cada GAME_VIEW_MS: la vista 'game' a cada cliente local
const viewTicker = setInterval(() => sendViewsToLocals(), cfg.GAME_VIEW_MS);

// ---------- Replicación del árbitro (decisión 17) ----------
const REPLICATE_MIN_GAP_MS = 50; // tras una acción, como mucho una réplica cada 50 ms
const OPEN_WORLD_REPLICATE_MS = 1000;
const MAX_EVENTS_PER_STATE = 100; // validatePeerMessage acepta hasta 100 eventos por game_state
let lastReplicateAt = 0;
let replicateTimer = null;

// game_state { origin, match, events } a todos los peers ready, con los eventos acumulados desde el último
function replicate() {
    clearTimeout(replicateTimer);
    replicateTimer = null;
    lastReplicateAt = Date.now();
    const events = pendingEvents;
    pendingEvents = [];
    if (!isArbiter() || net.readyPeerIds().length === 0) return;
    let i = 0;
    do {
        net.sendToPeers({ type: "game_state", origin: COORDINATOR_ID, match, events: events.slice(i, i + MAX_EVENTS_PER_STATE) });
        i += MAX_EVENTS_PER_STATE;
    } while (i < events.length);
}

function scheduleReplicate() {
    if (!isArbiter() || replicateTimer) return;
    const wait = REPLICATE_MIN_GAP_MS - (Date.now() - lastReplicateAt);
    if (wait <= 0) replicate();
    else replicateTimer = setTimeout(replicate, wait);
}

// Cada MATCH_REPLICATE_MS en cuenta regresiva, partida y resultados; cada 1000 ms en el mundo abierto
const replicateTicker = setInterval(() => {
    if (!arbiterReady()) return;
    const every = match.phase === "open_world" ? OPEN_WORLD_REPLICATE_MS : cfg.MATCH_REPLICATE_MS;
    if (Date.now() - lastReplicateAt >= every - 5) replicate();
}, cfg.MATCH_REPLICATE_MS);

// ---------- Seguidor: estado replicado por el árbitro (decisión 18) ----------
function onGameState(msg) {
    const adopt = shouldAdoptGameState({
        selfId: COORDINATOR_ID,
        arbiterId,
        origin: msg.origin,
        handover: msg.handover,
        hasState,
        own: { matchId: match.matchId, rev: match.rev },
        incoming: { matchId: msg.match.matchId, rev: msg.match.rev },
    });
    if (!adopt) return;
    const hadState = hasState;
    hasState = true;
    // Handover (b): soy el árbitro y recibo la partida del anterior; termina la espera y la replico enseguida
    if (isArbiter()) {
        syncUntil = 0;
        console.log(`Handover recibido de ${msg.origin}: ${COORDINATOR_ID} sigue la partida ${msg.match.matchId} (${msg.match.phase})`);
        commitMatch({ state: msg.match, events: msg.events }, { fromArbiter: true, allowPlaza: false });
        sendViewsToLocals();
        replicate();
        return;
    }
    // La réplica periódica sin novedades no cambia nada: no hace falta reenviar las vistas
    if (msg.match.matchId === match.matchId && msg.match.rev === match.rev && msg.events.length === 0) return;
    commitMatch({ state: msg.match, events: msg.events }, { fromArbiter: true, allowPlaza: hadState });
    sendViewsToLocals();
}

// ---------- Elección del árbitro ----------
function recomputeArbiter() {
    const before = arbiterId;
    arbiterId = computeArbiter(COORDINATOR_ID, net.readyPeerIds());
    if (arbiterId !== before) console.log(`Árbitro de la partida: ${arbiterId} (antes ${before})`);
    return before;
}

function onPeerReady(peerId) {
    if (store) sendWorldSnapshot(peerId); // track 2.1: reconciliar lo persistido con el peer
    const before = recomputeArbiter();
    // Árbitro saliente: aparece un id menor → le paso la partida actual (handover)
    if (before === COORDINATOR_ID && arbiterId === peerId) {
        net.sendToPeer(peerId, { type: "game_state", origin: COORDINATOR_ID, handover: true, match, events: [] });
        console.log(`Handover a ${peerId}: partida ${match.matchId} (${match.phase})`);
    } else if (restoredMatch && peerId === arbiterId) {
        // Track 2.1: arranqué con una partida guardada y no soy el árbitro → se la ofrezco; la adopta si es
        // más nueva que la suya (misma regla del handover: matchId y luego rev)
        net.sendToPeer(peerId, { type: "game_state", origin: COORDINATOR_ID, handover: true, match, events: [] });
        console.log(`Partida recuperada ofrecida al árbitro ${peerId}: partida ${match.matchId} (${match.phase})`);
        restoredMatch = false;
    }
    if (!isArbiter()) return;
    restoredMatch = false; // soy el árbitro: mi partida ya es la que cuenta
    if (!hasState) startSyncWait("sin estado");
    else if (net.readyPeerIds().length === 1 && before === COORDINATOR_ID && syncUntil === 0) startSyncWait("se unió a la malla");
}

// Relevo por caída: si el que se fue era el árbitro, el siguiente de menor id asume con el último estado
// replicado (hasState) y sigue de inmediato, sin reiniciar nada. Sus jugadores pasan a la gracia.
function onPeerClosed(peerId) {
    const before = recomputeArbiter();
    if (before === peerId && isArbiter()) {
        if (!hasState && net.readyPeerIds().length > 0) return startSyncWait("relevo sin estado");
        console.log(`Relevo: ${COORDINATOR_ID} asume la partida ${match.matchId} (${match.phase}) tras la caída de ${peerId}`);
        replicate(); // los seguidores adoptan enseguida al nuevo árbitro
    }
}

// ---------- Arranque ----------
server.on("error", (err) => {
    // p. ej. puerto ocupado
    console.error(`No se pudo iniciar el servidor: ${err.message}`);
    process.exit(1);
});

// ---------- Heartbeat al directorio del auth (Taller 6, decisión 8; Taller 7, decisión 15) ----------
// Cada HEARTBEAT_AUTH_MS informa sus jugadores LOCALES a TODOS los auth de AUTH_URLS. Si ninguno responde, el
// coordinador sigue funcionando; solo se registra cuando cambia cuántos responden, no cada latido.
const stopAuthHeartbeat = startHeartbeatLoop({
    authUrls: conf.authUrls,
    secret: conf.clusterSecret,
    intervalMs: conf.heartbeatAuthMs,
    info: () => ({
        coordinatorId: COORDINATOR_ID,
        publicUrl: conf.publicUrl,
        peerUrl: conf.peerUrl,
        connectedPlayers: countLocal(players),
        uptime: Math.floor(process.uptime()),
    }),
    onChange(up, { ok, total }) {
        authReachable = up;
        authNodesUp = { up: ok, total };
        if (up) console.log(`Auth: ${ok} de ${total} nodos responden · ${COORDINATOR_ID} registrado en su directorio`);
        else console.warn(`Auth NO alcanzable: ninguno de los ${total} nodos responde; el coordinador sigue funcionando y reintentará`);
    },
});

server.listen(PORT, () => {
    const mapText = map ? `mapa "${map.id}" ${map.cols}×${map.rows}` : `mundo ${cfg.WORLD_WIDTH}×${cfg.WORLD_HEIGHT} sin mapa`;
    console.log(`Coordinator ${COORDINATOR_ID} en puerto ${PORT} (HTTP y WebSocket en /connect) · game loop a ${cfg.TICK_RATE} Hz · ${mapText}`);
});

net.start()
    .then(() => console.log(`Mesh de ${COORDINATOR_ID} en el puerto ${conf.peerPort} (peers en ${conf.peerUrl})`))
    .catch((err) => {
        console.error(`No se pudo iniciar el servidor de peers: ${err.message}`);
        process.exit(1);
    });

// ---------- Cierre ordenado ----------
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5 * 1000; // espera máxima antes de forzar la salida

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recibido, cerrando coordinator...`);

    // No se desregistra del auth: el directorio lo descarta por TTL (decisión 19)
    stopAuthHeartbeat();
    net.stop();
    // 1001 = "going away": el servidor se está apagando
    for (const ws of wss.clients) ws.close(1001, "server shutting down");
    clearTimeout(gameLoop);
    clearInterval(matchTicker);
    clearInterval(viewTicker);
    clearInterval(replicateTicker);
    clearTimeout(replicateTimer);
    clearInterval(heartbeat);
    // Track 2.1: último guardado antes de salir
    clearInterval(persistTicker);
    if (store) {
        persistNow();
        try {
            store.close();
        } catch {
            // ya cerrada
        }
    }
    wss.close();

    server.close(() => {
        console.log("Servidor HTTP y WebSocket cerrados");
        process.exit(0);
    });

    // Si algún cliente no completa el cierre a tiempo, se terminan los sockets y se sale
    setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
        console.error("Cierre forzado por tiempo de espera");
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
