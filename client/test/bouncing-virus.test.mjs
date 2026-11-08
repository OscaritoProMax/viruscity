// Pruebas de la física del virus animado del login (funciones puras de bouncing-virus.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVirus, stepVirus, boostJump, resizeVirus, createSpore, stepSpore, BASE_RADIUS } from "../public/js/ui/bouncing-virus.js";

const FLOOR = 400;
const fixed = () => 0.5; // azar fijo: las antenas no reciben empuje al rebotar

test("cae por gravedad", () => {
    const v = createVirus();
    v.y = 100;
    stepVirus(v, FLOOR, fixed);
    const y1 = v.y;
    stepVirus(v, FLOOR, fixed);
    assert.ok(v.y > y1 && v.vy > 0, `y=${v.y} vy=${v.vy}`);
});

test("al tocar el suelo rebota, se aplasta y queda apoyado", () => {
    const v = createVirus();
    v.y = FLOOR - v.radius - 1;
    v.vy = 10;
    const { bounced, impactSpeed } = stepVirus(v, FLOOR, fixed);
    assert.ok(bounced && impactSpeed > 10);
    assert.equal(v.vy, -14);
    assert.ok(v.scaleY < 1 && v.scaleX > 1, `escala ${v.scaleX.toFixed(2)} x ${v.scaleY.toFixed(2)}`);
    assert.ok(Math.abs(v.y + v.radius * v.scaleY - FLOOR) < 1e-9);
});

test("rebota indefinidamente sin atravesar el suelo y con altura estable", () => {
    const v = createVirus();
    v.y = 150;
    const apexes = [];
    for (let i = 0; i < 60 * 20; i++) {
        const before = v.vy;
        stepVirus(v, FLOOR, fixed);
        assert.ok(v.y + v.radius * v.scaleY <= FLOOR + 1e-9, "atravesó el suelo");
        assert.ok(v.scaleX > 0.4 && v.scaleX < 1.6 && v.scaleY > 0.4 && v.scaleY < 1.6, "escala fuera de rango");
        if (before < 0 && v.vy >= 0) apexes.push(v.y); // punto más alto de cada rebote
    }
    // Tras los primeros rebotes, todos llegan a la misma altura (rebote estable)
    const settled = apexes.slice(3);
    const spread = Math.max(...settled) - Math.min(...settled);
    assert.ok(settled.length >= 5 && spread < 1, `alturas ${settled.map((a) => a.toFixed(1)).join(", ")}`);
    // Sube alrededor de 14² / (2 · 0.55) ≈ 178 px desde su punto de lanzamiento (menos el aplastamiento)
    const rise = FLOOR - v.radius - settled[0];
    assert.ok(rise > 130 && rise < 190, `altura del rebote ${rise.toFixed(1)} px`);
});

test("las fuerzas se escalan con el radio (virus pequeño, rebote proporcional)", () => {
    const v = createVirus(BASE_RADIUS / 2);
    v.y = FLOOR - v.radius - 1;
    v.vy = 5;
    stepVirus(v, FLOOR, fixed);
    assert.equal(v.vy, -7);
});

test("el salto potente no saca al virus por arriba", () => {
    const minTop = 20;
    for (const radius of [46, 30, 20]) {
        const v = createVirus(radius);
        v.y = FLOOR - v.radius; // apoyado
        boostJump(v, minTop);
        let top = Infinity;
        for (let i = 0; i < 200; i++) {
            stepVirus(v, FLOOR, fixed);
            top = Math.min(top, v.y - v.radius);
        }
        assert.ok(top >= minTop - 1, `radio ${radius}: borde superior ${top.toFixed(1)} < ${minTop}`);
    }
    // En pleno vuelo, cerca del techo, el impulso se reduce
    const v = createVirus();
    v.y = minTop + v.radius + 10;
    boostJump(v, minTop);
    assert.ok(Math.abs(v.vy) < 18.5, `vy=${v.vy}`);
});

test("las antenas se amortiguan", () => {
    const v = createVirus();
    v.y = 100;
    v.antennas[0].vWobble = 1;
    for (let i = 0; i < 300; i++) stepVirus(v, 100000, fixed); // suelo lejano: sin rebotes
    assert.ok(Math.abs(v.antennas[0].wobble) < 0.01, `wobble=${v.antennas[0].wobble}`);
});

test("resizeVirus conserva la posición relativa", () => {
    const v = createVirus(40);
    v.y = 200;
    resizeVirus(v, 20);
    assert.equal(v.radius, 20);
    assert.equal(v.y, 100);
    assert.equal(v.k, 20 / BASE_RADIUS);
});

test("las esporas desaparecen al agotar su vida", () => {
    const s = createSpore(0, 0, 3, -2, 1, fixed);
    let steps = 0;
    while (stepSpore(s)) steps++;
    assert.equal(steps, Math.ceil(s.maxLife) - 1);
});
