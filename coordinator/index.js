// Coordinator (Taller 5): servidor autoritativo del juego en vivo.
// Los jugadores se conectan por WebSocket en /connect?token=XXX con un JWT válido del auth-service.
// Los clientes solo mandan intenciones (dirección) y extras; el servidor mueve a todos en un game loop
// y envía el estado completo en cada tick. HTTP y WebSocket comparten el mismo puerto.
//
// Configuración: variables de entorno cargadas desde .env (ver .env.example).
// JWT_SECRET es obligatorio y debe ser idéntico al del auth-service.
//
// Basado en coordinator/index.js del código de referencia SSD-CommsWS.

require("dotenv").config({ quiet: true }); // quiet: evita que dotenv imprima su propio mensaje en consola

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const { createConfig, parseMap, randomSpawn, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot } = require("./game.js");

// ---------- Configuración ----------

// Detiene el proceso con un motivo claro si la configuración no es válida
function fatal(reason) {
    console.error(`Error de configuración: ${reason}`);
    process.exit(1);
}

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;
const HEARTBEAT_RAW = process.env.HEARTBEAT_INTERVAL_MS || "30000";

if (!JWT_SECRET) fatal("JWT_SECRET es obligatorio");
if (JWT_SECRET.length < 32) fatal("JWT_SECRET debe tener al menos 32 caracteres");
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fatal("PORT debe ser un número de puerto válido");
if (!/^\d+$/.test(HEARTBEAT_RAW) || Number(HEARTBEAT_RAW) < 1) {
    fatal("HEARTBEAT_INTERVAL_MS debe ser un entero positivo (milisegundos)");
}
const HEARTBEAT_INTERVAL_MS = Number(HEARTBEAT_RAW);

// Mapa opcional con casillas sólidas (MAP_FILE, relativo a la carpeta del coordinator).
// Sin MAP_FILE el mundo es un rectángulo vacío de WORLD_WIDTH × WORLD_HEIGHT.
let map = null;
if (process.env.MAP_FILE) {
    const mapPath = path.resolve(__dirname, process.env.MAP_FILE);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    } catch {
        fatal(`no se pudo leer MAP_FILE como JSON (${mapPath})`);
    }
    try {
        map = parseMap(data);
    } catch (err) {
        fatal(err.message);
    }
}

// Mundo, velocidad, tick y límites de mensajes (game.js valida cada valor)
let cfg;
try {
    cfg = createConfig(process.env, map);
} catch (err) {
    fatal(err.message);
}

const PROVIDERS = new Set(["local", "google"]);
const RATE_WINDOW_MS = 1000;

// ---------- Estado ----------
// userId (string) -> { username, provider, socket, connectedAt, x, y, intent:{x,y}, extras:{} }
const players = new Map();

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
    res.status(200).json({ status: "ok", players: players.size, tickRate: cfg.TICK_RATE, map: map ? map.id : null });
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

// Envía la lista actual de jugadores a TODOS los jugadores conectados (incluido el recién llegado).
// A diferencia del broadcast() del base, recorre el Map y no wss.clients: así no se envía
// nada a sockets rechazados con 4001 que aún no terminaron de cerrarse.
function broadcastPlayers() {
    const message = {
        type: "players_update",
        players: [...players].map(([userId, p]) => ({ userId, username: p.username })),
    };
    for (const { socket } of players.values()) send(socket, message);
}

wss.on("connection", (ws, payload) => {
    const { userId, username, provider } = payload;

    // Sesión duplicada: se queda la conexión nueva y se cierra la anterior con 4002
    const previous = players.get(userId);
    const { x, y } = randomSpawn(cfg, Math.random, map);
    players.set(userId, {
        username,
        provider, // lo pone el servidor desde el JWT (no es un extra del cliente)
        socket: ws,
        connectedAt: new Date().toISOString(),
        x,
        y,
        intent: { x: 0, y: 0 },
        extras: {},
    });
    if (previous) {
        previous.socket.close(4002, "replaced by new session");
        console.log(`Sesión reemplazada: ${username} (${userId})`);
    } else {
        console.log(`Jugador conectado: ${username} (${userId}) · jugadores: ${players.size}`);
    }

    // Bienvenida: quién soy y cómo es el mundo
    send(ws, {
        type: "welcome",
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
        players.delete(userId);
        console.log(`Jugador desconectado: ${username} (${userId}) código ${code} · jugadores: ${players.size}`);
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
            if (intent) p.intent = intent;
        } else if (msg?.type === "extras_update") {
            const extras = sanitizeExtras(msg, cfg);
            if (extras) p.extras = extras; // reemplazo completo
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
// y envía UN mensaje state por tick a todos los jugadores. Es el único lugar donde se mueve a alguien.
let lastTick = Date.now();

function tick() {
    const now = Date.now();
    const dt = clampDt(now - lastTick);
    lastTick = now;
    if (players.size === 0) return;

    stepPlayers(players, dt, cfg, map);

    // El JSON se arma una sola vez por tick y se reutiliza para todos los sockets
    const message = JSON.stringify({ type: "state", t: now, players: snapshot(players) });
    for (const { socket } of players.values()) {
        if (socket.readyState === socket.OPEN) socket.send(message);
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

server.listen(PORT, () => {
    const mapText = map ? `mapa "${map.id}" ${map.cols}×${map.rows}` : `mundo ${cfg.WORLD_WIDTH}×${cfg.WORLD_HEIGHT} sin mapa`;
    console.log(`Coordinator en puerto ${PORT} (HTTP y WebSocket en /connect) · game loop a ${cfg.TICK_RATE} Hz · ${mapText}`);
});

// ---------- Cierre ordenado ----------
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5 * 1000; // espera máxima antes de forzar la salida

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recibido, cerrando coordinator...`);

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
