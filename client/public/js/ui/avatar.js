// Avatares de jugador: iniciales sobre un color estable derivado de un id.
// hashString, colorFromId e initials son funciones puras (se prueban con node:test).

// Hash FNV-1a de 32 bits: determinista y siempre un entero positivo
export function hashString(str) {
    let hash = 0x811c9dc5;
    for (const char of String(str)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

// Color HSL estable para un id: el mismo id da siempre el mismo tono
export function colorFromId(id) {
    return `hsl(${hashString(String(id)) % 360} 70% 55%)`;
}

// 1 o 2 letras en mayúsculas: inicial de las dos primeras palabras, o las 2 primeras letras
export function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const first = [...words[0]];
    if (words.length > 1) return (first[0] + [...words[1]][0]).toUpperCase();
    return first.slice(0, 2).join("").toUpperCase();
}

// Tamaños disponibles (en px) → clase CSS; así el único estilo en línea es el color de fondo
const SIZE_CLASSES = [
    [28, "avatar--s"],
    [36, "avatar--m"],
    [Infinity, "avatar--l"],
];

// <span class="avatar"> con las iniciales. Es decorativo: el nombre siempre se muestra al lado.
export function createAvatar(name, id, size = 36) {
    const avatar = document.createElement("span");
    const [, sizeClass] = SIZE_CLASSES.find(([max]) => size <= max);
    avatar.className = `avatar ${sizeClass}`;
    avatar.textContent = initials(name);
    avatar.style.background = colorFromId(id);
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
}
