// Pruebas de integración del gateway con dos servidores falsos (HTTP + WebSocket de eco) y un default.
// El WebSocket de eco se implementa a mano con node:crypto (el gateway no depende de ninguna librería de WS);
// el cliente es el WebSocket que trae Node.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { createGateway } = require("../index.js");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Servidor falso: contesta { name, url } a todo y hace eco de los mensajes de texto por WebSocket
function fakeBackend(name) {
    const seen = { http: [], ws: [] };
    const sockets = new Set();
    const server = http.createServer((req, res) => {
        seen.http.push(req.url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name, url: req.url }));
    });
    server.on("upgrade", (req, socket) => {
        seen.ws.push(req.url);
        sockets.add(socket);
        socket.on("error", () => {});
        socket.on("close", () => sockets.delete(socket));
        const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + WS_GUID).digest("base64");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        socket.on("data", (buf) => {
            const opcode = buf[0] & 0x0f;
            if (opcode === 8) return socket.end(); // close
            let len = buf[1] & 0x7f;
            let off = 2;
            if (len === 126) {
                len = buf.readUInt16BE(2);
                off = 4;
            }
            const mask = buf.subarray(off, off + 4);
            const data = Buffer.alloc(len);
            for (let i = 0; i < len; i++) data[i] = buf[off + 4 + i] ^ mask[i % 4];
            const text = `${name}:${data.toString("utf8")}`;
            const payload = Buffer.from(text, "utf8");
            socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload])); // texto sin máscara, < 126 bytes
        });
    });
    return {
        seen,
        listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`))),
        close: () =>
            new Promise((r) => {
                for (const s of sockets) s.destroy();
                server.closeAllConnections();
                server.close(r);
            }),
    };
}

let a;
let b;
let fallback;
let gateway;
let base;
let deadTarget;

before(async () => {
    a = fakeBackend("A");
    b = fakeBackend("B");
    fallback = fakeBackend("DEFAULT");
    const [ua, ub, ud] = await Promise.all([a.listen(), b.listen(), fallback.listen()]);
    // Un puerto que estuvo abierto y ya no: destino caído
    const tmp = http.createServer();
    await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
    deadTarget = `http://127.0.0.1:${tmp.address().port}`;
    await new Promise((r) => tmp.close(r));
    gateway = createGateway({
        routes: [
            { prefix: "/svc-a", target: ua },
            { prefix: "/svc-b", target: ub },
            { prefix: "/caido", target: deadTarget },
        ],
        defaultTarget: ud,
    });
    await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${gateway.address().port}`;
});

after(async () => {
    await new Promise((r) => {
        gateway.closeAllConnections();
        gateway.close(r);
    });
    await Promise.all([a.close(), b.close(), fallback.close()]);
});

test("HTTP: se reenvía al destino del prefijo con el prefijo quitado y la query intacta", async () => {
    let res = await fetch(`http://${base}/svc-a/status?x=1&y=dos`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { name: "A", url: "/status?x=1&y=dos" });
    res = await fetch(`http://${base}/svc-b`);
    assert.deepEqual(await res.json(), { name: "B", url: "/" });
    res = await fetch(`http://${base}/svc-b/auth/google`, { method: "POST", body: "{}" });
    assert.deepEqual(await res.json(), { name: "B", url: "/auth/google" });
    assert.deepEqual(a.seen.http, ["/status?x=1&y=dos"]);
});

test("HTTP: la raíz y lo que no coincide (incluido /svc-ab) van al default sin cambios", async () => {
    for (const path of ["/", "/login.html", "/svc-ab/x", "/js/play/play.js?v=1"]) {
        const res = await fetch(`http://${base}${path}`);
        assert.deepEqual(await res.json(), { name: "DEFAULT", url: path }, path);
    }
});

test("HTTP: destino caído → 502 { error: 'bad_gateway' }", async () => {
    const res = await fetch(`http://${base}/caido/status`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "bad_gateway" });
});

test("WebSocket: un eco atraviesa el gateway con el prefijo quitado (y la query con el token)", async () => {
    const ws = new WebSocket(`ws://${base}/svc-a/connect?token=abc.def`);
    const reply = await new Promise((resolve, reject) => {
        ws.onopen = () => ws.send("hola");
        ws.onmessage = (e) => resolve(e.data);
        ws.onerror = () => reject(new Error("error de WebSocket"));
        setTimeout(() => reject(new Error("sin eco")), 3000);
    });
    ws.close();
    assert.equal(reply, "A:hola");
    assert.deepEqual(a.seen.ws, ["/connect?token=abc.def"]);
    // Y al otro destino
    const wb = new WebSocket(`ws://${base}/svc-b`);
    const replyB = await new Promise((resolve, reject) => {
        wb.onopen = () => wb.send("chao");
        wb.onmessage = (e) => resolve(e.data);
        setTimeout(() => reject(new Error("sin eco")), 3000);
    });
    wb.close();
    assert.equal(replyB, "B:chao");
    assert.deepEqual(b.seen.ws, ["/"]);
});

test("WebSocket sin destino (ruta sin prefijo) o con el destino caído → se cierra sin abrir", async () => {
    for (const path of ["/", "/otra/cosa", "/caido/connect"]) {
        const ws = new WebSocket(`ws://${base}${path}`);
        const outcome = await new Promise((resolve) => {
            ws.onopen = () => resolve("abierto");
            ws.onerror = () => resolve("rechazado");
            ws.onclose = () => resolve("rechazado");
            setTimeout(() => resolve("colgado"), 3000);
        });
        assert.equal(outcome, "rechazado", path);
    }
    assert.equal(fallback.seen.ws.length, 0, "el default nunca recibe WebSocket");
});
