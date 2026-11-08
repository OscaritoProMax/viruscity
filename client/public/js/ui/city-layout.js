// Diseño de la ciudad de Viruscity (solo decorativo).
// Coordenadas normalizadas 0..1 que se multiplican por el tamaño del mundo.
// Las colisiones, si existen, las decide el servidor; aquí solo se dibuja.

// Dos filas de tres edificios
export const BUILDINGS_NORM = [
    { name: "Hospital", x: 0.083, y: 0.125, w: 0.175, h: 0.1875 },
    { name: "Laboratorio", x: 0.425, y: 0.125, w: 0.175, h: 0.1875 },
    { name: "Farmacia", x: 0.725, y: 0.125, w: 0.167, h: 0.1875 },
    { name: "Central de datos", x: 0.083, y: 0.625, w: 0.175, h: 0.1875 },
    { name: "Planta de síntesis", x: 0.425, y: 0.625, w: 0.175, h: 0.1875 },
    { name: "Almacén", x: 0.725, y: 0.625, w: 0.167, h: 0.1875 },
];

// Calles: una avenida entre las dos filas y dos calles entre las columnas
export const STREETS_NORM = [
    { x: 0, y: 0.40875, w: 1, h: 0.12 },
    { x: 0.3015, y: 0, w: 0.08, h: 1 },
    { x: 0.6225, y: 0, w: 0.08, h: 1 },
];

// Plaza central sobre la avenida (radio relativo al lado menor del mundo)
export const PLAZA_NORM = { x: 0.5, y: 0.46875, r: 0.09 };

const scale = (rect, world) => ({
    ...rect,
    x: rect.x * world.width,
    y: rect.y * world.height,
    w: rect.w * world.width,
    h: rect.h * world.height,
});

// Edificios en píxeles del mundo
export function layoutFor(world) {
    return BUILDINGS_NORM.map((b) => scale(b, world));
}

// Calles en píxeles del mundo
export function streetsFor(world) {
    return STREETS_NORM.map((s) => scale(s, world));
}

// Plaza en píxeles del mundo
export function plazaFor(world) {
    return {
        x: PLAZA_NORM.x * world.width,
        y: PLAZA_NORM.y * world.height,
        r: PLAZA_NORM.r * Math.min(world.width, world.height),
    };
}
