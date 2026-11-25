// Pruebas de la parte pura del dibujo de la ciudad (js/vc/city-render.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { stationMarks, ringLook } from "../public/js/vc/city-render.js";

const CITY = {
    zones: [{ id: "hospital", name: "Hospital", x: 100, y: 100, w: 210, h: 150 }],
    stations: [{ id: "hospital-1", zoneId: "hospital", x: 152, y: 52 }, { id: "hospital-2", zoneId: "hospital", x: 257, y: 52 }],
    plaza: { x: 600, y: 400 },
};
const missions = [{ id: "hospital-1", zoneId: "hospital", stationId: "hospital-1", x: 152, y: 52, title: "Recolectar muestras", kind: "sequence", status: "in_progress" }];

test("stationMarks: fuera de partida todas idle; en partida el estado de su misión, sin misión idle", () => {
    for (const phase of ["open_world", "countdown"]) {
        assert.deepEqual(stationMarks(CITY, { phase, missions }).map((m) => m.status), ["idle", "idle"], phase);
    }
    for (const phase of ["playing", "ended"]) {
        assert.deepEqual(stationMarks(CITY, { phase, missions }).map((m) => m.status), ["in_progress", "idle"], phase);
    }
    assert.deepEqual(stationMarks(CITY, null).map((m) => m.status), ["idle", "idle"]);
    assert.deepEqual(stationMarks(null, { phase: "playing", missions }), []);
    assert.deepEqual(stationMarks(CITY, { phase: "playing", missions })[0], { id: "hospital-1", x: 152, y: 52, status: "in_progress" });
});

test("ringLook: dorado pulsante solo para el sano (y sin pulso con movimiento reducido)", () => {
    assert.deepEqual(ringLook("available", "healthy"), { dot: false, color: "cure", alpha: 1, pulse: true, check: false });
    assert.equal(ringLook("available", "healthy", true).pulse, false, "prefers-reduced-motion");
    assert.equal(ringLook("available", "spectator").pulse, false);
    assert.equal(ringLook("available", "spectator").color, "cure");
    assert.equal(ringLook("in_progress", "healthy").color, "accent");
    assert.ok(ringLook("in_progress", "healthy").alpha < 1, "cian tenue");
    assert.deepEqual([ringLook("done", "healthy").color, ringLook("done", "healthy").check], ["muted", true]);
    assert.deepEqual(ringLook("idle", "healthy"), { dot: true, color: "muted", alpha: 0.6, pulse: false, check: false });
});

test("ringLook: para el infectado todos los anillos de misión se ven apagados", () => {
    for (const status of ["available", "in_progress", "done"]) {
        const look = ringLook(status, "infected");
        assert.equal(look.color, "muted", status);
        assert.equal(look.pulse, false, status);
        assert.ok(look.alpha <= 0.3, status);
    }
});
