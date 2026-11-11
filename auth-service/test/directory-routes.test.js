// Pruebas HTTP del directory service: POST /heartbeat, GET /coordinator, /peers y /directory.
// La app recibe un directorio con reloj falso y escucha en un puerto libre (listen(0)).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { ensureSchema } = require("../db.js");
const { createApp } = require("../app.js");
const { createDirectory } = require("../directory.js");
const { JWT_SECRET, captureLogs, fakeGoogleVerifier } = require("./helpers.js");

const CLUSTER_SECRET = "c".repeat(16) + "secreto-del-cluster-de-prueba-123";

function fakeClock(start = 5_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => (t += ms) };
}

// Levanta una app con su propio directorio. Devuelve { clock, request, close }.
async function startCluster({ reservationTtlMs = 3000, clusterSecret = CLUSTER_SECRET } = {}) {
    const clock = fakeClock();
    const db = new DatabaseSync(":memory:");
    ensureSchema(db, { dbPath: ":memory:" });
    const directory = createDirectory({ ttlMs: 6000, reservationTtlMs, now: clock.now });
    const app = createApp({ db, jwtSecret: JWT_SECRET, bcryptRounds: 10, verifyGoogle: fakeGoogleVerifier(), directory, clusterSecret });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(method, route, { body, headers = {} } = {}) {
        const options = { method, headers: { "Content-Type": "application/json", ...headers } };
        if (body !== undefined) options.body = typeof body === "string" ? body : JSON.stringify(body);
        const res = await fetch(base + route, options);
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = undefined;
        }
        return { status: res.status, json, headers: res.headers };
    }
    return {
        clock,
        request,
        get: (route) => request("GET", route),
        beat: (id, changes = {}, secret = CLUSTER_SECRET) =>
            request("POST", "/heartbeat", { body: heartbeatBody(id, changes), headers: { "x-cluster-secret": secret } }),
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(() => {
                    db.close();
                    resolve();
                });
            }),
    };
}

const PORTS = { a: 1, b: 2, c: 3 };
// El ejemplo del enunciado, con cambios opcionales
const heartbeatBody = (id, changes = {}) => ({
    coordinatorId: id,
    publicUrl: `ws://localhost:500${PORTS[id.slice(-1)]}`,
    peerUrl: `ws://localhost:510${PORTS[id.slice(-1)]}`,
    connectedPlayers: 0,
    uptime: 12.4,
    ...changes,
});

let logs;
before(() => {
    logs = captureLogs();
});
after(() => {
    logs.restore();
    // El secreto del clúster nunca aparece en los logs
    assert.ok(logs.lines.length > 0, "hubo logs de peticiones");
    assert.ok(logs.lines.every((line) => !line.includes(CLUSTER_SECRET)), "el log no contiene el CLUSTER_SECRET");
});

test("POST /heartbeat: sin header o con header incorrecto → 401; correcto → 200; body inválido → 400", async () => {
    const c = await startCluster();
    try {
        const noHeader = await c.request("POST", "/heartbeat", { body: heartbeatBody("coord-a") });
        assert.equal(noHeader.status, 401);
        assert.deepEqual(noHeader.json, { error: "invalid_cluster_secret" });

        const wrong = await c.beat("coord-a", {}, CLUSTER_SECRET + "x");
        assert.equal(wrong.status, 401);
        assert.deepEqual(wrong.json, { error: "invalid_cluster_secret" });
        assert.equal((await c.beat("coord-a", {}, "")).status, 401);

        const ok = await c.beat("coord-a");
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.json, { ok: true });

        for (const changes of [{ coordinatorId: "con espacios" }, { publicUrl: "http://localhost:5001" }, { connectedPlayers: -1 }, { uptime: "1" }]) {
            const bad = await c.request("POST", "/heartbeat", { body: { ...heartbeatBody("coord-a"), ...changes }, headers: { "x-cluster-secret": CLUSTER_SECRET } });
            assert.equal(bad.status, 400, JSON.stringify(changes));
            assert.equal(typeof bad.json.error, "string");
        }
        const notObject = await c.request("POST", "/heartbeat", { body: "[1,2]", headers: { "x-cluster-secret": CLUSTER_SECRET } });
        assert.equal(notObject.status, 400);
    } finally {
        await c.close();
    }
});

test("sin clusterSecret configurado, /heartbeat responde siempre 401", async () => {
    const c = await startCluster({ clusterSecret: null }); // null: undefined activaría el valor por defecto
    try {
        assert.equal((await c.beat("coord-a")).status, 401);
        assert.equal((await c.beat("coord-a", {}, "")).status, 401);
    } finally {
        await c.close();
    }
});

test("GET /peers: solo vivos y en orden de registro; sin header y con Cache-Control: no-store", async () => {
    const c = await startCluster();
    try {
        await c.beat("coord-a");
        await c.beat("coord-b");
        await c.beat("coord-c");
        let r = await c.get("/peers");
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.deepEqual(r.json.peers.map((p) => p.coordinatorId), ["coord-a", "coord-b", "coord-c"]);
        assert.deepEqual(r.json.peers[0], { coordinatorId: "coord-a", peerUrl: "ws://localhost:5101" });
        // b deja de latir
        c.clock.advance(4000);
        await c.beat("coord-a");
        await c.beat("coord-c");
        c.clock.advance(2001);
        r = await c.get("/peers");
        assert.deepEqual(r.json.peers.map((p) => p.coordinatorId), ["coord-a", "coord-c"]);
    } finally {
        await c.close();
    }
});

test("GET /coordinator: menor carga, empate → el primero, 503 sin vivos y caída por TTL", async () => {
    const c = await startCluster({ reservationTtlMs: 0 });
    try {
        let r = await c.get("/coordinator");
        assert.equal(r.status, 503);
        assert.deepEqual(r.json, { error: "no_coordinators_available" });

        await c.beat("coord-a", { connectedPlayers: 4 });
        await c.beat("coord-b", { connectedPlayers: 1 });
        await c.beat("coord-c", { connectedPlayers: 1 });
        r = await c.get("/coordinator");
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.deepEqual(r.json, { coordinatorId: "coord-b", publicUrl: "ws://localhost:5002" }, "menor carga; empate b/c → b");

        // b deja de latir: a los 6001 ms ya no aparece
        c.clock.advance(3000);
        await c.beat("coord-a", { connectedPlayers: 4 });
        await c.beat("coord-c", { connectedPlayers: 1 });
        c.clock.advance(3001);
        r = await c.get("/coordinator");
        assert.equal(r.json.coordinatorId, "coord-c");

        c.clock.advance(6001);
        r = await c.get("/coordinator");
        assert.equal(r.status, 503);
    } finally {
        await c.close();
    }
});

test("GET /coordinator: 4 pedidos seguidos con 3 coordinadores en 0 no devuelven siempre el mismo (reservas)", async () => {
    const c = await startCluster({ reservationTtlMs: 3000 });
    try {
        await c.beat("coord-a");
        await c.beat("coord-b");
        await c.beat("coord-c");
        const got = [];
        for (let i = 0; i < 4; i++) got.push((await c.get("/coordinator")).json.coordinatorId);
        assert.ok(new Set(got).size > 1, got.join(", "));
        assert.deepEqual(got, ["coord-a", "coord-b", "coord-c", "coord-a"]);
    } finally {
        await c.close();
    }
});

test("GET /directory: solo vivos, con ageMs y ttlMs; los tres GET funcionan sin header", async () => {
    const c = await startCluster();
    try {
        await c.beat("coord-a", { connectedPlayers: 2, uptime: 99.6 });
        c.clock.advance(1200);
        const r = await c.get("/directory");
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.deepEqual(r.json, {
            coordinators: [{ coordinatorId: "coord-a", publicUrl: "ws://localhost:5001", peerUrl: "ws://localhost:5101", connectedPlayers: 2, uptime: 100, ageMs: 1200 }],
            ttlMs: 6000,
        });
        for (const route of ["/coordinator", "/peers", "/directory"]) assert.equal((await c.get(route)).status, 200, route);
    } finally {
        await c.close();
    }
});
