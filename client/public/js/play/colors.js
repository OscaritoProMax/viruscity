// Colores de los jugadores (funciones puras).

const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

// Color "#rrggbb" válido (el mismo formato que acepta el servidor en extras.color)
export function isValidColor(value) {
    return typeof value === "string" && COLOR_REGEX.test(value);
}

// Hash FNV-1a de 32 bits: determinista y siempre un entero positivo
export function hashString(str) {
    let hash = 0x811c9dc5;
    for (const char of String(str)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

// Color estable para un id: el mismo id da siempre el mismo tono
export function colorFromId(id) {
    return `hsl(${hashString(String(id)) % 360} 70% 55%)`;
}

// El color elegido por el jugador (extras.color) si es válido; si no, uno derivado de su userId
export function playerColor(player) {
    const chosen = player?.extras?.color;
    return isValidColor(chosen) ? chosen : colorFromId(player?.userId);
}
