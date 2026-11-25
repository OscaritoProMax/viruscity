// Minijuego "Dosificador" (farmacia-1, Preparar el suero base).
// Mantener pulsado para verter del matraz al vaso y soltar cuando el nivel quede dentro de la franja dorada.
// Si se pasa de la franja, el vaso se vacía y se vuelve a intentar.
// Puntero: mantener pulsado sobre el lienzo. Teclado: mantener Espacio o Enter.

import { createStage, createCelebration, palette, clamp, lerp, easeOutCubic, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const POUR_RATE = 0.24; // fracción del vaso por segundo
export const BAND_HEIGHT = 0.1;
export const DRAIN_MS = 700;
const BEAKER = { x: 250, y: 104, w: 150, h: 196 }; // interior del vaso

// ---------- Lógica pura ----------
export function createDosing(rng = Math.random) {
    const lo = 0.5 + rng() * 0.3;
    return { band: [lo, lo + BAND_HEIGHT], level: 0 };
}
export const pour = (level, dtMs, rate = POUR_RATE) => clamp(level + (rate * dtMs) / 1000, 0, 1);
export const levelInBand = (level, band) => level >= band[0] && level <= band[1];
export const overflowed = (level, band) => level > band[1];
// Resultado de soltar: "ok" (dentro de la franja), "short" (falta) u "over" (se pasó)
export function releaseResult(level, band) {
    if (levelInBand(level, band)) return "ok";
    return overflowed(level, band) ? "over" : "short";
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Dosificador", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    const st = createDosing(rng);
    let pouring = false;
    let tilt = 0; // 0..1 inclinación del matraz
    let drainFrom = null; // { level, at }
    let shownLevel = 0;
    const drops = [];
    stage.status("Mantén pulsado para verter y suelta dentro de la franja dorada");

    function start() {
        if (done.active || drainFrom) return;
        pouring = true;
        sfx("tick");
    }
    function stop(now) {
        if (!pouring) return;
        pouring = false;
        const r = releaseResult(st.level, st.band);
        if (r === "ok") {
            sfx("done");
            stage.status("¡Dosis exacta!");
            done.start(now);
        } else if (r === "short") stage.status("Falta un poco: vuelve a verter");
    }

    stage.onPointer({ down: () => start(), up: () => stop(performance.now()) });
    const POUR_KEYS = ["Enter", " "];
    function onKeyDown(event) {
        if (!POUR_KEYS.includes(event.key)) return false;
        event.preventDefault();
        if (!event.repeat) start();
        return true;
    }
    function onKeyUp(event) {
        if (!POUR_KEYS.includes(event.key)) return false;
        stop(performance.now());
        return true;
    }
    const onBlur = () => stop(performance.now());
    window.addEventListener("blur", onBlur);

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        // física simple: verter, pasarse y vaciar
        if (drainFrom) {
            const t = clamp((now - drainFrom.at) / DRAIN_MS, 0, 1);
            st.level = lerp(drainFrom.level, 0, easeOutCubic(t));
            if (t >= 1) {
                drainFrom = null;
                st.level = 0;
                stage.status("Vaso vacío: vuelve a intentarlo");
            }
        } else if (pouring && tilt > 0.6) {
            st.level = pour(st.level, dt);
            if (overflowed(st.level, st.band)) {
                pouring = false;
                drainFrom = { level: st.level, at: now };
                sfx("error");
                stage.status("¡Te pasaste! Se vacía el vaso…");
            }
        }
        tilt = clamp(tilt + (pouring ? 1 : -1) * dt / 220, 0, 1);
        shownLevel = lerp(shownLevel, st.level, reduceMotion ? 1 : 0.25);

        // fondo
        roundRect(ctx, 0, 0, 560, H, 16, "#0d2418");
        roundRect(ctx, 20, 300, 520, 22, 8, "#14532d", "#16a34a", 2);
        // matraz: gira sobre su base al verter; el líquido queda horizontal y baja a medida que se vierte
        const fx = 150;
        const fy = 96;
        const angle = easeOutCubic(tilt) * 1.05;
        const flaskPath = () => {
            ctx.beginPath();
            ctx.moveTo(-12, -60);
            ctx.lineTo(12, -60);
            ctx.lineTo(12, -24);
            ctx.lineTo(44, 34);
            ctx.quadraticCurveTo(46, 44, 34, 44);
            ctx.lineTo(-34, 44);
            ctx.quadraticCurveTo(-46, 44, -44, 34);
            ctx.lineTo(-12, -24);
            ctx.closePath();
        };
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(angle);
        flaskPath();
        ctx.fillStyle = withAlpha("#ffffff", 0.18);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.rotate(-angle); // de vuelta a la horizontal del mundo para la superficie del líquido
        const surface = 4 + st.level * 26 + (pouring && !reduceMotion ? Math.sin(now / 90) * 1.5 : 0);
        ctx.fillStyle = withAlpha(pal.infected, 0.75);
        ctx.fillRect(-80, surface, 160, 120);
        ctx.restore();
        flaskPath();
        ctx.strokeStyle = withAlpha("#e6e9f5", 0.8);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        // chorro desde la boca del matraz (el punto (0, -60) girado) y gotas
        const spoutX = fx + 60 * Math.sin(angle);
        const spoutY = fy - 60 * Math.cos(angle);
        const surfY = BEAKER.y + BEAKER.h * (1 - shownLevel);
        if (tilt > 0.6 && pouring) {
            ctx.strokeStyle = withAlpha(pal.infected, 0.85);
            ctx.lineWidth = 6 + (reduceMotion ? 0 : Math.sin(now / 50));
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(spoutX, spoutY);
            ctx.quadraticCurveTo(BEAKER.x + BEAKER.w * 0.35, spoutY - 6, BEAKER.x + BEAKER.w / 2, surfY);
            ctx.stroke();
            if (!reduceMotion && Math.random() < 0.5) drops.push({ x: BEAKER.x + BEAKER.w / 2 + (Math.random() - 0.5) * 20, y: surfY, vy: -0.12 - Math.random() * 0.1, vx: (Math.random() - 0.5) * 0.15, life: 1 });
        }
        // vaso graduado
        roundRect(ctx, BEAKER.x - 6, BEAKER.y - 10, BEAKER.w + 12, BEAKER.h + 16, 10, withAlpha("#ffffff", 0.1), withAlpha("#e6e9f5", 0.8), 2);
        // franja objetivo
        const by0 = BEAKER.y + BEAKER.h * (1 - st.band[1]);
        const by1 = BEAKER.y + BEAKER.h * (1 - st.band[0]);
        const inBand = levelInBand(st.level, st.band);
        ctx.fillStyle = withAlpha(pal.cure, inBand ? 0.35 : 0.16);
        ctx.fillRect(BEAKER.x, by0, BEAKER.w, by1 - by0);
        ctx.strokeStyle = pal.cure;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        for (const y of [by0, by1]) {
            ctx.beginPath();
            ctx.moveTo(BEAKER.x - 14, y);
            ctx.lineTo(BEAKER.x + BEAKER.w + 14, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        if (inBand) glowCircle(ctx, BEAKER.x + BEAKER.w + 30, (by0 + by1) / 2, 26, pal.cure, 0.6);
        // líquido con superficie que ondula
        if (shownLevel > 0.002) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(BEAKER.x, BEAKER.y, BEAKER.w, BEAKER.h);
            ctx.clip();
            ctx.fillStyle = withAlpha(pal.infected, 0.6);
            ctx.beginPath();
            ctx.moveTo(BEAKER.x, BEAKER.y + BEAKER.h);
            for (let x = 0; x <= BEAKER.w; x += 6) {
                const wave = reduceMotion ? 0 : Math.sin(x / 14 + now / 180) * (pouring ? 3.5 : 1.5);
                ctx.lineTo(BEAKER.x + x, surfY + wave);
            }
            ctx.lineTo(BEAKER.x + BEAKER.w, BEAKER.y + BEAKER.h);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        // marcas de graduación
        ctx.fillStyle = pal.muted;
        ctx.font = `600 10px ${pal.fontMono}`;
        ctx.textAlign = "right";
        for (let k = 1; k < 10; k++) {
            const y = BEAKER.y + BEAKER.h * (1 - k / 10);
            ctx.fillRect(BEAKER.x, y, k % 5 ? 10 : 18, 1.5);
            if (k % 5 === 0) ctx.fillText(`${k * 10}`, BEAKER.x - 10, y + 4);
        }
        // gotas
        for (const d of drops) {
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.vy += 0.0009 * dt;
            d.life -= dt / 500;
            ctx.globalAlpha = clamp(d.life, 0, 1);
            ctx.beginPath();
            ctx.arc(d.x, d.y, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = pal.infected;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        for (let i = drops.length - 1; i >= 0; i--) if (drops[i].life <= 0) drops.splice(i, 1);
        // botón de verter (indicación visual)
        roundRect(ctx, 432, 230, 104, 52, 26, pouring ? pal.infected : pal.panel, pal.infected, 2);
        ctx.fillStyle = pouring ? pal.bg : pal.infected;
        ctx.font = `800 13px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText(pouring ? "VERTIENDO" : "MANTÉN", 484, 261);
        ctx.fillStyle = pal.text;
        ctx.font = `700 14px ${pal.fontMono}`;
        ctx.fillText(`${Math.round(st.level * 100)} %`, BEAKER.x + BEAKER.w / 2, BEAKER.y - 18);
        stage.label(`Dosificador: nivel ${Math.round(st.level * 100)} por ciento; la franja va de ${Math.round(st.band[0] * 100)} a ${Math.round(st.band[1] * 100)}`);
        if (done.active) drawSuccess(ctx, 560, H, done.progress(now), pal);
    });

    return {
        focusTarget: stage.canvas,
        onKeyDown,
        onKeyUp,
        close() {
            window.removeEventListener("blur", onBlur);
            stage.destroy();
        },
    };
}
