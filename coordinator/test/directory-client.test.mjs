// Pruebas del cliente HTTP del directorio (directory-client.js) con un fetch falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendHeartbeat, fetchPeers, startHeartbeatLoop } from "../directory-client.js";

const INFO = { coordinatorId: "coord-a", publicUrl: "ws://localhost:5001", peerUrl: "ws://localhost:5101", connectedPlayers: 2, uptime: 17 };
const AUTH = "http://localhost:4000";
const SECRET = "x".repeat(64);

// fetch falso: registra cada llamada y responde con lo que diga `reply` (o lanza)
function fakeFetch(reply) {
    const calls = [];
    const impl = async (url, options = {}) => {
        calls.push({ url, options });
        const r = typeof reply === "function" ? reply(calls.length, options) : reply;
        if (r instanceof Error) throw r;
        if (r?.hang) {
            // no responde hasta que se cumpla el timeout (AbortSignal)
            return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
        }
        return { status: r.status, json: async () => r.body };
    };
    return { impl, calls };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("sendHeartbeat: 200 { ok: true } → true, con el body y los headers esperados", async () => {
    const f = fakeFetch({ status: 200, body: { ok: true } });
    assert.equal(await sendHeartbeat({ authUrl: AUTH, secret: SECRET, info: { ...INFO, extra: "no viaja" }, fetchImpl: f.impl }), true);
    assert.equal(f.calls.length, 1);
    const { url, options } = f.calls[0];
    assert.equal(url, "http://localhost:4000/heartbeat");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.headers["x-cluster-secret"], SECRET);
    assert.deepEqual(JSON.parse(options.body), INFO);
    assert.ok(options.signal instanceof AbortSignal);
});

test("sendHeartbeat: 401, 500, 200 sin ok, excepción y timeout → false (nunca lanza)", async () => {
    const cases = [
        { status: 401, body: { error: "invalid_cluster_secret" } },
        { status: 500, body: { error: "x" } },
        { status: 200, body: { ok: false } },
        new Error("ECONNREFUSED"),
    ];
    for (const reply of cases) {
        assert.equal(await sendHeartbeat({ authUrl: AUTH, secret: SECRET, info: INFO, fetchImpl: fakeFetch(reply).impl }), false, JSON.stringify(reply));
    }
    const started = Date.now();
    assert.equal(await sendHeartbeat({ authUrl: AUTH, secret: SECRET, info: INFO, fetchImpl: fakeFetch({ hang: true }).impl, timeoutMs: 50 }), false);
    assert.ok(Date.now() - started < 1000, "respeta el timeout");
    // info roto: tampoco lanza
    assert.equal(await sendHeartbeat({ authUrl: AUTH, secret: SECRET, info: null, fetchImpl: fakeFetch({ status: 200, body: { ok: true } }).impl }), false);
});

test("fetchPeers: filtra el propio id y entradas inválidas; null si falla", async () => {
    const peers = [
        { coordinatorId: "coord-a", peerUrl: "ws://localhost:5101" },
        { coordinatorId: "coord-b", peerUrl: "ws://localhost:5102/" },
        { coordinatorId: "coord-c", peerUrl: "http://localhost:5103" },
        { coordinatorId: "coord-d" },
        { coordinatorId: "mal id", peerUrl: "ws://localhost:5105" },
        { coordinatorId: "coord-e", peerUrl: "wss://e.ngrok-free.app" },
        null,
    ];
    const f = fakeFetch({ status: 200, body: { peers } });
    const got = await fetchPeers({ authUrl: AUTH, selfId: "coord-a", fetchImpl: f.impl });
    assert.equal(f.calls[0].url, "http://localhost:4000/peers");
    assert.deepEqual(got, [
        { coordinatorId: "coord-b", peerUrl: "ws://localhost:5102" },
        { coordinatorId: "coord-e", peerUrl: "wss://e.ngrok-free.app" },
    ]);
    assert.equal(await fetchPeers({ authUrl: AUTH, selfId: "coord-a", fetchImpl: fakeFetch({ status: 500, body: {} }).impl }), null);
    assert.equal(await fetchPeers({ authUrl: AUTH, selfId: "coord-a", fetchImpl: fakeFetch(new Error("caído")).impl }), null);
    assert.equal(await fetchPeers({ authUrl: AUTH, selfId: "coord-a", fetchImpl: fakeFetch({ status: 200, body: { nada: 1 } }).impl }), null);
});

test("startHeartbeatLoop: late de inmediato y cada intervalo; onChange solo en las transiciones", async () => {
    // Respuestas por latido: ok, ok, falla, falla, falla, ok, ok…
    const script = [true, true, false, false, false, true];
    const f = fakeFetch((n) => (script[n - 1] ?? true ? { status: 200, body: { ok: true } } : new Error("caído")));
    const changes = [];
    let players = 0;
    const stop = startHeartbeatLoop({
        authUrl: AUTH,
        secret: SECRET,
        info: () => ({ ...INFO, connectedPlayers: players++ }),
        intervalMs: 20,
        onChange: (up) => changes.push(up),
        fetchImpl: f.impl,
    });
    await sleep(5);
    assert.equal(f.calls.length, 1, "el primer latido es inmediato");
    await sleep(200);
    stop();
    const calls = f.calls.length;
    assert.ok(calls >= 7, `${calls} latidos`);
    assert.deepEqual(changes, [true, false, true], "un aviso por transición, no uno por latido");
    // info se evalúa en cada latido (jugadores actuales)
    assert.deepEqual(f.calls.slice(0, 3).map((c) => JSON.parse(c.options.body).connectedPlayers), [0, 1, 2]);
    await sleep(60);
    assert.equal(f.calls.length, calls, "stop() detiene los latidos");
});
