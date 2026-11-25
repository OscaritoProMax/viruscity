// Pruebas del catálogo de misiones de Viruscity (missions.js).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MISSIONS, KINDS, pickMissions } = require("../missions.js");
const { buildCity } = require("../city.js");
const { seededRng } = require("./support/rng.js");

const EXPECTED = [
    ["hospital-1", "Recolectar muestras de pacientes", "samples"],
    ["hospital-2", "Esterilizar el quirófano", "uvlamp"],
    ["laboratorio-1", "Analizar la muestra del paciente cero", "slider"],
    ["laboratorio-2", "Secuenciar el genoma del virus", "code"],
    ["farmacia-1", "Preparar el suero base", "dosing"],
    ["farmacia-2", "Etiquetar las dosis", "code"],
    ["central-1", "Restaurar el registro de contagios", "patchpanel"],
    ["central-2", "Descargar el historial clínico", "hold"],
    ["planta-1", "Sintetizar el compuesto", "slider"],
    ["planta-2", "Purificar el reactor", "sequence"],
    ["almacen-1", "Cargar el suero en los camiones", "hold"],
    ["almacen-2", "Inventariar el cargamento", "code"],
];

test("MISSIONS: las 12 misiones de la decisión 13, válidas y con ids únicos", () => {
    assert.equal(MISSIONS.length, 12);
    assert.deepEqual(MISSIONS.map((m) => [m.id, m.title, m.kind]), EXPECTED);
    assert.equal(new Set(MISSIONS.map((m) => m.id)).size, 12);
    assert.deepEqual([...KINDS].sort(), ["code", "dosing", "helix", "hold", "labeling", "loading", "microscope", "patchpanel", "reactor", "samples", "scanner", "sequence", "slider", "transfer", "uvlamp", "valves", "wires"]);
    for (const m of MISSIONS) {
        assert.match(m.id, /^[a-z0-9-]{1,40}$/, "el id cumple el patrón de missionId del protocolo");
        assert.equal(m.stationId, m.id);
        assert.ok(KINDS.includes(m.kind), m.kind);
        assert.equal(m.id.split("-")[0], m.zoneId);
        assert.ok(Object.isFrozen(m), "las definiciones no se pueden modificar");
    }
    assert.ok(Object.isFrozen(MISSIONS));
});

test("MISSIONS: cada misión tiene su estación en buildCity y en su zona", () => {
    const city = buildCity({ width: 1200, height: 800 });
    for (const m of MISSIONS) {
        const station = city.stations.find((s) => s.id === m.stationId);
        assert.ok(station, `estación ${m.stationId}`);
        assert.equal(station.zoneId, m.zoneId);
    }
    assert.deepEqual(city.stations.map((s) => s.id).sort(), MISSIONS.map((m) => m.id).sort(), "una misión por estación");
});

test("pickMissions: determinista con rng sembrado, sin repetir y respetando count", () => {
    for (const count of [0, 1, 3, 6, 9, 12]) {
        const a = pickMissions(count, seededRng(42));
        const b = pickMissions(count, seededRng(42));
        assert.deepEqual(a, b, `mismo resultado con la misma semilla (count ${count})`);
        assert.equal(a.length, count);
        assert.equal(new Set(a.map((m) => m.id)).size, count, "sin repeticiones");
        for (const m of a) assert.ok(MISSIONS.includes(m));
    }
    assert.deepEqual(pickMissions(12, seededRng(7)).map((m) => m.id).sort(), MISSIONS.map((m) => m.id).sort(), "con 12 salen todas");
    assert.notDeepEqual(pickMissions(6, seededRng(1)).map((m) => m.id), pickMissions(6, seededRng(2)).map((m) => m.id), "otra semilla, otro sorteo");
});

test("pickMissions: count fuera de rango se acota y el catálogo no se altera", () => {
    const before = MISSIONS.map((m) => m.id);
    assert.equal(pickMissions(50, seededRng(3)).length, 12);
    assert.equal(pickMissions(-2, seededRng(3)).length, 0);
    assert.equal(pickMissions(Number.NaN, seededRng(3)).length, 0);
    assert.deepEqual(MISSIONS.map((m) => m.id), before);
});

test("pickMissions: con un rng uniforme todas las misiones pueden salir", () => {
    const rng = seededRng(99);
    const seen = new Set();
    for (let i = 0; i < 200; i++) for (const m of pickMissions(3, rng)) seen.add(m.id);
    assert.equal(seen.size, 12);
});
