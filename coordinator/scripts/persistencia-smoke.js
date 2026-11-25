// Smoke del track 2.1 del examen final (persistencia del estado): npm run smoke:persistencia
//
// Levanta como procesos hijos el auth-service (puerto 4650, base temporal) y coord-a, coord-b y coord-c
// (clientes 5661-5663, mesh 5761-5763), cada uno con SU PROPIA base de estado (STATE_DB_PATH) en una carpeta
// temporal. Secretos generados al azar; ningún .env real. Mundo de 1200 × 800 sin mapa.
//
//   P1  malla completa y persistencia activa en los 3 (/status.persistence)
//   P2  alice camina hasta x ≈ 400 en coord-a y cambia su color (extras)
//   P3  los 3 guardaron a alice (incluso los que la tienen como copia remota)
//   P4  se MATAN los 3 coordinadores a la vez (sin cierre ordenado: lo que cuenta es lo guardado cada PERSIST_MS)
//   P5  se levanta SOLO coord-c (alice nunca estuvo conectada a él): alice vuelve en x ≈ 400 con su color
//   P6  vuelven coord-a y coord-b: world_snapshot y todos conocen a alice con la misma versión
//   P7  partida de Viruscity en juego (3 jugadores) → se matan los 3 → al reiniciar sigue la MISMA partida
//   P8  ningún token aparece en los logs
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

const AUTH_PORT = 4650;
const AUTH = `http://localhost:${AUTH_PORT}`;
const COORDS = { a: 1, b: 2, c: 3 };
const port = (l) => 5660 + COORDS[l];
const peerPort = (l) => 5760 + COORDS[l];
const URL_OF = (l) => `ws://localhost:${port(l)}`;
const PERSIST_MS = 500;
const TARGET_X = 400;
const TOLERANCE = 12; // px: lo que alcanza a moverse entre el último guardado y la muerte

const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const CLUSTER_SECRET = crypto.randomBytes(32).toString("hex");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viruscity-persist-"));
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

// ---------- Procesos ----------
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
    return launch(`coord-${l}`, COORD_DIR, [...sqliteFlag(), "index.js", "--env", emptyEnv], {
        COORDINATOR_ID: `coord-${l}`,
        PORT: String(port(l)),
        PEER_PORT: String(peerPort(l)),
        PUBLIC_URL: URL_OF(l),
        PEER_URL: `ws://localhost:${peerPort(l)}`,
        AUTH_URLS: AUTH,
        JWT_SECRET,
        CLUSTER_SECRET,
        MAP_FILE: "",
        STATE_DB_PATH: path.join(tmpDir, `state-coord-${l}.db`),
        PERSIST_MS: String(PERSIST_MS),
        PERSIST_MAX_AGE_MS: "600000",
        HEARTBEAT_AUTH_MS: "1000",
        PEER_DISCOVERY_MS: "1000",
        PEER_PING_MS: "1000",
        PEER_SYNC_MS: "500",
        // Partida rápida: 3 jugadores, sin cuenta regresiva larga ni bloqueo
        MIN_PLAYERS_TO_START: "3",
        MATCH_COUNTDOWN_MS: "500",
        INITIAL_LOCK_MS: "0",
        GAME_SYNC_WAIT_MS: "800",
    });
}

// Matar sin cierre ordenado (en Windows kill() termina el proceso en el acto)
async function killCoord(l) {
    const child = children.get(`coord-${l}`);
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited;
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

// ---------- Usuarios y clientes ----------
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

function connect(baseUrl, token) {
    const ws = new WebSocket(`${baseUrl}/connect?token=${encodeURIComponent(token)}`);
    const c = { ws, welcome: null, state: null, game: null };
    c.closed = new Promise((resolve) => ws.on("close", () => resolve()));
    ws.on("error", () => {});
    ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") c.welcome = m;
        if (m.type === "state") c.state = m;
        if (m.type === "game") c.game = m;
    });
    c.find = (username) => c.state?.players.find((p) => p.username === username) ?? null;
    c.intent = (x, y) => ws.readyState === 1 && ws.send(JSON.stringify({ type: "intent", intent: { dir: { x, y } } }));
    c.send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
    c.close = async () => {
        if (ws.readyState <= 1) ws.close();
        await c.closed;
    };
    return c;
}
const fmt = (p) => (p ? `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})` : "—");

// Lleva al jugador hasta x ≈ TARGET_X (solo eje x) y lo detiene
async function walkTo(c, username, targetX) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        const me = c.find(username);
        if (me) {
            const dx = targetX - me.x;
            if (Math.abs(dx) <= 3) break;
            c.intent(Math.sign(dx), 0);
            // cerca del objetivo: pasos cortos para no pasarse
            await sleep(Math.abs(dx) < 30 ? 20 : 50);
            if (Math.abs(dx) < 30) c.intent(0, 0);
        } else {
            await sleep(50);
        }
    }
    c.intent(0, 0);
    await sleep(300);
    return c.find(username);
}

// ---------- Pruebas ----------
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

    // P1
    const meshOk = await waitFor(async () => {
        const all = await Promise.all(Object.keys(COORDS).map(status));
        return all.every((s) => s && s.peers.length === 2 && s.persistence?.enabled === true);
    }, 20000, 200);
    report("P1", "malla completa y persistencia activa en los 3 coordinadores", meshOk);
    if (!meshOk) return;

    // P2
    const alice = await createUser("alice");
    let a = connect(URL_OF("a"), alice.token);
    await waitFor(() => Boolean(a.find(alice.username)), 5000);
    a.send({ type: "extras_update", extras: { color: "#e11d48" } });
    const before = await walkTo(a, alice.username, TARGET_X);
    report("P2", "alice camina hasta x ≈ 400 en coord-a y elige su color", Boolean(before) && Math.abs(before.x - TARGET_X) <= 5, fmt(before));

    // P3: los 3 la guardaron (coord-b y coord-c como copia remota)
    await sleep(PERSIST_MS * 3);
    const saved = await Promise.all(Object.keys(COORDS).map(status));
    const savedOk = saved.every((s) => s.persistence.lastSavedAt && s.persistence.knownPlayers >= 1);
    report("P3", "los 3 guardaron a alice en su propia base", savedOk, saved.map((s) => `${s.coordinatorId}: ${s.persistence.knownPlayers}`).join(" · "));

    // P4: matar los 3 a la vez
    await Promise.all(Object.keys(COORDS).map(killCoord));
    await a.closed;
    const allDown = (await Promise.all(Object.keys(COORDS).map(status))).every((s) => s === null);
    report("P4", "se matan los 3 coordinadores a la vez (sin cierre ordenado)", allDown);

    // P5: solo coord-c, que nunca fue el dueño de alice
    startCoord("c");
    await waitFor(async () => (await status("c")) !== null, 15000, 100);
    a = connect(URL_OF("c"), alice.token);
    await waitFor(() => Boolean(a.find(alice.username)), 5000);
    const back = a.find(alice.username);
    const posOk = Boolean(back) && Math.abs(back.x - before.x) <= TOLERANCE && Math.abs(back.y - before.y) <= TOLERANCE;
    report("P5", "solo con coord-c arriba, alice vuelve donde estaba (x ≈ 400) con su color", posOk && back.extras?.color === "#e11d48", `antes ${fmt(before)} · después ${fmt(back)} · color ${back?.extras?.color ?? "—"}`);

    // P6: vuelven a y b; el snapshot los pone al día
    startCoord("a");
    startCoord("b");
    const mesh2 = await waitFor(async () => {
        const all = await Promise.all(Object.keys(COORDS).map(status));
        return all.every((s) => s && s.peers.length === 2);
    }, 20000, 200);
    await sleep(PERSIST_MS * 3);
    const known = await Promise.all(Object.keys(COORDS).map(status));
    report("P6", "vuelven coord-a y coord-b: la malla se reconcilia y todos conocen a alice", mesh2 && known.every((s) => s.persistence.knownPlayers >= 1));

    // P7: partida de Viruscity en juego, se matan los 3 y sigue la misma
    const bob = await createUser("bob");
    const carol = await createUser("carol");
    const b = connect(URL_OF("a"), bob.token);
    const c = connect(URL_OF("b"), carol.token);
    const playing = await waitFor(async () => (await status("a"))?.match.phase === "playing", 15000, 100);
    await sleep(PERSIST_MS * 3);
    const m1 = (await status("a")).match;
    await Promise.all(Object.keys(COORDS).map(killCoord));
    await Promise.all([a.closed, b.closed, c.closed]);
    for (const l of Object.keys(COORDS)) startCoord(l);
    await waitFor(async () => {
        const all = await Promise.all(Object.keys(COORDS).map(status));
        return all.every((s) => s && s.peers.length === 2);
    }, 20000, 200);
    await sleep(1500); // handover / réplica del árbitro
    const after = await Promise.all(Object.keys(COORDS).map(status));
    const same = after.every((s) => s.match.matchId === m1.matchId && s.match.phase === "playing" && s.match.rosterSize === 3);
    report(
        "P7",
        "partida en juego → se matan los 3 → al reiniciar sigue la MISMA partida con su roster",
        playing && same,
        `antes partida ${m1.matchId} ${m1.phase} roster ${m1.rosterSize} · después ${after.map((s) => `${s.coordinatorId}: ${s.match.matchId} ${s.match.phase} ${s.match.rosterSize}`).join(" · ")}`,
    );
    // alice vuelve dentro de la gracia de reconexión y sigue en la partida
    const a2 = connect(URL_OF("b"), alice.token);
    const inGame = await waitFor(() => a2.game?.phase === "playing" && ["healthy", "infected"].includes(a2.game?.you?.role), 5000);
    report("P7b", "alice reconecta dentro de la gracia y sigue en la partida con su rol", inGame, a2.game ? `fase ${a2.game.phase}` : "sin vista");
    await a2.close();

    // P8: ningún token en los logs
    let leaked = false;
    for (const file of fs.readdirSync(tmpDir).filter((f) => f.endsWith(".log"))) {
        const text = fs.readFileSync(path.join(tmpDir, file), "utf8");
        if (tokens.some((t) => text.includes(t))) leaked = true;
    }
    report("P8", "ningún token aparece en los logs", !leaked);
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
