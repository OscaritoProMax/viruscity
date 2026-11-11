// Pruebas de la configuración por instancia (config.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, envFileArg } from "../config.js";

const SECRET = "s".repeat(40);
const valid = (changes = {}) => ({
    COORDINATOR_ID: "coord-b",
    PORT: "5002",
    PEER_PORT: "5102",
    PUBLIC_URL: "ws://localhost:5002",
    PEER_URL: "ws://localhost:5102",
    AUTH_URL: "http://localhost:4000",
    JWT_SECRET: SECRET,
    CLUSTER_SECRET: "c".repeat(64),
    MAP_FILE: "", // sin mapa: mundo de 1200 × 800 por defecto
    ...changes,
});

test("acepta una configuración válida con los tiempos por defecto", () => {
    const c = loadConfig(valid());
    assert.equal(c.coordinatorId, "coord-b");
    assert.equal(c.port, 5002);
    assert.equal(c.peerPort, 5102);
    assert.equal(c.publicUrl, "ws://localhost:5002");
    assert.equal(c.peerUrl, "ws://localhost:5102");
    assert.equal(c.authUrl, "http://localhost:4000");
    assert.deepEqual([c.heartbeatAuthMs, c.peerDiscoveryMs, c.peerPingMs, c.peerSyncMs, c.clientHeartbeatMs], [2000, 3000, 3000, 1000, 30000]);
    assert.equal(c.map, null);
    assert.equal(c.game.TICK_RATE, 20);
    assert.equal(c.game.WORLD_WIDTH, 1200);
});

test("acepta wss://, https:// y tiempos personalizados", () => {
    const c = loadConfig(valid({ PUBLIC_URL: "wss://abc.ngrok-free.app", AUTH_URL: "https://auth.ngrok-free.app", PEER_SYNC_MS: "500", HEARTBEAT_AUTH_MS: "100" }));
    assert.equal(c.publicUrl, "wss://abc.ngrok-free.app");
    assert.equal(c.peerSyncMs, 500);
    assert.equal(c.heartbeatAuthMs, 100);
});

test("normaliza AUTH_URL (y las URLs ws) quitando la barra final", () => {
    const c = loadConfig(valid({ AUTH_URL: "http://localhost:4000/", PUBLIC_URL: "ws://localhost:5002//" }));
    assert.equal(c.authUrl, "http://localhost:4000");
    assert.equal(c.publicUrl, "ws://localhost:5002");
});

test("carga el mapa del Taller 5 y toma de él el tamaño del mundo", () => {
    const c = loadConfig(valid({ MAP_FILE: "./map/virus-city.json" }));
    assert.equal(c.map.id, "virus-city");
    assert.equal(c.game.WORLD_HEIGHT, 3840);
});

test("rechaza configuraciones inválidas con un motivo claro", () => {
    const cases = {
        "id inválido": [{ COORDINATOR_ID: "coord b" }, /COORDINATOR_ID/],
        "id ausente": [{ COORDINATOR_ID: "" }, /COORDINATOR_ID/],
        "id de 33 caracteres": [{ COORDINATOR_ID: "c".repeat(33) }, /COORDINATOR_ID/],
        "PORT == PEER_PORT": [{ PEER_PORT: "5002" }, /distintos/],
        "PORT fuera de rango": [{ PORT: "70000" }, /PORT/],
        "PEER_PORT ausente": [{ PEER_PORT: "" }, /PEER_PORT/],
        "PUBLIC_URL con http://": [{ PUBLIC_URL: "http://localhost:5002" }, /PUBLIC_URL/],
        "PEER_URL que no es URL": [{ PEER_URL: "no es url" }, /PEER_URL/],
        "AUTH_URL con ws://": [{ AUTH_URL: "ws://localhost:4000" }, /AUTH_URL/],
        "CLUSTER_SECRET corto": [{ CLUSTER_SECRET: "corto" }, /CLUSTER_SECRET/],
        "CLUSTER_SECRET ausente": [{ CLUSTER_SECRET: "" }, /CLUSTER_SECRET/],
        "JWT_SECRET corto": [{ JWT_SECRET: "x".repeat(31) }, /JWT_SECRET/],
        "HEARTBEAT_AUTH_MS menor que 100": [{ HEARTBEAT_AUTH_MS: "99" }, /HEARTBEAT_AUTH_MS/],
        "PEER_DISCOVERY_MS no numérico": [{ PEER_DISCOVERY_MS: "rápido" }, /PEER_DISCOVERY_MS/],
        "PEER_PING_MS decimal": [{ PEER_PING_MS: "1500.5" }, /PEER_PING_MS/],
        "PEER_SYNC_MS negativo": [{ PEER_SYNC_MS: "-1" }, /PEER_SYNC_MS/],
        "TICK_RATE del juego inválido": [{ TICK_RATE: "0" }, /TICK_RATE/],
        "MAP_FILE que no existe": [{ MAP_FILE: "./map/no-existe.json" }, /MAP_FILE/],
    };
    for (const [name, [changes, pattern]] of Object.entries(cases)) {
        assert.throws(() => loadConfig(valid(changes)), pattern, name);
    }
});

test("envFileArg: --env <ruta>, --env=<ruta>, sin ruta y sin argumento", () => {
    assert.equal(envFileArg(["node", "index.js", "--env", ".env.coord-b"]), ".env.coord-b");
    assert.equal(envFileArg(["node", "index.js", "--env=.env.coord-c"]), ".env.coord-c");
    assert.equal(envFileArg(["node", "index.js", "--env"]), "");
    assert.equal(envFileArg(["node", "index.js"]), null);
});
