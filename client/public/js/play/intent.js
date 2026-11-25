// Intención de movimiento a partir de las teclas pulsadas (función pura).
// El cliente solo calcula la DIRECCIÓN que quiere el jugador; la posición la decide el servidor.

const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const UP = new Set(["KeyW", "ArrowUp"]);
const DOWN = new Set(["KeyS", "ArrowDown"]);

// Teclas que mueven (para preventDefault en la página)
export const MOVEMENT_CODES = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN]);

const pressed = (keys, group) => [...group].some((code) => keys.has(code));

// keys: Set de event.code → { x, y } con -1, 0 o 1. Dos direcciones opuestas en un eje se anulan.
export function computeIntent(keys) {
    const x = (pressed(keys, RIGHT) ? 1 : 0) - (pressed(keys, LEFT) ? 1 : 0);
    const y = (pressed(keys, DOWN) ? 1 : 0) - (pressed(keys, UP) ? 1 : 0);
    return { x, y };
}
