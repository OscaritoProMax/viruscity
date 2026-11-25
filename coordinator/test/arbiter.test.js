// Pruebas del árbitro de la partida (arbiter.js) y de la validación del estado replicado (match.js).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeArbiter, shouldAdoptGameState, selectEventsToDeliver } = require("../arbiter.js");
const { createMatchState, advance, applyAction, validateMatchState } = require("../match.js");
const { readMatchConfig } = require("../config.js");
const { buildCity } = require("../city.js");
const { seededRng } = require("./support/rng.js");

// ---------- computeArbiter ----------

test("computeArbiter: solo → él mismo; con peers → el menor id (strings)", () => {
    assert.equal(computeArbiter("coord-b", []), "coord-b");
    assert.equal(computeArbiter("coord-b", ["coord-c", "coord-a"]), "coord-a");
    assert.equal(computeArbiter("coord-a", ["coord-c", "coord-b"]), "coord-a");
    assert.equal(computeArbiter("coord-2", ["coord-10"]), "coord-10", "comparación de strings");
    assert.equal(computeArbiter("coord-b", undefined), "coord-b");
    assert.equal(computeArbiter("coord-b", [null, 7, "coord-c"]), "coord-b", "ids raros se ignoran");
});

// ---------- shouldAdoptGameState ----------

const base = { selfId: "coord-b", arbiterId: "coord-a", origin: "coord-a", handover: false, hasState: true, own: { matchId: 2, rev: 10 }, incoming: { matchId: 2, rev: 5 } };

test("shouldAdoptGameState (a): lo que manda el árbitro calculado se adopta siempre", () => {
    assert.equal(shouldAdoptGameState(base), true, "aunque (matchId, rev) sea menor");
    assert.equal(shouldAdoptGameState({ ...base, hasState: false }), true);
    assert.equal(shouldAdoptGameState({ ...base, handover: true }), true);
});

test("shouldAdoptGameState (b): handover siendo yo el árbitro calculado", () => {
    const mine = { ...base, selfId: "coord-a", arbiterId: "coord-a", origin: "coord-b", handover: true };
    assert.equal(shouldAdoptGameState({ ...mine, hasState: false, own: null }), true, "sin estado → se adopta");
    assert.equal(shouldAdoptGameState({ ...mine, own: { matchId: 1, rev: 99 }, incoming: { matchId: 2, rev: 1 } }), true, "matchId mayor");
    assert.equal(shouldAdoptGameState({ ...mine, own: { matchId: 2, rev: 10 }, incoming: { matchId: 2, rev: 11 } }), true, "mismo matchId, rev mayor");
    assert.equal(shouldAdoptGameState({ ...mine, own: { matchId: 2, rev: 10 }, incoming: { matchId: 2, rev: 10 } }), false, "igual → no");
    assert.equal(shouldAdoptGameState({ ...mine, own: { matchId: 3, rev: 0 }, incoming: { matchId: 2, rev: 50 } }), false, "menor → no");
});

test("shouldAdoptGameState (c): handover sin ser el árbitro, origen que no es el árbitro, o propio → no", () => {
    assert.equal(shouldAdoptGameState({ ...base, origin: "coord-c" }), false, "origen que no es el árbitro");
    assert.equal(shouldAdoptGameState({ ...base, origin: "coord-c", handover: true, hasState: false }), false, "handover pero el árbitro es otro");
    assert.equal(shouldAdoptGameState({ ...base, selfId: "coord-a", arbiterId: "coord-a", origin: "coord-a", handover: true, hasState: false }), false, "origen propio");
    assert.equal(shouldAdoptGameState({ ...base, origin: undefined }), false);
    assert.equal(shouldAdoptGameState({ ...base, selfId: "coord-a", arbiterId: "coord-a", origin: "coord-b", handover: "true", hasState: false }), false, "handover debe ser true booleano");
});

// ---------- selectEventsToDeliver con cambio de árbitro ----------

test("selectEventsToDeliver: el relevo continúa la numeración (sin duplicados ni huecos)", () => {
    // coord-c recibió del árbitro coord-a hasta el eid 12; coord-a cae y coord-b sigue desde el estado replicado
    let last = selectEventsToDeliver([{ eid: 11, kind: "x" }, { eid: 12, kind: "x" }], 10, 12).newLast;
    assert.equal(last, 12);
    // coord-b reenvía su primer game_state con el match replicado (eid 12) y luego eventos nuevos 13 y 14
    let r = selectEventsToDeliver([], last, 12);
    assert.deepEqual([r.deliver, r.newLast], [[], 12]);
    r = selectEventsToDeliver([{ eid: 12, kind: "x" }, { eid: 13, kind: "y" }, { eid: 14, kind: "z" }], r.newLast, 14);
    assert.deepEqual(r.deliver.map((e) => e.eid), [13, 14], "el 12 ya se había entregado");
    last = r.newLast;
    // Un árbitro que arrancó de cero (eid 3 < 14) reinicia el contador: sus eventos se entregan
    r = selectEventsToDeliver([{ eid: 2, kind: "a" }, { eid: 3, kind: "b" }], last, 3);
    assert.deepEqual(r.deliver.map((e) => e.eid), [2, 3]);
    assert.equal(r.newLast, 3);
});

test("selectEventsToDeliver: un game_state partido en trozos (máx. 100 eventos) llega completo", () => {
    const all = Array.from({ length: 230 }, (_, i) => ({ eid: 50 + i + 1, kind: "match_started" })); // eid 51..280
    const chunks = [all.slice(0, 100), all.slice(100, 200), all.slice(200)];
    let last = 50;
    const got = [];
    for (const chunk of chunks) {
        const r = selectEventsToDeliver(chunk, last, 280); // el mismo match (eid 280) en cada trozo
        got.push(...r.deliver.map((e) => e.eid));
        last = r.newLast;
    }
    assert.equal(got.length, 230);
    assert.deepEqual([got[0], got[229], last], [51, 280, 280]);
    // Repetir un trozo no duplica
    assert.deepEqual(selectEventsToDeliver(chunks[1], last, 280).deliver, []);
});

// ---------- validateMatchState ----------

const CFG = { ...readMatchConfig({}), WORLD_WIDTH: 1200, WORLD_HEIGHT: 800 };
const CITY = buildCity({ width: 1200, height: 800 });

// Partida simulada: 4 jugadores, un contagio y una misión en curso
function simulated() {
    const rng = seededRng(3);
    const players = [0, 1, 2, 3].map((i) => ({ userId: `u${i}`, username: `Jugador${i}`, x: 100 + i * 250, y: 400 }));
    const ctx = (now) => ({ now, players, cfg: CFG, city: CITY, rng });
    let s = advance(createMatchState(), ctx(0)).state;
    s = advance(s, ctx(10000)).state;
    const infected = Object.keys(s.roster).find((id) => s.roster[id].role === "infected");
    const healthy = Object.keys(s.roster).filter((id) => id !== infected);
    const m = s.missions[0];
    Object.assign(players.find((p) => p.userId === healthy[0]), { x: m.x, y: m.y });
    s = applyAction(s, healthy[0], { kind: "mission_start", missionId: m.id }, ctx(11000)).state;
    const inf = players.find((p) => p.userId === infected);
    Object.assign(players.find((p) => p.userId === healthy[1]), { x: inf.x + 30, y: inf.y });
    s = applyAction(s, infected, { kind: "infect" }, ctx(80000)).state;
    return { s, ctx };
}

test("validateMatchState: acepta createMatchState y una partida simulada (copia saneada idéntica)", () => {
    const fresh = createMatchState();
    assert.deepEqual(validateMatchState(fresh), { ok: true, match: fresh });
    const { s, ctx } = simulated();
    assert.equal(s.phase, "playing");
    assert.ok(s.missions.some((m) => m.status === "in_progress"));
    const v = validateMatchState(s);
    assert.equal(v.ok, true, v.reason);
    assert.deepEqual(v.match, s);
    assert.notEqual(v.match.roster, s.roster, "objetos nuevos");
    // Y también en 'ended' (tiempo agotado) y después de un viaje por JSON
    const ended = advance(s, ctx(s.endsAt)).state;
    assert.equal(ended.phase, "ended");
    assert.deepEqual(validateMatchState(JSON.parse(JSON.stringify(ended))).match, ended);
});

test("validateMatchState: descarta campos desconocidos sin rechazar", () => {
    const { s } = simulated();
    const dirty = JSON.parse(JSON.stringify(s));
    dirty.extra = "x";
    dirty.roster[Object.keys(dirty.roster)[0]].secreto = 1;
    dirty.missions[0].hack = true;
    const v = validateMatchState(dirty);
    assert.equal(v.ok, true);
    assert.deepEqual(v.match, s);
});

test("validateMatchState: rechaza fase, roster gigante, role, cure 150, misiones de más y más", () => {
    const { s } = simulated();
    const bad = (mutate, why) => {
        const copy = JSON.parse(JSON.stringify(s));
        mutate(copy);
        const v = validateMatchState(copy);
        assert.equal(v.ok, false, why);
        assert.equal(typeof v.reason, "string");
    };
    bad((m) => (m.phase = "jugando"), "fase inválida");
    bad((m) => {
        for (let i = 0; i < 201; i++) m.roster[`x${i}`] = { username: `user_${i}`, role: "healthy", infectReadyAt: null, connected: true, disconnectedAt: null };
    }, "roster gigante");
    bad((m) => (m.roster[Object.keys(m.roster)[0]].role = "zombie"), "role inválido");
    bad((m) => (m.roster[Object.keys(m.roster)[0]].username = "a b"), "username inválido");
    bad((m) => (m.cure = 150), "cure 150");
    bad((m) => (m.cure = -1), "cure negativa");
    bad((m) => (m.missions = [...m.missions, ...m.missions.map((x, i) => ({ ...x, id: `extra-${i}` })), ...m.missions.map((x, i) => ({ ...x, id: `mas-${i}` }))]), "más de 12 misiones");
    bad((m) => (m.missions[1].id = m.missions[0].id), "misión repetida");
    bad((m) => (m.missions[0].x = "10"), "x no numérica");
    bad((m) => (m.missions[0].status = "hecha"), "estado inválido");
    bad((m) => (m.missions[0].kind = "baile"), "tipo inválido");
    bad((m) => {
        const busy = m.missions.find((x) => x.status === "in_progress");
        busy.by = null;
    }, "en curso sin by");
    bad((m) => (m.matchId = -1), "matchId negativo");
    bad((m) => (m.rev = 1.5), "rev no entero");
    bad((m) => (m.endsAt = null), "playing sin endsAt");
    bad((m) => (m.results = { winner: "players", reason: "cure", players: [], endedAt: 1 }), "results fuera de ended");
    bad((m) => (m.roster = []), "roster como lista");
    assert.equal(validateMatchState(null).ok, false);
    assert.equal(validateMatchState("hola").ok, false);
});

test("validateMatchState: ended debe traer results coherente", () => {
    const { s, ctx } = simulated();
    const ended = JSON.parse(JSON.stringify(advance(s, ctx(s.endsAt)).state));
    const noResults = { ...ended, results: null };
    assert.equal(validateMatchState(noResults).ok, false);
    const badWinner = JSON.parse(JSON.stringify(ended));
    badWinner.results.winner = "nadie";
    assert.equal(validateMatchState(badWinner).ok, false);
    const badRole = JSON.parse(JSON.stringify(ended));
    badRole.results.players[0].role = "spectator";
    assert.equal(validateMatchState(badRole).ok, false);
});
