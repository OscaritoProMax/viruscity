// Pruebas del núcleo de elección de líder (replication/election.js) con el simulador de clúster (Taller 7,
// decisiones 5, 6 y 7). Todas deterministas: reloj falso y rng sembrado; varias semillas por propiedad.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createElectionState, step, majorityOf } = require("../replication/election.js");
const { createSimNetwork, mulberry32, createFakeClock, DEFAULT_CFG } = require("./helpers/sim.js");

const CFG = DEFAULT_CFG; // heartbeat 2000, timeout 6000, jitter 1500
const IDS = ["auth-a", "auth-b", "auth-c"];
const FAILOVER_BOUND = CFG.LEADER_TIMEOUT_MS + CFG.ELECTION_JITTER_MS + 1000;

function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}
const noDuplicateLeaders = (net) => [...net.leadersByTerm()].every(([, set]) => set.size <= 1);
const followersOk = (net, L) => IDS.filter((id) => id !== L && net.alive(id)).every((id) => net.state(id).leaderId === L && net.state(id).role === "replica");
function elect(net, maxMs = 5000) {
    const t = net.runUntil(() => net.leaders().length === 1 && followersOk(net, net.leader()), maxMs);
    assert.notEqual(t, null, "debería haber un líder");
    return net.leader();
}

// Un nodo puro (sin simulador) para las pruebas de mensajes
function pureNode(id = "auth-a", persisted = {}, nodes = IDS, now = 0, seed = 1) {
    return createElectionState({ id, nodes, cfg: CFG, now, rng: mulberry32(seed), persisted });
}
const ctx0 = { lastSeq: 0, lastTerm: 0 };

// ---------- Utilidades ----------

test("simulador: el reloj falso ejecuta los temporizadores en orden y el rng es determinista", () => {
    const clock = createFakeClock(0);
    const log = [];
    clock.setTimeout(() => log.push(`b@${clock.now()}`), 20);
    clock.setTimeout(() => log.push(`a@${clock.now()}`), 10);
    clock.setTimeout(() => {
        log.push(`c@${clock.now()}`);
        clock.setTimeout(() => log.push(`d@${clock.now()}`), 5);
    }, 20);
    clock.advance(30);
    assert.deepEqual(log, ["a@10", "b@20", "c@20", "d@25"]);
    assert.equal(clock.now(), 30);
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
    assert.equal(majorityOf(1), 1);
    assert.equal(majorityOf(3), 2);
    assert.equal(majorityOf(4), 3);
    assert.equal(majorityOf(5), 3);
});

test("step es inmutable y persiste ANTES de anunciar una candidatura", () => {
    let s = deepFreeze(pureNode("auth-a"));
    for (const from of ["auth-b", "auth-c"]) {
        s = deepFreeze(step(s, { kind: "peer_hello", now: 10, from, hello: { role: "replica", term: 0, leaderId: null, lastSeq: 0, lastTerm: 0 } }, ctx0).state);
    }
    let actions = [];
    for (let now = 100; now <= 3000 && !actions.some((a) => a.msg?.type === "election"); now += 100) {
        ({ state: s, actions } = step(s, { kind: "tick", now }, ctx0));
        deepFreeze(s);
    }
    assert.equal(s.role, "candidate");
    assert.deepEqual(actions[0], { type: "persist", term: 1, votedFor: "auth-a" }, "persist es la primera acción");
    const iElection = actions.findIndex((a) => a.msg?.type === "election");
    assert.ok(iElection > 0);
    assert.deepEqual(actions[iElection].msg, { type: "election", candidate: "auth-a", term: 1, lastSeq: 0, lastTerm: 0 });
});

// ---------- E1 ----------

test("E1 arranque en frío con 3 nodos: exactamente un líder en menos de 3 s (30 semillas)", () => {
    for (let seed = 1; seed <= 30; seed++) {
        const net = createSimNetwork({ seed });
        const t = net.runUntil(() => net.leaders().length === 1 && followersOk(net, net.leader()), 3000);
        assert.notEqual(t, null, `semilla ${seed}`);
        assert.ok(t < 3000, `semilla ${seed}: ${t} ms`);
        net.run(10000);
        assert.equal(net.leaders().length, 1, `semilla ${seed}: sigue habiendo un solo líder`);
        assert.ok(noDuplicateLeaders(net));
    }
});

// ---------- E2 ----------

test("E2 el líder muere: una réplica asume con término+1 dentro de LEADER_TIMEOUT + JITTER + 1 s", () => {
    for (let seed = 1; seed <= 12; seed++) {
        const net = createSimNetwork({ seed });
        const L = elect(net);
        const term = net.state(L).term;
        net.run(3000);
        net.kill(L);
        const t = net.runUntil(() => net.leader() !== null && net.leader() !== L, FAILOVER_BOUND);
        assert.notEqual(t, null, `semilla ${seed}`);
        assert.ok(t <= FAILOVER_BOUND, `semilla ${seed}: ${t} ms`);
        assert.equal(net.state(net.leader()).term, term + 1, `semilla ${seed}`);
    }
});

test("E2 propiedad: en 200 semillas (con pérdidas, caídas, reinicios y particiones) nunca hay dos líderes en el mismo término", () => {
    for (let seed = 1; seed <= 200; seed++) {
        const net = createSimNetwork({ seed, lossRate: 0.05 });
        const chaos = mulberry32(seed + 999);
        net.runUntil(() => net.leader() !== null, 10000);
        for (let round = 0; round < 6; round++) {
            const victim = IDS[Math.floor(chaos() * IDS.length)];
            const action = chaos();
            if (action < 0.4) {
                net.kill(victim);
                net.run(2000 + chaos() * 8000);
                net.restart(victim);
            } else if (action < 0.7) {
                net.isolate(victim);
                net.run(3000 + chaos() * 8000);
                net.heal();
            } else {
                const L = net.leader();
                if (L) net.kill(L);
                net.run(9000);
                if (L) net.restart(L);
            }
            net.run(3000 + chaos() * 5000);
        }
        assert.ok(noDuplicateLeaders(net), `semilla ${seed}: ${JSON.stringify([...net.leadersByTerm()].map(([t, s]) => [t, [...s]]))}`);
        // Y al final, ya sin fallas, el clúster vuelve a tener un líder
        assert.notEqual(net.runUntil(() => net.leaders().length === 1, 20000), null, `semilla ${seed}: sin líder al final`);
    }
});

// ---------- E3 ----------

test("E3 restricción de elección: el log menos al día nunca gana; con logs iguales puede ganar cualquiera", () => {
    const winners = (logs) => {
        const seen = new Set();
        for (let seed = 1; seed <= 40; seed++) {
            const net = createSimNetwork({ seed, logs, start: false });
            net.restart("auth-b");
            net.restart("auth-c"); // auth-a no arranca: hay que ganar con el voto del otro
            const t = net.runUntil(() => net.leader() !== null, 20000);
            assert.notEqual(t, null, `semilla ${seed}`);
            seen.add(net.leader());
            assert.ok(noDuplicateLeaders(net));
        }
        return seen;
    };
    assert.deepEqual([...winners({ "auth-b": { seq: 5, term: 1 }, "auth-c": { seq: 3, term: 1 } })], ["auth-b"], "lastSeq menor");
    assert.deepEqual([...winners({ "auth-b": { seq: 3, term: 1 }, "auth-c": { seq: 9, term: 0 } })], ["auth-b"], "lastTerm menor aunque tenga más entradas");
    assert.deepEqual([...winners({ "auth-b": { seq: 4, term: 1 }, "auth-c": { seq: 4, term: 1 } })].sort(), ["auth-b", "auth-c"], "logs iguales: cualquiera");
});

// ---------- E4 ----------

test("E4 estabilidad: un nodo que vuelve con término alto como candidato no consigue votos; el líder sigue y lo absorbe", () => {
    for (let seed = 1; seed <= 10; seed++) {
        const net = createSimNetwork({ seed });
        const L = elect(net);
        const term = net.state(L).term;
        const R = IDS.find((id) => id !== L);
        const other = IDS.find((id) => id !== L && id !== R);
        // R vuelve como candidato con un término alto (simulado) y su plazo ya vencido
        net.patchState(R, { role: "candidate", term: term + 5, maxTerm: term + 5, votedFor: R, votes: [R], leaderId: null, electionDeadline: net.clock.now() });
        const sentBefore = net.nodes.get(other).sent.length;
        net.run(200); // su elección (término + 6) sale y llega a los demás
        const votes = net.nodes.get(other).sent.slice(sentBefore).filter((s) => s.msg.type === "vote" && s.to === R);
        assert.ok(votes.length >= 1 && votes.every((v) => v.msg.voteGranted === false), `semilla ${seed}: la otra réplica no le vota`);
        assert.equal(net.state(other).term, term, "la otra réplica no adopta su término");
        assert.equal(net.state(L).role, "leader");
        assert.equal(net.state(L).term, term, "el líder conserva el liderazgo y su término");
        // Al oír el heartbeat del líder, lo sigue
        const t = net.runUntil(() => net.state(R).leaderId === L && net.state(R).role === "replica", CFG.AUTH_HEARTBEAT_MS + 500);
        assert.notEqual(t, null, `semilla ${seed}: sigue al líder`);
        net.run(20000);
        assert.equal(net.leader(), L, `semilla ${seed}: el mismo líder 20 s después`);
        assert.equal(net.state(L).term, term);
        assert.ok(noDuplicateLeaders(net));
    }
});

// ---------- E5 ----------

test("E5 lease: el líder aislado se baja en LEADER_TIMEOUT; la mayoría elige otro; al sanar, el viejo lo sigue", () => {
    for (let seed = 1; seed <= 10; seed++) {
        const net = createSimNetwork({ seed });
        const L = elect(net);
        const term = net.state(L).term;
        net.run(2500);
        net.isolate(L);
        const tDown = net.runUntil(() => net.state(L).role !== "leader", CFG.LEADER_TIMEOUT_MS + 200);
        assert.notEqual(tDown, null, `semilla ${seed}: el líder aislado se baja`);
        assert.equal(net.state(L).leaderId, null, "sin líder conocido");
        const tNew = net.runUntil(() => net.leaders().some((id) => id !== L), FAILOVER_BOUND);
        assert.notEqual(tNew, null, `semilla ${seed}: el lado mayoritario elige`);
        const N = net.leader();
        assert.ok(net.state(N).term > term);
        net.run(15000); // sigue aislado varios plazos de elección: sin mayoría conectada no se postula
        assert.equal(net.state(L).term, term, "aislado no infla su término");
        assert.notEqual(net.state(L).role, "candidate");
        net.heal();
        const tBack = net.runUntil(() => net.state(L).leaderId === N && net.state(L).role === "replica", 3000);
        assert.notEqual(tBack, null, `semilla ${seed}: el viejo sigue al nuevo`);
        assert.equal(net.state(L).term, net.state(N).term, "al ver el término mayor lo adopta");
        assert.equal(net.leader(), N);
        assert.ok(noDuplicateLeaders(net));
    }
});

// ---------- E6 ----------

test("E6 reincorporación: el nodo de id más bajo que se reinicia sigue al líder y nunca recupera el liderazgo por su id", () => {
    for (let seed = 1; seed <= 12; seed++) {
        const net = createSimNetwork({ seed });
        let L = elect(net);
        const low = "auth-a";
        net.kill(low);
        if (L === low) L = (net.runUntil(() => net.leader() !== null, FAILOVER_BOUND), net.leader());
        assert.ok(L && L !== low);
        net.run(4000);
        const mark = net.history.length;
        net.restart(low);
        const t = net.runUntil(() => net.state(low).leaderId === L, 3000);
        assert.notEqual(t, null, `semilla ${seed}: adopta al líder`);
        net.run(60000);
        assert.ok(!net.history.slice(mark).some((h) => h.id === low && h.role === "leader"), `semilla ${seed}: nunca líder por su id`);
        assert.equal(net.leader(), L);
    }
});

// ---------- E7 ----------

test("E7 voto dividido: dos candidatos a la vez se resuelven en pocas rondas", () => {
    for (let seed = 1; seed <= 30; seed++) {
        const net = createSimNetwork({ seed });
        const L = elect(net);
        const term = net.state(L).term;
        net.kill(L);
        const [x, y] = IDS.filter((id) => id !== L);
        const now = net.clock.now();
        // Mismo plazo forzado y tick en el mismo instante: los dos se postulan a la vez
        net.patchState(x, { electionDeadline: now, lastLeaderContactAt: now - CFG.LEADER_TIMEOUT_MS });
        net.patchState(y, { electionDeadline: now, lastLeaderContactAt: now - CFG.LEADER_TIMEOUT_MS });
        net.inject(x, { kind: "tick" });
        net.inject(y, { kind: "tick" });
        assert.equal(net.state(x).role, "candidate");
        assert.equal(net.state(y).role, "candidate");
        assert.equal(net.state(x).term, net.state(y).term, "mismo término: voto dividido");
        const t = net.runUntil(() => net.leader() !== null, 15000);
        assert.notEqual(t, null, `semilla ${seed}`);
        assert.ok(net.state(net.leader()).term <= term + 4, `semilla ${seed}: término ${net.state(net.leader()).term} (pocas rondas)`);
        assert.ok(noDuplicateLeaders(net));
    }
});

// ---------- E8 ----------

test("E8 persistencia: tras reiniciar con votedFor en el término T, no vota por otro en T", () => {
    const s = pureNode("auth-a", { term: 4, votedFor: "auth-b" }, IDS, 100_000);
    assert.equal(s.term, 4);
    const election = (from, term) => ({ kind: "message", now: 100_000, from, msg: { type: "election", candidate: from, term, lastSeq: 0, lastTerm: 0 } });
    let r = step(s, election("auth-c", 4), ctx0);
    assert.deepEqual(r.actions.at(-1), { type: "send", to: "auth-c", msg: { type: "vote", voter: "auth-a", term: 4, voteGranted: false } });
    assert.equal(r.state.votedFor, "auth-b");
    r = step(s, election("auth-b", 4), ctx0);
    assert.equal(r.actions.at(-1).msg.voteGranted, true, "al mismo candidato sí (repetición)");
    // En un término nuevo vuelve a poder votar, y lo persiste antes de contestar
    r = step(s, election("auth-c", 5), ctx0);
    assert.deepEqual(r.actions[0], { type: "persist", term: 5, votedFor: "auth-c" });
    assert.equal(r.actions.at(-1).msg.voteGranted, true);
    // Y con el simulador: reinicio entre medio
    const net = createSimNetwork({ seed: 3, start: false });
    net.setPersisted("auth-a", { term: 7, votedFor: "auth-b" });
    net.restart("auth-a");
    net.inject("auth-a", { kind: "message", from: "auth-c", msg: { type: "election", candidate: "auth-c", term: 7, lastSeq: 0, lastTerm: 0 } });
    assert.equal(net.state("auth-a").votedFor, "auth-b");
    assert.equal(net.nodes.get("auth-a").sent.at(-1).msg.voteGranted, false);
});

// ---------- E9 ----------

test("E9 nodo único: líder desde el primer tick con el término persistido + 1", () => {
    const s = createElectionState({ id: "auth-solo", nodes: ["auth-solo"], cfg: CFG, now: 0, rng: mulberry32(1), persisted: { term: 3, votedFor: null } });
    const r = step(s, { kind: "tick", now: 100 }, ctx0);
    assert.equal(r.state.role, "leader");
    assert.equal(r.state.term, 4);
    assert.deepEqual(r.actions.slice(0, 2), [{ type: "persist", term: 4, votedFor: "auth-solo" }, { type: "became", role: "leader", term: 4, leaderId: "auth-solo" }]);
    assert.ok(!r.actions.some((a) => a.type === "broadcast"), "sin peers no hay mensajes");
    const net = createSimNetwork({ ids: ["auth-solo"], seed: 1 });
    net.run(150);
    assert.equal(net.leader(), "auth-solo");
    net.run(60000);
    assert.equal(net.state("auth-solo").term, 1, "y no cambia de término");
});

// ---------- E10 ----------

test("E10 clúster de 5: elige con 2 caídos; con 3 caídos no hay líder posible", () => {
    const ids5 = ["auth-a", "auth-b", "auth-c", "auth-d", "auth-e"];
    for (let seed = 1; seed <= 8; seed++) {
        const net = createSimNetwork({ ids: ids5, seed });
        assert.notEqual(net.runUntil(() => net.leaders().length === 1, 4000), null);
        const L = net.leader();
        const others = ids5.filter((id) => id !== L);
        net.kill(L);
        net.kill(others[0]);
        const t = net.runUntil(() => net.leader() !== null, FAILOVER_BOUND);
        assert.notEqual(t, null, `semilla ${seed}: 3 de 5 eligen`);
        const L2 = net.leader();
        // Cae uno más (3 caídos): no hay mayoría; el líder se baja por el lease y nadie gana
        net.kill(ids5.find((id) => id !== L2 && net.alive(id)));
        net.run(CFG.LEADER_TIMEOUT_MS + 500);
        assert.equal(net.leaders().length, 0, `semilla ${seed}: sin líder con 2 de 5`);
        const mark = net.history.length;
        net.run(30000);
        assert.ok(!net.history.slice(mark).some((h) => h.role === "leader"), "nadie gana sin mayoría");
        assert.ok(noDuplicateLeaders(net));
    }
});

// ---------- E11 ----------

test("E11 remitentes desconocidos o campos que no coinciden se ignoran; términos viejos se contestan con el actual", () => {
    // auth-a sigue al líder auth-b en el término 3
    let s = pureNode("auth-a", { term: 0 }, IDS, 1000);
    s = step(s, { kind: "peer_hello", now: 1000, from: "auth-c", hello: { role: "replica", term: 3, leaderId: "auth-b", lastSeq: 0, lastTerm: 0 } }, ctx0).state;
    s = step(s, { kind: "message", now: 1000, from: "auth-b", msg: { type: "heartbeat", authId: "auth-b", term: 3, lastSeq: 0, lastTerm: 0 } }, ctx0).state;
    assert.deepEqual([s.role, s.leaderId, s.term], ["replica", "auth-b", 3]);
    deepFreeze(s);
    const ignored = [
        ["auth-z", { type: "heartbeat", authId: "auth-z", term: 9, lastSeq: 0, lastTerm: 0 }], // desconocido
        ["auth-a", { type: "heartbeat", authId: "auth-a", term: 9, lastSeq: 0, lastTerm: 0 }], // uno mismo
        ["auth-c", { type: "heartbeat", authId: "auth-b", term: 9, lastSeq: 0, lastTerm: 0 }], // authId ≠ from
        ["auth-c", { type: "election", candidate: "auth-b", term: 9, lastSeq: 0, lastTerm: 0 }], // candidate ≠ from
        ["auth-c", { type: "vote", voter: "auth-b", term: 9, voteGranted: true }], // voter ≠ from
        ["auth-c", { type: "new_leader", leader: "auth-b", term: 9 }], // leader ≠ from
        ["auth-c", { type: "heartbeat_ack", authId: "auth-b", term: 9, lastSeq: 0 }],
        ["auth-c", { type: "heartbeat", authId: "auth-c", term: "9", lastSeq: 0, lastTerm: 0 }], // término no entero
        ["auth-c", { type: "desconocido", term: 9 }],
        ["auth-c", null],
    ];
    for (const [from, msg] of ignored) {
        const r = step(s, { kind: "message", now: 1100, from, msg }, ctx0);
        assert.deepEqual(r.actions, [], JSON.stringify(msg));
        assert.deepEqual(r.state, s, JSON.stringify(msg));
    }
    // Término viejo: elección y heartbeat de un líder viejo se contestan con el término actual sin cambiar nada
    let r = step(s, { kind: "message", now: 1100, from: "auth-c", msg: { type: "election", candidate: "auth-c", term: 2, lastSeq: 9, lastTerm: 9 } }, ctx0);
    assert.deepEqual(r.actions, [{ type: "send", to: "auth-c", msg: { type: "vote", voter: "auth-a", term: 3, voteGranted: false } }]);
    assert.deepEqual(r.state, s);
    r = step(s, { kind: "message", now: 1100, from: "auth-c", msg: { type: "heartbeat", authId: "auth-c", term: 2, lastSeq: 0, lastTerm: 0 } }, ctx0);
    assert.deepEqual(r.actions, [{ type: "send", to: "auth-c", msg: { type: "heartbeat_ack", authId: "auth-a", term: 3, lastSeq: 0 } }]);
    assert.deepEqual(r.state, s);
    // Un hello mal formado no conecta a nadie
    r = step(s, { kind: "peer_hello", now: 1100, from: "auth-c", hello: { role: "jefe", term: 1, leaderId: null, lastSeq: 0 } }, ctx0);
    assert.deepEqual(r.state, s);
});

test("heartbeat del líder: ack, leaderSeq y request_sync cuando falta log; el líder viejo se baja con un ack de término mayor", () => {
    let s = pureNode("auth-a", {}, IDS, 0);
    let r = step(s, { kind: "message", now: 50, from: "auth-b", msg: { type: "heartbeat", authId: "auth-b", term: 2, lastSeq: 8, lastTerm: 2 } }, { lastSeq: 5, lastTerm: 2 });
    assert.deepEqual([r.state.leaderId, r.state.term, r.state.leaderSeq], ["auth-b", 2, 8]);
    assert.deepEqual(r.actions.filter((a) => a.type !== "persist" && a.type !== "became"), [
        { type: "request_sync", to: "auth-b" },
        { type: "send", to: "auth-b", msg: { type: "heartbeat_ack", authId: "auth-a", term: 2, lastSeq: 5 } },
    ]);
    r = step(r.state, { kind: "message", now: 2050, from: "auth-b", msg: { type: "heartbeat", authId: "auth-b", term: 2, lastSeq: 8, lastTerm: 2 } }, { lastSeq: 8, lastTerm: 2 });
    assert.ok(!r.actions.some((a) => a.type === "request_sync"), "al día: no pide sync");
    // Líder en término 2 que recibe un ack con término 3 → réplica sin líder
    s = { ...pureNode("auth-b", { term: 2, votedFor: "auth-b" }), role: "leader", leaderId: "auth-b", connected: ["auth-a", "auth-c"] };
    r = step(s, { kind: "message", now: 100, from: "auth-a", msg: { type: "heartbeat_ack", authId: "auth-a", term: 3, lastSeq: 0 } }, ctx0);
    assert.deepEqual([r.state.role, r.state.term, r.state.leaderId], ["replica", 3, null]);
    assert.deepEqual(r.actions.slice(0, 2), [{ type: "persist", term: 3, votedFor: null }, { type: "became", role: "replica", term: 3, leaderId: null }]);
});

// ---------- E12 ----------

test("E12 elección de arranque: si un peer reporta líder en su hello, se espera su heartbeat y no hay elección temprana", () => {
    const run = (reportedLeader) => {
        let s = pureNode("auth-a", {}, IDS, 0, 5);
        s = step(s, { kind: "peer_hello", now: 10, from: "auth-b", hello: { role: "replica", term: 1, leaderId: reportedLeader, lastSeq: 0, lastTerm: 0 } }, ctx0).state;
        for (let now = 100; now <= CFG.LEADER_TIMEOUT_MS - 100; now += 100) {
            const r = step(s, { kind: "tick", now }, ctx0);
            s = r.state;
            if (r.actions.some((a) => a.msg?.type === "election")) return now;
        }
        return null;
    };
    assert.equal(run("auth-c"), null, "un peer reporta líder (auth-c): sin elección de arranque");
    const early = run(null);
    assert.ok(early !== null && early >= 500 && early <= 1600, `sin líder reportado: elección a los ${early} ms (500..1500 + tick)`);
    // Y un hello de un líder con término >= al propio se adopta de inmediato
    const s = pureNode("auth-a", { term: 1 }, IDS, 0);
    const r = step(s, { kind: "peer_hello", now: 10, from: "auth-c", hello: { role: "leader", term: 2, leaderId: "auth-c", lastSeq: 0, lastTerm: 0 } }, ctx0);
    assert.deepEqual([r.state.role, r.state.leaderId, r.state.term], ["replica", "auth-c", 2]);
});
