// Pruebas de /register, /login y /auth/google (A1-A3, G1-G7, G9) y de que los logs no filtren datos (L1).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { OAuth2Client } = require("google-auth-library");
const { makeGoogleVerifier } = require("../google.js");
const { CLIENT_ID, captureLogs, startApp, decodeJwt } = require("./helpers.js");

// Datos sensibles usados en este archivo: ninguno debe aparecer en los logs (L1)
const SECRETS = {
    passwords: ["secret123", "clave_incorrecta", "otraClave9"],
    idTokens: [],
    emails: ["gabi.google@example.com", "nueva.persona@example.com", "sin.verificar@example.com"],
};
const idToken = (sub, email, verified = true) => {
    const token = `ok|${sub}|${email}|${verified}`;
    SECRETS.idTokens.push(token);
    return token;
};

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

// ---------- Registro y login local ----------

test("A1 /register: 201 sin datos sensibles, 409 duplicado (sin distinguir mayúsculas) y 400 en datos inválidos", async () => {
    const ok = await api.post("/register", { username: "alice", password: "secret123" });
    assert.equal(ok.status, 201);
    assert.deepEqual(Object.keys(ok.json).sort(), ["userId", "username"]);
    assert.equal(ok.json.userId, "1");
    assert.doesNotMatch(ok.text, /secret123|password|hash|\$2[aby]\$/i);

    assert.equal((await api.post("/register", { username: "alice", password: "secret123" })).status, 409);
    const upper = await api.post("/register", { username: "ALICE", password: "secret123" });
    assert.equal(upper.status, 409);
    assert.equal(upper.json.error, "El nombre de usuario ya existe");

    const invalid = [
        { username: "ab", password: "secret123" },
        { username: "a b!", password: "secret123" },
        { username: "a".repeat(33), password: "secret123" },
        { username: "bob_ok", password: "123" },
        { username: "bob_ok", password: 123 },
        {},
    ];
    for (const body of invalid) {
        const res = await api.post("/register", body);
        assert.equal(res.status, 400, `esperaba 400 para ${JSON.stringify(body)}`);
        assert.equal(typeof res.json.error, "string");
    }
    assert.equal((await api.post("/register", { username: "a".repeat(32), password: "secret123" })).status, 201, "32 caracteres es válido");

    const broken = await api.post("/register", "{bad");
    assert.equal(broken.status, 400);
    assert.equal(broken.json.error, "JSON inválido");
    const plain = await api.post("/register", "username=x&password=y", { "Content-Type": "text/plain" });
    assert.equal(plain.status, 400);
});

test("A2 /login correcto: token HS256 con userId string, username, provider local y 1 h de vigencia", async () => {
    const res = await api.post("/login", { username: "alice", password: "secret123" });
    assert.equal(res.status, 200);
    assert.equal(res.json.username, "alice");
    const p = decodeJwt(res.json.token);
    assert.equal(p.userId, "1");
    assert.equal(p.username, "alice");
    assert.equal(p.provider, "local");
    assert.equal(p.exp - p.iat, 3600);
    const header = JSON.parse(Buffer.from(res.json.token.split(".")[0], "base64url"));
    assert.equal(header.alg, "HS256");

    // Sin distinguir mayúsculas: entra a la misma cuenta y devuelve el nombre registrado
    const upper = await api.post("/login", { username: "ALICE", password: "secret123" });
    assert.equal(upper.status, 200);
    assert.equal(upper.json.username, "alice");
});

test("A3 contraseña incorrecta y login local de un usuario de Google: mismo 401 con cuerpo idéntico", async () => {
    const created = await api.post("/auth/google", { idToken: idToken("sub-a3", "gabi.google@example.com"), username: "solo_google" });
    assert.equal(created.status, 200);

    const wrong = await api.post("/login", { username: "alice", password: "clave_incorrecta" });
    const google = await api.post("/login", { username: "solo_google", password: "clave_incorrecta" });
    const missing = await api.post("/login", { username: "no_existe", password: "clave_incorrecta" });
    assert.equal(wrong.status, 401);
    assert.equal(google.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.text, google.text);
    assert.equal(wrong.text, missing.text);
    assert.deepEqual(wrong.json, { error: "Credenciales inválidas" });
});

// ---------- Google ----------

test("G1 ID token rechazado → 401 invalid_id_token; sin idToken → 400", async () => {
    const bad = await api.post("/auth/google", { idToken: "token-que-no-sirve" });
    SECRETS.idTokens.push("token-que-no-sirve");
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.json, { error: "invalid_id_token" });

    for (const body of [{}, { idToken: "" }, { idToken: 123 }, { idToken: "x".repeat(4097) }]) {
        const res = await api.post("/auth/google", body);
        // un idToken de más de 4096 caracteres ya no cabe en el límite de 4 kB del body (413)
        assert.ok(res.status === 400 || res.status === 413, `status ${res.status}`);
        if (res.status === 400) assert.deepEqual(res.json, { error: "idToken requerido" });
    }
});

test("G2 email no verificado → 401 email_not_verified", async () => {
    const res = await api.post("/auth/google", { idToken: idToken("sub-g2", "sin.verificar@example.com", false), username: "nadie_g2" });
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { error: "email_not_verified" });
});

let googleUserId;

test("G3 primer login: sin username → 409 username_required; con username → 200 con provider google", async () => {
    const token = idToken("sub-g3", "nueva.persona@example.com");
    const first = await api.post("/auth/google", { idToken: token });
    assert.equal(first.status, 409);
    assert.equal(first.json.error, "username_required");
    assert.equal(typeof first.json.hint, "string");
    assert.doesNotMatch(first.text, /nueva\.persona|sub-g3/);

    const ok = await api.post("/auth/google", { idToken: token, username: "gabi_g" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.username, "gabi_g");
    assert.doesNotMatch(ok.text, /nueva\.persona|sub-g3/);
    const p = decodeJwt(ok.json.token);
    assert.equal(p.provider, "google");
    assert.equal(typeof p.userId, "string");
    assert.equal(p.username, "gabi_g");
    googleUserId = p.userId;

    const row = api.db.prepare("SELECT provider, password_hash, google_sub, email FROM users WHERE id = ?").get(Number(p.userId));
    assert.equal(row.provider, "google");
    assert.equal(row.password_hash, null);
    assert.equal(row.google_sub, "sub-g3");
    assert.equal(row.email, "nueva.persona@example.com");
});

test("G4 segundo login del mismo sub: mismo userId y se ignora otro username", async () => {
    const again = await api.post("/auth/google", { idToken: idToken("sub-g3", "nueva.persona@example.com") });
    assert.equal(again.status, 200);
    assert.equal(decodeJwt(again.json.token).userId, googleUserId);
    assert.equal(again.json.username, "gabi_g");

    const other = await api.post("/auth/google", { idToken: idToken("sub-g3", "nueva.persona@example.com"), username: "otro_nombre" });
    assert.equal(other.status, 200);
    assert.equal(other.json.username, "gabi_g");
    assert.equal(decodeJwt(other.json.token).userId, googleUserId);
});

test("G5 username de un usuario local → 409 username_taken (también con otras mayúsculas); inválido → 400", async () => {
    for (const username of ["alice", "Alice"]) {
        const res = await api.post("/auth/google", { idToken: idToken("sub-g5", "otra@example.com"), username });
        assert.equal(res.status, 409);
        assert.deepEqual(res.json, { error: "username_taken" });
    }
    SECRETS.emails.push("otra@example.com");
    const invalid = await api.post("/auth/google", { idToken: idToken("sub-g5", "otra@example.com"), username: "a!" });
    assert.equal(invalid.status, 400);
    assert.match(invalid.json.error, /username/);
    assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'sub-g5'").get().n, 0);
});

test("G6 un usuario local no tiene google_sub ni email", () => {
    const row = api.db.prepare("SELECT provider, password_hash, google_sub, email FROM users WHERE username = 'alice'").get();
    assert.equal(row.provider, "local");
    assert.match(row.password_hash, /^\$2[aby]\$10\$/);
    assert.equal(row.google_sub, null);
    assert.equal(row.email, null);
});

test("G7 el username de un usuario de Google no se puede registrar con /register", async () => {
    for (const username of ["gabi_g", "GABI_G"]) {
        const res = await api.post("/register", { username, password: "otraClave9" });
        assert.equal(res.status, 409);
    }
});

test("G9 con el OAuth2Client real, un idToken basura da 401 invalid_id_token sin salir a la red", async () => {
    const real = await startApp({ verifyGoogle: makeGoogleVerifier(new OAuth2Client(CLIENT_ID), CLIENT_ID) });
    try {
        const started = Date.now();
        const res = await real.post("/auth/google", { idToken: "abc" });
        assert.equal(res.status, 401);
        assert.deepEqual(res.json, { error: "invalid_id_token" });
        assert.ok(Date.now() - started < 1000, "no debería esperar a la red");
    } finally {
        await real.close();
    }
});

// ---------- Logs ----------

test("L1 los logs no contienen contraseñas, idTokens, emails, subs ni JWT", () => {
    const output = logs.lines.join("\n");
    assert.ok(logs.lines.length > 10, "se esperaba el log de cada petición");
    for (const secret of [...SECRETS.passwords, ...SECRETS.idTokens, ...SECRETS.emails, "sub-g3", "sub-g5", "abc"]) {
        assert.ok(!output.includes(secret), `apareció en los logs: ${secret}`);
    }
    assert.doesNotMatch(output, /eyJ[A-Za-z0-9_-]{10,}/);
    assert.ok(logs.lines.includes("verificación de ID token fallida"));
});
