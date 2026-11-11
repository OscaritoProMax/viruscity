// Configuración de una instancia del coordinador (Taller 6, decisión 7).
//
// loadConfig(env, { baseDir }) → configuración validada, o lanza un Error con un motivo claro
// (index.js lo convierte en exit(1)). No lee archivos .env: eso lo hace index.js con --env.
//
// Cada instancia tiene su id, su puerto para clientes (PORT) y su puerto para el mesh (PEER_PORT),
// la URL que usan los CLIENTES (PUBLIC_URL) y la que usan los otros coordinadores (PEER_URL).
// Las variables del juego del Taller 5 se validan con createConfig/parseMap de game.js.

const fs = require("node:fs");
const path = require("node:path");
const { createConfig, parseMap } = require("./game.js");

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const URL_MAX = 200; // el directorio del auth rechaza URLs más largas
const SECRET_MIN = 32;

// Tiempos del clúster (ms): valor por defecto y mínimo
const TIMINGS = {
    HEARTBEAT_AUTH_MS: 2000, // heartbeat HTTP al auth (no confundir con HEARTBEAT_INTERVAL_MS de los clientes)
    PEER_DISCOVERY_MS: 3000,
    PEER_PING_MS: 3000,
    PEER_SYNC_MS: 1000,
};
const TIMING_MIN = 100;
const CLIENT_HEARTBEAT_DEFAULT = 30000; // ping WS a los clientes (Taller 4)

function readPort(env, key) {
    const raw = String(env[key] ?? "").trim();
    if (!/^\d+$/.test(raw)) throw new Error(`${key} es obligatorio y debe ser un entero entre 1 y 65535`);
    const value = Number(raw);
    if (value < 1 || value > 65535) throw new Error(`${key} debe ser un entero entre 1 y 65535`);
    return value;
}

// URL obligatoria con uno de los protocolos dados; devuelve el texto sin barras finales
function readUrl(env, key, protocols) {
    const raw = String(env[key] ?? "").trim();
    const list = protocols.map((p) => `${p}//`).join(" o ");
    if (!raw) throw new Error(`${key} es obligatorio (${list})`);
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${key} no es una URL válida`);
    }
    if (!protocols.includes(url.protocol)) throw new Error(`${key} debe empezar por ${list}`);
    const clean = raw.replace(/\/+$/, "");
    if (clean.length > URL_MAX) throw new Error(`${key} no puede tener más de ${URL_MAX} caracteres`);
    return clean;
}

function readSecret(env, key) {
    const value = env[key];
    if (!value) throw new Error(`${key} es obligatorio`);
    if (value.length < SECRET_MIN) throw new Error(`${key} debe tener al menos ${SECRET_MIN} caracteres`);
    return value;
}

function readInt(env, key, defaultValue, min) {
    const raw = env[key];
    if (raw === undefined || String(raw).trim() === "") return defaultValue;
    const text = String(raw).trim();
    if (!/^\d+$/.test(text) || Number(text) < min) throw new Error(`${key} debe ser un entero mayor o igual a ${min} (milisegundos)`);
    return Number(text);
}

// Mapa opcional (MAP_FILE, relativo a baseDir) validado con parseMap
function readMap(env, baseDir) {
    const file = String(env.MAP_FILE ?? "").trim();
    if (!file) return null;
    const mapPath = path.resolve(baseDir, file);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    } catch {
        throw new Error(`no se pudo leer MAP_FILE como JSON (${mapPath})`);
    }
    return parseMap(data);
}

function loadConfig(env = process.env, { baseDir = __dirname } = {}) {
    const coordinatorId = String(env.COORDINATOR_ID ?? "").trim();
    if (!ID_REGEX.test(coordinatorId)) {
        throw new Error("COORDINATOR_ID es obligatorio: de 1 a 32 caracteres, letras, números, guion o guion bajo");
    }

    const port = readPort(env, "PORT");
    const peerPort = readPort(env, "PEER_PORT");
    if (port === peerPort) throw new Error("PORT (clientes) y PEER_PORT (mesh) deben ser distintos");

    const publicUrl = readUrl(env, "PUBLIC_URL", ["ws:", "wss:"]);
    const peerUrl = readUrl(env, "PEER_URL", ["ws:", "wss:"]);
    const authUrl = readUrl(env, "AUTH_URL", ["http:", "https:"]);

    const jwtSecret = readSecret(env, "JWT_SECRET");
    const clusterSecret = readSecret(env, "CLUSTER_SECRET");

    const timings = {};
    for (const [key, def] of Object.entries(TIMINGS)) timings[key] = readInt(env, key, def, TIMING_MIN);
    const clientHeartbeatMs = readInt(env, "HEARTBEAT_INTERVAL_MS", CLIENT_HEARTBEAT_DEFAULT, 1);

    // Juego (Taller 5): mapa y mundo, velocidad, tick y límites de mensajes
    const map = readMap(env, baseDir);
    const game = createConfig(env, map);

    return {
        coordinatorId,
        port,
        peerPort,
        publicUrl,
        peerUrl,
        authUrl,
        jwtSecret,
        clusterSecret,
        clientHeartbeatMs,
        heartbeatAuthMs: timings.HEARTBEAT_AUTH_MS,
        peerDiscoveryMs: timings.PEER_DISCOVERY_MS,
        peerPingMs: timings.PEER_PING_MS,
        peerSyncMs: timings.PEER_SYNC_MS,
        map,
        game,
    };
}

// Busca "--env <ruta>" (o "--env=<ruta>") en los argumentos; null si no está, "" si falta la ruta
function envFileArg(argv = process.argv) {
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--env") return argv[i + 1] ?? "";
        if (argv[i].startsWith("--env=")) return argv[i].slice("--env=".length);
    }
    return null;
}

module.exports = { loadConfig, envFileArg, ID_REGEX };
