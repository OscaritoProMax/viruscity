// Pruebas de la replicación de nodo único (replication/standalone.js) y del mutex de escrituras.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { ensureSchema, entriesAfter, lastPosition, nextUserId, countUsers, getMeta, setMeta, usersChecksum } = require("../oplog.js");
const { createStandaloneReplication } = require("../replication/standalone.js");
const { createMutex } = require("../replication/mutex.js");

const HASH = "$2a$10$abcdefghijklmnopqrstuuJ0pQxS6m1wYqk2v1q3m1E4v5Z6x7y8z";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshDb() {
    const db = new DatabaseSync(":memory:");
    ensureSchema(db, { dbPath: ":memory:" });
    return db;
}

// prepare de un registro local: asigna el siguiente id dentro del mutex (con una espera para forzar intercalados)
const register = (username, delay = 0) => async (db) => {
    const userId = nextUserId(db);
    if (delay) await sleep(delay);
    return { data: { userId, username, provider: "local", password_hash: HASH, created_at: "2026-11-20 10:00:00" } };
};

test("write serializa: 10 escrituras en paralelo dan seq e ids consecutivos sin huecos", async () => {
    const db = freshDb();
    const rep = createStandaloneReplication({ db, cfg: { authId: "auth-solo" } });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => rep.write("register", register(`user_${i}`, (i * 7) % 5))));
    for (const r of results) assert.equal(r.ok, true);
    assert.deepEqual(results.map((r) => r.entry.seq).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(results.map((r) => r.entry.seq), results.map((r) => r.entry.data.userId), "seq e id avanzan juntos");
    assert.deepEqual(results.map((r) => r.entry.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "en el orden de llegada");
    assert.equal(new Set(results.map((r) => r.entry.entryId)).size, 10, "entryId únicos");
    assert.ok(results.every((r) => r.entry.term === 1 && r.entry.op === "register"));
    assert.deepEqual(entriesAfter(db, 0, 100).map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(countUsers(db), 10);
});

test("write: noop no crea entrada y error devuelve su status y body", async () => {
    const db = freshDb();
    const rep = createStandaloneReplication({ db });
    await rep.write("register", register("ana"));
    const noop = await rep.write("register_google", () => ({ noop: { id: 1, username: "ana" } }));
    assert.deepEqual(noop, { ok: true, noop: { id: 1, username: "ana" } });
    const err = await rep.write("register", () => ({ error: { status: 409, body: { error: "El nombre de usuario ya existe" } } }));
    assert.deepEqual(err, { ok: false, status: 409, body: { error: "El nombre de usuario ya existe" } });
    assert.deepEqual(lastPosition(db), { seq: 1, term: 1 }, "solo la primera escritura");
    // Una entrada que choca igual (prepare que no valida) se informa como conflicto, sin romper la BD
    const clash = await rep.write("register", () => ({ data: { userId: 2, username: "ANA", provider: "local", password_hash: HASH, created_at: "" } }));
    assert.deepEqual([clash.ok, clash.status, clash.conflict], [false, 409, true]);
    assert.equal(countUsers(db), 1);
    await assert.rejects(rep.write("borrar", () => ({ data: {} })), /operación desconocida/);
    await assert.rejects(rep.write("register", () => ({})), /prepare debe devolver/);
    // Tras un error el mutex sigue funcionando
    assert.equal((await rep.write("register", register("beto"))).entry.seq, 2);
});

test("al crearse aplica bootstrapLegacy a una BD heredada y sigue la numeración", async () => {
    const db = freshDb();
    db.prepare("INSERT INTO users (id, username, provider, password_hash, created_at) VALUES (3, 'vieja', 'local', ?, '2026-01-01 00:00:00')").run(HASH);
    db.prepare("INSERT INTO users (id, username, provider, password_hash, created_at) VALUES (7, 'antigua', 'local', ?, '2026-01-01 00:00:00')").run(HASH);
    const rep = createStandaloneReplication({ db });
    assert.equal(rep.legacyEntries, 2);
    assert.deepEqual(entriesAfter(db, 0, 10).map((e) => e.entryId), ["legacy-3", "legacy-7"]);
    const r = await rep.write("register", register("nueva"));
    assert.deepEqual([r.entry.seq, r.entry.data.userId], [3, 8]);
    assert.equal(createStandaloneReplication({ db }).legacyEntries, 0, "la segunda vez no repite");
});

test("status, puertas de lectura, peers y término persistido", () => {
    const db = freshDb();
    const rep = createStandaloneReplication({ db, cfg: { authId: "auth-x", publicUrl: "http://localhost:4555", peerUrl: null }, now: () => 1234 });
    const s = rep.status();
    assert.deepEqual(Object.keys(s).sort(), ["authId", "checksum", "election", "knownPeers", "lastAppliedSeq", "lastTerm", "leaderId", "leaderUrl", "peerUrl", "publicUrl", "role", "term", "users"].sort());
    assert.deepEqual(
        { ...s, checksum: undefined },
        { authId: "auth-x", role: "leader", publicUrl: "http://localhost:4555", peerUrl: null, leaderUrl: "http://localhost:4555", knownPeers: [], lastAppliedSeq: 0, users: 0, term: 1, leaderId: "auth-x", election: false, lastTerm: 0, checksum: undefined }
    );
    assert.equal(s.checksum, usersChecksum(db));
    assert.deepEqual(rep.whoami(), { authId: "auth-x", role: "leader" });
    assert.deepEqual(rep.canServeRead(), { ok: true });
    assert.equal(rep.isLagging(), false);
    assert.deepEqual(rep.peers(), []);
    assert.deepEqual(rep.leader(), { leaderId: "auth-x", leaderUrl: "http://localhost:4555" });
    assert.equal(rep.now(), 1234);
    assert.equal(getMeta(db, "current_term"), "1");
    // Una BD que viene de un clúster con término mayor lo conserva
    const db2 = freshDb();
    setMeta(db2, "current_term", 9);
    assert.equal(createStandaloneReplication({ db: db2 }).status().term, 9);
});

test("createMutex: una tarea a la vez, en orden, y un error no bloquea la cola", async () => {
    const m = createMutex();
    const log = [];
    let running = 0;
    const task = (name, ms, fail = false) => async () => {
        running += 1;
        assert.equal(running, 1, "nunca dos a la vez");
        log.push(`+${name}`);
        await sleep(ms);
        log.push(`-${name}`);
        running -= 1;
        if (fail) throw new Error(name);
        return name;
    };
    const p = [m.run(task("a", 15)), m.run(task("b", 1, true)), m.run(task("c", 5))];
    assert.equal(m.pending(), 3);
    const settled = await Promise.allSettled(p);
    assert.deepEqual(settled.map((s) => s.status), ["fulfilled", "rejected", "fulfilled"]);
    assert.deepEqual(log, ["+a", "-a", "+b", "-b", "+c", "-c"]);
    await sleep(0);
    assert.equal(m.pending(), 0);
});
