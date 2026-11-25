// Pruebas del almacenamiento replicable (oplog.js) con BD en memoria (Taller 7, decisión 8).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
    ensureSchema, bootstrapLegacy, lastPosition, entryAt, entriesAfter, getMeta, setMeta, countUsers, nextUserId,
    usersChecksum, validateEntry, applyEntry, undoLast, wipe, ConflictError, OrderError,
} = require("../oplog.js");

const HASH = "$2a$10$abcdefghijklmnopqrstuuJ0pQxS6m1wYqk2v1q3m1E4v5Z6x7y8z"; // forma de un hash de bcrypt

function freshDb() {
    const db = new DatabaseSync(":memory:");
    ensureSchema(db, { dbPath: ":memory:" });
    return db;
}

const local = (seq, userId, username, extra = {}) => ({
    seq, term: 1, entryId: `e-${seq}-${username}`, op: "register",
    data: { userId, username, provider: "local", password_hash: HASH, created_at: "2026-11-20 10:00:00" }, ...extra,
});
const google = (seq, userId, username, sub = `sub-${username}`) => ({
    seq, term: 1, entryId: `g-${seq}-${username}`, op: "register_google",
    data: { userId, username, provider: "google", google_sub: sub, email: `${username}@example.com`, created_at: "2026-11-20 10:00:00" },
});
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);

test("ensureSchema crea users, oplog y meta y es idempotente", () => {
    const db = freshDb();
    assert.deepEqual(tables(db), ["meta", "oplog", "users"]);
    const oplogSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'oplog'").get().sql;
    assert.match(oplogSql, /seq INTEGER PRIMARY KEY, term INTEGER NOT NULL, entry_id TEXT NOT NULL UNIQUE, op TEXT NOT NULL, data TEXT NOT NULL/);
    applyEntry(db, local(1, 1, "ana"));
    setMeta(db, "current_term", 3);
    const again = ensureSchema(db, { dbPath: ":memory:" });
    assert.deepEqual(again, { created: false, migrated: 0, backup: null });
    assert.deepEqual(tables(db), ["meta", "oplog", "users"]);
    assert.equal(countUsers(db), 1, "no borra datos");
    assert.equal(getMeta(db, "current_term"), "3");
});

test("bootstrapLegacy: entradas deterministas por id y solo con oplog vacío", () => {
    const build = () => {
        const db = freshDb();
        // Usuarios heredados (insertados sin oplog, como en los Talleres 4-6), con un hueco de ids
        db.prepare("INSERT INTO users (id, username, provider, password_hash, created_at) VALUES (5, 'zoe', 'local', ?, '2026-01-02 03:04:05')").run(HASH);
        db.prepare("INSERT INTO users (id, username, provider, google_sub, email, created_at) VALUES (2, 'gabi', 'google', 'sub-9', 'g@example.com', '2026-01-01 00:00:00')").run();
        db.prepare("INSERT INTO users (id, username, provider, password_hash, created_at) VALUES (9, 'ivan', 'local', ?, '2026-01-03 00:00:00')").run(HASH);
        return db;
    };
    const a = build();
    const b = build();
    assert.equal(bootstrapLegacy(a), 3);
    assert.equal(bootstrapLegacy(b), 3);
    const entriesA = entriesAfter(a, 0, 100);
    assert.deepEqual(entriesA, entriesAfter(b, 0, 100), "mismas entradas en dos BD con los mismos users");
    assert.deepEqual(entriesA.map((e) => [e.seq, e.term, e.entryId, e.op, e.data.userId]), [
        [1, 0, "legacy-2", "register_google", 2],
        [2, 0, "legacy-5", "register", 5],
        [3, 0, "legacy-9", "register", 9],
    ]);
    for (const e of entriesA) assert.equal(validateEntry(e).ok, true, `${e.entryId}: ${validateEntry(e).reason}`);
    assert.deepEqual(lastPosition(a), { seq: 3, term: 0 });
    assert.equal(bootstrapLegacy(a), 0, "con oplog ya lleno no hace nada");
    assert.equal(bootstrapLegacy(freshDb()), 0, "sin usuarios no hace nada");
    // La siguiente entrada real continúa en seq 4 con id MAX+1
    assert.equal(nextUserId(a), 10);
    applyEntry(a, local(4, 10, "nuevo"));
    assert.deepEqual(lastPosition(a), { seq: 4, term: 1 });
});

test("applyEntry: aplica en orden, guarda users y oplog, y rechaza fuera de orden", () => {
    const db = freshDb();
    assert.deepEqual(lastPosition(db), { seq: 0, term: 0 });
    applyEntry(db, local(1, 1, "ana"));
    applyEntry(db, google(2, 2, "gabi"));
    assert.deepEqual(lastPosition(db), { seq: 2, term: 1 });
    const ana = db.prepare("SELECT * FROM users WHERE id = 1").get();
    assert.deepEqual({ ...ana }, { id: 1, username: "ana", provider: "local", password_hash: HASH, google_sub: null, email: null, created_at: "2026-11-20 10:00:00" });
    const gabi = db.prepare("SELECT provider, password_hash, google_sub, email FROM users WHERE id = 2").get();
    assert.deepEqual({ ...gabi }, { provider: "google", password_hash: null, google_sub: "sub-gabi", email: "gabi@example.com" });
    assert.deepEqual(entryAt(db, 2), google(2, 2, "gabi"));
    assert.equal(entryAt(db, 99), null);

    assert.throws(() => applyEntry(db, local(4, 3, "hueco")), (err) => err instanceof OrderError && err.expected === 3 && err.got === 4);
    assert.throws(() => applyEntry(db, local(2, 3, "repetido")), OrderError, "seq ya usado");
    assert.equal(countUsers(db), 2, "nada aplicado");
});

test("applyEntry: duplicados → ConflictError sin dejar rastro (username sin mayúsculas, google_sub, id, entryId)", () => {
    const db = freshDb();
    applyEntry(db, local(1, 1, "ana"));
    applyEntry(db, google(2, 2, "gabi", "sub-1"));
    const before = { users: countUsers(db), pos: lastPosition(db), sum: usersChecksum(db) };
    const cases = [
        local(3, 3, "ana"),
        local(3, 3, "ANA"),
        google(3, 3, "otro", "sub-1"),
        local(3, 2, "nuevo"),
        { ...local(3, 3, "nuevo"), entryId: "e-1-ana" },
    ];
    for (const entry of cases) {
        assert.throws(() => applyEntry(db, entry), ConflictError, JSON.stringify(entry.data));
        assert.deepEqual({ users: countUsers(db), pos: lastPosition(db), sum: usersChecksum(db) }, before, "rollback completo");
    }
    applyEntry(db, local(3, 3, "nuevo"));
    assert.equal(countUsers(db), 3, "la BD sigue usable después del rollback");
});

test("validateEntry: casos válidos e inválidos (invariantes de provider y op)", () => {
    assert.deepEqual(validateEntry(local(1, 1, "ana")), { ok: true });
    assert.deepEqual(validateEntry(google(1, 1, "gabi")), { ok: true });
    assert.equal(validateEntry({ ...local(1, 1, "ana"), term: 0 }).ok, true, "term 0 (legado)");
    const bad = (mutate, why) => {
        const e = structuredClone(local(1, 1, "ana"));
        mutate(e);
        const r = validateEntry(e);
        assert.equal(r.ok, false, why);
        assert.equal(typeof r.reason, "string");
    };
    bad((e) => (e.seq = 0), "seq 0");
    bad((e) => (e.seq = 1.5), "seq decimal");
    bad((e) => (e.term = -1), "term negativo");
    bad((e) => (e.entryId = ""), "entryId vacío");
    bad((e) => (e.entryId = "x".repeat(65)), "entryId largo");
    bad((e) => (e.op = "delete"), "op desconocida");
    bad((e) => (e.data = null), "sin data");
    bad((e) => (e.data.userId = 0), "userId 0");
    bad((e) => (e.data.userId = "1"), "userId texto");
    bad((e) => (e.data.username = "a b"), "username inválido");
    bad((e) => (e.data.username = "ab"), "username corto");
    bad((e) => (e.data.password_hash = "plano123"), "hash que no es de bcrypt");
    bad((e) => (e.data.password_hash = "$2" + "x".repeat(100)), "hash largo");
    bad((e) => (e.data.google_sub = "sub"), "local con google_sub");
    bad((e) => (e.data.provider = "github"), "provider desconocido");
    bad((e) => (e.data.created_at = 5), "created_at numérico");
    bad((e) => (e.data.created_at = "x".repeat(33)), "created_at largo");
    bad((e) => (e.op = "register_google"), "op y provider incoherentes");
    const g = (mutate, why) => {
        const e = structuredClone(google(1, 1, "gabi"));
        mutate(e);
        assert.equal(validateEntry(e).ok, false, why);
    };
    g((e) => delete e.data.google_sub, "google sin sub");
    g((e) => (e.data.email = ""), "google sin email");
    g((e) => (e.data.email = "x".repeat(255)), "email largo");
    g((e) => (e.data.google_sub = "s".repeat(65)), "sub largo");
    g((e) => (e.data.password_hash = HASH), "google con password_hash");
    g((e) => (e.op = "register"), "op local con provider google");
    assert.equal(validateEntry(null).ok, false);
    assert.equal(validateEntry([]).ok, false);
    assert.throws(() => applyEntry(freshDb(), { ...local(1, 1, "ana"), op: "x" }), /entrada inválida/);
});

test("undoLast: deshace solo la última entrada y solo si coincide el entryId", () => {
    const db = freshDb();
    applyEntry(db, local(1, 1, "ana"));
    applyEntry(db, local(2, 2, "beto"));
    assert.equal(undoLast(db, "e-1-ana"), false, "no es la última");
    assert.equal(undoLast(db, "otra"), false);
    assert.equal(countUsers(db), 2);
    assert.equal(undoLast(db, "e-2-beto"), true);
    assert.deepEqual(lastPosition(db), { seq: 1, term: 1 });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'beto'").get().n, 0);
    assert.equal(undoLast(db, "e-2-beto"), false, "ya no está");
    // Después de deshacer, la posición 2 se puede volver a usar con otra entrada
    applyEntry(db, local(2, 2, "carla"));
    assert.equal(entryAt(db, 2).data.username, "carla");
    assert.equal(undoLast(freshDb(), "nada"), false, "oplog vacío");
});

test("wipe: borra users y oplog, conserva meta y deja la BD lista para empezar de cero", () => {
    const db = freshDb();
    applyEntry(db, local(1, 1, "ana"));
    applyEntry(db, local(2, 2, "beto"));
    setMeta(db, "current_term", 7);
    setMeta(db, "voted_for", "auth-b");
    wipe(db);
    assert.equal(countUsers(db), 0);
    assert.deepEqual(lastPosition(db), { seq: 0, term: 0 });
    assert.equal(nextUserId(db), 1);
    assert.deepEqual([getMeta(db, "current_term"), getMeta(db, "voted_for")], ["7", "auth-b"]);
    applyEntry(db, local(1, 1, "beto"));
    assert.equal(countUsers(db), 1);
});

test("entriesAfter con límite, nextUserId, meta y usersChecksum", () => {
    const db = freshDb();
    for (let i = 1; i <= 7; i++) applyEntry(db, local(i, i, `user_${i}`));
    assert.deepEqual(entriesAfter(db, 0, 3).map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(entriesAfter(db, 5, 10).map((e) => e.seq), [6, 7]);
    assert.deepEqual(entriesAfter(db, 7, 10), []);
    assert.equal(nextUserId(db), 8);
    assert.equal(getMeta(db, "nada"), null);
    setMeta(db, "k", "1");
    setMeta(db, "k", "2");
    assert.equal(getMeta(db, "k"), "2", "upsert");

    // Mismo contenido → mismo checksum; un username distinto lo cambia
    const twin = freshDb();
    for (let i = 1; i <= 7; i++) applyEntry(twin, local(i, i, `user_${i}`));
    assert.equal(usersChecksum(db), usersChecksum(twin));
    assert.match(usersChecksum(db), /^[0-9a-f]{64}$/);
    twin.prepare("UPDATE users SET username = 'cambiado' WHERE id = 3").run();
    assert.notEqual(usersChecksum(db), usersChecksum(twin));
    assert.equal(usersChecksum(freshDb()), usersChecksum(freshDb()), "vacías iguales");
});
