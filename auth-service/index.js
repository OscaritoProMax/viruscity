// Auth service: registro e inicio de sesión de usuarios.
// Guarda los usuarios en SQLite (contraseñas con bcrypt) y emite JWT firmados con HS256
// que luego valida el coordinator.
//
// Configuración: variables de entorno cargadas desde .env (ver .env.example).
// Solo PORT, DB_PATH, JWT_EXPIRES_IN y BCRYPT_ROUNDS tienen valor por defecto;
// JWT_SECRET es obligatorio.

require("dotenv").config({ quiet: true }); // quiet: evita que dotenv imprima su propio mensaje en consola

const path = require("node:path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ---------- Configuración ----------

// Detiene el proceso con un motivo claro si la configuración no es válida
function fatal(reason) {
    console.error(`Error de configuración: ${reason}`);
    process.exit(1);
}

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "./users.db");
const JWT_SECRET = process.env.JWT_SECRET;
const ROUNDS_RAW = process.env.BCRYPT_ROUNDS || "10";
const EXPIRES_RAW = process.env.JWT_EXPIRES_IN || "1h";

if (!JWT_SECRET) fatal("JWT_SECRET es obligatorio");
if (JWT_SECRET.length < 16) fatal("JWT_SECRET debe tener al menos 16 caracteres");

if (!/^\d+$/.test(ROUNDS_RAW)) fatal("BCRYPT_ROUNDS debe ser un número entero");
const BCRYPT_ROUNDS = Number(ROUNDS_RAW);
if (BCRYPT_ROUNDS < 10) fatal("BCRYPT_ROUNDS debe ser mayor o igual a 10");
if (BCRYPT_ROUNDS > 31) fatal("BCRYPT_ROUNDS no puede ser mayor que 31 (límite de bcrypt)");

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fatal("PORT debe ser un número de puerto válido");

// jsonwebtoken interpreta un string numérico ("3600") como milisegundos;
// si solo trae dígitos se convierte a Number para que cuente como segundos.
const JWT_EXPIRES_IN = /^\d+$/.test(EXPIRES_RAW) ? Number(EXPIRES_RAW) : EXPIRES_RAW;

// ---------- Base de datos ----------
const db = new Database(DB_PATH);
db.exec(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
);

// Consultas preparadas: los valores siempre van como parámetros, nunca concatenados al SQL
const findUserByName = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?");
const insertUser = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");

// Reglas de formato del registro (ver decisiones fijas en CLAUDE.md)
const USERNAME_REGEX = /^[A-Za-z0-9_]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // límite de bcrypt
const LOGIN_FIELD_MAX = 1000; // tope de tamaño en el login, sin aplicar las reglas de formato del registro

// Hash de relleno: si el usuario no existe se compara contra él igualmente,
// para que la respuesta tarde lo mismo y no revele qué usuarios existen.
const DUMMY_HASH = bcrypt.hashSync("dummy", BCRYPT_ROUNDS);
const INVALID_CREDENTIALS = { error: "Credenciales inválidas" };

// ---------- HTTP ----------
const app = express();

// Log de cada petición: solo fecha, método, ruta (sin query ni body) y status.
// Nunca se registran contraseñas, hashes, tokens ni cuerpos de peticiones.
// Va primero para que también queden registradas las peticiones que fallan al parsear el JSON.
app.use((req, res, next) => {
    res.on("finish", () => {
        const route = req.originalUrl.split("?")[0];
        console.log(`${new Date().toISOString()} ${req.method} ${route} ${res.statusCode}`);
    });
    next();
});

app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Registro de usuario: valida, guarda el hash bcrypt y responde 201 con userId (string) y username
app.post("/register", async (req, res) => {
    const { username: rawUsername, password } = req.body ?? {}; // Express 5 deja body undefined si no hay JSON

    if (typeof rawUsername !== "string" || typeof password !== "string") {
        return res.status(400).json({ error: "username y password son obligatorios y deben ser texto" });
    }

    const username = rawUsername.trim();
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_REGEX.test(username)) {
        return res
            .status(400)
            .json({ error: "username debe tener entre 3 y 30 caracteres y solo letras, números o guion bajo" });
    }

    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        return res.status(400).json({ error: "password debe tener entre 6 y 72 caracteres" });
    }

    if (findUserByName.get(username)) {
        return res.status(409).json({ error: "El nombre de usuario ya existe" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let info;
    try {
        info = insertUser.run(username, passwordHash);
    } catch (err) {
        // Condición de carrera: otro registro con el mismo nombre entró entre el SELECT y el INSERT
        if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({ error: "El nombre de usuario ya existe" });
        }
        throw err;
    }

    // Nunca se devuelve el hash
    res.status(201).json({ userId: String(info.lastInsertRowid), username });
});

// Inicio de sesión: si las credenciales son válidas responde 200 con un JWT { userId, username }
app.post("/login", async (req, res) => {
    const { username, password } = req.body ?? {};

    const validField = (v) => typeof v === "string" && v.length > 0 && v.length <= LOGIN_FIELD_MAX;
    if (!validField(username) || !validField(password)) {
        return res.status(400).json({ error: "username y password son obligatorios" });
    }

    const row = findUserByName.get(username);
    if (!row) {
        await bcrypt.compare(password, DUMMY_HASH); // mismo costo que con un usuario real
        return res.status(401).json(INVALID_CREDENTIALS);
    }

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json(INVALID_CREDENTIALS);

    // iat y exp los agrega jsonwebtoken
    const token = jwt.sign({ userId: String(row.id), username: row.username }, JWT_SECRET, {
        algorithm: "HS256",
        expiresIn: JWT_EXPIRES_IN,
    });

    res.status(200).json({ token, username: row.username });
});

// ---------- Errores ----------

// Cualquier ruta no definida
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// Manejador de errores central (Express 5 también envía aquí los errores de rutas async)
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "JSON inválido" });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ error: "Cuerpo demasiado grande" });
    }

    // Solo el mensaje: sin stack ni body, para no filtrar datos sensibles a los logs
    console.error(`Error interno: ${err.message}`);
    res.status(500).json({ error: "Error interno del servidor" });
});

// ---------- Arranque ----------
const server = app.listen(PORT, (err) => {
    if (err) {
        // p. ej. puerto ocupado
        console.error(`No se pudo iniciar el servidor: ${err.message}`);
        process.exit(1);
    }
    console.log(`Auth service en puerto ${PORT}`);
});

// ---------- Cierre ordenado ----------
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5 * 1000; // espera máxima antes de forzar la salida

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recibido, cerrando auth service...`);

    server.close(() => {
        db.close();
        console.log("Servidor HTTP y base de datos cerrados");
        process.exit(0);
    });

    // Si alguna conexión no se cierra a tiempo, se fuerza la salida
    setTimeout(() => {
        console.error("Cierre forzado por tiempo de espera");
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
