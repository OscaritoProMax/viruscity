// Minijuego "Lámpara UV" (hospital-2, Esterilizar el quirófano).
// Pasar la lámpara ultravioleta sobre la mesa de operaciones hasta borrar todas las colonias de germen.
// Puntero: la lámpara sigue al puntero (o al dedo). Teclado: flechas para moverla; Enter la lleva a la siguiente
// colonia sucia (ayuda de accesibilidad).

import { createStage, createCelebration, palette, clamp, dist, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const UV_RADIUS = 48;
export const UV_DOSE_MS = 900; // tiempo bajo la luz que necesita una colonia
export const GERM_COUNT = 8;
const TABLE = { x: 46, y: 46, w: 468, h: 252 };
const KEY_SPEED = 0.32; // px lógicos por ms

// ---------- Lógica pura ----------
// Colonias en la mesa, separadas entre sí (al menos 72 px entre centros)
export function createGerms(rng = Math.random, n = GERM_COUNT) {
    const germs = [];
    for (let tries = 0; germs.length < n && tries < 2000; tries++) {
        const r = 13 + rng() * 9;
        const x = TABLE.x + 30 + rng() * (TABLE.w - 60);
        const y = TABLE.y + 30 + rng() * (TABLE.h - 60);
        if (germs.every((g) => dist(g.x, g.y, x, y) >= 72)) germs.push({ x, y, r, health: 1 });
    }
    return germs;
}
// La luz baja la salud de las colonias cuyo centro está dentro del haz
export function applyUv(germs, lx, ly, radius = UV_RADIUS, dtMs = 16, doseMs = UV_DOSE_MS) {
    return germs.map((g) => {
        if (g.health <= 0 || dist(g.x, g.y, lx, ly) > radius) return g;
        return { ...g, health: Math.max(0, g.health - dtMs / doseMs) };
    });
}
export const cleanFraction = (germs) => (germs.length ? germs.reduce((s, g) => s + (1 - clamp(g.health, 0, 1)), 0) / germs.length : 1);
export const isSterile = (germs) => germs.every((g) => g.health <= 0);
export const nextDirty = (germs, x, y) => germs.filter((g) => g.health > 0).sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0] ?? null;

// ---------- Dibujo ----------
function drawGerm(ctx, g, now, pal, reduceMotion) {
    const k = clamp(g.health, 0, 1);
    if (k <= 0) return;
    const pulse = reduceMotion ? 1 : 1 + 0.06 * Math.sin(now / 220 + g.x);
    const r = g.r * (0.35 + 0.65 * k) * pulse;
    ctx.save();
    ctx.translate(g.x, g.y);
    glowCircle(ctx, 0, 0, r * 2.1, pal.infected, 0.35 * k);
    ctx.fillStyle = withAlpha(pal.infected, 0.55 + 0.4 * k);
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const bump = r * (1 + 0.18 * Math.sin(a * 3 + g.y + (reduceMotion ? 0 : now / 400)));
        const px = Math.cos(a) * bump;
        const py = Math.sin(a) * bump;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha("#0b3d16", 0.6);
    for (const [dx, dy] of [[-0.3, -0.2], [0.25, 0.1], [-0.05, 0.35]]) {
        ctx.beginPath();
        ctx.arc(dx * r, dy * r, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Lámpara UV", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let germs = createGerms(rng);
    const lamp = { x: TABLE.x + TABLE.w / 2, y: TABLE.y + TABLE.h - 20 };
    const keys = new Set();
    let glide = null; // { x, y } destino al pulsar Enter
    let lastPct = -1;
    stage.status("Pasa la lámpara sobre los gérmenes · 0 % esterilizado");

    stage.onPointer({
        down(p) {
            glide = null;
            lamp.x = p.x;
            lamp.y = p.y;
        },
        move(p, e, pressed) {
            // Ratón: sigue al puntero siempre; dedo: solo mientras toca
            if (e.pointerType === "mouse" || pressed) {
                glide = null;
                lamp.x = p.x;
                lamp.y = p.y;
            }
        },
    });

    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    function onKeyDown(event) {
        if (done.active) return false;
        if (ARROWS[event.key]) {
            event.preventDefault();
            keys.add(event.key);
            glide = null;
            return true;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const g = nextDirty(germs, lamp.x, lamp.y);
            if (g) glide = { x: g.x, y: g.y };
            return true;
        }
        return false;
    }
    function onKeyUp(event) {
        if (!ARROWS[event.key]) return false;
        keys.delete(event.key);
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        // mover la lámpara con teclado o deslizarla hacia la colonia elegida
        let mx = 0;
        let my = 0;
        for (const k of keys) {
            mx += ARROWS[k][0];
            my += ARROWS[k][1];
        }
        if (mx || my) {
            const len = Math.hypot(mx, my);
            lamp.x += (mx / len) * KEY_SPEED * dt;
            lamp.y += (my / len) * KEY_SPEED * dt;
        } else if (glide) {
            const d = dist(lamp.x, lamp.y, glide.x, glide.y);
            const step = KEY_SPEED * 1.4 * dt;
            if (d <= step) {
                lamp.x = glide.x;
                lamp.y = glide.y;
                glide = null;
            } else {
                lamp.x += ((glide.x - lamp.x) / d) * step;
                lamp.y += ((glide.y - lamp.y) / d) * step;
            }
        }
        lamp.x = clamp(lamp.x, TABLE.x, TABLE.x + TABLE.w);
        lamp.y = clamp(lamp.y, TABLE.y, TABLE.y + TABLE.h);

        if (!done.active) {
            const before = germs;
            germs = applyUv(germs, lamp.x, lamp.y, UV_RADIUS, dt);
            germs.forEach((g, i) => {
                if (g.health < before[i].health && !reduceMotion && Math.random() < 0.25) stage.burst(g.x + (Math.random() - 0.5) * g.r, g.y + (Math.random() - 0.5) * g.r, "#c4b5fd", 1);
                if (g.health <= 0 && before[i].health > 0) {
                    stage.burst(g.x, g.y, pal.infected, 18);
                    sfx("ok");
                }
            });
            // Mientras quede una colonia el porcentaje no llega a 100 (el redondeo no debe adelantarse al final)
            const pct = isSterile(germs) ? 100 : Math.min(99, Math.round(cleanFraction(germs) * 100));
            if (pct !== lastPct) {
                lastPct = pct;
                stage.status(pct === 100 ? "¡Quirófano esterilizado!" : `Pasa la lámpara sobre los gérmenes · ${pct} % esterilizado`);
            }
            if (isSterile(germs)) {
                sfx("done");
                done.start(now);
            }
        }

        // sala y mesa de operaciones
        roundRect(ctx, 0, 0, 560, H, 16, "#0e1a2e");
        roundRect(ctx, TABLE.x - 10, TABLE.y - 10, TABLE.w + 20, TABLE.h + 20, 18, "#64748b", "#94a3b8", 2);
        roundRect(ctx, TABLE.x, TABLE.y, TABLE.w, TABLE.h, 14, "#cfe8f5");
        ctx.strokeStyle = withAlpha("#7aa9c7", 0.5);
        ctx.lineWidth = 1;
        for (let x = TABLE.x + 24; x < TABLE.x + TABLE.w; x += 24) {
            ctx.beginPath();
            ctx.moveTo(x, TABLE.y + 4);
            ctx.lineTo(x, TABLE.y + TABLE.h - 4);
            ctx.stroke();
        }
        for (const g of germs) drawGerm(ctx, g, now, pal, reduceMotion);
        // haz de la lámpara (por encima de todo, con mezcla aditiva)
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        glowCircle(ctx, lamp.x, lamp.y, UV_RADIUS * 1.5, "#8b5cf6", 0.55);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(lamp.x, lamp.y, UV_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha("#c4b5fd", 0.9);
        ctx.lineWidth = 2;
        ctx.setLineDash(reduceMotion ? [] : [6, 6]);
        ctx.lineDashOffset = reduceMotion ? 0 : -now / 40;
        ctx.stroke();
        ctx.setLineDash([]);
        roundRect(ctx, lamp.x - 22, lamp.y - 8, 44, 16, 8, "#334155", "#c4b5fd", 2);
        stage.drawParticles(dt);
        // barra de esterilización
        const f = cleanFraction(germs);
        roundRect(ctx, 46, 312, 468, 12, 6, pal.panel, pal.border, 1);
        roundRect(ctx, 46, 312, Math.max(12, 468 * f), 12, 6, pal.cure);
        stage.label(`Lámpara UV: ${Math.round(f * 100)} por ciento esterilizado`);
        if (done.active) drawSuccess(ctx, 560, H, done.progress(now), pal);
    });

    return {
        focusTarget: stage.canvas,
        onKeyDown,
        onKeyUp,
        close() {
            stage.destroy();
        },
    };
}
