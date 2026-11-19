// Pruebas del reducer de la partida de Viruscity y de sus vistas (match.js).
// Reloj y rng falsos. El arnés congela a fondo (Object.freeze) el estado de ENTRADA de cada llamada y verifica
// que no cambió (inmutabilidad) y que rev crece en 1 exactamente cuando changed es true; así M9 y M10 se
// comprueban en todos los escenarios, no solo en los suyos.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMatchState, advance, applyAction, buildClientView, frozenUserIds, isGhost, plazaSpawns, PLAZA_RADIUS } = require("../match.js");
const { readMatchConfig } = require("../config.js");
const { buildCity, zoneNear } = require("../city.js");
const { seededRng } = require("./support/rng.js");

const WORLD = { width: 1200, height: 800 };
const CFG = Object.freeze({ ...readMatchConfig({}), WORLD_WIDTH: WORLD.width, WORLD_HEIGHT: WORLD.height });
const CITY = buildCity(WORLD);
const T0 = 1_000_000;

function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

// Posiciones de partida separadas (≥ 150 px entre sí y lejos de las estaciones): nadie queda en rango por accidente
const spot = (i) => ({ x: 100 + (i % 5) * 250, y: 350 + Math.floor(i / 5) * 150 });
const idOf = (i) => `u${String(i + 1).padStart(2, "0")}`;
const nameOf = (i) => `Jugador${String(i + 1).padStart(2, "0")}`;

function createGame({ n = 3, seed = 1, cfg = {} } = {}) {
    const g = {
        cfg: Object.freeze({ ...CFG, ...cfg }),
        state: createMatchState(),
        now: T0,
        pos: new Map(),
        rng: seededRng(seed),
    };
    for (let i = 0; i < n; i++) g.pos.set(idOf(i), { userId: idOf(i), username: nameOf(i), ...spot(i) });

    g.ctx = () => ({ now: g.now, players: [...g.pos.values()].map((p) => ({ ...p })), cfg: g.cfg, city: CITY, rng: g.rng });

    // Ejecuta una operación del reducer con el estado de entrada congelado y verifica las invariantes
    g.run = (fn) => {
        const input = deepFreeze(g.state);
        const before = JSON.stringify(input);
        const r = fn(input);
        assert.equal(JSON.stringify(input), before, "el estado de entrada no se modifica");
        if (r.changed) {
            assert.notEqual(r.state, input, "con cambios devuelve un objeto nuevo");
            assert.equal(r.state.rev, input.rev + 1, "rev crece en 1 cuando cambia");
            for (const e of r.events) assert.ok(e.eid > input.eid && e.eid <= r.state.eid, "eid creciente");
            assert.deepEqual(r.events.map((e) => e.eid), r.events.map((_, k) => input.eid + 1 + k), "eid consecutivos");
        } else {
            assert.equal(r.state, input, "sin cambios devuelve el MISMO objeto");
            assert.deepEqual(r.events, []);
        }
        g.state = r.state;
        return r;
    };
    g.advance = () => g.run((s) => advance(s, g.ctx()));
    g.act = (userId, kind, missionId) => g.run((s) => applyAction(s, userId, missionId === undefined ? { kind } : { kind, missionId }, g.ctx()));
    g.start = () => {
        g.advance(); // → countdown
        g.now += g.cfg.MATCH_COUNTDOWN_MS;
        return g.advance(); // → playing
    };
    g.role = (id) => g.state.roster[id]?.role;
    g.ids = (role) => Object.keys(g.state.roster).filter((id) => g.state.roster[id].role === role).sort();
    g.at = (id, x, y) => {
        const p = g.pos.get(id) ?? { userId: id, username: id };
        g.pos.set(id, { ...p, x, y });
    };
    g.near = (id, other, d) => {
        const o = g.pos.get(other);
        g.at(id, o.x + d, o.y);
    };
    g.leave = (id) => g.pos.delete(id);
    g.view = (id, connected = g.pos.size) => buildClientView(g.state, id, { now: g.now, connected, cfg: g.cfg });
    return g;
}

// Partida ya empezada; X = infectado inicial; H = sanos (ordenados)
function playing(opts) {
    const g = createGame(opts);
    g.start();
    assert.equal(g.state.phase, "playing");
    return { g, X: g.ids("infected")[0], H: g.ids("healthy") };
}

const only = (r, kind) => r.events.filter((e) => e.kind === kind);
const one = (r, kind) => {
    const list = only(r, kind);
    assert.equal(list.length, 1, `un evento ${kind}`);
    return list[0];
};
const mission = (g, id) => g.state.missions.find((m) => m.id === id);

// ---------- M1 fases ----------

test("M1 fases: 2 no inician; 3 → countdown; vuelve a open_world si baja a 2; completa la cuenta → playing", () => {
    const g = createGame({ n: 2 });
    assert.equal(g.advance().changed, false, "con 2 jugadores no pasa nada");
    assert.equal(g.state.phase, "open_world");

    g.at("u03", 900, 650);
    g.pos.get("u03").username = "Jugador03";
    g.advance();
    assert.equal(g.state.phase, "countdown");
    assert.equal(g.state.countdownEndsAt, T0 + 10000);

    g.now += 4000;
    g.leave("u03");
    g.advance();
    assert.equal(g.state.phase, "open_world");
    assert.equal(g.state.countdownEndsAt, null);

    g.at("u03", 900, 650);
    g.advance();
    const ends = g.state.countdownEndsAt;
    assert.equal(ends, g.now + 10000, "la cuenta empieza de nuevo");
    g.now = ends - 1;
    assert.equal(g.advance().changed, false, "falta 1 ms");
    g.now = ends;
    const r = g.advance();
    assert.equal(g.state.phase, "playing");
    assert.equal(only(r, "match_started").length, 3);
});

// ---------- M2 inicio ----------

test("M2 inicio con 3: un infectado, roster = jugadores, 6 misiones, bloqueo inicial y matchId", () => {
    const g = createGame({ n: 3, seed: 5 });
    const r = g.start();
    const s = g.state;
    assert.deepEqual(Object.keys(s.roster).sort(), ["u01", "u02", "u03"]);
    assert.equal(s.roster.u02.username, "Jugador02");
    assert.equal(g.ids("infected").length, 1);
    assert.equal(g.ids("healthy").length, 2);
    assert.equal(s.matchId, 1);
    assert.equal(s.startedAt, g.now);
    assert.equal(s.endsAt, g.now + 900000);
    assert.equal(s.cure, 0);
    assert.equal(s.missions.length, 6);
    for (const id of Object.keys(s.roster)) {
        const m = s.roster[id];
        assert.equal(m.infectReadyAt, m.role === "infected" ? g.now + 60000 : null, id);
        assert.equal(m.connected, true);
    }
    for (const m of s.missions) {
        const st = CITY.stations.find((x) => x.id === m.stationId);
        assert.deepEqual([m.x, m.y, m.status, m.by], [st.x, st.y, "available", null]);
    }
    // match_started personal, con el rol de cada uno
    const started = only(r, "match_started");
    assert.deepEqual(started.map((e) => e.to).sort(), ["u01", "u02", "u03"]);
    for (const e of started) assert.equal(e.role, s.roster[e.to].role);
});

test("M2 misiones según el roster: 12 con 5 y con 10 jugadores (y 3 con 2)", () => {
    assert.equal(playing({ n: 5 }).g.state.missions.length, 12);
    assert.equal(playing({ n: 10 }).g.state.missions.length, 12);
    assert.equal(playing({ n: 4 }).g.state.missions.length, 9);
    assert.equal(playing({ n: 2, cfg: { MIN_PLAYERS_TO_START: 2 } }).g.state.missions.length, 3);
    const ids = playing({ n: 10 }).g.state.missions.map((m) => m.id);
    assert.equal(new Set(ids).size, 12, "sin repetir");
});

test("M2 determinista con rng sembrado; el infectado varía con la semilla", () => {
    const a = playing({ n: 5, seed: 11 }).g.state;
    const b = playing({ n: 5, seed: 11 }).g.state;
    assert.deepEqual(a, b);
    const infected = new Set();
    for (let seed = 1; seed <= 30; seed++) infected.add(playing({ n: 5, seed }).X);
    assert.ok(infected.size >= 3, "el sorteo no siempre elige al mismo");
});

test("M2 plazaSpawns: determinista, a 80 px de la plaza, en orden de userId", () => {
    const { g } = playing({ n: 5, seed: 2 });
    const a = plazaSpawns(g.state, CITY);
    const b = plazaSpawns(g.state, CITY);
    assert.deepEqual(a, b);
    assert.deepEqual(Object.keys(a), ["u01", "u02", "u03", "u04", "u05"]);
    for (const p of Object.values(a)) assert.ok(Math.abs(Math.hypot(p.x - CITY.plaza.x, p.y - CITY.plaza.y) - PLAZA_RADIUS) < 0.01);
    assert.deepEqual(a.u01, { x: CITY.plaza.x, y: CITY.plaza.y - 80 }, "el primero arriba de la plaza");
    assert.equal(new Set(Object.values(a).map((p) => `${p.x},${p.y}`)).size, 5, "puntos distintos");
});

test("M2 un userId '__proto__' es un jugador más y no altera prototipos", () => {
    const g = createGame({ n: 2 });
    g.pos.set("__proto__", { userId: "__proto__", username: "Raro", x: 900, y: 650 });
    g.start();
    assert.equal(Object.getPrototypeOf(g.state.roster), Object.prototype);
    assert.ok(Object.hasOwn(g.state.roster, "__proto__"));
    assert.equal(Object.keys(g.state.roster).length, 3);
    assert.equal(isGhost(g.state, "__proto__"), false);
    assert.ok(Object.hasOwn(plazaSpawns(g.state, CITY), "__proto__"));
    assert.equal(g.view("__proto__").you.role, g.state.roster.__proto__.role);
});

// ---------- M3 infección ----------

test("M3 bloqueo inicial: antes de 60 s 'cooldown'; a los 60 s contagia a 70 px", () => {
    const { g, X, H } = playing({ n: 3, seed: 3 });
    g.near(H[0], X, 70);
    let r = g.act(X, "infect");
    assert.deepEqual(one(r, "infect_result"), { eid: g.state.eid, kind: "infect_result", ok: false, reason: "cooldown", to: X });
    g.now = g.state.startedAt + 59999;
    assert.equal(one(g.act(X, "infect"), "infect_result").reason, "cooldown");
    g.now = g.state.startedAt + 60000;
    r = g.act(X, "infect");
    assert.equal(one(r, "infect_result").ok, true);
    assert.equal(g.role(H[0]), "infected");
});

for (const [d, ok] of [
    [70, true],
    [94, true],
    [95, true],
    [96, false],
]) {
    test(`M3 alcance: a ${d} px ${ok ? "contagia" : "'no_target'"} (70 + tolerancia 25)`, () => {
        const { g, X, H } = playing({ n: 3, seed: 3 });
        g.now += 60000;
        g.near(H[0], X, d);
        const readyBefore = g.state.roster[X].infectReadyAt;
        const r = g.act(X, "infect");
        const res = one(r, "infect_result");
        assert.equal(res.ok, ok);
        if (!ok) {
            assert.equal(res.reason, "no_target");
            assert.equal(g.state.roster[X].infectReadyAt, readyBefore, "no_target no consume el enfriamiento");
            assert.equal(g.role(H[0]), "healthy");
        }
    });
}

test("M3 éxito: víctima +3 min, atacante +2 min; enfriamientos exactos; eventos con to correcto", () => {
    const { g, X, H } = playing({ n: 4, seed: 3 });
    const [B, C, D] = H;
    g.now += 60000;
    const t1 = g.now;
    g.near(B, X, 50);
    const r = g.act(X, "infect");
    assert.deepEqual(
        r.events.map((e) => [e.kind, e.to]),
        [
            ["you_infected", B],
            ["infect_result", X],
            ["contagion_alert", undefined],
        ],
    );
    assert.equal(g.state.roster[B].infectReadyAt, t1 + 180000);
    assert.equal(g.state.roster[X].infectReadyAt, t1 + 120000);

    // La nueva infectada contagia recién a los 180000 ms
    g.near(C, B, 40);
    g.at(X, 1100, 100);
    g.now = t1 + 179999;
    assert.equal(one(g.act(B, "infect"), "infect_result").reason, "cooldown");
    // El atacante tampoco puede repetir antes de 2 min
    g.near(D, X, 30);
    g.now = t1 + 119999;
    assert.equal(one(g.act(X, "infect"), "infect_result").reason, "cooldown");
    g.now = t1 + 180000;
    const r2 = g.act(B, "infect");
    assert.equal(one(r2, "infect_result").ok, true);
    assert.equal(one(r2, "you_infected").to, C);
    assert.equal(g.state.phase, "playing", "queda D sano");
});

test("M3 motivos: sano 'not_infected', espectador 'spectator', fuera de partida 'not_playing'", () => {
    const { g, X, H } = playing({ n: 3, seed: 3 });
    g.now += 60000;
    g.near(X, H[0], 10);
    assert.equal(one(g.act(H[0], "infect"), "infect_result").reason, "not_infected");
    g.at("zz", 600, 400);
    assert.equal(one(g.act("zz", "infect"), "infect_result").reason, "spectator");

    const w = createGame({ n: 3 });
    assert.equal(one(w.act("u01", "infect"), "infect_result").reason, "not_playing");
    w.advance();
    assert.equal(w.state.phase, "countdown");
    assert.equal(one(w.act("u01", "mission_start", "hospital-1"), "mission_result").reason, "not_playing");
});

test("M3 un infectado cercano no es objetivo: se contagia al SANO más cercano", () => {
    const { g, X, H } = playing({ n: 4, seed: 3 });
    const [B, C] = H;
    g.now += 60000;
    g.near(B, X, 50);
    g.act(X, "infect"); // B infectada
    g.now += 120000;
    g.near(B, X, 10); // infectada a 10 px
    g.near(C, X, 60); // sana a 60 px
    const r = g.act(X, "infect");
    assert.equal(one(r, "you_infected").to, C);
});

test("M3 contagion_alert: pública, con la zona y SIN ids ni nombres", () => {
    const { g, X, H } = playing({ n: 3, seed: 3 });
    g.now += 60000;
    g.at(X, 150, 260);
    g.near(H[0], X, 40);
    const r = g.act(X, "infect");
    const alert = one(r, "contagion_alert");
    assert.deepEqual(Object.keys(alert).sort(), ["eid", "kind", "zone"], "sin to: es para todos");
    const vp = g.pos.get(H[0]);
    assert.equal(alert.zone, zoneNear(CITY, vp.x, vp.y));
    assert.equal(alert.zone, "Hospital");
    const json = JSON.stringify(alert);
    for (const [id, p] of g.pos) {
        assert.ok(!json.includes(id), `sin el id ${id}`);
        assert.ok(!json.includes(p.username), `sin el nombre ${p.username}`);
    }
});

// ---------- M4 misiones ----------

test("M4 inicio de misión: too_far, busy (ocupada o con otra), not_available, not_healthy", () => {
    const { g, X, H } = playing({ n: 3, seed: 4 });
    const [A, B] = H;
    const [m1, m2] = g.state.missions;

    g.at(A, m1.x, m1.y + 86);
    assert.equal(one(g.act(A, "mission_start", m1.id), "mission_result").reason, "too_far");
    g.at(A, m1.x, m1.y + 85); // 60 + tolerancia 25
    const r = g.act(A, "mission_start", m1.id);
    assert.deepEqual(one(r, "mission_started"), { eid: g.state.eid, kind: "mission_started", missionId: m1.id, to: A });
    assert.equal(mission(g, m1.id).status, "in_progress");

    g.at(B, m1.x, m1.y);
    assert.equal(one(g.act(B, "mission_start", m1.id), "mission_result").reason, "busy", "dos jugadores no toman la misma");
    g.at(A, m2.x, m2.y); // A se va: sigue a menos de rango? no: lejos, pero aún no hubo advance
    assert.equal(one(g.act(A, "mission_start", m2.id), "mission_result").reason, "busy", "ya tiene otra misión");
    assert.equal(one(g.act(B, "mission_start", "no-existe"), "mission_result").reason, "not_available");
    g.at(X, m2.x, m2.y);
    assert.equal(one(g.act(X, "mission_start", m2.id), "mission_result").reason, "not_healthy");
});

test("M4 completar: antes de 8 s 'too_fast'; a los 8 s done con cure = 100/M; no se repite", () => {
    const { g, H } = playing({ n: 3, seed: 4 });
    const A = H[0];
    const m = g.state.missions[0];
    g.at(A, m.x, m.y);
    g.act(A, "mission_start", m.id);
    const t = g.now;
    g.now = t + 7999;
    assert.equal(one(g.act(A, "mission_complete", m.id), "mission_result").reason, "too_fast");
    assert.equal(mission(g, m.id).status, "in_progress", "sigue en curso");
    g.now = t + 8000;
    const r = g.act(A, "mission_complete", m.id);
    assert.deepEqual(one(r, "mission_result"), { eid: r.events[0].eid, kind: "mission_result", ok: true, missionId: m.id, to: A });
    assert.deepEqual(Object.keys(one(r, "cure_update")).sort(), ["cure", "eid", "kind"], "cure_update es pública");
    assert.equal(mission(g, m.id).status, "done");
    assert.equal(g.state.cure, 100 / 6);
    assert.equal(one(g.act(A, "mission_complete", m.id), "mission_result").reason, "no_active_mission");
    assert.equal(one(g.act(A, "mission_start", m.id), "mission_result").reason, "not_available", "una misión no se completa dos veces");
});

test("M4 la última misión deja la cura en exactamente 100 y ganan los jugadores", () => {
    const { g, H } = playing({ n: 3, seed: 4 });
    const A = H[0];
    let last;
    for (const m of g.state.missions.map((x) => ({ ...x }))) {
        g.at(A, m.x, m.y);
        assert.equal(one(g.act(A, "mission_start", m.id), "mission_started").missionId, m.id);
        g.now += 8000;
        last = g.act(A, "mission_complete", m.id);
    }
    assert.equal(g.state.cure, 100);
    assert.equal(g.state.phase, "ended");
    assert.equal(g.state.results.winner, "players");
    assert.equal(g.state.results.reason, "cure");
    assert.deepEqual(one(last, "match_ended"), { eid: g.state.eid, kind: "match_ended", winner: "players" });
});

test("M4 la víctima de un contagio pierde su misión", () => {
    const { g, X, H } = playing({ n: 3, seed: 4 });
    const A = H[0];
    const m = g.state.missions[0];
    g.at(A, m.x, m.y);
    g.act(A, "mission_start", m.id);
    g.now += 60000;
    g.near(X, A, 30);
    const r = g.act(X, "infect");
    assert.deepEqual(r.events.map((e) => [e.kind, e.to, e.reason]), [
        ["mission_result", A, "infected"],
        ["you_infected", A, undefined],
        ["infect_result", X, undefined],
        ["contagion_alert", undefined, undefined],
    ]);
    assert.equal(mission(g, m.id).status, "available");
    assert.equal(mission(g, m.id).by, null);
});

test("M4 desconexión, expiración (45 s), salir de rango y cancelar liberan la misión", () => {
    // desconexión
    let { g, H } = playing({ n: 3, seed: 4 });
    let m = g.state.missions[0];
    g.at(H[0], m.x, m.y);
    g.act(H[0], "mission_start", m.id);
    const saved = g.pos.get(H[0]);
    g.leave(H[0]);
    g.advance();
    assert.equal(mission(g, m.id).status, "available");
    assert.equal(g.state.roster[H[0]].connected, false);
    g.pos.set(H[0], saved);

    // expiración: a los 45000 ms sigue, a los 45001 se libera
    g.act(H[0], "mission_start", m.id);
    const t = g.now;
    g.now = t + 45000;
    assert.equal(g.advance().changed, true, "solo reconexión ya aplicada; la misión sigue");
    assert.equal(mission(g, m.id).status, "in_progress");
    g.now = t + 45001;
    let r = g.advance();
    assert.deepEqual(one(r, "mission_result"), { eid: r.events[0].eid, kind: "mission_result", ok: false, missionId: m.id, reason: "expired", to: H[0] });
    assert.equal(mission(g, m.id).status, "available");

    // salir de rango
    ({ g, H } = playing({ n: 3, seed: 4 }));
    m = g.state.missions[0];
    g.at(H[0], m.x, m.y);
    g.act(H[0], "mission_start", m.id);
    g.at(H[0], m.x + 85, m.y);
    assert.equal(g.advance().changed, false, "a 85 px sigue en rango");
    g.at(H[0], m.x + 86, m.y);
    r = g.advance();
    assert.equal(one(r, "mission_result").reason, "too_far");
    assert.equal(mission(g, m.id).status, "available");

    // cancelar
    g.at(H[0], m.x, m.y);
    g.act(H[0], "mission_start", m.id);
    r = g.act(H[0], "mission_cancel", m.id);
    assert.equal(one(r, "mission_result").reason, "cancelled");
    assert.equal(mission(g, m.id).status, "available");
    assert.equal(one(g.act(H[0], "mission_cancel"), "mission_result").reason, "no_active_mission");
});

test("M4 completar fuera de plazo o fuera de rango falla y libera; otra misión → no_active_mission", () => {
    const { g, H } = playing({ n: 3, seed: 4 });
    const [m1, m2] = g.state.missions;
    g.at(H[0], m1.x, m1.y);
    g.act(H[0], "mission_start", m1.id);
    g.now += 9000;
    assert.equal(one(g.act(H[0], "mission_complete", m2.id), "mission_result").reason, "no_active_mission");
    g.at(H[0], m1.x, m1.y + 90);
    assert.equal(one(g.act(H[0], "mission_complete", m1.id), "mission_result").reason, "too_far");
    assert.equal(mission(g, m1.id).status, "available");
    g.at(H[0], m1.x, m1.y);
    g.act(H[0], "mission_start", m1.id);
    g.now += 45001;
    assert.equal(one(g.act(H[0], "mission_complete", m1.id), "mission_result").reason, "expired");
    assert.equal(mission(g, m1.id).status, "available");
});

// ---------- M5 victoria ----------

test("M5 todos infectados → gana 'infected' (all_infected)", () => {
    const { g, X, H } = playing({ n: 3, seed: 4 });
    g.now += 60000;
    g.near(H[0], X, 20);
    g.act(X, "infect");
    g.now += 120000;
    g.near(H[1], X, 20);
    const r = g.act(X, "infect");
    assert.equal(g.state.phase, "ended");
    assert.deepEqual([g.state.results.winner, g.state.results.reason], ["infected", "all_infected"]);
    assert.deepEqual(one(r, "match_ended"), { eid: g.state.eid, kind: "match_ended", winner: "infected" });
    assert.equal(g.state.resultsEndsAt, g.now + 15000);
});

test("M5 tiempo agotado → gana 'infected' (time)", () => {
    const { g } = playing({ n: 3, seed: 4 });
    g.now = g.state.endsAt - 1;
    assert.equal(g.advance().changed, false);
    g.now = g.state.endsAt;
    g.advance();
    assert.deepEqual([g.state.phase, g.state.results.winner, g.state.results.reason], ["ended", "infected", "time"]);
});

test("M5 sin infectados (el único sale pasada la gracia) → gana 'players' (no_infected)", () => {
    const { g, X } = playing({ n: 4, seed: 4 });
    g.leave(X);
    g.advance();
    g.now += 60000;
    assert.equal(g.advance().changed, false, "a los 60000 ms sigue en gracia");
    g.now += 1;
    g.advance();
    assert.deepEqual([g.state.phase, g.state.results.winner, g.state.results.reason], ["ended", "players", "no_infected"]);
    assert.ok(!g.state.results.players.some((p) => p.userId === X), "ya no está en el roster");
});

test("M5 roster con menos de 2 → partida cancelada y open_world limpio", () => {
    const { g, H } = playing({ n: 2, seed: 4, cfg: { MIN_PLAYERS_TO_START: 2 } });
    g.leave(H[0]);
    g.advance();
    g.now += 60001;
    const r = g.advance();
    assert.deepEqual(one(r, "match_cancelled"), { eid: g.state.eid, kind: "match_cancelled", reason: "not_enough_players" });
    assert.equal(only(r, "match_ended").length, 0, "se cancela antes de evaluar la victoria");
    assert.equal(g.state.phase, "open_world");
    assert.deepEqual([g.state.roster, g.state.missions, g.state.cure, g.state.results], [{}, [], 0, null]);
    assert.equal(g.state.matchId, 1);
});

test("M5 la cura tiene prioridad sobre las demás condiciones", () => {
    const { g } = playing({ n: 3, seed: 4 });
    const crafted = structuredClone(g.state);
    crafted.cure = 100;
    for (const m of Object.values(crafted.roster)) m.role = "infected";
    g.state = crafted;
    g.now = crafted.endsAt + 1;
    g.advance();
    assert.deepEqual([g.state.results.winner, g.state.results.reason], ["players", "cure"]);
});

// ---------- M6 gracia ----------

test("M6 gracia: desconectado conserva su rol; vuelve dentro de 60 s sin su misión", () => {
    const { g, X, H } = playing({ n: 3, seed: 4 });
    const A = H[0];
    const m = g.state.missions[0];
    g.at(A, m.x, m.y);
    g.act(A, "mission_start", m.id);
    const saved = g.pos.get(A);
    g.leave(A);
    g.advance();
    assert.deepEqual([g.state.roster[A].connected, g.state.roster[A].disconnectedAt], [false, g.now]);
    assert.equal(mission(g, m.id).status, "available", "la misión se libera de inmediato");
    g.now += 59999;
    g.pos.set(A, saved);
    g.advance();
    assert.deepEqual([g.state.roster[A].connected, g.state.roster[A].disconnectedAt, g.role(A)], [true, null, "healthy"]);
    assert.equal(g.role(X), "infected");
    assert.equal(mission(g, m.id).status, "available", "no recupera la misión");
});

test("M6 pasada la gracia sale del roster y se reevalúa la victoria", () => {
    const { g, X, H } = playing({ n: 3, seed: 4 });
    const [A, B] = H;
    g.now += 60000;
    g.near(B, X, 20);
    g.act(X, "infect"); // B infectada: queda A como único sano
    g.leave(A);
    g.advance();
    g.now += 60001;
    g.advance();
    assert.ok(!Object.hasOwn(g.state.roster, A) || g.state.phase === "ended");
    assert.deepEqual([g.state.phase, g.state.results.reason], ["ended", "all_infected"]);
});

// ---------- M7 fin de la partida ----------

test("M7 ended → open_world a los RESULTS_MS; matchId se conserva y eid sigue creciendo", () => {
    const { g } = playing({ n: 3, seed: 4 });
    g.now = g.state.endsAt;
    g.advance();
    assert.equal(g.state.phase, "ended");
    const eidAtEnd = g.state.eid;
    g.now = g.state.resultsEndsAt - 1;
    assert.equal(g.advance().changed, false);
    g.now += 1;
    g.advance();
    assert.equal(g.state.phase, "open_world");
    assert.deepEqual([g.state.roster, g.state.missions, g.state.cure, g.state.results, g.state.resultsEndsAt], [{}, [], 0, null, null]);
    assert.equal(g.state.matchId, 1);
    assert.equal(g.state.eid, eidAtEnd, "eid no se reinicia");
    // Siguiente partida: matchId 2 y eventos con eid mayores
    const r = g.start();
    assert.equal(g.state.matchId, 2);
    for (const e of r.events) assert.ok(e.eid > eidAtEnd);
});

// ---------- M8 vistas ----------

const VIEW_MISSION_KEYS = ["id", "kind", "stationId", "status", "title", "x", "y", "zoneId"];

test("M8 vistas en partida: cada uno ve SOLO su rol; nada de roles, ids ni nombres ajenos", () => {
    const { g, X, H } = playing({ n: 5, seed: 6 });
    g.now += 60000;
    g.near(H[0], X, 20);
    g.act(X, "infect"); // 2 infectados: X y H[0]
    const m = g.state.missions[0];
    g.at(H[1], m.x, m.y);
    g.act(H[1], "mission_start", m.id);
    g.at("zz-espectador", 600, 400);

    for (const id of [...Object.keys(g.state.roster), "zz-espectador"]) {
        const view = g.view(id);
        const json = JSON.stringify(view);
        for (const [other, p] of g.pos) {
            if (other === id) continue;
            assert.ok(!json.includes(other), `la vista de ${id} no contiene el id ${other}`);
            assert.ok(!json.includes(p.username), `la vista de ${id} no contiene a ${p.username}`);
        }
        assert.ok(!/"(roster|by|results|role)s?":\s*\{/.test(json.replace(/"you":\{"role"/, "")), "sin mapas de roles");
        assert.ok(!("results" in view), "en playing no hay results");
        for (const vm of view.missions) assert.deepEqual(Object.keys(vm).sort(), VIEW_MISSION_KEYS, "misiones sin by");

        const expected = Object.hasOwn(g.state.roster, id) ? g.state.roster[id].role : "spectator";
        assert.equal(view.you.role, expected, id);
        if (expected === "healthy") assert.ok(!json.includes("infected"), `un sano (${id}) no ve la palabra infected`);
        assert.equal(view.you.infectReadyAt, expected === "infected" ? g.state.roster[id].infectReadyAt : null);
        assert.equal(view.you.missionId, id === H[1] ? m.id : null);
        assert.equal(view.you.missionStartedAt, id === H[1] ? g.now : null);
    }
    const v = g.view(H[1], 6);
    assert.deepEqual(
        [v.type, v.phase, v.minPlayers, v.connected, v.serverTime, v.startedAt, v.endsAt, v.cure, "countdownEndsAt" in v, "resultsEndsAt" in v],
        ["game", "playing", 3, 6, g.now, g.state.startedAt, g.state.endsAt, 0, false, false],
    );
});

test("M8 vistas en open_world y countdown: role null y sin datos de partida", () => {
    const g = createGame({ n: 3 });
    let v = g.view("u01");
    assert.deepEqual(v, {
        type: "game",
        serverTime: T0,
        phase: "open_world",
        minPlayers: 3,
        connected: 3,
        cure: 0,
        missions: [],
        you: { role: null, infectReadyAt: null, missionId: null, missionStartedAt: null },
    });
    g.advance();
    v = g.view("u02");
    assert.equal(v.phase, "countdown");
    assert.equal(v.countdownEndsAt, T0 + 10000);
    assert.equal(v.you.role, null);
    assert.ok(!("startedAt" in v) && !("results" in v));
});

test("M8 vista en ended: results trae los roles de todos; sin endedAt interno", () => {
    const { g, X } = playing({ n: 3, seed: 6 });
    g.now = g.state.endsAt;
    g.advance();
    const v = g.view(X);
    assert.equal(v.phase, "ended");
    assert.equal(v.resultsEndsAt, g.state.resultsEndsAt);
    assert.deepEqual(Object.keys(v.results).sort(), ["players", "reason", "winner"]);
    assert.deepEqual(
        v.results.players,
        Object.keys(g.state.roster).sort().map((id) => ({ userId: id, username: g.pos.get(id).username, role: g.state.roster[id].role })),
    );
    assert.equal(v.you.role, "infected");
    assert.equal(v.you.infectReadyAt, null, "infectReadyAt solo mientras se juega");
});

// ---------- M9 inmutabilidad ----------

test("M9 sin cambios: advance y applyAction devuelven el mismo objeto con changed:false", () => {
    const empty = deepFreeze(createMatchState());
    const ctx = { now: T0, players: [], cfg: CFG, city: CITY, rng: seededRng(1) };
    const r = advance(empty, ctx);
    assert.equal(r.state, empty);
    assert.deepEqual([r.changed, r.events], [false, []]);
    const unknown = applyAction(empty, "u01", { kind: "volar" }, ctx);
    assert.equal(unknown.state, empty);
    assert.equal(unknown.changed, false);

    const { g } = playing({ n: 3 });
    const before = g.state;
    assert.equal(g.advance().state, before, "jugando, sin novedades, el mismo objeto");
});

test("M9 el estado de entrada congelado nunca se modifica (incluido un flujo completo)", () => {
    // El arnés ya lo verifica en cada llamada; aquí, además, un flujo con todas las acciones
    const { g, X, H } = playing({ n: 4, seed: 9 });
    const m = g.state.missions[0];
    g.at(H[0], m.x, m.y);
    g.act(H[0], "mission_start", m.id);
    g.now += 8000;
    g.act(H[0], "mission_complete", m.id);
    g.act(H[1], "mission_cancel");
    g.now += 60000;
    g.near(H[2], X, 10);
    g.act(X, "infect");
    g.leave(H[1]);
    g.advance();
    g.now += 61000;
    g.advance();
    // El flujo llegó a donde debía: H[1] salió del roster, H[2] está infectado y la partida sigue
    assert.equal(g.state.phase, "playing");
    assert.deepEqual(Object.keys(g.state.roster).sort(), [X, H[0], H[2]].sort());
    assert.equal(g.role(H[2]), "infected");
    assert.equal(mission(g, m.id).status, "done");
});

// ---------- M10 consultas ----------

test("M10 frozenUserIds e isGhost; rev solo crece cuando changed es true", () => {
    const { g, H } = playing({ n: 3, seed: 4 });
    const m = g.state.missions[0];
    assert.equal(frozenUserIds(g.state).size, 0);
    g.at(H[0], m.x, m.y);
    g.act(H[0], "mission_start", m.id);
    assert.deepEqual([...frozenUserIds(g.state)], [H[0]]);
    g.now += 8000;
    g.act(H[0], "mission_complete", m.id);
    assert.equal(frozenUserIds(g.state).size, 0);

    g.at("zz", 10, 10);
    assert.equal(isGhost(g.state, "zz"), true);
    assert.equal(isGhost(g.state, H[0]), false);
    assert.equal(isGhost(createMatchState(), "zz"), false, "en open_world nadie es fantasma");

    const rev = g.state.rev;
    assert.equal(g.advance().changed, false);
    assert.equal(g.state.rev, rev);
    g.act(H[1], "mission_cancel"); // un fallo emite evento: rev + 1
    assert.equal(g.state.rev, rev + 1);
    assert.equal(frozenUserIds(createMatchState()).size, 0);
});
