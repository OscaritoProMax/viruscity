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

// ---------- HTTP ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: "10kb" }));

// Log de cada petición: solo fecha, método, ruta (sin query ni body) y status.
// Nunca se registran contraseñas, hashes, tokens ni cuerpos de peticiones.
app.use((req, res, next) => {
    res.on("finish", () => {
        const route = req.originalUrl.split("?")[0];
        console.log(`${new Date().toISOString()} ${req.method} ${route} ${res.statusCode}`);
    });
    next();
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

const server = app.listen(PORT, (err) => {
    if (err) {
        // p. ej. puerto ocupado
        console.error(`No se pudo iniciar el servidor: ${err.message}`);
        process.exit(1);
    }
    console.log(`Auth service en puerto ${PORT}`);
});
