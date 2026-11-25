// Partes PURAS del mesh entre auth-services (Taller 7, decisiones 3 y 4): quién inicia cada conexión, qué hacer
// con una conexión duplicada y la validación estricta de cada mensaje. Sin sockets: lo usa mesh.js.
//
// shouldInitiate(selfId, peerId) → true si este nodo abre la conexión (inicia el id MENOR)
// resolveLink(selfId, peerId, { direction, existing }) → "accept" | "reject" | "replace"
// validatePeerMessage(msg, { from, selfId, nodeIds, syncBatch }) → { ok:true, msg } (copia con solo los campos
//   conocidos) | { ok:false, reason }. El remitente es SIEMPRE `from` (el id de la conexión): un mensaje cuyo
//   authId/candidate/voter/leader lo contradiga se rechaza. El hello se valida sin `from` (aún no hay conexión).
// La validez de una ENTRADA (provider, hash, username…) la decide el nodo con validateEntry, para poder
// contestar write_ack ok:false 'invalid_entry'; aquí solo se exige la forma.

const ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const ENTRY_ID_MAX = 64;
const REASON_MAX = 40;
const MAX_SYNC_ENTRIES = 5000;
const ROLES = new Set(["leader", "replica"]);
const OPS = new Set(["register", "register_google"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isSeq = (v) => Number.isSafeInteger(v) && v > 0;
const isEntryId = (v) => typeof v === "string" && v.length >= 1 && v.length <= ENTRY_ID_MAX;
const fail = (reason) => ({ ok: false, reason });

const shouldInitiate = (selfId, peerId) => selfId < peerId;

// Una sola conexión por par (decisión 3). existing: ¿ya hay una conexión activa con ese peer?
// Entrante de un id MAYOR: si ya hay una, se rechaza la nueva (4010). De un id MENOR (el que debe iniciar):
// reemplaza a cualquier previa. Saliente: solo si no hay otra.
function resolveLink(selfId, peerId, { direction = "in", existing = false } = {}) {
    if (direction !== "in") return existing ? "reject" : "accept";
    if (peerId > selfId) return existing ? "reject" : "accept";
    return existing ? "replace" : "accept";
}

// Forma de una entrada del log (para write_propagate y sync_response)
function shapeEntry(e) {
    if (!isObject(e) || !isSeq(e.seq) || !isCount(e.term) || !isEntryId(e.entryId) || !OPS.has(e.op) || !isObject(e.data)) return null;
    return { seq: e.seq, term: e.term, entryId: e.entryId, op: e.op, data: e.data };
}

function validatePeerMessage(msg, { from = null, selfId = null, nodeIds = [], syncBatch = 500 } = {}) {
    if (!isObject(msg) || typeof msg.type !== "string") return fail("mensaje sin type");
    const known = (id) => typeof id === "string" && ID_REGEX.test(id) && nodeIds.includes(id);
    const sender = (field) => msg[field] === from; // el campo debe coincidir con la conexión
    switch (msg.type) {
        case "hello": {
            if (!known(msg.authId) || msg.authId === selfId) return fail("hello de un id desconocido o propio");
            if (from !== null && !sender("authId")) return fail("authId distinto de la conexión");
            if (!ROLES.has(msg.role) || !isCount(msg.term) || !isCount(msg.lastSeq) || !isCount(msg.lastTerm)) return fail("hello inválido");
            const leaderId = msg.leaderId ?? null;
            if (leaderId !== null && !known(leaderId)) return fail("leaderId desconocido");
            return { ok: true, msg: { type: "hello", authId: msg.authId, role: msg.role, term: msg.term, leaderId, lastSeq: msg.lastSeq, lastTerm: msg.lastTerm } };
        }
        case "heartbeat":
            if (!sender("authId") || !isCount(msg.term) || !isCount(msg.lastSeq) || !isCount(msg.lastTerm)) return fail("heartbeat inválido");
            return { ok: true, msg: { type: "heartbeat", authId: from, term: msg.term, lastSeq: msg.lastSeq, lastTerm: msg.lastTerm } };
        case "heartbeat_ack":
            if (!sender("authId") || !isCount(msg.term) || !isCount(msg.lastSeq)) return fail("heartbeat_ack inválido");
            return { ok: true, msg: { type: "heartbeat_ack", authId: from, term: msg.term, lastSeq: msg.lastSeq } };
        case "write_propagate": {
            const e = shapeEntry(msg);
            if (!e) return fail("write_propagate inválido");
            return { ok: true, msg: { type: "write_propagate", ...e } };
        }
        case "write_ack": {
            if (!sender("authId") || !isCount(msg.term) || !isSeq(msg.seq) || !isEntryId(msg.entryId) || typeof msg.ok !== "boolean") return fail("write_ack inválido");
            if (msg.reason !== undefined && !(typeof msg.reason === "string" && msg.reason.length <= REASON_MAX)) return fail("reason inválido");
            const out = { type: "write_ack", authId: from, term: msg.term, seq: msg.seq, entryId: msg.entryId, ok: msg.ok };
            if (msg.reason !== undefined) out.reason = msg.reason;
            return { ok: true, msg: out };
        }
        case "write_abort":
            if (!isCount(msg.term) || !isSeq(msg.seq) || !isEntryId(msg.entryId)) return fail("write_abort inválido");
            return { ok: true, msg: { type: "write_abort", term: msg.term, seq: msg.seq, entryId: msg.entryId } };
        case "request_sync":
            if (!isCount(msg.fromSeq) || !(msg.fromEntryId === null || isEntryId(msg.fromEntryId))) return fail("request_sync inválido");
            return { ok: true, msg: { type: "request_sync", fromSeq: msg.fromSeq, fromEntryId: msg.fromEntryId } };
        case "sync_response": {
            const max = Math.min(syncBatch, MAX_SYNC_ENTRIES);
            if (!isCount(msg.term) || !Array.isArray(msg.entries) || msg.entries.length > max || typeof msg.conflict !== "boolean" || typeof msg.done !== "boolean") return fail("sync_response inválido");
            const entries = [];
            for (const raw of msg.entries) {
                const e = shapeEntry(raw);
                if (!e) return fail("entrada de sync inválida");
                entries.push(e);
            }
            return { ok: true, msg: { type: "sync_response", term: msg.term, entries, conflict: msg.conflict, done: msg.done } };
        }
        case "election":
            if (!sender("candidate") || !isCount(msg.term) || !isCount(msg.lastSeq) || !isCount(msg.lastTerm)) return fail("election inválido");
            return { ok: true, msg: { type: "election", candidate: from, term: msg.term, lastSeq: msg.lastSeq, lastTerm: msg.lastTerm } };
        case "vote":
            if (!sender("voter") || !isCount(msg.term) || typeof msg.voteGranted !== "boolean") return fail("vote inválido");
            return { ok: true, msg: { type: "vote", voter: from, term: msg.term, voteGranted: msg.voteGranted } };
        case "new_leader":
            if (!sender("leader") || !isCount(msg.term)) return fail("new_leader inválido");
            return { ok: true, msg: { type: "new_leader", leader: from, term: msg.term } };
        default:
            return fail("tipo de mensaje desconocido");
    }
}

module.exports = { shouldInitiate, resolveLink, validatePeerMessage, ID_REGEX };
