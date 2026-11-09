// Trazado del mundo: calles, zonas, edificios, props y casillas sólidas.
// Es PURO (no usa canvas ni el DOM): Node lo ejecuta para exportar la grilla de colisiones al coordinator
// (client/scripts/export-map.mjs). Determinista: el mapa siempre sale igual.
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { hash2 } from "./draw-utils.js";
import { roofAC, roofVent, roofAntenna, roofSky } from "./buildings.js";
import { TILE_SIZE, MAP_COLS, MAP_ROWS } from "./constants.js";

// =====================================================================
//  MUNDO EXTERIOR — estructuras, calles y zonas  (80 × 60 tiles)
// =====================================================================
export const G = { GRASS: 0, LAWN: 1, ROAD: 2, SIDE: 3, PLAZA: 4, WATER: 5, SAND: 6, DIRT: 7, GRAVEL: 8, LOT: 9, CROPS: 10, DOCK: 11, FOREST: 12, ALLEY: 13 };
const N = MAP_COLS * MAP_ROWS;
export const ground = new Uint8Array(N);
export const solid = new Uint8Array(N);       // 1 = tile bloqueado
const reserved = new Uint8Array(N);    // 1 = no esparcir vegetación aleatoria
export const roadCount = new Uint8Array(N);
export const lines = { bot: new Uint8Array(N), right: new Uint8Array(N), midH: new Uint8Array(N), midV: new Uint8Array(N) };
export const zebra = new Uint8Array(N);       // 1 = franjas horizontales, 2 = verticales
export const cropKind = new Uint8Array(N);
export const idx = (c, r) => r * MAP_COLS + c;
export const inMap = (c, r) => c >= 0 && r >= 0 && c < MAP_COLS && r < MAP_ROWS;
export const gAt = (c, r) => inMap(c, r) ? ground[idx(c, r)] : G.FOREST;

export const worldObjs = [];        // objetos con ordenación en Y
export const groundDecals = [];     // {x0,y0,x1,y1,draw(c)}
export const buildingsList = [];    // para minimapa / luces
export const waterTiles = [];

function fillG(c0, r0, c1, r1, t) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inMap(c, r)) ground[idx(c, r)] = t; }
function reserve(c0, r0, c1, r1) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inMap(c, r)) reserved[idx(c, r)] = 1; }
function block(c0, r0, c1, r1) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inMap(c, r)) { solid[idx(c, r)] = 1; reserved[idx(c, r)] = 1; } }

function roadH(r0, rows, c0, c1) {
    for (let r = r0; r < r0 + rows; r++) for (let c = c0; c <= c1; c++) { ground[idx(c, r)] = G.ROAD; roadCount[idx(c, r)]++; reserved[idx(c, r)] = 1; }
    for (let c = c0; c <= c1; c++) {
        if (rows === 4) { lines.bot[idx(c, r0)] = 1; lines.bot[idx(c, r0 + 1)] = 2; lines.bot[idx(c, r0 + 2)] = 1; }
        else if (rows === 2) lines.bot[idx(c, r0)] = 3;
        else lines.midH[idx(c, r0 + 1)] = 1;
    }
}
function roadV(c0, cols, r0, r1) {
    for (let c = c0; c < c0 + cols; c++) for (let r = r0; r <= r1; r++) { ground[idx(c, r)] = G.ROAD; roadCount[idx(c, r)]++; reserved[idx(c, r)] = 1; }
    for (let r = r0; r <= r1; r++) {
        if (cols === 4) { lines.right[idx(c0, r)] = 1; lines.right[idx(c0 + 1, r)] = 2; lines.right[idx(c0 + 2, r)] = 1; }
        else if (cols === 2) lines.right[idx(c0, r)] = 3;
        else lines.midV[idx(c0 + 1, r)] = 1;
    }
}
function crossing(c0, r0, c1, r1, kind) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) zebra[idx(c, r)] = kind; }

// ---------- Trazado de calles ----------
function layRoads() {
    roadH(12, 2, 0, 79);   // Calle Norte
    roadH(27, 4, 0, 79);   // Avenida Central (4 carriles)
    roadH(43, 2, 0, 79);   // Calle Sur
    roadV(24, 2, 0, 59);   // Calle del Parque
    roadV(50, 3, 0, 59);   // Boulevard
    roadV(70, 2, 31, 59);  // Calle Este
    // la intersección no lleva marcas viales
    for (let i = 0; i < N; i++) if (roadCount[i] > 1) { lines.bot[i] = 0; lines.right[i] = 0; lines.midH[i] = 0; lines.midV[i] = 0; }
    // pasos de cebra junto a las intersecciones
    const vRoads = [[24, 25, 0], [50, 52, 0], [70, 71, 31]];
    const hRoads = [[12, 13], [27, 30], [43, 44]];
    vRoads.forEach(([a, b, rmin]) => {
        hRoads.forEach(([r0, r1]) => {
            if (r0 < rmin) return;
            crossing(a - 1, r0, a - 1, r1, 1); crossing(b + 1, r0, b + 1, r1, 1);   // cruzan la calle horizontal
            crossing(a, r0 - 1, b, r0 - 1, 2); crossing(a, r1 + 1, b, r1 + 1, 2);   // cruzan la calle vertical
        });
    });
    // acera alrededor de cada calle
    const sw = [];
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
        if (ground[idx(c, r)] === G.ROAD) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => inMap(c + dc, r + dr) && ground[idx(c + dc, r + dr)] === G.ROAD);
        if (near) sw.push(idx(c, r));
    }
    sw.forEach(i => { ground[i] = G.SIDE; reserved[i] = 1; });
}

// Los pasos de cebra no deben pisar la acera: se corrige quitando los que no están sobre calzada
function cleanZebra() { for (let i = 0; i < N; i++) if (zebra[i] && ground[i] !== G.ROAD) zebra[i] = 0; }

// ---------- Zonas: parque, plaza, lagos, aparcamiento, huerto ----------
function layZones() {
    // forest ring (los bordes que no son calzada)
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
        if (c < 2 || r < 2 || c >= MAP_COLS - 2 || r >= MAP_ROWS - 2) { if (ground[idx(c, r)] !== G.ROAD && ground[idx(c, r)] !== G.SIDE) ground[idx(c, r)] = G.FOREST; }
    }
    // PARQUE CENTRAL
    fillG(27, 2, 48, 10, G.LAWN);
    fillG(35, 2, 36, 10, G.GRAVEL); fillG(27, 8, 48, 8, G.GRAVEL); fillG(30, 7, 30, 7, G.GRAVEL);
    // estanque (elipse)
    for (let r = 2; r <= 8; r++) for (let c = 38; c <= 47; c++) {
        const dx = (c - 42.5) / 4.6, dy = (r - 5.0) / 2.5;
        if (dx * dx + dy * dy < 1) { ground[idx(c, r)] = G.WATER; solid[idx(c, r)] = 1; waterTiles.push([c, r]); }
    }
    // arena alrededor del agua (solo sobre césped)
    for (let r = 1; r <= 9; r++) for (let c = 36; c <= 49; c++) {
        const g0 = ground[idx(c, r)]; if (g0 !== G.LAWN && g0 !== G.GRASS) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([a, b]) => gAt(c + a, r + b) === G.WATER)) ground[idx(c, r)] = G.SAND;
    }
    // PLAZA MAYOR
    fillG(27, 15, 48, 25, G.PLAZA);
    // PLAYGROUND
    fillG(28, 33, 35, 40, G.SAND);
    // APARCAMIENTO supermercado
    fillG(16, 36, 22, 41, G.LOT);
    fillG(3, 32, 22, 35, G.GRASS);
    // CALLEJONES
    fillG(2, 19, 22, 20, G.ALLEY); fillG(54, 19, 77, 20, G.ALLEY);
    // CAMINO VERDE (sur-oeste)
    fillG(2, 52, 22, 53, G.DIRT);
    // LAGO SUR
    for (let r = 48; r <= 56; r++) for (let c = 27; c <= 48; c++) {
        const dx = (c - 37.5) / 10.8, dy = (r - 52.5) / 4.4;
        if (dx * dx + dy * dy < 1) { ground[idx(c, r)] = G.WATER; solid[idx(c, r)] = 1; waterTiles.push([c, r]); }
    }
    for (let r = 46; r <= 57; r++) for (let c = 26; c <= 49; c++) {
        if (ground[idx(c, r)] === G.WATER) continue;
        if ((ground[idx(c, r)] === G.GRASS || ground[idx(c, r)] === G.LAWN) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([a, b]) => gAt(c + a, r + b) === G.WATER)) ground[idx(c, r)] = G.SAND;
    }
    // muelle (pasarela)
    fillG(37, 48, 38, 52, G.DOCK); [37, 38].forEach(c => { for (let r = 48; r <= 52; r++) solid[idx(c, r)] = 0; });
    // HUERTO
    fillG(54, 53, 68, 56, G.CROPS);
    for (let r = 53; r <= 56; r++) for (let c = 54; c <= 68; c++) cropKind[idx(c, r)] = (Math.floor((c - 54) / 3) + r) % 4;
    reserve(54, 53, 68, 56);
    // patio de tierra frente al granero
    fillG(54, 52, 68, 52, G.DIRT);
    // huerto/jardín del este
    fillG(73, 47, 77, 56, G.LAWN);
    reserve(2, 52, 22, 53); reserve(27, 2, 48, 10); reserve(27, 15, 48, 25); reserve(28, 33, 35, 40); reserve(16, 36, 22, 41);
    reserve(26, 46, 49, 57);
}

// =====================================================================
//  MUNDO EXTERIOR — edificios, props, vegetación y puertas
// =====================================================================
function put(name, x, y, o = {}) {
    const ob = Object.assign({ sprite: name, x, y, sortY: y, kind: 'prop', name }, o); worldObjs.push(ob); return ob;
}
function tilePut(name, c, r, o = {}) { return put(name, c * TILE_SIZE + TILE_SIZE / 2 + (o.dx || 0), (r + 1) * TILE_SIZE - (o.dy ?? 4), o); }
function tree(name, c, r, o = {}) {
    const j = hash2(c, r, 9); if (!o.nojitter) o = Object.assign({ dx: Math.round((j - 0.5) * 10) }, o);
    block(c, r, c, r); return tilePut(name, c, r, o);
}
function solidProp(name, c, r, cw, o = {}) { block(c, r, c + cw - 1, r); return put(name, (c + cw / 2) * TILE_SIZE, (r + 1) * TILE_SIZE - (o.dy ?? 4), o); }

function building(spec, c, r) {
    const x = c * TILE_SIZE, y = (r + spec.h) * TILE_SIZE;
    const ob = { x, y, sortY: y - 1, kind: 'building', spec, c, r, name: spec.name || spec.kind };
    worldObjs.push(ob); buildingsList.push(ob);
    block(c, r, c + spec.w - 1, r + spec.h - 1);
    const doorW = spec.doorW || 1;
    const defBay = (spec.kind === 'house') ? Math.floor((spec.w - 1) / 2) : Math.floor((spec.w - doorW) / 2);
    const bay = spec.doorBay ?? defBay;
    const cols = []; for (let k = 0; k < doorW; k++) cols.push(c + bay + k);
    ob.doorCols = cols; ob.doorRow = r + spec.h - 1;
    // camino desde la puerta hasta la acera
    let rr_ = r + spec.h;
    while (rr_ < MAP_ROWS && (gAt(cols[0], rr_) === G.GRASS || gAt(cols[0], rr_) === G.LAWN)) { cols.forEach(cc => ground[idx(cc, rr_)] = G.GRAVEL); rr_++; }
    reserve(c - 1, r, c + spec.w, r + spec.h + 1);
    return ob;
}

const HOUSES = [
    { wall: '#f5e6c8', roof: '#b91c1c', trim: '#ffffff', door: '#7c2d12', shutters: '#166534', flowerbox: true, chimney: true, dormer: true },
    { wall: '#bfdbfe', roof: '#1e3a8a', trim: '#f8fafc', door: '#be123c', shutters: '#1e3a8a', chimney: true, chimneyAt: 0.2 },
    { wall: '#fde68a', roof: '#9a3412', trim: '#fff7ed', door: '#166534', flowerbox: true, vines: true, dormer: true },
    { wall: '#fbcfe8', roof: '#6d28d9', trim: '#ffffff', door: '#0e7490', shutters: '#be185d', chimney: true, flowerbox: true },
    { wall: '#e7d9b0', roof: '#3f3a36', trim: '#fafaf9', door: '#3b2a1a', tudor: true, chimney: true, chimneyAt: 0.15 },
    { wall: '#bbf7d0', roof: '#15803d', trim: '#ffffff', door: '#78350f', shutters: '#065f46', dormer: true, flowerbox: true },
    { wall: '#fed7aa', roof: '#0f766e', trim: '#fffbeb', door: '#7f1d1d', chimney: true, vines: true },
    { wall: '#a8553a', roof: '#1c1917', trim: '#fafaf9', door: '#1e3a8a', wallStyle: 'brick', chimney: true, shutters: '#292524' },
    { wall: '#e9d5ff', roof: '#a21caf', trim: '#fff', door: '#134e4a', flowerbox: true, dormer: true, shutters: '#6b21a8' },
    { wall: '#d9f99d', roof: '#92400e', trim: '#fefce8', door: '#9f1239', chimney: true, flowerbox: true }
];
let houseN = 0;
function house(c, bottomRow, w = 4, h = 4) {
    const st = HOUSES[houseN % HOUSES.length]; houseN++;
    return building(Object.assign({ kind: 'house', w, h, seed: houseN + 3, number: 10 + houseN * 2 }, st), c, bottomRow - h + 1);
}

function frontYard(c, doorCol, row) {
    // jardín delantero: flores, arbustos y buzón (la casilla de la puerta queda libre)
    const set = [[c, 'flowers' + (houseN % 4)], [c + 2, 'flowers' + ((houseN + 1) % 4)], [c + 3, 'bush' + (houseN % 2)]];
    set.forEach(([cc, nm]) => { if (cc !== doorCol && gAt(cc, row) !== G.SIDE) { block(cc, row, cc, row); tilePut(nm, cc, row); } });
}

export function buildWorld() {
    layRoads(); cleanZebra(); layZones();

    // ---------- Barreras de cuarentena en los extremos de las calles ----------
    const barrier = (c, r) => { block(c, r, c, r); tilePut('barrier', c, r, { dy: 2 }); };
    [[12, 2], [27, 4], [43, 2]].forEach(([r0, n]) => { for (let k = 0; k < n; k++) { barrier(2, r0 + k); barrier(77, r0 + k); } });
    [[24, 2], [50, 3]].forEach(([c0, n]) => { for (let k = 0; k < n; k++) { barrier(c0 + k, 2); barrier(c0 + k, 57); } });
    barrier(70, 57); barrier(71, 57);
    // fuera de la ciudad todo es sólido
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) if (c < 2 || r < 2 || c >= MAP_COLS - 2 || r >= MAP_ROWS - 2) solid[idx(c, r)] = 1;

    // ---------- Edificios: bloque NO (casas + jardines) ----------
    [3, 8, 13, 18].forEach(c => { const b = house(c, 9); frontYard(c, b.doorCols[0], 10); });
    // ---------- Bloque NE: apartamentos, casa, iglesia ----------
    building({ kind: 'apartment', w: 7, h: 7, wall: '#a8553a', name: 'RESIDENCIAL ARCOÍRIS', seed: 4 }, 55, 4);
    { const b = house(63, 9); frontYard(63, b.doorCols[0], 10); }
    building({ kind: 'church', w: 8, h: 7, wall: '#d6d3d1', seed: 2, name: 'Iglesia' }, 69, 4);
    

    // ---------- Banda oeste: casas / callejón / comercios ----------
    [3, 8, 13, 18].forEach(c => house(c, 18));
    building({ kind: 'shop', w: 6, h: 5, wall: '#fde68a', sign: { text: 'PANADERÍA', bg: '#7c2d12', fg: '#fde68a' }, awning: ['#f97316', '#fff7ed'], display: 'bread', seed: 5 }, 3, 21);
    building({ kind: 'shop', w: 5, h: 5, wall: '#e0f2fe', sign: { text: 'FARMACIA', bg: '#15803d', fg: '#ffffff' }, awning: ['#16a34a', '#f0fdf4'], display: 'pharma', seed: 6, openText: 'ABIERTO' }, 9, 21);
    building({ kind: 'shop', w: 5, h: 5, wall: '#4c1d95', sign: { text: 'DISCOS 80', bg: '#be185d', fg: '#67e8f9' }, neon: true, awning: ['#7c3aed', '#ede9fe'], display: 'music', glassBack: '#2e1065', trim: '#e9d5ff', seed: 7, roofTop: '#475569' }, 14, 21);
    building({ kind: 'shop', w: 4, h: 5, wall: '#1e1b4b', sign: { text: 'ARCADE', bg: '#0f172a', fg: '#4ade80' }, neon: true, awning: ['#0ea5e9', '#e0f2fe'], display: 'arcade', glassBack: '#1e1b4b', trim: '#c7d2fe', seed: 8 }, 19, 21);

    // ---------- Banda este ----------
    [55, 61, 67, 73].forEach(c => house(c, 18));
    building({ kind: 'shop', w: 9, h: 5, wall: '#fef3c7', stripe: '#dc2626', sign: { text: 'BURGER NEÓN', bg: '#be123c', fg: '#fef08a' }, neon: true, awning: ['#dc2626', '#ffffff'], display: 'cafe', doorW: 2, rooftop: 'burger', openText: 'ABIERTO', seed: 9, name: 'Burger Neón', roofItems: [roofAC(20), roofVent(300)] }, 54, 21);
    building({ kind: 'shop', w: 7, h: 5, wall: '#7f1d1d', sign: { text: 'CINE RIALTO', bg: '#0f172a', fg: '#fde047', bulbs: true }, awning: ['#facc15', '#7f1d1d'], display: 'posters', glassBack: '#1e1b4b', openText: 'CINE', seed: 10, roofTop: '#44403c' }, 63, 21);
    building({ kind: 'shop', w: 4, h: 5, wall: '#fbcfe8', sign: { text: 'PELUQUERÍA', bg: '#be185d', fg: '#ffffff', size: 14 }, awning: ['#ec4899', '#fdf2f8'], display: 'barber', seed: 11 }, 70, 21);
    building({ kind: 'shop', w: 4, h: 5, wall: '#bbf7d0', sign: { text: 'FLORES', bg: '#15803d', fg: '#fde047' }, awning: ['#22c55e', '#fefce8'], display: 'flowers', seed: 12 }, 74, 21);

    // ---------- Plaza Mayor ----------
    building({ kind: 'hall', w: 10, h: 5, wall: '#e7e5e4', seed: 3, name: 'Ayuntamiento', doorW: 2 }, 33, 15);
    
    put('fountain', 37.5 * 48, 25 * 48 - 6, { name: 'fountain', fx: 'fountain' }); block(36, 22, 38, 24);
    
    solidProp('stall0', 28, 22, 2); solidProp('stall2', 30, 22, 2); solidProp('stall1', 44, 22, 2); solidProp('stall3', 46, 22, 2);
    tilePut('statue', 41, 23, { dy: 2 }); block(41, 23, 41, 23); 
    solidProp('bench', 32, 24, 2); solidProp('bench', 42, 24, 2);
    [35, 41].forEach(c => { block(c, 20, c, 20); tilePut('planter', c, 20); });
    [[28, 16], [47, 16], [28, 25], [47, 25], [33, 21], [42, 21], [31, 24], [44, 24]].forEach(([c, r]) => { block(c, r, c, r); tilePut('lamp', c, r, { name: 'lamp', light: true }); });
    tree('cherry', 28, 18); tree('cherry', 47, 18); tree('oak2', 29, 24, {}); tree('oak0', 46, 24);
    tilePut('phonebooth', 31, 25, { dy: 2 }); block(31, 25, 31, 25); 
    solidProp('busstop', 44, 25, 3, { dy: 2 });
    tilePut('postsign', 34, 25, { dy: 2 }); block(34, 25, 34, 25);
    tilePut('postsign', 49, 11, { dy: 2 }); block(49, 11, 49, 11); 
    groundDecals.push({ x0: 36 * 48, y0: 21 * 48, x1: 40 * 48, y1: 26 * 48, draw: drawPlazaRosette });

    // ---------- Parque Central ----------
    put('gazebo', 30.5 * 48, 7 * 48 - 4, { name: 'gazebo' }); block(29, 4, 31, 6); 
    solidProp('bench', 33, 7, 2); solidProp('bench', 37, 7, 2, {}); solidProp('bench', 40, 9, 2); solidProp('bench', 45, 9, 2); solidProp('bench', 28, 9, 2);
    [[34, 3], [37, 3], [34, 9], [37, 9], [34, 6], [37, 6], [47, 9], [27, 9]].forEach(([c, r]) => { if (!solid[idx(c, r)] && gAt(c, r) !== G.WATER) { block(c, r, c, r); tilePut('lamp', c, r, { name: 'lamp', light: true }); } });
    tree('cherry', 28, 4); tree('cherry', 28, 6); tree('cherry', 33, 4); tree('oak0', 33, 6, {}); tree('oak1', 28, 3); tree('birch', 32, 9); tree('oak2', 48, 3); tree('birch', 48, 6); tree('oak0', 40, 2); tree('cherry', 44, 2); tree('birch', 46, 9);
    solidProp('picnic', 44, 10, 2); solidProp('picnic', 28, 10, 2);
    for (let c = 27; c <= 48; c++) { if (c >= 35 && c <= 36) continue; if (c % 2 === 0 || c > 40) { block(c, 10, c, 10); tilePut('hedge', c, 10, { dy: 2 }); } }
    tilePut('flowers1', 31, 9, { dy: 4 }); block(31, 9, 31, 9); tilePut('flowers0', 33, 9); block(33, 9, 33, 9);
    put('boat', 42 * 48, 6.3 * 48, { name: 'boat', sortY: 6.3 * 48 - 20 }); // barca en el estanque
    

    // ---------- Supermercado + aparcamiento ----------
    const mk = building({ kind: 'shop', w: 12, h: 6, wall: '#dcfce7', stripe: '#16a34a', sign: { text: 'SUPER MERCADO', bg: '#15803d', fg: '#fef08a' }, awning: ['#16a34a', '#f0fdf4'], display: 'bread', doorW: 2, openText: '24H', seed: 13, name: 'Supermercado', roofItems: [roofAC(30), roofAC(200), roofSky(300), roofVent(420), roofAntenna(520)] }, 3, 36);
    [[17, 38, 0], [19, 38, 1], [21, 38, 3], [17, 40, 4], [20, 40, 2], [21, 41, 5]].forEach(([c, r, v], k) => { if (k % 2 === 0 || k === 3) { block(c, r, c + 1, r); put('car' + v, (c + 1) * 48, (r + 1) * 48 - 2, { name: 'car' }); } });
    
    solidProp('crates', 5, 41, 1, { dy: 2 }); solidProp('crates', 6, 41, 1, { dy: 2 });
    solidProp('dumpster', 4, 34, 2, {}); solidProp('crates', 8, 34, 1, {});
    tree('pine', 12, 33); tree('pine', 14, 33); tree('oak1', 10, 32); tree('oak0', 20, 33); tree('pine', 3, 32);

    // ---------- Parque infantil ----------
    for (let c = 27; c <= 36; c++) { if (c >= 31 && c <= 32) continue; block(c, 32, c, 32); tilePut('hedge', c, 32, { dy: 2 }); block(c, 41, c, 41); tilePut('hedge', c, 41, { dy: 2 }); }
    for (let r = 33; r <= 40; r++) { block(27, r, 27, r); tilePut('hedge', 27, r, { dy: 2 }); block(36, r, 36, r); tilePut('hedge', 36, r, { dy: 2 }); }
    solidProp('swings', 29, 35, 3, {}); solidProp('slide', 33, 36, 2, {}); solidProp('sandbox', 29, 39, 2, {}); solidProp('seesaw', 33, 39, 2, {});
    solidProp('bench', 33, 34, 2, {}); tree('cherry', 34, 33); tilePut('lamp', 31, 33); block(31, 33, 31, 33);
    

    // ---------- Casas bloque sur-medio ----------
    [38, 44].forEach(c => { const b = house(c, 40); frontYard(c, b.doorCols[0], 41); });
    tree('pine', 38, 34); tree('oak2', 41, 35); tree('oak0', 46, 34); tree('pine', 48, 36); tree('birch', 37, 33); tree('oak1', 43, 33);

    // ---------- Clínica y casas este ----------
    building({ kind: 'shop', w: 8, h: 5, wall: '#f1f5f9', roofTop: '#94a3b8', sign: { text: 'CLÍNICA VIRUS CARE', bg: '#0e7490', fg: '#ffffff', pad: 30 }, cross: true, awning: ['#0ea5e9', '#ffffff'], display: 'pharma', doorW: 2, openText: '24H', seed: 14, name: 'Clínica' }, 55, 37);
    
    { const b = house(64, 40); frontYard(64, b.doorCols[0], 41); }
    { const b = house(74, 40); frontYard(74, b.doorCols[0], 41); }
    tree('oak0', 55, 33); tree('oak2', 58, 34); tree('pine', 62, 33); tree('birch', 66, 35); tree('oak1', 74, 34); tree('pine', 76, 36); tree('cherry', 68, 33);
    tree('oak1', 64, 33); tree('oak0', 60, 35);

    // ---------- Barrio sur-oeste ----------
    [4, 10, 16].forEach(c => { const b = house(c, 50); frontYard(c, b.doorCols[0], 51); });
    [3, 6, 9, 12, 15, 18, 21].forEach((c, k) => tree(k % 2 ? 'pine' : 'oak' + (k % 3), c, 46));
    [3, 8, 14, 20].forEach((c, k) => { tree(k % 2 ? 'oak0' : 'pine', c, 55); });
    tree('birch', 7, 56); tree('oak1', 12, 56); tree('pine', 17, 55); tree('oak2', 21, 56);

    // ---------- Lago sur ----------
    put('boat', 34 * 48, 52.4 * 48, { name: 'boat', sortY: 52.4 * 48 - 20 }); put('boat', 41.5 * 48, 54 * 48, { name: 'boat', sortY: 54 * 48 - 20 });
    [[29, 47], [33, 47], [41, 47], [46, 47]].forEach(([c, r]) => { block(c, r, c, r); tilePut('lamp', c, r, { name: 'lamp', light: true }); });
    solidProp('bench', 30, 47, 2); solidProp('bench', 43, 47, 2);
    tree('cherry', 27, 47); tree('cherry', 48, 47); tree('oak0', 26, 55); tree('oak2', 49, 55); tree('birch', 31, 57); tree('pine', 45, 57);
    

    // ---------- Granja ----------
    building({ kind: 'barn', w: 7, h: 5, seed: 3, name: 'Granero' }, 56, 47);
    solidProp('haystack', 64, 49, 2, {}); solidProp('haystack', 66, 50, 2, {}); put('scarecrow', 61.5 * 48, 55 * 48 - 6, { name: 'scarecrow' }); block(61, 54, 61, 54);
    tilePut('well', 54, 51, { dy: 4, name: 'well' }); block(54, 51, 54, 51); 
    
    // hileras de setos del huerto
    for (let c = 54; c <= 68; c++) if (c !== 61) { block(c, 57, c, 57); tilePut('hedge', c, 57, { dy: 2 }); }

    // ---------- Huerto este (árboles frutales) ----------
    [[74, 48], [76, 48], [74, 51], [76, 51], [74, 54], [76, 54]].forEach(([c, r], k) => tree(k % 2 ? 'cherry' : 'oak3', c, r));
    solidProp('crates', 75, 56, 1, { dy: 2 }); put('haystack', 75.5 * 48, 50 * 48, { name: 'haystack' });

    // ---------- Mobiliario urbano (aceras) ----------
    [[22, 26], [6, 31], [14, 31], [26, 11], [30, 14], [46, 31], [53, 20]].forEach(([c, r], k) => { if (!solid[idx(c, r)] && gAt(c, r) === G.SIDE) { block(c, r, c, r); tilePut(k % 2 ? 'hydrant' : 'trash', c, r, { dy: 2 }); } });
    [[6, 14], [16, 14], [30, 11], [56, 11], [66, 14], [76, 14], [8, 26], [18, 26], [61, 26], [68, 26], [10, 31], [40, 42], [62, 31], [20, 42], [66, 45]].forEach(([c, r]) => { if (!solid[idx(c, r)] && gAt(c, r) === G.SIDE) { block(c, r, c, r); tilePut('lamp', c, r, { name: 'lamp', light: true, dy: 2 }); } });
    // buzones en los jardines
    [[2, 10], [7, 10], [12, 10], [17, 10], [62, 10]].forEach(([c, r]) => { if (!solid[idx(c, r)] && gAt(c, r) !== G.SIDE) { block(c, r, c, r); tilePut('mailbox', c, r, { dx: 14 }); } });

    scatterVegetation();
    // el suelo del patio de cada casa que quedó como GRAVEL ya se pintó; recalcular reservados
}

// Árboles, arbustos y flores sueltos en las zonas verdes que quedaron libres
function scatterVegetation() {
    const kinds = ['oak0', 'oak1', 'oak2', 'pine', 'birch'];
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) {
        const i = idx(c, r), g0 = ground[i];
        if (reserved[i] || solid[i] || (g0 !== G.GRASS && g0 !== G.LAWN)) continue;
        // no pegar a edificios ni aceras
        let near = false;
        for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1; dc++) { const gg = gAt(c + dc, r + dr); if (solid[idx(Math.max(0, c + dc), Math.max(0, r + dr))] || gg === G.SIDE || gg === G.ROAD || gg === G.GRAVEL) { near = true; break; } }
        if (near) continue;
        const h = hash2(c, r, 77);
        if (h < 0.06) tree(kinds[Math.floor(hash2(c, r, 5) * kinds.length)], c, r);
        else if (h < 0.10) { block(c, r, c, r); tilePut('bush' + (Math.floor(hash2(c, r, 6) * 2)), c, r); }
        else if (h < 0.14) tilePut('flowers' + Math.floor(hash2(c, r, 8) * 4), c, r, { dy: 6 });
    }
    // bosque exterior: árboles muy densos en el borde
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
        if (!(c < 2 || r < 2 || c >= MAP_COLS - 2 || r >= MAP_ROWS - 2)) continue;
        const g0 = ground[idx(c, r)]; if (g0 === G.ROAD || g0 === G.SIDE) continue;
        const h = hash2(c, r, 3);
        put(h < 0.45 ? 'pine' : h < 0.7 ? 'oak' + Math.floor(hash2(c, r, 4) * 3) : 'birch', c * 48 + 24 + Math.round((hash2(c, r, 1) - 0.5) * 18), (r + 1) * 48 - 2 + Math.round((hash2(c, r, 2) - 0.5) * 10), { name: 'forest' });
    }
}

// Rosetón decorativo del suelo de la plaza
function drawPlazaRosette(c) {
    const cx = 37.5 * 48, cy = 23.5 * 48;
    [[110, '#b8a77a'], [96, '#d8c9a0'], [82, '#b8a77a']].forEach(([r, col]) => { c.strokeStyle = col; c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke(); });
    c.fillStyle = 'rgba(180,60,60,0.35)'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; c.beginPath(); c.arc(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96, 7, 0, 7); c.fill(); }
}

// ¿Se puede llegar andando a cada puerta desde el punto de inicio?
export function reachable(sc, sr) {
    const seen = new Uint8Array(N), q = [[sc, sr]]; seen[idx(sc, sr)] = 1;
    while (q.length) { const [c, r] = q.pop(); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => { const nc = c + a, nr = r + b; if (inMap(nc, nr) && !seen[idx(nc, nr)] && !solid[idx(nc, nr)]) { seen[idx(nc, nr)] = 1; q.push([nc, nr]); } }); }
    return seen;
}
