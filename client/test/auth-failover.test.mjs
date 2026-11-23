// Pruebas de la lógica de failover entre auth-services (js/auth/failover.js) con fetch, sleep y reloj falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, isAllowedLeaderUrl, classifyResponse, createAuthClient, AuthUnavailableError, PASS_PAUSE_MS } from "../public/js/auth/failover.js";

const URLS = ["http://localhost:4001", "http://localhost:4002", "http://localhost:4003"];

// Respuesta mínima con status, JSON y headers X-Auth-*
function reply(status, body = {}, authId = null, role = "replica") {
    const headers = new Headers(authId ? { "X-Auth-Id": authId, "X-Auth-Role": role } : {});
    const make = () => ({ status, headers, json: async () => body, clone: () => make() });
    return make();
}

// Clúster falso: cada nodo responde según su función (o lanza); registra las llamadas y el tiempo simulado
function fakeCluster(handlers) {
    const calls = [];
    let t = 0;
    const fetchImpl = async (url, init) => {
        calls.push({ url, method: init?.method ?? "GET", at: t });
        const node = URLS.find((u) => url.startsWith(u + "/")) ?? url;
        const h = handlers[node];
        const out = typeof h === "function" ? h(calls.filter((c) => c.url.startsWith(node)).length) : h;
        if (out instanceof Error) throw out;
        return out;
    };
    return {
        calls,
        client: (opts = {}) => createAuthClient({ urls: URLS, fetchImpl, sleep: async (ms) => (t += ms), now: () => t, ...opts }),
        nodes: () => calls.map((c) => c.url.slice(0, 21)),
        sleeps: () => t,
    };
}

const down = () => new TypeError("fetch failed");
const leader = (id = "auth-b") => reply(200, { ok: true }, id, "leader");

test("normalizeUrl, isAllowedLeaderUrl y classifyResponse", () => {
    assert.equal(normalizeUrl("http://x:4001///"), "http://x:4001");
    assert.equal(normalizeUrl(null), "");
    assert.equal(isAllowedLeaderUrl("http://localhost:4002/", URLS), true);
    assert.equal(isAllowedLeaderUrl("http://127.0.0.1:4002", URLS), false, "igualdad exacta: otro host no vale");
    assert.equal(isAllowedLeaderUrl("http://evil.example.com", URLS), false);
    assert.equal(isAllowedLeaderUrl(undefined, URLS), false);
    assert.equal(classifyResponse(200, null, URLS), "return");
    for (const s of [400, 401, 404, 409, 413]) assert.equal(classifyResponse(s, { error: "x" }, URLS), "return", String(s));
    assert.equal(classifyResponse(503, { error: "not_leader", leaderUrl: URLS[1] }, URLS), "follow");
    assert.equal(classifyResponse(503, { error: "not_leader", leaderUrl: "http://otro:1" }, URLS), "retry");
    assert.equal(classifyResponse(503, { error: "not_leader" }, URLS), "retry");
    for (const e of ["no_leader", "no_quorum", "replication_timeout"]) assert.equal(classifyResponse(503, { error: e }, URLS), "retry", e);
    assert.equal(classifyResponse(503, { error: "otra_cosa" }, URLS), "next");
    assert.equal(classifyResponse(500, { error: "x" }, URLS), "next");
    assert.equal(classifyResponse(502, null, URLS), "next");
});

test("éxito en el primer nodo: sin reintentos y con X-Auth-Id / X-Auth-Role", async () => {
    const c = fakeCluster({ [URLS[0]]: reply(200, { token: "t" }, "auth-a", "leader") });
    const r = await c.client().request("/login", { method: "POST" });
    assert.equal(r.response.status, 200);
    assert.deepEqual([r.authId, r.authRole, r.retried, r.nodeUrl], ["auth-a", "leader", false, URLS[0]]);
    assert.equal(c.calls.length, 1);
});

test("error de red → segundo nodo; 5xx → siguiente; retried true", async () => {
    let c = fakeCluster({ [URLS[0]]: down(), [URLS[1]]: leader() });
    let r = await c.client().request("/login", { method: "POST" });
    assert.deepEqual([r.nodeUrl, r.retried], [URLS[1], true]);
    c = fakeCluster({ [URLS[0]]: reply(500, { error: "Error interno" }), [URLS[1]]: reply(502), [URLS[2]]: leader("auth-c") });
    r = await c.client().request("/register", { method: "POST" });
    assert.deepEqual([r.nodeUrl, r.authId, r.retried], [URLS[2], "auth-c", true]);
    assert.deepEqual(c.nodes(), URLS);
    assert.equal(c.sleeps(), 0, "sin esperas dentro de una pasada");
});

test("réplica 503 not_leader con leaderUrl permitido → reintento inmediato en esa URL", async () => {
    const c = fakeCluster({
        [URLS[0]]: reply(503, { error: "not_leader", leaderUrl: URLS[2] + "/", leaderId: "auth-c" }, "auth-a"),
        [URLS[1]]: () => assert.fail("no debía probar auth-b"),
        [URLS[2]]: reply(201, { userId: "1" }, "auth-c", "leader"),
    });
    const r = await c.client().request("/register", { method: "POST" });
    assert.deepEqual([r.response.status, r.nodeUrl, r.authRole, r.retried], [201, URLS[2], "leader", true]);
    assert.deepEqual(c.nodes(), [URLS[0], URLS[2]]);
    assert.equal(c.sleeps(), 0);
});

test("not_leader con una URL NO permitida se ignora y se sigue iterando", async () => {
    const c = fakeCluster({
        [URLS[0]]: reply(503, { error: "not_leader", leaderUrl: "http://atacante.example.com", leaderId: "x" }),
        [URLS[1]]: leader(),
    });
    const r = await c.client().request("/register", { method: "POST" });
    assert.equal(r.nodeUrl, URLS[1]);
    assert.ok(!c.calls.some((x) => x.url.includes("atacante")), "nunca se llama a una URL fuera de AUTH_URLS");
});

test("no_leader en todos → espera 1 s y nueva pasada hasta que uno responde", async () => {
    const c = fakeCluster({
        [URLS[0]]: reply(503, { error: "no_leader" }),
        [URLS[1]]: (n) => (n < 3 ? reply(503, { error: "no_leader" }) : leader()),
        [URLS[2]]: reply(503, { error: "no_quorum" }),
    });
    const r = await c.client().request("/login", { method: "POST" });
    assert.equal(r.nodeUrl, URLS[1]);
    assert.equal(c.sleeps(), 2 * PASS_PAUSE_MS, "dos pausas de 1 s entre pasadas");
    assert.equal(c.calls.length, 3 + 3 + 2);
});

test("presupuesto agotado → AuthUnavailableError con el último motivo", async () => {
    const c = fakeCluster({ [URLS[0]]: down(), [URLS[1]]: reply(503, { error: "no_leader" }), [URLS[2]]: reply(503, { error: "replication_timeout" }) });
    await assert.rejects(c.client().request("/register", { method: "POST" }), (err) => err instanceof AuthUnavailableError && err.reason === "replication_timeout");
    assert.ok(c.sleeps() < 12000, `respeta los 12 s (${c.sleeps()} ms de pausas)`);
    assert.ok(c.sleeps() >= 10000, "hizo varias pasadas");
    const tiny = fakeCluster({ [URLS[0]]: down(), [URLS[1]]: down(), [URLS[2]]: down() });
    await assert.rejects(tiny.client({ budgetMs: 500 }).request("/login"), (err) => err.name === "AuthUnavailableError" && err.reason === "error de red");
    assert.equal(tiny.sleeps(), 0, "sin presupuesto para otra pasada: no espera");
});

test("4xx (400, 401, 409) se devuelven sin reintentar", async () => {
    for (const status of [400, 401, 409]) {
        const c = fakeCluster({ [URLS[0]]: reply(status, { error: "x" }, "auth-a"), [URLS[1]]: () => assert.fail("no debía reintentar") });
        const r = await c.client().request("/login", { method: "POST" });
        assert.deepEqual([r.response.status, r.retried, c.calls.length], [status, false, 1], String(status));
    }
});

test("recuerda el último nodo bueno y empieza por él; las peticiones son secuenciales", async () => {
    let healthy = 1;
    let inFlight = 0;
    let maxInFlight = 0;
    const handler = (i) => async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return i === healthy ? leader(`auth-${"abc"[i]}`) : reply(503, { error: "no_leader" });
    };
    const c = fakeCluster({ [URLS[0]]: handler(0), [URLS[1]]: handler(1), [URLS[2]]: handler(2) });
    const client = c.client();
    await client.request("/register", { method: "POST" });
    assert.equal(client.lastNode(), URLS[1]);
    const before = c.calls.length;
    await client.request("/login", { method: "POST" });
    assert.equal(c.calls[before].url.startsWith(URLS[1]), true, "empieza por el último que respondió");
    assert.equal(c.calls.length - before, 1);
    healthy = 2;
    const r = await client.request("/login", { method: "POST" });
    assert.equal(r.nodeUrl, URLS[2]);
    assert.equal(client.lastNode(), URLS[2]);
    assert.equal(maxInFlight, 1, "nunca dos peticiones a la vez");
});
