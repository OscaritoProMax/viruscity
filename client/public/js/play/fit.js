// Escala para que el mundo entero quepa en el área disponible conservando la proporción (función pura).

const MIN_SCALE = 0.1;

// → { scale, cssW, cssH }: tamaño CSS del canvas para mostrar el mundo completo
export function computeFit(worldW, worldH, availW, availH) {
    const raw = Math.min(availW / worldW, availH / worldH);
    const scale = Number.isFinite(raw) && raw > MIN_SCALE ? raw : MIN_SCALE;
    return { scale, cssW: worldW * scale, cssH: worldH * scale };
}
