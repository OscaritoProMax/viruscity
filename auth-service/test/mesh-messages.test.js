// Pruebas de la parte pura del mesh entre auth-services (replication/mesh-messages.js): quién inicia,
// conexiones duplicadas y validación estricta de cada tipo de mensaje (Taller 7, decisiones 3 y 4).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shouldInitiate, resolveLink, validatePeerMessage } = require("../replication/mesh-messages.js");
const { parseAuthNodes } = require("../config.js");

const NODES = ["auth-a", "auth-b", "auth-c"];
const opts = (from) => ({ from, selfId: "auth-b", nodeIds: NODES, syncBatch: 500 });
const ok = (msg, from = "auth-a") => {
    const v = validatePeerMessage(msg, opts(from));
    assert.equal(v.ok, true, `${String(JSON.stringify(msg)).slice(0, 80)} → ${v.reason}`);
    return v.msg;
};
const bad = (msg, from = "auth-a", why = "") => {
    const v = validatePeerMessage(msg, opts(from));
    assert.equal(v.ok, false, `${why} ${String(JSON.stringify(msg)).slice(0, 80)}`);
    assert.equal(typeof v.reason, "string");
};
const ENTRY = { seq: 3, term: 2, entryId: "e-3", op: "register", data: { userId: 3, username: "ana", provider: "local", password_hash: "$2a$10$x", created_at: "" } };

test("shouldInitiate y resolveLink (decisión 3): inicia el id menor; duplicados según dirección e id", () => {
    assert.equal(shouldInitiate("auth-a", "auth-b"), true);
    assert.equal(shouldInitiate("auth-b", "auth-a"), false);
    assert.equal(shouldInitiate("auth-10", "auth-2"), true, "comparación de strings");
    // Entrante de un id MAYOR: rechazo si ya hay una conexión, si no se acepta
    assert.equal(resolveLink("auth-a", "auth-b", { direction: "in", existing: true }), "reject");
    assert.equal(resolveLink("auth-a", "auth-b", { direction: "in", existing: false }), "accept");
    // Entrante de un id MENOR (el que debe iniciar): reemplaza
    assert.equal(resolveLink("auth-c", "auth-a", { direction: "in", existing: true }), "replace");
    assert.equal(resolveLink("auth-c", "auth-a", { direction: "in", existing: false }), "accept");
    // Saliente: solo si no hay otra
    assert.equal(resolveLink("auth-a", "auth-b", { direction: "out", existing: true }), "reject");
    assert.equal(resolveLink("auth-a", "auth-b", { direction: "out", existing: false }), "accept");
});

test("hello: id conocido y distinto del propio, campos completos; copia sin campos de más", () => {
    const hello = { type: "hello", authId: "auth-a", role: "leader", term: 3, leaderId: "auth-a", lastSeq: 10, lastTerm: 3, extra: "x" };
    assert.deepEqual(validatePeerMessage(hello, { selfId: "auth-b", nodeIds: NODES }).msg, { type: "hello", authId: "auth-a", role: "leader", term: 3, leaderId: "auth-a", lastSeq: 10, lastTerm: 3 });
    assert.equal(ok({ ...hello, leaderId: null, role: "replica" }).leaderId, null);
    assert.equal(ok({ ...hello, leaderId: undefined }).leaderId, null, "leaderId ausente = null");
    bad({ ...hello, authId: "auth-z" }, null, "id fuera de AUTH_NODES");
    bad({ ...hello, authId: "auth-b" }, null, "id propio");
    bad({ ...hello, authId: "auth-a" }, "auth-c", "authId distinto de la conexión");
    bad({ ...hello, role: "candidate" }, null, "role fuera de leader|replica");
    bad({ ...hello, term: -1 }, null);
    bad({ ...hello, lastSeq: "10" }, null);
    bad({ ...hello, leaderId: "auth-z" }, null, "leaderId desconocido");
    bad({ ...hello, authId: "a b" }, null);
});

test("heartbeat, heartbeat_ack, election, vote y new_leader: el remitente debe ser la conexión", () => {
    assert.deepEqual(ok({ type: "heartbeat", authId: "auth-a", term: 2, lastSeq: 5, lastTerm: 2, x: 1 }), { type: "heartbeat", authId: "auth-a", term: 2, lastSeq: 5, lastTerm: 2 });
    bad({ type: "heartbeat", authId: "auth-c", term: 2, lastSeq: 5, lastTerm: 2 }, "auth-a", "authId falso");
    bad({ type: "heartbeat", authId: "auth-a", term: 2, lastSeq: 5 }, "auth-a", "sin lastTerm");
    assert.deepEqual(ok({ type: "heartbeat_ack", authId: "auth-a", term: 2, lastSeq: 5 }), { type: "heartbeat_ack", authId: "auth-a", term: 2, lastSeq: 5 });
    bad({ type: "heartbeat_ack", authId: "auth-c", term: 2, lastSeq: 5 });
    assert.deepEqual(ok({ type: "election", candidate: "auth-a", term: 4, lastSeq: 1, lastTerm: 1 }), { type: "election", candidate: "auth-a", term: 4, lastSeq: 1, lastTerm: 1 });
    bad({ type: "election", candidate: "auth-c", term: 4, lastSeq: 1, lastTerm: 1 }, "auth-a", "candidate falso");
    assert.deepEqual(ok({ type: "vote", voter: "auth-a", term: 4, voteGranted: true }), { type: "vote", voter: "auth-a", term: 4, voteGranted: true });
    bad({ type: "vote", voter: "auth-c", term: 4, voteGranted: true }, "auth-a", "voter falso");
    bad({ type: "vote", voter: "auth-a", term: 4, voteGranted: "si" });
    assert.deepEqual(ok({ type: "new_leader", leader: "auth-a", term: 4 }), { type: "new_leader", leader: "auth-a", term: 4 });
    bad({ type: "new_leader", leader: "auth-c", term: 4 }, "auth-a", "leader falso");
    bad({ type: "new_leader", leader: "auth-a", term: 1.5 });
});

test("write_propagate, write_ack y write_abort", () => {
    assert.deepEqual(ok({ type: "write_propagate", ...ENTRY, extra: 1 }), { type: "write_propagate", ...ENTRY });
    bad({ type: "write_propagate", ...ENTRY, seq: 0 }, "auth-a", "seq 0");
    bad({ type: "write_propagate", ...ENTRY, entryId: "x".repeat(65) }, "auth-a", "entryId largo");
    bad({ type: "write_propagate", ...ENTRY, op: "delete" }, "auth-a", "op desconocida");
    bad({ type: "write_propagate", ...ENTRY, data: "texto" }, "auth-a", "data no es objeto");
    assert.deepEqual(ok({ type: "write_ack", authId: "auth-a", term: 2, seq: 3, entryId: "e-3", ok: false, reason: "stale_term" }), { type: "write_ack", authId: "auth-a", term: 2, seq: 3, entryId: "e-3", ok: false, reason: "stale_term" });
    assert.equal("reason" in ok({ type: "write_ack", authId: "auth-a", term: 2, seq: 3, entryId: "e-3", ok: true }), false);
    bad({ type: "write_ack", authId: "auth-c", term: 2, seq: 3, entryId: "e-3", ok: true }, "auth-a", "authId falso");
    bad({ type: "write_ack", authId: "auth-a", term: 2, seq: 3, entryId: "e-3", ok: "true" });
    bad({ type: "write_ack", authId: "auth-a", term: 2, seq: 3, entryId: "e-3", ok: false, reason: "x".repeat(41) });
    assert.deepEqual(ok({ type: "write_abort", term: 2, seq: 3, entryId: "e-3" }), { type: "write_abort", term: 2, seq: 3, entryId: "e-3" });
    bad({ type: "write_abort", term: 2, seq: 3 });
});

test("request_sync y sync_response (máximo SYNC_BATCH entradas)", () => {
    assert.deepEqual(ok({ type: "request_sync", fromSeq: 0, fromEntryId: null }), { type: "request_sync", fromSeq: 0, fromEntryId: null });
    assert.deepEqual(ok({ type: "request_sync", fromSeq: 7, fromEntryId: "e-7" }), { type: "request_sync", fromSeq: 7, fromEntryId: "e-7" });
    bad({ type: "request_sync", fromSeq: -1, fromEntryId: null });
    bad({ type: "request_sync", fromSeq: 1 }, "auth-a", "sin fromEntryId");
    const entries = Array.from({ length: 500 }, (_, i) => ({ ...ENTRY, seq: i + 1, entryId: `e-${i + 1}` }));
    const sync = ok({ type: "sync_response", term: 2, entries, conflict: false, done: true });
    assert.equal(sync.entries.length, 500);
    bad({ type: "sync_response", term: 2, entries: [...entries, { ...ENTRY, seq: 501 }], conflict: false, done: true }, "auth-a", "501 > SYNC_BATCH");
    assert.equal(validatePeerMessage({ type: "sync_response", term: 2, entries: entries.slice(0, 11), conflict: false, done: false }, { ...opts("auth-a"), syncBatch: 10 }).ok, false, "respeta un SYNC_BATCH menor");
    bad({ type: "sync_response", term: 2, entries: [{ ...ENTRY, op: "x" }], conflict: false, done: true }, "auth-a", "entrada mal formada");
    bad({ type: "sync_response", term: 2, entries: "[]", conflict: false, done: true });
    bad({ type: "sync_response", term: 2, entries: [], conflict: "no", done: true });
    bad({ type: "sync_response", term: 2, entries: [], conflict: false });
});

test("basura: sin type, tipos desconocidos, no-objetos", () => {
    for (const junk of [null, undefined, 5, "hola", [], {}, { type: 3 }, { type: "desconocido" }, { type: "__proto__" }]) bad(junk);
});

test("parseAuthNodes (cubierto también en config-multi): entradas id|publicUrl|peerUrl normalizadas", () => {
    assert.deepEqual(parseAuthNodes("auth-a|http://localhost:4001/|ws://localhost:4101"), [{ id: "auth-a", publicUrl: "http://localhost:4001", peerUrl: "ws://localhost:4101" }]);
    assert.throws(() => parseAuthNodes("auth-a|http://localhost:4001"), /AUTH_NODES, entrada 1/);
});
