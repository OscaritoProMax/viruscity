// Pruebas de la lógica pura del juego (game.js) con node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfig, randomSpawn, sanitizeIntent, sanitizeExtras, stepPlayers, clampDt, snapshot } from "../game.js";

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
