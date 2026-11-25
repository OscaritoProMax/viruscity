// Suelo: casillas pintadas en trozos de 16 × 16 cacheados en canvas y agua animada.
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { hash2, rect, circle, ellipse } from "./draw-utils.js";
import { G, ground, roadCount, lines, zebra, cropKind, idx, inMap, gAt, groundDecals, waterTiles } from "./layout.js";
import { TILE_SIZE, MAP_COLS, MAP_ROWS } from "./constants.js";

// =====================================================================
//  RENDER DEL SUELO — chunks de 16×16 tiles cacheados en canvas
// =====================================================================
const CHUNK = 16;
const chunkCache = new Map();

const GRASS_COLORS = ['#5fb04a', '#5aa846', '#64b64e', '#58a444'];

function paintTile(c, t, col, row, x, y) {
    const T = TILE_SIZE, h = hash2(col, row, 1), h2 = hash2(col, row, 2);
    const N4 = { u: gAt(col, row - 1), d: gAt(col, row + 1), l: gAt(col - 1, row), r: gAt(col + 1, row) };
    switch (t) {
        case G.GRASS: case G.LAWN: case G.FOREST: {
            let base = GRASS_COLORS[Math.floor(h * 4)];
            if (t === G.LAWN) base = ((col >> 1) + (row >> 1)) % 2 ? '#62b84c' : '#5aae47';
            if (t === G.FOREST) base = h < 0.5 ? '#2f7a3a' : '#2a6e34';
            rect(c, x, y, T, T, base);
            c.fillStyle = 'rgba(0,0,0,0.07)'; for (let k = 0; k < 3; k++) { const bx = hash2(col, row, 10 + k) * 40, by = hash2(col, row, 20 + k) * 40; c.beginPath(); c.ellipse(x + bx + 4, y + by + 4, 7, 4, 0, 0, 7); c.fill(); }
            c.strokeStyle = t === G.FOREST ? '#1f5a2a' : '#3f9a3a'; c.lineWidth = 1.6; c.lineCap = 'round';
            for (let k = 0; k < 4; k++) { const bx = x + 4 + hash2(col, row, 30 + k) * 40, by = y + 8 + hash2(col, row, 40 + k) * 34; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - 2, by - 5); c.moveTo(bx, by); c.lineTo(bx + 2, by - 6); c.stroke(); }
            if (t !== G.FOREST && h2 < 0.14) { const fc = ['#fff', '#fde047', '#f9a8d4', '#c4b5fd'][Math.floor(h * 40) % 4]; const fx = x + 8 + h * 30, fy = y + 10 + h2 * 200; circle(c, fx, fy, 2.2, fc); circle(c, fx, fy, 0.9, '#f59e0b'); }
            break;
        }
        case G.ROAD: {
            rect(c, x, y, T, T, h < 0.5 ? '#3d4452' : '#3a414e');
            c.fillStyle = 'rgba(255,255,255,0.045)'; for (let k = 0; k < 7; k++) c.fillRect(x + hash2(col, row, 50 + k) * 46, y + hash2(col, row, 60 + k) * 46, 2, 2);
            c.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < 5; k++) c.fillRect(x + hash2(col, row, 70 + k) * 44, y + hash2(col, row, 80 + k) * 44, 3, 2);
            const i = idx(col, row), z = zebra[i];
            if (z) { c.fillStyle = 'rgba(245,245,245,0.92)'; if (z === 1) for (let k = 0; k < 4; k++) c.fillRect(x + 4, y + 3 + k * 12, T - 8, 6); else for (let k = 0; k < 4; k++) c.fillRect(x + 3 + k * 12, y + 4, 6, T - 8); }
            // líneas viales
            const drawLine = (type, x1, y1, x2, y2) => {
                const horiz = y1 === y2;
                if (type === 1 || type === 3) { c.strokeStyle = type === 1 ? '#e5e7eb' : '#fbbf24'; c.lineWidth = 3; c.setLineDash([14, 12]); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.setLineDash([]); }
                else if (type === 2) { c.strokeStyle = '#fbbf24'; c.lineWidth = 2.2; for (const o of [-2.6, 2.6]) { c.beginPath(); horiz ? (c.moveTo(x1, y1 + o), c.lineTo(x2, y2 + o)) : (c.moveTo(x1 + o, y1), c.lineTo(x2 + o, y2)); c.stroke(); } }
            };
            if (!z) {
                if (lines.bot[i]) drawLine(lines.bot[i], x, y + T, x + T, y + T);
                if (lines.right[i]) drawLine(lines.right[i], x + T, y, x + T, y + T);
                if (lines.midH[i]) drawLine(1, x, y + T / 2, x + T, y + T / 2);
                if (lines.midV[i]) drawLine(1, x + T / 2, y, x + T / 2, y + T);
            }
            if (h2 < 0.015 && roadCount[i] === 1) { circle(c, x + 24, y + 24, 9, '#2a303b'); circle(c, x + 24, y + 24, 7, '#4b5563'); c.strokeStyle = '#2a303b'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 17, y + 24); c.lineTo(x + 31, y + 24); c.moveTo(x + 24, y + 17); c.lineTo(x + 24, y + 31); c.stroke(); }
            break;
        }
        case G.SIDE: {
            rect(c, x, y, T, T, (col + row) % 2 ? '#cfd6df' : '#c7ced8');
            c.strokeStyle = 'rgba(0,0,0,0.13)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, T / 2, T / 2); c.strokeRect(x + T / 2 + 0.5, y + T / 2 + 0.5, T / 2 - 1, T / 2 - 1);
            c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + 2, y + 2, 20, 2);
            const curb = (side) => {
                if (side === 'u') { rect(c, x, y, T, 6, '#e2e8f0'); rect(c, x, y + 6, T, 2, '#8a94a3'); }
                if (side === 'd') { rect(c, x, y + T - 8, T, 6, '#e2e8f0'); rect(c, x, y + T - 2, T, 2, '#8a94a3'); rect(c, x, y + T - 8, T, 2, '#8a94a3'); }
                if (side === 'l') { rect(c, x, y, 6, T, '#e2e8f0'); rect(c, x + 6, y, 2, T, '#8a94a3'); }
                if (side === 'r') { rect(c, x + T - 8, y, 6, T, '#e2e8f0'); rect(c, x + T - 8, y, 2, T, '#8a94a3'); rect(c, x + T - 2, y, 2, T, '#8a94a3'); }
            };
            Object.entries(N4).forEach(([s, g]) => { if (g === G.ROAD) curb(s); });
            // borde hacia la hierba
            c.fillStyle = 'rgba(0,0,0,0.10)';
            if (N4.u === G.GRASS || N4.u === G.LAWN) c.fillRect(x, y, T, 3); if (N4.d === G.GRASS || N4.d === G.LAWN) c.fillRect(x, y + T - 3, T, 3);
            if (N4.l === G.GRASS || N4.l === G.LAWN) c.fillRect(x, y, 3, T); if (N4.r === G.GRASS || N4.r === G.LAWN) c.fillRect(x + T - 3, y, 3, T);
            break;
        }
        case G.PLAZA: {
            const base = (col + row) % 2 ? '#d9cba6' : '#cfc09a'; rect(c, x, y, T, T, base);
            c.strokeStyle = 'rgba(90,70,30,0.28)'; c.lineWidth = 1.2;
            for (let k = 0; k < 3; k++) { const yy = y + k * 16; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + T, yy); c.stroke(); const off = (k + col) % 2 ? 8 : 20; for (let xx = x + off; xx < x + T; xx += 24) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + 16); c.stroke(); } }
            c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(x + 2, y + 2, 14, 2);
            if (h < 0.1) { c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(x + h * 200, y + 14, 8, 6); }
            break;
        }
        case G.SAND: {
            rect(c, x, y, T, T, h < 0.5 ? '#ecd9a3' : '#e8d49a');
            c.fillStyle = 'rgba(160,120,50,0.25)'; for (let k = 0; k < 8; k++) c.fillRect(x + hash2(col, row, 90 + k) * 46, y + hash2(col, row, 100 + k) * 46, 2, 1.6);
            c.fillStyle = 'rgba(255,255,255,0.3)'; for (let k = 0; k < 4; k++) c.fillRect(x + hash2(col, row, 110 + k) * 46, y + hash2(col, row, 120 + k) * 46, 2, 2);
            if (h2 < 0.04) { c.fillStyle = '#f9a8d4'; c.beginPath(); c.ellipse(x + 20, y + 30, 5, 3, 0.4, 0, 7); c.fill(); }
            break;
        }
        case G.DIRT: {
            rect(c, x, y, T, T, '#a6794a'); c.fillStyle = 'rgba(60,35,10,0.22)';
            for (let k = 0; k < 7; k++) c.fillRect(x + hash2(col, row, 130 + k) * 44, y + hash2(col, row, 140 + k) * 44, 3, 2);
            c.fillStyle = 'rgba(255,230,180,0.25)'; for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + hash2(col, row, 150 + k) * 44, y + hash2(col, row, 160 + k) * 44, 1.8, 0, 7); c.fill(); }
            c.strokeStyle = 'rgba(60,35,10,0.18)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y + 14); c.lineTo(x + T, y + 14); c.moveTo(x, y + 34); c.lineTo(x + T, y + 34); c.stroke();
            break;
        }
        case G.GRAVEL: {
            rect(c, x, y, T, T, '#d8cdb2'); c.fillStyle = 'rgba(100,80,50,0.28)';
            for (let k = 0; k < 14; k++) { c.beginPath(); c.arc(x + hash2(col, row, 170 + k) * 46 + 1, y + hash2(col, row, 180 + k) * 46 + 1, 1.2 + hash2(col, row, 190 + k) * 1.2, 0, 7); c.fill(); }
            c.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 5; k++) c.fillRect(x + hash2(col, row, 200 + k) * 44, y + hash2(col, row, 210 + k) * 44, 2, 2);
            const edge = (g) => g === G.GRASS || g === G.LAWN; c.fillStyle = 'rgba(70,90,40,0.35)';
            if (edge(N4.u)) c.fillRect(x, y, T, 4); if (edge(N4.d)) c.fillRect(x, y + T - 4, T, 4); if (edge(N4.l)) c.fillRect(x, y, 4, T); if (edge(N4.r)) c.fillRect(x + T - 4, y, 4, T);
            break;
        }
        case G.LOT: {
            rect(c, x, y, T, T, '#2f3540'); c.fillStyle = 'rgba(255,255,255,0.04)'; for (let k = 0; k < 6; k++) c.fillRect(x + hash2(col, row, 220 + k) * 46, y + hash2(col, row, 230 + k) * 46, 2, 2);
            if (col % 2 === 0 && row >= 36 && row <= 41) { c.fillStyle = 'rgba(245,245,245,0.85)'; c.fillRect(x, y, 3, T); }
            if (col === 22) { c.fillStyle = 'rgba(245,245,245,0.85)'; c.fillRect(x + T - 3, y, 3, T); }
            if (row === 36 || row === 39) { c.fillStyle = 'rgba(245,245,245,0.3)'; c.fillRect(x, y, T, 2); }
            break;
        }
        case G.ALLEY: {
            rect(c, x, y, T, T, (col + row) % 2 ? '#a7a9ad' : '#9fa2a7'); c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
            if (h < 0.2) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.moveTo(x + 8, y + 10); c.lineTo(x + 20, y + 20); c.lineTo(x + 18, y + 34); c.stroke(); }
            if (h2 < 0.08) { ellipse(c, x + 24, y + 30, 12, 5, 'rgba(100,150,200,0.35)'); }
            break;
        }
        case G.CROPS: {
            rect(c, x, y, T, T, '#6b4423'); const k = cropKind[idx(col, row)];
            c.fillStyle = '#4e3018'; for (let yy = 4; yy < T; yy += 12) c.fillRect(x, y + yy, T, 4);
            for (let rowi = 0; rowi < 4; rowi++) for (let xi = 0; xi < 3; xi++) {
                const px = x + 8 + xi * 16, py = y + 6 + rowi * 12;
                if (k === 0) { circle(c, px, py, 5, '#4ade80'); circle(c, px - 1, py - 1, 3, '#bbf7d0'); }
                else if (k === 1) { circle(c, px, py, 6, '#15803d'); circle(c, px, py, 3.4, '#86efac'); }
                else if (k === 2) { c.strokeStyle = '#65a30d'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py + 5); c.lineTo(px, py - 8); c.moveTo(px, py - 1); c.lineTo(px - 5, py - 6); c.moveTo(px, py - 3); c.lineTo(px + 5, py - 8); c.stroke(); circle(c, px, py - 8, 2, '#facc15'); }
                else { circle(c, px - 2, py + 1, 5.2, '#ea580c'); circle(c, px - 3, py - 0.5, 2, '#fdba74'); rect(c, px - 2, py - 6, 2, 3, '#15803d'); }
            }
            break;
        }
        case G.DOCK: {
            rect(c, x, y, T, T, '#8b5a2b'); c.strokeStyle = '#5b3410'; c.lineWidth = 1.6;
            for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(x, y + k * 12); c.lineTo(x + T, y + k * 12); c.stroke(); }
            c.fillStyle = 'rgba(255,255,255,0.15)'; for (let k = 0; k < 4; k++) c.fillRect(x, y + k * 12 + 1, T, 2);
            c.fillStyle = '#3f2410'; for (let k = 0; k < 4; k++) { c.fillRect(x + 4, y + k * 12 + 5, 2, 2); c.fillRect(x + T - 6, y + k * 12 + 5, 2, 2); }
            break;
        }
        case G.WATER: {
            rect(c, x, y, T, T, h < 0.5 ? '#1d7fc4' : '#1b78bb');
            const edge = (g) => g !== G.WATER && g !== G.DOCK;
            c.fillStyle = 'rgba(255,255,255,0.55)';
            if (edge(N4.u)) c.fillRect(x, y, T, 3); if (edge(N4.d)) c.fillRect(x, y + T - 3, T, 3); if (edge(N4.l)) c.fillRect(x, y, 3, T); if (edge(N4.r)) c.fillRect(x + T - 3, y, 3, T);
            c.fillStyle = 'rgba(0,30,80,0.22)'; if (edge(N4.u)) c.fillRect(x, y + 3, T, 5); if (edge(N4.l)) c.fillRect(x + 3, y, 5, T);
            break;
        }
    }
}

function renderChunk(cx, cy) {
    const key = cx + ',' + cy; if (chunkCache.has(key)) return chunkCache.get(key);
    const S = CHUNK * TILE_SIZE, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const c = cv.getContext('2d');
    for (let r = 0; r < CHUNK; r++) for (let q = 0; q < CHUNK; q++) {
        const col = cx * CHUNK + q, row = cy * CHUNK + r; if (!inMap(col, row)) continue;
        // fondo de hierba bajo transiciones
        paintTile(c, ground[idx(col, row)], col, row, q * TILE_SIZE, r * TILE_SIZE);
    }
    c.save(); c.translate(-cx * S, -cy * S);
    groundDecals.forEach(d => { if (d.x1 > cx * S && d.x0 < (cx + 1) * S && d.y1 > cy * S && d.y0 < (cy + 1) * S) d.draw(c); });
    c.restore();
    chunkCache.set(key, cv); return cv;
}

export function drawGround(ctx, vx0, vy0, vx1, vy1) {
    const S = CHUNK * TILE_SIZE;
    for (let cy = Math.max(0, Math.floor(vy0 / S)); cy <= Math.min(Math.floor((MAP_ROWS * TILE_SIZE - 1) / S), Math.floor(vy1 / S)); cy++)
        for (let cx = Math.max(0, Math.floor(vx0 / S)); cx <= Math.min(Math.floor((MAP_COLS * TILE_SIZE - 1) / S), Math.floor(vx1 / S)); cx++)
            ctx.drawImage(renderChunk(cx, cy), cx * S, cy * S);
}

// Agua animada (se dibuja sobre el chunk cada frame, solo lo visible)
export function drawWaterFx(ctx, t, vx0, vy0, vx1, vy1) {
    ctx.save(); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (const [c, r] of waterTiles) {
        const x = c * TILE_SIZE, y = r * TILE_SIZE; if (x > vx1 || x + TILE_SIZE < vx0 || y > vy1 || y + TILE_SIZE < vy0) continue;
        for (let k = 0; k < 2; k++) {
            const ph = t * 0.0014 + hash2(c, r, k) * 6.28, ox = (Math.sin(ph) * 6), a = 0.25 + 0.2 * Math.sin(ph * 1.7);
            ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(2)})`;
            const px = x + 8 + hash2(c, r, 40 + k) * 24 + ox, py = y + 12 + k * 20 + hash2(c, r, 50 + k) * 8;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + 6, py - 3, px + 12, py); ctx.stroke();
        }
        const g = Math.sin(t * 0.003 + c * 1.3 + r * 0.7); if (g > 0.93) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + 10 + hash2(c, r, 60) * 24, y + 10 + hash2(c, r, 61) * 24, 2.5, 2.5); }
    }
    ctx.restore();
}
