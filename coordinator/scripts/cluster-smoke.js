// Smoke multi-proceso del clúster (Taller 6): npm run smoke:cluster
//
// Levanta como procesos hijos el auth-service (puerto 4600, base temporal) y los coordinadores coord-a,
// coord-b y coord-c (clientes 5601-5603, mesh 5701-5703); coord-d (5604/5704) entra más tarde. Todo se
// configura por variables de entorno (secretos generados al azar para esta prueba; ningún .env real).
// Corre C1-C13, imprime ✔/✘ por prueba y sale con código 1 si alguna falla. Al terminar (éxito, fallo o
// Ctrl+C) mata TODOS los hijos y borra los temporales.
//
// Los coordinadores usan un mundo de 4000 × 3000 SIN mapa, para que el movimiento no dependa de paredes.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..", "..");
const AUTH_DIR = path.join(ROOT, "auth-service");
const COORD_DIR = path.join(ROOT, "coordinator");

const AUTH_PORT = 4600;
const AUTH = `http://localhost:${AUTH_PORT}`;
const COORDS = { a: 1, b: 2, c: 3, d: 4 }; // coord-x → PORT 560n, PEER_PORT 570n
const port = (l) => 5600 + COORDS[l];
const peerPort = (l) => 5700 + COORDS[l];
const WORLD = { width: 4000, height: 3000 };

const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const CLUSTER_SECRET = crypto.randomBytes(32).toString("hex");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viruscity-cluster-"));
const emptyEnv = path.join(tmpDir, "vacio.env");
fs.writeFileSync(emptyEnv, ""); // --env a un archivo vacío: el coordinador no lee coordinator/.env

const children = new Map(); // nombre → proceso
const tokens = []; // para comprobar que no aparezcan en los logs
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

// ---------- Procesos ----------
// node:sqlite necesita --experimental-sqlite en Node 22.5-22.12 y 23.0-23.3
function sqliteFlag() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    return (major === 22 && minor < 13) || (major === 23 && minor < 4) ? ["--experimental-sqlite"] : [];
}

function launch(name, cwd, args, env) {
    const log = fs.openSync(path.join(tmpDir, `${name}.log`), "a");
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", log, log] });
    fs.closeSync(log); // el hijo tiene su propia copia del descriptor
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
        PUBLIC_URL: `ws://localhost:${port(l)}`,
        PEER_URL: `ws://localhost:${peerPort(l)}`,
        AUTH_URL: AUTH,
        JWT_SECRET,
        CLUSTER_SECRET,
        MAP_FILE: "",
        WORLD_WIDTH: String(WORLD.width),
        WORLD_HEIGHT: String(WORLD.height),
        HEARTBEAT_AUTH_MS: "2000",
        PEER_DISCOVERY_MS: "3000",
        PEER_PING_MS: "3000",
        PEER_SYNC_MS: "1000",
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
    const c = { ws, welcome: null, state: null, stateCount: 0, closeInfo: null };
    c.closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve((c.closeInfo = { code, reason: String(reason), at: Date.now() }))));
    ws.on("error", () => {});
    ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") c.welcome = m;
        if (m.type === "state") {
            c.state = m;
            c.stateCount++;
        }
    });
    c.find = (username) => c.state?.players.find((p) => p.username === username) ?? null;
    c.count = (username) => (c.state?.players ?? []).filter((p) => p.username === username).length;
    c.intent = (x, y) => ws.readyState === 1 && ws.send(JSON.stringify({ type: "intent", intent: { dir: { x, y } } }));
    c.send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
    return c;
}
const viaDirectory = async (token) => {
    const r = await getJson(`${AUTH}/coordinator`);
    return { assigned: r.json?.coordinatorId, conn: r.status === 200 ? connect(r.json.publicUrl, token) : null };
};
const fmt = (p) => (p ? `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})` : "—");

// Conexión cruda al puerto del mesh (para las pruebas de seguridad)
function peerSocket(l, headers = {}) {
    const ws = new WebSocket(`ws://localhost:${peerPort(l)}`, { headers });
    const s = { ws, got: [] };
    s.result = new Promise((resolve) => {
        ws.on("unexpected-response", (req, res) => {
            req.destroy();
            resolve({ rejected: res.statusCode });
        });
        ws.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
        ws.on("error", () => {});
    });
    s.opened = new Promise((resolve) => {
        ws.on("open", () => resolve(true));
        ws.on("close", () => resolve(false));
        ws.on("unexpected-response", () => resolve(false));
    });
    ws.on("message", (raw) => s.got.push(String(raw)));
    return s;
}

// ---------- Pruebas ----------
async function main() {
    // Puertos libres
    const ports = [AUTH_PORT, ...Object.keys(COORDS).flatMap((l) => [port(l), peerPort(l)])];
    const busy = [];
    for (const p of ports) if ((await getJson(`http://localhost:${p}/`)).status !== 0) busy.push(p);
    if (busy.length) {
        report("PRE", "puertos libres", false, `ocupados: ${busy.join(", ")}`);
        return;
    }

    startAuth();
    for (const l of ["a", "b", "c"]) startCoord(l);

    // C1: malla completa con una conexión por par
    const t1 = Date.now();
    let statuses = [];
    const meshOk = await waitFor(async () => {
        const peers = await getJson(`${AUTH}/peers`);
        statuses = await Promise.all(["a", "b", "c"].map((l) => getJson(`http://localhost:${port(l)}/status`).then((r) => r.json)));
        return (
            peers.json?.peers?.length === 3 &&
            statuses.every((s) => s && s.peers.length === 2 && new Set(s.peers).size === 2 && !s.peers.includes(s.coordinatorId))
        );
    }, 10000, 200);
    report("C1", "en < 10 s /peers lista 3 coordinadores y cada uno tiene 2 peers distintos", meshOk,
        `${((Date.now() - t1) / 1000).toFixed(1)} s · ${statuses.map((s) => s && `${s.coordinatorId}→[${s.peers.join(",")}]`).join(" ")}`);

    // C2: 4 pedidos seguidos a /coordinator se reparten
    const picks = (await Promise.all([1, 2, 3, 4].map(() => getJson(`${AUTH}/coordinator`)))).map((r) => r.json?.coordinatorId);
    const counts = picks.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map());
    report("C2", "4 GET /coordinator seguidos devuelven ≥ 2 coordinadores y ninguno recibe los 4", new Set(picks).size >= 2 && Math.max(...counts.values()) < 4, picks.join(", "));

    // C3: 4 clientes repartidos; /directory suma 4 y ninguno tiene 4
    const c3 = [];
    for (let i = 0; i < 4; i++) c3.push(await viaDirectory((await createUser(`c3u${i}`)).token));
    await sleep(3000);
    const dir3 = (await getJson(`${AUTH}/directory`)).json?.coordinators ?? [];
    const loads = dir3.map((c) => c.connectedPlayers);
    const sum = loads.reduce((a, b) => a + b, 0);
    report("C3", "con 4 clientes, ~3 s después /directory suma 4 y ningún coordinador tiene 4", sum === 4 && Math.max(...loads) < 4,
        `${dir3.map((c) => `${c.coordinatorId}:${c.connectedPlayers}`).join(" ")} (asignados: ${c3.map((x) => x.assigned).join(", ")})`);
    for (const { conn } of c3) conn?.ws.close();
    await sleep(500);

    // C4: Alice en coord-a, Bob en coord-b; cada uno ve al otro con el coordinatorId correcto
    const A = await createUser("alice");
    const B = await createUser("bob");
    const alice = connect(`ws://localhost:${port("a")}`, A.token);
    const bob = connect(`ws://localhost:${port("b")}`, B.token);
    const seeEach = await waitFor(() => alice.find(B.username) && bob.find(A.username), 5000);
    report("C4", "Alice (coord-a) y Bob (coord-b) se ven con el coordinatorId de su dueño", Boolean(seeEach) &&
        alice.find(B.username).coordinatorId === "coord-b" && bob.find(A.username).coordinatorId === "coord-a" &&
        alice.welcome?.coordinatorId === "coord-a" && bob.welcome?.coordinatorId === "coord-b" &&
        alice.state?.coordinatorId === "coord-a" && bob.state?.coordinatorId === "coord-b",
        `Alice ve a Bob en ${alice.find(B.username)?.coordinatorId} · Bob ve a Alice en ${bob.find(A.username)?.coordinatorId} · welcome ${alice.welcome?.coordinatorId}/${bob.welcome?.coordinatorId}`);

    // C5: movimiento replicado (cada uno hacia el centro del mundo, para no chocar con un borde)
    const toCenter = (p, axis) => (p[axis] < WORLD[axis === "x" ? "width" : "height"] / 2 ? 1 : -1);
    let before = bob.find(A.username);
    const dxA = toCenter(before, "x");
    alice.intent(dxA, 0);
    await sleep(1000);
    alice.intent(0, 0);
    await sleep(500);
    let after = bob.find(A.username);
    const movedA = Math.abs(after.x - before.x);
    before = alice.find(B.username);
    const dyB = toCenter(before, "y");
    bob.intent(0, dyB);
    await sleep(1000);
    bob.intent(0, 0);
    await sleep(500);
    after = alice.find(B.username);
    const movedB = Math.abs(after.y - before.y);
    report("C5", "1 s de movimiento se ve en el otro coordinador (150-250 px)", movedA >= 150 && movedA <= 250 && movedB >= 150 && movedB <= 250,
        `Bob ve a Alice moverse ${movedA.toFixed(1)} px en x (${dxA > 0 ? "derecha" : "izquierda"}) · Alice ve a Bob ${movedB.toFixed(1)} px en y (${dyB > 0 ? "abajo" : "arriba"})`);

    // C6: extras replicados y persistentes
    alice.send({ type: "extras_update", extras: { color: "#ff5500" } });
    const colorSeen = await waitFor(() => bob.find(A.username)?.extras?.color === "#ff5500", 2000);
    await sleep(800);
    report("C6", "el color de Alice llega a Bob y se mantiene", colorSeen && bob.find(A.username)?.extras?.color === "#ff5500", JSON.stringify(bob.find(A.username)?.extras));

    // C7: Bob se desconecta y Alice deja de verlo en < 500 ms
    const t7 = Date.now();
    bob.ws.close();
    const gone = await waitFor(() => !alice.find(B.username), 2000, 5);
    const goneMs = Date.now() - t7;
    report("C7", "Bob se desconecta: Alice deja de verlo en < 500 ms", gone && goneMs < 500, `${goneMs} ms`);

    // Bob vuelve (a coord-b) para las pruebas siguientes
    const bob2 = connect(`ws://localhost:${port("b")}`, B.token);
    await waitFor(() => alice.find(B.username) && bob2.find(A.username), 4000);

    // C8: coord-d entra tarde y un cliente suyo recibe el estado completo (resync)
    startCoord("d");
    const dMesh = await waitFor(async () => (await getJson(`http://localhost:${port("d")}/status`)).json?.peers?.length === 3, 12000, 200);
    const L = await createUser("late");
    const late = connect(`ws://localhost:${port("d")}`, L.token);
    await waitFor(() => late.find(A.username) && late.find(B.username), 4000);
    const aTrue = alice.find(A.username);
    const bTrue = bob2.find(B.username);
    const aSeen = late.find(A.username);
    const bSeen = late.find(B.username);
    const close = (p, q) => p && q && Math.hypot(p.x - q.x, p.y - q.y) < 2;
    report("C8", "coord-d (tardío) ve a Alice y Bob con sus x,y actuales y el color de Alice", dMesh && close(aSeen, aTrue) && close(bSeen, bTrue) && aSeen?.extras?.color === "#ff5500",
        `malla de d: ${dMesh} · Alice ${fmt(aSeen)} vs ${fmt(aTrue)} · Bob ${fmt(bSeen)} vs ${fmt(bTrue)} · color ${aSeen?.extras?.color}`);

    // C9: el mismo usuario en coord-a y luego en coord-b → gana la sesión más nueva (coord-b)
    const C = await createUser("carol");
    const carol = connect(`ws://localhost:${port("c")}`, C.token); // observadora en coord-c
    const D = await createUser("dup");
    const dupA = connect(`ws://localhost:${port("a")}`, D.token);
    await waitFor(() => bob2.find(D.username)?.coordinatorId === "coord-a" && carol.state, 4000);
    const dupB = connect(`ws://localhost:${port("b")}`, D.token);
    const closedA = await Promise.race([dupA.closed, sleep(3000).then(() => null)]);
    await sleep(1200);
    const views = { "coord-a": alice, "coord-b": bob2, "coord-c": carol, "coord-d": late };
    const entries = Object.entries(views).map(([id, v]) => `${id}:${v.count(D.username)}×${v.find(D.username)?.coordinatorId}`);
    const single = Object.values(views).every((v) => v.count(D.username) === 1 && v.find(D.username)?.coordinatorId === "coord-b");
    report("C9", "sesión duplicada entre coordinadores: coord-a cierra con 4002 y queda UNA entrada en coord-b", closedA?.code === 4002 && closedA.reason === "replaced by new session" && dupB.ws.readyState === 1 && single,
        `cierre en coord-a: ${closedA ? `${closedA.code} "${closedA.reason}"` : "ninguno"} · coord-b abierto: ${dupB.ws.readyState === 1} · ${entries.join(" ")}`);

    // C10: muere coord-a
    const tDeath = Date.now();
    children.get("coord-a").kill();
    const aliceClosed = await Promise.race([alice.closed, sleep(3000).then(() => null)]);
    const others = [bob2, carol, late];
    const dropped = await waitFor(() => others.every((v) => !v.find(A.username)), 2000, 20);
    const dropMs = Date.now() - tDeath;
    report("C10a", "los clientes de coord-a reciben el cierre", Boolean(aliceClosed), aliceClosed ? `código ${aliceClosed.code}` : "sin cierre");
    report("C10b", "en < 2 s coord-b, coord-c y coord-d dejan de listar a los jugadores de coord-a", dropped && dropMs < 2000, `${dropMs} ms`);
    await sleep(Math.max(0, 3000 - (Date.now() - tDeath)));
    const at3 = (await getJson(`${AUTH}/directory`)).json?.coordinators?.some((c) => c.coordinatorId === "coord-a");
    let goneAt = null;
    await waitFor(async () => {
        const has = (await getJson(`${AUTH}/peers`)).json?.peers?.some((p) => p.coordinatorId === "coord-a");
        if (!has && goneAt === null) goneAt = Date.now() - tDeath;
        return goneAt !== null;
    }, 5000, 100);
    await sleep(Math.max(0, 7000 - (Date.now() - tDeath)));
    const inPeers = (await getJson(`${AUTH}/peers`)).json?.peers?.some((p) => p.coordinatorId === "coord-a");
    const inDir = (await getJson(`${AUTH}/directory`)).json?.coordinators?.some((c) => c.coordinatorId === "coord-a");
    const assigned = [];
    for (let i = 0; i < 6; i++) assigned.push((await getJson(`${AUTH}/coordinator`)).json?.coordinatorId);
    report("C10c", "coord-a sigue en /directory a los 3 s, desaparece entre 4 y 6,5 s y a los 7 s no está en /peers, /directory ni /coordinator",
        at3 && goneAt !== null && goneAt >= 4000 && goneAt <= 6500 && !inPeers && !inDir && !assigned.includes("coord-a"),
        `a los 3 s: ${at3 ? "presente" : "ausente"} · desapareció a los ${goneAt !== null ? (goneAt / 1000).toFixed(2) : "?"} s · /coordinator → ${[...new Set(assigned)].join(", ")}`);
    const E = await createUser("eve");
    const { assigned: eveAt, conn: eve } = await viaDirectory(E.token);
    await waitFor(() => eve?.find(E.username), 3000);
    const eveStart = eve?.find(E.username);
    eve?.intent(toCenter(eveStart ?? { x: 0 }, "x"), 0);
    await sleep(600);
    eve?.intent(0, 0);
    await sleep(300);
    const eveMoved = eveStart && eve.find(E.username) ? Math.abs(eve.find(E.username).x - eveStart.x) : 0;
    report("C10d", "un cliente nuevo recibe un coordinador vivo, conecta y juega", eveAt && eveAt !== "coord-a" && eve?.welcome && eveMoved > 60,
        `asignado ${eveAt} · se movió ${eveMoved.toFixed(0)} px`);

    // C11: coord-a vuelve y se reintegra a la malla
    const t11 = Date.now();
    startCoord("a");
    const back = await waitFor(async () => {
        const inP = (await getJson(`${AUTH}/peers`)).json?.peers?.some((p) => p.coordinatorId === "coord-a");
        const st = (await getJson(`http://localhost:${port("a")}/status`)).json;
        return inP && st?.peers?.length === 3;
    }, 10000, 200);
    const backMs = Date.now() - t11;
    const A2 = await createUser("again");
    const again = connect(`ws://localhost:${port("a")}`, A2.token);
    const seesOld = await waitFor(() => again.find(B.username) && again.find(C.username), 3000);
    report("C11", "coord-a vuelve: en < 10 s está en /peers con 3 peers y ve a los jugadores existentes", back && backMs < 10000 && seesOld,
        `${(backMs / 1000).toFixed(1)} s · ve a Bob: ${Boolean(again.find(B.username))} · ve a Carol: ${Boolean(again.find(C.username))}`);

    // C12: seguridad
    const hb = await fetch(`${AUTH}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinatorId: "coord-x", publicUrl: "ws://localhost:1", peerUrl: "ws://localhost:2", connectedPlayers: 0, uptime: 0 }),
    });
    const noHeader = await peerSocket("b").result;
    const wrongSecret = await peerSocket("b", { "x-cluster-secret": "no-es-el-secreto" }).result;
    // Peer falso con el secreto correcto
    const fake = peerSocket("b", { "x-cluster-secret": CLUSTER_SECRET });
    await fake.opened;
    fake.ws.send(JSON.stringify({ type: "hello", coordinatorId: "coord-fake" }));
    await waitFor(() => fake.got.some((g) => g.includes('"hello"')), 2000);
    await sleep(300);
    const bobBefore = bob2.find(B.username);
    const carolBefore = bob2.find(C.username);
    const ghost = (origin, name) => ({ type: "player_joined", origin, userId: `ghost-${name}`, username: `ghost_${name}`, provider: "local", x: 100, y: 100, connectedAtMs: Date.now() });
    fake.ws.send(JSON.stringify(ghost("coord-zzz", "a"))); // (a) origin distinto al del peer
    fake.ws.send(JSON.stringify({ type: "intent_replicate", origin: "coord-fake", userId: bobBefore.userId, intent: { dir: { x: 1, y: 1 } } })); // (b)
    fake.ws.send(JSON.stringify({ type: "positions_sync", origin: "coord-fake", players: [{ userId: bobBefore.userId, x: 100, y: 100 }, { userId: carolBefore.userId, x: 100, y: 100 }] })); // (c)
    fake.ws.send(JSON.stringify(ghost("coord-b", "b"))); // origin = id del receptor
    await sleep(1500);
    const bobAfter = bob2.find(B.username);
    const carolAfter = bob2.find(C.username);
    const ghosts = (bob2.state?.players ?? []).filter((p) => p.username.startsWith("ghost_")).length;
    const unchanged = bobAfter && carolAfter && Math.hypot(bobAfter.x - bobBefore.x, bobAfter.y - bobBefore.y) < 0.5 && Math.hypot(carolAfter.x - carolBefore.x, carolAfter.y - carolBefore.y) < 0.5;
    fake.ws.close();
    report("C12", "seguridad: heartbeat sin secreto 401, peer sin/mal secreto 401 y un peer falso no altera el estado",
        hb.status === 401 && noHeader.rejected === 401 && wrongSecret.rejected === 401 && unchanged && ghosts === 0,
        `heartbeat ${hb.status} · peer sin header ${noHeader.rejected} · secreto malo ${wrongSecret.rejected} · Bob ${fmt(bobBefore)}→${fmt(bobAfter)} · Carol ${fmt(carolBefore)}→${fmt(carolAfter)} · fantasmas ${ghosts}`);

    // C13: basura en el puerto del mesh
    const auth = { "x-cluster-secret": CLUSTER_SECRET };
    const g1 = peerSocket("b", auth);
    await g1.opened;
    g1.ws.send("{roto");
    const g2 = peerSocket("b", auth);
    await g2.opened;
    g2.ws.send(JSON.stringify({ type: "desconocido" }));
    const g3 = peerSocket("b", auth); // nunca manda hello
    const g4 = peerSocket("b", auth);
    await g4.opened;
    g4.ws.send(JSON.stringify({ type: "hello", coordinatorId: "coord-basura" }));
    await sleep(300);
    for (let i = 0; i < 700; i++) g4.ws.send(i % 3 === 0 ? "{roto" : JSON.stringify({ type: i % 3 === 1 ? "nada" : "player_left", origin: "coord-basura", userId: 5 }));
    g4.ws.send(JSON.stringify({ type: "positions_sync", origin: "coord-basura", players: "no" }));
    const [r1, r2, r3] = await Promise.all([g1.result, g2.result, g3.result]);
    const alive = await getJson(`http://localhost:${port("b")}/status`);
    g4.ws.close();
    report("C13", "basura en el puerto del mesh no tumba al coordinador",
        r1.code === 4011 && r2.code === 4011 && r3.code === 4011 && r3.reason === "hello timeout" && alive.status === 200 && Boolean(bob2.find(B.username)),
        `JSON roto → ${r1.code} · tipo desconocido → ${r2.code} · sin hello → ${r3.code} "${r3.reason}" · /status ${alive.status}`);

    for (const c of [bob2, carol, late, dupB, eve, again]) c?.ws.close();
    await sleep(300);
}

// Logs sin secretos ni tokens
function checkLogs() {
    const texts = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".log")).map((f) => fs.readFileSync(path.join(tmpDir, f), "utf8"));
    const leaks = [JWT_SECRET, CLUSTER_SECRET, ...tokens].filter((secret) => texts.some((t) => t.includes(secret))).length;
    report("LOG", "ningún log contiene CLUSTER_SECRET, JWT_SECRET ni tokens", leaks === 0, `${texts.length} logs revisados`);
}

main()
    .catch((err) => report("ERROR", "la prueba no pudo completarse", false, err.message))
    .finally(async () => {
        try {
            for (const child of children.values()) if (child.exitCode === null) child.kill();
            await sleep(500);
            checkLogs();
        } catch (err) {
            report("LOG", "revisión de logs", false, err.message);
        }
        await cleanup();
        console.log(`\n${passed} pasaron, ${failed} fallaron`);
        process.exit(failed > 0 ? 1 : 0);
    });
