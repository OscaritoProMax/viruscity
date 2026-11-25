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
import { sceneAt } from "../public/js/play/map/scenes.js";

test("ciudad de la partida: 6 zonas y 12 estaciones con los ids y nombres del coordinador; va en virus-city.json", () => {
    const city = matchCity();
    assert.deepEqual(city.zones.map((z) => z.name), ["Hospital", "Laboratorio", "Farmacia", "Central de datos", "Planta de síntesis", "Almacén"]);
    assert.deepEqual(city.stations.map((s) => s.id), city.zones.flatMap((z) => [`${z.id}-1`, `${z.id}-2`]));
    assert.deepEqual(data.city, city, "buildMapData incluye la ciudad");
});

// Casillas alcanzables caminando desde (c, r) en el mundo completo, atravesando los portales (puertas de los locales)
function reachableWorld(c0, r0) {
    const cols = data.cols;
    const free = (c, r) => c >= 0 && r >= 0 && c < cols && r < data.rows && data.solid[r][c] === "0";
    const portalAt = new Map();
    for (const p of data.portals) for (let r = p.r0; r <= p.r1; r++) for (let c = p.c0; c <= p.c1; c++) portalAt.set(r * cols + c, [Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)]);
    const seen = new Set([r0 * cols + c0]);
    const queue = [[c0, r0]];
    while (queue.length) {
        const [c, r] = queue.pop();
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let nc = c + dc;
            let nr = r + dr;
            if (!free(nc, nr)) continue;
            const jump = portalAt.get(nr * cols + nc);
            if (jump) [nc, nr] = jump; // pisar la puerta lleva al otro lado
            const k = nr * cols + nc;
            if (seen.has(k)) continue;
            seen.add(k);
            queue.push([nc, nr]);
        }
    }
    return seen;
}

test("ciudad de la partida: cada estación está DENTRO de la sala de su zona, en casilla libre, y se llega desde la plaza entrando por la puerta", () => {
    const city = matchCity();
    const seen = reachableWorld(Math.floor(city.plaza.x / TILE_SIZE), Math.floor(city.plaza.y / TILE_SIZE));
    for (const s of city.stations) {
        const c = Math.floor(s.x / TILE_SIZE);
        const r = Math.floor(s.y / TILE_SIZE);
        const z = city.zones.find((zone) => zone.id === s.zoneId);
        const room = z.inside;
        assert.ok(s.x > room.x && s.x < room.x + room.w && s.y > room.y && s.y < room.y + room.h, `${s.id} dentro de la sala de ${z.id}`);
        assert.ok(r >= MAP_ROWS, `${s.id} en la zona de interiores`);
        // la caja del jugador (32 × 32) cabe parada en la estación
        for (const [dx, dy] of [[-16, -16], [15.9, -16], [-16, 15.9], [15.9, 15.9]]) assert.equal(data.solid[Math.floor((s.y + dy) / TILE_SIZE)][Math.floor((s.x + dx) / TILE_SIZE)], "0", `${s.id}: caja libre`);
        assert.ok(seen.has(r * data.cols + c), `${s.id} se puede alcanzar desde la plaza entrando al edificio`);
    }
    // y la sala de cada zona es la escena a la que lleva la puerta de su edificio
    for (const z of city.zones) assert.equal(sceneAt(z.inside.x + 10, z.inside.y + 10), z.id);
});

test("ciudad de la partida: cada zona contiene un edificio del mapa con su puerta, y las zonas no se superponen", () => {
    for (const z of MATCH_ZONES) {
        const b = buildingsList.find((bl) => bl.c >= z.c0 && bl.r >= z.r0 && bl.c + bl.spec.w - 1 <= z.c1 && bl.r + bl.spec.h - 1 <= z.r1);
        assert.ok(b, `la zona ${z.id} contiene un edificio`);
        assert.ok(b.doorRow < z.r1, `la puerta del edificio de ${z.id} da a la franja de su entrada`);
        assert.equal(b.spec.enter, z.id, `la puerta del edificio de ${z.id} lleva a su sala`);
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
