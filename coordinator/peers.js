// Capa de red del mesh de coordinadores (Taller 6): sockets, temporizadores y E/S.
// TODA decisión (quién inicia, conexiones duplicadas, validación, propiedad, resync) la toma mesh.js;
// aquí solo se conectan los cables.
//
// createPeerNetwork({ selfId, peerPort, clusterSecret, cfg, players, log }) → {
//   start()            levanta el servidor de peers en PEER_PORT
//   stop()             cierra conexiones y servidor
//   readyPeerIds()     ids de los peers con handshake completo
// }
//
// Seguridad: el servidor de peers exige el header x-cluster-secret en el upgrade (sha256 +
// timingSafeEqual; si falla, 401 y se destruye el socket) y el primer mensaje debe ser un hello válido
// en 3 s. Nunca se registran secretos ni el contenido de los mensajes.

const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");
const { resolveLink, validatePeerMessage, buildResync } = require("./mesh.js");

const PEER_MAX_PAYLOAD = 262144;
const HELLO_TIMEOUT_MS = 3000;

const sha256 = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest();

function createPeerNetwork({ selfId, peerPort, clusterSecret, cfg, players, log = console }) {
    // peerId → { ws, direction: "in" | "out", ready }
    const peers = new Map();
    const secretHash = sha256(clusterSecret);

    const secretMatches = (given) => typeof given === "string" && given.length > 0 && crypto.timingSafeEqual(sha256(given), secretHash);
    const isOpen = (ws) => ws.readyState === ws.OPEN;
    const sendRaw = (ws, text) => {
        if (isOpen(ws)) ws.send(text);
    };

    // Primer mensaje: debe ser un hello con un id válido y distinto del propio; si no, null
    function parseHello(raw) {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return null;
        }
        const v = validatePeerMessage(msg, cfg);
        if (!v.ok || v.msg.type !== "hello" || v.msg.coordinatorId === selfId) return null;
        return v.msg.coordinatorId;
    }

    // Handshake completo: se registra el peer y se le manda el estado de nuestros jugadores locales
    function registerPeer(peerId, ws, direction) {
        peers.set(peerId, { ws, direction, ready: true });
        for (const m of buildResync(players, selfId)) sendRaw(ws, JSON.stringify(m));
        log.log(`Peer ${peerId} conectado (${direction === "in" ? "entrante" : "saliente"})`);
    }

    // ---------- Servidor de peers (conexiones entrantes) ----------
    const server = http.createServer((req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ruta no encontrada" }));
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: PEER_MAX_PAYLOAD });

    server.on("upgrade", (req, socket, head) => {
        socket.on("error", () => {}); // un reset durante el handshake no tumba el proceso
        if (!secretMatches(req.headers["x-cluster-secret"])) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
        // Cualquier ruta es válida: la peerUrl del directorio se usa tal cual
        wss.handleUpgrade(req, socket, head, (ws) => handleIncoming(ws));
    });

    function handleIncoming(ws) {
        ws.on("error", () => {});
        let peerId = null;
        const helloTimer = setTimeout(() => ws.close(4011, "hello timeout"), HELLO_TIMEOUT_MS);
        ws.on("close", () => clearTimeout(helloTimer));

        ws.once("message", (raw) => {
            clearTimeout(helloTimer);
            peerId = parseHello(raw);
            if (!peerId) {
                ws.close(4011, "invalid hello");
                return;
            }
            const current = peers.get(peerId);
            const decision = resolveLink(selfId, peerId, { direction: "in", existing: Boolean(current && isOpen(current.ws)) });
            if (decision === "reject") {
                ws.close(4010, "duplicate peer");
                return;
            }
            sendRaw(ws, JSON.stringify({ type: "hello", coordinatorId: selfId }));
            registerPeer(peerId, ws, "in");
            // replace: la conexión vieja se cierra DESPUÉS de registrar la nueva (su cierre no la borra)
            if (decision === "replace" && current) current.ws.close(4010, "duplicate peer");
        });
    }

    function start() {
        return new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(peerPort, () => {
                server.off("error", reject);
                resolve();
            });
        });
    }

    function stop() {
        for (const { ws } of peers.values()) ws.close(1001, "server shutting down");
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close();
    }

    const readyPeerIds = () => [...peers].filter(([, e]) => e.ready && isOpen(e.ws)).map(([id]) => id);

    return { start, stop, readyPeerIds };
}

module.exports = { createPeerNetwork };
