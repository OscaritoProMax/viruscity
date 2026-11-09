// Edificios: partes (paredes, tejados, ventanas, carteles) y fachadas por tipo.
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { mulberry, shade, rr, rect, circle, ellipse, makeSprite } from "./draw-utils.js";
import { groundShadow } from "./props.js";
import { TILE_SIZE } from "./constants.js";

// =====================================================================
//  PIEZAS PARA CONSTRUIR FACHADAS (paredes, tejados, ventanas, puertas…)
// =====================================================================
function wallFill(c, x, y, w, h, col, style, rnd) {
    rect(c, x, y, w, h, col);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    if (style === 'brick') {
        c.strokeStyle = shade(col, -0.28); c.lineWidth = 1;
        for (let r = 0, yy = y; yy < y + h; yy += 8, r++) {
            c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke();
            for (let xx = x + (r % 2) * 10; xx < x + w; xx += 20) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + 8); c.stroke(); }
        }
        for (let k = 0; k < w * h / 160; k++) { c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'; c.fillRect(x + rnd() * w, y + rnd() * h, 18, 6); }
    } else if (style === 'stone') {
        c.strokeStyle = shade(col, -0.22); c.lineWidth = 1.2;
        for (let r = 0, yy = y; yy < y + h; yy += 16, r++) {
            c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke();
            for (let xx = x + (r % 2) * 18; xx < x + w; xx += 36) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + 16); c.stroke(); }
        }
        c.fillStyle = 'rgba(255,255,255,0.12)'; for (let yy = y + 2; yy < y + h; yy += 16) c.fillRect(x, yy, w, 2);
    } else if (style === 'stucco') {
        for (let k = 0; k < w * h / 60; k++) { c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)'; c.fillRect(x + rnd() * w, y + rnd() * h, 2, 2); }
    } else if (style === 'boards') {
        c.strokeStyle = shade(col, -0.25); c.lineWidth = 1.2;
        for (let xx = x; xx < x + w; xx += 10) { c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); }
        c.fillStyle = 'rgba(255,255,255,0.08)'; for (let xx = x + 1; xx < x + w; xx += 10) c.fillRect(xx, y, 2, h);
    } else { // siding
        c.strokeStyle = shade(col, -0.18); c.lineWidth = 1.2;
        for (let yy = y + 9; yy < y + h; yy += 9) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
        c.fillStyle = 'rgba(255,255,255,0.10)'; for (let yy = y + 10; yy < y + h; yy += 9) c.fillRect(x, yy, w, 1.5);
    }
    // sombra suave bajo el alero y luz lateral
    const g = c.createLinearGradient(0, y, 0, y + 26); g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x, y, w, 26);
    c.restore();
}

function shingleRoof(c, x, y, w, h, base, rnd, opt = {}) {
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    rect(c, x, y, w, h, shade(base, -0.3));
    const rowH = 11, sw = 14;
    for (let r = 0, yy = y + 6; yy < y + h; yy += rowH, r++) {
        for (let sx = x - (r % 2) * (sw / 2); sx < x + w; sx += sw) {
            c.beginPath(); c.moveTo(sx, yy); c.lineTo(sx + sw, yy); c.lineTo(sx + sw, yy + rowH - 3);
            c.quadraticCurveTo(sx + sw / 2, yy + rowH + 3, sx, yy + rowH - 3); c.closePath();
            c.fillStyle = shade(base, (rnd() - 0.5) * 0.14); c.fill();
            c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1; c.stroke();
        }
    }
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    rect(c, x, y, w, 9, shade(base, 0.22)); rect(c, x, y + 9, w, 2, 'rgba(0,0,0,0.35)'); rect(c, x, y, w, 2, shade(base, 0.4));
    rect(c, x, y, 5, h, shade(base, -0.38)); rect(c, x + w - 5, y, 5, h, shade(base, -0.45));
    c.restore();
    // alero
    rr(c, x - 5, y + h - 8, w + 10, 10, 3, shade(base, -0.45)); rect(c, x - 5, y + h - 8, w + 10, 3, shade(base, 0.05));
    rect(c, x, y + h + 2, w, 7, 'rgba(0,0,0,0.25)');
}

function flatRoofTop(c, x, y, w, h, col, rnd, items) {
    rect(c, x, y, w, h, shade(col, -0.35));
    rect(c, x + 6, y + 6, w - 12, h - 14, col);
    c.fillStyle = 'rgba(0,0,0,0.07)';
    for (let k = 0; k < w * h / 200; k++) c.fillRect(x + 8 + rnd() * (w - 16), y + 8 + rnd() * (h - 20), 3, 3);
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1.2;
    for (let xx = x + 30; xx < x + w - 10; xx += 44) { c.beginPath(); c.moveTo(xx, y + 6); c.lineTo(xx, y + h - 8); c.stroke(); }
    // parapeto
    rect(c, x, y, w, 6, shade(col, 0.28)); rect(c, x, y, 6, h, shade(col, 0.1)); rect(c, x + w - 6, y, 6, h, shade(col, -0.25));
    rect(c, x, y + h - 10, w, 10, shade(col, 0.3)); rect(c, x, y + h - 4, w, 4, 'rgba(0,0,0,0.3)');
    (items || []).forEach(it => it(c, x, y, w, h, rnd));
}
// Elementos de azotea
export const roofAC = (px) => (c, x, y, w, h) => { const ax = x + px, ay = y + h - 50; rr(c, ax, ay, 38, 24, 3, '#cbd5e1'); rect(c, ax, ay + 18, 38, 6, '#94a3b8'); circle(c, ax + 19, ay + 10, 8, '#64748b'); circle(c, ax + 19, ay + 10, 5, '#334155'); c.strokeStyle = '#94a3b8'; c.lineWidth = 1; c.beginPath(); c.moveTo(ax + 19, ay + 3); c.lineTo(ax + 19, ay + 17); c.moveTo(ax + 12, ay + 10); c.lineTo(ax + 26, ay + 10); c.stroke(); };
export const roofVent = (px) => (c, x, y, w, h) => { const ax = x + px, ay = y + h - 40; rr(c, ax, ay, 14, 14, 2, '#94a3b8'); rect(c, ax - 3, ay - 3, 20, 5, '#cbd5e1'); };
export const roofAntenna = (px) => (c, x, y, w, h) => { const ax = x + px, ay = y + h - 30; c.strokeStyle = '#cbd5e1'; c.lineWidth = 2; c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, ay - 34); for (let k = 0; k < 3; k++) { c.moveTo(ax - 12 + k * 3, ay - 12 - k * 8); c.lineTo(ax + 12 - k * 3, ay - 12 - k * 8); } c.stroke(); };
const roofTank = (px) => (c, x, y, w, h) => { const ax = x + px, ay = y + h - 58; rect(c, ax + 2, ay + 24, 3, 20, '#78350f'); rect(c, ax + 24, ay + 24, 3, 20, '#78350f'); rr(c, ax, ay, 30, 28, 6, '#a16207'); rect(c, ax, ay + 8, 30, 2, '#713f12'); rect(c, ax, ay + 18, 30, 2, '#713f12'); c.fillStyle = '#854d0e'; c.beginPath(); c.moveTo(ax - 2, ay + 2); c.lineTo(ax + 15, ay - 10); c.lineTo(ax + 32, ay + 2); c.fill(); };
export const roofSky = (px) => (c, x, y, w, h) => { const ax = x + px, ay = y + h - 54; rr(c, ax, ay, 40, 28, 3, '#e2e8f0'); rr(c, ax + 4, ay + 4, 32, 20, 2, '#7dd3fc'); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(ax + 4, ay + 24); c.lineTo(ax + 20, ay + 4); c.stroke(); };

function windowDraw(c, x, y, w, h, o = {}) {
    const frame = o.frame || '#f8fafc';
    if (o.shutters) { rr(c, x - 9, y, 8, h, 1.5, o.shutters); rr(c, x + w + 1, y, 8, h, 1.5, o.shutters); c.strokeStyle = shade(o.shutters, -0.3); c.lineWidth = 1; for (let k = 4; k < h; k += 4) { c.beginPath(); c.moveTo(x - 9, y + k); c.lineTo(x - 1, y + k); c.moveTo(x + w + 1, y + k); c.lineTo(x + w + 9, y + k); c.stroke(); } }
    rr(c, x - 3, y - 3, w + 6, h + 6, o.arch ? w / 2 : 3, frame, 'rgba(0,0,0,0.35)', 1);
    const g = c.createLinearGradient(x, y, x + w * 0.4, y + h); g.addColorStop(0, o.glass1 || '#bfe3ff'); g.addColorStop(1, o.glass2 || '#3b82c4');
    c.beginPath(); o.arch ? c.roundRect(x, y, w, h, [w / 2, w / 2, 0, 0]) : c.rect(x, y, w, h); c.fillStyle = g; c.fill();
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(x + w * 0.1, y + h); c.lineTo(x + w * 0.5, y); c.lineTo(x + w * 0.68, y); c.lineTo(x + w * 0.28, y + h); c.fill();
    if (o.curtain) { c.fillStyle = o.curtain; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w * 0.32, y); c.quadraticCurveTo(x + w * 0.12, y + h * 0.5, x + w * 0.26, y + h); c.lineTo(x, y + h); c.fill(); c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w * 0.68, y); c.quadraticCurveTo(x + w * 0.88, y + h * 0.5, x + w * 0.74, y + h); c.lineTo(x + w, y + h); c.fill(); }
    c.restore();
    c.strokeStyle = frame; c.lineWidth = 2; c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); if (!o.noMullion) { c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); } c.stroke();
    rect(c, x - 5, y + h + 3, w + 10, 4, shade(frame, -0.2)); rect(c, x - 5, y + h + 3, w + 10, 1.5, shade(frame, 0.2));
    if (o.flowerbox) { rr(c, x - 4, y + h + 4, w + 8, 8, 2, '#7c2d12'); const rnd = mulberry(Math.floor(x * 7 + y)); for (let k = 0; k < 6; k++) { circle(c, x - 1 + k * (w + 2) / 5.5, y + h + 3 - rnd() * 2, 3.2, ['#f43f5e', '#fde047', '#f9a8d4', '#fb923c'][k % 4]); circle(c, x - 1 + k * (w + 2) / 5.5, y + h + 6, 3, '#16a34a'); } }
}

function doorDraw(c, x, y, w, h, col, o = {}) {
    // y = parte alta de la puerta, h = alto; la base (y+h) apoya en el suelo
    rr(c, x - 4, y - 4, w + 8, h + 4, o.arch ? w / 2 : 3, o.frame || '#f1f5f9', 'rgba(0,0,0,0.4)', 1);
    c.beginPath(); o.arch ? c.roundRect(x, y, w, h, [w / 2, w / 2, 0, 0]) : c.rect(x, y, w, h); c.fillStyle = col; c.fill();
    c.save(); c.beginPath(); o.arch ? c.roundRect(x, y, w, h, [w / 2, w / 2, 0, 0]) : c.rect(x, y, w, h); c.clip();
    if (o.glass) {
        const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#d7efff'); g.addColorStop(1, '#4a90c2'); c.fillStyle = g; c.fillRect(x + 3, y + 3, w - 6, h - 8);
        c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.moveTo(x + 4, y + h * 0.7); c.lineTo(x + w * 0.45, y + 4); c.lineTo(x + w * 0.62, y + 4); c.lineTo(x + 14, y + h * 0.8); c.fill();
        c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.stroke();
    } else {
        c.strokeStyle = shade(col, -0.3); c.lineWidth = 1.5;
        c.strokeRect(x + 5, y + 6, w / 2 - 7, h * 0.4); c.strokeRect(x + w / 2 + 2, y + 6, w / 2 - 7, h * 0.4); c.strokeRect(x + 5, y + h * 0.5, w - 10, h * 0.42);
        c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(x + 6, y + 7, 5, h * 0.4 - 2);
        if (o.window) { rr(c, x + 7, y + 8, w - 14, 14, 3, '#9bd1ff'); c.strokeStyle = '#f8fafc'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + w / 2, y + 8); c.lineTo(x + w / 2, y + 22); c.stroke(); }
    }
    c.restore();
    if (!o.noKnob) circle(c, x + w - 7, y + h * 0.55, 2.2, '#fde047');
    rect(c, x - 6, y + h, w + 12, 4, '#a8a29e'); rect(c, x - 6, y + h, w + 12, 1.5, '#d6d3d1');
}

function awningDraw(c, x, y, w, h, c1, c2) {
    c.save(); c.beginPath(); c.rect(x - 2, y, w + 4, h + 10); c.clip();
    const n = Math.round(w / 14), sw = w / n;
    for (let k = 0; k < n; k++) {
        const ax = x + k * sw; c.fillStyle = k % 2 ? c2 : c1;
        c.beginPath(); c.moveTo(ax, y); c.lineTo(ax + sw, y); c.lineTo(ax + sw, y + h); c.arc(ax + sw / 2, y + h, sw / 2, 0, Math.PI); c.closePath(); c.fill();
    }
    const g = c.createLinearGradient(0, y, 0, y + h + 8); g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = g; c.fillRect(x, y, w, h + 8); c.restore();
    rect(c, x - 2, y - 3, w + 4, 5, shade(c1, -0.3)); rect(c, x, y + h + 8, w, 6, 'rgba(0,0,0,0.20)');
}

function signBoard(c, x, y, w, h, o) {
    rr(c, x - 3, y - 3, w + 6, h + 6, 6, '#1e293b'); rr(c, x, y, w, h, 4, o.bg, shade(o.bg, 0.35), 1.5);
    const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x + 2, y + 2, w - 4, h / 2);
    let fs = o.size || h * 0.62; const font = o.font || "'Orbitron', 'Arial Black', Impact, sans-serif";
    c.font = `900 ${fs}px ${font}`; while (c.measureText(o.text).width > w - 20 - (o.pad || 0) && fs > 8) { fs -= 1; c.font = `900 ${fs}px ${font}`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (o.glow) { c.shadowColor = o.fg; c.shadowBlur = 12; }
    c.fillStyle = o.fg; c.fillText(o.text, x + w / 2 + (o.pad || 0) / 2, y + h / 2 + 1);
    c.shadowBlur = 0; c.textBaseline = 'alphabetic';
}

// Escaparate: decoración por tipo
function displayItems(c, type, x, y, w, h) {
    rect(c, x, y + h - 10, w, 10, 'rgba(0,0,0,0.25)');
    const sh = (yy) => rect(c, x + 3, yy, w - 6, 3, '#92400e');
    switch (type) {
        case 'bread': sh(y + h * 0.45); sh(y + h - 12);
            for (let k = 0; k < Math.floor(w / 16); k++) { ellipse(c, x + 12 + k * 16, y + h * 0.45 - 5, 7, 4, '#c2823a'); ellipse(c, x + 12 + k * 16, y + h - 17, 6, 4, '#e0a95a'); circle(c, x + 12 + k * 16, y + h - 21, 3, '#f9a8d4'); }
            break;
        case 'pharma': sh(y + h * 0.4); sh(y + h - 12);
            for (let k = 0; k < Math.floor(w / 14); k++) { rr(c, x + 7 + k * 14, y + h * 0.4 - 11, 8, 11, 2, k % 2 ? '#22c55e' : '#fff'); rr(c, x + 7 + k * 14, y + h - 23, 8, 11, 2, k % 2 ? '#38bdf8' : '#f97316'); }
            circle(c, x + w / 2, y + 14, 8, '#22c55e'); rect(c, x + w / 2 - 2, y + 8, 4, 12, '#fff'); rect(c, x + w / 2 - 6, y + 12, 12, 4, '#fff'); break;
        case 'music': sh(y + h * 0.5);
            for (let k = 0; k < Math.floor(w / 13); k++) { rect(c, x + 6 + k * 13, y + h * 0.5 - 18, 10, 18, ['#ec4899', '#06b6d4', '#facc15', '#a855f7'][k % 4]); circle(c, x + 11 + k * 13, y + h * 0.5 - 9, 3, '#111'); }
            circle(c, x + w / 2, y + h - 22, 14, '#111'); circle(c, x + w / 2, y + h - 22, 5, '#dc2626'); circle(c, x + w / 2, y + h - 22, 1.5, '#fff'); break;
        case 'arcade':
            for (let k = 0; k < Math.floor(w / 28); k++) { const ax = x + 10 + k * 28; rr(c, ax, y + 8, 20, h - 18, 3, ['#7c3aed', '#be123c', '#0e7490'][k % 3]); rr(c, ax + 3, y + 12, 14, 12, 2, '#0f172a'); rect(c, ax + 5, y + 15, 4, 4, '#4ade80'); rect(c, ax + 11, y + 18, 4, 4, '#f472b6'); circle(c, ax + 6, y + 32, 2, '#fde047'); circle(c, ax + 13, y + 32, 2, '#f87171'); } break;
        case 'flowers': sh(y + h - 14);
            for (let k = 0; k < Math.floor(w / 14); k++) { const fx = x + 10 + k * 14; c.strokeStyle = '#16a34a'; c.lineWidth = 2; c.beginPath(); c.moveTo(fx, y + h - 14); c.lineTo(fx, y + h - 34 - (k % 2) * 6); c.stroke(); circle(c, fx, y + h - 36 - (k % 2) * 6, 5, ['#f43f5e', '#fde047', '#f9a8d4', '#a855f7'][k % 4]); circle(c, fx, y + h - 36 - (k % 2) * 6, 1.8, '#fef08a'); } break;
        case 'barber':
            rr(c, x + w / 2 - 6, y + 8, 12, h - 20, 5, '#fff'); c.save(); c.beginPath(); c.roundRect(x + w / 2 - 6, y + 8, 12, h - 20, 5); c.clip(); c.fillStyle = '#ef4444'; for (let k = -2; k < 8; k++) { c.beginPath(); c.moveTo(x + w / 2 - 8, y + 6 + k * 9); c.lineTo(x + w / 2 + 8, y + 12 + k * 9); c.lineTo(x + w / 2 + 8, y + 17 + k * 9); c.lineTo(x + w / 2 - 8, y + 11 + k * 9); c.fill(); } c.restore(); break;
        case 'books': sh(y + h * 0.4); sh(y + h - 12);
            for (let k = 0; k < Math.floor(w / 8); k++) { rect(c, x + 5 + k * 8, y + h * 0.4 - 14 - (k % 3) * 2, 6, 14 + (k % 3) * 2, ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'][k % 5]); rect(c, x + 5 + k * 8, y + h - 26 + (k % 2) * 2, 6, 14 - (k % 2) * 2, ['#0e7490', '#be123c', '#4d7c0f'][k % 3]); } break;
        case 'cafe': sh(y + h * 0.5);
            for (let k = 0; k < Math.floor(w / 16); k++) { rr(c, x + 6 + k * 16, y + h * 0.5 - 12, 10, 12, 2, '#fff'); rect(c, x + 8 + k * 16, y + h * 0.5 - 10, 6, 3, '#78350f'); }
            circle(c, x + w / 2, y + h - 22, 11, '#d97706'); circle(c, x + w / 2, y + h - 22, 7, '#fde68a'); break;
        default: sh(y + h * 0.5); for (let k = 0; k < Math.floor(w / 14); k++) rect(c, x + 6 + k * 14, y + h * 0.5 - 12, 10, 12, ['#f43f5e', '#38bdf8', '#facc15'][k % 3]);
    }
}

// =====================================================================
//  TIPOS DE EDIFICIO → cada uno dibuja su fachada completa en un sprite
//  Convención: footprint = w×h tiles; las filas de abajo son la fachada
//  (wallRows) y las de arriba el tejado. Base del sprite = suelo.
// =====================================================================
const KINDS = {};

// ---------- CASA ----------
KINDS.house = (c, s, W, H, TOP, rnd, meta) => {
    const wallTop = TOP + H - 96, baseY = TOP + H;
    const doorBay = s.doorBay ?? Math.floor((s.w - 1) / 2);
    wallFill(c, 0, wallTop, W, 96, s.wall, s.wallStyle || 'siding', rnd);
    rect(c, 0, baseY - 9, W, 9, '#78716c'); rect(c, 0, baseY - 9, W, 2, '#a8a29e');
    for (let x = 0; x < W; x += 24) rect(c, x, baseY - 9, 1, 9, 'rgba(0,0,0,0.25)');
    rect(c, 0, wallTop, 5, 96, s.trim); rect(c, W - 5, wallTop, 5, 96, s.trim);
    for (let i = 0; i < s.w; i++) {
        if (i === doorBay) continue;
        const o = { frame: s.trim, shutters: s.shutters, flowerbox: s.flowerbox && (i + (s.seed || 0)) % 2 === 0, curtain: i % 2 ? '#fda4af' : '#fde68a', arch: s.archWin };
        windowDraw(c, i * 48 + 9, wallTop + 24, 30, 36, o);
        meta.windows.push({ x: i * 48 + 9, y: wallTop + 24, w: 30, h: 36 });
    }
    // vigas decorativas (estilo tudor)
    if (s.tudor) { c.strokeStyle = '#5b3410'; c.lineWidth = 3; for (let i = 0; i <= s.w; i++) { c.beginPath(); c.moveTo(i * 48, wallTop); c.lineTo(i * 48, baseY - 9); c.stroke(); } c.beginPath(); c.moveTo(0, wallTop + 6); c.lineTo(W, wallTop + 6); c.stroke(); }
    // enredadera
    if (s.vines) { c.fillStyle = '#15803d'; for (let k = 0; k < 40; k++) { circle(c, W - 4 - rnd() * 34, wallTop + 6 + rnd() * 76, 3 + rnd() * 3, rnd() > 0.5 ? '#16a34a' : '#22c55e'); } }
    const dx = doorBay * 48 + 7, dy = baseY - 9 - 66;
    doorDraw(c, dx, dy, 34, 66, s.door, { window: true });
    // tejado
    const roofH = wallTop - TOP + 6;
    shingleRoof(c, 4, TOP + 2, W - 8, roofH, s.roof, rnd);
    // buhardilla
    if (s.dormer) {
        const bx = doorBay * 48 + 7, by = TOP + 22;
        rect(c, bx, by + 8, 34, 28, s.wall); rect(c, bx, by + 8, 34, 28, 'rgba(0,0,0,0.05)');
        windowDraw(c, bx + 7, by + 14, 20, 18, { frame: s.trim, noMullion: true });
        c.fillStyle = shade(s.roof, -0.1); c.beginPath(); c.moveTo(bx - 5, by + 10); c.lineTo(bx + 17, by - 8); c.lineTo(bx + 39, by + 10); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.2; c.stroke(); rect(c, bx - 5, by + 8, 44, 3, shade(s.roof, -0.4));
    }
    if (s.chimney) {
        const cx = Math.floor(W * (s.chimneyAt ?? 0.72)); rect(c, cx, TOP - 16, 22, 56, '#9a3412'); rect(c, cx, TOP - 16, 22, 56, 'rgba(0,0,0,0.08)');
        c.strokeStyle = '#7c2d12'; c.lineWidth = 1; for (let y = TOP - 8; y < TOP + 38; y += 8) { c.beginPath(); c.moveTo(cx, y); c.lineTo(cx + 22, y); c.stroke(); }
        rect(c, cx - 3, TOP - 20, 28, 7, '#78716c'); rect(c, cx - 3, TOP - 20, 28, 2, '#a8a29e');
        meta.chimney = { x: cx + 11, y: TOP - 20 };
    }
    // porche (gablete sobre la puerta)
    c.fillStyle = shade(s.roof, 0.05); c.beginPath(); c.moveTo(dx - 11, dy - 2); c.lineTo(dx + 17, dy - 24); c.lineTo(dx + 45, dy - 2); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1.2; c.stroke(); c.fillStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.moveTo(dx - 11, dy - 2); c.lineTo(dx + 17, dy - 24); c.lineTo(dx + 17, dy - 2); c.fill();
    rect(c, dx - 11, dy - 3, 56, 4, shade(s.roof, -0.45)); rect(c, dx - 8, dy + 1, 50, 5, 'rgba(0,0,0,0.25)');
    rr(c, dx + 46, dy + 10, 10, 14, 2, '#1e293b'); rect(c, dx + 48, dy + 12, 6, 8, '#fde68a'); meta.windows.push({ x: dx + 48, y: dy + 12, w: 6, h: 8, lamp: true });
    rr(c, dx + 10, dy - 12, 14, 8, 2, '#f8fafc', '#475569', 1); c.fillStyle = '#334155'; c.font = 'bold 7px Arial'; c.textAlign = 'center'; c.fillText(String(s.number || 12), dx + 17, dy - 5.5);
};

// ---------- TIENDA / COMERCIO ----------
KINDS.shop = (c, s, W, H, TOP, rnd, meta) => {
    const wallH = 144, wallTop = TOP + H - wallH, baseY = TOP + H, roofH = wallTop - TOP + 4;
    const doorW = s.doorW || 1, doorBay = s.doorBay ?? Math.floor((s.w - doorW) / 2);
    flatRoofTop(c, 0, TOP, W, roofH, s.roofTop || '#6b7280', rnd, s.roofItems || [roofAC(20), roofVent(W * 0.55), roofAntenna(W - 40)]);
    if (s.rooftop === 'burger') drawGiantBurger(c, W / 2, TOP + roofH - 18);
    wallFill(c, 0, wallTop, W, wallH, s.wall, s.wallStyle || 'stucco', rnd);
    rect(c, 0, wallTop, W, 8, shade(s.wall, 0.35)); rect(c, 0, wallTop + 8, W, 3, 'rgba(0,0,0,0.25)');
    rect(c, 0, baseY - 10, W, 10, s.base || '#57534e'); rect(c, 0, baseY - 10, W, 2, 'rgba(255,255,255,0.25)');
    rect(c, 0, wallTop, 7, wallH, shade(s.wall, -0.2)); rect(c, W - 7, wallTop, 7, wallH, shade(s.wall, -0.3));
    if (s.stripe) { rect(c, 7, wallTop + 44, W - 14, 6, s.stripe); }
    signBoard(c, 14, wallTop + 14, W - 28, 32, Object.assign({}, s.sign, { glow: s.neon }));
    if (s.sign.bulbs) { for (let x = 20; x < W - 18; x += 12) { circle(c, x, wallTop + 14, 2.3, '#fde047'); circle(c, x, wallTop + 46, 2.3, '#fde047'); } }
    if (s.cross) { rr(c, 16, wallTop + 17, 26, 26, 4, '#fff'); rect(c, 26, wallTop + 20, 6, 20, '#dc2626'); rect(c, 19, wallTop + 27, 20, 6, '#dc2626'); }
    awningDraw(c, 7, wallTop + 52, W - 14, 13, s.awning[0], s.awning[1]);
    // escaparates (agrupa bahías contiguas)
    const wy = wallTop + 78, wh = 54;
    let i = 0;
    while (i < s.w) {
        if (i >= doorBay && i < doorBay + doorW) { i = doorBay + doorW; continue; }
        let j = i; while (j < s.w && !(j >= doorBay && j < doorBay + doorW)) j++;
        const x0 = i * 48 + 9, ww = (j - i) * 48 - 18;
        if (ww > 20) {
            rr(c, x0 - 4, wy - 4, ww + 8, wh + 8, 3, s.trim || '#f1f5f9', 'rgba(0,0,0,0.4)', 1);
            rect(c, x0, wy, ww, wh, s.glassBack || '#fde8c8');
            if (s.display === 'posters') { for (let k = 0; k < Math.floor(ww / 36); k++) { rr(c, x0 + 6 + k * 36, wy + 5, 28, 42, 2, ['#be123c', '#1d4ed8', '#6d28d9', '#047857'][k % 4], '#fff', 1.2); circle(c, x0 + 20 + k * 36, wy + 22, 6, 'rgba(255,255,255,0.7)'); rect(c, x0 + 11 + k * 36, wy + 34, 18, 3, 'rgba(255,255,255,0.8)'); } }
            else displayItems(c, s.display, x0, wy, ww, wh);
            const g = c.createLinearGradient(x0, wy, x0 + ww * 0.5, wy + wh); g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.35, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(120,180,255,0.18)');
            c.fillStyle = g; c.fillRect(x0, wy, ww, wh);
            c.strokeStyle = s.trim || '#f1f5f9'; c.lineWidth = 2; for (let k = i + 1; k < j; k++) { c.beginPath(); c.moveTo(k * 48, wy); c.lineTo(k * 48, wy + wh); c.stroke(); }
            meta.windows.push({ x: x0, y: wy, w: ww, h: wh });
        }
        i = j;
    }
    const dx = doorBay * 48 + 6, dw = doorW * 48 - 12;
    doorDraw(c, dx, baseY - 10 - 72, dw, 72, s.doorColor || '#334155', { glass: true, frame: s.trim || '#f1f5f9', noKnob: doorW > 1 });
    rr(c, dx + dw / 2 - 14, baseY - 10 - 54, 28, 12, 3, '#ef4444', '#fff', 1); c.fillStyle = '#fff'; c.font = 'bold 8px Arial'; c.textAlign = 'center'; c.fillText(s.openText || 'OPEN', dx + dw / 2, baseY - 10 - 45);
    meta.neon = s.neon ? { x: 14, y: wallTop + 14, w: W - 28, h: 32, color: s.sign.fg } : null;
};

function drawGiantBurger(c, cx, by) {
    groundShadow(c, cx, by, 62, 8, 0.25);
    rr(c, cx - 56, by - 20, 112, 20, 9, '#d4a054'); rr(c, cx - 56, by - 20, 112, 8, 7, '#e8c07a');          // pan inferior
    rr(c, cx - 58, by - 36, 116, 17, 8, '#5b2a14'); rect(c, cx - 58, by - 36, 116, 4, '#7c3a1c');            // carne
    c.fillStyle = '#fbbf24'; c.beginPath(); c.moveTo(cx - 54, by - 38); c.lineTo(cx + 54, by - 38); c.lineTo(cx + 30, by - 28); c.lineTo(cx + 12, by - 38); c.lineTo(cx - 8, by - 26); c.lineTo(cx - 30, by - 38); c.fill();  // queso
    c.fillStyle = '#22c55e'; c.beginPath(); c.moveTo(cx - 62, by - 44); for (let k = 0; k <= 12; k++) c.lineTo(cx - 62 + k * 10.3, by - 44 + (k % 2 ? 8 : 0)); c.lineTo(cx + 62, by - 52); c.lineTo(cx - 62, by - 52); c.fill();   // lechuga
    rr(c, cx - 56, by - 54, 112, 9, 4, '#ef4444');                                                           // tomate
    c.fillStyle = '#d4902f'; c.beginPath(); c.moveTo(cx - 60, by - 54); c.quadraticCurveTo(cx - 60, by - 108, cx, by - 108); c.quadraticCurveTo(cx + 60, by - 108, cx + 60, by - 54); c.closePath(); c.fill();   // pan superior
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.moveTo(cx - 50, by - 62); c.quadraticCurveTo(cx - 48, by - 96, cx - 12, by - 100); c.quadraticCurveTo(cx - 40, by - 86, cx - 40, by - 62); c.fill();
    c.fillStyle = '#fef3c7'; [[-30, -90], [-8, -98], [16, -94], [36, -84], [-42, -76], [0, -80], [26, -70], [-18, -68]].forEach(([x, y]) => { c.save(); c.translate(cx + x, by + y); c.rotate(x * 0.05); c.beginPath(); c.ellipse(0, 0, 4, 2.2, 0, 0, 7); c.fill(); c.restore(); });
}

// ---------- EDIFICIO DE APARTAMENTOS ----------
KINDS.apartment = (c, s, W, H, TOP, rnd, meta) => {
    const wallH = 240, wallTop = TOP + H - wallH, baseY = TOP + H, roofH = wallTop - TOP + 4;
    const doorBay = Math.floor((s.w - 1) / 2);
    flatRoofTop(c, 0, TOP, W, roofH, '#57534e', rnd, [roofTank(26), roofAC(W - 80), roofAntenna(W / 2), roofVent(110)]);
    wallFill(c, 0, wallTop, W, wallH, s.wall, 'brick', rnd);
    rect(c, 0, wallTop, W, 8, shade(s.wall, 0.4)); rect(c, 0, baseY - 12, W, 12, '#44403c');
    rect(c, 0, wallTop, 7, wallH, shade(s.wall, -0.25)); rect(c, W - 7, wallTop, 7, wallH, shade(s.wall, -0.35));
    for (let f = 0; f < 3; f++) {
        const fy = wallTop + 18 + f * 66;
        rect(c, 0, fy + 56, W, 5, 'rgba(255,255,255,0.18)'); rect(c, 0, fy + 61, W, 2, 'rgba(0,0,0,0.25)');
        for (let i = 0; i < s.w; i++) {
            if (f === 2 && i === doorBay) continue;
            if (f === 2) { windowDraw(c, i * 48 + 8, fy + 12, 32, 40, { frame: '#e2e8f0', glass1: '#fde68a', glass2: '#ca8a04' }); meta.windows.push({ x: i * 48 + 8, y: fy + 12, w: 32, h: 40 }); continue; }
            windowDraw(c, i * 48 + 10, fy + 8, 28, 36, { frame: '#f1f5f9', curtain: ['#fda4af', '#a5f3fc', '#fde68a', '#c4b5fd'][(i + f) % 4] });
            meta.windows.push({ x: i * 48 + 10, y: fy + 8, w: 28, h: 36 });
            if ((i + f) % 2 === 0) { rr(c, i * 48 + 4, fy + 44, 40, 14, 2, '#334155'); c.strokeStyle = '#64748b'; c.lineWidth = 1.2; for (let x = i * 48 + 8; x < i * 48 + 44; x += 6) { c.beginPath(); c.moveTo(x, fy + 44); c.lineTo(x, fy + 58); c.stroke(); } circle(c, i * 48 + 14, fy + 42, 4, '#16a34a'); circle(c, i * 48 + 30, fy + 41, 3.5, '#f43f5e'); }
        }
    }
    const dx = doorBay * 48 - 2, dy = baseY - 12 - 74;
    doorDraw(c, dx, dy, 52, 74, '#1e3a5f', { glass: true, frame: '#e2e8f0' });
    awningDraw(c, dx - 14, dy - 22, 80, 14, '#1d4ed8', '#dbeafe');
    signBoard(c, dx - 8, dy - 56, 68, 20, { text: s.name || 'RESIDENCIAL', bg: '#0f172a', fg: '#fde047', size: 11 });
    // cartel de buzón
    rr(c, dx + 62, baseY - 12 - 46, 16, 28, 2, '#94a3b8');
};

// ---------- IGLESIA ----------
KINDS.church = (c, s, W, H, TOP, rnd, meta) => {
    const wallH = 144, wallTop = TOP + H - wallH, baseY = TOP + H, roofH = wallTop - TOP + 4;
    wallFill(c, 0, wallTop, W, wallH, s.wall, 'stone', rnd);
    rect(c, 0, baseY - 12, W, 12, '#78716c'); rect(c, 0, wallTop, W, 6, shade(s.wall, 0.3));
    shingleRoof(c, 4, TOP + 44, W - 8, roofH - 44, '#475569', rnd);
    const tx = W / 2 - 62, tw = 124, ty = 24;
    wallFill(c, tx, ty, tw, baseY - ty, shade(s.wall, 0.08), 'stone', rnd);
    rect(c, tx, ty, 6, baseY - ty, 'rgba(255,255,255,0.18)'); rect(c, tx + tw - 8, ty, 8, baseY - ty, 'rgba(0,0,0,0.22)');
    for (let x = tx; x < tx + tw; x += 20) rect(c, x, ty - 8, 12, 10, shade(s.wall, 0.08));
    // reloj + campanario
    circle(c, W / 2, ty + 28, 17, '#f8fafc'); c.strokeStyle = '#1e293b'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, ty + 28, 17, 0, 7); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.moveTo(W / 2, ty + 28); c.lineTo(W / 2, ty + 17); c.moveTo(W / 2, ty + 28); c.lineTo(W / 2 + 8, ty + 32); c.stroke();
    c.fillStyle = '#1e293b'; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; c.fillRect(W / 2 + Math.sin(a) * 14 - 1, ty + 28 - Math.cos(a) * 14 - 1, 2, 2); }
    windowDraw(c, W / 2 - 14, ty + 58, 28, 40, { frame: '#e7e5e4', arch: true, glass1: '#1e293b', glass2: '#0f172a', noMullion: true });
    circle(c, W / 2, ty + 80, 5, '#fde047');
    // aguja
    c.fillStyle = '#334155'; c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(tx + tw + 6, ty - 6); c.lineTo(tx - 6, ty - 6); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(tx - 6, ty - 6); c.lineTo(W / 2, ty - 6); c.fill();
    // rosetón y vitrales
    circle(c, W / 2, wallTop + 6, 18, '#e7e5e4'); circle(c, W / 2, wallTop + 6, 14, '#1d4ed8');
    ['#ef4444', '#facc15', '#22c55e', '#a855f7'].forEach((col, k) => { c.fillStyle = col; c.beginPath(); c.moveTo(W / 2, wallTop + 6); c.arc(W / 2, wallTop + 6, 13, k * Math.PI / 2, (k + 1) * Math.PI / 2); c.fill(); });
    [[22, 0], [W - 52, 0], [76, 0], [W - 106, 0]].forEach(([x]) => { windowDraw(c, x, wallTop + 36, 30, 66, { frame: '#e7e5e4', arch: true, glass1: '#60a5fa', glass2: '#7c3aed', noMullion: true }); meta.windows.push({ x, y: wallTop + 36, w: 30, h: 66 }); });
    const doorBay = Math.floor((s.w - 2) / 2);
    doorDraw(c, doorBay * 48 + 6, baseY - 12 - 90, 84, 90, '#5b2a14', { arch: true, frame: '#e7e5e4', noKnob: true });
    c.strokeStyle = '#2b1408'; c.lineWidth = 2; c.beginPath(); c.moveTo(doorBay * 48 + 48, baseY - 12 - 82); c.lineTo(doorBay * 48 + 48, baseY - 12); c.stroke();
    c.strokeStyle = '#d4a054'; c.lineWidth = 3; c.beginPath(); c.moveTo(doorBay * 48 + 26, baseY - 12 - 40); c.lineTo(doorBay * 48 + 40, baseY - 12 - 40); c.moveTo(doorBay * 48 + 56, baseY - 12 - 40); c.lineTo(doorBay * 48 + 70, baseY - 12 - 40); c.stroke();
};

// ---------- AYUNTAMIENTO ----------
KINDS.hall = (c, s, W, H, TOP, rnd, meta) => {
    const wallH = 192, wallTop = TOP + H - wallH, baseY = TOP + H, roofH = wallTop - TOP + 4;
    const doorBay = Math.floor((s.w - 2) / 2);
    flatRoofTop(c, 0, TOP, W, roofH, '#64748b', rnd, [roofVent(30), roofVent(W - 60)]);
    // balaustrada en la azotea
    for (let x = 8; x < W - 8; x += 12) { rect(c, x, TOP + roofH - 26, 5, 14, '#e7e5e4'); } rect(c, 6, TOP + roofH - 28, W - 12, 4, '#f5f5f4');
    wallFill(c, 0, wallTop, W, wallH, s.wall, 'stone', rnd);
    rect(c, 0, wallTop, W, 8, '#f5f5f4'); rect(c, 0, wallTop + 8, W, 3, 'rgba(0,0,0,0.2)'); rect(c, 0, baseY - 14, W, 14, '#a8a29e');
    for (let i = 0; i < s.w; i++) { if (i >= doorBay - 1 && i <= doorBay + 2) continue; for (let f = 0; f < 2; f++) { windowDraw(c, i * 48 + 9, wallTop + 22 + f * 76, 30, 52, { frame: '#f5f5f4', arch: f === 0, curtain: '#e5e7eb' }); meta.windows.push({ x: i * 48 + 9, y: wallTop + 22 + f * 76, w: 30, h: 52 }); } }
    // frontón + columnas
    const px = (doorBay - 1) * 48, pw = 4 * 48;
    c.fillStyle = '#e7e5e4'; c.beginPath(); c.moveTo(px - 12, wallTop + 4); c.lineTo(px + pw / 2, TOP - 30); c.lineTo(px + pw + 12, wallTop + 4); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2; c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.08)'; c.beginPath(); c.moveTo(px + pw / 2, TOP - 8); c.lineTo(px + pw - 4, wallTop - 2); c.lineTo(px + 4, wallTop - 2); c.closePath(); c.fill();
    circle(c, px + pw / 2, TOP + 22, 20, '#f8fafc'); c.strokeStyle = '#1e293b'; c.lineWidth = 3; c.beginPath(); c.arc(px + pw / 2, TOP + 22, 20, 0, 7); c.stroke();
    c.lineWidth = 2.4; c.beginPath(); c.moveTo(px + pw / 2, TOP + 22); c.lineTo(px + pw / 2 - 3, TOP + 8); c.moveTo(px + pw / 2, TOP + 22); c.lineTo(px + pw / 2 + 9, TOP + 26); c.stroke();
    rect(c, px - 14, wallTop + 2, pw + 28, 10, '#d6d3d1');
    for (let k = 0; k < 5; k++) { const cx = px + 6 + k * (pw - 24) / 4; rr(c, cx, wallTop + 10, 14, wallH - 24, 2, '#f5f5f4'); rect(c, cx, wallTop + 10, 4, wallH - 24, '#fff'); rect(c, cx + 10, wallTop + 10, 4, wallH - 24, 'rgba(0,0,0,0.12)'); rect(c, cx - 3, wallTop + 8, 20, 6, '#e7e5e4'); rect(c, cx - 3, baseY - 24, 20, 6, '#e7e5e4'); }
    doorDraw(c, doorBay * 48 + 6, baseY - 14 - 92, 84, 92, '#3b2a1a', { arch: true, frame: '#fafaf9', noKnob: true });
    c.strokeStyle = '#d4a054'; c.lineWidth = 2; c.beginPath(); c.moveTo(doorBay * 48 + 48, baseY - 14 - 84); c.lineTo(doorBay * 48 + 48, baseY - 14); c.stroke();
    // escalones
    [0, 1, 2].forEach(k => rect(c, px - 6 + k * 3, baseY - 12 + k * 4 - 4, pw + 12 - k * 6, 4, k % 2 ? '#d6d3d1' : '#e7e5e4'));
    // bandera
    rect(c, W - 40, TOP - 34, 3, 46, '#cbd5e1'); c.fillStyle = '#dc2626'; c.beginPath(); c.moveTo(W - 37, TOP - 32); c.lineTo(W - 8, TOP - 24); c.lineTo(W - 37, TOP - 14); c.fill();
};

// ---------- GRANERO ----------
KINDS.barn = (c, s, W, H, TOP, rnd, meta) => {
    const wallH = 144, wallTop = TOP + H - wallH, baseY = TOP + H;
    wallFill(c, 0, wallTop, W, wallH, '#b91c1c', 'boards', rnd);
    rect(c, 0, baseY - 10, W, 10, '#78716c');
    c.fillStyle = '#7f1d1d'; c.beginPath(); c.moveTo(0, wallTop + 6); c.lineTo(W * 0.18, TOP + 28); c.lineTo(W * 0.82, TOP + 28); c.lineTo(W, wallTop + 6); c.closePath(); c.fill();
    c.save(); c.beginPath(); c.moveTo(0, wallTop + 6); c.lineTo(W * 0.18, TOP + 28); c.lineTo(W * 0.82, TOP + 28); c.lineTo(W, wallTop + 6); c.closePath(); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1.2; for (let y = TOP + 28; y < wallTop + 8; y += 9) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, TOP + 28, W, 7); c.restore();
    c.strokeStyle = '#f8fafc'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, wallTop + 6); c.lineTo(W * 0.18, TOP + 28); c.lineTo(W * 0.82, TOP + 28); c.lineTo(W, wallTop + 6); c.stroke();
    rect(c, 0, wallTop + 4, W, 6, '#f8fafc');
    const dx = W / 2 - 46; doorDraw(c, dx, baseY - 10 - 100, 92, 100, '#991b1b', { noKnob: true, frame: '#f8fafc' });
    c.strokeStyle = '#f8fafc'; c.lineWidth = 4; c.beginPath(); c.moveTo(dx, baseY - 110); c.lineTo(dx + 46, baseY - 10); c.moveTo(dx + 46, baseY - 110); c.lineTo(dx, baseY - 10); c.moveTo(dx + 46, baseY - 110); c.lineTo(dx + 92, baseY - 10); c.moveTo(dx + 92, baseY - 110); c.lineTo(dx + 46, baseY - 10); c.stroke();
    rr(c, W / 2 - 18, TOP + 36, 36, 34, 3, '#f8fafc'); rect(c, W / 2 - 14, TOP + 40, 28, 26, '#3b1d0d'); rect(c, W / 2 - 14, TOP + 52, 28, 3, '#f8fafc');
    for (let k = 0; k < 14; k++) c.fillStyle = '#eab308', c.fillRect(W / 2 - 12 + (k % 7) * 4, TOP + 58 + Math.floor(k / 7) * 4, 3, 3);
};

// ---------- REGISTRO ----------
export function buildBuildingSprite(spec) {
    const W = spec.w * TILE_SIZE, H = spec.h * TILE_SIZE;
    const TOP = spec.top ?? { church: 150, hall: 76, barn: 40, apartment: 40 }[spec.kind] ?? 36;
    const rnd = mulberry((spec.seed || 1) * 977);
    const meta = { windows: [], chimney: null, neon: null };
    const s = makeSprite(W, TOP + H, (c) => KINDS[spec.kind](c, spec, W, H, TOP, rnd, meta));
    s.ax = 0; s.ay = TOP + H; s.meta = meta; s.top = TOP; return s;
}

