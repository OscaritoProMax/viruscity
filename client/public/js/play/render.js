// Dibujo del juego en un <canvas>. Solo pinta lo que dice window.lastState (el estado del servidor);
// no calcula posiciones de juego.
//
// createRenderer(canvas) → { resize(world, availW, availH), draw(lastState, world, me, nowMs, dt) }

import { computeFit } from "./fit.js";
import { playerColor } from "./colors.js";

const MAX_DPR = 2;
const GRID_STEP = 100; // unidades del mundo

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

    function drawPlayer(p, pos, radius, isMe) {
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
        const pillX = pos.x - pillW / 2;
        const pillY = pos.y - radius - px(8) - pillH;

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = colors.bg;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = colors.text;
        ctx.fillText(name, pillX + padX, pillY + pillH / 2);
    }

    function draw(lastState, world, me) {
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
        for (const p of players) drawPlayer(p, { x: p.x, y: p.y }, radius, p.userId === meId);
    }

    return { resize, draw };
}
