// Capa de red del mesh de coordinadores (Taller 6): sockets, temporizadores y E/S.
// TODA decisión (quién inicia, conexiones duplicadas, validación, propiedad, resync) la toma mesh.js;
// aquí solo se conectan los cables.
//
// createPeerNetwork({ selfId, peerPort, clusterSecret, authUrl, discoveryMs, cfg, players,
//                     onMembershipChanged, onCloseLocal, log }) → {
//   start()            levanta el servidor de peers en PEER_PORT y empieza el descubrimiento
//   stop()             detiene temporizadores y cierra conexiones y servidor
//   readyPeerIds()     ids de los peers con handshake completo
//   sendToPeers(obj)   serializa UNA vez y envía a los peers listos
// }
// Mensajes recibidos: JSON.parse → validatePeerMessage → applyPeerMessage (mesh.js). Si cambió la lista
// de jugadores se llama onMembershipChanged(); las acciones close-local van a onCloseLocal(action).
// Nada se retransmite: cada coordinador envía SUS mensajes directamente a cada peer.
//
// Descubrimiento: al arrancar y cada discoveryMs se pide GET {authUrl}/peers y se abre conexión SOLO
// hacia los peers de id mayor (shouldInitiate) que aún no tengan conexión ni intento en curso. Los de id
// menor esperan a que ellos conecten. Si el auth no responde, se conservan las conexiones existentes.
//
// Seguridad: el servidor de peers exige el header x-cluster-secret en el upgrade (sha256 +
// timingSafeEqual; si falla, 401 y se destruye el socket) y el primer mensaje debe ser un hello válido
// en 3 s. Nunca se registran secretos ni el contenido de los mensajes.

const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { shouldInitiate, resolveLink, validatePeerMessage, applyPeerMessage, buildResync } = require("./mesh.js");
const { fetchPeers } = require("./directory-client.js");

const PEER_MAX_PAYLOAD = 262144;
const HELLO_TIMEOUT_MS = 3000;
const PEER_MSGS_PER_SEC = 500; // por conexión; el exceso se ignora

const sha256 = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest();

function createPeerNetwork({
    selfId,
    peerPort,
    clusterSecret,
    authUrl,
    discoveryMs,
    cfg,
    players,
    onMembershipChanged = () => {},
    onCloseLocal = () => {},
    log = console,
}) {
    // peerId → { ws, direction: "in" | "out", ready }
    const peers = new Map();
    const connecting = new Set(); // peers con una conexión saliente en curso
    const failing = new Set(); // peers cuyo último intento falló (para avisar UNA vez, sin spam)
    const pending = new Set(); // sockets salientes todavía sin handshake (para cerrarlos al apagar)
    let discoveryTimer = null;
    let stopped = false;
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
        attachMessageHandler(peerId, ws);
        ws.on("close", () => {
            // Solo si sigue siendo ESA conexión (una reemplazada no borra a la nueva)
            if (peers.get(peerId)?.ws !== ws) return;
            peers.delete(peerId);
            log.log(`Peer ${peerId} desconectado`);
        });
        for (const m of buildResync(players, selfId)) sendRaw(ws, JSON.stringify(m));
        log.log(`Peer ${peerId} conectado (${direction === "in" ? "entrante" : "saliente"})`);
    }

    // Único manejador de mensajes de una conexión con handshake completo (entrante o saliente).
    // No se registra el contenido de los mensajes.
    function attachMessageHandler(peerId, ws) {
        let windowStart = Date.now();
        let count = 0;
        ws.on("message", (raw) => {
            const now = Date.now();
            if (now - windowStart >= 1000) {
                windowStart = now;
                count = 0;
            }
            if (++count > PEER_MSGS_PER_SEC) return;
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return; // JSON roto
            }
            const v = validatePeerMessage(msg, cfg);
            if (!v.ok) return;
            const result = applyPeerMessage(players, selfId, peerId, v.msg, cfg);
            for (const action of result.actions) onCloseLocal(action);
            if (result.membershipChanged) onMembershipChanged();
        });
    }

    // Serializa UNA vez y envía a todos los peers listos
    function sendToPeers(obj) {
        const text = JSON.stringify(obj);
        for (const { ws, ready } of peers.values()) if (ready) sendRaw(ws, text);
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

    // ---------- Conexiones salientes ----------
    function warnOnce(peerId, why) {
        if (failing.has(peerId)) return;
        failing.add(peerId);
        log.warn(`No se pudo conectar con el peer ${peerId} (${why}); se reintentará`);
    }

    function connectTo(peerId, peerUrl) {
        connecting.add(peerId);
        const ws = new WebSocket(peerUrl, {
            headers: { "x-cluster-secret": clusterSecret },
            handshakeTimeout: HELLO_TIMEOUT_MS,
            maxPayload: PEER_MAX_PAYLOAD,
        });
        pending.add(ws);
        let helloTimer = null;
        const done = () => {
            clearTimeout(helloTimer);
            connecting.delete(peerId);
            pending.delete(ws);
        };

        ws.on("error", (err) => warnOnce(peerId, err.code || "error de conexión"));
        ws.on("unexpected-response", (req, res) => {
            warnOnce(peerId, `HTTP ${res.statusCode}`);
            req.destroy(); // con este listener, abortar la petición es responsabilidad nuestra
            done();
        });
        ws.on("close", done);
        ws.on("open", () => {
            ws.send(JSON.stringify({ type: "hello", coordinatorId: selfId }));
            helloTimer = setTimeout(() => ws.close(4011, "hello timeout"), HELLO_TIMEOUT_MS);
        });
        ws.once("message", (raw) => {
            done();
            // La respuesta debe ser el hello del peer que esperábamos
            if (parseHello(raw) !== peerId) {
                warnOnce(peerId, "respondió con un hello inesperado");
                ws.close(4011, "unexpected hello");
                return;
            }
            const current = peers.get(peerId);
            if (current && isOpen(current.ws)) {
                ws.close(4010, "duplicate peer");
                return;
            }
            failing.delete(peerId);
            registerPeer(peerId, ws, "out");
        });
    }

    async function discover() {
        if (stopped) return;
        const list = await fetchPeers({ authUrl, selfId });
        if (!list || stopped) return; // auth caído: las conexiones existentes se conservan
        for (const { coordinatorId, peerUrl } of list) {
            if (!shouldInitiate(selfId, coordinatorId)) continue; // los de id menor nos conectan a nosotros
            if (peers.has(coordinatorId) || connecting.has(coordinatorId)) continue;
            connectTo(coordinatorId, peerUrl);
        }
    }

    function start() {
        return new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(peerPort, () => {
                server.off("error", reject);
                discover();
                discoveryTimer = setInterval(discover, discoveryMs);
                resolve();
            });
        });
    }

    function stop() {
        stopped = true;
        clearInterval(discoveryTimer);
        for (const ws of pending) ws.terminate();
        for (const { ws } of peers.values()) ws.close(1001, "server shutting down");
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close();
    }

    const readyPeerIds = () => [...peers].filter(([, e]) => e.ready && isOpen(e.ws)).map(([id]) => id);

    return { start, stop, readyPeerIds, sendToPeers };
}

module.exports = { createPeerNetwork };
