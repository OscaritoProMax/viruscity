// Pruebas del directorio de coordinadores (directory.js) con un reloj falso.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDirectory, validateHeartbeat } = require("../directory.js");

// Reloj falso: el directorio solo ve el tiempo que la prueba hace avanzar
function fakeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => (t += ms) };
}

// Heartbeat válido (el ejemplo del enunciado) con cambios opcionales; coord-a usa 5001/5101, coord-b 5002/5102…
const portOf = (id) => "abcdefghi".indexOf(id.slice(-1)) + 1;
const hb = (coordinatorId, changes = {}) => ({
    coordinatorId,
    publicUrl: `ws://localhost:500${portOf(coordinatorId)}`,
    peerUrl: `ws://localhost:510${portOf(coordinatorId)}`,
    connectedPlayers: 0,
    uptime: 12.4,
    ...changes,
});

function makeDir({ ttlMs = 6000, reservationTtlMs = 3000, maxCoordinators } = {}) {
    const clock = fakeClock();
    const dir = createDirectory({ ttlMs, reservationTtlMs, maxCoordinators, now: clock.now });
    const beat = (id, changes) => {
        const v = dir.validateHeartbeat(hb(id, changes));
        assert.equal(v.ok, true, JSON.stringify(v));
        return dir.heartbeat(v.value);
    };
    return { dir, clock, beat };
}

const ids = (list) => list.map((e) => e.coordinatorId);

test("TTL: vivo a los 6000 ms y muerto a los 6001", () => {
    const { dir, clock, beat } = makeDir();
    beat("coord-a");
    clock.advance(6000);
    assert.deepEqual(ids(dir.alive()), ["coord-a"]);
    clock.advance(1);
    assert.deepEqual(ids(dir.alive()), []);
});

test("un heartbeat refresca la vida del coordinador", () => {
    const { dir, clock, beat } = makeDir();
    beat("coord-a");
    clock.advance(5000);
    beat("coord-a", { connectedPlayers: 3 });
    clock.advance(5000); // 10 s desde el primero, 5 s desde el último
    assert.deepEqual(ids(dir.alive()), ["coord-a"]);
    assert.equal(dir.alive()[0].connectedPlayers, 3);
});

test("orden de registro: un heartbeat no cambia el lugar; un reinsertado tras expirar va al final", () => {
    const { dir, clock, beat } = makeDir();
    beat("coord-a");
    beat("coord-b");
    beat("coord-c");
    beat("coord-a", { connectedPlayers: 1 });
    assert.deepEqual(ids(dir.alive()), ["coord-a", "coord-b", "coord-c"]);
    // a deja de latir y expira; b y c siguen vivos
    clock.advance(4000);
    beat("coord-b");
    beat("coord-c");
    clock.advance(3000);
    assert.deepEqual(ids(dir.alive()), ["coord-b", "coord-c"]);
    beat("coord-a");
    assert.deepEqual(ids(dir.alive()), ["coord-b", "coord-c", "coord-a"]);
});

test("pick: el de menor connectedPlayers; empate → el primero; sin vivos → null", () => {
    const { dir, clock, beat } = makeDir({ reservationTtlMs: 0 });
    assert.equal(dir.pick(), null);
    beat("coord-a", { connectedPlayers: 5 });
    beat("coord-b", { connectedPlayers: 2 });
    beat("coord-c", { connectedPlayers: 9 });
    assert.equal(dir.pick().coordinatorId, "coord-b");
    beat("coord-c", { connectedPlayers: 2 });
    assert.equal(dir.pick().coordinatorId, "coord-b", "empate entre b y c: el primero en orden de registro");
    clock.advance(6001);
    assert.equal(dir.pick(), null);
});

test("reservas: 4 pick seguidos con 3 coordinadores en 0 reparten A, B, C, A", () => {
    const { dir, beat } = makeDir();
    beat("coord-a");
    beat("coord-b");
    beat("coord-c");
    assert.deepEqual([1, 2, 3, 4].map(() => dir.pick().coordinatorId), ["coord-a", "coord-b", "coord-c", "coord-a"]);
});

test("reservas: expiran a los reservationTtlMs", () => {
    const { dir, clock, beat } = makeDir({ reservationTtlMs: 3000 });
    beat("coord-a");
    beat("coord-b");
    assert.equal(dir.pick().coordinatorId, "coord-a");
    clock.advance(2999);
    assert.equal(dir.pick().coordinatorId, "coord-b", "la reserva de a sigue activa");
    clock.advance(1); // la de a cumple 3000 ms y vence; la de b lleva 1 ms
    assert.equal(dir.pick().coordinatorId, "coord-a");
});

test("reservas: con reservationTtlMs = 0 el empate siempre da el mismo", () => {
    const { dir, beat } = makeDir({ reservationTtlMs: 0 });
    beat("coord-a");
    beat("coord-b");
    beat("coord-c");
    assert.deepEqual([1, 2, 3, 4].map(() => dir.pick().coordinatorId), ["coord-a", "coord-a", "coord-a", "coord-a"]);
});

test("maxCoordinators: el siguiente nuevo da directory_full; uno ya registrado sí se actualiza", () => {
    const { dir, clock, beat } = makeDir({ maxCoordinators: 2 });
    assert.deepEqual(beat("coord-a"), { ok: true });
    assert.deepEqual(beat("coord-b"), { ok: true });
    assert.deepEqual(beat("coord-c"), { ok: false, status: 503, error: "directory_full" });
    assert.deepEqual(beat("coord-a", { connectedPlayers: 4 }), { ok: true });
    // Cuando uno expira, hay lugar otra vez
    clock.advance(4000);
    beat("coord-a");
    clock.advance(3000);
    assert.deepEqual(beat("coord-c"), { ok: true });
    assert.deepEqual(ids(dir.alive()), ["coord-a", "coord-c"]);
});

test("peers y list: solo vivos; list incluye ageMs", () => {
    const { dir, clock, beat } = makeDir();
    beat("coord-a");
    clock.advance(1500);
    beat("coord-b", { connectedPlayers: 2 });
    clock.advance(500);
    assert.deepEqual(dir.peers(), [
        { coordinatorId: "coord-a", peerUrl: "ws://localhost:5101" },
        { coordinatorId: "coord-b", peerUrl: "ws://localhost:5102" },
    ]);
    const list = dir.list();
    assert.deepEqual(list.map((e) => [e.coordinatorId, e.ageMs, e.connectedPlayers, e.uptime]), [
        ["coord-a", 2000, 0, 12],
        ["coord-b", 500, 2, 12],
    ]);
    assert.ok(list.every((e) => !("lastSeen" in e)));
});

test("sweep elimina los expirados", () => {
    const { dir, clock, beat } = makeDir();
    beat("coord-a");
    clock.advance(6001);
    dir.sweep();
    assert.deepEqual(dir.peers(), []);
});

test("validateHeartbeat: acepta el ejemplo del enunciado (uptime redondeado)", () => {
    const r = validateHeartbeat({ coordinatorId: "coord-a", publicUrl: "ws://localhost:5001", peerUrl: "ws://localhost:5101", connectedPlayers: 3, uptime: 12.4 });
    assert.deepEqual(r, { ok: true, value: { coordinatorId: "coord-a", publicUrl: "ws://localhost:5001", peerUrl: "ws://localhost:5101", connectedPlayers: 3, uptime: 12 } });
    assert.equal(validateHeartbeat(hb("x_9", { publicUrl: "wss://abc.ngrok-free.app/" })).value.publicUrl, "wss://abc.ngrok-free.app", "sin barra final");
});

test("validateHeartbeat: rechaza cuerpos e ids, URLs y números inválidos", () => {
    const long = "ws://" + "a".repeat(200) + ".com";
    const cases = {
        "id con espacios": hb("coord a"),
        "id vacío": { ...hb("coord-a"), coordinatorId: "" },
        "id de 33 caracteres": { ...hb("coord-a"), coordinatorId: "a".repeat(33) },
        "publicUrl con http://": hb("coord-a", { publicUrl: "http://localhost:5001" }),
        "publicUrl que no es URL": hb("coord-a", { publicUrl: "no es una url" }),
        "peerUrl con https://": hb("coord-a", { peerUrl: "https://localhost:5101" }),
        "publicUrl de más de 200 caracteres": hb("coord-a", { publicUrl: long }),
        "peerUrl de más de 200 caracteres": hb("coord-a", { peerUrl: long }),
        "connectedPlayers negativo": hb("coord-a", { connectedPlayers: -1 }),
        "connectedPlayers 1.5": hb("coord-a", { connectedPlayers: 1.5 }),
        "connectedPlayers string": hb("coord-a", { connectedPlayers: "3" }),
        "uptime negativo": hb("coord-a", { uptime: -1 }),
        "uptime no numérico": hb("coord-a", { uptime: "12" }),
        "body null": null,
        "body array": [hb("coord-a")],
        "body string": "coord-a",
    };
    for (const [name, body] of Object.entries(cases)) {
        const r = validateHeartbeat(body);
        assert.equal(r.ok, false, name);
        assert.equal(typeof r.error, "string", name);
    }
});
