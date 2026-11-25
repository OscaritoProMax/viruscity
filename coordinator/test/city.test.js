// Pruebas de la ciudad de Viruscity (city.js): zonas, estaciones de misión, plaza y zona más cercana.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildCity, zoneNear } = require("../city.js");

const WORLDS = [
    { width: 1200, height: 800 },
    { width: 1600, height: 900 },
];
const MARGIN = 16;
const inside = (p, z) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

for (const world of WORLDS) {
    const label = `${world.width}×${world.height}`;

    test(`buildCity ${label}: 6 zonas y 12 estaciones con ids únicos`, () => {
        const city = buildCity(world);
        assert.equal(city.zones.length, 6);
        assert.equal(city.stations.length, 12);
        assert.deepEqual(city.zones.map((z) => z.name), ["Hospital", "Laboratorio", "Farmacia", "Central de datos", "Planta de síntesis", "Almacén"]);
        assert.equal(new Set(city.zones.map((z) => z.id)).size, 6);
        assert.equal(new Set(city.stations.map((s) => s.id)).size, 12);
        for (const z of city.zones) {
            const own = city.stations.filter((s) => s.zoneId === z.id).map((s) => s.id);
            assert.deepEqual(own, [`${z.id}-1`, `${z.id}-2`], `dos estaciones para ${z.id}`);
        }
    });

    test(`buildCity ${label}: zonas escaladas y estaciones dentro del mundo y fuera de los edificios`, () => {
        const city = buildCity(world);
        const hospital = city.zones[0];
        assert.ok(Math.abs(hospital.x - 0.083 * world.width) < 0.01 && Math.abs(hospital.h - 0.1875 * world.height) < 0.01);
        for (const z of city.zones) {
            assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= world.width && z.y + z.h <= world.height, `zona ${z.id} dentro del mundo`);
        }
        for (const s of city.stations) {
            assert.ok(s.x >= MARGIN && s.x <= world.width - MARGIN, `${s.id}: x=${s.x} con margen`);
            assert.ok(s.y >= MARGIN && s.y <= world.height - MARGIN, `${s.id}: y=${s.y} con margen`);
            for (const z of city.zones) assert.ok(!inside(s, z), `${s.id} no está dentro de ${z.id}`);
        }
    });

    test(`buildCity ${label}: posición exacta de las estaciones y la plaza en el centro`, () => {
        const city = buildCity(world);
        const lab1 = city.stations.find((s) => s.id === "laboratorio-1");
        assert.ok(Math.abs(lab1.x - (0.425 + 0.175 * 0.25) * world.width) < 0.01);
        assert.ok(Math.abs(lab1.y - (0.125 - 0.06) * world.height) < 0.01, "fila superior: por encima del edificio");
        const alm2 = city.stations.find((s) => s.id === "almacen-2");
        assert.ok(Math.abs(alm2.x - (0.725 + 0.167 * 0.75) * world.width) < 0.01);
        assert.ok(Math.abs(alm2.y - (0.625 + 0.1875 + 0.06) * world.height) < 0.01, "fila inferior: por debajo del edificio");
        assert.deepEqual(city.plaza, { x: world.width / 2, y: world.height / 2 });
    });

    test(`zoneNear ${label}: cada zona desde su centro y desde sus estaciones; la plaza`, () => {
        const city = buildCity(world);
        for (const z of city.zones) {
            assert.equal(zoneNear(city, z.x + z.w / 2, z.y + z.h / 2), z.name);
            for (const s of city.stations.filter((st) => st.zoneId === z.id)) assert.equal(zoneNear(city, s.x, s.y), z.name, s.id);
        }
        // El centro del mundo está más cerca del centro de la Planta de síntesis (fila inferior, columna central)
        assert.equal(zoneNear(city, city.plaza.x, city.plaza.y), "Planta de síntesis");
    });
}

test("buildCity rechaza un mundo sin tamaño; zoneNear sin zonas devuelve null", () => {
    assert.throws(() => buildCity({ width: 0, height: 800 }), /width y height/);
    assert.throws(() => buildCity(null), /width y height/);
    assert.equal(zoneNear({ zones: [] }, 0, 0), null);
});

// ---------- Ciudad sobre el mapa de Virus City (MAP_FILE) ----------
const { parseMap, boxBlocked } = require("../game.js");
const { MISSIONS } = require("../missions.js");
const { plazaSpawns } = require("../match.js");
const MAP_JSON = require("../map/virus-city.json");
const PLAYER_RADIUS = 16;
const clone = (v) => JSON.parse(JSON.stringify(v));

test("mapa real: buildCity usa la ciudad del mapa (mismas zonas y orden; una estación por misión)", () => {
    const map = parseMap(MAP_JSON);
    const city = buildCity({ width: map.width, height: map.height }, map);
    assert.deepEqual(city, map.city, "la ciudad es la del mapa");
    assert.deepEqual(city.zones.map((z) => z.name), ["Hospital", "Laboratorio", "Farmacia", "Central de datos", "Planta de síntesis", "Almacén"]);
    assert.deepEqual(city.stations.map((s) => s.id).sort(), MISSIONS.map((m) => m.stationId).sort());
    city.zones[0].x = -1; // es una copia: modificarla no toca el mapa
    assert.notEqual(map.city.zones[0].x, -1);
});

test("mapa real: cada estación está en una casilla libre, DENTRO de la sala de su zona, y la alerta nombra esa zona", () => {
    const map = parseMap(MAP_JSON);
    const city = buildCity({ width: map.width, height: map.height }, map);
    for (const s of city.stations) {
        assert.equal(boxBlocked(map, s.x, s.y, PLAYER_RADIUS), false, `${s.id}: el jugador cabe parado en la estación`);
        const z = city.zones.find((zone) => zone.id === s.zoneId);
        assert.ok(z.inside && inside(s, z.inside), `${s.id} dentro de la sala de ${z.id}`);
        assert.ok(!inside(s, z), `${s.id} no está en la calle (se entra al edificio)`);
        assert.equal(zoneNear(city, s.x, s.y), z.name, `${s.id}: alerta de contagio con la zona correcta`);
    }
});

test("mapa real: la plaza deja libre el círculo de aparición para cualquier roster (1 a 12 jugadores)", () => {
    const map = parseMap(MAP_JSON);
    const city = buildCity({ width: map.width, height: map.height }, map);
    for (let n = 1; n <= 12; n++) {
        const roster = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { username: `j${i + 1}` }]));
        for (const [userId, p] of Object.entries(plazaSpawns({ roster }, city))) {
            assert.equal(boxBlocked(map, p.x, p.y, PLAYER_RADIUS), false, `roster ${n}: el jugador ${userId} aparece en (${p.x}, ${p.y}) libre`);
        }
    }
});

test("mapa: parseMap rechaza una ciudad inválida y buildCity una que no coincide con las misiones", () => {
    const bad = (mutate) => {
        const data = clone(MAP_JSON);
        mutate(data.city);
        return data;
    };
    assert.throws(() => parseMap(bad((c) => (c.stations[0].x = 0))), /estación hospital-1 .*sólida/, "estación sobre el bosque del borde");
    assert.throws(() => parseMap(bad((c) => (c.stations[1].zoneId = "otra"))), /zona desconocida/);
    assert.throws(() => parseMap(bad((c) => (c.plaza = { x: 99999, y: 10 }))), /plaza/);
    assert.throws(() => parseMap(bad((c) => (c.zones[2].w = 1e6))), /fuera del mundo/);
    assert.throws(() => parseMap(bad((c) => (c.zones[3].inside = { x: 0, y: 0, w: 1e6, h: 10 }))), /inside fuera del mundo/);
    assert.throws(() => parseMap(bad((c) => (c.zones[1].id = c.zones[0].id))), /repetido/);
    assert.throws(() => parseMap(bad((c) => (c.zones = "x"))), /city.zones/);
    const map = parseMap(bad((c) => c.zones.reverse()));
    assert.throws(() => buildCity({ width: map.width, height: map.height }, map), /zonas/);
    const missing = parseMap(bad((c) => c.stations.pop()));
    assert.throws(() => buildCity({ width: missing.width, height: missing.height }, missing), /estaciones/);
    const noCity = clone(MAP_JSON);
    delete noCity.city;
    assert.equal(parseMap(noCity).city, null, "un mapa sin ciudad sigue siendo válido (se usa la ciudad normalizada)");
});

test("zoneNear: dentro de una sala gana su zona aunque el centro de otra esté más cerca", () => {
    const city = {
        zones: [
            { id: "a", name: "Zona A", x: 0, y: 0, w: 100, h: 100, inside: { x: 1000, y: 1000, w: 100, h: 100 } },
            { id: "b", name: "Zona B", x: 900, y: 900, w: 100, h: 100 },
        ],
    };
    assert.equal(zoneNear(city, 1050, 1050), "Zona A", "dentro de la sala de A");
    assert.equal(zoneNear(city, 960, 960), "Zona B", "fuera de cualquier sala: la más cercana");
    assert.equal(zoneNear(city, 1100, 1050), "Zona B", "el borde derecho de la sala ya no es la sala");
});
