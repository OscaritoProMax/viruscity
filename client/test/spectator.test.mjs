// Track 2.5: modo espectador (cámara pura y URL del WebSocket sin token).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextFollow, panCamera, followLabel, PAN_SPEED } from "../public/js/play/spectator.js";
import { buildSpectateUrl } from "../public/js/play/directory.js";

const players = [
    { userId: "3", username: "carol", x: 10, y: 10 },
    { userId: "1", username: "alice", x: 20, y: 20 },
    { userId: "2", username: "bob", x: 30, y: 30 },
    { userId: "9", username: "roto", x: Number.NaN, y: 0 }, // sin posición: no se puede seguir
];

test("nextFollow: recorre por nombre, da la vuelta y empieza por el primero", () => {
    assert.equal(nextFollow(players, null, 1), "1"); // alice
    assert.equal(nextFollow(players, "1", 1), "2"); // bob
    assert.equal(nextFollow(players, "3", 1), "1"); // carol → alice (vuelta)
    assert.equal(nextFollow(players, "1", -1), "3"); // alice → carol (hacia atrás)
    assert.equal(nextFollow(players, null, -1), "3");
    assert.equal(nextFollow(players, "no-esta", 1), "1");
    assert.equal(nextFollow([], null, 1), null);
    assert.equal(nextFollow(null, null, 1), null);
});

test("panCamera: se mueve según la dirección y el zoom, sin salir del mundo", () => {
    const world = { width: 1000, height: 800 };
    const p = panCamera({ x: 500, y: 400 }, { x: 1, y: 0 }, 0.1, world, 1);
    assert.deepEqual(p, { x: 500 + PAN_SPEED * 0.1, y: 400 });
    // con zoom 2 avanza la mitad de unidades del mundo
    assert.equal(panCamera({ x: 500, y: 400 }, { x: -1, y: 0 }, 0.1, world, 2).x, 500 - (PAN_SPEED / 2) * 0.1);
    // bordes
    assert.deepEqual(panCamera({ x: 5, y: 795 }, { x: -1, y: 1 }, 0.1, world, 1), { x: 0, y: 800 });
    // sin posición previa empieza en el centro; dt enorme se acota a 0,1 s
    assert.deepEqual(panCamera(null, { x: 0, y: 0 }, 5, world, 1), { x: 500, y: 400 });
    assert.equal(panCamera({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, world, 1).x, PAN_SPEED * 0.1);
});

test("followLabel: a quién se sigue o cámara libre", () => {
    assert.equal(followLabel(players, "2"), "Siguiendo a bob");
    assert.equal(followLabel(players, null), "Cámara libre");
    assert.equal(followLabel(players, "se-fue"), "Cámara libre");
});

test("buildSpectateUrl: /spectate sin token ni barras dobles", () => {
    assert.equal(buildSpectateUrl("ws://localhost:5001"), "ws://localhost:5001/spectate");
    assert.equal(buildSpectateUrl("wss://coord-a.ngrok.app/"), "wss://coord-a.ngrok.app/spectate");
});
