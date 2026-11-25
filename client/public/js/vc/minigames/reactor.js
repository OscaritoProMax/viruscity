// Minijuego "Secuencia del reactor" (planta-2, Purificar el reactor).
// El reactor enciende una serie de luces y hay que repetirla. Son 3 rondas que crecen (3, 4 y 5 luces): cada ronda
// repite la anterior y agrega una luz. Con cada ronda el núcleo se aclara. Si te equivocas, el reactor vuelve a
// mostrar la serie de esa ronda.
// Puntero: tocar las luces. Teclado: flechas (↑ amarilla, → azul, ↓ verde, ← roja) o 1, 2, 3, 4.

import { createStage, createCelebration, palette, clamp, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const ROUND_LENGTHS = [3, 4, 5];
export const LIGHT_COUNT = 4;
export const SHOW_ON_MS = 430; // cada luz de la serie encendida
export const SHOW_GAP_MS = 190; // pausa entre luces
export const SHOW_LEAD_MS = 650; // pausa antes de empezar a mostrar
export const PRESS_FLASH_MS = 220;

const CORE = { x: 280, y: 166 };
const LIGHT_R = 34;
const ORBIT = 112;
// Orden de las luces: 0 arriba (amarilla), 1 derecha (azul), 2 abajo (verde), 3 izquierda (roja)
export const LIGHTS = Object.freeze([
    { name: "amarilla", color: "#facc15", key: "ArrowUp", dx: 0, dy: -1 },
    { name: "azul", color: "#38bdf8", key: "ArrowRight", dx: 1, dy: 0 },
    { name: "verde", color: "#4ade80", key: "ArrowDown", dx: 0, dy: 1 },
    { name: "roja", color: "#ef4444", key: "ArrowLeft", dx: -1, dy: 0 },
]);
const lightPos = (i) => ({ x: CORE.x + LIGHTS[i].dx * ORBIT * 1.35, y: CORE.y + LIGHTS[i].dy * ORBIT });

// ---------- Lógica pura ----------
// Una serie de 5 luces; la ronda r usa sus primeras ROUND_LENGTHS[r]. Nunca la misma luz tres veces seguidas.
export function createReactor(rng = Math.random) {
    const seq = [];
    while (seq.length < ROUND_LENGTHS[ROUND_LENGTHS.length - 1]) {
        const k = Math.floor(rng() * LIGHT_COUNT) % LIGHT_COUNT;
        if (seq.length >= 2 && seq[seq.length - 1] === k && seq[seq.length - 2] === k) continue;
        seq.push(k);
    }
    return { seq, round: 0, pos: 0, phase: "watch" };
}
export const roundSequence = (s) => s.seq.slice(0, ROUND_LENGTHS[s.round]);
export const startInput = (s) => (s.phase === "watch" ? { ...s, phase: "input", pos: 0 } : s);
// Pulsar una luz: "ignored" (no es tu turno), "ok" (bien, sigue), "wrong" (se repite la ronda),
// "round" (ronda completa, pasa a la siguiente) o "done" (reactor purificado)
export function pressLight(s, k) {
    if (s.phase !== "input" || !(k >= 0 && k < LIGHT_COUNT)) return { state: s, result: "ignored" };
    if (s.seq[s.pos] !== k) return { state: { ...s, pos: 0, phase: "watch" }, result: "wrong" };
    const pos = s.pos + 1;
    if (pos < ROUND_LENGTHS[s.round]) return { state: { ...s, pos }, result: "ok" };
    if (s.round + 1 >= ROUND_LENGTHS.length) return { state: { ...s, pos, phase: "done" }, result: "done" };
    return { state: { ...s, round: s.round + 1, pos: 0, phase: "watch" }, result: "round" };
}
export const isPurified = (s) => s.phase === "done";
// Qué luz muestra el reactor a los `elapsed` ms de empezar la serie: índice de luz, null (pausa) o -1 (terminó)
export function showingAt(sequence, elapsed) {
    const t = elapsed - SHOW_LEAD_MS;
    if (t < 0) return null;
    const step = SHOW_ON_MS + SHOW_GAP_MS;
    const i = Math.floor(t / step);
    if (i >= sequence.length) return -1;
    return t - i * step < SHOW_ON_MS ? sequence[i] : null;
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Secuencia del reactor", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let s = createReactor(rng);
    let showStart = null; // inicio de la serie que se está mostrando
    let pressed = null; // { k, at } última luz pulsada (destello)
    let shakeAt = -1e9;
    let clarity = 0; // 0 (núcleo turbio) → 1 (limpio), animado
    let lastShown = null;
    stage.status("Observa la secuencia del reactor y repítela");

    function press(k, now) {
        if (done.active) return;
        const r = pressLight(s, k);
        if (r.result === "ignored") return;
        s = r.state;
        pressed = { k, at: now };
        if (r.result === "ok") {
            sfx("tick");
            stage.status(`Bien: ${s.pos} de ${ROUND_LENGTHS[s.round]}`);
        } else if (r.result === "wrong") {
            sfx("error");
            shakeAt = now;
            showStart = now + 500;
            stage.status("Secuencia incorrecta: mira otra vez");
        } else if (r.result === "round") {
            sfx("ok");
            showStart = now + 400;
            stage.status(`Ronda superada. Ronda ${s.round + 1} de ${ROUND_LENGTHS.length}: observa`);
        } else if (r.result === "done") {
            sfx("done");
            stage.status("Reactor purificado");
            done.start(now + PRESS_FLASH_MS);
        }
    }

    stage.onPointer({
        down(p) {
            const k = LIGHTS.findIndex((_, i) => {
                const q = lightPos(i);
                return Math.hypot(p.x - q.x, p.y - q.y) <= LIGHT_R + 8;
            });
            if (k !== -1) press(k, performance.now());
        },
    });

    function onKeyDown(event) {
        if (event.repeat) return false;
        let k = LIGHTS.findIndex((l) => l.key === event.key);
        const n = Number(event.key);
        if (k === -1 && n >= 1 && n <= LIGHT_COUNT) k = n - 1;
        if (k === -1) return false;
        event.preventDefault();
        press(k, performance.now());
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        if (showStart === null) showStart = now;
        // serie que muestra el reactor
        let lit = null;
        if (s.phase === "watch") {
            const shown = showingAt(roundSequence(s), now - showStart);
            if (shown === -1) {
                s = startInput(s);
                stage.status(`Tu turno: repite las ${ROUND_LENGTHS[s.round]} luces`);
            } else {
                lit = shown;
                if (lit !== null && lit !== lastShown) sfx("tick");
            }
        }
        lastShown = lit;
        if (pressed && now - pressed.at < PRESS_FLASH_MS) lit = pressed.k;
        const targetClarity = isPurified(s) ? 1 : s.round / ROUND_LENGTHS.length;
        clarity += (targetClarity - clarity) * (reduceMotion ? 1 : clamp(dt / 300, 0, 1));

        // sala
        roundRect(ctx, 0, 0, 560, H, 16, "#18181b");
        ctx.strokeStyle = "#27272a";
        ctx.lineWidth = 1;
        for (let x = 20; x < 560; x += 28) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        // rondas
        for (let r = 0; r < ROUND_LENGTHS.length; r++) {
            const passed = r < s.round || isPurified(s);
            const current = r === s.round && !isPurified(s);
            roundRect(ctx, 24 + r * 30, 20, 22, 10, 5, passed ? pal.infected : current ? pal.cure : "#3f3f46");
        }
        ctx.fillStyle = pal.muted;
        ctx.font = `700 11px ${pal.fontMono}`;
        ctx.textAlign = "left";
        ctx.fillText(s.phase === "input" ? `TU TURNO · ${s.pos}/${ROUND_LENGTHS[s.round]}` : isPurified(s) ? "PURIFICADO" : "OBSERVA", 24, 48);

        // núcleo (tiembla si fallas) y su turbiedad
        const shake = !reduceMotion && now - shakeAt < 380 ? Math.sin((now - shakeAt) / 22) * 6 * (1 - (now - shakeAt) / 380) : 0;
        const cx = CORE.x + shake;
        const murk = 1 - clarity;
        glowCircle(ctx, cx, CORE.y, 96, lit !== null ? LIGHTS[lit].color : "#84cc16", 0.35 + clarity * 0.25);
        roundRect(ctx, cx - 40, CORE.y - 70, 80, 140, 34, "#27272a", "#71717a", 3);
        roundRect(ctx, cx - 30, CORE.y - 60, 60, 120, 26, withAlpha("#ecfccb", 0.25 + clarity * 0.6));
        // partículas de "contaminación" que desaparecen al purificar
        ctx.save();
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(cx - 30, CORE.y - 60, 60, 120, 26) : ctx.rect(cx - 30, CORE.y - 60, 60, 120);
        ctx.clip();
        ctx.fillStyle = withAlpha("#365314", 0.85 * murk);
        ctx.fillRect(cx - 30, CORE.y - 60, 60, 120);
        for (let i = 0; i < 14; i++) {
            const px = cx - 22 + ((i * 37) % 44) + (reduceMotion ? 0 : Math.sin(now / 600 + i) * 4);
            const py = CORE.y - 50 + ((i * 53 + (reduceMotion ? 0 : now / 30)) % 100);
            ctx.globalAlpha = murk;
            ctx.fillStyle = "#1a2e05";
            ctx.beginPath();
            ctx.arc(px, py, 3 + (i % 3), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        for (const y of [CORE.y - 34, CORE.y + 30]) roundRect(ctx, cx - 44, y, 88, 8, 3, "#52525b");

        // luces
        for (let i = 0; i < LIGHT_COUNT; i++) {
            const q = lightPos(i);
            const on = lit === i;
            ctx.strokeStyle = "#3f3f46";
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(cx + LIGHTS[i].dx * 44, CORE.y + LIGHTS[i].dy * 72);
            ctx.lineTo(q.x - LIGHTS[i].dx * LIGHT_R, q.y - LIGHTS[i].dy * LIGHT_R);
            ctx.stroke();
            if (on) glowCircle(ctx, q.x, q.y, LIGHT_R * 2.2, LIGHTS[i].color, 0.8);
            ctx.beginPath();
            ctx.arc(q.x, q.y, LIGHT_R, 0, Math.PI * 2);
            ctx.fillStyle = on ? LIGHTS[i].color : withAlpha(LIGHTS[i].color, s.phase === "input" ? 0.42 : 0.22);
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = on ? "#ffffff" : "#52525b";
            ctx.stroke();
            ctx.fillStyle = on ? "#18181b" : withAlpha("#ffffff", 0.75);
            ctx.font = `800 14px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(String(i + 1), q.x, q.y + 5);
        }
        stage.drawParticles(dt);
        const litText = lit !== null && s.phase === "watch" ? `; encendida la luz ${lit + 1} (${LIGHTS[lit].name})` : "";
        stage.label(
            `Reactor: ronda ${Math.min(s.round + 1, ROUND_LENGTHS.length)} de ${ROUND_LENGTHS.length}; ${s.phase === "input" ? `tu turno, llevas ${s.pos} de ${ROUND_LENGTHS[s.round]}` : isPurified(s) ? "purificado" : "observa la serie"}${litText}`,
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
