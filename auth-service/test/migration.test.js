// M1: migración de una base del Taller 4 a la tabla única (archivo temporal fuera del repo).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const { ensureSchema, USERS_SCHEMA } = require("../db.js");
const { captureLogs, startApp, decodeJwt } = require("./helpers.js");

const OLD_SCHEMA =
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)";
const OLD_USERS = [
    { id: 2, username: "ana_vieja", password: "claveAna1" },
    { id: 9, username: "beto_viejo", password: "claveBeto2" },
];

let dir;
let logs;

// Crea un archivo con el esquema del Taller 4 y dos usuarios con hash de bcryptjs
function createOldDb(file) {
    const db = new DatabaseSync(file);
    db.exec(OLD_SCHEMA);
    const insert = db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, '2026-11-01 10:00:00')");
    for (const u of OLD_USERS) insert.run(u.id, u.username, bcrypt.hashSync(u.password, 10));
    db.close();
}

const backups = (file) => fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(path.basename(file)) && n.endsWith(".bak"));

before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-migracion-"));
    logs = captureLogs();
});

after(() => {
    logs.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("M1 migra conservando ids y hashes, crea el .bak, es idempotente y la cuenta sigue funcionando", async () => {
    const file = path.join(dir, "users.db");
    createOldDb(file);

    const db = new DatabaseSync(file);
    let api = null;
    try {
    const first = ensureSchema(db, { dbPath: file });
    assert.equal(first.migrated, 2);
    assert.deepEqual(backups(file), ["users.db.bak"]);

    // Esquema exacto y datos conservados como provider 'local' con los mismos ids.
    // Tras "ALTER TABLE users_new RENAME TO users" SQLite guarda el nombre entre comillas ("users");
    // el resto de la definición es idéntico al esquema de CLAUDE.md.
    const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
    assert.equal(stored.replace('CREATE TABLE "users"', "CREATE TABLE users"), USERS_SCHEMA);
    const rows = db.prepare("SELECT id, username, provider, password_hash, google_sub, email, created_at FROM users ORDER BY id").all();
    assert.deepEqual(rows.map((r) => [r.id, r.username, r.provider, r.google_sub, r.email, r.created_at]), [
        [2, "ana_vieja", "local", null, null, "2026-11-01 10:00:00"],
        [9, "beto_viejo", "local", null, null, "2026-11-01 10:00:00"],
    ]);
    assert.ok(rows.every((r) => /^\$2[aby]\$10\$/.test(r.password_hash)));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'users_new'").get().n, 0);

    // Idempotente: una segunda llamada no migra ni crea otra copia
    const second = ensureSchema(db, { dbPath: file });
    assert.equal(second.migrated, 0);
    assert.equal(second.backup, null);
    assert.deepEqual(backups(file), ["users.db.bak"]);

    // El login con la contraseña original funciona y un usuario nuevo recibe un id mayor
    api = await startApp({ db });
    const login = await api.post("/login", { username: "beto_viejo", password: "claveBeto2" });
    assert.equal(login.status, 200);
    const p = decodeJwt(login.json.token);
    assert.equal(p.userId, "9");
    assert.equal(p.provider, "local");
    const created = await api.post("/register", { username: "nuevo_t5", password: "claveNueva3" });
    assert.equal(created.status, 201);
    assert.ok(Number(created.json.userId) > 9, `id nuevo ${created.json.userId}`);
    // Sin distinguir mayúsculas también tras la migración
    assert.equal((await api.post("/register", { username: "ANA_VIEJA", password: "claveNueva3" })).status, 409);
    } finally {
        // Siempre se cierra la base: en Windows un archivo abierto impide borrar la carpeta temporal
        if (api) await api.close();
        db.close();
    }
});

test("M1 si ya existe users.db.bak, la nueva copia lleva marca de tiempo", () => {
    const file = path.join(dir, "otra.db");
    createOldDb(file);
    fs.writeFileSync(`${file}.bak`, "copia anterior");
    const db = new DatabaseSync(file);
    const result = ensureSchema(db, { dbPath: file });
    db.close();
    assert.equal(result.migrated, 2);
    assert.match(path.basename(result.backup), /^otra\.db\.\d{4}-\d{2}-\d{2}T[\d-]+Z\.bak$/);
    assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), "copia anterior");
});

test("M1 una base nueva en memoria se crea sin copia", () => {
    const db = new DatabaseSync(":memory:");
    const result = ensureSchema(db, { dbPath: ":memory:" });
    assert.equal(result.created, true);
    assert.equal(result.backup, null);
    db.close();
});

test("L1 la migración registra solo el conteo, sin nombres ni contraseñas", () => {
    const output = logs.lines.join("\n");
    assert.ok(logs.lines.includes("[db] migración aplicada: 2 usuarios conservados como provider=local"));
    for (const secret of ["ana_vieja", "beto_viejo", "claveAna1", "claveBeto2", "claveNueva3"]) {
        assert.ok(!output.includes(secret), `apareció en los logs: ${secret}`);
    }
});
