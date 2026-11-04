// Coordinator: mantiene en memoria la lista de jugadores conectados por WebSocket
// y se la envía a todos cada vez que cambia. HTTP y WebSocket comparten el mismo puerto.
// Solo acepta conexiones en /connect?token=XXX con un JWT válido emitido por el auth-service.
//
// Configuración: variables de entorno cargadas desde .env (ver .env.example).
// JWT_SECRET es obligatorio y debe ser idéntico al del auth-service.
//
// Basado en coordinator/index.js del código de referencia SSD-CommsWS.

require("dotenv").config({ quiet: true }); // quiet: evita que dotenv imprima su propio mensaje en consola

const http = require("node:http");
const express = require("express");
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");

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
if (JWT_SECRET.length < 16) fatal("JWT_SECRET debe tener al menos 16 caracteres");
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fatal("PORT debe ser un número de puerto válido");
if (!/^\d+$/.test(HEARTBEAT_RAW) || Number(HEARTBEAT_RAW) < 1) {
    fatal("HEARTBEAT_INTERVAL_MS debe ser un entero positivo (milisegundos)");
}
const HEARTBEAT_INTERVAL_MS = Number(HEARTBEAT_RAW);

// ---------- Estado ----------
const players = new Map(); // userId (string) -> { username, socket, connectedAt }

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
    res.status(200).json({ status: "ok", players: players.size });
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
// maxPayload: el cliente no necesita enviar nada; se limita el tamaño de cualquier mensaje entrante.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

// Devuelve el payload si el token es válido; null si falta, está malformado, vencido,
// firmado con otra clave o le faltan datos. Nunca registra el token.
function verifyToken(token) {
    try {
        const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
        const complete =
            typeof payload.userId === "string" &&
            typeof payload.username === "string" &&
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

// ---------- Arranque ----------
server.on("error", (err) => {
    // p. ej. puerto ocupado
    console.error(`No se pudo iniciar el servidor: ${err.message}`);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`Coordinator en puerto ${PORT} (HTTP y WebSocket en /connect)`);
});
