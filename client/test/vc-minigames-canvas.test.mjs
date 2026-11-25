// Pruebas de la lógica pura de los minijuegos de las misiones jugables (canvas): gradilla de muestras, lámpara UV,
// panel de conexiones y dosificador, y las utilidades puras del motor común (canvas-kit.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, lerp, easeOutBack, easeOutCubic, shuffle, derange } from "../public/js/vc/minigames/canvas-kit.js";
import { createSamples, canPlace, placeTube, placedCount, isRackComplete, SAMPLE_COLORS } from "../public/js/vc/minigames/samples.js";
import { createGerms, applyUv, cleanFraction, isSterile, nextDirty, UV_RADIUS, UV_DOSE_MS, GERM_COUNT } from "../public/js/vc/minigames/uvlamp.js";
import { createPanel, canConnect, connect, linkCount, isPanelComplete, PLUGS } from "../public/js/vc/minigames/patchpanel.js";
import { createDosing, pour, levelInBand, overflowed, releaseResult, POUR_RATE, BAND_HEIGHT } from "../public/js/vc/minigames/dosing.js";
import { MINIGAMES } from "../public/js/vc/minigames/index.js";

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("motor: clamp, lerp, easing con extremos exactos; shuffle y derange son permutaciones", () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(lerp(10, 20, 0.25), 12.5);
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9);
    assert.ok(easeOutBack(0.7) > 1, "easeOutBack se pasa un poco antes de llegar (rebote)");
    for (let s = 1; s <= 50; s++) {
        const list = ["a", "b", "c", "d"];
        assert.deepEqual(shuffle(list, seeded(s)).sort(), list);
        const d = derange(list, seeded(s));
        assert.deepEqual([...d].sort(), list);
        assert.ok(d.every((v, i) => v !== list[i]), "ningún elemento queda en su sitio");
    }
});

test("muestras: la gradilla nunca empieza en el orden de la bandeja y es determinista con el mismo rng", () => {
    for (let s = 1; s <= 40; s++) {
        const st = createSamples(seeded(s));
        assert.deepEqual([...st.tray].sort(), SAMPLE_COLORS.map((c) => c.id).sort());
        assert.ok(st.slots.every((id, i) => id !== st.tray[i]));
        assert.deepEqual(createSamples(seeded(s)), st);
    }
});

test("muestras: solo el tubo del color del hueco, sin repetir tubo ni hueco; colocar es inmutable", () => {
    const st = { tray: ["rojo", "amarillo", "cian", "verde"], slots: ["verde", "rojo", "amarillo", "cian"], placed: {} };
    assert.equal(canPlace(st, 0, 1), true, "rojo → hueco rojo");
    assert.equal(canPlace(st, 0, 0), false, "rojo → hueco verde");
    assert.equal(canPlace(st, 9, 0), false);
    assert.equal(canPlace(st, 0, -1), false);
    const s1 = placeTube(st, 0, 1);
    assert.deepEqual(st.placed, {}, "el estado original no cambia");
    assert.equal(placedCount(s1), 1);
    assert.equal(placeTube(s1, 0, 1), s1, "el mismo tubo no se coloca dos veces");
    assert.equal(canPlace(s1, 0, 1), false);
    assert.equal(placeTube(s1, 1, 0), s1, "un error no cambia nada");
    const full = [[1, 2], [2, 3], [3, 0]].reduce((acc, [t, s]) => placeTube(acc, t, s), s1);
    assert.equal(isRackComplete(full), true);
    assert.equal(isRackComplete(s1), false);
});

test("lámpara UV: colonias separadas dentro de la mesa; la luz solo afecta a las que están bajo el haz", () => {
    for (let s = 1; s <= 20; s++) {
        const g = createGerms(seeded(s));
        assert.equal(g.length, GERM_COUNT);
        for (const a of g) for (const b of g) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 72);
        assert.ok(g.every((x) => x.health === 1 && x.x > 46 && x.x < 514 && x.y > 46 && x.y < 298));
    }
    const germs = [{ x: 100, y: 100, r: 15, health: 1 }, { x: 300, y: 100, r: 15, health: 1 }];
    const after = applyUv(germs, 110, 100, UV_RADIUS, 450);
    assert.equal(after[0].health, 0.5, "la mitad de la dosis");
    assert.equal(after[1], germs[1], "la lejana no cambia (misma referencia)");
    assert.equal(germs[0].health, 1, "inmutable");
    let cur = germs;
    for (let t = 0; t < UV_DOSE_MS; t += 16) cur = applyUv(cur, 100, 100, UV_RADIUS, 16);
    assert.equal(cur[0].health, 0);
    assert.equal(applyUv(cur, 100, 100, UV_RADIUS, 16)[0].health, 0, "no baja de 0");
    assert.equal(cleanFraction(cur), 0.5);
    assert.equal(isSterile(cur), false);
    assert.deepEqual(nextDirty(cur, 0, 0), germs[1]);
    assert.equal(isSterile(applyUv(cur, 300, 100, UV_RADIUS, UV_DOSE_MS)), true);
    assert.equal(nextDirty([{ x: 1, y: 1, r: 1, health: 0 }], 0, 0), null);
});

test("panel de conexiones: enchufes desordenados; solo el mismo símbolo; cada cable y enchufe una vez", () => {
    for (let s = 1; s <= 30; s++) {
        const p = createPanel(seeded(s));
        assert.deepEqual([...p.left].sort(), PLUGS.map((x) => x.id).sort());
        assert.ok(p.right.every((id, i) => id !== p.left[i]));
    }
    const st = { left: ["triangulo", "circulo", "cuadrado", "rombo"], right: ["rombo", "triangulo", "circulo", "cuadrado"], links: {} };
    assert.equal(canConnect(st, 0, 1), true);
    assert.equal(canConnect(st, 0, 0), false);
    const s1 = connect(st, 0, 1);
    assert.equal(linkCount(s1), 1);
    assert.equal(connect(s1, 0, 1), s1);
    assert.equal(canConnect(s1, 1, 1), false, "enchufe ocupado");
    const full = [[1, 2], [2, 3], [3, 0]].reduce((acc, [l, r]) => connect(acc, l, r), s1);
    assert.equal(isPanelComplete(full), true);
    assert.deepEqual(st.links, {}, "inmutable");
});

test("dosificador: franja entre 50 % y 90 %, verter acotado y resultado al soltar", () => {
    for (let s = 1; s <= 30; s++) {
        const d = createDosing(seeded(s));
        assert.ok(d.band[0] >= 0.5 && d.band[1] <= 0.9 + 1e-9);
        assert.ok(Math.abs(d.band[1] - d.band[0] - BAND_HEIGHT) < 1e-9);
        assert.equal(d.level, 0);
    }
    assert.ok(Math.abs(pour(0, 1000) - POUR_RATE) < 1e-9);
    assert.equal(pour(0.99, 1000), 1, "no pasa de lleno");
    const band = [0.6, 0.7];
    assert.equal(releaseResult(0.65, band), "ok");
    assert.equal(releaseResult(0.6, band), "ok", "los bordes cuentan");
    assert.equal(releaseResult(0.55, band), "short");
    assert.equal(releaseResult(0.75, band), "over");
    assert.equal(levelInBand(0.7, band), true);
    assert.equal(overflowed(0.7001, band), true);
    // tarda de 2 a 4 s en llegar a la franja si se vierte sin parar
    const toBand = (band[0] / POUR_RATE) * 1000;
    assert.ok(toBand > 2000 && toBand < 4000);
});

test("registro: los 4 minijuegos de canvas están en el modal con nombre en español", () => {
    for (const [kind, name] of [["samples", "Muestras"], ["uvlamp", "Lámpara UV"], ["patchpanel", "Conexiones"], ["dosing", "Dosificador"]]) {
        assert.equal(MINIGAMES[kind]?.name, name);
        assert.equal(MINIGAMES[kind].canvas, true);
        assert.equal(typeof MINIGAMES[kind].module.mount, "function");
    }
});
