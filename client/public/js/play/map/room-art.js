// Dibujo de las salas de las misiones (rooms.js): piso y paredes de cada sala según su tema, muebles de
// decoración y las 12 consolas (una por minijuego). Todo con canvas, sin imágenes externas.

import { shade, rr, rect, circle, ellipse } from "./draw-utils.js";
import { SPRITES, def, groundShadow } from "./props.js";
import { TILE_SIZE } from "./constants.js";
import { ROOM_COLS, ROOM_ROWS, ROOM_EXIT } from "./rooms.js";

const T = TILE_SIZE;

// ---------- Temas de cada sala ----------
const THEMES = {
    hospital: { floorA: "#e8f1f8", floorB: "#d3e3ef", floor: "tiles", wall: "#dbeafe", wallDark: "#93c5fd", stripe: "#0e7490", sign: "#0e7490", signFg: "#ffffff", trim: "#f8fafc" },
    lab: { floorA: "#334155", floorB: "#3b4a5f", floor: "plates", wall: "#1e293b", wallDark: "#0f172a", stripe: "#14b8a6", sign: "#134e4a", signFg: "#99f6e4", trim: "#475569" },
    pharmacy: { floorA: "#d1fae5", floorB: "#bbf7d0", floor: "tiles", wall: "#ecfdf5", wallDark: "#86efac", stripe: "#16a34a", sign: "#15803d", signFg: "#ffffff", trim: "#f0fdf4" },
    datacenter: { floorA: "#0f172a", floorB: "#131d36", floor: "raised", wall: "#0b1220", wallDark: "#020617", stripe: "#38bdf8", sign: "#020617", signFg: "#38bdf8", trim: "#1e293b" },
    plant: { floorA: "#3f3f46", floorB: "#52525b", floor: "grate", wall: "#27272a", wallDark: "#18181b", stripe: "#facc15", sign: "#365314", signFg: "#d9f99d", trim: "#3f3f46" },
    warehouse: { floorA: "#a8a29e", floorB: "#9f9893", floor: "concrete", wall: "#78716c", wallDark: "#57534e", stripe: "#ea580c", sign: "#7c2d12", signFg: "#fed7aa", trim: "#a8a29e" },
};

function hazard(c, x, y, w, h, a = "#facc15", b = "#18181b") {
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    rect(c, x, y, w, h, a);
    c.fillStyle = b;
    for (let k = -h; k < w + h; k += 16) {
        c.beginPath();
        c.moveTo(x + k, y + h);
        c.lineTo(x + k + 8, y + h);
        c.lineTo(x + k + 8 + h, y);
        c.lineTo(x + k + h, y);
        c.fill();
    }
    c.restore();
}

function paintFloor(c, th, x0, y0, w, h) {
    if (th.floor === "tiles") {
        for (let y = y0; y < y0 + h; y += 24) for (let x = x0; x < x0 + w; x += 24) rect(c, x, y, 24, 24, ((x + y) / 24) % 2 ? th.floorA : th.floorB);
        c.fillStyle = "rgba(255,255,255,0.35)";
        for (let y = y0; y < y0 + h; y += 24) c.fillRect(x0, y, w, 1);
    } else if (th.floor === "plates") {
        rect(c, x0, y0, w, h, th.floorA);
        for (let y = y0; y < y0 + h; y += T) for (let x = x0; x < x0 + w; x += T) {
            rr(c, x + 2, y + 2, T - 4, T - 4, 3, th.floorB);
            [[6, 6], [T - 8, 6], [6, T - 8], [T - 8, T - 8]].forEach(([dx, dy]) => circle(c, x + dx, y + dy, 1.6, "#64748b"));
        }
    } else if (th.floor === "raised") {
        rect(c, x0, y0, w, h, th.floorA);
        for (let y = y0; y < y0 + h; y += T) for (let x = x0; x < x0 + w; x += T) {
            rect(c, x + 1, y + 1, T - 2, T - 2, th.floorB);
            if (((x + y) / T) % 3 === 0) for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) circle(c, x + 10 + k * 9, y + 10 + j * 9, 1.4, "#1e3a5f");
        }
        c.fillStyle = "rgba(56,189,248,0.06)";
        c.fillRect(x0, y0, w, h);
    } else if (th.floor === "grate") {
        rect(c, x0, y0, w, h, th.floorA);
        c.strokeStyle = th.floorB;
        c.lineWidth = 2;
        for (let x = x0; x < x0 + w; x += 8) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + h); c.stroke(); }
        c.strokeStyle = "rgba(0,0,0,0.35)";
        for (let y = y0; y < y0 + h; y += T) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke(); }
    } else {
        rect(c, x0, y0, w, h, th.floorA);
        for (let k = 0; k < 220; k++) { const px = x0 + ((k * 97) % w), py = y0 + ((k * 61) % h); rect(c, px, py, 2, 2, k % 2 ? th.floorB : "rgba(0,0,0,0.06)"); }
        c.strokeStyle = "#eab308";
        c.lineWidth = 4;
        c.setLineDash([18, 10]);
        c.strokeRect(x0 + 2 * T + 12, y0 + 2 * T - 30, 7 * T - 24, 3 * T);
        c.setLineDash([]);
    }
}

// Piso, paredes y cartel de una sala (canvas del tamaño de la sala)
export function paintRoomBase(sc) {
    const th = THEMES[sc.theme] ?? THEMES.lab;
    const W = ROOM_COLS * T, H = ROOM_ROWS * T;
    const base = document.createElement("canvas");
    base.width = W;
    base.height = H;
    const c = base.getContext("2d");
    rect(c, 0, 0, W, H, th.wallDark);
    paintFloor(c, th, T, 2 * T, W - 2 * T, (ROOM_ROWS - 3) * T);
    // pared del fondo con franja y zócalo
    rect(c, 0, 0, W, 2 * T, th.wall);
    rect(c, 0, 0, W, 6, shade(th.wall, -0.35));
    if (sc.theme === "plant") hazard(c, 0, 2 * T - 22, W, 12);
    else rect(c, 0, 2 * T - 22, W, 8, th.stripe);
    rect(c, 0, 2 * T - 6, W, 6, "rgba(0,0,0,0.28)");
    wallDecor(c, sc.theme, th, W); // a los lados del cartel, dentro de las paredes laterales
    // cartel con el nombre de la sala (centro de la pared)
    c.save();
    if (sc.theme === "datacenter" || sc.theme === "lab") { c.shadowColor = th.signFg; c.shadowBlur = 14; }
    rr(c, W / 2 - 132, 14, 264, 36, 8, th.sign, th.signFg, 2);
    c.restore();
    c.fillStyle = th.signFg;
    c.font = "900 15px 'Orbitron', Arial Black";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(sc.name.toUpperCase(), W / 2, 33);
    c.textBaseline = "alphabetic";
    // paredes laterales
    [0, W - T].forEach((x) => {
        rect(c, x, 0, T, H, th.wallDark);
        rect(c, x, 0, T, H, "rgba(0,0,0,0.15)");
        for (let y = 2 * T; y < H; y += 24) rect(c, x, y, T, 2, "rgba(255,255,255,0.08)");
    });
    rect(c, T - 6, 2 * T, 6, (ROOM_ROWS - 3) * T, "rgba(0,0,0,0.25)");
    rect(c, W - T, 2 * T, 6, (ROOM_ROWS - 3) * T, "rgba(0,0,0,0.25)");
    // pared inferior con la puerta
    const ex0 = ROOM_EXIT.cols[0] * T, ew = ROOM_EXIT.cols.length * T, ey = ROOM_EXIT.row * T;
    rect(c, 0, ey, W, T, th.wallDark);
    rect(c, 0, ey, W, 4, th.trim);
    rr(c, ex0 - 2, ey - 4, ew + 4, T + 4, 3, th.trim);
    rect(c, ex0 + 2, ey, ew - 4, T, "#38bdf8");
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath(); c.moveTo(ex0 + 6, ey + T); c.lineTo(ex0 + 40, ey); c.lineTo(ex0 + 54, ey); c.lineTo(ex0 + 20, ey + T); c.fill();
    rr(c, ex0 + 4, ey - 40, ew - 8, 32, 4, "#1f2937");
    c.fillStyle = "#e5e7eb";
    c.font = "900 8px 'Orbitron', Arial";
    c.textAlign = "center";
    c.fillText(sc.theme === "hospital" ? "MANOS LIMPIAS" : "SOLO PERSONAL", ex0 + ew / 2, ey - 21);
    return base;
}

// Decoración de la pared del fondo: un elemento a la izquierda (x 60-148) y otro a la derecha (W-148 a W-60)
function wallDecor(c, theme, th, W) {
    const L = 60, R = W - 148;
    if (theme === "hospital") {
        rr(c, L + 22, 18, 40, 40, 6, "#ffffff", "#ef4444", 2); rect(c, L + 38, 24, 8, 28, "#ef4444"); rect(c, L + 28, 34, 28, 8, "#ef4444");
        rr(c, R + 8, 14, 74, 46, 4, "#0f172a", "#475569", 2);
        c.strokeStyle = "#4ade80"; c.lineWidth = 2; c.beginPath(); c.moveTo(R + 14, 38);
        [[8, 0], [6, -12], [6, 22], [6, -14], [6, 4], [10, 0], [6, -10], [6, 14], [8, 0]].reduce((x, [dx, dy]) => { c.lineTo(x + dx, 38 + dy); return x + dx; }, R + 14);
        c.stroke();
    } else if (theme === "lab") {
        rr(c, L, 12, 88, 50, 3, "#f8fafc", "#94a3b8", 2);
        c.fillStyle = "#1e293b"; c.font = "bold 8px Arial"; c.textAlign = "left";
        ["C6H12O6 + V → ?", "ARN-v  Δ = 0,3", "¡LA CURA EXISTE!"].forEach((t, k) => c.fillText(t, L + 5, 26 + k * 13));
        hazard(c, R, 26, 88, 18, "#facc15", "#0f172a");
    } else if (theme === "pharmacy") {
        c.save(); c.shadowColor = "#22c55e"; c.shadowBlur = 16;
        rect(c, L + 37, 16, 14, 42, "#22c55e"); rect(c, L + 23, 30, 42, 14, "#22c55e"); c.restore();
        for (let k = 0; k < 4; k++) { rr(c, R + k * 22, 18, 18, 40, 3, ["#fef3c7", "#e0f2fe", "#fce7f3", "#dcfce7"][k], "#94a3b8", 1); rect(c, R + 3 + k * 22, 30, 12, 6, ["#f59e0b", "#0ea5e9", "#ec4899", "#16a34a"][k]); }
    } else if (theme === "datacenter") {
        for (let k = 0; k < 14; k++) circle(c, L + 4 + k * 6, 24 + (k % 3) * 12, 2, k % 4 ? "#38bdf8" : "#4ade80");
        rr(c, R, 14, 88, 46, 3, "#020617", "#38bdf8", 2);
        c.fillStyle = "#38bdf8"; c.font = "bold 8px monospace"; c.textAlign = "left";
        ["> registro.db", "  ERROR 3/12", "> reparar_"].forEach((t, k) => c.fillText(t, R + 5, 28 + k * 12));
    } else if (theme === "plant") {
        // tuberías por la pared (el cartel se dibuja encima)
        [22, 58].forEach((y) => { rr(c, 0, y - 6, W, 12, 6, "#71717a"); rect(c, 0, y - 4, W, 3, "rgba(255,255,255,0.25)"); });
        for (let x = L; x < W - 48; x += 150) { circle(c, x, 22, 10, "#3f3f46"); circle(c, x, 22, 6, "#a1a1aa"); }
        rr(c, R + 10, 30, 70, 24, 4, "#14532d", "#84cc16", 2); c.fillStyle = "#d9f99d"; c.font = "bold 9px monospace"; c.textAlign = "center"; c.fillText("PRESIÓN ▲", R + 45, 46);
    } else if (theme === "warehouse") {
        // persiana metálica y cajas en la estantería del fondo
        rr(c, L, 8, 88, 80, 3, "#57534e"); for (let y = 12; y < 86; y += 7) rect(c, L + 2, y, 84, 3, "#a8a29e");
        for (let k = 0; k < 3; k++) { rect(c, R + k * 30, 16, 26, 30, ["#b45309", "#92400e", "#a16207"][k]); rect(c, R + k * 30, 28, 26, 4, "#fde68a"); }
    }
}

// ---------- Sprites: decoración ----------
function buildDecor() {
    def("hospbed", 96, 84, 48, 78, (c) => {
        groundShadow(c, 48, 76, 44, 6, 0.3);
        rr(c, 4, 34, 88, 34, 6, "#cbd5e1"); rr(c, 8, 26, 80, 30, 8, "#ffffff", "#93c5fd", 2);
        rr(c, 10, 28, 26, 16, 6, "#e0f2fe"); rr(c, 40, 34, 46, 18, 4, "#60a5fa");
        rect(c, 6, 66, 4, 12, "#64748b"); rect(c, 86, 66, 4, 12, "#64748b"); circle(c, 8, 78, 3, "#334155"); circle(c, 88, 78, 3, "#334155");
        rect(c, 88, 4, 3, 40, "#94a3b8"); rr(c, 80, 2, 18, 22, 4, "rgba(186,230,253,0.85)", "#7dd3fc", 1);
    });
    def("medcart", 48, 70, 24, 64, (c) => {
        groundShadow(c, 24, 62, 20, 5, 0.3);
        rr(c, 6, 18, 36, 40, 3, "#e2e8f0", "#94a3b8", 1.5); rect(c, 8, 30, 32, 2, "#94a3b8"); rect(c, 8, 44, 32, 2, "#94a3b8");
        rr(c, 10, 10, 12, 10, 2, "#fca5a5"); rr(c, 24, 8, 14, 12, 2, "#bfdbfe"); circle(c, 10, 62, 3, "#334155"); circle(c, 38, 62, 3, "#334155");
    });
    def("labbench", 96, 86, 48, 80, (c) => {
        groundShadow(c, 48, 78, 44, 6, 0.3);
        rr(c, 2, 34, 92, 40, 3, "#475569"); rr(c, 0, 30, 96, 10, 2, "#e2e8f0");
        [[14, "#22c55e"], [34, "#38bdf8"], [56, "#f472b6"], [76, "#facc15"]].forEach(([x, col]) => { rr(c, x - 6, 8, 12, 24, 4, "rgba(226,232,240,0.6)", "#cbd5e1", 1); rect(c, x - 5, 20, 10, 11, col); });
        circle(c, 48, 60, 6, "#94a3b8");
    });
    def("chemshelf", 48, 112, 24, 106, (c) => {
        groundShadow(c, 24, 104, 22, 5, 0.3);
        rr(c, 2, 6, 44, 98, 3, "#334155"); rect(c, 4, 8, 40, 94, "#1e293b");
        for (let s = 0; s < 4; s++) {
            const y = 12 + s * 23; rect(c, 4, y + 18, 40, 3, "#64748b");
            for (let k = 0; k < 4; k++) rr(c, 7 + k * 9.5, y + 4, 7, 14, 2, ["#22c55e", "#38bdf8", "#f97316", "#e879f9", "#facc15"][(k + s) % 5]);
        }
    });
    def("pharmcounter", 192, 76, 96, 70, (c) => {
        groundShadow(c, 96, 68, 92, 6, 0.3);
        rr(c, 2, 24, 188, 44, 4, "#16a34a"); rr(c, 0, 20, 192, 10, 3, "#f0fdf4"); rect(c, 2, 34, 188, 2, "rgba(255,255,255,0.35)");
        rr(c, 140, 2, 34, 22, 3, "#1e293b"); rect(c, 143, 5, 28, 12, "#4ade80");
        for (let k = 0; k < 5; k++) rr(c, 14 + k * 22, 8, 14, 14, 3, ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#fed7aa"][k]);
        c.fillStyle = "#ffffff"; c.font = "900 10px 'Orbitron', Arial"; c.textAlign = "center"; c.fillText("DISPENSACIÓN", 96, 52);
    });
    def("serverrack", 48, 116, 24, 110, (c) => {
        groundShadow(c, 24, 108, 22, 5, 0.3);
        rr(c, 3, 4, 42, 104, 3, "#0f172a", "#334155", 1.5);
        for (let k = 0; k < 9; k++) {
            const y = 10 + k * 11; rect(c, 7, y, 34, 8, "#1e293b");
            circle(c, 12, y + 4, 1.6, k % 3 ? "#38bdf8" : "#4ade80"); circle(c, 17, y + 4, 1.6, k % 4 ? "#1d4ed8" : "#f43f5e");
            rect(c, 24, y + 3, 14, 2, "#334155");
        }
    });
    def("tank", 48, 120, 24, 114, (c) => {
        groundShadow(c, 24, 112, 22, 5, 0.3);
        rr(c, 4, 10, 40, 100, 18, "#a1a1aa", "#52525b", 2); rect(c, 4, 40, 40, 5, "#71717a"); rect(c, 4, 80, 40, 5, "#71717a");
        rr(c, 14, 50, 20, 26, 5, "#14532d"); rect(c, 16, 60, 16, 14, "#84cc16"); circle(c, 24, 20, 6, "#52525b");
        rect(c, 10, 14, 4, 92, "rgba(255,255,255,0.25)");
    });
    def("barrels", 48, 66, 24, 60, (c) => {
        groundShadow(c, 24, 58, 22, 5, 0.3);
        rr(c, 6, 14, 36, 44, 6, "#facc15", "#a16207", 1.5); rect(c, 6, 24, 36, 3, "#a16207"); rect(c, 6, 46, 36, 3, "#a16207");
        ellipse(c, 24, 14, 18, 5, "#eab308"); circle(c, 24, 36, 7, "#18181b"); circle(c, 24, 36, 4, "#facc15");
    });
    def("cratestack", 48, 104, 24, 98, (c) => {
        groundShadow(c, 24, 96, 22, 5, 0.3);
        [[2, 52, 44, 44], [6, 14, 36, 38]].forEach(([x, y, w, h]) => {
            rr(c, x, y, w, h, 2, "#b45309", "#78350f", 2);
            c.strokeStyle = "#78350f"; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y + h); c.moveTo(x + w, y); c.lineTo(x, y + h); c.stroke();
        });
        rr(c, 12, 60, 24, 10, 2, "#fef3c7"); c.fillStyle = "#7c2d12"; c.font = "bold 7px Arial"; c.textAlign = "center"; c.fillText("SUERO", 24, 68);
    });
    def("forklift", 96, 90, 48, 84, (c) => {
        groundShadow(c, 48, 82, 44, 6, 0.3);
        rr(c, 26, 30, 52, 40, 6, "#f59e0b", "#b45309", 2); rr(c, 34, 12, 34, 24, 4, "rgba(186,230,253,0.6)", "#334155", 2);
        rect(c, 8, 10, 5, 66, "#475569"); rect(c, 2, 66, 30, 5, "#64748b"); rect(c, 2, 50, 30, 4, "#64748b");
        circle(c, 36, 74, 9, "#18181b"); circle(c, 70, 74, 9, "#18181b"); circle(c, 36, 74, 4, "#a1a1aa"); circle(c, 70, 74, 4, "#a1a1aa");
    });
}

// ---------- Sprites: las 12 consolas (2 casillas de ancho, base en (48, 104)) ----------
function consoleBase(c, top = "#334155", body = "#1e293b") {
    groundShadow(c, 48, 102, 44, 6, 0.32);
    rr(c, 4, 60, 88, 42, 4, body, shade(body, 0.35), 1.5);
    rr(c, 0, 56, 96, 10, 3, top);
    rect(c, 0, 56, 96, 3, "rgba(255,255,255,0.25)");
}
function screen(c, x, y, w, h, glow = "#38bdf8") {
    rr(c, x - 3, y - 3, w + 6, h + 6, 3, "#0f172a", "#475569", 1.5);
    rect(c, x, y, w, h, "#020617");
    c.fillStyle = glow; c.globalAlpha = 0.18; c.fillRect(x, y, w, h); c.globalAlpha = 1;
}

function buildConsoles() {
    const C = (name, draw) => def(`console_${name}`, 96, 112, 48, 104, draw);
    C("samples", (c) => {
        consoleBase(c, "#e2e8f0", "#94a3b8");
        rr(c, 10, 30, 76, 26, 3, "#f8fafc", "#cbd5e1", 1.5);
        [["#ef4444", 20], ["#facc15", 38], ["#38bdf8", 56], ["#22c55e", 74]].forEach(([col, x]) => { rr(c, x - 5, 10, 10, 34, 4, "rgba(255,255,255,0.75)", "#cbd5e1", 1); rect(c, x - 4, 26, 8, 16, shade(col, 0.2)); rr(c, x - 6, 6, 12, 7, 2, col); });
        rr(c, 14, 72, 30, 18, 2, "#0f172a"); rect(c, 17, 75, 24, 4, "#22c55e");
    });
    C("uvlamp", (c) => {
        groundShadow(c, 48, 102, 44, 6, 0.32);
        rr(c, 6, 62, 84, 22, 8, "#e0f2fe", "#7dd3fc", 2); rect(c, 14, 84, 6, 18, "#64748b"); rect(c, 76, 84, 6, 18, "#64748b");
        rect(c, 84, 18, 5, 50, "#94a3b8"); rect(c, 46, 16, 42, 5, "#94a3b8");
        ellipse(c, 44, 24, 18, 8, "#475569"); c.save(); c.globalAlpha = 0.35; ellipse(c, 44, 52, 26, 18, "#a78bfa"); c.restore();
        ellipse(c, 44, 27, 12, 4, "#c4b5fd");
        [[30, 72], [50, 70], [64, 74]].forEach(([x, y]) => circle(c, x, y, 3, "#7cff6b"));
    });
    C("microscope", (c) => {
        consoleBase(c, "#e2e8f0", "#475569");
        rr(c, 30, 46, 36, 10, 3, "#334155"); rect(c, 44, 18, 8, 30, "#1e293b"); rr(c, 38, 8, 22, 14, 4, "#0f172a");
        rect(c, 52, 12, 18, 6, "#334155"); circle(c, 40, 34, 7, "#64748b"); circle(c, 40, 34, 3, "#cbd5e1");
        ellipse(c, 16, 52, 9, 4, "rgba(186,230,253,0.7)"); circle(c, 16, 51, 2, "#7cff6b"); ellipse(c, 80, 52, 9, 4, "rgba(186,230,253,0.7)");
    });
    C("helix", (c) => {
        consoleBase(c);
        rr(c, 8, 4, 80, 54, 6, "#1e293b", "#38bdf8", 1.5); screen(c, 16, 12, 64, 36, "#4dd2ff");
        c.lineWidth = 2;
        for (let k = 0; k < 2; k++) { c.strokeStyle = k ? "#7cff6b" : "#4dd2ff"; c.beginPath(); for (let x = 0; x <= 64; x += 2) { const y = 30 + Math.sin((x / 64) * Math.PI * 3 + k * Math.PI) * 12; x ? c.lineTo(16 + x, y) : c.moveTo(16 + x, y); } c.stroke(); }
        for (let x = 4; x < 64; x += 8) { const a = Math.sin((x / 64) * Math.PI * 3) * 12; rect(c, 16 + x, 30 - Math.abs(a), 1.5, Math.abs(a) * 2, "rgba(255,209,102,0.7)"); }
        rr(c, 30, 72, 36, 8, 3, "#0f172a"); rect(c, 34, 74, 28, 4, "#38bdf8");
    });
    C("dosing", (c) => {
        consoleBase(c, "#e2e8f0", "#16a34a");
        rect(c, 64, 10, 6, 46, "#94a3b8"); rect(c, 40, 10, 30, 6, "#94a3b8"); rect(c, 40, 16, 4, 10, "#64748b");
        c.fillStyle = "rgba(255,255,255,0.7)"; c.beginPath(); c.moveTo(30, 34); c.lineTo(54, 34); c.lineTo(52, 56); c.lineTo(32, 56); c.fill();
        rect(c, 33, 46, 18, 9, "#7cff6b");
        c.fillStyle = "rgba(255,255,255,0.75)"; c.beginPath(); c.moveTo(10, 56); c.lineTo(16, 34); c.lineTo(16, 22); c.lineTo(22, 22); c.lineTo(22, 34); c.lineTo(28, 56); c.fill(); rect(c, 12, 44, 14, 11, "#ffd166");
        rr(c, 72, 70, 16, 16, 3, "#0f172a"); circle(c, 80, 78, 4, "#ef4444");
    });
    C("labeling", (c) => {
        consoleBase(c, "#cbd5e1", "#334155");
        rr(c, 2, 40, 92, 14, 7, "#18181b"); for (let x = 8; x < 92; x += 10) rect(c, x, 44, 4, 6, "#3f3f46");
        [[18, "#ef4444"], [44, "#38bdf8"], [70, "#facc15"]].forEach(([x, col]) => { rr(c, x - 6, 18, 12, 24, 3, "rgba(255,255,255,0.8)", "#cbd5e1", 1); rect(c, x - 5, 30, 10, 11, col); rr(c, x - 6, 14, 12, 6, 2, "#475569"); });
        rr(c, 64, 64, 24, 24, 12, "#f8fafc", "#94a3b8", 2); circle(c, 76, 76, 5, "#94a3b8");
    });
    C("patchpanel", (c) => {
        groundShadow(c, 48, 102, 44, 6, 0.32);
        rr(c, 6, 4, 84, 98, 4, "#0f172a", "#334155", 2);
        for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) { rr(c, 14 + k * 12, 14 + r * 14, 9, 9, 2, "#1e293b"); circle(c, 18.5 + k * 12, 18.5 + r * 14, 2, ["#ef4444", "#facc15", "#38bdf8", "#7cff6b"][r]); }
        c.lineWidth = 3; [["#ef4444", 20, 70], ["#facc15", 44, 84], ["#38bdf8", 68, 74]].forEach(([col, x, y]) => { c.strokeStyle = col; c.beginPath(); c.moveTo(x, 22); c.quadraticCurveTo(x + 6, y + 10, x + 10, y); c.stroke(); });
        rr(c, 22, 88, 52, 8, 3, "#020617"); rect(c, 26, 90, 20, 4, "#38bdf8");
    });
    C("transfer", (c) => {
        consoleBase(c, "#475569", "#1e293b");
        screen(c, 6, 14, 34, 26, "#4dd2ff"); screen(c, 56, 14, 34, 26, "#7cff6b");
        rect(c, 20, 40, 6, 16, "#334155"); rect(c, 70, 40, 6, 16, "#334155");
        c.strokeStyle = "#ffd166"; c.lineWidth = 2; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(40, 27); c.lineTo(56, 27); c.stroke(); c.setLineDash([]);
        rect(c, 10, 30, 26, 4, "#334155"); rect(c, 10, 30, 16, 4, "#4dd2ff");
        rect(c, 46, 2, 4, 14, "#64748b"); circle(c, 48, 2, 3, "#ef4444");
    });
    C("valves", (c) => {
        groundShadow(c, 48, 102, 44, 6, 0.32);
        rr(c, 0, 52, 96, 14, 7, "#71717a"); rect(c, 0, 55, 96, 3, "rgba(255,255,255,0.25)");
        [16, 48, 80].forEach((x, k) => {
            rect(c, x - 4, 24, 8, 30, "#52525b");
            circle(c, x, 22, 11, "#b91c1c"); circle(c, x, 22, 7, "#18181b"); circle(c, x, 22, 3, "#ef4444");
            rr(c, x - 12, 70, 24, 24, 12, "#f4f4f5", "#52525b", 2); c.strokeStyle = "#16a34a"; c.lineWidth = 3; c.beginPath(); c.arc(x, 82, 8, -2.2, -1.2); c.stroke();
            c.strokeStyle = "#18181b"; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 82); c.lineTo(x + 6 * Math.cos(-2.6 + k * 0.7), 82 + 6 * Math.sin(-2.6 + k * 0.7)); c.stroke();
        });
    });
    C("reactor", (c) => {
        groundShadow(c, 48, 102, 44, 6, 0.32);
        rr(c, 18, 70, 60, 32, 4, "#3f3f46", "#71717a", 2);
        c.save(); c.shadowColor = "#84cc16"; c.shadowBlur = 16; rr(c, 30, 6, 36, 68, 16, "rgba(132,204,22,0.55)", "#a3e635", 2); c.restore();
        rect(c, 26, 22, 44, 6, "#52525b"); rect(c, 26, 48, 44, 6, "#52525b");
        circle(c, 48, 38, 8, "#ecfccb");
        [[26, 84, "#ef4444"], [40, 84, "#facc15"], [56, 84, "#38bdf8"], [70, 84, "#7cff6b"]].forEach(([x, y, col]) => circle(c, x, y, 5, col));
    });
    C("loading", (c) => {
        groundShadow(c, 48, 102, 44, 6, 0.32);
        rect(c, 4, 92, 88, 8, "#a16207"); for (let x = 8; x < 92; x += 16) rect(c, x, 92, 8, 10, "#854d0e");
        [[8, 58, 38, 34], [50, 58, 38, 34], [26, 26, 40, 32]].forEach(([x, y, w, h]) => { rr(c, x, y, w, h, 2, "#d97706", "#92400e", 2); rect(c, x + w / 2 - 4, y, 8, h, "rgba(255,255,255,0.18)"); });
        rr(c, 32, 36, 28, 12, 2, "#fef3c7"); c.fillStyle = "#7c2d12"; c.font = "bold 7px Arial"; c.textAlign = "center"; c.fillText("CURA", 46, 45);
    });
    C("scanner", (c) => {
        consoleBase(c, "#a8a29e", "#57534e");
        rr(c, 8, 22, 40, 34, 2, "#d97706", "#92400e", 2);
        for (let k = 0; k < 12; k++) rect(c, 14 + k * 2.6, 30, k % 3 ? 1.2 : 2, 18, "#18181b");
        rr(c, 58, 18, 18, 30, 6, "#334155"); rect(c, 62, 44, 10, 14, "#1e293b"); c.save(); c.globalAlpha = 0.6; rect(c, 52, 34, 30, 2, "#ef4444"); c.restore();
        screen(c, 62, 70, 24, 14, "#7cff6b");
    });
}

let built = false;
export function buildRoomSprites() {
    if (built) return;
    built = true;
    buildDecor();
    buildConsoles();
}

export const ROOM_THEMES = Object.freeze(Object.keys(THEMES));
export { SPRITES };
