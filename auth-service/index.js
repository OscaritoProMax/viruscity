// Auth service (Taller 5): registro e inicio de sesión con usuario/contraseña y con Google.
// Ambas vías emiten el mismo JWT HS256 { userId, username, provider } y conviven en una sola tabla users.
// Taller 6: además es el directory service de los coordinadores (heartbeat, /coordinator, /peers, /directory).
// Taller 7: la configuración la valida config.js (también la de varios nodos con AUTH_NODES) y el archivo
// de entorno se elige con --env <ruta> (por defecto auth-service/.env). Cada auth es un nodo replicado
// (replication/node.js) unido a los demás por un mesh WebSocket en PEER_PORT (replication/mesh.js); sin
// AUTH_NODES es un clúster de uno que usa el mismo camino (líder desde el arranque, sin mesh).
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
const { createReplicationNode } = require("./replication/node.js");
const { createAuthMesh } = require("./replication/mesh.js");

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

const { port: PORT, dbPath: DB_PATH, jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN, bcryptRounds: BCRYPT_ROUNDS } = conf;
const { googleClientId: GOOGLE_CLIENT_ID, clusterSecret: CLUSTER_SECRET, coordinatorTtlMs: COORDINATOR_TTL_MS, reservationTtlMs: RESERVATION_TTL_MS } = conf;

// ---------- Base de datos ----------
const db = new DatabaseSync(DB_PATH);
ensureSchema(db, { dbPath: DB_PATH });

// ---------- Replicación (Taller 7) ----------
// Con varios nodos: mesh WebSocket con los demás auth (solo si hay AUTH_NODES); el nodo de replicación decide
// todo (elección, escrituras por mayoría, sync) y el mesh solo mueve mensajes. Una BD heredada sin oplog
// recibe sus entradas "legacy" (una por usuario) para poder replicarse.
const mesh = conf.multi
    ? createAuthMesh({ selfId: conf.authId, nodes: conf.nodes, peerPort: conf.peerPort, clusterSecret: CLUSTER_SECRET, pingMs: conf.tunables.AUTH_PEER_PING_MS, syncBatch: conf.tunables.SYNC_BATCH, log: console })
    : null;
const realClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };
// Registro: solo cambios de rol, término y líder (nunca datos de usuarios ni mensajes)
const replLog = { info: (text) => console.log(text), warn: (text) => console.warn(text) };
const replication = createReplicationNode({
    id: conf.authId,
    nodes: conf.nodes,
    cfg: conf.tunables,
    db,
    transport: mesh ? mesh.transport : { send() {}, connectedIds: () => [] },
    clock: realClock,
    log: replLog,
});
if (mesh) mesh.attach(replication);
if (replication.legacyEntries > 0) console.log(`[db] oplog inicial: ${replication.legacyEntries} entradas legacy creadas a partir de users`);

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
    replication,
});

const server = app.listen(PORT, (err) => {
    if (err) {
        // p. ej. puerto ocupado
        console.error(`No se pudo iniciar el servidor: ${err.message}`);
        process.exit(1);
    }
    const cluster = conf.multi ? `clúster de ${conf.nodes.length} (mayoría ${conf.majority}), mesh en ${conf.peerPort}` : "nodo único";
    console.log(`Auth service ${conf.authId} en puerto ${PORT} · ${cluster} · directorio de coordinadores (TTL ${COORDINATOR_TTL_MS} ms, reservas ${RESERVATION_TTL_MS} ms)`);
});

if (mesh) {
    mesh.start().catch((err) => {
        console.error(`No se pudo abrir el mesh en el puerto ${conf.peerPort}: ${err.code || err.message}`);
        process.exit(1);
    });
}

// ---------- Cierre ordenado ----------
// Sin desregistrarse ni transferir el liderazgo: los demás lo notan por el cierre de las conexiones y, si era
// el líder, eligen otro cuando vence su LEADER_TIMEOUT_MS.
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5 * 1000; // espera máxima antes de forzar la salida

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recibido, cerrando auth service...`);
    clearInterval(sweepTimer);
    replication.close();
    if (mesh) mesh.stop();
    server.closeAllConnections?.();

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
