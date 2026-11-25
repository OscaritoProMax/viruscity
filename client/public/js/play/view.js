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
