// Smoke completo del Taller 7: npm run smoke:full
//
// Levanta como procesos hijos 3 auth-services replicados (4811-4813, mesh 4911-4913) y 3 coordinadores
// (5811-5813, mesh 5911-5913) con AUTH_URLS de los 3 auths, secretos aleatorios, BD temporales y logs a archivos
// (--env apunta a un archivo vacío: no se leen los .env del proyecto). Las llamadas HTTP de los "clientes" usan
// el failover REAL del navegador (client/public/js/auth/failover.js). Al terminar (éxito, fallo o Ctrl+C) mata
// todo y borra los temporales. ✔/✘ por prueba; sale con 1 si alguna falla.
//
// F1 líder y directorios con los 3 coordinadores · F2 un jugador registra, entra y se mueve · F3 cae el líder de
// auth y el jugador sigue sin huecos · F4 nuevo usuario con el nuevo líder · F5 cae un coordinador con un auth
// caído: el jugador se reconecta · F6 vuelve el auth muerto · F7 sin mayoría: el juego sigue, login/registro no ·
// F8 logs sin secretos, tokens ni hashes
"use strict";

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..", "..");
const AUTH_DIR = path.join(ROOT, "auth-service");
const COORD_DIR = path.join(ROOT, "coordinator");
const FAILOVER = pathToFileURL(path.join(ROOT, "client", "public", "js", "auth", "failover.js")).href;

const AUTHS = ["auth-a", "auth-b", "auth-c"];
const COORDS = ["coord-a", "coord-b", "coord-c"];
const AUTH_PORT = { "auth-a": 4811, "auth-b": 4812, "auth-c": 4813 };
const AUTH_PEER = { "auth-a": 4911, "auth-b": 4912, "auth-c": 4913 };
const COORD_PORT = { "coord-a": 5811, "coord-b": 5812, "coord-c": 5813 };
const COORD_PEER = { "coord-a": 5911, "coord-b": 5912, "coord-c": 5913 };
const authUrl = (id) => `http://localhost:${AUTH_PORT[id]}`;
const AUTH_URLS = AUTHS.map(authUrl);
const NODES = AUTHS.map((id) => `${id}|${authUrl(id)}|ws://localhost:${AUTH_PEER[id]}`).join(",");
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const CLUSTER_SECRET = crypto.randomBytes(32).toString("hex");
const PASSWORD = "claveFull1";
const ELECTION_BUDGET_MS = 12000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "full-smoke-"));
const emptyEnv = path.join(tmp, "vacio.env");
fs.writeFileSync(emptyEnv, "");
const children = new Map();
const players = [];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (id, description, ok, detail = "") => {
    results.push({ id, ok });
    console.log(`${ok ? "✔" : "✘"} ${id} ${description}${detail ? ` — ${detail}` : ""}`);
};

function sqliteFlag() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    return (major === 22 && minor < 13) || (major === 23 && minor < 4) ? ["--experimental-sqlite"] : [];
}

function launch(name, cwd, args, env) {
    const log = fs.openSync(path.join(tmp, `${name}.log`), "a");
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", log, log], env: { ...process.env, ...env } });
    fs.closeSync(log);
    // Un hijo matado con kill() queda con exitCode null (y signalCode): se marca al salir, sea como sea
    child.once("exit", () => {
        child.exited = true;
    });
    children.set(name, child);
}

function startAuth(id) {
    launch(id, AUTH_DIR, [...sqliteFlag(), "index.js", "--env", emptyEnv], {
        AUTH_ID: id, PORT: String(AUTH_PORT[id]), PEER_PORT: String(AUTH_PEER[id]), PUBLIC_URL: authUrl(id), PEER_URL: `ws://localhost:${AUTH_PEER[id]}`,
        AUTH_NODES: NODES, DB_PATH: path.join(tmp, `${id}.db`), JWT_SECRET, JWT_EXPIRES_IN: "1h", BCRYPT_ROUNDS: "10", CLUSTER_SECRET,
        GOOGLE_CLIENT_ID: "000000000000-full.apps.googleusercontent.com", COORDINATOR_TTL_MS: "6000", RESERVATION_TTL_MS: "3000",
    });
}

function startCoord(id) {
    launch(id, COORD_DIR, ["index.js", "--env", emptyEnv], {
        COORDINATOR_ID: id, PORT: String(COORD_PORT[id]), PEER_PORT: String(COORD_PEER[id]), PUBLIC_URL: `ws://localhost:${COORD_PORT[id]}`,
        PEER_URL: `ws://localhost:${COORD_PEER[id]}`, AUTH_URLS: AUTH_URLS.join(","), JWT_SECRET, CLUSTER_SECRET, MAP_FILE: "", HEARTBEAT_AUTH_MS: "2000",
    });
}

async function kill(name) {
    const child = children.get(name);
    if (!child || child.exited) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
}
const isUp = (name) => Boolean(children.get(name)) && !children.get(name).exited;

async function getJson(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { status: res.status, json: await res.json().catch(() => null) };
    } catch {
        return { status: 0, json: null };
    }
}
async function waitFor(fn, ms, every = 150) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = await fn();
        if (v) return v;
        await sleep(every);
    }
    return null;
}

// Líder de auth entre los vivos (exactamente uno, seguido por los demás vivos)
async function authLeader(ids = AUTHS.filter(isUp)) {
    const list = await Promise.all(ids.map(async (id) => (await getJson(`${authUrl(id)}/status`)).json));
    if (list.some((s) => !s)) return null;
    const leaders = list.filter((s) => s.role === "leader");
    if (leaders.length !== 1) return null;
    return list.every((s) => s.role === "leader" || s.leaderId === leaders[0].authId) ? leaders[0] : null;
}
const directoryIds = async (id) => ((await getJson(`${authUrl(id)}/directory`)).json?.coordinators ?? []).map((c) => c.coordinatorId).sort();

// ---------- Cliente HTTP con el failover real del navegador ----------
let failover;
let client;
async function api(path, method = "GET", body) {
    const init = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await client.request(path, init);
    const json = await r.response.json().catch(() => null);
    return { status: r.response.status, json, authId: r.authId, authRole: r.authRole, retried: r.retried };
}

// ---------- Jugador ----------
function createPlayer(name) {
    const p = { name, token: null, ws: null, coordinatorId: null, closedCodes: [], lastStateAt: 0, maxGap: 0, states: 0, positions: [], timer: null };
    p.resetGaps = () => {
        p.maxGap = 0;
        p.lastStateAt = Date.now();
    };
    p.connect = (coordinatorId, publicUrl) =>
        new Promise((resolve) => {
            const ws = new WebSocket(`${publicUrl}/connect?token=${encodeURIComponent(p.token)}`);
            p.ws = ws;
            p.coordinatorId = coordinatorId;
            ws.on("error", () => {});
            ws.on("close", (code) => {
                if (p.ws === ws) p.closedCodes.push(code);
            });
            ws.on("message", (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.type !== "state") return;
                const now = Date.now();
                if (p.lastStateAt) p.maxGap = Math.max(p.maxGap, now - p.lastStateAt);
                p.lastStateAt = now;
                p.states += 1;
                const me = msg.players?.find((x) => x.username === p.name);
                if (me) p.positions.push({ t: now, x: me.x, y: me.y });
                resolve(true);
            });
            setTimeout(() => resolve(false), 5000);
        });
    // Se mueve sin parar: alterna derecha/izquierda cada 400 ms
    p.move = () => {
        let dir = 1;
        p.timer = setInterval(() => {
            dir = -dir;
            if (p.ws?.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: "intent", intent: { dir: { x: dir, y: 0 } } }));
        }, 400);
    };
    p.open = () => p.ws?.readyState === WebSocket.OPEN;
    p.close = () => {
        clearInterval(p.timer);
        p.ws?.terminate();
    };
    players.push(p);
    return p;
}

async function signUpAndPlay(name) {
    const reg = await api("/register", "POST", { username: name, password: PASSWORD });
    const login = await api("/login", "POST", { username: name, password: PASSWORD });
    const p = createPlayer(name);
    p.token = login.json?.token ?? null;
    const coord = await api("/coordinator");
    const connected = p.token && coord.status === 200 ? await p.connect(coord.json.coordinatorId, coord.json.publicUrl) : false;
    return { p, reg, login, coord, connected };
}

// ---------- Pruebas ----------

async function main() {
    failover = await import(FAILOVER);
    client = failover.createAuthClient({ urls: AUTH_URLS });
    console.log(`Clúster: auths ${AUTHS.map((id) => AUTH_PORT[id]).join("/")} · coordinadores ${COORDS.map((id) => COORD_PORT[id]).join("/")}`);
    for (const id of AUTHS) startAuth(id);
    for (const id of COORDS) startCoord(id);

    // F1
    const t1 = Date.now();
    const leader1 = await waitFor(() => authLeader(), 15000);
    const dirsOk = await waitFor(async () => {
        const dirs = await Promise.all(AUTHS.map(directoryIds));
        return dirs.every((d) => JSON.stringify(d) === JSON.stringify(COORDS)) ? dirs : null;
    }, 15000);
    report("F1", "los 3 auths eligen líder y cada /directory lista a los 3 coordinadores (heartbeats a todos)", Boolean(leader1) && Boolean(dirsOk),
        `${((Date.now() - t1) / 1000).toFixed(1)} s · líder ${leader1?.authId ?? "—"} · directorios ${dirsOk ? "3 × [coord-a, coord-b, coord-c]" : "incompletos"}`);
    if (!leader1) throw new Error("no hubo líder de auth");

    // F2
    const s2 = await signUpAndPlay("full_ana");
    const ana = s2.p;
    ana.move();
    await sleep(1500);
    const moved = ana.positions.length > 2 && new Set(ana.positions.map((q) => Math.round(q.x))).size > 1;
    report("F2", "un jugador registra y entra por failover, se conecta al coordinador asignado y se mueve recibiendo state", s2.reg.status === 201 && s2.login.status === 200 && s2.connected && moved,
        `register ${s2.reg.status} (vía ${s2.reg.authId}) · login ${s2.login.status} · coordinador ${ana.coordinatorId} · ${ana.states} state · se movió ${moved}`);

    // F3: cae el líder de auth
    const deadAuth = leader1.authId;
    const survivors = AUTHS.filter((id) => id !== deadAuth);
    ana.resetGaps();
    await kill(deadAuth);
    const tKill = Date.now();
    const duringElection = await getJson(`${authUrl(survivors[0])}/coordinator`);
    const leader2 = await waitFor(() => authLeader(survivors), ELECTION_BUDGET_MS, 200);
    const electionMs = Date.now() - tKill;
    await sleep(1500); // también después de la elección
    const dirsAfter = await Promise.all(survivors.map(directoryIds));
    const gap3 = ana.maxGap;
    report("F3", "cae el líder de auth: el WS del jugador no se cierra, state sin huecos > 1 s, /coordinator en una réplica 200 y los 3 coordinadores siguen en los directorios",
        ana.open() && ana.closedCodes.length === 0 && gap3 < 1000 && duringElection.status === 200 && Boolean(leader2) && dirsAfter.every((d) => JSON.stringify(d) === JSON.stringify(COORDS)),
        `WS abierto ${ana.open()} · hueco máximo ${gap3} ms · /coordinator en ${survivors[0]} durante la elección: ${duringElection.status} · nuevo líder ${leader2?.authId ?? "—"} en ${(electionMs / 1000).toFixed(1)} s · directorios ${dirsAfter.map((d) => d.length).join("/")}`);

    // F4: usuario nuevo con el nuevo líder (el failover maneja el auth caído, el 503 y los reintentos)
    const s4 = await signUpAndPlay("full_beto");
    report("F4", "con el nuevo líder se registra y entra un usuario nuevo y se conecta a un coordinador", s4.reg.status === 201 && s4.login.status === 200 && s4.connected,
        `register ${s4.reg.status} (vía ${s4.reg.authId}, reintentos ${s4.reg.retried}) · login ${s4.login.status} · coordinador ${s4.p.coordinatorId}`);

    // F5: cae el coordinador de ana (con un auth todavía caído en AUTH_URLS) y ana se reconecta
    const deadCoord = ana.coordinatorId;
    await kill(deadCoord);
    const closed = await waitFor(() => !ana.open(), 3000, 50);
    const tReconnect = Date.now();
    let reconnected = false;
    let newCoord = null;
    while (!reconnected && Date.now() - tReconnect < 15000) {
        const coord = await api("/coordinator");
        // El directorio olvida al coordinador muerto cuando vence su TTL; mientras tanto, se vuelve a pedir
        if (coord.status === 200 && coord.json.coordinatorId !== deadCoord) {
            newCoord = coord.json.coordinatorId;
            reconnected = await ana.connect(newCoord, coord.json.publicUrl);
        } else {
            await sleep(500);
        }
    }
    const reconnectMs = Date.now() - tReconnect;
    ana.resetGaps();
    const statesBefore = ana.states;
    await sleep(1500);
    report("F5", "cae un coordinador con un auth caído en AUTH_URLS: el jugador pide /coordinator (failover) y se reconecta a otro",
        Boolean(closed) && reconnected && ana.states > statesBefore && ana.maxGap < 1000,
        `${deadCoord} cayó · ${ana.name} → ${newCoord ?? "—"} en ${(reconnectMs / 1000).toFixed(1)} s · ${ana.states - statesBefore} state después`);

    // F6: vuelve el auth muerto
    startAuth(deadAuth);
    const liveCoords = COORDS.filter(isUp);
    const back6 = await waitFor(async () => {
        const st = (await getJson(`${authUrl(deadAuth)}/status`)).json;
        const others = await Promise.all(survivors.map(async (id) => (await getJson(`${authUrl(id)}/status`)).json));
        const dir = await directoryIds(deadAuth);
        const synced = st && others.every((o) => o && o.users === st.users && o.checksum === st.checksum);
        return st?.role === "replica" && synced && liveCoords.every((c) => dir.includes(c)) ? { st, dir } : null;
    }, 12000, 200);
    report("F6", "el auth muerto vuelve como réplica, sincroniza (users y checksum) y su /directory vuelve a ver a los coordinadores", Boolean(back6),
        back6 ? `${deadAuth}: ${back6.st.role} · users ${back6.st.users} · directorio [${back6.dir.join(", ")}]` : "no convergió");

    // F7: sin mayoría (2 de 3 auths caídos)
    const leader7 = (await waitFor(() => authLeader(), 8000))?.authId ?? AUTHS[0];
    const lone = AUTHS.find((id) => id !== leader7);
    for (const id of AUTHS) if (id !== lone) await kill(id);
    ana.resetGaps();
    await sleep(CLUSTER_WAIT_MS());
    const coordsAlive = await Promise.all(liveCoords.map(async (c) => (await getJson(`http://localhost:${COORD_PORT[c]}/status`)).status === 200));
    const dir7 = await getJson(`${authUrl(lone)}/coordinator`);
    const reg7 = await fetchJson(`${authUrl(lone)}/register`, { username: "full_sin_mayoria", password: PASSWORD });
    const login7 = await fetchJson(`${authUrl(lone)}/login`, { username: "full_ana", password: PASSWORD });
    const shortClient = failover.createAuthClient({ urls: AUTH_URLS, budgetMs: 3000 });
    let unavailable = false;
    try {
        await shortClient.request("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "full_ana", password: PASSWORD }) });
    } catch (err) {
        unavailable = err?.name === "AuthUnavailableError";
    }
    const playing = ana.open() && ana.maxGap < 1000;
    startAuth(leader7);
    const recovered = await waitFor(async () => {
        try {
            const r = await api("/login", "POST", { username: "full_ana", password: PASSWORD });
            return r.status === 200 ? r : null;
        } catch {
            return null;
        }
    }, 20000, 500);
    report("F7", "sin mayoría: el jugador sigue y los coordinadores viven; /coordinator 200 en el auth restante; login y register 503; al volver uno se recupera",
        playing && coordsAlive.every(Boolean) && dir7.status === 200 && reg7.status === 503 && login7.status === 503 && unavailable && Boolean(recovered),
        `jugador sigue ${playing} (hueco ${ana.maxGap} ms) · coordinadores ${coordsAlive.filter(Boolean).length}/${liveCoords.length} · /coordinator ${dir7.status} · register ${reg7.status} ${reg7.json?.error} · login ${login7.status} ${login7.json?.error} · failover AuthUnavailableError ${unavailable} · recuperado vía ${recovered?.authId ?? "—"}`);
}

// Tiempo para que el auth que queda pierda el lease o el contacto con el líder (como mucho LEADER_TIMEOUT_MS)
const CLUSTER_WAIT_MS = () => 6500;

async function fetchJson(url, body) {
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
        return { status: res.status, json: await res.json().catch(() => null) };
    } catch {
        return { status: 0, json: null };
    }
}

function checkLogs() {
    const leaks = [];
    const files = fs.readdirSync(tmp).filter((f) => f.endsWith(".log"));
    for (const f of files) {
        const text = fs.readFileSync(path.join(tmp, f), "utf8");
        if (text.includes(JWT_SECRET) || text.includes(CLUSTER_SECRET)) leaks.push(`${f}: secreto`);
        if (/eyJ[A-Za-z0-9_-]{10,}/.test(text)) leaks.push(`${f}: token`);
        if (/\$2[aby]\$/.test(text)) leaks.push(`${f}: hash`);
        if (text.includes(PASSWORD)) leaks.push(`${f}: contraseña`);
    }
    report("F8", "los logs no contienen secretos, tokens, hashes ni contraseñas", leaks.length === 0, leaks.length ? leaks.join(", ") : `${files.length} logs revisados`);
}

let finished = false;
async function finish(code) {
    if (finished) return;
    finished = true;
    for (const p of players) p.close();
    try {
        checkLogs();
    } catch {
        // sin logs si falló el arranque
    }
    for (const name of children.keys()) await kill(name);
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed} pasaron, ${failed} fallaron`);
    process.exit(code || (failed > 0 ? 1 : 0));
}

process.on("SIGINT", () => {
    console.log("\nInterrumpido: cerrando los procesos del smoke…");
    finish(1);
});

main()
    .then(() => finish(0))
    .catch((err) => {
        console.log(`✘ ERROR ${err.message}`);
        results.push({ id: "ERROR", ok: false });
        finish(1);
    });
