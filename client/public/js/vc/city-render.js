// Ciudad de la partida en el canvas (Viruscity, decisiones 9 y 12): zonas, plaza central y estaciones de
// misión. Se dibuja ANTES de los jugadores, en coordenadas del mundo (la cámara la pone render.js).
// La ciudad llega del servidor en welcome.city; las misiones y su estado, en el último mensaje 'game'.
//
// stationMarks(city, game)            → [{ id, x, y, status }]  (status: available | in_progress | done | idle)
// ringLook(status, role, reduceMotion) → cómo se ve una estación (lógica pura, probada)
// drawCity(ctx, city, game, me, nowMs, reduceMotion, opts?)
//   opts.zoneAlpha: opacidad del relleno de las zonas (más baja sobre el mapa de Virus City)
// Todo el texto va con fillText.

const PLAZA_RING = 110; // radio del círculo de la plaza (los jugadores aparecen a 80 del centro)
const RING_RADIUS = 22;
const DOT_RADIUS = 4;
const PULSE_MS = 1400; // periodo del pulso del anillo dorado
const ZONE_FONT = 14; // unidades del mundo
const CHECK_FONT = 18;

// Lee una variable CSS (tokens.css) con su valor de respaldo
function cssVar(name, fallback) {
    if (typeof document === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

let palette = null;
function colors() {
    palette ??= {
        panel: cssVar("--panel", "#121a33"),
        border: cssVar("--border", "#2a3560"),
        muted: cssVar("--muted", "#8f9bc4"),
        accent: cssVar("--accent", "#4dd2ff"),
        cure: cssVar("--cure", "#ffd166"),
        mono: cssVar("--font-mono", "monospace"),
    };
    return palette;
}

// Las misiones solo existen en playing y ended; fuera de partida todas las estaciones quedan "idle"
export function stationMarks(city, game) {
    const inMatch = game?.phase === "playing" || game?.phase === "ended";
    const byStation = new Map();
    if (inMatch) for (const m of game.missions ?? []) byStation.set(m.stationId, m);
    return (city?.stations ?? []).map((s) => {
        const m = byStation.get(s.id);
        return { id: s.id, x: s.x, y: s.y, status: m ? m.status : "idle" };
    });
}

// color: nombre del color de la paleta; alpha: opacidad; pulse: si late; check: si lleva ✓; dot: punto pequeño
export function ringLook(status, role, reduceMotion = false) {
    if (status === "idle") return { dot: true, color: "muted", alpha: 0.6, pulse: false, check: false };
    if (role === "infected") return { dot: false, color: "muted", alpha: 0.3, pulse: false, check: status === "done" }; // anillos apagados
    if (status === "available") return { dot: false, color: "cure", alpha: role === "healthy" ? 1 : 0.7, pulse: role === "healthy" && !reduceMotion, check: false };
    if (status === "in_progress") return { dot: false, color: "accent", alpha: 0.45, pulse: false, check: false };
    return { dot: false, color: "muted", alpha: 0.75, pulse: false, check: true }; // done
}

function drawZones(ctx, city, c, zoneAlpha) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${ZONE_FONT}px ${c.mono}`;
    for (const z of city.zones) {
        ctx.globalAlpha = zoneAlpha;
        ctx.fillStyle = c.panel;
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c.border;
        ctx.strokeRect(z.x, z.y, z.w, z.h);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = c.muted;
        ctx.fillText(z.name.toUpperCase(), z.x + z.w / 2, z.y + z.h / 2, z.w - 12);
    }
    ctx.restore();
}

function drawPlaza(ctx, plaza, c) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(plaza.x, plaza.y, PLAZA_RING, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawStation(ctx, mark, look, c, nowMs) {
    ctx.save();
    ctx.globalAlpha = look.alpha;
    if (look.dot) {
        ctx.fillStyle = c.muted;
        ctx.beginPath();
        ctx.arc(mark.x, mark.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }
    const color = c[look.color];
    const wave = look.pulse ? (Math.sin((nowMs / PULSE_MS) * Math.PI * 2) + 1) / 2 : 0; // 0..1
    const r = RING_RADIUS + wave * 5;
    // Halo suave debajo del anillo
    ctx.fillStyle = color;
    ctx.globalAlpha = look.alpha * (0.12 + wave * 0.12);
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = look.alpha * (look.pulse ? 0.75 + wave * 0.25 : 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (look.check) {
        ctx.fillStyle = color;
        ctx.font = `700 ${CHECK_FONT}px ${c.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("✓", mark.x, mark.y + 1);
    }
    ctx.restore();
}

export function drawCity(ctx, city, game, me, nowMs, reduceMotion, opts = {}) {
    if (!city) return;
    const c = colors();
    const role = game?.you?.role ?? me?.role ?? null;
    drawZones(ctx, city, c, opts.zoneAlpha ?? 0.85);
    drawPlaza(ctx, city.plaza, c);
    for (const mark of stationMarks(city, game)) drawStation(ctx, mark, ringLook(mark.status, role, reduceMotion), c, nowMs);
}
