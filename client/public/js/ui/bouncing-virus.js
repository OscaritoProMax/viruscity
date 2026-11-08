// Virus animado del login: un virus "blando" que rebota contra el suelo, se aplasta y estira,
// mueve sus 8 antenas con inercia y suelta esporas al caer. Un clic (o Enter/Espacio) lo hace saltar.
// Basado en la animación de referencia virus_city_loading_screen.html (física y dibujo), adaptada
// a las reglas de la interfaz: colores de tokens.css, sin dependencias, paso fijo de 1/60 s y
// respeto de prefers-reduced-motion.
//
// La física son funciones puras (se prueban con node:test); startBouncingVirus() hace el dibujo.

// ---------- Física (valores de la referencia, calibrados para un radio de 46 px a 60 pasos/s) ----------

export const STEP_S = 1 / 60;
export const BASE_RADIUS = 46;
const GRAVITY = 0.55; // px por paso²
const BOUNCE_IMPULSE = -14; // px por paso
const BOOST_IMPULSE = -18.5;
const SCALE_STIFFNESS = 180;
const SCALE_DAMPING = 12;
const ANTENNA_STIFFNESS = 120;
const ANTENNA_DAMPING = 8;
const MAX_SQUISH = 0.45;

// Estado inicial del virus. radius en px; las fuerzas se escalan con radius / BASE_RADIUS.
export function createVirus(radius = BASE_RADIUS) {
    return {
        radius,
        k: radius / BASE_RADIUS,
        y: 0,
        vy: 0,
        scaleX: 1,
        scaleY: 1,
        velScaleX: 0,
        velScaleY: 0,
        antennas: Array.from({ length: 8 }, (_, i) => ({ angle: (i * Math.PI) / 4, wobble: 0, vWobble: 0 })),
    };
}

// Cambia el tamaño conservando la posición relativa (al redimensionar el escenario)
export function resizeVirus(virus, radius) {
    const ratio = radius / virus.radius;
    virus.y *= ratio;
    virus.vy *= ratio;
    virus.radius = radius;
    virus.k = radius / BASE_RADIUS;
}

// Avanza un paso de 1/60 s. Devuelve { bounced, impactSpeed } para que el dibujo suelte esporas.
export function stepVirus(virus, floorY, rand = Math.random) {
    const { k } = virus;
    virus.vy += GRAVITY * k;
    virus.y += virus.vy;

    // Estiramiento según la velocidad mientras está en el aire
    const v = virus.vy / k; // velocidad normalizada al radio base
    if (Math.abs(v) > 1) {
        const targetY = 1 + v * 0.015;
        const targetX = 1 - v * 0.012;
        virus.scaleY += (targetY - virus.scaleY) * 0.15;
        virus.scaleX += (targetX - virus.scaleX) * 0.15;
    }

    // Resorte amortiguado que devuelve la escala a 1
    const forceX = -SCALE_STIFFNESS * (virus.scaleX - 1) - SCALE_DAMPING * virus.velScaleX;
    virus.velScaleX += forceX * STEP_S;
    virus.scaleX += virus.velScaleX * STEP_S;
    const forceY = -SCALE_STIFFNESS * (virus.scaleY - 1) - SCALE_DAMPING * virus.velScaleY;
    virus.velScaleY += forceY * STEP_S;
    virus.scaleY += virus.velScaleY * STEP_S;

    // Choque con el suelo: rebote y aplastamiento elástico
    let bounced = false;
    let impactSpeed = 0;
    const radiusY = virus.radius * virus.scaleY;
    if (virus.y + radiusY >= floorY) {
        impactSpeed = Math.abs(virus.vy) / k;
        virus.vy = BOUNCE_IMPULSE * k;

        const squish = Math.min(MAX_SQUISH, impactSpeed * 0.035);
        virus.scaleY = 1 - squish;
        virus.scaleX = 1 + squish * 0.9;
        virus.velScaleY = squish * 25;
        virus.velScaleX = -squish * 20;
        // Apoyado ya aplastado (la referencia lo colocaba antes de aplastarlo y quedaba flotando)
        virus.y = floorY - virus.radius * virus.scaleY;

        for (const antenna of virus.antennas) antenna.vWobble = (rand() - 0.5) * impactSpeed * 0.1;
        bounced = true;
    }

    // Antenas: osciladores amortiguados
    for (const antenna of virus.antennas) {
        const force = -ANTENNA_STIFFNESS * antenna.wobble - ANTENNA_DAMPING * antenna.vWobble;
        antenna.vWobble += force * STEP_S;
        antenna.wobble += antenna.vWobble * STEP_S;
    }

    return { bounced, impactSpeed };
}

// Salto potente. Se limita para que el borde superior del virus no pase de minTop,
// partiendo de su posición actual (puede pulsarse en pleno vuelo).
export function boostJump(virus, minTop = 0) {
    const g = GRAVITY * virus.k;
    const room = Math.max(0, virus.y - virus.radius - minTop); // altura disponible hasta el techo
    const maxSpeed = Math.sqrt(2 * g * room);
    virus.vy = -Math.min(Math.abs(BOOST_IMPULSE * virus.k), maxSpeed);
    virus.scaleY = 1.4;
    virus.scaleX = 0.7;
}

// Esporas: partículas con vida corta (en pasos de 1/60 s)
export function createSpore(x, y, vx, vy, k = 1, rand = Math.random) {
    const life = 25 + rand() * 20;
    return { x, y, vx, vy, size: (2 + rand() * 4) * Math.max(k, 0.6), life, maxLife: life, light: rand() > 0.7 };
}

export function stepSpore(spore, k = 1) {
    spore.x += spore.vx;
    spore.y += spore.vy;
    spore.vx *= 0.94;
    spore.vy *= 0.94;
    spore.vy += 0.15 * k; // gravedad leve
    spore.life -= 1;
    return spore.life > 0;
}

// ---------- Dibujo ----------

const MAX_DPR = 2;
const MAX_SPORES = 160;
const MAX_FRAME_S = 0.1; // tras una pausa no se simulan más de 0.1 s de golpe

export function startBouncingVirus(stage, canvas, { onInteractiveChange } = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return { stop() {} };

    const css = getComputedStyle(document.documentElement);
    const colors = {
        accent: css.getPropertyValue("--accent").trim(),
        bg: css.getPropertyValue("--bg").trim(),
        light: css.getPropertyValue("--text").trim(),
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const virus = createVirus();
    let spores = [];
    let width = 0;
    let height = 0;
    let floorY = 0;
    let raf = 0;
    let lastTime = 0;
    let accumulator = 0;
    let started = false;
    let stopped = false;

    // "#rrggbb" + alfa → "rgba(...)"
    const alpha = (hex, a) => {
        const n = parseInt(hex.replace("#", ""), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    };

    // El tamaño del virus y del suelo salen del tamaño del escenario
    function resize(w, h) {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        width = w;
        height = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const radius = Math.max(18, Math.min(BASE_RADIUS, h * 0.13));
        floorY = h - Math.max(16, h * 0.1);
        if (!started) {
            Object.assign(virus, createVirus(radius));
            virus.y = h * 0.35; // entra cayendo
            started = true;
        } else {
            resizeVirus(virus, radius);
        }
        if (reduceMotion.matches) restPose();
    }

    // Movimiento reducido: el virus queda quieto apoyado en el suelo
    function restPose() {
        virus.y = floorY - virus.radius;
        virus.vy = 0;
        virus.scaleX = virus.scaleY = 1;
        virus.velScaleX = virus.velScaleY = 0;
        for (const a of virus.antennas) a.wobble = a.vWobble = 0;
        spores = [];
    }

    function burst(count, x, y, spread, upward) {
        for (let i = 0; i < count && spores.length < MAX_SPORES; i++) {
            const k = virus.k;
            if (upward) {
                spores.push(createSpore(x + (Math.random() - 0.5) * 20 * k, y, (Math.random() - 0.5) * spread * k, (-1 - Math.random() * 4) * k, k));
            } else {
                const angle = Math.random() * Math.PI * 2;
                const speed = (2 + Math.random() * 6) * k;
                spores.push(createSpore(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, k));
            }
        }
    }

    function simulate() {
        const { bounced, impactSpeed } = stepVirus(virus, floorY);
        if (bounced) burst(Math.floor(10 + impactSpeed * 1.5), width / 2, floorY - 2, 8, true);
        spores = spores.filter((s) => stepSpore(s, virus.k));
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);
        const x = width / 2;
        const r = virus.radius;
        const k = virus.k;

        // Línea de suelo tenue
        ctx.strokeStyle = alpha(colors.accent, 0.15);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width * 0.1, floorY);
        ctx.lineTo(width * 0.9, floorY);
        ctx.stroke();

        // Esporas
        for (const s of spores) {
            const a = Math.max(0, s.life / s.maxLife);
            const color = s.light ? colors.light : colors.accent;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size * a, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Sombra en el suelo (se encoge cuando el virus está alto)
        const distance = Math.max(0, floorY - virus.y);
        const shadowScale = Math.max(0.2, 1 - distance / (280 * k));
        ctx.save();
        ctx.translate(x, floorY);
        ctx.scale(shadowScale * virus.scaleX, 0.25);
        ctx.fillStyle = alpha(colors.accent, 0.25);
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Cuerpo con brillo de neón
        ctx.save();
        ctx.translate(x, virus.y);
        ctx.scale(virus.scaleX, virus.scaleY);
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 25;

        const inner = r * 0.42;
        const outer = inner + r * 0.55;
        for (const antenna of virus.antennas) {
            const angle = antenna.angle + antenna.wobble;
            const x1 = Math.cos(angle) * inner;
            const y1 = Math.sin(angle) * inner;
            const x2 = Math.cos(angle) * outer;
            const y2 = Math.sin(angle) * outer;
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 4 * k;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.fillStyle = colors.accent;
            ctx.beginPath();
            ctx.arc(x2, y2, 5.5 * k, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = colors.bg;
            ctx.beginPath();
            ctx.arc(x2, y2, 2.2 * k, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 5 * k;
        ctx.beginPath();
        ctx.arc(0, 0, inner, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = colors.light;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(-r * 0.05, -r * 0.05, r * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Bucle con paso fijo: la física avanza igual a 60, 120 o 144 Hz
    function frame(time) {
        raf = 0;
        if (stopped) return;
        const dt = lastTime ? Math.min((time - lastTime) / 1000, MAX_FRAME_S) : 0;
        lastTime = time;
        accumulator += dt;
        while (accumulator >= STEP_S) {
            simulate();
            accumulator -= STEP_S;
        }
        draw();
        raf = requestAnimationFrame(frame);
    }

    function pause() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        lastTime = 0;
        accumulator = 0;
    }

    function update() {
        pause();
        const interactive = !reduceMotion.matches;
        onInteractiveChange?.(interactive);
        if (stopped || width === 0 || height === 0) return;
        if (!interactive) {
            restPose();
            draw(); // un solo cuadro quieto
            return;
        }
        if (!document.hidden) raf = requestAnimationFrame(frame);
    }

    // Salto potente con ráfaga de esporas (solo con movimiento permitido)
    function jump() {
        if (reduceMotion.matches || width === 0) return;
        boostJump(virus, height * 0.04);
        burst(18, width / 2, virus.y, 0, false);
    }

    const observer = new ResizeObserver(([entry]) => {
        resize(entry.contentRect.width, entry.contentRect.height);
        update();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", update);
    reduceMotion.addEventListener("change", update);

    // Clic o toque en el escenario; Enter o Espacio cuando tiene el foco
    const onPointer = () => jump();
    const onKey = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        jump();
    };
    stage.addEventListener("pointerdown", onPointer);
    stage.addEventListener("keydown", onKey);

    return {
        jump,
        stop() {
            stopped = true;
            pause();
            observer.disconnect();
            document.removeEventListener("visibilitychange", update);
            reduceMotion.removeEventListener("change", update);
            stage.removeEventListener("pointerdown", onPointer);
            stage.removeEventListener("keydown", onKey);
        },
    };
}
