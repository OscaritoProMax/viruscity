// Track 2.1: persistencia del estado del coordinador (reconciliación pura y base node:sqlite).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { winner, mergeEntry, isFresh, validateEntry, snapshotEntries, openStateStore } = require("../persist.js");
const { validatePeerMessage, applyPeerMessage, buildPositionsSync } = require("../mesh.js");

const cfg = { WORLD_WIDTH: 2000, WORLD_HEIGHT: 1500, PLAYER_RADIUS: 16 };
const entry = (over = {}) => ({ userId: "u1", username: "alice", x: 400, y: 300, extras: {}, version: 1, savedAt: 1000, ownerId: "coord-a", ...over });

test("winner: gana la versión más alta aunque su reloj diga que es más vieja", () => {
    const a = entry({ version: 5, savedAt: 1000 });
    const b = entry({ version: 4, savedAt: 9999, ownerId: "coord-b" }); // reloj adelantado: no importa
    assert.equal(winner(a, b), a);
    assert.equal(winner(b, a), a);
});

test("winner: con la misma versión gana savedAt mayor y luego el ownerId mayor (determinista)", () => {
    assert.equal(winner(entry({ savedAt: 1 }), entry({ savedAt: 2, x: 50 })).x, 50);
    const a = entry({ ownerId: "coord-a" });
    const c = entry({ ownerId: "coord-c" });
    assert.equal(winner(a, c), c);
    assert.equal(winner(c, a), c);
    assert.equal(winner(null, a), a);
    assert.equal(winner(a, undefined), a);
});

test("isFresh: descarta lo guardado hace más de maxAge", () => {
    assert.equal(isFresh(entry({ savedAt: 1000 }), 5000, 4000), true);
    assert.equal(isFresh(entry({ savedAt: 1000 }), 5001, 4000), false);
    assert.equal(isFresh(null, 0, 1), false);
});

test("mergeEntry: aplica solo si gana; nunca pisa a un jugador vivo ni acepta entradas viejas", () => {
    const known = new Map([["u1", entry({ version: 3, x: 100 })]]);
    assert.equal(mergeEntry(known, entry({ version: 2, x: 200 }), { now: 1000 }), false);
    assert.equal(known.get("u1").x, 100);
    assert.equal(mergeEntry(known, entry({ version: 4, x: 400 }), { now: 1000 }), true);
    assert.equal(known.get("u1").x, 400);
    // vivo aquí: el presente gana sobre cualquier snapshot
    assert.equal(mergeEntry(known, entry({ version: 99, x: 999 }), { live: new Set(["u1"]), now: 1000 }), false);
    // demasiado vieja
    assert.equal(mergeEntry(known, entry({ userId: "u2", savedAt: 0 }), { now: 700000, maxAgeMs: 600000 }), false);
    assert.equal(known.has("u2"), false);
    assert.equal(mergeEntry(known, null), false);
});

test("validateEntry: userId string, posición dentro del mundo, extras acotados", () => {
    assert.deepEqual(validateEntry(entry(), cfg), entry());
    assert.equal(validateEntry(entry({ userId: 7 }), cfg).userId, "7");
    assert.equal(validateEntry(entry({ x: 5 }), cfg), null); // dentro del radio del borde
    assert.equal(validateEntry(entry({ x: Number.NaN }), cfg), null);
    assert.equal(validateEntry(entry({ version: 1.5 }), cfg), null);
    assert.equal(validateEntry(entry({ ownerId: "" }), cfg), null);
    assert.equal(validateEntry(entry({ extras: [] }), cfg), null);
    assert.equal(validateEntry(entry({ extras: { s: "x".repeat(2000) } }), cfg), null);
    assert.deepEqual(validateEntry(entry({ extras: null }), cfg).extras, {});
    assert.equal(validateEntry("nada", cfg), null);
});

test("snapshotEntries: los vivos locales con su versión y los conocidos que no están vivos", () => {
    const locals = new Map([["u1", { username: "alice", x: 1, y: 2, extras: { c: 1 } }]]);
    const known = new Map([
        ["u1", entry({ x: 999 })],
        ["u2", entry({ userId: "u2", username: "bob" })],
    ]);
    const out = snapshotEntries(locals, known, "coord-b", 50, () => 7);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { userId: "u1", username: "alice", x: 1, y: 2, extras: { c: 1 }, version: 7, savedAt: 50, ownerId: "coord-b" });
    assert.equal(out[1].userId, "u2");
});

test("store: guarda, recupera y no retrocede a una versión más vieja", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-persist-"));
    const file = path.join(dir, "estado.db");
    try {
        let store = openStateStore(file);
        store.savePlayers([entry({ version: 3, x: 400, extras: { color: 2 } }), entry({ userId: "u2", username: "bob", savedAt: 10 })]);
        store.savePlayers([entry({ version: 2, x: 111 })]); // más vieja: no pisa
        store.saveMatch({ phase: "open_world", matchId: 4, rev: 9 }, 1234);
        store.close();

        // Reinicio: se abre de nuevo el mismo archivo
        store = openStateStore(file);
        const rows = store.loadPlayers();
        const alice = rows.find((r) => r.userId === "u1");
        assert.equal(alice.x, 400);
        assert.equal(alice.version, 3);
        assert.deepEqual(alice.extras, { color: 2 });
        assert.deepEqual(store.loadMatch(), { match: { phase: "open_world", matchId: 4, rev: 9 }, savedAt: 1234 });

        // Poda por antigüedad
        store.savePlayers([], { pruneBefore: 500 });
        assert.deepEqual(
            store.loadPlayers().map((r) => r.userId),
            ["u1"],
        );
        store.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("store: una base nueva no tiene partida ni jugadores", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-persist-"));
    try {
        const store = openStateStore(path.join(dir, "sub", "nueva.db"));
        assert.deepEqual(store.loadPlayers(), []);
        assert.equal(store.loadMatch(), null);
        store.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("mesh: world_snapshot se valida entrada por entrada y se entrega como acción", () => {
    const ok = validatePeerMessage({ type: "world_snapshot", origin: "coord-b", players: [entry({ ownerId: "coord-b" })] }, cfg);
    assert.equal(ok.ok, true);
    const result = applyPeerMessage(new Map(), "coord-a", "coord-b", ok.msg, cfg);
    assert.deepEqual(result.actions, [{ type: "world_snapshot", origin: "coord-b", players: [entry({ ownerId: "coord-b" })] }]);

    assert.equal(validatePeerMessage({ type: "world_snapshot", origin: "coord-b", players: [entry({ x: -50 })] }, cfg).ok, false);
    assert.equal(validatePeerMessage({ type: "world_snapshot", origin: "coord-b", players: [entry({ ownerId: "con espacios" })] }, cfg).ok, false);
    assert.equal(validatePeerMessage({ type: "world_snapshot", origin: "coord-b", players: "x" }, cfg).ok, false);
    // un snapshot que dice venir de otro peer se descarta (anti-bucles / propiedad de la conexión)
    assert.deepEqual(applyPeerMessage(new Map(), "coord-a", "coord-c", ok.msg, cfg).actions, []);
});

test("mesh: positions_sync lleva la versión del dueño y la copia remota la adopta", () => {
    const players = new Map([["u1", { username: "alice", ownerId: "coord-b", socket: null, x: 0, y: 0, intent: { x: 0, y: 0 }, extras: {} }]]);
    const v = validatePeerMessage({ type: "positions_sync", origin: "coord-b", players: [{ userId: "u1", x: 400, y: 300, v: 12 }] }, cfg);
    assert.equal(v.ok, true);
    applyPeerMessage(players, "coord-a", "coord-b", v.msg, cfg);
    assert.equal(players.get("u1").version, 12);
    assert.equal(players.get("u1").x, 400);
    // v es opcional (compatibilidad), pero si viene debe ser un entero >= 0
    assert.equal(validatePeerMessage({ type: "positions_sync", origin: "coord-b", players: [{ userId: "u1", x: 400, y: 300 }] }, cfg).ok, true);
    assert.equal(validatePeerMessage({ type: "positions_sync", origin: "coord-b", players: [{ userId: "u1", x: 400, y: 300, v: -1 }] }, cfg).ok, false);
    // el dueño manda su versión
    const local = new Map([["u9", { username: "zoe", ownerId: "coord-a", socket: {}, x: 50, y: 60, version: 3 }]]);
    assert.deepEqual(buildPositionsSync(local, "coord-a").players, [{ userId: "u9", x: 50, y: 60, v: 3 }]);
});
