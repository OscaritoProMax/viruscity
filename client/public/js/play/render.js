// Dibujo del juego en un <canvas>. Solo pinta lo que dice window.lastState (el estado del servidor);
// no calcula posiciones de juego.
//
// createRenderer(canvas) → { resize(world, availW, availH), draw(lastState, world, me, nowMs, dt) }

import { computeFit } from "./fit.js";
import { playerColor } from "./colors.js";

const MAX_DPR = 2;
const GRID_STEP = 100; // unidades del mundo
const SMOOTHING = 20; // cuanto mayor, más rápido alcanza la posición del servidor
const SNAP_DISTANCE = 200; // si la diferencia es mayor, se salta directamente (sin suavizar)

// Insignia del proveedor: "G" azul de Google sobre blanco, o "L" sobre gris para cuentas locales
const GOOGLE_BLUE = "#4285f4";
const BADGE_WHITE = "#ffffff";

// Lee una variable CSS (tokens.css) con un valor de respaldo
function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

export function createRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    const colors = {
        bg: cssVar("--bg", "#0b1020"),
        border: cssVar("--border", "#2a3560"),
        text: cssVar("--text", "#e6e9f5"),
        muted: cssVar("--muted", "#8f9bc4"),
    };
    const fontMono = cssVar("--font-mono", "monospace");

    let scale = 1;
    let dpr = 1;

    // Posiciones SOLO para dibujar: se acercan a las del servidor (window.lastState) con un suavizado
    // exponencial. Nunca se escriben en lastState: si alguien lo edita en DevTools, la vista lo refleja
    // y el siguiente state del servidor lo corrige.
    const renderPos = new Map();

    function smoothedPosition(p, dt) {
        let pos = renderPos.get(p.userId);
        if (!pos || Math.hypot(p.x - pos.x, p.y - pos.y) > SNAP_DISTANCE) {
            pos = { x: p.x, y: p.y };
            renderPos.set(p.userId, pos);
            return pos;
        }
        const k = 1 - Math.exp(-SMOOTHING * dt);
        pos.x += (p.x - pos.x) * k;
        pos.y += (p.y - pos.y) * k;
        return pos;
    }

    // Ajusta el canvas para mostrar el mundo completo en el área disponible
    function resize(world, availW, availH) {
        const fit = computeFit(world.width, world.height, availW, availH);
        scale = fit.scale;
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.style.width = `${Math.floor(fit.cssW)}px`;
        canvas.style.height = `${Math.floor(fit.cssH)}px`;
        canvas.width = Math.round(Math.floor(fit.cssW) * dpr);
        canvas.height = Math.round(Math.floor(fit.cssH) * dpr);
    }

    // Medidas en píxeles de pantalla expresadas en unidades del mundo (para líneas y textos nítidos)
    const px = (n) => n / scale;

    function drawBackground(world) {
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, world.width, world.height);

        // Cuadrícula tenue cada 100 unidades
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = px(1);
        ctx.beginPath();
        for (let x = GRID_STEP; x < world.width; x += GRID_STEP) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, world.height);
        }
        for (let y = GRID_STEP; y < world.height; y += GRID_STEP) {
            ctx.moveTo(0, y);
            ctx.lineTo(world.width, y);
        }
        ctx.stroke();
        ctx.restore();

        // Borde del mundo
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = px(2);
        ctx.strokeRect(px(1), px(1), world.width - px(2), world.height - px(2));
    }

    function drawPlayer(p, pos, radius, isMe, world) {
        // Anillo claro del jugador local
        if (isMe) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius + px(4), 0, Math.PI * 2);
            ctx.lineWidth = px(3);
            ctx.strokeStyle = colors.text;
            ctx.stroke();
        }

        // Cuerpo con borde oscuro
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = playerColor(p);
        ctx.fill();
        ctx.lineWidth = px(2);
        ctx.strokeStyle = colors.bg;
        ctx.stroke();

        // Nombre en una píldora encima
        const fontSize = px(12);
        ctx.font = `600 ${fontSize}px ${fontMono}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const name = String(p.username ?? "");
        const padX = px(6);
        const pillH = fontSize + px(6);
        const pillW = ctx.measureText(name).width + padX * 2;
        const hasBadge = p.provider === "google" || p.provider === "local";
        const labelW = pillW + (hasBadge ? px(4) + pillH : 0); // píldora + insignia

        // La etiqueta se mantiene dentro del mundo: se desplaza en horizontal cerca de los bordes
        // y pasa debajo del círculo si el jugador está pegado al borde superior
        const margin = px(2);
        const pillX = Math.min(Math.max(pos.x - pillW / 2, margin), world.width - labelW - margin);
        const above = pos.y - radius - px(8) - pillH;
        const pillY = above >= margin ? above : pos.y + radius + px(8);

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = colors.bg;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = colors.text;
        ctx.fillText(name, pillX + padX, pillY + pillH / 2);

        // Insignia del proveedor a la derecha del nombre (el provider lo pone el servidor)
        if (hasBadge) {
            const r = pillH / 2;
            const cx = pillX + pillW + px(4) + r;
            const cy = pillY + pillH / 2;
            const google = p.provider === "google";
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = google ? BADGE_WHITE : colors.muted;
            ctx.fill();
            ctx.fillStyle = google ? GOOGLE_BLUE : colors.bg;
            ctx.font = `700 ${px(11)}px ${fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(google ? "G" : "L", cx, cy + px(0.5));
        }
    }

    // nowMs se recibe por contrato; el suavizado solo necesita dt (segundos desde el cuadro anterior)
    function draw(lastState, world, me, nowMs, dt = 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!world) return;

        // Coordenadas del mundo → píxeles del canvas
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
        drawBackground(world);

        if (!lastState) {
            ctx.fillStyle = colors.muted;
            ctx.font = `600 ${px(16)}px ${fontMono}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Conectando…", world.width / 2, world.height / 2);
            return;
        }

        const radius = world.playerRadius;
        const meId = me?.userId ?? null;
        const players = lastState.players.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
        // El jugador local se dibuja al final para que quede encima
        players.sort((a, b) => (a.userId === meId) - (b.userId === meId));
        const present = new Set();
        for (const p of players) {
            present.add(p.userId);
            drawPlayer(p, smoothedPosition(p, dt), radius, p.userId === meId, world);
        }
        // Se olvidan las posiciones de quienes ya no están
        for (const id of renderPos.keys()) if (!present.has(id)) renderPos.delete(id);
    }

    return { resize, draw };
}
