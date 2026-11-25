// Smoke de partidas completas de Viruscity: npm run smoke:viruscity [-- --coordinators=N]
//
// Levanta como procesos hijos el auth-service (puerto 4700, base temporal, secretos al azar) y N coordinadores
// coord-a, coord-b… (clientes 5801+, mesh 5901+) con tiempos de partida reducidos por variables de entorno.
// Los coordinadores usan el mundo por defecto SIN mapa (1200 × 800), para que moverse no dependa de paredes.
// Los clientes se reparten entre los coordinadores en orden rotatorio (con N = 1, todos al mismo).
// Corre V1-V12, imprime ✔/✘ por prueba y sale con código 1 si alguna falla. Al terminar (éxito, fallo o Ctrl+C)
// mata TODOS los hijos y borra los temporales.
//
// Recorrido: partida 1 (V1-V8: fases, inicio, contagio, misiones y victoria por cura), partida 2 (V9 victoria
// del virus y V12 espectador), partida 3 (V11 gracia, con el espectador ya en el roster), con 3 o más
// coordinadores la partida 4 (X1-X7: árbitro, acciones entre coordinadores, relevo al matar coord-a,
// handover al volver, peer falso e información oculta) y una segunda ejecución con MATCH_DURATION_MS=8000
// (V10 tiempo). V5 (información oculta) se evalúa al final sobre TODOS los mensajes recibidos.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const WebSocket = require("ws");
const { createMatchState } = require("../match.js");

const ROOT = path.join(__dirname, "..", "..");
const AUTH_DIR = path.join(ROOT, "auth-service");
const COORD_DIR = path.join(ROOT, "coordinator");

const arg = process.argv.find((a) => a.startsWith("--coordinators="));
const N = arg ? Number(arg.split("=")[1]) : 1;
if (!Number.isInteger(N) || N < 1 || N > 9) {
    console.error("--coordinators debe ser un entero entre 1 y 9");
    process.exit(1);
}

const AUTH_PORT = 4700;
const AUTH = `http://localhost:${AUTH_PORT}`;
const LETTERS = "abcdefghi".slice(0, N).split("");
const port = (i) => 5801 + i;
const peerPort = (i) => 5901 + i;

// Tiempos reducidos (los rangos y demás valores quedan por defecto)
const TIMES = {
    MATCH_COUNTDOWN_MS: 2000,
    INITIAL_LOCK_MS: 3000,
    INFECT_COOLDOWN_MS: 4000,
    NEW_INFECTED_LOCK_MS: 6000,
    MATCH_DURATION_MS: 60000,
    RESULTS_MS: 3000,
    RECONNECT_GRACE_MS: 6000,
    MISSION_MIN_MS: 1000,
    MISSION_MAX_MS: 8000,
    GAME_TICK_MS: 100,
    GAME_VIEW_MS: 100,
};
const INFECT_REACH = 70 + 25; // INFECT_RANGE + RANGE_TOLERANCE por defecto

const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const CLUSTER_SECRET = crypto.randomBytes(32).toString("hex");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viruscity-smoke-"));
const emptyEnv = path.join(tmpDir, "vacio.env");
fs.writeFileSync(emptyEnv, ""); // --env a un archivo vacío: el coordinador no lee coordinator/.env

const children = new Map();
const tokens = [];
const allClients = [];
let passed = 0;
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function report(id, desc, ok, detail = "") {
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "✔" : "✘"} ${id} ${desc}${detail ? ` — ${detail}` : ""}`);
}
async function waitFor(condition, ms, every = 25) {
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

function startCoord(l, i, times) {
    launch(`coord-${l}`, COORD_DIR, ["index.js", "--env", emptyEnv], {
        COORDINATOR_ID: `coord-${l}`,
        PORT: String(port(i)),
        PEER_PORT: String(peerPort(i)),
        PUBLIC_URL: `ws://localhost:${port(i)}`,
        PEER_URL: `ws://localhost:${peerPort(i)}`,
        AUTH_URL: AUTH,
        JWT_SECRET,
        CLUSTER_SECRET,
        MAP_FILE: "",
        STATE_DB_PATH: "off", // track 2.1: esta prueba no usa persistencia (la prueba smoke:persistencia)
        ...Object.fromEntries(Object.entries(times).map(([k, v]) => [k, String(v)])),
    });
}
const startCoords = (times) => LETTERS.forEach((l, i) => startCoord(l, i, times));

// Mata un coordinador y espera a que el proceso termine
async function killCoord(l) {
    const child = children.get(`coord-${l}`);
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
}
const statusOf = (i) => getJson(`http://localhost:${port(i)}/status`);

async function stopCoords() {
    const waits = [];
    for (const [name, child] of children) {
        if (!name.startsWith("coord-") || child.exitCode !== null) continue;
        waits.push(new Promise((r) => child.once("exit", r)));
        child.kill();
    }
    await Promise.all(waits);
}

// Coordinadores arriba y, con más de uno, malla completa con árbitro coord-a; después, la espera de
// sincronización del árbitro (GAME_SYNC_WAIT_MS = 1500 por defecto) para que la partida ya avance
async function coordsUp() {
    const up = await waitFor(async () => {
        const all = await Promise.all(LETTERS.map((_, i) => statusOf(i)));
        return all.every((r) => r.status === 200 && r.json.peers.length === N - 1 && r.json.match.arbiterId === "coord-a");
    }, 15000, 100);
    if (up && N > 1) await sleep(1500 + 300);
    return up;
}

let cleaned = false;
async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const c of allClients) c.ws.terminate();
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

let rotation = 0;
// Cliente WS: guarda el último welcome, game y state, y TODOS los game y event recibidos.
// target: sin indicar → siguiente coordinador en orden rotatorio; número → ese coordinador (0 = coord-a);
// { url, id } → la publicUrl que dio el directorio.
function connect(user, target) {
    let base;
    let coordinator;
    if (target && typeof target === "object") {
        base = target.url;
        coordinator = target.id;
    } else {
        const index = Number.isInteger(target) ? target : rotation++ % N;
        base = `ws://localhost:${port(index)}`;
        coordinator = `coord-${LETTERS[index]}`;
    }
    const ws = new WebSocket(`${base}/connect?token=${encodeURIComponent(user.token)}`);
    const c = { user, ws, coordinator, welcome: null, game: null, state: null, games: [], states: 0, stateSamples: [], playersUpdates: [], events: [], closed: false, closeCode: null };
    ws.on("error", () => {});
    ws.on("close", (code) => {
        c.closed = true;
        c.closeCode = code;
    });
    ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") c.welcome = m;
        else if (m.type === "game") {
            c.game = m;
            c.games.push(m);
        } else if (m.type === "event") c.events.push(m);
        else if (m.type === "players_update") c.playersUpdates.push(raw.toString());
        else if (m.type === "state") {
            c.state = m;
            if (c.states++ % 20 === 0) c.stateSamples.push(raw.toString()); // muestra para V5/X7
        }
    });
    c.userId = () => c.welcome?.you.userId;
    c.me = () => c.state?.players.find((p) => p.userId === c.userId()) ?? null;
    c.find = (other) => c.state?.players.find((p) => p.userId === other.userId()) ?? null;
    c.role = () => c.game?.you.role;
    c.intent = (x, y) => ws.readyState === 1 && ws.send(JSON.stringify({ type: "intent", intent: { dir: { x, y } } }));
    c.act = (action, missionId) => ws.readyState === 1 && ws.send(JSON.stringify({ type: "game_action", action, ...(missionId && { missionId }) }));
    c.waitFor = (pred, ms = 3000) => waitFor(() => pred(c), ms);
    // Espera un evento de cierto tipo recibido desde la posición `from` de la lista
    c.waitEvent = async (kind, from = 0, ms = 3000, pred = () => true) => {
        let found = null;
        await waitFor(() => (found = c.events.slice(from).find((e) => e.kind === kind && pred(e)) ?? null), ms);
        return found;
    };
    c.close = () => ws.close();
    allClients.push(c);
    return c;
}
const ready = (c) => c.waitFor((x) => x.welcome && x.game && x.me(), 5000);

const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);
const fmt = (p) => (p ? `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})` : "—");

// Mueve al cliente hasta (x, y) mandando intenciones por eje según su posición en el último state (máx. 15 s)
async function moveTo(c, x, y, tol = 12) {
    const end = Date.now() + 15000;
    let last = null;
    while (Date.now() < end) {
        const me = c.me();
        if (me) {
            const dx = x - me.x;
            const dy = y - me.y;
            const ix = Math.abs(dx) > tol ? Math.sign(dx) : 0;
            const iy = Math.abs(dy) > tol ? Math.sign(dy) : 0;
            const key = `${ix},${iy}`;
            if (key !== last) {
                c.intent(ix, iy);
                last = key;
            }
            if (ix === 0 && iy === 0) {
                await sleep(150); // que llegue el state ya detenido
                return dist(c.me(), { x, y }) <= tol * 3;
            }
        }
        await sleep(20);
    }
    c.intent(0, 0);
    return false;
}

// infect o mission_complete y su resultado (infect_result / mission_result); null si no llegó
async function act(c, action, missionId, ms = 3000) {
    const from = c.events.length;
    c.act(action, missionId);
    return c.waitEvent(action === "infect" ? "infect_result" : "mission_result", from, ms);
}
// mission_start responde mission_started (éxito) o mission_result (fallo)
async function startMission(c, missionId) {
    const from = c.events.length;
    c.act("mission_start", missionId);
    let ev = null;
    await waitFor(() => (ev = c.events.slice(from).find((e) => (e.kind === "mission_started" && e.missionId === missionId) || e.kind === "mission_result") ?? null), 3000);
    return ev;
}

const available = (c) => (c.game?.missions ?? []).filter((m) => m.status === "available");
const nearestMission = (c, list) => list.slice().sort((a, b) => dist(c.me(), a) - dist(c.me(), b))[0] ?? null;

// ---------- Pruebas ----------
async function main() {
    const ports = [AUTH_PORT, ...LETTERS.flatMap((_, i) => [port(i), peerPort(i)])];
    const busy = [];
    for (const p of ports) if ((await getJson(`http://localhost:${p}/`)).status !== 0) busy.push(p);
    if (busy.length) {
        report("PRE", "puertos libres", false, `ocupados: ${busy.join(", ")}`);
        return;
    }

    startAuth();
    await waitFor(async () => (await getJson(`${AUTH}/health`)).status === 200, 8000, 100);
    startCoords(TIMES);
    if (!(await coordsUp())) {
        report("PRE", `${N} coordinador(es) arriba`, false);
        return;
    }
    console.log(`Clúster: auth en ${AUTH_PORT} y ${N} coordinador(es) en ${LETTERS.map((_, i) => port(i)).join(", ")}`);
    const users = {};
    for (const n of ["ana", "beto", "caro", "dani", "eva", "fede"]) users[n] = await createUser(n);

    // ----- V1: dos jugadores, mundo abierto -----
    const A = connect(users.ana);
    const B = connect(users.beto);
    await ready(A);
    await ready(B);
    const v1 = await waitFor(() => [A, B].every((c) => c.game.phase === "open_world" && c.game.connected === 2 && !("countdownEndsAt" in c.game)), 3000);
    await sleep(500);
    report("V1", "con 2 jugadores: open_world, connected 2, sin countdown", v1 && A.game.phase === "open_world", `fase ${A.game?.phase} · connected ${A.game?.connected}`);

    // ----- V2: el tercero inicia la cuenta -----
    const tJoin = Date.now();
    let C = connect(users.caro);
    const gotCountdown = await A.waitFor((c) => c.game.phase === "countdown", 1500);
    const tCountdown = Date.now();
    const ends1 = A.game.countdownEndsAt;
    report("V2", "al entrar el tercero llega countdown (≤ 1 s) con countdownEndsAt ≈ +2 s", gotCountdown && tCountdown - tJoin <= 1000 && Math.abs(ends1 - tJoin - TIMES.MATCH_COUNTDOWN_MS) <= 700, `llegó en ${tCountdown - tJoin} ms · termina en ${ends1 - tJoin} ms`);

    // ----- V3: uno se va durante la cuenta y vuelve -----
    C.close();
    const backToOpen = await A.waitFor((c) => c.game.phase === "open_world", 1500);
    C = connect(users.caro);
    await ready(C);
    const again = await A.waitFor((c) => c.game.phase === "countdown" && c.game.countdownEndsAt > ends1, 2000);
    report("V3", "si uno se va durante la cuenta vuelve a open_world; al volver se reinicia la cuenta", backToOpen && again, `nueva cuenta termina ${A.game.countdownEndsAt - ends1} ms después que la anterior`);

    // ----- V4: arranca la partida -----
    const p1 = [A, B, C];
    const started = await waitFor(() => p1.every((c) => c.game.phase === "playing" && ["healthy", "infected"].includes(c.role())), 4000);
    const tStart = Date.now();
    await sleep(300);
    const plaza = A.welcome.city.plaza;
    const infected1 = p1.filter((c) => c.role() === "infected");
    const near = p1.map((c) => dist(A.find(c), plaza));
    report("V4", "arranca: 1 infectado, los demás sanos, todos a < 100 px de la plaza", started && infected1.length === 1 && near.every((d) => d < 100), `roles ${p1.map((c) => c.role()).join(",")} · distancias ${near.map((d) => d.toFixed(0)).join(", ")}`);
    if (!started || infected1.length !== 1) return;

    const statusDuring = await getJson(`http://localhost:${port(0)}/status`);

    // ----- V6: infección -----
    const X = infected1[0];
    const [H1, H2] = p1.filter((c) => c !== X);
    const early = await act(X, "infect");
    const v6a = early?.ok === false && early.reason === "cooldown";
    await sleep(Math.max(0, tStart + TIMES.INITIAL_LOCK_MS + 200 - Date.now()));
    await moveTo(X, A.find(H1).x, A.find(H1).y, 10);
    const dBefore = dist(A.find(X), A.find(H1));
    const fromH1 = H1.events.length;
    const hit = await act(X, "infect");
    const tInfect = Date.now();
    const youInfected = await H1.waitEvent("you_infected", fromH1, 2000);
    const roleChanged = await H1.waitFor((c) => c.role() === "infected", 2000);
    const retry = await act(X, "infect");
    const victimEarly = await act(H1, "infect");
    const v6b = hit?.ok === true && dBefore < 60 && youInfected && roleChanged && retry?.reason === "cooldown" && victimEarly?.reason === "cooldown";

    // V7 y V8 (sano H2) corren en paralelo con el resto de V6. Los dos infectados se van a los bordes izquierdo y
    // derecho a media altura: ninguna estación (ni el camino entre ellas) queda a menos de 95 px de ahí, así no
    // pueden contagiar por accidente al sano que hace las misiones.
    const missionsTask = runMissions(H2, X, [A, B, C]);
    const W = A.welcome.world.width;
    await Promise.all([moveTo(X, W - 20, plaza.y), moveTo(H1, 20, plaza.y)]);

    // A los 4 s del contagio el atacante ya puede, pero no hay sanos cerca → no_target sin cambiar infectReadyAt
    await sleep(Math.max(0, tInfect + TIMES.INFECT_COOLDOWN_MS + 200 - Date.now()));
    const farFromH2 = Math.min(dist(A.find(X), A.find(H2)), dist(A.find(H1), A.find(H2))) > INFECT_REACH;
    const readyBefore = X.game.you.infectReadyAt;
    const noTarget = await act(X, "infect");
    await sleep(250);
    const readyAfter = X.game.you.infectReadyAt;
    // La víctima: bloqueada hasta NEW_INFECTED_LOCK_MS; después ya no es 'cooldown' (sin sanos cerca: no_target)
    await sleep(Math.max(0, tInfect + TIMES.NEW_INFECTED_LOCK_MS - 800 - Date.now()));
    const victimStill = await act(H1, "infect");
    await sleep(Math.max(0, tInfect + TIMES.NEW_INFECTED_LOCK_MS + 300 - Date.now()));
    const victimLater = await act(H1, "infect");
    report(
        "V6",
        "infección: cooldown inicial, contagio a < 60 px, you_infected, cooldowns del atacante y de la víctima, no_target sin cambiar infectReadyAt",
        v6a && v6b && farFromH2 && noTarget?.reason === "no_target" && readyBefore === readyAfter && victimStill?.reason === "cooldown" && victimLater?.reason === "no_target",
        `inicio ${early?.reason} · a ${dBefore.toFixed(0)} px ${hit?.ok} · reintento ${retry?.reason} · víctima ${victimEarly?.reason}/${victimStill?.reason}/${victimLater?.reason} · sin sanos ${noTarget?.reason} (infectReadyAt ${readyBefore === readyAfter ? "igual" : "cambió"})`,
    );

    const { v7, v7detail, v8, v8detail } = await missionsTask;
    report("V7", "misiones: started, inmóvil, too_fast, ok y cure = 100/M en todos, not_healthy, too_far, expired", v7, v7detail);
    report("V8", "victoria de los jugadores: todos reciben match_ended players y results con todos los roles; a los 3 s open_world", v8, v8detail);

    // ----- Partida 2: V12 espectador y V9 victoria del virus -----
    const started2 = await waitFor(() => p1.every((c) => c.game.phase === "playing" && c.game.startedAt > tStart), 10000);
    const tStart2 = Date.now();
    const D = connect(users.dani);
    await ready(D);
    await sleep(300);
    const spectator = D.role() === "spectator";
    const ghostSeen = await A.waitFor((c) => c.find(D)?.ghost === true, 2000);
    const noGhostOthers = A.state.players.filter((p) => p.ghost).map((p) => p.userId).join(",") === D.userId();
    const target = D.game.missions[0];
    const dMission = await startMission(D, target.id);

    const X2 = p1.find((c) => c.role() === "infected");
    const healthy2 = p1.filter((c) => c.role() === "healthy");
    const fromAll = p1.map((c) => c.events.length);
    let ok9 = Boolean(X2) && healthy2.length === 2;
    await sleep(Math.max(0, tStart2 + TIMES.INITIAL_LOCK_MS + 200 - Date.now()));
    for (const [k, h] of healthy2.entries()) {
        if (k > 0) await sleep(TIMES.INFECT_COOLDOWN_MS + 200);
        await moveTo(X2, A.find(h).x, A.find(h).y, 10);
        const r = await act(X2, "infect");
        ok9 = ok9 && r?.ok === true;
    }
    const ended9 = await waitFor(() => p1.every((c) => c.game.phase === "ended"), 3000);
    const results9 = A.game.results;
    const allEnded9 = p1.every((c, k) => c.events.slice(fromAll[k]).some((e) => e.kind === "match_ended" && e.winner === "infected"));
    report("V9", "victoria del virus: contagia a todos respetando cooldowns → winner infected, reason all_infected", started2 && ok9 && ended9 && allEnded9 && results9?.winner === "infected" && results9?.reason === "all_infected", `${results9?.winner}/${results9?.reason}`);

    // V12 (fin): en la siguiente open_world el espectador cuenta para el mínimo y entra a la partida 3
    const p3 = [A, B, C, D];
    const counted = await D.waitFor((c) => c.game.phase !== "ended" && c.game.connected === 4, 6000);
    const started3 = await waitFor(() => p3.every((c) => c.game.phase === "playing" && ["healthy", "infected"].includes(c.role())), 6000);
    report(
        "V12",
        "espectador: role spectator, ghost:true en el state de los demás, mission_start 'spectator'; luego cuenta para el mínimo",
        spectator && ghostSeen && noGhostOthers && dMission?.kind === "mission_result" && dMission.reason === "spectator" && counted && started3,
        `rol ${spectator ? "spectator" : D.role()} · ghost ${ghostSeen} · mission_start ${dMission?.reason ?? dMission?.kind} · partida 3 con D: ${started3 ? D.role() : "no"}`,
    );

    // ----- V11: gracia (partida 3, roster de 4) -----
    let v11 = false;
    let v11detail = "la partida 3 no empezó";
    if (started3) {
        await sleep(300);
        const X3 = p3.find((c) => c.role() === "infected");
        const R = p3.find((c) => c.role() === "healthy");
        const roleBefore = R.role();
        R.close();
        await sleep(1500);
        const R2 = connect(R.user);
        await ready(R2);
        await R2.waitFor((c) => c.game.phase === "playing" && c.role(), 2000);
        const kept = R2.role() === roleBefore;
        const atPlaza = dist(R2.me(), plaza);
        // El infectado se va y no vuelve: a los 6 s sale del roster y, sin infectados, ganan los jugadores
        const stay = p3.filter((c) => c !== X3 && c !== R).concat(R2);
        const from = stay.map((c) => c.events.length);
        const tLeave = Date.now();
        X3.close();
        const ended = await waitFor(() => stay.every((c) => c.game.phase === "ended"), TIMES.RECONNECT_GRACE_MS + 3000);
        const tEnded = Date.now() - tLeave;
        const res = R2.game.results;
        const allGot = stay.every((c, k) => c.events.slice(from[k]).some((e) => e.kind === "match_ended" && e.winner === "players"));
        v11 = kept && atPlaza < 100 && ended && allGot && res?.reason === "no_infected" && tEnded >= TIMES.RECONNECT_GRACE_MS && !res.players.some((p) => p.username === X3.user.username) && res.players.length === 3;
        v11detail = `reconecta con rol ${kept ? "igual" : "distinto"} a ${atPlaza.toFixed(0)} px de la plaza · el infectado sale a los ${(tEnded / 1000).toFixed(1)} s → ${res?.winner}/${res?.reason} · roster final ${res?.players.length}`;
        for (const c of stay) c.close();
    }
    report("V11", "gracia: reconectar dentro de 6 s conserva el rol (en la plaza); quien no vuelve sale y se reevalúa la victoria", v11, v11detail);

    // ----- X1-X7: partida en el clúster con relevo y handover (solo con 3 o más coordinadores) -----
    if (N >= 3) await clusterTests(users);

    // ----- V5: información oculta (sobre todo lo recibido hasta ahora) -----
    const names = Object.values(users).map((u) => u.username);
    let leak = findLeaks(allClients, names);
    const alerts = allClients.reduce((n, c) => n + c.events.filter((e) => e.kind === "contagion_alert").length, 0);
    const statusText = JSON.stringify(statusDuring.json);
    if (/role|healthy|infected/.test(statusText)) leak ||= "/status con roles";
    report("V5", "información oculta: game solo con you.role propio, state y /status sin roles, contagion_alert sin ids ni nombres", !leak && alerts > 0 && statusDuring.status === 200, leak || `${allClients.reduce((n, c) => n + c.games.length, 0)} game revisados · ${alerts} alertas · /status ${statusText}`);

    // ----- V10: segunda ejecución con MATCH_DURATION_MS=8000 -----
    for (const c of allClients) c.ws.terminate();
    await stopCoords();
    startCoords({ ...TIMES, MATCH_DURATION_MS: 8000 });
    if (!(await coordsUp())) {
        report("V10", "tiempo agotado → winner infected, reason time", false, "los coordinadores no volvieron");
        return;
    }
    const q = [connect(users.ana), connect(users.beto), connect(users.caro)];
    for (const c of q) await ready(c);
    const playing10 = await waitFor(() => q.every((c) => c.game.phase === "playing"), 5000);
    const t10 = Date.now();
    const ended10 = await waitFor(() => q.every((c) => c.game.phase === "ended"), 8000 + 3000);
    const r10 = q[0].game.results;
    report("V10", "tiempo agotado (MATCH_DURATION_MS=8000, sin hacer nada) → winner infected, reason time", playing10 && ended10 && r10?.winner === "infected" && r10?.reason === "time", `${r10?.winner}/${r10?.reason} a los ${((Date.now() - t10) / 1000).toFixed(1)} s`);
    for (const c of q) c.close();
    await sleep(300);
}

// Información oculta en lo que reciben los clientes: game solo con su you.role (los roles de todos solo en
// results, en 'ended'), state y players_update sin roles, contagion_alert sin ids ni nombres
function findLeaks(clients, names) {
    const userIds = allClients.map((c) => c.userId()).filter(Boolean);
    const youKeys = "infectReadyAt,missionId,missionStartedAt,role";
    let leak = "";
    for (const c of clients) {
        for (const g of c.games) {
            const { you, results, ...rest } = g;
            if (Object.keys(you).sort().join(",") !== youKeys) leak ||= `you con campos raros: ${Object.keys(you)}`;
            if (/role|healthy|infected|spectator/.test(JSON.stringify(rest))) leak ||= `game de ${c.user.username} con roles fuera de you`;
            if (results && g.phase !== "ended") leak ||= "results fuera de ended";
            if (g.phase !== "ended" && userIds.some((id) => id !== c.userId() && JSON.stringify(g).includes(`"${id}"`))) leak ||= "game con el id de otro";
        }
        for (const s of [...c.stateSamples, ...c.playersUpdates]) if (/"role"|healthy|infected|spectator/.test(s)) leak ||= "state o players_update con roles";
        for (const e of c.events.filter((x) => x.kind === "contagion_alert")) {
            const json = JSON.stringify(e);
            if (Object.keys(e).sort().join(",") !== "kind,type,zone" || userIds.some((id) => json.includes(`"${id}"`)) || names.some((n) => json.includes(n))) leak ||= `contagion_alert con datos: ${json}`;
        }
    }
    return leak;
}

// Pide un coordinador al directorio (como el cliente real) y se conecta; si devuelve el que está caído
// (sigue en el directorio hasta que vence su TTL) vuelve a pedir: su reserva hace que el siguiente sea otro
async function viaDirectory(user, deadId) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
        const r = await getJson(`${AUTH}/coordinator`);
        if (r.status === 200 && r.json.coordinatorId !== deadId) return connect(user, { url: r.json.publicUrl, id: r.json.coordinatorId });
        await sleep(100);
    }
    return null;
}

// Partida 4 en el clúster: 6 jugadores (2 por coordinador). X1-X7.
async function clusterTests(users) {
    const matchOf = async () => (await Promise.all(LETTERS.slice(0, 3).map((_, i) => statusOf(i)))).map((r) => r.json?.match ?? null);
    const names = Object.values(users).map((u) => u.username);
    const results = {};
    const say = (id, desc, ok, detail) => (results[id] = { desc, ok, detail });

    await waitFor(async () => (await statusOf(0)).json?.match.phase === "open_world", 8000, 200);
    let live = ["ana", "beto", "caro", "dani", "eva", "fede"].map((n, k) => connect(users[n], k % 3));
    const clusterClients = [...live];
    for (const c of live) await ready(c);
    const playing = await waitFor(() => live.every((c) => c.game.phase === "playing" && ["healthy", "infected"].includes(c.role())), 6000);
    const tStart = Date.now();

    // ----- X1 -----
    let m = await matchOf();
    await waitFor(async () => {
        m = await matchOf();
        return m.every((s) => s && s.phase === "playing" && s.matchId === m[0].matchId && s.arbiterId === "coord-a");
    }, 2000, 100);
    const x1 = playing && m.every((s) => s?.phase === "playing" && s.matchId === m[0].matchId && s.arbiterId === "coord-a");
    report("X1", "/status de los tres coincide en phase, matchId y arbiterId (= coord-a) tras iniciar la partida", x1, m.map((s, i) => `coord-${LETTERS[i]}: ${s?.phase} #${s?.matchId} árbitro ${s?.arbiterId}`).join(" · "));
    if (!playing) {
        for (const c of live) c.close();
        return;
    }
    const matchId = m[0].matchId;

    // Mueve la sesión de un jugador a otro coordinador (la vieja se cierra con 4002 y conserva su rol)
    async function moveSession(c, i) {
        if (c.coordinator === `coord-${LETTERS[i]}`) return c;
        const n = connect(c.user, i);
        clusterClients.push(n);
        await ready(n);
        await n.waitFor((x) => x.role(), 2000);
        await waitFor(() => c.closed, 2000);
        live = live.map((x) => (x === c ? n : x));
        return n;
    }

    // ----- X2: infectado en coord-b contagia a un sano en coord-c (árbitro coord-a) -----
    let X = await moveSession(live.find((c) => c.role() === "infected"), 1);
    let V = live.find((c) => c.role() === "healthy" && c.coordinator === "coord-c") ?? (await moveSession(live.find((c) => c.role() === "healthy"), 2));
    await sleep(Math.max(0, tStart + TIMES.INITIAL_LOCK_MS + 300 - Date.now()));
    await moveTo(X, X.find(V).x, X.find(V).y, 10);
    const readyBefore = X.game.you.infectReadyAt;
    const hit = await act(X, "infect");
    const victimSees = await V.waitFor((c) => c.role() === "infected", 2000);
    const attackerSees = await X.waitFor((c) => c.game.you.infectReadyAt > readyBefore, 2000);
    report("X2", "un infectado en coord-b contagia a un sano en coord-c (árbitro coord-a); ambos ven el cambio en su game", hit?.ok === true && victimSees && attackerSees && X.coordinator === "coord-b" && V.coordinator === "coord-c", `infect_result ${hit?.ok} · víctima ${V.role()} · infectReadyAt del atacante ${attackerSees ? "actualizado" : "igual"}`);

    // ----- X3: misiones desde coordinadores distintos; la cura es la misma en todos -----
    const healthy = live.filter((c) => c.role() === "healthy");
    const h1 = healthy[0];
    const h2 = healthy.find((c) => c.coordinator !== h1.coordinator) ?? (await moveSession(healthy[1], (LETTERS.indexOf(h1.coordinator.slice(-1)) + 1) % 3));
    const m1 = nearestMission(h1, available(h1));
    const m2 = nearestMission(h2, available(h2).filter((x) => x.id !== m1.id));
    const doMission = async (c, mission) => {
        await moveTo(c, mission.x, mission.y);
        const s = await startMission(c, mission.id);
        if (s?.kind !== "mission_started") return s;
        await sleep(TIMES.MISSION_MIN_MS + 150);
        return act(c, "mission_complete", mission.id);
    };
    const [r1, r2] = await Promise.all([doMission(h1, m1), doMission(h2, m2)]);
    const expected = (2 * 100) / h1.game.missions.length;
    const sameCure = await waitFor(() => live.every((c) => Math.abs(c.game.cure - expected) < 1e-9), 2000);
    m = await matchOf();
    report("X3", "la cura es la misma en los clientes de los tres coordinadores tras misiones desde coordinadores distintos", r1?.ok === true && r2?.ok === true && sameCure && m.every((s) => Math.abs(s.cure - expected) < 1e-9), `${h1.coordinator} y ${h2.coordinator} · cura ${expected.toFixed(2)} en ${live.length} clientes y en /status`);

    // ----- X4: se mata coord-a (el árbitro) en plena partida -----
    const I = live.find((c) => c.role() === "infected" && c.coordinator === "coord-a") ?? (await moveSession(V, 0));
    const aClients = live.filter((c) => c.coordinator === "coord-a");
    const rolesBefore = new Map(aClients.map((c) => [c.user.username, c.role()]));
    const before = (await statusOf(1)).json.match;
    const tKill = Date.now();
    await killCoord("a");
    const relay = await waitFor(async () => (await Promise.all([statusOf(1), statusOf(2)])).every((r) => r.json?.match.arbiterId === "coord-b"), 3000, 100);
    const relayMs = Date.now() - tKill;
    const afterKill = (await Promise.all([statusOf(1), statusOf(2)])).map((r) => r.json?.match);
    const conserved = afterKill.every((s) => s && s.phase === before.phase && s.matchId === before.matchId && s.cure === before.cure);
    const reconnected = [];
    for (const c of aClients) {
        const n = await viaDirectory(c.user, "coord-a");
        if (n) {
            reconnected.push(n);
            clusterClients.push(n);
        }
    }
    for (const n of reconnected) {
        await ready(n);
        await n.waitFor((x) => x.role(), 2000);
    }
    const reconnectMs = Date.now() - tKill;
    const rolesKept = reconnected.length === aClients.length && reconnected.every((n) => n.role() === rolesBefore.get(n.user.username));
    live = live.filter((c) => !aClients.includes(c)).concat(reconnected);
    const I2 = reconnected.find((n) => n.user === I.user);
    const iAct = I2 ? await act(I2, "infect") : null;
    const canAct = Boolean(iAct) && !["spectator", "arbiter_unavailable", "not_infected", "not_playing"].includes(iAct.reason);
    const x4partial = relay && relayMs < 3000 && conserved && rolesKept && reconnectMs < TIMES.RECONNECT_GRACE_MS && I2?.role() === "infected" && canAct;
    const x4detail = `árbitro coord-b en ${relayMs} ms · phase/matchId/cure ${conserved ? "iguales" : "distintos"} · ${reconnected.length}/${aClients.length} reconectados por /coordinator en ${(reconnectMs / 1000).toFixed(1)} s con su rol ${rolesKept} · infectado actúa: ${iAct?.ok ?? ""} ${iAct?.reason ?? ""}`;

    // ----- X5: coord-a vuelve con la partida en curso -----
    startCoord("a", 0, TIMES);
    const back = await waitFor(async () => (await matchOf()).every((s) => s?.arbiterId === "coord-a"), 15000, 200);
    m = await matchOf();
    const handedOver = m.every((s) => s && s.phase === "playing" && s.matchId === matchId && s.cure === before.cure);
    const noCountdown = live.every((c) => c.games.filter((g) => g.serverTime >= tKill).every((g) => g.phase === "playing" || g.phase === "ended"));
    const actor = live.find((c) => c.role() === "infected" && c.coordinator !== "coord-a") ?? live.find((c) => c.role() === "infected");
    const afterBack = await act(actor, "infect");
    const actionsWork = Boolean(afterBack) && afterBack.reason !== "arbiter_unavailable";
    say("X5", "reincorporación: coord-a vuelve a ser árbitro con el mismo matchId y cure (handover), sin cuenta nueva; las acciones siguen", back && handedOver && noCountdown && actionsWork, `${m.map((s, i) => `coord-${LETTERS[i]}: árbitro ${s?.arbiterId} #${s?.matchId} cura ${s?.cure?.toFixed(2)}`).join(" · ")} · sin countdown ${noCountdown} · acción de ${actor.coordinator}: ${afterBack?.reason ?? afterBack?.ok}`);

    // ----- X6: un peer falso CON el secreto intenta alterar la partida -----
    const beforeFake = await matchOf();
    const fakes = [];
    for (const [i, id] of [
        [0, "coord-fake"],
        [1, "coord-fake2"],
    ]) {
        const ws = new WebSocket(`ws://localhost:${peerPort(i)}`, { headers: { "x-cluster-secret": CLUSTER_SECRET } });
        ws.on("error", () => {});
        const hello = new Promise((resolve) => ws.once("message", () => resolve(true)));
        await new Promise((resolve) => ws.once("open", resolve));
        ws.send(JSON.stringify({ type: "hello", coordinatorId: id }));
        await Promise.race([hello, sleep(2000)]);
        fakes.push({ ws, id });
    }
    const someone = live.find((c) => c.role() === "healthy") ?? live[0];
    const giantRoster = {};
    for (let k = 0; k < 250; k++) giantRoster[`z${k}`] = { username: `zombi_${k}`, role: "infected", infectReadyAt: null, connected: true, disconnectedAt: null };
    const fakeMatch = { ...createMatchState(), matchId: 999, rev: 999, eid: 9999 };
    for (const { ws, id } of fakes) {
        const sendJ = (o) => ws.send(JSON.stringify(o));
        sendJ({ type: "game_state", origin: id, match: fakeMatch, events: [{ eid: 9999, kind: "match_ended", winner: "players" }] }); // (a) no es el árbitro
        sendJ({ type: "game_action", origin: id, userId: someone.userId(), action: { kind: "infect" } }); // (b) jugador ajeno
        sendJ({ type: "game_action", origin: id, userId: someone.userId(), action: { kind: "mission_cancel" } });
        sendJ({ type: "game_state", origin: id, match: { ...fakeMatch, cure: 150 }, events: [] }); // (c) cure inválida
        sendJ({ type: "game_state", origin: id, match: { ...fakeMatch, roster: giantRoster }, events: [] }); // (c) roster gigante
        sendJ({ type: "game_state", origin: "coord-a", match: fakeMatch, events: [] }); // origin ajeno al de la conexión
        sendJ({ type: "game_state", origin: id, match: "basura", events: [] });
    }
    await sleep(1500);
    const afterFake = await Promise.all(LETTERS.slice(0, 3).map((_, i) => statusOf(i)));
    const alive = afterFake.every((r) => r.status === 200);
    const unchanged = afterFake.every((r, i) => {
        const s = r.json?.match;
        return s && s.phase === beforeFake[i].phase && s.matchId === beforeFake[i].matchId && s.cure === beforeFake[i].cure && s.arbiterId === "coord-a";
    });
    const fakeEnded = live.some((c) => c.events.some((e) => e.kind === "match_ended"));
    say("X6", "peer falso con el secreto: game_state que no es del árbitro, game_action ajeno y match inválido no cambian nada ni tumban a nadie", alive && unchanged && !fakeEnded && someone.role() !== undefined, `coordinadores vivos ${alive} · partida ${unchanged ? "igual" : "cambió"} · match_ended falso ${fakeEnded}`);
    for (const { ws } of fakes) ws.close();

    // ----- X7: nada de lo que reciben los clientes ni /status expone roles -----
    const leak = findLeaks(clusterClients, names);
    const statusText = JSON.stringify(afterFake.map((r) => r.json));
    say("X7", "ningún mensaje hacia los clientes (game, state, players_update, eventos) ni /status de los tres expone roles", !leak && !/role|healthy|infected/.test(statusText), leak || `${clusterClients.reduce((n, c) => n + c.games.length, 0)} game · /status de 3 coordinadores sin roles`);

    // La partida sigue hasta un final válido (por tiempo, cura o contagio)
    const endsAt = live[0].game.endsAt;
    const ended = await waitFor(() => live.every((c) => c.closed || c.game.phase === "ended"), Math.max(0, endsAt - Date.now()) + 4000, 200);
    const res = live.find((c) => !c.closed)?.game.results;
    const validEnd = ended && ["players", "infected"].includes(res?.winner) && ["cure", "all_infected", "time", "no_infected"].includes(res?.reason);
    report("X4", "relevo: matan a coord-a; coord-b asume en < 3 s conservando la partida; sus clientes reconectan con su rol y la partida termina bien", x4partial && validEnd, `${x4detail} · final ${res?.winner}/${res?.reason}`);
    for (const id of ["X5", "X6", "X7"]) report(id, results[id].desc, results[id].ok, results[id].detail);
    for (const c of live) c.close();
    await sleep(300);
}

// V7 y V8 con el único sano que queda (H) mientras los infectados están en la plaza
async function runMissions(H, X, everyone) {
    let v7detail = "";
    let v7 = false;
    let v8 = false;
    let v8detail = "";
    try {
        const M = H.game.missions.length;
        const first = nearestMission(H, available(H));
        await moveTo(H, first.x, first.y);
        const started = await startMission(H, first.id);
        const okStart = started?.kind === "mission_started";
        // Inmóvil: las intenciones no cambian su posición
        const before = H.me();
        H.intent(1, 1);
        await sleep(600);
        const after = H.me();
        H.intent(0, 0);
        const still = dist(before, after) < 0.5;
        const tooFast = await act(H, "mission_complete", first.id);
        await sleep(TIMES.MISSION_MIN_MS + 150);
        const done = await act(H, "mission_complete", first.id);
        const cure = 100 / M;
        const cureAll = await waitFor(() => everyone.every((c) => Math.abs(c.game.cure - cure) < 1e-9), 2000);
        const notHealthy = await startMission(X, available(H)[0]?.id);
        // Lejos de otra estación: too_far
        const far = available(H).sort((a, b) => dist(H.me(), b) - dist(H.me(), a))[0];
        const tooFar = await startMission(H, far.id);
        // Expira si se espera más de MISSION_MAX_MS
        const next = nearestMission(H, available(H));
        await moveTo(H, next.x, next.y);
        await startMission(H, next.id);
        const expired = await H.waitEvent("mission_result", H.events.length, TIMES.MISSION_MAX_MS + 2000, (e) => e.missionId === next.id);
        v7 =
            okStart && still && tooFast?.reason === "too_fast" && done?.ok === true && cureAll && notHealthy?.reason === "not_healthy" && tooFar?.reason === "too_far" && expired?.reason === "expired";
        v7detail = `M=${M} · started ${okStart} · inmóvil ${still} · ${tooFast?.reason} · ok ${done?.ok} · cure ${H.game.cure.toFixed(2)} en todos ${cureAll} · infectado ${notHealthy?.reason} · lejos ${tooFar?.reason} · espera ${expired?.reason}`;

        // V8: completar todas las misiones que quedan
        const from = everyone.map((c) => c.events.length);
        while (H.game.phase === "playing" && available(H).length > 0) {
            const m = nearestMission(H, available(H));
            await moveTo(H, m.x, m.y);
            const s = await startMission(H, m.id);
            if (s?.kind !== "mission_started") throw new Error(`no pudo empezar ${m.id}: ${s?.reason}`);
            await sleep(TIMES.MISSION_MIN_MS + 100);
            await act(H, "mission_complete", m.id);
            await sleep(150);
        }
        const ended = await waitFor(() => everyone.every((c) => c.game.phase === "ended"), 3000);
        const res = H.game.results;
        const cureAtEnd = H.game.cure; // al volver a open_world la cura vuelve a 0
        const allGot = everyone.every((c, k) => c.events.slice(from[k]).some((e) => e.kind === "match_ended" && e.winner === "players"));
        const allRoles = everyone.every((c) => c.game.results?.players.length === 3 && c.game.results.players.every((p) => ["healthy", "infected"].includes(p.role)));
        const tEnded = Date.now();
        const reopened = await waitFor(() => everyone.every((c) => c.game.phase !== "ended"), TIMES.RESULTS_MS + 1500);
        const reopenMs = Date.now() - tEnded;
        v8 = ended && allGot && res?.winner === "players" && res?.reason === "cure" && cureAtEnd === 100 && allRoles && reopened && reopenMs >= TIMES.RESULTS_MS - 400;
        v8detail = `${res?.winner}/${res?.reason} · cure ${cureAtEnd} · results con ${res?.players.length} roles · open_world a los ${(reopenMs / 1000).toFixed(1)} s`;
    } catch (err) {
        v7detail ||= `error: ${err.message}`;
        v8detail = `error: ${err.message}`;
    }
    return { v7, v7detail, v8, v8detail };
}

// Logs: sin secretos, tokens ni roles
function checkLogs() {
    const logs = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".log"));
    const leaks = [];
    for (const f of logs) {
        const text = fs.readFileSync(path.join(tmpDir, f), "utf8");
        if (text.includes(JWT_SECRET) || text.includes(CLUSTER_SECRET)) leaks.push(`${f}: secreto`);
        if (tokens.some((t) => t && text.includes(t))) leaks.push(`${f}: token`);
        if (/\b(healthy|infected|spectator)\b|"role"/.test(text)) leaks.push(`${f}: roles`);
    }
    report("LOG", "ningún log contiene secretos, tokens ni roles", leaks.length === 0, leaks.join(", ") || `${logs.length} logs revisados`);
}

main()
    .catch((err) => report("ERROR", "excepción inesperada", false, err.stack))
    .finally(async () => {
        try {
            checkLogs();
        } catch (err) {
            report("LOG", "revisión de logs", false, err.message);
        }
        await cleanup();
        console.log(`\n${passed} pasaron, ${failed} fallaron`);
        process.exit(failed > 0 ? 1 : 0);
    });
