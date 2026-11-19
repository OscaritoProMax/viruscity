// Ciudad de la partida de Viruscity (metodología, decisión 9): 6 zonas con 2 estaciones de misión cada una.
// Lógica pura: las zonas están normalizadas (0-1) y se escalan al tamaño del mundo, así funciona igual
// con 1200 × 800 que con cualquier otro mundo. El servidor envía el resultado al cliente en welcome.city.
//
// buildCity(world) → { zones:[{id,name,x,y,w,h}], stations:[{id,zoneId,x,y}], plaza:{x,y} }
// zoneNear(city, x, y) → nombre de la zona cuyo centro está más cerca (para la alerta de contagio)
"use strict";

// id, nombre y rectángulo normalizado (nx, ny = esquina superior izquierda; nw, nh = ancho y alto)
const ZONES = Object.freeze([
    { id: "hospital", name: "Hospital", nx: 0.083, ny: 0.125, nw: 0.175, nh: 0.1875 },
    { id: "laboratorio", name: "Laboratorio", nx: 0.425, ny: 0.125, nw: 0.175, nh: 0.1875 },
    { id: "farmacia", name: "Farmacia", nx: 0.725, ny: 0.125, nw: 0.167, nh: 0.1875 },
    { id: "central", name: "Central de datos", nx: 0.083, ny: 0.625, nw: 0.175, nh: 0.1875 },
    { id: "planta", name: "Planta de síntesis", nx: 0.425, ny: 0.625, nw: 0.175, nh: 0.1875 },
    { id: "almacen", name: "Almacén", nx: 0.725, ny: 0.625, nw: 0.167, nh: 0.1875 },
].map((z) => Object.freeze(z)));

// Separación (normalizada) entre el edificio y sus estaciones: arriba de la zona en la fila superior,
// abajo en la inferior; así las estaciones quedan en la calle, fuera del edificio.
const STATION_GAP = 0.06;

const round2 = (v) => Math.round(v * 100) / 100;

function buildCity(world) {
    const width = Number(world?.width);
    const height = Number(world?.height);
    if (!(width > 0) || !(height > 0)) throw new Error("buildCity necesita un mundo con width y height positivos");

    const zones = [];
    const stations = [];
    for (const z of ZONES) {
        zones.push({ id: z.id, name: z.name, x: round2(z.nx * width), y: round2(z.ny * height), w: round2(z.nw * width), h: round2(z.nh * height) });
        const top = z.ny < 0.5;
        const y = round2((top ? z.ny - STATION_GAP : z.ny + z.nh + STATION_GAP) * height);
        stations.push({ id: `${z.id}-1`, zoneId: z.id, x: round2((z.nx + z.nw * 0.25) * width), y });
        stations.push({ id: `${z.id}-2`, zoneId: z.id, x: round2((z.nx + z.nw * 0.75) * width), y });
    }
    return { zones, stations, plaza: { x: round2(width / 2), y: round2(height / 2) } };
}

// Nombre de la zona cuyo centro está más cerca de (x, y); en empate gana la primera de la lista
function zoneNear(city, x, y) {
    let best = null;
    let bestD = Infinity;
    for (const z of city?.zones ?? []) {
        const d = Math.hypot(z.x + z.w / 2 - x, z.y + z.h / 2 - y);
        if (d < bestD) {
            bestD = d;
            best = z;
        }
    }
    return best ? best.name : null;
}

module.exports = { ZONES, buildCity, zoneNear };
