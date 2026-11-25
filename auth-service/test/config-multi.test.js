// Pruebas de la configuración del auth-service (config.js): nodo único y clúster con AUTH_NODES (Taller 7).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadConfig, parseAuthNodes, envFileArg, TUNABLES } = require("../config.js");

const BASE = {
    JWT_SECRET: "j".repeat(48),
    CLUSTER_SECRET: "c".repeat(48),
    GOOGLE_CLIENT_ID: "123456789012-pruebas.apps.googleusercontent.com",
};
const NODES = "auth-a|http://localhost:4001|ws://localhost:4101,auth-b|http://localhost:4002|ws://localhost:4102,auth-c|http://localhost:4003|ws://localhost:4103";
const nodeA = (extra = {}) => ({ ...BASE, AUTH_ID: "auth-a", PORT: "4001", PEER_PORT: "4101", PUBLIC_URL: "http://localhost:4001", PEER_URL: "ws://localhost:4101", AUTH_NODES: NODES, ...extra });
const rejects = (env, pattern, why) => assert.throws(() => loadConfig(env), pattern, why);

test("nodo único: sin AUTH_NODES es auth-solo, líder de un clúster de uno, con los valores por defecto", () => {
    const c = loadConfig({ ...BASE }, { baseDir: "/srv/auth" });
    assert.equal(c.authId, "auth-solo");
    assert.equal(c.port, 4000);
    assert.equal(c.peerPort, null);
    assert.equal(c.publicUrl, "http://localhost:4000");
    assert.equal(c.peerUrl, null);
    assert.equal(c.multi, false);
    assert.equal(c.majority, 1);
    assert.deepEqual(c.nodes, [{ id: "auth-solo", publicUrl: "http://localhost:4000", peerUrl: null }]);
    assert.equal(c.dbPath, path.resolve("/srv/auth", "./users.db"));
    assert.equal(c.jwtExpiresIn, "1h");
    assert.equal(c.bcryptRounds, 10);
    assert.equal(c.coordinatorTtlMs, 6000);
    assert.equal(c.reservationTtlMs, 3000);
    const defaults = Object.fromEntries(Object.entries(TUNABLES).map(([k, v]) => [k, v.def]));
    assert.deepEqual(c.tunables, defaults);
    assert.deepEqual(defaults, { AUTH_HEARTBEAT_MS: 2000, LEADER_TIMEOUT_MS: 6000, ELECTION_JITTER_MS: 1500, READ_TOLERANCE: 10, WRITE_TIMEOUT_MS: 3000, ACK_GRACE_MS: 150, SYNC_BATCH: 500, AUTH_PEER_PING_MS: 3000 });
    // Con AUTH_ID, PORT y PUBLIC_URL propios (por ejemplo detrás de ngrok)
    const d = loadConfig({ ...BASE, AUTH_ID: "mi-auth", PORT: "4500", PUBLIC_URL: "https://abc.ngrok-free.app/" });
    assert.deepEqual([d.authId, d.port, d.publicUrl], ["mi-auth", 4500, "https://abc.ngrok-free.app"]);
});

test("multi-nodo válido: tres nodos, mayoría 2, URLs del propio nodo y tunables leídos", () => {
    const c = loadConfig(nodeA({ AUTH_HEARTBEAT_MS: "500", LEADER_TIMEOUT_MS: "1500", SYNC_BATCH: "100", ELECTION_JITTER_MS: "0" }));
    assert.equal(c.authId, "auth-a");
    assert.equal(c.multi, true);
    assert.equal(c.majority, 2);
    assert.deepEqual([c.port, c.peerPort, c.publicUrl, c.peerUrl], [4001, 4101, "http://localhost:4001", "ws://localhost:4101"]);
    assert.deepEqual(c.nodes.map((n) => n.id), ["auth-a", "auth-b", "auth-c"]);
    assert.deepEqual(c.nodes[1], { id: "auth-b", publicUrl: "http://localhost:4002", peerUrl: "ws://localhost:4102" });
    assert.deepEqual([c.tunables.AUTH_HEARTBEAT_MS, c.tunables.LEADER_TIMEOUT_MS, c.tunables.SYNC_BATCH, c.tunables.ELECTION_JITTER_MS], [500, 1500, 100, 0]);
    // PUBLIC_URL y PEER_URL por defecto salen de los puertos
    const d = loadConfig(nodeA({ PUBLIC_URL: "", PEER_URL: "" }));
    assert.deepEqual([d.publicUrl, d.peerUrl], ["http://localhost:4001", "ws://localhost:4101"]);
    // Dos nodos (mayoría 2) y nueve (mayoría 5)
    const two = loadConfig(nodeA({ AUTH_NODES: NODES.split(",").slice(0, 2).join(",") }));
    assert.deepEqual([two.nodes.length, two.majority], [2, 2]);
    const nine = Array.from({ length: 9 }, (_, i) => `auth-${i}|http://localhost:${4001 + i}|ws://localhost:${4101 + i}`).join(",");
    const n9 = loadConfig({ ...BASE, AUTH_ID: "auth-0", PORT: "4001", PEER_PORT: "4101", AUTH_NODES: nine });
    assert.deepEqual([n9.nodes.length, n9.majority], [9, 5]);
});

test("normaliza barras finales en PUBLIC_URL, PEER_URL y AUTH_NODES", () => {
    const slashed = NODES.replace("http://localhost:4001", "http://localhost:4001/").replace("ws://localhost:4102", "ws://localhost:4102//");
    const c = loadConfig(nodeA({ PUBLIC_URL: "http://localhost:4001///", PEER_URL: "ws://localhost:4101/", AUTH_NODES: slashed }));
    assert.equal(c.publicUrl, "http://localhost:4001");
    assert.equal(c.peerUrl, "ws://localhost:4101");
    assert.equal(c.nodes[0].publicUrl, "http://localhost:4001");
    assert.equal(c.nodes[1].peerUrl, "ws://localhost:4102");
    assert.deepEqual(parseAuthNodes(" auth-x | https://x.example.com/ | wss://x.example.com/peer/ "), [{ id: "auth-x", publicUrl: "https://x.example.com", peerUrl: "wss://x.example.com/peer" }]);
    assert.deepEqual(parseAuthNodes(""), []);
    assert.deepEqual(parseAuthNodes(undefined), []);
});

test("rechaza: id propio ausente, URLs que no coinciden, ids duplicados y PEER_PORT faltante o igual a PORT", () => {
    rejects(nodeA({ AUTH_ID: "auth-z" }), /AUTH_ID "auth-z" no aparece en AUTH_NODES/);
    rejects(nodeA({ AUTH_ID: "" }), /AUTH_ID es obligatorio/);
    rejects(nodeA({ PUBLIC_URL: "http://localhost:4999" }), /publicUrl de "auth-a".*PUBLIC_URL/);
    rejects(nodeA({ PEER_URL: "ws://localhost:4999" }), /peerUrl de "auth-a".*PEER_URL/);
    rejects(nodeA({ PORT: "4002", PUBLIC_URL: "" }), /publicUrl de "auth-a"/, "PUBLIC_URL por defecto que no coincide");
    rejects(nodeA({ AUTH_NODES: `${NODES},auth-b|http://localhost:4009|ws://localhost:4109` }), /id repetido "auth-b"/);
    rejects(nodeA({ AUTH_NODES: `${NODES},auth-d|http://localhost:4002|ws://localhost:4109` }), /publicUrl repetida/);
    rejects(nodeA({ PEER_PORT: "" }), /PEER_PORT es obligatorio/);
    rejects(nodeA({ PEER_PORT: "4001" }), /PORT y PEER_PORT deben ser distintos/);
    rejects(nodeA({ PEER_PORT: "70000" }), /PEER_PORT/);
    rejects(nodeA({ AUTH_ID: "auth a" }), /AUTH_ID/);
});

test("rechaza AUTH_NODES mal formado (también con una sola entrada) y más de 9 nodos", () => {
    for (const bad of [
        "auth-a|http://localhost:4001", // faltan partes
        "auth-a|http://localhost:4001|ws://localhost:4101|extra",
        "auth a|http://localhost:4001|ws://localhost:4101", // id inválido
        "auth-a|ws://localhost:4001|ws://localhost:4101", // publicUrl no es http
        "auth-a|http://localhost:4001|http://localhost:4101", // peerUrl no es ws
        "auth-a||ws://localhost:4101",
        "auth-a|no-es-url|ws://localhost:4101",
    ]) {
        rejects({ ...BASE, AUTH_ID: "auth-a", PORT: "4001", PEER_PORT: "4101", AUTH_NODES: bad }, /AUTH_NODES, entrada 1/, bad);
    }
    rejects(nodeA({ AUTH_NODES: `${NODES},roto` }), /AUTH_NODES, entrada 4/);
    const ten = Array.from({ length: 10 }, (_, i) => `auth-${i}|http://localhost:${4001 + i}|ws://localhost:${4101 + i}`).join(",");
    rejects({ ...BASE, AUTH_ID: "auth-0", PORT: "4001", PEER_PORT: "4101", AUTH_NODES: ten }, /como máximo 9 nodos/);
    // Una sola entrada válida = clúster de uno (debe ser el propio nodo)
    const solo = loadConfig({ ...BASE, AUTH_ID: "auth-a", PORT: "4001", PEER_PORT: "4101", AUTH_NODES: "auth-a|http://localhost:4001|ws://localhost:4101" });
    assert.deepEqual([solo.multi, solo.nodes.length, solo.majority], [false, 1, 1]);
});

test("rechaza tunables inválidos y LEADER_TIMEOUT_MS menor que 3 heartbeats", () => {
    for (const key of Object.keys(TUNABLES)) {
        rejects(nodeA({ [key]: "abc" }), new RegExp(`${key} debe ser un número entero`), key);
        rejects(nodeA({ [key]: "-5" }), new RegExp(key), `${key} negativo`);
        rejects(nodeA({ [key]: "1.5" }), new RegExp(key), `${key} decimal`);
    }
    rejects(nodeA({ READ_TOLERANCE: "0" }), /READ_TOLERANCE debe ser mayor o igual a 1/);
    rejects(nodeA({ SYNC_BATCH: "0" }), /SYNC_BATCH/);
    rejects(nodeA({ SYNC_BATCH: "5001" }), /SYNC_BATCH no puede ser mayor que 5000/);
    rejects(nodeA({ AUTH_HEARTBEAT_MS: "10" }), /AUTH_HEARTBEAT_MS debe ser mayor o igual a 50/);
    rejects(nodeA({ AUTH_HEARTBEAT_MS: "2000", LEADER_TIMEOUT_MS: "5999" }), /LEADER_TIMEOUT_MS debe ser al menos 3 veces AUTH_HEARTBEAT_MS/);
    assert.equal(loadConfig(nodeA({ AUTH_HEARTBEAT_MS: "2000", LEADER_TIMEOUT_MS: "6000" })).tunables.LEADER_TIMEOUT_MS, 6000, "justo 3 veces vale");
});

test("conserva las validaciones de los Talleres 5 y 6", () => {
    rejects({ ...BASE, JWT_SECRET: "" }, /JWT_SECRET es obligatorio/);
    rejects({ ...BASE, JWT_SECRET: "corto" }, /JWT_SECRET debe tener al menos 32/);
    rejects({ ...BASE, CLUSTER_SECRET: undefined }, /CLUSTER_SECRET es obligatorio/);
    rejects({ ...BASE, CLUSTER_SECRET: "corto" }, /CLUSTER_SECRET debe tener al menos 32/);
    rejects({ ...BASE, GOOGLE_CLIENT_ID: "" }, /GOOGLE_CLIENT_ID es obligatorio/);
    rejects({ ...BASE, GOOGLE_CLIENT_ID: "abc.example.com" }, /GOOGLE_CLIENT_ID debe terminar/);
    rejects({ ...BASE, BCRYPT_ROUNDS: "9" }, /BCRYPT_ROUNDS debe ser mayor o igual a 10/);
    rejects({ ...BASE, BCRYPT_ROUNDS: "32" }, /BCRYPT_ROUNDS no puede ser mayor que 31/);
    rejects({ ...BASE, BCRYPT_ROUNDS: "diez" }, /BCRYPT_ROUNDS debe ser un número entero/);
    rejects({ ...BASE, COORDINATOR_TTL_MS: "999" }, /COORDINATOR_TTL_MS/);
    rejects({ ...BASE, RESERVATION_TTL_MS: "-1" }, /RESERVATION_TTL_MS/);
    rejects({ ...BASE, PORT: "0" }, /PORT debe ser un número de puerto válido/);
    rejects({ ...BASE, PUBLIC_URL: "ws://localhost:4000" }, /PUBLIC_URL debe empezar por http:\/\/ o https:\/\//);
    assert.equal(loadConfig({ ...BASE, RESERVATION_TTL_MS: "0" }).reservationTtlMs, 0, "0 desactiva las reservas");
    assert.deepEqual(loadConfig({ ...BASE, GOOGLE_CLIENT_ID: "localtest-1.apps.googleusercontent.com" }).warnings.length, 1);
});

test("envFileArg: --env ruta, --env=ruta, sin valor y sin la opción", () => {
    assert.equal(envFileArg(["node", "index.js", "--env", ".env.auth-a"]), ".env.auth-a");
    assert.equal(envFileArg(["node", "index.js", "--env=.env.auth-b"]), ".env.auth-b");
    assert.equal(envFileArg(["node", "index.js", "--env"]), "");
    assert.equal(envFileArg(["node", "index.js"]), null);
});
