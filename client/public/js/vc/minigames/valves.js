// Minijuego "Válvulas" (planta-1, Sintetizar el compuesto).
// Tres válvulas alimentan tres medidores de presión. Hay que dejar las tres agujas en su zona verde A LA VEZ y
// sostenerlas un instante. Cada válvula también empuja un poco el medidor de su derecha (la última, el primero),
// así que no basta con ajustar cada una por separado.
// Puntero: girar el volante arrastrando en círculo (horario abre). Teclado: ← → (o 1, 2, 3) eligen la válvula
// y ↑ ↓ la abren o la cierran.

import { createStage, createCelebration, palette, clamp, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const VALVE_COUNT = 3;
export const COUPLING = 0.3; // cuánto empuja cada válvula al medidor de su derecha
export const ZONE_WIDTH = 0.14; // ancho de la zona verde (fracción de la escala)
export const HOLD_MS = 600; // tiempo con las tres en verde para estabilizar
export const KEY_STEP = 0.02;
export const TURN_RANGE = Math.PI * 2; // una vuelta completa del volante = de cerrada a abierta

const GAUGE_Y = 104;
const WHEEL_Y = 262;
const XS = [120, 280, 440];
const GAUGE_R = 56;
const WHEEL_R = 40;
const ARC_START = Math.PI * 0.8; // la escala va de 144° a 396° (abajo a la izquierda → abajo a la derecha)
const ARC_SWEEP = Math.PI * 1.4;

// ---------- Lógica pura ----------
// Presión de cada medidor: su válvula más COUPLING de la válvula de su izquierda, normalizada a 0..1
export function pressures(valves) {
    const n = valves.length;
    return valves.map((v, k) => clamp((v + COUPLING * valves[(k + n - 1) % n]) / (1 + COUPLING), 0, 1));
}
// La zona verde de cada medidor se arma alrededor de una combinación de válvulas que existe: siempre tiene solución
export function createValves(rng = Math.random) {
    const target = Array.from({ length: VALVE_COUNT }, () => 0.2 + rng() * 0.6);
    const zones = pressures(target).map((p) => [p - ZONE_WIDTH / 2, p + ZONE_WIDTH / 2]);
    return { valves: Array(VALVE_COUNT).fill(0), zones };
}
export const inZone = (p, zone) => p >= zone[0] && p <= zone[1];
export const allInZone = (s) => pressures(s.valves).every((p, k) => inZone(p, s.zones[k]));
export function turnValve(s, k, delta) {
    if (k < 0 || k >= s.valves.length || !Number.isFinite(delta)) return s;
    const valves = [...s.valves];
    valves[k] = clamp(valves[k] + delta, 0, 1);
    return { ...s, valves };
}
// Diferencia de ángulo en (-π, π]: para girar el volante sin saltos al cruzar ±π
export function angleDelta(from, to) {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    return d;
}

const pct = (v) => Math.round(v * 100);

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Válvulas", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let s = createValves(rng);
    let selected = 0;
    let holdMs = 0;
    let wasAll = false;
    const needle = s.valves.map(() => ({ p: 0, v: 0 })); // aguja con inercia (resorte)
    let drag = null; // { k, angle }
    const bubbles = [];
    stage.status("Gira las válvulas hasta dejar las tres agujas en verde a la vez. Ojo: cada válvula también sube el medidor de su derecha");

    function turn(k, delta) {
        if (done.active) return;
        const before = s.valves[k];
        s = turnValve(s, k, delta);
        if (s.valves[k] !== before && !reduceMotion && Math.random() < 0.35) bubbles.push({ x: XS[k] + (Math.random() - 0.5) * 10, y: WHEEL_Y - 50, life: 1 });
    }

    stage.onPointer({
        down(p) {
            const k = XS.findIndex((x) => Math.hypot(p.x - x, p.y - WHEEL_Y) < WHEEL_R + 26);
            if (k === -1) return;
            selected = k;
            drag = { k, angle: Math.atan2(p.y - WHEEL_Y, p.x - XS[k]) };
            sfx("tick");
        },
        move(p, e, active) {
            if (!drag || !active) return;
            const angle = Math.atan2(p.y - WHEEL_Y, p.x - XS[drag.k]);
            turn(drag.k, angleDelta(drag.angle, angle) / TURN_RANGE);
            drag.angle = angle;
        },
        up() {
            drag = null;
        },
    });

    function onKeyDown(event) {
        const n = Number(event.key);
        if (n >= 1 && n <= VALVE_COUNT) selected = n - 1;
        else if (event.key === "ArrowLeft") selected = (selected + VALVE_COUNT - 1) % VALVE_COUNT;
        else if (event.key === "ArrowRight") selected = (selected + 1) % VALVE_COUNT;
        else if (event.key === "ArrowUp") turn(selected, KEY_STEP);
        else if (event.key === "ArrowDown") turn(selected, -KEY_STEP);
        else return false;
        event.preventDefault();
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        const p = pressures(s.valves);
        const all = allInZone(s);
        if (!done.active) {
            holdMs = all ? holdMs + dt : 0;
            if (all && !wasAll) {
                sfx("ok");
                stage.status("¡Las tres en verde! Sostén la presión…");
            } else if (!all && wasAll) stage.status("Se salió una aguja: ajusta de nuevo");
            wasAll = all;
            if (holdMs >= HOLD_MS) {
                sfx("done");
                stage.status("Compuesto estabilizado");
                done.start(now);
            }
        }
        // agujas con inercia: resorte amortiguado en pasos cortos (estable aunque el cuadro tarde)
        for (let k = 0; k < needle.length; k++) {
            const n = needle[k];
            if (reduceMotion) {
                n.p = p[k];
                continue;
            }
            for (let t = 0; t < dt; t += 8) {
                const h = Math.min(8, dt - t);
                n.v += (0.0006 * (p[k] - n.p) - 0.045 * n.v) * h;
                n.p += n.v * h;
            }
        }

        // fondo de la planta
        roundRect(ctx, 0, 0, 560, H, 16, "#1c1c20");
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, 560, 14);
        ctx.clip();
        for (let x = -20; x < 580; x += 28) {
            ctx.fillStyle = "#facc15";
            ctx.beginPath();
            ctx.moveTo(x, 14);
            ctx.lineTo(x + 14, 0);
            ctx.lineTo(x + 28, 0);
            ctx.lineTo(x + 14, 14);
            ctx.fill();
        }
        ctx.restore();
        // tubería común que une las tres válvulas (queda detrás de los volantes)
        roundRect(ctx, 40, WHEEL_Y - 7, 480, 14, 7, "#52525b");

        for (let k = 0; k < VALVE_COUNT; k++) {
            const x = XS[k];
            const ok = inZone(p[k], s.zones[k]);
            // tubo del volante al medidor, con burbujas
            roundRect(ctx, x - 7, GAUGE_Y + GAUGE_R - 4, 14, WHEEL_Y - GAUGE_Y - GAUGE_R - 20, 4, "#3f3f46");
            // medidor
            ctx.beginPath();
            ctx.arc(x, GAUGE_Y, GAUGE_R, 0, Math.PI * 2);
            ctx.fillStyle = "#f4f4f5";
            ctx.fill();
            ctx.lineWidth = 6;
            ctx.strokeStyle = k === selected ? pal.accent : "#52525b";
            ctx.stroke();
            // escala y zona verde
            ctx.lineWidth = 10;
            ctx.strokeStyle = "#d4d4d8";
            ctx.beginPath();
            ctx.arc(x, GAUGE_Y, GAUGE_R - 12, ARC_START, ARC_START + ARC_SWEEP);
            ctx.stroke();
            ctx.strokeStyle = ok ? "#16a34a" : "#4ade80";
            ctx.beginPath();
            ctx.arc(x, GAUGE_Y, GAUGE_R - 12, ARC_START + s.zones[k][0] * ARC_SWEEP, ARC_START + s.zones[k][1] * ARC_SWEEP);
            ctx.stroke();
            ctx.strokeStyle = "#18181b";
            ctx.lineWidth = 1.5;
            for (let i = 0; i <= 10; i++) {
                const a = ARC_START + (i / 10) * ARC_SWEEP;
                const r0 = GAUGE_R - (i % 5 ? 20 : 24);
                ctx.beginPath();
                ctx.moveTo(x + Math.cos(a) * r0, GAUGE_Y + Math.sin(a) * r0);
                ctx.lineTo(x + Math.cos(a) * (GAUGE_R - 17), GAUGE_Y + Math.sin(a) * (GAUGE_R - 17));
                ctx.stroke();
            }
            // aguja (con un leve temblor cuando está fuera de la zona)
            const jitter = !ok && !reduceMotion ? Math.sin(now / 45 + k) * 0.004 : 0;
            const a = ARC_START + clamp(needle[k].p + jitter, -0.02, 1.02) * ARC_SWEEP;
            ctx.strokeStyle = ok ? "#15803d" : pal.danger;
            ctx.lineWidth = 3.5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x, GAUGE_Y);
            ctx.lineTo(x + Math.cos(a) * (GAUGE_R - 16), GAUGE_Y + Math.sin(a) * (GAUGE_R - 16));
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, GAUGE_Y, 6, 0, Math.PI * 2);
            ctx.fillStyle = "#18181b";
            ctx.fill();
            ctx.fillStyle = ok ? "#15803d" : "#3f3f46";
            ctx.font = `800 13px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(`${pct(p[k])}`, x, GAUGE_Y + 30);
            if (ok) glowCircle(ctx, x, GAUGE_Y - GAUGE_R - 2, 18, pal.infected, 0.7);

            // volante: gira con la apertura (una vuelta = de cerrada a abierta)
            const rot = s.valves[k] * TURN_RANGE;
            ctx.save();
            ctx.translate(x, WHEEL_Y);
            ctx.rotate(rot);
            ctx.strokeStyle = "#b91c1c";
            ctx.lineWidth = 9;
            ctx.beginPath();
            ctx.arc(0, 0, WHEEL_R - 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 6;
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos((i * Math.PI) / 2) * (WHEEL_R - 6), Math.sin((i * Math.PI) / 2) * (WHEEL_R - 6));
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(WHEEL_R - 6, 0, 6, 0, Math.PI * 2);
            ctx.fillStyle = "#fca5a5";
            ctx.fill();
            ctx.restore();
            ctx.beginPath();
            ctx.arc(x, WHEEL_Y, 9, 0, Math.PI * 2);
            ctx.fillStyle = "#18181b";
            ctx.fill();
            if (k === selected) {
                ctx.strokeStyle = withAlpha(pal.accent, 0.8);
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 5]);
                ctx.beginPath();
                ctx.arc(x, WHEEL_Y, WHEEL_R + 8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.fillStyle = pal.muted;
            ctx.font = `700 11px ${pal.fontMono}`;
            ctx.fillText(`V${k + 1} · ${pct(s.valves[k])} %`, x, WHEEL_Y + WHEEL_R + 22);
        }
        // burbujas que suben por los tubos
        for (const b of bubbles) {
            b.y -= dt * 0.05;
            b.life -= dt / 900;
            ctx.globalAlpha = clamp(b.life, 0, 1);
            ctx.strokeStyle = "#d9f99d";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].life <= 0) bubbles.splice(i, 1);
        // estabilizando: barra y vapor
        if (holdMs > 0 && !done.active) {
            const t = clamp(holdMs / HOLD_MS, 0, 1);
            roundRect(ctx, 190, 22, 180, 10, 5, "#3f3f46");
            roundRect(ctx, 190, 22, 180 * t, 10, 5, pal.infected);
            if (!reduceMotion && Math.random() < 0.3) stage.burst(280 + (Math.random() - 0.5) * 300, 40, "#e4e4e7", 2);
        }
        stage.drawParticles(dt);
        stage.label(
            `Válvulas: ${p.map((v, k) => `medidor ${k + 1} en ${pct(v)} (verde de ${pct(s.zones[k][0])} a ${pct(s.zones[k][1])})`).join("; ")}; válvula seleccionada ${selected + 1} abierta ${pct(s.valves[selected])} por ciento`,
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
