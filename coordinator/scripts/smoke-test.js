// Prueba automatizada del flujo WebSocket del coordinator (S1-S11).
// Requiere el auth-service y el coordinator levantados.
//
// Uso:  npm run smoke
// Lee de variables de entorno o de coordinator/.env:
//   AUTH_URL            (por defecto http://localhost:4000)
//   COORDINATOR_WS_URL  (por defecto ws://localhost:5000)
//   JWT_SECRET          (el mismo del coordinator; se usa para fabricar tokens de prueba)
// Sale con código 1 si alguna comprobación falla.

const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const AUTH_URL = (process.env.AUTH_URL || "http://localhost:4000").replace(/\/+$/, "");
const WS_URL = (process.env.COORDINATOR_WS_URL || "ws://localhost:5000").replace(/\/+$/, "");
const JWT_SECRET = process.env.JWT_SECRET;
const TIMEOUT_MS = 3000;

let passed = 0;
let failed = 0;

function report(id, desc, ok, detail = "") {
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "✔" : "✘"} ${id} ${desc}${detail ? ` — ${detail}` : ""}`);
}

// Resuelve con el valor de la promesa o con `fallback` si tarda más de `ms`
function withTimeout(promise, ms, fallback) {
    return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// ---------- Conexiones WS ----------

// Abre una conexión y encola los mensajes que recibe para consumirlos en orden
function connect(token, pathname = "/connect") {
    const query = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(`${WS_URL}${pathname}${query}`);
    const conn = { ws, queue: [], listeners: [], last: null, openedAt: null, errorMessage: null };

    conn.opened = new Promise((resolve) => {
        ws.once("open", () => {
            conn.openedAt = Date.now();
            resolve(true);
        });
        ws.once("close", () => resolve(false));
    });
    conn.closed = new Promise((resolve) => {
        ws.once("close", (code, reason) => resolve({ code, reason: reason.toString(), at: Date.now() }));
    });

    ws.on("error", (err) => {
        conn.errorMessage = err.message;
    });
    ws.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }
        if (msg.type === "players_update") conn.last = msg.players;
        conn.queue.push(msg);
        for (const fn of conn.listeners) fn();
    });

    return conn;
}

// Consume mensajes hasta encontrar un players_update que cumpla `predicate`.
// Resuelve con la lista de jugadores, o null si no llega a tiempo.
function nextUpdate(conn, predicate, ms = TIMEOUT_MS) {
    return new Promise((resolve) => {
        let timer;
        const finish = (players) => {
            clearTimeout(timer);
            conn.listeners = conn.listeners.filter((fn) => fn !== tryMatch);
            resolve(players);
        };
        function tryMatch() {
            while (conn.queue.length) {
                const msg = conn.queue.shift();
                if (msg.type === "players_update" && Array.isArray(msg.players) && predicate(msg.players)) {
                    return finish(msg.players);
                }
            }
        }
        timer = setTimeout(() => finish(null), ms);
        conn.listeners.push(tryMatch);
        tryMatch();
    });
}

// Descarta lo recibido hasta ahora, para esperar solo los mensajes que provoque la siguiente acción
const drain = (conn) => (conn.queue.length = 0);

const has = (players, user) => players.some((p) => p.userId === user.userId && p.username === user.username);
const count = (players, user) => players.filter((p) => p.userId === user.userId).length;
const names = (players) => (players ? `[${players.map((p) => p.username).join(", ")}]` : "sin lista");

// ---------- Usuarios ----------

async function postJson(route, body) {
    const res = await fetch(`${AUTH_URL}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
}

// Registra un usuario con sufijo aleatorio y hace login. Devuelve { username, userId, token }.
async function createUser(label) {
    const username = `smoke_${label}_${crypto.randomBytes(3).toString("hex")}`;
    const password = crypto.randomBytes(9).toString("hex");

    const reg = await postJson("/register", { username, password });
    if (reg.status !== 201) throw new Error(`el registro de ${username} respondió ${reg.status}`);

    const login = await postJson("/login", { username, password });
    if (login.status !== 200 || !login.json.token) throw new Error(`el login de ${username} respondió ${login.status}`);

    return { username, userId: jwt.decode(login.json.token).userId, token: login.json.token };
}

// ---------- Comprobaciones ----------

// La conexión debe cerrarse con 4001 "invalid token" sin recibir ninguna lista de jugadores
async function expectInvalid(id, desc, token) {
    const conn = connect(token);
    const result = await withTimeout(conn.closed, TIMEOUT_MS, null);
    if (!result) conn.ws.terminate();
    const ok = result && result.code === 4001 && result.reason === "invalid token" && conn.last === null;
    report(id, desc, ok, result ? `cierre ${result.code} "${result.reason}"` : "no se cerró a tiempo");
}

async function main() {
    if (!JWT_SECRET) throw new Error("falta JWT_SECRET (en coordinator/.env o en el entorno)");

    console.log(`Auth: ${AUTH_URL} · Coordinator: ${WS_URL}`);
    const A = await createUser("a");
    const B = await createUser("b");
    const C = await createUser("c");
    console.log(`Usuarios de prueba: ${A.username}, ${B.username}, ${C.username}\n`);

    // S1-S4: tokens inválidos
    await expectInvalid("S1", "sin token → 4001 invalid token", undefined);
    await expectInvalid("S2", 'token "abc" → 4001', "abc");
    const otherSecret = `otra_clave_distinta_${crypto.randomBytes(8).toString("hex")}`;
    await expectInvalid(
        "S3",
        "token firmado con otra secret → 4001",
        jwt.sign({ userId: A.userId, username: A.username }, otherSecret, { algorithm: "HS256", expiresIn: "1h" })
    );
    await expectInvalid(
        "S4",
        "token con la secret correcta pero vencido → 4001",
        jwt.sign(
            { userId: A.userId, username: A.username, exp: Math.floor(Date.now() / 1000) - 60 },
            JWT_SECRET,
            { algorithm: "HS256" }
        )
    );

    // S5: A se conecta
    const a1 = connect(A.token);
    const s5 = await nextUpdate(a1, (ps) => has(ps, A));
    report("S5", "A válido recibe players_update con A", s5 !== null, names(s5 ?? a1.last));

    // S6: B se conecta; ambos reciben la lista con A y B
    const b = connect(B.token);
    const both = (ps) => has(ps, A) && has(ps, B);
    const [s6a, s6b] = await Promise.all([nextUpdate(a1, both), nextUpdate(b, both)]);
    report("S6", "A y B reciben players_update con ambos", s6a !== null && s6b !== null,
        `A: ${names(s6a ?? a1.last)} · B: ${names(s6b ?? b.last)}`);

    // S7: B se desconecta; A recibe la lista con solo A
    drain(a1);
    b.ws.close();
    const s7 = await nextUpdate(a1, (ps) => ps.length === 1 && has(ps, A));
    report("S7", "B se desconecta → A recibe lista con solo A", s7 !== null, names(s7 ?? a1.last));

    // S8: A abre una segunda conexión; la primera se cierra con 4002
    const a2 = connect(A.token);
    const [a1Closed, s8] = await Promise.all([
        withTimeout(a1.closed, TIMEOUT_MS, null),
        nextUpdate(a2, (ps) => has(ps, A)),
    ]);
    const s8ok =
        a1Closed?.code === 4002 && a1Closed?.reason === "replaced by new session" && s8 !== null && count(s8, A) === 1;
    report("S8", "A2 reemplaza a A1 (4002) y la lista trae una sola entrada de A", s8ok,
        `A1: ${a1Closed ? `${a1Closed.code} "${a1Closed.reason}"` : "sin cierre"} · A2: ${names(s8 ?? a2.last)}`);

    // S9: C se conecta; la lista debe tener a A y C (el cierre de A1 no borró a A2)
    drain(a2);
    const c = connect(C.token);
    const aAndC = (ps) => has(ps, A) && has(ps, C) && count(ps, A) === 1;
    const [s9c, s9a] = await Promise.all([nextUpdate(c, aAndC), nextUpdate(a2, aAndC)]);
    report("S9", "C se conecta → la lista contiene a A y C", s9c !== null && s9a !== null && a2.ws.readyState === WebSocket.OPEN,
        `C: ${names(s9c ?? c.last)} · A2: ${names(s9a ?? a2.last)}`);

    // S10: token válido que vence a los 3 s con el socket abierto
    const shortToken = jwt.sign({ userId: B.userId, username: B.username }, JWT_SECRET, {
        algorithm: "HS256",
        expiresIn: "3s",
    });
    const e = connect(shortToken);
    const eOpened = await withTimeout(e.opened, TIMEOUT_MS, false);
    const eClosed = await withTimeout(e.closed, 7000, null);
    if (!eClosed) e.ws.terminate();
    const elapsed = eClosed && e.openedAt ? eClosed.at - e.openedAt : null;
    const s10ok = eOpened && eClosed?.code === 4001 && eClosed?.reason === "token expired" && elapsed < 6000;
    report("S10", 'token de 3 s → 4001 "token expired" en menos de 6 s', s10ok,
        eClosed ? `cierre ${eClosed.code} "${eClosed.reason}" a los ${(elapsed / 1000).toFixed(1)} s` : "no se cerró a tiempo");

    // S11: ruta distinta de /connect, aun con token válido
    const wrong = connect(A.token, "/otra-ruta");
    const wrongOpened = await withTimeout(wrong.opened, TIMEOUT_MS, null);
    if (wrongOpened === null) wrong.ws.terminate();
    report("S11", "ruta distinta de /connect → conexión rechazada", wrongOpened === false,
        wrong.errorMessage ?? (wrongOpened ? "la conexión se abrió" : "sin respuesta"));

    // Limpieza: se cierran las conexiones que siguen abiertas
    const open = [a2, c].filter((x) => x.ws.readyState === WebSocket.OPEN);
    for (const x of open) x.ws.close();
    await withTimeout(Promise.all(open.map((x) => x.closed)), TIMEOUT_MS, null);
}

main()
    .catch((err) => report("ERROR", "la prueba no pudo completarse", false, err.message))
    .finally(() => {
        console.log(`\n${passed} pasaron, ${failed} fallaron`);
        process.exit(failed > 0 ? 1 : 0);
    });
