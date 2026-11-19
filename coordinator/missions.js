// Catálogo de misiones de Viruscity (metodología, decisión 13): 12 misiones fijas, una por estación.
// Lógica pura. El id de cada misión es el id de su estación (city.js).
//
// MISSIONS: [{ id, zoneId, stationId, title, kind }]   kind = tipo de minijuego del cliente
// pickMissions(count, rng) → `count` misiones al azar, sin repetir (Fisher-Yates con rng inyectable)
"use strict";

const KINDS = Object.freeze(["sequence", "code", "wires", "slider", "hold"]);

const MISSIONS = Object.freeze(
    [
        ["hospital-1", "hospital", "Recolectar muestras de pacientes", "sequence"],
        ["hospital-2", "hospital", "Esterilizar el quirófano", "hold"],
        ["laboratorio-1", "laboratorio", "Analizar la muestra del paciente cero", "slider"],
        ["laboratorio-2", "laboratorio", "Secuenciar el genoma del virus", "code"],
        ["farmacia-1", "farmacia", "Preparar el suero base", "wires"],
        ["farmacia-2", "farmacia", "Etiquetar las dosis", "code"],
        ["central-1", "central", "Restaurar el registro de contagios", "wires"],
        ["central-2", "central", "Descargar el historial clínico", "hold"],
        ["planta-1", "planta", "Sintetizar el compuesto", "slider"],
        ["planta-2", "planta", "Purificar el reactor", "sequence"],
        ["almacen-1", "almacen", "Cargar el suero en los camiones", "hold"],
        ["almacen-2", "almacen", "Inventariar el cargamento", "code"],
    ].map(([id, zoneId, title, kind]) => Object.freeze({ id, zoneId, stationId: id, title, kind })),
);

// Subconjunto aleatorio sin repetición. Solo se baraja lo necesario (las primeras `count` posiciones).
// count se acota a [0, 12]; rng debe devolver números en [0, 1) como Math.random.
function pickMissions(count, rng = Math.random) {
    const n = Math.max(0, Math.min(MISSIONS.length, Math.floor(Number(count) || 0)));
    const pool = MISSIONS.slice();
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

module.exports = { MISSIONS, KINDS, pickMissions };
