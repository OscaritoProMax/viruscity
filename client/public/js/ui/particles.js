// Partículas decorativas (virus a la deriva) para fondos como el hero del login.
// Solo presentación: no usa red ni datos del juego.
//
// startParticles(canvas, { count }) → { stop() }
// - Colores tomados de las variables CSS --accent y --infected.
// - Respeta prefers-reduced-motion (un solo cuadro estático), se pausa con la pestaña oculta,
//   limita devicePixelRatio a 2, se redimensiona con ResizeObserver y no anima si el canvas
//   no se ve (display:none deja su tamaño en 0).

const SPEED_MIN = 8; // px/s
const SPEED_MAX = 24;
const RADIUS_MIN = 3; // px
const RADIUS_MAX = 9;
const ALPHA_MIN = 0.15;
const ALPHA_MAX = 0.4;
const MAX_DPR = 2;
const MAX_STEP_S = 0.05; // evita saltos grandes tras una pausa

const rand = (min, max) => min + Math.random() * (max - min);

export function startParticles(canvas, { count = 40 } = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return { stop() {} };

    const css = getComputedStyle(document.documentElement);
    const colors = ["--accent", "--infected"].map((name) => css.getPropertyValue(name).trim()).filter(Boolean);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let particles = [];
    let raf = 0;
    let lastTime = 0;
    let stopped = false;

    function makeParticle() {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(SPEED_MIN, SPEED_MAX);
        const r = rand(RADIUS_MIN, RADIUS_MAX);
        return {
            x: rand(r, Math.max(r, width - r)),
            y: rand(r, Math.max(r, height - r)),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            r,
            alpha: rand(ALPHA_MIN, ALPHA_MAX),
            color: colors[Math.floor(Math.random() * colors.length)],
        };
    }

    // Ajusta el tamaño interno del canvas al tamaño visible (con DPR limitado)
    function resize(w, h) {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        width = w;
        height = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (width === 0 || height === 0) return;
        if (particles.length === 0) {
            particles = Array.from({ length: count }, makeParticle);
        } else {
            for (const p of particles) {
                p.x = Math.min(Math.max(p.x, p.r), width - p.r);
                p.y = Math.min(Math.max(p.y, p.r), height - p.r);
            }
        }
    }

    // Cada partícula: núcleo relleno + anillo
    function draw() {
        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 1.5;
        for (const p of particles) {
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.strokeStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Deriva lenta con rebote suave en los bordes
    function step(dt) {
        for (const p of particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); }
            if (p.x > width - p.r) { p.x = width - p.r; p.vx = -Math.abs(p.vx); }
            if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy); }
            if (p.y > height - p.r) { p.y = height - p.r; p.vy = -Math.abs(p.vy); }
        }
    }

    function frame(time) {
        raf = 0;
        if (stopped) return;
        const dt = lastTime ? Math.min((time - lastTime) / 1000, MAX_STEP_S) : 0;
        lastTime = time;
        step(dt);
        draw();
        raf = requestAnimationFrame(frame);
    }

    function pause() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        lastTime = 0;
    }

    // Decide si anima, dibuja un cuadro estático o no hace nada
    function update() {
        pause();
        if (stopped || width === 0 || height === 0) return;
        if (reduceMotion.matches) {
            draw(); // movimiento reducido: un solo cuadro quieto
            return;
        }
        if (!document.hidden) raf = requestAnimationFrame(frame);
    }

    const observer = new ResizeObserver(([entry]) => {
        resize(entry.contentRect.width, entry.contentRect.height);
        update();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", update);
    reduceMotion.addEventListener("change", update);

    return {
        stop() {
            stopped = true;
            pause();
            observer.disconnect();
            document.removeEventListener("visibilitychange", update);
            reduceMotion.removeEventListener("change", update);
            ctx.clearRect(0, 0, width, height);
        },
    };
}
