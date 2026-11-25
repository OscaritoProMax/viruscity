// Núcleo PURO de elección de líder del clúster de auth (Taller 7, decisiones 5, 6 y 7). Estilo Raft simplificado.
// Sin sockets, sin BD y sin relojes propios: el tiempo llega en cada evento (now) y el azar es el rng inyectado.
//
// createElectionState({ id, nodes, cfg, now, rng, persisted:{ term, votedFor } }) → estado inicial (réplica)
// step(state, event, ctx) → { state, actions }   (no modifica el estado recibido)
//   ctx = { lastSeq, lastTerm }: posición del log propio en esta llamada
//
// Eventos:
//   { kind:'tick', now }
//   { kind:'peer_hello', now, from, hello:{ role, term, leaderId, lastSeq, lastTerm } }   (handshake completo)
//   { kind:'peer_down', now, from }
//   { kind:'message', now, from, msg }   msg: heartbeat | heartbeat_ack | election | vote | new_leader
// Acciones:
//   { type:'persist', term, votedFor }   SIEMPRE la primera de la lista: guardar ANTES de enviar
//   { type:'became', role, term, leaderId }
//   { type:'send', to, msg } · { type:'broadcast', msg } (a los conectados) · { type:'request_sync', to }
//
// Reglas (CLAUDE.md, Taller 7):
// - Término monótono y persistido con votedFor antes de contestar un voto o de anunciar una candidatura.
// - Una réplica sin contacto del líder durante LEADER_TIMEOUT_MS + rng()·ELECTION_JITTER_MS se vuelve candidata
//   (solo si tiene mayoría conectada, él cuenta: así un nodo aislado no infla su término). La ronda de una
//   candidatura dura AUTH_HEARTBEAT_MS + rng()·ELECTION_JITTER_MS; si vence sin ganador, nuevo término.
// - Voto: término del candidato >= al propio, no votó por otro en ese término y el log del candidato está al día
//   (lastTerm mayor, o igual y lastSeq >= propio). Estabilidad: quien oyó a un líder en los últimos
//   (LEADER_TIMEOUT_MS − 1000) ms, o es el líder, no concede votos ni adopta el término de un candidato.
// - Gana con mayoría = floor(N/2)+1: new_leader y heartbeat inmediato. El líder late cada AUTH_HEARTBEAT_MS y
//   mantiene un lease: sin acks de una mayoría (él cuenta) dentro de LEADER_TIMEOUT_MS se baja a réplica sin líder.
// - Contacto con un líder (heartbeat, new_leader o hello de un líder) con término >= al propio: se le sigue.
//   Un CANDIDATO que oye a un líder vigente con término menor también lo sigue: abandona su candidatura (no la
//   ganó y nadie adoptó su término) y se alinea al término del líder; sus próximas elecciones parten del mayor
//   término que vio (maxTerm), así ningún término de elección se reutiliza. Una réplica que ya sigue a un líder
//   de término mayor contesta el heartbeat viejo con su término y el líder viejo se baja al verlo.
// - Arranque en frío: sin líder conocido, con mayoría conectada y sin que ningún peer reporte líder en su hello,
//   la elección sale a los 500..1500 ms (no se esperan 6 s). Nodo único: líder desde el primer tick.
// - Mensajes de remitentes desconocidos o con candidate/voter/authId/leader distinto de from se ignoran.

const ROLES = new Set(["replica", "candidate", "leader"]);
const BOOTSTRAP_MIN_MS = 500;
const BOOTSTRAP_SPAN_MS = 1000;
const STABILITY_MARGIN_MS = 1000;

const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const majorityOf = (n) => Math.floor(n / 2) + 1;

function createElectionState({ id, nodes, cfg, now, rng = Math.random, persisted = {} }) {
    const ids = (nodes ?? []).map((n) => (typeof n === "string" ? n : n?.id));
    if (typeof id !== "string" || !ids.includes(id)) throw new Error("createElectionState: id debe estar en nodes");
    if (new Set(ids).size !== ids.length) throw new Error("createElectionState: nodes tiene ids repetidos");
    const timing = { AUTH_HEARTBEAT_MS: cfg.AUTH_HEARTBEAT_MS, LEADER_TIMEOUT_MS: cfg.LEADER_TIMEOUT_MS, ELECTION_JITTER_MS: cfg.ELECTION_JITTER_MS };
    const term = isCount(persisted?.term) ? persisted.term : 0;
    return {
        id,
        nodes: ids,
        cfg: timing,
        rng,
        term,
        maxTerm: term,
        role: "replica",
        votedFor: typeof persisted?.votedFor === "string" ? persisted.votedFor : null,
        leaderId: null,
        leaderSeq: 0,
        lastLeaderContactAt: null,
        electionDeadline: now + timing.LEADER_TIMEOUT_MS + rng() * timing.ELECTION_JITTER_MS,
        votes: [],
        connected: [],
        peerInfo: {},
        lastAckAt: {},
        nextHeartbeatAt: null,
        bootstrapAt: null,
    };
}

// ---------- Ayudantes sobre el borrador (d) ----------

const draftOf = (s) => ({ ...s, nodes: s.nodes, votes: [...s.votes], connected: [...s.connected], peerInfo: { ...s.peerInfo }, lastAckAt: { ...s.lastAckAt } });
const isPeer = (d, from) => typeof from === "string" && from !== d.id && d.nodes.includes(from);
const replicaDeadline = (d, now) => now + d.cfg.LEADER_TIMEOUT_MS + d.rng() * d.cfg.ELECTION_JITTER_MS;
const heartbeatMsg = (d, ctx) => ({ type: "heartbeat", authId: d.id, term: d.term, lastSeq: ctx.lastSeq, lastTerm: ctx.lastTerm });

// Término mayor visto: se adopta, se olvida el voto y quien era líder o candidato vuelve a réplica sin líder
function adoptTerm(d, term, now) {
    if (term <= d.term) return;
    d.term = term;
    d.maxTerm = Math.max(d.maxTerm, term);
    d.votedFor = null;
    d.votes = [];
    d.leaderId = null;
    if (d.role !== "replica") {
        d.role = "replica";
        d.nextHeartbeatAt = null;
        d.electionDeadline = replicaDeadline(d, now);
    }
}

function stepDown(d, now) {
    d.role = "replica";
    d.leaderId = null;
    d.votes = [];
    d.nextHeartbeatAt = null;
    d.lastLeaderContactAt = null;
    d.electionDeadline = replicaDeadline(d, now);
}

function becomeLeader(d, now, ctx, actions) {
    d.role = "leader";
    d.leaderId = d.id;
    d.bootstrapAt = null;
    d.lastLeaderContactAt = null;
    d.lastAckAt = {};
    for (const voter of d.votes) if (voter !== d.id) d.lastAckAt[voter] = now;
    d.nextHeartbeatAt = now + d.cfg.AUTH_HEARTBEAT_MS;
    if (d.nodes.length > 1) {
        actions.push({ type: "broadcast", msg: { type: "new_leader", leader: d.id, term: d.term } });
        actions.push({ type: "broadcast", msg: heartbeatMsg(d, ctx) });
    }
}

function startElection(d, now, ctx, actions) {
    d.term = Math.max(d.term, d.maxTerm) + 1;
    d.maxTerm = d.term;
    d.role = "candidate";
    d.votedFor = d.id;
    d.votes = [d.id];
    d.leaderId = null;
    d.bootstrapAt = null;
    d.electionDeadline = now + d.cfg.AUTH_HEARTBEAT_MS + d.rng() * d.cfg.ELECTION_JITTER_MS;
    if (d.votes.length >= majorityOf(d.nodes.length)) return becomeLeader(d, now, ctx, actions); // nodo único
    actions.push({ type: "broadcast", msg: { type: "election", candidate: d.id, term: d.term, lastSeq: ctx.lastSeq, lastTerm: ctx.lastTerm } });
}

// Contacto con un líder (heartbeat, new_leader o hello). Devuelve true si se le sigue, false si es un líder viejo.
function leaderContact(d, from, term, leaderSeq, now, ctx, actions) {
    if (term > d.term) adoptTerm(d, term, now);
    else if (term < d.term) {
        if (d.role !== "candidate") return false; // líder viejo: el que llama contesta con el término propio
        // Candidatura sin ganar frente a un líder vigente: se abandona y se sigue al líder (maxTerm se conserva)
        d.term = term;
        d.votedFor = from;
        d.votes = [];
    } else if (d.role === "leader") {
        return false; // dos líderes en el mismo término no pueden existir: se ignora
    }
    d.role = "replica";
    d.leaderId = from;
    d.votes = [];
    d.nextHeartbeatAt = null;
    d.bootstrapAt = null;
    d.lastLeaderContactAt = now;
    d.electionDeadline = replicaDeadline(d, now);
    if (isCount(leaderSeq)) {
        d.leaderSeq = leaderSeq;
        if (leaderSeq > ctx.lastSeq) actions.push({ type: "request_sync", to: from });
    }
    d.peerInfo[from] = { role: "leader", leaderId: from, term };
    return true;
}

// ---------- Eventos ----------

function onTick(d, now, ctx, actions) {
    const n = d.nodes.length;
    if (n === 1) {
        if (d.role !== "leader") startElection(d, now, ctx, actions);
        return;
    }
    if (d.role === "leader") {
        // Lease: el líder necesita acks recientes de una mayoría (él cuenta)
        const fresh = d.nodes.filter((p) => p !== d.id && d.lastAckAt[p] !== undefined && now - d.lastAckAt[p] < d.cfg.LEADER_TIMEOUT_MS).length;
        if (fresh + 1 < majorityOf(n)) return stepDown(d, now);
        if (d.nextHeartbeatAt === null || now >= d.nextHeartbeatAt) {
            actions.push({ type: "broadcast", msg: heartbeatMsg(d, ctx) });
            d.nextHeartbeatAt = now + d.cfg.AUTH_HEARTBEAT_MS;
        }
        return;
    }
    const canRun = d.connected.length + 1 >= majorityOf(n);
    // Arranque en frío (decisión 6): mayoría conectada y ningún peer reporta líder
    if (d.role === "replica" && d.leaderId === null) {
        const noneReported = d.connected.every((p) => d.peerInfo[p] && d.peerInfo[p].leaderId === null && d.peerInfo[p].role !== "leader");
        if (canRun && noneReported) {
            if (d.bootstrapAt === null) d.bootstrapAt = now + BOOTSTRAP_MIN_MS + d.rng() * BOOTSTRAP_SPAN_MS;
            else if (now >= d.bootstrapAt) return startElection(d, now, ctx, actions);
        } else {
            d.bootstrapAt = null;
        }
    }
    if (now >= d.electionDeadline) {
        if (canRun) startElection(d, now, ctx, actions);
        else d.electionDeadline = replicaDeadline(d, now); // sin mayoría no se puede ganar: no se infla el término
    }
}

function onHello(d, from, hello, now, ctx, actions) {
    if (!isPeer(d, from) || hello === null || typeof hello !== "object") return;
    const { role, term, leaderId, lastSeq } = hello;
    if (!ROLES.has(role) || !isCount(term) || !(leaderId === null || typeof leaderId === "string") || !isCount(lastSeq)) return;
    if (!d.connected.includes(from)) d.connected.push(from);
    d.peerInfo[from] = { role, leaderId, term };
    if (role === "leader" && leaderId === from && term >= d.term && !(d.role === "leader" && term === d.term)) {
        if (d.role === "leader") stepDown(d, now);
        leaderContact(d, from, term, lastSeq, now, ctx, actions);
    } else if (d.role === "leader") {
        actions.push({ type: "send", to: from, msg: heartbeatMsg(d, ctx) }); // que nos adopte de inmediato
    }
}

function onMessage(d, from, msg, now, ctx, actions) {
    if (!isPeer(d, from) || msg === null || typeof msg !== "object" || !isCount(msg.term)) return;
    const n = d.nodes.length;
    switch (msg.type) {
        case "heartbeat": {
            if (msg.authId !== from || !isCount(msg.lastSeq) || !isCount(msg.lastTerm)) return;
            leaderContact(d, from, msg.term, msg.lastSeq, now, ctx, actions);
            // Seguido o viejo, se contesta con el término propio (un líder viejo se baja al verlo)
            actions.push({ type: "send", to: from, msg: { type: "heartbeat_ack", authId: d.id, term: d.term, lastSeq: ctx.lastSeq } });
            return;
        }
        case "new_leader": {
            if (msg.leader !== from) return;
            leaderContact(d, from, msg.term, null, now, ctx, actions);
            return;
        }
        case "heartbeat_ack": {
            if (msg.authId !== from || !isCount(msg.lastSeq)) return;
            if (msg.term > d.term) adoptTerm(d, msg.term, now);
            else if (d.role === "leader" && msg.term === d.term) d.lastAckAt[from] = now;
            return;
        }
        case "election": {
            if (msg.candidate !== from || !isCount(msg.lastSeq) || !isCount(msg.lastTerm)) return;
            const deny = () => actions.push({ type: "send", to: from, msg: { type: "vote", voter: d.id, term: d.term, voteGranted: false } });
            if (msg.term < d.term) return deny();
            const stable = d.role === "leader" || (d.lastLeaderContactAt !== null && now - d.lastLeaderContactAt < d.cfg.LEADER_TIMEOUT_MS - STABILITY_MARGIN_MS);
            if (stable) return deny(); // no concede ni adopta el término del candidato
            adoptTerm(d, msg.term, now);
            const upToDate = msg.lastTerm > ctx.lastTerm || (msg.lastTerm === ctx.lastTerm && msg.lastSeq >= ctx.lastSeq);
            const free = d.votedFor === null || d.votedFor === from;
            if (d.role === "replica" && upToDate && free) {
                d.votedFor = from;
                d.electionDeadline = replicaDeadline(d, now);
                actions.push({ type: "send", to: from, msg: { type: "vote", voter: d.id, term: d.term, voteGranted: true } });
                return;
            }
            return deny();
        }
        case "vote": {
            if (msg.voter !== from || typeof msg.voteGranted !== "boolean") return;
            if (msg.term > d.term) return adoptTerm(d, msg.term, now);
            if (d.role !== "candidate" || msg.term !== d.term || !msg.voteGranted || d.votes.includes(from)) return;
            d.votes.push(from);
            if (d.votes.length >= majorityOf(n)) becomeLeader(d, now, ctx, actions);
            return;
        }
        default:
            return;
    }
}

function step(state, event, ctx = { lastSeq: 0, lastTerm: 0 }) {
    const d = draftOf(state);
    const actions = [];
    const now = event?.now;
    if (Number.isFinite(now)) {
        if (event.kind === "tick") onTick(d, now, ctx, actions);
        else if (event.kind === "peer_hello") onHello(d, event.from, event.hello, now, ctx, actions);
        else if (event.kind === "peer_down") {
            d.connected = d.connected.filter((p) => p !== event.from);
            delete d.peerInfo[event.from];
        } else if (event.kind === "message") onMessage(d, event.from, event.msg, now, ctx, actions);
    }

    const head = [];
    if (d.term !== state.term || d.votedFor !== state.votedFor) head.push({ type: "persist", term: d.term, votedFor: d.votedFor });
    if (d.role !== state.role || d.leaderId !== state.leaderId) head.push({ type: "became", role: d.role, term: d.term, leaderId: d.leaderId });
    return { state: d, actions: [...head, ...actions] };
}

module.exports = { createElectionState, step, majorityOf, STABILITY_MARGIN_MS };
