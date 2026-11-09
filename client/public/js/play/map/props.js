// Sprites de props: árboles, mobiliario urbano, parque, coches…
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { mulberry, shade, rr, rect, circle, ellipse, makeSprite } from "./draw-utils.js";
import { TILE_SIZE } from "./constants.js";

// =====================================================================
//  SPRITES DE PROPS (árboles, mobiliario urbano, parque…)
//  Cada sprite: {cv, ax, ay}  → (ax,ay) = punto base (suelo) dentro del sprite
// =====================================================================
export const SPRITES = {};
function def(name, w, h, ax, ay, fn) {
    const s = makeSprite(w, h, fn); s.ax = ax; s.ay = ay; SPRITES[name] = s; return s;
}
export function groundShadow(c, x, y, rx, ry, a = 0.28) { ellipse(c, x, y, rx, ry, `rgba(0,20,10,${a})`); }

function leafDots(c, rnd, cx, cy, R, col, n, sz) {
    c.fillStyle = col;
    for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R;
        c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, sz * (0.6 + rnd() * 0.7), 0, 7); c.fill();
    }
}

function buildTrees() {
    const oakPal = [
        ['#14532d', '#15803d', '#4ade80', '#bbf7d0'],
        ['#1a4d2e', '#2f8f46', '#7bd66f', '#d9f99d'],
        ['#365314', '#65a30d', '#bef264', '#ecfccb'],
        ['#7c2d12', '#c2410c', '#fb923c', '#fed7aa']   // otoño
    ];
    oakPal.forEach((p, i) => def('oak' + i, 130, 150, 65, 138, (c) => {
        const rnd = mulberry(100 + i);
        groundShadow(c, 65, 138, 38, 11);
        // tronco
        c.fillStyle = '#5b3410'; c.beginPath(); c.moveTo(54, 138); c.lineTo(57, 96); c.lineTo(73, 96); c.lineTo(78, 138); c.closePath(); c.fill();
        c.fillStyle = '#7a4a1c'; c.fillRect(57, 100, 6, 36);
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(70, 100, 4, 36);
        c.strokeStyle = '#5b3410'; c.lineWidth = 5; c.lineCap = 'round';
        c.beginPath(); c.moveTo(56, 136); c.quadraticCurveTo(48, 138, 44, 136); c.moveTo(76, 136); c.quadraticCurveTo(84, 138, 88, 136); c.stroke();
        // copa por capas
        [[65, 70, 50, p[0]], [38, 82, 28, p[0]], [92, 82, 28, p[0]],
         [65, 62, 44, p[1]], [42, 74, 24, p[1]], [88, 74, 24, p[1]],
         [58, 52, 32, p[2]], [82, 58, 22, p[2]]].forEach(([x, y, r, col]) => circle(c, x, y, r, col));
        leafDots(c, rnd, 65, 60, 46, p[0], 26, 4);
        leafDots(c, rnd, 60, 48, 28, p[3], 18, 2.6);
        c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 2;
        c.beginPath(); c.arc(65, 70, 49, 0.2, Math.PI - 0.2); c.stroke();
    }));

    // Cerezo
    def('cherry', 130, 150, 65, 138, (c) => {
        const rnd = mulberry(7);
        groundShadow(c, 65, 138, 36, 10);
        c.fillStyle = '#4a2c1a'; c.beginPath(); c.moveTo(56, 138); c.lineTo(60, 92); c.lineTo(72, 92); c.lineTo(76, 138); c.fill();
        c.strokeStyle = '#4a2c1a'; c.lineWidth = 4; c.beginPath(); c.moveTo(64, 100); c.lineTo(42, 78); c.moveTo(68, 100); c.lineTo(92, 74); c.stroke();
        [[65, 66, 48, '#be185d'], [40, 78, 26, '#be185d'], [92, 78, 26, '#be185d'],
         [65, 58, 42, '#ec4899'], [42, 70, 22, '#ec4899'], [90, 70, 22, '#ec4899'],
         [58, 48, 28, '#f9a8d4'], [82, 52, 20, '#f9a8d4']].forEach(([x, y, r, col]) => circle(c, x, y, r, col));
        leafDots(c, rnd, 65, 58, 46, '#fbcfe8', 40, 3); leafDots(c, rnd, 65, 58, 40, '#9d174d', 14, 2.4);
    });

    // Abedul
    def('birch', 100, 150, 50, 138, (c) => {
        const rnd = mulberry(3);
        groundShadow(c, 50, 138, 26, 8);
        rect(c, 44, 70, 12, 68, '#f1f5f9'); rect(c, 52, 70, 4, 68, '#cbd5e1');
        c.fillStyle = '#334155'; [[45, 84, 6], [50, 102, 5], [46, 120, 7], [51, 94, 4]].forEach(([x, y, w]) => c.fillRect(x, y, w, 2.5));
        [[50, 54, 36, '#4d7c0f'], [30, 66, 20, '#4d7c0f'], [72, 66, 20, '#4d7c0f'], [50, 50, 30, '#84cc16'], [66, 44, 18, '#a3e635']].forEach(([x, y, r, col]) => circle(c, x, y, r, col));
        leafDots(c, rnd, 50, 52, 32, '#365314', 16, 3); leafDots(c, rnd, 48, 42, 20, '#d9f99d', 12, 2.4);
    });

    // Pino
    def('pine', 100, 160, 50, 150, (c) => {
        groundShadow(c, 50, 150, 26, 8);
        rect(c, 44, 120, 12, 30, '#5b3410'); rect(c, 44, 120, 4, 30, '#7a4a1c');
        [[116, 40, '#14532d'], [92, 34, '#166534'], [68, 28, '#15803d'], [46, 20, '#16a34a']].forEach(([y, hw, col], i) => {
            c.fillStyle = col; c.beginPath(); c.moveTo(50, y - 36); c.lineTo(50 + hw, y + 6); c.lineTo(50 - hw, y + 6); c.closePath(); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.10)'; c.beginPath(); c.moveTo(50, y - 36); c.lineTo(50 - hw, y + 6); c.lineTo(50 - hw * 0.4, y + 6); c.closePath(); c.fill();
            c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.moveTo(50, y - 36); c.lineTo(50 + hw, y + 6); c.lineTo(50 + hw * 0.4, y + 6); c.closePath(); c.fill();
        });
    });

    // Arbustos y setos
    [['#166534', '#22c55e'], ['#115e59', '#2dd4bf']].forEach((p, i) => {
        def('bush' + i, 60, 46, 30, 42, (c) => {
            const rnd = mulberry(20 + i);
            groundShadow(c, 30, 42, 24, 6);
            circle(c, 30, 26, 20, p[0]); circle(c, 16, 30, 13, p[0]); circle(c, 44, 30, 13, p[0]);
            circle(c, 28, 22, 15, p[1]); circle(c, 40, 28, 9, p[1]);
            leafDots(c, rnd, 30, 24, 18, shade(p[1], 0.35), 8, 2);
            if (i === 0) { ['#f43f5e', '#fde047', '#fff'].forEach((f, k) => circle(c, 18 + k * 12, 24 + (k % 2) * 6, 2.6, f)); }
        });
    });
    def('hedge', 48, 44, 24, 42, (c) => {
        rr(c, 0, 12, 48, 28, 8, '#14532d'); rr(c, 0, 6, 48, 26, 9, '#16a34a');
        const rnd = mulberry(5); leafDots(c, rnd, 24, 20, 22, '#4ade80', 14, 2.4); leafDots(c, rnd, 24, 26, 22, '#14532d', 8, 2.4);
    });
    // Macizos de flores
    [['#f43f5e', '#fde047', '#ffffff'], ['#a855f7', '#f9a8d4', '#fde047'], ['#fb923c', '#fde047', '#ef4444'], ['#38bdf8', '#ffffff', '#a78bfa']].forEach((p, i) => {
        def('flowers' + i, 48, 40, 24, 38, (c) => {
            const rnd = mulberry(40 + i);
            rr(c, 2, 14, 44, 24, 8, '#5b3410'); rr(c, 2, 12, 44, 22, 8, '#7a4a1c');
            for (let k = 0; k < 15; k++) {
                const x = 6 + rnd() * 36, y = 14 + rnd() * 16;
                c.strokeStyle = '#15803d'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x, y + 6); c.lineTo(x, y); c.stroke();
                circle(c, x, y - 1, 3.4, p[k % 3]); circle(c, x, y - 1, 1.2, '#fef08a');
            }
        });
    });
}

function buildFurniture() {
    // Farola
    def('lamp', 44, 118, 22, 112, (c) => {
        groundShadow(c, 22, 112, 12, 4, 0.3);
        rr(c, 14, 100, 16, 12, 3, '#1e293b'); rr(c, 18, 24, 8, 78, 3, '#334155'); rect(c, 18, 24, 3, 78, '#64748b');
        rr(c, 12, 14, 20, 14, 4, '#0f172a'); rect(c, 14, 17, 16, 9, '#fde68a'); rect(c, 14, 17, 16, 3, '#fff7d6');
        c.fillStyle = '#0f172a'; c.beginPath(); c.moveTo(10, 15); c.lineTo(22, 4); c.lineTo(34, 15); c.closePath(); c.fill();
    });
    // Banco
    def('bench', 90, 50, 45, 44, (c) => {
        groundShadow(c, 45, 44, 38, 6);
        rect(c, 8, 26, 5, 16, '#1e293b'); rect(c, 77, 26, 5, 16, '#1e293b');
        rr(c, 4, 10, 82, 8, 3, '#92400e'); rr(c, 4, 20, 82, 9, 3, '#b45309'); rr(c, 4, 30, 82, 5, 2, '#78350f');
        rect(c, 4, 12, 82, 2, '#d97706'); rect(c, 4, 22, 82, 2, '#d97706');
        rect(c, 6, 10, 4, 26, '#1e293b'); rect(c, 80, 10, 4, 26, '#1e293b');
    });
    def('trash', 30, 44, 15, 40, (c) => {
        groundShadow(c, 15, 40, 12, 4); rr(c, 4, 12, 22, 28, 4, '#475569'); rect(c, 4, 12, 22, 4, '#64748b');
        rr(c, 2, 8, 26, 7, 3, '#94a3b8'); c.strokeStyle = '#334155'; c.lineWidth = 1.5; for (let x = 9; x < 26; x += 5) { c.beginPath(); c.moveTo(x, 18); c.lineTo(x, 38); c.stroke(); }
    });
    def('hydrant', 28, 40, 14, 37, (c) => {
        groundShadow(c, 14, 37, 10, 3); rr(c, 7, 12, 14, 24, 4, '#dc2626'); rr(c, 5, 8, 18, 8, 4, '#ef4444'); rr(c, 3, 20, 22, 6, 3, '#b91c1c');
        circle(c, 14, 8, 3, '#7f1d1d'); rect(c, 12, 28, 4, 3, '#fca5a5');
    });
    def('mailbox', 30, 52, 15, 48, (c) => {
        groundShadow(c, 15, 48, 10, 3); rect(c, 13, 24, 4, 24, '#78350f'); rr(c, 4, 8, 22, 18, 9, '#2563eb'); rect(c, 4, 18, 22, 6, '#2563eb');
        rect(c, 20, 4, 3, 10, '#ef4444'); rect(c, 20, 4, 8, 3, '#ef4444'); rr(c, 8, 14, 8, 3, 1, '#1e3a8a');
    });
    def('planter', 56, 52, 28, 48, (c) => {
        groundShadow(c, 28, 48, 24, 5); rr(c, 6, 26, 44, 20, 4, '#9a3412'); rect(c, 6, 26, 44, 5, '#c2410c');
        const rnd = mulberry(11); circle(c, 28, 20, 16, '#15803d'); leafDots(c, rnd, 28, 18, 16, '#4ade80', 8, 2.5);
        ['#f43f5e', '#fde047', '#f9a8d4', '#fff'].forEach((f, k) => circle(c, 14 + k * 10, 14 + (k % 2) * 8, 3.4, f));
    });
    def('postsign', 40, 80, 20, 76, (c) => {
        groundShadow(c, 20, 76, 10, 3); rect(c, 18, 22, 4, 54, '#64748b');
        rr(c, 4, 8, 32, 18, 3, '#15803d', '#f8fafc', 1.5); c.fillStyle = '#f8fafc'; c.font = 'bold 8px Arial'; c.textAlign = 'center'; c.fillText('CENTRO', 20, 20);
    });
    def('busstop', 120, 100, 60, 94, (c) => {
        groundShadow(c, 60, 94, 52, 6);
        rect(c, 12, 30, 4, 64, '#334155'); rect(c, 104, 30, 4, 64, '#334155');
        rr(c, 6, 18, 108, 14, 4, '#0ea5e9'); rect(c, 6, 28, 108, 4, '#0369a1');
        rect(c, 16, 34, 88, 44, 'rgba(186,230,253,0.35)'); rect(c, 16, 34, 88, 44, 'rgba(255,255,255,0.0)');
        c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.5; c.strokeRect(16, 34, 88, 44);
        rr(c, 24, 74, 72, 6, 2, '#475569'); rect(c, 28, 80, 4, 12, '#334155'); rect(c, 88, 80, 4, 12, '#334155');
        circle(c, 60, 8, 10, '#0ea5e9'); c.fillStyle = '#fff'; c.font = 'bold 12px Arial'; c.textAlign = 'center'; c.fillText('B', 60, 13);
    });
    // Cabina telefónica estilo 80s
    def('phonebooth', 44, 100, 22, 94, (c) => {
        groundShadow(c, 22, 94, 18, 5); rr(c, 4, 10, 36, 84, 3, '#dc2626'); rr(c, 8, 18, 28, 62, 2, '#7dd3fc');
        c.strokeStyle = '#991b1b'; c.lineWidth = 2; c.beginPath(); c.moveTo(22, 18); c.lineTo(22, 80); c.moveTo(8, 38); c.lineTo(36, 38); c.moveTo(8, 58); c.lineTo(36, 58); c.stroke();
        rr(c, 6, 4, 32, 10, 3, '#b91c1c'); c.fillStyle = '#fff'; c.font = 'bold 7px Arial'; c.textAlign = 'center'; c.fillText('TEL', 22, 12);
    });
    // Fuente (3x3 tiles)
    def('fountain', 170, 170, 85, 150, (c) => {
        groundShadow(c, 85, 148, 70, 18, 0.25);
        rr(c, 10, 70, 150, 78, 38, '#94a3b8'); rr(c, 10, 62, 150, 78, 38, '#cbd5e1');
        rr(c, 20, 72, 130, 58, 30, '#e2e8f0'); rr(c, 24, 78, 122, 48, 26, '#38bdf8'); rr(c, 24, 78, 122, 20, 24, '#7dd3fc');
        rect(c, 79, 36, 12, 66, '#cbd5e1'); rect(c, 79, 36, 4, 66, '#f1f5f9');
        rr(c, 56, 52, 58, 16, 8, '#cbd5e1'); rr(c, 60, 54, 50, 9, 5, '#7dd3fc');
        rr(c, 70, 24, 30, 12, 6, '#cbd5e1'); circle(c, 85, 20, 7, '#94a3b8'); circle(c, 85, 20, 4, '#e2e8f0');
    });
    // Puesto de mercado (2x2)
    [['#dc2626', '#fef2f2', 'fruit'], ['#2563eb', '#eff6ff', 'fish'], ['#16a34a', '#f0fdf4', 'veg'], ['#d97706', '#fffbeb', 'bread']].forEach((p, i) => {
        def('stall' + i, 110, 120, 55, 110, (c) => {
            groundShadow(c, 55, 108, 48, 8);
            rect(c, 10, 40, 5, 66, '#78350f'); rect(c, 95, 40, 5, 66, '#78350f');
            rr(c, 8, 70, 94, 36, 3, '#b45309'); rect(c, 8, 70, 94, 6, '#d97706');
            const goods = i === 0 ? ['#ef4444', '#f97316', '#facc15'] : i === 1 ? ['#94a3b8', '#cbd5e1', '#64748b'] : i === 2 ? ['#22c55e', '#f97316', '#a855f7'] : ['#d4a054', '#b6803a', '#e8c07a'];
            for (let k = 0; k < 9; k++) circle(c, 16 + k * 10, 66 + (k % 2) * 3, 5, goods[k % 3]);
            // toldo a rayas
            for (let k = 0; k < 10; k++) { c.fillStyle = k % 2 ? p[1] : p[0]; c.beginPath(); c.moveTo(4 + k * 10.2, 20); c.lineTo(14 + k * 10.2, 20); c.lineTo(14 + k * 10.2, 48); c.arc(9 + k * 10.2, 48, 5, 0, Math.PI); c.lineTo(4 + k * 10.2, 20); c.fill(); }
            rect(c, 4, 14, 102, 8, shade(p[0], -0.2)); rect(c, 4, 14, 102, 3, shade(p[0], 0.25));
        });
    });
    // Mesa de pícnic
    def('picnic', 100, 66, 50, 60, (c) => {
        groundShadow(c, 50, 58, 42, 6); rr(c, 8, 18, 84, 22, 3, '#b45309'); rect(c, 8, 18, 84, 4, '#f59e0b');
        rr(c, 4, 42, 92, 7, 2, '#92400e'); rr(c, 4, 6, 92, 7, 2, '#92400e');
        c.strokeStyle = '#78350f'; c.lineWidth = 3; c.beginPath(); c.moveTo(18, 40); c.lineTo(10, 58); c.moveTo(82, 40); c.lineTo(90, 58); c.stroke();
        rr(c, 40, 20, 18, 6, 2, '#fff'); rr(c, 44, 28, 10, 8, 3, '#ef4444');
    });
    // Cenador del parque (3x3)
    def('gazebo', 170, 190, 85, 168, (c) => {
        groundShadow(c, 85, 164, 66, 16, 0.22);
        rr(c, 16, 120, 138, 44, 8, '#a8a29e'); rr(c, 16, 112, 138, 44, 8, '#d6d3d1');
        [[26, 100], [60, 108], [110, 108], [144, 100]].forEach(([x, y]) => { rect(c, x - 4, 60, 8, y - 44, '#f8fafc'); rect(c, x - 4, 60, 3, y - 44, '#cbd5e1'); });
        rect(c, 22, 92, 126, 6, '#f8fafc');
        for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#fef2f2' : '#dc2626'; c.beginPath(); c.moveTo(85, 6); c.lineTo(8 + k * 22, 66); c.lineTo(30 + k * 22, 66); c.closePath(); c.fill(); }
        c.strokeStyle = '#7f1d1d'; c.lineWidth = 3; c.beginPath(); c.moveTo(8, 66); c.quadraticCurveTo(85, 80, 184, 66); c.stroke();
        circle(c, 85, 8, 5, '#facc15'); rect(c, 84, 0, 2, 8, '#facc15');
    });
    // Pozo
    def('well', 70, 90, 35, 80, (c) => {
        groundShadow(c, 35, 78, 28, 7); rr(c, 8, 38, 54, 40, 8, '#78716c'); rr(c, 8, 34, 54, 38, 8, '#a8a29e');
        c.strokeStyle = '#57534e'; c.lineWidth = 1.5; for (let y = 44; y < 70; y += 8) { c.beginPath(); c.moveTo(10, y); c.lineTo(60, y); c.stroke(); }
        rect(c, 12, 12, 5, 30, '#78350f'); rect(c, 53, 12, 5, 30, '#78350f');
        c.fillStyle = '#b91c1c'; c.beginPath(); c.moveTo(35, 0); c.lineTo(66, 16); c.lineTo(4, 16); c.closePath(); c.fill();
        c.strokeStyle = '#d6b370'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(35, 16); c.lineTo(35, 36); c.stroke(); rr(c, 31, 34, 8, 7, 2, '#78350f');
    });
    // Estatua en pedestal (plaza)
    def('statue', 50, 110, 25, 104, (c) => {
        groundShadow(c, 25, 102, 20, 6); rr(c, 6, 72, 38, 30, 3, '#a8a29e'); rr(c, 10, 66, 30, 12, 2, '#d6d3d1');
        c.fillStyle = '#64748b'; c.beginPath(); c.arc(25, 26, 11, 0, 7); c.fill(); rr(c, 15, 36, 20, 32, 7, '#64748b');
        rect(c, 9, 40, 8, 24, '#64748b'); rect(c, 33, 40, 8, 24, '#64748b'); rect(c, 15, 38, 5, 26, '#94a3b8'); rect(c, 14, 14, 10, 3, '#94a3b8');
    });
    // Coches estacionados (vista 3/4, mirando al este)
    [['#dc2626', '#fecaca'], ['#2563eb', '#bfdbfe'], ['#eab308', '#fef9c3'], ['#f8fafc', '#e2e8f0'], ['#16a34a', '#bbf7d0'], ['#7c3aed', '#ddd6fe']].forEach((p, i) => {
        def('car' + i, 92, 56, 46, 50, (c) => {
            groundShadow(c, 46, 48, 40, 7, 0.3);
            rr(c, 4, 22, 84, 24, 8, shade(p[0], -0.3)); rr(c, 4, 18, 84, 24, 8, p[0]);
            rr(c, 22, 6, 46, 20, 8, shade(p[0], 0.1)); rr(c, 26, 9, 16, 13, 3, '#1e3a5f'); rr(c, 46, 9, 18, 13, 3, '#1e3a5f');
            rect(c, 28, 11, 6, 3, 'rgba(255,255,255,0.5)');
            rect(c, 4, 30, 84, 3, shade(p[0], -0.25)); rect(c, 8, 20, 76, 2, p[1]);
            rr(c, 80, 24, 8, 6, 2, '#fef08a'); rr(c, 4, 24, 6, 6, 2, '#ef4444');
            [22, 66].forEach(x => { circle(c, x, 44, 8, '#0f172a'); circle(c, x, 44, 4, '#94a3b8'); });
        });
    });
    def('dumpster', 70, 56, 35, 52, (c) => {
        groundShadow(c, 35, 50, 30, 5); rr(c, 4, 16, 62, 34, 3, '#166534'); rr(c, 2, 10, 66, 10, 3, '#15803d'); rect(c, 4, 26, 62, 3, '#14532d'); rect(c, 4, 38, 62, 3, '#14532d');
        circle(c, 12, 50, 4, '#111'); circle(c, 58, 50, 4, '#111');
    });
    def('crates', 60, 60, 30, 54, (c) => {
        groundShadow(c, 30, 52, 26, 5);
        [[4, 26, 28], [30, 26, 26], [14, 4, 28]].forEach(([x, y, s], k) => { rr(c, x, y, s, s, 2, '#b45309'); c.strokeStyle = '#78350f'; c.lineWidth = 2; c.strokeRect(x + 2, y + 2, s - 4, s - 4); c.beginPath(); c.moveTo(x + 2, y + 2); c.lineTo(x + s - 2, y + s - 2); c.stroke(); });
    });
    def('haystack', 80, 70, 40, 64, (c) => {
        groundShadow(c, 40, 62, 34, 7); c.fillStyle = '#ca8a04'; c.beginPath(); c.moveTo(6, 62); c.quadraticCurveTo(8, 8, 40, 6); c.quadraticCurveTo(72, 8, 74, 62); c.closePath(); c.fill();
        c.strokeStyle = '#a16207'; c.lineWidth = 1.5; for (let k = 0; k < 9; k++) { c.beginPath(); c.moveTo(14 + k * 6, 58); c.lineTo(22 + k * 4, 14); c.stroke(); }
        rect(c, 8, 38, 64, 4, '#92400e');
    });
    def('scarecrow', 60, 100, 30, 94, (c) => {
        groundShadow(c, 30, 92, 14, 4); rect(c, 28, 30, 4, 62, '#78350f'); rect(c, 6, 38, 48, 4, '#78350f');
        rr(c, 18, 32, 24, 28, 4, '#2563eb'); rect(c, 18, 44, 24, 4, '#1d4ed8'); circle(c, 30, 24, 10, '#fde68a');
        c.fillStyle = '#92400e'; c.fillRect(16, 12, 28, 5); c.beginPath(); c.moveTo(22, 12); c.lineTo(30, 0); c.lineTo(38, 12); c.fill();
        rect(c, 26, 22, 2, 2, '#111'); rect(c, 33, 22, 2, 2, '#111'); rect(c, 27, 28, 6, 1.5, '#111');
        c.fillStyle = '#ca8a04'; [[8, 44], [50, 44], [12, 60], [46, 60]].forEach(([x, y]) => c.fillRect(x - 3, y, 6, 10));
    });
    // Columpios (3x2)
    def('swings', 150, 110, 75, 100, (c) => {
        groundShadow(c, 75, 98, 60, 8);
        c.strokeStyle = '#dc2626'; c.lineWidth = 6; c.lineCap = 'round';
        [[14, 98, 40, 12], [136, 98, 110, 12]].forEach(([x1, y1, x2, y2]) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.beginPath(); c.moveTo(x1 + (x1 < 75 ? 18 : -18), y1 - 5 + 6); c.lineTo(x2 + (x1 < 75 ? -8 : 8), y2 + 6); c.stroke(); });
        c.strokeStyle = '#dc2626'; c.beginPath(); c.moveTo(40, 12); c.lineTo(110, 12); c.stroke();
        c.strokeStyle = '#64748b'; c.lineWidth = 1.6; [[58, 60], [92, 60]].forEach(([x]) => { c.beginPath(); c.moveTo(x - 6, 14); c.lineTo(x - 6, 66); c.moveTo(x + 6, 14); c.lineTo(x + 6, 66); c.stroke(); rr(c, x - 10, 64, 20, 5, 2, '#f59e0b'); });
    });
    def('slide', 100, 110, 50, 100, (c) => {
        groundShadow(c, 50, 98, 40, 7);
        rect(c, 12, 28, 5, 70, '#2563eb'); rect(c, 40, 28, 5, 70, '#2563eb'); rr(c, 8, 22, 40, 10, 3, '#f59e0b');
        c.fillStyle = '#facc15'; c.beginPath(); c.moveTo(42, 32); c.lineTo(58, 32); c.lineTo(92, 96); c.lineTo(76, 98); c.closePath(); c.fill();
        c.fillStyle = '#fde68a'; c.beginPath(); c.moveTo(46, 33); c.lineTo(52, 33); c.lineTo(84, 96); c.lineTo(80, 97); c.closePath(); c.fill();
        c.strokeStyle = '#2563eb'; c.lineWidth = 3; c.beginPath(); c.moveTo(14, 30); c.lineTo(14, 8); c.lineTo(44, 8); c.lineTo(44, 30); c.stroke();
    });
    def('sandbox', 100, 70, 50, 64, (c) => {
        rr(c, 4, 18, 92, 44, 8, '#92400e'); rr(c, 8, 22, 84, 36, 6, '#fde68a'); rr(c, 8, 22, 84, 14, 6, '#fef3c7');
        circle(c, 30, 44, 6, '#ef4444'); rect(c, 60, 36, 14, 10, '#2563eb'); rr(c, 62, 30, 10, 8, 2, '#60a5fa');
    });
    def('seesaw', 100, 60, 50, 54, (c) => {
        groundShadow(c, 50, 52, 38, 5);
        c.fillStyle = '#334155'; c.beginPath(); c.moveTo(42, 50); c.lineTo(50, 28); c.lineTo(58, 50); c.closePath(); c.fill();
        c.save(); c.translate(50, 30); c.rotate(-0.12); rr(c, -42, -5, 84, 9, 3, '#ec4899'); rect(c, -42, -4, 84, 2, '#f9a8d4'); circle(c, -36, 6, 4, '#334155'); circle(c, 36, 6, 4, '#334155'); c.restore();
    });
    // Barco de remos y muelle (vista superior)
    def('boat', 90, 44, 45, 30, (c) => {
        c.fillStyle = '#78350f'; c.beginPath(); c.moveTo(4, 14); c.quadraticCurveTo(45, 44, 86, 14); c.quadraticCurveTo(45, 24, 4, 14); c.fill();
        c.fillStyle = '#b45309'; c.beginPath(); c.moveTo(8, 14); c.quadraticCurveTo(45, 38, 82, 14); c.quadraticCurveTo(45, 20, 8, 14); c.fill();
        rect(c, 40, 16, 4, 10, '#78350f'); c.strokeStyle = '#d6b370'; c.lineWidth = 2; c.beginPath(); c.moveTo(20, 8); c.lineTo(66, 28); c.stroke();
    });
}

function buildExtras() {
    // Barrera de cuarentena (un tile)
    def('barrier', 56, 70, 28, 64, (c) => {
        groundShadow(c, 28, 62, 24, 5, 0.3);
        rr(c, 2, 40, 14, 24, 2, '#6b7280'); rr(c, 40, 40, 14, 24, 2, '#6b7280'); rect(c, 2, 40, 14, 4, '#9ca3af'); rect(c, 40, 40, 14, 4, '#9ca3af');
        c.save(); c.beginPath(); c.roundRect(0, 24, 56, 16, 3); c.clip(); c.fillStyle = '#f8fafc'; c.fillRect(0, 24, 56, 16);
        c.fillStyle = '#dc2626'; for (let k = -2; k < 8; k++) { c.beginPath(); c.moveTo(k * 14, 40); c.lineTo(k * 14 + 8, 40); c.lineTo(k * 14 + 22, 24); c.lineTo(k * 14 + 14, 24); c.fill(); } c.restore();
        c.strokeStyle = '#7f1d1d'; c.lineWidth = 1.5; c.strokeRect(0, 24, 56, 16);
        circle(c, 9, 36, 6, '#ef4444'); circle(c, 9, 34, 3, '#fecaca'); circle(c, 47, 36, 6, '#fbbf24'); circle(c, 47, 34, 3, '#fef9c3');
        rr(c, 14, 4, 28, 18, 3, '#fde047', '#111', 1.5); c.fillStyle = '#111'; c.font = 'bold 6px Arial'; c.textAlign = 'center'; c.fillText('CUARENTENA', 28, 16);
        c.beginPath(); c.moveTo(28, 6); c.lineTo(32, 12); c.lineTo(24, 12); c.closePath(); c.fill();
    });
}
export function buildAllPropSprites() { buildTrees(); buildFurniture(); buildExtras(); }
