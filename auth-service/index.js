// Auth service (Taller 5): registro e inicio de sesión con usuario/contraseña y con Google.
// Ambas vías emiten el mismo JWT HS256 { userId, username, provider } y conviven en una sola tabla users.
// Taller 6: además es el directory service de los coordinadores (heartbeat, /coordinator, /peers, /directory).
// Taller 7: la configuración la valida config.js (también la de varios nodos con AUTH_NODES) y el archivo
// de entorno se elige con --env <ruta> (por defecto auth-service/.env).
//
// Este archivo solo arranca: valida la configuración, abre la base (node:sqlite), aplica el esquema o la
// migración del Taller 4 y levanta la app de app.js.

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { DatabaseSync } = require("node:sqlite");
const { OAuth2Client } = require("google-auth-library");
const { ensureSchema } = require("./db.js");
const { makeGoogleVerifier } = require("./google.js");
const { createApp } = require("./app.js");
const { createDirectory } = require("./directory.js");
const { loadConfig, envFileArg } = require("./config.js");

// ---------- Configuración ----------

// Detiene el proceso con un motivo claro si la configuración no es válida
function fatal(reason) {
    console.error(`Error de configuración: ${reason}`);
    process.exit(1);
}

// Archivo de entorno: --env <ruta> (relativa a la carpeta desde donde se lanza) o auth-service/.env.
// dotenv no pisa las variables que ya existen en el entorno (las pruebas y los smokes pueden inyectarlas).
const envArg = envFileArg(process.argv);
if (envArg !== null) {
    if (!envArg) fatal("--env necesita la ruta de un archivo (por ejemplo --env .env.auth-a)");
    const envPath = path.resolve(process.cwd(), envArg);
    if (!fs.existsSync(envPath)) fatal(`no existe el archivo de entorno ${envPath}`);
    dotenv.config({ path: envPath, quiet: true }); // quiet: evita que dotenv imprima su propio mensaje
} else {
    dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });
}

let conf;
try {
    conf = loadConfig(process.env, { baseDir: __dirname });
} catch (err) {
    fatal(err.message);
}
for (const warning of conf.warnings) console.warn(`Advertencia: ${warning}`);

// Fase N1: la configuración de varios nodos ya se valida, pero la replicación entre ellos todavía no
// existe. Arrancar varios nodos sueltos crearía bases distintas que aceptan escrituras a la vez.
if (conf.multi) {
    fatal(`la configuración de ${conf.nodes.length} nodos es válida (mayoría ${conf.majority}), pero la replicación entre auth todavía no está implementada: usa npm start (nodo único)`);
}

const { port: PORT, dbPath: DB_PATH, jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN, bcryptRounds: BCRYPT_ROUNDS } = conf;
const { googleClientId: GOOGLE_CLIENT_ID, clusterSecret: CLUSTER_SECRET, coordinatorTtlMs: COORDINATOR_TTL_MS, reservationTtlMs: RESERVATION_TTL_MS } = conf;

// ---------- Base de datos ----------
const db = new DatabaseSync(DB_PATH);
ensureSchema(db, { dbPath: DB_PATH });

// ---------- App ----------
// El Client ID es público; el Client Secret no se usa ni se guarda
const verifyGoogle = makeGoogleVerifier(new OAuth2Client(GOOGLE_CLIENT_ID), GOOGLE_CLIENT_ID);

// Directorio de coordinadores en memoria (Taller 6): se pierde si el auth se reinicia y los
// coordinadores vuelven a registrarse con su siguiente heartbeat
const SWEEP_EVERY_MS = 2 * 1000;
const directory = createDirectory({ ttlMs: COORDINATOR_TTL_MS, reservationTtlMs: RESERVATION_TTL_MS });
const sweepTimer = setInterval(() => directory.sweep(), SWEEP_EVERY_MS);
sweepTimer.unref(); // el barrido no mantiene vivo el proceso

const app = createApp({
    db,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
    bcryptRounds: BCRYPT_ROUNDS,
    verifyGoogle,
    directory,
    clusterSecret: CLUSTER_SECRET,
});

const server = app.listen(PORT, (err) => {
    if (err) {
        // p. ej. puerto ocupado
        console.error(`No se pudo iniciar el servidor: ${err.message}`);
        process.exit(1);
    }
    console.log(`Auth service ${conf.authId} en puerto ${PORT} · directorio de coordinadores (TTL ${COORDINATOR_TTL_MS} ms, reservas ${RESERVATION_TTL_MS} ms)`);
});

// ---------- Cierre ordenado ----------
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5 * 1000; // espera máxima antes de forzar la salida

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recibido, cerrando auth service...`);
    clearInterval(sweepTimer);

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
