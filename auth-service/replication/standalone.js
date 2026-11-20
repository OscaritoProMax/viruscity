// Replicación de un nodo único (Taller 7): el nodo es el líder de un clúster de uno. Implementa la interfaz
// común que usan las rutas de app.js; el modo de varios nodos implementará la misma interfaz.
//
// ---------------------------------------------------------------------------------------------------------
// Interfaz de replicación (la usan las rutas; ninguna ruta toca el oplog directamente)
//
// replication.status() → objeto de GET /status (decisión 14):
//     { authId, role, publicUrl, peerUrl, leaderUrl, knownPeers, lastAppliedSeq, users, term, leaderId,
//       election, lastTerm, checksum }
// replication.whoami() → { authId, role } (barato: lo usan los headers X-Auth-Id y X-Auth-Role)
// replication.canServeRead() → { ok:true } | { ok:false, status:503, body } (puerta de /login y de /auth/google
//     con usuario existente: decisión 12)
// replication.isLagging() → boolean: la BD local va detrás del líder (una lectura que fallaría da 503 not_leader)
// replication.leader() → { leaderId, leaderUrl } (null si no se conoce)
// replication.write(op, prepare) → Promise de
//     { ok:true, entry } | { ok:true, noop } | { ok:false, status, body } (o { ok:false, status:409, conflict:true })
//   prepare(db) corre DENTRO del mutex de escrituras (puede ser async) y devuelve:
//     { data }            → se arma la entrada { seq, term, entryId, op, data }, se aplica (y replica) y se responde
//     { noop: valor }     → no hay escritura (por ejemplo, el usuario de Google ya existía)
//     { error:{ status, body } } → la ruta responde ese error
// replication.peers() → lista para GET /peers: [{ authId, publicUrl, peerUrl, role, connected }] de los OTROS nodos
// replication.now() → hora (ms) del reloj inyectado (para created_at)
// replication.close() → libera timers y conexiones
// ---------------------------------------------------------------------------------------------------------
//
// createStandaloneReplication({ db, cfg, now }) → replication
//   db   DatabaseSync con ensureSchema aplicado
//   cfg  { authId, publicUrl, peerUrl } (por defecto auth-solo en http://localhost:4000)
//   now  reloj inyectable (por defecto Date.now)

const crypto = require("node:crypto");
const { bootstrapLegacy, lastPosition, applyEntry, getMeta, setMeta, countUsers, usersChecksum, ConflictError, OPS } = require("../oplog.js");
const { createMutex } = require("./mutex.js");

const SOLO_TERM = 1;

function createStandaloneReplication({ db, cfg = {}, now = Date.now } = {}) {
    if (!db) throw new Error("createStandaloneReplication necesita db");
    const authId = cfg.authId ?? "auth-solo";
    const publicUrl = cfg.publicUrl ?? "http://localhost:4000";
    const peerUrl = cfg.peerUrl ?? null;

    // BD heredada de los Talleres 4-6: sus usuarios pasan a ser las primeras entradas del oplog
    const legacy = bootstrapLegacy(db);

    // Un nodo único es líder desde el arranque. Si la BD viene de un clúster con un término mayor, se conserva.
    const stored = Number(getMeta(db, "current_term") ?? 0);
    const term = Math.max(SOLO_TERM, Number.isSafeInteger(stored) ? stored : 0);
    if (term !== stored) setMeta(db, "current_term", term);

    const mutex = createMutex();

    function status() {
        const pos = lastPosition(db);
        return {
            authId,
            role: "leader",
            publicUrl,
            peerUrl,
            leaderUrl: publicUrl,
            knownPeers: [],
            lastAppliedSeq: pos.seq,
            users: countUsers(db),
            term,
            leaderId: authId,
            election: false,
            lastTerm: pos.term,
            checksum: usersChecksum(db),
        };
    }

    async function write(op, prepare) {
        if (!OPS.has(op)) throw new Error(`operación desconocida: ${op}`);
        return mutex.run(async () => {
            const prepared = await prepare(db);
            if (prepared?.error) return { ok: false, status: prepared.error.status, body: prepared.error.body };
            if (prepared && Object.hasOwn(prepared, "noop")) return { ok: true, noop: prepared.noop };
            if (!prepared?.data) throw new Error("prepare debe devolver { data }, { noop } o { error }");
            const entry = { seq: lastPosition(db).seq + 1, term, entryId: crypto.randomUUID(), op, data: prepared.data };
            try {
                applyEntry(db, entry);
            } catch (err) {
                // No debería pasar (prepare valida dentro del mutex), pero si choca se informa como conflicto
                if (err instanceof ConflictError) return { ok: false, status: 409, conflict: true, body: { error: "conflict" } };
                throw err;
            }
            return { ok: true, entry };
        });
    }

    return {
        legacyEntries: legacy,
        status,
        whoami: () => ({ authId, role: "leader" }),
        canServeRead: () => ({ ok: true }),
        isLagging: () => false,
        leader: () => ({ leaderId: authId, leaderUrl: publicUrl }),
        write,
        peers: () => [],
        now: () => now(),
        close() {},
    };
}

module.exports = { createStandaloneReplication };
