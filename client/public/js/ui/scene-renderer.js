// Render de la escena del juego en un <canvas>. Solo dibuja datos planos (contrato "scene" de CLAUDE.md):
// scene = { world:{width,height}, playerRadius, me:{userId}|null, status:"healthy"|"infected"|null,
//           players:[{userId, username, x, y, color?, badge?}] }
// No conoce la red ni calcula movimiento. Nunca dibuja el estado de infección de otros jugadores:
// status es solo el del jugador local (viñeta verde en los bordes de su pantalla).

import { UI } from "./ui-config.js";
import { colorFromId } from "./avatar.js";
import { layoutFor, streetsFor, plazaFor } from "./city-layout.js";

// "#rrggbb" → "rgba(r, g, b, a)" (los tokens de color son hex)
function withAlpha(hex, alpha) {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const MAX_DPR = 2;
const GRID_STEP = 100; // px del mundo
const CULL_MARGIN = 80; // margen para no recortar nombres que asoman en el borde

// ---------- Cámara (función pura) ----------

// Devuelve la esquina superior izquierda de la vista en coordenadas del mundo.
// Centra en "me" ({x, y}) y no deja ver fuera del mundo; si el mundo es más chico que la vista
// en un eje, lo centra en ese eje. Sin "me", centra el mundo.
export function computeCamera(me, viewW, viewH, world) {
    const axis = (target, view, size) => {
        if (size <= view) return (size - view) / 2; // mundo más chico: centrado
        const wanted = (target ?? size / 2) - view / 2;
        return Math.min(Math.max(wanted, 0), size - view);
    };
    return {
        x: axis(me?.x, viewW, world.width),
        y: axis(me?.y, viewH, world.height),
    };
}

// ---------- Render ----------

export function createSceneRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const token = (name) => css.getPropertyValue(name).trim();
    const remPx = parseFloat(getComputedStyle(root).fontSize) || 16;

    // Colores y tipografía cacheados al crear (salen de tokens.css)
    const colors = {
        bg: token("--bg"),
        panel: token("--panel"),
        panel2: token("--panel-2"),
        border: token("--border"),
        text: token("--text"),
        muted: token("--muted"),
        accent: token("--accent"),
        infected: token("--infected"),
    };
    const fontMono = token("--font-mono");
    const fontSmall = Math.round(parseFloat(token("--fs-s")) * remPx); // var(--fs-s) en px

    let dpr = 1;
    let viewW = 0;
    let viewH = 0;
    let lastScene = null;

    // Ajusta el búfer del canvas a su tamaño CSS (DPR limitado a 2)
    function resize() {
        const rect = canvas.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        viewW = rect.width;
        viewH = rect.height;
        canvas.width = Math.round(viewW * dpr);
        canvas.height = Math.round(viewH * dpr);
        if (lastScene) draw(lastScene);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const visible = (x, y, w, h, cam) =>
        x + w >= cam.x - CULL_MARGIN && x <= cam.x + viewW + CULL_MARGIN &&
        y + h >= cam.y - CULL_MARGIN && y <= cam.y + viewH + CULL_MARGIN;

    function drawGrid(cam) {
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const startX = Math.floor(cam.x / GRID_STEP) * GRID_STEP;
        const startY = Math.floor(cam.y / GRID_STEP) * GRID_STEP;
        for (let x = startX; x <= cam.x + viewW; x += GRID_STEP) {
            ctx.moveTo(x, cam.y);
            ctx.lineTo(x, cam.y + viewH);
        }
        for (let y = startY; y <= cam.y + viewH; y += GRID_STEP) {
            ctx.moveTo(cam.x, y);
            ctx.lineTo(cam.x + viewW, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawCity(world, cam) {
        // Calles
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = colors.panel;
        for (const s of streetsFor(world)) {
            if (visible(s.x, s.y, s.w, s.h, cam)) ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        ctx.restore();

        // Plaza central
        const plaza = plazaFor(world);
        if (visible(plaza.x - plaza.r, plaza.y - plaza.r, plaza.r * 2, plaza.r * 2, cam)) {
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = colors.muted;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(plaza.x, plaza.y, plaza.r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Edificios con su nombre
        ctx.font = `600 ${fontSmall}px ${fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const b of layoutFor(world)) {
            if (!visible(b.x, b.y, b.w, b.h, cam)) continue;
            ctx.beginPath();
            ctx.roundRect(b.x, b.y, b.w, b.h, 12);
            ctx.fillStyle = colors.panel2;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = colors.border;
            ctx.stroke();
            ctx.fillStyle = colors.muted;
            ctx.fillText(b.name.toUpperCase(), b.x + b.w / 2, b.y + b.h / 2);
        }
    }

    function drawPlayer(p, radius, isMe) {
        // Halo cian suave y anillo claro del jugador local
        if (isMe) {
            ctx.save();
            ctx.shadowColor = colors.accent;
            ctx.shadowBlur = 16;
            ctx.strokeStyle = colors.text;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Cuerpo con borde oscuro
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color || colorFromId(p.userId);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = colors.bg;
        ctx.stroke();

        // Píldora con el nombre (y la insignia a la derecha, si hay)
        ctx.font = `600 ${fontSmall}px ${fontMono}`;
        ctx.textBaseline = "middle";
        const name = String(p.username ?? "");
        const badge = p.badge ? String(p.badge) : "";
        const gap = badge ? 6 : 0;
        const nameW = ctx.measureText(name).width;
        const badgeW = badge ? ctx.measureText(badge).width : 0;
        const padX = 8;
        const pillH = fontSmall + 8;
        const pillW = nameW + gap + badgeW + padX * 2;
        const pillX = p.x - pillW / 2;
        const pillY = p.y - radius - (isMe ? 10 : 6) - pillH;

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = colors.bg;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.restore();

        ctx.textAlign = "left";
        ctx.fillStyle = colors.text;
        ctx.fillText(name, pillX + padX, pillY + pillH / 2);
        if (badge) ctx.fillText(badge, pillX + padX + nameW + gap, pillY + pillH / 2);
    }

    // Viñeta verde en los bordes de la pantalla del jugador local infectado
    function drawInfectedVignette() {
        const r = Math.hypot(viewW, viewH) / 2;
        const gradient = ctx.createRadialGradient(viewW / 2, viewH / 2, r * 0.55, viewW / 2, viewH / 2, r);
        gradient.addColorStop(0, withAlpha(colors.infected, 0));
        gradient.addColorStop(1, withAlpha(colors.infected, 0.28));
        ctx.save();
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, viewW, viewH);
        ctx.restore();
    }

    // nowMs se acepta por contrato (animaciones futuras); el dibujo actual no depende del tiempo
    function draw(scene, nowMs) {
        lastScene = scene;
        if (!ctx || viewW === 0 || viewH === 0) return;

        const world = scene.world;
        const radius = scene.playerRadius ?? UI.PLAYER_RADIUS_DEFAULT;
        const meId = scene.me?.userId ?? null;
        const mePlayer = meId != null ? scene.players.find((p) => p.userId === meId) : null;
        const cam = computeCamera(mePlayer ?? null, viewW, viewH, world);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, viewW, viewH);

        ctx.save();
        ctx.translate(-cam.x, -cam.y);
        drawGrid(cam);
        drawCity(world, cam);

        // Jugadores: el local al final para que quede encima
        const others = scene.players.filter((p) => p.userId !== meId);
        for (const p of mePlayer ? [...others, mePlayer] : others) {
            if (!visible(p.x - radius, p.y - radius - 40, radius * 2, radius * 2 + 40, cam)) continue;
            drawPlayer(p, radius, p.userId === meId);
        }
        ctx.restore();

        if (scene.status === "infected") drawInfectedVignette();
    }

    return {
        resize,
        draw,
        destroy() {
            observer.disconnect();
        },
    };
}
