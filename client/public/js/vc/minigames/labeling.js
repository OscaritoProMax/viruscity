// Minijuego "Línea de etiquetado" (farmacia-2, Etiquetar las dosis).
// Una cinta trae 5 viales; cuando un vial pasa por la marca del aplicador, se estampa la etiqueta de SU color.
// Los que pasan sin etiqueta dan la vuelta y vuelven a pasar. Puntero: tocar la etiqueta del color.
// Teclado: teclas 1 a 4 (o ←/→ para elegir y Enter o Espacio para estampar).

import { createStage, createCelebration, palette, clamp, easeOutBack, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const LABELS = Object.freeze([
    { id: "rojo", name: "roja", token: "danger" },
    { id: "amarillo", name: "amarilla", token: "cure" },
    { id: "cian", name: "cian", token: "accent" },
    { id: "verde", name: "verde", token: "infected" },
]);
export const VIAL_COUNT = 5;
export const SPACING = 124;
export const SPEED = 0.095; // px por ms
export const MARKER_X = 280;
export const WINDOW = 30; // ± px alrededor de la marca
const BELT_Y = 196;
const BTN_Y = 286;

// ---------- Lógica pura ----------
export function createLine(rng = Math.random) {
    return { colors: Array.from({ length: VIAL_COUNT }, () => LABELS[Math.floor(rng() * LABELS.length)].id), labeled: Array(VIAL_COUNT).fill(false) };
}
// x del vial i cuando la cinta lleva tMs andando: avanza de izquierda a derecha en un bucle de
// VIAL_COUNT × SPACING px (sale por la derecha y vuelve a entrar por la izquierda, en x = -40)
export function vialX(i, tMs, n = VIAL_COUNT) {
    const loop = n * SPACING;
    return ((i * SPACING + tMs * SPEED) % loop) - 40;
}
// índice del vial que está bajo la marca (o null)
export function vialAtMarker(tMs, n = VIAL_COUNT) {
    for (let i = 0; i < n; i++) if (Math.abs(vialX(i, tMs, n) - MARKER_X) <= WINDOW) return i;
    return null;
}
// Estampa una etiqueta en el vial i: { state, ok } (ok solo si el color coincide y no tenía etiqueta)
export function stamp(st, i, color) {
    if (i === null || i === undefined || i < 0 || i >= st.colors.length || st.labeled[i] || st.colors[i] !== color) return { state: st, ok: false };
    const labeled = [...st.labeled];
    labeled[i] = true;
    return { state: { ...st, labeled }, ok: true };
}
export const labeledCount = (st) => st.labeled.filter(Boolean).length;
export const isLineDone = (st) => st.labeled.every(Boolean);

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const colorOf = (id) => pal[LABELS.find((l) => l.id === id).token];
    const nameOf = (id) => LABELS.find((l) => l.id === id).name;
    const stage = createStage(container, { height: H, label: "Línea de etiquetado", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let st = createLine(rng);
    let belt = 0; // ms de cinta andando
    const stampedAt = new Map(); // vial → hora
    const shakeAt = new Map();
    let pressAt = -1;
    let sel = 0;
    let keySel = false;
    const say = () => stage.status(isLineDone(st) ? "¡Dosis etiquetadas!" : `Estampa la etiqueta del color de cada vial cuando pase por la marca · ${labeledCount(st)} de ${VIAL_COUNT}`);
    say();

    function press(color, now) {
        if (done.active) return;
        pressAt = now;
        const i = vialAtMarker(belt);
        if (i === null) {
            sfx("error");
            stage.status("No hay ningún vial bajo la marca");
            return;
        }
        if (st.labeled[i]) return;
        const r = stamp(st, i, color);
        if (r.ok) {
            st = r.state;
            stampedAt.set(i, now);
            stage.burst(MARKER_X, BELT_Y - 60, colorOf(color), 14);
            sfx("ok");
            say();
            if (isLineDone(st)) {
                sfx("done");
                done.start(now);
            }
        } else {
            shakeAt.set(i, now);
            sfx("error");
            stage.status(`Ese vial necesita la etiqueta ${nameOf(st.colors[i])}`);
        }
    }
    const btnX = (k) => 112 + k * 112;

    stage.onPointer({
        down(p) {
            keySel = false;
            LABELS.forEach((l, k) => {
                if (Math.abs(p.x - btnX(k)) < 46 && Math.abs(p.y - BTN_Y) < 30) press(l.id, performance.now());
            });
        },
    });
    function onKeyDown(event) {
        if (done.active) return false;
        const n = Number(event.key);
        if (Number.isInteger(n) && n >= 1 && n <= 4) {
            event.preventDefault();
            press(LABELS[n - 1].id, performance.now());
            return true;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            keySel = true;
            sel = (sel + (event.key === "ArrowRight" ? 1 : -1) + 4) % 4;
            return true;
        }
        if ((event.key === "Enter" || event.key === " ") && keySel) {
            event.preventDefault();
            press(LABELS[sel].id, performance.now());
            return true;
        }
        return false;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        if (!done.active) belt += dt;
        roundRect(ctx, 0, 0, 560, H, 16, "#0b1f17");
        // aplicador sobre la marca
        const down = pressAt > 0 && now - pressAt < 180 ? 18 : 0;
        roundRect(ctx, MARKER_X - 34, 40, 68, 30, 6, "#334155", pal.border, 2);
        ctx.fillStyle = "#64748b";
        ctx.fillRect(MARKER_X - 5, 70, 10, 30 + down);
        roundRect(ctx, MARKER_X - 22, 98 + down, 44, 12, 4, "#94a3b8");
        const at = vialAtMarker(belt);
        if (at !== null && !st.labeled[at]) glowCircle(ctx, MARKER_X, BELT_Y - 50, 54, pal.cure, 0.22);
        // marca en la cinta
        ctx.fillStyle = withAlpha(pal.cure, 0.7);
        ctx.fillRect(MARKER_X - WINDOW, BELT_Y + 16, WINDOW * 2, 4);
        // cinta con rodillos que giran
        roundRect(ctx, 0, BELT_Y, 560, 16, 4, "#18181b");
        const off = reduceMotion ? 0 : (belt * SPEED) % 28;
        ctx.fillStyle = "#3f3f46";
        for (let x = -28 + 28 - off; x < 580; x += 28) ctx.fillRect(x, BELT_Y + 4, 14, 8);
        for (let x = 14; x < 560; x += 56) {
            ctx.beginPath();
            ctx.arc(x, BELT_Y + 26, 9, 0, Math.PI * 2);
            ctx.fillStyle = "#27272a";
            ctx.fill();
        }
        // viales
        for (let i = 0; i < VIAL_COUNT; i++) {
            const sh = shakeAt.has(i) && now - shakeAt.get(i) < 400 ? Math.sin((now - shakeAt.get(i)) / 22) * 5 : 0;
            const x = vialX(i, belt) + sh;
            if (x < -40 || x > 600) continue;
            const col = colorOf(st.colors[i]);
            roundRect(ctx, x - 15, BELT_Y - 74, 30, 74, 8, withAlpha("#ffffff", 0.18), withAlpha("#e6e9f5", 0.75), 2);
            ctx.fillStyle = withAlpha(col, 0.8);
            ctx.fillRect(x - 12, BELT_Y - 44, 24, 42);
            roundRect(ctx, x - 12, BELT_Y - 84, 24, 12, 3, "#475569");
            if (st.labeled[i]) {
                const t = clamp((now - stampedAt.get(i)) / 220, 0, 1);
                const k = reduceMotion ? 1 : easeOutBack(t);
                roundRect(ctx, x - 14, BELT_Y - 64 + (1 - k) * -30, 28, 18, 3, "#f8fafc", col, 2);
                ctx.fillStyle = col;
                ctx.fillRect(x - 9, BELT_Y - 58 + (1 - k) * -30, 18, 6);
            }
        }
        // etiquetas (botones)
        LABELS.forEach((l, k) => {
            const x = btnX(k);
            const col = colorOf(l.id);
            roundRect(ctx, x - 46, BTN_Y - 26, 92, 52, 10, withAlpha(col, 0.16), keySel && sel === k ? pal.accent : col, keySel && sel === k ? 3 : 2);
            roundRect(ctx, x - 26, BTN_Y - 14, 52, 20, 4, "#f8fafc", col, 2);
            ctx.fillStyle = col;
            ctx.fillRect(x - 18, BTN_Y - 8, 36, 8);
            ctx.fillStyle = pal.muted;
            ctx.font = `700 11px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(String(k + 1), x, BTN_Y + 20);
        });
        ctx.fillStyle = pal.muted;
        ctx.font = `700 12px ${pal.fontMono}`;
        ctx.textAlign = "left";
        ctx.fillText(`ETIQUETADAS ${labeledCount(st)}/${VIAL_COUNT}`, 18, 28);
        stage.drawParticles(dt);
        stage.label(`Línea de etiquetado: ${labeledCount(st)} de ${VIAL_COUNT}; ${at === null ? "nada bajo la marca" : st.labeled[at] ? "vial ya etiquetado bajo la marca" : `bajo la marca: vial ${nameOf(st.colors[at])}`}`);
        if (done.active) drawSuccess(ctx, 560, H, done.progress(now), pal);
    });

    return {
        focusTarget: stage.canvas,
        onKeyDown,
        close() {
            stage.destroy();
        },
    };
}
