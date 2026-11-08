// Pruebas de computeCamera (función pura de scene-renderer.js) con node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCamera } from "../public/js/ui/scene-renderer.js";

const WORLD = { width: 2400, height: 1600 };
const VIEW_W = 1000;
const VIEW_H = 600;

test("centra la vista en el jugador", () => {
    assert.deepEqual(computeCamera({ x: 1200, y: 800 }, VIEW_W, VIEW_H, WORLD), { x: 700, y: 500 });
});

test("no deja ver fuera del mundo en las 4 esquinas", () => {
    assert.deepEqual(computeCamera({ x: 0, y: 0 }, VIEW_W, VIEW_H, WORLD), { x: 0, y: 0 });
    assert.deepEqual(computeCamera({ x: 2400, y: 0 }, VIEW_W, VIEW_H, WORLD), { x: 1400, y: 0 });
    assert.deepEqual(computeCamera({ x: 0, y: 1600 }, VIEW_W, VIEW_H, WORLD), { x: 0, y: 1000 });
    assert.deepEqual(computeCamera({ x: 2400, y: 1600 }, VIEW_W, VIEW_H, WORLD), { x: 1400, y: 1000 });
});

test("si el mundo es menor que la vista en un eje, lo centra en ese eje", () => {
    const small = { width: 800, height: 400 };
    assert.deepEqual(computeCamera({ x: 10, y: 390 }, VIEW_W, VIEW_H, small), { x: -100, y: -100 });
    // Solo un eje menor: el otro sigue al jugador
    const wide = { width: 3000, height: 400 };
    assert.deepEqual(computeCamera({ x: 1500, y: 0 }, VIEW_W, VIEW_H, wide), { x: 1000, y: -100 });
});

test("sin jugador local centra el mundo", () => {
    assert.deepEqual(computeCamera(null, VIEW_W, VIEW_H, WORLD), { x: 700, y: 500 });
    assert.deepEqual(computeCamera(undefined, VIEW_W, VIEW_H, { width: 800, height: 400 }), { x: -100, y: -100 });
});
