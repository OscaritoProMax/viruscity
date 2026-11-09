// El mapa que DIBUJA el cliente y la grilla de colisiones que USA el servidor deben ser el mismo.
// coordinator/map/virus-city.json se genera con client/scripts/export-map.mjs; si alguien cambia el
// trazado (public/js/play/map/layout.js) sin regenerarlo, esta prueba falla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildMapData } from "../public/js/play/map/map-data.js";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, WORLD_ROWS, WORLD_WIDTH, WORLD_HEIGHT, CITY_HEIGHT } from "../public/js/play/map/constants.js";

const SERVER_MAP = new URL("../../coordinator/map/virus-city.json", import.meta.url);
const data = buildMapData();

test("el trazado es determinista: dos generaciones dan la misma grilla", () => {
    assert.deepEqual(buildMapData(), data);
});

test("medidas del mapa: ciudad de 80 × 60 casillas de 48 y mundo de 80 × 80 con los interiores", () => {
    assert.equal(data.tile, TILE_SIZE);
    assert.equal(data.cols, MAP_COLS);
    assert.equal(data.rows, WORLD_ROWS);
    assert.equal(MAP_ROWS, 60);
    assert.equal(WORLD_WIDTH, 3840);
    assert.equal(WORLD_HEIGHT, 3840);
    assert.equal(CITY_HEIGHT, 2880);
    assert.equal(data.solid.length, WORLD_ROWS);
    assert.ok(data.solid.every((row) => row.length === MAP_COLS && /^[01]+$/.test(row)));
});

test("las casillas de aparición están libres y con sus 8 vecinas libres", () => {
    const solidAt = (c, r) => data.solid[r][c] === "1";
    assert.ok(data.spawns.length > 50, `solo ${data.spawns.length} casillas de aparición`);
    for (const [c, r] of data.spawns) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) assert.equal(solidAt(c + dc, r + dr), false, `aparición (${c}, ${r})`);
    }
});

test("coordinator/map/virus-city.json coincide con el trazado del cliente", { skip: !existsSync(SERVER_MAP) && "no está la carpeta del coordinator" }, () => {
    const server = JSON.parse(readFileSync(SERVER_MAP, "utf8"));
    assert.deepEqual(server, data, "regenera el archivo con: node scripts/export-map.mjs");
});
