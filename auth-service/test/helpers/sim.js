// Simulador del clúster de auth para las pruebas del núcleo de elección (Taller 7). Sin sockets ni BD:
// reloj falso, rng sembrado y una red en memoria con retardo, pérdida, particiones, caídas y reinicios.
//
// mulberry32(seed) → rng determinista en [0, 1)
// createFakeClock(start) → { now(), setTimeout(fn, ms), advance(ms) }   (advance ejecuta en orden los vencidos)
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
            timers.push({ at: t + Math.max(0, ms), seq: seq++, fn });
        },
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

module.exports = { mulberry32, createFakeClock, createSimNetwork, DEFAULT_CFG };
