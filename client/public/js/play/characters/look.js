// Apariencia de los jugadores (funciones puras, sin DOM).
//
// La apariencia viaja en los extras del jugador: el cliente la envía con extras_update, el servidor la
// guarda en player.extras y la reenvía en cada state. Formato:
//   { character: "heroina"|"explorador"|"mensajero", color: "#rrggbb", detail: "#rrggbb", skin: "#rrggbb",
//     power: uno de los poderes del personaje, powerOn?: true mientras el poder está activo }
// El poder es solo visual (no cambia posiciones ni reglas): el que lo activa envía powerOn: true y,
// POWER_MS después, powerOn: false; como viaja en el state, todos ven el efecto.
// El servidor solo valida `color`; el resto puede venir mal (o malicioso) de otro cliente, así que
// resolveLook lo revisa campo por campo y usa valores por defecto estables para lo que no sirva.

import { hashString, isValidColor } from "../colors.js";

export const CHARACTERS = {
    heroina: {
        name: "Heroína 11",
        description: "Trenzas, overol de los 80 y poderes mentales.",
        colorLabel: "Overol",
        detailLabel: "Pelo",
        colors: ["#581c87", "#1e293b", "#0369a1", "#be123c", "#047857", "#c2410c"],
        details: ["#d4b36c", "#4a2f1d", "#1c1b21", "#ec4899", "#00e5ff", "#b45309"],
        powers: [
            { id: "aura", label: "Aura telequinética" },
            { id: "walkie", label: "Walkie-talkie" },
            { id: "vial", label: "Frasco de esporas" },
            { id: "none", label: "Manos libres" },
        ],
    },
    explorador: {
        name: "Explorador Pop",
        description: "Rizos, chaqueta táctica y equipo de expedición.",
        colorLabel: "Chaqueta",
        detailLabel: "Pelo",
        colors: ["#3b4836", "#1e293b", "#7c2d12", "#0f766e", "#4338ca", "#a21caf"],
        details: ["#4a2f1d", "#1c1b21", "#d4b36c", "#b45309", "#ec4899", "#9ca3af"],
        powers: [
            { id: "shotgun", label: "Escopeta" },
            { id: "sword", label: "Espada" },
            { id: "vial", label: "Frasco de esporas" },
            { id: "none", label: "Manos libres" },
        ],
    },
    mensajero: {
        name: "Mensajero",
        description: "Gorra, sudadera, bolso cruzado y herramientas de la calle.",
        colorLabel: "Sudadera",
        detailLabel: "Gorra",
        colors: ["#f97316", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0f172a"],
        details: ["#facc15", "#f8fafc", "#111827", "#ef4444", "#06b6d4", "#22c55e"],
        powers: [
            { id: "jetpack", label: "Mochila cohete" },
            { id: "spray", label: "Aerosol" },
            { id: "smg", label: "Subfusil" },
            { id: "none", label: "Manos libres" },
        ],
    },
};

// Duración del efecto de un poder activado (ms)
export const POWER_MS = 700;

const hasPower = (character, id) => CHARACTERS[character].powers.some((p) => p.id === id);
export const powerLabel = (character, id) => CHARACTERS[character]?.powers.find((p) => p.id === id)?.label ?? "";

export const CHARACTER_IDS = Object.keys(CHARACTERS);

export const SKIN_TONES = [
    { value: "#f7d5b8", label: "Clara" },
    { value: "#e8b88f", label: "Media clara" },
    { value: "#c68e5f", label: "Media" },
    { value: "#8d5b3c", label: "Morena" },
    { value: "#5c3a21", label: "Oscura" },
];

const isCharacter = (id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(CHARACTERS, id);

// Apariencia por defecto, distinta (pero estable) para cada userId
export function defaultLook(userId) {
    const h = hashString(String(userId ?? ""));
    const character = CHARACTER_IDS[h % CHARACTER_IDS.length];
    const def = CHARACTERS[character];
    return {
        character,
        color: def.colors[(h >>> 3) % def.colors.length],
        detail: def.details[(h >>> 7) % def.details.length],
        skin: SKIN_TONES[(h >>> 11) % SKIN_TONES.length].value,
        power: def.powers[0].id,
    };
}

// Apariencia válida a partir de los extras de un jugador del state (nunca lanza)
export function resolveLook(player) {
    const base = defaultLook(player?.userId);
    const extras = player?.extras && typeof player.extras === "object" ? player.extras : {};
    const character = isCharacter(extras.character) ? extras.character : base.character;
    return {
        character,
        color: isValidColor(extras.color) ? extras.color.toLowerCase() : base.color,
        detail: isValidColor(extras.detail) ? extras.detail.toLowerCase() : character === base.character ? base.detail : CHARACTERS[character].details[0],
        skin: isValidColor(extras.skin) ? extras.skin.toLowerCase() : base.skin,
        power: typeof extras.power === "string" && hasPower(character, extras.power) ? extras.power : CHARACTERS[character].powers[0].id,
        powerOn: extras.powerOn === true,
    };
}

// Extras listos para enviar (solo los campos conocidos, ya validados; powerOn no se guarda)
export function lookToExtras(look) {
    const clean = resolveLook({ extras: look });
    return { character: clean.character, color: clean.color, detail: clean.detail, skin: clean.skin, power: clean.power };
}

// Lee la apariencia guardada en localStorage (texto JSON). Acepta el color suelto del Taller 5
// ("playColor") para no perder la elección anterior. Devuelve null si no hay nada utilizable.
export function parseSavedLook(savedJson, legacyColor) {
    let saved = null;
    try {
        saved = savedJson ? JSON.parse(savedJson) : null;
    } catch {
        saved = null;
    }
    if (saved && typeof saved === "object" && isCharacter(saved.character)) return lookToExtras(saved);
    if (isValidColor(legacyColor)) return lookToExtras({ character: "explorador", color: legacyColor });
    return null;
}
