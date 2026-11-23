// Mesh WebSocket entre auth-services (Taller 7, decisiones 3 y 4): solo sockets, temporizadores y cableado.
// Las decisiones (quién inicia, duplicados, validación) están en mesh-messages.js y toda la lógica de
// replicación en node.js.
//
// createAuthMesh({ selfId, nodes, peerPort, clusterSecret, pingMs, syncBatch, log }) → {
//   transport   { send(to, msg), connectedIds() } para createReplicationNode (solo conexiones con hello completo)
//   attach(node) conecta el nodo de replicación (peerUp / peerDown / handleMessage / helloInfo)
//   start()      servidor en peerPort y conexiones salientes hacia los ids MAYORES (reintento cada 2 s)
//   stop()       cierra todo (sin despedirse ni transferir el liderazgo)
// }
//
// Seguridad (igual que el mesh de coordinadores): x-cluster-secret en el upgrade (sha256 + timingSafeEqual; si
// no, 401 y se destruye el socket); el primer mensaje debe ser un hello válido en 3 s (si no, 4011); un id fuera
// de AUTH_NODES o igual al propio se rechaza (4011); una conexión duplicada se cierra con 4010; el remitente de
// cada mensaje es SIEMPRE el id de la conexión; ping/pong cada pingMs (terminate si no hubo pong en el ciclo
// anterior); máximo 500 mensajes por segundo por conexión (el exceso se descarta); maxPayload 2 MB.
// Nunca se registran secretos ni el contenido de los mensajes.

const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { shouldInitiate, resolveLink, validatePeerMessage } = require("./mesh-messages.js");

const MAX_PAYLOAD = 2 * 1024 * 1024;
const HELLO_TIMEOUT_MS = 3000;
const RECONNECT_MS = 2000;
const MSGS_PER_SEC = 500;

const sha256 = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest();

function createAuthMesh({ selfId, nodes, peerPort, clusterSecret, pingMs = 3000, syncBatch = 500, log = console }) {
    const nodeIds = nodes.map((n) => n.id);
    const others = nodes.filter((n) => n.id !== selfId);
    const secretHash = sha256(clusterSecret);
    const peers = new Map(); // id → { ws, alive, direction }
    const pending = new Set(); // sockets salientes sin handshake
    const connecting = new Set();
    const failing = new Set(); // peers con un aviso de fallo ya mostrado (un aviso por cambio de estado)
    let node = null;
    let server = null;
    let wss = null;
    let reconnectTimer = null;
    let pingTimer = null;
    let stopped = false;

    const isOpen = (ws) => ws.readyState === WebSocket.OPEN;
    const secretMatches = (given) => typeof given === "string" && given.length > 0 && crypto.timingSafeEqual(sha256(given), secretHash);
    const validate = (msg, from) => validatePeerMessage(msg, { from, selfId, nodeIds, syncBatch });
    const parse = (raw) => {
        try {
            return JSON.parse(raw.toString());
        } catch {
            return null;
        }
    };

    const transport = {
        send(to, msg) {
            const p = peers.get(to);
            if (p && isOpen(p.ws)) p.ws.send(JSON.stringify(msg));
        },
        connectedIds: () => [...peers].filter(([, p]) => isOpen(p.ws)).map(([id]) => id),
    };

    // Handshake completo: el peer queda registrado y el nodo lo conoce
    function register(peerId, ws, direction, hello) {
        const entry = { ws, alive: true, direction };
        peers.set(peerId, entry);
        failing.delete(peerId);
        ws.on("pong", () => {
            entry.alive = true;
        });
        ws.on("close", () => {
            if (peers.get(peerId)?.ws !== ws) return; // una conexión reemplazada no borra a la nueva
            peers.delete(peerId);
            log.log(`[mesh] peer ${peerId} desconectado`);
            node?.peerDown(peerId);
        });
        attachMessages(peerId, ws);
        log.log(`[mesh] peer ${peerId} conectado (${direction === "in" ? "entrante" : "saliente"})`);
        node?.peerUp(peerId, hello);
    }

    // Mensajes de una conexión con handshake completo: límite por segundo, JSON y validación estricta
    function attachMessages(peerId, ws) {
        let windowStart = Date.now();
        let count = 0;
        ws.on("message", (raw) => {
            const now = Date.now();
            if (now - windowStart >= 1000) {
                windowStart = now;
                count = 0;
            }
            if (++count > MSGS_PER_SEC) return;
            const v = validate(parse(raw), peerId);
            if (!v.ok || v.msg.type === "hello") return; // un hello repetido no cambia nada
            node?.handleMessage(peerId, v.msg);
        });
    }

    const sendHello = (ws) => {
        if (isOpen(ws) && node) ws.send(JSON.stringify(node.helloInfo()));
    };

    // ---------- Conexiones entrantes ----------

    function onUpgrade(req, socket, head) {
        socket.on("error", () => {});
        if (!secretMatches(req.headers["x-cluster-secret"])) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => onIncoming(ws));
    }

    function onIncoming(ws) {
        ws.on("error", () => {});
        const timer = setTimeout(() => ws.close(4011, "hello timeout"), HELLO_TIMEOUT_MS);
        ws.on("close", () => clearTimeout(timer));
        ws.once("message", (raw) => {
            clearTimeout(timer);
            const v = validate(parse(raw), null);
            if (!v.ok || v.msg.type !== "hello") return ws.close(4011, "invalid hello");
            const peerId = v.msg.authId;
            const current = peers.get(peerId);
            const decision = resolveLink(selfId, peerId, { direction: "in", existing: Boolean(current && isOpen(current.ws)) });
            if (decision === "reject") return ws.close(4010, "duplicate peer");
            sendHello(ws); // el receptor contesta con su hello
            if (decision === "replace" && current) {
                peers.delete(peerId); // su cierre ya no avisa: la nueva la reemplaza
                current.ws.close(4010, "duplicate peer");
                node?.peerDown(peerId);
            }
            register(peerId, ws, "in", v.msg);
        });
    }

    // ---------- Conexiones salientes (hacia los ids mayores) ----------

    function warnOnce(peerId, why) {
        if (failing.has(peerId)) return;
        failing.add(peerId);
        log.warn(`[mesh] no se pudo conectar con ${peerId} (${why}); se reintentará cada ${RECONNECT_MS / 1000} s`);
    }

    function connectTo(peer) {
        connecting.add(peer.id);
        const ws = new WebSocket(peer.peerUrl, { headers: { "x-cluster-secret": clusterSecret }, handshakeTimeout: HELLO_TIMEOUT_MS, maxPayload: MAX_PAYLOAD });
        pending.add(ws);
        let timer = null;
        const done = () => {
            clearTimeout(timer);
            connecting.delete(peer.id);
            pending.delete(ws);
        };
        ws.on("error", (err) => warnOnce(peer.id, err.code || "error de conexión"));
        ws.on("unexpected-response", (req, res) => {
            warnOnce(peer.id, `HTTP ${res.statusCode}`);
            req.destroy();
            done();
        });
        ws.on("close", done);
        ws.on("open", () => {
            sendHello(ws);
            timer = setTimeout(() => ws.close(4011, "hello timeout"), HELLO_TIMEOUT_MS);
        });
        ws.once("message", (raw) => {
            done();
            const v = validate(parse(raw), peer.id);
            if (!v.ok || v.msg.type !== "hello" || v.msg.authId !== peer.id) {
                warnOnce(peer.id, "respondió con un hello inesperado");
                return ws.close(4011, "unexpected hello");
            }
            const current = peers.get(peer.id);
            if (resolveLink(selfId, peer.id, { direction: "out", existing: Boolean(current && isOpen(current.ws)) }) === "reject") {
                return ws.close(4010, "duplicate peer");
            }
            register(peer.id, ws, "out", v.msg);
        });
    }

    function connectMissing() {
        if (stopped) return;
        for (const peer of others) {
            if (!shouldInitiate(selfId, peer.id) || !peer.peerUrl) continue;
            if (peers.has(peer.id) || connecting.has(peer.id)) continue;
            connectTo(peer);
        }
    }

    // Ping a cada peer; si no respondió al anterior, la conexión está muerta (sin cierre limpio)
    function pingAll() {
        for (const entry of peers.values()) {
            if (!entry.alive) {
                entry.ws.terminate();
                continue;
            }
            entry.alive = false;
            if (isOpen(entry.ws)) entry.ws.ping();
        }
    }

    return {
        transport,
        attach(n) {
            node = n;
        },
        start() {
            return new Promise((resolve, reject) => {
                server = http.createServer((req, res) => {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Ruta no encontrada" }));
                });
                wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
                server.on("upgrade", onUpgrade);
                server.once("error", reject);
                server.listen(peerPort, () => {
                    server.off("error", reject);
                    connectMissing();
                    reconnectTimer = setInterval(connectMissing, RECONNECT_MS);
                    pingTimer = setInterval(pingAll, pingMs);
                    resolve();
                });
            });
        },
        stop() {
            stopped = true;
            clearInterval(reconnectTimer);
            clearInterval(pingTimer);
            for (const ws of pending) ws.terminate();
            for (const { ws } of peers.values()) ws.terminate();
            peers.clear();
            if (wss) {
                for (const ws of wss.clients) ws.terminate();
                wss.close();
            }
            if (server) server.close();
        },
    };
}

module.exports = { createAuthMesh };
