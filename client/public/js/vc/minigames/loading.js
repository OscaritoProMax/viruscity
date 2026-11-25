// Minijuego "Carga" (almacen-1, Cargar el suero en los camiones).
// La caja del camión tiene 8 casillas (4 abajo y 4 arriba) y ya trae 3 cajas viejas en el piso. Hay que subir las
// 5 cajas de suero del muelle hasta llenarla. Una caja de arriba necesita otra debajo: primero el piso.
// Al llenarla, la persiana baja. Puntero: arrastrar una caja a su casilla (o tocar la casilla). Teclado: flechas
// para elegir la casilla y Enter o Espacio para subir una caja.

import { createStage, createCelebration, palette, clamp, lerp, easeOutBack, easeOutCubic, roundRect, withAlpha, drawSuccess } from "./canvas-kit.js";

const H = 320;
export const COLS = 4;
export const ROWS = 2; // fila 0 = piso, fila 1 = arriba
export const OLD_CRATES = 3;
export const CRATES = COLS * ROWS - OLD_CRATES; // las que hay que subir
const SLOT = 52;
const BAY = { x: 232, y: 116, w: COLS * SLOT, h: ROWS * SLOT };
const CRATE = 46;
const DOCK = { x: 16, y: 240, w: 190 };
const DOOR_MS = 550;

// ---------- Lógica pura ----------
export const slotIndex = (col, row) => row * COLS + col;
export const slotCol = (i) => i % COLS;
export const slotRow = (i) => Math.floor(i / COLS);
// Las 3 cajas viejas ocupan el piso salvo una columna al azar
export function createLoading(rng = Math.random) {
    const emptyCol = Math.floor(rng() * COLS) % COLS;
    const slots = Array(COLS * ROWS).fill(null);
    for (let c = 0; c < COLS; c++) if (c !== emptyCol) slots[slotIndex(c, 0)] = "old";
    return { slots, placed: 0 };
}
// ¿Se puede poner una caja? La casilla debe estar libre y, si es de arriba, tener una caja debajo
export function canPlace(s, i) {
    if (!(i >= 0 && i < s.slots.length) || s.slots[i]) return false;
    return slotRow(i) === 0 || Boolean(s.slots[i - COLS]);
}
// Motivo por el que no se puede (para el aviso): "occupied" | "unsupported" | null
export function placeProblem(s, i) {
    if (!(i >= 0 && i < s.slots.length)) return "occupied";
    if (s.slots[i]) return "occupied";
    return canPlace(s, i) ? null : "unsupported";
}
export function place(s, i) {
    if (!canPlace(s, i) || s.placed >= CRATES) return s;
    const slots = [...s.slots];
    slots[i] = "crate";
    return { slots, placed: s.placed + 1 };
}
export const isLoaded = (s) => s.slots.every(Boolean);
export const validSlots = (s) => s.slots.map((_, i) => i).filter((i) => canPlace(s, i));

const slotRect = (i) => ({ x: BAY.x + slotCol(i) * SLOT, y: BAY.y + (ROWS - 1 - slotRow(i)) * SLOT, w: SLOT, h: SLOT });
const slotAt = (p) => {
    for (let i = 0; i < COLS * ROWS; i++) {
        const r = slotRect(i);
        if (p.x >= r.x - 10 && p.x <= r.x + r.w + 10 && p.y >= r.y - 10 && p.y <= r.y + r.h + 10) return i;
    }
    return -1;
};
// Cajas que esperan en el muelle: 3 abajo y 2 encima
const dockSpot = (k) => (k < 3 ? { x: DOCK.x + 14 + k * 58, y: DOCK.y - CRATE } : { x: DOCK.x + 43 + (k - 3) * 58, y: DOCK.y - CRATE * 2 - 2 });

function drawCrate(ctx, x, y, kind, pal) {
    const old = kind === "old";
    roundRect(ctx, x, y, CRATE, CRATE, 3, old ? "#78716c" : "#d97706", old ? "#44403c" : "#92400e", 2);
    ctx.fillStyle = withAlpha("#ffffff", old ? 0.08 : 0.18);
    ctx.fillRect(x + CRATE / 2 - 4, y + 2, 8, CRATE - 4);
    ctx.strokeStyle = withAlpha("#000000", 0.25);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + CRATE - 4, y + CRATE - 4);
    ctx.stroke();
    if (!old) {
        roundRect(ctx, x + 9, y + 16, CRATE - 18, 14, 2, "#fef3c7");
        ctx.fillStyle = "#7c2d12";
        ctx.font = `800 9px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText("CURA", x + CRATE / 2, y + 26);
    }
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Carga", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let s = createLoading(rng);
    let cursor = validSlots(s)[0] ?? 0;
    let drag = null; // { x, y, ox, oy } caja que se arrastra
    const falling = []; // { i, fromX, fromY, at }
    const returning = []; // { fromX, fromY, k, at }
    let sink = 0; // cuánto se hunde el camión (px)
    let sinkV = 0;
    let doorAt = null;
    stage.status("Sube las 5 cajas de suero al camión. Primero el piso: arriba solo con una caja debajo");

    const dockLeft = () => CRATES - s.placed - (drag ? 1 : 0);

    function problemText(i) {
        const why = placeProblem(s, i);
        return why === "occupied" ? "Esa casilla ya está ocupada" : "Esa casilla no tiene caja debajo: primero el piso";
    }
    function tryPlace(i, from, now) {
        if (done.active || doorAt !== null) return false;
        if (!canPlace(s, i)) {
            sfx("error");
            stage.status(problemText(i));
            return false;
        }
        s = place(s, i);
        falling.push({ i, fromX: from.x, fromY: from.y, at: now });
        sfx("tick");
        if (isLoaded(s)) {
            stage.status("¡Camión lleno! Cerrando la persiana…");
            doorAt = now + 300;
        } else stage.status(`Caja ${s.placed} de ${CRATES} cargada`);
        if (!canPlace(s, cursor)) cursor = validSlots(s)[0] ?? cursor;
        return true;
    }

    stage.onPointer({
        down(p) {
            if (done.active || doorAt !== null) return;
            // ¿una caja del muelle? (se toma la de más arriba que esté bajo el puntero)
            for (let k = dockLeft() - 1; k >= 0; k--) {
                const q = dockSpot(k);
                if (p.x >= q.x && p.x <= q.x + CRATE && p.y >= q.y && p.y <= q.y + CRATE) {
                    drag = { x: q.x, y: q.y, ox: p.x - q.x, oy: p.y - q.y };
                    sfx("tick");
                    return;
                }
            }
            // ¿una casilla? Tocarla sube la siguiente caja (atajo accesible)
            const i = slotAt(p);
            if (i !== -1) {
                cursor = i;
                const from = dockSpot(Math.max(0, dockLeft() - 1));
                tryPlace(i, from, performance.now());
            }
        },
        move(p, e, active) {
            if (!drag || !active) return;
            drag.x = p.x - drag.ox;
            drag.y = p.y - drag.oy;
        },
        up() {
            if (!drag) return;
            const from = { x: drag.x, y: drag.y };
            const i = slotAt({ x: drag.x + CRATE / 2, y: drag.y + CRATE / 2 });
            drag = null;
            const now = performance.now();
            if (i === -1 || !tryPlace(i, from, now)) returning.push({ fromX: from.x, fromY: from.y, k: dockLeft() - 1, at: now });
        },
    });

    function onKeyDown(event) {
        const c = slotCol(cursor);
        const r = slotRow(cursor);
        if (event.key === "ArrowLeft") cursor = slotIndex((c + COLS - 1) % COLS, r);
        else if (event.key === "ArrowRight") cursor = slotIndex((c + 1) % COLS, r);
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") cursor = slotIndex(c, 1 - r);
        else if (event.key === "Enter" || event.key === " ") {
            if (!event.repeat) tryPlace(cursor, dockSpot(Math.max(0, dockLeft() - 1)), performance.now());
        } else return false;
        event.preventDefault();
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        // suspensión del camión: se hunde un poco con cada caja (resorte)
        const targetSink = s.placed * 1.4;
        if (reduceMotion) sink = targetSink;
        else
            for (let t = 0; t < dt; t += 8) {
                const h = Math.min(8, dt - t);
                sinkV += (0.0012 * (targetSink - sink) - 0.04 * sinkV) * h;
                sink += sinkV * h;
            }

        // fondo: bodega y piso
        roundRect(ctx, 0, 0, 560, H, 16, "#a8a29e");
        ctx.fillStyle = "#78716c";
        ctx.fillRect(0, 0, 560, 36);
        for (let x = 0; x < 560; x += 40) {
            ctx.fillStyle = withAlpha("#000000", 0.08);
            ctx.fillRect(x, 36, 2, 250);
        }
        ctx.fillStyle = "#57534e";
        ctx.fillRect(0, 286, 560, 34);
        // muelle
        roundRect(ctx, DOCK.x, DOCK.y, DOCK.w, 46, 4, "#a16207", "#713f12", 2);
        for (let x = DOCK.x + 6; x < DOCK.x + DOCK.w - 6; x += 22) ctx.fillRect(x, DOCK.y + 8, 2, 30);
        ctx.fillStyle = "#fef3c7";
        ctx.font = `800 11px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText(`MUELLE · ${CRATES - s.placed} por subir`, DOCK.x + DOCK.w / 2, DOCK.y + 64);

        // camión (se hunde con la carga)
        ctx.save();
        ctx.translate(0, sink);
        roundRect(ctx, BAY.x - 8, BAY.y + BAY.h, BAY.w + 112, 16, 3, "#334155");
        roundRect(ctx, BAY.x - 8, BAY.y - 8, BAY.w + 16, BAY.h + 16, 4, "#e2e8f0", "#64748b", 3);
        roundRect(ctx, BAY.x, BAY.y, BAY.w, BAY.h, 2, "#1e293b");
        // cabina
        roundRect(ctx, BAY.x + BAY.w + 14, BAY.y + 34, 92, BAY.h - 26, 10, "#2563eb", "#1e3a8a", 3);
        roundRect(ctx, BAY.x + BAY.w + 56, BAY.y + 44, 40, 30, 5, "#bae6fd", "#1e3a8a", 2);
        ctx.restore();
        // ruedas (no se hunden)
        for (const wx of [BAY.x + 36, BAY.x + BAY.w - 30, BAY.x + BAY.w + 82]) {
            ctx.beginPath();
            ctx.arc(wx, BAY.y + BAY.h + 30, 17, 0, Math.PI * 2);
            ctx.fillStyle = "#18181b";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(wx, BAY.y + BAY.h + 30, 7, 0, Math.PI * 2);
            ctx.fillStyle = "#a1a1aa";
            ctx.fill();
        }

        ctx.save();
        ctx.translate(0, sink);
        // casillas y cajas ya puestas
        const animating = new Set(falling.map((f) => f.i));
        const valid = new Set(validSlots(s));
        for (let i = 0; i < COLS * ROWS; i++) {
            const r = slotRect(i);
            if (!s.slots[i]) {
                ctx.strokeStyle = valid.has(i) ? withAlpha(pal.infected, 0.7) : withAlpha("#94a3b8", 0.3);
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 4]);
                ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
                ctx.setLineDash([]);
            } else if (!animating.has(i)) drawCrate(ctx, r.x + 3, r.y + 3, s.slots[i], pal);
            if (i === cursor && !done.active) {
                ctx.strokeStyle = pal.accent;
                ctx.lineWidth = 3;
                ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
            }
        }
        ctx.restore();
        // cajas que caen a su casilla (rebote)
        for (let j = falling.length - 1; j >= 0; j--) {
            const f = falling[j];
            const t = reduceMotion ? 1 : clamp((now - f.at) / 380, 0, 1);
            const r = slotRect(f.i);
            const k = easeOutBack(t);
            drawCrate(ctx, lerp(f.fromX, r.x + 3, easeOutCubic(t)), lerp(f.fromY, r.y + 3 + sink, k), "crate", pal);
            if (t >= 1) {
                falling.splice(j, 1);
                stage.burst(r.x + SLOT / 2, r.y + SLOT + sink, "#fde68a", 8);
            }
        }
        // persiana que baja al llenar el camión
        if (doorAt !== null) {
            const t = reduceMotion ? 1 : clamp((now - doorAt) / DOOR_MS, 0, 1);
            const h = BAY.h * easeOutCubic(t);
            ctx.fillStyle = "#94a3b8";
            ctx.fillRect(BAY.x, BAY.y + sink, BAY.w, h);
            ctx.fillStyle = "#64748b";
            for (let y = BAY.y + 6; y < BAY.y + h; y += 9) ctx.fillRect(BAY.x, y + sink, BAY.w, 2);
            if (t >= 1 && !done.active) {
                sfx("done");
                stage.status("Camión cargado");
                done.start(now);
            }
        }
        // cajas del muelle (la que vuelve, la que se arrastra)
        const waiting = dockLeft() - returning.length;
        for (let k = 0; k < waiting; k++) {
            const q = dockSpot(k);
            drawCrate(ctx, q.x, q.y, "crate", pal);
        }
        for (let j = returning.length - 1; j >= 0; j--) {
            const b = returning[j];
            const t = reduceMotion ? 1 : clamp((now - b.at) / 300, 0, 1);
            const q = dockSpot(Math.max(0, b.k));
            drawCrate(ctx, lerp(b.fromX, q.x, easeOutCubic(t)), lerp(b.fromY, q.y, easeOutCubic(t)), "crate", pal);
            if (t >= 1) returning.splice(j, 1);
        }
        if (drag) {
            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = 12;
            ctx.shadowOffsetY = 6;
            drawCrate(ctx, drag.x, drag.y, "crate", pal);
            ctx.restore();
        }
        stage.drawParticles(dt);
        ctx.fillStyle = "#292524";
        ctx.font = `800 13px ${pal.fontMono}`;
        ctx.textAlign = "left";
        ctx.fillText(`CARGA ${s.placed}/${CRATES}`, 20, 24);
        const where = (i) => `${i + 1} (${slotRow(i) === 0 ? "piso" : "arriba"}, columna ${slotCol(i) + 1})`;
        stage.label(
            `Carga: ${s.placed} de ${CRATES} cajas; casillas numeradas 1 a 4 en el piso y 5 a 8 arriba; se puede cargar en ${validSlots(s).map((i) => i + 1).join(", ") || "ninguna"}; seleccionada la casilla ${where(cursor)}`,
        );
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
