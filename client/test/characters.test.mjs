// Pruebas de las funciones puras de personajes, cámara, reloj y zonas (js/play/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTERS, CHARACTER_IDS, SKIN_TONES, defaultLook, resolveLook, lookToExtras, parseSavedLook } from "../public/js/play/characters/look.js";
import { computeView, nextAnim, clampZoom, ZOOM_MIN, ZOOM_MAX } from "../public/js/play/view.js";
import { gameMinutes, formatClock, ambientAt, isNight, DAY_MS } from "../public/js/play/map/clock.js";
import { areaName } from "../public/js/play/map/zones.js";

const HEX = /^#[0-9a-f]{6}$/;
const isValidLook = (l) => CHARACTER_IDS.includes(l.character) && [l.color, l.detail, l.skin].every((c) => HEX.test(c));

test("defaultLook: estable por userId, válido y variado entre jugadores", () => {
    assert.deepEqual(defaultLook("42"), defaultLook("42"));
    const looks = Array.from({ length: 30 }, (_, i) => defaultLook(String(i)));
    assert.ok(looks.every(isValidLook));
    assert.equal(new Set(looks.map((l) => l.character)).size, CHARACTER_IDS.length, "salen los tres personajes");
});

test("resolveLook: usa los extras válidos y reemplaza los inválidos (de otro cliente)", () => {
    const good = { userId: "7", extras: { character: "mensajero", color: "#FF5500", detail: "#facc15", skin: "#8d5b3c" } };
    assert.deepEqual(resolveLook(good), { character: "mensajero", color: "#ff5500", detail: "#facc15", skin: "#8d5b3c" });

    const base = defaultLook("7");
    for (const extras of [
        { character: "dragón", color: "rojo", detail: 5, skin: "<script>" },
        { character: "__proto__" },
        { character: "toString" },
        null,
        "texto",
        [1, 2],
    ]) {
        const look = resolveLook({ userId: "7", extras });
        assert.ok(isValidLook(look), JSON.stringify(extras));
        assert.equal(look.character, base.character, JSON.stringify(extras));
        assert.equal(look.color, base.color);
    }
    assert.ok(isValidLook(resolveLook(undefined)));
    // Solo el color válido (como antes del cambio): personaje por defecto con ese color
    assert.equal(resolveLook({ userId: "7", extras: { color: "#123456" } }).color, "#123456");
});

test("lookToExtras: solo los 4 campos conocidos y siempre dentro del límite de 1024 bytes", () => {
    const extras = lookToExtras({ character: "heroina", color: "#581C87", detail: "#d4b36c", skin: "#f7d5b8", extra: "x".repeat(5000) });
    assert.deepEqual(Object.keys(extras).sort(), ["character", "color", "detail", "skin"]);
    assert.equal(extras.color, "#581c87");
    assert.ok(JSON.stringify(extras).length < 200);
});

test("parseSavedLook: JSON guardado, color suelto del Taller 5 o nada", () => {
    const saved = JSON.stringify({ character: "heroina", color: "#be123c", detail: "#ec4899", skin: "#c68e5f" });
    assert.deepEqual(parseSavedLook(saved, null), { character: "heroina", color: "#be123c", detail: "#ec4899", skin: "#c68e5f" });
    assert.equal(parseSavedLook(null, "#ff5500").color, "#ff5500");
    assert.equal(parseSavedLook("{roto", null), null);
    assert.equal(parseSavedLook(JSON.stringify({ character: "otro" }), "rojo"), null);
    assert.equal(parseSavedLook(null, null), null);
});

test("paletas: 6 colores y 6 detalles por personaje, 5 tonos de piel, todos #rrggbb", () => {
    for (const id of CHARACTER_IDS) {
        assert.equal(CHARACTERS[id].colors.length, 6);
        assert.equal(CHARACTERS[id].details.length, 6);
        assert.ok([...CHARACTERS[id].colors, ...CHARACTERS[id].details].every((c) => HEX.test(c)), id);
    }
    assert.equal(SKIN_TONES.length, 5);
});

test("computeView: sigue al jugador, se detiene en los bordes y centra un mundo chico", () => {
    const world = { width: 3840, height: 2880 };
    assert.deepEqual(computeView({ x: 2000, y: 1500 }, 800, 600, world, 1), { x: 1600, y: 1200, w: 800, h: 600 });
    assert.deepEqual(computeView({ x: 10, y: 10 }, 800, 600, world, 1), { x: 0, y: 0, w: 800, h: 600 });
    assert.deepEqual(computeView({ x: 3830, y: 2870 }, 800, 600, world, 1), { x: 3040, y: 2280, w: 800, h: 600 });
    // Con zoom 2 se ve la mitad de unidades
    assert.deepEqual(computeView({ x: 2000, y: 1500 }, 800, 600, world, 2), { x: 1800, y: 1350, w: 400, h: 300 });
    // Mundo más chico que la vista: centrado (x e y negativos)
    const small = computeView({ x: 100, y: 100 }, 1600, 1000, { width: 1200, height: 800 }, 1);
    assert.deepEqual([small.x, small.y], [-200, -100]);
    // Sin jugador: el centro del mundo
    assert.deepEqual(computeView(null, 800, 600, world, 1), { x: 1520, y: 1140, w: 800, h: 600 });
});

test("clampZoom", () => {
    assert.equal(clampZoom(1), 1);
    assert.equal(clampZoom(99), ZOOM_MAX);
    assert.equal(clampZoom(0), ZOOM_MIN);
    assert.equal(clampZoom(NaN), 1);
});

test("nextAnim: dirección según el movimiento dominante y quieto por debajo del umbral", () => {
    let a = nextAnim(null, 100, 100, 0.016);
    assert.deepEqual([a.dir, a.moving], ["DOWN", false]);
    a = nextAnim(a, 104, 100, 0.016); // 250 u/s a la derecha
    assert.deepEqual([a.dir, a.moving], ["RIGHT", true]);
    assert.ok(a.walkTime > 0);
    a = nextAnim(a, 104, 96, 0.016);
    assert.equal(a.dir, "UP");
    a = nextAnim(a, 104.1, 96, 0.016); // 6 u/s: ruido del suavizado
    assert.deepEqual([a.dir, a.moving, a.walkTime], ["UP", false, 0], "quieto conserva la última dirección");
    a = nextAnim(a, 90, 96, 0.016);
    assert.equal(a.dir, "LEFT");
    assert.equal(nextAnim(a, 90, 120, 0.016).dir, "DOWN");
});

test("reloj del juego: mismo t del servidor → misma hora en todos los clientes", () => {
    assert.equal(gameMinutes(0), 0);
    assert.equal(gameMinutes(DAY_MS / 2), 720);
    assert.equal(gameMinutes(DAY_MS * 3 + DAY_MS / 4), 360);
    assert.equal(gameMinutes(-DAY_MS / 4), 1080, "t negativo no rompe");
    assert.equal(gameMinutes(NaN), 720);
    assert.equal(formatClock(510), "08:30");
    assert.equal(formatClock(1439.9), "23:59");
    assert.equal(ambientAt(12 * 60).a, 0, "mediodía sin oscuridad");
    assert.ok(ambientAt(2 * 60).a > 0.4, "madrugada oscura");
    assert.equal(isNight(23 * 60), true);
    assert.equal(isNight(10 * 60), false);
});

test("areaName: zonas conocidas del mapa", () => {
    const at = (c, r) => areaName(c * 48 + 24, r * 48 + 24);
    assert.equal(at(37, 22), "Plaza Mayor");
    assert.equal(at(30, 5), "Parque Central");
    assert.equal(at(10, 28), "Avenida Central");
    assert.equal(at(30, 52), "Lago Sur");
    assert.equal(at(60, 50), "Granja Los Brotes");
    assert.equal(at(0, 0), "Virus City");
});
