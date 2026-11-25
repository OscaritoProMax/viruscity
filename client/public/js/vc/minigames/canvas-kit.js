// Motor común de los minijuegos dibujados en canvas (Viruscity, misiones jugables).
//
// createStage(container, { height, label, reduceMotion }) → stage
//   Lienzo con coordenadas LÓGICAS fijas (STAGE_W × height) que se adapta al ancho del contenedor y se ve nítido
//   en pantallas de alta densidad. Es enfocable (teclado) y anuncia su estado con aria-live.
//   stage.ctx                 contexto 2D ya escalado a coordenadas lógicas en cada frame
//   stage.loop(draw)          llama draw(dtMs, nowMs) en cada frame hasta stop() o destroy()
//   stage.onPointer({ down, move, up })  puntero (ratón o dedo) en coordenadas lógicas; captura el puntero
//   stage.status(text)        texto del aviso aria-live (solo si cambia)
//   stage.label(text)         aria-label del lienzo (describe el estado)
//   stage.burst(x, y, color, n)  partículas (no hace nada con movimiento reducido)
//   stage.drawParticles(dt)   dibuja y avanza las partículas
//   stage.destroy()           detiene el bucle y quita listeners y el ResizeObserver
// Utilidades: palette() (colores de tokens.css), easing, lerp, clamp, roundRect, shuffle(rng).

import { el } from "./dom.js";

export const STAGE_W = 560;

// ---------- Colores (tokens.css con valores de respaldo) ----------
const FALLBACK = {
    bg: "#0b1020", panel: "#121a33", panel2: "#18223f", border: "#2a3560", text: "#e6e9f5", muted: "#8f9bc4",
    accent: "#4dd2ff", infected: "#7cff6b", cure: "#ffd166", danger: "#ff4d6d", fontMono: "monospace", fontUi: "system-ui, sans-serif",
};
const VARS = { bg: "--bg", panel: "--panel", panel2: "--panel-2", border: "--border", text: "--text", muted: "--muted", accent: "--accent", infected: "--infected", cure: "--cure", danger: "--danger", fontMono: "--font-mono", fontUi: "--font-ui" };
let cachedPalette = null;
export function palette() {
    if (cachedPalette) return cachedPalette;
    const out = { ...FALLBACK };
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
        const css = getComputedStyle(document.documentElement);
        for (const [key, name] of Object.entries(VARS)) {
            const v = css.getPropertyValue(name).trim();
            if (v) out[key] = v;
        }
    }
    cachedPalette = out;
    return out;
}

// ---------- Matemática y easing (puros) ----------
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
export function easeOutBack(t) {
    const x = clamp(t, 0, 1);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Barajado Fisher-Yates con el generador dado (no modifica la lista original)
export function shuffle(list, rng = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Permutación que no deja ningún elemento en su posición original (para que nada empiece "resuelto")
export function derange(list, rng = Math.random) {
    if (list.length < 2) return [...list];
    for (let attempt = 0; attempt < 20; attempt++) {
        const out = shuffle(list, rng);
        if (out.every((v, i) => v !== list[i])) return out;
    }
    return [...list.slice(1), list[0]];
}

// ---------- Dibujo ----------
export function roundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 1) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}
export function withAlpha(color, alpha) {
    if (typeof color !== "string" || !color.startsWith("#") || color.length !== 7) return color;
    const a = Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, "0");
    return color + a;
}
export function glowCircle(ctx, x, y, r, color, alpha = 0.5) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
// Marca de "resuelto" que crece en el centro (t de 0 a 1)
export function drawSuccess(ctx, w, h, t, pal = palette()) {
    const k = easeOutBack(t);
    ctx.save();
    ctx.globalAlpha = clamp(t * 2, 0, 1) * 0.85;
    ctx.fillStyle = withAlpha(pal.bg, 0.55);
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.translate(w / 2, h / 2);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(pal.cure, 0.18);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = pal.cure;
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-24, 2);
    ctx.lineTo(-6, 20);
    ctx.lineTo(26, -16);
    ctx.stroke();
    ctx.restore();
}

// ---------- Escenario ----------
export function createStage(container, { height = 340, label = "Minijuego", reduceMotion = false } = {}) {
    const W = STAGE_W;
    const H = height;
    const wrap = el("div", "vc-stage");
    const canvas = document.createElement("canvas");
    canvas.className = "vc-stage__canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-roledescription", "minijuego");
    canvas.setAttribute("aria-label", label);
    canvas.style.aspectRatio = `${W} / ${H}`;
    const live = el("p", "vc-mg__status vc-stage__status", "");
    live.setAttribute("aria-live", "polite");
    wrap.append(canvas);
    container.append(wrap, live);
    const ctx = canvas.getContext("2d");

    let cssW = W;
    let dpr = 1;
    function resize() {
        cssW = Math.max(1, canvas.clientWidth || W);
        dpr = Math.min(3, window.devicePixelRatio || 1);
        const pw = Math.round(cssW * dpr);
        const ph = Math.round((cssW * H * dpr) / W);
        if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
        }
    }
    resize();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    let raf = 0;
    let running = false;
    let last = 0;
    let drawFn = null;
    function frame(now) {
        if (!running) return;
        const dt = last ? Math.min(64, now - last) : 16;
        last = now;
        const s = canvas.width / W;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawFn?.(dt, now);
        raf = requestAnimationFrame(frame);
    }

    const listeners = [];
    const on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        listeners.push([target, type, fn, opts]);
    };
    // Coordenadas lógicas del evento
    function toLocal(event) {
        const r = canvas.getBoundingClientRect();
        return { x: ((event.clientX - r.left) / Math.max(1, r.width)) * W, y: ((event.clientY - r.top) / Math.max(1, r.height)) * H };
    }

    let particles = [];
    let lastStatus = null;

    const stage = {
        canvas,
        ctx,
        W,
        H,
        reduceMotion,
        loop(fn) {
            drawFn = fn;
            if (running) return;
            running = true;
            last = 0;
            raf = requestAnimationFrame(frame);
        },
        stop() {
            running = false;
            cancelAnimationFrame(raf);
        },
        onPointer({ down, move, up } = {}) {
            canvas.style.touchAction = "none";
            let active = null;
            on(canvas, "pointerdown", (e) => {
                e.preventDefault();
                canvas.focus({ preventScroll: true });
                active = e.pointerId;
                canvas.setPointerCapture?.(e.pointerId);
                down?.(toLocal(e), e);
            });
            on(canvas, "pointermove", (e) => {
                move?.(toLocal(e), e, active === e.pointerId);
            });
            const end = (e) => {
                if (active !== e.pointerId) return;
                active = null;
                up?.(toLocal(e), e);
            };
            on(canvas, "pointerup", end);
            on(canvas, "pointercancel", end);
        },
        status(text) {
            if (text === lastStatus) return;
            lastStatus = text;
            live.textContent = text;
        },
        label(text) {
            if (canvas.getAttribute("aria-label") !== text) canvas.setAttribute("aria-label", text);
        },
        burst(x, y, color, n = 14) {
            if (reduceMotion) return;
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2;
                const v = 0.04 + Math.random() * 0.14;
                particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.05, life: 1, color, r: 1.5 + Math.random() * 2.5 });
            }
        },
        drawParticles(dt) {
            if (!particles.length) return;
            ctx.save();
            for (const p of particles) {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 0.00025 * dt;
                p.life -= dt / 650;
                ctx.globalAlpha = clamp(p.life, 0, 1);
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            particles = particles.filter((p) => p.life > 0);
        },
        destroy() {
            stage.stop();
            ro?.disconnect();
            for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
            listeners.length = 0;
            particles = [];
        },
    };
    return stage;
}

// Animación de éxito común: ~600 ms (300 con movimiento reducido) y luego onSolved (una sola vez)
export function createCelebration(onSolved, reduceMotion = false) {
    const duration = reduceMotion ? 300 : 650;
    let startedAt = null;
    let fired = false;
    return {
        start(now) {
            if (startedAt === null) startedAt = now;
        },
        get active() {
            return startedAt !== null;
        },
        // progreso 0..1; llama onSolved al terminar
        progress(now) {
            if (startedAt === null) return 0;
            const t = clamp((now - startedAt) / duration, 0, 1);
            if (t >= 1 && !fired) {
                fired = true;
                onSolved();
            }
            return t;
        },
    };
}
