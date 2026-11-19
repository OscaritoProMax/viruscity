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
