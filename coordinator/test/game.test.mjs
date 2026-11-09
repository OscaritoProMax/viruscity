// Pruebas de la lógica pura del juego (game.js) con node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createConfig, parseMap, boxBlocked, portalAt, randomSpawn, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot } from "../game.js";

const cfg = createConfig({});
const R = cfg.PLAYER_RADIUS;

const player = (x, y, ix = 0, iy = 0) => ({ username: "p", provider: "local", socket: {}, x, y, intent: { x: ix, y: iy }, extras: {} });
const one = (p) => new Map([["1", p]]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("createConfig: valores por defecto de CLAUDE.md y errores claros", () => {
    assert.deepEqual(
        { ...cfg },
        { WORLD_WIDTH: 1200, WORLD_HEIGHT: 800, PLAYER_RADIUS: 16, PLAYER_SPEED: 200, TICK_RATE: 20, TICK_MS: 50, MAX_EXTRAS_BYTES: 1024, MAX_MSGS_PER_SEC: 60 }
    );
    assert.equal(createConfig({ TICK_RATE: "30", PLAYER_SPEED: "150.5" }).TICK_MS, 1000 / 30);
    for (const env of [{ TICK_RATE: "abc" }, { WORLD_WIDTH: "-5" }, { PLAYER_RADIUS: "1.5" }, { PLAYER_RADIUS: "500" }, { MAX_MSGS_PER_SEC: "0" }]) {
        assert.throws(() => createConfig(env), /debe|demasiado/, JSON.stringify(env));
    }
});

test("la diagonal avanza la misma distancia que un eje", () => {
    const dt = 0.05;
    const axis = player(600, 400, 1, 0);
    const diag = player(600, 400, 1, 1);
    const startA = { ...axis };
    const startD = { ...diag };
    stepPlayers(one(axis), dt, cfg);
    stepPlayers(one(diag), dt, cfg);
    const expected = cfg.PLAYER_SPEED * dt;
    assert.ok(Math.abs(dist(axis, startA) - expected) < 0.001);
    assert.ok(Math.abs(dist(diag, startD) - expected) < 0.001, `diagonal ${dist(diag, startD)}`);
});

test("dos pasos de dt/2 equivalen a uno de dt (no depende del tickrate)", () => {
    const a = player(500, 300, 1, -1);
    const b = player(500, 300, 1, -1);
    stepPlayers(one(a), 0.1, cfg);
    stepPlayers(one(b), 0.05, cfg);
    stepPlayers(one(b), 0.05, cfg);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
});

test("el jugador no sale del mundo en las 4 esquinas", () => {
    const cases = [
        [player(20, 20, -1, -1), R, R],
        [player(1180, 20, 1, -1), 1200 - R, R],
        [player(20, 780, -1, 1), R, 800 - R],
        [player(1180, 780, 1, 1), 1200 - R, 800 - R],
    ];
    for (const [p, ex, ey] of cases) {
        stepPlayers(one(p), 0.25, cfg);
        assert.equal(p.x, ex);
        assert.equal(p.y, ey);
    }
    // Una posición fuera del mundo también se corrige aunque no haya intención
    const outside = player(-50, 9999);
    stepPlayers(one(outside), 0.05, cfg);
    assert.deepEqual([outside.x, outside.y], [R, 800 - R]);
});

test("sanitizeIntent: signo de cada eje o null si es inválido", () => {
    const intent = (dir) => ({ type: "intent", intent: { dir } });
    assert.deepEqual(sanitizeIntent(intent({ x: 9999, y: -5 })), { x: 1, y: -1 });
    assert.deepEqual(sanitizeIntent(intent({ x: 0, y: 0 })), { x: 0, y: 0 });
    assert.deepEqual(sanitizeIntent(intent({ x: -0, y: 0.2 })), { x: 0, y: 1 });
    for (const bad of [
        intent({ x: "a", y: 0 }),
        intent({ x: NaN, y: 0 }),
        intent({ x: 0, y: Infinity }),
        intent([1, 0]),
        intent(null),
        { type: "intent", intent: {} },
        { type: "intent" },
        { type: "intent", intent: [1, 1] },
        null,
        "intent",
    ]) {
        assert.equal(sanitizeIntent(bad), null, JSON.stringify(bad));
    }
});

test("sanitizeExtras: acepta objetos válidos (color en minúsculas, copia) y rechaza el resto", () => {
    const original = { color: "#FF5500", hat: { kind: "gorra" } };
    const clean = sanitizeExtras({ extras: original }, cfg);
    assert.deepEqual(clean, { color: "#ff5500", hat: { kind: "gorra" } });
    assert.notEqual(clean, original);
    assert.notEqual(clean.hat, original.hat);
    assert.equal(original.color, "#FF5500", "no modifica el objeto recibido");
    assert.deepEqual(sanitizeExtras({ extras: {} }, cfg), {});

    for (const extras of [[1, 2], null, "rojo", 5, { color: "red" }, { color: "#12345" }, { color: 0xff5500 }, { pad: "x".repeat(1100) }]) {
        assert.equal(sanitizeExtras({ extras }, cfg), null, JSON.stringify(extras).slice(0, 40));
    }
    assert.equal(sanitizeExtras({}, cfg), null);
    // Justo en el límite de bytes: {"p":"…"} = 8 + n bytes
    assert.ok(sanitizeExtras({ extras: { p: "x".repeat(1016) } }, cfg));
    assert.equal(sanitizeExtras({ extras: { p: "x".repeat(1017) } }, cfg), null);
});

test("snapshot: sin socket ni intent, con provider y coordenadas redondeadas a 2 decimales", () => {
    const players = new Map([["7", { ...player(10.12345, 20.98765, 1, 0), username: "ana", provider: "google", extras: { color: "#ff5500" } }]]);
    const snap = snapshot(players);
    assert.deepEqual(snap, [{ userId: "7", username: "ana", provider: "google", x: 10.12, y: 20.99, extras: { color: "#ff5500" } }]);
    assert.ok(!("socket" in snap[0]) && !("intent" in snap[0]));
});

test("randomSpawn: siempre dentro del mundo (1000 muestras y extremos del azar)", () => {
    for (let i = 0; i < 1000; i++) {
        const { x, y } = randomSpawn(cfg);
        assert.ok(x >= R && x <= 1200 - R && y >= R && y <= 800 - R, `${x}, ${y}`);
    }
    assert.deepEqual(randomSpawn(cfg, () => 0), { x: R, y: R });
    const top = randomSpawn(cfg, () => 0.999999999);
    assert.ok(top.x <= 1200 - R && top.y <= 800 - R);
});

test("clampDt: milisegundos a segundos, acotado a [0, 0.25]", () => {
    assert.equal(clampDt(50), 0.05);
    assert.equal(clampDt(250), 0.25);
    assert.equal(clampDt(5000), 0.25);
    assert.equal(clampDt(0), 0);
    assert.equal(clampDt(-10), 0);
    assert.equal(clampDt(NaN), 0);
});

// ---------- Mapa y colisiones ----------
// Mapa de prueba de 6 × 5 casillas de 48 (el borde es sólido; "#" = sólido):
//   ######
//   #....#
//   #.#..#
//   #....#
//   ######
const tinyMap = () =>
    parseMap({ id: "mini", tile: 48, cols: 6, rows: 5, solid: ["111111", "100001", "101001", "100001", "111111"], spawns: [[1, 1], [4, 3]] });

test("parseMap: valida la forma del archivo y calcula el tamaño del mundo", () => {
    const map = tinyMap();
    assert.equal(map.width, 288);
    assert.equal(map.height, 240);
    assert.equal(map.solid[2 * 6 + 2], 1);
    const base = { id: "m", tile: 48, cols: 2, rows: 1, solid: ["01"], spawns: [[0, 0]] };
    for (const bad of [
        null,
        [],
        { ...base, id: "" },
        { ...base, tile: 0 },
        { ...base, solid: ["01", "00"] },
        { ...base, solid: ["0x"] },
        { ...base, solid: ["011"] },
        { ...base, spawns: [] },
        { ...base, spawns: [[1, 0]] }, // casilla sólida
        { ...base, spawns: [[5, 0]] }, // fuera del mapa
        { ...base, spawns: [[0.5, 0]] },
    ]) {
        assert.throws(() => parseMap(bad), /mapa inválido/, JSON.stringify(bad));
    }
});

test("createConfig con mapa: el mundo sale del mapa y se rechazan valores incompatibles", () => {
    const map = tinyMap();
    const c = createConfig({}, map);
    assert.equal(c.WORLD_WIDTH, 288);
    assert.equal(c.WORLD_HEIGHT, 240);
    assert.equal(createConfig({ WORLD_WIDTH: "288" }, map).WORLD_WIDTH, 288);
    assert.throws(() => createConfig({ WORLD_WIDTH: "1200" }, map), /no coincide con el mapa/);
    assert.throws(() => createConfig({ PLAYER_RADIUS: "24" }, map), /menor que 24/);
});

test("boxBlocked: tocar el borde de una casilla no es chocar; entrar en ella sí", () => {
    const map = tinyMap();
    // Casilla sólida (2,2) ocupa x 96..144, y 96..144. Caja de radio 16.
    assert.equal(boxBlocked(map, 80, 120, 16), false); // lado derecho en x = 96 (borde)
    assert.equal(boxBlocked(map, 80.01, 120, 16), true);
    assert.equal(boxBlocked(map, 160, 120, 16), false); // lado izquierdo en x = 144
    assert.equal(boxBlocked(map, 64, 64, 16), false);
    assert.equal(boxBlocked(map, 20, 100, 16), true); // toca el borde sólido del mapa
    assert.equal(boxBlocked(map, -100, -100, 16), true); // fuera del mapa
});

test("stepPlayers con mapa: se detiene justo en la pared y no la atraviesa ni con dt grande", () => {
    const map = tinyMap();
    const c = createConfig({ PLAYER_SPEED: "2000" }, map); // 500 px en un tick de 0,25 s
    const p = player(72, 120, 1, 0); // fila 2, a la izquierda de la casilla sólida (2,2)
    stepPlayers(one(p), 0.25, c, map);
    assert.equal(p.x, 96 - 16, "queda pegado al borde izquierdo de la pared");
    assert.equal(p.y, 120);
    stepPlayers(one(p), 0.25, c, map);
    assert.equal(p.x, 80, "sigue sin atravesarla");
});

test("stepPlayers con mapa: en diagonal contra una pared se desliza por el otro eje", () => {
    const map = tinyMap();
    const c = createConfig({}, map);
    const p = player(80, 120, 1, 1); // pegado a la pared por la izquierda, avanzando hacia abajo-derecha
    const startY = p.y;
    stepPlayers(one(p), 0.05, c, map);
    assert.equal(p.x, 80, "x no entra en la pared");
    assert.ok(p.y > startY, "y avanza");
});

test("stepPlayers con mapa: un pasillo de una casilla deja pasar a la caja del jugador", () => {
    // Pasillo vertical en la columna 1 entre paredes en las columnas 0 y 2
    const map = parseMap({ id: "pasillo", tile: 48, cols: 3, rows: 6, solid: ["111", "101", "101", "101", "101", "111"], spawns: [[1, 1]] });
    const c = createConfig({}, map);
    const p = player(72, 72, 0, 1);
    for (let i = 0; i < 40; i++) stepPlayers(one(p), 0.05, c, map);
    assert.equal(p.x, 72);
    assert.equal(p.y, 5 * 48 - 16, "llega al final del pasillo");
});

test("mapa real (coordinator/map/virus-city.json): aparición y paseo al azar nunca pisan casillas sólidas", () => {
    const map = parseMap(JSON.parse(readFileSync(new URL("../map/virus-city.json", import.meta.url), "utf8")));
    const c = createConfig({}, map);
    assert.equal(map.width, 3840);
    assert.equal(map.height, 3840, "ciudad (60 filas) + zona de interiores (20 filas)");
    assert.ok(map.portals.length >= 4, "entrada y salida de dos locales");
    // Azar con semilla fija para que la prueba sea reproducible
    let seed = 12345;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const dirs = [-1, 0, 1];
    for (let n = 0; n < 50; n++) {
        const p = player(0, 0);
        Object.assign(p, randomSpawn(c, rng, map));
        assert.equal(boxBlocked(map, p.x, p.y, c.PLAYER_RADIUS), false, "aparece en un lugar libre");
        for (let t = 0; t < 200; t++) {
            if (t % 10 === 0) p.intent = { x: dirs[Math.floor(rng() * 3)], y: dirs[Math.floor(rng() * 3)] };
            stepPlayers(one(p), 0.05 + rng() * 0.2, c, map);
            assert.equal(boxBlocked(map, p.x, p.y, c.PLAYER_RADIUS), false, `jugador ${n} dentro de una casilla sólida en (${p.x}, ${p.y})`);
        }
    }
});

test("parseMap: portales válidos y rechazo de destinos sólidos, fuera del mundo o encadenados", () => {
    const base = { id: "p", tile: 48, cols: 4, rows: 1, solid: ["0000"], spawns: [[0, 0]] };
    const map = parseMap({ ...base, portals: [{ c0: 3, r0: 0, c1: 3, r1: 0, x: 24, y: 24 }] });
    assert.deepEqual(portalAt(map, 3 * 48 + 10, 20), map.portals[0]);
    assert.equal(portalAt(map, 60, 20), null);
    assert.equal(parseMap(base).portals.length, 0, "sin portals es una lista vacía");
    for (const portals of [
        "no",
        [{ c0: 0, r0: 0, c1: 9, r1: 0, x: 24, y: 24 }], // fuera del mapa
        [{ c0: 3, r0: 0, c1: 3, r1: 0, x: 9999, y: 24 }], // destino fuera del mundo
        [{ c0: 3, r0: 0, c1: 3, r1: 0, x: 3 * 48 + 5, y: 24 }], // destino dentro del mismo portal
    ]) {
        assert.throws(() => parseMap({ ...base, portals }), /mapa inválido/, JSON.stringify(portals));
    }
    assert.throws(() => parseMap({ ...base, solid: ["1000"], spawns: [[1, 0]], portals: [{ c0: 3, r0: 0, c1: 3, r1: 0, x: 24, y: 24 }] }), /sólido/);
});

test("stepPlayers: al pisar un portal (puerta) el servidor traslada al jugador al destino", () => {
    // Pasillo horizontal; la casilla 5 es una puerta que lleva a (72, 168) en otra "habitación" (fila 3)
    const map = parseMap({
        id: "puerta", tile: 48, cols: 7, rows: 5,
        solid: ["1111111", "1000001", "1111111", "1000001", "1111111"],
        spawns: [[1, 1]],
        portals: [{ c0: 5, r0: 1, c1: 5, r1: 1, x: 72, y: 168 }],
    });
    const c = createConfig({}, map);
    const p = player(120, 72, 1, 0);
    for (let i = 0; i < 40 && p.y < 100; i++) stepPlayers(one(p), 0.05, c, map);
    assert.deepEqual([p.x, p.y], [72, 168], "aparece en el destino");
    // Sigue caminando dentro de la otra habitación sin volver a entrar al portal
    stepPlayers(one(p), 0.05, c, map);
    assert.equal(p.y, 168);
    assert.ok(p.x > 72);
});
