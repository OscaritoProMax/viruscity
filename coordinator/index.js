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
const { resumePosition, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot, isLocal, countLocal } = require("./game.js");
const { startHeartbeatLoop } = require("./directory-client.js");
const { createPeerNetwork } = require("./peers.js");

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

// Estado del heartbeat al auth (null = todavía sin respuesta)
let authReachable = null;

// Mesh con los otros coordinadores (Taller 6): servidor de peers en PEER_PORT
const net = createPeerNetwork({
    selfId: COORDINATOR_ID,
    peerPort: conf.peerPort,
    clusterSecret: conf.clusterSecret,
    cfg,
    players,
});
// userId -> { x, y }: última posición de quien se desconectó. Al volver (recargar la página, otra pestaña,
// reconexión) aparece donde estaba: el cliente no puede elegir dónde aparecer. Vive en memoria: se pierde
// si el coordinator se reinicia.
const lastPositions = new Map();

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
    const previous = players.get(userId);
    const saved = previous ? { x: previous.x, y: previous.y } : lastPositions.get(userId);
    const { x, y } = resumePosition(saved, cfg, map);
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
        extras: {},
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

    // Bienvenida: quién soy y cómo es el mundo
    send(ws, {
        type: "welcome",
        coordinatorId: COORDINATOR_ID,
        you: { userId, username, provider },
        world: { width: cfg.WORLD_WIDTH, height: cfg.WORLD_HEIGHT, playerRadius: cfg.PLAYER_RADIUS, tickRate: cfg.TICK_RATE },
    });
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
        lastPositions.set(userId, { x: gone.x, y: gone.y });
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

    ws.on("message", (raw) => {
        // Límite de mensajes por segundo y por socket: el exceso se descarta en silencio
        const now = Date.now();
        if (now - windowStart >= RATE_WINDOW_MS) {
            windowStart = now;
            messagesInWindow = 0;
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

    stepPlayers(players, dt, cfg, map);
    if (countLocal(players) === 0) return; // nadie a quien enviarle el state

    // El JSON se arma una sola vez por tick y se reutiliza para todos los sockets locales
    const message = JSON.stringify({ type: "state", t: now, coordinatorId: COORDINATOR_ID, players: snapshot(players) });
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

// ---------- Arranque ----------
server.on("error", (err) => {
    // p. ej. puerto ocupado
    console.error(`No se pudo iniciar el servidor: ${err.message}`);
    process.exit(1);
});

// ---------- Heartbeat al directorio del auth (Taller 6, decisión 8) ----------
// Cada HEARTBEAT_AUTH_MS informa sus jugadores LOCALES. Si el auth no responde, el coordinador sigue
// funcionando; solo se registra el cambio de estado (alcanzable / no alcanzable), no cada latido.
const stopAuthHeartbeat = startHeartbeatLoop({
    authUrl: conf.authUrl,
    secret: conf.clusterSecret,
    intervalMs: conf.heartbeatAuthMs,
    info: () => ({
        coordinatorId: COORDINATOR_ID,
        publicUrl: conf.publicUrl,
        peerUrl: conf.peerUrl,
        connectedPlayers: countLocal(players),
        uptime: Math.floor(process.uptime()),
    }),
    onChange(up) {
        authReachable = up;
        if (up) console.log(`Auth alcanzable (${conf.authUrl}): ${COORDINATOR_ID} registrado en el directorio`);
        else console.warn(`Auth NO alcanzable (${conf.authUrl}): el coordinador sigue funcionando y reintentará`);
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
    clearInterval(heartbeat);
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
