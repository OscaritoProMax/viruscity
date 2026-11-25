// Smoke del track 2.5 del examen final (modo espectador): npm run smoke:espectador
//
// Levanta como procesos hijos el auth-service (puerto 4660, base temporal), coord-a (5671/5771, con
// MAX_SPECTATORS=3) y coord-b (5672/5772). Secretos al azar; ningún .env real. Mundo de 1200 × 800 sin mapa.
//
//   E1  malla completa
//   E2  un espectador entra a /spectate SIN token: welcome con spectator:true y sin "you", y recibe el state
//   E3  ve moverse a alice, que juega en OTRO coordinador
//   E4  lo que mande (intent, extras_update, game_action, basura) se ignora: nada se mueve, nadie aparece,
//       el coordinador sigue vivo y /status lo cuenta
//   E5  los espectadores no cuentan como jugadores (/status y el directorio del auth)
//   E6  en partida ve fase, cura y misiones con rol "spectator" y ningún rol de nadie
//   E7  con el máximo lleno, el siguiente espectador recibe 4003
//   E8  si inunda de mensajes, se le cierra (1008) sin afectar a nadie
//   E9  /connect sin token sigue cerrando con 4001
//   E10 ningún token aparece en los logs
//
// Al terminar (éxito, fallo o Ctrl+C) mata TODOS los hijos y borra los temporales.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..", "..");
const AUTH_DIR = path.join(ROOT, "auth-service");
const COORD_DIR = path.join(ROOT, "coordinator");

const AUTH_PORT = 4660;
const AUTH = `http://localhost:${AUTH_PORT}`;
const COORDS = { a: 1, b: 2 };
const port = (l) => 5670 + COORDS[l];
const peerPort = (l) => 5770 + COORDS[l];
const URL_OF = (l) => `ws://localhost:${port(l)}`;
const MAX_SPECTATORS = 3;

const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const CLUSTER_SECRET = crypto.randomBytes(32).toString("hex");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viruscity-spectate-"));
const emptyEnv = path.join(tmpDir, "vacio.env");
fs.writeFileSync(emptyEnv, "");

const children = new Map();
const tokens = [];
let passed = 0;
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function report(id, desc, ok, detail = "") {
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "✔" : "✘"} ${id} ${desc}${detail ? ` — ${detail}` : ""}`);
}
async function waitFor(condition, ms, every = 50) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await condition()) return true;
        await sleep(every);
    }
    return Boolean(await condition());
}
const getJson = async (url) => {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return { status: r.status, json: await r.json() };
    } catch {
        return { status: 0, json: null };
    }
};
const status = async (l) => (await getJson(`http://localhost:${port(l)}/status`)).json;

function sqliteFlag() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    return (major === 22 && minor < 13) || (major === 23 && minor < 4) ? ["--experimental-sqlite"] : [];
}

function launch(name, cwd, args, env) {
    const log = fs.openSync(path.join(tmpDir, `${name}.log`), "a");
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", log, log] });
    fs.closeSync(log);
    children.set(name, child);
    return child;
}

function startAuth() {
    return launch("auth", AUTH_DIR, [...sqliteFlag(), "index.js"], {
        PORT: String(AUTH_PORT),
        DB_PATH: path.join(tmpDir, "users.db"),
        JWT_SECRET,
        JWT_EXPIRES_IN: "1h",
        BCRYPT_ROUNDS: "10",
        GOOGLE_CLIENT_ID: "000000000000-smoke.apps.googleusercontent.com",
        CLUSTER_SECRET,
        COORDINATOR_TTL_MS: "6000",
        RESERVATION_TTL_MS: "3000",
    });
}

function startCoord(l) {
    return launch(`coord-${l}`, COORD_DIR, ["index.js", "--env", emptyEnv], {
        COORDINATOR_ID: `coord-${l}`,
        PORT: String(port(l)),
        PEER_PORT: String(peerPort(l)),
        PUBLIC_URL: URL_OF(l),
        PEER_URL: `ws://localhost:${peerPort(l)}`,
        AUTH_URLS: AUTH,
        JWT_SECRET,
        CLUSTER_SECRET,
        MAP_FILE: "",
        STATE_DB_PATH: "off",
        MAX_SPECTATORS: l === "a" ? String(MAX_SPECTATORS) : "50",
        HEARTBEAT_AUTH_MS: "1000",
        PEER_DISCOVERY_MS: "1000",
        PEER_PING_MS: "1000",
        MIN_PLAYERS_TO_START: "3",
        MATCH_COUNTDOWN_MS: "500",
        INITIAL_LOCK_MS: "0",
    });
}

let cleaned = false;
async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const child of children.values()) if (child.exitCode === null) child.kill();
    await sleep(500);
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
process.on("SIGINT", async () => {
    console.log("\nInterrumpido: deteniendo los procesos…");
    await cleanup();
    process.exit(1);
});

const suffix = crypto.randomBytes(2).toString("hex");
async function createUser(label) {
    const username = `${label}_${suffix}`;
    const body = JSON.stringify({ username, password: "secret123" });
    const headers = { "Content-Type": "application/json" };
    await fetch(`${AUTH}/register`, { method: "POST", headers, body });
    const r = await fetch(`${AUTH}/login`, { method: "POST", headers, body });
    const { token } = await r.json();
    tokens.push(token);
    return { username, token };
}

// Cliente WebSocket (jugador con token o espectador sin token)
function open(url) {
    const ws = new WebSocket(url);
    const c = { ws, welcome: null, state: null, game: null, states: 0, events: [], closeInfo: null, raw: [] };
    c.closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve((c.closeInfo = { code, reason: String(reason) }))));
    ws.on("error", () => {});
    ws.on("message", (raw) => {
        const text = String(raw);
        c.raw.push(text);
        if (c.raw.length > 50) c.raw.shift();
        const m = JSON.parse(text);
        if (m.type === "welcome") c.welcome = m;
        if (m.type === "state") {
            c.state = m;
            c.states++;
        }
        if (m.type === "game") c.game = m;
        if (m.type === "event") c.events.push(m);
    });
    c.find = (username) => c.state?.players.find((p) => p.username === username) ?? null;
    c.send = (obj) => ws.readyState === 1 && ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
    c.close = async () => {
        if (ws.readyState <= 1) ws.close();
        await c.closed;
    };
    return c;
}
const player = (l, token) => open(`${URL_OF(l)}/connect?token=${encodeURIComponent(token)}`);
const spectator = (l) => open(`${URL_OF(l)}/spectate`);
const fmt = (p) => (p ? `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})` : "—");

async function main() {
    const ports = [AUTH_PORT, ...Object.keys(COORDS).flatMap((l) => [port(l), peerPort(l)])];
    const busy = [];
    for (const p of ports) if ((await getJson(`http://localhost:${p}/`)).status !== 0) busy.push(p);
    if (busy.length) {
        report("PRE", "puertos libres", false, `ocupados: ${busy.join(", ")}`);
        return;
    }

    startAuth();
    await waitFor(async () => (await getJson(`${AUTH}/health`)).status === 200, 15000, 200);
    for (const l of Object.keys(COORDS)) startCoord(l);

    // E1
    const meshOk = await waitFor(async () => {
        const all = await Promise.all(Object.keys(COORDS).map(status));
        return all.every((s) => s && s.peers.length === 1);
    }, 20000, 200);
    report("E1", "malla completa (coord-a y coord-b)", meshOk);
    if (!meshOk) return;

    // E2
    const spec = spectator("a");
    const gotState = await waitFor(() => spec.welcome !== null && spec.states > 0 && spec.game !== null, 5000);
    report(
        "E2",
        "un espectador entra a /spectate SIN token y recibe welcome, state y la vista de la partida",
        gotState && spec.welcome.spectator === true && spec.welcome.you === undefined && Boolean(spec.welcome.world),
        `spectator=${spec.welcome?.spectator} · you=${spec.welcome?.you === undefined ? "no" : "sí"} · states=${spec.states}`,
    );

    // E3: alice en coord-b se mueve; el espectador (en coord-a) la ve moverse
    const alice = await createUser("alice");
    const a = player("b", alice.token);
    await waitFor(() => Boolean(spec.find(alice.username)), 5000);
    const before = spec.find(alice.username);
    a.send({ type: "intent", intent: { dir: { x: before && before.x > 600 ? -1 : 1, y: 0 } } });
    await sleep(800);
    a.send({ type: "intent", intent: { dir: { x: 0, y: 0 } } });
    // alice juega en coord-b: en coord-a su posición se corrige con positions_sync (cada PEER_SYNC_MS), así que se
    // espera a que quede quieta del todo antes de medir (si no, E4 vería esa corrección y no al espectador)
    let after = null;
    await waitFor(async () => {
        const p1 = spec.find(alice.username);
        await sleep(700);
        const p2 = spec.find(alice.username);
        after = p2;
        return Boolean(p1 && p2) && p1.x === p2.x && p1.y === p2.y;
    }, 8000, 0);
    report("E3", "el espectador ve moverse a alice, que juega en OTRO coordinador", Boolean(before && after) && Math.abs(after.x - before.x) > 50, `${fmt(before)} → ${fmt(after)}`);

    // E4: lo que mande el espectador se ignora
    const ignoredBefore = (await status("a")).spectators.ignoredMessages;
    const playersBefore = spec.state.players.length;
    spec.send({ type: "intent", intent: { dir: { x: 1, y: 1 } } });
    spec.send({ type: "extras_update", extras: { color: "#ff0000" } });
    spec.send({ type: "game_action", action: "infect" });
    spec.send("esto no es JSON");
    await sleep(800);
    const s4 = await status("a");
    const still = spec.find(alice.username);
    const health = await getJson(`http://localhost:${port("a")}/health`);
    report(
        "E4",
        "intent, extras_update, game_action y basura del espectador se ignoran sin romper nada",
        spec.ws.readyState === 1 &&
            health.status === 200 &&
            spec.state.players.length === playersBefore &&
            Math.abs(still.x - after.x) < 1 &&
            still.extras?.color !== "#ff0000" &&
            s4.spectators.ignoredMessages - ignoredBefore === 4,
        `ignorados ${s4.spectators.ignoredMessages - ignoredBefore} · jugadores ${spec.state.players.length} · alice ${fmt(still)}`,
    );

    // E5: no cuentan como jugadores (ni en /status ni en el directorio)
    await sleep(1500); // un heartbeat al auth
    const dir = (await getJson(`${AUTH}/directory`)).json;
    const entryA = dir?.coordinators?.find((c) => c.coordinatorId === "coord-a");
    report(
        "E5",
        "los espectadores no cuentan como jugadores (/status y directorio del auth)",
        s4.localPlayers === 0 && s4.spectators.connected === 1 && entryA?.connectedPlayers === 0,
        `coord-a: localPlayers ${s4.localPlayers} · espectadores ${s4.spectators.connected} · directorio ${entryA?.connectedPlayers}`,
    );

    // E6: partida en juego vista por el espectador, sin roles de nadie
    const bob = await createUser("bob");
    const carol = await createUser("carol");
    const b = player("a", bob.token);
    const c = player("b", carol.token);
    const playing = await waitFor(() => spec.game?.phase === "playing", 10000);
    await sleep(600);
    const leaked = spec.raw.some((t) => /"role"\s*:\s*"(healthy|infected)"/.test(t));
    report(
        "E6",
        "en partida el espectador ve fase, cura y misiones con rol 'spectator', sin el rol de nadie",
        playing && spec.game.you?.role === "spectator" && Array.isArray(spec.game.missions) && spec.game.missions.length > 0 && !leaked,
        `fase ${spec.game?.phase} · rol ${spec.game?.you?.role} · misiones ${spec.game?.missions?.length ?? 0} · roles filtrados ${leaked ? "SÍ" : "no"}`,
    );

    // E7: máximo de espectadores por coordinador
    const extra = [spectator("a"), spectator("a")];
    await waitFor(() => extra.every((s) => s.welcome !== null), 5000);
    const overflow = spectator("a");
    await Promise.race([overflow.closed, sleep(3000)]);
    report("E7", `con ${MAX_SPECTATORS} espectadores, el siguiente recibe 4003`, overflow.closeInfo?.code === 4003, overflow.closeInfo ? `${overflow.closeInfo.code} ${overflow.closeInfo.reason}` : "no se cerró");

    // E8: inundación → cierre 1008, sin afectar a los demás
    for (let i = 0; i < 30; i++) extra[0].send({ type: "intent", intent: { dir: { x: 1, y: 0 } } });
    await Promise.race([extra[0].closed, sleep(3000)]);
    const s8 = await status("a");
    report(
        "E8",
        "un espectador que inunda de mensajes se cierra con 1008 y el resto sigue",
        extra[0].closeInfo?.code === 1008 && spec.ws.readyState === 1 && s8.spectators.closedForFlood >= 1,
        extra[0].closeInfo ? `${extra[0].closeInfo.code} ${extra[0].closeInfo.reason}` : "no se cerró",
    );

    // E9: el endpoint del jugador sigue exigiendo token
    const noToken = open(`${URL_OF("a")}/connect`);
    await Promise.race([noToken.closed, sleep(3000)]);
    report("E9", "/connect sin token sigue cerrando con 4001", noToken.closeInfo?.code === 4001, noToken.closeInfo ? String(noToken.closeInfo.code) : "no se cerró");

    for (const x of [spec, a, b, c, ...extra]) await x.close();

    // E10
    let leakedToken = false;
    for (const file of fs.readdirSync(tmpDir).filter((f) => f.endsWith(".log"))) {
        const text = fs.readFileSync(path.join(tmpDir, file), "utf8");
        if (tokens.some((t) => text.includes(t))) leakedToken = true;
    }
    report("E10", "ningún token aparece en los logs", !leakedToken);
}

main()
    .catch((err) => {
        failed++;
        console.error(`Error inesperado: ${err.message}`);
    })
    .finally(async () => {
        await cleanup();
        console.log(`\n${passed} de ${passed + failed} pruebas OK`);
        process.exit(failed > 0 ? 1 : 0);
    });
