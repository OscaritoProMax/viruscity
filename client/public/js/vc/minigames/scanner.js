// Minijuego "Escáner" (almacen-2, Inventariar el cargamento).
// Llegan 3 cajas por la cinta. Hay que pasar el lector sobre el código de barras de cada una, de izquierda a
// derecha y a la velocidad justa: ni muy rápido ni muy lento (cada caja tiene su propio rango). El aviso dice
// "Muy rápido", "Muy lento" o "Leído".
// Puntero: arrastrar el lector por encima del código. Teclado: ↑ ↓ eligen la velocidad (1 a 6) y mantener →
// pasa el lector a esa velocidad (← lo devuelve).

import { createStage, createCelebration, palette, clamp, lerp, easeOutCubic, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 320;
export const BOXES = 3;
export const SPEED_LEVELS = Object.freeze([0.14, 0.22, 0.35, 0.55, 0.86, 1.35]); // px/ms del teclado
export const WINDOW_RATIO = 1.9; // el rango de cada caja va de lo a lo · 1,9 (siempre contiene un nivel)
export const CODE = Object.freeze({ x: 214, w: 132, y: 148, h: 44 });
const REST_X = 104;
const MIN_X = 64;
const MAX_X = 500;
const BACK_SPEED = 0.6;
const SLIDE_MS = 650;

// ---------- Lógica pura ----------
export function createScanner(rng = Math.random) {
    const windows = Array.from({ length: BOXES }, () => {
        const lo = 0.15 + rng() * 0.35;
        return [lo, lo * WINDOW_RATIO];
    });
    // patrón de barras de cada caja (solo visual)
    const bars = Array.from({ length: BOXES }, () => Array.from({ length: 26 }, () => 1 + Math.floor(rng() * 3)));
    return { windows, bars, box: 0 };
}
// Resultado de una pasada que cruzó todo el código (width px) en ms milisegundos
export function sweepResult(width, ms, window) {
    if (!(ms > 0)) return "fast";
    const speed = width / ms;
    if (speed > window[1]) return "fast";
    if (speed < window[0]) return "slow";
    return "ok";
}
export const registerRead = (s) => (s.box < BOXES ? { ...s, box: s.box + 1 } : s);
export const isInventoried = (s) => s.box >= BOXES;
export const levelsInWindow = (window) => SPEED_LEVELS.map((v, i) => i).filter((i) => SPEED_LEVELS[i] >= window[0] && SPEED_LEVELS[i] <= window[1]);
// Momento (interpolado) en que el lector cruzó la línea `edge` entre dos muestras (x0, t0) → (x1, t1)
export function crossingTime(edge, x0, t0, x1, t1) {
    if (x1 === x0) return t1;
    return t0 + ((edge - x0) / (x1 - x0)) * (t1 - t0);
}

const RESULT_TEXT = { fast: "Muy rápido", slow: "Muy lento", ok: "Leído", partial: "Pasa el lector por todo el código" };

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const stage = createStage(container, { height: H, label: "Escáner", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let s = createScanner(rng);
    let readerX = REST_X;
    let lastSample = { x: REST_X, t: 0 };
    let sweepStart = null; // momento en que el haz entró al código por la izquierda
    let dragging = null; // { ox }
    let keyLevel = 2;
    let keyDir = 0; // +1 → mantenida, -1 ← mantenida
    let flash = null; // { result, at, speed }
    let slide = null; // { at, counted }: la caja leída sale y entra la siguiente
    let lastResult = "ninguna";
    stage.status("Pasa el lector sobre el código de barras de izquierda a derecha, ni muy rápido ni muy lento");

    const busy = () => done.active || slide !== null;

    function finishSweep(result, now, speed = null) {
        sweepStart = null;
        flash = { result, at: now, speed };
        lastResult = RESULT_TEXT[result];
        stage.status(result === "ok" ? `Leído: caja ${s.box + 1} de ${BOXES}` : RESULT_TEXT[result]);
        if (result !== "ok") {
            sfx("error");
            return;
        }
        sfx("ok");
        stage.burst(CODE.x + CODE.w / 2, CODE.y + CODE.h / 2, pal.infected, 16);
        slide = { at: now, counted: false };
    }

    // Nueva posición del lector en el momento t: detecta la entrada y la salida del código
    function moveReader(x, t) {
        const prev = lastSample;
        readerX = clamp(x, MIN_X, MAX_X);
        lastSample = { x: readerX, t };
        if (busy()) return;
        const left = CODE.x;
        const right = CODE.x + CODE.w;
        if (readerX < left - 2) sweepStart = null; // volvió atrás: la pasada no cuenta
        if (sweepStart === null && prev.x < left && readerX >= left) sweepStart = crossingTime(left, prev.x, prev.t, readerX, t);
        if (sweepStart !== null && prev.x < right && readerX >= right) {
            const exitAt = crossingTime(right, prev.x, prev.t, readerX, t);
            const ms = exitAt - sweepStart;
            finishSweep(sweepResult(CODE.w, ms, s.windows[s.box]), t, CODE.w / Math.max(1, ms));
        }
    }
    // Se soltó a mitad del código
    function release(now) {
        if (sweepStart !== null && !busy()) finishSweep("partial", now);
    }

    stage.onPointer({
        down(p) {
            if (busy()) return;
            if (Math.abs(p.x - readerX) < 46 && p.y < 120) dragging = { ox: p.x - readerX };
            else if (p.y < 230) dragging = { ox: 0 }; // tocar en otra parte trae el lector a esa x
            if (dragging) {
                lastSample = { x: readerX, t: performance.now() };
                moveReader(p.x - dragging.ox, performance.now());
            }
        },
        move(p, e, active) {
            if (!dragging || !active) return;
            moveReader(p.x - dragging.ox, performance.now());
        },
        up() {
            if (!dragging) return;
            dragging = null;
            release(performance.now());
        },
    });

    function onKeyDown(event) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            keyLevel = clamp(keyLevel + (event.key === "ArrowUp" ? 1 : -1), 0, SPEED_LEVELS.length - 1);
            stage.status(`Velocidad ${keyLevel + 1} de ${SPEED_LEVELS.length}`);
        } else if (event.key === "ArrowRight") {
            if (!event.repeat && keyDir !== 1) lastSample = { x: readerX, t: performance.now() };
            keyDir = 1;
        } else if (event.key === "ArrowLeft") keyDir = -1;
        else return false;
        event.preventDefault();
        return true;
    }
    function onKeyUp(event) {
        if (event.key === "ArrowRight" && keyDir === 1) {
            keyDir = 0;
            release(performance.now());
            return true;
        }
        if (event.key === "ArrowLeft" && keyDir === -1) {
            keyDir = 0;
            return true;
        }
        return false;
    }
    const onBlur = () => {
        keyDir = 0;
        dragging = null;
    };
    window.addEventListener("blur", onBlur);

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        // lector movido por el teclado; sin nadie que lo mueva vuelve solo a su sitio
        if (keyDir === 1) moveReader(readerX + SPEED_LEVELS[keyLevel] * dt, now);
        else if (keyDir === -1) moveReader(readerX - BACK_SPEED * dt, now);
        else if (!dragging && readerX !== REST_X && (!flash || now - flash.at > 450)) {
            const x = reduceMotion ? REST_X : lerp(readerX, REST_X, clamp(dt / 120, 0, 1));
            readerX = Math.abs(x - REST_X) < 0.5 ? REST_X : x;
            lastSample = { x: readerX, t: now };
            sweepStart = null;
        }
        // caja leída: sale por la derecha (primera mitad) y entra la siguiente por la izquierda (segunda mitad)
        let boxX = 0;
        if (slide) {
            const t = reduceMotion ? 1 : clamp((now - slide.at) / SLIDE_MS, 0, 1);
            if (t < 0.5) boxX = easeOutCubic(t * 2) * 420;
            else {
                if (!slide.counted) {
                    slide.counted = true;
                    s = registerRead(s);
                    if (isInventoried(s)) {
                        sfx("done");
                        stage.status("Inventario completo");
                        done.start(now);
                    }
                }
                boxX = -420 + easeOutCubic((t - 0.5) * 2) * 420;
            }
            if (t >= 1) {
                slide = null;
                boxX = 0;
                if (!isInventoried(s)) stage.status(`Caja ${s.box + 1} de ${BOXES}: pásale el lector`);
            }
        }
        if (isInventoried(s)) boxX = 420;

        // bodega
        roundRect(ctx, 0, 0, 560, H, 16, "#a8a29e");
        ctx.fillStyle = "#78716c";
        ctx.fillRect(0, 0, 560, 30);
        // cinta transportadora
        roundRect(ctx, 0, 238, 560, 24, 4, "#27272a");
        const offset = reduceMotion ? 0 : (now / (slide ? 4 : 40)) % 28;
        ctx.fillStyle = "#52525b";
        for (let x = -28 + offset; x < 560; x += 28) ctx.fillRect(x, 242, 14, 16);
        ctx.fillStyle = "#57534e";
        ctx.fillRect(0, 262, 560, 58);

        // caja con su etiqueta y código de barras
        if (!isInventoried(s)) {
            ctx.save();
            ctx.translate(boxX, 0);
            roundRect(ctx, 176, 104, 208, 134, 4, "#d97706", "#92400e", 3);
            ctx.fillStyle = withAlpha("#ffffff", 0.16);
            ctx.fillRect(272, 104, 16, 134);
            roundRect(ctx, CODE.x - 12, CODE.y - 14, CODE.w + 24, CODE.h + 36, 3, "#fefce8", "#a16207", 1.5);
            let bx = CODE.x;
            ctx.fillStyle = "#18181b";
            for (const [i, w] of s.bars[Math.min(s.box, BOXES - 1)].entries()) {
                if (i % 2 === 0) ctx.fillRect(bx, CODE.y, w * 1.6, CODE.h);
                bx += w * 1.6 + 1.2;
                if (bx > CODE.x + CODE.w - 2) break;
            }
            ctx.font = `700 10px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(`VC-${String(4100 + s.box * 37).padStart(5, "0")}`, CODE.x + CODE.w / 2, CODE.y + CODE.h + 15);
            ctx.restore();
        }

        // lector y su haz
        const reading = sweepStart !== null;
        const fl = flash && now - flash.at < 700 ? flash : null;
        const beam = fl ? (fl.result === "ok" ? pal.infected : pal.danger) : "#ef4444";
        glowCircle(ctx, readerX, CODE.y + CODE.h / 2, 40, beam, reading ? 0.5 : 0.25);
        ctx.strokeStyle = beam;
        ctx.lineWidth = reading ? 4 : 3;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(readerX, 94);
        ctx.lineTo(readerX, CODE.y + CODE.h + 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
        roundRect(ctx, readerX - 26, 40, 52, 44, 10, "#334155", "#0f172a", 2);
        roundRect(ctx, readerX - 9, 80, 18, 16, 3, "#1e293b");
        roundRect(ctx, readerX + 6, 46, 14, 10, 3, fl ? beam : "#0f172a");
        if (dragging) {
            ctx.strokeStyle = withAlpha(pal.accent, 0.7);
            ctx.lineWidth = 2;
            ctx.strokeRect(readerX - 30, 36, 60, 52);
        }

        // medidor de velocidad (escala logarítmica) con el rango de esta caja
        const G = { x: 300, y: 278, w: 240, h: 12 };
        const lo = Math.log(0.1);
        const hi = Math.log(1.8);
        const gx = (v) => G.x + clamp((Math.log(v) - lo) / (hi - lo), 0, 1) * G.w;
        roundRect(ctx, G.x, G.y, G.w, G.h, 6, "#292524");
        const win = s.windows[Math.min(s.box, BOXES - 1)];
        roundRect(ctx, gx(win[0]), G.y, gx(win[1]) - gx(win[0]), G.h, 6, withAlpha(pal.infected, 0.75));
        for (let i = 0; i < SPEED_LEVELS.length; i++) {
            const x = gx(SPEED_LEVELS[i]);
            ctx.fillStyle = i === keyLevel ? pal.cure : "#d6d3d1";
            ctx.fillRect(x - 1, G.y - (i === keyLevel ? 7 : 4), 2, i === keyLevel ? 7 : 4);
        }
        if (flash?.speed) {
            ctx.beginPath();
            const mx = gx(flash.speed);
            ctx.moveTo(mx, G.y + G.h + 2);
            ctx.lineTo(mx - 6, G.y + G.h + 10);
            ctx.lineTo(mx + 6, G.y + G.h + 10);
            ctx.fillStyle = flash.result === "ok" ? pal.infected : pal.danger;
            ctx.fill();
        }
        ctx.fillStyle = "#fafaf9";
        ctx.font = `700 10px ${pal.fontMono}`;
        ctx.textAlign = "left";
        ctx.fillText("LENTO", G.x, G.y - 10);
        ctx.textAlign = "right";
        ctx.fillText("RÁPIDO", G.x + G.w, G.y - 10);
        ctx.textAlign = "left";
        ctx.font = `800 13px ${pal.fontMono}`;
        ctx.fillText(`CAJA ${Math.min(s.box + 1, BOXES)}/${BOXES}`, 20, 290);
        ctx.fillStyle = "#292524";
        ctx.fillText("INVENTARIO", 20, 22);
        // aviso grande del resultado
        if (fl) {
            const a = clamp(1 - (now - fl.at) / 700, 0, 1);
            ctx.globalAlpha = a;
            roundRect(ctx, 400, 44, 140, 36, 18, fl.result === "ok" ? pal.infected : pal.danger);
            ctx.fillStyle = "#0b1020";
            ctx.font = `800 13px ${pal.fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(RESULT_TEXT[fl.result].length > 12 ? "INCOMPLETO" : RESULT_TEXT[fl.result].toUpperCase(), 470, 67);
            ctx.globalAlpha = 1;
        }
        stage.drawParticles(dt);
        const pos = readerX < CODE.x ? "a la izquierda del código" : readerX > CODE.x + CODE.w ? "a la derecha del código" : "sobre el código";
        stage.label(
            `Escáner: caja ${Math.min(s.box + 1, BOXES)} de ${BOXES}; velocidad del teclado ${keyLevel + 1} de ${SPEED_LEVELS.length}; última lectura: ${lastResult}; lector ${pos}`,
        );
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
