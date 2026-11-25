// Pruebas del cliente HTTP del directorio (directory-client.js) con un fetch falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendHeartbeat, sendHeartbeatAll, fetchPeers, fetchCoordinatorPeers, startHeartbeatLoop } from "../directory-client.js";

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
    assert.equal(f.calls[0].url, "http://localhost:4000/coordinator-peers");
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

// ---------- Taller 7: varios auth (AUTH_URLS) ----------

const AUTHS = ["http://localhost:4001", "http://localhost:4002", "http://localhost:4003"];
// fetch falso por nodo: los que están en "down" lanzan (red caída); los demás contestan 200 { ok: true }
function clusterFetch(down = new Set(), body = { ok: true }) {
    const calls = [];
    const impl = async (url, options = {}) => {
        calls.push({ url, options });
        const node = AUTHS.find((a) => url.startsWith(a));
        if (down.has(node)) throw new Error("ECONNREFUSED");
        return { status: 200, json: async () => (typeof body === "function" ? body(node) : body) };
    };
    return { impl, calls };
}

test("sendHeartbeatAll: el latido va a TODOS en paralelo; con 1 caído ok:2, con todos caídos ok:0 sin lanzar", async () => {
    let f = clusterFetch();
    assert.deepEqual(await sendHeartbeatAll({ authUrls: AUTHS, secret: SECRET, info: INFO, fetchImpl: f.impl }), { ok: 3, total: 3 });
    assert.deepEqual(f.calls.map((c) => c.url).sort(), AUTHS.map((a) => `${a}/heartbeat`));
    assert.ok(f.calls.every((c) => c.options.headers["x-cluster-secret"] === SECRET));
    f = clusterFetch(new Set([AUTHS[1]]));
    assert.deepEqual(await sendHeartbeatAll({ authUrls: AUTHS, secret: SECRET, info: INFO, fetchImpl: f.impl }), { ok: 2, total: 3 });
    f = clusterFetch(new Set(AUTHS));
    assert.deepEqual(await sendHeartbeatAll({ authUrls: AUTHS, secret: SECRET, info: INFO, fetchImpl: f.impl }), { ok: 0, total: 3 });
    // Uno que no responde no frena a los demás: cada uno tiene su timeout
    const slow = async (url, options) => (url.startsWith(AUTHS[0]) ? new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))) : { status: 200, json: async () => ({ ok: true }) });
    const t0 = Date.now();
    assert.deepEqual(await sendHeartbeatAll({ authUrls: AUTHS, secret: SECRET, info: INFO, fetchImpl: slow, timeoutMs: 80 }), { ok: 2, total: 3 });
    assert.ok(Date.now() - t0 < 1000, "en paralelo, acotado por el timeout");
    // Con una sola AUTH_URL (compatibilidad)
    assert.deepEqual(await sendHeartbeatAll({ authUrl: AUTHS[0], secret: SECRET, info: INFO, fetchImpl: clusterFetch().impl }), { ok: 1, total: 1 });
});

test("fetchCoordinatorPeers: con el primer nodo caído usa el segundo; null si ninguno responde", async () => {
    const peers = { peers: [{ coordinatorId: "coord-b", peerUrl: "ws://localhost:5102" }] };
    let f = clusterFetch(new Set([AUTHS[0]]), peers);
    assert.deepEqual(await fetchCoordinatorPeers({ authUrls: AUTHS, selfId: "coord-a", fetchImpl: f.impl }), [{ coordinatorId: "coord-b", peerUrl: "ws://localhost:5102" }]);
    assert.deepEqual(f.calls.map((c) => c.url), [`${AUTHS[0]}/coordinator-peers`, `${AUTHS[1]}/coordinator-peers`], "en orden y se detiene en el primero que responde");
    f = clusterFetch(new Set(AUTHS), peers);
    assert.equal(await fetchCoordinatorPeers({ authUrls: AUTHS, selfId: "coord-a", fetchImpl: f.impl }), null);
    assert.equal(f.calls.length, 3);
});

test("startHeartbeatLoop con varios auth: onChange solo cuando cambia cuántos responden", async () => {
    const down = new Set();
    const f = clusterFetch(down);
    const changes = [];
    const stop = startHeartbeatLoop({ authUrls: AUTHS, secret: SECRET, info: () => INFO, intervalMs: 20, fetchImpl: f.impl, onChange: (up, r) => changes.push([up, r.ok, r.total]) });
    await sleep(70);
    down.add(AUTHS[2]);
    await sleep(70);
    for (const a of AUTHS) down.add(a);
    await sleep(70);
    down.clear();
    await sleep(70);
    stop();
    assert.deepEqual(changes, [[true, 3, 3], [true, 2, 3], [false, 0, 3], [true, 3, 3]]);
});
