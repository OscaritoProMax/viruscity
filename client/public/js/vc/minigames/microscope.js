// Minijuego "Microscopio" (laboratorio-1, Analizar la muestra del paciente cero).
// 1) Enfocar: girar la perilla hasta que la muestra deje de verse borrosa (mantenerla enfocada un instante).
// 2) Identificar: tocar la única célula infectada (late en verde) entre las sanas.
// Puntero: arrastrar la perilla (o tocar su barra) y tocar la célula. Teclado: ↑/↓ enfocan; luego ←/→ eligen
// una célula y Enter o Espacio la marcan.

import { createStage, createCelebration, palette, clamp, lerp, dist, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const FOCUS_TOLERANCE = 0.045;
export const FOCUS_HOLD_MS = 450;
export const KEY_STEP = 0.02;
export const CELL_COUNT = 9;
const VIEW = { x: 230, y: 170, r: 140 }; // ocular (círculo de la muestra)
const KNOB = { x: 470, y0: 60, y1: 280 }; // barra de la perilla de enfoque

// ---------- Lógica pura ----------
export function createSample(rng = Math.random) {
    const target = 0.25 + rng() * 0.55; // enfoque correcto
    const focus = target > 0.5 ? 0.06 : 0.94; // empieza lejos del enfoque
    const cells = [];
    for (let tries = 0; cells.length < CELL_COUNT && tries < 3000; tries++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * (VIEW.r - 34);
        const x = VIEW.x + Math.cos(a) * d;
        const y = VIEW.y + Math.sin(a) * d;
        if (cells.every((c) => dist(c.x, c.y, x, y) > 50)) cells.push({ x, y, r: 15 + rng() * 6, infected: false });
    }
    cells[Math.floor(rng() * cells.length)].infected = true;
    return { target, focus, cells };
}
export const nudgeFocus = (focus, delta) => clamp(focus + delta, 0, 1);
export const isFocused = (focus, target, tol = FOCUS_TOLERANCE) => Math.abs(focus - target) <= tol;
// desenfoque en píxeles: 0 enfocado y MAX_BLUR en el extremo; baja de forma continua en todo el recorrido,
// así siempre se nota hacia dónde girar la perilla
export const MAX_BLUR = 16;
export const blurFor = (focus, target) => clamp((Math.abs(focus - target) - FOCUS_TOLERANCE * 0.5) * 18, 0, MAX_BLUR);
// índice de la célula bajo el punto (o null)
export function cellAt(cells, x, y) {
    let best = null;
    cells.forEach((c, i) => {
        const d = dist(c.x, c.y, x, y);
        if (d <= c.r + 8 && (best === null || d < best.d)) best = { i, d };
    });
    return best ? best.i : null;
}
export const infectedIndex = (cells) => cells.findIndex((c) => c.infected);

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Microscopio", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    const st = createSample(rng);
    let phase = "focus"; // focus | pick
    let focusedSince = null;
    let dragging = false;
    let pick = 0; // célula elegida con teclado
    let keyPick = false;
    const wrong = new Map(); // célula → hora del error
    stage.status("Gira la perilla hasta que la muestra se vea nítida");

    const focusFromY = (y) => clamp(1 - (y - KNOB.y0) / (KNOB.y1 - KNOB.y0), 0, 1);
    function choose(i, now) {
        if (i === null || phase !== "pick" || done.active) return;
        if (st.cells[i].infected) {
            stage.burst(st.cells[i].x, st.cells[i].y, pal.infected, 22);
            sfx("done");
            stage.status("¡Paciente cero identificado!");
            done.start(now);
        } else {
            wrong.set(i, now);
            sfx("error");
            stage.status("Esa célula está sana: busca la que late en verde");
        }
    }

    stage.onPointer({
        down(p) {
            if (done.active) return;
            if (phase === "focus" && Math.abs(p.x - KNOB.x) < 40 && p.y > KNOB.y0 - 20 && p.y < KNOB.y1 + 20) {
                dragging = true;
                st.focus = focusFromY(p.y);
            } else if (phase === "pick") {
                keyPick = false;
                choose(cellAt(st.cells, p.x, p.y), performance.now());
            }
        },
        move(p, e, pressed) {
            if (dragging && pressed && phase === "focus") st.focus = focusFromY(p.y);
        },
        up() {
            dragging = false;
        },
    });

    function onKeyDown(event) {
        if (done.active) return false;
        const k = event.key;
        if (phase === "focus" && (k === "ArrowUp" || k === "ArrowDown")) {
            event.preventDefault();
            st.focus = nudgeFocus(st.focus, k === "ArrowUp" ? KEY_STEP : -KEY_STEP);
            return true;
        }
        if (phase === "pick" && (k === "ArrowLeft" || k === "ArrowRight")) {
            event.preventDefault();
            keyPick = true;
            pick = (pick + (k === "ArrowRight" ? 1 : -1) + st.cells.length) % st.cells.length;
            stage.status(`Célula ${pick + 1} de ${st.cells.length} seleccionada: Enter para marcarla`);
            return true;
        }
        if (phase === "pick" && (k === "Enter" || k === " ")) {
            event.preventDefault();
            keyPick = true;
            choose(pick, performance.now());
            return true;
        }
        return false;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        // ¿enfocado y sostenido?
        if (phase === "focus") {
            if (isFocused(st.focus, st.target)) {
                focusedSince ??= now;
                if (now - focusedSince >= FOCUS_HOLD_MS) {
                    phase = "pick";
                    sfx("ok");
                    stage.status("Muestra enfocada: toca la célula infectada (la que late en verde)");
                }
            } else focusedSince = null;
        }
        const blur = phase === "pick" ? 0 : blurFor(st.focus, st.target);
        // fondo y cuerpo del microscopio
        roundRect(ctx, 0, 0, 560, H, 16, "#0f1b2d");
        roundRect(ctx, 390, 40, 150, 260, 14, "#1e293b", pal.border, 2);
        // ocular con la muestra
        ctx.save();
        ctx.beginPath();
        ctx.arc(VIEW.x, VIEW.y, VIEW.r, 0, Math.PI * 2);
        ctx.clip();
        const bg = ctx.createRadialGradient(VIEW.x, VIEW.y, 10, VIEW.x, VIEW.y, VIEW.r);
        bg.addColorStop(0, "#f4f9ea");
        bg.addColorStop(1, "#c9dcb8");
        ctx.fillStyle = bg;
        ctx.fillRect(VIEW.x - VIEW.r, VIEW.y - VIEW.r, VIEW.r * 2, VIEW.r * 2);
        if (blur > 0.2 && "filter" in ctx) ctx.filter = `blur(${blur.toFixed(1)}px)`;
        st.cells.forEach((c, i) => {
            const drift = reduceMotion ? 0 : Math.sin(now / 900 + i) * 3;
            const cx = c.x + drift;
            const cy = c.y + (reduceMotion ? 0 : Math.cos(now / 1100 + i * 2) * 3);
            const pulse = c.infected && phase === "pick" && !reduceMotion ? 1 + 0.12 * Math.sin(now / 160) : 1;
            const r = c.r * pulse;
            const w = wrong.get(i);
            const red = w !== undefined && now - w < 500;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r, r * 0.82, i, 0, Math.PI * 2);
            ctx.fillStyle = red ? withAlpha(pal.danger, 0.55) : c.infected ? withAlpha(pal.infected, phase === "pick" ? 0.75 : 0.45) : "rgba(196,120,140,0.55)";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = c.infected ? "#2f7d1a" : "rgba(130,60,80,0.8)";
            ctx.stroke();
            // núcleo
            ctx.beginPath();
            ctx.arc(cx + r * 0.15, cy - r * 0.1, r * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = c.infected ? "#1d5e10" : "rgba(110,40,70,0.75)";
            ctx.fill();
            if (c.infected && phase === "pick") for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2 + now / 700;
                ctx.fillRect(cx + Math.cos(a) * (r + 3) - 1.5, cy + Math.sin(a) * (r * 0.82 + 3) - 1.5, 3, 3);
            }
            if (phase === "pick" && keyPick && pick === i) {
                ctx.beginPath();
                ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
                ctx.strokeStyle = pal.accent;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        });
        ctx.filter = "none";
        ctx.restore();
        ctx.beginPath();
        ctx.arc(VIEW.x, VIEW.y, VIEW.r, 0, Math.PI * 2);
        ctx.lineWidth = 10;
        ctx.strokeStyle = "#334155";
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = phase === "pick" ? pal.cure : pal.border;
        ctx.stroke();
        // perilla de enfoque: barra vertical con la marca del enfoque correcto (se ve al acercarse)
        roundRect(ctx, KNOB.x - 8, KNOB.y0, 16, KNOB.y1 - KNOB.y0, 8, "#0f172a", pal.border, 2);
        const ky = lerp(KNOB.y1, KNOB.y0, st.focus);
        const near = clamp(1 - Math.abs(st.focus - st.target) * 6, 0, 1);
        if (phase === "focus" && near > 0) glowCircle(ctx, KNOB.x, lerp(KNOB.y1, KNOB.y0, st.target), 30, pal.cure, 0.35 * near);
        ctx.save();
        ctx.translate(KNOB.x, ky);
        ctx.rotate(reduceMotion ? 0 : st.focus * 8);
        ctx.beginPath();
        for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const rr = k % 2 ? 22 : 18;
            k ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = phase === "focus" ? pal.accent : pal.muted;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#0f172a";
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = pal.muted;
        ctx.font = `700 11px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText("ENFOQUE", KNOB.x, 304);
        // barra de nitidez
        const sharp = phase === "pick" ? 1 : clamp(1 - blur / MAX_BLUR, 0, 1);
        roundRect(ctx, 410, 316, 120, 10, 5, pal.panel, pal.border, 1);
        roundRect(ctx, 410, 316, Math.max(10, 120 * sharp), 10, 5, sharp > 0.9 ? pal.cure : pal.accent);
        stage.drawParticles(dt);
        stage.label(phase === "focus" ? `Microscopio: nitidez ${Math.round(sharp * 100)} por ciento${isFocused(st.focus, st.target) ? ", enfocado" : ""}` : `Microscopio: muestra enfocada, ${st.cells.length} células; célula ${pick + 1} seleccionada`);
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
