// Pruebas de las utilidades puras del juego (js/play/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIntent } from "../public/js/play/intent.js";
import { isValidColor, colorFromId, playerColor, hashString } from "../public/js/play/colors.js";
import { computeFit } from "../public/js/play/fit.js";

const keys = (...codes) => new Set(codes);

test("computeIntent: sin teclas, una tecla, diagonal, opuestas y flechas = WASD", () => {
    assert.deepEqual(computeIntent(keys()), { x: 0, y: 0 });
    assert.deepEqual(computeIntent(keys("KeyD")), { x: 1, y: 0 });
    assert.deepEqual(computeIntent(keys("KeyA")), { x: -1, y: 0 });
    assert.deepEqual(computeIntent(keys("KeyW")), { x: 0, y: -1 });
    assert.deepEqual(computeIntent(keys("KeyS")), { x: 0, y: 1 });
    assert.deepEqual(computeIntent(keys("KeyW", "KeyD")), { x: 1, y: -1 });
    assert.deepEqual(computeIntent(keys("KeyA", "KeyD")), { x: 0, y: 0 });
    assert.deepEqual(computeIntent(keys("KeyW", "KeyS", "KeyA")), { x: -1, y: 0 });
    assert.deepEqual(computeIntent(keys("ArrowLeft", "KeyD")), { x: 0, y: 0 }, "flecha y WASD opuestas se anulan");
    for (const [arrow, wasd] of [["ArrowUp", "KeyW"], ["ArrowDown", "KeyS"], ["ArrowLeft", "KeyA"], ["ArrowRight", "KeyD"]]) {
        assert.deepEqual(computeIntent(keys(arrow)), computeIntent(keys(wasd)));
    }
    assert.deepEqual(computeIntent(keys("Space", "KeyQ")), { x: 0, y: 0 });
});

test("isValidColor", () => {
    for (const ok of ["#4dd2ff", "#FF5500", "#000000"]) assert.equal(isValidColor(ok), true, ok);
    for (const bad of ["red", "#12345", "#1234567", "ff5500", "#gggggg", "", null, 0xff5500]) assert.equal(isValidColor(bad), false, String(bad));
});

test("playerColor: extras válido, inválido o ausente", () => {
    assert.equal(playerColor({ userId: "1", extras: { color: "#ff5500" } }), "#ff5500");
    assert.equal(playerColor({ userId: "1", extras: { color: "red" } }), colorFromId("1"));
    assert.equal(playerColor({ userId: "1", extras: {} }), colorFromId("1"));
    assert.equal(playerColor({ userId: "1" }), colorFromId("1"));
});

test("colorFromId es determinista y con formato hsl", () => {
    assert.equal(colorFromId("42"), colorFromId("42"));
    assert.notEqual(colorFromId("1"), colorFromId("2"));
    assert.match(colorFromId("42"), /^hsl\(\d{1,3} 70% 55%\)$/);
    assert.ok(Number.isInteger(hashString("abc")) && hashString("abc") >= 0);
});

test("computeFit: mundo mayor y menor que el área, con la proporción conservada", () => {
    const big = computeFit(1200, 800, 600, 600);
    assert.equal(big.scale, 0.5);
    assert.deepEqual([big.cssW, big.cssH], [600, 400]);

    const small = computeFit(1200, 800, 2400, 2000);
    assert.equal(small.scale, 2);
    assert.deepEqual([small.cssW, small.cssH], [2400, 1600]);

    for (const fit of [computeFit(1200, 800, 700, 300), computeFit(1200, 800, 1000, 900)]) {
        assert.ok(Math.abs(fit.cssW / fit.cssH - 1200 / 800) < 1e-9);
    }
    assert.equal(computeFit(1200, 800, 0, 0).scale, 0.1, "nunca <= 0");
    assert.equal(computeFit(1200, 800, -5, 100).scale, 0.1);
});
