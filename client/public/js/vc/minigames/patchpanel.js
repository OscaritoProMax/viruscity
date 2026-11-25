// Minijuego "Panel de conexiones" (central-1, Restaurar el registro de contagios).
// Arrastrar los 4 cables de la izquierda hasta el enchufe con su mismo símbolo a la derecha.
// Teclado: ↑/↓ elige un cable, Enter o Espacio lo toma, ↑/↓ elige el enchufe y Enter o Espacio lo conecta.

import { createStage, createCelebration, palette, clamp, lerp, easeOutCubic, dist, derange, shuffle, roundRect, withAlpha, glowCircle, drawSuccess } from "./canvas-kit.js";

const H = 340;
export const PLUGS = Object.freeze([
    { id: "triangulo", name: "triángulo", token: "danger" },
    { id: "circulo", name: "círculo", token: "cure" },
    { id: "cuadrado", name: "cuadrado", token: "accent" },
    { id: "rombo", name: "rombo", token: "infected" },
]);
const ROW_Y = [74, 142, 210, 278];
const LEFT_X = 86;
const RIGHT_X = 474;
const HIT = 30;

// ---------- Lógica pura ----------
export function createPanel(rng = Math.random) {
    const left = shuffle(PLUGS.map((p) => p.id), rng);
    return { left, right: derange(left, rng), links: {} }; // links: cable izquierdo → enchufe derecho
}
export function canConnect(state, l, r) {
    if (!state || !Number.isInteger(l) || !Number.isInteger(r) || l < 0 || r < 0 || l >= state.left.length || r >= state.right.length) return false;
    if (Object.hasOwn(state.links, l) || Object.values(state.links).includes(r)) return false;
    return state.left[l] === state.right[r];
}
export function connect(state, l, r) {
    return canConnect(state, l, r) ? { ...state, links: { ...state.links, [l]: r } } : state;
}
export const linkCount = (state) => Object.keys(state?.links ?? {}).length;
export const isPanelComplete = (state) => !!state && linkCount(state) === state.left.length;

// ---------- Dibujo ----------
function symbol(ctx, id, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (id === "triangulo") {
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s * 0.95, y + s * 0.75);
        ctx.lineTo(x - s * 0.95, y + s * 0.75);
    } else if (id === "circulo") ctx.arc(x, y, s * 0.85, 0, Math.PI * 2);
    else if (id === "cuadrado") ctx.rect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
    else {
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y);
        ctx.lineTo(x, y + s);
        ctx.lineTo(x - s, y);
    }
    ctx.closePath();
    ctx.fill();
}
// Cable que cuelga entre dos puntos (curva con caída)
function cable(ctx, ax, ay, bx, by, color, sway) {
    const sag = 40 + Math.abs(bx - ax) * 0.12;
    ctx.lineCap = "round";
    for (const [w, c] of [[11, withAlpha("#000000", 0.35)], [8, color], [2, withAlpha("#ffffff", 0.35)]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(ax + (bx - ax) * 0.3, ay + sag + sway, ax + (bx - ax) * 0.7, by + sag - sway, bx, by);
        ctx.stroke();
    }
}

export function mount(container, { onSolved, rng = Math.random, reduceMotion = false, sfx = () => {} } = {}) {
    const pal = palette();
    const colorOf = (id) => pal[PLUGS.find((p) => p.id === id).token];
    const nameOf = (id) => PLUGS.find((p) => p.id === id).name;
    const stage = createStage(container, { height: H, label: "Panel de conexiones", reduceMotion });
    const done = createCelebration(onSolved, reduceMotion);
    let state = createPanel(rng);
    let drag = null; // { l, x, y }
    const retract = new Map(); // cable → { x, y, at } (vuelve a su sitio)
    const flash = new Map(); // enchufe → hora del destello rojo
    const linkedAt = new Map(); // cable → hora en que se conectó
    let keyMode = null; // { phase, l, r }

    const freeLeft = () => state.left.map((_, i) => i).filter((i) => !Object.hasOwn(state.links, i));
    const freeRight = () => state.right.map((_, i) => i).filter((i) => !Object.values(state.links).includes(i));
    const say = () => stage.status(isPanelComplete(state) ? "¡Registro restaurado!" : `Conecta cada cable con su mismo símbolo · ${linkCount(state)} de 4`);
    say();

    function tryLink(l, r, now, from) {
        if (r !== null && canConnect(state, l, r)) {
            state = connect(state, l, r);
            linkedAt.set(l, now);
            stage.burst(RIGHT_X - 26, ROW_Y[r], pal.cure, 18);
            sfx("ok");
            say();
            if (isPanelComplete(state)) {
                sfx("done");
                done.start(now);
            }
            return;
        }
        retract.set(l, { x: from.x, y: from.y, at: now });
        if (r === null) return say();
        flash.set(r, now);
        sfx("error");
        stage.status(`Ese enchufe es el ${nameOf(state.right[r])}: no coincide`);
    }
    const socketAt = (x, y) => {
        let best = null;
        ROW_Y.forEach((ry, i) => {
            const d = dist(x, y, RIGHT_X - 26, ry);
            if (d < HIT + 16 && (!best || d < best.d)) best = { i, d };
        });
        return best ? best.i : null;
    };

    stage.onPointer({
        down(p) {
            if (done.active) return;
            keyMode = null;
            for (const l of freeLeft()) {
                if (dist(p.x, p.y, LEFT_X + 26, ROW_Y[l]) < HIT) {
                    drag = { l, x: p.x, y: p.y };
                    retract.delete(l);
                    sfx("tick");
                    return;
                }
            }
        },
        move(p, e, pressed) {
            if (drag && pressed) {
                drag.x = clamp(p.x, 10, 550);
                drag.y = clamp(p.y, 10, H - 10);
            }
        },
        up(p) {
            if (!drag) return;
            const { l } = drag;
            drag = null;
            tryLink(l, socketAt(p.x, p.y), performance.now(), { x: p.x, y: p.y });
        },
    });

    function onKeyDown(event) {
        if (done.active) return false;
        const k = event.key;
        if (!["ArrowUp", "ArrowDown", "Enter", " "].includes(k)) return false;
        event.preventDefault();
        const now = performance.now();
        if (!keyMode) keyMode = { phase: "left", l: freeLeft()[0], r: freeRight()[0] };
        const cycle = (list, cur, dir) => list[(list.indexOf(cur) + dir + list.length) % list.length] ?? list[0];
        const dir = k === "ArrowUp" ? -1 : 1;
        if (keyMode.phase === "left") {
            if (k === "ArrowUp" || k === "ArrowDown") keyMode.l = cycle(freeLeft(), keyMode.l, dir);
            else {
                keyMode.phase = "right";
                keyMode.r = freeRight()[0];
                sfx("tick");
                stage.status(`Cable ${nameOf(state.left[keyMode.l])} tomado: elige el enchufe con ↑ ↓`);
            }
        } else if (k === "ArrowUp" || k === "ArrowDown") keyMode.r = cycle(freeRight(), keyMode.r, dir);
        else {
            tryLink(keyMode.l, keyMode.r, now, { x: RIGHT_X - 26, y: ROW_Y[keyMode.r] });
            keyMode = { phase: "left", l: freeLeft()[0], r: freeRight()[0] };
        }
        return true;
    }

    stage.loop((dt, now) => {
        const ctx = stage.ctx;
        const sway = reduceMotion ? 0 : Math.sin(now / 600) * 4;
        // panel metálico
        roundRect(ctx, 0, 0, 560, H, 16, "#0b1220");
        roundRect(ctx, 20, 20, 520, 300, 12, "#111c33", pal.border, 2);
        for (const [x, y] of [[34, 34], [526, 34], [34, 306], [526, 306]]) {
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = "#475569";
            ctx.fill();
        }
        ctx.fillStyle = pal.muted;
        ctx.font = `700 12px ${pal.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText("REGISTRO DE CONTAGIOS · BUS DE DATOS", 280, 40);
        // enchufes de la derecha
        state.right.forEach((id, i) => {
            const y = ROW_Y[i];
            const red = flash.has(i) && now - flash.get(i) < 450;
            const used = Object.values(state.links).includes(i);
            roundRect(ctx, RIGHT_X - 50, y - 22, 48, 44, 8, "#0f172a", red ? pal.danger : used ? colorOf(id) : pal.border, 3);
            symbol(ctx, id, RIGHT_X + 26, y, 12, colorOf(id));
            ctx.beginPath();
            ctx.arc(RIGHT_X + 52, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = used ? pal.cure : withAlpha(pal.cure, 0.15);
            ctx.fill();
            if (used) glowCircle(ctx, RIGHT_X + 52, y, 16, pal.cure, 0.5);
            if (keyMode?.phase === "right" && keyMode.r === i) roundRect(ctx, RIGHT_X - 56, y - 28, 120, 56, 10, null, pal.accent, 3);
        });
        // conectores de la izquierda y sus cables
        state.left.forEach((id, i) => {
            const y = ROW_Y[i];
            const color = colorOf(id);
            symbol(ctx, id, LEFT_X - 40, y, 12, color);
            roundRect(ctx, LEFT_X, y - 14, 28, 28, 6, color, withAlpha("#000000", 0.4), 2);
            const ax = LEFT_X + 26;
            if (Object.hasOwn(state.links, i)) {
                const r = state.links[i];
                const t = easeOutCubic(clamp((now - linkedAt.get(i)) / 200, 0, 1));
                cable(ctx, ax, y, lerp(ax + 60, RIGHT_X - 26, t), lerp(y, ROW_Y[r], t), color, sway);
            } else if (drag?.l === i) {
                cable(ctx, ax, y, drag.x, drag.y, color, sway * 0.5);
                ctx.beginPath();
                ctx.arc(drag.x, drag.y, 9, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            } else if (retract.has(i)) {
                const rt = retract.get(i);
                const t = easeOutCubic(clamp((now - rt.at) / 260, 0, 1));
                cable(ctx, ax, y, lerp(rt.x, ax + 14, t), lerp(rt.y, y, t), color, sway);
                if (t >= 1) retract.delete(i);
            } else {
                // cable suelto, enrollado junto a su conector
                cable(ctx, ax, y, ax + 34, y + 6, color, sway * 0.3);
            }
            if (keyMode?.phase === "left" && keyMode.l === i) roundRect(ctx, LEFT_X - 60, y - 26, 100, 52, 10, null, pal.accent, 3);
            if (keyMode?.phase === "right" && keyMode.l === i) roundRect(ctx, LEFT_X - 60, y - 26, 100, 52, 10, null, pal.cure, 2);
        });
        stage.drawParticles(dt);
        stage.label(`Panel de conexiones: ${linkCount(state)} de 4 cables conectados`);
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
