// Nodo de replicación del clúster de auth (Taller 7, decisiones 8-14). Une el núcleo puro de elección
// (election.js) con el oplog (oplog.js). Sin sockets propios: recibe un transporte y un reloj inyectables, así
// las pruebas lo corren sobre el simulador y index.js sobre el mesh WebSocket.
//
// createReplicationNode({ id, nodes, cfg, db, transport, clock, rng, log }) → misma interfaz que
// createStandaloneReplication (status, whoami, canServeRead, isLagging, leader, write, peers, now, close) más
// handleMessage(from, msg), peerUp(from, hello), peerDown(from), tick() y helloInfo().
//   nodes      AUTH_NODES: [{ id, publicUrl, peerUrl }] (incluido este nodo)
//   cfg        AUTH_HEARTBEAT_MS, LEADER_TIMEOUT_MS, ELECTION_JITTER_MS, READ_TOLERANCE, WRITE_TIMEOUT_MS,
//              ACK_GRACE_MS, SYNC_BATCH
//   transport  { send(to, msg), connectedIds() }
//   clock      { now(), setTimeout(fn, ms) → handle, clearTimeout(handle) }
//   log        { info(text), warn(text) } (solo roles y fallas; nunca hashes, subs, emails ni mensajes)
//
// Escritura (decisión 9): mutex; solo el líder; mayoría de nodos conectados antes de proponer (si no, 503
// no_quorum); prepare(db) dentro del mutex; write_propagate a las réplicas conectadas; con acks ok de una
// mayoría (él cuenta) dentro de WRITE_TIMEOUT_MS aplica localmente y espera hasta ACK_GRACE_MS al resto de
// conectados; si vence, write_abort y 503 replication_timeout sin aplicar nada local. Si deja de ser líder
// mientras espera, 503 not_leader (o no_leader). Las réplicas aplican al recibir y contestan write_ack.

const crypto = require("node:crypto");
const { createElectionState, step, majorityOf } = require("./election.js");
const { createMutex } = require("./mutex.js");
const {
    bootstrapLegacy, lastPosition, entryAt, applyEntry, undoLast, getMeta, setMeta, countUsers, usersChecksum,
    validateEntry, ConflictError, OrderError, OPS,
} = require("../oplog.js");

const TICK_MS = 100;
const SILENT = { info() {}, warn() {} };
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function createReplicationNode({ id, nodes, cfg, db, transport, clock, rng = Math.random, log = SILENT }) {
    const defs = nodes.map((n) => (typeof n === "string" ? { id: n, publicUrl: null, peerUrl: null } : n));
    const ids = defs.map((n) => n.id);
    const self = defs.find((n) => n.id === id);
    if (!self) throw new Error("createReplicationNode: id debe estar en nodes");
    const urlOf = (nodeId) => defs.find((n) => n.id === nodeId)?.publicUrl ?? null;
    const majority = majorityOf(ids.length);

    // BD heredada sin oplog: sus usuarios pasan a ser las primeras entradas (deterministas en todos los nodos)
    const legacyEntries = bootstrapLegacy(db);

    // Término y voto persistidos en meta (se guardan ANTES de contestar un voto: el núcleo los pide primero)
    const storedTerm = Number(getMeta(db, "current_term") ?? 0);
    const storedVote = getMeta(db, "voted_for");
    let election = createElectionState({
        id,
        nodes: ids,
        cfg,
        now: clock.now(),
        rng,
        persisted: { term: Number.isSafeInteger(storedTerm) && storedTerm >= 0 ? storedTerm : 0, votedFor: storedVote ? storedVote : null },
    });

    const mutex = createMutex();
    let pending = null; // escritura del líder esperando acks
    let closed = false;
    let tickTimer = null;

    const position = () => lastPosition(db);
    const ctx = () => {
        const p = position();
        return { lastSeq: p.seq, lastTerm: p.term };
    };
    const isLeader = () => election.role === "leader";
    const connectedPeers = () => {
        const live = new Set(transport.connectedIds());
        return election.connected.filter((p) => live.has(p));
    };
    const send = (to, msg) => {
        if (!closed) transport.send(to, msg);
    };

    // ---------- Núcleo de elección ----------

    const hooks = { onRequestSync: () => {}, afterLeaderMessage: () => {} };

    function runElection(event) {
        if (closed) return;
        const before = election;
        const { state, actions } = step(election, { now: clock.now(), ...event }, ctx());
        election = state;
        for (const a of actions) {
            if (a.type === "persist") {
                setMeta(db, "current_term", a.term);
                setMeta(db, "voted_for", a.votedFor ?? "");
            } else if (a.type === "became") {
                onBecame(before, a);
            } else if (a.type === "send") {
                send(a.to, a.msg);
            } else if (a.type === "broadcast") {
                for (const to of connectedPeers()) send(to, a.msg);
            } else if (a.type === "request_sync") {
                hooks.onRequestSync(a.to);
            }
        }
    }

    function onBecame(before, a) {
        if (a.role === "leader") log.info(`[auth] ${id} es el líder (término ${a.term})`);
        else if (before.role === "leader") log.info(`[auth] ${id} deja de ser líder (término ${a.term})`);
        else if (a.leaderId && a.leaderId !== before.leaderId) log.info(`[auth] ${id} sigue al líder ${a.leaderId} (término ${a.term})`);
        else if (a.role === "candidate") log.info(`[auth] ${id} se postula (término ${a.term})`);
        // Una escritura esperando mayoría falla si este nodo deja de ser líder
        if (a.role !== "leader" && pending && pending.phase === "majority") pending.finish("lost");
    }

    // ---------- Respuestas 503 (decisión 13) ----------

    function leaderInfo() {
        if (isLeader()) return { leaderId: id, leaderUrl: urlOf(id) };
        return election.leaderId ? { leaderId: election.leaderId, leaderUrl: urlOf(election.leaderId) } : null;
    }
    function notLeaderResult() {
        const l = leaderInfo();
        if (!l || l.leaderId === id) return { ok: false, status: 503, body: { error: "no_leader" } };
        return { ok: false, status: 503, body: { error: "not_leader", leaderUrl: l.leaderUrl, leaderId: l.leaderId } };
    }

    // ---------- Escritura en el líder ----------

    async function write(op, prepare) {
        if (!OPS.has(op)) throw new Error(`operación desconocida: ${op}`);
        if (!isLeader()) return notLeaderResult(); // sin ejecutar prepare
        return mutex.run(async () => {
            if (!isLeader()) return notLeaderResult();
            const peers = connectedPeers();
            if (peers.length + 1 < majority) return { ok: false, status: 503, body: { error: "no_quorum" } };

            const prepared = await prepare(db);
            if (prepared?.error) return { ok: false, status: prepared.error.status, body: prepared.error.body };
            if (prepared && Object.hasOwn(prepared, "noop")) return { ok: true, noop: prepared.noop };
            if (!prepared?.data) throw new Error("prepare debe devolver { data }, { noop } o { error }");
            if (!isLeader()) return notLeaderResult(); // prepare pudo ser asíncrono

            const entry = { seq: position().seq + 1, term: election.term, entryId: crypto.randomUUID(), op, data: prepared.data };
            const check = validateEntry(entry);
            if (!check.ok) throw new Error(`entrada inválida: ${check.reason}`);

            const outcome = await propose(entry, peers);
            if (outcome === "lost") return notLeaderResult();
            if (outcome === "timeout") {
                for (const to of connectedPeers()) send(to, { type: "write_abort", term: entry.term, seq: entry.seq, entryId: entry.entryId });
                return { ok: false, status: 503, body: { error: "replication_timeout" } };
            }
            // Mayoría: recién ahora el líder aplica la entrada
            try {
                applyEntry(db, entry);
            } catch (err) {
                for (const to of connectedPeers()) send(to, { type: "write_abort", term: entry.term, seq: entry.seq, entryId: entry.entryId });
                if (err instanceof ConflictError) return { ok: false, status: 409, conflict: true, body: { error: "conflict" } };
                throw err;
            }
            await grace();
            return { ok: true, entry };
        });
    }

    // Propone la entrada y espera mayoría: "majority" | "timeout" | "lost"
    function propose(entry, peers) {
        return new Promise((resolve) => {
            const state = { entry, phase: "majority", acks: new Set(), timer: null };
            state.finish = (outcome) => {
                if (state.phase !== "majority") return;
                state.phase = "decided";
                clock.clearTimeout(state.timer);
                resolve(outcome);
            };
            pending = state;
            const msg = { type: "write_propagate", term: entry.term, seq: entry.seq, entryId: entry.entryId, op: entry.op, data: entry.data };
            for (const to of peers) send(to, msg);
            state.timer = clock.setTimeout(() => state.finish("timeout"), cfg.WRITE_TIMEOUT_MS);
            checkMajority();
        });
    }

    function checkMajority() {
        if (pending?.phase === "majority" && pending.acks.size + 1 >= majority) pending.finish("majority");
    }

    // Tras aplicar: hasta ACK_GRACE_MS para que respondan los demás conectados (así /status coincide)
    function grace() {
        const state = pending;
        if (!state) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                if (state.phase === "closed") return;
                state.phase = "closed";
                clock.clearTimeout(state.timer);
                if (pending === state) pending = null;
                resolve();
            };
            state.phase = "grace";
            state.done = done;
            state.timer = clock.setTimeout(done, cfg.ACK_GRACE_MS);
            checkGrace();
        });
    }

    function checkGrace() {
        if (pending?.phase !== "grace") return;
        if (connectedPeers().every((p) => pending.acks.has(p))) pending.done();
    }

    function onWriteAck(from, msg) {
        if (msg.authId !== from || !isCount(msg.term) || !isCount(msg.seq) || typeof msg.entryId !== "string" || typeof msg.ok !== "boolean") return;
        // Cuenta como contacto para el lease del líder; un término mayor lo baja (y falla la escritura pendiente)
        runElection({ kind: "message", from, msg: { type: "heartbeat_ack", authId: from, term: msg.term, lastSeq: msg.seq } });
        if (!pending || msg.term !== election.term || msg.seq !== pending.entry.seq || msg.entryId !== pending.entry.entryId || !msg.ok) return;
        pending.acks.add(from);
        checkMajority();
        checkGrace();
    }

    // ---------- Réplica ----------

    // Acepta mensajes de replicación solo del líder del término actual o mayor; devuelve true si se aceptan
    function acceptFromLeader(from, term) {
        if (term > election.term || (term === election.term && election.leaderId !== from && !isLeader())) {
            runElection({ kind: "message", from, msg: { type: "new_leader", leader: from, term } });
        }
        return election.role === "replica" && election.leaderId === from && election.term === term;
    }

    function ack(to, entry, ok, reason) {
        const msg = { type: "write_ack", authId: id, term: election.term, seq: entry.seq, entryId: entry.entryId, ok };
        if (reason) msg.reason = reason;
        send(to, msg);
    }

    function onWritePropagate(from, msg) {
        const entry = { seq: msg.seq, term: msg.term, entryId: msg.entryId, op: msg.op, data: msg.data };
        if (!isCount(msg.term) || !isCount(msg.seq) || typeof msg.entryId !== "string") return;
        if (msg.term < election.term) return ack(from, entry, false, "stale_term");
        if (!validateEntry(entry).ok) return ack(from, entry, false, "invalid_entry");
        if (!acceptFromLeader(from, msg.term)) return ack(from, entry, false, "not_leader");
        hooks.afterLeaderMessage(from);
        replicaApply(from, entry);
    }

    // Aplica una entrada que llega del líder (decisión 10). La etapa de conflictos/sync la amplía.
    function replicaApply(from, entry) {
        const last = position().seq;
        if (entry.seq <= last) {
            const existing = entryAt(db, entry.seq);
            if (existing && existing.entryId === entry.entryId) return ack(from, entry, true); // idempotente
            return conflicts.onConflict(from, entry, last);
        }
        if (entry.seq > last + 1) {
            hooks.onRequestSync(from);
            return ack(from, entry, false, "gap");
        }
        try {
            applyEntry(db, entry);
            return ack(from, entry, true);
        } catch (err) {
            if (err instanceof ConflictError) return conflicts.onUniqueViolation(from, entry);
            if (err instanceof OrderError) return ack(from, entry, false, "gap");
            throw err;
        }
    }

    // Comportamiento básico ante conflictos (la etapa de sync lo reemplaza por la resincronización)
    const conflicts = {
        onConflict: (from, entry) => ack(from, entry, false, "conflict"),
        onUniqueViolation: (from, entry) => ack(from, entry, false, "conflict"),
    };

    function onWriteAbort(from, msg) {
        if (!isCount(msg.term) || !isCount(msg.seq) || typeof msg.entryId !== "string") return;
        if (msg.term < election.term || !acceptFromLeader(from, msg.term)) return;
        const last = entryAt(db, position().seq);
        if (last && last.seq === msg.seq && last.entryId === msg.entryId) undoLast(db, msg.entryId);
    }

    // ---------- Mensajes ----------

    const ELECTION_TYPES = new Set(["heartbeat", "heartbeat_ack", "election", "vote", "new_leader"]);
    const extraHandlers = {};

    function handleMessage(from, msg) {
        if (closed || !ids.includes(from) || from === id || !isObject(msg) || typeof msg.type !== "string") return;
        if (ELECTION_TYPES.has(msg.type)) {
            runElection({ kind: "message", from, msg });
            if (msg.type === "heartbeat" && election.leaderId === from) hooks.afterLeaderMessage(from, msg);
            return;
        }
        if (msg.type === "write_propagate") return onWritePropagate(from, msg);
        if (msg.type === "write_ack") return onWriteAck(from, msg);
        if (msg.type === "write_abort") return onWriteAbort(from, msg);
        extraHandlers[msg.type]?.(from, msg);
    }

    function helloInfo() {
        const p = position();
        return { type: "hello", authId: id, role: isLeader() ? "leader" : "replica", term: election.term, leaderId: election.leaderId, lastSeq: p.seq, lastTerm: p.term };
    }

    function peerUp(from, hello) {
        if (closed || !ids.includes(from) || from === id || !isObject(hello)) return;
        runElection({ kind: "peer_hello", from, hello: { role: hello.role, term: hello.term, leaderId: hello.leaderId ?? null, lastSeq: hello.lastSeq, lastTerm: hello.lastTerm } });
        if (election.leaderId === from && !isLeader()) hooks.afterLeaderMessage(from, { lastSeq: hello.lastSeq, lastTerm: hello.lastTerm });
        checkGrace();
    }

    function peerDown(from) {
        if (closed || !ids.includes(from)) return;
        runElection({ kind: "peer_down", from });
        hooks.onPeerDown?.(from);
        checkGrace();
    }

    const tickHooks = [];
    function tick() {
        if (closed) return;
        runElection({ kind: "tick" });
        for (const fn of tickHooks) fn();
    }
    function loop() {
        if (closed) return;
        tick();
        tickTimer = clock.setTimeout(loop, TICK_MS);
    }

    // ---------- Lecturas, estado y pares ----------

    const reads = {
        canServeRead() {
            if (isLeader()) return { ok: true };
            if (!election.leaderId) return { ok: false, status: 503, body: { error: "no_leader" } };
            return { ok: true };
        },
        isLagging: () => !isLeader() && election.leaderId !== null && position().seq < election.leaderSeq,
    };

    function status() {
        const p = position();
        const l = leaderInfo();
        return {
            authId: id,
            role: isLeader() ? "leader" : "replica",
            publicUrl: self.publicUrl,
            peerUrl: self.peerUrl,
            leaderUrl: l?.leaderUrl ?? null,
            knownPeers: ids.filter((n) => n !== id),
            lastAppliedSeq: p.seq,
            users: countUsers(db),
            term: election.term,
            leaderId: l?.leaderId ?? null,
            election: election.role === "candidate",
            lastTerm: p.term,
            checksum: usersChecksum(db),
        };
    }

    function peers() {
        const live = new Set(transport.connectedIds());
        const leaderId = leaderInfo()?.leaderId ?? null;
        return defs
            .filter((n) => n.id !== id)
            .map((n) => ({ authId: n.id, publicUrl: n.publicUrl, peerUrl: n.peerUrl, role: n.id === leaderId ? "leader" : "replica", connected: live.has(n.id) }));
    }

    const node = {
        legacyEntries,
        status,
        whoami: () => ({ authId: id, role: isLeader() ? "leader" : "replica" }),
        canServeRead: () => reads.canServeRead(),
        isLagging: () => reads.isLagging(),
        leader: leaderInfo,
        write,
        peers,
        now: () => clock.now(),
        handleMessage,
        peerUp,
        peerDown,
        tick,
        helloInfo,
        close() {
            closed = true;
            clock.clearTimeout(tickTimer);
            if (pending?.phase === "majority") pending.finish("lost");
        },
        // Para la etapa de sync y las pruebas
        _internal: { hooks, conflicts, reads, extraHandlers, tickHooks, send, runElection, position, election: () => election, isLeader, connectedPeers, leaderInfo, ack, replicaApply },
    };

    loop(); // primer tick ya: un nodo único es líder desde el arranque
    return node;
}

module.exports = { createReplicationNode, TICK_MS };
