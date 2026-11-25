// Salas de las misiones de Viruscity: el interior de los 6 edificios de la partida (función pura, sin canvas).
//
// Cada sala mide 12 × 9 casillas y está en la zona de interiores del mundo (columnas 44-79, filas 61-78), en
// ROOM_PLACEMENT. Misma estructura en todas (los jugadores aprenden dónde está cada cosa):
//   - filas 0-1: pared del fondo; columnas 0 y 11: paredes laterales; fila 8: pared con la puerta (columnas 5-6)
//   - dos CONSOLAS contra la pared del fondo (columnas 2-3 y 8-9, fila 2); su estación de misión queda justo
//     delante (fila 3), en el centro de la consola
//   - muebles en los lados y en el medio que tapan la vista (el infectado puede esconderse)
// La entrada es un portal: la puerta del edificio en la ciudad lleva a la sala y su salida devuelve a la acera
// (map-data.js). match-places.js toma de aquí las estaciones de la partida.

import { TILE_SIZE } from "./constants.js";

export const ROOM_COLS = 12;
export const ROOM_ROWS = 9;
export const ROOM_EXIT = Object.freeze({ cols: [5, 6], row: 8 });
// Consolas: casilla izquierda (c, fila 2) y 2 de ancho; la estación queda delante, en el centro
export const CONSOLE_SLOTS = Object.freeze([{ c: 2, r: 2 }, { c: 8, r: 2 }]);

// id = id de la zona de la partida (y de la escena); minigames: tipo de minijuego de cada consola (misión -1 y -2)
export const ROOMS = Object.freeze([
    {
        id: "hospital", name: "Hospital Virus Care", c0: 44, r0: 61, theme: "hospital", minigames: ["samples", "uvlamp"],
        decor: [["hospbed", 1, 5, 2], ["hospbed", 9, 5, 2], ["medcart", 10, 3, 1], ["plant", 1, 7, 1], ["plant", 10, 7, 1]],
        lights: [[3, 3.5, "200,240,255"], [9, 3.5, "200,240,255"], [6, 6, "220,245,255"]],
        say: [6, 2.2, ["HOSPITAL VIRUS CARE · SALA DE MUESTRAS", "Cada camilla tiene una ficha con un solo dato: \"positivo\"."]],
    },
    {
        id: "laboratorio", name: "Laboratorio Vega", c0: 56, r0: 61, theme: "lab", minigames: ["microscope", "helix"],
        decor: [["labbench", 5, 5, 2], ["chemshelf", 1, 4, 1], ["fridge", 10, 4, 1], ["barrels", 1, 6, 1], ["plant", 10, 7, 1]],
        lights: [[3, 3.5, "120,255,230"], [9, 3.5, "120,255,230"], [6, 6.5, "160,255,235"]],
        say: [6, 2.2, ["LABORATORIO VEGA", "Una pizarra llena de fórmulas. Al final, subrayado tres veces: \"la cura existe\"."]],
    },
    {
        id: "farmacia", name: "Farmacia", c0: 68, r0: 61, theme: "pharmacy", minigames: ["dosing", "labeling"],
        decor: [["pharmcounter", 4, 5, 4], ["chemshelf", 1, 4, 1], ["chemshelf", 10, 4, 1], ["plant", 1, 7, 1], ["plant", 10, 7, 1]],
        lights: [[3, 3.5, "190,255,200"], [9, 3.5, "190,255,200"], [6, 6.5, "230,255,235"]],
        say: [6, 2.2, ["FARMACIA · TRASTIENDA", "Cajas de jeringas, frascos sin etiqueta y un cartel: \"Solo personal de la cura\"."]],
    },
    {
        id: "central", name: "Central de datos", c0: 44, r0: 70, theme: "datacenter", minigames: ["patchpanel", "transfer"],
        decor: [["serverrack", 1, 4, 1], ["serverrack", 1, 6, 1], ["serverrack", 10, 4, 1], ["serverrack", 10, 6, 1], ["serverrack", 5, 5, 1], ["serverrack", 6, 5, 1]],
        lights: [[3, 3.5, "120,200,255"], [9, 3.5, "120,200,255"], [6, 7, "90,160,255"]],
        say: [6, 2.2, ["CENTRAL DE DATOS", "Miles de luces parpadean. En una pantalla: \"REGISTRO DE CONTAGIOS · DAÑADO\"."]],
    },
    {
        id: "planta", name: "Planta de síntesis", c0: 56, r0: 70, theme: "plant", minigames: ["valves", "reactor"],
        decor: [["tank", 1, 4, 1], ["tank", 10, 4, 1], ["barrels", 5, 5, 1], ["barrels", 6, 5, 1], ["barrels", 10, 6, 1]],
        lights: [[3, 3.5, "190,255,120"], [9, 3.5, "190,255,120"], [6, 7, "160,255,110"]],
        say: [6, 2.2, ["PLANTA DE SÍNTESIS", "El suelo vibra. Una luz verde advierte: \"Presión inestable\"."]],
    },
    {
        id: "almacen", name: "Almacén", c0: 68, r0: 70, theme: "warehouse", minigames: ["loading", "scanner"],
        decor: [["cratestack", 1, 4, 1], ["cratestack", 1, 6, 1], ["cratestack", 10, 5, 1], ["forklift", 5, 5, 2]],
        lights: [[3, 3.5, "255,220,160"], [9, 3.5, "255,220,160"], [6, 7, "255,205,140"]],
        say: [6, 2.2, ["ALMACÉN", "Cajas de suero con el sello de la cura, listas para salir de Virus City."]],
    },
].map((r) => Object.freeze(r)));

export const ROOM_PLACEMENT = Object.freeze(Object.fromEntries(ROOMS.map((r) => [r.id, { c0: r.c0, r0: r.r0 }])));

// Estación de cada consola, en unidades del mundo: centro de la consola, media casilla delante de ella
export function roomStations(room) {
    return CONSOLE_SLOTS.map(({ c, r }, k) => ({
        id: `${room.id}-${k + 1}`,
        zoneId: room.id,
        x: (room.c0 + c + 1) * TILE_SIZE,
        y: (room.r0 + r + 1.5) * TILE_SIZE,
        minigame: room.minigames[k],
    }));
}

// Rectángulo de la sala en el mundo
export function roomRect(room) {
    return { x: room.c0 * TILE_SIZE, y: room.r0 * TILE_SIZE, w: ROOM_COLS * TILE_SIZE, h: ROOM_ROWS * TILE_SIZE };
}

// Arma las escenas de las salas con el constructor de interiors.js (newScene / put / block / say)
export function buildRoomScenes(newScene, SCENES) {
    const T = TILE_SIZE;
    for (const room of ROOMS) {
        const sc = newScene(room.id, room.name, ROOM_COLS, ROOM_ROWS);
        sc.theme = room.theme;
        // paredes
        sc.block(0, 0, ROOM_COLS - 1, 1);
        sc.block(0, 0, 0, ROOM_ROWS - 1);
        sc.block(ROOM_COLS - 1, 0, ROOM_COLS - 1, ROOM_ROWS - 1);
        sc.block(0, ROOM_EXIT.row, ROOM_EXIT.cols[0] - 1, ROOM_EXIT.row);
        sc.block(ROOM_EXIT.cols[1] + 1, ROOM_EXIT.row, ROOM_COLS - 1, ROOM_EXIT.row);
        // consolas de las misiones (un sprite por minijuego)
        CONSOLE_SLOTS.forEach(({ c, r }, k) => sc.put(`console_${room.minigames[k]}`, c, r, 2, { dy: 4, name: `consola ${room.id}-${k + 1}` }));
        for (const [sprite, c, r, w] of room.decor) sc.put(sprite, c, r, w, { dy: 4 });
        sc.exit = { cols: [...ROOM_EXIT.cols], row: ROOM_EXIT.row };
        sc.spawn = { x: (ROOM_EXIT.cols[0] + 1) * T, y: (ROOM_ROWS - 2) * T + 6 };
        sc.lights = room.lights.map(([x, y, col]) => ({ x: x * T, y: y * T, r: 200, c: col }));
        const [sx, sy, lines] = room.say;
        sc.say(sx * T, sy * T, lines, { r: 90 });
        SCENES[room.id] = sc;
    }
}
