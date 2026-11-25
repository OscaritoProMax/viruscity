// Ambiente LOCAL: vecinos, perro y coches. Son decorado: no chocan con nadie,
// no viajan por la red y cada cliente ve los suyos (la posición de los jugadores es del servidor).
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { shade, rr, rect, circle, ellipse } from "./draw-utils.js";
import { SPRITES } from "./props.js";
import { TILE_SIZE } from "./constants.js";

// =====================================================================
//  PERSONAJES NO JUGABLES, PERRO Y COCHES
// =====================================================================
const PAL = {
    cashierPink: { skin: '#f1c9a5', hair: '#4a2c1a', hs: 'long', shirt: '#ec4899', acc: '#fff', pants: '#1e293b', shoes: '#111827', apron: '#fff', visor: '#be123c' },
    cashierBlue: { skin: '#e8b88f', hair: '#1c1b21', hs: 'short', shirt: '#2563eb', acc: '#fff', pants: '#1e293b', shoes: '#111827', visor: '#1d4ed8' },
    cashierGreen: { skin: '#d9a77a', hair: '#7c2d12', hs: 'bun', shirt: '#16a34a', acc: '#fef08a', pants: '#1e293b', shoes: '#111827', apron: '#bbf7d0' },
    cook: { skin: '#f1c9a5', hair: '#78350f', hs: 'short', shirt: '#f8fafc', acc: '#dc2626', pants: '#374151', shoes: '#111827', hat: '#f8fafc', apron: '#e5e7eb' },
    customerA: { skin: '#f7d5b8', hair: '#4a2f1d', hs: 'short', shirt: '#f97316', acc: '#fde047', pants: '#1d4ed8', shoes: '#f8fafc' },
    customerB: { skin: '#c68e5f', hair: '#1c1b21', hs: 'long', shirt: '#a855f7', acc: '#f0abfc', pants: '#0f172a', shoes: '#fb7185' },
    kid: { skin: '#f7d5b8', hair: '#d4b36c', hs: 'short', shirt: '#facc15', acc: '#ef4444', pants: '#2563eb', shoes: '#f8fafc', hat: '#ef4444', small: true },
    oldman: { skin: '#e8b88f', hair: '#e5e7eb', hs: 'bald', shirt: '#78350f', acc: '#d6d3d1', pants: '#44403c', shoes: '#292524' },
    granny: { skin: '#f1c9a5', hair: '#e5e7eb', hs: 'bun', shirt: '#f472b6', acc: '#fff', pants: '#7c3aed', shoes: '#44403c' },
    guard: { skin: '#b9835a', hair: '#111827', hs: 'cap', shirt: '#1e3a8a', acc: '#fde047', pants: '#111827', shoes: '#111827', hat: '#1e3a8a' },
    stocker: { skin: '#f1c9a5', hair: '#be123c', hs: 'long', shirt: '#0d9488', acc: '#fff', pants: '#1f2937', shoes: '#f8fafc', hat: '#0d9488' },
    jogger: { skin: '#d9a77a', hair: '#111827', hs: 'short', shirt: '#22d3ee', acc: '#f0abfc', pants: '#be185d', shoes: '#f8fafc', band: '#f0abfc' },
    farmer: { skin: '#e0b088', hair: '#92400e', hs: 'cap', shirt: '#dc2626', acc: '#fff', pants: '#1d4ed8', shoes: '#78350f', hat: '#ca8a04' }
};

function drawNPC(c, dir, moving, wt, p, sitting, ph = 0) {
    const t = Date.now() * 0.003 + ph;
    const bob = moving ? Math.abs(Math.sin(wt * 12)) * 3 : Math.sin(t) * 1.1;
    const leg = moving ? Math.sin(wt * 12) * 7 : 0, arm = moving ? Math.sin(wt * 12) * 6 : 0;
    const k = p.small ? 0.82 : 1;
    c.save();
    ellipse(c, 0, 22, 17 * k, 7 * k, 'rgba(0,0,0,0.3)');
    c.translate(0, 22); c.scale(k, k); c.translate(0, -22 - bob);
    if (dir === 'RIGHT') c.scale(-1, 1);
    const side = dir === 'LEFT' || dir === 'RIGHT', back = dir === 'UP', hy = -26;
    // piernas
    if (!sitting) {
        if (!side) { rr(c, -10, 6, 8, 11, 2, p.pants); rr(c, 2, 6, 8, 11, 2, p.pants); rr(c, -11, 14 + (leg > 0 ? leg * 0.3 : 0), 10, 8, 3, p.shoes); rr(c, 1, 14 + (leg < 0 ? -leg * 0.3 : 0), 10, 8, 3, p.shoes); }
        else { rr(c, -5 + leg, 6, 8, 11, 2, p.pants); rr(c, -4 - leg, 6, 8, 11, 2, shade(p.pants, -0.2)); rr(c, -8 + leg, 14, 11, 8, 3, p.shoes); rr(c, -7 - leg, 14, 11, 8, 3, shade(p.shoes, -0.2)); }
    } else { rr(c, -10, 8, 8, 8, 2, p.pants); rr(c, 2, 8, 8, 8, 2, p.pants); }
    // torso
    const tw = side ? 18 : 26;
    rr(c, -tw / 2, -8, tw, 18, 5, p.shirt); rect(c, -tw / 2 + 2, 6, tw - 4, 2, 'rgba(0,0,0,0.12)');
    if (p.apron && !back) { rr(c, -tw / 2 + 3, -4, tw - 6, 14, 3, p.apron); if (!side) { rect(c, -2, -4, 4, 3, p.shirt); } }
    if (p.band && !back && !side) rect(c, -tw / 2, -2, tw, 3, p.band);
    if (!side && !back) { c.fillStyle = p.acc; c.beginPath(); c.moveTo(-5, -8); c.lineTo(5, -8); c.lineTo(0, -1); c.fill(); }
    // brazos
    if (!side) { rr(c, -tw / 2 - 5, -6 + arm * 0.3, 6, 14, 3, p.shirt); rr(c, tw / 2 - 1, -6 - arm * 0.3, 6, 14, 3, p.shirt); circle(c, -tw / 2 - 2, 9 + arm * 0.3, 3, p.skin); circle(c, tw / 2 + 2, 9 - arm * 0.3, 3, p.skin); }
    else { rr(c, -3 + arm * 0.8, -6, 6, 14, 3, shade(p.shirt, -0.1)); circle(c, arm * 0.8, 9, 3, p.skin); }
    // cabeza
    const hw = side ? 38 : 44, hh = 34, hx = side ? -2 : 0;
    rr(c, hx - hw / 2, hy - hh / 2, hw, hh, 12, p.skin);
    const hairC = p.hair, x0 = hx - hw / 2;
    const hs = p.hs;
    if (back) { rr(c, x0 - 1, hy - hh / 2 - 1, hw + 2, hh - 6, 12, hairC); if (hs === 'long') rr(c, x0 + 2, hy - 2, hw - 4, 20, 8, hairC); if (hs === 'bun') circle(c, 0, hy - hh / 2 - 3, 8, hairC); }
    else {
        if (hs !== 'bald') { c.fillStyle = hairC; c.beginPath(); c.roundRect(x0 - 1, hy - hh / 2 - 2, hw + 2, 14, [12, 12, 3, 3]); c.fill(); }
        else { rr(c, x0 - 3, hy - 6, 6, 12, 3, hairC); rr(c, x0 + hw - 3, hy - 6, 6, 12, 3, hairC); }
        if (hs === 'long') { if (side) rr(c, x0 + hw * 0.45, hy - 8, 16, 26, 7, hairC); else { rr(c, x0 - 3, hy - 10, 9, 26, 5, hairC); rr(c, x0 + hw - 6, hy - 10, 9, 26, 5, hairC); } }
        if (hs === 'bun') circle(c, side ? 8 : 0, hy - hh / 2 - 4, 8, hairC);
        if (!side) { // cara frontal
            [-9, 9].forEach(ex => { circle(c, ex, hy + 3, 3.6, '#111827'); circle(c, ex + 1.2, hy + 1.8, 1.2, '#fff'); });
            circle(c, -14, hy + 10, 4, 'rgba(244,114,182,0.30)'); circle(c, 14, hy + 10, 4, 'rgba(244,114,182,0.30)');
            c.strokeStyle = '#7c2d12'; c.lineWidth = 1.4; c.beginPath(); c.arc(0, hy + 9, 3.2, 0.2, Math.PI - 0.2); c.stroke();
        } else {
            circle(c, hx - 9, hy + 3, 3.6, '#111827'); circle(c, hx - 8, hy + 1.8, 1.2, '#fff'); circle(c, hx - 13, hy + 10, 4, 'rgba(244,114,182,0.30)');
            circle(c, hx - hw / 2 - 1, hy + 5, 2.6, p.skin);
        }
    }
    if (p.hat || hs === 'cap') {
        const hc = p.hat || '#334155';
        if (p.hat === '#f8fafc') { rr(c, x0 + 2, hy - hh / 2 - 12, hw - 4, 16, 8, hc); rect(c, x0 + 2, hy - hh / 2 + 2, hw - 4, 4, shade(hc, -0.15)); }
        else { c.fillStyle = hc; c.beginPath(); c.roundRect(x0 - 1, hy - hh / 2 - 3, hw + 2, 13, [13, 13, 2, 2]); c.fill(); if (!back) { rr(c, side ? x0 - 10 : x0 + 4, hy - hh / 2 + 6, side ? 18 : hw - 8, 5, 2, shade(hc, -0.2)); } }
    }
    if (p.visor && !back) { rr(c, x0 + 3, hy - hh / 2 + 3, hw - 6, 5, 2, p.visor); }
    c.restore();
}

function drawDog(c, dir, moving, wt) {
    c.save(); ellipse(c, 0, 14, 17, 5, 'rgba(0,0,0,0.28)');
    if (dir === 'RIGHT') c.scale(-1, 1);
    const leg = moving ? Math.sin(wt * 16) * 4 : 0, tail = Math.sin(Date.now() * 0.02) * 0.5;
    [-9, -4, 8, 13].forEach((x, i) => rr(c, x - 2, 2 + (i % 2 ? leg : -leg) * 0.4, 5, 12, 2, '#a16207'));
    rr(c, -14, -8, 32, 16, 8, '#ca8a04'); rr(c, -6, -8, 14, 14, 6, '#f59e0b');
    c.save(); c.translate(17, -4); c.rotate(-0.7 + tail); rr(c, -1, -10, 5, 12, 2, '#a16207'); c.restore();
    rr(c, -24, -16, 18, 16, 6, '#ca8a04'); rr(c, -30, -8, 10, 8, 3, '#f59e0b'); circle(c, -29, -7, 2, '#111'); circle(c, -17, -11, 2, '#111'); rr(c, -14, -20, 6, 10, 3, '#92400e');
    rr(c, -22, -3, 12, 3, 1.5, '#dc2626'); c.restore();
}

export const worldNPCs = [];
function addWorldNPC(o) { const n = Object.assign({ dir: 'DOWN', mode: 'walk', pi: 0, wait: 0, wt: 0, moving: false, ph: Math.random() * 6, speed: 0.85 }, o); n.x *= TILE_SIZE; n.y *= TILE_SIZE; if (n.path) n.path = n.path.map(([a, b]) => [a * TILE_SIZE, b * TILE_SIZE]); worldNPCs.push(n); return n; }

export function buildWorldNPCs() {
    addWorldNPC({ name: 'Pipo', pal: 'kid', x: 35.5, y: 21.5, path: [[35.5, 21.5], [39.8, 21.5], [39.8, 25.2], [35.5, 25.2]], speed: 1.5, speaker: 'Niño travieso', lines: ['¡No me alcanzas! ¡Corre, corre!', 'Mamá dice que no corra cerca de la fuente... pero la fuente no dijo nada.'] });
    addWorldNPC({ name: 'Don Aurelio', pal: 'oldman', x: 29.5, y: 8.5, path: [[29.5, 8.5], [46.5, 8.5]], speed: 0.6, speaker: 'Don Aurelio', lines: ['Este parque antes era verde... digo, de otro verde.', 'Ahora las flores se abren de noche y miran hacia la ciudad.'] });
    addWorldNPC({ name: 'Rosa', pal: 'customerB', x: 28.5, y: 26.5, path: [[28.5, 26.5], [46.5, 26.5]], speed: 0.8, speaker: 'Rosa', lines: ['Voy al súper antes de que cierren. Siempre hay cola en la caja dos.', '¿Sabías que el Burger Neón tiene un jukebox de verdad? Las canciones no cambian desde 1986.'] });
    addWorldNPC({ name: 'Marcos', pal: 'jogger', x: 4.5, y: 11.5, path: [[4.5, 11.5], [22.5, 11.5]], speed: 2.0, speaker: 'Marcos (corredor)', lines: ['¡Entreno para el maratón de la cuarentena! Doy vueltas desde hace tres años.', 'Cada vez que llego a la barrera, la calle parece más corta.'] });
    addWorldNPC({ name: 'Tomás', pal: 'farmer', x: 56, y: 52.5, path: [[56, 52.5], [68, 52.5]], speed: 0.7, speaker: 'Tomás (granjero)', lines: ['Mis tomates crecen solos esta temporada. No sé si alegrarme.', 'El espantapájaros... hum, olvídalo.'] });
    addWorldNPC({ name: 'Doña Pura', pal: 'granny', x: 47.5, y: 11.5, path: [[40.5, 11.5], [47.5, 11.5]], speed: 0.55, speaker: 'Doña Pura', lines: ['Paseo con mi bastón todas las tardes. Aquí se respira tranquilidad.', 'Menos cuando suena la sirena. Pero a esa uno se acostumbra.'] });
    addWorldNPC({ name: 'Lector', pal: 'customerA', x: 33, y: 23.6, mode: 'sit', dir: 'DOWN', speaker: 'Lector', lines: ['Shh... estoy en el mejor capítulo del libro.', 'El título es "Cómo sobrevivir a todo". Sospechosamente corto.'] });
    addWorldNPC({ name: 'Luli', pal: 'kid', x: 31.5, y: 37.2, mode: 'bob', dir: 'DOWN', speaker: 'Luli', lines: ['¡Los columpios suben tan alto que casi toco las nubes!'] });
    const dog = addWorldNPC({ name: 'Pelusa', dog: true, x: 29, y: 38.5, path: [[29, 38.5], [35, 38.5]], speed: 1.1, speaker: 'Pelusa', lines: ['¡Guau! ¡Guau!', '(Mueve la cola con muchísima alegría)'] });
    return dog;
}

export function updateNPC(n, f, talkingTo) {
    n.moving = false;
    if (talkingTo === n) { n.wt = 0; return; }
    if (n.mode === 'walk' && n.path) {
        if (n.wait > 0) { n.wait -= f / 60; return; }
        const tg = n.path[n.pi], dx = tg[0] - n.x, dy = tg[1] - n.y, d = Math.hypot(dx, dy);
        if (d < 2) { n.pi = (n.pi + 1) % n.path.length; n.wait = 0.5 + Math.random() * 1.2; return; }
        const sp = Math.min(d, n.speed * f); n.x += dx / d * sp; n.y += dy / d * sp; n.moving = true; n.wt += f / 60 * (n.speed > 1.4 ? 1.4 : 1);
        n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'LEFT' : 'RIGHT') : (dy < 0 ? 'UP' : 'DOWN');
    }
}
export function drawNPCEntity(c, n) {
    c.save(); c.translate(n.x, n.y);
    if (n.dog) drawDog(c, n.dir, n.moving, n.wt); else drawNPC(c, n.dir, n.moving, n.wt, PAL[n.pal], n.mode === 'sit', n.ph);
    c.restore();
}
// pie del NPC (para ordenar en Y)
export const npcFoot = (n) => n.y + (n.dog ? 14 : 22);

// ---------- Coches en la Avenida Central y calles ----------
export const cars = [];
export function buildCars() {
    const lanes = [[28.0, -1, 0], [30.0, 1, 0], [12.5, -1, 0], [13.5, 1, 0], [43.5, -1, 0], [44.5, 1, 0]];
    const defs = [[0, 3, 0], [0, 18, 1], [1, 6, 2], [1, 26, 3], [1, 12, 4], [2, 10, 5], [3, 30, 1], [4, 40, 2], [5, 20, 0], [5, 52, 4], [0, 52, 3], [1, 40, 5]];
    defs.forEach(([li, col, v], i) => { const [ly, dirx] = lanes[li]; cars.push({ x: col * 48 + 24, y: ly * 48 + 14, dir: dirx, v, speed: 1.3 + (i % 4) * 0.35, base: 1.3 + (i % 4) * 0.35, lane: li, stopped: false }); });
}
export function updateCars(f, px, py) {
    cars.forEach(cr => {
        let sp = cr.base;
        // frena si hay alguien cruzando delante o un coche adelante
        const ahead = (ox, oy, dist, lat) => (ox - cr.x) * cr.dir > 0 && (ox - cr.x) * cr.dir < dist && Math.abs(oy - cr.y) < lat;
        if (ahead(px, py + 22, 130, 44)) sp = 0;
        cars.forEach(o => { if (o !== cr && o.lane === cr.lane && ahead(o.x, o.y, 140, 20)) sp = Math.min(sp, Math.max(0, o.speed * 0.8)); });
        cr.speed += (sp - cr.speed) * 0.08 * f; cr.x += cr.dir * cr.speed * f;
        if (cr.dir > 0 && cr.x > 77 * 48) cr.x = 3 * 48; if (cr.dir < 0 && cr.x < 3 * 48) cr.x = 77 * 48;
    });
}
export function drawCar(c, cr) {
    const sp = SPRITES['car' + cr.v]; c.save(); c.translate(cr.x, cr.y);
    if (cr.dir < 0) c.scale(-1, 1);
    c.drawImage(sp, -sp.ax, -sp.ay, sp._w, sp._h); c.restore();
}
