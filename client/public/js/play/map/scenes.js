// ¿En qué escenario está una posición? (función pura)
// El servidor solo conoce (x, y): la ciudad ocupa las filas 0-59 y cada interior tiene su rectángulo en la
// zona de interiores (ver PLACEMENT en interiors.js). Con esto cada cliente sabe en qué local está cada
// jugador sin que el protocolo cambie.

import { CITY_WIDTH, CITY_HEIGHT, TILE_SIZE } from "./constants.js";
import { buildScenes } from "./interiors.js";

export const WORLD_SCENE = "world";

// Rectángulo (en unidades del mundo) y nombre de cada escenario
export function sceneRect(id) {
    if (id === WORLD_SCENE) return { x: 0, y: 0, width: CITY_WIDTH, height: CITY_HEIGHT, name: "Virus City" };
    const sc = buildScenes()[id];
    if (!sc) return null;
    return { x: sc.ox, y: sc.oy, width: sc.cols * TILE_SIZE, height: sc.rows * TILE_SIZE, name: sc.name };
}

export function sceneAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return WORLD_SCENE;
    if (y < CITY_HEIGHT) return WORLD_SCENE;
    for (const sc of Object.values(buildScenes())) {
        if (x >= sc.ox && x < sc.ox + sc.cols * TILE_SIZE && y >= sc.oy && y < sc.oy + sc.rows * TILE_SIZE) return sc.id;
    }
    return WORLD_SCENE;
}
