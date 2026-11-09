// Datos del mapa que comparte el servidor: grilla de casillas sólidas y casillas de aparición.
// Puro (sin DOM): lo usan client/scripts/export-map.mjs (genera coordinator/map/virus-city.json)
// y la prueba que verifica que ese archivo coincide con lo que dibuja el cliente.

import { buildWorld, solid, idx, reachable } from "./layout.js";
import { TILE_SIZE, MAP_COLS, MAP_ROWS } from "./constants.js";

export const MAP_ID = "virus-city";

// Casilla libre desde la que se calcula qué zonas se pueden recorrer (Plaza Mayor)
const REACH_FROM = [34, 21];
// Zona de aparición: el centro de la ciudad (Plaza Mayor, sus aceras, la Avenida Central y las calles laterales)
const SPAWN_AREA = { c0: 24, r0: 15, c1: 52, r1: 31 };

let built = false;
function ensureWorld() {
    if (!built) {
        buildWorld();
        built = true;
    }
}

export function buildMapData() {
    ensureWorld();
    const free = (c, r) => c >= 0 && r >= 0 && c < MAP_COLS && r < MAP_ROWS && !solid[idx(c, r)];
    const seen = reachable(REACH_FROM[0], REACH_FROM[1]);

    const rows = [];
    for (let r = 0; r < MAP_ROWS; r++) {
        let line = "";
        for (let c = 0; c < MAP_COLS; c++) line += solid[idx(c, r)] ? "1" : "0";
        rows.push(line);
    }

    // Aparición: casillas alcanzables desde la plaza con sus 8 vecinas libres (nadie aparece pegado a una pared)
    const spawns = [];
    for (let r = SPAWN_AREA.r0; r <= SPAWN_AREA.r1; r++) {
        for (let c = SPAWN_AREA.c0; c <= SPAWN_AREA.c1; c++) {
            if (!seen[idx(c, r)]) continue;
            let open = true;
            for (let dr = -1; dr <= 1 && open; dr++) for (let dc = -1; dc <= 1; dc++) if (!free(c + dc, r + dr)) open = false;
            if (open) spawns.push([c, r]);
        }
    }

    return { id: MAP_ID, tile: TILE_SIZE, cols: MAP_COLS, rows: MAP_ROWS, solid: rows, spawns };
}
