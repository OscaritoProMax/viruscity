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
//
// Conflictos (decisión 10): misma posición y mismo entryId → ack idempotente; distinta entrada en la ÚLTIMA
// posición → se deshace y se aplica la nueva; más atrás, o una violación de unicidad → resincronización completa
// (wipe + sync desde 0); hueco → request_sync. Solo se acepta replicación del líder del término actual o mayor.
//
// Sync (decisión 11): la réplica pide request_sync { fromSeq, fromEntryId } al conectar con el líder, cuando un
// heartbeat (o el hello) muestra que va atrás o que su log difiere, o ante un hueco. Uno solo en vuelo; si no
// hay respuesta en 2 × WRITE_TIMEOUT_MS, se reintenta. El líder contesta por lotes de SYNC_BATCH (done en el
// último); si fromEntryId no coincide con su entrada en fromSeq, o fromSeq es mayor que su lastSeq, contesta
// conflict:true con todo desde 1 y la réplica borra (wipe) antes de aplicar. Al terminar, la réplica manda un
// heartbeat_ack en el siguiente ciclo para que el líder vea su nueva posición.
//
// Lecturas (decisión 12): con líder conocido y leaderSeq − mySeq < READ_TOLERANCE se sirven localmente; más
// atrasada → 503 not_leader (con leaderUrl y leaderId de AUTH_NODES); sin líder (o en elección) → 503 no_leader.
// Una réplica que perdió la conexión con su líder también responde no_leader (lecturas y escrituras): no sirve
// datos que pueden estar viejos ni manda al cliente hacia un líder que quizá cayó.

const crypto = require("node:crypto");
const { createElectionState, step, majorityOf } = require("./election.js");
const { createMutex } = require("./mutex.js");
const {
    bootstrapLegacy, lastPosition, entryAt, entriesAfter, applyEntry, undoLast, wipe, getMeta, setMeta, countUsers,
    usersChecksum, validateEntry, ConflictError, OrderError, OPS,
} = require("../oplog.js");

const TICK_MS = 100;
const MAX_SYNC_ENTRIES = 5000; // tope de un lote recibido (SYNC_BATCH nunca pasa de 5000)
const SILENT = { info() {}, warn() {} };
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ELECTION_TYPES = new Set(["heartbeat", "heartbeat_ack", "election", "vote", "new_leader"]);
const entryOf = (e) => ({ seq: e.seq, term: e.term, entryId: e.entryId, op: e.op, data: e.data });

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
    let syncFlight = null; // { to, timer }: un solo request_sync en vuelo
    let ackAfterSync = false;
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
                requestSync(a.to);
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
        if (a.role === "leader") cancelSync();
    }

    // ---------- Respuestas 503 (decisión 13) ----------

    function leaderInfo() {
        if (isLeader()) return { leaderId: id, leaderUrl: urlOf(id) };
        return election.leaderId ? { leaderId: election.leaderId, leaderUrl: urlOf(election.leaderId) } : null;
    }
    // ¿Hay un líder conocido Y conectado? (para una réplica)
    const leaderReachable = () => election.leaderId !== null && connectedPeers().includes(election.leaderId);
    function notLeaderResult() {
        const l = leaderInfo();
        if (!l || l.leaderId === id || !leaderReachable()) return { ok: false, status: 503, body: { error: "no_leader" } };
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
                abort(entry);
                return { ok: false, status: 503, body: { error: "replication_timeout" } };
            }
            // Mayoría: recién ahora el líder aplica la entrada
            try {
                applyEntry(db, entry);
            } catch (err) {
                abort(entry);
                if (err instanceof ConflictError) return { ok: false, status: 409, conflict: true, body: { error: "conflict" } };
                throw err;
            }
            await grace();
            return { ok: true, entry };
        });
    }

    function abort(entry) {
        for (const to of connectedPeers()) send(to, { type: "write_abort", term: entry.term, seq: entry.seq, entryId: entry.entryId });
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
            state.phase = "grace";
            state.done = () => {
                if (state.phase !== "grace") return;
                state.phase = "closed";
                clock.clearTimeout(state.timer);
                if (pending === state) pending = null;
                resolve();
            };
            state.timer = clock.setTimeout(state.done, cfg.ACK_GRACE_MS);
            checkGrace();
        });
    }

    function checkGrace() {
        if (pending?.phase === "grace" && connectedPeers().every((p) => pending.acks.has(p))) pending.done();
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

    // ---------- Réplica: write_propagate y write_abort ----------

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
        if (!isCount(msg.term) || !isCount(msg.seq) || typeof msg.entryId !== "string") return;
        const entry = entryOf(msg);
        if (msg.term < election.term) return ack(from, entry, false, "stale_term");
        if (!validateEntry(entry).ok) return ack(from, entry, false, "invalid_entry");
        if (!acceptFromLeader(from, msg.term)) return ack(from, entry, false, "not_leader");
        const last = position().seq;
        if (entry.seq <= last) {
            const existing = entryAt(db, entry.seq);
            if (existing && existing.entryId === entry.entryId) return ack(from, entry, true); // idempotente
            if (entry.seq === last) {
                // Conflicto en la cola (p. ej. un write_abort perdido): se deshace la última y se aplica la nueva
                undoLast(db, existing.entryId);
                return applyOrResync(from, entry);
            }
            fullResync(from); // conflicto profundo
            return ack(from, entry, false, "resync");
        }
        if (entry.seq > last + 1) {
            requestSync(from); // hueco
            return ack(from, entry, false, "gap");
        }
        return applyOrResync(from, entry);
    }

    function applyOrResync(from, entry) {
        try {
            applyEntry(db, entry);
            return ack(from, entry, true);
        } catch (err) {
            if (err instanceof OrderError) {
                requestSync(from);
                return ack(from, entry, false, "gap");
            }
            if (err instanceof ConflictError) {
                fullResync(from); // violación de unicidad: esta BD no se parece a la del líder
                return ack(from, entry, false, "resync");
            }
            throw err;
        }
    }

    function onWriteAbort(from, msg) {
        if (!isCount(msg.term) || !isCount(msg.seq) || typeof msg.entryId !== "string") return;
        if (msg.term < election.term || !acceptFromLeader(from, msg.term)) return;
        const last = entryAt(db, position().seq);
        if (last && last.seq === msg.seq && last.entryId === msg.entryId) undoLast(db, msg.entryId);
    }

    // ---------- Sync ----------

    function cancelSync() {
        if (syncFlight) clock.clearTimeout(syncFlight.timer);
        syncFlight = null;
    }

    function requestSync(to, force = false) {
        if (closed || isLeader() || !to) return;
        if (syncFlight && !force) return;
        cancelSync();
        const p = position();
        const fromEntryId = p.seq > 0 ? entryAt(db, p.seq)?.entryId ?? null : null;
        send(to, { type: "request_sync", fromSeq: p.seq, fromEntryId });
        armSyncRetry(to);
    }

    function armSyncRetry(to) {
        if (syncFlight) clock.clearTimeout(syncFlight.timer);
        syncFlight = {
            to,
            timer: clock.setTimeout(() => {
                syncFlight = null;
                if (election.leaderId && !isLeader()) requestSync(election.leaderId);
            }, 2 * cfg.WRITE_TIMEOUT_MS),
        };
    }

    // Resincronización completa: sin usuarios ni oplog, y todo de nuevo desde el líder
    function fullResync(from) {
        log.warn(`[auth] ${id}: su log difiere del líder ${from}; resincronización completa`);
        wipe(db);
        requestSync(from, true);
    }

    // El log de la réplica no cuadra con lo que reporta el líder (va atrás, adelante o con otro término al final)
    function checkDivergence(from, info) {
        if (isLeader() || election.leaderId !== from || !info || !isCount(info.lastSeq)) return;
        const p = position();
        if (info.lastSeq > p.seq || info.lastSeq < p.seq || (info.lastSeq === p.seq && isCount(info.lastTerm) && info.lastTerm !== p.term)) requestSync(from);
    }

    // Líder: entradas con seq > fromSeq por lotes; si el punto de partida no coincide, todo desde 1 con conflict
    function onRequestSync(from, msg) {
        if (!isLeader() || !isCount(msg.fromSeq) || !(msg.fromEntryId === null || typeof msg.fromEntryId === "string")) return;
        const last = position().seq;
        const conflict = msg.fromSeq > last || (msg.fromSeq > 0 && entryAt(db, msg.fromSeq)?.entryId !== msg.fromEntryId);
        let after = conflict ? 0 : msg.fromSeq;
        let first = true;
        for (;;) {
            const batch = entriesAfter(db, after, cfg.SYNC_BATCH);
            if (batch.length > 0) after = batch[batch.length - 1].seq;
            const done = batch.length < cfg.SYNC_BATCH || after >= last;
            send(from, { type: "sync_response", term: election.term, entries: batch.map(entryOf), conflict: first && conflict, done });
            first = false;
            if (done) break;
        }
    }

    // Réplica: aplica un lote en orden (con conflict, primero borra)
    function onSyncResponse(from, msg) {
        if (!isCount(msg.term) || !Array.isArray(msg.entries) || msg.entries.length > MAX_SYNC_ENTRIES || typeof msg.conflict !== "boolean" || typeof msg.done !== "boolean") return;
        if (msg.term < election.term || !acceptFromLeader(from, msg.term)) return;
        if (msg.conflict) wipe(db);
        for (const raw of msg.entries) {
            const entry = isObject(raw) ? entryOf(raw) : null;
            if (!entry || !validateEntry(entry).ok) return requestSync(from, true);
            const last = position().seq;
            if (entry.seq <= last) {
                if (entryAt(db, entry.seq)?.entryId === entry.entryId) continue;
                return fullResync(from);
            }
            if (entry.seq > last + 1) return requestSync(from, true); // faltó un lote: se pide de nuevo
            try {
                applyEntry(db, entry);
            } catch (err) {
                if (err instanceof ConflictError) return fullResync(from);
                if (err instanceof OrderError) return requestSync(from, true);
                throw err;
            }
        }
        if (msg.done) {
            cancelSync();
            ackAfterSync = true; // el líder verá la nueva posición en el próximo ciclo
        } else if (syncFlight?.to === from) {
            armSyncRetry(from); // llegó un lote: se reinicia la espera
        }
    }

    // ---------- Mensajes, conexiones y tick ----------

    function handleMessage(from, msg) {
        if (closed || !ids.includes(from) || from === id || !isObject(msg) || typeof msg.type !== "string") return;
        if (ELECTION_TYPES.has(msg.type)) {
            runElection({ kind: "message", from, msg });
            if (msg.type === "heartbeat") checkDivergence(from, msg);
            return;
        }
        if (msg.type === "write_propagate") return onWritePropagate(from, msg);
        if (msg.type === "write_ack") return onWriteAck(from, msg);
        if (msg.type === "write_abort") return onWriteAbort(from, msg);
        if (msg.type === "request_sync") return onRequestSync(from, msg);
        if (msg.type === "sync_response") return onSyncResponse(from, msg);
    }

    function helloInfo() {
        const p = position();
        return { type: "hello", authId: id, role: isLeader() ? "leader" : "replica", term: election.term, leaderId: election.leaderId, lastSeq: p.seq, lastTerm: p.term };
    }

    function peerUp(from, hello) {
        if (closed || !ids.includes(from) || from === id || !isObject(hello)) return;
        runElection({ kind: "peer_hello", from, hello: { role: hello.role, term: hello.term, leaderId: hello.leaderId ?? null, lastSeq: hello.lastSeq, lastTerm: hello.lastTerm } });
        checkDivergence(from, hello); // al conectar con el líder: sync si le falta o si su log difiere
        checkGrace();
    }

    function peerDown(from) {
        if (closed || !ids.includes(from)) return;
        runElection({ kind: "peer_down", from });
        if (syncFlight?.to === from) cancelSync();
        checkGrace();
    }

    function tick() {
        if (closed) return;
        runElection({ kind: "tick" });
        if (ackAfterSync && election.leaderId && !isLeader()) {
            ackAfterSync = false;
            send(election.leaderId, { type: "heartbeat_ack", authId: id, term: election.term, lastSeq: position().seq });
        }
    }
    function loop() {
        if (closed) return;
        tick();
        tickTimer = clock.setTimeout(loop, TICK_MS);
    }

    // ---------- Lecturas, estado y pares ----------

    function canServeRead() {
        if (isLeader()) return { ok: true };
        if (!leaderReachable()) return { ok: false, status: 503, body: { error: "no_leader" } };
        if (election.leaderSeq - position().seq >= cfg.READ_TOLERANCE) return notLeaderResult();
        return { ok: true };
    }

    const isLagging = () => !isLeader() && election.leaderId !== null && position().seq < election.leaderSeq;

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
        canServeRead,
        isLagging,
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
            cancelSync();
            if (pending?.phase === "majority") pending.finish("lost");
        },
    };

    loop(); // primer tick ya: un nodo único es líder desde el arranque
    return node;
}

module.exports = { createReplicationNode, TICK_MS };
