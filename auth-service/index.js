// Auth service (Taller 5): registro e inicio de sesión con usuario/contraseña y con Google.
// Ambas vías emiten el mismo JWT HS256 { userId, username, provider } y conviven en una sola tabla users.
// Taller 6: además es el directory service de los coordinadores (heartbeat, /coordinator, /peers, /directory).
//
// Este archivo solo arranca: valida la configuración, abre la base (node:sqlite), aplica el esquema o la
// migración del Taller 4 y levanta la app de app.js. Configuración en .env (ver .env.example).

require("dotenv").config({ quiet: true }); // quiet: evita que dotenv imprima su propio mensaje en consola

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { OAuth2Client } = require("google-auth-library");
const { ensureSchema } = require("./db.js");
const { makeGoogleVerifier } = require("./google.js");
const { createApp } = require("./app.js");

// ---------- Configuración ----------

// Detiene el proceso con un motivo claro si la configuración no es válida
function fatal(reason) {
    console.error(`Error de configuración: ${reason}`);
    process.exit(1);
}

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "./users.db"); // relativo a la carpeta del servicio
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
const ROUNDS_RAW = process.env.BCRYPT_ROUNDS || "10";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_ID_SUFFIX = ".apps.googleusercontent.com";
// Directory service (Taller 6)
const CLUSTER_SECRET = process.env.CLUSTER_SECRET;
const TTL_RAW = process.env.COORDINATOR_TTL_MS || "6000";
const RESERVATION_RAW = process.env.RESERVATION_TTL_MS || "3000";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fatal("PORT debe ser un número de puerto válido");

if (!JWT_SECRET) fatal("JWT_SECRET es obligatorio");
if (JWT_SECRET.length < 32) fatal("JWT_SECRET debe tener al menos 32 caracteres");

if (!/^\d+$/.test(ROUNDS_RAW)) fatal("BCRYPT_ROUNDS debe ser un número entero");
const BCRYPT_ROUNDS = Number(ROUNDS_RAW);
if (BCRYPT_ROUNDS < 10) fatal("BCRYPT_ROUNDS debe ser mayor o igual a 10");
if (BCRYPT_ROUNDS > 31) fatal("BCRYPT_ROUNDS no puede ser mayor que 31 (límite de bcrypt)");

if (!GOOGLE_CLIENT_ID) fatal("GOOGLE_CLIENT_ID es obligatorio");
if (!GOOGLE_CLIENT_ID.endsWith(GOOGLE_ID_SUFFIX)) fatal(`GOOGLE_CLIENT_ID debe terminar en "${GOOGLE_ID_SUFFIX}"`);
if (!CLUSTER_SECRET) fatal("CLUSTER_SECRET es obligatorio (secreto compartido con los coordinadores)");
if (CLUSTER_SECRET.length < 32) fatal("CLUSTER_SECRET debe tener al menos 32 caracteres");
if (!/^\d+$/.test(TTL_RAW) || Number(TTL_RAW) < 1000) fatal("COORDINATOR_TTL_MS debe ser un entero mayor o igual a 1000 (milisegundos)");
const COORDINATOR_TTL_MS = Number(TTL_RAW);
if (!/^\d+$/.test(RESERVATION_RAW)) fatal("RESERVATION_TTL_MS debe ser un entero mayor o igual a 0 (milisegundos; 0 desactiva las reservas)");
const RESERVATION_TTL_MS = Number(RESERVATION_RAW);

if (GOOGLE_CLIENT_ID.includes("localtest")) {
    console.warn("Advertencia: GOOGLE_CLIENT_ID es de prueba: el login con Google no funcionará hasta poner el real");
}

// ---------- Base de datos ----------
const db = new DatabaseSync(DB_PATH);
ensureSchema(db, { dbPath: DB_PATH });

// ---------- App ----------
// El Client ID es público; el Client Secret no se usa ni se guarda
const verifyGoogle = makeGoogleVerifier(new OAuth2Client(GOOGLE_CLIENT_ID), GOOGLE_CLIENT_ID);

const app = createApp({
    db,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
    bcryptRounds: BCRYPT_ROUNDS,
    verifyGoogle,
});

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
