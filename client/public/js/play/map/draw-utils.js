// Utilidades de dibujo: azar determinista, colores, figuras y caché de sprites.
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

// Util: números pseudo-aleatorios deterministas (el mapa siempre sale igual)
export function hash2(x, y, s = 0) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function mulberry(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Util: color
export function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((f - r) * p + r); g = Math.round((f - g) * p + g); b = Math.round((f - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Util: rectángulo redondeado relleno / borde
export function rr(c, x, y, w, h, r, fill, stroke, lw) {
    c.beginPath(); c.roundRect(x, y, w, h, r);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
}
export function rect(c, x, y, w, h, fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
export function circle(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
export function ellipse(c, x, y, rx, ry, fill) { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }

// Sprite cache: dibuja una vez a un canvas fuera de pantalla (2x para nitidez con zoom)
export const SPR = 2;
export function makeSprite(w, h, drawFn) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * SPR); cv.height = Math.ceil(h * SPR);
    const c = cv.getContext('2d');
    c.scale(SPR, SPR);
    drawFn(c, w, h);
    cv._w = w; cv._h = h;
    return cv;
}
