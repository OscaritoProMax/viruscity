// Simulador del clúster de auth para las pruebas del núcleo de elección (Taller 7). Sin sockets ni BD:
// reloj falso, rng sembrado y una red en memoria con retardo, pérdida, particiones, caídas y reinicios.
//
// mulberry32(seed) → rng determinista en [0, 1)
// createFakeClock(start) → { now(), setTimeout(fn, ms) → id, clearTimeout(id), advance(ms), advanceAsync(ms) }
//   advance ejecuta en orden los vencidos; advanceAsync además deja correr las promesas entre uno y otro
// createReplicationSim({ ids, cfg, seed, delayMs, loss, dbs }) → clúster de nodos de replicación REALES (N3)
//   sobre BD ':memory:', con transporte en memoria (retardo, pérdidas por tipo de mensaje, filtros y particiones),
//   caídas y reinicios (el reinicio conserva la BD: oplog, users y meta). Ver los métodos al final.
// createSimNetwork({ ids, cfg, seed, delayMs, lossRate, tickMs, logs }) → red; ver los métodos al final.
//   - Cada nodo corre createElectionState/step con su propio rng sembrado y un log simulado { seq, term }.
//   - Un reinicio conserva term/votedFor persistidos y el log, y pierde todo lo demás.
//   - partition(a, b) corta el par en los dos sentidos (cada lado recibe peer_down); heal() lo restablece con
//     un nuevo handshake (peer_hello en los dos sentidos).
//   - Cada nodo hace tick cada tickMs con una fase propia al azar (los procesos reales no laten alineados).
//   - request_sync copia el log del líder al nodo que lo pidió (tras un retardo), como haría la sincronización.
"use strict";

const { createElectionState, step } = require("../../replication/election.js");

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createFakeClock(start = 0) {
    let t = start;
    let seq = 0;
    const timers = []; // { at, seq, fn }
    return {
        now: () => t,
        setTimeout(fn, ms = 0) {
            const id = seq++;
            timers.push({ at: t + Math.max(0, ms), seq: id, fn });
            return id;
        },
        clearTimeout(id) {
            const i = timers.findIndex((x) => x.seq === id);
            if (i !== -1) timers.splice(i, 1);
        },
        pending: () => timers.length,
        // Avanza ms; los temporizadores vencen en orden de hora y, a igual hora, de creación
        advance(ms) {
            const end = t + ms;
            for (;;) {
                let best = -1;
                for (let i = 0; i < timers.length; i++) {
                    const x = timers[i];
                    if (x.at <= end && (best === -1 || x.at < timers[best].at || (x.at === timers[best].at && x.seq < timers[best].seq))) best = i;
                }
                if (best === -1) break;
                const [timer] = timers.splice(best, 1);
                t = Math.max(t, timer.at);
                timer.fn();
            }
            t = end;
        },
        // Como advance, pero tras cada temporizador deja correr las promesas (código async de los nodos)
        async advanceAsync(ms) {
            const end = t + ms;
            for (;;) {
                await new Promise((r) => setImmediate(r));
                let best = -1;
                for (let i = 0; i < timers.length; i++) {
                    const x = timers[i];
                    if (x.at <= end && (best === -1 || x.at < timers[best].at || (x.at === timers[best].at && x.seq < timers[best].seq))) best = i;
                }
                if (best === -1) break;
                const [timer] = timers.splice(best, 1);
                t = Math.max(t, timer.at);
                timer.fn();
            }
            t = end;
            await new Promise((r) => setImmediate(r));
        },
    };
}

const DEFAULT_CFG = { AUTH_HEARTBEAT_MS: 2000, LEADER_TIMEOUT_MS: 6000, ELECTION_JITTER_MS: 1500 };

function createSimNetwork({ ids = ["auth-a", "auth-b", "auth-c"], cfg = DEFAULT_CFG, seed = 1, delayMs = 5, lossRate = 0, tickMs = 100, logs = {}, start = true } = {}) {
    const clock = createFakeClock(0);
    const netRng = mulberry32(seed * 7919 + 13);
    const nodes = new Map();
    const blocked = new Set(); // "a|b" ordenado
    const history = []; // acciones 'became' { at, id, role, term, leaderId }
    const syncRequests = [];
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const cut = (a, b) => blocked.has(key(a, b));

    function makeState(id, persisted) {
        const n = nodes.get(id);
        return createElectionState({ id, nodes: ids, cfg, now: clock.now(), rng: n.rng, persisted });
    }

    ids.forEach((id, i) => {
        nodes.set(id, { id, alive: false, state: null, log: { ...(logs[id] ?? { seq: 0, term: 0 }) }, persisted: { term: 0, votedFor: null }, rng: mulberry32(seed * 1000 + i + 1), sent: [] });
    });

    function apply(id, event) {
        const n = nodes.get(id);
        if (!n.alive) return;
        const before = n.state;
        const { state, actions } = step(before, event, { lastSeq: n.log.seq, lastTerm: n.log.term });
        n.state = state;
        for (const a of actions) {
            if (a.type === "persist") n.persisted = { term: a.term, votedFor: a.votedFor };
            else if (a.type === "became") history.push({ at: clock.now(), id, role: a.role, term: a.term, leaderId: a.leaderId });
            else if (a.type === "send") deliver(id, a.to, a.msg);
            else if (a.type === "broadcast") for (const to of state.connected) deliver(id, to, a.msg);
            else if (a.type === "request_sync") requestSync(id, a.to);
        }
        return actions;
    }

    function deliver(from, to, msg) {
        const src = nodes.get(from);
        src.sent.push({ at: clock.now(), to, msg });
        if (!nodes.get(to)?.alive || cut(from, to) || netRng() < lossRate) return;
        const epoch = nodes.get(to).epoch;
        clock.setTimeout(() => {
            const dst = nodes.get(to);
            // Un mensaje en vuelo no llega a una instancia nueva del nodo, ni cruza una partición nueva
            if (!dst.alive || dst.epoch !== epoch || cut(from, to) || !nodes.get(from).alive) return;
            apply(to, { kind: "message", now: clock.now(), from, msg });
        }, delayMs);
    }

    function requestSync(id, leader) {
        syncRequests.push({ at: clock.now(), id, leader });
        clock.setTimeout(() => {
            const n = nodes.get(id);
            const l = nodes.get(leader);
            if (n.alive && l.alive && !cut(id, leader) && (l.log.seq > n.log.seq)) n.log = { ...l.log };
        }, delayMs * 2);
    }

    const helloOf = (id) => {
        const n = nodes.get(id);
        const s = n.state;
        return { role: s.role === "leader" ? "leader" : "replica", term: s.term, leaderId: s.leaderId, lastSeq: n.log.seq, lastTerm: n.log.term };
    };

    function handshake(a, b) {
        if (!nodes.get(a).alive || !nodes.get(b).alive || cut(a, b)) return;
        clock.setTimeout(() => {
            if (!nodes.get(a).alive || !nodes.get(b).alive || cut(a, b)) return;
            const ha = helloOf(a);
            const hb = helloOf(b);
            apply(a, { kind: "peer_hello", now: clock.now(), from: b, hello: hb });
            apply(b, { kind: "peer_hello", now: clock.now(), from: a, hello: ha });
        }, delayMs);
    }

    function down(a, b) {
        for (const [x, y] of [[a, b], [b, a]]) if (nodes.get(x).alive) apply(x, { kind: "peer_down", now: clock.now(), from: y });
    }

    function scheduleTick(id, epoch, first = tickMs) {
        clock.setTimeout(() => {
            const n = nodes.get(id);
            if (!n.alive || n.epoch !== epoch) return;
            apply(id, { kind: "tick", now: clock.now() });
            scheduleTick(id, epoch);
        }, first);
    }
    const phase = () => 1 + Math.floor(netRng() * tickMs);

    function boot(id) {
        const n = nodes.get(id);
        n.alive = true;
        n.epoch = (n.epoch ?? 0) + 1;
        n.state = makeState(id, n.persisted);
        scheduleTick(id, n.epoch, phase());
        for (const other of ids) if (other !== id) handshake(id, other);
    }

    const net = {
        clock,
        nodes,
        history,
        syncRequests,
        start() {
            for (const id of ids) {
                const n = nodes.get(id);
                n.alive = true;
                n.epoch = 1;
                n.state = makeState(id, n.persisted);
                scheduleTick(id, n.epoch, phase());
            }
            for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) handshake(ids[i], ids[j]);
        },
        run: (ms) => clock.advance(ms),
        // Avanza de a 100 ms hasta que pred() sea verdadero o se agote maxMs; devuelve los ms usados o null
        runUntil(pred, maxMs = 30000, every = 100) {
            const start0 = clock.now();
            while (clock.now() - start0 <= maxMs) {
                if (pred()) return clock.now() - start0;
                clock.advance(every);
            }
            return pred() ? clock.now() - start0 : null;
        },
        state: (id) => nodes.get(id).state,
        alive: (id) => nodes.get(id).alive,
        leaders: () => ids.filter((id) => nodes.get(id).alive && nodes.get(id).state.role === "leader"),
        leader() {
            const l = net.leaders();
            return l.length === 1 ? l[0] : null;
        },
        kill(id) {
            const n = nodes.get(id);
            if (!n.alive) return;
            n.alive = false;
            for (const other of ids) if (other !== id && nodes.get(other).alive) apply(other, { kind: "peer_down", now: clock.now(), from: id });
        },
        restart: (id) => boot(id),
        partition(a, b) {
            if (cut(a, b)) return;
            blocked.add(key(a, b));
            down(a, b);
        },
        isolate(id) {
            for (const other of ids) if (other !== id) net.partition(id, other);
        },
        heal() {
            const pairs = [...blocked];
            blocked.clear();
            for (const p of pairs) {
                const [a, b] = p.split("|");
                handshake(a, b);
            }
        },
        setLog(id, log) {
            nodes.get(id).log = { ...log };
        },
        // Para forzar escenarios (E4, E7): reemplaza campos del estado de un nodo vivo
        patchState(id, fields) {
            const n = nodes.get(id);
            n.state = { ...n.state, ...fields };
        },
        setPersisted(id, persisted) {
            nodes.get(id).persisted = { ...persisted };
        },
        inject: (id, event) => apply(id, { now: clock.now(), ...event }),
        // Propiedad de seguridad: nunca dos líderes distintos en el mismo término
        leadersByTerm() {
            const byTerm = new Map();
            for (const h of history) {
                if (h.role !== "leader") continue;
                if (!byTerm.has(h.term)) byTerm.set(h.term, new Set());
                byTerm.get(h.term).add(h.id);
            }
            return byTerm;
        },
    };
    if (start) net.start();
    return net;
}

// ---------- Fase N3: clúster de nodos de replicación reales ----------

const REPL_CFG = { ...DEFAULT_CFG, READ_TOLERANCE: 10, WRITE_TIMEOUT_MS: 3000, ACK_GRACE_MS: 150, SYNC_BATCH: 500 };
const TEST_HASH = "$2a$10$abcdefghijklmnopqrstuuJ0pQxS6m1wYqk2v1q3m1E4v5Z6x7y8z";

function createReplicationSim({ ids = ["auth-a", "auth-b", "auth-c"], cfg = REPL_CFG, seed = 1, delayMs = 5, loss = {}, dbs = {}, start = true, log } = {}) {
    const { DatabaseSync } = require("node:sqlite");
    const { ensureSchema, nextUserId } = require("../../oplog.js");
    const { createReplicationNode } = require("../../replication/node.js");
    const clock = createFakeClock(0);
    const netRng = mulberry32(seed * 7919 + 17);
    const defs = ids.map((id, i) => ({ id, publicUrl: `http://localhost:${4001 + i}`, peerUrl: `ws://localhost:${4101 + i}` }));
    const blocked = new Set();
    const filters = new Set();
    const linkDelay = new Map(); // "from>to" → ms (retardo propio de un enlace)
    const messages = []; // { at, from, to, type, delivered }
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const cut = (a, b) => blocked.has(key(a, b));
    const slots = new Map();
    ids.forEach((id, i) => {
        let db = dbs[id];
        if (!db) {
            db = new DatabaseSync(":memory:");
            ensureSchema(db, { dbPath: ":memory:" });
        }
        slots.set(id, { id, db, node: null, alive: false, epoch: 0, links: new Set(), rng: mulberry32(seed * 1000 + i + 1) });
    });

    function deliver(from, to, msg) {
        const record = { at: clock.now(), from, to, type: msg?.type, msg, delivered: false };
        messages.push(record);
        const dst = slots.get(to);
        const src = slots.get(from);
        if (!dst?.alive || !src.links.has(to) || cut(from, to)) return;
        if ((loss[msg?.type] ?? 0) > 0 && netRng() < loss[msg.type]) return;
        for (const f of filters) if (f(from, to, msg)) return;
        const epoch = dst.epoch;
        const srcEpoch = src.epoch;
        clock.setTimeout(() => {
            if (!dst.alive || dst.epoch !== epoch || src.epoch !== srcEpoch || !dst.links.has(from) || cut(from, to)) return;
            record.delivered = true;
            dst.node.handleMessage(from, structuredClone(msg));
        }, linkDelay.get(`${from}>${to}`) ?? delayMs);
    }

    function boot(id) {
        const slot = slots.get(id);
        slot.alive = true;
        slot.epoch += 1;
        slot.links = new Set();
        slot.node = createReplicationNode({
            id,
            nodes: defs,
            cfg,
            db: slot.db,
            transport: { send: (to, msg) => deliver(id, to, msg), connectedIds: () => [...slot.links] },
            clock,
            rng: slot.rng,
            log,
        });
    }

    function handshake(a, b) {
        const A = slots.get(a);
        const B = slots.get(b);
        if (!A.alive || !B.alive || cut(a, b) || A.links.has(b)) return;
        A.links.add(b);
        B.links.add(a);
        const ea = A.epoch;
        const eb = B.epoch;
        clock.setTimeout(() => {
            if (!A.alive || !B.alive || A.epoch !== ea || B.epoch !== eb || cut(a, b)) return;
            const ha = A.node.helloInfo();
            const hb = B.node.helloInfo();
            A.node.peerUp(b, hb);
            B.node.peerUp(a, ha);
        }, delayMs);
    }

    function unlink(a, b) {
        const A = slots.get(a);
        const B = slots.get(b);
        const had = A.links.delete(b) | B.links.delete(a);
        if (!had) return;
        if (A.alive) A.node.peerDown(b);
        if (B.alive) B.node.peerDown(a);
    }

    const sim = {
        clock,
        ids,
        defs,
        messages,
        node: (id) => slots.get(id).node,
        db: (id) => slots.get(id).db,
        alive: (id) => slots.get(id).alive,
        start() {
            for (const id of ids) if (!slots.get(id).alive) boot(id);
            for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) handshake(ids[i], ids[j]);
        },
        startOnly(list) {
            for (const id of list) boot(id);
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) handshake(list[i], list[j]);
        },
        run: (ms) => clock.advanceAsync(ms),
        async runUntil(pred, maxMs = 20000, every = 50) {
            const t0 = clock.now();
            while (clock.now() - t0 <= maxMs) {
                if (pred()) return clock.now() - t0;
                await clock.advanceAsync(every);
            }
            return pred() ? clock.now() - t0 : null;
        },
        // Espera a que la promesa termine haciendo correr el reloj; devuelve su resultado
        async settle(promise, maxMs = 20000) {
            let done = false;
            let value;
            let error;
            promise.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
            const t0 = clock.now();
            while (!done) {
                if (clock.now() - t0 > maxMs) throw new Error("settle: la promesa no terminó a tiempo");
                await clock.advanceAsync(5);
            }
            if (error) throw error;
            return value;
        },
        leaders: () => ids.filter((id) => slots.get(id).alive && slots.get(id).node.whoami().role === "leader"),
        leader() {
            const l = sim.leaders();
            return l.length === 1 ? l[0] : null;
        },
        // Un líder y todos los demás vivos siguiéndolo
        async elect(maxMs = 10000) {
            const t = await sim.runUntil(() => {
                const l = sim.leader();
                return l && ids.filter((id) => slots.get(id).alive && id !== l).every((id) => slots.get(id).node.status().leaderId === l);
            }, maxMs);
            if (t === null) throw new Error("elect: no hubo líder");
            return sim.leader();
        },
        kill(id) {
            const slot = slots.get(id);
            if (!slot.alive) return;
            slot.node.close();
            slot.alive = false;
            for (const other of [...slot.links]) unlink(id, other);
        },
        restart(id) {
            boot(id);
            for (const other of ids) if (other !== id) handshake(id, other);
        },
        partition(a, b) {
            blocked.add(key(a, b));
            unlink(a, b);
        },
        isolate(id) {
            for (const other of ids) if (other !== id) sim.partition(id, other);
        },
        heal() {
            const pairs = [...blocked];
            blocked.clear();
            for (const p of pairs) {
                const [a, b] = p.split("|");
                handshake(a, b);
            }
        },
        // filter(from, to, msg) → true para descartar el mensaje; devuelve la función para quitarlo
        drop(filter) {
            filters.add(filter);
            return () => filters.delete(filter);
        },
        // Registro local con el mismo prepare que usa app.js (sin bcrypt: hash de prueba)
        register(id, username, extra = {}) {
            return slots.get(id).node.write("register", (db) => {
                const taken = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
                if (taken) return { error: { status: 409, body: { error: "El nombre de usuario ya existe" } } };
                return { data: { userId: nextUserId(db), username, provider: "local", password_hash: TEST_HASH, created_at: "2026-11-23 10:00:00", ...extra } };
            });
        },
        sent: (type, pred = () => true) => messages.filter((m) => m.type === type && pred(m)),
        // Retardo propio de un enlace en un sentido (null vuelve al de siempre)
        setDelay(from, to, ms) {
            if (ms === null) linkDelay.delete(`${from}>${to}`);
            else linkDelay.set(`${from}>${to}`, ms);
        },
    };
    if (start) sim.start();
    return sim;
}

module.exports = { mulberry32, createFakeClock, createSimNetwork, createReplicationSim, DEFAULT_CFG, REPL_CFG, TEST_HASH };
