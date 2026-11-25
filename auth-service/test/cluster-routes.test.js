// Pruebas de las rutas del clúster de auth (Taller 7): headers X-Auth-*, GET /status, GET /peers,
// GET /coordinator-peers y las puertas de lectura/escritura con una replicación de réplica simulada.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { ensureSchema, usersChecksum, lastPosition, countUsers } = require("../oplog.js");
const { createStandaloneReplication } = require("../replication/standalone.js");
const { captureLogs, startApp } = require("./helpers.js");

const STATUS_KEYS = ["authId", "role", "publicUrl", "peerUrl", "leaderUrl", "knownPeers", "lastAppliedSeq", "users", "term", "leaderId", "election", "lastTerm", "checksum"].sort();

let logs;
before(() => {
    logs = captureLogs();
});
after(() => logs.restore());

function freshDb() {
    const db = new DatabaseSync(":memory:");
    ensureSchema(db, { dbPath: ":memory:" });
    return db;
}

test("todas las respuestas llevan X-Auth-Id y X-Auth-Role (también 404 y 400) y CORS los expone", async () => {
    const api = await startApp();
    try {
        for (const r of [await api.get("/health"), await api.get("/no-existe"), await api.post("/register", "{roto"), await api.post("/login", {}), await api.get("/coordinator")]) {
            assert.equal(r.headers.get("x-auth-id"), "auth-solo", `${r.status}`);
            assert.equal(r.headers.get("x-auth-role"), "leader", `${r.status}`);
        }
        const cors = await api.get("/status", { Origin: "http://localhost:3000" });
        assert.equal(cors.headers.get("access-control-allow-origin"), "*");
        assert.match(cors.headers.get("access-control-expose-headers") ?? "", /X-Auth-Id/);
        assert.match(cors.headers.get("access-control-expose-headers") ?? "", /X-Auth-Role/);
    } finally {
        await api.close();
    }
});

test("GET /status: todas las claves, valores de nodo único y coherente con la BD tras registrar", async () => {
    const api = await startApp();
    try {
        let r = await api.get("/status");
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.deepEqual(Object.keys(r.json).sort(), STATUS_KEYS);
        assert.deepEqual(
            { ...r.json, checksum: null },
            { authId: "auth-solo", role: "leader", publicUrl: "http://localhost:4000", peerUrl: null, leaderUrl: "http://localhost:4000", knownPeers: [], lastAppliedSeq: 0, users: 0, term: 1, leaderId: "auth-solo", election: false, lastTerm: 0, checksum: null }
        );
        await api.post("/register", { username: "st_ana", password: "claveSegura1" });
        await api.post("/register", { username: "st_beto", password: "claveSegura1" });
        r = await api.get("/status");
        assert.deepEqual([r.json.lastAppliedSeq, r.json.users, r.json.lastTerm], [2, 2, 1]);
        assert.equal(r.json.checksum, usersChecksum(api.db));
        assert.match(r.json.checksum, /^[0-9a-f]{64}$/);
        assert.doesNotMatch(r.text, /claveSegura1|\$2[aby]\$|st_ana/, "/status no lista usuarios ni hashes");
    } finally {
        await api.close();
    }
});

test("GET /peers (auth) vacío en nodo único y GET /coordinator-peers con la forma del Taller 6", async () => {
    const api = await startApp();
    try {
        const peers = await api.get("/peers");
        assert.equal(peers.status, 200);
        assert.deepEqual(peers.json, { peers: [] });
        const coords = await api.get("/coordinator-peers");
        assert.equal(coords.status, 200);
        assert.deepEqual(coords.json, { peers: [] });
        assert.equal(coords.headers.get("cache-control"), "no-store");
    } finally {
        await api.close();
    }
});

// Réplica simulada: la interfaz de nodo único con las puertas y el rol cambiados
function fakeReplica(db, { gate = { ok: true }, lagging = false, leader = { leaderId: "auth-a", leaderUrl: "http://localhost:4001" }, writeResult = null } = {}) {
    const base = createStandaloneReplication({ db, cfg: { authId: "auth-b", publicUrl: "http://localhost:4002" } });
    return {
        ...base,
        whoami: () => ({ authId: "auth-b", role: "replica" }),
        canServeRead: () => gate,
        isLagging: () => lagging,
        leader: () => leader,
        write: writeResult ? async () => writeResult : base.write,
    };
}

test("réplica: X-Auth-Role replica; sin líder → 503 no_leader en login y Google existente (sin token)", async () => {
    const db = freshDb();
    const seed = await startApp({ db });
    await seed.post("/register", { username: "rp_ana", password: "claveSegura1" });
    await seed.post("/auth/google", { idToken: "ok|sub-rp|rp@example.com|true", username: "rp_gabi" });
    await seed.close();

    const api = await startApp({ db, replication: fakeReplica(db, { gate: { ok: false, status: 503, body: { error: "no_leader" } } }) });
    try {
        const login = await api.post("/login", { username: "rp_ana", password: "claveSegura1" });
        assert.deepEqual([login.status, login.json], [503, { error: "no_leader" }]);
        assert.equal(login.headers.get("x-auth-role"), "replica");
        const google = await api.post("/auth/google", { idToken: "ok|sub-rp|rp@example.com|true" });
        assert.deepEqual([google.status, google.json], [503, { error: "no_leader" }]);
        assert.equal((await api.post("/login", {})).status, 400, "la validación va antes de la puerta");
        // El directorio de coordinadores no pasa por la puerta
        assert.equal((await api.get("/coordinator-peers")).status, 200);
        assert.equal((await api.get("/directory")).status, 200);
    } finally {
        await api.close();
    }
});

test("réplica atrasada: una lectura que fallaría da 503 not_leader con el líder; una que funciona da token", async () => {
    const db = freshDb();
    const seed = await startApp({ db });
    await seed.post("/register", { username: "lag_ana", password: "claveSegura1" });
    await seed.close();
    const api = await startApp({ db, replication: fakeReplica(db, { lagging: true }) });
    try {
        const ok = await api.post("/login", { username: "lag_ana", password: "claveSegura1" });
        assert.equal(ok.status, 200);
        for (const body of [{ username: "lag_nuevo", password: "claveSegura1" }, { username: "lag_ana", password: "malaClave99" }]) {
            const r = await api.post("/login", body);
            assert.deepEqual([r.status, r.json], [503, { error: "not_leader", leaderUrl: "http://localhost:4001", leaderId: "auth-a" }], JSON.stringify(body));
        }
    } finally {
        await api.close();
    }
    // Sin líder conocido el 503 not_leader no trae URL
    const noUrl = await startApp({ db, replication: fakeReplica(db, { lagging: true, leader: null }) });
    try {
        const r = await noUrl.post("/login", { username: "lag_x", password: "claveSegura1" });
        assert.deepEqual([r.status, r.json], [503, { error: "not_leader" }]);
    } finally {
        await noUrl.close();
    }
});

test("escrituras rechazadas por la replicación (not_leader, no_quorum) llegan tal cual y no tocan la BD", async () => {
    const db = freshDb();
    for (const result of [
        { ok: false, status: 503, body: { error: "not_leader", leaderUrl: "http://localhost:4001", leaderId: "auth-a" } },
        { ok: false, status: 503, body: { error: "no_quorum" } },
        { ok: false, status: 503, body: { error: "replication_timeout" } },
    ]) {
        const api = await startApp({ db, replication: fakeReplica(db, { writeResult: result }) });
        try {
            const reg = await api.post("/register", { username: "w_nuevo", password: "claveSegura1" });
            assert.deepEqual([reg.status, reg.json], [503, result.body]);
            const g = await api.post("/auth/google", { idToken: "ok|sub-w|w@example.com|true", username: "w_gabi" });
            assert.deepEqual([g.status, g.json], [503, result.body]);
        } finally {
            await api.close();
        }
    }
    assert.deepEqual([countUsers(db), lastPosition(db).seq], [0, 0]);
});
