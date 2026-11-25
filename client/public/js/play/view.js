// Cámara y animación de los personajes (funciones puras, solo visuales).
// Nada de esto cambia posiciones de juego: trabaja con las posiciones que manda el servidor.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.25;

export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));

// Esquina superior izquierda de la vista (en unidades del mundo) para seguir a `target`.
// viewW/viewH son el tamaño del canvas en px CSS; con zoom, se ve viewW/zoom unidades.
// Si el mundo es más chico que la vista, queda centrado.
export function computeView(target, viewW, viewH, world, zoom) {
    const w = viewW / zoom;
    const h = viewH / zoom;
    const axis = (t, view, size) => {
        if (size <= view) return (size - view) / 2;
        const wanted = (t ?? size / 2) - view / 2;
        return Math.min(Math.max(wanted, 0), size - view);
    };
    return { x: axis(target?.x, w, world.width), y: axis(target?.y, h, world.height), w, h };
}

// ---------- Animación según el SERVIDOR (la que usa el renderer) ----------
// Camina si su posición en el servidor cambió hace menos de MOVE_HOLD_MS. No se calcula con la posición suavizada:
// por internet (ngrok) los state llegan a ráfagas (nada durante 100–200 ms y luego varios juntos); en esos huecos el
// suavizado alcanzaba al servidor, la velocidad dibujada caía a 0 y el personaje se deslizaba en pose quieta
// ("levitaba"). Con la retención, unos huecos de red de hasta MOVE_HOLD_MS no cortan la caminata.
export const MOVE_HOLD_MS = 250;
export const MAX_MOVE_HOLD_MS = 700;
const MOVE_EPSILON = 1; // px: correcciones más chicas no cuentan como caminar
const TELEPORT_DISTANCE = 200; // px: un salto mayor (plaza, portal, reconexión) no es caminar

// Retención adaptada a la red: 1,25 × el hueco más largo entre state de los últimos segundos, entre MOVE_HOLD_MS
// (red buena: el personaje se detiene enseguida) y MAX_MOVE_HOLD_MS (red muy irregular)
export function adaptiveHoldMs(gapsMs) {
    const gaps = (gapsMs ?? []).filter((g) => Number.isFinite(g) && g > 0);
    if (gaps.length === 0) return MOVE_HOLD_MS;
    return Math.min(MAX_MOVE_HOLD_MS, Math.max(MOVE_HOLD_MS, Math.round(Math.max(...gaps) * 1.25)));
}

// prev: { dir, moving, walkTime, sx, sy, movedAt } o null. sx/sy: última posición del servidor que contó
export function nextServerAnim(prev, x, y, nowMs, dt, holdMs = MOVE_HOLD_MS) {
    if (!prev || !Number.isFinite(prev.sx)) return { dir: prev?.dir ?? "DOWN", moving: false, walkTime: 0, sx: x, sy: y, movedAt: -Infinity };
    const dx = x - prev.sx;
    const dy = y - prev.sy;
    const d = Math.hypot(dx, dy);
    let { dir, movedAt, sx, sy } = prev;
    if (d > TELEPORT_DISTANCE) {
        sx = x; // teletransporte: se acomoda sin animar pasos
        sy = y;
        movedAt = -Infinity;
    } else if (d >= MOVE_EPSILON) {
        sx = x;
        sy = y;
        movedAt = nowMs;
        dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "LEFT" : "RIGHT") : dy < 0 ? "UP" : "DOWN";
    }
    const moving = nowMs - movedAt < holdMs;
    return { dir, moving, walkTime: moving ? prev.walkTime + Math.max(0, dt || 0) : 0, sx, sy, movedAt };
}

// ---------- Animación según la posición dibujada (anterior; se conserva por compatibilidad) ----------
const MOVING_SPEED = 20; // unidades/s: por debajo se considera quieto (ruido del suavizado)

// Animación de un personaje a partir de cuánto se movió su posición dibujada en `dt` segundos.
// Devuelve un nuevo estado { dir, moving, walkTime, x, y } (dir: "UP"|"DOWN"|"LEFT"|"RIGHT").
export function nextAnim(prev, x, y, dt) {
    if (!prev || !(dt > 0)) return { dir: prev?.dir ?? "DOWN", moving: false, walkTime: prev?.walkTime ?? 0, x, y };
    const vx = (x - prev.x) / dt;
    const vy = (y - prev.y) / dt;
    const moving = Math.hypot(vx, vy) > MOVING_SPEED;
    let dir = prev.dir;
    if (moving) dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? "LEFT" : "RIGHT") : vy < 0 ? "UP" : "DOWN";
    return { dir, moving, walkTime: moving ? prev.walkTime + dt : 0, x, y };
}
