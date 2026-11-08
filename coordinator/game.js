// Lógica PURA del juego en vivo (Taller 5): sin sockets, sin DOM, sin red.
// El servidor es la autoridad: los clientes solo mandan intenciones y extras;
// aquí se sanean y se aplica el movimiento en cada tick.

const DEFAULTS = {
    WORLD_WIDTH: 1200,
    WORLD_HEIGHT: 800,
    PLAYER_RADIUS: 16,
    PLAYER_SPEED: 200, // px/s
    TICK_RATE: 20, // Hz
    MAX_EXTRAS_BYTES: 1024,
    MAX_MSGS_PER_SEC: 60,
};

const MAX_DT_S = 0.25; // un tick nunca avanza más de 0.25 s (p. ej. tras una pausa del proceso)
const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

// Lee un número de env (o el valor por defecto) y lo valida; lanza un Error claro si no sirve
function readNumber(env, key, { integer = true, min = 1, max = Infinity } = {}) {
    const raw = env[key];
    if (raw === undefined || raw === "") return DEFAULTS[key];
    const text = String(raw).trim();
    const value = Number(text);
    const valid = text !== "" && Number.isFinite(value) && (!integer || Number.isInteger(value)) && value >= min && value <= max;
    if (!valid) {
        const kind = integer ? "un entero" : "un número";
        throw new Error(`${key} debe ser ${kind} entre ${min} y ${max === Infinity ? "∞" : max} (recibido "${text}")`);
    }
    return value;
}

// Configuración del juego desde las variables de entorno (con los valores por defecto de CLAUDE.md)
function createConfig(env = {}) {
    const cfg = {
        WORLD_WIDTH: readNumber(env, "WORLD_WIDTH", { min: 100, max: 100000 }),
        WORLD_HEIGHT: readNumber(env, "WORLD_HEIGHT", { min: 100, max: 100000 }),
        PLAYER_RADIUS: readNumber(env, "PLAYER_RADIUS", { min: 1, max: 1000 }),
        PLAYER_SPEED: readNumber(env, "PLAYER_SPEED", { integer: false, min: 1, max: 100000 }),
        TICK_RATE: readNumber(env, "TICK_RATE", { min: 1, max: 120 }),
        MAX_EXTRAS_BYTES: readNumber(env, "MAX_EXTRAS_BYTES", { min: 2, max: 1024 * 1024 }),
        MAX_MSGS_PER_SEC: readNumber(env, "MAX_MSGS_PER_SEC", { min: 1, max: 10000 }),
    };
    if (cfg.PLAYER_RADIUS * 2 >= Math.min(cfg.WORLD_WIDTH, cfg.WORLD_HEIGHT)) {
        throw new Error("PLAYER_RADIUS es demasiado grande para el tamaño del mundo");
    }
    cfg.TICK_MS = 1000 / cfg.TICK_RATE;
    return cfg;
}

// Posición inicial al azar, siempre dentro del mundo (dejando el radio libre en cada borde)
function randomSpawn(cfg, rng = Math.random) {
    const r = cfg.PLAYER_RADIUS;
    return {
        x: r + rng() * (cfg.WORLD_WIDTH - 2 * r),
        y: r + rng() * (cfg.WORLD_HEIGHT - 2 * r),
    };
}

// { type:"intent", intent:{ dir:{ x, y } } } → { x, y } con -1/0/1, o null si es inválido
function sanitizeIntent(msg) {
    const dir = msg?.intent?.dir;
    if (!dir || typeof dir !== "object" || Array.isArray(dir)) return null;
    const { x, y } = dir;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    // Math.sign(-0) es -0: se normaliza a 0
    return { x: Math.sign(x) || 0, y: Math.sign(y) || 0 };
}

// { type:"extras_update", extras:{...} } → copia saneada o null si es inválido
function sanitizeExtras(msg, cfg) {
    const extras = msg?.extras;
    if (extras === null || typeof extras !== "object" || Array.isArray(extras)) return null;

    let json;
    try {
        json = JSON.stringify(extras);
    } catch {
        return null;
    }
    if (Buffer.byteLength(json, "utf8") > cfg.MAX_EXTRAS_BYTES) return null;

    const copy = JSON.parse(json); // copia profunda: el original del cliente no se guarda
    if (Object.prototype.hasOwnProperty.call(copy, "color")) {
        if (typeof copy.color !== "string" || !COLOR_REGEX.test(copy.color)) return null;
        copy.color = copy.color.toLowerCase();
    }
    return copy;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Aplica las intenciones: la diagonal se normaliza (misma velocidad que un eje)
// y cada jugador queda dentro del mundo
function stepPlayers(players, dt, cfg) {
    const r = cfg.PLAYER_RADIUS;
    for (const p of players.values()) {
        const ix = p.intent?.x ?? 0;
        const iy = p.intent?.y ?? 0;
        const mag = Math.hypot(ix, iy);
        if (mag > 0) {
            p.x += (ix / mag) * cfg.PLAYER_SPEED * dt;
            p.y += (iy / mag) * cfg.PLAYER_SPEED * dt;
        }
        p.x = clamp(p.x, r, cfg.WORLD_WIDTH - r);
        p.y = clamp(p.y, r, cfg.WORLD_HEIGHT - r);
    }
}

// Milisegundos entre ticks → segundos, acotados a [0, 0.25]
function clampDt(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.min(ms / 1000, MAX_DT_S);
}

const round2 = (n) => Math.round(n * 100) / 100;

// Estado público de los jugadores: nunca incluye socket ni intent.
// players es un Map userId → jugador.
function snapshot(players) {
    return [...players].map(([userId, p]) => ({
        userId,
        username: p.username,
        provider: p.provider,
        x: round2(p.x),
        y: round2(p.y),
        extras: p.extras ?? {},
    }));
}

module.exports = { DEFAULTS, createConfig, randomSpawn, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot };
