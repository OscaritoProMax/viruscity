// Base de datos del auth-service (Taller 5): una sola tabla users para cuentas locales y de Google.
//
// ensureSchema(db, { dbPath }) crea la tabla con el esquema exacto de CLAUDE.md o migra la tabla del
// Taller 4 (sin columna provider). Es idempotente.
// createStatements(db) devuelve las consultas preparadas que usa la app.
//
// Invariantes (se hacen cumplir aquí): local → password_hash y sin google_sub;
// google → google_sub y email, sin password_hash. Un username no se repite entre providers
// y es único SIN distinguir mayúsculas ("Oscar" = "oscar").

const fs = require("node:fs");

// Esquema EXACTO de la tabla (CLAUDE.md, Taller 5, decisión 1)
const USERS_SCHEMA =
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('local','google')), password_hash TEXT, google_sub TEXT UNIQUE, email TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)";

// Índice aparte (no cambia el esquema de la tabla): usernames únicos sin distinguir mayúsculas
const NOCASE_INDEX = "CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase ON users (username COLLATE NOCASE)";

function userColumns(db) {
    return db.prepare("PRAGMA table_info('users')").all().map((column) => column.name);
}

// <dbPath>.bak, o <dbPath>.<timestamp>.bak si ya existe una copia
function backupPath(dbPath) {
    const plain = `${dbPath}.bak`;
    if (!fs.existsSync(plain)) return plain;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${dbPath}.${stamp}.bak`;
}

// Migra la tabla del Taller 4 (id, username, password_hash, created_at): todos quedan como provider 'local'
// con los mismos ids. Antes se copia el archivo; si algo falla se deshace todo.
function migrateFromTaller4(db, dbPath) {
    let backup = null;
    if (dbPath && dbPath !== ":memory:") {
        backup = backupPath(dbPath);
        fs.copyFileSync(dbPath, backup);
    }

    db.exec("BEGIN");
    try {
        db.exec(USERS_SCHEMA.replace("CREATE TABLE users", "CREATE TABLE users_new"));
        db.exec(
            "INSERT INTO users_new (id, username, provider, password_hash, created_at) " +
                "SELECT id, username, 'local', password_hash, created_at FROM users"
        );
        const { n } = db.prepare("SELECT COUNT(*) AS n FROM users_new").get();
        db.exec("DROP TABLE users");
        db.exec("ALTER TABLE users_new RENAME TO users");
        db.exec("COMMIT");
        console.log(`[db] migración aplicada: ${n} usuarios conservados como provider=local`);
        return { migrated: n, backup };
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

function ensureNocaseIndex(db) {
    try {
        db.exec(NOCASE_INDEX);
    } catch {
        // Una base antigua puede tener nombres que solo difieren en mayúsculas: se avisa sin nombres
        // y la app sigue validando los registros nuevos con findByUsername (COLLATE NOCASE).
        console.error("[db] aviso: hay usuarios cuyo nombre solo difiere en mayúsculas; no se pudo crear el índice único sin mayúsculas");
    }
}

// Deja la base lista. Devuelve { created, migrated, backup } para que las pruebas lo comprueben.
function ensureSchema(db, { dbPath } = {}) {
    const columns = userColumns(db);
    let result = { created: false, migrated: 0, backup: null };

    if (columns.length === 0) {
        db.exec(USERS_SCHEMA);
        result.created = true;
    } else if (!columns.includes("provider")) {
        result = { ...result, ...migrateFromTaller4(db, dbPath) };
    }
    // Si ya tiene provider no hay nada que migrar

    ensureNocaseIndex(db);
    return result;
}

// Consultas preparadas: siempre con parámetros ?, nunca concatenando valores
function createStatements(db) {
    const insertLocalStmt = db.prepare("INSERT INTO users (username, provider, password_hash) VALUES (?, 'local', ?)");
    const insertGoogleStmt = db.prepare("INSERT INTO users (username, provider, google_sub, email) VALUES (?, 'google', ?, ?)");
    const findByUsernameStmt = db.prepare(
        "SELECT id, username, provider, password_hash FROM users WHERE username = ? COLLATE NOCASE"
    );
    const findByGoogleStmt = db.prepare("SELECT id, username, provider FROM users WHERE google_sub = ?");

    return {
        // Cuenta local: siempre con hash y sin google_sub
        insertLocal(username, passwordHash) {
            if (typeof passwordHash !== "string" || passwordHash === "") throw new Error("insertLocal requiere password_hash");
            return insertLocalStmt.run(username, passwordHash);
        },
        // Cuenta de Google: siempre con google_sub y email, sin password_hash
        insertGoogle(username, googleSub, email) {
            if (typeof googleSub !== "string" || googleSub === "") throw new Error("insertGoogle requiere google_sub");
            if (typeof email !== "string" || email === "") throw new Error("insertGoogle requiere email");
            return insertGoogleStmt.run(username, googleSub, email);
        },
        // Búsqueda sin distinguir mayúsculas (registro, login y elección de username en Google)
        findByUsername(username) {
            return findByUsernameStmt.get(username) ?? null;
        },
        findByGoogle(googleSub) {
            return findByGoogleStmt.get(googleSub) ?? null;
        },
    };
}

module.exports = { ensureSchema, createStatements, USERS_SCHEMA };
