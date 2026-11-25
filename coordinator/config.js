// Configuración de una instancia del coordinador (Taller 6, decisión 7).
//
// loadConfig(env, { baseDir }) → configuración validada, o lanza un Error con un motivo claro
// (index.js lo convierte en exit(1)). No lee archivos .env: eso lo hace index.js con --env.
//
// Cada instancia tiene su id, su puerto para clientes (PORT) y su puerto para el mesh (PEER_PORT),
// la URL que usan los CLIENTES (PUBLIC_URL) y la que usan los otros coordinadores (PEER_URL).
// Las variables del juego del Taller 5 se validan con createConfig/parseMap de game.js, y las del balance
// de la partida de Viruscity con readMatchConfig (se agregan al mismo objeto game).

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

// Partida de Viruscity (balance/pruebas): valor por defecto y mínimo de cada clave. Todas son enteros.
//   - tiempos y duraciones: >= 0 (0 sirve para pruebas: p. ej. sin bloqueo inicial);
//   - periodos de temporizadores (replicación, tick y vista de la partida): >= 1 (0 haría un bucle sin pausa);
//   - rangos de infección y de misión: > 0; la tolerancia puede ser 0;
//   - MIN_PLAYERS_TO_START: >= 2 (hace falta un infectado y al menos un sano).
const MATCH_SETTINGS = {
    MIN_PLAYERS_TO_START: { def: 3, min: 2, unit: "jugadores" },
    MATCH_COUNTDOWN_MS: { def: 10000, min: 0 },
    INITIAL_LOCK_MS: { def: 60000, min: 0 },
    INFECT_COOLDOWN_MS: { def: 120000, min: 0 },
    NEW_INFECTED_LOCK_MS: { def: 180000, min: 0 },
    MATCH_DURATION_MS: { def: 900000, min: 0 },
    RESULTS_MS: { def: 15000, min: 0 },
    RECONNECT_GRACE_MS: { def: 60000, min: 0 },
    MISSION_MIN_MS: { def: 8000, min: 0 },
    MISSION_MAX_MS: { def: 45000, min: 0 },
    INFECT_RANGE: { def: 70, min: 1, unit: "px" },
    MISSION_RANGE: { def: 60, min: 1, unit: "px" },
    RANGE_TOLERANCE: { def: 25, min: 0, unit: "px" },
    MATCH_REPLICATE_MS: { def: 250, min: 1 },
    GAME_TICK_MS: { def: 200, min: 1 },
    GAME_VIEW_MS: { def: 250, min: 1 },
    GAME_SYNC_WAIT_MS: { def: 1500, min: 0 },
};
const MATCH_DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(MATCH_SETTINGS).map(([k, s]) => [k, s.def])));

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

// AUTH_URLS (Taller 7, decisión 16): lista de URLs http/https del clúster de auth separadas por comas, sin barra
// final y sin repetidas. Si solo existe AUTH_URL (Talleres 5 y 6), es una lista de una.
function readAuthUrls(env) {
    const listRaw = String(env.AUTH_URLS ?? "").trim();
    const key = listRaw ? "AUTH_URLS" : "AUTH_URL";
    const raw = listRaw || String(env.AUTH_URL ?? "").trim();
    if (!raw) throw new Error("AUTH_URLS es obligatorio: una o más URLs http:// o https:// del auth-service separadas por comas");
    const urls = raw.split(",").map((part, i) => {
        const value = part.trim();
        if (!value) throw new Error(`${key}: la entrada ${i + 1} está vacía`);
        return readUrl({ [key]: value }, key, ["http:", "https:"]);
    });
    if (new Set(urls).size !== urls.length) throw new Error(`${key} tiene una URL repetida`);
    return urls;
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

// Configuración de la partida de Viruscity (ver MATCH_SETTINGS). Lanza un Error con el motivo si algo no vale.
function readMatchConfig(env = {}) {
    const cfg = {};
    for (const [key, { def, min, unit = "milisegundos" }] of Object.entries(MATCH_SETTINGS)) {
        const raw = env[key];
        if (raw === undefined || String(raw).trim() === "") {
            cfg[key] = def;
            continue;
        }
        const text = String(raw).trim();
        if (!/^\d+$/.test(text) || Number(text) < min || !Number.isSafeInteger(Number(text))) {
            throw new Error(`${key} debe ser un entero mayor o igual a ${min} (${unit})`);
        }
        cfg[key] = Number(text);
    }
    if (cfg.MISSION_MIN_MS > cfg.MISSION_MAX_MS) throw new Error("MISSION_MIN_MS no puede ser mayor que MISSION_MAX_MS");
    return cfg;
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

// Persistencia del estado (track 2.1 del examen final): base node:sqlite PROPIA de cada coordinador.
//   STATE_DB_PATH: ruta relativa a baseDir; vacío = state-<COORDINATOR_ID>.db; "off" la desactiva (pruebas)
//   PERSIST_MS: cada cuánto se guarda; PERSIST_MAX_AGE_MS: lo guardado hace más que esto se descarta
const PERSIST = { PERSIST_MS: { def: 2000, min: 100 }, PERSIST_MAX_AGE_MS: { def: 600000, min: 1000 } };
function readPersist(env, baseDir, coordinatorId) {
    const raw = String(env.STATE_DB_PATH ?? "").trim();
    const off = raw.toLowerCase() === "off";
    return {
        dbPath: off ? null : path.resolve(baseDir, raw || `state-${coordinatorId}.db`),
        everyMs: readInt(env, "PERSIST_MS", PERSIST.PERSIST_MS.def, PERSIST.PERSIST_MS.min),
        maxAgeMs: readInt(env, "PERSIST_MAX_AGE_MS", PERSIST.PERSIST_MAX_AGE_MS.def, PERSIST.PERSIST_MAX_AGE_MS.min),
    };
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
    const authUrls = readAuthUrls(env);

    const jwtSecret = readSecret(env, "JWT_SECRET");
    const clusterSecret = readSecret(env, "CLUSTER_SECRET");

    const timings = {};
    for (const [key, def] of Object.entries(TIMINGS)) timings[key] = readInt(env, key, def, TIMING_MIN);
    const clientHeartbeatMs = readInt(env, "HEARTBEAT_INTERVAL_MS", CLIENT_HEARTBEAT_DEFAULT, 1);

    // Juego (Taller 5): mapa y mundo, velocidad, tick y límites de mensajes; más el balance de la
    // partida de Viruscity, en el mismo objeto para que el reducer reciba un solo cfg
    const map = readMap(env, baseDir);
    const game = { ...createConfig(env, map), ...readMatchConfig(env) };

    return {
        coordinatorId,
        port,
        peerPort,
        publicUrl,
        peerUrl,
        authUrls,
        authUrl: authUrls[0], // compatibilidad (Talleres 5 y 6)
        jwtSecret,
        clusterSecret,
        clientHeartbeatMs,
        heartbeatAuthMs: timings.HEARTBEAT_AUTH_MS,
        peerDiscoveryMs: timings.PEER_DISCOVERY_MS,
        peerPingMs: timings.PEER_PING_MS,
        peerSyncMs: timings.PEER_SYNC_MS,
        map,
        game,
        persist: readPersist(env, baseDir, coordinatorId),
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

module.exports = { loadConfig, envFileArg, readAuthUrls, readMatchConfig, MATCH_DEFAULTS, ID_REGEX };
