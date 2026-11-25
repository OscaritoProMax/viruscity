// Pruebas de la configuración de balance de la partida de Viruscity (config.js: readMatchConfig y loadConfig).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readMatchConfig, loadConfig, MATCH_DEFAULTS } = require("../config.js");

const EXPECTED = {
    MIN_PLAYERS_TO_START: 3,
    MATCH_COUNTDOWN_MS: 10000,
    INITIAL_LOCK_MS: 60000,
    INFECT_COOLDOWN_MS: 120000,
    NEW_INFECTED_LOCK_MS: 180000,
    MATCH_DURATION_MS: 900000,
    RESULTS_MS: 15000,
    RECONNECT_GRACE_MS: 60000,
    MISSION_MIN_MS: 8000,
    MISSION_MAX_MS: 45000,
    INFECT_RANGE: 70,
    MISSION_RANGE: 60,
    RANGE_TOLERANCE: 25,
    MATCH_REPLICATE_MS: 250,
    GAME_TICK_MS: 200,
    GAME_VIEW_MS: 250,
    GAME_SYNC_WAIT_MS: 1500,
};

const baseEnv = (changes = {}) => ({
    COORDINATOR_ID: "coord-a",
    PORT: "5001",
    PEER_PORT: "5101",
    PUBLIC_URL: "ws://localhost:5001",
    PEER_URL: "ws://localhost:5101",
    AUTH_URL: "http://localhost:4000",
    JWT_SECRET: "s".repeat(40),
    CLUSTER_SECRET: "c".repeat(64),
    MAP_FILE: "",
    ...changes,
});

test("readMatchConfig: sin variables usa los valores por defecto de la metodología", () => {
    assert.deepEqual(readMatchConfig({}), EXPECTED);
    assert.deepEqual({ ...MATCH_DEFAULTS }, EXPECTED);
    // Vacíos o con espacios cuentan como no definidos
    assert.deepEqual(readMatchConfig({ MIN_PLAYERS_TO_START: "", INFECT_RANGE: "  " }), EXPECTED);
});

test("readMatchConfig: acepta sobreescrituras (tiempos reducidos para pruebas)", () => {
    const cfg = readMatchConfig({
        MIN_PLAYERS_TO_START: "2",
        MATCH_COUNTDOWN_MS: "0",
        INITIAL_LOCK_MS: "0",
        MISSION_MIN_MS: "100",
        MISSION_MAX_MS: "100",
        RANGE_TOLERANCE: "0",
        GAME_TICK_MS: " 50 ",
    });
    assert.equal(cfg.MIN_PLAYERS_TO_START, 2);
    assert.equal(cfg.MATCH_COUNTDOWN_MS, 0);
    assert.equal(cfg.INITIAL_LOCK_MS, 0);
    assert.equal(cfg.MISSION_MIN_MS, 100);
    assert.equal(cfg.MISSION_MAX_MS, 100);
    assert.equal(cfg.RANGE_TOLERANCE, 0);
    assert.equal(cfg.GAME_TICK_MS, 50);
    assert.equal(cfg.INFECT_RANGE, 70, "lo no indicado conserva su valor por defecto");
});

test("readMatchConfig: rechaza valores inválidos con un motivo que nombra la variable", () => {
    const bad = [
        ["MIN_PLAYERS_TO_START", "1"],
        ["MIN_PLAYERS_TO_START", "0"],
        ["MATCH_COUNTDOWN_MS", "-1"],
        ["MATCH_DURATION_MS", "1.5"],
        ["RESULTS_MS", "abc"],
        ["RECONNECT_GRACE_MS", "1e3"],
        ["INFECT_RANGE", "0"],
        ["MISSION_RANGE", "0"],
        ["RANGE_TOLERANCE", "-5"],
        ["MATCH_REPLICATE_MS", "0"],
        ["GAME_TICK_MS", "0"],
        ["GAME_VIEW_MS", "0"],
        ["GAME_SYNC_WAIT_MS", "x"],
        ["INFECT_COOLDOWN_MS", "99999999999999999999"],
    ];
    for (const [key, value] of bad) {
        assert.throws(() => readMatchConfig({ [key]: value }), new RegExp(key), `${key}=${value}`);
    }
    assert.throws(() => readMatchConfig({ MISSION_MIN_MS: "50000" }), /MISSION_MIN_MS no puede ser mayor que MISSION_MAX_MS/);
});

test("loadConfig: el balance de la partida viaja en conf.game junto al juego del Taller 5", () => {
    const conf = loadConfig(baseEnv());
    for (const [key, value] of Object.entries(EXPECTED)) assert.equal(conf.game[key], value, key);
    assert.equal(conf.game.TICK_RATE, 20, "las claves del Taller 5 siguen ahí");
    assert.equal(loadConfig(baseEnv({ MIN_PLAYERS_TO_START: "4" })).game.MIN_PLAYERS_TO_START, 4);
    assert.throws(() => loadConfig(baseEnv({ GAME_VIEW_MS: "0" })), /GAME_VIEW_MS/);
});

test("las plantillas .env*.example traen todas las claves con sus valores por defecto", () => {
    for (const file of [".env.example", ".env.coord-a.example", ".env.coord-b.example", ".env.coord-c.example"]) {
        const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
        for (const [key, value] of Object.entries(EXPECTED)) {
            assert.match(text, new RegExp(`^${key}=${value}\\r?$`, "m"), `${file}: ${key}`);
        }
    }
});
