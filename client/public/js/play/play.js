// Página del juego en vivo (Taller 5).
// El SERVIDOR es la autoridad: este cliente no calcula posiciones. Solo:
//   - guarda el último mensaje state en window.lastState y lo dibuja,
//   - envía intenciones de movimiento y extras (color).
// Todo el texto dinámico va con textContent (DOM) o fillText (canvas).

import { playerColor } from "./colors.js";
import { createRenderer } from "./render.js";

const $ = (id) => document.getElementById(id);

// Mensajes según el código de cierre del coordinator (los mismos del Taller 4)
const CLOSE_MESSAGES = {
    4001: "Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.",
    4002: "Tu sesión se abrió en otra pestaña. Esta sesión fue cerrada.",
};
const DEFAULT_CLOSE_MESSAGE = "Se perdió la conexión con el coordinador. Inicia sesión de nuevo.";

// Vigilancia del token guardado (igual que el lobby): si cambia o desaparece, la sesión se cae
const TOKEN_CHECK_MS = 1000;
const TOKEN_CHANGED_MESSAGE = "El token de tu sesión no es válido. Inicia sesión de nuevo.";
const TOKEN_REMOVED_MESSAGE = "Tu sesión se cerró. Inicia sesión de nuevo.";

const UNSTABLE_AFTER_MS = 3000; // sin state durante más de 3 s → aviso
const MAX_FRAME_DT = 0.05;
const PROVIDER_LABELS = { google: "Google", local: "Local" };

// Estado más reciente del servidor (el mensaje state completo). Es la única fuente de verdad.
window.lastState = null;

// Lee el payload del JWT sin verificar la firma (eso lo hace el coordinator). Solo para mostrar datos.
function decodeTokenPayload(token) {
    try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

// Borra la sesión guardada solo si el token sigue siendo el de esta pestaña
// (todas las pestañas comparten localStorage)
function clearSession(token) {
    if (localStorage.getItem("token") !== token) return;
    localStorage.removeItem("token");
    localStorage.removeItem("username");
}

function setConnection(state) {
    const texts = { connecting: "Conectando…", connected: "Conectado", disconnected: "Desconectado" };
    $("connection").dataset.state = state;
    $("connectionText").textContent = texts[state];
}

function startGame(token) {
    const payload = decodeTokenPayload(token);
    let me = { userId: payload?.userId ?? null };
    let world = null;
    let loggingOut = false;
    let lastStateAt = 0;
    let welcomeAt = 0;

    // Cabecera: username y proveedor (solo para mostrar; el servidor manda el suyo en welcome)
    const provider = payload?.provider;
    $("meName").textContent = payload?.username ?? localStorage.getItem("username") ?? "";
    if (PROVIDER_LABELS[provider]) {
        $("meProvider").textContent = PROVIDER_LABELS[provider];
        $("meProvider").dataset.provider = provider;
        $("meProvider").hidden = false;
    }
    setConnection("connecting");

    // ---------- Canvas ----------
    const canvas = $("gameCanvas");
    const box = $("canvasBox");
    const renderer = createRenderer(canvas);
    const fitCanvas = () => {
        if (world) renderer.resize(world, box.clientWidth, box.clientHeight);
    };
    new ResizeObserver(fitCanvas).observe(box);

    // ---------- WebSocket ----------
    const ws = new WebSocket(`${window.APP_CONFIG.COORDINATOR_WS_URL}/connect?token=${encodeURIComponent(token)}`);
    const sendJson = (msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.onopen = () => setConnection("connected");

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return; // mensaje que no es JSON: se ignora
        }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "welcome") {
            const w = msg.world;
            if (w && [w.width, w.height, w.playerRadius].every(Number.isFinite)) {
                world = { width: w.width, height: w.height, playerRadius: w.playerRadius, tickRate: w.tickRate };
                welcomeAt = performance.now();
                fitCanvas();
            }
            if (msg.you?.userId) me = { userId: String(msg.you.userId) };
        } else if (msg.type === "state") {
            if (!Array.isArray(msg.players)) return;
            window.lastState = msg;
            lastStateAt = performance.now();
        }
        // players_update se ignora: la lista sale de lastState
    };

    // Cierre inesperado: se guarda el motivo y se vuelve al login (sin reconexión automática).
    // Con 4002 el token guardado ya es de la sesión nueva (otra pestaña): no se borra.
    ws.onclose = (event) => {
        setConnection("disconnected");
        clearInterval(tokenWatch);
        if (loggingOut) return;
        sessionStorage.setItem("sessionMessage", CLOSE_MESSAGES[event.code] || DEFAULT_CLOSE_MESSAGE);
        if (event.code !== 4002) clearSession(token);
        window.location.href = "login.html";
    };

    $("logoutButton").addEventListener("click", () => {
        loggingOut = true;
        clearSession(token);
        ws.close(1000, "logout");
        window.location.href = "login.html";
    });

    // El coordinator solo valida el token al conectar: si el token guardado cambia o desaparece con la
    // sesión abierta, esta sesión ya no es válida (igual que en el lobby)
    function checkStoredToken() {
        const stored = localStorage.getItem("token");
        if (loggingOut || stored === token) return;
        loggingOut = true;
        clearInterval(tokenWatch);
        sessionStorage.setItem("sessionMessage", stored === null ? TOKEN_REMOVED_MESSAGE : TOKEN_CHANGED_MESSAGE);
        ws.close(1000, "invalid token");
        window.location.href = "login.html";
    }
    const tokenWatch = setInterval(checkStoredToken, TOKEN_CHECK_MS);
    window.addEventListener("storage", (event) => {
        if (event.key === "token" || event.key === null) checkStoredToken();
    });

    // ---------- Lista de jugadores (solo cuando cambia) ----------
    let listSignature = "";
    function updatePlayerList(state) {
        const players = state?.players ?? [];
        const signature = players.map((p) => `${p.userId}|${p.username}|${p.provider}|${playerColor(p)}`).join(";") + `#${me.userId}`;
        if (signature === listSignature) return;
        listSignature = signature;

        const rows = players.map((p) => {
            const li = document.createElement("li");
            li.className = "play-player";
            const isMe = p.userId === me.userId;
            if (isMe) li.classList.add("is-me");

            const dot = document.createElement("span");
            dot.className = "play-player__dot";
            dot.style.background = playerColor(p); // único estilo en línea: el color del jugador
            dot.setAttribute("aria-hidden", "true");

            const name = document.createElement("span");
            name.className = "play-player__name";
            name.textContent = isMe ? `${p.username} (tú)` : p.username;

            li.append(dot, name);
            if (PROVIDER_LABELS[p.provider]) {
                const badge = document.createElement("span");
                badge.className = "provider-badge";
                badge.dataset.provider = p.provider;
                badge.textContent = PROVIDER_LABELS[p.provider];
                li.append(badge);
            }
            return li;
        });
        $("playerList").replaceChildren(...rows);
        $("playerCount").textContent = String(players.length);
    }

    // ---------- Bucle de dibujo ----------
    let lastFrame = performance.now();
    function frame(now) {
        const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_DT);
        lastFrame = now;
        renderer.draw(window.lastState, world, me, now, dt);
        updatePlayerList(window.lastState);

        // Aviso discreto si dejan de llegar state
        const since = lastStateAt || welcomeAt;
        $("unstableNotice").hidden = !(ws.readyState === WebSocket.OPEN && since && now - since > UNSTABLE_AFTER_MS);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { sendJson, isClosing: () => loggingOut };
}

// Sin token no hay sesión: directo al login
const token = localStorage.getItem("token");
if (!token) {
    window.location.href = "login.html";
} else {
    startGame(token);
}
