// Pruebas de las funciones puras de la vista del clúster (js/cluster.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDirectory, formatUptime, formatAge, STALE_MS } from "../public/js/cluster.js";

test("summarizeDirectory: coordinadores válidos y total de jugadores", () => {
    const data = {
        coordinators: [
            { coordinatorId: "coord-a", publicUrl: "ws://localhost:5001", peerUrl: "ws://localhost:5101", connectedPlayers: 2, uptime: 65, ageMs: 812 },
            { coordinatorId: "coord-b", publicUrl: "ws://localhost:5002", connectedPlayers: 1, uptime: 3, ageMs: 4500 },
        ],
        ttlMs: 6000,
    };
    const r = summarizeDirectory(data);
    assert.equal(r.totalPlayers, 3);
    assert.deepEqual(r.coordinators.map((c) => c.coordinatorId), ["coord-a", "coord-b"]);
    assert.deepEqual(r.coordinators[0], { coordinatorId: "coord-a", publicUrl: "ws://localhost:5001", connectedPlayers: 2, uptime: 65, ageMs: 812 });
    assert.ok(r.coordinators[1].ageMs > STALE_MS, "coord-b ya no late (> 4 s)");
});

test("summarizeDirectory: vacío, datos raros y entradas inválidas", () => {
    for (const data of [null, undefined, {}, { coordinators: "x" }, { coordinators: [] }]) {
        assert.deepEqual(summarizeDirectory(data), { coordinators: [], totalPlayers: 0 }, JSON.stringify(data));
    }
    const r = summarizeDirectory({ coordinators: [null, { coordinatorId: "" }, { coordinatorId: "ok", connectedPlayers: -3, uptime: "x", ageMs: NaN }] });
    assert.deepEqual(r, { coordinators: [{ coordinatorId: "ok", publicUrl: "", connectedPlayers: 0, uptime: 0, ageMs: 0 }], totalPlayers: 0 });
});

test("formatUptime: segundos, minutos y horas", () => {
    assert.equal(formatUptime(0), "0 s");
    assert.equal(formatUptime(45), "45 s");
    assert.equal(formatUptime(65), "1 min 5 s");
    assert.equal(formatUptime(120), "2 min");
    assert.equal(formatUptime(3725), "1 h 2 min 5 s");
    assert.equal(formatUptime(7200), "2 h");
    assert.equal(formatUptime(-5), "0 s");
    assert.equal(formatUptime("x"), "0 s");
    assert.equal(formatUptime(59.9), "59 s");
});

test("formatAge: milisegundos a segundos con coma decimal", () => {
    assert.equal(formatAge(812), "0,8 s");
    assert.equal(formatAge(4500), "4,5 s");
    assert.equal(formatAge(-1), "0,0 s");
});
