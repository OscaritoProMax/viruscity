// Minijuego "Transferencia" (central-2, Descargar el historial clínico).
// Pulsar "Iniciar": las carpetas viajan del servidor al equipo. Dos veces se cae la señal (la antena parpadea en
// rojo): pulsar "Reconectar" antes de 1,5 s o la barra retrocede. Puntero: tocar el botón. Teclado: Enter o Espacio.

import { createStage, createCelebration, palette, clamp, lerp, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const TRANSFER_MS = 9000; // descarga completa sin cortes
export const RECONNECT_MS = 1500;
export const PENALTY = 0.15;
const BTN = { x: 280, y: 290, w: 190, h: 46 };

// ---------- Lógica pura (reducer) ----------
// phase: idle → running ⇄ dropped → done. drops: progresos donde se cae la señal (dos, en orden)
export function createTransfer(rng = Math.random) {
    return { phase: "idle", progress: 0, drops: [0.22 + rng() * 0.18, 0.58 + rng() * 0.2], nextDrop: 0, droppedFor: 0, misses: 0 };
}
export function stepTransfer(s, dtMs) {
    if (s.phase === "running") {
        const progress = Math.min(1, s.progress + dtMs / TRANSFER_MS);
        if (s.nextDrop < s.drops.length && progress >= s.drops[s.nextDrop]) return { ...s, progress: s.drops[s.nextDrop], phase: "dropped", droppedFor: 0 };
        return progress >= 1 ? { ...s, progress: 1, phase: "done" } : { ...s, progress };
    }
    if (s.phase === "dropped") {
        const droppedFor = s.droppedFor + dtMs;
        if (droppedFor < RECONNECT_MS) return { ...s, droppedFor };
        // no reconectó a tiempo: la barra retrocede y la descarga sigue (esa caída cuenta como pasada)
        return { ...s, phase: "running", progress: Math.max(0, s.progress - PENALTY), nextDrop: s.nextDrop + 1, droppedFor: 0, misses: s.misses + 1 };
    }
    return s;
}
// Pulsar el botón: Iniciar (idle) o Reconectar (dropped); en otras fases no hace nada
export function pressTransfer(s) {
    if (s.phase === "idle") return { ...s, phase: "running" };
    if (s.phase === "dropped") return { ...s, phase: "running", nextDrop: s.nextDrop + 1, droppedFor: 0 };
    return s;
}
export const isTransferred = (s) => s.phase === "done";

function computer(ctx, x, y, label, glow, pal, on) {
    roundRect(ctx, x - 62, y - 50, 124, 84, 8, "#0f172a", pal.border, 2);
    roundRect(ctx, x - 54, y - 42, 108, 66, 4, on ? withAlpha(glow, 0.2) : "#020617");
    ctx.fillStyle = "#334155";
    ctx.fillRect(x - 10, y + 34, 20, 16);
    ctx.fillRect(x - 34, y + 50, 68, 6);
    ctx.fillStyle = pal.muted;
    ctx.font = `700 11px ${pal.fontMono}`;
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 72);
}
function folder(ctx, x, y, col) {
    roundRect(ctx, x - 13, y - 8, 12, 5, 2, col);
    roundRect(ctx, x - 13, y - 5, 26, 18, 3, col, withAlpha("#000000", 0.35), 1);
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Transferencia", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let s = createTransfer(rng);
    let lastPhase = s.phase;
    stage.status("Pulsa «Iniciar» para descargar el historial clínico");

    function press() {
        if (done.active) return;
        const before = s.phase;
        s = pressTransfer(s);
        if (before === "idle") sfx("tick");
        if (before === "dropped") {
            sfx("ok");
            stage.status("Señal recuperada: la descarga sigue");
        }
    }
    stage.onPointer({
        down(p) {
            if (Math.abs(p.x - BTN.x) <= BTN.w / 2 && Math.abs(p.y - BTN.y) <= BTN.h / 2) press();
        },
    });
    function onKeyDown(event) {
        if (event.key !== "Enter" && event.key !== " ") return false;
        event.preventDefault();
        if (!event.repeat) press();
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        if (!done.active) {
            const prev = s;
            s = stepTransfer(s, dt);
            if (s.phase !== lastPhase) {
                if (s.phase === "dropped") {
                    sfx("error");
                    stage.status("¡Señal perdida! Pulsa «Reconectar» rápido");
                } else if (s.phase === "running" && prev.phase === "dropped" && s.misses > prev.misses) stage.status("Se perdieron datos: la descarga retrocedió");
                else if (s.phase === "done") {
                    sfx("done");
                    stage.status("¡Historial clínico descargado!");
                    done.start(now);
                }
                lastPhase = s.phase;
            }
        }
        const dropped = s.phase === "dropped";
        const blink = dropped && (reduceMotion || Math.floor(now / 180) % 2 === 0);
        roundRect(ctx, 0, 0, 560, H, 16, "#070f22");
        computer(ctx, 90, 120, "SERVIDOR CENTRAL", pal.accent, pal, s.phase !== "idle");
        computer(ctx, 470, 120, "TU EQUIPO", pal.infected, pal, s.phase !== "idle");
        // antena con ondas
        const ax = 280;
        const ay = 92;
        ctx.fillStyle = "#64748b";
        ctx.fillRect(ax - 3, ay, 6, 70);
        ctx.beginPath();
        ctx.arc(ax, ay, 8, 0, Math.PI * 2);
        ctx.fillStyle = dropped ? (blink ? pal.danger : "#3f1220") : pal.accent;
        ctx.fill();
        if (dropped) glowCircle(ctx, ax, ay, 40, pal.danger, blink ? 0.55 : 0.15);
        else if (s.phase === "running") {
            for (let k = 0; k < 3; k++) {
                const t = reduceMotion ? k / 3 : ((now / 900 + k / 3) % 1);
                ctx.beginPath();
                ctx.arc(ax, ay, 12 + t * 40, Math.PI * 1.15, Math.PI * 1.85);
                ctx.strokeStyle = withAlpha(pal.accent, 1 - t);
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }
        // carpetas viajando por el arco
        if (s.phase === "running" && !reduceMotion) {
            for (let k = 0; k < 3; k++) {
                const t = (now / 1400 + k / 3) % 1;
                const x = lerp(150, 410, t);
                const y = 120 - Math.sin(t * Math.PI) * 70;
                folder(ctx, x, y, pal.cure);
            }
        }
        if (dropped) {
            ctx.fillStyle = blink ? pal.danger : withAlpha(pal.danger, 0.5);
            ctx.font = `900 16px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText("SEÑAL PERDIDA", ax, 196);
            const left = clamp(1 - s.droppedFor / RECONNECT_MS, 0, 1);
            roundRect(ctx, ax - 60, 204, 120, 6, 3, pal.panel);
            roundRect(ctx, ax - 60, 204, Math.max(6, 120 * left), 6, 3, pal.danger);
        }
        // barra de progreso
        roundRect(ctx, 40, 228, 480, 22, 11, pal.panel, pal.border, 1.5);
        roundRect(ctx, 40, 228, Math.max(22, 480 * s.progress), 22, 11, dropped ? pal.danger : pal.cure);
        ctx.fillStyle = pal.text;
        ctx.font = `700 12px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(s.progress * 100)} %`, 280, 244);
        // botón
        const label = s.phase === "idle" ? "INICIAR" : dropped ? "RECONECTAR" : s.phase === "done" ? "LISTO" : "DESCARGANDO…";
        const active = s.phase === "idle" || dropped;
        roundRect(ctx, BTN.x - BTN.w / 2, BTN.y - BTN.h / 2, BTN.w, BTN.h, 23, active ? (dropped ? pal.danger : pal.accent) : pal.panel, active ? "#ffffff" : pal.border, 2);
        ctx.fillStyle = active ? pal.bg : pal.muted;
        ctx.font = `900 14px ${pal.fontMono}`;
        ctx.fillText(label, BTN.x, BTN.y + 5);
        stage.label(`Transferencia: ${Math.round(s.progress * 100)} por ciento; ${s.phase === "idle" ? "sin iniciar" : dropped ? "señal perdida, reconecta" : s.phase === "done" ? "completa" : "descargando"}`);
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
