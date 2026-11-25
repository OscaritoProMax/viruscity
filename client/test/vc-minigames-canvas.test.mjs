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

// ---------- Fase M3: microscopio, doble hélice, etiquetado y transferencia ----------
import { createSample, nudgeFocus, isFocused, blurFor, cellAt, infectedIndex, FOCUS_TOLERANCE, CELL_COUNT } from "../public/js/vc/minigames/microscope.js";
import { complement, createStrand, currentHole, placeBase, isSequenced, BASES, GAP_COUNT, STRAND_LENGTH } from "../public/js/vc/minigames/helix.js";
import { createLine, vialX, vialAtMarker, stamp, labeledCount, isLineDone, VIAL_COUNT, SPACING, SPEED, MARKER_X, WINDOW } from "../public/js/vc/minigames/labeling.js";
import { createTransfer, stepTransfer, pressTransfer, isTransferred, TRANSFER_MS, RECONNECT_MS, PENALTY } from "../public/js/vc/minigames/transfer.js";

test("microscopio: empieza desenfocado; enfoque con tolerancia; una sola célula infectada y separadas", () => {
    for (let s = 1; s <= 30; s++) {
        const st = createSample(seeded(s));
        assert.equal(st.cells.length, CELL_COUNT);
        assert.equal(st.cells.filter((c) => c.infected).length, 1);
        assert.ok(!isFocused(st.focus, st.target), "no empieza enfocado");
        assert.ok(blurFor(st.focus, st.target) > 5, "empieza muy borroso");
        for (const a of st.cells) for (const b of st.cells) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 50);
        assert.equal(cellAt(st.cells, st.cells[infectedIndex(st.cells)].x, st.cells[infectedIndex(st.cells)].y), infectedIndex(st.cells));
    }
    assert.equal(nudgeFocus(0.99, 0.05), 1);
    assert.equal(nudgeFocus(0.01, -0.05), 0);
    assert.equal(isFocused(0.5 + FOCUS_TOLERANCE * 0.99, 0.5), true, "dentro de la tolerancia (sin depender del redondeo del borde)");
    assert.equal(isFocused(0.5 + FOCUS_TOLERANCE + 0.01, 0.5), false);
    assert.equal(blurFor(0.5, 0.5), 0);
    assert.equal(cellAt([{ x: 10, y: 10, r: 10 }], 200, 200), null);
});

test("doble hélice: complementos, huecos en orden y error sin cambios", () => {
    assert.deepEqual(BASES.map(complement), ["T", "A", "G", "C"]);
    assert.equal(complement("X"), null);
    for (let s = 1; s <= 30; s++) {
        const st = createStrand(seeded(s));
        assert.equal(st.top.length, STRAND_LENGTH);
        assert.equal(st.holes.length, GAP_COUNT);
        assert.deepEqual([...st.holes].sort((a, b) => a - b), st.holes, "huecos en orden");
        assert.equal(new Set(st.holes).size, GAP_COUNT);
    }
    const st = { top: ["A", "C", "G", "T"], holes: [1, 3], filled: [] };
    assert.equal(currentHole(st), 1);
    const bad = placeBase(st, "C");
    assert.equal(bad.ok, false);
    assert.equal(bad.state, st);
    const r1 = placeBase(st, "G");
    assert.equal(r1.ok, true);
    assert.equal(currentHole(r1.state), 3);
    const r2 = placeBase(r1.state, "A");
    assert.equal(isSequenced(r2.state), true);
    assert.equal(currentHole(r2.state), null);
    assert.equal(placeBase(r2.state, "A").ok, false, "no hay más huecos");
    assert.deepEqual(st.filled, [], "inmutable");
});

test("etiquetado: la cinta es un bucle, un vial a la vez bajo la marca y solo su color", () => {
    const loop = VIAL_COUNT * SPACING;
    assert.equal(vialX(0, 0), -40);
    assert.ok(Math.abs(vialX(0, loop / SPEED) - vialX(0, 0)) < 1e-6, "da la vuelta completa");
    // nunca hay dos viales a la vez bajo la marca (la separación es mayor que la ventana)
    assert.ok(SPACING > WINDOW * 2);
    let seen = 0;
    for (let t = 0; t < loop / SPEED; t += 20) {
        const i = vialAtMarker(t);
        if (i !== null) {
            seen++;
            assert.ok(Math.abs(vialX(i, t) - MARKER_X) <= WINDOW);
        }
    }
    assert.ok(seen > 0);
    const st = { colors: ["rojo", "verde", "rojo", "cian", "amarillo"], labeled: [false, false, false, false, false] };
    assert.equal(stamp(st, 1, "rojo").ok, false);
    assert.equal(stamp(st, null, "rojo").ok, false);
    const r = stamp(st, 0, "rojo");
    assert.equal(r.ok, true);
    assert.equal(stamp(r.state, 0, "rojo").ok, false, "no se etiqueta dos veces");
    assert.equal(labeledCount(r.state), 1);
    const all = st.colors.reduce((acc, c, i) => stamp(acc, i, c).state, st);
    assert.equal(isLineDone(all), true);
    for (let s = 1; s <= 10; s++) assert.equal(createLine(seeded(s)).colors.length, VIAL_COUNT);
});

test("transferencia: iniciar, dos caídas, reconectar a tiempo o perder datos, y terminar", () => {
    let s = createTransfer(seeded(3));
    assert.equal(s.phase, "idle");
    assert.equal(stepTransfer(s, 5000), s, "sin iniciar no avanza");
    s = pressTransfer(s);
    assert.equal(s.phase, "running");
    // avanza hasta la primera caída y se detiene ahí
    for (let i = 0; i < 400 && s.phase === "running"; i++) s = stepTransfer(s, 16);
    assert.equal(s.phase, "dropped");
    assert.equal(s.progress, s.drops[0]);
    const atDrop = s.progress;
    s = stepTransfer(s, 500);
    assert.equal(s.progress, atDrop, "sin señal no avanza");
    s = pressTransfer(s); // reconecta a tiempo
    assert.equal(s.phase, "running");
    for (let i = 0; i < 600 && s.phase === "running"; i++) s = stepTransfer(s, 16);
    assert.equal(s.phase, "dropped", "segunda caída");
    const second = s.progress;
    s = stepTransfer(s, RECONNECT_MS); // no reconecta: retrocede y sigue
    assert.equal(s.phase, "running");
    assert.ok(Math.abs(s.progress - Math.max(0, second - PENALTY)) < 1e-9);
    assert.equal(s.misses, 1);
    for (let i = 0; i < 2000 && s.phase !== "done"; i++) s = stepTransfer(s, 16);
    assert.equal(isTransferred(s), true);
    assert.equal(pressTransfer(s), s, "terminada no hace nada");
    // sin cortes tardaría TRANSFER_MS: entre 8 y 10 s
    assert.ok(TRANSFER_MS >= 8000 && TRANSFER_MS <= 10000);
});

test("registro M3: los 4 minijuegos nuevos están en el modal", () => {
    for (const [kind, name] of [["microscope", "Microscopio"], ["helix", "Doble hélice"], ["labeling", "Etiquetado"], ["transfer", "Transferencia"]]) {
        assert.equal(MINIGAMES[kind]?.name, name);
        assert.equal(MINIGAMES[kind].canvas, true);
    }
});
