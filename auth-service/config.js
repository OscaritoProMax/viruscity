// Configuración del auth-service (Talleres 5, 6 y 7).
//
// loadConfig(env, { baseDir }) → configuración validada, o lanza un Error con un motivo claro (index.js lo
// convierte en exit(1)). No lee archivos .env: eso lo hace index.js (con --env <ruta> o el .env de la carpeta).
// parseAuthNodes(text) → [{ id, publicUrl, peerUrl }] a partir de "id|publicUrl|peerUrl,id|publicUrl|peerUrl"
// envFileArg(argv) → ruta pasada con --env (o --env=ruta), "" si falta el valor, null si no se usó
//
// Taller 7 (decisión 1): cada nodo tiene AUTH_ID, PORT (HTTP), PEER_PORT (mesh WS), PUBLIC_URL, PEER_URL y
// AUTH_NODES con TODOS los nodos (incluido él). Sin AUTH_NODES es un clúster de uno ("auth-solo").

const path = require("node:path");

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const URL_MAX = 200;
const SECRET_MIN = 32;
const MAX_NODES = 9;
const GOOGLE_ID_SUFFIX = ".apps.googleusercontent.com";
const DEFAULT_PORT = 4000;
const SOLO_ID = "auth-solo";

// Parámetros del clúster de auth (decisión "Config del auth"): valor por defecto y mínimo
const TUNABLES = {
    AUTH_HEARTBEAT_MS: { def: 2000, min: 50 },
    LEADER_TIMEOUT_MS: { def: 6000, min: 150 },
    ELECTION_JITTER_MS: { def: 1500, min: 0 },
    READ_TOLERANCE: { def: 10, min: 1 },
    WRITE_TIMEOUT_MS: { def: 3000, min: 100 },
    ACK_GRACE_MS: { def: 150, min: 0 },
    SYNC_BATCH: { def: 500, min: 1, max: 5000 },
    AUTH_PEER_PING_MS: { def: 3000, min: 100 },
};

const trimSlash = (url) => url.replace(/\/+$/, "");

// Entero >= min (y <= max si se da); vacío o ausente → valor por defecto
function readInt(env, key, def, min, max = Number.MAX_SAFE_INTEGER) {
    const raw = String(env[key] ?? "").trim();
    if (raw === "") return def;
    if (!/^\d+$/.test(raw)) throw new Error(`${key} debe ser un número entero`);
    const value = Number(raw);
    if (value < min) throw new Error(`${key} debe ser mayor o igual a ${min}`);
    if (value > max) throw new Error(`${key} no puede ser mayor que ${max}`);
    return value;
}

function readPort(env, key, def = null) {
    const raw = String(env[key] ?? "").trim();
    if (raw === "") {
        if (def === null) throw new Error(`${key} es obligatorio y debe ser un entero entre 1 y 65535`);
        return def;
    }
    if (!/^\d+$/.test(raw)) throw new Error(`${key} debe ser un número de puerto válido`);
    const value = Number(raw);
    if (value < 1 || value > 65535) throw new Error(`${key} debe ser un número de puerto válido`);
    return value;
}

// URL con uno de los protocolos dados, sin barras finales
function checkUrl(name, raw, protocols) {
    const text = String(raw ?? "").trim();
    const list = protocols.map((p) => `${p}//`).join(" o ");
    let url;
    try {
        url = new URL(text);
    } catch {
        throw new Error(`${name} no es una URL válida`);
    }
    if (!protocols.includes(url.protocol)) throw new Error(`${name} debe empezar por ${list}`);
    const clean = trimSlash(text);
    if (clean.length > URL_MAX) throw new Error(`${name} no puede tener más de ${URL_MAX} caracteres`);
    return clean;
}

function readSecret(env, key, hint) {
    const value = env[key];
    if (!value) throw new Error(`${key} es obligatorio${hint ? ` (${hint})` : ""}`);
    if (value.length < SECRET_MIN) throw new Error(`${key} debe tener al menos ${SECRET_MIN} caracteres`);
    return value;
}

// "id|publicUrl|peerUrl,..." → lista normalizada. Lanza con el número de la entrada que esté mal.
function parseAuthNodes(text) {
    const raw = String(text ?? "").trim();
    if (raw === "") return [];
    const entries = raw.split(",").map((e) => e.trim());
    return entries.map((entry, i) => {
        const where = `AUTH_NODES, entrada ${i + 1}`;
        const parts = entry.split("|").map((p) => p.trim());
        if (parts.length !== 3 || parts.some((p) => p === "")) throw new Error(`${where}: debe tener la forma id|publicUrl|peerUrl`);
        const [id, publicUrl, peerUrl] = parts;
        if (!ID_REGEX.test(id)) throw new Error(`${where}: el id debe tener de 1 a 32 letras, números, guiones o guiones bajos`);
        return { id, publicUrl: checkUrl(`${where} (publicUrl)`, publicUrl, ["http:", "https:"]), peerUrl: checkUrl(`${where} (peerUrl)`, peerUrl, ["ws:", "wss:"]) };
    });
}

function loadConfig(env, { baseDir = __dirname } = {}) {
    // ---------- Nodos del clúster (Taller 7) ----------
    const nodes = parseAuthNodes(env.AUTH_NODES);
    if (nodes.length > MAX_NODES) throw new Error(`AUTH_NODES admite como máximo ${MAX_NODES} nodos`);
    const ids = new Set();
    for (const n of nodes) {
        if (ids.has(n.id)) throw new Error(`AUTH_NODES tiene el id repetido "${n.id}"`);
        ids.add(n.id);
    }
    for (const key of ["publicUrl", "peerUrl"]) {
        const seen = new Set(nodes.map((n) => n[key]));
        if (seen.size !== nodes.length) throw new Error(`AUTH_NODES tiene una ${key} repetida`);
    }

    const rawId = String(env.AUTH_ID ?? "").trim();
    if (nodes.length > 0 && rawId === "") throw new Error("AUTH_ID es obligatorio cuando hay AUTH_NODES");
    const authId = rawId === "" ? SOLO_ID : rawId;
    if (!ID_REGEX.test(authId)) throw new Error("AUTH_ID debe tener de 1 a 32 letras, números, guiones o guiones bajos");

    const multi = nodes.length > 1;
    const port = readPort(env, "PORT", DEFAULT_PORT);
    const peerPortRaw = String(env.PEER_PORT ?? "").trim();
    if (multi && peerPortRaw === "") throw new Error("PEER_PORT es obligatorio con más de un nodo en AUTH_NODES");
    const peerPort = peerPortRaw === "" ? null : readPort(env, "PEER_PORT");
    if (peerPort !== null && peerPort === port) throw new Error("PORT y PEER_PORT deben ser distintos");

    const publicUrl = String(env.PUBLIC_URL ?? "").trim() === "" ? `http://localhost:${port}` : checkUrl("PUBLIC_URL", env.PUBLIC_URL, ["http:", "https:"]);
    let peerUrl = null;
    if (String(env.PEER_URL ?? "").trim() !== "") peerUrl = checkUrl("PEER_URL", env.PEER_URL, ["ws:", "wss:"]);
    else if (peerPort !== null) peerUrl = `ws://localhost:${peerPort}`;

    // El propio nodo debe estar en AUTH_NODES con las mismas URLs (las usan los demás para hablarle)
    if (nodes.length > 0) {
        const self = nodes.find((n) => n.id === authId);
        if (!self) throw new Error(`AUTH_ID "${authId}" no aparece en AUTH_NODES`);
        if (self.publicUrl !== publicUrl) throw new Error(`la publicUrl de "${authId}" en AUTH_NODES no coincide con PUBLIC_URL (${publicUrl})`);
        if (self.peerUrl !== peerUrl) throw new Error(`la peerUrl de "${authId}" en AUTH_NODES no coincide con PEER_URL (${peerUrl ?? "sin PEER_PORT"})`);
    }
    const allNodes = nodes.length > 0 ? nodes : [{ id: authId, publicUrl, peerUrl }];

    // ---------- Validaciones de los Talleres 5 y 6 ----------
    const jwtSecret = readSecret(env, "JWT_SECRET");
    const roundsRaw = String(env.BCRYPT_ROUNDS ?? "10").trim() || "10";
    if (!/^\d+$/.test(roundsRaw)) throw new Error("BCRYPT_ROUNDS debe ser un número entero");
    const bcryptRounds = Number(roundsRaw);
    if (bcryptRounds < 10) throw new Error("BCRYPT_ROUNDS debe ser mayor o igual a 10");
    if (bcryptRounds > 31) throw new Error("BCRYPT_ROUNDS no puede ser mayor que 31 (límite de bcrypt)");

    const googleClientId = env.GOOGLE_CLIENT_ID;
    if (!googleClientId) throw new Error("GOOGLE_CLIENT_ID es obligatorio");
    if (!googleClientId.endsWith(GOOGLE_ID_SUFFIX)) throw new Error(`GOOGLE_CLIENT_ID debe terminar en "${GOOGLE_ID_SUFFIX}"`);
    const clusterSecret = readSecret(env, "CLUSTER_SECRET", "secreto compartido con los coordinadores y los otros auth");

    const ttlRaw = String(env.COORDINATOR_TTL_MS ?? "6000").trim() || "6000";
    if (!/^\d+$/.test(ttlRaw) || Number(ttlRaw) < 1000) throw new Error("COORDINATOR_TTL_MS debe ser un entero mayor o igual a 1000 (milisegundos)");
    const resRaw = String(env.RESERVATION_TTL_MS ?? "3000").trim() || "3000";
    if (!/^\d+$/.test(resRaw)) throw new Error("RESERVATION_TTL_MS debe ser un entero mayor o igual a 0 (milisegundos; 0 desactiva las reservas)");

    // ---------- Parámetros del clúster de auth ----------
    const tunables = {};
    for (const [key, { def, min, max }] of Object.entries(TUNABLES)) tunables[key] = readInt(env, key, def, min, max);
    if (tunables.LEADER_TIMEOUT_MS < 3 * tunables.AUTH_HEARTBEAT_MS) {
        throw new Error("LEADER_TIMEOUT_MS debe ser al menos 3 veces AUTH_HEARTBEAT_MS");
    }

    const warnings = [];
    if (googleClientId.includes("localtest")) warnings.push("GOOGLE_CLIENT_ID es de prueba: el login con Google no funcionará hasta poner el real");

    return {
        authId,
        port,
        peerPort,
        publicUrl,
        peerUrl,
        nodes: allNodes,
        multi,
        majority: Math.floor(allNodes.length / 2) + 1,
        dbPath: path.resolve(baseDir, env.DB_PATH || "./users.db"), // relativo a la carpeta del servicio
        jwtSecret,
        jwtExpiresIn: env.JWT_EXPIRES_IN || "1h",
        bcryptRounds,
        googleClientId,
        clusterSecret,
        coordinatorTtlMs: Number(ttlRaw),
        reservationTtlMs: Number(resRaw),
        tunables,
        warnings,
    };
}

function envFileArg(argv = process.argv) {
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--env") return argv[i + 1] ?? "";
        if (argv[i].startsWith("--env=")) return argv[i].slice("--env=".length);
    }
    return null;
}

module.exports = { loadConfig, parseAuthNodes, envFileArg, TUNABLES, ID_REGEX, SOLO_ID, MAX_NODES };
