// Lugares de la partida de Viruscity sobre el mapa de Virus City (función pura, sin DOM).
//
// Cada zona de la partida es un edificio real del mapa (layout.js) más la acera o el camino de su entrada,
// donde quedan sus dos estaciones de misión. La plaza de aparición está en el ala este de la Plaza Mayor:
// es el lugar de la plaza donde el círculo de aparición (radio 80) no pisa nada sólido.
//
// client/scripts/export-map.mjs guarda matchCity() en coordinator/map/virus-city.json (campo "city") y el
// coordinador la usa en lugar de las coordenadas normalizadas de city.js cuando arranca con MAP_FILE.
// Mismos ids, nombres y orden que coordinator/city.js; la prueba client/test/map.test.mjs exige que cada
// estación esté en una casilla libre, alcanzable desde la plaza y dentro de su zona.

import { TILE_SIZE } from "./constants.js";

// Casillas: zona [c0, r0] … [c1, r1] (inclusive) y estaciones [c, r] en la entrada del edificio
export const MATCH_ZONES = Object.freeze([
    { id: "hospital", name: "Hospital", c0: 55, r0: 37, c1: 62, r1: 42, stations: [[56, 42], [61, 42]] }, // Hospital Virus Care → Calle Sur
    { id: "laboratorio", name: "Laboratorio", c0: 13, r0: 5, c1: 21, r1: 11, stations: [[14, 11], [20, 11]] }, // Laboratorio Vega → Calle Norte
    { id: "farmacia", name: "Farmacia", c0: 9, r0: 21, c1: 13, r1: 26, stations: [[10, 26], [13, 26]] }, // Farmacia → Avenida Central
    { id: "central", name: "Central de datos", c0: 67, r0: 15, c1: 76, r1: 20, stations: [[69, 20], [74, 20]] }, // → Callejón del Mercado
    { id: "planta", name: "Planta de síntesis", c0: 10, r0: 47, c1: 19, r1: 52, stations: [[12, 52], [17, 52]] }, // → Camino Verde
    { id: "almacen", name: "Almacén", c0: 64, r0: 47, c1: 68, r1: 52, stations: [[64, 52], [68, 52]] }, // junto al Granero → patio
]);

// Centro del círculo de aparición: ala este de la Plaza Mayor (casilla 45, 18), junto al Ayuntamiento
export const MATCH_PLAZA = Object.freeze({ x: 45 * TILE_SIZE, y: 18 * TILE_SIZE + 16 });

const center = (n) => (n + 0.5) * TILE_SIZE;

// Ciudad de la partida en coordenadas del mundo, con la misma forma que buildCity() del coordinador:
// { zones:[{id,name,x,y,w,h}], stations:[{id,zoneId,x,y}], plaza:{x,y} }
export function matchCity() {
    const zones = [];
    const stations = [];
    for (const z of MATCH_ZONES) {
        zones.push({ id: z.id, name: z.name, x: z.c0 * TILE_SIZE, y: z.r0 * TILE_SIZE, w: (z.c1 - z.c0 + 1) * TILE_SIZE, h: (z.r1 - z.r0 + 1) * TILE_SIZE });
        z.stations.forEach(([c, r], k) => stations.push({ id: `${z.id}-${k + 1}`, zoneId: z.id, x: center(c), y: center(r) }));
    }
    return { zones, stations, plaza: { x: MATCH_PLAZA.x, y: MATCH_PLAZA.y } };
}
