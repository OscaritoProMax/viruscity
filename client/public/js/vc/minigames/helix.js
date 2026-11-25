// Minijuego "Doble hélice" (laboratorio-2, Secuenciar el genoma del virus).
// La hebra de abajo tiene 6 huecos: completarlos en orden con la base complementaria de la de arriba
// (A con T, C con G). Puntero: tocar la base en los botones. Teclado: teclas A, T, C o G (o ←/→ y Enter).

import { createStage, createCelebration, palette, clamp, easeOutBack, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const BASES = Object.freeze(["A", "T", "C", "G"]);
export const STRAND_LENGTH = 10;
export const GAP_COUNT = 6;
const PAIRS = { A: "T", T: "A", C: "G", G: "C" };
const BASE_TOKEN = { A: "danger", T: "cure", C: "accent", G: "infected" };
const X0 = 46;
const STEP = 52;
const MID = 150;
const BTN_Y = 268;

// ---------- Lógica pura ----------
export const complement = (b) => PAIRS[b] ?? null;
export function createStrand(rng = Math.random, length = STRAND_LENGTH, gaps = GAP_COUNT) {
    const top = Array.from({ length }, () => BASES[Math.floor(rng() * 4)]);
    const order = Array.from({ length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    const holes = order.slice(0, gaps).sort((a, b) => a - b);
    return { top, holes, filled: [] }; // filled: bases puestas en los huecos, en orden
}
export const currentHole = (st) => (st.filled.length < st.holes.length ? st.holes[st.filled.length] : null);
// Pone una base en el hueco actual: { state, ok } (si no es la complementaria, el estado no cambia)
export function placeBase(st, base) {
    const hole = currentHole(st);
    if (hole === null || complement(st.top[hole]) !== base) return { state: st, ok: false };
    return { state: { ...st, filled: [...st.filled, base] }, ok: true };
}
export const isSequenced = (st) => st.filled.length === st.holes.length;

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const colorOf = (b) => pal[BASE_TOKEN[b]];
    const stage = createStage(container, { height: H, label: "Doble hélice", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let st = createStrand(rng);
    let shakeAt = -1;
    const placedAt = new Map(); // posición → hora
    let sel = 0; // botón elegido con ←/→
    let keySel = false;
    const say = () => stage.status(isSequenced(st) ? "¡Genoma secuenciado!" : `Completa la hebra: base complementaria del hueco marcado · ${st.filled.length} de ${GAP_COUNT}`);
    say();

    function put(base, now) {
        if (done.active) return;
        const hole = currentHole(st);
        const r = placeBase(st, base);
        if (r.ok) {
            st = r.state;
            placedAt.set(hole, now);
            stage.burst(X0 + hole * STEP, MID + 46, colorOf(base), 14);
            sfx("ok");
            say();
            if (isSequenced(st)) {
                sfx("done");
                done.start(now);
            }
        } else {
            shakeAt = now;
            sfx("error");
            stage.status(`${base} no va con ${st.top[hole]}: recuerda A con T y C con G`);
        }
    }
    const btnX = (i) => 130 + i * 100;

    stage.onPointer({
        down(p) {
            keySel = false;
            BASES.forEach((b, i) => {
                if (Math.abs(p.x - btnX(i)) < 40 && Math.abs(p.y - BTN_Y) < 30) put(b, performance.now());
            });
        },
    });

    function onKeyDown(event) {
        if (done.active) return false;
        const k = event.key.toUpperCase();
        if (BASES.includes(k)) {
            event.preventDefault();
            put(k, performance.now());
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
            put(BASES[sel], performance.now());
            return true;
        }
        return false;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        const phase = reduceMotion ? 0 : now / 900;
        roundRect(ctx, 0, 0, 560, H, 16, "#0c1426");
        // las dos hebras ondulan (hélice): y = MID ± A·cos(fase)
        const amp = (i) => 40 * Math.cos(phase + i * 0.62);
        const hole = currentHole(st);
        const shake = shakeAt > 0 && now - shakeAt < 350 ? Math.sin((now - shakeAt) / 25) * 6 : 0;
        for (const side of [-1, 1]) {
            ctx.beginPath();
            for (let i = 0; i < STRAND_LENGTH; i++) {
                const x = X0 + i * STEP;
                const y = MID + side * amp(i);
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.strokeStyle = withAlpha(side < 0 ? pal.accent : pal.infected, 0.55);
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        // peldaños y bases
        for (let i = 0; i < STRAND_LENGTH; i++) {
            const x = X0 + i * STEP;
            const a = amp(i);
            const front = Math.cos(phase + i * 0.62) > 0;
            const yTop = MID - a;
            const yBot = MID + a;
            const isHole = st.holes.includes(i);
            const k = st.holes.indexOf(i);
            const filledBase = isHole && k < st.filled.length ? st.filled[k] : null;
            const bottom = isHole ? filledBase : complement(st.top[i]);
            ctx.strokeStyle = withAlpha("#e6e9f5", front ? 0.35 : 0.15);
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, yTop);
            ctx.lineTo(x, yBot);
            ctx.stroke();
            const drawBase = (b, y, alpha = 1, scale = 1) => {
                roundRect(ctx, x - 17 * scale, y - 15 * scale, 34 * scale, 30 * scale, 8, withAlpha(colorOf(b), 0.9 * alpha), withAlpha("#000000", 0.35), 1.5);
                ctx.fillStyle = "#0b1020";
                ctx.font = `900 ${Math.round(17 * scale)}px ${pal.fontMono}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(b, x, y + 1);
                ctx.textBaseline = "alphabetic";
            };
            drawBase(st.top[i], yTop, front ? 1 : 0.55);
            if (bottom) {
                const t = placedAt.has(i) ? clamp((now - placedAt.get(i)) / 260, 0, 1) : 1;
                drawBase(bottom, yBot, front ? 1 : 0.55, reduceMotion ? 1 : easeOutBack(t));
                if (placedAt.has(i) && t < 1) glowCircle(ctx, x, yBot, 34, colorOf(bottom), 0.6 * (1 - t));
            } else {
                // hueco: el actual late y tiembla si te equivocas
                const current = i === hole;
                const dx = current ? shake : 0;
                roundRect(ctx, x - 17 + dx, yBot - 15, 34, 30, 8, withAlpha(pal.panel, 0.9), current ? pal.cure : pal.border, current ? 3 : 1.5);
                ctx.fillStyle = current ? pal.cure : pal.muted;
                ctx.font = `900 17px ${pal.fontMono}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("?", x + dx, yBot + 1);
                ctx.textBaseline = "alphabetic";
                if (current && !reduceMotion) glowCircle(ctx, x, yBot, 30, pal.cure, 0.25 + 0.15 * Math.sin(now / 200));
            }
        }
        // botones de bases
        BASES.forEach((b, i) => {
            const x = btnX(i);
            roundRect(ctx, x - 38, BTN_Y - 26, 76, 52, 12, withAlpha(colorOf(b), 0.18), keySel && sel === i ? pal.accent : colorOf(b), keySel && sel === i ? 3 : 2);
            ctx.fillStyle = colorOf(b);
            ctx.font = `900 24px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(b, x, BTN_Y + 1);
            ctx.textBaseline = "alphabetic";
        });
        ctx.fillStyle = pal.muted;
        ctx.font = `600 11px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText("A ↔ T     C ↔ G", 280, 22);
        stage.drawParticles(dt);
        const holeTxt = hole === null ? "completa" : `hueco frente a ${st.top[hole]}`;
        stage.label(`Doble hélice: ${st.filled.length} de ${GAP_COUNT} bases puestas; ${holeTxt}`);
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
