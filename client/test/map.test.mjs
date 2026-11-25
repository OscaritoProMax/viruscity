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

// ---------- Viruscity: la partida se juega en el mapa (match-places.js) ----------
import { matchCity, MATCH_ZONES } from "../public/js/play/map/match-places.js";
import { buildingsList, reachable, idx } from "../public/js/play/map/layout.js";
import { areaName } from "../public/js/play/map/zones.js";

test("ciudad de la partida: 6 zonas y 12 estaciones con los ids y nombres del coordinador; va en virus-city.json", () => {
    const city = matchCity();
    assert.deepEqual(city.zones.map((z) => z.name), ["Hospital", "Laboratorio", "Farmacia", "Central de datos", "Planta de síntesis", "Almacén"]);
    assert.deepEqual(city.stations.map((s) => s.id), city.zones.flatMap((z) => [`${z.id}-1`, `${z.id}-2`]));
    assert.deepEqual(data.city, city, "buildMapData incluye la ciudad");
});

test("ciudad de la partida: cada estación en una casilla libre de la ciudad, dentro de su zona y alcanzable desde la plaza", () => {
    const city = matchCity();
    const plazaC = Math.floor(city.plaza.x / TILE_SIZE);
    const plazaR = Math.floor(city.plaza.y / TILE_SIZE);
    const seen = reachable(plazaC, plazaR);
    for (const s of city.stations) {
        const c = Math.floor(s.x / TILE_SIZE);
        const r = Math.floor(s.y / TILE_SIZE);
        assert.ok(r < MAP_ROWS, `${s.id} en la ciudad (no en los interiores)`);
        assert.equal(data.solid[r][c], "0", `${s.id} en casilla libre`);
        assert.ok(seen[idx(c, r)], `${s.id} se puede alcanzar caminando desde la plaza`);
        const z = city.zones.find((zone) => zone.id === s.zoneId);
        assert.ok(s.x > z.x && s.x < z.x + z.w && s.y > z.y && s.y < z.y + z.h, `${s.id} dentro de su zona`);
    }
});

test("ciudad de la partida: cada zona contiene un edificio del mapa con su puerta, y las zonas no se superponen", () => {
    for (const z of MATCH_ZONES) {
        const b = buildingsList.find((bl) => bl.c >= z.c0 && bl.r >= z.r0 && bl.c + bl.spec.w - 1 <= z.c1 && bl.r + bl.spec.h - 1 <= z.r1);
        assert.ok(b, `la zona ${z.id} contiene un edificio`);
        assert.ok(b.doorRow < z.r1, `la puerta del edificio de ${z.id} da a la franja de sus estaciones`);
        assert.ok(areaName((b.c + 1) * TILE_SIZE, (b.r + 1) * TILE_SIZE).length > 0);
    }
    for (const a of MATCH_ZONES) for (const b of MATCH_ZONES) {
        if (a === b) continue;
        const overlap = a.c0 <= b.c1 && b.c0 <= a.c1 && a.r0 <= b.r1 && b.r0 <= a.r1;
        assert.equal(overlap, false, `${a.id} y ${b.id} no se superponen`);
    }
});

test("ciudad de la partida: el círculo de aparición (radio 80) de la plaza no pisa casillas sólidas", () => {
    const { plaza } = matchCity();
    const R = 16;
    const solidAt = (x, y) => data.solid[Math.floor(y / TILE_SIZE)][Math.floor(x / TILE_SIZE)] === "1";
    for (let a = 0; a < 360; a += 2) {
        const t = (a * Math.PI) / 180;
        const x = plaza.x + 80 * Math.cos(t);
        const y = plaza.y + 80 * Math.sin(t);
        for (const [dx, dy] of [[-R, -R], [R - 0.01, -R], [-R, R - 0.01], [R - 0.01, R - 0.01]]) assert.equal(solidAt(x + dx, y + dy), false, `ángulo ${a}°`);
    }
    assert.equal(areaName(plaza.x, plaza.y), "Plaza Mayor");
});
