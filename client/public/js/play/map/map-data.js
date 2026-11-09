// Datos del mapa que comparte el servidor: grilla de casillas sólidas, casillas de aparición y portales.
// Puro (sin DOM): lo usan client/scripts/export-map.mjs (genera coordinator/map/virus-city.json)
// y la prueba que verifica que ese archivo coincide con lo que dibuja el cliente.
//
// El mundo del servidor es la ciudad (filas 0-59) más una zona de interiores (filas 60-79) donde están el
// Burger Neón y el Supermercado. Entrar a un local es un PORTAL: al pisar la puerta, el servidor traslada
// al jugador dentro del interior (y al revés con la salida). Así la posición sigue siendo solo (x, y) y
// el protocolo no cambia: cada cliente sabe en qué escenario está alguien mirando sus coordenadas.

import { buildWorld, solid, idx, reachable, doors } from "./layout.js";
import { buildScenes } from "./interiors.js";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, WORLD_ROWS } from "./constants.js";

export const MAP_ID = "virus-city";

// Casilla libre desde la que se calcula qué zonas se pueden recorrer (Plaza Mayor)
const REACH_FROM = [34, 21];
// Zona de aparición: el centro de la ciudad (Plaza Mayor, sus aceras, la Avenida Central y las calles laterales)
const SPAWN_AREA = { c0: 24, r0: 15, c1: 52, r1: 31 };
// El servidor usa el centro de la caja del jugador; la referencia usaba el origen del dibujo, 6 px más arriba
const ORIGIN_TO_CENTER = 6;

let built = false;
function ensureWorld() {
    if (!built) {
        buildWorld();
        buildScenes();
        built = true;
    }
}

// Grilla completa (ciudad + interiores): 1 = sólida
export function worldGrid() {
    ensureWorld();
    const scenes = buildScenes();
    const grid = new Uint8Array(MAP_COLS * WORLD_ROWS).fill(1); // fuera de los locales todo es pared
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) grid[r * MAP_COLS + c] = solid[idx(c, r)];
    for (const sc of Object.values(scenes)) {
        for (let r = 0; r < sc.rows; r++) for (let c = 0; c < sc.cols; c++) grid[(sc.r0 + r) * MAP_COLS + sc.c0 + c] = sc.solid[r * sc.cols + c];
    }
    return grid;
}

// Portales: puerta de la ciudad → interior y salida del interior → frente a la puerta
export function portals() {
    ensureWorld();
    const scenes = buildScenes();
    const list = [];
    for (const door of doors) {
        const sc = scenes[door.to];
        if (!sc) continue;
        const last = door.cols[door.cols.length - 1];
        // Entrada: las casillas de la puerta (fila inferior del edificio) llevan al punto de entrada del local
        list.push({ to: sc.id, c0: door.cols[0], r0: door.row, c1: last, r1: door.row, x: sc.ox + sc.spawn.x, y: sc.oy + sc.spawn.y + ORIGIN_TO_CENTER });
        // Salida: el hueco de la puerta del local devuelve a la acera, frente a la entrada
        const ex = sc.exit;
        list.push({
            to: "world",
            c0: sc.c0 + ex.cols[0],
            r0: sc.r0 + ex.row,
            c1: sc.c0 + ex.cols[ex.cols.length - 1],
            r1: sc.r0 + ex.row,
            x: (door.cols[0] + door.cols.length / 2) * TILE_SIZE,
            y: (door.row + 1) * TILE_SIZE + 30 + ORIGIN_TO_CENTER,
        });
    }
    return list;
}

export function buildMapData() {
    ensureWorld();
    const grid = worldGrid();
    const free = (c, r) => c >= 0 && r >= 0 && c < MAP_COLS && r < WORLD_ROWS && !grid[r * MAP_COLS + c];
    const seen = reachable(REACH_FROM[0], REACH_FROM[1]);

    const rows = [];
    for (let r = 0; r < WORLD_ROWS; r++) {
        let line = "";
        for (let c = 0; c < MAP_COLS; c++) line += grid[r * MAP_COLS + c] ? "1" : "0";
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

    return {
        id: MAP_ID,
        tile: TILE_SIZE,
        cols: MAP_COLS,
        rows: WORLD_ROWS,
        solid: rows,
        spawns,
        portals: portals().map(({ c0, r0, c1, r1, x, y }) => ({ c0, r0, c1, r1, x, y })),
    };
}
