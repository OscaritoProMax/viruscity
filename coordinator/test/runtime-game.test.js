// Pruebas puras del cableado de la partida en el coordinador (arbiter.js; stepPlayers/snapshot de game.js).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeGameAction, selectEventsToDeliver, routeEvents } = require("../arbiter.js");
const { createConfig, stepPlayers, snapshot } = require("../game.js");

// ---------- sanitizeGameAction ----------

test("sanitizeGameAction: acepta las 4 acciones y missionId con el patrón", () => {
    assert.deepEqual(sanitizeGameAction({ type: "game_action", action: "infect" }), { kind: "infect" });
    assert.deepEqual(sanitizeGameAction({ type: "game_action", action: "mission_start", missionId: "hospital-1" }), { kind: "mission_start", missionId: "hospital-1" });
    assert.deepEqual(sanitizeGameAction({ type: "game_action", action: "mission_complete", missionId: null }), { kind: "mission_complete" });
    assert.deepEqual(sanitizeGameAction({ type: "game_action", action: "mission_cancel", extra: 1 }), { kind: "mission_cancel" }, "campos de más se descartan");
});

test("sanitizeGameAction: rechaza acciones desconocidas, missionId inválido y basura", () => {
    for (const msg of [
        null,
        [],
        "game_action",
        { type: "intent", action: "infect" },
        { type: "game_action" },
        { type: "game_action", action: "volar" },
        { type: "game_action", action: ["infect"] },
        { type: "game_action", action: "mission_start", missionId: "Hospital-1" },
        { type: "game_action", action: "mission_start", missionId: "x".repeat(41) },
        { type: "game_action", action: "mission_start", missionId: "" },
        { type: "game_action", action: "mission_start", missionId: 7 },
        { type: "game_action", action: "mission_start", missionId: "../etc" },
    ]) {
        assert.equal(sanitizeGameAction(msg), null, JSON.stringify(msg));
    }
});

// ---------- routeEvents ----------

const EVENTS = [
    { eid: 5, kind: "infect_result", ok: true, to: "u1" },
    { eid: 6, kind: "you_infected", to: "u9" },
    { eid: 7, kind: "contagion_alert", zone: "Hospital" },
    { eid: 8, kind: "mission_result", ok: false, missionId: "farmacia-1", reason: "too_fast", to: "u2" },
];

test("routeEvents: con to solo a ese usuario si es local; sin to a todos (userId null)", () => {
    const out = routeEvents(EVENTS, new Set(["u1", "u2", "u3"]));
    assert.deepEqual(out, [
        { userId: "u1", msg: { type: "event", kind: "infect_result", ok: true } },
        { userId: null, msg: { type: "event", kind: "contagion_alert", zone: "Hospital" } },
        { userId: "u2", msg: { type: "event", kind: "mission_result", ok: false, missionId: "farmacia-1", reason: "too_fast" } },
    ]);
    assert.ok(!out.some((r) => r.userId === "u9"), "you_infected de un usuario no local se descarta");
});

test("routeEvents: los mensajes nunca llevan to ni eid; acepta arrays de ids; ignora basura", () => {
    const out = routeEvents([...EVENTS, null, { eid: 9 }, { eid: 10, kind: 3 }], ["u9"]);
    assert.deepEqual(out.map((r) => r.userId), ["u9", null]);
    for (const { msg } of out) {
        assert.equal(msg.type, "event");
        assert.ok(!("to" in msg) && !("eid" in msg), JSON.stringify(msg));
    }
    assert.deepEqual(routeEvents([], new Set()), []);
    assert.deepEqual(routeEvents(undefined, undefined), []);
});

// ---------- selectEventsToDeliver ----------

const ev = (eid, kind = "cure_update") => ({ eid, kind });

test("selectEventsToDeliver: entrega solo eid mayor al último, en orden y sin pasarse de match.eid", () => {
    const r = selectEventsToDeliver([ev(4), ev(6), ev(5), ev(3), ev(9)], 4, 6);
    assert.deepEqual(r.deliver.map((e) => e.eid), [5, 6]);
    assert.equal(r.newLast, 6);
});

test("selectEventsToDeliver: repetir el mismo mensaje no duplica eventos", () => {
    const events = [ev(1), ev(2), ev(2), ev(3)];
    const first = selectEventsToDeliver(events, 0, 3);
    assert.deepEqual(first.deliver.map((e) => e.eid), [1, 2, 3], "un eid repetido en la lista se entrega una vez");
    const again = selectEventsToDeliver(events, first.newLast, 3);
    assert.deepEqual(again.deliver, []);
    assert.equal(again.newLast, 3);
});

test("selectEventsToDeliver: si match.eid retrocede se reinicia el contador", () => {
    // Se entregó hasta 40; un árbitro nuevo empezó de cero y ya va en 2
    const r = selectEventsToDeliver([ev(1), ev(2)], 40, 2);
    assert.deepEqual(r.deliver.map((e) => e.eid), [1, 2]);
    assert.equal(r.newLast, 2);
    // Sin eventos nuevos, el contador avanza igual hasta match.eid
    assert.deepEqual(selectEventsToDeliver([], 2, 5), { deliver: [], newLast: 5 });
    // Entradas raras no rompen
    assert.deepEqual(selectEventsToDeliver(null, undefined, undefined), { deliver: [], newLast: 0 });
});

// ---------- stepPlayers con frozen y snapshot con ghost ----------

const CFG = createConfig({}); // mundo de 1200 × 800 sin mapa, 200 px/s
const mover = (extra = {}) => ({ username: "ana", provider: "local", x: 600, y: 400, intent: { x: 1, y: 0 }, extras: {}, ...extra });

test("stepPlayers: un jugador congelado no se mueve aunque tenga intención", () => {
    const players = new Map([["u1", mover({ frozen: true })]]);
    stepPlayers(players, 0.25, CFG);
    assert.deepEqual([players.get("u1").x, players.get("u1").y], [600, 400]);
    players.get("u1").intent = { x: -1, y: 1 };
    stepPlayers(players, 0.25, CFG);
    assert.deepEqual([players.get("u1").x, players.get("u1").y], [600, 400]);
});

test("stepPlayers: sin frozen (o frozen false) se mueve igual que antes", () => {
    const players = new Map([
        ["u1", mover()],
        ["u2", mover({ frozen: false })],
        ["u3", mover({ frozen: true })],
    ]);
    stepPlayers(players, 0.25, CFG);
    assert.equal(players.get("u1").x, 650, "200 px/s × 0,25 s");
    assert.equal(players.get("u2").x, 650);
    assert.equal(players.get("u3").x, 600);
    // Al descongelarse vuelve a moverse
    players.get("u3").frozen = false;
    stepPlayers(players, 0.25, CFG);
    assert.equal(players.get("u3").x, 650);
});

test("snapshot: ghost:true solo para quien isGhost indica; nunca roles", () => {
    const players = new Map([
        ["u1", mover({ ownerId: "coord-a" })],
        ["u2", mover({ ownerId: "coord-a", role: "infected" })], // aunque el objeto tuviera un rol, no se copia
    ]);
    const plain = snapshot(players);
    assert.ok(plain.every((p) => !("ghost" in p)));
    const withGhost = snapshot(players, (id) => id === "u2");
    assert.equal(withGhost.find((p) => p.userId === "u2").ghost, true);
    assert.ok(!("ghost" in withGhost.find((p) => p.userId === "u1")));
    assert.ok(!JSON.stringify(withGhost).includes("role") && !JSON.stringify(withGhost).includes("infected"));
});
