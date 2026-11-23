// Pruebas del nodo de replicación (replication/node.js) con el simulador: nodos reales sobre BD ':memory:',
// transporte en memoria y reloj falso (Taller 7, decisiones 8-14).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const { ensureSchema, applyEntry, entriesAfter, entryAt, lastPosition, usersChecksum } = require("../oplog.js");
const { createReplicationSim, REPL_CFG, TEST_HASH } = require("./helpers/sim.js");
const { startApp, captureLogs } = require("./helpers.js");

let logs;
before(() => {
    logs = captureLogs(); // las apps HTTP de R10 escriben su log de peticiones
});
after(() => logs.restore());

const others = (sim, L) => sim.ids.filter((id) => id !== L);
const snapshot = (sim, id) => {
    const s = sim.node(id).status();
    return { seq: s.lastAppliedSeq, users: s.users, checksum: s.checksum };
};
const rows = (db) => db.prepare("SELECT id, username, provider, password_hash, google_sub, email, created_at FROM users ORDER BY id").all().map((r) => ({ ...r }));
function assertConverged(sim, ids = sim.ids.filter((id) => sim.alive(id))) {
    const first = snapshot(sim, ids[0]);
    for (const id of ids) assert.deepEqual(snapshot(sim, id), first, `${id} igual a ${ids[0]}`);
    for (const id of ids) assert.deepEqual(rows(sim.db(id)), rows(sim.db(ids[0])), `${id}: mismas filas`);
}

// ---------- R1 ----------

test("R1 register en el líder: al responder, las 3 BD tienen la fila con el mismo userId, seq y checksum", async () => {
    const sim = createReplicationSim({ seed: 1 });
    const L = await sim.elect();
    sim.setDelay(L, others(sim, L)[1], 40); // una réplica lenta: el líder la espera dentro de ACK_GRACE_MS
    for (const name of ["r1_ana", "r1_beto"]) {
        const r = await sim.settle(sim.register(L, name));
        assert.equal(r.ok, true);
        // Sin avanzar el reloj: todos ya la tienen (el líder esperó los acks de los conectados)
        for (const id of sim.ids) {
            const row = sim.db(id).prepare("SELECT id FROM users WHERE username = ?").get(name);
            assert.equal(row?.id, r.entry.data.userId, `${id} tiene ${name}`);
        }
        assertConverged(sim);
    }
    assert.equal(snapshot(sim, L).seq, 2);
});

// ---------- R2 ----------

test("R2 mayoría: con una réplica caída funciona; con dos → 503 no_quorum inmediato y el líder no cambia", async () => {
    const sim = createReplicationSim({ seed: 2 });
    const L = await sim.elect();
    const [b, c] = others(sim, L);
    sim.kill(b);
    const ok = await sim.settle(sim.register(L, "r2_uno"));
    assert.equal(ok.ok, true);
    assert.deepEqual(snapshot(sim, c), snapshot(sim, L));
    sim.kill(c);
    const before = { ...snapshot(sim, L), role: sim.node(L).status().role, term: sim.node(L).status().term };
    const t0 = sim.clock.now();
    const r = await sim.settle(sim.register(L, "r2_dos"));
    assert.deepEqual(r, { ok: false, status: 503, body: { error: "no_quorum" } });
    assert.ok(sim.clock.now() - t0 <= 5, "inmediato, sin esperar el timeout");
    assert.deepEqual({ ...snapshot(sim, L), role: sim.node(L).status().role, term: sim.node(L).status().term }, before);
    assert.equal(sim.sent("write_propagate", (m) => m.msg.data.username === "r2_dos").length, 0, "no propone");
});

// ---------- R3 ----------

test("R3 timeout: sin write_ack → 503 replication_timeout; el líder no tiene la fila y las réplicas la deshacen", async () => {
    const sim = createReplicationSim({ seed: 3 });
    const L = await sim.elect();
    await sim.settle(sim.register(L, "r3_base"));
    const undrop = sim.drop((from, to, msg) => msg.type === "write_ack");
    const t0 = sim.clock.now();
    const r = await sim.settle(sim.register(L, "r3_perdida"));
    undrop();
    assert.deepEqual(r, { ok: false, status: 503, body: { error: "replication_timeout" } });
    assert.ok(sim.clock.now() - t0 >= REPL_CFG.WRITE_TIMEOUT_MS);
    assert.equal(sim.db(L).prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'r3_perdida'").get().n, 0, "el líder no aplicó");
    assert.equal(sim.sent("write_abort").length, 2, "abort a las dos réplicas");
    await sim.run(50);
    for (const id of sim.ids) assert.equal(sim.db(id).prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'r3_perdida'").get().n, 0, `${id} la deshizo`);
    assertConverged(sim);
});

// ---------- R4 ----------

test("R4 abort perdido: la siguiente escritura en el mismo seq con otro entryId corrige la cola de la réplica", async () => {
    const sim = createReplicationSim({ seed: 4 });
    const L = await sim.elect();
    await sim.settle(sim.register(L, "r4_base"));
    const seq = snapshot(sim, L).seq + 1;
    const noSync = sim.drop((from, to, msg) => msg.type === "request_sync"); // que la corrija la escritura, no un sync
    const undrop = sim.drop((from, to, msg) => msg.type === "write_ack" || msg.type === "write_abort");
    const r1 = await sim.settle(sim.register(L, "r4_fantasma"));
    undrop();
    assert.equal(r1.body.error, "replication_timeout");
    const ghost = entryAt(sim.db(others(sim, L)[0]), seq);
    assert.equal(ghost?.data.username, "r4_fantasma", "la réplica quedó con la entrada abortada");
    const r2 = await sim.settle(sim.register(L, "r4_buena"));
    assert.equal(r2.ok, true);
    assert.equal(r2.entry.seq, seq, "mismo seq");
    assert.notEqual(r2.entry.entryId, ghost.entryId, "otro entryId");
    for (const id of sim.ids) {
        assert.equal(entryAt(sim.db(id), seq).entryId, r2.entry.entryId, `${id}: la cola es la nueva`);
        assert.equal(sim.db(id).prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'r4_fantasma'").get().n, 0);
    }
    assert.equal(sim.sent("write_ack", (m) => m.msg.reason === "resync").length, 0, "sin resincronización completa");
    noSync();
    assertConverged(sim);
});

// ---------- R5 ----------

test("R5 conflicto profundo: una réplica con 3 entradas falsas recibe conflict:true, borra y queda igual al líder", async () => {
    const sim = createReplicationSim({ seed: 5 });
    const L = await sim.elect();
    for (let i = 0; i < 5; i++) await sim.settle(sim.register(L, `r5_u${i}`));
    const R = others(sim, L)[0];
    sim.kill(R);
    // Tres entradas que el líder nunca escribió (término 0: su log no puede ganar una elección)
    for (let i = 0; i < 3; i++) {
        const seq = lastPosition(sim.db(R)).seq + 1;
        applyEntry(sim.db(R), { seq, term: 0, entryId: `falsa-${i}`, op: "register", data: { userId: 100 + i, username: `r5_falsa${i}`, provider: "local", password_hash: TEST_HASH, created_at: "" } });
    }
    assert.equal(snapshot(sim, R).seq, 8);
    const mark = sim.messages.length;
    sim.restart(R);
    await sim.runUntil(() => snapshot(sim, R).checksum === snapshot(sim, L).checksum && snapshot(sim, R).seq === snapshot(sim, L).seq, 10000);
    const syncs = sim.messages.slice(mark).filter((m) => m.type === "sync_response" && m.to === R);
    assert.ok(syncs.some((m) => m.msg.conflict === true), "conflict:true");
    assert.equal(sim.db(R).prepare("SELECT COUNT(*) AS n FROM users WHERE username LIKE 'r5_falsa%'").get().n, 0);
    assertConverged(sim);
});

// ---------- R6 ----------

test("R6 sync por lotes: una réplica que se perdió 600 escrituras las recibe en 2 lotes (SYNC_BATCH 500)", async () => {
    const sim = createReplicationSim({ seed: 6 });
    const L = await sim.elect();
    const R = others(sim, L)[0];
    sim.kill(R);
    for (let i = 0; i < 600; i++) {
        const r = await sim.settle(sim.register(L, `r6_u${i}`));
        assert.equal(r.ok, true);
    }
    const mark = sim.messages.length;
    sim.restart(R);
    await sim.runUntil(() => snapshot(sim, R).seq === 600, 10000);
    const batches = sim.messages.slice(mark).filter((m) => m.type === "sync_response" && m.to === R);
    assert.deepEqual(batches.map((b) => [b.msg.entries.length, b.msg.done, b.msg.conflict]), [[500, false, false], [100, true, false]]);
    assert.equal(sim.messages.slice(mark).filter((m) => m.type === "request_sync" && m.from === R).length, 1, "un solo pedido en vuelo");
    assertConverged(sim);
    assert.equal(snapshot(sim, R).users, 600);
});

// ---------- R7 ----------

test("R7 BD heredada: el líder genera entradas legacy deterministas y una réplica nueva queda con los mismos ids y hashes", async () => {
    const legacy = new DatabaseSync(":memory:");
    ensureSchema(legacy, { dbPath: ":memory:" });
    const hash = bcrypt.hashSync("claveVieja1", 4);
    legacy.prepare("INSERT INTO users (id, username, provider, password_hash, created_at) VALUES (2, 'vieja_ana', 'local', ?, '2026-01-01 00:00:00')").run(hash);
    legacy.prepare("INSERT INTO users (id, username, provider, google_sub, email, created_at) VALUES (5, 'vieja_gabi', 'google', 'sub-v', 'v@example.com', '2026-01-02 00:00:00')").run();
    legacy.prepare("INSERT INTO users (id, username, provider, password_hash, created_at) VALUES (9, 'vieja_ivan', 'local', ?, '2026-01-03 00:00:00')").run(hash);
    const sim = createReplicationSim({ seed: 7, dbs: { "auth-a": legacy }, start: false });
    // Arrancan el nodo con datos y uno vacío: el vacío no puede ganar (su log está atrás)
    sim.startOnly(["auth-a", "auth-b"]);
    assert.equal(sim.node("auth-a").legacyEntries, 3);
    assert.deepEqual(entriesAfter(legacy, 0, 10).map((e) => e.entryId), ["legacy-2", "legacy-5", "legacy-9"]);
    await sim.runUntil(() => sim.leader() === "auth-a" && snapshot(sim, "auth-b").seq === 3, 10000);
    assert.equal(sim.leader(), "auth-a");
    sim.restart("auth-c"); // réplica nueva
    await sim.runUntil(() => snapshot(sim, "auth-c").seq === 3, 10000);
    assertConverged(sim);
    for (const id of sim.ids) {
        assert.deepEqual(sim.db(id).prepare("SELECT id FROM users ORDER BY id").all().map((r) => r.id), [2, 5, 9]);
        assert.equal(sim.db(id).prepare("SELECT password_hash FROM users WHERE id = 2").get().password_hash, hash);
        assert.deepEqual(entriesAfter(sim.db(id), 0, 10).map((e) => e.entryId), ["legacy-2", "legacy-5", "legacy-9"]);
    }
    // Y la siguiente escritura sigue la numeración: seq 4, id 10
    const r = await sim.settle(sim.register("auth-a", "nueva_tras_legado"));
    assert.deepEqual([r.entry.seq, r.entry.data.userId], [4, 10]);
});

// ---------- R8 ----------

test("R8 concurrencia: 10 registros paralelos dan seq e ids consecutivos iguales en todos; 5 del mismo nombre → uno gana", async () => {
    const sim = createReplicationSim({ seed: 8 });
    const L = await sim.elect();
    const results = await sim.settle(Promise.all(Array.from({ length: 10 }, (_, i) => sim.register(L, `r8_u${i}`))));
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual(results.map((r) => r.entry.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(results.map((r) => r.entry.data.userId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assertConverged(sim);
    const same = await sim.settle(Promise.all(Array.from({ length: 5 }, () => sim.register(L, "r8_mismo"))));
    assert.equal(same.filter((r) => r.ok).length, 1);
    assert.deepEqual(same.filter((r) => !r.ok).map((r) => r.status), [409, 409, 409, 409]);
    assertConverged(sim);
    assert.equal(snapshot(sim, L).seq, 11);
});

// ---------- R9 ----------

test("R9 el líder cae tras proponer a una sola réplica: gana la más al día y la escritura queda en todos (resultado ambiguo)", async () => {
    for (const seed of [9, 19, 29]) {
        const sim = createReplicationSim({ seed });
        const L = await sim.elect();
        await sim.settle(sim.register(L, "r9_base"));
        const [b, c] = others(sim, L);
        const undrop = sim.drop((from, to, msg) => msg.type === "write_propagate" && to === c);
        const promise = sim.register(L, "r9_ambigua");
        let result = null;
        promise.then((r) => (result = r));
        await sim.run(7); // la réplica b ya la aplicó; su ack todavía no llega al líder
        assert.equal(sim.db(b).prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'r9_ambigua'").get().n, 1);
        sim.kill(L);
        undrop();
        await sim.run(1);
        assert.equal(result?.status, 503, `semilla ${seed}: el cliente ve un error`);
        const t = await sim.runUntil(() => sim.leader() !== null, REPL_CFG.LEADER_TIMEOUT_MS + REPL_CFG.ELECTION_JITTER_MS + 2000);
        assert.notEqual(t, null);
        assert.equal(sim.leader(), b, `semilla ${seed}: gana la réplica con el log más al día`);
        await sim.runUntil(() => snapshot(sim, c).seq === snapshot(sim, b).seq, 5000);
        sim.restart(L);
        await sim.runUntil(() => snapshot(sim, L).seq === snapshot(sim, b).seq, 5000);
        assertConverged(sim);
        for (const id of sim.ids) assert.equal(sim.db(id).prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'r9_ambigua'").get().n, 1, `${id} la tiene`);
        // Reintentar el registro da 409: ya existía
        const retry = await sim.settle(sim.register(b, "r9_ambigua"));
        assert.equal(retry.status, 409);
    }
});

// ---------- R10 ----------

test("R10 lecturas: réplica al día sirve /login; atrasada ≥ 10 → not_leader; en elección → no_leader; lectura fallida atrasada → not_leader", async () => {
    const sim = createReplicationSim({ seed: 10 });
    const L = await sim.elect();
    const [R, other] = others(sim, L);
    const hash = bcrypt.hashSync("claveSegura1", 4);
    await sim.settle(sim.register(L, "r10_ana", { password_hash: hash }));
    await sim.run(REPL_CFG.AUTH_HEARTBEAT_MS + 100); // la réplica conoce el leaderSeq actual
    const api = await startApp({ db: sim.db(R), replication: sim.node(R) });
    try {
        assert.deepEqual(sim.node(R).canServeRead(), { ok: true });
        let res = await api.post("/login", { username: "r10_ana", password: "claveSegura1" });
        assert.equal(res.status, 200, "réplica al día");
        assert.equal(res.headers.get("x-auth-role"), "replica");
        res = await api.post("/login", { username: "r10_ana", password: "malaClave99" });
        assert.equal(res.status, 401, "al día: el 401 de siempre");

        // R se atrasa (no le llegan escrituras ni sync): 1 entrada → una lectura que fallaría da not_leader
        const stop = sim.drop((from, to, msg) => (msg.type === "write_propagate" && to === R) || (msg.type === "request_sync" && from === R));
        await sim.settle(sim.register(L, "r10_nuevo", { password_hash: hash }));
        await sim.run(REPL_CFG.AUTH_HEARTBEAT_MS + 100);
        assert.equal(sim.node(R).isLagging(), true);
        assert.deepEqual(sim.node(R).canServeRead(), { ok: true }, "lag 1 < 10: todavía sirve lecturas");
        res = await api.post("/login", { username: "r10_nuevo", password: "claveSegura1" });
        assert.deepEqual([res.status, res.json.error, res.json.leaderId], [503, "not_leader", L], "no 401: el usuario puede existir en el líder");
        res = await api.post("/login", { username: "r10_ana", password: "claveSegura1" });
        assert.equal(res.status, 200, "un usuario que sí tiene sigue entrando");

        // Atrasada 10 o más → not_leader con la URL del líder
        for (let i = 0; i < 9; i++) await sim.settle(sim.register(L, `r10_lag${i}`));
        await sim.run(REPL_CFG.AUTH_HEARTBEAT_MS + 100);
        const gate = sim.node(R).canServeRead();
        assert.deepEqual(gate, { ok: false, status: 503, body: { error: "not_leader", leaderUrl: sim.defs.find((d) => d.id === L).publicUrl, leaderId: L } });
        res = await api.post("/login", { username: "r10_ana", password: "claveSegura1" });
        assert.deepEqual([res.status, res.json.error], [503, "not_leader"]);
        stop();
        await sim.runUntil(() => snapshot(sim, R).seq === snapshot(sim, L).seq, 8000);
        assert.deepEqual(sim.node(R).canServeRead(), { ok: true }, "al ponerse al día vuelve a servir");

        // Elección en curso (cae el líder) → no_leader, también para lecturas
        sim.kill(L);
        await sim.runUntil(() => sim.node(R).status().leaderId === null || sim.node(other).status().leaderId === null, 15000);
        const waiting = [R, other].find((id) => sim.node(id).status().leaderId === null);
        assert.deepEqual(sim.node(waiting).canServeRead(), { ok: false, status: 503, body: { error: "no_leader" } });
    } finally {
        await api.close();
    }
});

// ---------- R11 ----------

test("R11 validación: entradas inconsistentes se rechazan con ok:false y no se aplican", async () => {
    const sim = createReplicationSim({ seed: 11 });
    const L = await sim.elect();
    const R = others(sim, L)[0];
    const term = sim.node(L).status().term;
    const seq = snapshot(sim, R).seq + 1;
    const base = { type: "write_propagate", term, seq, op: "register", data: { userId: 50, username: "r11_ok", provider: "local", password_hash: TEST_HASH, created_at: "" } };
    const bad = [
        { ...base, entryId: "x1", op: "register_google" }, // op y provider incoherentes
        { ...base, entryId: "x2", data: { ...base.data, password_hash: undefined } }, // sin password_hash
        { ...base, entryId: "x3", data: { ...base.data, username: "a b" } }, // username inválido
        { ...base, entryId: "x4", data: { ...base.data, provider: "google", google_sub: "s" } }, // google sin email
    ];
    const mark = sim.messages.length;
    for (const msg of bad) sim.node(R).handleMessage(L, msg);
    const acks = sim.messages.slice(mark).filter((m) => m.type === "write_ack" && m.from === R);
    assert.deepEqual(acks.map((a) => [a.msg.entryId, a.msg.ok, a.msg.reason]), bad.map((b) => [b.entryId, false, "invalid_entry"]));
    assert.equal(snapshot(sim, R).seq, seq - 1);
    assert.equal(sim.db(R).prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
    // Mensajes mal formados o de desconocidos se ignoran sin responder
    const mark2 = sim.messages.length;
    sim.node(R).handleMessage("auth-z", { ...base, entryId: "x5" });
    sim.node(R).handleMessage(L, { type: "write_propagate", term: "1", seq, entryId: "x6" });
    sim.node(R).handleMessage(L, null);
    assert.equal(sim.messages.length, mark2);
});

// ---------- R12 ----------

test("R12 términos: write_propagate de un término viejo se rechaza; un líder que ve un término mayor se baja y su escritura falla", async () => {
    const sim = createReplicationSim({ seed: 12 });
    const L = await sim.elect();
    const [R, other] = others(sim, L);
    const term = sim.node(L).status().term;
    assert.ok(term >= 1);
    const mark = sim.messages.length;
    sim.node(R).handleMessage(L, { type: "write_propagate", term: term - 1, seq: 1, entryId: "viejo", op: "register", data: { userId: 1, username: "r12_viejo", provider: "local", password_hash: TEST_HASH, created_at: "" } });
    const ack = sim.messages.slice(mark).find((m) => m.type === "write_ack" && m.from === R);
    assert.deepEqual([ack.msg.ok, ack.msg.reason, ack.msg.term], [false, "stale_term", term]);
    assert.equal(snapshot(sim, R).seq, 0);

    // Escritura pendiente (sin acks) y el líder recibe un término mayor
    const undrop = sim.drop((from, to, msg) => msg.type === "write_ack");
    const promise = sim.register(L, "r12_pendiente");
    let result = null;
    promise.then((r) => (result = r));
    await sim.run(20);
    assert.equal(result, null, "esperando mayoría");
    sim.node(L).handleMessage(other, { type: "heartbeat_ack", authId: other, term: term + 1, lastSeq: 0 });
    await sim.run(1);
    undrop();
    assert.equal(sim.node(L).status().role, "replica", "se bajó");
    assert.equal(result?.status, 503);
    assert.ok(["not_leader", "no_leader"].includes(result.body.error));
    assert.equal(sim.db(L).prepare("SELECT COUNT(*) AS n FROM users").get().n, 0, "no aplicó");
    // El clúster vuelve a tener líder con un término mayor
    assert.notEqual(await sim.runUntil(() => sim.leader() !== null, 15000), null);
    assert.ok(sim.node(sim.leader()).status().term > term);
});

// ---------- R13 ----------

test("R13 /status: forma completa, contadores coherentes, checksum igual y knownPeers sin el propio id", async () => {
    const lines = [];
    const sim = createReplicationSim({ seed: 13, log: { info: (t) => lines.push(t), warn: (t) => lines.push(t) } });
    const L = await sim.elect();
    for (let i = 0; i < 4; i++) await sim.settle(sim.register(L, `r13_u${i}`));
    const g = await sim.settle(sim.node(L).write("register_google", (db) => ({ data: { userId: 5, username: "r13_gabi", provider: "google", google_sub: "sub-secreto-13", email: "r13@example.com", created_at: "" } })));
    assert.equal(g.ok, true);
    const keys = ["authId", "role", "publicUrl", "peerUrl", "leaderUrl", "knownPeers", "lastAppliedSeq", "users", "term", "leaderId", "election", "lastTerm", "checksum"].sort();
    const statuses = sim.ids.map((id) => sim.node(id).status());
    for (const [i, s] of statuses.entries()) {
        const id = sim.ids[i];
        assert.deepEqual(Object.keys(s).sort(), keys);
        assert.equal(s.authId, id);
        assert.equal(s.role, id === L ? "leader" : "replica");
        assert.deepEqual(s.knownPeers, sim.ids.filter((x) => x !== id));
        assert.deepEqual([s.lastAppliedSeq, s.users, s.lastTerm, s.election], [5, 5, s.term, false]);
        assert.equal(s.leaderId, L);
        assert.equal(s.leaderUrl, sim.defs.find((d) => d.id === L).publicUrl);
        assert.equal(s.publicUrl, sim.defs.find((d) => d.id === id).publicUrl);
        assert.equal(s.checksum, usersChecksum(sim.db(id)));
    }
    assert.equal(new Set(statuses.map((s) => s.checksum)).size, 1, "mismo checksum");
    const R = sim.ids.find((id) => id !== L);
    const expected = sim.ids.filter((id) => id !== R).map((id) => [id, id === L ? "leader" : "replica", true]);
    assert.deepEqual(sim.node(R).peers().map((p) => [p.authId, p.role, p.connected]), expected, "peers de una réplica: el líder marcado y todos conectados");
    assert.ok(sim.node(R).peers().every((p) => p.publicUrl && p.peerUrl));
    assert.ok(lines.length > 0, "hubo logs de roles");
    assert.doesNotMatch(lines.join("\n"), /\$2[aby]\$|sub-secreto|r13@example|r13_/, "los logs no muestran hashes, subs, emails ni nombres");
});

// ---------- R14 ----------

test("R14 un líder aislado deja de aceptar escrituras de inmediato (no_quorum) y lecturas tras el lease", async () => {
    const sim = createReplicationSim({ seed: 14 });
    const L = await sim.elect();
    await sim.settle(sim.register(L, "r14_base"));
    sim.isolate(L);
    const w = await sim.settle(sim.register(L, "r14_aislado"));
    assert.deepEqual(w.body, { error: "no_quorum" });
    assert.deepEqual(sim.node(L).canServeRead(), { ok: true }, "todavía dentro del lease");
    const t = await sim.runUntil(() => sim.node(L).status().role !== "leader", REPL_CFG.LEADER_TIMEOUT_MS + 200);
    assert.notEqual(t, null, "se baja por el lease");
    assert.deepEqual(sim.node(L).canServeRead(), { ok: false, status: 503, body: { error: "no_leader" } });
    const w2 = await sim.settle(sim.register(L, "r14_tarde"));
    assert.deepEqual(w2, { ok: false, status: 503, body: { error: "no_leader" } });
    // La mayoría elige otro líder y al sanar todo converge
    assert.notEqual(await sim.runUntil(() => sim.leaders().some((id) => id !== L), 10000), null);
    sim.heal();
    await sim.runUntil(() => sim.node(L).status().leaderId === sim.leader(), 5000);
    assertConverged(sim);
});

test("nodo único por el camino de replicación: líder desde el arranque y escribe sin peers", async () => {
    const sim = createReplicationSim({ ids: ["auth-solo"], seed: 1 });
    assert.equal(sim.node("auth-solo").whoami().role, "leader", "líder sin esperar ticks");
    const r = await sim.settle(sim.register("auth-solo", "solo_ana"));
    assert.deepEqual([r.ok, r.entry.seq, r.entry.data.userId], [true, 1, 1]);
    assert.deepEqual(sim.node("auth-solo").peers(), []);
    assert.equal(sim.node("auth-solo").status().knownPeers.length, 0);
});
