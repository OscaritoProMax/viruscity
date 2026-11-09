// Dibujo del juego en un <canvas>. Solo pinta lo que dice window.lastState (el estado del servidor):
// no calcula posiciones de juego.
//
// createRenderer(canvas, minimap) → {
//   resize(availW, availH), draw(lastState, world, me, nowMs, dt), setZoom(z), getZoom(), area()
// }
//
// - Si el mundo del servidor mide lo mismo que el mapa de Virus City (3840 × 2880), dibuja la ciudad
//   (las colisiones con ese mismo mapa las calcula el servidor). Si no, una cuadrícula simple.
// - La cámara sigue al jugador local; el zoom es solo visual.
// - Vecinos y coches son decorado local: cada cliente ve los suyos y no chocan con nadie.

import { computeView, clampZoom, nextAnim } from "./view.js";
import { resolveLook } from "./characters/look.js";
import { drawCharacter, CHARACTER_HEIGHT, FEET_OFFSET } from "./characters/index.js";
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE, MAP_COLS, MAP_ROWS } from "./map/constants.js";
import { buildWorld, worldObjs, buildingsList, ground, idx } from "./map/layout.js";
import { SPRITES, buildAllPropSprites } from "./map/props.js";
import { buildBuildingSprite } from "./map/buildings.js";
import { drawGround, drawWaterFx } from "./map/ground.js";
import { worldNPCs, buildWorldNPCs, updateNPC, drawNPCEntity, npcFoot, cars, buildCars, updateCars, drawCar } from "./map/npcs.js";
import { hash2, circle } from "./map/draw-utils.js";
import { gameMinutes, ambientAt } from "./map/clock.js";
import { areaName } from "./map/zones.js";

const MAX_DPR = 2;
const GRID_STEP = 100; // cuadrícula del modo sin mapa (unidades del mundo)
const SMOOTHING = 20; // cuanto mayor, más rápido alcanza la posición del servidor
const SNAP_DISTANCE = 200; // si la diferencia es mayor, se salta directamente (sin suavizar)

// Insignia del proveedor: "G" azul de Google sobre blanco, o "L" sobre gris para cuentas locales
const GOOGLE_BLUE = "#4285f4";
const BADGE_WHITE = "#ffffff";

// Árboles y cenador se vuelven translúcidos si tapan al jugador local
const FADE_RE = /^(oak|pine|birch|cherry|forest|gazebo)/;
// Colores del minimapa por tipo de suelo (orden de G en layout.js)
const MINI_COLORS = ["#4a9c3f", "#58aa47", "#3d4452", "#b8c0cb", "#d9cba6", "#1d7fc4", "#ecd9a3", "#a6794a", "#d8cdb2", "#2f3540", "#6b4423", "#8b5a2b", "#2a6e34", "#9fa2a7"];
const MINI_SCALE = 2; // px del minimapa base por casilla

// Lee una variable CSS (tokens.css) con un valor de respaldo
function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function glow(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---------- Ciudad (se construye una sola vez, al primer uso) ----------
let city = null;
function ensureCity() {
    if (city) return city;
    buildAllPropSprites();
    buildWorld();
    for (const o of worldObjs) o.sp = o.kind === "building" ? buildBuildingSprite(o.spec) : SPRITES[o.sprite];
    const objs = worldObjs.filter((o) => o.sp); // un sprite que no exista no rompe el dibujo
    buildWorldNPCs();
    buildCars();

    // Minimapa base: color del suelo por casilla y edificios encima
    const mini = document.createElement("canvas");
    mini.width = MAP_COLS * MINI_SCALE;
    mini.height = MAP_ROWS * MINI_SCALE;
    const m = mini.getContext("2d");
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let q = 0; q < MAP_COLS; q++) {
            m.fillStyle = MINI_COLORS[ground[idx(q, r)]] ?? MINI_COLORS[0];
            m.fillRect(q * MINI_SCALE, r * MINI_SCALE, MINI_SCALE, MINI_SCALE);
        }
    }
    for (const o of buildingsList) {
        const s = o.spec;
        m.fillStyle = s.roof || s.roofTop || { church: "#475569", hall: "#64748b", barn: "#7f1d1d" }[s.kind] || "#57534e";
        m.fillRect(o.c * MINI_SCALE, o.r * MINI_SCALE, s.w * MINI_SCALE, s.h * MINI_SCALE);
    }
    city = { objs, mini, fountain: objs.find((o) => o.fx === "fountain") ?? null };
    return city;
}

export function createRenderer(canvas, minimap) {
    const ctx = canvas.getContext("2d");
    const colors = {
        bg: cssVar("--bg", "#0b1020"),
        border: cssVar("--border", "#2a3560"),
        text: cssVar("--text", "#e6e9f5"),
        muted: cssVar("--muted", "#8f9bc4"),
        accent: cssVar("--accent", "#4dd2ff"),
    };
    const fontMono = cssVar("--font-mono", "monospace");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let zoom = 1;
    let lastView = null;
    let lastMePos = null;

    // Posiciones SOLO para dibujar: se acercan a las del servidor (window.lastState) con un suavizado
    // exponencial. Nunca se escriben en lastState: si alguien lo edita en DevTools, la vista lo refleja
    // y el siguiente state del servidor lo corrige.
    const renderPos = new Map();
    const anims = new Map();

    function smoothedPosition(p, dt) {
        let pos = renderPos.get(p.userId);
        if (!pos || Math.hypot(p.x - pos.x, p.y - pos.y) > SNAP_DISTANCE) {
            pos = { x: p.x, y: p.y };
            renderPos.set(p.userId, pos);
            return pos;
        }
        const k = 1 - Math.exp(-SMOOTHING * dt);
        pos.x += (p.x - pos.x) * k;
        pos.y += (p.y - pos.y) * k;
        return pos;
    }

    // El canvas ocupa todo el espacio disponible (la cámara decide qué parte del mundo se ve)
    function resize(availW, availH) {
        cssW = Math.max(1, Math.floor(availW));
        cssH = Math.max(1, Math.floor(availH));
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
    }

    // Medidas en píxeles de pantalla expresadas en unidades del mundo (líneas y textos nítidos con zoom)
    const px = (n) => n / zoom;

    // ---------- Fondo sin mapa ----------
    function drawPlainWorld(world) {
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, world.width, world.height);
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = px(1);
        ctx.beginPath();
        for (let x = GRID_STEP; x < world.width; x += GRID_STEP) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, world.height);
        }
        for (let y = GRID_STEP; y < world.height; y += GRID_STEP) {
            ctx.moveTo(0, y);
            ctx.lineTo(world.width, y);
        }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = px(2);
        ctx.strokeRect(px(1), px(1), world.width - px(2), world.height - px(2));
    }

    // ---------- Efectos de la ciudad: humo, fuente, noche, luces y neones (de la referencia) ----------
    function cityEffects(c, t, minutes, v) {
        const { vx0, vy0, vx1, vy1 } = v;
        const amb = ambientAt(minutes);
        const night = Math.max(0, Math.min(1, amb.a / 0.32));
        const motion = !reducedMotion.matches;
        if (motion) {
            for (const o of buildingsList) {
                const m = o.sp?.meta?.chimney;
                if (!m) continue;
                const cx = o.x + m.x;
                const cy = o.y - o.sp.ay + m.y;
                if (cx < vx0 - 40 || cx > vx1 + 40 || cy < vy0 - 100 || cy > vy1 + 40) continue;
                for (let k = 0; k < 4; k++) {
                    const ph = (t * 0.0004 + k / 4 + hash2(o.c, o.r, 3)) % 1;
                    const a = (1 - ph) * 0.32 * (0.6 + night * 0.4);
                    circle(c, cx + Math.sin(ph * 6 + k) * 6 + ph * 14, cy - ph * 46, 4 + ph * 9, `rgba(235,235,240,${a.toFixed(3)})`);
                }
            }
            const fo = city.fountain;
            if (fo && fo.x > vx0 - 120 && fo.x < vx1 + 120 && fo.y > vy0 && fo.y < vy1 + 200) {
                const fx = fo.x;
                const fy = fo.y - 124;
                c.save();
                c.strokeStyle = "rgba(200,235,255,0.85)";
                c.lineWidth = 2;
                c.lineCap = "round";
                c.fillStyle = "rgba(210,240,255,0.9)";
                for (let k = 0; k < 14; k++) {
                    const ph = (t * 0.0011 + k / 14) % 1;
                    const ang = (k / 14) * 6.283;
                    c.beginPath();
                    c.arc(fx + Math.cos(ang) * 46 * ph, fy - 30 * ph + 120 * ph * ph + 14, 2, 0, 7);
                    c.fill();
                }
                c.beginPath();
                c.moveTo(fx, fy + 16);
                c.quadraticCurveTo(fx - 3, fy - 6, fx, fy - 14);
                c.stroke();
                for (let k = 0; k < 3; k++) {
                    const ph = (t * 0.0008 + k / 3) % 1;
                    c.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - ph)).toFixed(2)})`;
                    c.beginPath();
                    c.ellipse(fx, fo.y - 46, 22 + ph * 40, 8 + ph * 14, 0, 0, 6.283);
                    c.stroke();
                }
                c.restore();
            }
        }
        // Oscuridad ambiental según la hora (la misma para todos: sale del reloj del servidor)
        if (amb.a > 0.01) {
            c.fillStyle = `rgba(${amb.c[0]},${amb.c[1]},${amb.c[2]},${amb.a.toFixed(3)})`;
            c.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
        }
        // Luces aditivas: farolas y ventanas de noche, neones siempre
        c.save();
        c.globalCompositeOperation = "lighter";
        if (night > 0.05) {
            for (const o of city.objs) {
                if (!o.light || o.x < vx0 - 120 || o.x > vx1 + 120 || o.y < vy0 - 40 || o.y > vy1 + 160) continue;
                glow(c, o.x, o.y - 92, 110, "255,214,120", (0.55 * night).toFixed(2));
            }
            for (const o of buildingsList) {
                if (!o.sp || o.x > vx1 + 20 || o.x + o.sp._w < vx0 - 20 || o.y - o.sp.ay > vy1 || o.y < vy0) continue;
                o.sp.meta.windows.forEach((w, i) => {
                    if (hash2(i, o.c * 7 + o.r, 5) < (w.lamp ? 0 : 0.3)) return;
                    const wx = o.x + w.x;
                    const wy = o.y - o.sp.ay + w.y;
                    c.fillStyle = `rgba(255,196,96,${(0.55 * night).toFixed(2)})`;
                    c.fillRect(wx, wy, w.w, w.h);
                    glow(c, wx + w.w / 2, wy + w.h / 2 + 10, Math.max(w.w, w.h) * 1.3 + 10, "255,190,90", (0.2 * night).toFixed(2));
                });
            }
        }
        for (const o of buildingsList) {
            const n = o.sp?.meta?.neon;
            if (!n) continue;
            const nx = o.x + n.x;
            const ny = o.y - o.sp.ay + n.y;
            if (nx > vx1 + 20 || nx + n.w < vx0 - 20 || ny > vy1 || ny + n.h < vy0) continue;
            const flick = motion ? 0.75 + 0.25 * Math.sin(t * 0.008 + o.c) + (Math.sin(t * 0.021 + o.r * 3) > 0.96 ? -0.4 : 0) : 0.85;
            const base = 0.2 + 0.55 * night;
            const col = n.color === "#fef08a" ? "255,120,160" : n.color === "#4ade80" ? "60,255,140" : "120,230,255";
            glow(c, nx + n.w / 2, ny + n.h / 2 + 6, n.w * 0.7, col, (base * flick * 0.5).toFixed(2));
        }
        c.restore();
    }

    // ---------- Jugadores ----------
    function drawPlayerBody(p, pos, radius, isMe) {
        const anim = anims.get(p.userId);
        const feetY = pos.y + radius; // base de la caja de colisión del servidor = pies del personaje
        ctx.save();
        ctx.translate(pos.x, feetY - FEET_OFFSET);
        // Anillo en el suelo para reconocer al jugador local
        if (isMe) {
            ctx.save();
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2.5;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.ellipse(0, FEET_OFFSET + 2, 26, 10, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        drawCharacter(ctx, resolveLook(p), anim?.dir ?? "DOWN", reducedMotion.matches ? false : Boolean(anim?.moving), anim?.walkTime ?? 0);
        ctx.restore();
    }

    // Nombre en una píldora sobre la cabeza + insignia del proveedor (tamaño constante en pantalla)
    function drawLabel(p, pos, radius, world) {
        const fontSize = px(12);
        ctx.font = `600 ${fontSize}px ${fontMono}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const name = String(p.username ?? "");
        const padX = px(6);
        const pillH = fontSize + px(6);
        const pillW = ctx.measureText(name).width + padX * 2;
        const hasBadge = p.provider === "google" || p.provider === "local";
        const labelW = pillW + (hasBadge ? px(4) + pillH : 0);

        // La etiqueta se mantiene dentro del mundo
        const margin = px(2);
        const pillX = Math.min(Math.max(pos.x - labelW / 2, margin), world.width - labelW - margin);
        const headTop = pos.y + radius - CHARACTER_HEIGHT;
        const above = headTop - px(6) - pillH;
        const pillY = above >= margin ? above : pos.y + radius + px(6);

        ctx.save();
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = colors.bg;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = colors.text;
        ctx.fillText(name, pillX + padX, pillY + pillH / 2);

        if (hasBadge) {
            const r = pillH / 2;
            const cx = pillX + pillW + px(4) + r;
            const cy = pillY + pillH / 2;
            const google = p.provider === "google";
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = google ? BADGE_WHITE : colors.muted;
            ctx.fill();
            ctx.fillStyle = google ? GOOGLE_BLUE : colors.bg;
            ctx.font = `700 ${px(11)}px ${fontMono}`;
            ctx.textAlign = "center";
            ctx.fillText(google ? "G" : "L", cx, cy + px(0.5));
        }
    }

    // ---------- Minimapa ----------
    function drawMinimap(players, positions, meId, world, view, nowMs) {
        if (!minimap) return;
        const mc = minimap.getContext("2d");
        mc.clearRect(0, 0, minimap.width, minimap.height);
        if (!city) return;
        mc.drawImage(city.mini, 0, 0, minimap.width, minimap.height);
        const kx = minimap.width / world.width;
        const ky = minimap.height / world.height;
        mc.strokeStyle = "rgba(255,255,255,0.85)";
        mc.lineWidth = 1;
        mc.strokeRect(view.x * kx, view.y * ky, view.w * kx, view.h * ky);
        for (const p of players) {
            const pos = positions.get(p.userId);
            if (!pos) continue;
            const isMe = p.userId === meId;
            const blink = !reducedMotion.matches && Math.floor(nowMs / 300) % 2;
            mc.fillStyle = isMe ? (blink ? colors.accent : "#ffffff") : resolveLook(p).color;
            mc.beginPath();
            mc.arc(pos.x * kx, pos.y * ky, isMe ? 3.5 : 2.5, 0, Math.PI * 2);
            mc.fill();
            mc.strokeStyle = "#000000";
            mc.stroke();
        }
    }

    // nowMs: reloj del navegador (animaciones). dt: segundos desde el cuadro anterior (suavizado).
    function draw(lastState, world, me, nowMs, dt = 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!world) return;

        const withMap = world.width === WORLD_WIDTH && world.height === WORLD_HEIGHT;
        if (withMap) ensureCity();

        const radius = world.playerRadius;
        const meId = me?.userId ?? null;
        const players = (lastState?.players ?? []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));

        // Posiciones suavizadas y animación (solo visual)
        const positions = new Map();
        for (const p of players) {
            const pos = smoothedPosition(p, dt);
            positions.set(p.userId, pos);
            anims.set(p.userId, nextAnim(anims.get(p.userId), pos.x, pos.y, dt));
        }
        for (const id of [...renderPos.keys()]) {
            if (!positions.has(id)) {
                renderPos.delete(id);
                anims.delete(id);
            }
        }

        // Cámara: sigue al jugador local
        const mePos = positions.get(meId) ?? null;
        lastMePos = mePos ? { x: mePos.x, y: mePos.y } : null;
        const view = computeView(mePos, cssW, cssH, world, zoom);
        lastView = view;
        const scale = zoom * dpr;
        ctx.setTransform(scale, 0, 0, scale, Math.round(-view.x * scale), Math.round(-view.y * scale));
        const v = { vx0: view.x - 8, vy0: view.y - 8, vx1: view.x + view.w + 8, vy1: view.y + view.h + 8 };

        if (withMap) {
            drawGround(ctx, v.vx0, v.vy0, v.vx1, v.vy1);
            if (!reducedMotion.matches) drawWaterFx(ctx, nowMs, v.vx0, v.vy0, v.vx1, v.vy1);
            // Decorado local: vecinos y coches (frenan ante el jugador local, no chocan)
            const f = Math.min(dt, 0.1) * 60;
            for (const n of worldNPCs) updateNPC(n, f, null);
            updateCars(f, mePos?.x ?? -9999, (mePos?.y ?? -9999) + radius - FEET_OFFSET);
        } else {
            drawPlainWorld(world);
        }

        if (!lastState) {
            ctx.fillStyle = colors.muted;
            ctx.font = `600 ${px(16)}px ${fontMono}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Conectando…", view.x + view.w / 2, view.y + view.h / 2);
            drawMinimap([], positions, meId, world, view, nowMs);
            return;
        }

        // Todo lo que tiene "pies" se ordena por su y de suelo (los de más abajo tapan a los de arriba)
        const list = [];
        if (withMap) {
            const meFoot = mePos ? mePos.y + radius : -Infinity;
            const meBox = mePos ? { x: mePos.x - 22, y: meFoot - CHARACTER_HEIGHT - 6, w: 44, h: CHARACTER_HEIGHT + 6 } : null;
            for (const o of city.objs) {
                const x0 = o.x - o.sp.ax;
                const y0 = o.y - o.sp.ay;
                if (x0 > v.vx1 || x0 + o.sp._w < v.vx0 || y0 > v.vy1 || y0 + o.sp._h < v.vy0) continue;
                const covers = meBox && (o.kind === "building" || FADE_RE.test(o.name)) && o.sortY > meFoot &&
                    meBox.x < x0 + o.sp._w && meBox.x + meBox.w > x0 && meBox.y < y0 + o.sp._h && meBox.y + meBox.h > y0 + (o.kind === "building" ? 0 : 20);
                o.a = (o.a ?? 1) + ((covers ? 0.45 : 1) - (o.a ?? 1)) * 0.2;
                list.push({ s: o.sortY, k: 0, o, x0, y0 });
            }
            for (const n of worldNPCs) {
                if (n.x < v.vx0 - 60 || n.x > v.vx1 + 60 || n.y < v.vy0 - 80 || n.y > v.vy1 + 60) continue;
                list.push({ s: npcFoot(n), k: 1, o: n });
            }
            for (const cr of cars) {
                if (cr.x < v.vx0 - 80 || cr.x > v.vx1 + 80 || cr.y < v.vy0 - 60 || cr.y > v.vy1 + 60) continue;
                list.push({ s: cr.y, k: 2, o: cr });
            }
        }
        for (const p of players) {
            const pos = positions.get(p.userId);
            // a igual altura, el jugador local va encima
            list.push({ s: pos.y + radius + (p.userId === meId ? 0.01 : 0), k: 3, p, pos });
        }
        list.sort((a, b) => a.s - b.s);
        for (const it of list) {
            if (it.k === 0) {
                if (it.o.a < 0.99) ctx.globalAlpha = it.o.a;
                ctx.drawImage(it.o.sp, it.x0, it.y0, it.o.sp._w, it.o.sp._h);
                ctx.globalAlpha = 1;
            } else if (it.k === 1) drawNPCEntity(ctx, it.o);
            else if (it.k === 2) drawCar(ctx, it.o);
            else drawPlayerBody(it.p, it.pos, radius, it.p.userId === meId);
        }

        if (withMap) cityEffects(ctx, nowMs, gameMinutes(lastState.t), v);

        // Nombres al final, por encima de la noche, para que siempre se lean
        for (const p of players) drawLabel(p, positions.get(p.userId), radius, world);

        drawMinimap(withMap ? players : [], positions, meId, world, view, nowMs);
    }

    return {
        resize,
        draw,
        setZoom: (z) => (zoom = clampZoom(z)),
        getZoom: () => zoom,
        // Nombre de la zona donde está el jugador local (null sin mapa o sin posición)
        area: () => (city && lastMePos ? areaName(lastMePos.x, lastMePos.y) : null),
        hasCity: () => city !== null,
        view: () => lastView,
    };
}
