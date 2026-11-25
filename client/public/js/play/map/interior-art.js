// Dibujo de los interiores: sprites de muebles y el piso/paredes de cada local (canvas).
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { mulberry, shade, rr, rect, circle, ellipse } from "./draw-utils.js";
import { SPRITES, def, groundShadow } from "./props.js";
import { TILE_SIZE } from "./constants.js";

const SHELF_PALETTES = [
    { label: 'CEREALES', head: '#f59e0b', items: ['#ef4444', '#facc15', '#38bdf8', '#fb923c', '#a3e635'], kind: 'box' },
    { label: 'CONSERVAS', head: '#b91c1c', items: ['#fca5a5', '#fde68a', '#bef264', '#fdba74', '#d4d4d8'], kind: 'can' },
    { label: 'BEBIDAS', head: '#0284c7', items: ['#22c55e', '#f97316', '#3b82f6', '#e11d48', '#a855f7'], kind: 'bottle' },
    { label: 'SNACKS', head: '#7c3aed', items: ['#fde047', '#f472b6', '#4ade80', '#f87171', '#60a5fa'], kind: 'bag' },
    { label: 'LIMPIEZA', head: '#0d9488', items: ['#67e8f9', '#d9f99d', '#fde68a', '#fbcfe8', '#c4b5fd'], kind: 'bottle' },
    { label: 'PASTAS', head: '#ca8a04', items: ['#fde68a', '#fcd34d', '#f59e0b', '#fef3c7', '#ef4444'], kind: 'box' }
];
function drawProduct(c, kind, x, y, col, w, h) {
    if (kind === 'can') { rr(c, x, y, w, h, 2, col); rect(c, x, y + 3, w, 3, 'rgba(0,0,0,0.25)'); rect(c, x + 1, y + 1, 2, h - 2, 'rgba(255,255,255,0.45)'); rect(c, x, y, w, 2, '#cbd5e1'); }
    else if (kind === 'bottle') { rr(c, x + 1, y + 4, w - 2, h - 4, 3, col); rect(c, x + w / 2 - 1.5, y, 3, 6, shade(col, -0.3)); rect(c, x + 2, y + 9, w - 4, 6, 'rgba(255,255,255,0.7)'); rect(c, x + 2, y + 6, 2, h - 8, 'rgba(255,255,255,0.35)'); }
    else if (kind === 'bag') { c.fillStyle = col; c.beginPath(); c.moveTo(x, y + 3); c.lineTo(x + w, y + 3); c.lineTo(x + w - 1, y + h); c.lineTo(x + 1, y + h); c.closePath(); c.fill(); rect(c, x, y, w, 3, shade(col, -0.25)); circle(c, x + w / 2, y + h / 2 + 2, w * 0.22, 'rgba(255,255,255,0.8)'); }
    else { rr(c, x, y, w, h, 1.5, col); rect(c, x, y + 4, w, 2, 'rgba(0,0,0,0.2)'); rect(c, x + w * 0.2, y + h * 0.4, w * 0.6, h * 0.3, 'rgba(255,255,255,0.75)'); rect(c, x + 1, y + 1, 2, h - 2, 'rgba(255,255,255,0.3)'); }
}

export function buildInteriorSprites() {
    SHELF_PALETTES.forEach((p, i) => def('shelf' + i, 96, 114, 48, 106, (c) => {
        groundShadow(c, 48, 104, 44, 6, 0.3);
        rr(c, 3, 22, 90, 82, 3, '#475569'); rect(c, 6, 26, 84, 74, '#64748b');
        [0, 1, 2].forEach(l => {
            const ly = 30 + l * 24; rect(c, 6, ly, 84, 22, '#475569');
            for (let k = 0; k < 7; k++) { const colr = p.items[(k + l + i) % p.items.length]; drawProduct(c, p.kind, 9 + k * 11.6, ly + 2, colr, 9, 17); }
            rect(c, 5, ly + 20, 86, 5, '#cbd5e1'); rect(c, 5, ly + 20, 86, 1.5, '#fff'); rect(c, 5, ly + 25, 86, 2, 'rgba(0,0,0,0.25)');
            rect(c, 14, ly + 22.5, 22, 2.5, '#fde047');
        });
        rect(c, 0, 22, 5, 82, '#334155'); rect(c, 91, 22, 5, 82, '#334155');
        rr(c, 0, 4, 96, 20, 3, p.head); rect(c, 0, 4, 96, 4, 'rgba(255,255,255,0.3)'); rect(c, 0, 20, 96, 4, 'rgba(0,0,0,0.25)');
        c.fillStyle = '#fff'; c.font = "900 12px 'Orbitron', Arial"; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(p.label, 48, 14); c.textBaseline = 'alphabetic';
    }));
    def('freezer', 96, 124, 48, 116, (c) => {
        groundShadow(c, 48, 114, 44, 6, 0.3);
        rr(c, 2, 10, 92, 106, 4, '#cbd5e1'); rr(c, 6, 14, 84, 98, 3, '#e2e8f0');
        [0, 1].forEach(d => { const dx = 8 + d * 41; rr(c, dx, 18, 39, 90, 2, '#0f172a'); rect(c, dx + 2, 20, 35, 86, '#dbeafe');
            for (let sh = 0; sh < 4; sh++) { rect(c, dx + 2, 20 + sh * 22 + 18, 35, 3, '#94a3b8'); for (let k = 0; k < 4; k++) { rr(c, dx + 4 + k * 8.4, 20 + sh * 22 + 2, 7, 16, 1.5, ['#60a5fa', '#f9a8d4', '#fde68a', '#86efac', '#fdba74'][(k + sh + d) % 5]); } }
            c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.moveTo(dx + 4, 104); c.lineTo(dx + 20, 20); c.lineTo(dx + 28, 20); c.lineTo(dx + 12, 104); c.fill();
            rect(c, dx + 33, 56, 3, 22, '#475569'); });
        rr(c, 2, 0, 92, 12, 3, '#0e7490'); rect(c, 2, 0, 92, 3, 'rgba(255,255,255,0.3)');
        c.fillStyle = '#fff'; c.font = "900 8px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('LÁCTEOS · CONGELADOS', 48, 9);
    });
    def('checkout', 96, 92, 48, 84, (c) => {
        groundShadow(c, 48, 82, 44, 6, 0.3);
        rr(c, 2, 30, 92, 52, 4, '#334155'); rr(c, 2, 24, 92, 46, 4, '#475569'); rect(c, 2, 24, 92, 3, '#94a3b8');
        rr(c, 6, 36, 58, 20, 3, '#111827'); c.strokeStyle = '#374151'; c.lineWidth = 2; for (let x = 12; x < 62; x += 8) { c.beginPath(); c.moveTo(x, 37); c.lineTo(x, 55); c.stroke(); }
        rect(c, 6, 36, 58, 2, 'rgba(255,255,255,0.15)');
        rr(c, 68, 20, 22, 26, 3, '#1e293b'); rr(c, 70, 22, 18, 12, 2, '#14532d'); rect(c, 72, 24, 14, 2, '#4ade80'); rect(c, 72, 28, 9, 2, '#4ade80');
        for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) rect(c, 71 + k * 6, 37 + j * 3.5, 4, 2.4, '#94a3b8');
        rr(c, 8, 62, 26, 10, 2, '#16a34a'); c.fillStyle = '#fff'; c.font = 'bold 7px Arial'; c.textAlign = 'center'; c.fillText('CAJA', 21, 70);
        rr(c, 36, 62, 22, 10, 2, '#fde047'); rect(c, 4, 50, 4, 8, '#fb923c'); rect(c, 60, 12, 3, 12, '#cbd5e1');
    });
    def('producetable', 96, 90, 48, 84, (c) => {
        groundShadow(c, 48, 82, 44, 6, 0.3);
        rr(c, 2, 36, 92, 44, 3, '#92400e'); rect(c, 2, 36, 92, 4, '#b45309'); for (let x = 8; x < 92; x += 16) rect(c, x, 44, 2, 34, '#78350f');
        const fruit = [['#ef4444', '#fca5a5'], ['#f97316', '#fdba74'], ['#facc15', '#fef08a'], ['#22c55e', '#86efac'], ['#a855f7', '#d8b4fe'], ['#fb7185', '#fecdd3']];
        for (let b = 0; b < 4; b++) { const bx = 6 + b * 22, [f1, f2] = fruit[(b + 1) % 6]; rr(c, bx, 22, 20, 24, 2, '#b45309'); rect(c, bx, 22, 20, 3, '#d97706'); for (let k = 0; k < 8; k++) { circle(c, bx + 4 + (k % 4) * 4.4, 17 + Math.floor(k / 4) * 5, 3.6, k % 2 ? f1 : f2); } }
        for (let b = 0; b < 4; b++) { const bx = 6 + b * 22, [f1, f2] = fruit[(b + 4) % 6]; for (let k = 0; k < 6; k++) circle(c, bx + 5 + (k % 3) * 5, 52 + Math.floor(k / 3) * 7, 3.8, k % 2 ? f1 : f2); }
        rr(c, 22, 4, 52, 12, 3, '#16a34a', '#fff', 1); c.fillStyle = '#fff'; c.font = "900 8px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('FRUTAS Y VERDURAS', 48, 13);
    });
    def('cart', 54, 60, 27, 54, (c) => {
        groundShadow(c, 27, 52, 22, 4, 0.3); c.strokeStyle = '#94a3b8'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(6, 10); c.lineTo(14, 34); c.lineTo(46, 34); c.lineTo(50, 14); c.stroke();
        for (let x = 16; x < 48; x += 6) { c.beginPath(); c.moveTo(x, 34); c.lineTo(x + 1, 14 + (x - 16) / 10); c.stroke(); }
        for (let y = 18; y < 34; y += 7) { c.beginPath(); c.moveTo(11 + (y - 18) / 4, y); c.lineTo(48, y - 2); c.stroke(); }
        c.strokeStyle = '#ef4444'; c.lineWidth = 3; c.beginPath(); c.moveTo(2, 10); c.lineTo(10, 10); c.stroke();
        circle(c, 18, 46, 4, '#1e293b'); circle(c, 42, 46, 4, '#1e293b'); c.strokeStyle = '#94a3b8'; c.lineWidth = 2; c.beginPath(); c.moveTo(18, 36); c.lineTo(18, 44); c.moveTo(42, 36); c.lineTo(42, 44); c.stroke();
    });
    def('baskets', 54, 54, 27, 48, (c) => {
        groundShadow(c, 27, 46, 22, 4, 0.3);
        [0, 1, 2].forEach(k => { rr(c, 8, 26 - k * 7, 38, 20, 3, k % 2 ? '#f97316' : '#fb923c'); rect(c, 8, 26 - k * 7, 38, 3, 'rgba(255,255,255,0.3)'); c.strokeStyle = '#7c2d12'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(12, 24 - k * 7); c.quadraticCurveTo(27, 12 - k * 7, 42, 24 - k * 7); c.stroke(); });
    });
    def('mat', 96, 54, 48, 48, (c) => { rr(c, 4, 10, 88, 34, 4, '#1f2937'); c.fillStyle = '#e5e7eb'; c.font = "900 12px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('BIENVENIDO', 48, 32); c.strokeStyle = '#6b7280'; c.lineWidth = 1.5; c.strokeRect(8, 14, 80, 26); });

    // ---- Hamburguesería ----
    def('burgercounter', 12 * 48, 96, 6 * 48, 90, (c) => {
        const W = 12 * 48; groundShadow(c, W / 2, 86, W / 2, 6, 0.3);
        rr(c, 0, 30, W, 58, 6, '#be123c'); rr(c, 0, 24, W, 52, 6, '#f8fafc'); rect(c, 0, 24, W, 5, '#e2e8f0');
        c.fillStyle = '#be123c'; for (let x = 0; x < W; x += 24) rect(c, x, 58, 12, 14, '#be123c');
        rect(c, 0, 72, W, 4, '#9f1239'); rect(c, 0, 24, W, 3, 'rgba(255,255,255,0.8)');
        for (let k = 0; k < 3; k++) { const rx = 38 + k * 150;
            rr(c, rx, 10, 44, 24, 3, '#1e293b'); rr(c, rx + 3, 12, 38, 13, 2, '#fde047'); c.fillStyle = '#7c2d12'; c.font = "900 8px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('PEDIR', rx + 22, 22);
            rr(c, rx + 6, 38, 32, 8, 2, '#475569'); circle(c, rx + 54, 24, 5, '#fbbf24'); rect(c, rx + 53, 17, 2, 4, '#92400e'); }
        rr(c, 470, 14, 22, 12, 2, '#fca5a5'); rr(c, 500, 18, 14, 10, 2, '#fff'); rr(c, 520, 12, 40, 16, 3, '#facc15'); c.fillStyle = '#7c2d12'; c.font = 'bold 8px Arial'; c.fillText('PROPINAS', 540, 23);
    });
    def('grill', 96, 90, 48, 82, (c) => {
        groundShadow(c, 48, 82, 42, 6, 0.3); rr(c, 2, 30, 92, 52, 4, '#94a3b8'); rr(c, 2, 24, 92, 46, 4, '#cbd5e1'); rect(c, 2, 24, 92, 3, '#fff');
        rr(c, 8, 28, 80, 28, 3, '#1f2937'); c.strokeStyle = '#374151'; c.lineWidth = 2; for (let x = 12; x < 86; x += 6) { c.beginPath(); c.moveTo(x, 29); c.lineTo(x, 55); c.stroke(); }
        for (let k = 0; k < 4; k++) { rr(c, 14 + k * 18, 36, 12, 8, 3, '#5b2a14'); rect(c, 14 + k * 18, 36, 12, 2, '#7c3a1c'); }
        for (let k = 0; k < 3; k++) circle(c, 24 + k * 22, 66, 3.5, '#ef4444'); rr(c, 4, 6, 14, 20, 2, '#e2e8f0'); rect(c, 78, 6, 12, 20, '#64748b');
    });
    def('fryer', 56, 80, 28, 72, (c) => {
        groundShadow(c, 28, 72, 24, 5, 0.3); rr(c, 4, 26, 48, 46, 4, '#94a3b8'); rr(c, 4, 20, 48, 40, 4, '#cbd5e1'); rr(c, 8, 26, 40, 16, 3, '#1f2937'); rr(c, 10, 28, 36, 10, 2, '#b45309');
        rr(c, 22, 6, 12, 14, 2, '#1f2937'); rect(c, 26, 0, 4, 8, '#334155'); circle(c, 14, 52, 3, '#ef4444'); circle(c, 42, 52, 3, '#22c55e');
    });
    def('fridge', 56, 118, 28, 110, (c) => {
        groundShadow(c, 28, 108, 24, 5, 0.3); rr(c, 4, 8, 48, 100, 4, '#cbd5e1'); rr(c, 7, 11, 42, 94, 3, '#e2e8f0'); rect(c, 7, 50, 42, 3, '#94a3b8');
        rect(c, 40, 20, 3, 22, '#64748b'); rect(c, 40, 60, 3, 30, '#64748b'); rect(c, 9, 13, 5, 90, 'rgba(255,255,255,0.45)'); rr(c, 14, 24, 14, 10, 1.5, '#fde047');
    });
    def('preptable', 96, 80, 48, 72, (c) => {
        groundShadow(c, 48, 72, 42, 5, 0.3); rr(c, 2, 24, 92, 46, 3, '#94a3b8'); rr(c, 2, 18, 92, 40, 3, '#e2e8f0'); rect(c, 2, 18, 92, 3, '#fff');
        rr(c, 8, 22, 26, 16, 2, '#f8fafc', '#94a3b8', 1); circle(c, 14, 28, 4, '#22c55e'); circle(c, 22, 30, 4, '#ef4444'); circle(c, 28, 27, 3, '#fde047');
        rr(c, 44, 24, 18, 12, 2, '#d4a054'); rr(c, 44, 22, 18, 5, 3, '#e8c07a'); rect(c, 70, 20, 4, 14, '#cbd5e1'); rect(c, 66, 24, 12, 3, '#94a3b8');
    });
    def('booth', 96, 112, 48, 104, (c) => {
        groundShadow(c, 48, 102, 44, 6, 0.3);
        rr(c, 4, 4, 88, 26, 8, '#9f1239'); rr(c, 8, 8, 80, 20, 6, '#dc2626'); for (let k = 0; k < 4; k++) rect(c, 14 + k * 20, 10, 2, 16, 'rgba(0,0,0,0.2)');
        rr(c, 14, 40, 68, 36, 6, '#f8fafc', '#cbd5e1', 1.5); c.fillStyle = '#dc2626'; for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) if ((x + y) % 2 === 0) c.fillRect(16 + x * 16.5, 42 + y * 11, 16.5, 11);
        rr(c, 34, 46, 8, 14, 3, '#ef4444'); rr(c, 46, 46, 8, 14, 3, '#facc15'); rect(c, 14, 70, 68, 6, 'rgba(0,0,0,0.18)'); rr(c, 58, 52, 14, 10, 2, '#e2e8f0'); circle(c, 65, 57, 3, '#fff');
        rr(c, 4, 80, 88, 22, 8, '#9f1239'); rr(c, 8, 80, 80, 18, 6, '#dc2626'); rect(c, 8, 82, 80, 3, 'rgba(255,255,255,0.25)');
    });
    def('stooltable', 96, 96, 48, 88, (c) => {
        groundShadow(c, 48, 86, 38, 6, 0.3);
        rect(c, 44, 40, 8, 44, '#475569'); rr(c, 28, 80, 40, 8, 4, '#334155'); ellipse(c, 48, 36, 36, 16, '#94a3b8'); ellipse(c, 48, 33, 36, 16, '#f8fafc');
        c.fillStyle = '#dc2626'; for (let k = 0; k < 8; k++) { c.beginPath(); c.arc(48, 33, 34 - k * 4, 0, 7); if (k % 2) c.fill(); } ellipse(c, 48, 33, 8, 4, '#fde047');
        [[10, 56], [76, 56]].forEach(([x, y]) => { rect(c, x + 6, y + 8, 4, 22, '#475569'); ellipse(c, x + 8, y + 6, 12, 6, '#be123c'); ellipse(c, x + 8, y + 4, 12, 6, '#e11d48'); });
        rr(c, 40, 26, 6, 10, 3, '#ef4444'); rr(c, 50, 26, 6, 10, 3, '#facc15');
    });
    def('jukebox', 56, 100, 28, 92, (c) => {
        groundShadow(c, 28, 90, 24, 5, 0.3);
        c.fillStyle = '#7c2d12'; c.beginPath(); c.moveTo(4, 90); c.lineTo(4, 30); c.quadraticCurveTo(28, -8, 52, 30); c.lineTo(52, 90); c.closePath(); c.fill();
        c.fillStyle = '#9a3412'; c.beginPath(); c.moveTo(8, 88); c.lineTo(8, 32); c.quadraticCurveTo(28, -2, 48, 32); c.lineTo(48, 88); c.closePath(); c.fill();
        ['#ef4444', '#fbbf24', '#22c55e', '#38bdf8'].forEach((col, k) => { c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.moveTo(11 + k * 1.5, 82); c.lineTo(11 + k * 1.5, 34 - Math.abs(k - 1.5) * -2); c.stroke(); c.beginPath(); c.moveTo(45 - k * 1.5, 82); c.lineTo(45 - k * 1.5, 34); c.stroke(); });
        rr(c, 14, 36, 28, 26, 4, '#1e293b'); circle(c, 28, 49, 9, '#111'); circle(c, 28, 49, 3, '#fde047'); rr(c, 14, 66, 28, 12, 2, '#fde68a'); for (let k = 0; k < 4; k++) rect(c, 17 + k * 6, 69, 4, 6, '#b45309');
    });
    [['#7c3aed', '#a78bfa', '#4ade80'], ['#be123c', '#fb7185', '#fde047'], ['#0e7490', '#67e8f9', '#f472b6']].forEach((p, i) => def('arcade' + i, 56, 104, 28, 96, (c) => {
        groundShadow(c, 28, 94, 24, 5, 0.3);
        c.fillStyle = p[0]; c.beginPath(); c.moveTo(6, 94); c.lineTo(10, 14); c.lineTo(46, 14); c.lineTo(50, 94); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(6, 94); c.lineTo(10, 14); c.lineTo(18, 14); c.lineTo(14, 94); c.fill();
        rr(c, 8, 4, 40, 14, 3, '#111827'); c.fillStyle = p[2]; c.font = "900 8px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText(['VIRUS!', 'ZAPPER', 'NEON'][i], 28, 14);
        rr(c, 13, 22, 30, 26, 3, '#0b1020'); rect(c, 16, 25, 24, 20, p[1]); rect(c, 19, 28, 6, 6, '#111'); rect(c, 30, 33, 6, 6, '#111'); rect(c, 22, 38, 12, 3, '#111');
        rr(c, 10, 52, 36, 12, 3, '#1f2937'); circle(c, 18, 58, 3.5, '#ef4444'); rect(c, 17, 52, 2, 6, '#9ca3af'); circle(c, 30, 58, 2.6, '#fde047'); circle(c, 38, 58, 2.6, '#38bdf8');
    }));
    def('plant', 54, 84, 27, 78, (c) => {
        groundShadow(c, 27, 76, 20, 4, 0.28); rr(c, 14, 54, 26, 22, 4, '#9a3412'); rect(c, 14, 54, 26, 4, '#c2410c');
        const rnd = mulberry(77); for (let k = 0; k < 9; k++) { const a = -1.4 + k * 0.35; c.fillStyle = k % 2 ? '#16a34a' : '#15803d'; c.beginPath(); c.ellipse(27 + Math.sin(a) * 10, 40 - Math.cos(a) * 14, 5, 14, a, 0, 7); c.fill(); }
    });
    def('menuboard', 190, 70, 0, 0, (c) => {
        rr(c, 0, 0, 190, 70, 5, '#1c1917', '#d4a054', 3); c.fillStyle = '#fde047'; c.font = "900 11px 'Orbitron', Arial"; c.textAlign = 'left'; c.fillText('MENÚ NEÓN', 10, 16);
        const items = [['Hamburguesa Spore', '$4.50'], ['Doble Cuarentena', '$6.00'], ['Papas Radiactivas', '$2.50'], ['Batido Verde', '$3.00']];
        c.font = "bold 9px 'Plus Jakarta Sans', Arial"; items.forEach(([n, p], k) => { c.fillStyle = '#f8fafc'; c.textAlign = 'left'; c.fillText(n, 10, 30 + k * 10); c.fillStyle = '#4ade80'; c.textAlign = 'right'; c.fillText(p, 180, 30 + k * 10); });
    });
}

function tileStrip(c, x, y, w, h, a, b, size = TILE_SIZE) { for (let yy = 0; yy < h; yy += size) for (let xx = 0; xx < w; xx += size) { c.fillStyle = ((xx + yy) / size) % 2 ? a : b; c.fillRect(x + xx, y + yy, size, size); } }

// Piso, paredes y decoración fija del Burger Neón (requiere buildInteriorSprites por el menú)
export function paintBurgerBase() {
    const cols = 18, rows = 12, T = TILE_SIZE, W = cols * T, H = rows * T;
        const base = document.createElement('canvas'); base.width = W; base.height = H; const c = base.getContext('2d');
        rect(c, 0, 0, W, H, '#1c1917');
        // suelo comedor (damero rojo/crema)
        tileStrip(c, T, 6 * T, W - 2 * T, 5 * T, '#fff1e0', '#e11d48');
        c.fillStyle = 'rgba(255,255,255,0.10)'; for (let y = 6 * T; y < 11 * T; y += T) c.fillRect(T, y, W - 2 * T, 2);
        // cocina (baldosa blanca)
        tileStrip(c, T, 2 * T, 12 * T, 4 * T, '#f1f5f9', '#e2e8f0', 24);
        c.strokeStyle = 'rgba(0,0,0,0.08)'; c.lineWidth = 1; for (let x = T; x < 13 * T; x += 24) { c.beginPath(); c.moveTo(x, 2 * T); c.lineTo(x, 6 * T); c.stroke(); }
        // moqueta zona arcade
        rect(c, 13 * T, 2 * T, 4 * T, 4 * T, '#1e1b4b');
        for (let y = 2 * T; y < 6 * T; y += 24) for (let x = 13 * T; x < 17 * T; x += 24) { c.fillStyle = ((x + y) / 24) % 2 ? '#312e81' : '#1e1b4b'; c.fillRect(x, y, 24, 24); c.fillStyle = '#6366f1'; c.fillRect(x + 10, y + 10, 3, 3); c.fillStyle = '#ec4899'; c.fillRect(x + 20, y + 4, 2, 2); }
        rect(c, 13 * T, 2 * T, 4, 4 * T, '#0f172a');
        // pared trasera
        rect(c, 0, 0, W, 2 * T, '#fbcfe8'); rect(c, 0, 0, W, 6, '#be123c');
        for (let x = 0; x < W; x += 24) { rect(c, x, 2 * T - 34, 12, 34, '#be123c'); }
        rect(c, 0, 2 * T - 38, W, 5, '#fff'); rect(c, 0, 2 * T - 4, W, 4, 'rgba(0,0,0,0.3)');
        // campana extractora sobre la parrilla
        rr(c, 2 * T - 10, 16, 110, 48, 4, '#cbd5e1'); rect(c, 2 * T - 10, 56, 110, 8, '#94a3b8'); for (let k = 0; k < 6; k++) rect(c, 2 * T + k * 16, 36, 10, 3, '#64748b');
        // menú + letrero neón
        c.drawImage(SPRITES.menuboard, 5 * T - 34, 14, 184, 68);
        c.save(); c.shadowColor = '#f472b6'; c.shadowBlur = 18; rr(c, 424, 10, 198, 52, 12, '#0f172a', '#f472b6', 4); c.fillStyle = '#f9a8d4'; c.font = "900 19px 'Orbitron', Arial Black"; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BURGER NEÓN', 8 * T + 139, 38); c.restore(); c.textBaseline = 'alphabetic';
        // reloj retro
        circle(c, 406, 36, 16, '#f8fafc'); c.strokeStyle = '#be123c'; c.lineWidth = 4; c.beginPath(); c.arc(406, 36, 16, 0, 7); c.stroke(); c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(406, 36); c.lineTo(406, 26); c.moveTo(406, 36); c.lineTo(413, 39); c.stroke();
        // pósters de la zona arcade
        [[13 * T + 8, 'GAME', '#7c3aed'], [14.5 * T + 8, 'HI-SCORE', '#be123c']].forEach(([x, t, col]) => { rr(c, x, 14, 62, 70, 3, col, '#fff', 2); c.fillStyle = '#fff'; c.font = "900 9px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText(t, x + 31, 30); circle(c, x + 31, 54, 14, 'rgba(255,255,255,0.8)'); });
        // paredes laterales
        [[0, 0], [17 * T, 0]].forEach(([x]) => { rect(c, x, 0, T, H, '#9f1239'); rect(c, x, 0, T, H, 'rgba(0,0,0,0.2)'); for (let y = 2 * T; y < H; y += 24) rect(c, x, y, T, 2, 'rgba(255,255,255,0.15)'); });
        rect(c, T - 6, 2 * T, 6, 9 * T, 'rgba(0,0,0,0.25)'); rect(c, 17 * T, 2 * T, 6, 9 * T, 'rgba(0,0,0,0.25)');
        // pared inferior con ventanales y puerta
        rect(c, 0, 11 * T, W, T, '#9f1239'); rect(c, 0, 11 * T, W, 4, '#fff1e0');
        [[T + 8, 6], [4 * T, 6], [11 * T + 8, 6], [14 * T, 4]].forEach(([x, n]) => { rr(c, x, 11 * T + 6, 2.4 * T, 34, 3, '#fff1e0'); const g = c.createLinearGradient(x, 0, x + 110, 0); g.addColorStop(0, '#7dd3fc'); g.addColorStop(1, '#1e3a8a'); c.fillStyle = g; c.fillRect(x + 4, 11 * T + 10, 2.4 * T - 8, 26); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 12, 11 * T + 10, 12, 26); });
        rr(c, 8 * T - 2, 11 * T - 4, 2 * T + 4, T + 4, 3, '#fff1e0'); rect(c, 8 * T + 2, 11 * T, 2 * T - 4, T, '#38bdf8'); c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(8 * T + 6, 12 * T); c.lineTo(8 * T + 40, 11 * T); c.lineTo(8 * T + 54, 11 * T); c.lineTo(8 * T + 20, 12 * T); c.fill();
        c.strokeStyle = '#fff1e0'; c.lineWidth = 3; c.beginPath(); c.moveTo(9 * T, 11 * T); c.lineTo(9 * T, 12 * T); c.stroke();
        // felpudo de entrada
        rr(c, 8 * T + 2, 10 * T + 8, 2 * T - 4, 34, 4, '#1f2937'); c.fillStyle = '#fde047'; c.font = "900 11px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('¡HOLA!', 9 * T, 10 * T + 30);
        // zócalo
        rect(c, T, 5 * T + 40, W - 2 * T, 0, '#000');
    return base;
}

// Piso, paredes y decoración fija del Supermercado
export function paintMarketBase() {
    const cols = 22, rows = 16, T = TILE_SIZE, W = cols * T, H = rows * T;
        const base = document.createElement('canvas'); base.width = W; base.height = H; const c = base.getContext('2d');
        rect(c, 0, 0, W, H, '#1f2937');
        tileStrip(c, T, 2 * T, W - 2 * T, 13 * T, '#eceff3', '#dfe3e9');
        c.strokeStyle = 'rgba(0,0,0,0.07)'; c.lineWidth = 1; for (let y = 2 * T; y < 15 * T; y += T / 2) { c.beginPath(); c.moveTo(T, y); c.lineTo(W - T, y); c.stroke(); }
        // pasillos señalizados
        c.fillStyle = 'rgba(34,197,94,0.14)'; c.fillRect(T, 6 * T, W - 2 * T, 3 * T); c.fillStyle = 'rgba(250,204,21,0.40)'; for (let x = T + 12; x < W - T - 20; x += 40) c.fillRect(x, 6.5 * T, 22, 4); for (let x = T + 12; x < W - T - 20; x += 40) c.fillRect(x, 8.4 * T, 22, 4);
        // zona de frescos
        rect(c, T, 2 * T, 6 * T, 8 * T, 'rgba(251,191,36,0.10)');
        // pared trasera
        rect(c, 0, 0, W, 2 * T, '#bbf7d0'); rect(c, 0, 0, W, 8, '#15803d');
        for (let x = 0; x < W; x += 48) { rect(c, x, 2 * T - 28, 24, 28, '#86efac'); }
        rect(c, 0, 2 * T - 32, W, 5, '#f0fdf4'); rect(c, 0, 2 * T - 4, W, 4, 'rgba(0,0,0,0.3)');
        c.save(); c.shadowColor = '#fde047'; c.shadowBlur = 10; rr(c, 7.5 * T, 10, 7 * T, 44, 8, '#166534', '#fde047', 3); c.fillStyle = '#fef08a'; c.font = "900 22px 'Orbitron', Arial Black"; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SUPER MERCADO', 11 * T, 33); c.restore(); c.textBaseline = 'alphabetic';
        // puerta de personal y reloj en el hueco de congeladores
        rr(c, 9.2 * T, 2 * T - 90, 1.6 * T, 90, 3, '#374151', '#9ca3af', 2); c.fillStyle = '#fbbf24'; c.font = "900 8px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('SOLO', 10 * T, 2 * T - 56); c.fillText('PERSONAL', 10 * T, 2 * T - 44); circle(c, 10.7 * T, 2 * T - 38, 3, '#9ca3af');
        circle(c, 11.9 * T, 78, 18, '#f8fafc'); c.strokeStyle = '#15803d'; c.lineWidth = 4; c.beginPath(); c.arc(11.9 * T, 78, 18, 0, 7); c.stroke(); c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(11.9 * T, 78); c.lineTo(11.9 * T, 66); c.moveTo(11.9 * T, 78); c.lineTo(11.9 * T + 8, 82); c.stroke();
        // carteles de oferta + aviso sanitario
        [[T + 14, '2x1', '#dc2626'], [3.2 * T, 'OFERTA', '#f59e0b']].forEach(([x, t, col]) => { rr(c, x, 14, 72, 38, 4, col, '#fff', 2); c.fillStyle = '#fff'; c.font = "900 15px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText(t, x + 36, 40); });
        rr(c, 15.6 * T, 14, 90, 50, 3, '#fef3c7', '#b45309', 2); c.fillStyle = '#7f1d1d'; c.font = "900 8px 'Orbitron', Arial"; c.textAlign = 'center'; c.fillText('AVISO SANITARIO', 15.6 * T + 45, 28); c.font = '7px Arial'; c.fillStyle = '#44403c'; c.fillText('Lavarse las manos', 15.6 * T + 45, 40); c.fillText('No tocar lo verde', 15.6 * T + 45, 50);
        // paredes laterales y frontal
        [[0], [21 * T]].forEach(([x]) => { rect(c, x, 0, T, H, '#14532d'); rect(c, x, 0, T, H, 'rgba(0,0,0,0.15)'); for (let y = 2 * T; y < H; y += 24) rect(c, x, y, T, 2, 'rgba(255,255,255,0.12)'); });
        rect(c, 0, 15 * T, W, T, '#14532d'); rect(c, 0, 15 * T, W, 4, '#bbf7d0');
        [[1.2 * T], [3.8 * T], [6.4 * T], [13.2 * T], [15.8 * T], [18.4 * T]].forEach(([x]) => { rr(c, x, 15 * T + 6, 2.2 * T, 34, 3, '#f0fdf4'); const g = c.createLinearGradient(x, 0, x + 100, 0); g.addColorStop(0, '#bae6fd'); g.addColorStop(1, '#1d4ed8'); c.fillStyle = g; c.fillRect(x + 4, 15 * T + 10, 2.2 * T - 8, 26); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 12, 15 * T + 10, 10, 26); });
        rr(c, 10 * T - 4, 15 * T - 4, 2 * T + 8, T + 4, 3, '#f0fdf4'); rect(c, 10 * T, 15 * T, 2 * T, T, '#7dd3fc'); c.strokeStyle = '#f0fdf4'; c.lineWidth = 3; c.beginPath(); c.moveTo(11 * T, 15 * T); c.lineTo(11 * T, 16 * T); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.moveTo(10 * T + 6, 16 * T); c.lineTo(10 * T + 40, 15 * T); c.lineTo(10 * T + 54, 15 * T); c.lineTo(10 * T + 20, 16 * T); c.fill();
    return base;
}
