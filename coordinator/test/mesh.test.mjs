// Pruebas del núcleo puro del mesh (mesh.js): sin sockets ni red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfig } from "../game.js";
import {
    shouldInitiate,
    resolveLink,
    validatePeerMessage,
    resolveJoin,
    applyPeerMessage,
    dropPeerPlayers,
    buildResync,
    buildPositionsSync,
} from "../mesh.js";

const cfg = createConfig({}); // mundo 1200 × 800, radio 16
const SOCKET = { fake: "socket" };

const local = (selfId, changes = {}) => ({
    username: "ana",
    provider: "local",
    ownerId: selfId,
    connectedAtMs: 1000,
    socket: SOCKET,
    x: 100,
    y: 100,
    intent: { x: 0, y: 0 },
    extras: {},
    ...changes,
});
const remote = (ownerId, changes = {}) => ({ ...local(ownerId), socket: null, ...changes });
const joined = (origin, changes = {}) => ({ type: "player_joined", origin, userId: "u1", username: "ana", provider: "local", x: 300, y: 300, connectedAtMs: 2000, ...changes });
const valid = (msg) => {
    const r = validatePeerMessage(msg, cfg);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.msg;
};

test("shouldInitiate: solo hacia ids mayores (comparación de strings)", () => {
    assert.equal(shouldInitiate("coord-a", "coord-b"), true);
    assert.equal(shouldInitiate("coord-b", "coord-a"), false);
    assert.equal(shouldInitiate("coord-10", "coord-2"), true, '"coord-10" < "coord-2" como strings');
    assert.equal(shouldInitiate("coord-a", "coord-a"), false);
});

test("resolveLink: una sola conexión por par", () => {
    // coord-b recibe de coord-c (id mayor)
    assert.equal(resolveLink("coord-b", "coord-c", { direction: "in", existing: true }), "reject");
    assert.equal(resolveLink("coord-b", "coord-c", { direction: "in", existing: false }), "accept");
    // coord-b recibe de coord-a (id menor, el que debe iniciar)
    assert.equal(resolveLink("coord-b", "coord-a", { direction: "in", existing: true }), "replace");
    assert.equal(resolveLink("coord-b", "coord-a", { direction: "in", existing: false }), "accept");
});

test("validatePeerMessage: cada tipo válido y normalizado", () => {
    assert.deepEqual(valid({ type: "hello", coordinatorId: "coord-a", extra: 1 }), { type: "hello", coordinatorId: "coord-a" });
    assert.deepEqual(valid(joined("coord-b", { userId: 42 })), joined("coord-b", { userId: "42" }), "userId numérico 42 → \"42\"");
    assert.deepEqual(valid({ type: "player_left", origin: "coord-b", userId: "u1" }), { type: "player_left", origin: "coord-b", userId: "u1" });
    assert.deepEqual(valid({ type: "intent_replicate", origin: "coord-b", userId: "u1", intent: { dir: { x: 9999, y: -0.5 } } }), {
        type: "intent_replicate",
        origin: "coord-b",
        userId: "u1",
        intent: { dir: { x: 1, y: -1 } },
    }, "intent saneado con Math.sign");
    assert.deepEqual(valid({ type: "extras_replicate", origin: "coord-b", userId: "u1", extras: { color: "#FF5500", character: "heroina" } }).extras, { color: "#ff5500", character: "heroina" });
    assert.deepEqual(valid({ type: "positions_sync", origin: "coord-b", players: [{ userId: 7, x: 5000, y: -20 }] }).players, [{ userId: "7", x: 1200 - 16, y: 16 }], "limitado a los bordes");
    assert.deepEqual(valid(joined("coord-b", { x: -50, y: 99999 })).x, 16);
});

test("validatePeerMessage: rechaza lo inválido", () => {
    const cases = {
        "no es objeto": "hola",
        "tipo desconocido": { type: "teleport", origin: "coord-b" },
        "hello con id inválido": { type: "hello", coordinatorId: "coord b" },
        "sin origin": { type: "player_left", userId: "u1" },
        "x como string": joined("coord-b", { x: "300" }),
        "y infinita": joined("coord-b", { y: Infinity }),
        "username corto": joined("coord-b", { username: "an" }),
        "username con espacios": joined("coord-b", { username: "a n a" }),
        "provider inválido": joined("coord-b", { provider: "facebook" }),
        "connectedAtMs negativo": joined("coord-b", { connectedAtMs: -1 }),
        "userId vacío": joined("coord-b", { userId: "" }),
        "color malo": { type: "extras_replicate", origin: "coord-b", userId: "u1", extras: { color: "rojo" } },
        "extras gigantes": { type: "extras_replicate", origin: "coord-b", userId: "u1", extras: { pad: "x".repeat(2000) } },
        "intent sin dir": { type: "intent_replicate", origin: "coord-b", userId: "u1", intent: {} },
        "positions_sync con x string": { type: "positions_sync", origin: "coord-b", players: [{ userId: "u1", x: "1", y: 2 }] },
        "positions_sync de 1001": { type: "positions_sync", origin: "coord-b", players: Array.from({ length: 1001 }, (_, i) => ({ userId: String(i), x: 1, y: 1 })) },
    };
    for (const [name, msg] of Object.entries(cases)) {
        const r = validatePeerMessage(msg, cfg);
        assert.equal(r.ok, false, name);
        assert.equal(typeof r.reason, "string", name);
    }
});

test("anti-bucles: origin propio se descarta; origin distinto al peer de la conexión se ignora", () => {
    const players = new Map();
    assert.deepEqual(applyPeerMessage(players, "coord-a", "coord-b", valid(joined("coord-a"))), { membershipChanged: false, actions: [] });
    assert.deepEqual(applyPeerMessage(players, "coord-a", "coord-b", valid(joined("coord-c"))), { membershipChanged: false, actions: [] });
    assert.equal(players.size, 0);
});

test("player_joined crea un remoto con ownerId del peer, sin socket e intent (0,0)", () => {
    const players = new Map();
    const r = applyPeerMessage(players, "coord-a", "coord-b", valid(joined("coord-b")));
    assert.deepEqual(r, { membershipChanged: true, actions: [] });
    const p = players.get("u1");
    assert.equal(p.ownerId, "coord-b");
    assert.equal(p.socket, null);
    assert.deepEqual(p.intent, { x: 0, y: 0 });
    assert.deepEqual([p.x, p.y, p.connectedAtMs, p.username, p.provider], [300, 300, 2000, "ana", "local"]);
});

test("propiedad: solo el dueño mueve, cambia extras o saca a su jugador", () => {
    const players = new Map([
        ["mine", local("coord-a")],
        ["ofB", remote("coord-b")],
        ["ofC", remote("coord-c")],
    ]);
    const intent = (userId) => valid({ type: "intent_replicate", origin: "coord-b", userId, intent: { dir: { x: 1, y: 0 } } });
    applyPeerMessage(players, "coord-a", "coord-b", intent("mine"));
    applyPeerMessage(players, "coord-a", "coord-b", intent("ofC"));
    applyPeerMessage(players, "coord-a", "coord-b", intent("desconocido"));
    assert.deepEqual(players.get("mine").intent, { x: 0, y: 0 }, "un peer no mueve a un jugador local");
    assert.deepEqual(players.get("ofC").intent, { x: 0, y: 0 }, "ni a uno de otro dueño");
    applyPeerMessage(players, "coord-a", "coord-b", intent("ofB"));
    assert.deepEqual(players.get("ofB").intent, { x: 1, y: 0 }, "sobre uno suyo se aplica");

    const extras = (userId) => valid({ type: "extras_replicate", origin: "coord-b", userId, extras: { color: "#123456" } });
    applyPeerMessage(players, "coord-a", "coord-b", extras("ofC"));
    applyPeerMessage(players, "coord-a", "coord-b", extras("ofB"));
    assert.deepEqual(players.get("ofC").extras, {});
    assert.deepEqual(players.get("ofB").extras, { color: "#123456" });

    const left = (userId) => valid({ type: "player_left", origin: "coord-b", userId });
    assert.equal(applyPeerMessage(players, "coord-a", "coord-b", left("ofC")).membershipChanged, false, "player_left de un no-dueño se ignora");
    assert.equal(applyPeerMessage(players, "coord-a", "coord-b", left("mine")).membershipChanged, false);
    assert.ok(players.has("ofC") && players.has("mine"));
    assert.equal(applyPeerMessage(players, "coord-a", "coord-b", left("ofB")).membershipChanged, true);
    assert.equal(players.has("ofB"), false);
});

test("conflicto de sesión: local más viejo + entrante más nuevo → yield-local (cierra el socket y queda remoto)", () => {
    const players = new Map([["u1", local("coord-a", { connectedAtMs: 1000 })]]);
    assert.equal(resolveJoin(players.get("u1"), { connectedAtMs: 2000, origin: "coord-b" }, "coord-a"), "yield-local");
    const r = applyPeerMessage(players, "coord-a", "coord-b", valid(joined("coord-b", { connectedAtMs: 2000 })));
    assert.equal(r.membershipChanged, true);
    assert.equal(r.actions.length, 1);
    const [action] = r.actions;
    assert.deepEqual({ type: action.type, userId: action.userId, code: action.code, reason: action.reason }, {
        type: "close-local",
        userId: "u1",
        code: 4002,
        reason: "replaced by new session",
    });
    assert.equal(action.socket, SOCKET, "la acción lleva el socket a cerrar");
    const p = players.get("u1");
    assert.equal(p.socket, null);
    assert.equal(p.ownerId, "coord-b");
});

test("conflicto de sesión: local más nuevo + entrante más viejo → ignora", () => {
    const players = new Map([["u1", local("coord-a", { connectedAtMs: 5000 })]]);
    assert.equal(resolveJoin(players.get("u1"), { connectedAtMs: 2000, origin: "coord-b" }, "coord-a"), "ignore");
    const r = applyPeerMessage(players, "coord-a", "coord-b", valid(joined("coord-b", { connectedAtMs: 2000 })));
    assert.deepEqual(r, { membershipChanged: false, actions: [] });
    assert.equal(players.get("u1").socket, SOCKET);
});

test("conflicto de sesión: empate de connectedAtMs → gana el coordinatorId mayor", () => {
    assert.equal(resolveJoin(local("coord-a", { connectedAtMs: 3000 }), { connectedAtMs: 3000, origin: "coord-b" }, "coord-a"), "yield-local");
    assert.equal(resolveJoin(local("coord-b", { connectedAtMs: 3000 }), { connectedAtMs: 3000, origin: "coord-a" }, "coord-b"), "ignore");
    // remotos: se reemplaza solo si el entrante es más nuevo
    assert.equal(resolveJoin(remote("coord-c", { connectedAtMs: 3000 }), { connectedAtMs: 3000, origin: "coord-b" }, "coord-a"), "ignore");
    assert.equal(resolveJoin(remote("coord-b", { connectedAtMs: 3000 }), { connectedAtMs: 3000, origin: "coord-c" }, "coord-a"), "replace-remote");
    assert.equal(resolveJoin(remote("coord-b", { connectedAtMs: 3000 }), { connectedAtMs: 4000, origin: "coord-b" }, "coord-a"), "replace-remote");
    assert.equal(resolveJoin(undefined, { connectedAtMs: 1, origin: "coord-b" }, "coord-a"), "create");
});

test("los DOS coordinadores aplicando la misma pareja de eventos llegan al MISMO ganador", () => {
    for (const [tsA, tsB] of [[1000, 2000], [2000, 1000], [3000, 3000]]) {
        // El mismo usuario inicia sesión en coord-a (tsA) y en coord-b (tsB)
        const onA = new Map([["u1", local("coord-a", { connectedAtMs: tsA })]]);
        const onB = new Map([["u1", local("coord-b", { connectedAtMs: tsB })]]);
        applyPeerMessage(onA, "coord-a", "coord-b", valid(joined("coord-b", { connectedAtMs: tsB })));
        applyPeerMessage(onB, "coord-b", "coord-a", valid(joined("coord-a", { connectedAtMs: tsA })));
        const winnerA = onA.get("u1").ownerId;
        const winnerB = onB.get("u1").ownerId;
        assert.equal(winnerA, winnerB, `${tsA} vs ${tsB}`);
        const expected = tsA > tsB ? "coord-a" : "coord-b"; // en empate gana coord-b (id mayor)
        assert.equal(winnerA, expected, `${tsA} vs ${tsB}`);
        // Exactamente uno de los dos conserva el socket local
        assert.equal([onA.get("u1").socket, onB.get("u1").socket].filter(Boolean).length, 1);
    }
});

test("positions_sync: solo mueve jugadores del origen y respeta los límites del mundo", () => {
    const players = new Map([
        ["mine", local("coord-a", { x: 50, y: 50 })],
        ["ofB", remote("coord-b", { x: 50, y: 50 })],
        ["ofC", remote("coord-c", { x: 50, y: 50 })],
    ]);
    const msg = valid({
        type: "positions_sync",
        origin: "coord-b",
        players: [
            { userId: "mine", x: 600, y: 600 },
            { userId: "ofB", x: 99999, y: 400 },
            { userId: "ofC", x: 600, y: 600 },
            { userId: "nadie", x: 600, y: 600 },
        ],
    });
    applyPeerMessage(players, "coord-a", "coord-b", msg, cfg);
    assert.deepEqual([players.get("mine").x, players.get("mine").y], [50, 50]);
    assert.deepEqual([players.get("ofC").x, players.get("ofC").y], [50, 50]);
    assert.deepEqual([players.get("ofB").x, players.get("ofB").y], [1200 - 16, 400]);
    assert.equal(players.has("nadie"), false);
});

test("dropPeerPlayers: solo quita los remotos de ese peer", () => {
    const players = new Map([
        ["mine", local("coord-a")],
        ["b1", remote("coord-b")],
        ["b2", remote("coord-b")],
        ["c1", remote("coord-c")],
    ]);
    assert.deepEqual(dropPeerPlayers(players, "coord-b").sort(), ["b1", "b2"]);
    assert.deepEqual([...players.keys()].sort(), ["c1", "mine"]);
});

test("buildResync: player_joined primero (connectedAtMs original), luego intent ≠ (0,0) y extras no vacíos", () => {
    const players = new Map([
        ["u1", local("coord-a", { connectedAtMs: 111, x: 10, y: 20, intent: { x: 1, y: 0 }, extras: { color: "#123456" } })],
        ["u2", local("coord-a", { username: "beto", connectedAtMs: 222, intent: { x: 0, y: 0 }, extras: {} })],
        ["r1", remote("coord-b")], // los remotos no se reenvían
    ]);
    const msgs = buildResync(players, "coord-a");
    assert.deepEqual(msgs.map((m) => `${m.type}:${m.userId}`), ["player_joined:u1", "player_joined:u2", "intent_replicate:u1", "extras_replicate:u1"]);
    assert.ok(msgs.every((m) => m.origin === "coord-a"));
    assert.deepEqual(msgs[0], { type: "player_joined", origin: "coord-a", userId: "u1", username: "ana", provider: "local", x: 10, y: 20, connectedAtMs: 111 });
    assert.deepEqual(msgs[2].intent, { dir: { x: 1, y: 0 } });
    // Lo que se arma también pasa la validación del otro lado
    for (const m of msgs) assert.equal(validatePeerMessage(m, cfg).ok, true, m.type);
    assert.deepEqual(buildResync(new Map([["r1", remote("coord-b")]]), "coord-a"), []);
});

test("buildPositionsSync: posiciones de los locales, o null si no hay", () => {
    const players = new Map([
        ["u1", local("coord-a", { x: 10, y: 20 })],
        ["r1", remote("coord-b")],
    ]);
    assert.deepEqual(buildPositionsSync(players, "coord-a"), { type: "positions_sync", origin: "coord-a", players: [{ userId: "u1", x: 10, y: 20 }] });
    assert.equal(buildPositionsSync(new Map([["r1", remote("coord-b")]]), "coord-a"), null);
    assert.equal(buildPositionsSync(new Map(), "coord-a"), null);
});
