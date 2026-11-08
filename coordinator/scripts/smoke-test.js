// Prueba automatizada del coordinator: flujo WebSocket del Taller 4 (S1-S11) y juego en vivo
// autoritativo del Taller 5 (G1-G12). Requiere el auth-service y el coordinator levantados.
// Los usuarios locales se crean en el auth; los tokens con provider 'google' se firman aquí
// con el secreto compartido (la prueba lo conoce).
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
    // last: último players_update · welcome: mensaje de bienvenida · lastState / stateCount: juego en vivo
    const conn = { ws, queue: [], listeners: [], last: null, welcome: null, lastState: null, stateCount: 0, openedAt: null, errorMessage: null };

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
        if (msg.type === "welcome") conn.welcome = msg;
        if (msg.type === "state") {
            conn.lastState = msg;
            conn.stateCount += 1;
            conn.onState?.(msg);
            return; // los state no se encolan: nextUpdate solo busca players_update
        }
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
        jwt.sign({ userId: A.userId, username: A.username, provider: "local" }, otherSecret, { algorithm: "HS256", expiresIn: "1h" })
    );
    await expectInvalid(
        "S4",
        "token con la secret correcta pero vencido → 4001",
        jwt.sign(
            { userId: A.userId, username: A.username, provider: "local", exp: Math.floor(Date.now() / 1000) - 60 },
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
    const shortToken = jwt.sign({ userId: B.userId, username: B.username, provider: "local" }, JWT_SECRET, {
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

    await gameChecks();
}

// ---------- Juego en vivo (Taller 5) ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Espera (sondeando) a que la condición se cumpla; true si se cumplió a tiempo
async function waitFor(condition, ms = TIMEOUT_MS) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (condition()) return true;
        await sleep(20);
    }
    return condition();
}

const playerIn = (conn, user) => conn.lastState?.players.find((p) => p.userId === user.userId) ?? null;
const sendJson = (conn, msg) => conn.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
const sendIntent = (conn, x, y) => sendJson(conn, { type: "intent", intent: { dir: { x, y } } });
const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const fmt = (p) => (p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})` : "sin posición");

// Mantiene una intención durante `ms`, la detiene y devuelve la posición antes y después
// (vista por el propio jugador y por otro cliente)
async function moveFor(mover, watcher, user, dir, ms) {
    const before = playerIn(mover, user);
    sendIntent(mover, dir.x, dir.y);
    await sleep(ms);
    sendIntent(mover, 0, 0);
    await sleep(300); // deja que el tick aplique el alto y llegue el state
    const after = playerIn(mover, user);
    const seen = playerIn(watcher, user);
    return { before, after, seen, dist: before && after ? Math.hypot(after.x - before.x, after.y - before.y) : NaN };
}

async function gameChecks() {
    console.log("\n— Juego en vivo —");
    const D = await createUser("d");
    const E = await createUser("e");

    // G1: welcome
    const d = connect(D.token);
    await waitFor(() => d.welcome !== null);
    const w = d.welcome;
    const g1 = w && w.you?.userId === D.userId && typeof w.you.userId === "string" && w.you.username === D.username &&
        w.you.provider === "local" && ["width", "height", "playerRadius", "tickRate"].every((k) => isNum(w.world?.[k]));
    report("G1", "welcome con you (userId string, provider local) y world numérico", g1, w ? JSON.stringify(w) : "sin welcome");
    const world = w?.world ?? { width: 1200, height: 800, playerRadius: 16, tickRate: 20 };

    // G2: frecuencia de state (~20 Hz)
    await waitFor(() => d.lastState !== null);
    const received = [];
    d.onState = (msg) => received.push(msg);
    await sleep(2000);
    d.onState = null;
    const wellFormed = received.every((s) => isNum(s.t) && Array.isArray(s.players) && s.players.every((p) => isNum(p.x) && isNum(p.y)));
    report("G2", "state a ~20 Hz: entre 30 y 45 en 2 s, con t y posiciones numéricas", received.length >= 30 && received.length <= 45 && wellFormed,
        `${received.length} state en 2 s · bien formados: ${wellFormed}`);

    // G3: dos clientes se ven mutuamente y cada jugador trae provider
    const e = connect(E.token);
    const g3 = await waitFor(() => playerIn(d, E) && playerIn(e, D) && playerIn(e, E));
    const providers = (e.lastState?.players ?? []).map((p) => `${p.username}:${p.provider}`).join(", ");
    report("G3", "dos clientes se ven en el state, cada uno con provider", g3 && playerIn(d, E)?.provider === "local" && playerIn(e, D)?.provider === "local", providers);

    // G4: un token con provider 'google' aparece como google en el state de los demás
    const G = { userId: `g-${crypto.randomBytes(3).toString("hex")}`, username: `smoke_g_${crypto.randomBytes(3).toString("hex")}` };
    const gConn = connect(jwt.sign({ ...G, provider: "google" }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" }));
    const g4 = await waitFor(() => playerIn(d, G)?.provider === "google");
    report("G4", "un usuario de Google aparece con provider google en el state de los demás", g4, `D ve: ${JSON.stringify(playerIn(d, G))}`);
    gConn.ws.close();

    // Dirección hacia el centro del mundo, para no chocar con un borde al medir
    const towardCenter = (p) => ({ x: p.x < world.width / 2 ? 1 : -1, y: p.y < world.height / 2 ? 1 : -1 });

    // G5: un eje durante 1 s ≈ 200 px, y el otro cliente ve lo mismo
    let dir = towardCenter(playerIn(d, D));
    const g5 = await moveFor(d, e, D, { x: dir.x, y: 0 }, 1000);
    const sameView = g5.seen && g5.after && Math.abs(g5.seen.x - g5.after.x) < 0.5 && Math.abs(g5.seen.y - g5.after.y) < 0.5;
    report("G5", "intención de un eje durante 1 s mueve 160-240 px y el otro cliente lo ve igual", g5.dist >= 160 && g5.dist <= 240 && sameView,
        `${g5.dist.toFixed(1)} px · ${fmt(g5.before)} → ${fmt(g5.after)} · E ve ${fmt(g5.seen)}`);

    // G6: diagonal durante 1 s: misma distancia que un eje (no ~283)
    dir = towardCenter(playerIn(d, D));
    const g6 = await moveFor(d, e, D, dir, 1000);
    report("G6", "intención diagonal durante 1 s recorre 160-240 px", g6.dist >= 160 && g6.dist <= 240, `${g6.dist.toFixed(1)} px`);

    // G7: {9999, 9999} se comporta como {1, 1}
    dir = towardCenter(playerIn(d, D));
    const g7 = await moveFor(d, e, D, { x: 9999 * dir.x, y: 9999 * dir.y }, 1000);
    report("G7", "intención {9999, 9999} se comporta como {1, 1} (sin teletransporte)", g7.dist >= 160 && g7.dist <= 240, `${g7.dist.toFixed(1)} px`);

    // G8: mensajes inválidos (y una ráfaga por encima del límite) no cierran el socket ni cambian nada
    const beforeG8 = playerIn(e, D);
    const countBefore = d.stateCount;
    const invalid = [
        "{roto",
        { type: "intent", intent: { dir: { x: "a", y: 0 } } },
        { type: "intent", intent: {} },
        { type: "teletransporte", x: 0, y: 0 },
        { type: "extras_update", extras: [1, 2, 3] },
        { type: "extras_update", extras: { pad: "x".repeat(1990) } }, // ~2000 bytes: más que MAX_EXTRAS_BYTES, menos que maxPayload
        { type: "extras_update", extras: { color: "red" } },
    ];
    for (const msg of invalid) sendJson(d, msg);
    for (let i = 0; i < 150; i++) sendJson(d, { type: "nada" }); // ráfaga por encima de MAX_MSGS_PER_SEC
    await sleep(600);
    const afterG8 = playerIn(e, D);
    const g8 = d.ws.readyState === WebSocket.OPEN && d.stateCount > countBefore + 5 && afterG8 &&
        afterG8.x === beforeG8.x && afterG8.y === beforeG8.y && JSON.stringify(afterG8.extras) === "{}";
    report("G8", "mensajes inválidos no cierran el socket ni cambian nada; siguen llegando state", g8,
        `abierto: ${d.ws.readyState === WebSocket.OPEN} · state nuevos: ${d.stateCount - countBefore} · posición ${fmt(beforeG8)} → ${fmt(afterG8)} · extras ${JSON.stringify(afterG8?.extras)}`);

    // G9: extras_update con color aparece en el state de los otros y se mantiene
    await sleep(1000); // nueva ventana del límite de mensajes
    sendJson(d, { type: "extras_update", extras: { color: "#ff5500" } });
    const seenColor = await waitFor(() => playerIn(e, D)?.extras?.color === "#ff5500");
    await sleep(600);
    const stillColor = playerIn(e, D)?.extras?.color === "#ff5500";
    report("G9", "extras con color aparece en el state de los otros y persiste", seenColor && stillColor, `E ve extras de D: ${JSON.stringify(playerIn(e, D)?.extras)}`);

    // G10: el jugador nunca sale del mundo
    sendIntent(d, -1, 0);
    await sleep(8000);
    sendIntent(d, 0, 0);
    await sleep(300);
    const edge = playerIn(d, D);
    report("G10", "intención hacia -x durante 8 s deja x == playerRadius", edge?.x === world.playerRadius, `x = ${edge?.x} (radio ${world.playerRadius})`);

    // G11: provider ausente o inválido → 4001
    const sign = (extra) => jwt.sign({ userId: "x1", username: "sin_provider", ...extra }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });
    await expectInvalid("G11", "token sin provider → 4001 invalid token", sign({}));
    await expectInvalid("G11", 'token con provider "facebook" → 4001 invalid token', sign({ provider: "facebook" }));

    // G12: al desconectar, el jugador desaparece del state y llega players_update
    drain(d);
    e.ws.close();
    const update = await nextUpdate(d, (ps) => !has(ps, E));
    const goneFromState = await waitFor(() => d.lastState && !playerIn(d, E));
    report("G12", "al desconectar desaparece del state y llega players_update", update !== null && goneFromState, `players_update: ${names(update)}`);

    d.ws.close();
    await withTimeout(d.closed, TIMEOUT_MS, null);
}

main()
    .catch((err) => report("ERROR", "la prueba no pudo completarse", false, err.message))
    .finally(() => {
        console.log(`\n${passed} pasaron, ${failed} fallaron`);
        process.exit(failed > 0 ? 1 : 0);
    });
