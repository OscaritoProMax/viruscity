// Almacenamiento replicable del auth-service (Taller 7, decisión 8). Funciones puras sobre una BD node:sqlite
// inyectada (DatabaseSync): no hay red ni relojes aquí.
//
// Cada escritura de usuarios es una ENTRADA del oplog { seq, term, entryId, op, data } que se aplica en orden
// estricto (seq = último + 1) en una transacción atómica oplog + users. El líder y las réplicas aplican
// exactamente las mismas entradas, así que terminan con las mismas filas (mismos ids).
//
// ensureSchema(db, { dbPath })  → el de db.js (users + migración del Taller 4 + oplog + meta)
// bootstrapLegacy(db)           → entradas deterministas para una BD con users y sin oplog; devuelve cuántas creó
// lastPosition(db)              → { seq, term } de la última entrada ({ 0, 0 } si está vacío)
// entryAt(db, seq) / entriesAfter(db, seq, limit)
// getMeta(db, key) / setMeta(db, key, value)
// countUsers(db) / nextUserId(db) / usersChecksum(db)
// validateEntry(entry)          → { ok:true } | { ok:false, reason }
// applyEntry(db, entry)         → aplica una entrada (lanza OrderError, ConflictError o un Error de validación)
// undoLast(db, entryId)         → deshace la última entrada si es esa; true | false
// wipe(db)                      → borra users y oplog (no toca meta)

const crypto = require("node:crypto");
const { ensureSchema } = require("./db.js");

const OPS = new Set(["register", "register_google"]);
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const ENTRY_ID_MAX = 64;
const HASH_MAX = 100;
const SUB_MAX = 64;
const EMAIL_MAX = 254;
const CREATED_MAX = 32;

// La entrada choca con una fila existente (username, google_sub, id o entry_id repetidos)
class ConflictError extends Error {
    constructor(message = "la entrada choca con datos existentes") {
        super(message);
        this.name = "ConflictError";
        this.code = "conflict";
    }
}

// La entrada no es la siguiente (seq != último + 1)
class OrderError extends Error {
    constructor(expected, got) {
        super(`entrada fuera de orden: se esperaba seq ${expected} y llegó ${got}`);
        this.name = "OrderError";
        this.code = "out_of_order";
        this.expected = expected;
        this.got = got;
    }
}

// Violación de UNIQUE o PRIMARY KEY en node:sqlite (SQLITE_CONSTRAINT_UNIQUE = 2067, _PRIMARYKEY = 1555)
const isUniqueViolation = (err) => err?.errcode === 2067 || err?.errcode === 1555 || /UNIQUE constraint failed/i.test(err?.message ?? "");

const isText = (v, max, min = 1) => typeof v === "string" && v.length >= min && v.length <= max;
const isPositiveInt = (v) => Number.isSafeInteger(v) && v > 0;

// ---------- Validación ----------

function validateEntry(entry) {
    const fail = (reason) => ({ ok: false, reason });
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return fail("la entrada debe ser un objeto");
    if (!isPositiveInt(entry.seq)) return fail("seq debe ser un entero mayor que 0");
    if (!Number.isSafeInteger(entry.term) || entry.term < 0) return fail("term debe ser un entero mayor o igual a 0");
    if (!isText(entry.entryId, ENTRY_ID_MAX)) return fail(`entryId debe tener de 1 a ${ENTRY_ID_MAX} caracteres`);
    if (!OPS.has(entry.op)) return fail("op desconocida");
    const d = entry.data;
    if (d === null || typeof d !== "object" || Array.isArray(d)) return fail("data debe ser un objeto");
    if (!isPositiveInt(d.userId)) return fail("data.userId debe ser un entero mayor que 0");
    if (typeof d.username !== "string" || !USERNAME_REGEX.test(d.username)) return fail("data.username inválido");
    if (!isText(d.created_at, CREATED_MAX, 0)) return fail(`data.created_at debe ser texto de hasta ${CREATED_MAX} caracteres`);
    if (d.provider === "local") {
        if (entry.op !== "register") return fail("provider local requiere op register");
        if (!isText(d.password_hash, HASH_MAX) || !d.password_hash.startsWith("$2")) return fail("data.password_hash inválido");
        if (d.google_sub !== undefined && d.google_sub !== null) return fail("una cuenta local no lleva google_sub");
    } else if (d.provider === "google") {
        if (entry.op !== "register_google") return fail("provider google requiere op register_google");
        if (!isText(d.google_sub, SUB_MAX)) return fail("data.google_sub inválido");
        if (!isText(d.email, EMAIL_MAX)) return fail("data.email inválido");
        if (d.password_hash !== undefined && d.password_hash !== null) return fail("una cuenta de Google no lleva password_hash");
    } else {
        return fail("data.provider debe ser local o google");
    }
    return { ok: true };
}

// Solo los campos conocidos, en un orden fijo (así el JSON del oplog es igual en todos los nodos)
function canonicalData(d) {
    const base = { userId: d.userId, username: d.username, provider: d.provider };
    const extra = d.provider === "local" ? { password_hash: d.password_hash } : { google_sub: d.google_sub, email: d.email };
    return { ...base, ...extra, created_at: d.created_at };
}

// ---------- Lecturas ----------

function rowToEntry(row) {
    if (!row) return null;
    return { seq: row.seq, term: row.term, entryId: row.entry_id, op: row.op, data: JSON.parse(row.data) };
}

function lastPosition(db) {
    const row = db.prepare("SELECT seq, term FROM oplog ORDER BY seq DESC LIMIT 1").get();
    return row ? { seq: row.seq, term: row.term } : { seq: 0, term: 0 };
}

function entryAt(db, seq) {
    return rowToEntry(db.prepare("SELECT seq, term, entry_id, op, data FROM oplog WHERE seq = ?").get(seq));
}

function entriesAfter(db, seq, limit = 500) {
    return db.prepare("SELECT seq, term, entry_id, op, data FROM oplog WHERE seq > ? ORDER BY seq LIMIT ?").all(seq, limit).map(rowToEntry);
}

function getMeta(db, key) {
    return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

function setMeta(db, key, value) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

const countUsers = (db) => db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

const nextUserId = (db) => db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM users").get().next;

// sha256 hex de las líneas "id:username" ordenadas por id (decisión 14): dos nodos con los mismos usuarios
// tienen el mismo checksum
function usersChecksum(db) {
    const lines = db.prepare("SELECT id, username FROM users ORDER BY id").all().map((r) => `${r.id}:${r.username}`);
    return crypto.createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

// ---------- Escrituras ----------

// Ejecuta fn dentro de BEGIN IMMEDIATE / COMMIT; ante cualquier error, ROLLBACK y relanza
function transaction(db, fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

function insertEntryRows(db, entry) {
    const d = canonicalData(entry.data);
    db.prepare("INSERT INTO users (id, username, provider, password_hash, google_sub, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        d.userId,
        d.username,
        d.provider,
        d.provider === "local" ? d.password_hash : null,
        d.provider === "google" ? d.google_sub : null,
        d.provider === "google" ? d.email : null,
        d.created_at
    );
    db.prepare("INSERT INTO oplog (seq, term, entry_id, op, data) VALUES (?, ?, ?, ?, ?)").run(entry.seq, entry.term, entry.entryId, entry.op, JSON.stringify(d));
}

function applyEntry(db, entry) {
    const check = validateEntry(entry);
    if (!check.ok) throw new Error(`entrada inválida: ${check.reason}`);
    return transaction(db, () => {
        const expected = lastPosition(db).seq + 1;
        if (entry.seq !== expected) throw new OrderError(expected, entry.seq);
        try {
            insertEntryRows(db, entry);
        } catch (err) {
            if (isUniqueViolation(err)) throw new ConflictError();
            throw err;
        }
        return { seq: entry.seq, term: entry.term };
    });
}

// Deshace la última entrada solo si su entryId coincide (write_abort o conflicto en la misma posición)
function undoLast(db, entryId) {
    return transaction(db, () => {
        const last = db.prepare("SELECT seq, entry_id, data FROM oplog ORDER BY seq DESC LIMIT 1").get();
        if (!last || last.entry_id !== entryId) return false;
        const { userId } = JSON.parse(last.data);
        db.prepare("DELETE FROM users WHERE id = ?").run(userId);
        db.prepare("DELETE FROM oplog WHERE seq = ?").run(last.seq);
        return true;
    });
}

// Resincronización completa: sin usuarios ni oplog (meta, con término y voto, se conserva)
function wipe(db) {
    transaction(db, () => {
        db.exec("DELETE FROM users");
        db.exec("DELETE FROM oplog");
        // users usa AUTOINCREMENT: se reinicia su contador si la tabla interna existe
        const hasSequence = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get().n > 0;
        if (hasSequence) db.exec("DELETE FROM sqlite_sequence WHERE name = 'users'");
    });
}

// BD heredada (Talleres 4-6): users con filas pero oplog vacío → una entrada por usuario, ordenadas por id,
// con seq = posición, term 0 y entry_id "legacy-<id>". Mismos users ⇒ mismas entradas en cualquier nodo.
function bootstrapLegacy(db) {
    if (lastPosition(db).seq > 0 || countUsers(db) === 0) return 0;
    const rows = db.prepare("SELECT id, username, provider, password_hash, google_sub, email, created_at FROM users ORDER BY id").all();
    const insert = db.prepare("INSERT INTO oplog (seq, term, entry_id, op, data) VALUES (?, 0, ?, ?, ?)");
    transaction(db, () => {
        rows.forEach((r, i) => {
            const data = canonicalData({
                userId: r.id,
                username: r.username,
                provider: r.provider,
                password_hash: r.password_hash,
                google_sub: r.google_sub,
                email: r.email,
                created_at: r.created_at === null ? "" : String(r.created_at),
            });
            insert.run(i + 1, `legacy-${r.id}`, r.provider === "google" ? "register_google" : "register", JSON.stringify(data));
        });
    });
    return rows.length;
}

module.exports = {
    ensureSchema,
    bootstrapLegacy,
    lastPosition,
    entryAt,
    entriesAfter,
    getMeta,
    setMeta,
    countUsers,
    nextUserId,
    usersChecksum,
    validateEntry,
    applyEntry,
    undoLast,
    wipe,
    ConflictError,
    OrderError,
    OPS,
};
