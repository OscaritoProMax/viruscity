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

// Configuración del juego desde las variables de entorno (con los valores por defecto de CLAUDE.md).
// Con un mapa (parseMap), el tamaño del mundo sale del mapa: WORLD_WIDTH/HEIGHT, si se definen, deben coincidir.
function createConfig(env = {}, map = null) {
    const cfg = {
        WORLD_WIDTH: readNumber(env, "WORLD_WIDTH", { min: 100, max: 100000 }),
        WORLD_HEIGHT: readNumber(env, "WORLD_HEIGHT", { min: 100, max: 100000 }),
        PLAYER_RADIUS: readNumber(env, "PLAYER_RADIUS", { min: 1, max: 1000 }),
        PLAYER_SPEED: readNumber(env, "PLAYER_SPEED", { integer: false, min: 1, max: 100000 }),
        TICK_RATE: readNumber(env, "TICK_RATE", { min: 1, max: 120 }),
        MAX_EXTRAS_BYTES: readNumber(env, "MAX_EXTRAS_BYTES", { min: 2, max: 1024 * 1024 }),
        MAX_MSGS_PER_SEC: readNumber(env, "MAX_MSGS_PER_SEC", { min: 1, max: 10000 }),
    };
    if (map) {
        for (const [key, size] of [["WORLD_WIDTH", map.width], ["WORLD_HEIGHT", map.height]]) {
            if (env[key] !== undefined && env[key] !== "" && cfg[key] !== size) {
                throw new Error(`${key} (${cfg[key]}) no coincide con el mapa "${map.id}" (${size}); bórralo del .env o pon ${size}`);
            }
            cfg[key] = size;
        }
        // La caja del jugador (2·radio) debe caber en un pasillo de una casilla
        if (cfg.PLAYER_RADIUS * 2 >= map.tile) {
            throw new Error(`PLAYER_RADIUS debe ser menor que ${map.tile / 2} con el mapa "${map.id}" (casillas de ${map.tile})`);
        }
    }
    if (cfg.PLAYER_RADIUS * 2 >= Math.min(cfg.WORLD_WIDTH, cfg.WORLD_HEIGHT)) {
        throw new Error("PLAYER_RADIUS es demasiado grande para el tamaño del mundo");
    }
    cfg.TICK_MS = 1000 / cfg.TICK_RATE;
    return cfg;
}

// ---------- Mapa (colisiones) ----------
// Formato del archivo (lo genera client/scripts/export-map.mjs desde el mismo trazado que dibuja el cliente):
// { id, tile, cols, rows, solid: [rows strings de cols caracteres "0"/"1"], spawns: [[col, row], ...],
//   portals?: [{ c0, r0, c1, r1, x, y }] }
// Un portal es un rectángulo de casillas (puerta de un local o su salida): si el centro del jugador
// entra en él, el servidor lo traslada a (x, y). Así se entra y se sale de los interiores.
function parseMap(data) {
    const fail = (reason) => {
        throw new Error(`mapa inválido: ${reason}`);
    };
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("se esperaba un objeto JSON");
    const { id, tile, cols, rows, solid, spawns } = data;
    if (typeof id !== "string" || id === "") fail("falta id");
    for (const [name, value, max] of [["tile", tile, 1024], ["cols", cols, 1000], ["rows", rows, 1000]]) {
        if (!Number.isInteger(value) || value < 1 || value > max) fail(`${name} debe ser un entero entre 1 y ${max}`);
    }
    if (!Array.isArray(solid) || solid.length !== rows) fail(`solid debe tener ${rows} filas`);
    const grid = new Uint8Array(cols * rows);
    solid.forEach((line, r) => {
        if (typeof line !== "string" || !new RegExp(`^[01]{${cols}}$`).test(line)) fail(`la fila ${r} de solid debe tener ${cols} caracteres 0/1`);
        for (let c = 0; c < cols; c++) grid[r * cols + c] = line.charCodeAt(c) === 49 ? 1 : 0;
    });
    if (!Array.isArray(spawns) || spawns.length === 0) fail("spawns debe ser una lista no vacía");
    for (const s of spawns) {
        const ok = Array.isArray(s) && s.length === 2 && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[0] >= 0 && s[0] < cols && s[1] >= 0 && s[1] < rows;
        if (!ok || grid[s[1] * cols + s[0]]) fail(`spawn ${JSON.stringify(s)} fuera del mapa o en una casilla sólida`);
    }
    const list = data.portals === undefined ? [] : data.portals;
    if (!Array.isArray(list)) fail("portals debe ser una lista");
    const portalIndex = new Int16Array(cols * rows).fill(-1);
    const portals = list.map((p, i) => {
        const ints = p && ["c0", "r0", "c1", "r1"].every((k) => Number.isInteger(p[k]));
        if (!ints || p.c0 < 0 || p.r0 < 0 || p.c1 >= cols || p.r1 >= rows || p.c0 > p.c1 || p.r0 > p.r1) fail(`portal ${i} fuera del mapa`);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= cols * tile || p.y >= rows * tile) fail(`destino del portal ${i} fuera del mundo`);
        for (let r = p.r0; r <= p.r1; r++) for (let c = p.c0; c <= p.c1; c++) portalIndex[r * cols + c] = i;
        return { c0: p.c0, r0: p.r0, c1: p.c1, r1: p.r1, x: p.x, y: p.y };
    });
    // El destino debe ser una casilla libre y fuera de cualquier portal (si no, rebotaría sin parar)
    portals.forEach((p, i) => {
        const at = Math.floor(p.y / tile) * cols + Math.floor(p.x / tile);
        if (grid[at] || portalIndex[at] !== -1) fail(`el destino del portal ${i} es sólido o es otro portal`);
    });
    return { id, tile, cols, rows, width: cols * tile, height: rows * tile, solid: grid, spawns: spawns.map(([c, r]) => [c, r]), portals, portalIndex };
}

// ¿La caja del jugador [x-r, x+r] × [y-r, y+r] toca alguna casilla sólida? Fuera del mapa cuenta como sólido.
// Intervalos semiabiertos: tocar el borde de una casilla no es chocar.
function boxBlocked(map, x, y, r) {
    const T = map.tile;
    const c0 = Math.floor((x - r) / T);
    const c1 = Math.ceil((x + r) / T) - 1;
    const r0 = Math.floor((y - r) / T);
    const r1 = Math.ceil((y + r) / T) - 1;
    for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
            if (col < 0 || row < 0 || col >= map.cols || row >= map.rows || map.solid[row * map.cols + col]) return true;
        }
    }
    return false;
}

// Portal en el que está el centro del jugador, o null
function portalAt(map, x, y) {
    if (!map.portalIndex) return null;
    const c = Math.floor(x / map.tile);
    const r = Math.floor(y / map.tile);
    if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return null;
    const i = map.portalIndex[r * map.cols + c];
    return i >= 0 ? map.portals[i] : null;
}

// Posición inicial al azar. Sin mapa: cualquier punto del mundo (dejando el radio libre en cada borde).
// Con mapa: el centro de una casilla de aparición, con un pequeño desplazamiento que no sale de la casilla.
function randomSpawn(cfg, rng = Math.random, map = null) {
    const r = cfg.PLAYER_RADIUS;
    if (map) {
        const [col, row] = map.spawns[Math.min(map.spawns.length - 1, Math.floor(rng() * map.spawns.length))];
        const jitter = map.tile / 2 - r; // margen libre dentro de la casilla
        return {
            x: (col + 0.5) * map.tile + (rng() * 2 - 1) * jitter,
            y: (row + 0.5) * map.tile + (rng() * 2 - 1) * jitter,
        };
    }
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

// Mueve un eje ("x" o "y") con colisión contra el mapa. Si la caja choca, se pega al borde de la casilla
// que la frena (el avance de un tick, como mucho 0,25 s · velocidad, se revisa casilla por casilla).
function moveAxis(p, axis, delta, r, map) {
    if (delta === 0) return;
    const T = map.tile;
    // Pasos de como mucho media casilla: a gran velocidad tampoco se atraviesan paredes de una casilla
    const steps = Math.ceil(Math.abs(delta) / (T / 2));
    const step = delta / steps;
    for (let i = 0; i < steps; i++) {
        const next = p[axis] + step;
        const x = axis === "x" ? next : p.x;
        const y = axis === "y" ? next : p.y;
        if (!boxBlocked(map, x, y, r)) {
            p[axis] = next;
            continue;
        }
        // Borde de la casilla que frena: el lado de la caja queda justo en el límite
        const edge = step > 0 ? Math.ceil((next + r) / T) - 1 : Math.floor((next - r) / T);
        const snapped = step > 0 ? edge * T - r : (edge + 1) * T + r;
        const sx = axis === "x" ? snapped : p.x;
        const sy = axis === "y" ? snapped : p.y;
        // Solo se acepta si acerca al jugador sin meterlo en otra casilla sólida
        if ((snapped - p[axis]) * step >= 0 && !boxBlocked(map, sx, sy, r)) p[axis] = snapped;
        return;
    }
}

// Aplica las intenciones: la diagonal se normaliza (misma velocidad que un eje)
// y cada jugador queda dentro del mundo. Con mapa, además no atraviesa casillas sólidas
// (se mueve un eje a la vez: al chocar en diagonal se desliza por la pared).
function stepPlayers(players, dt, cfg, map = null) {
    const r = cfg.PLAYER_RADIUS;
    for (const p of players.values()) {
        const ix = p.intent?.x ?? 0;
        const iy = p.intent?.y ?? 0;
        const mag = Math.hypot(ix, iy);
        const dx = mag > 0 ? (ix / mag) * cfg.PLAYER_SPEED * dt : 0;
        const dy = mag > 0 ? (iy / mag) * cfg.PLAYER_SPEED * dt : 0;
        if (map) {
            moveAxis(p, "x", dx, r, map);
            moveAxis(p, "y", dy, r, map);
            // Puerta de un local (o su salida): el servidor traslada al jugador al otro lado
            const portal = portalAt(map, p.x, p.y);
            if (portal) {
                p.x = portal.x;
                p.y = portal.y;
            }
        } else {
            p.x += dx;
            p.y += dy;
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

module.exports = { DEFAULTS, createConfig, parseMap, boxBlocked, portalAt, randomSpawn, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot };
