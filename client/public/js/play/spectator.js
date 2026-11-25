// Modo espectador (track 2.5): funciones puras de la cámara, sin DOM ni red.
//
// nextFollow(players, currentId, step) → userId del jugador a seguir (step +1 siguiente, -1 anterior) o null
// panCamera(pos, dir, dt, world, zoom)  → nueva posición de la cámara libre, dentro del mundo
// followLabel(players, followId)        → texto del control de cámara

export const PAN_SPEED = 700; // px de pantalla por segundo (se divide por el zoom: igual de rápido a cualquier zoom)

const visible = (players) =>
    (Array.isArray(players) ? players : [])
        .filter((p) => p && typeof p.userId === "string" && Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => String(a.username).localeCompare(String(b.username), "es") || a.userId.localeCompare(b.userId));

// Orden estable por nombre: el espectador recorre a los jugadores siempre en el mismo orden
export function nextFollow(players, currentId, step = 1) {
    const list = visible(players);
    if (list.length === 0) return null;
    const i = list.findIndex((p) => p.userId === currentId);
    if (i === -1) return step < 0 ? list[list.length - 1].userId : list[0].userId;
    const n = list.length;
    return list[(((i + step) % n) + n) % n].userId;
}

export function panCamera(pos, dir, dt, world, zoom = 1) {
    const base = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : { x: (world?.width ?? 0) / 2, y: (world?.height ?? 0) / 2 };
    const step = (PAN_SPEED / (zoom > 0 ? zoom : 1)) * Math.max(0, Math.min(dt, 0.1));
    const clamp = (v, max) => Math.min(Math.max(v, 0), Math.max(0, max));
    return {
        x: clamp(base.x + Math.sign(dir?.x ?? 0) * step, world?.width ?? base.x),
        y: clamp(base.y + Math.sign(dir?.y ?? 0) * step, world?.height ?? base.y),
    };
}

export function followLabel(players, followId) {
    if (!followId) return "Cámara libre";
    const p = visible(players).find((q) => q.userId === followId);
    return p ? `Siguiendo a ${p.username}` : "Cámara libre";
}
