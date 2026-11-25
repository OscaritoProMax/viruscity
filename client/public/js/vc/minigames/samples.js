// Minijuego "Gradilla de muestras" (hospital-1, Recolectar muestras de pacientes).
// Arrastrar los 4 tubos de ensayo de la bandeja a la gradilla, cada uno al hueco del color de su tapa.
// Teclado: ←/→ elige un tubo, Enter o Espacio lo toma, ←/→ elige el hueco y Enter o Espacio lo deja.

import {
    createStage, createCelebration, palette, clamp, lerp, easeOutBack, easeOutCubic, dist, derange, shuffle, roundRect, withAlpha, glowCircle, drawSuccess,
} from "./canvas-kit.js";

export const SAMPLE_COLORS = Object.freeze([
    { id: "rojo", name: "roja", token: "danger" },
    { id: "amarillo", name: "amarilla", token: "cure" },
    { id: "cian", name: "cian", token: "accent" },
    { id: "verde", name: "verde", token: "infected" },
]);
const H = 340;
const SLOT_X = [130, 230, 330, 430];
const RACK_Y = 142; // base de los tubos en la gradilla
const TRAY_Y = 300; // base de los tubos en la bandeja
const SNAP_RADIUS = 56;

// ---------- Lógica pura ----------
// tray: color de cada tubo (posición en la bandeja); slots: color que pide cada hueco (nunca en el mismo orden)
export function createSamples(rng = Math.random) {
    const ids = SAMPLE_COLORS.map((c) => c.id);
    const tray = shuffle(ids, rng);
    return { tray, slots: derange(tray, rng), placed: {} };
}
// ¿Se puede dejar el tubo t en el hueco s? (mismo color, hueco libre y tubo aún en la bandeja)
export function canPlace(state, tube, slot) {
    if (!state || !Number.isInteger(tube) || !Number.isInteger(slot)) return false;
    if (tube < 0 || tube >= state.tray.length || slot < 0 || slot >= state.slots.length) return false;
    if (Object.hasOwn(state.placed, slot) || Object.values(state.placed).includes(tube)) return false;
    return state.tray[tube] === state.slots[slot];
}
// Estado nuevo con el tubo colocado (o el mismo estado si no se puede)
export function placeTube(state, tube, slot) {
    if (!canPlace(state, tube, slot)) return state;
    return { ...state, placed: { ...state.placed, [slot]: tube } };
}
export const placedCount = (state) => Object.keys(state?.placed ?? {}).length;
export const isRackComplete = (state) => !!state && placedCount(state) === state.slots.length;

// ---------- Dibujo ----------
function drawTube(ctx, x, baseY, color, { tilt = 0, wobble = 0, glow = false, pal }) {
    ctx.save();
    ctx.translate(x, baseY);
    ctx.rotate(tilt);
    if (glow) glowCircle(ctx, 0, -46, 46, pal.accent, 0.35);
    // vidrio
    roundRect(ctx, -13, -96, 26, 92, 13, withAlpha("#ffffff", 0.16), withAlpha("#e6e9f5", 0.7), 2);
    // líquido con superficie que se mece
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-11, -94, 22, 88, 11) : ctx.rect(-11, -94, 22, 88);
    ctx.clip();
    ctx.fillStyle = withAlpha(color, 0.85);
    ctx.beginPath();
    const top = -52;
    ctx.moveTo(-12, top + wobble * 3);
    ctx.quadraticCurveTo(0, top - wobble * 4, 12, top - wobble * 3);
    ctx.lineTo(12, 0);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha("#ffffff", 0.35);
    ctx.fillRect(-8, -90, 3, 80);
    ctx.restore();
    // tapa
    roundRect(ctx, -15, -110, 30, 16, 4, color, withAlpha("#000000", 0.35), 1.5);
    ctx.fillStyle = withAlpha("#ffffff", 0.35);
    ctx.fillRect(-12, -108, 24, 3);
    ctx.restore();
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const colorOf = (id) => pal[SAMPLE_COLORS.find((c) => c.id === id).token];
    const nameOf = (id) => SAMPLE_COLORS.find((c) => c.id === id).name;
    const stage = createStage(container, { height: H, label: "Gradilla de muestras", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let state = createSamples(rng);
    // Posición dibujada de cada tubo (se anima hacia su destino)
    const tubes = state.tray.map((id, i) => ({ id, x: SLOT_X[i], y: TRAY_Y, tx: SLOT_X[i], ty: TRAY_Y, tilt: 0, from: null, at: 0 }));
    const flash = new Map(); // hueco → hora del destello rojo
    const lit = new Map(); // hueco → hora en que se encendió
    let drag = null; // { tube, dx, dy, lastX }
    let keyMode = null; // null | { phase: "tube"|"slot", tube, slot }

    const free = () => state.tray.map((_, i) => i).filter((i) => !Object.values(state.placed).includes(i));
    const emptySlots = () => state.slots.map((_, i) => i).filter((i) => !Object.hasOwn(state.placed, i));
    const say = () => stage.status(isRackComplete(state) ? "¡Muestras listas!" : `Coloca cada tubo en el hueco de su color · ${placedCount(state)} de 4`);
    say();

    function moveTo(t, x, y, now) {
        t.from = { x: t.x, y: t.y };
        t.tx = x;
        t.ty = y;
        t.at = now;
    }
    function tryDrop(tubeIdx, slotIdx, now) {
        const t = tubes[tubeIdx];
        if (slotIdx !== null && canPlace(state, tubeIdx, slotIdx)) {
            state = placeTube(state, tubeIdx, slotIdx);
            moveTo(t, SLOT_X[slotIdx], RACK_Y, now);
            lit.set(slotIdx, now);
            stage.burst(SLOT_X[slotIdx], RACK_Y - 60, colorOf(t.id), 16);
            sfx("ok");
            if (isRackComplete(state)) {
                sfx("done");
                done.start(now);
            }
            say();
            return;
        }
        // hueco equivocado (destello rojo y aviso) o fuera de la gradilla: el tubo vuelve a la bandeja
        moveTo(t, SLOT_X[tubeIdx], TRAY_Y, now);
        if (slotIdx === null) return say();
        flash.set(slotIdx, now);
        sfx("error");
        stage.status(`Ese hueco pide la tapa ${nameOf(state.slots[slotIdx])}`);
    }
    const slotAt = (x, y) => {
        let best = null;
        SLOT_X.forEach((sx, i) => {
            const d = dist(x, y, sx, RACK_Y - 50);
            if (d < SNAP_RADIUS + 20 && (best === null || d < best.d)) best = { i, d };
        });
        return best ? best.i : null;
    };

    stage.onPointer({
        down(p) {
            if (done.active) return;
            keyMode = null;
            for (const i of free()) {
                const t = tubes[i];
                if (Math.abs(p.x - t.x) < 22 && p.y > t.y - 116 && p.y < t.y + 6) {
                    drag = { tube: i, dx: p.x - t.x, dy: p.y - t.y, lastX: p.x };
                    t.from = null;
                    sfx("tick");
                    return;
                }
            }
        },
        move(p, e, pressed) {
            if (!drag || !pressed) return;
            const t = tubes[drag.tube];
            const vx = p.x - drag.lastX;
            drag.lastX = p.x;
            t.x = clamp(p.x - drag.dx, 20, 540);
            t.y = clamp(p.y - drag.dy, 120, 330);
            t.tx = t.x;
            t.ty = t.y;
            t.tilt = clamp(lerp(t.tilt, vx * 0.06, 0.35), -0.6, 0.6);
        },
        up(p) {
            if (!drag) return;
            const i = drag.tube;
            drag = null;
            tryDrop(i, slotAt(tubes[i].x, tubes[i].y - 50), performance.now());
        },
    });

    function onKeyDown(event) {
        if (done.active) return false;
        const k = event.key;
        if (!["ArrowLeft", "ArrowRight", "Enter", " "].includes(k)) return false;
        event.preventDefault();
        const now = performance.now();
        if (!keyMode) keyMode = { phase: "tube", tube: free()[0], slot: emptySlots()[0] };
        const cycle = (list, cur, dir) => list[(list.indexOf(cur) + dir + list.length) % list.length] ?? list[0];
        if (keyMode.phase === "tube") {
            if (k === "ArrowLeft" || k === "ArrowRight") keyMode.tube = cycle(free(), keyMode.tube, k === "ArrowLeft" ? -1 : 1);
            else {
                keyMode.phase = "slot";
                keyMode.slot = emptySlots()[0];
                const t = tubes[keyMode.tube];
                moveTo(t, SLOT_X[keyMode.tube], TRAY_Y - 34, now);
                sfx("tick");
                stage.status(`Tubo de tapa ${nameOf(t.id)} en la mano: elige el hueco con ← →`);
            }
        } else if (k === "ArrowLeft" || k === "ArrowRight") keyMode.slot = cycle(emptySlots(), keyMode.slot, k === "ArrowLeft" ? -1 : 1);
        else {
            const tube = keyMode.tube;
            tryDrop(tube, keyMode.slot, now);
            keyMode = { phase: "tube", tube: free()[0], slot: emptySlots()[0] };
        }
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        const wob = reduceMotion ? 0 : Math.sin(now / 260);
        // fondo: mesa de la sala de muestras
        roundRect(ctx, 0, 0, 560, H, 16, pal.panel2);
        // gradilla
        roundRect(ctx, 70, 150, 420, 22, 6, "#94a3b8", "#cbd5e1", 2);
        roundRect(ctx, 80, 40, 400, 16, 6, "#64748b");
        for (const x of [86, 474]) roundRect(ctx, x - 6, 40, 12, 132, 4, "#475569");
        state.slots.forEach((id, i) => {
            const x = SLOT_X[i];
            const filled = Object.hasOwn(state.placed, i);
            const f = flash.get(i);
            const red = f !== undefined && now - f < 450;
            // hueco con aro del color que pide
            roundRect(ctx, x - 20, 34, 40, 28, 8, filled ? withAlpha(colorOf(id), 0.35) : pal.panel, red ? pal.danger : colorOf(id), 3);
            // luz del hueco
            const l = lit.get(i);
            const on = filled ? easeOutCubic(l !== undefined ? (now - l) / 300 : 1) : 0;
            const pulse = filled || reduceMotion ? 1 : 0.45 + 0.25 * (Math.sin(now / 400 + i) + 1) / 2;
            ctx.beginPath();
            ctx.arc(x, 186, 7, 0, Math.PI * 2);
            ctx.fillStyle = filled ? colorOf(id) : withAlpha(colorOf(id), 0.25 * pulse);
            ctx.fill();
            if (on > 0) glowCircle(ctx, x, 186, 24, colorOf(id), 0.6 * on);
            if (keyMode?.phase === "slot" && keyMode.slot === i) roundRect(ctx, x - 28, 26, 56, 172, 10, null, pal.accent, 3);
        });
        // bandeja
        roundRect(ctx, 60, TRAY_Y + 2, 440, 18, 8, "#334155", "#475569", 2);
        ctx.fillStyle = pal.muted;
        ctx.font = `600 12px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText("BANDEJA DE MUESTRAS", 280, TRAY_Y + 34);
        // tubos (el arrastrado al final, por encima)
        const order = tubes.map((t, i) => i).sort((a, b) => (drag?.tube === a ? 1 : 0) - (drag?.tube === b ? 1 : 0));
        for (const i of order) {
            const t = tubes[i];
            if (t.from && drag?.tube !== i) {
                const k = easeOutBack(clamp((now - t.at) / 320, 0, 1));
                t.x = lerp(t.from.x, t.tx, k);
                t.y = lerp(t.from.y, t.ty, k);
                if (k >= 1) t.from = null;
            }
            if (drag?.tube !== i) t.tilt = lerp(t.tilt, 0, 0.12);
            const selected = keyMode && keyMode.tube === i && !Object.values(state.placed).includes(i);
            drawTube(ctx, t.x, t.y, colorOf(t.id), { tilt: reduceMotion ? 0 : t.tilt, wobble: wob * (0.4 + Math.abs(t.tilt)), glow: selected, pal });
        }
        stage.drawParticles(dt);
        stage.label(`Gradilla de muestras: ${placedCount(state)} de 4 tubos colocados`);
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
