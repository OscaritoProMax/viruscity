// Pruebas de la lógica pura de los minijuegos de Viruscity (js/vc/minigames/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSequence, randomSequence, SYMBOLS, SEQUENCE_LENGTH, STEP_MS } from "../public/js/vc/minigames/sequence.js";
import { normalizeCode, isCodeCorrect, randomCode, CODE_ALPHABET, CODE_LENGTH } from "../public/js/vc/minigames/code.js";
import { isWiresComplete, isCorrectPair, shuffledConnectors, WIRES } from "../public/js/vc/minigames/wires.js";
import { isInGreenZone, markerPosition, randomGreenStart, GREEN_WIDTH } from "../public/js/vc/minigames/slider.js";
import { holdProgress, HOLD_MS } from "../public/js/vc/minigames/hold.js";
import { MINIGAMES } from "../public/js/vc/minigames/index.js";

// Generador determinista (mulberry32) para las partes al azar
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

test("los 5 tipos del servidor tienen minijuego con nombre en español", () => {
    assert.deepEqual(Object.keys(MINIGAMES).sort(), ["code", "hold", "sequence", "slider", "wires"]);
    assert.deepEqual(Object.values(MINIGAMES).map((m) => m.name), ["Secuencia", "Código", "Cables", "Calibración", "Mantener"]);
    for (const { module } of Object.values(MINIGAMES)) assert.equal(typeof module.mount, "function");
});

test("checkSequence: progreso, completa, error y bordes", () => {
    const seq = [0, 3, 3, 1, 2];
    assert.equal(checkSequence(seq, []), "progress", "aún no responde");
    assert.equal(checkSequence(seq, [0]), "progress");
    assert.equal(checkSequence(seq, [0, 3, 3, 1]), "progress");
    assert.equal(checkSequence(seq, [0, 3, 3, 1, 2]), "complete");
    assert.equal(checkSequence(seq, [1]), "error", "falla al primero");
    assert.equal(checkSequence(seq, [0, 3, 3, 1, 3]), "error", "falla al último");
    assert.equal(checkSequence(seq, [0, 3, 3, 1, 2, 0]), "error", "de más");
    assert.equal(checkSequence([], []), "error");
    assert.equal(checkSequence(null, [0]), "error");
    assert.equal(checkSequence(seq, "0"), "error");
    // Secuencias al azar: 5 símbolos válidos de los 4, cada 600 ms
    const r = randomSequence(seeded(1));
    assert.equal(r.length, SEQUENCE_LENGTH);
    assert.ok(r.every((i) => Number.isInteger(i) && i >= 0 && i < SYMBOLS.length));
    assert.deepEqual(SYMBOLS.map((s) => s.char), ["▲", "●", "■", "◆"]);
    assert.equal(STEP_MS, 600);
});

test("normalizeCode y isCodeCorrect: sin distinguir mayúsculas ni espacios", () => {
    assert.equal(normalizeCode(" ab3 kz9 "), "AB3KZ9");
    assert.equal(normalizeCode("Ab3Kz9"), "AB3KZ9");
    assert.equal(normalizeCode(""), "");
    assert.equal(normalizeCode(null), "");
    assert.equal(normalizeCode(undefined), "");
    assert.equal(isCodeCorrect("AB3KZ9", "ab3kz9"), true);
    assert.equal(isCodeCorrect("AB3KZ9", "AB3 KZ9"), true);
    assert.equal(isCodeCorrect("AB3KZ9", "AB3KZ8"), false);
    assert.equal(isCodeCorrect("AB3KZ9", "AB3KZ"), false, "le falta uno");
    assert.equal(isCodeCorrect("", ""), false, "un código vacío nunca vale");
});

test("randomCode: 6 caracteres del alfabeto sin 0/O/1/I", () => {
    for (const ch of ["0", "O", "1", "I"]) assert.equal(CODE_ALPHABET.includes(ch), false, ch);
    const rng = seeded(7);
    for (let i = 0; i < 200; i++) {
        const c = randomCode(rng);
        assert.equal(c.length, CODE_LENGTH);
        assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/);
    }
});

test("isWiresComplete: los 4 pares correctos; incompleto, repetido o equivocado no", () => {
    const all = WIRES.map((w) => [w.id, w.id]);
    assert.equal(isWiresComplete(all), true);
    assert.equal(isWiresComplete([...all].reverse()), true, "el orden no importa");
    assert.equal(isWiresComplete(all.slice(0, 3)), false, "faltan cables");
    assert.equal(isWiresComplete([]), false);
    assert.equal(isWiresComplete([...all.slice(0, 3), ["rojo", "rojo"]]), false, "un cable repetido");
    assert.equal(isWiresComplete([["rojo", "verde"], ["verde", "rojo"], ["cian", "cian"], ["amarillo", "amarillo"]]), false, "pares cruzados");
    assert.equal(isWiresComplete(null), false);
    assert.equal(isWiresComplete([...all, ["rojo", "rojo"]]), false, "de más");
    assert.equal(isCorrectPair("cian", "cian"), true);
    assert.equal(isCorrectPair("cian", "verde"), false);
    assert.equal(isCorrectPair(undefined, undefined), false);
});

test("shuffledConnectors: los mismos 4 colores y nunca en el orden de los cables", () => {
    const ids = WIRES.map((w) => w.id);
    for (let seed = 0; seed < 100; seed++) {
        const order = shuffledConnectors(seeded(seed));
        assert.deepEqual([...order].sort(), [...ids].sort());
        assert.notDeepEqual(order, ids, `semilla ${seed}`);
    }
    assert.notDeepEqual(shuffledConnectors(() => 0.999), ids, "aunque el azar dé siempre lo mismo");
});

test("isInGreenZone: dentro, bordes incluidos, fuera y datos inválidos", () => {
    assert.equal(isInGreenZone(0.5, 0.4, 0.2), true);
    assert.equal(isInGreenZone(0.4, 0.4, 0.2), true, "borde izquierdo");
    assert.equal(isInGreenZone(0.6, 0.4, 0.2), true, "borde derecho");
    assert.equal(isInGreenZone(0.3999, 0.4, 0.2), false);
    assert.equal(isInGreenZone(0.6001, 0.4, 0.2), false);
    assert.equal(isInGreenZone(0, 0, GREEN_WIDTH), true);
    assert.equal(isInGreenZone(1, 0.8, GREEN_WIDTH), true);
    assert.equal(isInGreenZone(NaN, 0.4, 0.2), false);
    assert.equal(isInGreenZone(0.5, 0.4, 0), false, "zona sin ancho");
    assert.equal(GREEN_WIDTH, 0.2);
    const rng = seeded(3);
    for (let i = 0; i < 200; i++) {
        const s = randomGreenStart(rng);
        assert.ok(s >= 0 && s + GREEN_WIDTH <= 1 + 1e-9, String(s));
    }
});

test("markerPosition: va y viene en ~1 s por pasada", () => {
    assert.equal(markerPosition(0), 0);
    assert.equal(markerPosition(500), 0.5);
    assert.equal(markerPosition(1000), 1, "llega al final");
    assert.equal(markerPosition(1500), 0.5, "vuelve");
    assert.equal(markerPosition(2000), 0, "de nuevo al inicio");
    assert.equal(markerPosition(2250), 0.25);
    assert.equal(markerPosition(-10), 0);
    assert.equal(markerPosition(NaN), 0);
});

test("holdProgress: sin pulsar, a medias, al soltar y a 100 %", () => {
    assert.equal(HOLD_MS, 10000);
    assert.equal(holdProgress(null, 5000), 0, "no está pulsado (soltó)");
    assert.equal(holdProgress(undefined, 5000), 0);
    assert.equal(holdProgress(1000, 1000), 0, "recién pulsado");
    assert.equal(holdProgress(1000, 6000), 0.5);
    assert.equal(holdProgress(1000, 10999), 0.9999);
    assert.equal(holdProgress(1000, 11000), 1, "justo 10 s");
    assert.equal(holdProgress(1000, 50000), 1, "nunca pasa de 1");
    assert.equal(holdProgress(5000, 1000), 0, "reloj hacia atrás");
    assert.equal(holdProgress(0, 2500, 5000), 0.5, "otra duración");
    assert.equal(holdProgress(0, 2500, 0), 0, "duración inválida");
});
