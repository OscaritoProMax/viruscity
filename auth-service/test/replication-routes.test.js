// Pruebas de las rutas sobre la interfaz de replicación (Taller 7) en un nodo único: cada escritura es una
// entrada del oplog, las carreras se resuelven dentro del mutex y el comportamiento del Taller 5 no cambia.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { entriesAfter, lastPosition } = require("../oplog.js");
const { captureLogs, startApp, decodeJwt } = require("./helpers.js");

let logs;
let api;

before(async () => {
    logs = captureLogs();
    api = await startApp();
});

after(async () => {
    await api.close();
    logs.restore();
});

const oplog = () => entriesAfter(api.db, 0, 1000);

test("register crea entradas del oplog con seq consecutivos, ids iguales y sin la contraseña en claro", async () => {
    const start = lastPosition(api.db).seq;
    const names = ["rep_ana", "rep_beto", "rep_carla"];
    const created = [];
    for (const username of names) {
        const r = await api.post("/register", { username, password: "claveSegura1" });
        assert.equal(r.status, 201);
        created.push(r.json);
    }
    const entries = oplog().slice(start);
    assert.deepEqual(entries.map((e) => e.seq), [start + 1, start + 2, start + 3]);
    assert.deepEqual(entries.map((e) => String(e.data.userId)), created.map((c) => c.userId), "userId de la respuesta = el de la entrada");
    for (const e of entries) {
        assert.equal(e.op, "register");
        assert.equal(e.term, 1);
        assert.match(e.entryId, /^[0-9a-f-]{36}$/);
        assert.equal(e.data.provider, "local");
        assert.match(e.data.password_hash, /^\$2[aby]\$/);
        assert.match(e.data.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        assert.doesNotMatch(JSON.stringify(e), /claveSegura1/);
    }
    // Las filas de users son las de las entradas
    const row = api.db.prepare("SELECT id, username, provider, created_at FROM users WHERE username = 'rep_beto'").get();
    assert.deepEqual([row.id, row.created_at], [entries[1].data.userId, entries[1].data.created_at]);
});

test("un usuario nuevo de Google genera register_google; el segundo login no crea otra entrada", async () => {
    const before = lastPosition(api.db).seq;
    const first = await api.post("/auth/google", { idToken: "ok|sub-rep-1|rep.gabi@example.com|true", username: "rep_gabi" });
    assert.equal(first.status, 200);
    assert.equal(decodeJwt(first.json.token).provider, "google");
    const entry = oplog().at(-1);
    assert.equal(entry.seq, before + 1);
    assert.equal(entry.op, "register_google");
    assert.deepEqual(
        { ...entry.data, created_at: undefined },
        { userId: Number(decodeJwt(first.json.token).userId), username: "rep_gabi", provider: "google", google_sub: "sub-rep-1", email: "rep.gabi@example.com", created_at: undefined }
    );
    const again = await api.post("/auth/google", { idToken: "ok|sub-rep-1|rep.gabi@example.com|true" });
    assert.equal(again.status, 200);
    assert.equal(again.json.username, "rep_gabi");
    assert.equal(lastPosition(api.db).seq, before + 1, "un login de un usuario existente es una lectura");
    // Username tomado por una cuenta local → 409 username_taken sin entrada
    const taken = await api.post("/auth/google", { idToken: "ok|sub-rep-2|otra@example.com|true", username: "REP_ANA" });
    assert.deepEqual([taken.status, taken.json.error], [409, "username_taken"]);
    assert.equal(lastPosition(api.db).seq, before + 1);
});

test("carrera: registros paralelos del mismo username → un solo 201, el resto 409, una sola entrada", async () => {
    const before = lastPosition(api.db).seq;
    const tries = await Promise.all(Array.from({ length: 6 }, (_, i) => api.post("/register", { username: i % 2 ? "Rep_Race" : "rep_race", password: "claveSegura1" })));
    const statuses = tries.map((t) => t.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
    for (const t of tries.filter((x) => x.status === 409)) assert.equal(t.json.error, "El nombre de usuario ya existe");
    assert.equal(lastPosition(api.db).seq, before + 1);
    // Y dos primeros logins de Google simultáneos del mismo sub: los dos entran con la MISMA cuenta
    const g = await Promise.all([1, 2].map(() => api.post("/auth/google", { idToken: "ok|sub-race|race@example.com|true", username: "rep_race_g" })));
    assert.deepEqual(g.map((r) => r.status), [200, 200]);
    assert.equal(decodeJwt(g[0].json.token).userId, decodeJwt(g[1].json.token).userId);
    assert.equal(lastPosition(api.db).seq, before + 2, "una sola entrada register_google");
});

test("login en nodo único: 200 con token, 401 genérico si falla (nunca 503)", async () => {
    await api.post("/register", { username: "rep_login", password: "claveSegura1" });
    const ok = await api.post("/login", { username: "rep_login", password: "claveSegura1" });
    assert.equal(ok.status, 200);
    assert.equal(decodeJwt(ok.json.token).username, "rep_login");
    for (const body of [{ username: "rep_login", password: "otraClave99" }, { username: "no_existe_x", password: "claveSegura1" }, { username: "rep_gabi", password: "claveSegura1" }]) {
        const r = await api.post("/login", body);
        assert.equal(r.status, 401, JSON.stringify(body));
        assert.deepEqual(r.json, { error: "Credenciales inválidas" });
    }
});

test("los logs no muestran contraseñas, hashes ni datos de Google", () => {
    const text = logs.lines.join("\n");
    assert.doesNotMatch(text, /claveSegura1|otraClave99|\$2[aby]\$|sub-rep|rep\.gabi@|race@example/);
});
