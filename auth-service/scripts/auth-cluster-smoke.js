// Smoke del clúster de auth-services (Taller 7): npm run smoke:auth-cluster
//
// Levanta 3 auth como procesos hijos (auth-a/b/c en 4801-4803, mesh en 4901-4903), cada uno con su BD temporal,
// secretos aleatorios compartidos y un GOOGLE_CLIENT_ID de prueba. Todo por variables de entorno (--env apunta a un
// archivo vacío: no se lee auth-service/.env) y los logs van a archivos temporales. Al terminar (éxito, fallo o
// Ctrl+C) mata a todos y borra los temporales. Imprime ✔/✘ por prueba y sale con 1 si alguna falla.
//
// A1 un líder y dos réplicas · A2 escritura en réplica (not_leader) y en el líder · A3 login en los 3 nodos ·
// A4 concurrencia · A5 relevo al matar al líder · A6 sin 201 en réplicas durante la elección · A7 escritura en el
// nuevo líder · A8 el nodo que vuelve es réplica y se sincroniza · A9 mayoría · A10 reinicio completo ·
// A11 seguridad del mesh · A12 headers X-Auth-* y CORS · A13 logs sin datos sensibles
"use strict";

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");
const jwt = require("jsonwebtoken");

const AUTH_DIR = path.join(__dirname, "..");
const IDS = ["auth-a", "auth-b", "auth-c"];
const PORT = { "auth-a": 4801, "auth-b": 4802, "auth-c": 4803 };
const PEER = { "auth-a": 4901, "auth-b": 4902, "auth-c": 4903 };
const url = (id) => `http://localhost:${PORT[id]}`;
const NODES = IDS.map((id) => `${id}|${url(id)}|ws://localhost:${PEER[id]}`).join(",");
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const CLUSTER_SECRET = crypto.randomBytes(32).toString("hex");
const PASSWORD = "claveSmoke1";
const ELECTION_BUDGET_MS = 12000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auth-cluster-smoke-"));
const emptyEnv = path.join(tmp, "vacio.env");
fs.writeFileSync(emptyEnv, "");
const children = new Map();
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(id, description, ok, detail = "") {
    results.push({ id, ok });
    console.log(`${ok ? "✔" : "✘"} ${id} ${description}${detail ? ` — ${detail}` : ""}`);
}

// node:sqlite necesita --experimental-sqlite en Node 22.5-22.12 y 23.0-23.3
function sqliteFlag() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    return (major === 22 && minor < 13) || (major === 23 && minor < 4) ? ["--experimental-sqlite"] : [];
}

function startNode(id) {
    const log = fs.openSync(path.join(tmp, `${id}.log`), "a");
    const child = spawn(process.execPath, [...sqliteFlag(), "index.js", "--env", emptyEnv], {
        cwd: AUTH_DIR,
        stdio: ["ignore", log, log],
        env: {
            ...process.env,
            AUTH_ID: id,
            PORT: String(PORT[id]),
            PEER_PORT: String(PEER[id]),
            PUBLIC_URL: url(id),
            PEER_URL: `ws://localhost:${PEER[id]}`,
            AUTH_NODES: NODES,
            DB_PATH: path.join(tmp, `${id}.db`),
            JWT_SECRET,
            JWT_EXPIRES_IN: "1h",
            BCRYPT_ROUNDS: "10",
            CLUSTER_SECRET,
            GOOGLE_CLIENT_ID: "000000000000-smoke.apps.googleusercontent.com",
        },
    });
    fs.closeSync(log);
    // Un hijo matado con kill() queda con exitCode null (y signalCode): se marca al salir, sea como sea
    child.once("exit", () => {
        child.exited = true;
    });
    children.set(id, child);
    return child;
}

async function killNode(id) {
    const child = children.get(id);
    if (!child || child.exited) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
}

async function cleanup() {
    for (const id of IDS) await killNode(id);
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// ---------- HTTP ----------

async function request(id, method, route, body, headers = {}) {
    try {
        const res = await fetch(url(id) + route, {
            method,
            headers: { "Content-Type": "application/json", ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(4000),
        });
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = undefined;
        }
        return { status: res.status, json, headers: res.headers };
    } catch {
        return { status: 0, json: undefined, headers: new Headers() };
    }
}
const status = async (id) => (await request(id, "GET", "/status")).json ?? null;
const statuses = (ids = IDS) => Promise.all(ids.map(status));
const register = (id, username) => request(id, "POST", "/register", { username, password: PASSWORD });
const login = (id, username) => request(id, "POST", "/login", { username, password: PASSWORD });

async function waitFor(fn, ms, every = 100) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = await fn();
        if (v) return v;
        await sleep(every);
    }
    return null;
}

const alive = () => IDS.filter((id) => children.get(id) && !children.get(id).exited);
// Exactamente un líder entre los vivos y los demás réplicas que lo siguen; devuelve { leader, list } o null
async function settled(ids = alive()) {
    const list = await statuses(ids);
    if (list.some((s) => !s)) return null;
    const leaders = list.filter((s) => s.role === "leader");
    if (leaders.length !== 1) return null;
    const L = leaders[0];
    if (!list.every((s) => s.role === "leader" || (s.role === "replica" && s.leaderId === L.authId && s.term === L.term))) return null;
    return { leader: L, list };
}
// Mismo lastAppliedSeq, users y checksum en todos
async function converged(ids = alive()) {
    const list = await statuses(ids);
    if (list.some((s) => !s)) return null;
    const first = list[0];
    return list.every((s) => s.lastAppliedSeq === first.lastAppliedSeq && s.users === first.users && s.checksum === first.checksum) ? list : null;
}

// ---------- WebSocket al mesh (A11) ----------

function peerConnect(port, { secret, hello, raw, afterHello = [] } = {}) {
    return new Promise((resolve) => {
        const headers = secret === undefined ? {} : { "x-cluster-secret": secret };
        const ws = new WebSocket(`ws://localhost:${port}`, { headers });
        const out = { status: null, closeCode: null, reply: null };
        const finish = () => resolve(out);
        ws.on("unexpected-response", (req, res) => {
            out.status = res.statusCode;
            req.destroy();
            finish();
        });
        ws.on("error", () => {});
        ws.on("open", () => {
            out.status = 101;
            if (raw !== undefined) ws.send(raw);
            if (hello) ws.send(JSON.stringify(hello));
        });
        ws.on("message", async (data) => {
            if (out.reply) return;
            out.reply = JSON.parse(data.toString());
            for (const m of afterHello) ws.send(typeof m === "string" ? m : JSON.stringify(m));
            await sleep(500);
            ws.close();
        });
        ws.on("close", (code) => {
            out.closeCode = code;
            finish();
        });
        setTimeout(() => {
            ws.terminate();
            finish();
        }, 6000);
    });
}

// ---------- Pruebas ----------

async function main() {
    const busy = [];
    for (const id of IDS) for (const p of [PORT[id], PEER[id]]) if ((await request(id, "GET", "/health")).status !== 0 && p === PORT[id]) busy.push(p);
    if (busy.length) throw new Error(`puertos ocupados: ${busy.join(", ")}`);
    console.log(`Clúster de auth: ${IDS.map((id) => `${id} ${PORT[id]}/${PEER[id]}`).join(" · ")}`);
    let expectedUsers = 0;

    // A1
    for (const id of IDS) startNode(id);
    const t1 = Date.now();
    const s1 = await waitFor(settled, 10000);
    let leader = s1?.leader.authId;
    let detail1 = "sin líder";
    let ok1 = false;
    if (s1) {
        const peers = await Promise.all(IDS.map(async (id) => (await request(id, "GET", "/peers")).json?.peers ?? []));
        const peersOk = IDS.every((id, i) => {
            const p = peers[i];
            const others = IDS.filter((x) => x !== id);
            return p.length === 2 && others.every((o) => p.some((x) => x.authId === o && x.role === (o === leader ? "leader" : "replica")));
        });
        const known = s1.list.every((s) => s.knownPeers.length === 2 && !s.knownPeers.includes(s.authId));
        const same = new Set(s1.list.map((s) => `${s.term}|${s.users}`)).size === 1;
        ok1 = peersOk && known && same && s1.list.filter((s) => s.role === "replica").length === 2;
        detail1 = `${((Date.now() - t1) / 1000).toFixed(1)} s · líder ${leader} (término ${s1.leader.term}) · /peers ${peersOk} · knownPeers ${known} · term/users iguales ${same}`;
    }
    report("A1", "en < 10 s hay un líder y dos réplicas; /status, knownPeers y /peers coherentes", ok1, detail1);
    if (!s1) throw new Error("no hubo líder: no tiene sentido seguir");

    // A2
    const replica = IDS.find((id) => id !== leader);
    const onReplica = await register(replica, "alice");
    const onLeader = await register(leader, "alice");
    expectedUsers += 1;
    const t2 = Date.now();
    const conv2 = await waitFor(async () => {
        const c = await converged();
        return c && c[0].users === expectedUsers ? c : null;
    }, 500, 25);
    report("A2", "register en una réplica → 503 not_leader con la URL del líder; en el líder → 201; en < 500 ms los tres coinciden", onReplica.status === 503 && onReplica.json?.error === "not_leader" && onReplica.json?.leaderUrl === url(leader) && onLeader.status === 201 && Boolean(conv2),
        `réplica ${onReplica.status} ${onReplica.json?.error} → ${onReplica.json?.leaderUrl} · líder ${onLeader.status} · convergió en ${conv2 ? Date.now() - t2 : "—"} ms · seq ${conv2?.[0].lastAppliedSeq}`);

    // A3
    const logins = await Promise.all(IDS.map((id) => login(id, "alice")));
    const userIds = logins.map((r) => {
        try {
            return jwt.verify(r.json?.token, JWT_SECRET).userId;
        } catch {
            return null;
        }
    });
    report("A3", "login de alice en los 3 nodos → 200 con tokens válidos y el mismo userId", logins.every((r) => r.status === 200) && userIds.every((u) => u && u === userIds[0]),
        `${logins.map((r, i) => `${IDS[i]} ${r.status}`).join(" · ")} · userId ${userIds.join("/")}`);

    // A4
    const same = await Promise.all(Array.from({ length: 5 }, () => register(leader, "carla")));
    const distinct = await Promise.all(Array.from({ length: 8 }, (_, i) => register(leader, `user_${i}`)));
    expectedUsers += 1 + 8;
    const ids4 = distinct.map((r) => Number(r.json?.userId)).sort((a, b) => a - b);
    const consecutive = ids4.every((v, i) => i === 0 || v === ids4[i - 1] + 1);
    const conv4 = await waitFor(async () => {
        const c = await converged();
        return c && c[0].users === expectedUsers ? c : null;
    }, 2000, 50);
    const sameStatuses = same.map((r) => r.status).sort();
    report("A4", "5 registros paralelos del mismo nombre → un 201 y cuatro 409; 8 distintos → 201 con ids consecutivos; todos iguales", JSON.stringify(sameStatuses) === "[201,409,409,409,409]" && distinct.every((r) => r.status === 201) && consecutive && Boolean(conv4),
        `mismo nombre ${sameStatuses.join(",")} · ids ${ids4.join(",")} · users ${conv4?.[0].users}`);

    // A5 y A6: muere el líder
    const before5 = await status(leader);
    const deadLeader = leader;
    await killNode(deadLeader);
    const tKill = Date.now();
    const survivors = IDS.filter((id) => id !== deadLeader);
    // A6 (inmediato): nada de 201 en réplicas y lecturas en réplica → no_leader
    const early = await Promise.all(survivors.map((id) => register(id, "eleccion_temprana")));
    const earlyLogin = await login(survivors[0], "alice");
    let violations = 0;
    let attempts = 0;
    const s5 = await waitFor(async () => {
        const s = await settled(survivors);
        if (s) return s;
        for (const id of survivors) {
            const st = await status(id);
            if (st?.role !== "replica") continue;
            attempts += 1;
            const r = await register(id, `eleccion_${attempts}`);
            if (r.status === 201 && (await status(id))?.role !== "leader") violations += 1;
            if (r.status === 201) expectedUsers += 1;
        }
        return null;
    }, ELECTION_BUDGET_MS, 300);
    const electionMs = Date.now() - tKill;
    const newLeader = s5?.leader.authId;
    report("A6", "durante la elección ningún register da 201 en una réplica; un login en réplica sin líder → 503 no_leader",
        early.every((r) => r.status === 503 && ["no_leader", "not_leader"].includes(r.json?.error)) && earlyLogin.status === 503 && earlyLogin.json?.error === "no_leader" && violations === 0,
        `register al instante ${early.map((r) => `${r.status} ${r.json?.error}`).join(" / ")} · login ${earlyLogin.status} ${earlyLogin.json?.error} · ${attempts} intentos durante la elección, 201 en réplica: ${violations}`);
    const other5 = survivors.find((id) => id !== newLeader);
    const otherStatus = s5 ? s5.list.find((s) => s.authId === other5) : null;
    report("A5", "al matar al líder, en < 12 s una superviviente es líder con término+1 y la otra la sigue", Boolean(s5) && s5.leader.term === before5.term + 1 && otherStatus?.leaderUrl === url(newLeader),
        s5 ? `${(electionMs / 1000).toFixed(1)} s · ${deadLeader} (término ${before5.term}) → ${newLeader} (término ${s5.leader.term}) · ${other5} sigue a ${otherStatus?.leaderUrl}` : "sin nuevo líder");
    if (!s5) throw new Error("no hubo relevo");
    leader = newLeader;

    // A7
    const bob = await register(leader, "bob");
    expectedUsers += 1;
    const conv7 = await waitFor(async () => {
        const c = await converged(survivors);
        return c && c[0].users === expectedUsers ? c : null;
    }, 500, 25);
    report("A7", "register bob en el nuevo líder → 201 y la otra superviviente muestra users+1", bob.status === 201 && Boolean(conv7), `${bob.status} · users ${conv7?.[0].users}`);

    // A8
    startNode(deadLeader);
    let wasLeader = false;
    const s8 = await waitFor(async () => {
        const st = await status(deadLeader);
        if (st?.role === "leader") wasLeader = true;
        const c = await converged();
        return st?.role === "replica" && st.leaderUrl === url(leader) && c && c[0].users === expectedUsers ? st : null;
    }, 10000, 100);
    report("A8", "el nodo muerto vuelve con su BD: réplica del líder actual (no recupera el liderazgo) y sincronizado", Boolean(s8) && !wasLeader,
        s8 ? `${deadLeader}: ${s8.role} · leaderUrl ${s8.leaderUrl} · seq ${s8.lastAppliedSeq} · users ${s8.users}` : `${deadLeader} no convergió`);

    // A9
    const [r1, r2] = IDS.filter((id) => id !== leader);
    await killNode(r1);
    const with2 = await register(leader, "dora");
    if (with2.status === 201) expectedUsers += 1;
    await killNode(r2);
    const with1 = await register(leader, "edgar");
    const down = await waitFor(async () => (await status(leader))?.role === "replica", 8000, 100);
    const loginAlone = await login(leader, "alice");
    startNode(r1);
    const back9 = await waitFor(async () => settled([leader, r1]), ELECTION_BUDGET_MS, 200);
    const after9 = back9 ? await register(back9.leader.authId, "fabio") : { status: 0 };
    if (after9.status === 201) expectedUsers += 1;
    startNode(r2);
    const conv9 = await waitFor(async () => {
        const c = await converged();
        return c && c[0].users === expectedUsers && c.length === 3 ? c : null;
    }, 10000, 100);
    report("A9", "con 2 de 3 escribe; con 1 de 3 ni register ni login (503); al volver uno se recupera sin perder usuarios",
        with2.status === 201 && with1.status === 503 && Boolean(down) && loginAlone.status === 503 && after9.status === 201 && Boolean(conv9),
        `2/3 ${with2.status} · 1/3 register ${with1.status} ${with1.json?.error} · se bajó ${Boolean(down)} · login ${loginAlone.status} ${loginAlone.json?.error} · recuperado ${after9.status} · users ${conv9?.[0].users}/${expectedUsers}`);
    leader = back9?.leader.authId ?? leader;

    // A10
    for (const id of IDS) await killNode(id);
    for (const id of IDS) startNode(id);
    const s10 = await waitFor(settled, ELECTION_BUDGET_MS, 200);
    const conv10 = s10 ? await waitFor(async () => {
        const c = await converged();
        return c && c[0].users === expectedUsers ? c : null;
    }, 5000, 100) : null;
    report("A10", "reinicio completo con las mismas BD: un líder y todos los usuarios", Boolean(s10) && Boolean(conv10), s10 ? `líder ${s10.leader.authId} (término ${s10.leader.term}) · users ${conv10?.[0].users}/${expectedUsers}` : "sin líder");
    leader = s10?.leader.authId ?? leader;

    // A11
    const target = "auth-c";
    const noSecret = await peerConnect(PEER[target], {});
    const badSecret = await peerConnect(PEER[target], { secret: "secreto-incorrecto-de-prueba-0000000000" });
    const unknown = await peerConnect(PEER[target], { secret: CLUSTER_SECRET, hello: { type: "hello", authId: "auth-z", role: "replica", term: 0, leaderId: null, lastSeq: 0, lastTerm: 0 } });
    const junk = await peerConnect(PEER[target], { secret: CLUSTER_SECRET, raw: "{esto no es json" });
    const beforeState = await status(target);
    // Peer falso con el secreto que dice ser auth-a: manda basura y mensajes con remitente falso o término viejo
    const fake = await peerConnect(PEER[target], {
        secret: CLUSTER_SECRET,
        hello: { type: "hello", authId: "auth-a", role: "replica", term: 0, leaderId: null, lastSeq: 0, lastTerm: 0 },
        afterHello: [
            "basura{{",
            { type: "heartbeat", authId: "auth-b", term: 999, lastSeq: 999, lastTerm: 999 },
            { type: "vote", voter: "auth-b", term: 999, voteGranted: true },
            { type: "new_leader", leader: "auth-b", term: 999 },
            { type: "write_propagate", term: 0, seq: 1, entryId: "falsa", op: "register", data: { userId: 999, username: "intrusa", provider: "local", password_hash: "$2a$10$x", created_at: "" } },
            { type: "tipo_raro" },
        ],
    });
    await sleep(3000); // el auth-a real vuelve a conectarse
    const afterState = await status(target);
    const unchanged = afterState && ["term", "leaderId", "lastAppliedSeq", "users", "checksum"].every((k) => afterState[k] === beforeState[k]);
    report("A11", "mesh: sin secreto o con secreto malo → 401; id desconocido o JSON basura → cierre; un peer falso no tumba ni altera al nodo",
        noSecret.status === 401 && badSecret.status === 401 && unknown.closeCode === 4011 && junk.closeCode === 4011 && fake.status === 101 && Boolean(unchanged),
        `sin secreto ${noSecret.status} · secreto malo ${badSecret.status} · id desconocido ${unknown.closeCode} · basura ${junk.closeCode} · falso: hello ${fake.reply?.authId ?? "—"} · /status ${afterState ? 200 : "—"} · sin cambios ${Boolean(unchanged)}`);

    // A12
    const plain = await request(leader, "GET", "/status");
    const preflight = await request(leader, "OPTIONS", "/login", undefined, { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" });
    const exposed = preflight.headers.get("access-control-expose-headers") ?? "";
    report("A12", "las respuestas llevan X-Auth-Id y X-Auth-Role y el preflight CORS los expone",
        plain.headers.get("x-auth-id") === leader && plain.headers.get("x-auth-role") === "leader" && /X-Auth-Id/.test(exposed) && /X-Auth-Role/.test(exposed),
        `X-Auth-Id ${plain.headers.get("x-auth-id")} · X-Auth-Role ${plain.headers.get("x-auth-role")} · preflight ${preflight.status} expone "${exposed}"`);
}

async function checkLogs() {
    const leaks = [];
    for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".log"))) {
        const text = fs.readFileSync(path.join(tmp, f), "utf8");
        if (/\$2[aby]\$/.test(text)) leaks.push(`${f}: hash`);
        if (/eyJ[A-Za-z0-9_-]{10,}/.test(text)) leaks.push(`${f}: token`);
        if (text.includes(JWT_SECRET) || text.includes(CLUSTER_SECRET)) leaks.push(`${f}: secreto`);
        if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) leaks.push(`${f}: email`);
        if (text.includes(PASSWORD)) leaks.push(`${f}: contraseña`);
    }
    report("A13", "los logs de los tres nodos no contienen hashes, tokens, secretos, contraseñas ni emails", leaks.length === 0, leaks.length ? leaks.join(", ") : `${fs.readdirSync(tmp).filter((x) => x.endsWith(".log")).length} logs revisados`);
}

let finished = false;
async function finish(code) {
    if (finished) return;
    finished = true;
    try {
        await checkLogs();
    } catch {
        // los logs pueden no existir si falló el arranque
    }
    await cleanup();
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
